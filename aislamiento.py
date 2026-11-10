"""Aislamiento opcional de los subprocesos de Diké con bubblewrap.

Corre ``python -m lexo_cli`` y ``scripts/panel.py`` dentro de un sandbox de
bubblewrap cuando el equipo lo permite, y deja constancia del modo en cada
respuesta (``estado()``). Sin bubblewrap —o si el kernel niega las user
namespaces, como en algunos Ubuntu con AppArmor— el plugin sigue funcionando
exactamente igual que antes y lo declara: modo ``ninguno`` con el motivo.

Este módulo no importa ``__init__.py`` (el adaptador lo importa a él): solo
usa la biblioteca estándar y rutas derivadas de su propia ubicación, para
poder cargarse también desde ``dashboard/plugin_api.py`` sin efectos.

La política la fija el adaptador con ``establecer_politica``: ``auto``
(bwrap si la sonda pasa, si no se corre como siempre) o ``requerido``
(cualquier valor distinto de ``auto`` se trata como ``requerido``, fail-closed:
si la sonda falla se lanza ``SandboxNoDisponible`` y no se ejecuta nada).

Perfil del sandbox (todo bind en la misma ruta dentro que fuera, para que el
modo degradado se comporte igual):

- ``--unshare-all --die-with-parent --new-session --proc /proc --dev /dev
  --tmpfs /tmp``: sin red, sin IPC, sin usuarios reales; /tmp es un tmpfs.
- ``/usr`` en solo lectura; ``/lib``, ``/lib64``, ``/lib32``, ``/bin`` y
  ``/sbin`` replicados según el layout del host (``--symlink`` si son
  symlinks, ``--ro-bind`` si son directorios, se omiten si no existen).
- ``sys.base_prefix`` en solo lectura, más la cadena de symlinks/directorios
  que ``sys.executable`` necesita (el python del venv) y
  ``sys.prefix/pyvenv.cfg`` — no el venv entero.
- En solo lectura, los directorios ``site-packages``/``dist-packages`` que
  contienen los módulos medidos del motor y del panel
  (``MODULOS_MEDIDOS``), y las carpetas del plugin que leen:
  ``motor/``, ``scripts/`` y ``data/arbol/``.
- De ``/etc``, solo lo que el intérprete y el cargador necesitan de verdad
  (``ld.so.cache``, ``localtime``), medido; nunca el HOME real, todo
  ``~/.hermes``, ``~/.ssh`` ni credenciales.
- Escribible: solo las rutas ``escritura`` del comando (y ``lectura`` en solo
  lectura). Cada comando declara las suyas; la generación sellada
  (``users/``) queda siempre en solo lectura.

Dos formas de correr un comando: ``ejecutar`` lanza un proceso de un solo uso;
``consultar`` habla con un servidor del motor que ya verificó el corpus
(``scripts/motor_servidor.py``), con el mismo perfil de sandbox, y solo para
pedidos de lectura sobre la generación sellada.

Solo se usan flags presentes en el bubblewrap de Debian 12 (0.8.0) y Ubuntu
22.04 (0.6.1) o posteriores: ``--unshare-all``, ``--die-with-parent``,
``--new-session``, ``--proc``, ``--dev``, ``--tmpfs``, ``--ro-bind``,
``--bind``, ``--symlink``, ``--chdir`` (todos anteriores a 0.6.x).
"""
from __future__ import annotations

import atexit
import importlib.util
import json
import os
import shutil
import site
import subprocess
import sys
import time
import threading
from pathlib import Path

_RAIZ = Path(__file__).resolve().parent

# Módulos de primer nivel que importan el motor y el panel, medidos el
# 2026-11-09 corriendo cada comando y volcando sys.modules (constancia,
# starter install, nif *, grafo *). El adaptador reutiliza la lista para
# PYTHONPATH; aquí sirve para montar en solo lectura el directorio que
# contiene cada módulo (find_spec → padre de su ubicación, deduplicado).
# Los .docx se leen en el adaptador con la biblioteca estándar (zipfile +
# ElementTree); el motor ya no importa ``docx``.
MODULOS_MEDIDOS = (
    # Carpetas del plugin (motor/ y scripts/, ya montadas aparte).
    "lexo_cli", "dike_id", "shared", "canal_arbol",
    # Dependencias de terceros medidas en los comandos.
    "annotated_types", "attr", "markdown_it", "mdurl",
    "pydantic", "pydantic_core", "pygments", "rich",
    "typing_extensions", "typing_inspection", "yaml",
)


class SandboxNoDisponible(RuntimeError):
    """La política exige sandbox y la sonda falló: no se ejecutó nada."""


# ── Política ────────────────────────────────────────────────────────────

_PROVEEDOR_POLITICA = None


def establecer_politica(fn) -> None:
    """Registra el proveedor del setting ``sandbox`` (lo fija el adaptador)."""
    global _PROVEEDOR_POLITICA
    _PROVEEDOR_POLITICA = fn


def _politica() -> str:
    """'auto' solo si el setting vale exactamente 'auto'; otro valor, 'requerido'.

    Fail-closed: si el proveedor del setting falla, se exige sandbox como con
    un valor desconocido — nunca se degrada en silencio por un error de lectura.
    """
    if _PROVEEDOR_POLITICA is None:
        return "auto"
    try:
        valor = _PROVEEDOR_POLITICA()
    except Exception:
        return "requerido"
    return "auto" if str(valor or "").strip() == "auto" else "requerido"


# ── Sonda (una vez por proceso, por PATH y binario resuelto) ─────────────

_SONDA: dict = {}


def _reset_sonda() -> None:
    """Vacía la caché de la sonda (lo usan los tests)."""
    _SONDA.clear()


_MARCADORES_USERNS = (
    "no permissions to create new namespace",
    "setting up uid map",
    "creating new namespace failed",
    "operation not permitted",
)


def _sonda() -> dict:
    """{'ok': bool, 'motivo'?: str} — determinista por proceso.

    La clave de caché incluye PATH y la ruta resuelta de bwrap para que un
    PATH sin bwrap en un test no herede el resultado de otro.
    """
    bwrap = shutil.which("bwrap")
    clave = (os.environ.get("PATH") or "", bwrap)
    if clave in _SONDA:
        return _SONDA[clave]
    if bwrap is None:
        resultado = {"ok": False, "motivo": "NO_INSTALADO"}
    else:
        # ``true`` para el perfil mínimo: /usr/bin/true en usr fusionado,
        # /bin/true cuando /bin es un directorio real (ambos quedan montados).
        cierto = next((p for p in ("/usr/bin/true", "/bin/true")
                       if Path(p).exists()), "/usr/bin/true")
        try:
            proc = subprocess.run(
                [bwrap, *_argumentos_sistema(), "--", cierto],
                capture_output=True, text=True, encoding="utf-8",
                errors="replace", timeout=20,
            )
        except (OSError, subprocess.SubprocessError):
            resultado = {"ok": False, "motivo": "OTRO"}
        else:
            if proc.returncode == 0:
                resultado = {"ok": True}
            else:
                texto = (proc.stderr or "").lower()
                motivo = ("USERNS_DENEGADO"
                          if any(m in texto for m in _MARCADORES_USERNS)
                          else "OTRO")
                resultado = {"ok": False, "motivo": motivo}
    _SONDA[clave] = resultado
    return resultado


def estado() -> dict:
    """{'modo': 'bwrap'|'ninguno', 'motivo'?: str} para declarar en respuestas."""
    sonda = _sonda()
    if sonda["ok"]:
        return {"modo": "bwrap"}
    return {"modo": "ninguno", "motivo": sonda["motivo"]}


# ── Perfil del sandbox ──────────────────────────────────────────────────

_RAICES_SISTEMA = ("/usr", "/lib", "/lib64", "/lib32", "/bin", "/sbin")

# /etc medido: el cargador dinámico y la zona horaria local.
_RUTAS_ETC = ("/etc/ld.so.cache", "/etc/localtime")


def _argumentos_base() -> list:
    return [
        "--unshare-all", "--die-with-parent", "--new-session",
        "--proc", "/proc", "--dev", "/dev", "--tmpfs", "/tmp",
    ]


def _bind_raiz(args: list, ruta: str) -> None:
    """Replica una raíz del sistema según el layout del host."""
    p = Path(ruta)
    if p.is_symlink():
        args += ["--symlink", os.readlink(p), ruta]
    elif p.is_dir():
        args += ["--ro-bind", ruta, ruta]


def _argumentos_sistema() -> list:
    """Aislamiento base + /usr y la cadena /lib* /bin /sbin + /etc medido."""
    args = _argumentos_base()
    for nombre in _RAICES_SISTEMA:
        _bind_raiz(args, nombre)
    for ruta in _RUTAS_ETC:
        if Path(ruta).exists():
            args += ["--ro-bind", ruta, ruta]
    return args


def _cadena_enlaces(ruta: Path):
    """(links, real): symlinks desde ruta hasta el primer no-symlink.

    links = [(path_absoluto, target_texto)] en orden ruta→destino; real es la
    ruta que queda al seguirlos (puede contener symlinks de directorio).
    """
    links = []
    cur = Path(ruta)
    seen = set()
    while cur.is_symlink() and str(cur) not in seen:
        seen.add(str(cur))
        target = os.readlink(cur)
        links.append((cur, target))
        cur = (Path(target) if os.path.isabs(target)
               else cur.parent / target)
        cur = Path(os.path.normpath(str(cur)))
    return links, cur


def _bajo_alguno(ruta, raices) -> bool:
    s = str(ruta)
    return any(s == r or s.startswith(r + os.sep) for r in raices)


def _enlaces_en_ascendencia(ruta: Path, cubiertos) -> list:
    """Symlinks en los ancestros de ruta que NO están bajo un bind cubierto."""
    out = []
    p = Path(ruta).parent
    while str(p) != str(p.parent):
        if p.is_symlink() and not _bajo_alguno(p, cubiertos):
            out.append((p, os.readlink(p)))
        p = p.parent
    return out


def _directorios_paquetes(env=None) -> list:
    """Directorios de paquetes a montar en solo lectura (deduplicados).

    Une tres fuentes para no dejar fuera ningún import que el motor o el
    panel puedan hacer dentro del sandbox:

    - el padre de la ubicación de cada módulo medido (``find_spec``);
    - cada directorio de ``PYTHONPATH`` del env del subproceso (los
      site-packages del anfitrión y ``motor/`` que arma ``_entorno``);
    - los site-/dist-packages y user-site que ``site`` reporta para este
      intérprete (el site-packages del venv entra al sys.path del hijo por
      pyvenv.cfg aunque no viaje en PYTHONPATH).
    """
    dirs = []

    def agregar(d):
        try:
            p = Path(d)
        except TypeError:
            return
        if p.is_dir() and str(p) not in dirs:
            dirs.append(str(p))

    for nombre in MODULOS_MEDIDOS:
        try:
            spec = importlib.util.find_spec(nombre)
        except Exception:
            spec = None
        if spec is None:
            continue
        padres = []
        locations = list(getattr(spec, "submodule_search_locations", None) or [])
        if locations:
            padres += [Path(l).resolve().parent for l in locations]
        else:
            origen = getattr(spec, "origin", None)
            if origen and origen not in ("built-in", "frozen") \
                    and not origen.startswith("<"):
                padres.append(Path(origen).resolve().parent)
        for p in padres:
            agregar(p)

    for d in (env or {}).get("PYTHONPATH", "").split(os.pathsep):
        if d:
            agregar(d)
    paquetes = list(site.getsitepackages())
    # El user-site solo existe si el intérprete lo habilita: en un venv está
    # desactivado y el hijo nunca lo usa, así que montarlo expondría
    # ~/.local/lib/pythonX.Y/site-packages sin necesidad.
    if getattr(site, "ENABLE_USER_SITE", False):
        paquetes.append(site.getusersitepackages())
    for d in paquetes:
        agregar(d)
    return dirs


def _binds_plugin() -> list:
    return [str(_RAIZ / "motor"), str(_RAIZ / "scripts"),
            str(_RAIZ / "data" / "arbol"), str(_RAIZ / "textos.py")]


def _argumentos_bwrap(argv, *, lectura, escritura, cwd, env):
    cubiertos = list(_RAICES_SISTEMA)
    args = [shutil.which("bwrap"), *_argumentos_sistema()]

    # Python: base_prefix, la cadena de sys.executable y pyvenv.cfg.
    base = Path(sys.base_prefix)
    if base.is_dir():
        args += ["--ro-bind", str(base), str(base)]
        cubiertos.append(str(base))
    exe = Path(sys.executable)
    # El directorio del ejecutable (p. ej. venv/bin) conserva sus symlinks.
    if exe.parent.is_dir() and not _bajo_alguno(exe.parent, cubiertos):
        args += ["--ro-bind", str(exe.parent), str(exe.parent)]
        cubiertos.append(str(exe.parent))
    links, real = _cadena_enlaces(exe)
    # Symlinks del propio ejecutable y de la ascendencia del destino real que
    # queden fuera de los binds (p. ej. el alias cpython-3.11 → 3.11.16).
    for link, target in links + _enlaces_en_ascendencia(real, cubiertos):
        if not _bajo_alguno(link, cubiertos):
            args += ["--symlink", target, str(link)]
    real_res = real.resolve() if real.exists() else real
    if real_res.is_file() and not _bajo_alguno(real_res, cubiertos):
        args += ["--ro-bind", str(real_res), str(real_res)]
        cubiertos.append(str(real_res))
    cfg = Path(sys.prefix) / "pyvenv.cfg"
    if cfg.is_file():
        args += ["--ro-bind", str(cfg), str(cfg)]
        cubiertos.append(str(cfg))

    # Paquetes y carpetas del plugin que los comandos leen: todo en ro.
    for d in list(_directorios_paquetes(env)) + _binds_plugin():
        if d not in cubiertos and not _bajo_alguno(Path(d), cubiertos):
            args += ["--ro-bind", d, d]
            cubiertos.append(d)

    # Lectura del comando (ro) y escritura (rw). Las fuentes deben existir:
    # escritura se crea antes (es dato del plugin, no del usuario).
    for ruta in lectura or ():
        p = Path(ruta)
        if p.exists():
            args += ["--ro-bind", str(p), str(p)]
    for ruta in escritura or ():
        p = Path(ruta)
        if not p.exists():
            p.mkdir(parents=True, exist_ok=True)
        args += ["--bind", str(p), str(p)]

    args += ["--chdir", str(cwd), "--", *[str(a) for a in argv]]
    return args


def _comando(argv, *, lectura, escritura, cwd, env) -> list:
    """argv final: dentro de bwrap si la sonda pasa; tal cual en modo degradado.

    Con la política ``requerido`` y sin sandbox lanza ``SandboxNoDisponible``.
    """
    if _sonda()["ok"]:
        return _argumentos_bwrap(argv, lectura=lectura, escritura=escritura,
                                 cwd=cwd, env=env)
    if _politica() == "requerido":
        raise SandboxNoDisponible(
            "sandbox requerido por configuración pero bubblewrap no está "
            "disponible en este equipo; no se verificó nada")
    return [str(a) for a in argv]


def ejecutar(argv, *, lectura, escritura, cwd, env, timeout, stdin=None):
    """Corre argv dentro del sandbox, o sin él según la sonda y la política.

    ``lectura``/``escritura``: rutas absolutas por comando; el perfil base se
    agrega dentro. Mismo argv en ambos modos (sin shell). ``env`` va por
    ``subprocess.run(env=...)``: bwrap lo hereda tal cual.
    """
    cmd = _comando(argv, lectura=lectura, escritura=escritura, cwd=cwd, env=env)
    return subprocess.run(
        cmd, env=env, cwd=str(cwd), input=stdin,
        capture_output=True, text=True, encoding="utf-8", errors="replace",
        timeout=timeout,
    )


# ── Motor en caliente ───────────────────────────────────────────────────
# Un servidor por generación sellada (``scripts/motor_servidor.py``): paga
# una vez la verificación completa que el motor hace al arrancar y atiende
# los pedidos siguientes en milisegundos. Mismo sandbox y mismo entorno que
# ``ejecutar``; vive mientras viva este proceso y haya pedidos.

_SERVIDOR = _RAIZ / "scripts" / "motor_servidor.py"
# Segundos que un pedido espera a que el servidor termine el anterior antes de
# irse al proceso de un solo uso: casi todos los pedidos tardan menos.
_ESPERA_SERVIDOR = 5


class _Servidor:
    def __init__(self):
        self.proc = None
        self.firma = None
        self.inicio = 0
        self.candado = threading.Lock()

    def cerrar(self) -> None:
        proc, self.proc = self.proc, None
        if proc is None:
            return
        proc.kill()
        for tubo in (proc.stdin, proc.stdout):
            try:
                tubo.close()
            except OSError:
                pass
        proc.wait()

    def leer(self, timeout) -> dict:
        """La siguiente línea JSON del servidor; {} si murió o contestó otra cosa.

        Si vence el plazo mata el servidor y lanza ``TimeoutExpired``.
        """
        proc = self.proc
        vencido = threading.Event()

        def matar():
            vencido.set()
            proc.kill()

        reloj = threading.Timer(timeout, matar)
        reloj.start()
        try:
            linea = proc.stdout.readline()
        finally:
            reloj.cancel()
        if vencido.is_set():
            raise subprocess.TimeoutExpired(proc.args, timeout)
        try:
            mensaje = json.loads(linea)
        except ValueError:
            return {}
        return mensaje if isinstance(mensaje, dict) else {}


_SERVIDORES: dict = {}
_CANDADO_SERVIDORES = threading.Lock()


def segundos_servidor():
    """Age of the oldest live engine server, or None; no probe or subprocess is started."""
    with _CANDADO_SERVIDORES:
        vivos = [(s.proc, s.inicio) for s in _SERVIDORES.values()]
    inicios = [inicio for proc, inicio in vivos if proc is not None and proc.poll() is None]
    return int(time.monotonic() - min(inicios)) if inicios else None


def consultar(clave, firma, pedido, *, lectura, escritura, cwd, env, timeout):
    """Manda un pedido de solo lectura al servidor del motor de ``clave``.

    Devuelve un ``CompletedProcess`` como ``ejecutar``, o None cuando hay que
    usar ``ejecutar``: el servidor sigue ocupado con otro pedido, no arrancó,
    murió o contestó algo que no es su protocolo. Por eso los pedidos deben
    poder repetirse sin efecto: solo lecturas sobre la generación sellada.

    ``firma`` identifica el estado del corpus que quien llama acaba de
    comprobar: si cambia, el servidor se reinicia y el motor vuelve a
    verificar todo. Un plazo vencido mata el servidor y lanza
    ``TimeoutExpired``; la política ``requerido`` sin sandbox lanza
    ``SandboxNoDisponible``, igual que ``ejecutar``.
    """
    with _CANDADO_SERVIDORES:
        servidor = _SERVIDORES.setdefault(str(clave), _Servidor())
    if not servidor.candado.acquire(timeout=_ESPERA_SERVIDOR):
        return None
    try:
        # La política y la sonda se consultan en cada pedido, como en
        # ``ejecutar``: un servidor lanzado sin sandbox no sigue contestando
        # cuando la política pasa a exigirlo.
        cmd = _comando([sys.executable, str(_SERVIDOR)], lectura=lectura,
                       escritura=escritura, cwd=cwd, env=env)
        firma = (firma, _sonda()["ok"])
        if servidor.proc is not None and (
                servidor.proc.poll() is not None or servidor.firma != firma):
            servidor.cerrar()
        if servidor.proc is None:
            servidor.inicio = time.monotonic()
            servidor.proc = subprocess.Popen(
                cmd, env=env, cwd=str(cwd), stdin=subprocess.PIPE,
                stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                text=True, encoding="utf-8", errors="replace")
            servidor.firma = firma
            if servidor.leer(timeout).get("listo") is not True:
                servidor.cerrar()
                return None
        try:
            servidor.proc.stdin.write(json.dumps(pedido) + "\n")
            servidor.proc.stdin.flush()
        except OSError:
            servidor.cerrar()
            return None
        respuesta = servidor.leer(timeout)
        if (type(respuesta.get("rc")) is not int
                or not isinstance(respuesta.get("out"), str)
                or not isinstance(respuesta.get("err"), str)):
            servidor.cerrar()
            return None
        return subprocess.CompletedProcess(
            pedido.get("argv"), respuesta["rc"], respuesta["out"], respuesta["err"])
    except (subprocess.TimeoutExpired, SandboxNoDisponible):
        servidor.cerrar()
        raise
    finally:
        servidor.candado.release()


def cerrar_servidores() -> None:
    """Termina los servidores del motor de este proceso (al salir y en tests)."""
    with _CANDADO_SERVIDORES:
        servidores = list(_SERVIDORES.values())
        _SERVIDORES.clear()
    for servidor in servidores:
        with servidor.candado:
            servidor.cerrar()


atexit.register(cerrar_servidores)
