"""Idioma de presentación, catálogo completo y medición del motor caliente."""
import ast
import json
from pathlib import Path
from string import Formatter
from types import SimpleNamespace

import pytest
from soporte_adaptador import native, _green_payload
from soporte_textos import cargar

ROOT = Path(__file__).parents[1]


def test_catalogo_paridad_y_uso():
    catalogo = cargar('textos_paridad', 'textos.py').TEXTOS
    assert set(catalogo) == {'en', 'es'}
    assert catalogo['en'].keys() == catalogo['es'].keys()
    formato = Formatter()
    for clave in catalogo['en']:
        campos = lambda idioma: {campo for _, campo, _, _ in formato.parse(catalogo[idioma][clave]) if campo is not None}
        assert campos('en') == campos('es'), clave
    usados = set()
    for archivo in ('__init__.py', 'dashboard/plugin_api.py', 'scripts/panel.py'):
        tree = ast.parse((ROOT / archivo).read_text())
        usados |= {n.value for n in ast.walk(tree) if isinstance(n, ast.Constant) and isinstance(n.value, str)}
        for n in ast.walk(tree):
            if isinstance(n, ast.Call) and (
                    isinstance(n.func, ast.Name) and n.func.id in {'_t', '_fallo', '_detalle'}
                    or isinstance(n.func, ast.Attribute) and n.func.attr == 't'):
                if n.args and isinstance(n.args[0], ast.Constant):
                    assert n.args[0].value in catalogo['en'], (archivo, n.lineno)
    assert not catalogo['en'].keys() - usados


def test_fallback(native, monkeypatch):
    textos = native._textos()
    assert textos.t('missing.key', 'es') == 'missing.key'
    assert textos.t('input.empty', 'unknown') == textos.TEXTOS['en']['input.empty']
    monkeypatch.delitem(textos.TEXTOS['es'], 'input.empty')
    assert textos.t('input.empty', 'es') == textos.TEXTOS['en']['input.empty']


@pytest.mark.parametrize('valor,esperado', [('es', 'es'), ('en', 'en'), ('ES', 'en'), (None, 'en'), (False, 'en')])
def test_idioma_setting(native, monkeypatch, valor, esperado):
    monkeypatch.setattr(native, '_setting', lambda *a: valor)
    assert native._idioma() == esperado


def test_idioma_fallo_es_ingles(native, monkeypatch):
    def falla(*args):
        raise RuntimeError('settings unavailable')
    monkeypatch.setattr(native, '_setting', falla)
    assert native._idioma() == 'en'


@pytest.mark.parametrize('idioma', ['en', 'es'])
def test_motor_y_contrato_se_conservan(native, monkeypatch, idioma):
    monkeypatch.setattr(native, '_setting', lambda clave, default=None: idioma if clave == 'idioma' else default)
    payload = _green_payload()
    salida = native._salida_publica(payload)
    assert salida['mensaje'] == native._t('summary.verified')
    assert salida['mensaje_motor'] == payload['mensaje']
    assert salida['alcance_motor'] == payload['alcance']
    for clave in ('veredicto', 'detalles', 'citation_disclosure', 'problemas'):
        assert salida[clave] == payload[clave]
    assert salida['alcance'] == native._t('scope.verification')
    error = json.loads(native.verificar_citas({'texto': ''}))
    assert error['error_code'] == 'INPUT_ERROR' and error['motivo'] == 'INPUT_EMPTY'
    assert native._t('input.empty') in native.verificar_citas({'texto': ''})


def test_edad_motor_sin_sondeo(native, monkeypatch):
    aislamiento = native._aislamiento()
    monkeypatch.setattr(aislamiento, '_SERVIDORES', {})
    assert aislamiento.segundos_servidor() is None
    vivos = [SimpleNamespace(proc=SimpleNamespace(poll=lambda: None), inicio=40),
             SimpleNamespace(proc=SimpleNamespace(poll=lambda: 1), inicio=10)]
    monkeypatch.setattr(aislamiento, '_SERVIDORES', dict(enumerate(vivos)))
    monkeypatch.setattr(aislamiento.time, 'monotonic', lambda: 100)
    assert aislamiento.segundos_servidor() == 60


def test_medicion_buscar_incluye_segunda_llamada_caliente(monkeypatch, capsys):
    import importlib.util
    import sys
    mod = cargar('medicion_textos_test', 'scripts/medir_aislamiento.py')
    llamadas = []
    instalado = {'generation': '/generacion'}
    def panel(*args, **kw):
        llamadas.append(kw)
        return {'total': 3}
    fake = SimpleNamespace(_asegurar_corpus=lambda datos: instalado, _panel_json=panel,
                           _aislamiento=lambda: SimpleNamespace(estado=lambda: {'modo': 'bwrap'}, cerrar_servidores=lambda: None))
    monkeypatch.setattr(importlib.util, 'spec_from_file_location', lambda *a: SimpleNamespace(loader=SimpleNamespace(exec_module=lambda m: None)))
    monkeypatch.setattr(importlib.util, 'module_from_spec', lambda spec: fake)
    monkeypatch.setattr(sys, 'argv', ['medicion', 'buscar'])
    monkeypatch.setitem(sys.modules, 'dike_med', fake)
    exec(mod._PAYLOAD.format(root=str(ROOT), datos='/datos', demo=str(mod.DEMO)), {})
    salida = json.loads(capsys.readouterr().out)
    assert len(llamadas) == 3
    assert 'instalado' not in llamadas[0]
    assert llamadas[1]['instalado'] is instalado and llamadas[2]['instalado'] is instalado
    assert llamadas[0]['entrada'] == llamadas[1]['entrada'] == llamadas[2]['entrada']
    assert salida['resultados'] == 3
    assert salida['segundos'] >= 0 and salida['caliente'] >= 0
