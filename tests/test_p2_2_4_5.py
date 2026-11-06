"""Tests for P2-2, P2-4, P2-5 remediación Opus 5.5.

P2-2: datos path must be resolved before corpus installation (symlink-safe).
P2-4: meta.documento must not contain local paths; neutral label only.
P2-5: Error classification must distinguish timeout, JSON errors, exit errors.
No ruta absoluta in output. No arbitrary stderr dumped.
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
    return {
        "veredicto": "TODAS_VERIFICADAS",
        "mensaje": "Todas las referencias normativas del escrito tienen fuente, integridad y vigencia verificables.",
        "alcance": "La constancia acredita identidad de la referencia.",
        "problemas": [],
        "citation_disclosure": {"alcance": [], "verificadas": ["161"], "no_verificadas": [], "advertencias": []},
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
            "documento": "/home/abogado/proyectos/dike/docs/escrito.md",
            "origen": None,
        },
    }


# ── P2-2: resolve datos path before corpus installation ─────────────────

def test_data_dir_resolved_before_install(monkeypatch, tmp_path):
    """P2-2: datos.resolve() is called before _asegurar_corpus to handle symlinks."""
    spec = importlib.util.spec_from_file_location('native_p22', Path(__file__).parents[1] / '__init__.py')
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    # Point datos to a symlinked dir.
    real_dir = tmp_path / 'real_data'
    real_dir.mkdir()
    link_dir = tmp_path / 'link_data'
    link_dir.symlink_to(real_dir)
    monkeypatch.setattr(m, '_carpeta_de_datos', lambda: link_dir)

    resolved_seen = []
    def fake_asegurar(datos):
        resolved_seen.append(datos)
        return {'generation': str(datos)}
    monkeypatch.setattr(m, '_asegurar_corpus', fake_asegurar)
    monkeypatch.setattr(m, '_dike', lambda *a, **kw: subprocess.CompletedProcess([], 1, '{}', ''))

    m.verificar_citas({'texto': 'art. 9999'})
    # datos must have been resolved (not a symlink path).
    assert resolved_seen[0] == link_dir.resolve()
    assert not resolved_seen[0].is_symlink()


# ── P2-4: no local paths in output ───────────────────────────────────────

def test_no_local_path_in_documento(native, monkeypatch):
    """P2-4: meta.documento must be a neutral label, not an absolute path."""
    payload = _green_payload()
    monkeypatch.setattr(
        native, '_dike',
        lambda *a, **kw: subprocess.CompletedProcess([], 0, json.dumps(payload), ''),
    )
    result = json.loads(native.verificar_citas({'texto': 'art. 161'}))
    meta = result['meta']
    assert meta['documento'] == 'escrito'
    assert '/home/' not in json.dumps(result)
    assert '/tmp/' not in json.dumps(result)
    assert '/var/' not in json.dumps(result)


# ── P2-5: error classification ───────────────────────────────────────────

def test_timeout_classified(native, monkeypatch):
    """P2-5: TimeoutExpired is classified as TIMEOUT, not generic error."""
    def timeout(*a, **kw):
        raise subprocess.TimeoutExpired('synthetic-test', 300)
    monkeypatch.setattr(native, '_dike', timeout)
    result = json.loads(native.verificar_citas({'texto': 'art. 161'}))
    assert 'error' in result
    assert 'TIMEOUT' in result['error']
    assert result['todo_verificado'] is False
    # No stderr dumped.
    assert 'stderr' not in result['error'].lower()


def test_json_decode_error_classified(native, monkeypatch):
    """P2-5: Invalid JSON from engine is classified as ENGINE_JSON_ERROR."""
    monkeypatch.setattr(
        native, '_dike',
        lambda *a, **kw: subprocess.CompletedProcess([], 0, 'not json at all', ''),
    )
    result = json.loads(native.verificar_citas({'texto': 'art. 161'}))
    assert 'error' in result
    assert 'ENGINE_JSON_ERROR' in result['error']
    assert result['todo_verificado'] is False


def test_engine_exit_error_classified(native, monkeypatch):
    """P2-5: Engine crash (stderr with paths) classified as ENGINE_EXIT_ERROR."""
    monkeypatch.setattr(
        native, '_dike',
        lambda *a, **kw: subprocess.CompletedProcess([], 2, '', '/home/abogado/crash traceback'),
    )
    result = json.loads(native.verificar_citas({'texto': 'art. 161'}))
    assert 'error' in result
    assert 'ENGINE_EXIT_ERROR' in result['error']
    # No local paths leaked.
    assert '/home/abogado' not in result['error']
    assert result['todo_verificado'] is False


def test_error_no_stderr_secret_leak(native, monkeypatch):
    """P2-5: Secrets/tokens in stderr must be sanitized."""
    monkeypatch.setattr(
        native, '_dike',
        lambda *a, **kw: subprocess.CompletedProcess(
            [], 2, '',
            'Error: OPENAI_API_KEY=sk-secret-12345 traceback at /home/user/dike',
        ),
    )
    result = json.loads(native.verificar_citas({'texto': 'art. 161'}))
    assert 'error' in result
    assert 'sk-secret-12345' not in result['error']
    assert '/home/user/dike' not in result['error']


def test_validation_error_sanitized(native, monkeypatch):
    """P2-5: Validation errors must not leak local paths."""
    monkeypatch.setattr(
        native, '_dike',
        lambda *a, **kw: subprocess.CompletedProcess([], 0, json.dumps({}), ''),
    )
    result = json.loads(native.verificar_citas({'texto': 'art. 161'}))
    assert 'error' in result
    assert '/home/' not in result['error']
