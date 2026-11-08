"""Driver del panel (scripts/panel.py): NIF y grafo personal en entorno aislado.

Corre el script como subproceso con HOME/DIKE_* redirigidos a tmp_path, sin
tocar el plugin-data real ni el corpus sellado. El corpus (grafo corpus*) no
se prueba aquí: exige la generación instalada y ya está cubierto por el e2e
real del adaptador.
"""
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).parents[1]
PANEL = ROOT / 'scripts' / 'panel.py'


@pytest.fixture(scope='module')
def panel_mod():
    """scripts/panel.py como módulo, para probar las funciones puras."""
    import importlib.util
    spec = importlib.util.spec_from_file_location('dike_panel_mod', PANEL)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


@pytest.fixture()
def panel(tmp_path):
    """Corre scripts/panel.py con el workspace NIF/GRE aislado en tmp_path."""
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

    def run(*args):
        proc = subprocess.run(
            [sys.executable, str(PANEL), *args],
            env=env, capture_output=True, text=True, timeout=120)
        assert proc.returncode in (0, 2), proc.stderr
        out = proc.stdout.strip()
        assert out, proc.stderr
        return json.loads(out)

    return run


def test_nif_init_list_snapshot_roundtrip(panel):
    creado = panel('nif', 'init', 'caso-1', '¿Procede el despido?')
    assert creado.get('success') is True, creado

    casos = panel('nif', 'list')
    assert any(c.get('case_id') == 'caso-1' for c in casos['cases'])

    snap = panel('nif', 'snapshot', 'caso-1')
    assert snap['snapshot']['exists'] is True
    assert snap['snapshot']['nif']['legal_question'] == '¿Procede el despido?'
    assert 'patches' in snap


def test_nif_seed_demo(panel):
    out = panel('nif', 'seed', 'demo-1')
    assert out.get('success') is True, out
    snap = panel('nif', 'snapshot', 'demo-1')
    nif = snap['snapshot']['nif']
    assert nif['legal_question']
    assert nif['subjects'] and nif['norms']


def test_nif_edit_validate_confidence(panel):
    panel('nif', 'init', 'caso-2', 'Pregunta de prueba')
    edit = panel('nif', 'edit', 'caso-2', 'facts.known', '"El trabajador fue despedido"')
    assert edit.get('success') is True, edit
    val = panel('nif', 'validate', 'caso-2', '1')
    assert val.get('success') is True, val
    conf = panel('nif', 'confidence', 'caso-2', '0.7')
    assert conf.get('success') is True, conf
    snap = panel('nif', 'snapshot', 'caso-2')
    nif = snap['snapshot']['nif']
    assert 'despedido' in json.dumps(nif['facts']['known'], ensure_ascii=False)
    assert nif['validated_by_human'] is True
    assert nif['confidence'] == 0.7
    assert snap['snapshot']['version'] >= 4


def test_nif_edit_json_invalido(panel):
    panel('nif', 'init', 'caso-3', 'Pregunta')
    out = panel('nif', 'edit', 'caso-3', 'facts.known', '{no-json')
    assert 'error' in out


def test_nif_case_id_invalido(panel):
    for op_args in (
        ('nif', 'init', '../escape', 'pregunta'),
        ('nif', 'snapshot', 'a/b'),
        ('nif', 'edit', 'x;rm', 'facts.known', '"v"'),
    ):
        out = panel(*op_args)
        assert 'error' in out


def test_nif_gap_llena_hueco(panel):
    panel('nif', 'seed', 'demo-gap')
    snap = panel('nif', 'snapshot', 'demo-gap')
    gaps = snap['snapshot']['nif'].get('gaps') or []
    abiertos = [i for i, g in enumerate(gaps) if g.get('status') != 'filled']
    if not abiertos:
        pytest.skip('el seed no dejó huecos abiertos')
    out = panel('nif', 'gap', 'demo-gap', str(abiertos[0]), 'abogado', 'certificado de despido')
    assert out.get('success') is True, out
    snap2 = panel('nif', 'snapshot', 'demo-gap')
    llenos = [g for g in snap2['snapshot']['nif']['gaps'] if g.get('status') == 'filled']
    assert llenos


def test_nif_operacion_desconocida(panel):
    out = panel('nif', 'volar')
    assert 'error' in out


def test_grafo_personal_vacio_honesto(panel):
    out = panel('grafo', 'personal')
    assert out == {'candidates': [], 'edges': []} or (
        'candidates' in out and 'edges' in out)


def test_grafo_corpus_sin_instalado(panel):
    """Sin corpus instalado el panel no inventa normas."""
    out = panel('grafo', 'corpus')
    assert out.get('packs') == []


def test_grafo_red_minicorpus(panel, tmp_path):
    """grafo red emite la red completa en una lectura: instrumento → artículos."""
    current = tmp_path / 'users' / 'test' / 'starter' / 'mini' / 'current'
    (current / 'normas').mkdir(parents=True)
    (current / 'articulos').mkdir(parents=True)
    (current / 'normas' / 'norma_207436.json').write_text(json.dumps({
        '@id': 'https://dike.invalid/eli/cl/codigo/codigo-del-trabajo',
        'leychileCode': '207436',
        'eli': {'type': 'codigo', 'number': 'codigo-del-trabajo'},
        'title': 'FIJA EL TEXTO DEL CODIGO DEL TRABAJO',
        'sourceDocumentUrl': 'https://x/ct',
    }), encoding='utf-8')
    for art in ('0161', '0168'):
        (current / 'articulos' / f'articulo_207436_art_{art}.json').write_text(json.dumps({
            '@id': f'https://dike.invalid/eli/cl/codigo/codigo-del-trabajo/art_{art}',
            'eId': f'art_{art}', 'label': str(int(art)),
            'textSha256': 'a' * 64,
            'provenance': {'wasDerivedFrom': 'https://x/ct/' + art},
        }), encoding='utf-8')

    out = panel('grafo', 'red')
    assert out['conteos'] == {'nodes': 3, 'links': 2}
    assert out['truncado'] is False
    ids = {n['id'] for n in out['nodes']}
    assert len(ids) == 3
    for link in out['links']:
        assert link['tipo'] == 'contiene'
        assert link['estado'] == 'verificada_estructura'
        assert link['source'] in ids and link['target'] in ids
    inst = next(n for n in out['nodes'] if n['tipo'] == 'instrumento')
    assert inst['label'] == 'Código del Trabajo'
    arts = [n for n in out['nodes'] if n['tipo'] == 'articulo']
    assert {a['label'] for a in arts} == {
        'Código del Trabajo, art. 161', 'Código del Trabajo, art. 168'}
    assert all(a['instrumento'] == 'n:207436' for a in arts)
    assert all('sha256' not in a and a['n_unidades'] == 0 for a in arts)


def test_grafo_red_sin_instalado(panel):
    out = panel('grafo', 'red')
    assert out['nodes'] == [] and out['links'] == []
    assert out['conteos'] == {'nodes': 0, 'links': 0}


def test_sin_args(panel):
    out = panel('nif')
    assert 'error' in out
    out = panel('grafo')
    assert 'error' in out


# ---------------------------------------------------------------------------
# Unidades mínimas y modalidad deóntica (cadenas sintéticas, no texto del corpus)
# ---------------------------------------------------------------------------

@pytest.mark.parametrize('linea,esperado,regla', [
    ('No obstante lo anterior, sigue igual.', 'excepcion', 'R-EXC'),
    ('Sin perjuicio de lo dispuesto antes.', 'excepcion', 'R-EXC'),
    ('Se prohíbe estacionar en esta vía.', 'prohibicion', 'R-PRO'),
    ('En ningún caso procede la acción.', 'prohibicion', 'R-PRO'),
    ('Será sancionado con multa de 5 UTM.', 'sancion', 'R-SAN'),
    ('La pena de presidio aplica.', 'sancion', 'R-SAN'),
    ('El empleador deberá pagar la indemnización.', 'obligacion', 'R-OBL'),
    ('Estará obligado a informar mensualmente.', 'obligacion', 'R-OBL'),
    ('Corresponderá al director decidir.', 'potestad', 'R-POT'),
    ('El juez podrá decretar la medida.', 'permiso', 'R-PER'),
    ('Se permite la representación de apoderados.', 'permiso', 'R-PER'),
    ('Se entenderá por empleador la persona natural.', 'definicion', 'R-DEF'),
])
def test_modalidad_reglas(panel_mod, linea, esperado, regla):
    assert panel_mod._modalidad(linea) == (esperado, regla)


def test_modalidad_precedencia_prohibicion(panel_mod):
    """'no podrá ... deberá' es prohibición: R-PRO precede a R-OBL."""
    assert panel_mod._modalidad(
        'El demandado no podrá disponer bienes y deberá informar.') == (
        'prohibicion', 'R-PRO')


def test_modalidad_otra(panel_mod):
    assert panel_mod._modalidad('El contrato se celebra por escrito.') == ('otra', None)


def test_unidades_offsets_y_etiquetas(panel_mod):
    texto = ('Primera línea del artículo.\n'
             '\n'
             'a) una letra.\n'
             '3. un número.\n'
             'N° 4 otro número.\n'
             '   inciso sangrado   \n')
    us = panel_mod._unidades(texto)
    assert [u['etiqueta'] for u in us] == [
        'inciso 1', 'letra a)', 'número 3', 'número 4', 'inciso 2']
    for u in us:
        assert texto[u['char_start']:u['char_end']] == u['texto']
    assert us[4]['texto'] == 'inciso sangrado'


def test_grafo_red_es_delgada(panel, tmp_path):
    """La red no emite unidades ni excepciona: artículos con n_unidades, ids cortos."""
    current = tmp_path / 'users' / 'test' / 'starter' / 'mini' / 'current'
    (current / 'normas').mkdir(parents=True)
    (current / 'articulos').mkdir(parents=True)
    aid = 'https://dike.invalid/eli/cl/ley/1/2020'
    (current / 'normas' / 'norma_1.json').write_text(json.dumps({
        '@id': aid, 'leychileCode': '1',
        'eli': {'type': 'ley', 'number': '1'}, 'title': 'LEY UNO',
        'sourceDocumentUrl': 'https://x/norma',
    }), encoding='utf-8')
    for eid, texto in (
        ('art_0001', 'Una línea.\nNo obstante lo anterior, otra cosa.'),
        ('art_0002', 'Línea única.'),
    ):
        (current / 'articulos' / f'articulo_1_{eid}.json').write_text(json.dumps({
            '@id': aid + '/' + eid, 'eId': eid, 'label': eid,
            'text': texto, 'textSha256': 'b' * 64,
        }), encoding='utf-8')
    out = panel('grafo', 'red')
    insts = [n for n in out['nodes'] if n['tipo'] == 'instrumento']
    arts = [n for n in out['nodes'] if n['tipo'] == 'articulo']
    assert not [n for n in out['nodes'] if n['tipo'] == 'unidad']
    assert not [l for l in out['links'] if l['tipo'] == 'excepciona']
    assert set(insts[0]) == {'id', 'tipo', 'label', 'n_articulos'}
    assert insts[0]['n_articulos'] == 2
    assert set(arts[0]) == {'id', 'tipo', 'label', 'instrumento', 'n_unidades'}
    assert arts[0]['instrumento'] == 'n:1'  # id del instrumento, no el nombre
    assert arts[0]['id'].startswith('a:1:')
    assert sorted(a['n_unidades'] for a in arts) == [1, 2]
    for l in out['links']:
        assert set(l) == {'source', 'target', 'tipo', 'estado'}
    ids = {n['id'] for n in out['nodes']}
    assert all(l['source'] in ids and l['target'] in ids for l in out['links'])


def test_grafo_red_presupuesto_bytes(panel, tmp_path):
    """Cada nodo-artículo aporta <200 B al payload: ~1,7 MB para 8.544."""
    current = tmp_path / 'users' / 'test' / 'starter' / 'mini' / 'current'
    (current / 'normas').mkdir(parents=True)
    (current / 'articulos').mkdir(parents=True)
    aid = 'https://dike.invalid/eli/cl/ley/9/2020'
    (current / 'normas' / 'norma_9.json').write_text(json.dumps({
        '@id': aid, 'leychileCode': '9',
        'eli': {'type': 'ley', 'number': '9'}, 'title': 'LEY NUEVE',
        'sourceDocumentUrl': 'https://x/norma', 'sha256': 'x' * 64,
    }), encoding='utf-8')
    for i in range(10):
        (current / 'articulos' / f'articulo_9_art_{i:04d}.json').write_text(json.dumps({
            '@id': f'{aid}/art_{i:04d}', 'eId': f'art_{i:04d}', 'label': str(i + 1),
            'text': 'línea uno\nlínea dos', 'textSha256': 'c' * 64,
            'provenance': {'wasDerivedFrom': 'https://x/art'},
        }), encoding='utf-8')
    out = panel('grafo', 'red')
    arts = [n for n in out['nodes'] if n['tipo'] == 'articulo']
    links = [l for l in out['links'] if l['tipo'] == 'contiene']
    bytes_art = sum(len(json.dumps(n, ensure_ascii=False)) for n in arts)
    assert bytes_art / len(arts) < 200


def test_grafo_unidades_forma_y_excepciona(panel, tmp_path):
    """grafo unidades: mismos nodos unidad que antes emitía la red completa."""
    current = tmp_path / 'users' / 'test' / 'starter' / 'mini' / 'current'
    (current / 'normas').mkdir(parents=True)
    (current / 'articulos').mkdir(parents=True)
    aid = 'https://dike.invalid/eli/cl/ley/1/2020'
    (current / 'normas' / 'norma_1.json').write_text(json.dumps({
        '@id': aid, 'leychileCode': '1',
        'eli': {'type': 'ley', 'number': '1'}, 'title': 'LEY UNO',
    }), encoding='utf-8')
    (current / 'articulos' / 'articulo_1_art_0001.json').write_text(json.dumps({
        '@id': aid + '/art_0001', 'eId': 'art_0001', 'label': '1',
        'text': 'Regla general del artículo.\nNo obstante lo anterior, otra cosa.',
        'textSha256': 'b' * 64,
    }), encoding='utf-8')
    out = panel('grafo', 'unidades', 'a:1:art_0001')
    unidades = out['nodes']
    assert len(unidades) == 2
    for u in unidades:
        assert u['clase'] == 'normativa'
        assert u['modalidad_estado'] == 'candidata'
        assert u['articulo'] == 'a:1:art_0001'
        assert u['id'].startswith('a:1:art_0001#u')
    assert unidades[1]['modalidad'] == 'excepcion'
    ids = {n['id'] for n in unidades}
    for l in out['links']:
        assert l['source'] in ids or l['source'] == 'a:1:art_0001'
        assert l['target'] in ids or l['target'] == 'a:1:art_0001'
    exc = [l for l in out['links'] if l['tipo'] == 'excepciona']
    assert len(exc) == 1 and exc[0]['estado'] == 'candidata'
    assert exc[0]['source'] == unidades[1]['id']
    assert exc[0]['target'] == unidades[0]['id']


def test_grafo_nodo_instrumento_y_articulo(panel, tmp_path):
    """grafo nodo: ficha con url, sha256, conteos y vigencia."""
    current = tmp_path / 'users' / 'test' / 'starter' / 'mini' / 'current'
    (current / 'normas').mkdir(parents=True)
    (current / 'articulos').mkdir(parents=True)
    aid = 'https://dike.invalid/eli/cl/ley/5/2020'
    (current / 'normas' / 'norma_5.json').write_text(json.dumps({
        '@id': aid, 'leychileCode': '5',
        'eli': {'type': 'ley', 'number': '5'}, 'title': 'LEY CINCO',
        'sourceDocumentUrl': 'https://x/ley5',
        'temporal': {'status': 'vigente', 'from': '2020-01-01'},
    }), encoding='utf-8')
    (current / 'articulos' / 'articulo_5_art_0001.json').write_text(json.dumps({
        '@id': aid + '/art_0001', 'eId': 'art_0001', 'label': '1',
        'text': 'una\ndos\ntres', 'textSha256': 'd' * 64,
        'temporal': {'status': 'vigente', 'from': '2020-01-01'},
    }), encoding='utf-8')
    ni = panel('grafo', 'nodo', 'n:5')
    assert ni['tipo'] == 'instrumento' and ni['n_articulos'] == 1
    assert ni['url'] == 'https://x/ley5' and len(ni['sha256']) == 64
    assert ni['vigencia']['estado'] == 'vigente'
    na = panel('grafo', 'nodo', 'a:5:art_0001')
    assert na['tipo'] == 'articulo' and na['n_unidades'] == 3
    assert na['sha256'] == 'd' * 64
    falta = panel('grafo', 'nodo', 'n:99')
    assert 'error' in falta


def test_grafo_unidades_sin_excepciona_en_primera(panel, tmp_path):
    """Un R-EXC como primera unidad no emite excepciona (no hay anterior)."""
    current = tmp_path / 'users' / 'test' / 'starter' / 'mini' / 'current'
    (current / 'normas').mkdir(parents=True)
    (current / 'articulos').mkdir(parents=True)
    aid = 'https://dike.invalid/eli/cl/ley/2/2020'
    (current / 'normas' / 'norma_2.json').write_text(json.dumps({
        '@id': aid, 'leychileCode': '2',
        'eli': {'type': 'ley', 'number': '2'}, 'title': 'LEY DOS',
    }), encoding='utf-8')
    (current / 'articulos' / 'articulo_2_art_0001.json').write_text(json.dumps({
        '@id': aid + '/art_0001', 'eId': 'art_0001', 'label': '1',
        'text': 'Salvo pacto en contrario, el plazo es de un año.',
    }), encoding='utf-8')
    out = panel('grafo', 'unidades', 'a:2:art_0001')
    assert not [l for l in out['links'] if l['tipo'] == 'excepciona']


def test_grafo_unidad_texto_y_offsets(panel, tmp_path):
    """grafo unidad devuelve el texto exacto y el sha256 de la unidad."""
    import hashlib
    current = tmp_path / 'users' / 'test' / 'starter' / 'mini' / 'current'
    (current / 'normas').mkdir(parents=True)
    (current / 'articulos').mkdir(parents=True)
    aid = 'https://dike.invalid/eli/cl/ley/3/2020'
    (current / 'normas' / 'norma_3.json').write_text(json.dumps({
        '@id': aid, 'leychileCode': '3',
        'eli': {'type': 'ley', 'number': '3'}, 'title': 'LEY TRES',
    }), encoding='utf-8')
    texto = 'Primera regla.\n  Segunda regla con sangría.  '
    (current / 'articulos' / 'articulo_3_art_0001.json').write_text(json.dumps({
        '@id': aid + '/art_0001', 'eId': 'art_0001', 'label': '1',
        'text': texto, 'textSha256': 'c' * 64,
        'provenance': {'wasDerivedFrom': 'https://x/art'},
    }), encoding='utf-8')
    out = panel('grafo', 'unidad', 'a:3:art_0001#u02')
    assert out['texto'] == 'Segunda regla con sangría.'
    assert texto[out['char_start']:out['char_end']] == out['texto']
    assert out['articulo'] == 'a:3:art_0001'
    assert out['articulo_url'] == 'https://x/art'
    assert out['articulo_sha256'] == 'c' * 64
    assert out['sha256'] == hashlib.sha256(
        'Segunda regla con sangría.'.encode('utf-8')).hexdigest()
    fuera = panel('grafo', 'unidad', 'a:3:art_0001#u09')
    assert 'error' in fuera
