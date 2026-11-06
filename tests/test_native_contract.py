"""Native entrypoint regression tests: actual constancia envelope, not commitment.

P1-1 remediación: the synthetic zero-citations test (test_zero_citations_never_certifies)
was replaced by test_p1_fixes.py::test_sin_citas_code0_never_verified and
test_zero_citations_uses_real_engine_envelope, which use the real SIN_CITAS
envelope shape from the engine.
"""
import importlib.util
import json
from datetime import date, datetime, timezone
from pathlib import Path
import subprocess

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


def envelope():
    return {'veredicto': 'CON_PROBLEMAS', 'alcance': 'Identidad, no interpretación',
            'problemas': ['No se resuelve la referencia'], 'citation_disclosure': {'advertencias': [], 'no_verificadas': []},
            'detalles': [{'cita_raw': 'artículo 9999', 'estado': 'FALLO', 'resolucion': 'UNRESOLVABLE'}],
            'meta': {'total_citas': 1, 'citas_verificadas': 0, 'citas_fallidas': 1,
                     'pack_hash': 'af1422d66d1e6eee', 'as_of': date.today().isoformat(),
                     'fecha_constancia': datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")}}


@pytest.mark.parametrize('payload,code', [({}, 0), ({}, 1), ([], 0), (envelope(), 0)])
def test_invalid_contract_never_green(native, monkeypatch, payload, code):
    monkeypatch.setattr(native, '_dike', lambda *a, **kw: subprocess.CompletedProcess([], code, json.dumps(payload), ''))
    result = json.loads(native.verificar_citas({'texto': 'artículo 9999'}))
    assert 'error' in result
    assert result.get('todo_verificado') is not True


def test_rejection_preserves_explanation(native, monkeypatch):
    monkeypatch.setattr(native, '_dike', lambda *a, **kw: subprocess.CompletedProcess([], 1, json.dumps(envelope()), ''))
    result = json.loads(native.verificar_citas({'texto': 'artículo 9999'}))
    assert 'error' not in result
    assert result['todo_verificado'] is False
    assert result['problemas'] == envelope()['problemas']


@pytest.mark.parametrize('args', [{'texto': 42}, {'texto': 'x' * 400001}, {'ruta': 42}, {'texto': 'x', 'ruta': 'x'}])
def test_input_rejected_before_install(native, monkeypatch, args):
    def must_not_install(*a):
        pytest.fail('invalid input reached corpus installation')
    monkeypatch.setattr(native, '_asegurar_corpus', must_not_install)
    assert 'error' in json.loads(native.verificar_citas(args))


def test_symlink_rejected(native, monkeypatch, tmp_path):
    p = tmp_path / 'real.md'
    p.write_text('artículo 9999')
    link = tmp_path / 'link.md'
    link.symlink_to(p)
    monkeypatch.setattr(native, '_asegurar_corpus', lambda *a: pytest.fail('symlink reached installation'))
    assert 'error' in json.loads(native.verificar_citas({'ruta': str(link)}))


@pytest.mark.parametrize('bad_count', [True, '1', -1, 2])
def test_invalid_counts_fail_closed(native, monkeypatch, bad_count):
    payload = envelope()
    payload['meta']['total_citas'] = bad_count
    monkeypatch.setattr(native, '_dike', lambda *a, **kw: subprocess.CompletedProcess([], 1, json.dumps(payload), ''))
    result = json.loads(native.verificar_citas({'texto': 'artículo 9999'}))
    assert 'error' in result and result['todo_verificado'] is False


def test_oversized_file_rejected_before_install(native, monkeypatch, tmp_path):
    p = tmp_path / 'oversized.md'
    p.write_bytes(b'x' * 400001)
    monkeypatch.setattr(native, '_asegurar_corpus', lambda *a: pytest.fail('oversized file reached installation'))
    assert 'error' in json.loads(native.verificar_citas({'ruta': str(p)}))


def test_subprocess_timeout_is_error(native, monkeypatch):
    def timeout(*a, **kw):
        raise subprocess.TimeoutExpired('synthetic-test', 300)
    monkeypatch.setattr(native, '_dike', timeout)
    result = json.loads(native.verificar_citas({'texto': 'artículo 9999'}))
    assert 'TIMEOUT' in result['error'] and result['todo_verificado'] is False


def test_environment_does_not_forward_credentials(native, monkeypatch, tmp_path):
    # Synthetic sentinels only; do not read real credentials.
    for key in ('OPENAI_API_KEY', 'LEXO_CUSTODY_SIGNING_KEY_PATH', 'LEXO_CONTENT_SIGNING_KEY_PATH'):
        monkeypatch.setenv(key, 'synthetic-sentinel')
    env = native._entorno(tmp_path)
    assert not any(key in env for key in ('OPENAI_API_KEY', 'LEXO_CUSTODY_SIGNING_KEY_PATH', 'LEXO_CONTENT_SIGNING_KEY_PATH'))
    assert env['HOME'] == str(tmp_path / 'home')
