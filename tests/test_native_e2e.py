"""Real engine, private plugin data, no productive home, no signing."""
import importlib.util
import json
import os
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


def test_tamper_que_conserva_tamano_y_fecha_es_error_de_integridad(real):
    """En un proceso que ya verificó el corpus, un byte cambiado con tamaño y fecha
    intactos pasaba el chequeo por stat y el motor respondía SIN_CORPUS: parecía
    «no hay corpus». Ahora se recalcula todo y se informa como corrupción."""
    m, data, _, _ = real
    # Una llamada limpia deja el registro y la caché del proceso al día.
    limpio = json.loads(m.verificar_citas({'texto': 'artículo 161 del Código del Trabajo'}))
    assert limpio.get('veredicto') == 'TODAS_VERIFICADAS', limpio
    victim = next((data / 'generations').glob(
        '*/users/*/starter/*/snapshots/*/articulos/articulo_207436_art_0161.json'))
    original = victim.read_bytes()
    info = victim.stat()
    inicio = original.index(b'"', original.index(b'"text"') + len(b'"text"') + 1) + 1
    i = next(j for j in range(inicio, len(original)) if chr(original[j]).isascii() and chr(original[j]).isalpha())
    cambiado = original[:i] + bytes([original[i] ^ 0x20]) + original[i + 1:]
    try:
        victim.write_bytes(cambiado)
        os.utime(victim, ns=(info.st_atime_ns, info.st_mtime_ns))
        assert victim.stat().st_size == info.st_size
        result = json.loads(m.verificar_citas({'texto': 'artículo 161 del Código del Trabajo'}))
        assert result.get('error_code') == 'CORPUS_INTEGRITY_ERROR', result
        assert result['todo_verificado'] is False
    finally:
        victim.write_bytes(original)
        os.utime(victim, ns=(info.st_atime_ns, info.st_mtime_ns))
    again = json.loads(m.verificar_citas({'texto': 'artículo 161 del Código del Trabajo'}))
    assert again.get('veredicto') == 'TODAS_VERIFICADAS', again


def test_cuerpo_de_la_linea_anterior_no_certifica_otra_norma(real):
    """El motor pegaba «Código del Trabajo» a la cita siguiente si la línea no
    terminaba en punto: «artículo 161 del Código Civil» salía VERIFICADA como
    cl.norma.ct:art:0161. Ninguna cita que nombre el Código Civil puede
    certificarse con un gid de otra norma."""
    texto = 'artículo 161 del Código del Trabajo\nartículo 161 del Código Civil'
    result = json.loads(real[0].verificar_citas({'texto': texto}))
    civil = [d for d in result['detalles'] if 'Código Civil' in d['cita_raw']]
    assert civil, result
    for detail in civil:
        if detail['estado'] == 'VERIFICADA':
            assert detail['gid'].startswith('cl.norma.cc:'), detail
    assert result['todo_verificado'] is False


def test_cuerpos_separados_por_punto_siguen_verificando(real):
    texto = 'artículo 161 del Código del Trabajo.\nartículo 161 del Código Civil.'
    result = json.loads(real[0].verificar_citas({'texto': texto}))
    gids = sorted(d['gid'] for d in result['detalles'] if d['estado'] == 'VERIFICADA')
    assert gids == ['cl.norma.cc:art:0161', 'cl.norma.ct:art:0161'], result


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
