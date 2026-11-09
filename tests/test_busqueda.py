"""Búsqueda por contenido (``grafo buscar`` / ``POST /grafo/buscar``).

El mini-corpus cumple el contrato completo del resolver —hash de texto,
atestación de completitud, ventana temporal y alias del catálogo— así que el
mismo camino que sirve la búsqueda real corre aquí de punta a punta, con
cadenas sintéticas (nada del corpus sellado entra al repo).
"""
import hashlib
import importlib.util
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).parents[1]
PANEL = ROOT / 'scripts' / 'panel.py'
API = ROOT / 'dashboard' / 'plugin_api.py'
BUNDLE = ROOT / 'desktop' / 'plugin.js'

ROTULO = 'Resultado de búsqueda: es una pista, no una fuente verificada'
NORM_ID = 'https://dike.invalid/eli/cl/codigo/codigo-del-trabajo'

# Tres artículos sintéticos del Código del Trabajo (leychileCode 207436 →
# alias 'ct' del catálogo). «trabajador» aparece en dos para poder observar
# el clamp de `limite`; «despido» solo en el primero.
ARTICULOS = [
    ('art_0001', '1',
     'El trabajador despedido tiene derecho a indemnización por años de servicio.\n'
     'La indemnización se calcula conforme a la remuneración y la antigüedad.\n'
     'El empleador debe pagar dentro del plazo legal.'),
    ('art_0002', '2',
     'El arrendamiento de bienes raíces se rige por las normas del código civil.'),
    ('art_0003', '3',
     'El trabajador tiene derecho a feriado legal de quince días hábiles por cada año de servicio.'),
]


def _articulo_json(eid: str, label: str, texto: str) -> dict:
    sha = hashlib.sha256(texto.encode('utf-8')).hexdigest()
    return {
        '@type': 'Article',
        '@id': f'{NORM_ID}/art_{eid.removeprefix("art_")}',
        'isPartOf': NORM_ID,
        'eId': eid,
        'label': label,
        'text': texto,
        'textSha256': sha,
        'citation': {
            'status': 'CITABLE',
            'completenessVerified': True,
            'textSha256': sha,
            'verificationMethod': 'fixture sintético de tests',
        },
        'temporal': {'from': '2020-01-01'},
        'provenance': {'wasDerivedFrom': f'https://x.test/{eid}'},
    }


def _mini_corpus(users_root: Path) -> Path:
    """Instala ``users/test/starter/mini/current`` con 1 norma y 3 artículos."""
    current = users_root / 'test' / 'starter' / 'mini' / 'current'
    (current / 'normas').mkdir(parents=True)
    (current / 'articulos').mkdir(parents=True)
    (current / 'normas' / 'norma_207436.json').write_text(json.dumps({
        '@type': 'LegalResource',
        '@id': NORM_ID,
        'leychileCode': '207436',
        'eli': {'type': 'codigo', 'number': 'codigo-del-trabajo'},
        'title': 'FIJA EL TEXTO DEL CODIGO DEL TRABAJO',
        'sourceDocumentUrl': 'https://x.test/ct',
    }), encoding='utf-8')
    for eid, label, texto in ARTICULOS:
        (current / 'articulos' / f'articulo_207436_{eid}.json').write_text(
            json.dumps(_articulo_json(eid, label, texto), ensure_ascii=False),
            encoding='utf-8')
    return current


@pytest.fixture(scope='module')
def panel_mod():
    """scripts/panel.py como módulo, para llamar ``buscar`` en proceso."""
    spec = importlib.util.spec_from_file_location('dike_panel_busq', PANEL)
    m = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = m
    spec.loader.exec_module(m)
    return m


@pytest.fixture()
def cache_a_tmp(tmp_path, monkeypatch):
    """Las cachés del motor (binding + BM25) caen en tmp, nunca en ~/.dike."""
    monkeypatch.setenv('HOME', str(tmp_path / 'home'))
    monkeypatch.setenv('DIKE_BINDING_CACHE_DIR', str(tmp_path / 'home' / '.dike' / 'binding_cache'))
    return tmp_path


@pytest.fixture()
def panel_proc(tmp_path):
    """Corre scripts/panel.py como subproceso con el workspace aislado."""
    home = tmp_path / 'home'
    users = tmp_path / 'users'
    home.mkdir()
    env = dict(os.environ)
    env.update({
        'HOME': str(home),
        'DIKE_USER': 'test',
        'DIKE_USERS_ROOT': str(users),
        'PYTHONPATH': str(ROOT / 'motor'),
        'LEXO_CONFIG': str(tmp_path / 'config.yaml'),
    })
    (tmp_path / 'config.yaml').write_text('starter:\n  user: test\n', encoding='utf-8')

    def run(*args, entrada=None):
        proc = subprocess.run(
            [sys.executable, str(PANEL), *args],
            env=env, input=entrada, capture_output=True, text=True, timeout=120)
        assert proc.returncode in (0, 2), proc.stderr
        out = proc.stdout.strip()
        assert out, proc.stderr
        return json.loads(out), proc

    return run


@pytest.fixture(scope='module')
def api():
    pytest.importorskip('fastapi')
    spec = importlib.util.spec_from_file_location('dike_plugin_api_busq', API)
    m = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = m
    try:
        spec.loader.exec_module(m)
    except Exception:
        sys.modules.pop(spec.name, None)
        raise
    return m


# ---------------------------------------------------------------------------
# buscar() sobre el mini-corpus sintético
# ---------------------------------------------------------------------------

def test_buscar_encuentra_articulo_y_nodo_en_grafo_red(panel_mod, cache_a_tmp):
    current = _mini_corpus(cache_a_tmp / 'users')
    out = panel_mod.buscar('despido indemnización', limite=10,
                           corpus_dirs=[current])
    assert out['rotulo'] == ROTULO
    assert out['metodo']['modelo'] is None
    assert out['sin_nodo'] == 0
    assert out['resultados'], out
    top = out['resultados'][0]
    assert top['nodo_id'] == 'a:207436:art_0001'
    assert top['gid'] == 'cl.norma.ct:art:0001'
    assert top['instrumento'] == 'n:207436'
    assert 'Código del Trabajo' in top['label']
    assert top['rank'] == 1
    assert top['score_rel'] == 1.0
    assert top['sha256'] == hashlib.sha256(
        ARTICULOS[0][2].encode('utf-8')).hexdigest()

    # El nodo existe en `grafo red` del mismo corpus (subproceso, como la API).
    red, _ = panel_proc_red(cache_a_tmp)
    ids = {n['id'] for n in red['nodes']}
    assert top['nodo_id'] in ids
    assert top['instrumento'] in ids

    # Unidades: ids #uNN y términos presentes (familia morfológica).
    assert top['unidades'], top
    for u in top['unidades']:
        assert u['id'].startswith('a:207436:art_0001#u')
        assert len(u['id'].rsplit('#u', 1)[1]) >= 2
        assert u['terminos'], u


def panel_proc_red(tmp_path):
    "_helper mínimo para `grafo red` con el mismo aislamiento."""
    home = tmp_path / 'home'
    users = tmp_path / 'users'
    home.mkdir(exist_ok=True)
    env = dict(os.environ)
    env.update({
        'HOME': str(home),
        'DIKE_USER': 'test',
        'DIKE_USERS_ROOT': str(users),
        'PYTHONPATH': str(ROOT / 'motor'),
        'LEXO_CONFIG': str(tmp_path / 'config.yaml'),
    })
    (tmp_path / 'config.yaml').write_text('starter:\n  user: test\n', encoding='utf-8')
    proc = subprocess.run(
        [sys.executable, str(PANEL), 'grafo', 'red'],
        env=env, capture_output=True, text=True, timeout=120)
    assert proc.returncode in (0, 2), proc.stderr
    return json.loads(proc.stdout.strip()), proc


def test_buscar_validacion(panel_mod, cache_a_tmp):
    current = _mini_corpus(cache_a_tmp / 'users2')
    for mala in ('', '   ', '\t\n', 'x' * 301, 'despido\x00forzado',
                 'que como para con por del las los'):
        with pytest.raises(ValueError):
            panel_mod.buscar(mala, limite=10, corpus_dirs=[current])
    with pytest.raises(ValueError):
        panel_mod.buscar(123, limite=10, corpus_dirs=[current])

    # `limite` fuera de rango se acota, no se rechaza: 0 → 1, 999 → 50.
    uno = panel_mod.buscar('trabajador', limite=0, corpus_dirs=[current])
    todos = panel_mod.buscar('trabajador', limite=999, corpus_dirs=[current])
    assert uno['total'] == 1
    assert todos['total'] == 2  # art_0001 y art_0003 mencionan «trabajador»


def test_buscar_sin_coincidencias(panel_mod, cache_a_tmp):
    current = _mini_corpus(cache_a_tmp / 'users3')
    out = panel_mod.buscar('zxqwplomenucleo', limite=10, corpus_dirs=[current])
    assert out['resultados'] == [] and out['total'] == 0


# ---------------------------------------------------------------------------
# Ruta HTTP: validación, rótulo y transporte stdin
# ---------------------------------------------------------------------------

class _PanelErrorFalso(Exception):
    """Doble del ``PanelError`` del adaptador: el dashboard solo lee kind/detalle."""
    def __init__(self, kind, detalle=''):
        super().__init__(kind)
        self.kind = kind
        self.detalle = detalle


def _stub_motor(monkeypatch, api, stdout='{}'):
    capturado = {}

    class FakeProc:
        pass

    proc = FakeProc()
    proc.returncode = 0
    proc.stdout = stdout
    proc.stderr = ''

    def fake_run(cmd, **kw):
        capturado['cmd'] = cmd
        capturado['kw'] = kw
        return proc

    # Misma forma que __init__._panel_json: parsea y clasifica en PanelError.
    def fake_panel_json(args, *, runtime, timeout=90, entrada=None):
        try:
            proc = subprocess.run(
                [sys.executable, str(PANEL), *args],
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
        '_carpeta_de_datos': staticmethod(lambda: Path('/tmp/x')),
        '_entorno': staticmethod(lambda runtime: {}),
        '_asegurar_corpus': staticmethod(lambda datos: {'generation': '/tmp/gen'}),
        '_panel_json': staticmethod(fake_panel_json),
        '_aislamiento': staticmethod(lambda: _AislamientoFalso),
    })()
    monkeypatch.setattr(api, '_adaptador', lambda: mod)
    monkeypatch.setattr(subprocess, 'run', fake_run)
    return capturado


def test_ruta_grafo_buscar(api, monkeypatch):
    payload = {
        'rotulo': ROTULO,
        'metodo': {'motor': 'bm25-starter', 'determinista': True,
                   'modelo': None, 'canales': [], 'pack': 'mini'},
        'total': 0, 'sin_nodo': 0, 'resultados': [],
    }
    _stub_motor(monkeypatch, api, stdout=json.dumps(payload))
    out = api.grafo_buscar({'q': 'despido', 'limite': 5})
    assert out['rotulo'] == ROTULO
    assert out['metodo']['modelo'] is None
    assert out['metodo']['determinista'] is True


def test_ruta_grafo_buscar_body_invalido(api):
    from fastapi import HTTPException
    for cuerpo in ({}, {'q': 123}, {'q': ''}, {'q': '   '},
                   {'q': 'x' * 301}, {'q': 'a\x00b'}, 'no-es-dict',
                   {'q': 'ok', 'limite': 'cinco'}, {'q': 'ok', 'limite': True},
                   {'q': 'ok', 'limite': 1.5}):
        with pytest.raises(HTTPException) as exc:
            api.grafo_buscar(cuerpo)
        assert exc.value.status_code == 400, cuerpo


def test_consulta_stdin_directo(api, monkeypatch):
    capturado = _stub_motor(monkeypatch, api,
                            stdout='{"rotulo": "x", "resultados": []}')
    consulta = 'indemnización consulta centinela'
    api.grafo_buscar({'q': consulta, 'limite': 7})
    cmd = capturado['cmd']
    assert cmd[-2:] == ['grafo', 'buscar']
    for arg in cmd:
        assert consulta not in str(arg)
        assert 'consulta centinela' not in str(arg)
    entrada = capturado['kw'].get('input')
    assert isinstance(entrada, str)
    payload = json.loads(entrada)
    assert payload['q'] == consulta and payload['limite'] == 7


# ---------------------------------------------------------------------------
# La consulta no persiste: búsqueda real sobre el mini-corpus en subproceso
# ---------------------------------------------------------------------------

def test_consulta_no_se_persiste(panel_proc, tmp_path):
    current = _mini_corpus(tmp_path / 'users')
    centinela = 'zxqwplomenucleo'
    salida, _ = panel_proc(
        'grafo', 'buscar',
        entrada=json.dumps({'q': centinela, 'limite': 10}))
    assert 'error' not in salida
    assert centinela not in json.dumps(salida, ensure_ascii=False)
    # Ningún archivo bajo el plugin-data temporal contiene los bytes de la
    # consulta (ni el pickle BM25 ni el binding cache la guardan).
    raiz = tmp_path
    archivos = [p for p in raiz.rglob('*') if p.is_file()]
    assert archivos, 'la búsqueda debió escribir al menos la caché BM25'
    for p in archivos:
        contenido = p.read_bytes()
        assert centinela.encode() not in contenido, p


# ---------------------------------------------------------------------------
# El bundle construido contiene el rótulo exacto
# ---------------------------------------------------------------------------

def _esbuild_ascii(texto: str) -> str:
    """La forma en que esbuild (charset ascii) escribe `texto` en el bundle.

    El runtime JS la decodifica de vuelta al string exacto; buscar el texto
    crudo fallaría porque el bundle escapa todo lo no-ASCII.
    """
    out = []
    for c in texto:
        cp = ord(c)
        if cp < 0x80:
            out.append(c)
        elif cp <= 0xFF:
            out.append('\\x%02X' % cp)
        elif cp <= 0xFFFF:
            out.append('\\u%04X' % cp)
        else:
            cp -= 0x10000
            out.append('\\u%04X\\u%04X'
                       % (0xD800 + (cp >> 10), 0xDC00 + (cp & 0x3FF)))
    return ''.join(out)


def test_bundle_contiene_rotulo():
    texto = BUNDLE.read_text(encoding='utf-8')
    assert ROTULO in texto or _esbuild_ascii(ROTULO) in texto
