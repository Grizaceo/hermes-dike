"""Diké para Hermes: adaptador delgado sobre el motor de verificación de citas.

Native community plugin. Engine vendored unchanged from https://github.com/Grizaceo/dike
(commit and file hashes in VENDORED.json). The verifier runs in a subprocess.
No signing or engine import in Hermes.

El motor no se importa en el proceso de Hermes. Corre como subproceso, por el
mismo contrato que usa cualquier otro consumidor: `dike constancia <archivo>
--json`, con sus códigos de salida (0: todo verificado; 1: hay citas que no se
pudieron verificar; 2: error). Así el motor sigue siendo el mismo con Hermes o
sin él, y sus módulos (`lexo_cli`, `shared`, `dike_id`) no se mezclan con los
de Hermes.

El subproceso recibe un entorno mínimo y un HOME de datos del plugin: no se
le pasan las variables de credenciales del agente. Cuando el equipo lo
permite, el motor y el panel corren además dentro de bubblewrap
(``aislamiento.py``): sin red y con solo las rutas que cada comando
necesita montadas — la generación sellada en solo lectura, las cachés y el
workspace del plugin en escritura. Si bubblewrap no está disponible el
plugin sigue funcionando igual y lo declara (``aislamiento.modo``); con la
política ``sandbox: requerido`` falla cerrado. El corpus se instala, la
primera vez, en la carpeta de datos del plugin.

El adaptador llama al motor de verificación como subproceso, no a otro modelo.
Los destinos de ejecución se redirigen a datos del plugin y, dentro del
sandbox, a los montajes que cada comando declara. No firma. Conserva
evidencia del motor y delimita su alcance.
"""
from __future__ import annotations

import hashlib
import fcntl
import importlib.util
from datetime import date, datetime
import json
import stat
import re
import os
import subprocess
import sys
import tarfile
import tempfile
import unicodedata
from pathlib import Path

_RAIZ = Path(__file__).resolve().parent
_MOTOR = _RAIZ / "motor"
_CORPUS = _RAIZ / "corpus"
_PANEL = _RAIZ / "scripts" / "panel.py"
# pack_hash (16 hex del SHA-256 del árbol) del corpus vendorizado en corpus/: snapshot
# chile-base d31d3dc0… con sus correcciones de vigencia; procedencia en corpus/README.md.
PACK_HASH = 'af1422d66d1e6eee'
_USUARIO = "hermes"
_NOMBRE_CORPUS = "chile-base"
_LIMITE_TEXTO = 400_000
_LIMITE_DOCX = 10_000_000


class EntradaInvalida(ValueError):
    """Error de entrada con código fijo: el modelo puede reaccionar al motivo."""
    def __init__(self, codigo: str, mensaje: str):
        super().__init__(mensaje)
        self.codigo = codigo


class PanelError(RuntimeError):
    """Fallo del subproceso ``scripts/panel.py``, ya clasificado.

    ``kind`` ∈ {'timeout', 'engine', 'data'}: 'engine' es salida no-cero o
    JSON que no es objeto; 'data' es un JSON bien formado que trae ``error``.
    ``detalle`` ya viene sin rutas locales y recortado (como ``_limpio`` del
    dashboard), listo para mostrar.
    """
    def __init__(self, kind: str, detalle: str = ""):
        super().__init__(f"{kind}: {detalle}")
        self.kind = kind
        self.detalle = detalle


_RUTA_LOCAL_PANEL = re.compile(
    r"(?<![\w:/])/(?:[^\s,;\"']+)|(?<![\w/])[A-Za-z]:[\\/][^\s,;\"']+")


def _limpiar_rutas(texto: str) -> str:
    """Oculta localizadores locales y conserva completas las URL de evidencia."""
    partes, pos = [], 0
    for url in _URL.finditer(texto):
        partes.extend([_RUTA_LOCAL_PANEL.sub('<ruta-local>', texto[pos:url.start()]), url.group()])
        pos = url.end()
    return ''.join(partes) + _RUTA_LOCAL_PANEL.sub('<ruta-local>', texto[pos:])


def _limpio_panel(texto) -> str:
    """Quita rutas locales y recorta a 400: stderr del motor nunca sale tal cual."""
    return _limpiar_rutas(str(texto))[:400]


# Controles C0 y DEL, salvo tabulador, saltos de línea, tabulador vertical y salto de página.
_CONTROLES = re.compile(r'[\x00-\x08\x0e-\x1f\x7f]')
_DOC_SUFFIXES = {'.pdf', '.doc', '.rtf', '.odt', '.html', '.htm'}

ESQUEMA = {'name': 'dike_verificar_citas',
 'description': 'Check detected article citations against a hash-identified, dated local copy of 25 Chilean '
                'statutes. Use before claiming a citation exists, is correctly cited or is in force. Report '
                'every unverified citation and its reason; inspect no_verificadas and evidencia_temporal. '
                'Checks identity, citability and recorded temporal status, not substance or current in-force '
                'status. Absence from this corpus does not prove legal nonexistence. Engine wording in '
                'mensaje_motor/alcance_motor does not expand this scope. Accepts texto or a .md/.txt/.docx '
                'ruta. Uses temporary files, plugin data and caches: do not call if the user forbids writes; '
                'explain the conflict first. / Comprueba citas con artículo contra una copia local fechada '
                'de 25 normas chilenas, identificada por hash. Úsala antes de afirmar existencia, corrección '
                'o vigencia de una cita. Informa cada cita no verificada y su motivo; revisa no_verificadas '
                'y evidencia_temporal. Comprueba identidad, citabilidad y estado temporal registrado, no '
                'sustancia ni vigencia actual. Ausencia en este corpus no demuestra inexistencia jurídica. '
                'mensaje_motor/alcance_motor no amplían el alcance. Acepta texto o ruta .md/.txt/.docx. Usa '
                'temporales, datos del plugin y cachés: si el usuario prohíbe escrituras, no la invoques y '
                'explica el conflicto.',
 'parameters': {'type': 'object',
                'properties': {'texto': {'type': 'string',
                                         'description': 'Brief text or a passage with citations. / Texto del '
                                                        'escrito o pasaje con citas.'},
                               'ruta': {'type': 'string',
                                        'description': 'Path to .md, .txt or .docx, instead of texto. '
                                                       'Extract other formats to text. / Ruta .md, .txt o '
                                                       '.docx, en lugar de texto. Extrae otros formatos a '
                                                       'texto.'}}}}

ESQUEMA_LEER = {'name': 'dike_leer_articulo',
 'description': 'Read an article and its normative units and graph nodes from Diké’s sealed, dated local '
                'corpus (25 Chilean statutes). Use before stating what an article says, assessing relevance '
                'or quoting a footnote. Provide exactly one of cita, gid or nodo_id. AMBIGUOUS or '
                'UNRESOLVABLE returns no text: report it. This does not certify relevance or current '
                'in-force status. / Lee un artículo, sus unidades normativas y nodos del grafo en el corpus '
                'local sellado y fechado de Diké (25 normas chilenas). Úsala antes de afirmar su contenido, '
                'valorar pertinencia o citar una nota. Indica solo cita, gid o nodo_id. AMBIGUOUS o '
                'UNRESOLVABLE no devuelve texto: informa ese estado. No certifica pertinencia ni vigencia '
                'actual.',
 'parameters': {'type': 'object',
                'properties': {'cita': {'type': 'string',
                                        'description': 'Article citation, e.g. «artículo 161 del Código del '
                                                       'Trabajo». / Cita del artículo, p. ej. «artículo 161 '
                                                       'del Código del Trabajo».'},
                               'gid': {'type': 'string',
                                       'description': 'Engine identifier, e.g. cl.norma.ct:art:0161. / '
                                                      'Identificador del motor, p. ej. '
                                                      'cl.norma.ct:art:0161.'},
                               'nodo_id': {'type': 'string',
                                           'description': 'Graph node, e.g. a:207436:art_0161. / Nodo del '
                                                          'grafo, p. ej. a:207436:art_0161.'}}}}

ESQUEMA_BUSCAR = {'name': 'dike_buscar_corpus',
 'description': 'Search the 25 local Chilean statutes by content (deterministic BM25, no model or network). '
                'Results are leads, never verified citations; read them with dike_leer_articulo. / Busca por '
                'contenido en las 25 normas chilenas locales (BM25 determinista, sin modelo ni red). Son '
                'pistas, nunca citas verificadas; léelas con dike_leer_articulo.',
 'parameters': {'type': 'object',
                'properties': {'consulta': {'type': 'string',
                                            'description': 'Search terms, 1–300 characters. / Términos de '
                                                           'búsqueda, 1–300 caracteres.'},
                               'limite': {'type': 'integer',
                                          'description': 'Result limit, 1–10; default 5. / Límite de '
                                                         'resultados, 1–10; por defecto 5.'}}}}


def _textos():
    nombre = 'dike_textos'
    mod = sys.modules.get(nombre)
    if mod is None:
        spec = importlib.util.spec_from_file_location(nombre, _RAIZ / 'textos.py')
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        sys.modules[nombre] = mod
    return mod


def _idioma():
    try:
        return 'es' if _setting('idioma', 'en') == 'es' else 'en'
    except Exception:
        return 'en'


def _t(clave, **datos):
    return _textos().t(clave, _idioma(), **datos)


def _carpeta_de_datos() -> Path:
    try:
        from plugins.plugin_storage import plugin_data_dir
        return Path(plugin_data_dir("dike"))
    except ImportError:
        base = Path(os.environ.get("HERMES_HOME") or (Path.home() / ".hermes")) / "plugin-data" / "dike"
        base.mkdir(parents=True, exist_ok=True)
        return base


# Módulos propios del plugin dentro de aislamiento.MODULOS_MEDIDOS: no son
# dependencias de terceros y su carpeta ya viaja como ``motor/`` en PYTHONPATH.
_MODULOS_PROPIOS = frozenset({"lexo_cli", "dike_id", "shared", "canal_arbol"})


def _paquetes_del_anfitrion() -> list:
    """Carpetas que contienen los módulos de terceros del motor.

    La lista sale de ``aislamiento.MODULOS_MEDIDOS`` menos los módulos propios
    (una sola fuente, sin duplicar nombres). Para cada módulo se toma el padre
    de su ubicación real (find_spec → submodule_search_locations para paquetes,
    origin para módulos sueltos), deduplicado y en orden. El subproceso usa el
    mismo intérprete y necesita esas mismas carpetas para encontrar pydantic,
    yaml y las demás, sea cual sea el nombre del directorio de instalación.
    """
    carpetas, vistas = [], set()
    for nombre in _aislamiento().MODULOS_MEDIDOS:
        if nombre in _MODULOS_PROPIOS:
            continue
        try:
            spec = importlib.util.find_spec(nombre)
        except Exception:
            spec = None
        if spec is None:
            continue
        ubicacion = None
        if spec.submodule_search_locations:
            ubicacion = spec.submodule_search_locations[0]
        elif spec.origin:
            ubicacion = spec.origin
        if not ubicacion:
            continue
        carpeta = str(Path(ubicacion).resolve().parent)
        if carpeta not in vistas:
            vistas.add(carpeta)
            carpetas.append(carpeta)
    return carpetas


def _entorno(datos: Path) -> dict:
    env = {k: v for k, v in os.environ.items() if k in ("PATH", "LANG", "LC_ALL", "TZ")}
    env.update({
        "PYTHONPATH": os.pathsep.join([str(_MOTOR), *_paquetes_del_anfitrion()]),
        "PYTHONDONTWRITEBYTECODE": "1",
        "PYTHONUTF8": "1",
        "HOME": str(datos / "home"),
        "LEXO_CONFIG": str(datos / "config.yaml"),
        "DIKE_USER": _USUARIO,
        "DIKE_USERS_ROOT": str(datos / "users"),
        "DIKE_ROOTS_CACHE_DIR": str(datos / "roots_cache"),
    })
    return env


# ── Aislamiento del subproceso (bubblewrap) ─────────────────────────────

def _aislamiento():
    """Carga ``aislamiento.py`` una vez y lo comparte vía ``sys.modules``.

    El dashboard y el agente cargan este adaptador por separado (por ruta y
    como paquete): guardar el módulo en ``sys.modules`` bajo un nombre fijo
    hace que compartan la misma sonda, la misma política y el mismo motor
    en caliente.
    """
    mod = sys.modules.get("dike_aislamiento")
    if mod is None:
        spec = importlib.util.spec_from_file_location(
            "dike_aislamiento", _RAIZ / "aislamiento.py")
        mod = importlib.util.module_from_spec(spec)
        sys.modules["dike_aislamiento"] = mod
        spec.loader.exec_module(mod)
    return mod


def _setting(key, default=None):
    """Lee ``plugins.entries.dike.settings.<key>``: del ctx del agente o de la config.

    Con ctx, ``get_config`` lee esa ruta (y el subárbol ``config`` legado) y
    cualquier error suyo se propaga. Sin ctx (dashboard) se lee la misma
    configuración por ``hermes_cli``: un ImportError (sin Hermes, p. ej. en
    tests) devuelve *default*; cualquier otro fallo al leer la config también
    se propaga — un setting de sandbox ilegible no puede degradar en silencio.
    """
    if _CTX is not None:
        return _CTX.get_config(key, default)
    try:
        from hermes_cli.config import load_config_readonly
        from hermes_cli.plugins_state import _plugin_settings_entry
    except ImportError:
        return default
    entry = _plugin_settings_entry(load_config_readonly() or {}, "dike")
    if isinstance(entry, dict):
        settings = entry.get("settings")
        if isinstance(settings, dict) and key in settings:
            return settings[key]
    return default


def _politica_sandbox():
    """Valor del setting ``sandbox``: ``auto`` solo si no está puesto.

    None/'' (sin definir) → ``auto``. Cualquier otro valor —incluido uno no
    string como True, 1 o una lista— se devuelve como texto para que
    aislamiento lo trate como ``requerido`` (fail-closed), nunca como ``auto``.
    Un fallo de lectura se propaga y el proveedor de política lo vuelve
    ``requerido``.
    """
    valor = _setting("sandbox", "auto")
    return "auto" if valor is None or valor == "" else str(valor)


_aislamiento().establecer_politica(_politica_sandbox)


def _perfil_chat() -> str:
    """Perfil de Hermes donde corre el chat del escrito; '' = el perfil activo."""
    try:
        valor = _setting("perfil_chat", "")
    except Exception:
        return ""
    return valor.strip() if isinstance(valor, str) else ""


def _dike(argumentos: list, datos: Path, timeout: int = 300, *,
          lectura=None, escritura=None) -> subprocess.CompletedProcess:
    return _aislamiento().ejecutar(
        [sys.executable, "-m", "lexo_cli", *argumentos],
        lectura=lectura or [], escritura=escritura or [],
        cwd=str(datos), env=_entorno(datos), timeout=timeout)


def _panel_lectura_escritura(args: list, runtime: Path):
    """(lectura, escritura) del sandbox para un op de ``scripts/panel.py``.

    Medido con strace el 2026-11-09. Los ops ``nif`` y ``grafo personal``
    usan el workspace escribible del plugin-data (``users/``, ``home/`` y
    ``roots_cache/``) y solo LEEN ``config.yaml`` (LEXO_CONFIG apunta ahí y
    ``load_config`` lo consulta para usuario/raíz). El resto del plugin-data
    —``escritos/`` con los casos, ``privacidad/`` con los mapas seudónimos,
    ``escritor/`` con la auditoría, ``generations/``— NO se monta: queda
    invisible dentro del sandbox. Los ``grafo`` de corpus leen la generación
    sellada entera y escriben solo en sus cachés. ``users/`` de la generación
    queda siempre en solo lectura: en ambos casos ``runtime`` se monta ro y
    los subdirectorios escribibles se montan encima en rw.
    """
    runtime = Path(runtime)
    grupo = args[0] if args else ""
    if grupo == "nif":
        return [runtime / "config.yaml"], [runtime / "users", runtime / "home",
                                           runtime / "roots_cache"]
    if grupo == "grafo" and len(args) > 1 and args[1] == "personal":
        return [runtime / "config.yaml"], [runtime / "users", runtime / "home",
                                           runtime / "roots_cache"]
    return [runtime], [runtime / "home", runtime / "roots_cache"]


def _consultar_motor(instalado: dict, pedido: dict, timeout: int):
    """Pedido de solo lectura al motor en caliente de la generación instalada.

    ``instalado`` es lo que devuelve ``_asegurar_corpus``: la generación y la
    ``firma`` del estado que se acaba de comprobar. Devuelve un
    ``CompletedProcess``, o None cuando toca el proceso de un solo uso (sin
    firma, o el servidor está ocupado o caído).
    """
    firma = instalado.get('firma')
    if not firma:
        return None
    runtime = Path(instalado['generation'])
    entrada = runtime.parents[1] / 'entrada'
    entrada.mkdir(exist_ok=True)
    # El día entra en la firma: el motor resuelve la vigencia a una fecha, y
    # un servidor por día no acumula en memoria el corpus de fechas pasadas.
    return _aislamiento().consultar(
        runtime, f'{firma}:{date.today().isoformat()}', pedido,
        lectura=[runtime, entrada],
        escritura=[runtime / 'home', runtime / 'roots_cache'],
        cwd=str(runtime), env=_entorno(runtime), timeout=timeout)


def _panel_json(args: list, *, runtime, timeout: int = 90, entrada=None,
                instalado=None):
    """Corre ``scripts/panel.py`` en el subproceso del motor y parsea la salida.

    Devuelve el dict del panel en éxito. Errores tipados: ``PanelError`` con
    ``kind`` 'timeout' (plazo), 'engine' (salida no-cero o JSON no-objeto) o
    'data' (JSON con ``error``); ``SandboxNoDisponible`` se propaga sin tocar.
    ``runtime`` es la generación sellada para los ops de corpus o el
    plugin-data para nif/grafo personal. Con ``instalado`` (solo ops de
    lectura del corpus) el pedido va primero al motor en caliente.
    """
    runtime = Path(runtime)
    lectura, escritura = _panel_lectura_escritura(args, runtime)
    try:
        proc = None
        if instalado is not None:
            proc = _consultar_motor(
                instalado, {'cmd': 'panel', 'argv': args, 'stdin': entrada}, timeout)
        if proc is None:
            proc = _aislamiento().ejecutar(
                [sys.executable, str(_PANEL), *args],
                lectura=lectura, escritura=escritura,
                cwd=str(runtime), env=_entorno(runtime), timeout=timeout,
                stdin=entrada)
    except subprocess.TimeoutExpired:
        raise PanelError('timeout') from None
    salida = proc.stdout.strip()
    try:
        data = json.loads(salida) if salida else {}
    except json.JSONDecodeError:
        data = None
    if proc.returncode != 0 or not isinstance(data, dict):
        raise PanelError('engine', _limpio_panel(proc.stderr or salida))
    if data.get('error'):
        raise PanelError('data', _limpio_panel(data['error']))
    return data


def _archivos_corpus(generation: Path):
    """(ruta relativa a la generación, DirEntry) de cada archivo bajo ``users/``.

    ``os.scandir`` y no ``Path.rglob``: son ~68.000 archivos y esto corre en
    cada llamada; con pathlib el recorrido costaba más de un segundo.
    """
    desde = len(str(generation)) + 1
    pendientes = [str(generation / 'users')]
    while pendientes:
        try:
            entradas = os.scandir(pendientes.pop())
        except FileNotFoundError:
            continue
        with entradas:
            for entrada in entradas:
                if entrada.is_dir(follow_symlinks=False):
                    pendientes.append(entrada.path)
                elif entrada.is_file():
                    yield entrada.path[desde:], entrada


def _hash_archivos_corpus(generation: Path) -> dict:
    out = {}
    for nombre, entrada in _archivos_corpus(generation):
        with open(entrada.path, 'rb') as archivo:
            out[nombre] = hashlib.file_digest(archivo, 'sha256').hexdigest()
    return out


def _stat_archivos_corpus(generation: Path) -> dict:
    out = {}
    for nombre, entrada in _archivos_corpus(generation):
        info = entrada.stat()
        out[nombre] = [info.st_size, info.st_mtime_ns]
    return out


def _stat_digest(stat: dict) -> str:
    h = hashlib.sha256()
    for name in sorted(stat):
        h.update(name.encode('utf-8'))
        h.update(repr(stat[name]).encode('ascii'))
    return h.hexdigest()


# Verificaciones de integridad ya hechas en este proceso: (generation, stat-digest).
_PROC_VERIFIED = set()
_PKG_DIGESTS = {}


def _paquete_digest(paquete: Path) -> str:
    """SHA-256 del tarball, cacheado por proceso según (ruta, tamaño, mtime)."""
    info = paquete.stat()
    key = (str(paquete), info.st_size, info.st_mtime_ns)
    if key not in _PKG_DIGESTS:
        _PKG_DIGESTS.clear()
        _PKG_DIGESTS[key] = hashlib.sha256(paquete.read_bytes()).hexdigest()
    return _PKG_DIGESTS[key]


def _reescribir_stat(datos: Path, generation: Path) -> dict:
    """Refresh installed.json's stat atomically, under the exclusive lock."""
    with (datos / 'install.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        marker = generation / 'installed.json'
        record = json.loads(marker.read_text())
        record['stat'] = _stat_archivos_corpus(generation)
        tmp = generation / 'installed.json.tmp'
        tmp.write_text(json.dumps(record))
        os.replace(tmp, marker)
        return record['stat']


def _snapshots_fuera_de_generacion(generation: Path):
    """STATE.json cuyo ``snapshot`` absoluto ya no cuelga de *generation*.

    El puntero se escribió en la instalación con la ruta absoluta de esa
    época; si todo el plugin-data se movió de sitio, el byte a byte sigue
    igual pero el localizador quedó viejo. Devuelve [(archivo, estado, snapshot)].
    """
    raiz = str(generation) + os.sep
    rotos = []
    for sf in (generation / 'users').glob('*/starter/*/STATE.json'):
        try:
            state = json.loads(sf.read_text())
        except (OSError, ValueError):
            continue
        snap = state.get('snapshot')
        if isinstance(snap, str) and snap and not snap.startswith(raiz):
            rotos.append((sf, state, snap))
    return rotos


def _relativo_en_generacion(snapshot: str, generation: Path):
    """La parte de *snapshot* que vive dentro de la generación (``users/…``).

    El localizador es ``<datos>/generations/<pack>/<rel>``; *rel* empieza por
    ``users/``. Devuelve None si no se puede reconstruir.
    """
    partes = list(Path(snapshot).parts)
    try:
        gi = max(i for i, p in enumerate(partes) if p == 'generations')
        if gi + 2 >= len(partes) or partes[gi + 1] != generation.name:
            return None
        return Path(*partes[gi + 2:])
    except (ValueError, IndexError):
        return None


def _reparar_reubicacion(datos: Path, generation: Path, esperado: str) -> None:
    """Reescribe los localizadores ``snapshot`` si el plugin-data se movió.

    Solo actúa cuando hay punteros rotos. Bajo el candado de instalación:
    primero rehashea TODOS los archivos contra ``installed.json`` (los bytes
    no cambian al mover, así que esto prueba que nada más se tocó), luego
    reescribe solo el localizador, actualiza su hash y el ``stat``, y anota la
    reubicación. Cualquier discrepancia es el mismo error de integridad.
    """
    if not _snapshots_fuera_de_generacion(generation):
        return
    with (datos / 'install.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        rotos = _snapshots_fuera_de_generacion(generation)
        if not rotos:
            return
        marker = generation / 'installed.json'
        record = json.loads(marker.read_text())
        if record.get('package_sha256') != esperado:
            raise ValueError('installed generation mismatch')
        if _hash_archivos_corpus(generation) != record.get('files'):
            raise ValueError('installed corpus integrity mismatch')
        files = dict(record.get('files') or {})
        from datetime import datetime, timezone
        for sf, state, snap in rotos:
            rel = _relativo_en_generacion(snap, generation)
            if rel is None:
                raise ValueError('installed corpus integrity mismatch')
            state['snapshot'] = str(generation / rel)
            sf.write_text(json.dumps(state, indent=2))
            files[str(sf.relative_to(generation))] = hashlib.sha256(
                sf.read_bytes()).hexdigest()
        record['files'] = files
        record['stat'] = _stat_archivos_corpus(generation)
        record.setdefault('reubicaciones', []).append({
            'desde': rotos[0][2].rsplit('/generations/', 1)[0] if '/generations/' in rotos[0][2] else '',
            'hacia': str(generation),
            'fecha': datetime.now(timezone.utc).isoformat()})
        tmp = generation / 'installed.json.tmp'
        tmp.write_text(json.dumps(record))
        os.replace(tmp, marker)
        for key in [k for k in _PROC_VERIFIED if k[0] == str(generation)]:
            _PROC_VERIFIED.discard(key)


def _verificar_generacion(datos: Path, generation: Path, esperado: str) -> dict:
    """Per-call integrity: stat cache first, full SHA-256 once per process.

    ``firma`` is the digest of the stat record this call found on disk; the
    hot engine server restarts, and re-verifies everything, when it changes.
    """
    marker = generation / 'installed.json'
    record = json.loads(marker.read_text())
    if record.get('package_sha256') != esperado:
        raise ValueError('installed generation mismatch')
    stat = record.get('stat')
    if isinstance(stat, dict) and _stat_archivos_corpus(generation) == stat:
        key = (str(generation), _stat_digest(stat))
        if key not in _PROC_VERIFIED:
            if _hash_archivos_corpus(generation) != record.get('files'):
                raise ValueError('installed corpus integrity mismatch')
            _PROC_VERIFIED.add(key)
        return {'generation': str(generation), 'firma': key[1]}
    # Sin stat (instalación antigua) o stat distinto: chequeo completo ahora.
    if _hash_archivos_corpus(generation) != record.get('files'):
        raise ValueError('installed corpus integrity mismatch')
    key = (str(generation), _stat_digest(_reescribir_stat(datos, generation)))
    _PROC_VERIFIED.add(key)
    return {'generation': str(generation), 'firma': key[1]}


def _comprobar_generacion_completa(generation: Path) -> None:
    """Full SHA-256 of the installed generation against its record, now."""
    marker = generation / 'installed.json'
    if not marker.is_file():
        # Sin registro no hay instalación publicada que comparar; _verificar_generacion
        # ya rechaza una generación real sin él antes de llamar al motor.
        return
    for key in [k for k in _PROC_VERIFIED if k[0] == str(generation)]:
        _PROC_VERIFIED.discard(key)
    record = json.loads(marker.read_text())
    if _hash_archivos_corpus(generation) != record.get('files'):
        raise ValueError('installed corpus integrity mismatch')


def _descriptor_corpus() -> tuple[str, Path]:
    """Lee la única entrada admitida: SHA-256 y nombre simple del paquete."""
    entries = [line.split() for line in (_CORPUS / 'SHA256SUMS').read_text().splitlines() if line.strip()]
    if len(entries) != 1 or len(entries[0]) != 2:
        raise ValueError('invalid corpus checksum manifest')
    esperado, nombre = entries[0]
    if Path(nombre).name != nombre or not re.fullmatch(r'[0-9a-f]{64}', esperado):
        raise ValueError('invalid corpus package name or digest')
    return esperado, _CORPUS / nombre


def _estado_corpus(datos: Path) -> dict:
    """Estado registrado, sin instalar ni recalcular hashes."""
    try:
        esperado, _ = _descriptor_corpus()
    except (OSError, ValueError):
        esperado = ''
    generacion = datos / 'generations' / esperado if esperado else None
    instalado, reubicaciones = False, 0
    if generacion and generacion.is_dir():
        try:
            registro = json.loads((generacion / 'installed.json').read_text(encoding='utf-8'))
            instalado = (isinstance(registro, dict) and registro.get('package_sha256') == esperado
                         and isinstance(registro.get('files'), dict) and bool(registro['files']))
            if isinstance(registro, dict) and isinstance(registro.get('reubicaciones'), list):
                reubicaciones = len(registro['reubicaciones'])
        except (OSError, ValueError):
            pass
    return {'corpus_instalado': instalado, 'generation': generacion.name if instalado else None,
            'reubicaciones': reubicaciones}


def _asegurar_corpus(datos: Path) -> dict:
    """Validate package and installed generation; publish only complete installs."""
    datos.mkdir(parents=True, exist_ok=True)
    esperado, paquete = _descriptor_corpus()
    if _paquete_digest(paquete) != esperado:
        raise ValueError('corpus package checksum mismatch')
    generation = datos / 'generations' / esperado
    generation.parent.mkdir(parents=True, exist_ok=True)
    if generation.exists():
        _reparar_reubicacion(datos, generation, esperado)
        return _verificar_generacion(datos, generation, esperado)
    with (datos / 'install.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if generation.exists():
            _reparar_reubicacion(datos, generation, esperado)
            return _verificar_generacion(datos, generation, esperado)
        with tempfile.TemporaryDirectory(dir=generation.parent, prefix='staging-') as tmp:
            stage = Path(tmp) / 'generation'
            stage.mkdir()
            (stage / 'home').mkdir()
            (stage / 'config.yaml').write_text('starter:\n  user: hermes\n')
            unpack = Path(tmp) / 'unpack'
            unpack.mkdir()
            with tarfile.open(paquete) as tar:
                tar.extractall(unpack, filter='data')
            result = _dike(['starter', '--user', _USUARIO, 'install', str(unpack / _NOMBRE_CORPUS),
                            '--name', _NOMBRE_CORPUS, '--json'], stage,
                           lectura=[unpack], escritura=[stage])
            if result.returncode != 0:
                raise subprocess.CalledProcessError(result.returncode, ['starter', 'install'], stderr=result.stderr)
            if not isinstance(json.loads(result.stdout), dict):
                raise ValueError('corpus installation failed')
            # Starter STATE carries a local absolute snapshot locator. Relocate
            # that locator before publishing; sealed snapshot content is untouched.
            for state_file in (stage / 'users').glob('*/starter/*/STATE.json'):
                state = json.loads(state_file.read_text())
                snapshot = Path(state['snapshot'])
                state['snapshot'] = str(generation / snapshot.relative_to(stage))
                state_file.write_text(json.dumps(state, indent=2))
            files = {str(p.relative_to(stage)): hashlib.sha256(p.read_bytes()).hexdigest()
                     for p in (stage / 'users').rglob('*') if p.is_file()}
            if not files:
                raise ValueError('corpus installation produced no data')
            (stage / 'installed.json').write_text(json.dumps(
                {'package_sha256': esperado, 'files': files,
                 'stat': _stat_archivos_corpus(stage)}))
            stage.rename(generation)
    return _verificar_generacion(datos, generation, esperado)


# ── Adaptador: clasificación de errores ──────────────────────────────

def _error_adaptador(raw, stderr="", *, returncode=None):
    """Return controlled diagnostics only; never forward exception/stderr text."""
    aislado = _aislamiento().estado()
    code = 'ADAPTER_ERROR'
    message = _t('error.adapter')
    if isinstance(raw, _aislamiento().SandboxNoDisponible):
        return {'error': f"SANDBOX_UNAVAILABLE: {_t('error.sandbox')}", 'error_code': 'SANDBOX_UNAVAILABLE',
                'todo_verificado': False, 'aislamiento': aislado}
    if isinstance(raw, subprocess.TimeoutExpired):
        code, message = 'TIMEOUT', _t('error.timeout')
    elif returncode is not None and returncode not in (0, 1):
        code, message = 'ENGINE_EXIT_ERROR', _t('error.engine_exit')
    elif isinstance(raw, json.JSONDecodeError):
        code = 'ENGINE_EXIT_ERROR' if returncode == 1 else 'ENGINE_JSON_ERROR'
        message = _t('error.engine_json')
    elif isinstance(raw, subprocess.CalledProcessError):
        code, message = 'ENGINE_EXIT_ERROR', _t('error.engine_install')
        stderr = raw.stderr if isinstance(raw.stderr, str) else ''
    elif isinstance(raw, EntradaInvalida):
        return {'error': f'INPUT_ERROR: {raw}', 'error_code': 'INPUT_ERROR',
                'motivo': raw.codigo, 'todo_verificado': False, 'aislamiento': aislado}
    elif isinstance(raw, PanelError):
        if raw.kind == 'timeout':
            code, message = 'TIMEOUT', _t('error.panel_timeout')
        elif raw.kind == 'data':
            return {'error': "PANEL_ERROR: " + _t('error.panel_input'),
                    'error_code': 'PANEL_ERROR', 'motivo': 'PANEL_DATA',
                    'todo_verificado': False, 'aislamiento': aislado}
        else:
            code, message = 'ENGINE_EXIT_ERROR', _t('error.panel_exit')
    elif isinstance(raw, (ValueError, TypeError, KeyError)):
        code, message = 'CONTRACT_OR_INPUT_ERROR', _t('error.contract')
        # Fixed diagnostics, no raw interpolation. The English phrase stays as a stable marker.
        if isinstance(raw, ValueError) and str(raw) == 'installed corpus integrity mismatch':
            code, message = 'CORPUS_INTEGRITY_ERROR', (
                _t('error.integrity'))
    elif isinstance(raw, OSError):
        code, message = 'IO_ERROR', _t('error.io')
    # Classify known missing-dependency signatures without echoing arbitrary content.
    if code == 'ENGINE_EXIT_ERROR' and 'ModuleNotFoundError' in stderr:
        message = _t('error.dependency')
    return {'error': f'{code}: {message}', 'error_code': code,
            'todo_verificado': False, 'aislamiento': aislado}


# ── Validación del contrato de constancia ────────────────────────────────

_GID_VERIFICADO = re.compile(r'cl\.[^\s:]+:art:[0-9a-z_]+')

def _validar_constancia(c, code, *, as_of=None):
    """Validate actual constancia variants; abstention never certifies anything."""
    if not isinstance(c, dict) or type(code) is not int or code not in (0, 1):
        raise ValueError('invalid constancia envelope or exit code')
    verdict = c.get('veredicto')
    if verdict not in ('SIN_CITAS', 'SIN_CORPUS', 'TODAS_VERIFICADAS', 'CON_PROBLEMAS'):
        raise ValueError('invalid verdict')
    for key, kind in [('meta', dict), ('detalles', list), ('citation_disclosure', dict)]:
        if not isinstance(c.get(key), kind):
            raise ValueError('invalid constancia field')
    disclosure = c['citation_disclosure']
    for key in ('no_verificadas', 'advertencias'):
        values = disclosure.get(key)
        if not isinstance(values, list) or any(not isinstance(v, str) for v in values):
            raise ValueError('invalid disclosure')
    meta = c['meta']
    if not isinstance(meta.get('as_of'), str) or not isinstance(meta.get('fecha_constancia'), str):
        raise ValueError('missing temporal metadata')
    day = date.fromisoformat(meta['as_of'])
    if day.isoformat() != meta['as_of']:
        raise ValueError('invalid ISO date')
    stamp = datetime.fromisoformat(meta['fecha_constancia'])
    if stamp.tzinfo is None:
        raise ValueError('timestamp must include timezone')
    expected = as_of or date.today().isoformat()
    if meta['as_of'] != expected:
        raise ValueError('as_of mismatch')
    expected_pack = 'sin-corpus' if verdict == 'SIN_CORPUS' else PACK_HASH
    if meta.get('pack_hash') != expected_pack:
        raise ValueError('unexpected corpus pack_hash')
    abstention = verdict in ('SIN_CITAS', 'SIN_CORPUS')
    if abstention:
        if c['detalles'] != [] or code != (0 if verdict == 'SIN_CITAS' else 1):
            raise ValueError('invalid abstention')
        if not isinstance(c.get('mensaje'), str) or not c['mensaje'].strip():
            raise ValueError('missing abstention explanation')
        for key in ('total_citas', 'citas_verificadas', 'citas_fallidas'):
            if key in meta and (type(meta[key]) is not int or meta[key] != 0):
                raise ValueError('abstention contradicts counts')
        return c
    if not isinstance(c.get('alcance'), str) or not c['alcance'].strip():
        raise ValueError('invalid scope')
    if not isinstance(c.get('problemas'), list) or any(not isinstance(v, str) for v in c['problemas']):
        raise ValueError('invalid problems')
    counts = [meta.get(k) for k in ('total_citas', 'citas_verificadas', 'citas_fallidas')]
    if any(type(n) is not int or n < 0 for n in counts):
        raise ValueError('invalid counts')
    total, verified, failed = counts
    if total != verified + failed or total != len(c['detalles']) or total == 0:
        raise ValueError('inconsistent citation counts')
    for detail in c['detalles']:
        if not isinstance(detail, dict) or detail.get('estado') not in ('VERIFICADA', 'FALLO'):
            raise ValueError('invalid citation detail')
        if not isinstance(detail.get('cita_raw'), str) or not detail['cita_raw'].strip():
            raise ValueError('missing citation text')
        if detail['estado'] == 'VERIFICADA':
            for key in ('gid', 'fuente_url', 'fecha_recuperacion'):
                if not isinstance(detail.get(key), str) or not detail[key].strip():
                    raise ValueError('missing verified evidence')
            # Forma de la evidencia: un gid de norma chilena y una URL de fuente.
            if not _GID_VERIFICADO.fullmatch(detail['gid']):
                raise ValueError('invalid verified gid')
            if not detail['fuente_url'].startswith(('https://', 'http://')):
                raise ValueError('invalid verified source')
            if not isinstance(detail.get('texto_hash'), str) or not re.fullmatch(r'[0-9a-f]{64}', detail['texto_hash']):
                raise ValueError('invalid verified hash')
            if (detail.get('resolucion') != 'RESOLVED' or detail.get('vigencia') != 'IN_FORCE'
                    or detail.get('estado_texto_historico') != 'CURRENT_VERSION_APPLIES'):
                raise ValueError('contradictory verified evidence')
            retrieved = datetime.fromisoformat(detail['fecha_recuperacion'])
            if retrieved.tzinfo is None or retrieved.date() > day:
                raise ValueError('invalid retrieval date')
    if verified != sum(d['estado'] == 'VERIFICADA' for d in c['detalles']):
        raise ValueError('details disagree with counts')
    all_verified = verdict == 'TODAS_VERIFICADAS'
    if code != (0 if all_verified else 1) or (all_verified and (failed or c['problemas'])):
        raise ValueError('verdict contradicts counts or exit code')
    return c


# ── Guarda fail-closed: una cita con dos cuerpos legales no se certifica ──
# El motor puede pegar a una cita el cuerpo de la línea anterior cuando esta
# no termina en puntuación («…del Código del Trabajo\nartículo 161 del Código
# Civil» salía VERIFICADA como Código del Trabajo). Esta guarda solo degrada:
# si el texto de la cita nombra un cuerpo antes de su última mención de
# artículo y otro distinto después del número, la cita queda sin certificar.

_MARCA_ARTICULO = re.compile(r'\bart(?:[íi]culo)?s?\b\.?', re.IGNORECASE)
_HASTA_NUMERO = re.compile(r'\D{0,12}?\d[\d.]*')
_CUERPO_EN_TEXTO = re.compile(
    r'c[oó]digo\s+(?:(?:de|del|la|las|los|el)\s+)*(?P<cod>[a-záéíóúñ]+)(?:\s+(?P<cod2>[a-záéíóúñ]+))?'
    r'|(?P<const>constituci[oó]n)'
    r'|\b(?P<tipo>ley|decreto|d\.?\s?f\.?\s?l\.?|d\.?\s?l\.?)\s*(?:n[°º.]*\s*)?(?P<num>\d[\d.]*\d|\d)',
    re.IGNORECASE)
_SIN_TILDE = str.maketrans('áéíóúÁÉÍÓÚ', 'aeiouAEIOU')


def _cuerpo(m):
    """(clave normalizada, texto tal como aparece) de un cuerpo legal nombrado."""
    if m.group('cod'):
        palabra = m.group('cod').lower().translate(_SIN_TILDE)
        fin = m.end('cod')
        if palabra in ('procedimiento', 'procesal') and m.group('cod2'):
            palabra += ' ' + m.group('cod2').lower().translate(_SIN_TILDE)
            fin = m.end('cod2')
        return 'codigo ' + palabra, m.string[m.start():fin]
    if m.group('const'):
        return 'constitucion', m.group(0)
    tipo = re.sub(r'[\s.]', '', m.group('tipo').lower())
    return f"{tipo} {m.group('num').replace('.', '')}", m.group(0)


def _cuerpos_en_conflicto(cita_raw: str):
    """(antes, después) si la cita nombra dos cuerpos distintos; si no, None."""
    marcas = list(_MARCA_ARTICULO.finditer(cita_raw or ''))
    if not marcas:
        return None
    antes = cita_raw[:marcas[-1].start()]
    despues = cita_raw[marcas[-1].end():]
    numero = _HASTA_NUMERO.match(despues)
    if numero:
        despues = despues[numero.end():]
    previos = [_cuerpo(m) for m in _CUERPO_EN_TEXTO.finditer(antes)]
    siguientes = [_cuerpo(m) for m in _CUERPO_EN_TEXTO.finditer(despues)]
    if previos and siguientes and previos[-1][0] != siguientes[0][0]:
        return previos[-1][1], siguientes[0][1]
    return None




def _degradar_cuerpos_en_conflicto(c):
    """Degrade VERIFICADA details whose text names two different legal bodies."""
    if c['veredicto'] not in ('TODAS_VERIFICADAS', 'CON_PROBLEMAS'):
        return c
    degradadas = 0
    for detail in c['detalles']:
        if detail.get('estado') != 'VERIFICADA':
            continue
        conflicto = _cuerpos_en_conflicto(detail.get('cita_raw', ''))
        if not conflicto:
            continue
        descartado = detail.get('gid')
        detail.update({
            'estado': 'FALLO', 'resolucion': 'AMBIGUOUS', 'gid': None, 'cuerpo': None,
            'texto_hash': None, 'fuente_url': '', 'fecha_recuperacion': '',
            'vigencia': 'DESCONOCIDO', 'vigencia_legible': 'vigencia desconocida',
            'estado_texto_historico': 'EVIDENCE_UNAVAILABLE',
            'motivo_adaptador': _t('guard.detail', before=conflicto[0], after=conflicto[1], gid=descartado),
        })
        degradadas += 1
    if not degradadas:
        return c
    meta = c['meta']
    meta['citas_verificadas'] -= degradadas
    meta['citas_fallidas'] += degradadas
    c['veredicto'] = 'CON_PROBLEMAS'
    c['problemas'] = [*c['problemas'], _t('guard.problem')]
    vigentes = {str(d['gid']).rsplit(':', 1)[-1] for d in c['detalles'] if d.get('estado') == 'VERIFICADA'}
    disclosure = c['citation_disclosure']
    if isinstance(disclosure.get('verificadas'), list):
        disclosure['verificadas'] = [t for t in disclosure['verificadas'] if t in vigentes]
    return c


_CTX = None


def _cwd_sesion():
    """The calling session's cwd; None when Hermes does not report one (gateway sessions)."""
    if _CTX is None:
        return Path(os.getcwd())
    try:
        cwd = _CTX.session_cwd()
    except Exception:
        cwd = ""
    return Path(cwd) if cwd else None


# ── Lectura DOCX independiente del modo de importación del plugin ───────

def _texto_docx(data: bytes) -> str:
    """Traduce errores del lector independiente al contrato público de entrada."""
    nombre = 'dike_lector_docx'
    lector = sys.modules.get(nombre)
    if lector is None:
        spec = importlib.util.spec_from_file_location(nombre, _RAIZ / 'lector_docx.py')
        lector = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(lector)
        sys.modules[nombre] = lector
    try:
        return lector.leer(data, limite=_LIMITE_TEXTO)
    except lector.DocxInvalido:
        raise EntradaInvalida('INPUT_DOCX', _t('input.docx')) from None


def _texto_input(args):
    """Devuelve el texto del escrito; un .docx se extrae aquí, no en el motor."""
    if not isinstance(args, dict) or set(args) - {'texto', 'ruta'}:
        raise EntradaInvalida('INPUT_FIELDS', _t('input.fields'))
    if ('texto' in args) == ('ruta' in args):
        raise EntradaInvalida('INPUT_FIELDS', _t('input.fields'))
    value = args.get('texto') if 'texto' in args else args.get('ruta')
    if not isinstance(value, str) or not value.strip():
        raise EntradaInvalida('INPUT_EMPTY', _t('input.empty'))
    if 'ruta' in args:
        # check symlinks on the original path, then resolve for safety.
        path = Path(value).expanduser()
        if not path.is_absolute():
            base = _cwd_sesion()
            if base is None:
                raise EntradaInvalida('INPUT_RELATIVE', _t('input.relative'))
            path = base / path
        suffix = path.suffix.lower()
        if suffix not in ('.md', '.txt', '.docx'):
            raise EntradaInvalida('INPUT_EXTENSION', _t('input.extension'))
        if any(p.is_symlink() for p in [path, *path.parents]):
            raise EntradaInvalida('INPUT_SYMLINK', _t('input.symlink'))
        # resolve after symlink check to handle any remaining edge cases.
        path = path.resolve()
        try:
            fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        except OSError:
            raise EntradaInvalida('INPUT_NOT_FOUND', _t('input.not_found')) from None
        limite = _LIMITE_DOCX if suffix == '.docx' else _LIMITE_TEXTO
        try:
            with os.fdopen(fd, 'rb') as stream:
                if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode):
                    raise EntradaInvalida('INPUT_NOT_FOUND', _t('input.not_found'))
                data = stream.read(limite + 1)
        except OSError:
            raise EntradaInvalida('INPUT_NOT_FOUND', _t('input.not_found')) from None
        if len(data) > limite:
            raise EntradaInvalida('INPUT_TOO_LARGE', _t('input.too_large'))
        if suffix == '.docx':
            value = _texto_docx(data)
        else:
            try:
                value = data.decode('utf-8')
            except UnicodeDecodeError:
                raise EntradaInvalida('INPUT_ENCODING', _t('input.encoding')) from None
    if not value.strip():
        raise EntradaInvalida('INPUT_EMPTY', _t('input.empty'))
    try:
        tamano = len(value.encode('utf-8'))
    except UnicodeEncodeError:
        raise EntradaInvalida('INPUT_ENCODING', _t('input.unicode')) from None
    if tamano > _LIMITE_TEXTO:
        raise EntradaInvalida('INPUT_TOO_LARGE', _t('input.too_large'))
    # Un NUL dentro de «16\x001» hacía que el motor certificara el artículo 16.
    if _CONTROLES.search(value):
        raise EntradaInvalida('INPUT_CONTROL', _t('input.control'))
    return value


_URL = re.compile(r'https?://[^\s"\'<>]+')
_LIMITE_MENCION = 300
_LIMITE_PROBLEMA = 1000
_LIMITE_MENCIONES = 200


def _acotar(lista, largo):
    """Recorta strings reflejados del escrito: una mención de 400 KB volvía entera,
    dos veces, al contexto del modelo. Solo se recorta lo que se muestra, nunca
    cita_raw, que la interfaz busca tal cual en el texto."""
    if not isinstance(lista, list):
        return lista
    out = [v[:largo] + _t('limit.characters', count=len(v) - largo) if isinstance(v, str) and len(v) > largo else v
           for v in lista[:_LIMITE_MENCIONES]]
    if len(lista) > _LIMITE_MENCIONES:
        out.append(_t('limit.more', count=len(lista) - _LIMITE_MENCIONES))
    return out


def _salida_publica(c):
    """Distinguish engine evidence, detected citations and unverified mentions."""
    no_verificadas = c['citation_disclosure']['no_verificadas']
    detected_verified = c['veredicto'] == 'TODAS_VERIFICADAS'
    messages = {
        'TODAS_VERIFICADAS': _t('summary.verified'),
        'CON_PROBLEMAS': _t('summary.problems'),
        'SIN_CITAS': _t('summary.no_citations'),
        'SIN_CORPUS': _t('summary.no_corpus'),
    }
    temporal = []
    day = date.fromisoformat(c['meta']['as_of'])
    for detail in c['detalles']:
        if detail['estado'] == 'VERIFICADA':
            retrieved = datetime.fromisoformat(detail['fecha_recuperacion'])
            temporal.append({'gid': detail['gid'], 'fecha_recuperacion': detail['fecha_recuperacion'],
                             'antiguedad_dias': (day - retrieved.date()).days})
    aislado = _aislamiento().estado()
    if aislado.get('modo') == 'bwrap':
        efecto_subproceso = _t('effects.sandbox')
    else:
        efecto_subproceso = _t('effects.no_sandbox', reason=aislado.get('motivo', 'OTRO'))
    out = {k: c[k] for k in ('veredicto', 'detalles', 'citation_disclosure', 'problemas') if k in c}
    out.update({
        'mensaje': messages[c['veredicto']],
        'mensaje_motor': c.get('mensaje'),
        'alcance': _t('scope.verification'),
        'alcance_motor': c.get('alcance'),
        'todas_citas_detectadas_verificadas': detected_verified,
        'todo_verificado': detected_verified and not no_verificadas,
        'certificacion_sustantiva': False,
        'certificacion_vigencia_actual': False,
        'no_verificadas': _acotar(no_verificadas, _LIMITE_MENCION),
        'evidencia_temporal': temporal,
        'efectos_de_ejecucion': [efecto_subproceso, _t('effects.temporary'),
                                _t('effects.corpus'), _t('effects.cache')],
        'aislamiento': aislado,
        'meta': {k: c['meta'][k] for k in ('origen', 'as_of', 'fecha_constancia', 'pack_hash',
                                        'total_citas', 'citas_verificadas', 'citas_fallidas') if k in c['meta']},
    })
    out['meta']['documento'] = 'escrito'
    out['meta']['certificacion_vigencia_actual'] = False
    out['citation_disclosure'] = {**out['citation_disclosure'],
                                  'no_verificadas': _acotar(no_verificadas, _LIMITE_MENCION)}
    if 'problemas' in out:
        out['problemas'] = _acotar(out['problemas'], _LIMITE_PROBLEMA)
    def clean(value):
        if isinstance(value, dict): return {k: clean(v) for k, v in value.items()}
        if isinstance(value, list): return [clean(v) for v in value]
        return _limpiar_rutas(value) if isinstance(value, str) else value

    return clean(out)


# ── Herramientas de lectura del artículo y búsqueda del corpus ──────────
# Argumentos de texto breve (cita, gid, nodo_id, consulta): nunca rutas.

_EXT_ARCHIVO = re.compile(r'\.(?:md|txt|docx|pdf|json|py|ya?ml|html?)$',
                          re.IGNORECASE)


def _texto_corto(nombre: str, valor) -> str:
    """Texto breve y seguro (1–300): sin controles ni pinta de ruta/archivo."""
    if not isinstance(valor, str):
        raise EntradaInvalida('INPUT_TYPE', _t('input.short_type', name=nombre))
    v = valor.strip()
    if not (1 <= len(v) <= 300):
        raise EntradaInvalida('INPUT_LENGTH',
                              _t('input.short_length', name=nombre))
    if any(unicodedata.category(c).startswith('C') for c in v):
        raise EntradaInvalida('INPUT_CONTROL',
                              _t('input.short_control', name=nombre))
    if ('/' in v or '\\' in v or v.startswith('~') or v.startswith('.')
            or _EXT_ARCHIVO.search(v)):
        raise EntradaInvalida('INPUT_PATH',
                              _t('input.short_path', name=nombre))
    return v


def _campos_leer(args) -> tuple:
    """(clave, valor) del único campo cita|gid|nodo_id, ya validado."""
    if not isinstance(args, dict):
        raise EntradaInvalida('INPUT_FIELDS', _t('read.fields'))
    presentes = [k for k in ('cita', 'gid', 'nodo_id') if k in args]
    if len(presentes) != 1 or set(args) - {'cita', 'gid', 'nodo_id'}:
        raise EntradaInvalida('INPUT_FIELDS', _t('read.fields'))
    clave = presentes[0]
    return clave, _texto_corto(clave, args[clave])


def _alcance_lectura() -> dict:
    return {
        'pack_hash': PACK_HASH,
        'certificacion_sustantiva': False,
        'alcance': (_t('scope.read')),
        'aislamiento': _aislamiento().estado(),
    }


def leer_articulo(args: dict, **kwargs) -> str:
    """Handler de ``dike_leer_articulo``: texto del artículo y sus unidades."""
    try:
        clave, valor = _campos_leer(args)
        datos = _carpeta_de_datos().resolve()
        installed = _asegurar_corpus(datos)
        runtime = Path(installed.get('generation', datos))
        payload = json.dumps({clave: valor}, ensure_ascii=False)
        data = _panel_json(['grafo', 'leer'], runtime=runtime, entrada=payload,
                           instalado=installed)
        base = _alcance_lectura()
        if data.get('resolucion') != 'RESOLVED':
            res = {k: data[k] for k in
                   ('resolucion', 'candidatos', 'motivo', 'failure_kind',
                    'gid', 'nodo_id') if k in data}
            return json.dumps({**res, **base}, ensure_ascii=False)
        # Segunda capa: el texto devuelto debe reproducir su propio sha256.
        real = hashlib.sha256(
            (data.get('texto') or '').encode('utf-8')).hexdigest()
        if real != data.get('texto_sha256'):
            raise ValueError('installed corpus integrity mismatch')
        return json.dumps({**data, **base}, ensure_ascii=False)
    except Exception as exc:
        return json.dumps(_error_adaptador(exc), ensure_ascii=False)


def buscar_corpus(args: dict, **kwargs) -> str:
    """Handler de ``dike_buscar_corpus``: pistas BM25, nunca citas verificadas."""
    try:
        if not isinstance(args, dict) or not set(args) <= {'consulta', 'limite'}:
            raise EntradaInvalida('INPUT_FIELDS', _t('search.fields'))
        if 'consulta' not in args:
            raise EntradaInvalida('INPUT_FIELDS', _t('search.query_missing'))
        consulta = _texto_corto('consulta', args['consulta'])
        limite = args.get('limite', 5)
        if isinstance(limite, bool) or not isinstance(limite, int):
            raise EntradaInvalida('INPUT_TYPE', _t('search.limit_type'))
        if not (1 <= limite <= 10):
            raise EntradaInvalida('INPUT_RANGE',
                                  _t('search.limit_range'))
        datos = _carpeta_de_datos().resolve()
        installed = _asegurar_corpus(datos)
        runtime = Path(installed.get('generation', datos))
        payload = json.dumps({'q': consulta, 'limite': limite},
                             ensure_ascii=False)
        data = _panel_json(['grafo', 'buscar'], runtime=runtime,
                           timeout=120, entrada=payload, instalado=installed)
        rotulo = _t('search.lead')
        resultados = [{
            'nodo_id': r.get('nodo_id'),
            'gid': r.get('gid'),
            'cita': r.get('cita'),
            'label': r.get('label'),
            'score': r.get('score'),
            'vigencia': r.get('vigencia'),
            'rotulo': rotulo,
        } for r in (data.get('resultados') or [])]
        return json.dumps({
            'resultados': resultados,
            'rotulo': rotulo,
            'metodo': data.get('metodo'),
            'pack_hash': PACK_HASH,
            'aislamiento': _aislamiento().estado(),
        }, ensure_ascii=False)
    except Exception as exc:
        return json.dumps(_error_adaptador(exc), ensure_ascii=False)


# ── nodo_id en las citas verificadas (enriquecimiento, nunca cambia el veredicto)

_NODO_ID_SAFE = re.compile(r'^a:\d+:[A-Za-z0-9_]+$')
_NODOS_MEM: dict = {}


def _token_articulo(eid: str) -> str:
    """La regla de ``StarterCorpusResolver._article_token``, reimplementada."""
    token = eid.removeprefix('art_').lower()
    if token.isdigit():
        return f'{int(token):04d}'
    return token.replace('-', '_')


def _mapa_nodos(datos: Path, instalado=None):
    """``{gid: nodo_id}`` del corpus; caché en disco y memoria. None si falla.

    ``instalado`` es el corpus que quien llama ya aseguró; sin él se asegura aquí.
    """
    if PACK_HASH in _NODOS_MEM:
        return _NODOS_MEM[PACK_HASH]
    mapa = None
    cache = datos / 'cache' / f'nodos_v1_{PACK_HASH}.json'
    try:
        if cache.is_file():
            guardado = json.loads(cache.read_text(encoding='utf-8'))
            if isinstance(guardado, dict) and isinstance(
                    guardado.get('nodos'), dict):
                mapa = guardado['nodos']
    except (OSError, json.JSONDecodeError):
        mapa = None
    if mapa is None:
        try:
            instalado = instalado or _asegurar_corpus(datos)
            runtime = Path(instalado.get('generation', datos))
            data = _panel_json(['grafo', 'nodos'], runtime=runtime,
                               entrada='{}', instalado=instalado)
            nodos = data.get('nodos')
            if isinstance(nodos, dict):
                mapa = nodos
                try:
                    cache.parent.mkdir(parents=True, exist_ok=True)
                    tmp = cache.with_suffix('.tmp')
                    tmp.write_text(json.dumps({'nodos': mapa},
                                              ensure_ascii=False),
                                   encoding='utf-8')
                    tmp.replace(cache)
                except OSError:
                    pass
        except Exception:
            mapa = None
    # Solo se memoiza un índice válido: un fallo transitorio no debe apagar
    # nodo_id para el resto del proceso — el próximo intento reintenta.
    if mapa is not None:
        _NODOS_MEM[PACK_HASH] = mapa
    return mapa


def _nodo_id_para_gid(gid, mapa) -> str | None:
    """``nodo_id`` válido para ``gid``, o None. Nunca lanza ni inventa."""
    try:
        if not isinstance(gid, str) or not isinstance(mapa, dict):
            return None
        nodo = mapa.get(gid)
        if not isinstance(nodo, str) or not _NODO_ID_SAFE.fullmatch(nodo):
            return None
        partes = nodo.split(':')
        if len(partes) != 3:
            return None
        eid = partes[2]
        # El token del eId debe ser el mismo que el sufijo :art: del gid.
        if ':art:' not in gid:
            return None
        if gid.rsplit(':art:', 1)[-1] != _token_articulo(eid):
            return None
        return nodo
    except Exception:
        return None


def _enriquecer_nodo_id(c, datos: Path, instalado=None):
    """Añade ``nodo_id`` a cada detalle VERIFICADA; nunca toca el veredicto.

    Se aplica tras ``_degradar_cuerpos_en_conflicto`` y solo a detalles
    VERIFICADA. Cualquier fallo del índice (build, caché corrupta, sandbox)
    omite el campo sin cambiar estado, conteos, veredicto ni problemas.
    """
    try:
        detalles = c.get('detalles') or []
        if not any(isinstance(d, dict) and d.get('estado') == 'VERIFICADA'
                   for d in detalles):
            return c
        mapa = _mapa_nodos(datos, instalado)
        if not mapa:
            return c
        for d in detalles:
            if not isinstance(d, dict) or d.get('estado') != 'VERIFICADA':
                continue
            nodo = _nodo_id_para_gid(d.get('gid'), mapa)
            if nodo:
                d['nodo_id'] = nodo
    except Exception:
        pass
    return c


def verificar_citas(args: dict, **kwargs) -> str:
    stdout, stderr, returncode = '', '', None
    try:
        contenido = _texto_input(args)
        expected_day = date.today().isoformat()
        datos = _carpeta_de_datos().resolve()
        installed = _asegurar_corpus(datos)
        runtime = Path(installed.get('generation', datos))
        entrada = datos / 'entrada'
        entrada.mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(dir=entrada) as tmp:
            archivo = Path(tmp) / 'escrito.md'
            archivo.write_text(contenido, encoding='utf-8')
            argv = ['constancia', str(archivo), '--as-of', expected_day, '--json']
            result = _consultar_motor(
                installed, {'cmd': 'motor', 'argv': argv, 'as_of': expected_day}, 300)
            if result is None:
                result = _dike(argv, runtime, lectura=[runtime, archivo.parent],
                               escritura=[runtime / 'home', runtime / 'roots_cache'])
        stdout, stderr, returncode = result.stdout, result.stderr, result.returncode
        if returncode not in (0, 1):
            return json.dumps(_error_adaptador(None, stderr, returncode=returncode), ensure_ascii=False)
        try:
            c = _validar_constancia(json.loads(stdout), returncode, as_of=expected_day)
        except json.JSONDecodeError as exc:
            return json.dumps(_error_adaptador(exc, stderr, returncode=returncode), ensure_ascii=False)
        if c['veredicto'] == 'SIN_CORPUS' and installed.get('generation'):
            # El motor no reconoció un corpus que el adaptador dio por bueno (por
            # ejemplo, un byte cambiado con tamaño y fecha intactos en un proceso que
            # ya lo había verificado): se recalcula todo y, si difiere, es corrupción.
            _comprobar_generacion_completa(Path(installed['generation']))
        c = _degradar_cuerpos_en_conflicto(c)
        c = _enriquecer_nodo_id(c, datos, installed)
        return json.dumps(_salida_publica(c), ensure_ascii=False)
    except Exception as exc:
        return json.dumps(_error_adaptador(exc, stderr, returncode=returncode), ensure_ascii=False)


def _linea_aislamiento(out: dict) -> str:
    aislado = out.get('aislamiento') or {}
    if aislado.get('modo') == 'bwrap':
        return _t('command.isolated')
    return _t('command.degraded', reason=aislado.get('motivo', 'OTRO'))


def _motivo_fallo(detalle: dict) -> str:
    """El código del motor y, para los dos que más se ven, qué quiere decir."""
    resolucion = str(detalle.get('resolucion'))
    if resolucion == 'AMBIGUOUS':
        return f"{resolucion} ({_t('command.ambiguous')})"
    if resolucion == 'UNRESOLVABLE':
        return f"{resolucion} ({_t('command.unresolvable')})"
    return resolucion


def _formatear_salida(out: dict) -> str:
    """Texto legible del comando: el tool sigue devolviendo JSON."""
    linea = _linea_aislamiento(out)
    if 'error' in out:
        error = str(out['error'])
        message = error.split(': ', 1)[1] if ': ' in error else error
        return _t('command.error', message=message) + '\n' + linea
    veredicto = out.get('veredicto')
    meta = out.get('meta') or {}
    if veredicto in ('SIN_CITAS', 'SIN_CORPUS'):
        return f"Diké: {out.get('mensaje') or ''}\n{linea}"
    detalles = out.get('detalles') or []
    lines = [_t('command.count', verified=meta.get('citas_verificadas'), total=meta.get('total_citas'),
                verdict=veredicto, pack=meta.get('pack_hash')), linea]
    fechas = []
    for d in detalles:
        cita = str(d.get('cita_raw') or '')[:120]
        if d.get('estado') == 'VERIFICADA':
            lines.append(f"✓ {cita} · {d.get('gid')} · {d.get('fuente_url')}")
            if d.get('fecha_recuperacion'):
                fechas.append(str(d['fecha_recuperacion'])[:10])
        else:
            lines.append(f"✗ {cita} · {_motivo_fallo(d)}")
    no_verificadas = out.get('no_verificadas') or []
    if no_verificadas:
        lines.append(_t('command.mentions', mentions=', '.join(str(v) for v in no_verificadas)))
    fecha = min(fechas) if fechas else '—'
    lines.append(_t('command.limits', date=fecha))
    return '\n'.join(lines)


def _comando(raw):
    arg = (raw or '').strip()
    if arg and len(arg) < 256 and not re.search(r'\s', arg):
        suffix = Path(arg).suffix.lower()
        if suffix in ('.md', '.txt', '.docx'):
            return _formatear_salida(json.loads(verificar_citas({'ruta': arg})))
        if suffix in _DOC_SUFFIXES:
            return _t('command.error', message=_t('input.extension'))
    return _formatear_salida(json.loads(verificar_citas({'texto': raw})))


def _version_plugin() -> str:
    try:
        import yaml
        data = yaml.safe_load((_RAIZ / "plugin.yaml").read_text(encoding="utf-8"))
        return str(data.get("version")) if isinstance(data, dict) and data.get("version") else "?"
    except Exception:
        return "?"


def _version_hermes() -> str:
    try:
        from hermes_cli.version_info import get_version_info
        return str(get_version_info().base_version)
    except Exception:
        return _t('status.unknown')


def _sha256_archivo(ruta: Path):
    try:
        return hashlib.sha256(ruta.read_bytes()).hexdigest()
    except OSError:
        return None


def _estado_datos(datos: Path) -> dict:
    """Datos de ``/dike-estado``; nunca incluye rutas absolutas."""
    aislado = _aislamiento().estado()
    corpus = _estado_corpus(datos)
    bundle = _RAIZ / "desktop" / "BUNDLE.json"
    plugin_js = _RAIZ / "desktop" / "plugin.js"
    bundle_sha = None
    try:
        bundle_sha = json.loads(bundle.read_text(encoding="utf-8")).get("sha256")
    except (OSError, ValueError):
        bundle_sha = None
    plugin_sha = _sha256_archivo(plugin_js) if plugin_js.is_file() else None
    return {
        "version": _version_plugin(),
        "hermes": _version_hermes(),
        "pack_hash": PACK_HASH,
        "corpus_instalado": corpus["corpus_instalado"],
        "reubicaciones": corpus["reubicaciones"],
        "aislamiento": aislado,
        "politica": _politica_sandbox(),
        "perfil_chat": _perfil_chat() or _t('status.active_profile'),
        "desktop_ok": bool(bundle_sha) and plugin_sha == bundle_sha,
        "desktop_presente": plugin_js.is_file(),
    }


def _estado_texto(d: dict) -> str:
    lineas = [f"Diké {d['version']} · Hermes {d['hermes']}",
              _t('status.corpus', state=_t('status.installed') if d['corpus_instalado'] else _t('status.not_installed'), pack=d['pack_hash'])]
    if d['corpus_instalado']:
        lineas.append(_t('status.integrity'))
    lineas += [_t('status.moves', count=d['reubicaciones']), _t('status.docx')]
    aislado = d.get('aislamiento') or {}
    lineas.append(_t('status.sandbox') if aislado.get('modo') == 'bwrap' else
                  _t('status.degraded', reason=aislado.get('motivo', 'OTRO'), policy=d['politica']))
    segundos = _aislamiento().segundos_servidor()
    lineas.append(_t('status.engine_running', seconds=segundos) if segundos is not None else _t('status.engine_stopped'))
    lineas.append(_t('status.profile', profile=d['perfil_chat']))
    if d['desktop_presente'] and d['desktop_ok']:
        lineas.append(_t('status.desktop_ok'))
    elif d['desktop_presente']:
        lineas.append(_t('status.desktop_mismatch'))
    else:
        lineas.append(_t('status.desktop_missing'))
    return '\n'.join(lineas)


def _comando_estado(raw):
    return _estado_texto(_estado_datos(_carpeta_de_datos().resolve()))


def _escritor_hooks():
    """Carga escritor/hooks.py por ruta, con un nombre propio: así no depende de
    cómo Hermes importe el plugin ni puede tomar otro módulo `escritor` del path."""
    spec = importlib.util.spec_from_file_location(
        "dike_escritor_hooks", _RAIZ / "escritor" / "hooks.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _descripcion_skill(ruta: Path) -> str:
    """La línea description: del frontmatter, para el listado de skills de Hermes."""
    try:
        texto = ruta.read_text(encoding='utf-8')
    except OSError:
        return ''
    cabecera = re.match(r'---\n(.*?)\n---', texto, re.DOTALL)
    linea = re.search(r'^description:\s*(.+)$', cabecera.group(1), re.MULTILINE) if cabecera else None
    return linea.group(1).strip().strip('"\'') if linea else ''


def register(ctx):
    global _CTX
    _CTX = ctx
    ctx.register_tool(name='dike_verificar_citas', toolset='dike', schema=ESQUEMA, handler=verificar_citas)
    ctx.register_tool(name='dike_leer_articulo', toolset='dike', schema=ESQUEMA_LEER, handler=leer_articulo)
    ctx.register_tool(name='dike_buscar_corpus', toolset='dike', schema=ESQUEMA_BUSCAR, handler=buscar_corpus)
    ctx.register_command('dike-verificar', _comando, _t('command.verify_description'),
                         args_hint=_t('command.verify_hint'))
    ctx.register_command('dike-estado', _comando_estado, _t('command.status_description'),
                         args_hint='')
    carpeta = _RAIZ / 'skills'
    if carpeta.is_dir():
        for hija in sorted(carpeta.iterdir()):
            if (hija / 'SKILL.md').is_file():
                ctx.register_skill(hija.name, hija / 'SKILL.md',
                                   description=_descripcion_skill(hija / 'SKILL.md'))
    _escritor_hooks().register_hooks(ctx)
