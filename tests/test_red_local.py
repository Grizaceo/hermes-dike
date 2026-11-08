"""Capa ambiental local: reglas R-CITA-ART/LEY, R-RES, R-APLICA y endpoints.

Todas las cadenas son sintéticas — ningún texto de sentencia real entra
al repo ni a las pruebas.
"""
import hashlib
import importlib.util
import json
import sqlite3
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).parents[1]
BUILDER = ROOT / 'scripts' / 'construir_red_local.py'


@pytest.fixture(scope='module')
def api():
    pytest.importorskip('fastapi')
    spec = importlib.util.spec_from_file_location(
        'dike_plugin_api_test_red', ROOT / 'dashboard' / 'plugin_api.py')
    m = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = m
    try:
        spec.loader.exec_module(m)
    except Exception:
        sys.modules.pop(spec.name, None)
        raise
    return m


@pytest.fixture(scope='module')
def builder():
    spec = importlib.util.spec_from_file_location('red_local_mod', BUILDER)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


DOC = 'cl.judgment.1_tribunal_ambiental.s1ta_r_60_2022'
INST = 'cl.norma.ley_19300'


def _db(tmp_path, doc_texto, cons=None, nodos_extra=None, links_extra=None,
        docs_extra=None, resos=None):
    """DB mínima con el mismo esquema que la base real."""
    nodos = [
        (INST, 'Instrumento', 'LEY X'),
        (INST + ':art:0005', 'UnidadNormativa', 'art. 5'),
        (INST + ':art:0005:inc:1', 'UnidadNormativa', ''),
        (INST + ':art:0005:inc:2', 'UnidadNormativa', ''),
        (INST + ':art:0005:inc:3', 'UnidadNormativa', ''),
        (INST + ':art:0006', 'UnidadNormativa', 'art. 6'),
        (INST + ':art:0010bis', 'UnidadNormativa', 'art. 10 bis'),
        (INST + ':art:0010ter', 'UnidadNormativa', 'art. 10 ter'),
        (INST + ':art:0018qua', 'UnidadNormativa', 'art. 18 quáter'),
        ('cl.norma.ley_20417', 'Instrumento', 'LEY Y'),
        ('cl.norma.ley_20417:art:0003', 'UnidadNormativa', 'art. 3'),
        ('cl.norma.ley_20600', 'Instrumento', 'LEY Z'),
        ('cl.norma.ds_40_2012', 'Instrumento', 'DS 40'),
        (DOC, 'Sentencia', ''),
    ] + (nodos_extra or [])
    aristas = [
        ('INSTRUMENT_CONTAINS_UNIT', INST, INST + ':art:0005', None),
        ('INSTRUMENT_CONTAINS_UNIT', INST, INST + ':art:0006', None),
        ('INSTRUMENT_CONTAINS_UNIT', INST, INST + ':art:0010bis', None),
        ('INSTRUMENT_CONTAINS_UNIT', INST, INST + ':art:0010ter', None),
        ('INSTRUMENT_CONTAINS_UNIT', INST, INST + ':art:0018qua', None),
        ('UNIT_CONTAINS_UNIT', INST + ':art:0005', INST + ':art:0005:inc:1', None),
        ('UNIT_CONTAINS_UNIT', INST + ':art:0005', INST + ':art:0005:inc:2', None),
        ('UNIT_CONTAINS_UNIT', INST + ':art:0005', INST + ':art:0005:inc:3', None),
        ('INSTRUMENT_CONTAINS_UNIT', 'cl.norma.ley_20417',
         'cl.norma.ley_20417:art:0003', None),
    ] + (links_extra or [])
    docs = {DOC: doc_texto, INST + ':art:0005': 'texto art',
            INST + ':art:0005:inc:1': 'inciso uno'}
    docs.update(docs_extra or {})
    db = tmp_path / 'mini.db'
    db.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(db)
    con.executescript('''
      CREATE TABLE nodes(id TEXT, tenant_id TEXT, type TEXT, title TEXT,
                         metadata_json TEXT);
      CREATE TABLE edges(edge_id TEXT, tenant_id TEXT, type TEXT,
                         from_id TEXT, to_id TEXT, evidence_json TEXT,
                         meta_json TEXT);
      CREATE TABLE documents(doc_id TEXT, tenant_id TEXT,
                             canonical_text TEXT);
      CREATE TABLE considering_units(considering_id TEXT, document_id TEXT,
                                     ordinal INT, char_start INT,
                                     char_end INT);
      CREATE TABLE resolutive_units(resolutive_id TEXT, document_id TEXT,
                                    ordinal INT, char_start INT,
                                    char_end INT);
    ''')
    con.executemany('INSERT INTO nodes VALUES (?,?,?,?,?)',
                    [(i, 't', ty, ti, '{}') for i, ty, ti in nodos])
    con.executemany('INSERT INTO edges VALUES (?,?,?,?,?,?,?)',
                    [(f'e{k}', 't', ty, f, t, '{}', m)
                     for k, (ty, f, t, m) in enumerate(aristas)])
    con.executemany('INSERT INTO documents VALUES (?,?,?)',
                    [(i, 't', x) for i, x in docs.items()])
    for i, (cs, ce, o) in enumerate(cons or [(0, len(doc_texto), 1)]):
        con.execute('INSERT INTO considering_units VALUES (?,?,?,?,?)',
                    (f'c{i}', DOC, o, cs, ce))
    for i, (cs, ce, o) in enumerate(resos or []):
        con.execute('INSERT INTO resolutive_units VALUES (?,?,?,?,?)',
                    (f'r{i}', DOC, o, cs, ce))
    con.commit()
    con.close()
    return db


def _build(builder, tmp_path, **kw):
    db = _db(tmp_path, **kw)
    ap = tmp_path / 'ap.json'
    ap.write_text(json.dumps(
        {'sha256': hashlib.sha256(db.read_bytes()).hexdigest()}))
    salida = tmp_path / 'out'
    info = builder.construir(db, salida, ap)
    red = json.loads((salida / 'red.json').read_text())
    return red, info


def _links(red, tipo, src=None, dst=None):
    return [l for l in red['links'] if l['tipo'] == tipo
            and (src is None or l['source'] == src)
            and (dst is None or l['target'] == dst)]


UID = DOC + '#cons01'


def test_cita_simple(builder, tmp_path):
    red, _ = _build(builder, tmp_path,
                    doc_texto='El artículo 5 de la Ley 19.300 manda.')
    assert _links(red, 'cita', UID, INST + ':art:0005')


def test_cita_enumeracion(builder, tmp_path):
    red, _ = _build(builder, tmp_path,
                    doc_texto='Los artículos 5, 6 y 10 bis de la Ley 19.300.')
    t = {l['target'] for l in _links(red, 'cita')}
    assert {INST + ':art:0005', INST + ':art:0006',
            INST + ':art:0010bis'} <= t


def test_cita_sufijos(builder, tmp_path):
    red, _ = _build(builder, tmp_path,
                    doc_texto='Véanse los artículos 10 ter y 18 quáter '
                              'de la Ley 19.300.')
    t = {l['target'] for l in _links(red, 'cita')}
    assert INST + ':art:0010ter' in t and INST + ':art:0018qua' in t


def test_cita_inciso_y_final(builder, tmp_path):
    texto = ('El artículo 5 inciso segundo de la Ley 19.300 y su '
             'artículo 5 inciso final de la Ley 19.300.')
    red, _ = _build(builder, tmp_path, doc_texto=texto)
    t = {l['target'] for l in _links(red, 'cita')}
    assert INST + ':art:0005:inc:2' in t
    assert INST + ':art:0005:inc:3' in t  # final = último existente


def test_cita_losma(builder, tmp_path):
    red, _ = _build(builder, tmp_path,
                    doc_texto='El artículo 3 de la LOSMA así lo ordena.')
    assert _links(red, 'cita', UID, 'cl.norma.ley_20417:art:0003')


def test_cita_20417_ambiguo(builder, tmp_path):
    red, info = _build(builder, tmp_path,
                       doc_texto='El artículo 2 de la Ley 20.417 dispone.')
    assert info['conteos']['ambiguos_20417'] == 1
    assert not _links(red, 'cita')


def test_cita_sin_cuerpo(builder, tmp_path):
    _, info = _build(builder, tmp_path,
                     doc_texto='El artículo 5 se cumplió cabalmente aquí.')
    assert info['conteos']['sin_cuerpo'] == 1


def test_cita_no_cruza_frase(builder, tmp_path):
    _, info = _build(builder, tmp_path,
                     doc_texto='El artículo 5 es claro. La Ley 19.300 manda.')
    assert info['conteos']['sin_cuerpo'] == 1


def test_cita_articulo_inexistente_nivel_ley(builder, tmp_path):
    red, _ = _build(builder, tmp_path,
                    doc_texto='El artículo 99 de la Ley 19.300.')
    c = _links(red, 'cita', UID, INST)
    assert c and c[0]['evidencia']['nivel'] == 'ley'


def test_res_con_anio_y_organismo(builder, tmp_path):
    red, _ = _build(builder, tmp_path,
                    doc_texto='La Resolución Exenta N° 72/2018 de la SMA '
                              'fue reclamada.')
    r = [n for n in red['nodes'] if n['tipo'] == 'resolucion']
    assert r and r[0]['id'] == 'res:SMA:72/2018'
    assert r[0]['organismo'] == 'SMA'
    assert _links(red, 'menciona', UID, 'res:SMA:72/2018') or \
        _links(red, 'revisa', UID, 'res:SMA:72/2018')


def test_res_sin_anio_no_crea_nodo(builder, tmp_path):
    red, info = _build(builder, tmp_path,
                       doc_texto='La Resolución Exenta N° 77 fue citada.')
    assert info['conteos']['sin_anio'] == 1
    assert not [n for n in red['nodes'] if n['tipo'] == 'resolucion']


def test_res_sin_organismo_id_local(builder, tmp_path):
    red, _ = _build(builder, tmp_path,
                    doc_texto='La Resolución N° 5 de 2019 fue estudiada.')
    r = [n for n in red['nodes'] if n['tipo'] == 'resolucion']
    assert r and r[0]['id'] == f'res:?:5/2019@{DOC}'


def test_res_revisa_vs_menciona(builder, tmp_path):
    # La 9/2020 va primero y a >220 caracteres del verbo de reclamo: la
    # ventana de R-RES-REV no la alcanza → menciona; la 72/2018 sí → revisa.
    relleno = 'texto neutro y más texto neutro. ' * 8
    red, _ = _build(builder, tmp_path,
                    doc_texto='La Resolución N° 9/2020 fue citada. ' + relleno +
                              'Los accionados se reclamaron en contra de la '
                              'Resolución Exenta N° 72/2018 de la SMA.')
    assert _links(red, 'revisa', UID, 'res:SMA:72/2018')
    assert _links(red, 'menciona', UID, 'res:?:9/2020@' + DOC)


def test_rca(builder, tmp_path):
    red, _ = _build(builder, tmp_path,
                    doc_texto='La RCA N° 161/2013 fue discutida.')
    r = [n for n in red['nodes'] if n['tipo'] == 'resolucion']
    assert r and r[0]['id'] == 'rca:161/2013' and r[0]['rca'] is True


def test_aplica_positivo(builder, tmp_path):
    red, _ = _build(builder, tmp_path,
                    doc_texto='La Resolución Exenta N° 72/2018 de la SMA '
                              'aplicó el artículo 5 de la Ley 19.300.')
    assert _links(red, 'aplica', 'res:SMA:72/2018', INST + ':art:0005')


def test_aplica_sin_verbo(builder, tmp_path):
    red, _ = _build(builder, tmp_path,
                    doc_texto='La Resolución Exenta N° 72/2018 de la SMA '
                              'y el artículo 5 de la Ley 19.300.')
    assert not _links(red, 'aplica')


def test_aplica_otra_frase(builder, tmp_path):
    red, _ = _build(builder, tmp_path,
                    doc_texto='La Resolución Exenta N° 72/2018 de la SMA '
                              'fue emitida. Se aplicó el artículo 5 '
                              'de la Ley 19.300.')
    assert not _links(red, 'aplica')


def test_cita_ley_y_dedupe(builder, tmp_path):
    """DOC_CITES_UNIT dentro de la unidad → cita ley; se omite si ya hay
    R-CITA-ART a un artículo del mismo instrumento."""
    texto = 'El artículo 5 de la Ley 19.300 y la norma entera.'
    meta = json.dumps({'j2_start_offset': 30, 'j2_end_offset': 40})
    red, info = _build(
        builder, tmp_path, doc_texto=texto,
        links_extra=[('DOC_CITES_UNIT', DOC, INST, meta)])
    assert info['conteos'].get('cita_ley_dedupe') == 1
    assert not _links(red, 'cita', UID, INST)


def test_cita_ley_sin_art(builder, tmp_path):
    texto = 'Se cita la ley sin artículo concreto alguno.'
    meta = json.dumps({'j2_start_offset': 4, 'j2_end_offset': 12})
    red, _ = _build(builder, tmp_path, doc_texto=texto,
                    links_extra=[('DOC_CITES_UNIT', DOC, INST, meta)])
    c = _links(red, 'cita', UID, INST)
    assert c and c[0]['evidencia']['regla'] == 'R-CITA-LEY'


def test_sha_mismatch_rechaza(builder, tmp_path):
    db = _db(tmp_path, doc_texto='x')
    ap = tmp_path / 'ap.json'
    ap.write_text(json.dumps({'sha256': '0' * 64}))
    with pytest.raises(SystemExit):
        builder.construir(db, tmp_path / 'out', ap)


def test_evidencia_offsets_validos(builder, tmp_path):
    texto = 'El artículo 5 de la Ley 19.300 manda y manda mucho.'
    db = _db(tmp_path, doc_texto=texto)
    ap = tmp_path / 'ap.json'
    ap.write_text(json.dumps(
        {'sha256': hashlib.sha256(db.read_bytes()).hexdigest()}))
    builder.construir(db, tmp_path / 'out', ap)
    red = json.loads((tmp_path / 'out' / 'red.json').read_text())
    for l in red['links']:
        ev = l.get('evidencia')
        if ev:
            assert 0 <= ev['char_start'] < ev['char_end'] <= len(texto)


# ---------------------------------------------------------------------------
# Endpoints de la capa local
# ---------------------------------------------------------------------------

def test_fuentes_y_red_ambiental(api, tmp_path, monkeypatch):
    amb = tmp_path / 'grafo-local' / 'ambiental'
    red = {'nodes': [], 'links': [], 'conteos': {}, 'fuente': 'ambiental',
           'local_only': True, 'truncado': False}
    amb.mkdir(parents=True)
    (amb / 'red.json').write_text(json.dumps(red))
    (amb / 'construccion.json').write_text(json.dumps({'construido': '2026-01-01T00:00:00'}))
    (amb / 'unidades.json').write_text(json.dumps({
        'textos': {'u_0001': {'texto': 't'}, 'r_0001': {'sin_texto': True}},
        'evidencias': {'s|d|cita': {'snippet': 'x', 'regla': 'R-CITA-ART'}}}))
    mod = type('M', (), {
        'PACK_HASH': 'h', '_carpeta_de_datos': staticmethod(lambda: tmp_path),
        '_entorno': staticmethod(lambda r: {}),
        '_asegurar_corpus': staticmethod(lambda d: {'generation': '/tmp/g'}),
    })()
    monkeypatch.setattr(api, '_adaptador', lambda: mod)
    fuentes = api.grafo_fuentes()
    amb_f = next(f for f in fuentes if f['id'] == 'ambiental')
    assert amb_f['disponible'] is True and amb_f['local_only'] is True
    assert api.grafo_red(fuente='ambiental')['local_only'] is True
    u = api.grafo_unidad('u_0001', fuente='ambiental')
    assert u['texto'] == 't'
    assert api.grafo_evidencia('s|d|cita')['snippet'] == 'x'


def test_red_ambiental_404_sin_build(api, tmp_path, monkeypatch):
    from fastapi import HTTPException
    mod = type('M', (), {
        'PACK_HASH': 'h', '_carpeta_de_datos': staticmethod(lambda: tmp_path),
        '_entorno': staticmethod(lambda r: {}),
        '_asegurar_corpus': staticmethod(lambda d: {'generation': '/tmp/g'}),
    })()
    monkeypatch.setattr(api, '_adaptador', lambda: mod)
    with pytest.raises(HTTPException) as exc:
        api.grafo_red(fuente='ambiental')
    assert exc.value.status_code == 404
    fuentes = api.grafo_fuentes()
    assert next(f for f in fuentes if f['id'] == 'ambiental')['disponible'] is False


# ---------------------------------------------------------------------------
# Etiquetas de sentencias y camino demo
# ---------------------------------------------------------------------------

def test_tabla_cubre_las_25_sentencias(builder, tmp_path):
    """Los 25 ids de la tabla reciben su etiqueta aprobada."""
    for clave, esperado in builder.ROTULOS_SENTENCIAS.items():
        sid = 'cl.judgment.' + clave
        assert builder.rotulo_sentencia(sid) == esperado


def test_tabla_prefijo_y_fallo_sin_etiqueta(builder):
    """Un id con carácter extra al final calza por prefijo; otro falla."""
    base = 'corte_suprema.civil5118_2024municipalidadvaldiviacongoguacorporations.'
    assert builder.rotulo_sentencia('cl.judgment.' + base + 'x') == \
        'CS · Rol 5.118-2024 · Municipalidad de Valdivia'
    with pytest.raises(SystemExit):
        builder.rotulo_sentencia('cl.judgment.desconocida.x')


def _camino_fixture(builder, tmp_path, *, revisa=True, con_u2=True,
                    org_ventana='de la SMA'):
    """Fixture sintética del camino completo S→U1→R→A←U2.

    Sentencias: dos considerandos — el primero reclama la resolución y
    aplica art. 5; el segundo cita art. 5. Todo con cadenas sintéticas."""
    verb = 'se reclamaron en contra de la ' if revisa else 'se estudió la '
    t1 = ('En esta parte ' + verb +
          'Resolución Exenta N° 72/2018 ' + org_ventana + ' y se aplicó '
          'el artículo 5 de la Ley 19.300.')
    t2 = 'Se citó el artículo 5 de la Ley 19.300 expresamente.'
    texto = t1 + '\n' + t2
    cons = [(0, len(t1), 1)]
    if con_u2:
        cons.append((len(t1) + 1, len(texto), 2))
    return _build(builder, tmp_path, doc_texto=texto, cons=cons)


def test_camino_completo(builder, tmp_path):
    red, info = _camino_fixture(builder, tmp_path)
    cam = red['caminos_demo'][0]
    assert cam['ids'] == [DOC, DOC + '#cons01', 'res:SMA:72/2018',
                          INST + ':art:0005', DOC + '#cons02']
    assert cam['relajacion'] == 'completo'
    assert cam['links'][1].endswith('|revisa')
    assert 'LOSMA' not in cam['titulo']
    assert cam['titulo'].startswith('Res. N° 72/2018 · SMA')
    assert info['conteos']['camino_relajacion_completo'] == 1


def test_camino_relaja_menciona(builder, tmp_path):
    red, info = _camino_fixture(builder, tmp_path, revisa=False)
    cam = red['caminos_demo'][0]
    assert cam['ids'][2] == 'res:SMA:72/2018'
    assert cam['links'][1].endswith('|menciona')
    assert cam['relajacion'] == 'menciona'
    assert info['conteos']['camino_relajacion_menciona'] == 1


def test_camino_sin_u2(builder, tmp_path):
    red, info = _camino_fixture(builder, tmp_path, con_u2=False)
    cam = red['caminos_demo'][0]
    assert len(cam['ids']) == 4 and cam['relajacion'] == 'sin_u2'
    assert info['conteos']['camino_relajacion_sin_u2'] == 1


def test_camino_determinista(builder, tmp_path):
    _camino_fixture(builder, tmp_path / 'a')
    _camino_fixture(builder, tmp_path / 'b')
    red_a = json.loads((tmp_path / 'a' / 'out' / 'red.json').read_text())
    red_b = json.loads((tmp_path / 'b' / 'out' / 'red.json').read_text())
    assert red_a['caminos_demo'] == red_b['caminos_demo']


def test_camino_global_y_local_misma_resolucion(builder, tmp_path):
    """Una global y su local con igual num/año cuentan como una sola."""
    texto = ('Se reclamaron en contra de la Resolución Exenta N° 72/2018 '
             'de la SMA y se aplicó el artículo 5 de la Ley 19.300. '
             'Otra Resolución N° 72/2018 sin organismo también apareció.')
    red, _ = _build(builder, tmp_path, doc_texto=texto)
    rids = {cam['ids'][2] for cam in red['caminos_demo']}
    assert len(rids) == len(red['caminos_demo']) == 1


def test_aplica_a_ley_descartada(builder, tmp_path):
    """Un 'aplica' cuya cita cayó a nivel ley no produce arista; se cuenta."""
    texto = ('La Resolución Exenta N° 72/2018 de la SMA aplicó el '
             'artículo 99 de la Ley 19.300.')
    red, info = _build(builder, tmp_path, doc_texto=texto)
    assert not _links(red, 'aplica')
    assert info['conteos']['aplica_a_ley_descartadas'] >= 1


def test_rotulos_norma(builder):
    assert builder.rotulo_articulo('cl.norma.ley_19300:art:0012bis') == \
        'Ley 19.300 art. 12 bis'
    assert builder.rotulo_articulo('cl.norma.ley_20417:art:0041') == \
        'LOSMA art. 41'
    assert builder.rotulo_articulo('cl.norma.ds_40_2012:art:0003') == \
        'RSEIA (DS 40/2012) art. 3'
    assert builder.rotulo_articulo('cl.norma.ley_20600:art:0008') == \
        'Ley 20.600 art. 8'
    assert builder.rotulo_articulo('cl.norma.ley_20417:art:0003:3d6cf80',
                                   'Artículo tercero.- Modifícase') == \
        'Ley 20.417 art. tercero'
    assert builder.rotulo_articulo('cl.norma.ley_20417:art:0009:abcdef1',
                                   'Otra cosa') == 'Ley 20.417 art. 9'
    assert builder.rotulo_articulo('cl.norma.ley_19300:art:0018qua') == \
        'Ley 19.300 art. 18 quáter' 
