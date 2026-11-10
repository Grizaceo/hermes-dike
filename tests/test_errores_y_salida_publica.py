"""Diagnósticos controlados, redacción de rutas y salida pública."""
import importlib.util
import json
import subprocess
from pathlib import Path

import pytest
from soporte_adaptador import native, _green_payload, call


def test_data_dir_resolved_before_install(monkeypatch, tmp_path):
    """datos.resolve() is called before _asegurar_corpus to handle symlinks."""
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


def test_no_local_path_in_documento(native, monkeypatch):
    """meta.documento must be a neutral label, not an absolute path."""
    payload = _green_payload()
    payload['meta']['documento'] = '/home/abogado/escrito.md'
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


def test_timeout_classified(native, monkeypatch):
    """TimeoutExpired is classified as TIMEOUT, not generic error."""
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
    """Invalid JSON from engine is classified as ENGINE_JSON_ERROR."""
    monkeypatch.setattr(
        native, '_dike',
        lambda *a, **kw: subprocess.CompletedProcess([], 0, 'not json at all', ''),
    )
    result = json.loads(native.verificar_citas({'texto': 'art. 161'}))
    assert 'error' in result
    assert 'ENGINE_JSON_ERROR' in result['error']
    assert result['todo_verificado'] is False


def test_validation_error_sanitized(native, monkeypatch):
    """Validation errors must not leak local paths."""
    monkeypatch.setattr(
        native, '_dike',
        lambda *a, **kw: subprocess.CompletedProcess([], 0, json.dumps({}), ''),
    )
    result = json.loads(native.verificar_citas({'texto': 'art. 161'}))
    assert 'error' in result
    assert '/home/' not in result['error']


def test_arbitrary_exception_text_not_forwarded(native, monkeypatch):
    def bad(*a): raise OSError('/opt/private/customer.txt unlabelled-SENTINEL')
    monkeypatch.setattr(native, '_asegurar_corpus', bad)
    r = json.loads(native.verificar_citas({'texto': 'artículo 161'}))
    assert 'error' in r
    assert '/opt/' not in json.dumps(r) and 'unlabelled-SENTINEL' not in json.dumps(r)


def test_nonzero_exit_valid_json_is_engine_error(native, monkeypatch):
    r = call(native, monkeypatch, _green_payload(), code=2)
    assert 'ENGINE_EXIT_ERROR' in r['error']


def test_install_dependency_error_is_safe_and_specific(native, monkeypatch):
    def bad(*a):
        raise subprocess.CalledProcessError(1, ['synthetic-command'], stderr='ModuleNotFoundError: no dependency /opt/private unlabelled-SENTINEL')
    monkeypatch.setattr(native, '_asegurar_corpus', bad)
    r = json.loads(native.verificar_citas({'texto': 'artículo 161'}))
    assert 'dependencia' in r['error']
    assert 'unlabelled-SENTINEL' not in r['error']


@pytest.mark.parametrize('stderr', [
    '/home/abogado/crash traceback',
    'Error: OPENAI_API_KEY=sk-secret-12345 traceback at /home/user/dike',
    'unlabelled-SENTINEL /opt/private/customer.txt',
])
def test_stderr_is_classified_not_replayed(native, monkeypatch, stderr):
    monkeypatch.setattr(native, '_dike', lambda *a, **kw:
                        subprocess.CompletedProcess([], 2, '', stderr))
    r = json.loads(native.verificar_citas({'texto': 'artículo 161'}))
    assert 'error' in r and 'ENGINE_EXIT_ERROR' in r['error']
    assert r['todo_verificado'] is False and 'stderr' not in r['error'].lower()
    assert all(s not in json.dumps(r)
               for s in ('/home/abogado', '/home/user', '/opt/private', 'sk-secret-12345', 'unlabelled-SENTINEL'))


def test_windows_redaction_not_in_url(native):
    const = {'veredicto': 'TODAS_VERIFICADAS',
             'detalles': [{'estado': 'VERIFICADA', 'cita_raw': 'ver https://x/y',
                           'gid': 'g', 'fuente_url': 'https://u', 'fecha_recuperacion': '2000-01-01T00:00:00+00:00',
                           'resolucion': 'RESOLVED', 'vigencia': 'IN_FORCE',
                           'texto_hash': 'a' * 64, 'estado_texto_historico': 'CURRENT_VERSION_APPLIES'},
                          {'estado': 'VERIFICADA', 'cita_raw': r'C:\Users\x y /home/x/y',
                           'gid': 'g2', 'fuente_url': 'https://u', 'fecha_recuperacion': '2000-01-01T00:00:00+00:00',
                           'resolucion': 'RESOLVED', 'vigencia': 'IN_FORCE',
                           'texto_hash': 'b' * 64, 'estado_texto_historico': 'CURRENT_VERSION_APPLIES'}],
             'citation_disclosure': {'no_verificadas': [], 'advertencias': []},
             'meta': {'as_of': '2000-01-01', 'fecha_constancia': '2000-01-01T00:00:00+00:00',
                      'pack_hash': native.PACK_HASH, 'total_citas': 2,
                      'citas_verificadas': 2, 'citas_fallidas': 0},
             'problemas': [], 'alcance': 'x', 'mensaje': 'm'}
    out = native._salida_publica(const)
    raws = [d['cita_raw'] for d in out['detalles']]
    assert 'ver https://x/y' in raws[0]
    assert raws[1] == '<ruta-local> y <ruta-local>'
