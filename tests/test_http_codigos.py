"""Contrato traducible de los errores HTTP y su inventario para la página."""
import ast
import json
import re
from types import SimpleNamespace

import pytest
from soporte_codigos_http import ROOT, inventario
from soporte_textos import cargar

API = cargar('api_codigos_test', 'dashboard/plugin_api.py')
TREE = ast.parse((ROOT / 'dashboard/plugin_api.py').read_text())
ERRORES = [n for n in ast.walk(TREE) if isinstance(n, ast.Call)
           and isinstance(n.func, ast.Name) and n.func.id == 'HTTPException']


@pytest.mark.parametrize('llamada', ERRORES, ids=lambda n: str(n.lineno))
def test_cada_error_tiene_codigo(llamada):
    kw = {k.arg: k.value for k in llamada.keywords}
    valores = dict(clave='texto', esperado='text', campo='valor', fuente='otro',
                   e=ValueError('failure'), exc=SimpleNamespace(detalle='engine failure'),
                   rel_name='law.txt', bkey='activo', data={'error': 'engine failure'}, rev_actual=7)
    detalle = eval(compile(ast.Expression(kw['detail']), '<detalle>', 'eval'), API.__dict__, valores)
    if ast.literal_eval(kw['status_code']) == 409:
        assert detalle == {'rev_actual': 7}
    else:
        assert re.match(r'^[A-Z][A-Z0-9_]+: ', detalle), detalle


def test_inventario_exacto():
    codigos = inventario()
    declarados = {n.args[0].value for n in ast.walk(TREE)
                  if isinstance(n, ast.Call) and isinstance(n.func, ast.Name)
                  and n.func.id == '_detalle' and n.args and isinstance(n.args[0], ast.Constant)}
    assert set(codigos) == declarados | API._CODIGOS_PANEL
    esperado = [dict(code=c, en=API._TEXTOS.TEXTOS['en'][c], es=API._TEXTOS.TEXTOS['es'][c], **datos)
                for c, datos in codigos.items()]
    # El inventario es un handoff gitignored; un checkout limpio no lo necesita.
    informe = ROOT / '.workshop/pulido-final/codigos-http.json'
    if informe.exists():
        assert json.loads(informe.read_text()) == esperado
    for codigo in API._CODIGOS_PANEL:
        assert API._detalle_panel(codigo + ': message') == codigo + ': message'
    assert API._detalle_panel('engine error').startswith('PANEL_INPUT_ERROR: ')
