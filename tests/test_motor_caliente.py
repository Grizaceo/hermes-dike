"""Motor en caliente: un servidor que verifica el corpus una vez y atiende muchas consultas.

Tres capas: el protocolo de ``scripts/motor_servidor.py`` (sin corpus), el
cliente ``aislamiento.consultar`` con servidores falsos (arranque fallido,
basura, plazo vencido, cambio de firma) y el camino real con el corpus
instalado, que debe responder lo mismo que el proceso de un solo uso.
"""
import importlib.util
import json
import subprocess
import sys
import textwrap
from pathlib import Path

import pytest

ROOT = Path(__file__).parents[1]
SERVIDOR = ROOT / 'scripts' / 'motor_servidor.py'
DEMO = (ROOT / 'tests/fixtures/escrito_demo.md').read_text(encoding='utf-8')


def _cargar(ruta, nombre):
    spec = importlib.util.spec_from_file_location(nombre, ruta)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[nombre] = mod
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture(scope='module')
def aisla():
    mod = sys.modules.get('dike_aislamiento')
    if mod is None:
        mod = _cargar(ROOT / 'aislamiento.py', 'dike_aislamiento')
    return mod


@pytest.fixture(autouse=True)
def _sin_servidores(aisla):
    yield
    aisla.cerrar_servidores()


# ── Protocolo del servidor, sin corpus ──────────────────────────────────

@pytest.fixture
def servidor(tmp_path):
    """El servidor real, sin sandbox, sobre un runtime vacío."""
    env = {'PATH': '/usr/bin:/bin', 'PYTHONDONTWRITEBYTECODE': '1', 'PYTHONUTF8': '1',
           'PYTHONPATH': ':'.join(p for p in sys.path if p),
           'HOME': str(tmp_path / 'home'), 'LEXO_CONFIG': str(tmp_path / 'config.yaml'),
           'DIKE_USER': 'hermes', 'DIKE_USERS_ROOT': str(tmp_path / 'users'),
           'DIKE_ROOTS_CACHE_DIR': str(tmp_path / 'roots_cache')}
    (tmp_path / 'config.yaml').write_text('starter:\n  user: hermes\n')
    proc = subprocess.Popen([sys.executable, str(SERVIDOR)], env=env, cwd=tmp_path,
                            stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, text=True, encoding='utf-8')
    assert json.loads(proc.stdout.readline()) == {'listo': True}

    def pedir(pedido):
        proc.stdin.write((pedido if isinstance(pedido, str) else json.dumps(pedido)) + '\n')
        proc.stdin.flush()
        return json.loads(proc.stdout.readline())

    yield proc, pedir
    proc.kill()
    proc.wait()


def test_el_hijo_devuelve_la_salida_y_el_codigo_del_comando(servidor):
    _, pedir = servidor
    version = pedir({'cmd': 'motor', 'argv': ['--version']})
    assert version['rc'] == 0 and version['out'].startswith('dike '), version
    # argparse rechaza el comando: código 2 y el motivo en stderr, como el CLI.
    malo = pedir({'cmd': 'motor', 'argv': ['no-existe']})
    assert malo['rc'] == 2 and malo['out'] == '' and 'no-existe' in malo['err'], malo
    # panel.py informa sus errores de uso como JSON en stdout, con código 0.
    panel = pedir({'cmd': 'panel', 'argv': ['otro', 'op']})
    assert panel['rc'] == 0 and 'grupo desconocido' in json.loads(panel['out'])['error']


def test_pedidos_repetidos_responden_igual(servidor):
    """Cada pedido corre en un hijo nuevo: el tercero ve lo mismo que el primero."""
    proc, pedir = servidor
    respuestas = [pedir({'cmd': 'panel', 'argv': ['grafo', 'leer'],
                         'stdin': json.dumps({'cita': 'artículo 1 del Código Civil'})})
                  for _ in range(3)]
    assert respuestas[0] == respuestas[1] == respuestas[2]
    # Sin corpus instalado no hay artículo que leer, y el panel lo dice.
    assert respuestas[0]['rc'] == 0, respuestas[0]
    assert json.loads(respuestas[0]['out'])['resolucion'] == 'UNRESOLVABLE'
    assert proc.poll() is None


def test_pedido_invalido_no_tumba_el_servidor(servidor):
    proc, pedir = servidor
    for basura in ('esto no es json', '[]', json.dumps({'cmd': 'shell', 'argv': []}),
                   json.dumps({'cmd': 'motor', 'argv': 'texto'})):
        assert pedir(basura) == {'rc': 2, 'out': '', 'err': 'pedido inválido'}
    assert proc.poll() is None
    assert pedir({'cmd': 'motor', 'argv': ['--version']})['rc'] == 0


def test_termina_solo_cuando_se_cierra_su_entrada(servidor):
    proc, _ = servidor
    proc.stdin.close()
    assert proc.wait(timeout=20) == 0


# ── Cliente con servidores falsos ───────────────────────────────────────

@pytest.fixture
def falso(aisla, monkeypatch, tmp_path):
    """Sustituye el servidor por un script de prueba y corre sin sandbox."""
    monkeypatch.setattr(aisla, '_sonda', lambda: {'ok': False, 'motivo': 'NO_INSTALADO'})

    def usar(codigo):
        script = tmp_path / 'servidor_falso.py'
        script.write_text(textwrap.dedent(codigo))
        monkeypatch.setattr(aisla, '_SERVIDOR', script)

    def consultar(firma='f1', timeout=20, pedido=None):
        return aisla.consultar(
            tmp_path, firma, pedido or {'cmd': 'motor', 'argv': ['x']},
            lectura=[], escritura=[], cwd=tmp_path,
            env={'PATH': '/usr/bin:/bin'}, timeout=timeout)

    return usar, consultar


ECO = '''
    import json, os, sys
    print(json.dumps({"listo": True}), flush=True)
    for linea in sys.stdin:
        print(json.dumps({"rc": 0, "out": str(os.getpid()), "err": linea.strip()}), flush=True)
'''


def test_el_mismo_servidor_atiende_pedidos_seguidos(falso):
    usar, consultar = falso
    usar(ECO)
    primero, segundo = consultar(), consultar()
    assert primero.returncode == 0 and primero.stdout == segundo.stdout
    assert json.loads(primero.stderr) == {'cmd': 'motor', 'argv': ['x']}


def test_una_firma_distinta_reinicia_el_servidor(falso, aisla):
    """Si el corpus cambió, el servidor que lo tenía en memoria no puede seguir."""
    usar, consultar = falso
    usar(ECO)
    viejo = consultar('f1').stdout
    nuevo = consultar('f2').stdout
    assert viejo != nuevo
    assert consultar('f2').stdout == nuevo


def test_un_servidor_muerto_se_reemplaza(falso, aisla, tmp_path):
    usar, consultar = falso
    usar(ECO)
    pid = consultar().stdout
    aisla._SERVIDORES[str(tmp_path)].proc.kill()
    aisla._SERVIDORES[str(tmp_path)].proc.wait()
    assert consultar().stdout != pid


@pytest.mark.parametrize('codigo', [
    'raise SystemExit(3)',                                    # no arranca
    'print("hola", flush=True)\nimport time; time.sleep(30)',  # no dice listo
    'import json\nprint(json.dumps({"listo": True}), flush=True)\ninput()\nprint("basura", flush=True)',
    'import json\nprint(json.dumps({"listo": True}), flush=True)\ninput()\n'
    'print(json.dumps({"rc": "0", "out": "", "err": ""}), flush=True)',  # rc no entero
    'import json\nprint(json.dumps({"listo": True}), flush=True)\ninput()',  # muere sin contestar
])
def test_un_servidor_que_falla_devuelve_none_y_no_queda_vivo(falso, aisla, tmp_path, codigo):
    """None es la señal de «usa el proceso de un solo uso»: nunca una respuesta inventada."""
    usar, consultar = falso
    usar(codigo)
    assert consultar() is None
    assert aisla._SERVIDORES[str(tmp_path)].proc is None


def test_plazo_vencido_mata_el_servidor(falso, aisla, tmp_path):
    usar, consultar = falso
    usar('''
        import json, time
        print(json.dumps({"listo": True}), flush=True)
        time.sleep(60)
    ''')
    with pytest.raises(subprocess.TimeoutExpired):
        consultar(timeout=1)
    assert aisla._SERVIDORES[str(tmp_path)].proc is None


def test_sandbox_requerido_sin_bubblewrap_no_lanza_servidor(falso, aisla, monkeypatch, tmp_path):
    usar, consultar = falso
    usar(ECO)
    monkeypatch.setattr(aisla, '_PROVEEDOR_POLITICA', lambda: 'requerido')
    with pytest.raises(aisla.SandboxNoDisponible):
        consultar()
    assert aisla._SERVIDORES[str(tmp_path)].proc is None


# ── Camino real: mismo resultado que el proceso de un solo uso ──────────

@pytest.fixture(scope='module')
def real(aisla, tmp_path_factory):
    m = _cargar(ROOT / '__init__.py', 'dike_adapter_caliente_test')
    data = tmp_path_factory.mktemp('caliente-data')
    m._carpeta_de_datos = lambda: data
    frio = json.loads(m.verificar_citas({'texto': DEMO}))
    assert 'error' not in frio, frio
    return m, data


def _sin_reloj(salida: dict) -> dict:
    salida = json.loads(json.dumps(salida))
    salida.get('meta', {}).pop('fecha_constancia', None)
    return salida


def test_caliente_y_de_un_solo_uso_responden_lo_mismo(real, aisla, monkeypatch):
    m, _ = real
    textos = [DEMO, 'artículo 161 del Código del Trabajo', 'La Ley 19.496 y el Código Civil.',
              'artículo 161 del Código del Trabajo\nartículo 161 del Código Civil']
    calientes = [json.loads(m.verificar_citas({'texto': t})) for t in textos]
    assert aisla._SERVIDORES, 'la verificación no pasó por el servidor'
    monkeypatch.setattr(m, '_consultar_motor', lambda *a, **k: None)
    frios = [json.loads(m.verificar_citas({'texto': t})) for t in textos]
    assert [_sin_reloj(c) for c in calientes] == [_sin_reloj(f) for f in frios]
    assert calientes[0]['meta']['citas_verificadas'] == 4


def test_las_llamadas_siguientes_no_lanzan_otro_proceso(real, aisla, monkeypatch):
    m, _ = real
    json.loads(m.verificar_citas({'texto': DEMO}))
    (servidor,) = aisla._SERVIDORES.values()
    pid = servidor.proc.pid
    monkeypatch.setattr(m, '_dike', lambda *a, **k: pytest.fail('lanzó un proceso de un solo uso'))
    monkeypatch.setattr(aisla, 'ejecutar', lambda *a, **k: pytest.fail('lanzó un proceso de un solo uso'))
    assert json.loads(m.verificar_citas({'texto': DEMO}))['meta']['citas_verificadas'] == 4
    leido = json.loads(m.leer_articulo({'cita': 'artículo 161 del Código del Trabajo'}))
    assert leido['resolucion'] == 'RESOLVED', leido
    pistas = json.loads(m.buscar_corpus({'consulta': 'despido injustificado'}))
    assert pistas['resultados'], pistas
    assert servidor.proc.pid == pid and servidor.proc.poll() is None


def test_sin_servidor_el_adaptador_sigue_verificando(real, aisla, monkeypatch, tmp_path):
    m, _ = real
    monkeypatch.setattr(aisla, '_SERVIDOR', tmp_path / 'no-existe.py')
    salida = json.loads(m.verificar_citas({'texto': DEMO}))
    assert salida['meta']['citas_verificadas'] == 4, salida


def test_un_corpus_tocado_reinicia_el_servidor_y_falla_cerrado(real, aisla):
    """Cambiar un archivo cambia la firma: el servidor viejo no contesta por él."""
    m, data = real
    json.loads(m.verificar_citas({'texto': DEMO}))
    victima = next(p for p in (data / 'generations').glob('*/users/**/*.json') if p.is_file())
    original = victima.read_bytes()
    try:
        victima.write_bytes(original + b' ')
        salida = json.loads(m.verificar_citas({'texto': DEMO}))
        assert salida.get('error_code') == 'CORPUS_INTEGRITY_ERROR', salida
    finally:
        victima.write_bytes(original)
    assert json.loads(m.verificar_citas({'texto': DEMO}))['meta']['citas_verificadas'] == 4
