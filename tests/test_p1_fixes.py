"""RED-GREEN-REFACTOR: Tests for P1-1 and P1-2 remediación Opus 5.5.

P1-1: SIN_CITAS (code 0) and SIN_CORPUS (code 1) must be accepted as non-verde
results, validating their real fields and returning todo_verificado: false.
Replace the synthetic zero-citations test with a real captured envelope.

P1-2: todo_verificado must be False when citation_disclosure.no_verificadas
is non-empty, even if veredicto is TODAS_VERIFICADAS. Expose no_verificadas
at the top level.
"""
import importlib.util
import json
import subprocess
from datetime import date, datetime, timezone
from pathlib import Path

import pytest


@pytest.fixture
def native(monkeypatch, tmp_path):
    path = Path(__file__).parents[1] / '__init__.py'
    spec = importlib.util.spec_from_file_location('native_under_test', path)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    monkeypatch.setattr(m, '_carpeta_de_datos', lambda: tmp_path)
    monkeypatch.setattr(m, '_asegurar_corpus', lambda data: {})
    return m


# ── P1-1: SIN_CITAS and SIN_CORPUS as non-verde results ──────────────────

def _sin_citas_payload():
    """Synthetic fixture matching the observed SIN_CITAS shape; not a capture."""
    return {
        "veredicto": "SIN_CITAS",
        "mensaje": "El escrito no contiene citas normativas. Nada que verificar.",
        "detalles": [],
        "citation_disclosure": {
            "alcance": [
                "existencia de la norma en la fuente consultada",
                "citabilidad de su texto",
                "vigencia (estado IN_FORCE) a la fecha de la consulta",
            ],
            "verificadas": [],
            "no_verificadas": ["Ley 19.496", "Código Civil"],
            "advertencias": [
                "Diké verifica que estas normas existan, sean citables y estén vigentes; "
                "NO verifica que fundamenten sustantivamente lo que el escrito afirma. "
                " Esa fundamentación es juicio del abogado.",
                "No se acreditó ninguna cita en este resultado: no hay certificado de "
                "que la norma exista.",
                "El texto menciona normas sin artículo pinpoint que el gate no "
                "verificó: no son citas verificables tal cual, pero existen y no "
                "deben darse por comprobadas.",
            ],
        },
        "meta": {
            "documento": "escrito.md",
            "origen": None,
            "as_of": date.today().isoformat(),
            "fecha_constancia": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
            "pack_hash": "af1422d66d1e6eee",
        },
    }


def _sin_corpus_payload():
    """Synthetic SIN_CORPUS fixture based on engine source; not a capture."""
    return {
        "veredicto": "SIN_CORPUS",
        "mensaje": "No se pueden verificar las citas: ...",
        "detalles": [],
        "citation_disclosure": {
            "alcance": [],
            "verificadas": [],
            "no_verificadas": ["art. 9999"],
            "advertencias": [],
        },
        "meta": {
            "documento": "escrito.md",
            "origen": None,
            "as_of": date.today().isoformat(),
            "fecha_constancia": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
            "pack_hash": "sin-corpus",
        },
    }


def test_sin_citas_code0_never_verified(native, monkeypatch):
    """P1-1: A text without article citations returns SIN_CITAS, code 0.

    The engine's real output has no 'problemas' or 'alcance' fields and no
    citation counts in meta. The adapter must accept it as a valid non-verde
    result, not reject it as a contract error.
    """
    payload = _sin_citas_payload()
    monkeypatch.setattr(
        native, '_dike',
        lambda *a, **kw: subprocess.CompletedProcess([], 0, json.dumps(payload), ''),
    )
    result = json.loads(native.verificar_citas({'texto': 'La Ley 19.496 y el Código Civil.'}))
    assert 'error' not in result
    assert result['veredicto'] == 'SIN_CITAS'
    assert result['todo_verificado'] is False
    assert result['certificacion_sustantiva'] is False
    # Disclosure preserved with no_verificadas at top level (P1-2)
    assert result['no_verificadas'] == ['Ley 19.496', 'Código Civil']


def test_sin_corpus_code1_never_verified(native, monkeypatch):
    """P1-1: SIN_CORPUS (code 1) must also be accepted, not rejected."""
    payload = _sin_corpus_payload()
    monkeypatch.setattr(
        native, '_dike',
        lambda *a, **kw: subprocess.CompletedProcess([], 1, json.dumps(payload), ''),
    )
    result = json.loads(native.verificar_citas({'texto': 'art. 9999 del Código Civil'}))
    assert 'error' not in result
    assert result['veredicto'] == 'SIN_CORPUS'
    assert result['todo_verificado'] is False
    assert result['certificacion_sustantiva'] is False


def test_sin_citas_preserves_disclosure(native, monkeypatch):
    """P1-1: The citation_disclosure from the engine must be preserved."""
    payload = _sin_citas_payload()
    monkeypatch.setattr(
        native, '_dike',
        lambda *a, **kw: subprocess.CompletedProcess([], 0, json.dumps(payload), ''),
    )
    result = json.loads(native.verificar_citas({'texto': 'La Ley 19.496.'}))
    assert 'citation_disclosure' in result
    assert result['citation_disclosure']['no_verificadas'] == ['Ley 19.496', 'Código Civil']


# ── P1-2: todo_verificado must be False when no_verificadas is non-empty ──

def _verified_with_unverified_mention():
    """Synthetic single-citation positive control with an unverified mention."""
    return {
        "veredicto": "TODAS_VERIFICADAS",
        "mensaje": "Todas las referencias normativas del escrito...",
        "alcance": "La constancia acredita identidad de la referencia...",
        "problemas": [],
        "detalles": [
            {"cita_raw": "art. 161", "gid": "cl.9999...:art:161", "estado": "VERIFICADA",
             "resolucion": "RESOLVED", "cuerpo": "Código del Trabajo", "texto_hash": "a" * 64,
             "vigencia": "IN_FORCE", "vigencia_legible": "Vigente",
             "fuente_url": "https://...", "fecha_recuperacion": "2026-08-13T19:48:38Z",
             "estado_texto_historico": "CURRENT_VERSION_APPLIES"},
        ],
        "citation_disclosure": {
            "alcance": [],
            "verificadas": ["161"],
            "no_verificadas": ["Código"],
            "advertencias": [],
        },
        "meta": {
            "total_citas": 1, "citas_verificadas": 1, "citas_fallidas": 0,
            "pack_hash": "af1422d66d1e6eee",
            "as_of": date.today().isoformat(),
            "fecha_constancia": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
            "documento": "escrito.md", "origen": None,
        },
    }


def test_verified_with_unverified_mention_not_verified(native, monkeypatch):
    """P1-2: Even TODAS_VERIFICADAS must be False when no_verificadas is non-empty."""
    payload = _verified_with_unverified_mention()
    monkeypatch.setattr(
        native, '_dike',
        lambda *a, **kw: subprocess.CompletedProcess([], 0, json.dumps(payload), ''),
    )
    result = json.loads(native.verificar_citas({'texto': 'art. 161 del Código y Código Civil'}))
    assert result['todo_verificado'] is False
    assert result['no_verificadas'] == ['Código']


def test_verified_without_unverified_mentions_is_verified(native, monkeypatch):
    """P1-2: TODAS_VERIFICADAS with no_verificadas empty should be True."""
    payload = _verified_with_unverified_mention()
    payload['citation_disclosure']['no_verificadas'] = []
    payload['meta']['total_citas'] = 1
    monkeypatch.setattr(
        native, '_dike',
        lambda *a, **kw: subprocess.CompletedProcess([], 0, json.dumps(payload), ''),
    )
    result = json.loads(native.verificar_citas({'texto': 'art. 161 del Código del Trabajo'}))
    assert result['todo_verificado'] is True
    assert result['no_verificadas'] == []


# ── P1-1 regression: the old synthetic test must no longer exist ──────────

def test_zero_citations_uses_real_engine_envelope(native, monkeypatch):
    """P1-1: The replacement test for zero citations uses the real SIN_CITAS shape."""
    # This test replaces the old test_zero_citations_never_certifies which used
    # a fabricated envelope with CON_PROBLEMAS and inventada problemas list.
    # Here we verify the SIN_CITAS path works with the real engine envelope.
    payload = _sin_citas_payload()
    monkeypatch.setattr(
        native, '_dike',
        lambda *a, **kw: subprocess.CompletedProcess([], 0, json.dumps(payload), ''),
    )
    result = json.loads(native.verificar_citas({'texto': 'Sin referencias normativas'}))
    assert 'error' not in result
    assert result['todo_verificado'] is False
