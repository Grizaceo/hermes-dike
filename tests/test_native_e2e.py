"""Real engine, private plugin data, no productive home, no signing."""
import importlib.util
import json
from pathlib import Path
import subprocess
import sys

import pytest

ROOT = Path(__file__).parents[1]


@pytest.fixture(scope='module')
def real(tmp_path_factory):
    spec = importlib.util.spec_from_file_location('native_real', ROOT / '__init__.py')
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    data = tmp_path_factory.mktemp('native-data')
    m._carpeta_de_datos = lambda: data
    before = {k for k in sys.modules if k == 'lexo_cli' or k.startswith('lexo_cli.')}
    text = (ROOT / 'tests/fixtures/escrito_demo.md').read_text()
    first = json.loads(m.verificar_citas({'texto': text}))
    second = json.loads(m.verificar_citas({'texto': text}))
    after = {k for k in sys.modules if k == 'lexo_cli' or k.startswith('lexo_cli.')}
    assert before == after
    return m, data, first, second


def test_demo_real_cold_and_warm(real):
    for result in real[2:]:
        assert 'error' not in result, result
        assert result['meta']['pack_hash'] == 'af1422d66d1e6eee'
        assert result['meta']['total_citas'] == 6
        assert result['meta']['citas_verificadas'] == 4
        assert result['meta']['citas_fallidas'] == 2
        assert result['todo_verificado'] is False
        assert result['problemas']


def test_installed_tamper_fails_closed(real):
    m, data, _, _ = real
    files = list((data / 'generations').glob('*/users/**/*'))
    victim = next(p for p in files if p.is_file() and p.suffix == '.json')
    original = victim.read_bytes()
    try:
        victim.write_bytes(original + b' ')
        result = json.loads(m.verificar_citas({'texto': 'artículo 161 del Código del Trabajo'}))
        assert 'integrity mismatch' in result.get('error', '')
        assert result['todo_verificado'] is False
    finally:
        victim.write_bytes(original)


def test_vendored_engine_matches_manifest():
    result = subprocess.run([sys.executable, str(ROOT / 'scripts/vendor_engine.py'), '--check'], capture_output=True, text=True)
    assert result.returncode == 0, result.stdout


def test_real_sin_citas_preserves_abstention(real):
    result = json.loads(real[0].verificar_citas({'texto': 'La Ley 19.496 y el Código Civil.'}))
    assert 'error' not in result, result
    assert result['veredicto'] == 'SIN_CITAS'
    assert result['todo_verificado'] is False
    assert result['todas_citas_detectadas_verificadas'] is False
    assert 'Ley 19.496' in result['no_verificadas']


def test_real_verified_article_with_unverified_mention(real):
    result = json.loads(real[0].verificar_citas({'texto': 'Conforme al artículo 161 del Código del Trabajo y a la Ley 99.999.'}))
    assert 'error' not in result, result
    assert result['todas_citas_detectadas_verificadas'] is True
    assert result['todo_verificado'] is False
    assert 'Ley 99.999' in result['no_verificadas']
    assert 'detectadas' in result['mensaje']
    assert result['certificacion_vigencia_actual'] is False
    assert result['evidencia_temporal'][0]['antiguedad_dias'] >= 0


def test_real_valid_file_input(real, tmp_path):
    path = tmp_path / 'escrito.md'
    path.write_text('artículo 161 del Código del Trabajo', encoding='utf-8')
    result = json.loads(real[0].verificar_citas({'ruta': str(path)}))
    assert 'error' not in result, result
    assert result['meta']['citas_verificadas'] == 1
    assert result['todas_citas_detectadas_verificadas'] is True
    assert str(path) not in json.dumps(result)


def test_real_sin_corpus_preserves_reason(real, monkeypatch, tmp_path):
    m = real[0]
    empty_runtime = tmp_path / 'empty-runtime'
    empty_runtime.mkdir()
    (empty_runtime / 'home').mkdir()
    (empty_runtime / 'config.yaml').write_text('starter:\n  user: hermes\n')
    monkeypatch.setattr(m, '_asegurar_corpus', lambda data: {'generation': str(empty_runtime)})
    result = json.loads(m.verificar_citas({'texto': 'artículo 161 del Código del Trabajo'}))
    assert 'error' not in result, result
    assert result['veredicto'] == 'SIN_CORPUS'
    assert result['meta']['pack_hash'] == 'sin-corpus'
    assert result['todo_verificado'] is False
    assert str(empty_runtime) not in json.dumps(result)
