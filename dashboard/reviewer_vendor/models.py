"""Pydantic v2 models for the span annotation module."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

AnnotationStatus = Literal["pending", "approved"]
DocType = Literal["sentencia", "resolucion", "otro"]
RelationMentionType = Literal["FUNDAMENTA", "MENCIONA"]
RelationFunctionType = Literal["CONTEXTO", "INTERPRETACION", "APLICACION", "RESOLUCION"]
QuickReviewDecision = Literal[
    "APPROVE",
    "MADURAR",
    "REJECT",
    "APPROVE_AS_IS",
    "APPROVE_WITH_CORRECTION",
    "REJECT_TOTAL",
    "REJECT_PARTIAL_WITH_CORRECTION",
    "DEFER_NEEDS_MORE_EVIDENCE",
    "OUT_OF_SCHEMA",
    "OUT_OF_DOMAIN",
]
ReviewConfidence = Literal["LOW", "MEDIUM", "HIGH", "VERY_HIGH"]
ErrorLayer = Literal[
    "RETRIEVAL",
    "RERANKING",
    "NODE_RESOLUTION",
    "EDGE_TYPING",
    "EVIDENCE_SELECTION",
    "SOURCE_TRUST",
    "SCOPE_FILTERING",
    "TEMPORAL_MISMATCH",
    "AUTHORITY_INSUFFICIENT",
]
CorrectionType = Literal["NONE", "NODE_FIX", "EDGE_FIX", "SPAN_FIX", "FULL_REWRITE", "QUERY_MISFIRED"]
ReviewerConflictCheck = Literal["NONE_DECLARED", "DECLARED_NONE", "CONFLICT_DECLARED", "RECUSED"]
ReviewerTier = Literal["INTERNAL_CURATOR", "EXTERNAL_LAWYER_DONATING", "PUBLIC_CONTRIBUTOR"]
ReviewerSeniorityTier = Literal["JUNIOR", "MID", "SENIOR", "PRINCIPAL"]
AgreementStatus = Literal["UNIQUE_REVIEW", "AGREE", "DISAGREE_RESOLVED", "DISAGREE_OPEN"]


# ---------------------------------------------------------------------------
# Label vocabulary — closed enums matching project schemas
# ---------------------------------------------------------------------------

PROPOSITION_TYPES = (
    "FACT_PROPOSITION",
    "RULE_PROPOSITION",
    "RULE_APPLICATION_PROPOSITION",
    "CONCLUSION_PROPOSITION",
    "DEFINITION_PROPOSITION",
)

PROCEDURAL_ROLES = (
    "HECHO_ALEGADO",
    "HECHO_PROBADO",
    "FUNDAMENTO_DERECHO",
    "HOLDING",
)

DOCUMENT_SECTIONS = (
    "VISTOS",
    "CONSIDERANDOS",
    "RESUELVO",
    "COSTAS",
    "OTRO",
)

POLARITY_VALUES = ("POSITIVE", "NEGATIVE")

MENTION_SIGNALS = ("CONTEXTO", "INTERPRETACION", "APLICACION", "RESOLUCION")

LabelCategory = Literal[
    "proposition_type",
    "procedural_role",
    "document_section",
    "polarity",
    "mention_signal",
    "entity",
    "case_prep_lexo",
    "case_prep_generic",
    "custom",
]

# Mapping category → allowed values (for UI config endpoint)
LABEL_CONFIG: dict[str, tuple[str, ...]] = {
    "proposition_type": PROPOSITION_TYPES,
    "procedural_role": PROCEDURAL_ROLES,
    "document_section": DOCUMENT_SECTIONS,
    "polarity": POLARITY_VALUES,
    "mention_signal": MENTION_SIGNALS,
}

# Reduced label config for the public-facing UI (most frequent, self-explanatory labels)
LABEL_CONFIG_PUBLIC: dict[str, tuple[str, ...]] = {
    "proposition_type": (
        "FACT_PROPOSITION",
        "RULE_PROPOSITION",
        "CONCLUSION_PROPOSITION",
        "DEFINITION_PROPOSITION",
    ),
    "procedural_role": (
        "HOLDING",
        "FUNDAMENTO_DERECHO",
        "HECHO_PROBADO",
    ),
    "document_section": (
        "VISTOS",
        "CONSIDERANDOS",
        "RESUELVO",
    ),
}

CASE_PREP_LABEL_CONFIG: dict[str, tuple[str, ...]] = {
    "case_prep_lexo": (
        "hecho_relevante",
        "norma_citada",
        "argumento_principal",
        "conflicto_normativo",
        "ratio_decidendi",
        "obiter_dictum",
        "prueba_relevante",
        "peticion",
        "pretension",
        "fundamento_juridico",
    ),
    "case_prep_generic": (
        "antecedente",
        "problema_juridico",
        "riesgo",
        "oportunidad",
        "fortaleza",
        "debilidad",
        "estrategia",
        "hecho_clave",
        "hito_procesal",
        "objetivo_defensa",
    ),
}


# ---------------------------------------------------------------------------
# Core models
# ---------------------------------------------------------------------------


def _make_annotation_id() -> str:
    return f"ann-{uuid.uuid4()}"


def _make_relation_label_id() -> str:
    return f"rel-{uuid.uuid4()}"


def _make_relation_candidate_id() -> str:
    return f"cand-{uuid.uuid4()}"


def _make_relation_review_id() -> str:
    return f"rev-{uuid.uuid4()}"


def _make_case_prep_id() -> str:
    return f"case-{uuid.uuid4()}"


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


class AnnotationLabel(BaseModel):
    """Single label applied to a span."""

    model_config = ConfigDict(extra="forbid")

    category: LabelCategory
    value: str = Field(min_length=1)


class SpanAnnotation(BaseModel):
    """One annotated span over a legal document."""

    model_config = ConfigDict(extra="forbid")

    annotation_id: str = Field(default_factory=_make_annotation_id)
    doc_id: str = Field(min_length=1)
    annotator: str = Field(min_length=1)

    # Core selection
    text: str = Field(min_length=1)
    start_offset: int = Field(ge=0)
    end_offset: int = Field(gt=0)

    # Context / snippet expansion
    context_text: str = ""
    context_start_offset: int | None = None
    context_end_offset: int | None = None
    snippet_words_before: int = Field(default=0, ge=0)
    snippet_words_after: int = Field(default=0, ge=0)
    page_start: int | None = Field(default=None, ge=1)
    page_end: int | None = Field(default=None, ge=1)

    # Labels & layers
    labels: list[AnnotationLabel] = Field(min_length=1)
    layer: int = Field(default=0, ge=0)
    legal_issue: str | None = None

    # Metadata
    notes: str = ""
    created_at: str = Field(default_factory=_now_iso)
    status: AnnotationStatus = "pending"


class RelationLabel(BaseModel):
    """Human-reviewed legal relation label produced in Ventana A."""

    model_config = ConfigDict(extra="forbid")

    relation_id: str = Field(default_factory=_make_relation_label_id)
    doc_id: str = Field(min_length=1)
    reviewer: str = Field(min_length=1)
    edge_type: str = Field(min_length=1)
    source_node_id: str = Field(min_length=1)
    target_node_id: str = Field(min_length=1)
    function_type: RelationFunctionType
    mention_type: RelationMentionType
    evidence_snippet: str = Field(min_length=1)
    start_offset: int = Field(ge=0)
    end_offset: int = Field(gt=0)
    source_url: str = Field(min_length=1)
    text_hash: str = Field(min_length=1)
    confidence: float = Field(ge=0.0, le=1.0)
    validated_by_human: bool = True
    reviewer_notes: str = Field(min_length=1)
    created_at: str = Field(default_factory=_now_iso)
    # E6: fecha de referencia para verificación temporal (ISO YYYY-MM-DD).
    # Default: hoy (fecha de la sesión de revisión).
    source_date: str = Field(default_factory=lambda: _now_iso()[:10])
    # E6: advertencia temporal generada al guardar (norma no vigente al source_date).
    temporal_warning: dict[str, Any] | None = None


class RelationCandidate(BaseModel):
    """Model-ranked legal relation candidate ingested in Ventana B."""

    model_config = ConfigDict(extra="forbid")

    candidate_id: str = Field(default_factory=_make_relation_candidate_id)
    doc_id: str = Field(min_length=1)
    suggested_by: str = Field(min_length=1)
    suggestion_confidence: float = Field(ge=0.0, le=1.0)
    edge_type: str = Field(min_length=1)
    source_node_id: str = Field(min_length=1)
    target_node_id: str = Field(min_length=1)
    function_type: RelationFunctionType
    mention_type: RelationMentionType
    evidence_snippet: str = Field(min_length=1)
    start_offset: int = Field(ge=0)
    end_offset: int = Field(gt=0)
    source_url: str = ""
    text_hash: str | None = None
    created_at: str = Field(default_factory=_now_iso)


class RelationCandidateCorrection(BaseModel):
    """Optional reviewer corrections applied to a candidate before export."""

    model_config = ConfigDict(extra="forbid")

    edge_type: str | None = None
    source_node_id: str | None = None
    target_node_id: str | None = None
    function_type: RelationFunctionType | None = None
    mention_type: RelationMentionType | None = None
    evidence_snippet: str | None = None
    start_offset: int | None = Field(default=None, ge=0)
    end_offset: int | None = Field(default=None, gt=0)
    source_url: str | None = None
    text_hash: str | None = None
    correction_type: CorrectionType | None = None


class RelationReviewDecisionRecord(BaseModel):
    """Auditable decision produced while reviewing a candidate in Ventana B."""

    model_config = ConfigDict(extra="forbid")

    review_id: str = Field(default_factory=_make_relation_review_id)
    candidate_id: str = Field(min_length=1)
    doc_id: str = Field(min_length=1)
    suggested_by: str = Field(min_length=1)
    suggestion_confidence: float = Field(ge=0.0, le=1.0)
    decision: QuickReviewDecision
    reviewer_notes: str = Field(min_length=1)
    comments_private: str = Field(min_length=1)
    comments_for_training: str | None = None
    review_confidence: ReviewConfidence | None = None
    error_layer: ErrorLayer | None = None
    correction_type: CorrectionType | None = None
    reviewer_conflict_check: ReviewerConflictCheck = "NONE_DECLARED"
    reviewer_tier: ReviewerTier = "INTERNAL_CURATOR"
    reviewer_seniority_tier: ReviewerSeniorityTier = "MID"
    agreement_status: AgreementStatus = "UNIQUE_REVIEW"
    corrections: RelationCandidateCorrection | None = None
    routed_to: Literal["to_canonic", "to_review_graph"]
    reviewed_by: str = Field(min_length=1)
    reviewed_at: str = Field(default_factory=_now_iso)


class CasePrepAnnotation(BaseModel):
    """Private case-prep annotation produced in Ventana C."""

    model_config = ConfigDict(extra="forbid")

    case_prep_id: str = Field(default_factory=_make_case_prep_id)
    doc_id: str = Field(min_length=1)
    annotator: str = Field(min_length=1)
    text: str = Field(min_length=1)
    start_offset: int = Field(ge=0)
    end_offset: int = Field(gt=0)
    labels: list[AnnotationLabel] = Field(min_length=1)
    notes: str = ""
    priority: Literal["alta", "media", "baja"] = "media"
    user_metadata: dict[str, str] = Field(default_factory=dict)
    donate_to_lexcon: bool = False
    created_at: str = Field(default_factory=_now_iso)


BibliographySourceKind = Literal[
    "journal_article",
    "book",
    "book_chapter",
    "institutional_document",
    "case",
    "web",
    "unknown",
]
BibliographyVerificationLevel = Literal["low", "medium", "high"]
BibliographyQuoteKind = Literal[
    "textual",
    "paraphrase",
    "idea",
    "definition",
    "method",
    "evidence",
    "counterargument",
]


def _make_bibliography_quote_id() -> str:
    return f"bq-{uuid.uuid4()}"


class BibliographySource(BaseModel):
    """Normalized bibliographic metadata for a source document under review."""

    model_config = ConfigDict(extra="forbid")

    doc_id: str = Field(min_length=1)
    source_kind: BibliographySourceKind = "unknown"
    title: str = ""
    authors: list[str] = Field(default_factory=list)
    year: str = ""
    container_title: str = ""
    volume: str = ""
    issue: str = ""
    pages: str = ""
    publisher: str = ""
    institution: str = ""
    doi: str = ""
    url: str = ""
    citation_text: str = ""
    short_citation: str = ""
    extractor_kind: str = "native"
    extraction_notes: str = ""
    verification_level: BibliographyVerificationLevel = "low"
    reviewed_by_human: bool = False
    updated_at: str = Field(default_factory=_now_iso)


class BibliographyQuote(BaseModel):
    """Citable passage extracted from a reviewed bibliography source."""

    model_config = ConfigDict(extra="forbid")

    quote_id: str = Field(default_factory=_make_bibliography_quote_id)
    doc_id: str = Field(min_length=1)
    annotator: str = Field(min_length=1)
    text: str = Field(min_length=1)
    start_offset: int = Field(ge=0)
    end_offset: int = Field(gt=0)
    page_start: int | None = Field(default=None, ge=1)
    page_end: int | None = Field(default=None, ge=1)
    quote_kind: BibliographyQuoteKind = "textual"
    tags: list[str] = Field(default_factory=list)
    note: str = ""
    citation_hint: str = ""
    created_at: str = Field(default_factory=_now_iso)


class AnnotationDocument(BaseModel):
    """A document with its full text and annotations."""

    # extra="ignore" allows loading old sessions without doc_type/sub_group
    model_config = ConfigDict(extra="ignore")

    doc_id: str = Field(min_length=1)
    source_file: str = ""
    full_text: str = ""
    annotations: list[SpanAnnotation] = Field(default_factory=list)
    case_prep_annotations: list[CasePrepAnnotation] = Field(default_factory=list)
    bibliography_source: BibliographySource | None = None
    bibliography_quotes: list[BibliographyQuote] = Field(default_factory=list)
    relation_labels: list[RelationLabel] = Field(default_factory=list)
    relation_candidates: list[RelationCandidate] = Field(default_factory=list)
    relation_decisions: list[RelationReviewDecisionRecord] = Field(default_factory=list)

    # Minimal units (per LEGAL_MINIMAL_UNITS_THEORY §8 — detected/structured/reviewable/canonical)
    minimal_units: list[dict] = Field(default_factory=list)

    # Classification metadata
    doc_type: DocType = "otro"
    sub_group: str = ""  # free text: tribunal name or issuing body

    # File metadata / extraction cache
    original_relpath: str = ""
    file_sha256: str = ""
    text_cache_path: str = ""
    extraction_mode: str = ""  # native | ocr | text | docx
    source_mtime: float | None = None
    extraction_metadata: dict | None = None
    review_notes: str = ""

    # Review reentrada state
    review_state: dict | None = None  # { last_page: int, last_span_id: str|None, timestamp: str }


class AnnotationSession(BaseModel):
    """A complete annotation session (one annotator, many documents)."""

    model_config = ConfigDict(extra="forbid")

    session_id: str = Field(default_factory=lambda: f"ses-{uuid.uuid4()}")
    annotator: str = Field(min_length=1)
    documents: list[AnnotationDocument] = Field(default_factory=list)
    created_at: str = Field(default_factory=_now_iso)


class SuggestedSpan(BaseModel):
    """A deterministic pipeline suggestion for a span annotation."""

    model_config = ConfigDict(extra="forbid")

    suggestion_id: str = Field(default_factory=lambda: f"sug-{uuid.uuid4()}")
    start_offset: int = Field(ge=0)
    end_offset: int = Field(gt=0)
    text: str = Field(min_length=1)
    label_category: LabelCategory
    label_value: str = Field(min_length=1)
    confidence: float = Field(ge=0.0, le=1.0)
    extraction_method: str = ""


__all__ = [
    "LABEL_CONFIG",
    "CASE_PREP_LABEL_CONFIG",
    "LABEL_CONFIG_PUBLIC",
    "QuickReviewDecision",
    "ReviewConfidence",
    "ErrorLayer",
    "CorrectionType",
    "ReviewerConflictCheck",
    "ReviewerTier",
    "ReviewerSeniorityTier",
    "AgreementStatus",
    "MENTION_SIGNALS",
    "POLARITY_VALUES",
    "PROCEDURAL_ROLES",
    "CasePrepAnnotation",
    "BibliographySource",
    "BibliographyQuote",
    "BibliographySourceKind",
    "BibliographyVerificationLevel",
    "BibliographyQuoteKind",
    "RelationCandidate",
    "RelationCandidateCorrection",
    "RelationFunctionType",
    "RelationLabel",
    "RelationMentionType",
    "RelationReviewDecisionRecord",
    "DOCUMENT_SECTIONS",
    "PROPOSITION_TYPES",
    "AnnotationDocument",
    "AnnotationLabel",
    "AnnotationSession",
    "AnnotationStatus",
    "DocType",
    "LabelCategory",
    "SpanAnnotation",
    "SuggestedSpan",
]
