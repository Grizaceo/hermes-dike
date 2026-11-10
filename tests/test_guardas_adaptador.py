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
def m(tmp_path_factory):
    spec = importlib.util.spec_from_file_location('dike_guardas', ROOT / '__init__.py')
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    datos = tmp_path_factory.mktemp('guardas-data')
    mod._carpeta_de_datos = lambda: datos  # nunca la carpeta de datos real
    return mod


def _motivo(m, args):
    with pytest.raises(m.EntradaInvalida) as info:
        m._texto_input(args)
    return info.value.codigo


@pytest.mark.parametrize('texto', [
    'artículo 16\x001 del Código del Trabajo',
    'artículo 161\x01 del Código del Trabajo',
    'artículo 161 del Código\x1b del Trabajo',
    'artículo 161 del Código del Trabajo\x7f',
])
def test_controles_invisibles_se_rechazan(m, texto):
    """«artículo 16\\x001» se veía como 161 y el motor certificaba el 16."""
    assert _motivo(m, {'texto': texto}) == 'INPUT_CONTROL'


def test_controles_en_archivo_se_rechazan(m, tmp_path):
    archivo = tmp_path / 'escrito.md'
    archivo.write_bytes('artículo 16\x001 del Código del Trabajo'.encode('utf-8'))
    assert _motivo(m, {'ruta': str(archivo)}) == 'INPUT_CONTROL'


def test_espacios_y_saltos_siguen_aceptados(m):
    texto = 'artículo 161\tdel Código del Trabajo\r\n\x0bart. 162\x0cdel Código del Trabajo'
    assert m._texto_input({'texto': texto}) == texto


def test_sustituto_suelto_es_error_de_codificacion(m):
    assert _motivo(m, {'texto': 'artículo \ud800 del Código del Trabajo'}) == 'INPUT_ENCODING'
    salida = json.loads(m.verificar_citas({'texto': 'artículo \ud800 del Código del Trabajo'}))
    assert salida['error_code'] == 'INPUT_ERROR' and salida['motivo'] == 'INPUT_ENCODING'


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
    assert m._t('guard.problem') in out['problemas']


def test_mismo_cuerpo_en_dos_lineas_sigue_verificada(m):
    c = _constancia([_verificada('Código del Trabajo\nartículo 162 del Código del Trabajo',
                                 'cl.norma.ct:art:0162')])
    out = m._salida_publica(m._degradar_cuerpos_en_conflicto(c))
    assert out['veredicto'] == 'TODAS_VERIFICADAS'
    assert out['detalles'][0]['estado'] == 'VERIFICADA'
    assert 'motivo_adaptador' not in out['detalles'][0]


def _sin_citas(no_verificadas):
    return {
        'veredicto': 'SIN_CITAS', 'detalles': [], 'mensaje': 'sin citas',
        'citation_disclosure': {'verificadas': [], 'no_verificadas': no_verificadas, 'advertencias': []},
        'meta': {'as_of': '2026-11-09', 'fecha_constancia': '2026-11-09T15:00:00+00:00',
                 'pack_hash': 'af1422d66d1e6eee'},
    }


def test_mencion_enorme_no_vuelve_entera(m):
    """«Ley » + 399.996 dígitos volvía entera, dos veces: 801.650 bytes de JSON."""
    out = m._salida_publica(_sin_citas(['Ley ' + '1' * 399996]))
    crudo = json.dumps(out, ensure_ascii=False)
    assert len(crudo.encode('utf-8')) < 5000
    assert out['no_verificadas'][0].endswith(m._t('limit.characters', count=399700))
    assert out['citation_disclosure']['no_verificadas'] == out['no_verificadas']
    assert out['todo_verificado'] is False


def test_muchas_menciones_se_resumen(m):
    out = m._salida_publica(_sin_citas([f'Ley {n}' for n in range(1000)]))
    assert len(out['no_verificadas']) == 201
    assert out['no_verificadas'][-1] == m._t('limit.more', count=800)
    assert out['todo_verificado'] is False


def test_redaccion_limpia_rutas_que_siguen_a_una_url(m):
    """Un string que empezaba con URL se saltaba entero y conservaba rutas locales."""
    c = _sin_citas([])
    c['mensaje'] = 'https://ejemplo.cl/a /home/usuario/secreto C:\\x\\y'
    out = m._salida_publica(c)
    assert out['mensaje_motor'] == 'https://ejemplo.cl/a <ruta-local> <ruta-local>'
    detalle = _verificada('artículo 161 del Código del Trabajo', 'cl.norma.ct:art:0161')
    out = m._salida_publica(_constancia([detalle]))
    assert out['detalles'][0]['fuente_url'] == detalle['fuente_url']


@pytest.mark.parametrize('campo, valor', [
    ('gid', 'inventado'), ('gid', 'cl.norma.ct:art:0161 y algo más'), ('fuente_url', 'inventado'),
])
def test_evidencia_con_forma_invalida_no_pasa_el_contrato(m, campo, valor):
    detalle = _verificada('artículo 161 del Código del Trabajo', 'cl.norma.ct:art:0161')
    detalle[campo] = valor
    with pytest.raises(ValueError):
        m._validar_constancia(_constancia([detalle]), 0, as_of='2026-11-09')


def test_evidencia_valida_pasa_el_contrato(m):
    detalles = [_verificada('artículo 161 del Código del Trabajo', 'cl.norma.ct:art:0161'),
                _verificada('artículo 1° bis del Código Civil', 'cl.norma.cc:art:0001_bis')]
    assert m._validar_constancia(_constancia(detalles), 0, as_of='2026-11-09')


def test_degradar_quita_el_articulo_de_la_lista_de_verificadas(m):
    c = _constancia([_verificada('Código del Trabajo\nartículo 161 del Código Civil', 'cl.norma.ct:art:0161')])
    out = m._salida_publica(m._degradar_cuerpos_en_conflicto(c))
    assert out['citation_disclosure']['verificadas'] == []
    assert out['veredicto'] == 'CON_PROBLEMAS'
