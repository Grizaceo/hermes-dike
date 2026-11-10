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
        '/grafo/red', '/grafo/unidad', '/grafo/nodo', '/grafo/unidades',
        '/grafo/buscar',
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


class _PanelErrorFalso(Exception):
    """Doble del ``PanelError`` del adaptador: el dashboard solo lee kind/detalle."""
    def __init__(self, kind, detalle=''):
        super().__init__(kind)
        self.kind = kind
        self.detalle = detalle


def _stub_motor(monkeypatch, api, stdout='{}', returncode=0, stderr='',
                datos=None, llamadas=None, asegurar=None):
    """Sustituye adaptador + subprocess del panel por un motor falso."""
    limpiar = api._adaptador()._limpio_panel
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

    # Misma forma que __init__._panel_json: parsea y clasifica en PanelError.
    def fake_panel_json(args, *, runtime, timeout=90, entrada=None, instalado=None):
        try:
            proc = subprocess.run(
                [sys.executable, str(ROOT / 'scripts' / 'panel.py'), *args],
                env={}, cwd=str(runtime), input=entrada, capture_output=True,
                text=True, timeout=timeout)
        except subprocess.TimeoutExpired:
            raise _PanelErrorFalso('timeout') from None
        salida = proc.stdout.strip()
        try:
            data = json.loads(salida) if salida else {}
        except json.JSONDecodeError:
            data = None
        if proc.returncode != 0 or not isinstance(data, dict):
            raise _PanelErrorFalso('engine', api._limpio(proc.stderr or salida))
        if data.get('error'):
            raise _PanelErrorFalso('data', api._limpio(data['error']))
        return data

    class _AislamientoFalso:
        class SandboxNoDisponible(Exception):
            pass

        @staticmethod
        def estado():
            return {'modo': 'bwrap'}

    mod = type('M', (), {
        'PACK_HASH': 'testpackhash0000',
        'PanelError': _PanelErrorFalso,
        '_limpio_panel': staticmethod(limpiar),
        '_carpeta_de_datos': staticmethod(lambda: datos or Path('/tmp/x')),
        '_entorno': staticmethod(lambda runtime: {}),
        '_asegurar_corpus': staticmethod(
            asegurar or (lambda datos: {'generation': '/tmp/gen'})),
        '_panel_json': staticmethod(fake_panel_json),
        '_aislamiento': staticmethod(lambda: _AislamientoFalso),
        # verificar_citas llama internamente _asegurar_corpus en producción.
        'verificar_citas': staticmethod(
            (lambda body: asegurar(None) and '{"ok": true}') if asegurar
            else (lambda body: '{"ok": true}')),
    })()
    monkeypatch.setattr(api, '_adaptador', lambda: mod)
    monkeypatch.setattr(subprocess, 'run', fake_run)
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
    assert (tmp_path / 'cache' / 'grafo_red_v3_testpackhash0000.json').is_file()


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


def test_grafo_nodo_y_unidades_validan_id(api, monkeypatch):
    from fastapi import HTTPException
    for malo in ('', 'abc', 'x#u01', 'con#nodo', '\x00nulo'):
        with pytest.raises(HTTPException) as exc:
            api.grafo_nodo(malo)
        assert exc.value.status_code == 400
        with pytest.raises(HTTPException) as exc:
            api.grafo_unidades(malo)
        assert exc.value.status_code == 400
    capturado = _stub_motor(
        monkeypatch, api,
        stdout='{"id": "eli/art_1", "tipo": "articulo", "n_unidades": 3}')
    out = api.grafo_nodo('eli/art_1')
    assert out['n_unidades'] == 3 and 'nodo' in capturado['cmd']
    capturado = _stub_motor(
        monkeypatch, api,
        stdout='{"nodes": [], "links": [], "conteos": {}}')
    out = api.grafo_unidades('eli/art_1')
    assert 'unidades' in capturado['cmd']


def test_corpus_memo_solo_lectura(api, monkeypatch, tmp_path):
    """Dos lecturas del grafo dentro del TTL = 1 _asegurar_corpus;
    dos /verificar = 2 (la integridad nunca usa la memo)."""
    gen = tmp_path / 'gen'
    gen.mkdir()
    contador = {'n': 0}

    def fake_asegurar(datos):
        contador['n'] += 1
        return {'generation': str(gen)}

    _stub_motor(monkeypatch, api,
                stdout='{"nodes": [], "links": [], "conteos": {}}',
                datos=tmp_path, asegurar=fake_asegurar)
    api._corpus_memo.clear()
    api.grafo_unidades('a:1:art_0001')
    api.grafo_unidades('a:1:art_0002')
    api.grafo_nodo('n:1001')
    api.grafo_unidad('a:1:art_0001#u01')
    assert contador['n'] == 1
    api.verificar({'texto': 'cita art. 161'})
    api.verificar({'texto': 'otra cita'})
    assert contador['n'] == 3  # 1 del memo + 2 verificaciones sin memo


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
        raise subprocess.TimeoutExpired(cmd='x', timeout=1)

    monkeypatch.setattr(subprocess, 'run', timeout)
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


def test_estado_no_da_por_instalada_una_carpeta_vacia(api, monkeypatch, tmp_path):
    """Una carpeta con el hash esperado pero sin installed.json no es un corpus
    instalado: /estado decía corpus_instalado=True y /verificar daba IO_ERROR."""
    monkeypatch.setenv('HERMES_HOME', str(tmp_path))
    esperado = (ROOT / 'corpus' / 'SHA256SUMS').read_text().split()[0]
    generacion = tmp_path / 'plugin-data' / 'dike' / 'generations' / esperado
    generacion.mkdir(parents=True)
    assert api.estado()['corpus_instalado'] is False
    (generacion / 'installed.json').write_text(json.dumps({'package_sha256': 'otro', 'files': {'a': 'b'}}))
    assert api.estado()['corpus_instalado'] is False
    (generacion / 'installed.json').write_text(json.dumps({'package_sha256': esperado, 'files': {'a': 'b'}}))
    out = api.estado()
    assert out['corpus_instalado'] is True and out['generation'] == esperado


@pytest.mark.parametrize('texto', [42, ['x'], {'a': 1}, 'artículo \ud800'])
def test_privacidad_rechaza_texto_invalido_con_400(api, texto):
    """Un texto que no es string terminaba en AttributeError (500), no en 400."""
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as exc:
        api._texto_privacidad({'texto': texto})
    assert exc.value.status_code == 400


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
    """Contrato del plugin en la FUENTE y en el bundle sin minificar:
    el bundle conserva la forma de la fuente (espacios y comillas)."""
    src = (DESKTOP / 'src' / 'plugin.src.js').read_text()
    assert "id: ID" in src
    assert "ROUTES_AREA" in src and "path: '/dike'" in src
    assert "SIDEBAR_NAV_AREA" in src
    assert "PALETTE_AREA" in src
    bundle = (DESKTOP / 'plugin.js').read_text()
    assert 'path: "/dike"' in bundle
    assert 'eval(' not in bundle and 'new Function(' not in bundle
    assert 'import(' not in bundle


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


def _js_publicados_desktop():
    """Los .js de desktop/ que viajan con el plugin: los versionados en git, o
    sin git todo desktop/ salvo node_modules y los dist del arnés."""
    try:
        rutas = subprocess.run(
            ['git', 'ls-files', 'desktop'], cwd=ROOT, capture_output=True,
            text=True, timeout=30, check=True).stdout.split()
        archivos = [ROOT / r for r in rutas]
    except (OSError, subprocess.SubprocessError):
        archivos = [p for p in DESKTOP.rglob('*.js')
                    if 'node_modules' not in p.parts and 'dist' not in p.parts]
    return [p for p in archivos if p.suffix == '.js' and p.is_file()]


def test_desktop_pasa_el_lint_de_superficie_de_hermes():
    """`hermes plugins validate` lintea todo .js bajo desktop/, también src/ y
    dev/: un import con forma de esquema ('x:…') en la fuente basta para que
    falle el check «desktop surface», aunque el bundle esté limpio."""
    lint = pytest.importorskip('hermes_cli.plugin_validate_desktop')
    hallazgos = []
    for js in _js_publicados_desktop():
        rel = js.relative_to(ROOT).as_posix()
        if lint.is_desktop_surface(rel):
            fuente = js.read_text(encoding='utf-8-sig')
            hallazgos += [f'{regla} ({rel}:{linea})'
                          for regla, linea in lint.desktop_surface_findings(fuente)]
    assert not hallazgos, hallazgos


@pytest.mark.skipif(NODE is None, reason='node no está en PATH')
def test_sintaxis_js(tmp_path):
    web = tmp_path / 'index.cjs'
    web.write_text((DASH / 'dist/index.js').read_text())
    desk = tmp_path / 'plugin.mjs'
    desk.write_text((DESKTOP / 'plugin.js').read_text())
    for f in (web, desk):
        subprocess.run([NODE, '--check', str(f)], check=True, capture_output=True)



def test_redaccion_compartida_conserva_urls_y_acota_panel(api):
    texto = 'https://ley.invalid/a /home/u/secreto C:\\Users\\u\\secreto'
    mod = api._adaptador()
    esperado = 'https://ley.invalid/a <ruta-local> <ruta-local>'
    assert mod._limpiar_rutas(texto) == esperado
    assert mod._limpio_panel(texto) == api._limpio(texto) == esperado
    assert len(api._limpio('x' * 500)) == 400
