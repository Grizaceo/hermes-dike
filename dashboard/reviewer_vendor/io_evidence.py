"""Evidence compliance export layer for legal-reviewer.

Converts SpanAnnotation sessions into EvidenceSpan-compliant records
for consumption by graph-legal-ir (Capa 3).

All derivations are deterministic — no LLM in the loop.
"""

from __future__ import annotations

import hashlib
import logging
import re
from typing import Any

from .models import AnnotationDocument, AnnotationLabel, AnnotationSession, SpanAnnotation

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_MENTION_TYPE_MAP: dict[str, str] = {
    "CONTEXTO": "MENCIONA",
    "INTERPRETACION": "FUNDAMENTA",
    "APLICACION": "FUNDAMENTA",
    "RESOLUCION": "FUNDAMENTA",
}

_DEFAULT_CONFIDENCE_FALLBACK = 0.8

# Regex to extract conf=<float> from notes (e.g. "conf=0.92")
_CONF_RE = re.compile(r"\bconf=([0-9]*\.?[0-9]+)")


# ---------------------------------------------------------------------------
# 1.1 — build_evidence_span
# ---------------------------------------------------------------------------

def build_evidence_span(
    ann: SpanAnnotation,
    doc: AnnotationDocument,
    canonicalizer_version: str = "v1",
) -> dict[str, Any] | None:
    """Build a single EvidenceSpan dict from a SpanAnnotation + its document.

    Returns None (and logs a warning) if ``ann.text`` doesn't match the
    slice of ``doc.full_text`` at the declared offsets, or if
    ``doc.full_text`` is empty/None.
    """
    full_text = doc.full_text or ""

    if not full_text:
        log.warning(
            "full_text_missing: ann=%s doc=%s — cannot build EvidenceSpan",
            ann.annotation_id,
            doc.doc_id,
        )
        return None

    snippet_exact = full_text[ann.start_offset : ann.end_offset]

    if snippet_exact != ann.text:
        log.warning(
            "snippet_mismatch: ann=%s doc=%s offsets=[%d:%d] "
            "expected=%r got=%r",
            ann.annotation_id,
            doc.doc_id,
            ann.start_offset,
            ann.end_offset,
            ann.text,
            snippet_exact,
        )
        return None

    text_hash = hashlib.sha256(full_text.encode("utf-8")).hexdigest()
    prefix = full_text[max(0, ann.start_offset - 10) : ann.start_offset]
    suffix = full_text[ann.end_offset : min(len(full_text), ann.end_offset + 10)]

    # Page detection from extraction_metadata
    page_span = _detect_page_span(doc, ann.start_offset, ann.end_offset)

    # source_url
    source_url = doc.source_file or getattr(doc, "original_relpath", "") or "unknown"

    # validated_by_human
    validated_by_human = ann.status == "approved"

    # confidence + extraction_method
    confidence, extraction_method = _parse_confidence_and_method(ann)

    evidence: dict[str, Any] = {
        "source_url": source_url,
        "snippet_exact": snippet_exact,
        "selector": {
            "start_offset": ann.start_offset,
            "end_offset": ann.end_offset,
            "prefix": prefix,
            "suffix": suffix,
        },
        "page_span": page_span,
        "text_hash": text_hash,
        "confidence": confidence,
        "validated_by_human": validated_by_human,
        "extraction_method": extraction_method,
        "canonicalizer_version": canonicalizer_version,
    }

    return {
        "annotation_id": ann.annotation_id,
        "doc_id": ann.doc_id,
        "labels": [lb.model_dump(mode="json") for lb in ann.labels],
        "evidence": evidence,
    }


# ---------------------------------------------------------------------------
# 1.2 — derive_mention_axes
# ---------------------------------------------------------------------------

def derive_mention_axes(labels: list[AnnotationLabel]) -> dict[str, Any]:
    """Derive mention_type + function_type from a list of AnnotationLabel.

    Also extracts proposition_type and procedural_role if present.
    """
    mention_type: str | None = None
    function_type: str | None = None
    proposition_type: str | None = None
    procedural_role: str | None = None

    for lb in labels:
        if lb.category == "mention_signal":
            function_type = lb.value
            mention_type = _MENTION_TYPE_MAP.get(lb.value)
        elif lb.category == "proposition_type" and proposition_type is None:
            proposition_type = lb.value
        elif lb.category == "procedural_role" and procedural_role is None:
            procedural_role = lb.value

    return {
        "mention_type": mention_type,
        "function_type": function_type,
        "proposition_type": proposition_type,
        "procedural_role": procedural_role,
    }


# ---------------------------------------------------------------------------
# 1.3 — export_evidence_spans
# ---------------------------------------------------------------------------

def export_evidence_spans(
    session: AnnotationSession,
    canonicalizer_version: str = "v1",
) -> list[dict[str, Any]]:
    """Convert all annotations in a session into EvidenceSpan rows.

    Rows with snippet mismatches are included but marked
    ``evidence_complete: false`` with appropriate warnings.
    """
    output: list[dict[str, Any]] = []

    for doc in session.documents:
        for ann in doc.annotations:
            warnings: list[str] = []

            span_result = build_evidence_span(ann, doc, canonicalizer_version)

            if span_result is None:
                # Snippet mismatch — create a minimal stub row
                row: dict[str, Any] = {
                    "annotation_id": ann.annotation_id,
                    "doc_id": doc.doc_id,
                    "doc_type": doc.doc_type,
                    "sub_group": doc.sub_group,
                    "evidence": {
                        "source_url": doc.source_file or getattr(doc, "original_relpath", "") or "unknown",
                        "snippet_exact": None,
                        "selector": None,
                        "page_span": None,
                        "text_hash": None,
                        "confidence": None,
                        "validated_by_human": ann.status == "approved",
                        "extraction_method": None,
                        "canonicalizer_version": canonicalizer_version,
                    },
                    "mention_type": None,
                    "function_type": None,
                    "proposition_type": None,
                    "procedural_role": None,
                    "legal_issue": ann.legal_issue,
                    "evidence_complete": False,
                    "evidence_warnings": ["snippet_mismatch"],
                }
                output.append(row)
                continue

            axes = derive_mention_axes(ann.labels)

            # Build the evidence dict from the span result
            evidence = span_result["evidence"]

            # Warnings
            if not evidence["validated_by_human"]:
                warnings.append("not_human_validated")
            if evidence["source_url"] == "unknown":
                warnings.append("source_url_missing")

            row = {
                "annotation_id": span_result["annotation_id"],
                "doc_id": span_result["doc_id"],
                "doc_type": doc.doc_type,
                "sub_group": doc.sub_group,
                "evidence": evidence,
                "mention_type": axes["mention_type"],
                "function_type": axes["function_type"],
                "proposition_type": axes["proposition_type"],
                "procedural_role": axes["procedural_role"],
                "legal_issue": ann.legal_issue,
                "evidence_complete": True,
                "evidence_warnings": warnings,
            }
            output.append(row)

    return output


# ---------------------------------------------------------------------------
# 1.4 — evidence_compliance_report
# ---------------------------------------------------------------------------

def evidence_compliance_report(rows: list[dict[str, Any]]) -> dict[str, Any]:
    """Summarise compliance metrics for a list of EvidenceSpan rows.

    ``gate_passed`` is True iff ``compliance_rate >= 0.95`` (Gate C).
    """
    total = len(rows)
    if total == 0:
        return {
            "total": 0,
            "complete": 0,
            "validated": 0,
            "compliance_rate": 0.0,
            "validation_rate": 0.0,
            "warnings_breakdown": {},
            "gate_passed": False,
        }

    complete = sum(1 for r in rows if r.get("evidence_complete") is True)
    validated = sum(
        1 for r in rows if r.get("evidence", {}).get("validated_by_human") is True
    )

    warnings_breakdown: dict[str, int] = {}
    for r in rows:
        for w in r.get("evidence_warnings", []):
            warnings_breakdown[w] = warnings_breakdown.get(w, 0) + 1

    compliance_rate = complete / total
    validation_rate = validated / total

    return {
        "total": total,
        "complete": complete,
        "validated": validated,
        "compliance_rate": compliance_rate,
        "validation_rate": validation_rate,
        "warnings_breakdown": warnings_breakdown,
        "gate_passed": compliance_rate >= 0.95,
    }


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _detect_page_span(
    doc: AnnotationDocument, start_offset: int, end_offset: int
) -> dict[str, int | None] | None:
    """Return page_span dict if page_offsets are available in extraction_metadata."""
    meta = doc.extraction_metadata
    if not meta:
        return None

    page_offsets: list[int] | None = meta.get("page_offsets")
    if not page_offsets:
        return None

    page_start: int | None = None
    page_end: int | None = None

    for i, offset in enumerate(page_offsets):
        if page_start is None and offset > start_offset:
            page_start = i  # 1-based page number
        if offset > end_offset:
            page_end = i
            break

    if page_start is None:
        page_start = len(page_offsets)
    if page_end is None:
        page_end = len(page_offsets)

    return {"page_start": page_start, "page_end": page_end}


def _parse_confidence_and_method(ann: SpanAnnotation) -> tuple[float, str]:
    """Extract confidence and extraction_method from a SpanAnnotation.

    Rules (deterministic, no LLM):
    - notes contains 'conf=<float>' → parse max confidence, extraction_method from notes
    - notes contains 'Sugerencia confirmada' → extraction_method from notes, confidence from conf= or 0.8
    - otherwise → confidence 1.0 (manual), extraction_method 'annotator_ui_v1'
    """
    notes = ann.notes or ""

    conf_matches = _CONF_RE.findall(notes)
    has_suggestion = "Sugerencia confirmada" in notes

    if conf_matches:
        confidence = max(float(c) for c in conf_matches)
    elif has_suggestion:
        confidence = _DEFAULT_CONFIDENCE_FALLBACK
    else:
        confidence = 1.0

    if has_suggestion:
        # Try to extract explicit method name from notes (e.g. "regex_suggest_v1")
        method_match = re.search(r"\b(\w+_v\d+)\b", notes)
        extraction_method = method_match.group(1) if method_match else "annotator_ui_v1"
    else:
        extraction_method = "annotator_ui_v1"

    return confidence, extraction_method
