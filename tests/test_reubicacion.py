import hashlib
import importlib.util
import json
import shutil
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent


@pytest.fixture(scope='module')
def real(tmp_path_factory):
    """Instala el corpus real en tmp A (module-scoped, una sola instalación)."""
    spec = importlib.util.spec_from_file_location('dike_reubicacion_test', ROOT / '__init__.py')
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    data_a = tmp_path_factory.mktemp('reub-a')
    m._carpeta_de_datos = lambda: data_a
    demo = (ROOT / 'tests/fixtures/escrito_demo.md').read_text()
    primero = json.loads(m.verificar_citas({'texto': demo}))
    assert primero.get('meta', {}).get('citas_verificadas') == 4, primero
    return m, data_a


def _generacion(data: Path) -> Path:
    return next((data / 'generations').iterdir())


def _state_files(gen: Path):
    return list((gen / 'users').glob('*/starter/*/STATE.json'))


def test_mover_plugin_data_repara_y_verifica(real, tmp_path):
    m, data_a = real
    data_b = tmp_path / 'plugin-data-movido'
    shutil.move(str(data_a), str(data_b))
    m._carpeta_de_datos = lambda: data_b

    demo = (ROOT / 'tests/fixtures/escrito_demo.md').read_text()
    out = json.loads(m.verificar_citas({'texto': demo}))
    assert out.get('meta', {}).get('citas_verificadas') == 4, out

    gen = _generacion(data_b)
    record = json.loads((gen / 'installed.json').read_text())
    assert len(record.get('reubicaciones', [])) == 1
    # el snapshot de cada STATE.json quedó bajo la NUEVA generación
    for sf in _state_files(gen):
        snap = json.loads(sf.read_text())['snapshot']
        assert snap.startswith(str(gen) + '/'), snap


def test_tamper_luego_mover_da_error_de_integridad(real, tmp_path):
    m, _ = real
    # Estado actual: _carpeta_de_datos apunta a la generación ya reubicada.
    data_actual = Path(m._carpeta_de_datos())
    gen = _generacion(data_actual)
    # Un byte cambiado en un artículo sellado (no en STATE.json/installed.json).
    victim = next(p for p in (gen / 'users').rglob('articulo_*.json') if p.is_file())
    original = victim.read_bytes()
    victim.write_bytes(original + b' ')
    data_c = tmp_path / 'plugin-data-tamper'
    shutil.move(str(data_actual), str(data_c))
    m._carpeta_de_datos = lambda: data_c
    out = json.loads(m.verificar_citas({'texto': 'artículo 161 del Código del Trabajo'}))
    assert out.get('error_code') == 'CORPUS_INTEGRITY_ERROR', out
    assert out.get('todo_verificado') is False
