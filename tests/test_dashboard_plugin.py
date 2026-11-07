"""Superficie del panel: dashboard/manifest.json, plugin_api.py y desktop/plugin.js."""
import importlib.util
import json
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).parents[1]
DASH = ROOT / 'dashboard'
DESKTOP = ROOT / 'desktop'
NODE = shutil.which('node')


@pytest.fixture(scope='module')
def api():
    pytest.importorskip('fastapi')
    spec = importlib.util.spec_from_file_location('dike_plugin_api_test', DASH / 'plugin_api.py')
    m = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = m
    try:
        spec.loader.exec_module(m)
    except Exception:
        sys.modules.pop(spec.name, None)
        raise
    return m


def test_manifest_declara_tab_entry_y_api():
    m = json.loads((DASH / 'manifest.json').read_text())
    assert m['name'] == 'dike'
    assert m['tab']['path'] == '/dike'
    assert m['icon'] in {
        'Activity', 'BarChart3', 'Clock', 'Code', 'Database', 'Eye', 'FileText',
        'Globe', 'Heart', 'KeyRound', 'MessageSquare', 'Package', 'Puzzle',
        'Settings', 'Shield', 'Sparkles', 'Star', 'Terminal', 'Wrench', 'Zap'}
    assert (DASH / m['api']).is_file()
    assert (DASH / m['entry']).is_file()


def test_manifest_misma_version_que_plugin_yaml():
    yaml = pytest.importorskip('yaml')
    manifiesto = json.loads((DASH / 'manifest.json').read_text())
    plugin = yaml.safe_load((ROOT / 'plugin.yaml').read_text())
    assert manifiesto['version'] == plugin['version']


def test_api_expone_estado_y_verificar(api):
    rutas = {r.path for r in api.router.routes}
    assert '/estado' in rutas
    assert '/verificar' in rutas


def test_estado_sin_efectos_secundarios(api, monkeypatch, tmp_path):
    """GET /estado no instala el corpus (la primera verificación cuesta ~1 min)."""
    monkeypatch.setenv('HERMES_HOME', str(tmp_path))
    out = api.estado()
    assert out['corpus_instalado'] is False
    assert not (tmp_path / 'plugin-data' / 'dike' / 'generations').exists()


def test_estado_campos(api, monkeypatch, tmp_path):
    monkeypatch.setenv('HERMES_HOME', str(tmp_path))
    out = api.estado()
    assert out['pack_hash'] and len(out['pack_hash']) == 16
    assert out['leyes'] == 25 and out['articulos'] == 8544


def test_verificar_rechaza_sin_texto(api):
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as exc:
        api.verificar({})
    assert exc.value.status_code == 400


def test_verificar_rechaza_texto_vacio(api):
    from fastapi import HTTPException
    with pytest.raises(HTTPException):
        api.verificar({'texto': '   '})


def test_verificar_pasa_texto_al_adaptador(api, monkeypatch):
    capturado = {}

    class Stub:
        @staticmethod
        def verificar_citas(args):
            capturado.update(args)
            return '{"veredicto": "SIN_CITAS", "mensaje": "sin citas"}'

    monkeypatch.setattr(api, '_adaptador', lambda: Stub)
    assert api.verificar({'texto': 'abc'})['veredicto'] == 'SIN_CITAS'
    assert capturado == {'texto': 'abc'}


def test_desktop_registra_pagina_nav_y_paleta():
    src = (DESKTOP / 'plugin.js').read_text()
    assert "id: ID" in src
    assert "ROUTES_AREA" in src and "path: '/dike'" in src
    assert "SIDEBAR_NAV_AREA" in src
    assert "PALETTE_AREA" in src


def test_web_tab_registra_dike():
    src = (DASH / 'dist/index.js').read_text()
    assert '__HERMES_PLUGINS__.register("dike"' in src
    assert '/api/plugins/dike/verificar' in src
    assert '/api/plugins/dike/estado' in src


@pytest.mark.skipif(NODE is None, reason='node no está en PATH')
def test_sintaxis_js(tmp_path):
    web = tmp_path / 'index.cjs'
    web.write_text((DASH / 'dist/index.js').read_text())
    desk = tmp_path / 'plugin.mjs'
    desk.write_text((DESKTOP / 'plugin.js').read_text())
    for f in (web, desk):
        subprocess.run([NODE, '--check', str(f)], check=True, capture_output=True)
