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


def test_api_expone_panel_nif_y_grafo(api):
    rutas = {r.path for r in api.router.routes}
    for ruta in (
        '/nif/casos', '/nif/init', '/nif/seed', '/nif/snapshot',
        '/nif/edit', '/nif/gap', '/nif/validar', '/nif/confianza',
        '/grafo/personal', '/grafo/corpus', '/grafo/corpus/norma/{code}',
        '/grafo/red', '/grafo/unidad',
    ):
        assert ruta in rutas, ruta


def test_panel_valida_case_id(api):
    from fastapi import HTTPException
    # body-based: case_id ausente, vacío, no-string o con path traversal
    for cuerpo in ({}, {'case_id': ''}, {'case_id': 7}, {'case_id': '../x'},
                   {'case_id': 'a/b'}, {'case_id': 'x;rm'}):
        with pytest.raises(HTTPException) as exc:
            api.nif_seed(cuerpo)
        assert exc.value.status_code == 400
    # query param (GET snapshot): la validación vive en el endpoint
    for malo in ('../x', 'a/b', '', 'x;y'):
        with pytest.raises(HTTPException) as exc:
            api.nif_snapshot(malo)
        assert exc.value.status_code == 400


def test_panel_edit_rechaza_campo_no_editable(api):
    from fastapi import HTTPException
    for campo in ('system.path', 'nif', 'facts', 'raw', 'constructor'):
        with pytest.raises(HTTPException) as exc:
            api.nif_edit({'case_id': 'c1', 'field_path': campo, 'value': 'x'})
        assert exc.value.status_code == 400


def _stub_motor(monkeypatch, api, stdout='{}', returncode=0, stderr='',
                datos=None, llamadas=None):
    """Sustituye adaptador + subprocess del panel por un motor falso."""
    capturado = {}

    class FakeProc:
        pass

    proc = FakeProc()
    proc.returncode = returncode
    proc.stdout = stdout
    proc.stderr = stderr

    def fake_run(cmd, **kw):
        capturado['cmd'] = cmd
        capturado['kw'] = kw
        if llamadas is not None:
            llamadas.append(cmd)
        return proc

    mod = type('M', (), {
        'PACK_HASH': 'testpackhash0000',
        '_carpeta_de_datos': staticmethod(lambda: datos or Path('/tmp/x')),
        '_entorno': staticmethod(lambda runtime: {}),
        '_asegurar_corpus': staticmethod(lambda datos: {'generation': '/tmp/gen'}),
    })()
    monkeypatch.setattr(api, '_adaptador', lambda: mod)
    monkeypatch.setattr(api.subprocess, 'run', fake_run)
    return capturado


def test_panel_edit_acepta_campo_nif(api, monkeypatch):
    capturado = _stub_motor(monkeypatch, api, stdout='{"success": true}')
    out = api.nif_edit({'case_id': 'c1', 'field_path': 'facts.known',
                        'value': 'hecho', 'reason': 'prueba'})
    assert out == {'success': True}
    cmd = capturado['cmd']
    assert 'facts.known' in cmd
    assert '"hecho"' in cmd or 'hecho' in cmd
    assert 'prueba' in cmd


def test_panel_edit_sin_value(api):
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as exc:
        api.nif_edit({'case_id': 'c1', 'field_path': 'confidence'})
    assert exc.value.status_code == 400


def test_panel_gap_valida_indice(api):
    from fastapi import HTTPException
    for gap_index in ('x', None, '', '1.5'):
        with pytest.raises(HTTPException):
            api.nif_gap({'case_id': 'c1', 'gap_index': gap_index,
                         'filled_by': 'a', 'filled_with': 'b'})
    with pytest.raises(HTTPException):
        api.nif_gap({'case_id': 'c1', 'gap_index': 0,
                     'filled_by': '', 'filled_with': 'b'})


def test_panel_validar_exige_booleano(api):
    from fastapi import HTTPException
    for valor in ('1', 1, None, 'true'):
        with pytest.raises(HTTPException):
            api.nif_validar({'case_id': 'c1', 'validated': valor})


def test_panel_confianza_exige_numero(api):
    from fastapi import HTTPException
    for valor in ('alta', None, {}, 'NaNx'):
        with pytest.raises(HTTPException):
            api.nif_confianza({'case_id': 'c1', 'confidence': valor})


def test_panel_init_exige_pregunta(api):
    from fastapi import HTTPException
    with pytest.raises(HTTPException):
        api.nif_init({'case_id': 'c1'})
    with pytest.raises(HTTPException):
        api.nif_init({'case_id': 'c1', 'pregunta': '  '})


def test_panel_norma_codigo_numerico(api, monkeypatch):
    from fastapi import HTTPException
    for code in ('abc', '10;DROP', '-1', '1.5', '../x'):
        with pytest.raises(HTTPException):
            api.grafo_corpus_norma(code)
    # código numérico pasa la validación y llega al panel como 'corpus-norma'
    capturado = _stub_motor(monkeypatch, api, stdout='{"packs": []}')
    out = api.grafo_corpus_norma('1058072')
    assert isinstance(out, dict)
    assert 'corpus-norma' in capturado['cmd']
    assert '1058072' in capturado['cmd']


_RED_FALSA = json.dumps({
    'nodes': [
        {'id': 'eli:ley/1', 'tipo': 'instrumento', 'label': 'Ley 1',
         'instrumento': None, 'url': 'https://x/1', 'sha256': 'a' * 64},
        {'id': 'eli:ley/1/art_1', 'tipo': 'articulo', 'label': 'Ley 1, art. 1',
         'instrumento': 'Ley 1', 'url': 'https://x/1a', 'sha256': 'b' * 64},
        {'id': 'eli:ley/1/art_2', 'tipo': 'articulo', 'label': 'Ley 1, art. 2',
         'instrumento': 'Ley 1', 'url': None, 'sha256': None},
    ],
    'links': [
        {'source': 'eli:ley/1', 'target': 'eli:ley/1/art_1',
         'tipo': 'contiene', 'estado': 'verificada_estructura'},
        {'source': 'eli:ley/1', 'target': 'eli:ley/1/art_2',
         'tipo': 'contiene', 'estado': 'verificada_estructura'},
    ],
    'conteos': {'nodes': 3, 'links': 2},
    'truncado': False,
})


def test_grafo_red_forma_y_conteos(api, monkeypatch, tmp_path):
    _stub_motor(monkeypatch, api, stdout=_RED_FALSA, datos=tmp_path)
    out = api.grafo_red()
    assert out['fuente'] == 'corpus'
    assert out['pack_hash'] == 'testpackhash0000'
    assert out['local_only'] is False
    assert out['truncado'] is False
    assert out['conteos'] == {'nodes': 3, 'links': 2}
    assert out['conteos']['nodes'] == len(out['nodes'])
    assert out['conteos']['links'] == len(out['links'])
    for n in out['nodes']:
        assert n['tipo'] in ('instrumento', 'articulo', 'sentencia', 'resolucion')
        assert set(n) == {'id', 'tipo', 'label', 'instrumento', 'url', 'sha256'}
    for link in out['links']:
        assert link['tipo'] in ('contiene', 'cita', 'aplica', 'revisa')
        assert link['estado'] in ('verificada_estructura', 'candidata', 'aprobada')


def test_grafo_red_aristas_apuntan_a_nodos(api, monkeypatch, tmp_path):
    _stub_motor(monkeypatch, api, stdout=_RED_FALSA, datos=tmp_path)
    out = api.grafo_red()
    ids = {n['id'] for n in out['nodes']}
    for link in out['links']:
        assert link['source'] in ids and link['target'] in ids


def test_grafo_red_fuente_desconocida_400(api):
    from fastapi import HTTPException
    for fuente in ('personal', 'todas', '', '../x'):
        with pytest.raises(HTTPException) as exc:
            api.grafo_red(fuente)
        assert exc.value.status_code == 400


def test_grafo_red_cachea_por_pack_hash(api, monkeypatch, tmp_path):
    llamadas = []
    _stub_motor(monkeypatch, api, stdout=_RED_FALSA, datos=tmp_path,
                llamadas=llamadas)
    primero = api.grafo_red()
    segundo = api.grafo_red()
    assert primero == segundo
    assert len(llamadas) == 1
    assert (tmp_path / 'cache' / 'grafo_red_v2_testpackhash0000.json').is_file()


def test_grafo_unidad_valida_id(api, monkeypatch):
    from fastapi import HTTPException
    for malo in ('', 'sin-unidad', 'a#', '#u01', 'x#u', 'x#uab', 'x#v01'):
        with pytest.raises(HTTPException) as exc:
            api.grafo_unidad(malo)
        assert exc.value.status_code == 400
    capturado = _stub_motor(
        monkeypatch, api,
        stdout='{"id": "eli/art_1#u01", "texto": "u", "char_start": 0, "char_end": 1}')
    out = api.grafo_unidad('eli/art_1#u01')
    assert out['texto'] == 'u'
    assert 'unidad' in capturado['cmd']


def test_limpiar_redacta_rutas_locales(api):
    assert '<ruta-local>' in api._limpio('falló en /home/gris96/secret/file.txt')
    assert '/home/gris96' not in api._limpio('falló en /home/gris96/secret/file.txt')
    assert len(api._limpio('x' * 5000)) <= 400


def test_panel_error_motor_a_http(api, monkeypatch):
    from fastapi import HTTPException
    _stub_motor(monkeypatch, api,
                stdout='{"error": "caso no existe en /home/u/cases/x"}')
    with pytest.raises(HTTPException) as exc:
        api.nif_casos()
    assert exc.value.status_code == 400
    assert '/home/u' not in exc.value.detail


def test_panel_exit_no_cero_a_502(api, monkeypatch):
    from fastapi import HTTPException
    _stub_motor(monkeypatch, api, stdout='', returncode=2,
                stderr='Traceback en /home/u/motor/x.py')
    with pytest.raises(HTTPException) as exc:
        api.nif_casos()
    assert exc.value.status_code == 502
    assert '/home/u' not in exc.value.detail


def test_panel_timeout_a_504(api, monkeypatch):
    from fastapi import HTTPException
    _stub_motor(monkeypatch, api)

    def timeout(*a, **k):
        raise api.subprocess.TimeoutExpired(cmd='x', timeout=1)

    monkeypatch.setattr(api.subprocess, 'run', timeout)
    with pytest.raises(HTTPException) as exc:
        api.nif_casos()
    assert exc.value.status_code == 504


def test_panel_corpus_asegura_generacion(api, monkeypatch):
    """Las rutas /grafo/corpus* verifican la generación sellada antes de leer."""
    capturado = _stub_motor(monkeypatch, api, stdout='{"packs": []}')
    api.grafo_corpus()
    assert capturado['kw'].get('cwd') == '/tmp/gen'
    env = capturado['kw'].get('env')
    assert env is not None


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
    """Contrato del plugin en la FUENTE (desktop/plugin.js se minifica:
    los identificadores cambian de nombre al compilar el bundle)."""
    src = (DESKTOP / 'src' / 'plugin.src.js').read_text()
    assert "id: ID" in src
    assert "ROUTES_AREA" in src and "path: '/dike'" in src
    assert "SIDEBAR_NAV_AREA" in src
    assert "PALETTE_AREA" in src
    bundle = (DESKTOP / 'plugin.js').read_text()
    assert 'path:"/dike"' in bundle


def test_desktop_usa_ctx_rest_no_host_rest():
    """El SDK del Desktop expone REST en ctx (PluginContext), no en host:
    host.rest no existe y rompe el render de toda la página."""
    src = (DESKTOP / 'src' / 'plugin.src.js').read_text()
    assert 'host.rest' not in src
    assert 'ctx.rest' in src
    assert 'host.rest' not in (DESKTOP / 'plugin.js').read_text()


def test_web_tab_registra_dike():
    src = (DASH / 'dist/index.js').read_text()
    assert '__HERMES_PLUGINS__.register("dike"' in src
    assert '/api/plugins/dike/verificar' in src
    assert '/api/plugins/dike/estado' in src


def test_desktop_bundle_imports_permitidos():
    """El bundle desktop/plugin.js solo importa @hermes/plugin-sdk y react*:
    el cargador runtime de la app rechaza cualquier otro especificador, y el
    chequeo además veta import() dinámico, eval y new Function en código."""
    script = ROOT / 'scripts' / 'check_desktop_bundle.py'
    proc = subprocess.run(
        [sys.executable, str(script), str(DESKTOP / 'plugin.js')],
        capture_output=True, text=True, timeout=60)
    assert proc.returncode == 0, proc.stderr


@pytest.mark.skipif(NODE is None, reason='node no está en PATH')
def test_sintaxis_js(tmp_path):
    web = tmp_path / 'index.cjs'
    web.write_text((DASH / 'dist/index.js').read_text())
    desk = tmp_path / 'plugin.mjs'
    desk.write_text((DESKTOP / 'plugin.js').read_text())
    for f in (web, desk):
        subprocess.run([NODE, '--check', str(f)], check=True, capture_output=True)
