"""Guardas fail-closed del adaptador sobre la entrada y la salida del motor.

Cada guarda solo puede quitar certificación o rechazar una entrada; nunca
convierte un resultado del motor en un pase.
"""
import importlib.util
import json
from pathlib import Path

import pytest

ROOT = Path(__file__).parents[1]


@pytest.fixture(scope='module')
def m():
    spec = importlib.util.spec_from_file_location('dike_guardas', ROOT / '__init__.py')
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _verificada(cita_raw, gid):
    return {
        'cita_raw': cita_raw, 'gid': gid, 'estado': 'VERIFICADA', 'resolucion': 'RESOLVED',
        'cuerpo': 'Código del Trabajo art. 161', 'texto_hash': '0' * 63 + '1',
        'vigencia': 'IN_FORCE', 'vigencia_legible': 'vigente',
        'fuente_url': 'https://nuevo.leychile.cl/servicios/Navegar/get_norma_json?idNorma=207436',
        'fecha_recuperacion': '2026-08-13T19:48:38Z', 'estado_texto_historico': 'CURRENT_VERSION_APPLIES',
    }


def _constancia(detalles):
    verificadas = sum(d['estado'] == 'VERIFICADA' for d in detalles)
    return {
        'veredicto': 'TODAS_VERIFICADAS' if verificadas == len(detalles) else 'CON_PROBLEMAS',
        'detalles': detalles,
        'citation_disclosure': {'verificadas': ['0161'], 'no_verificadas': [], 'advertencias': []},
        'problemas': [], 'mensaje': 'm', 'alcance': 'a',
        'meta': {'as_of': '2026-11-09', 'fecha_constancia': '2026-11-09T15:00:00+00:00',
                 'pack_hash': 'af1422d66d1e6eee', 'total_citas': len(detalles),
                 'citas_verificadas': verificadas, 'citas_fallidas': len(detalles) - verificadas},
    }


@pytest.mark.parametrize('cita_raw, conflicto', [
    ('Código del Trabajo\nartículo 161 del Código Civil', ('Código del Trabajo', 'Código Civil')),
    ('Ley 19.496\nartículo 3 de la Ley 20.000', ('Ley 19.496', 'Ley 20.000')),
    ('Código de Procedimiento Civil\nart. 254 del Código Procesal Penal',
     ('Código de Procedimiento Civil', 'Código Procesal Penal')),
    ('CÓDIGO DEL TRABAJO\nARTÍCULO 161 DEL CÓDIGO CIVIL', ('CÓDIGO DEL TRABAJO', 'CÓDIGO CIVIL')),
    # Sin conflicto: un solo cuerpo, o el mismo antes y después.
    ('artículo 161 del Código del Trabajo', None),
    ('artículo 162 del Código del Trabajo dispone', None),
    ('Código del Trabajo, artículo 161', None),
    ('Código del Trabajo\nartículo 162 del Código del Trabajo', None),
    ('Ley 19.496\nartículo 3 de la Ley 19.496', None),
    ('artículo 7 del DFL 1 que fija el texto refundido del Código del Trabajo', None),
    ('inciso segundo del artículo 161 del Código del Trabajo', None),
    ('artículos 161 y 162 del Código del Trabajo', None),
])
def test_cuerpos_en_conflicto(m, cita_raw, conflicto):
    assert m._cuerpos_en_conflicto(cita_raw) == conflicto


def test_cita_con_dos_cuerpos_no_queda_verificada(m):
    c = _constancia([
        _verificada('artículo 161 del Código del Trabajo', 'cl.norma.ct:art:0161'),
        _verificada('Código del Trabajo\nartículo 161 del Código Civil', 'cl.norma.ct:art:0161'),
    ])
    out = m._salida_publica(m._degradar_cuerpos_en_conflicto(c))
    primera, segunda = out['detalles']
    assert primera['estado'] == 'VERIFICADA'
    assert segunda['estado'] == 'FALLO' and segunda['resolucion'] == 'AMBIGUOUS'
    assert segunda['gid'] is None and segunda['texto_hash'] is None and segunda['fuente_url'] == ''
    assert 'Código Civil' in segunda['motivo_adaptador']
    assert out['veredicto'] == 'CON_PROBLEMAS'
    assert out['meta']['citas_verificadas'] == 1 and out['meta']['citas_fallidas'] == 1
    assert out['todo_verificado'] is False and out['todas_citas_detectadas_verificadas'] is False
    assert [e['gid'] for e in out['evidencia_temporal']] == ['cl.norma.ct:art:0161']
    assert any('dos cuerpos legales' in p for p in out['problemas'])


def test_mismo_cuerpo_en_dos_lineas_sigue_verificada(m):
    c = _constancia([_verificada('Código del Trabajo\nartículo 162 del Código del Trabajo',
                                 'cl.norma.ct:art:0162')])
    out = m._salida_publica(m._degradar_cuerpos_en_conflicto(c))
    assert out['veredicto'] == 'TODAS_VERIFICADAS'
    assert out['detalles'][0]['estado'] == 'VERIFICADA'
    assert 'motivo_adaptador' not in out['detalles'][0]


def test_degradar_quita_el_articulo_de_la_lista_de_verificadas(m):
    c = _constancia([_verificada('Código del Trabajo\nartículo 161 del Código Civil', 'cl.norma.ct:art:0161')])
    out = m._salida_publica(m._degradar_cuerpos_en_conflicto(c))
    assert out['citation_disclosure']['verificadas'] == []
    assert out['veredicto'] == 'CON_PROBLEMAS'
