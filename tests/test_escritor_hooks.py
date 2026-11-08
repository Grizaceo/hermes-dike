"""Hooks del chat del escrito: inyección de instrucciones y lista blanca."""
import importlib.util
import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).parents[1]


@pytest.fixture(scope='module')
def hooks():
    spec = importlib.util.spec_from_file_location(
        'dike_escritor_hooks_test', ROOT / 'escritor' / 'hooks.py')
    m = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = m
    try:
        spec.loader.exec_module(m)
    except Exception:
        sys.modules.pop(spec.name, None)
        raise
    return m


@pytest.fixture
def sesiones(hooks, monkeypatch, tmp_path):
    """Sesiones marcadas aisladas + auditoría en HERMES_HOME temporal."""
    hooks._sesiones_marcadas.clear()
    hooks._cache_instrucciones[0] = None
    monkeypatch.setenv('HERMES_HOME', str(tmp_path))
    return tmp_path


def _auditoria_path(tmp_path):
    return tmp_path / 'plugin-data' / 'dike' / 'escritor' / 'auditoria.jsonl'


def test_plataforma_ajena_no_interviene(hooks, sesiones):
    assert hooks.pre_llm_call(platform='telegram', session_id='s1',
                            is_first_turn=True) is None
    assert hooks.pre_tool_call(session_id='s1', tool_name='terminal') is None
    assert not hooks._sesiones_marcadas


def test_primer_turno_inyecta_instrucciones(hooks, sesiones):
    esperado = (ROOT / 'escritor' / 'instrucciones.md').read_text(encoding='utf-8')
    out = hooks.pre_llm_call(platform='dike-escritor', session_id='s9',
                             is_first_turn=True)
    assert out == {'context': esperado}


def test_turno_posterior_recordatorio(hooks, sesiones):
    out = hooks.pre_llm_call(platform='dike-escritor', session_id='s9',
                             is_first_turn=False)
    assert out == {'context': hooks.RECORDATORIO}
    assert 'VERIFICADA' in out['context']


def test_sesion_marcada_bloquea_tools_no_permitidas(hooks, sesiones):
    hooks.pre_llm_call(platform='dike-escritor', session_id='s1',
                       is_first_turn=True)
    out = hooks.pre_tool_call(session_id='s1', tool_name='terminal')
    assert out['action'] == 'block'
    assert 'terminal' in out['message']
    for permitida in ('skills_list', 'skill_view', 'dike_verificar_citas'):
        assert hooks.pre_tool_call(session_id='s1', tool_name=permitida) is None


def test_sesion_no_marcada_no_bloquea(hooks, sesiones):
    assert hooks.pre_tool_call(session_id='otra', tool_name='terminal') is None


def test_remarca_en_turnos_posteriores(hooks, sesiones):
    """Un gateway reiniciado (conjunto vacío) remarca en el siguiente turno."""
    hooks.pre_llm_call(platform='dike-escritor', session_id='s5',
                       is_first_turn=True)
    hooks._sesiones_marcadas.clear()
    assert hooks.pre_tool_call(session_id='s5', tool_name='terminal') is None
    hooks.pre_llm_call(platform='dike-escritor', session_id='s5',
                     is_first_turn=False)
    assert hooks.pre_tool_call(session_id='s5', tool_name='terminal')['action'] == 'block'


def test_sin_instrucciones_fail_closed(hooks, sesiones, monkeypatch):
    monkeypatch.setattr(Path, 'read_text',
                        lambda self, **kw: (_ for _ in ()).throw(OSError('no')))
    out = hooks.pre_llm_call(platform='dike-escritor', session_id='s1',
                             is_first_turn=True)
    assert out['action'] == 'block'
    assert 'instrucciones' in out['message']


def test_auditoria_sin_contenido(hooks, sesiones):
    hooks.pre_llm_call(platform='dike-escritor', session_id='s7',
                       is_first_turn=True, user_message='TEXTO-SECRETO-USER')
    hooks.pre_tool_call(session_id='s7', tool_name='terminal', args={'x': 'SECRETO'})
    ruta = _auditoria_path(sesiones)
    assert ruta.is_file()
    lineas = [json.loads(l) for l in ruta.read_text().splitlines() if l.strip()]
    assert lineas[0]['evento'] == 'instrucciones'
    assert lineas[1]['evento'] == 'bloqueo' and lineas[1]['tool'] == 'terminal'
    crudo = ruta.read_text()
    assert 'TEXTO-SECRETO-USER' not in crudo and 'SECRETO' not in crudo
    assert 'user_message' not in crudo and 'args' not in crudo


def test_register_registra_hooks_y_tool(hooks):
    import importlib.util as iu
    spec = iu.spec_from_file_location('dike_register_test', ROOT / '__init__.py')
    mod = iu.module_from_spec(spec)
    sys.modules[spec.name] = mod
    spec.loader.exec_module(mod)
    registrado = {'hooks': [], 'tools': []}

    class CtxFalso:
        def register_hook(self, nombre, cb, **kw):
            registrado['hooks'].append((nombre, cb))

        def register_tool(self, **kw):
            registrado['tools'].append(kw.get('name'))

        def register_command(self, *a, **kw):
            pass

        def register_skill(self, *a, **kw):
            pass

    mod.register(CtxFalso())
    nombres = {n for n, _ in registrado['hooks']}
    assert {'pre_llm_call', 'pre_tool_call'} <= nombres
    assert 'dike_verificar_citas' in registrado['tools']
    sys.modules.pop(spec.name, None)
