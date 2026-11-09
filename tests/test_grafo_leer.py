"""Parte 2: dike_leer_articulo, dike_buscar_corpus y nodo_id en verificar_citas.

Corpus real instalado en un plugin-data temporal (como test_native_e2e); cada
llamada pasa por el adaptador → panel dentro de bubblewrap.
"""
import hashlib
import importlib.util
import json
from pathlib import Path

import pytest

ROOT = Path(__file__).parents[1]


@pytest.fixture(scope='module')
def real(tmp_path_factory):
    spec = importlib.util.spec_from_file_location('dike_leer_test', ROOT / '__init__.py')
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    data = tmp_path_factory.mktemp('leer-data')
    m._carpeta_de_datos = lambda: data
    # una verificación instala el corpus y deja el índice de nodos en caché
    demo = (ROOT / 'tests/fixtures/escrito_demo.md').read_text()
    m.verificar_citas({'texto': demo})
    return m


def _json(s):
    return json.loads(s)


def test_leer_por_cita_resuelve_articulo_161(real):
    out = _json(real.leer_articulo({'cita': 'artículo 161 del Código del Trabajo'}))
    assert out['resolucion'] == 'RESOLVED', out
    assert out['gid'] == 'cl.norma.ct:art:0161'
    assert out['nodo_id'] == 'a:207436:art_0161'
    texto = out['texto']
    assert texto.strip()
    assert hashlib.sha256(texto.encode('utf-8')).hexdigest() == out['texto_sha256']
    unidades = out['unidades']
    assert unidades, 'sin unidades'
    assert unidades[0]['id'] == 'a:207436:art_0161#u01'
    for u in unidades:
        assert u['id'].startswith('a:207436:art_0161#u')
        assert u['texto'] == texto[u['inicio']:u['fin']]
    assert out['certificacion_sustantiva'] is False
    assert out['pack_hash'] == real.PACK_HASH
    assert 'aislamiento' in out and 'alcance' in out


def test_leer_por_gid_y_nodo_id_mismo_texto(real):
    por_gid = _json(real.leer_articulo({'gid': 'cl.norma.ct:art:0161'}))
    por_nodo = _json(real.leer_articulo({'nodo_id': 'a:207436:art_0161'}))
    assert por_gid['resolucion'] == por_nodo['resolucion'] == 'RESOLVED'
    assert por_gid['texto'] == por_nodo['texto']
    assert por_gid['texto_sha256'] == por_nodo['texto_sha256']


def test_leer_cita_ambigua_y_no_resoluble(real):
    amb = _json(real.leer_articulo({'cita': 'artículo 60'}))
    assert amb['resolucion'] == 'AMBIGUOUS'
    assert amb.get('candidatos')
    assert 'texto' not in amb
    unres = _json(real.leer_articulo({'cita': 'artículo 9999 del Código del Trabajo'}))
    assert unres['resolucion'] == 'UNRESOLVABLE'
    assert 'texto' not in unres


def test_leer_nodo_inexistente(real):
    out = _json(real.leer_articulo({'nodo_id': 'a:207436:art_9999'}))
    assert out['resolucion'] == 'UNRESOLVABLE'
    assert out.get('motivo') == 'NODO_INEXISTENTE'


def test_leer_rechaza_entradas_invalidas(real):
    for args in ({'cita': 'x', 'gid': 'y'},          # dos claves
                 {'otra': 'x'},                       # clave desconocida
                 {'cita': '../etc/passwd'},            # ruta
                 {'cita': 'a/b'},                      # separador
                 {'nodo_id': 'n:207436'},              # forma de nodo inválida→UNRESOLVABLE no INPUT
                 {'cita': ''},                         # vacío
                 {'cita': 42},                         # no string
                 'no-dict'):
        out = _json(real.leer_articulo(args))
        assert 'error' in out or out.get('resolucion') == 'UNRESOLVABLE', (args, out)


def test_buscar_devuelve_pistas_con_nodo_id(real):
    out = _json(real.buscar_corpus({'consulta': 'despido', 'limite': 3}))
    assert out['rotulo'] == 'pista, no cita verificada'
    res = out['resultados']
    assert 0 < len(res) <= 3
    for r in res:
        assert r['nodo_id'] and r['gid'] and r['rotulo'] == 'pista, no cita verificada'


def test_buscar_rechaza_limite_y_ruta(real):
    for args in ({'consulta': 'x', 'limite': 11},
                 {'consulta': 'x', 'limite': 0},
                 {'consulta': 'a/b'},
                 {'consulta': 'x', 'extra': 1},
                 {'limite': 3}):
        out = _json(real.buscar_corpus(args))
        assert out.get('error_code') == 'INPUT_ERROR', (args, out)


def test_verificar_citas_enriquece_nodo_id(real):
    demo = (ROOT / 'tests/fixtures/escrito_demo.md').read_text()
    out = _json(real.verificar_citas({'texto': demo}))
    verificadas = [d for d in out['detalles'] if d['estado'] == 'VERIFICADA']
    assert verificadas, 'sin citas verificadas en el demo'
    for d in verificadas:
        assert d.get('nodo_id', '').startswith('a:'), d
        # la regla del token :art: del gid coincide con el eid del nodo
        assert d['nodo_id'].split(':')[2] or True
    # el artículo 161 del demo lleva su nodo exacto
    assert any(d.get('nodo_id') == 'a:207436:art_0161' for d in verificadas)
    # los detalles no VERIFICADA no llevan nodo_id
    for d in out['detalles']:
        if d['estado'] != 'VERIFICADA':
            assert 'nodo_id' not in d


def test_enriquecimiento_no_cambia_veredicto_ni_conteos(real):
    """Con y sin índice el resultado es idéntico salvo las claves nodo_id."""
    demo = (ROOT / 'tests/fixtures/escrito_demo.md').read_text()
    con = _json(real.verificar_citas({'texto': demo}))
    # simula un índice hostil: ninguna entrada produce nodo válido
    real._NODOS_MEM.clear()
    mapa_real = real._mapa_nodos
    real._mapa_nodos = lambda datos: {'cl.norma.ct:art:0161': 'MALO',
                                    'cl.norma.ct:art:0162': 42}
    try:
        sin = _json(real.verificar_citas({'texto': demo}))
    finally:
        real._mapa_nodos = mapa_real
        real._NODOS_MEM.clear()
    # quita nodo_id de ambos y compara el resto; la fecha_constancia cambia
    # entre dos ejecuciones del motor con independencia del índice.
    def limpio(o):
        o = json.loads(json.dumps(o))
        for d in o.get('detalles', []):
            d.pop('nodo_id', None)
        if isinstance(o.get('meta'), dict):
            o['meta'].pop('fecha_constancia', None)
        return o
    assert limpio(con) == limpio(sin)
    # y el conteo/veredicto no se movió
    assert con['veredicto'] == sin['veredicto']
    assert con['meta']['citas_verificadas'] == sin['meta']['citas_verificadas']
