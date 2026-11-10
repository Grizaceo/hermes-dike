"""Fixtures y respuestas sintéticas compartidas del adaptador, sin corpus real."""
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


def call(native, monkeypatch, payload, code=0):
    monkeypatch.setattr(native, '_dike', lambda *a, **kw: subprocess.CompletedProcess([], code, json.dumps(payload), ''))
    return json.loads(native.verificar_citas({'texto': 'artículo 161'}))
