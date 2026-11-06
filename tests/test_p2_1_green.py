"""Tests for P2-1: Green path validation with real invariants.

P2-1: En verde, exigir problemas == [] y VERIFIED coherente
(RESOLVED, IN_FORCE, CURRENT_VERSION_APPLIES).
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


def _today_iso():
    return date.today().isoformat()


def _now_iso():
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _green_payload():
    """A valid TODAS_VERIFICADAS envelope with all invariants satisfied."""
    return {
        "veredicto": "TODAS_VERIFICADAS",
        "mensaje": "Todas las referencias normativas del escrito tienen fuente, integridad y vigencia verificables.",
        "alcance": "La constancia acredita identidad de la referencia, integridad del texto fuente, provenance y vigencia.",
        "problemas": [],
        "citation_disclosure": {
            "alcance": ["existencia", "citabilidad", "vigencia"],
            "verificadas": ["161"],
            "no_verificadas": [],
            "advertencias": [],
        },
        "detalles": [
            {
                "cita_raw": "art. 161",
                "gid": "cl.9999.cc:art:0161",
                "estado": "VERIFICADA",
                "resolucion": "RESOLVED",
                "cuerpo": "Código del Trabajo",
                "texto_hash": "a" * 64,
                "vigencia": "IN_FORCE",
                "vigencia_legible": "Vigente",
                "fuente_url": "https://www.bcn.cl/leychile/navegar?idNorma=12345",
                "fecha_recuperacion": "2026-08-13T19:48:38Z",
                "estado_texto_historico": "CURRENT_VERSION_APPLIES",
            }
        ],
        "meta": {
            "total_citas": 1, "citas_verificadas": 1, "citas_fallidas": 0,
            "pack_hash": "af1422d66d1e6eee",
            "as_of": _today_iso(),
            "fecha_constancia": _now_iso(),
            "documento": "escrito.md", "origen": None,
        },
    }


def test_green_path_verified(native, monkeypatch):
    """Positive control: a valid green envelope passes and sets todo_verificado=True."""
    monkeypatch.setattr(
        native, '_dike',
        lambda *a, **kw: subprocess.CompletedProcess([], 0, json.dumps(_green_payload()), ''),
    )
    result = json.loads(native.verificar_citas({'texto': 'art. 161 del Código del Trabajo'}))
    assert 'error' not in result
    assert result['veredicto'] == 'TODAS_VERIFICADAS'
    assert result['todo_verificado'] is True


def test_green_problemas_nonempty_rejected(native, monkeypatch):
    """P2-1: TODAS_VERIFICADAS with non-empty problemas must be rejected."""
    payload = _green_payload()
    payload['problemas'] = ['unexpected issue']
    monkeypatch.setattr(
        native, '_dike',
        lambda *a, **kw: subprocess.CompletedProcess([], 0, json.dumps(payload), ''),
    )
    result = json.loads(native.verificar_citas({'texto': 'art. 161 del Código del Trabajo'}))
    assert 'error' in result
    assert result['todo_verificado'] is False


def test_verified_nonresolved_rejected(native, monkeypatch):
    """P2-1: VERIFICADA with resolucion != RESOLVED must be rejected."""
    payload = _green_payload()
    payload['detalles'][0]['resolucion'] = "UNRESOLVED"
    monkeypatch.setattr(
        native, '_dike',
        lambda *a, **kw: subprocess.CompletedProcess([], 0, json.dumps(payload), ''),
    )
    result = json.loads(native.verificar_citas({'texto': 'art. 161'}))
    assert 'error' in result


def test_verified_noninforce_rejected(native, monkeypatch):
    """P2-1: VERIFICADA with vigencia != IN_FORCE must be rejected."""
    payload = _green_payload()
    payload['detalles'][0]['vigencia'] = "OUT_OF_FORCE"
    monkeypatch.setattr(
        native, '_dike',
        lambda *a, **kw: subprocess.CompletedProcess([], 0, json.dumps(payload), ''),
    )
    result = json.loads(native.verificar_citas({'texto': 'art. 161'}))
    assert 'error' in result


def test_verified_noncurrent_historical_rejected(native, monkeypatch):
    """P2-1: VERIFICADA with estado_texto_historico != CURRENT_VERSION_APPLIES must be rejected."""
    payload = _green_payload()
    payload['detalles'][0]['estado_texto_historico'] = "HISTORICAL_TEXT_UNAVAILABLE"
    monkeypatch.setattr(
        native, '_dike',
        lambda *a, **kw: subprocess.CompletedProcess([], 0, json.dumps(payload), ''),
    )
    result = json.loads(native.verificar_citas({'texto': 'art. 161'}))
    assert 'error' in result


def test_green_as_of_must_be_today(native, monkeypatch):
    """P2-1/P2-3: as_of must match today's date for green results."""
    payload = _green_payload()
    payload['meta']['as_of'] = "2020-01-01"
    monkeypatch.setattr(
        native, '_dike',
        lambda *a, **kw: subprocess.CompletedProcess([], 0, json.dumps(payload), ''),
    )
    result = json.loads(native.verificar_citas({'texto': 'art. 161'}))
    assert 'error' in result
    assert result['todo_verificado'] is False


def test_green_pin_pack_hash_preserved(native, monkeypatch):
    """P2-1: pack_hash must match the expected pinned value."""
    payload = _green_payload()
    monkeypatch.setattr(
        native, '_dike',
        lambda *a, **kw: subprocess.CompletedProcess([], 0, json.dumps(payload), ''),
    )
    result = json.loads(native.verificar_citas({'texto': 'art. 161'}))
    assert 'error' not in result
    assert result['meta']['pack_hash'] == 'af1422d66d1e6eee'


def test_unknown_verdict_rejected(native, monkeypatch):
    """P2-1: An unknown verdict must not produce a green result."""
    payload = _green_payload()
    payload['veredicto'] = "UNKNOWN_VERDICT"
    monkeypatch.setattr(
        native, '_dike',
        lambda *a, **kw: subprocess.CompletedProcess([], 0, json.dumps(payload), ''),
    )
    result = json.loads(native.verificar_citas({'texto': 'art. 161'}))
    assert 'error' in result
