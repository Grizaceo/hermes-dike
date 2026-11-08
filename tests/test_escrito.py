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
