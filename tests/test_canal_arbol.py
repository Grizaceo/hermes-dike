"""Árbol de materias (``scripts/canal_arbol.py`` + ``data/arbol/``).

El árbol clasifica la consulta y etiqueta cada resultado como ``ancla`` o
``territorio`` de las materias top 3. Es explicación auditable: no toca el
orden ni los puntajes del BM25, y si los JSON faltan o son inválidos la
búsqueda sigue igual con ``arbol.disponible == false``.

Los datos de prueba son sintéticos y viven en ``tmp_path``; los JSON
empaquetados en ``data/arbol/`` se verifican por hash y por contenido.
"""
import hashlib
import importlib.util
import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).parents[1]
PANEL = ROOT / 'scripts' / 'panel.py'
SCRIPTS = ROOT / 'scripts'
MOTOR = ROOT / 'motor'
DATA_ARBOL = ROOT / 'data' / 'arbol'

for _p in (str(SCRIPTS), str(MOTOR)):
    if _p not in sys.path:
        sys.path.insert(0, _p)

import canal_arbol  # noqa: E402
from soporte_busqueda import _articulo_json, _esbuild_ascii, NORM_ID  # noqa: E402

SHA_ARBOL = 'c675dfe38eb58bbbd4fcb72f3b5d2ffe086829d804089cd9d08ed810216cd826'
SHA_LEXICON = 'b77153bb397c55b07c716187f06281a5c290c6b21226de5649fb80c4ca19b300'

# Cuarto artículo del mismo código ('ct'): NO es ancla de ninguna materia,
# así un resultado suyo solo puede entrar por territorio.
ARTICULOS = [
    ('art_0001', '1',
     'El trabajador despedido tiene derecho a indemnización por años de servicio.\n'
     'La indemnización se calcula conforme a la remuneración y la antigüedad.\n'
     'El empleador debe pagar dentro del plazo legal.'),
    ('art_0002', '2',
     'El arrendamiento de bienes raíces se rige por las normas del código civil.'),
    ('art_0003', '3',
     'El trabajador tiene derecho a feriado legal de quince días hábiles por cada año de servicio.'),
    ('art_0004', '4',
     'El trabajador tiene derecho a vacaciones proporcionales de fifteen días por cada año.'),
]


def _mini_corpus(users_root: Path) -> Path:
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


def _arbol_dir(tmp_path: Path) -> Path:
    """Árbol y lexicón mínimos: laboral (2 anclas), propiedad (1 ancla)."""
    d = tmp_path / 'arbol'
    d.mkdir(parents=True)
    (d / 'arbol_derecho_anclas.json').write_text(json.dumps({
        'version': 1,
        'nombre': 'arbol sintético de tests',
        'nodos': [
            {'id': 'civil', 'nombre': 'Derecho civil', 'tipo': 'rama',
             'rama': 'civil', 'padre': None, 'anclas': []},
            {'id': 'laboral', 'nombre': 'Derecho laboral', 'tipo': 'materia',
             'rama': 'laboral', 'padre': 'civil',
             'anclas': ['cl.norma.ct:art:0001', 'cl.norma.ct:art:0003']},
            {'id': 'propiedad', 'nombre': 'Propiedad raíz', 'tipo': 'materia',
             'rama': 'civil', 'padre': 'civil',
             'anclas': ['cl.norma.ct:art:0002']},
            {'id': 'seguridad', 'nombre': 'Seguridad social', 'tipo': 'materia',
             'rama': 'laboral', 'padre': 'civil', 'anclas': []},
        ],
    }, ensure_ascii=False), encoding='utf-8')
    (d / 'arbol_lexicon.json').write_text(json.dumps({
        'laboral': ['despido', 'indemnización', 'vacaciones'],
        'propiedad': ['arrendamiento'],
        'seguridad': ['indemnización'],
    }, ensure_ascii=False), encoding='utf-8')
    return d


@pytest.fixture(scope='module')
def panel_mod():
    spec = importlib.util.spec_from_file_location('dike_panel_arbol', PANEL)
    m = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = m
    spec.loader.exec_module(m)
    return m


@pytest.fixture(scope='module')
def corpus_dir(tmp_path_factory):
    return _mini_corpus(tmp_path_factory.mktemp('corpus'))


@pytest.fixture()
def arbol_dir(tmp_path):
    return _arbol_dir(tmp_path)


def _retriever(corpus_dir):
    from lexo_cli.starter.resolver import StarterCorpusResolver
    from lexo_cli.starter.retrieval import StarterCorpusRetriever
    resolver = StarterCorpusResolver([Path(corpus_dir)])
    return StarterCorpusRetriever(resolver)


def test_clasificar_materia_y_terminos(panel_mod, corpus_dir, arbol_dir):
    """clasificar devuelve la materia esperada con los términos activadores."""
    retriever = _retriever(corpus_dir)
    d = arbol_dir
    canal = canal_arbol.CanalArbol(
        retriever,
        arbol_path=d / 'arbol_derecho_anclas.json',
        lexicon_path=d / 'arbol_lexicon.json')
    out = canal.clasificar('despido del trabajador', top=3)
    assert out, 'clasificar no devolvió materias'
    top = out[0]
    assert top['nodo'] == 'laboral'
    assert top['nombre'] == 'Derecho laboral'
    assert 'despido' in top['terminos']
    assert 'trabajador' in top['terminos'] or 'despido' in top['terminos']
    assert top['score'] > 0
    assert top['cobertura'] > 0


def test_materias_ancla_y_territorio(panel_mod, corpus_dir, arbol_dir):
    """materias marca ancla (gid en el nodo) y territorio (código del gid)."""
    r = panel_mod.buscar('despido indemnización', corpus_dirs=[corpus_dir],
                         arbol_dir=arbol_dir)
    assert r['arbol']['disponible'] is True
    top3 = {c['nodo'] for c in r['arbol']['clasificacion']}
    assert 'laboral' in top3
    por_gid = {x['gid']: x for x in r['resultados']}
    # art_0001 es ancla de laboral y art_0004 solo está en su territorio.
    m1 = {m['nodo']: m['relacion'] for m in por_gid['cl.norma.ct:art:0001']['materias']}
    assert m1.get('laboral') == 'ancla'
    # «vacaciones» trae art_0004, que no es ancla pero sí territorio (ct).
    r2 = panel_mod.buscar('vacaciones', corpus_dirs=[corpus_dir],
                          arbol_dir=arbol_dir)
    assert r2['arbol']['disponible'] is True
    assert 'laboral' in {c['nodo'] for c in r2['arbol']['clasificacion']}
    res4 = [x for x in r2['resultados'] if x['gid'] == 'cl.norma.ct:art:0004']
    assert res4, 'art_0004 no apareció en la búsqueda «vacaciones»'
    m4 = {m['nodo']: m['relacion'] for m in res4[0]['materias']}
    assert m4.get('laboral') == 'territorio'


def test_arbol_ratio_y_clara(panel_mod, corpus_dir, arbol_dir):
    """Con dos materias activas el ratio decide `clara`; la nota es fija."""
    r = panel_mod.buscar('despido indemnización', corpus_dirs=[corpus_dir],
                         arbol_dir=arbol_dir)
    arbol = r['arbol']
    assert arbol['nota'] == ('Clasificación léxica por árbol de materias: '
                             'explica, no reordena')
    assert arbol['umbral'] == 1.6
    # laboral puntúa por dos términos del lexicón; seguridad solo por uno.
    scores = [c['score'] for c in arbol['clasificacion']]
    assert len(scores) >= 2
    assert scores[0] > scores[1]
    assert arbol['ratio'] == round(scores[0] / scores[1], 3)
    assert arbol['clara'] == (arbol['ratio'] >= 1.6)


def test_arbol_ausente_o_invalido_no_tumba(panel_mod, corpus_dir, tmp_path):
    """Sin árbol o con JSON inválido: mismos resultados, disponible=false."""
    q = 'despido del trabajador'
    con_arbol = panel_mod.buscar(q, corpus_dirs=[corpus_dir],
                                 arbol_dir=_arbol_dir(tmp_path / 'a'))
    vacio = tmp_path / 'vacio'
    vacio.mkdir()
    sin_arbol = panel_mod.buscar(q, corpus_dirs=[corpus_dir], arbol_dir=vacio)
    assert sin_arbol['arbol']['disponible'] is False
    assert sin_arbol['arbol']['motivo']

    invalido = tmp_path / 'invalido'
    invalido.mkdir()
    (invalido / 'arbol_derecho_anclas.json').write_text('{roto', encoding='utf-8')
    (invalido / 'arbol_lexicon.json').write_text('{}', encoding='utf-8')
    roto = panel_mod.buscar(q, corpus_dirs=[corpus_dir], arbol_dir=invalido)
    assert roto['arbol']['disponible'] is False

    for campo in ('gid', 'nodo_id', 'score', 'canal'):
        assert ([x[campo] for x in con_arbol['resultados']]
                == [x[campo] for x in sin_arbol['resultados']])
        assert ([x[campo] for x in con_arbol['resultados']]
                == [x[campo] for x in roto['resultados']])
    for x in sin_arbol['resultados'] + roto['resultados']:
        assert x['materias'] == []


def test_orden_identico_con_y_sin_arbol(panel_mod, corpus_dir, tmp_path):
    """El árbol no reordena: gid, score y rank son idénticos."""
    con = panel_mod.buscar('trabajador indemnización', corpus_dirs=[corpus_dir],
                           arbol_dir=_arbol_dir(tmp_path / 'b'))
    vacio = tmp_path / 'vacio2'
    vacio.mkdir()
    sin = panel_mod.buscar('trabajador indemnización', corpus_dirs=[corpus_dir],
                           arbol_dir=vacio)
    assert [(x['rank'], x['gid'], x['score']) for x in con['resultados']] == \
           [(x['rank'], x['gid'], x['score']) for x in sin['resultados']]


def test_json_empaquetados_hash_y_contenido(corpus_dir):
    """Los JSON de data/arbol/ son byte a byte los aprobados y cargan."""
    for nombre, esperado in (('arbol_derecho_anclas.json', SHA_ARBOL),
                             ('arbol_lexicon.json', SHA_LEXICON)):
        datos = (DATA_ARBOL / nombre).read_bytes()
        assert hashlib.sha256(datos).hexdigest() == esperado, nombre
    arbol = json.loads((DATA_ARBOL / 'arbol_derecho_anclas.json')
                       .read_text(encoding='utf-8'))
    lexicon = json.loads((DATA_ARBOL / 'arbol_lexicon.json')
                         .read_text(encoding='utf-8'))
    assert len(arbol['nodos']) == 85
    anclas = sum(len(n.get('anclas') or []) for n in arbol['nodos'])
    assert anclas == 51
    assert len(lexicon) == 44
    # Y el canal los carga de verdad sobre el corpus sintético.
    canal = canal_arbol.CanalArbol(_retriever(corpus_dir))
    assert len(canal.nodos) == 85
    assert sum(len(g) for g in canal.nodo_anclas.values()) == 51
    assert len(canal.lexicon) == 44


def test_canal_arbol_sin_rutas_de_maquina():
    """El módulo vendorizado no referencia rutas /home ni os.environ."""
    src = (SCRIPTS / 'canal_arbol.py').read_text(encoding='utf-8')
    assert '/home/' not in src
    assert 'os.environ' not in src
    assert 'import os' not in src


def test_bundle_contiene_nota_arbol():
    """El bundle compilado muestra la nota fija de explicación del árbol."""
    texto = (ROOT / 'desktop' / 'plugin.js').read_text(encoding='utf-8')
    nota = 'clasificación léxica por árbol de materias: explica, no reordena'
    assert nota in texto or _esbuild_ascii(nota) in texto
