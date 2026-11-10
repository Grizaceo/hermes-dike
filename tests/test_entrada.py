"""Validación de texto, rutas y límites antes de invocar el motor."""
import json
import os
from pathlib import Path
import subprocess

import pytest
from soporte_adaptador import native

ROOT = Path(__file__).parents[1]


def _error(native, args):
    return json.loads(native.verificar_citas(args))


@pytest.mark.parametrize('args,code', [
    ({'otro': 'x'}, 'INPUT_FIELDS'),
    ({}, 'INPUT_FIELDS'),
    ({'texto': '   '}, 'INPUT_EMPTY'),
    ({'ruta': ''}, 'INPUT_EMPTY'),
    ({'ruta': 'brief.pdf'}, 'INPUT_EXTENSION'),
    ({'ruta': 'no-existe.md'}, 'INPUT_NOT_FOUND'),
])
def test_input_codes(native, args, code):
    result = _error(native, args)
    assert result['error_code'] == 'INPUT_ERROR' and result['motivo'] == code
    assert result['todo_verificado'] is False


def test_dir_is_not_found(native, tmp_path):
    (tmp_path / 'd.md').mkdir()
    assert _error(native, {'ruta': str(tmp_path / 'd.md')})['motivo'] == 'INPUT_NOT_FOUND'


def test_bad_encoding(native, tmp_path):
    p = tmp_path / 'latin.md'
    p.write_bytes('año \xf1'.encode('latin-1'))
    assert _error(native, {'ruta': str(p)})['motivo'] == 'INPUT_ENCODING'


def test_integrity_message_survives(native):
    """El marcador estable sigue; ahora con código propio y cómo recuperarse."""
    exc = ValueError('installed corpus integrity mismatch')
    out = native._error_adaptador(exc)
    assert out['error_code'] == 'CORPUS_INTEGRITY_ERROR'
    assert out['error'].startswith('CORPUS_INTEGRITY_ERROR: installed corpus integrity mismatch')
    assert 'plugin-data/dike/generations' in out['error'] and out['todo_verificado'] is False


def test_fifo_input_not_found_no_block(native, tmp_path):
    import threading
    os.mkfifo(tmp_path / 'x.md')
    out_box = []
    t = threading.Thread(target=lambda: out_box.append(_error(native, {'ruta': str(tmp_path / 'x.md')})))
    t.start(); t.join(timeout=10)
    assert out_box and out_box[0]['motivo'] == 'INPUT_NOT_FOUND'


def test_relative_ruta_uses_session_cwd(native, tmp_path):
    (tmp_path / 'rel.md').write_text('artículo 9999 del Código del Trabajo')
    called = {}
    native._dike = lambda *a, **kw: subprocess.CompletedProcess([], 2, '', 'stop')
    native._CTX = type('C', (), {'session_cwd': staticmethod(lambda: str(tmp_path))})()
    result = _error(native, {'ruta': 'rel.md'})
    assert result.get('motivo') != 'INPUT_NOT_FOUND'
    native._CTX = None


def test_relative_ruta_refused_without_session_cwd(native, tmp_path, monkeypatch):
    (tmp_path / 'rel.md').write_text('artículo 9999')
    monkeypatch.chdir(tmp_path)
    native._CTX = type('C', (), {'session_cwd': staticmethod(lambda: '')})()
    try:
        result = _error(native, {'ruta': 'rel.md'})
    finally:
        native._CTX = None
    assert result['error_code'] == 'INPUT_ERROR' and result['motivo'] == 'INPUT_RELATIVE'


def test_relative_ruta_fallback_getcwd(native, tmp_path, monkeypatch):
    (tmp_path / 'rel.md').write_text('artículo 9999')
    monkeypatch.chdir(tmp_path)
    native._CTX = None
    result = _error(native, {'ruta': 'rel.md'})
    assert result.get('motivo') != 'INPUT_NOT_FOUND'
