"""Rutas /escrito del Case Writer: persistencia por caso con rev optimista."""
import importlib.util
import json
import stat
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).parents[1]
DASH = ROOT / 'dashboard'


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


@pytest.fixture
def datos(api, monkeypatch, tmp_path):
    """Adaptador falso: _carpeta_de_datos → tmp_path (HERMES_HOME temporal)."""
    mod = type('M', (), {
        '_carpeta_de_datos': staticmethod(lambda: tmp_path),
        '_LIMITE_TEXTO': 400_000,
    })()
    monkeypatch.setattr(api, '_adaptador', lambda: mod)
    return tmp_path


def test_escrito_en_las_rutas(api):
    rutas = {r.path for r in api.router.routes}
    assert '/escrito' in rutas
    metodos = {m for r in api.router.routes if r.path == '/escrito' for m in r.methods}
    assert {'GET', 'POST'} <= metodos


def test_escrito_inexistente(api, datos):
    out = api.escrito_obtener('borrador')
    assert out['existe'] is False
    assert out['rev'] == 0
    assert out['case_id'] == 'borrador'
    assert not (datos / 'escritos').exists()


def test_escrito_guardar_y_leer(api, datos):
    r = api.escrito_guardar({'case_id': 'c1', 'html': '<p>hola</p>',
                             'texto': 'hola', 'rev_base': 0,
                             'registro': {'retiros': []}})
    assert r['rev'] == 1 and r['actualizado']
    out = api.escrito_obtener('c1')
    assert out['existe'] is True
    assert out['rev'] == 1
    assert out['html'] == '<p>hola</p>'
    assert out['texto'] == 'hola'
    assert out['registro'] == {'retiros': []}
    data = json.loads((datos / 'escritos' / 'c1.json').read_text())
    assert data['rev'] == 1 and data['case_id'] == 'c1'


def test_escrito_rev_incrementa(api, datos):
    api.escrito_guardar({'case_id': 'c1', 'html': 'a', 'texto': 'a', 'rev_base': 0})
    r = api.escrito_guardar({'case_id': 'c1', 'html': 'b', 'texto': 'b', 'rev_base': 1})
    assert r['rev'] == 2
    assert api.escrito_obtener('c1')['html'] == 'b'


def test_escrito_conflicto_409(api, datos):
    from fastapi import HTTPException
    api.escrito_guardar({'case_id': 'c1', 'html': 'a', 'texto': 'a', 'rev_base': 0})
    with pytest.raises(HTTPException) as exc:
        api.escrito_guardar({'case_id': 'c1', 'html': 'x', 'texto': 'x', 'rev_base': 0})
    assert exc.value.status_code == 409
    assert exc.value.detail['rev_actual'] == 1
    # no sobrescribe: el guardado con rev_base correcto sí pasa
    r = api.escrito_guardar({'case_id': 'c1', 'html': 'x', 'texto': 'x', 'rev_base': 1})
    assert r['rev'] == 2


def test_escrito_case_id_invalido(api, datos):
    from fastapi import HTTPException
    for malo in ('../x', 'a/b', '', 'x;y', 'a b'):
        with pytest.raises(HTTPException) as exc:
            api.escrito_obtener(malo)
        assert exc.value.status_code == 400
        with pytest.raises(HTTPException) as exc:
            api.escrito_guardar({'case_id': malo, 'html': '', 'texto': '', 'rev_base': 0})
        assert exc.value.status_code == 400


def test_escrito_campos_obligatorios(api, datos):
    from fastapi import HTTPException
    for cuerpo in (
        {'case_id': 'c1', 'texto': 'x', 'rev_base': 0},                # sin html
        {'case_id': 'c1', 'html': '', 'rev_base': 0},                  # sin texto
        {'case_id': 'c1', 'html': '', 'texto': 'x'},                   # sin rev_base
        {'case_id': 'c1', 'html': '', 'texto': 'x', 'rev_base': '0'},  # rev str
        {'case_id': 'c1', 'html': '', 'texto': 'x', 'rev_base': -1},
        {'case_id': 'c1', 'html': '', 'texto': 'x', 'rev_base': True},
        {'case_id': 'c1', 'html': '', 'texto': 'x', 'rev_base': 0, 'registro': []},
    ):
        with pytest.raises(HTTPException) as exc:
            api.escrito_guardar(cuerpo)
        assert exc.value.status_code == 400, cuerpo


def test_escrito_limites_de_tamano(api, datos):
    from fastapi import HTTPException
    base = {'case_id': 'c1', 'html': '', 'texto': 'x', 'rev_base': 0}
    with pytest.raises(HTTPException):
        api.escrito_guardar({**base, 'texto': 'x' * 400_001})
    with pytest.raises(HTTPException):
        api.escrito_guardar({**base, 'html': 'x' * 2_000_001})
    with pytest.raises(HTTPException):
        api.escrito_guardar({**base, 'registro': {'relleno': 'x' * 200_000}})


def test_escrito_permisos(api, datos):
    api.escrito_guardar({'case_id': 'c1', 'html': 'a', 'texto': 'a', 'rev_base': 0})
    modo_dir = stat.S_IMODE((datos / 'escritos').stat().st_mode)
    modo_file = stat.S_IMODE((datos / 'escritos' / 'c1.json').stat().st_mode)
    assert modo_dir == 0o700
    assert modo_file == 0o600
    # la escritura es atómica: no quedan .tmp
    assert not list((datos / 'escritos').glob('*.tmp'))


def test_escrito_doble_post_mismo_rev_base(api, datos):
    """Dos guardados con el mismo rev_base: uno gana, el otro sale 409."""
    from fastapi import HTTPException
    api.escrito_guardar({'case_id': 'c1', 'html': 'a', 'texto': 'a', 'rev_base': 0})
    resultados = []
    errores = []
    import threading as _th

    def intento(html):
        try:
            resultados.append(api.escrito_guardar(
                {'case_id': 'c1', 'html': html, 'texto': html, 'rev_base': 1}))
        except HTTPException as e:
            errores.append(e)

    hilos = [_th.Thread(target=intento, args=(h,)) for h in ('x', 'y')]
    for t in hilos:
        t.start()
    for t in hilos:
        t.join()
    assert len(resultados) == 1 and resultados[0]['rev'] == 2
    assert len(errores) == 1 and errores[0].status_code == 409
    assert api.escrito_obtener('c1')['rev'] == 2


def test_escrito_registro_persiste(api, datos):
    reg = {'retiros': [{'cita_raw': 'art. 161', 'motivo': 'm', 'fecha': 'f'}],
           'escaladas': [{'cita_raw': 'art. 1', 'nota': 'n', 'fecha': 'f'}]}
    api.escrito_guardar({'case_id': 'c1', 'html': '', 'texto': '', 'rev_base': 0,
                         'registro': reg})
    assert api.escrito_obtener('c1')['registro'] == reg


def test_escrito_registro_pistas(api, datos):
    """registro.pistas (citas traídas desde la búsqueda) persiste tal cual:
    /escrito acepta el registro como dict libre, sin esquema cerrado."""
    pista = {'cita': 'artículo 161 del Código del Trabajo',
             'gid': 'cl.norma.ct:art:0161',
             'nodo_id': 'a:207436:art_0161',
             'fecha': '2026-11-08T00:00:00Z', 'origen': 'busqueda'}
    reg = {'pistas': [pista]}
    api.escrito_guardar({'case_id': 'c1', 'html': '', 'texto': '', 'rev_base': 0,
                         'registro': reg})
    assert api.escrito_obtener('c1')['registro'] == reg


def test_escrito_demo_y_pizarra(api, datos):
    demo = api.escrito_demo()
    assert 'artículo 161 del Código del Trabajo' in demo['texto']
    assert '<p>' in demo['html']
    reg = {'pizarra': {'nodos': [{'id': 'n1', 'titulo': 'Hechos', 'texto': 'x'}],
                       'aristas': [], 'colapsada': False, 'altura': 220}}
    api.escrito_guardar({'case_id': 'c1', 'html': demo['html'], 'texto': demo['texto'],
                         'rev_base': 0, 'registro': reg})
    assert api.escrito_obtener('c1')['registro']['pizarra']['nodos'][0]['titulo'] == 'Hechos'


def test_estilo_analizar_escribe_claro(api, datos):
    texto = (
        "PRIMERO.- Consta que el trabajador fue notificado de la realización "
        "del despido conforme al artículo 161 del Código del Trabajo.\n\n"
        "SEGUNDO.- A mayor abundamiento, toda vez que no se acompañó en autos "
        "la carta de aviso según el artículo 162 del Código del Trabajo, "
        "por tanto procede acoger la demanda."
    )
    out = api.estilo_analizar({'texto': texto, 'contexto': 'escrito', 'detallado': True})
    assert 0 <= out['score'] <= 100
    stats = out['global_stats']
    assert stats['total_sentences'] >= 2
    assert stats['archaism_count'] >= 2
    assert stats['nominalization_count'] >= 1
    assert any(s['category'] == 'arcaismo' and s.get('replacement') for s in out['suggestions'])
    assert isinstance(out['sentences'], list) and len(out['sentences']) == stats['total_sentences']


def test_estilo_grafo_argumentativo(api, datos):
    texto = (
        "Consta que con fecha 10 de marzo se puso término al contrato.\n\n"
        "El artículo 161 del Código del Trabajo exige necesidades de la empresa.\n\n"
        "Según la prueba documental y la carta de aviso acompañada.\n\n"
        "Por tanto, procede acoger la demanda y condenar al pago."
    )
    g = api.estilo_grafo({'texto': texto})
    assert g['counts']['hecho'] >= 1
    assert g['counts']['norma'] >= 1
    assert g['counts']['prueba'] >= 1
    assert g['counts']['conclusion'] >= 1
    assert g['has_complete_chain'] is True
    assert g['coverage_ratio'] == 1.0


def test_ordenamiento_endpoints(api, datos):
    cat = api.ordenamiento_perfiles()
    jurs = {p['jurisdiccion'] for p in cat['perfiles']}
    assert {'cl', 'xx'} <= jurs
    pl = api.ordenamiento_plantilla({'jur': 'ar'})
    assert pl['ok'] is True and pl['jur'] == 'ar'
    val_pl = api.ordenamiento_validar_perfil({'perfil': pl['perfil']})
    assert val_pl['ok'] is False and val_pl['errores']
    xx = next(p['perfil'] for p in cat['perfiles'] if p['jurisdiccion'] == 'xx')
    val_xx = api.ordenamiento_validar_perfil({'perfil': xx})
    assert val_xx['ok'] is True and val_xx['errores'] == []
    res = api.ordenamiento_construir({
        'perfil': xx,
        'paquete': cat['ejemplo_xx']['paquete'],
        'textos': cat['ejemplo_xx']['textos'],
    })
    assert res['ok'] is True
    assert res['compatibilidad']['nivelAlcanzado'] == 'C1'
    resumen = res['construccion']
    assert resumen['normas'] == 2 and resumen['articulos'] == 5
    assert resumen['ventanasVigencia'] == 7 and resumen['aristas'] == 10
    assert resumen['packId'] == 'https://dike.invalid/packages/xx/v1'
    assert resumen['jurisdiccion'] == 'xx'
    assert len(resumen['manifestCoreSha256']) == 64
    assert all(t['id'] and t['etiqueta'] for p in cat['perfiles'] for t in p['tipos_norma'])


def test_preferencias_usuario(api, datos):
    prefs0 = api.preferencias_obtener()
    assert prefs0['tema_papel'] == 'clasico'
    prefs1 = api.preferencias_guardar({
        'tema_papel': 'sepia',
        'ancho_hoja': 'carta',
        'estrategia_privacidad': 'estricta',
        'mostrar_pizarra': False,
    })
    assert prefs1['tema_papel'] == 'sepia'
    assert prefs1['ancho_hoja'] == 'carta'
    assert prefs1['estrategia_privacidad'] == 'estricta'
    assert prefs1['mostrar_pizarra'] is False
    assert api.preferencias_obtener()['tema_papel'] == 'sepia'



@pytest.mark.parametrize('ruta,body', [
    ('privacidad_decision', {'case_id': 'x', 'valor': 4, 'accion': 'enmascarar'}),
    ('privacidad_detectar', {'texto': 'hola', 'estrategia': []}),
    ('privacidad_envio', {'case_id': 'x', 'sha256': 42}),
    ('privacidad_envio', {'case_id': 'x', 'sha256': 'a' * 64, 'conteos': []}),
    ('preferencias_guardar', {'tema_papel': []}),
    ('preferencias_guardar', {'fuente': '\ud800'}),
    ('prediccion_evento', {'procedencia': []}),
    ('prediccion_evento', {'largo': True}),
    ('nif_edit', {'case_id': 'x', 'field_path': [], 'value': 'x'}),
    ('nif_gap', {'case_id': 'x', 'gap_index': 1.5}),
    ('nif_confianza', {'case_id': 'x', 'confidence': float('nan')}),
    ('escrito_guardar', {'case_id': 'x', 'html': '\ud800', 'texto': '', 'rev_base': 0}),
    ('ordenamiento_plantilla', {'jur': []}),
])
def test_json_con_tipos_incorrectos_responde_400(api, datos, ruta, body):
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as error:
        getattr(api, ruta)(body)
    assert error.value.status_code == 400 and error.value.detail



def test_preferencias_fusiona_dos_guardados_simultaneos(api, datos, monkeypatch):
    import threading
    from concurrent.futures import ThreadPoolExecutor
    lectura = api.preferencias_obtener
    inicio = threading.Barrier(2)
    def leer_bajo_lock():
        assert api._prefs_lock.locked(), 'leyó las preferencias fuera del lock'
        return lectura()
    monkeypatch.setattr(api, 'preferencias_obtener', leer_bajo_lock)
    def guardar(cambio):
        inicio.wait()
        return api.preferencias_guardar(cambio)
    with ThreadPoolExecutor(2) as pool:
        list(pool.map(guardar, [{'tema_papel': 'sepia'}, {'ancho_hoja': 'carta'}]))
    final = lectura()
    assert final['tema_papel'] == 'sepia' and final['ancho_hoja'] == 'carta'



def test_grafo_argumentativo_acota_relaciones_y_declara_recorte(api, datos):
    texto = ('Consta que ocurrió un hecho.\n' * 200
             + 'Por tanto, solicito resolver.\n' * 200)
    grafo = api.estilo_grafo({'texto': texto})
    assert grafo['truncado'] and grafo['relaciones_omitidas'] > 39_000
    assert len(grafo['edges']) <= 9 * len(grafo['nodes'])
    assert any('omitidas' in a['message'] for a in grafo['coherence_warnings'])
    indices = {n['id']: n['paragraph_index'] for n in grafo['nodes']}
    assert all(0 < indices[a['target_id']] - indices[a['source_id']] <= 8
               for a in grafo['edges'])
