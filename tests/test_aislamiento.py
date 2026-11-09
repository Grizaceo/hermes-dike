"""Aislamiento bubblewrap: sonda, política, sandbox efectivo y modo degradado.

Las pruebas que necesitan un sandbox real se saltan con motivo explícito
cuando bubblewrap no está usable en el equipo; nunca fallan por eso. Las de
clasificación de la sonda usan ``bwrap`` falsos en un PATH temporal, así que
corren siempre.
"""
import importlib.util
import json
import os
import socket
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).parents[1]
DEMO = (ROOT / 'tests/fixtures/escrito_demo.md').read_text(encoding='utf-8')


def _cargar(ruta, nombre):
    spec = importlib.util.spec_from_file_location(nombre, ruta)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[nombre] = mod
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture(scope='module')
def aisla():
    """El módulo ``dike_aislamiento`` compartido con el adaptador."""
    mod = sys.modules.get('dike_aislamiento')
    if mod is None:
        mod = _cargar(ROOT / 'aislamiento.py', 'dike_aislamiento')
    return mod


@pytest.fixture(scope='module')
def motor(aisla, tmp_path_factory):
    """Adaptador real con el corpus instalado una vez (subprocesos en bwrap)."""
    m = _cargar(ROOT / '__init__.py', 'dike_adapter_aisla_test')
    data = tmp_path_factory.mktemp('aisla-data')
    m._carpeta_de_datos = lambda: data
    # Primera verificación: instala la generación (fría) y deja el corpus listo.
    json.loads(m.verificar_citas({'texto': 'artículo 161 del Código del Trabajo'}))
    return m, data


@pytest.fixture(autouse=True)
def _restaura(aisla):
    proveedor = aisla._PROVEEDOR_POLITICA
    yield
    aisla._PROVEEDOR_POLITICA = proveedor
    aisla._reset_sonda()


@pytest.fixture
def sandbox(aisla):
    estado = aisla.estado()
    if estado.get('modo') != 'bwrap':
        pytest.skip(f"bubblewrap no usable en este equipo: {estado.get('motivo')}")
    return aisla


def _env_minimo(**extra):
    env = {'PATH': os.environ.get('PATH', ''), 'HOME': '/tmp', 'PYTHONUTF8': '1'}
    env.update(extra)
    return env


def _python(aisla, codigo, *, cwd, lectura=(), escritura=(), env=None, timeout=60):
    return aisla.ejecutar(
        [sys.executable, '-c', codigo],
        lectura=list(lectura), escritura=list(escritura), cwd=str(cwd),
        env=env if env is not None else _env_minimo(), timeout=timeout)


def _bwrap_falso(tmp_path, script):
    directorio = tmp_path / 'bin'
    directorio.mkdir(exist_ok=True)
    falso = directorio / 'bwrap'
    falso.write_text(script)
    falso.chmod(0o755)
    return directorio


# ── Clasificación de la sonda (bwrap falsos, siempre corren) ─────────────

def test_sonda_no_instalado(aisla, monkeypatch, tmp_path):
    vacio = tmp_path / 'vacio'
    vacio.mkdir()
    monkeypatch.setenv('PATH', str(vacio))
    aisla._reset_sonda()
    assert aisla.estado() == {'modo': 'ninguno', 'motivo': 'NO_INSTALADO'}


def test_sonda_userns_denegado(aisla, monkeypatch, tmp_path):
    falso = _bwrap_falso(
        tmp_path,
        '#!/bin/sh\n'
        'echo "bwrap: No permissions to create new namespace" >&2\n'
        'exit 1\n')
    monkeypatch.setenv('PATH', str(falso))
    aisla._reset_sonda()
    assert aisla.estado() == {'modo': 'ninguno', 'motivo': 'USERNS_DENEGADO'}


def test_sonda_otro_fallo(aisla, monkeypatch, tmp_path):
    falso = _bwrap_falso(
        tmp_path,
        '#!/bin/sh\n'
        'echo "error inesperado de prueba" >&2\n'
        'exit 1\n')
    monkeypatch.setenv('PATH', str(falso))
    aisla._reset_sonda()
    estado = aisla.estado()
    assert estado['modo'] == 'ninguno'
    assert estado['motivo'] == 'OTRO'
    # La sonda no filtra stderr arbitrario del binario.
    assert 'inesperado' not in json.dumps(estado)


def test_sonda_exit_ok_es_bwrap(aisla, monkeypatch, tmp_path):
    falso = _bwrap_falso(tmp_path, '#!/bin/sh\nexit 0\n')
    monkeypatch.setenv('PATH', str(falso))
    aisla._reset_sonda()
    assert aisla.estado() == {'modo': 'bwrap'}


# ── Política ────────────────────────────────────────────────────────────

def _sin_bwrap(aisla, monkeypatch, tmp_path):
    vacio = tmp_path / 'sin-bwrap'
    vacio.mkdir(exist_ok=True)
    monkeypatch.setenv('PATH', str(vacio))
    aisla._reset_sonda()


def test_requerido_sin_bwrap_cierra(motor, aisla, monkeypatch, tmp_path):
    """``sandbox: requerido`` sin bubblewrap: SANDBOX_UNAVAILABLE y el motor
    no llega a ejecutarse (no hay subproceso lexo_cli/panel)."""
    m, _ = motor
    _sin_bwrap(aisla, monkeypatch, tmp_path)
    aisla.establecer_politica(lambda: 'requerido')
    llamadas = []
    real_run = subprocess.run

    def espia(cmd, **kw):
        llamadas.append(cmd)
        return real_run(cmd, **kw)

    monkeypatch.setattr(subprocess, 'run', espia)
    out = json.loads(m.verificar_citas({'texto': DEMO}))
    assert out.get('error_code') == 'SANDBOX_UNAVAILABLE'
    assert out['todo_verificado'] is False
    assert out['aislamiento'] == {'modo': 'ninguno', 'motivo': 'NO_INSTALADO'}
    ejecutados = ' '.join(' '.join(map(str, c)) for c in llamadas)
    assert 'lexo_cli' not in ejecutados
    assert 'panel.py' not in ejecutados


def test_politica_desconocida_es_requerido(motor, aisla, monkeypatch, tmp_path):
    """Cualquier valor que no sea ``auto`` se comporta como ``requerido``."""
    m, _ = motor
    _sin_bwrap(aisla, monkeypatch, tmp_path)
    aisla.establecer_politica(lambda: 'valor-raro')
    out = json.loads(m.verificar_citas({'texto': DEMO}))
    assert out.get('error_code') == 'SANDBOX_UNAVAILABLE'


def test_auto_sin_bwrap_degrada(motor, aisla, monkeypatch, tmp_path):
    """Con ``auto`` (defecto) y sin bubblewrap el plugin sigue funcionando y
    lo declara como modo degradado."""
    m, _ = motor
    _sin_bwrap(aisla, monkeypatch, tmp_path)
    aisla.establecer_politica(lambda: 'auto')
    out = json.loads(m.verificar_citas({'texto': DEMO}))
    assert 'error' not in out, out
    assert out['aislamiento']['modo'] == 'ninguno'
    assert out['aislamiento']['motivo'] == 'NO_INSTALADO'
    assert out['meta']['total_citas'] == 6
    assert out['meta']['citas_verificadas'] == 4
    assert out['meta']['citas_fallidas'] == 2
    assert any('sin aislamiento' in e for e in out['efectos_de_ejecucion'])


# ── Dentro del sandbox (requieren bubblewrap real) ──────────────────────

def test_sin_red_dentro_del_sandbox(sandbox, tmp_path):
    """Una conexión TCP a un listener del anfitrión no puede establecerse."""
    servidor = socket.socket()
    servidor.bind(('127.0.0.1', 0))
    servidor.listen(1)
    puerto = servidor.getsockname()[1]
    try:
        codigo = (
            'import socket,sys\n'
            's=socket.socket(); s.settimeout(3)\n'
            'try:\n'
            f'    s.connect(("127.0.0.1",{puerto})); print("CONECTO"); sys.exit(0)\n'
            'except OSError:\n'
            '    sys.exit(3)\n')
        proc = _python(sandbox, codigo, cwd=tmp_path, lectura=[tmp_path])
        assert proc.returncode == 3, proc.stderr
        assert 'CONECTO' not in proc.stdout
    finally:
        servidor.close()


def test_canario_fuera_de_los_binds_no_se_lee(sandbox, tmp_path):
    """Un archivo fuera de toda ruta montada no existe dentro del sandbox."""
    dentro = tmp_path / 'dentro'
    dentro.mkdir()
    canario = tmp_path / 'canario.txt'
    canario.write_text('contenido-secreto', encoding='utf-8')
    codigo = (
        'import sys\n'
        f'try:\n    print(open(r"{canario}").read()); sys.exit(0)\n'
        'except OSError:\n    sys.exit(4)\n')
    proc = _python(sandbox, codigo, cwd=dentro, lectura=[dentro])
    assert proc.returncode == 4, proc.stderr
    assert 'contenido-secreto' not in proc.stdout


def test_users_de_la_generacion_solo_lectura(motor, sandbox, tmp_path):
    """Con los binds de ``constancia``, escribir bajo ``users/`` da EROFS."""
    _, data = motor
    generation = next((data / 'generations').iterdir())
    objetivo = generation / 'users' / 'hermes' / 'intento_escritura.txt'
    codigo = (
        'import sys\n'
        f'p = r"{objetivo}"\n'
        'try:\n'
        '    open(p, "w").write("x")\n'
        '    print("ESCRIBIO"); sys.exit(0)\n'
        'except OSError as e:\n'
        '    print("ERRNO", e.errno)\n'
        '    sys.exit(0 if e.errno == 30 else 5)\n')
    proc = _python(
        sandbox, codigo, cwd=generation,
        lectura=[generation],
        escritura=[generation / 'home', generation / 'roots_cache'],
        env=motor[0]._entorno(generation))
    assert 'ERRNO 30' in proc.stdout, proc.stdout + proc.stderr
    assert 'ESCRIBIO' not in proc.stdout
    assert not objetivo.exists()


def test_demo_sigue_4_de_6_en_bwrap(motor, sandbox):
    """El escrito de demostración verifica igual dentro del sandbox."""
    m, _ = motor
    out = json.loads(m.verificar_citas({'texto': DEMO}))
    assert 'error' not in out, out
    assert out['aislamiento']['modo'] == 'bwrap'
    assert out['meta']['total_citas'] == 6
    assert out['meta']['citas_verificadas'] == 4
    assert out['meta']['citas_fallidas'] == 2
    assert any('bubblewrap' in e for e in out['efectos_de_ejecucion'])
