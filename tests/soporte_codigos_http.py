"""Inventario estático de errores y rutas, sin ejecutar el backend ni el motor."""
import ast
from pathlib import Path

ROOT = Path(__file__).parents[1]


def inventario():
    tree = ast.parse((ROOT / 'dashboard/plugin_api.py').read_text())
    funciones = {n.name: n for n in tree.body if isinstance(n, ast.FunctionDef)}
    panel = next(ast.literal_eval(n.value) for n in tree.body
                 if isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id == '_CODIGOS_PANEL' for t in n.targets))
    errores, llamadas, rutas = {}, {}, {}
    for nombre, fn in funciones.items():
        llamadas[nombre] = set()
        errores[nombre] = []
        rutas[nombre] = [d.func.attr.upper() + ' ' + ast.literal_eval(d.args[0])
                         for d in fn.decorator_list if isinstance(d, ast.Call)
                         and isinstance(d.func, ast.Attribute) and isinstance(d.func.value, ast.Name)
                         and d.func.value.id == 'router']
        for n in ast.walk(fn):
            if not isinstance(n, ast.Call) or not isinstance(n.func, ast.Name):
                continue
            llamadas[nombre].add(n.func.id)
            if n.func.id == 'HTTPException':
                kw = {k.arg: k.value for k in n.keywords}
                estado = ast.literal_eval(kw['status_code'])
                detalle = kw['detail']
                if estado == 409:
                    assert isinstance(detalle, ast.Dict)
                    assert [ast.literal_eval(k) for k in detalle.keys] == ['rev_actual']
                    continue
                assert isinstance(detalle, ast.Call) and isinstance(detalle.func, ast.Name)
                if detalle.func.id == '_detalle_panel':
                    codigos = panel | {'PANEL_INPUT_ERROR'}
                else:
                    assert detalle.func.id == '_detalle'
                    codigos = {ast.literal_eval(detalle.args[0])}
                errores[nombre].extend((codigo, estado) for codigo in codigos)
    resultado = {}
    for nombre, endpoints in rutas.items():
        if not endpoints:
            continue
        pendientes, vistos = [nombre], set()
        while pendientes:
            fn = pendientes.pop()
            if fn in vistos or fn not in funciones:
                continue
            vistos.add(fn)
            pendientes.extend(llamadas[fn])
            for codigo, estado in errores[fn]:
                entrada = resultado.setdefault(codigo, {'status': estado, 'routes': set()})
                assert entrada['status'] == estado, codigo
                entrada['routes'].update(endpoints)
    return {codigo: {**entrada, 'routes': sorted(entrada['routes'])}
            for codigo, entrada in sorted(resultado.items())}
