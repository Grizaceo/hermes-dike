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
le pasan las variables de credenciales del agente. Esto no es un sandbox ni
impide técnicamente acceder a otros archivos. El corpus se instala, la primera
vez, en la carpeta de datos del plugin.

El adaptador llama al motor de verificación como subproceso, no a otro modelo.
Los destinos de ejecución se redirigen a datos del plugin; no es aislamiento
del filesystem. No firma. Conserva evidencia del motor y delimita su alcance.
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
from pathlib import Path

_RAIZ = Path(__file__).resolve().parent
_MOTOR = _RAIZ / "motor"
_CORPUS = _RAIZ / "corpus"
# pack_hash (16 hex del SHA-256 del árbol) del corpus vendorizado en corpus/: snapshot
# chile-base d31d3dc0… (D2 + P12/P13), el mismo que firma el kit del hackathon (firma n.º 2).
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


_MSG_INPUT_FIELDS = "Indica exactamente uno de los dos campos: texto o ruta."
_MSG_INPUT_EMPTY = "El texto o la ruta están vacíos."
_MSG_INPUT_EXTENSION = "Solo se aceptan archivos .md, .txt o .docx. Para un .pdf u otro formato, extrae el texto y pásalo en el campo texto."
_MSG_INPUT_SYMLINK = "No se aceptan rutas con enlaces simbólicos."
_MSG_INPUT_NOT_FOUND = "No existe un archivo regular en esa ruta."
_MSG_INPUT_TOO_LARGE = "El texto o el archivo supera el límite: 400.000 bytes de texto, o 10 MB para un .docx."
_MSG_INPUT_ENCODING = "El archivo no está en UTF-8."
_MSG_INPUT_RELATIVE = "Usa una ruta absoluta: esta sesión no informa su carpeta de trabajo."
_MSG_INPUT_DOCX = "No se pudo leer el .docx: puede estar dañado o protegido."
_MSG_INPUT_CONTROL = ("El texto trae caracteres de control invisibles (por ejemplo NUL), que pueden cambiar "
                      "el número de una cita: quítalos y vuelve a intentarlo.")
_MSG_INPUT_UNICODE = "El texto trae caracteres Unicode inválidos (sustitutos sueltos): cópialo de nuevo desde el original."
# Controles C0 y DEL, salvo tabulador, saltos de línea, tabulador vertical y salto de página.
_CONTROLES = re.compile(r'[\x00-\x08\x0e-\x1f\x7f]')
_DOC_SUFFIXES = {'.pdf', '.doc', '.rtf', '.odt', '.html', '.htm'}

ESQUEMA = {
    "name": "dike_verificar_citas",
    "description": (
        "Verifica las citas de normas chilenas de un escrito jurídico contra un corpus local "
        "identificado por hash. Úsala SIEMPRE antes de afirmar que una cita legal es correcta, "
        "existe o está vigente. Devuelve, cita por cita, si se pudo verificar; las que no, vienen "
        "con el motivo (AMBIGUOUS, UNRESOLVABLE, …). Una cita no verificada NO se puede dar por "
        "buena: hay que decírselo al usuario tal cual. Comprueba identidad, citabilidad y estado "
        "de vigencia registrado en el corpus; no consulta cambios posteriores en vivo ni "
        "verifica que la norma diga lo que el escrito le atribuye. Usa archivos temporales "
        "y datos persistidos del plugin, incluyendo corpus y cachés. Si el usuario prohíbe "
        "escrituras, NO invoques esta herramienta: explica la incompatibilidad antes de actuar. "
        "No ofrece certificación sustantiva ni vigencia actual en vivo. Solo cubre citas con "
        "artículo detectadas; informa siempre no_verificadas y evidencia_temporal. Los campos "
        "mensaje_motor/alcance_motor conservan expresiones del motor, no amplían el alcance "
        "del mensaje del adaptador. Ausencia en corpus no demuestra inexistencia jurídica."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "texto": {"type": "string", "description": "El texto del escrito, o el pasaje con las citas."},
            "ruta": {"type": "string", "description": "Ruta de un archivo .md, .txt o .docx con el escrito (alternativa a `texto`). Para .pdf u otros formatos, extrae el texto y pásalo en `texto`."},
        },
    },
}


def _carpeta_de_datos() -> Path:
    try:
        from plugins.plugin_storage import plugin_data_dir
        return Path(plugin_data_dir("dike"))
    except ImportError:
        base = Path(os.environ.get("HERMES_HOME") or (Path.home() / ".hermes")) / "plugin-data" / "dike"
        base.mkdir(parents=True, exist_ok=True)
        return base


def _paquetes_del_anfitrion() -> list:
    """Las carpetas de paquetes instalados del proceso que carga el plugin.

    Hermes no corre desde un entorno con lanzador propio: activa sus dependencias
    agregándolas a `sys.path`. El subproceso usa el mismo intérprete y necesita
    esas mismas carpetas para encontrar pydantic, yaml y las demás. Solo viajan
    las carpetas de paquetes instalados, no el código de Hermes.
    """
    return [p for p in sys.path if p and ("site-packages" in p or "dist-packages" in p)]


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


def _dike(argumentos: list, datos: Path, timeout: int = 300) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, "-m", "lexo_cli", *argumentos],
        env=_entorno(datos), cwd=str(datos), capture_output=True, text=True,
        encoding="utf-8", errors="replace", timeout=timeout,
    )


def _hash_archivos_corpus(generation: Path) -> dict:
    return {str(p.relative_to(generation)): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in (generation / 'users').rglob('*') if p.is_file()}


def _stat_archivos_corpus(generation: Path) -> dict:
    out = {}
    for p in (generation / 'users').rglob('*'):
        if p.is_file():
            info = p.stat()
            out[str(p.relative_to(generation))] = [info.st_size, info.st_mtime_ns]
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


def _verificar_generacion(datos: Path, generation: Path, esperado: str) -> dict:
    """Per-call integrity: stat cache first, full SHA-256 once per process."""
    marker = generation / 'installed.json'
    record = json.loads(marker.read_text())
    if record.get('package_sha256') != esperado:
        raise ValueError('installed generation mismatch')
    stat = record.get('stat')
    if isinstance(stat, dict) and _stat_archivos_corpus(generation) == stat:
        key = (str(generation), _stat_digest(stat))
        if key in _PROC_VERIFIED:
            return {'generation': str(generation)}
        if _hash_archivos_corpus(generation) != record.get('files'):
            raise ValueError('installed corpus integrity mismatch')
        _PROC_VERIFIED.add(key)
        return {'generation': str(generation)}
    # Sin stat (instalación antigua) o stat distinto: chequeo completo ahora.
    if _hash_archivos_corpus(generation) != record.get('files'):
        raise ValueError('installed corpus integrity mismatch')
    stat = _reescribir_stat(datos, generation)
    _PROC_VERIFIED.add((str(generation), _stat_digest(stat)))
    return {'generation': str(generation)}


def _asegurar_corpus(datos: Path) -> dict:
    """Validate package and installed generation; publish only complete installs."""
    datos.mkdir(parents=True, exist_ok=True)
    entries = [line.split() for line in (_CORPUS / 'SHA256SUMS').read_text().splitlines() if line.strip()]
    if len(entries) != 1 or len(entries[0]) != 2:
        raise ValueError('invalid corpus checksum manifest')
    esperado, nombre = entries[0]
    if Path(nombre).name != nombre or not re.fullmatch(r'[0-9a-f]{64}', esperado):
        raise ValueError('invalid corpus package name or digest')
    paquete = _CORPUS / nombre
    if _paquete_digest(paquete) != esperado:
        raise ValueError('corpus package checksum mismatch')
    generation = datos / 'generations' / esperado
    generation.parent.mkdir(parents=True, exist_ok=True)
    if generation.exists():
        return _verificar_generacion(datos, generation, esperado)
    with (datos / 'install.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if generation.exists():
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
                            '--name', _NOMBRE_CORPUS, '--json'], stage)
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


# ── Adaptador: clasificación de errores P2-5 ──────────────────────────────

def _error_adaptador(raw, stdout="", stderr="", *, timeout=None, returncode=None):
    """Return controlled diagnostics only; never forward exception/stderr text."""
    code = 'ADAPTER_ERROR'
    message = 'No se pudo completar la comprobación.'
    if isinstance(raw, subprocess.TimeoutExpired):
        code, message = 'TIMEOUT', 'El motor no respondió dentro del plazo.'
    elif returncode is not None and returncode not in (0, 1):
        code, message = 'ENGINE_EXIT_ERROR', 'El motor terminó con un código de error.'
    elif isinstance(raw, json.JSONDecodeError):
        code = 'ENGINE_EXIT_ERROR' if returncode == 1 else 'ENGINE_JSON_ERROR'
        message = 'El motor no produjo una respuesta JSON válida.'
    elif isinstance(raw, subprocess.CalledProcessError):
        code, message = 'ENGINE_EXIT_ERROR', 'El motor terminó con error.'
        stderr = raw.stderr if isinstance(raw.stderr, str) else ''
    elif isinstance(raw, EntradaInvalida):
        return {'error': f'INPUT_ERROR: {raw}', 'error_code': 'INPUT_ERROR',
                'motivo': raw.codigo, 'todo_verificado': False}
    elif isinstance(raw, (ValueError, TypeError, KeyError)):
        code, message = 'CONTRACT_OR_INPUT_ERROR', 'Entrada, corpus o respuesta incompatibles con el contrato.'
        # Fixed diagnostics retained for existing integrity tests, no raw interpolation.
        if isinstance(raw, ValueError) and str(raw) == 'installed corpus integrity mismatch':
            message = 'installed corpus integrity mismatch'
    elif isinstance(raw, OSError):
        code, message = 'IO_ERROR', 'No se pudo acceder a los datos requeridos.'
    # Classify known missing-dependency signatures without echoing arbitrary content.
    if code == 'ENGINE_EXIT_ERROR' and 'ModuleNotFoundError' in stderr:
        message = 'Falta una dependencia del motor en el entorno de ejecución.'
    return {'error': f'{code}: {message}', 'error_code': code, 'todo_verificado': False}


# ── Validación del contrato de constancia ────────────────────────────────

_VERIFIED_RESOLUTION = "RESOLVED"
_VERIFIED_VIGENCIA = "IN_FORCE"
_VERIFIED_HISTORICAL = "CURRENT_VERSION_APPLIES"

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


_MSG_CUERPOS = ('Hay citas cuyo texto nombra dos cuerpos legales distintos, por ejemplo porque la '
                'línea anterior no termina en punto: Diké no las certifica. Separa cada cita con '
                'un punto o en su propio párrafo y vuelve a verificar.')


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
            'motivo_adaptador': (f'La cita nombra «{conflicto[0]}» antes del artículo y '
                                 f'«{conflicto[1]}» después; el motor la resolvió como '
                                 f'{descartado}. No se certifica.'),
        })
        degradadas += 1
    if not degradadas:
        return c
    meta = c['meta']
    meta['citas_verificadas'] -= degradadas
    meta['citas_fallidas'] += degradadas
    c['veredicto'] = 'CON_PROBLEMAS'
    c['problemas'] = [*c['problemas'], _MSG_CUERPOS]
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


def _texto_input(args):
    """Devuelve el texto del escrito; para una ruta .docx, sus bytes crudos."""
    if not isinstance(args, dict) or set(args) - {'texto', 'ruta'}:
        raise EntradaInvalida('INPUT_FIELDS', _MSG_INPUT_FIELDS)
    if ('texto' in args) == ('ruta' in args):
        raise EntradaInvalida('INPUT_FIELDS', _MSG_INPUT_FIELDS)
    value = args.get('texto') if 'texto' in args else args.get('ruta')
    if not isinstance(value, str) or not value.strip():
        raise EntradaInvalida('INPUT_EMPTY', _MSG_INPUT_EMPTY)
    if 'ruta' in args:
        # P2-2: check symlinks on the original path, then resolve for safety.
        path = Path(value).expanduser()
        if not path.is_absolute():
            base = _cwd_sesion()
            if base is None:
                raise EntradaInvalida('INPUT_RELATIVE', _MSG_INPUT_RELATIVE)
            path = base / path
        suffix = path.suffix.lower()
        if suffix not in ('.md', '.txt', '.docx'):
            raise EntradaInvalida('INPUT_EXTENSION', _MSG_INPUT_EXTENSION)
        if any(p.is_symlink() for p in [path, *path.parents]):
            raise EntradaInvalida('INPUT_SYMLINK', _MSG_INPUT_SYMLINK)
        # P2-2: resolve after symlink check to handle any remaining edge cases.
        path = path.resolve()
        try:
            fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        except OSError:
            raise EntradaInvalida('INPUT_NOT_FOUND', _MSG_INPUT_NOT_FOUND) from None
        limite = _LIMITE_DOCX if suffix == '.docx' else _LIMITE_TEXTO
        try:
            with os.fdopen(fd, 'rb') as stream:
                if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode):
                    raise EntradaInvalida('INPUT_NOT_FOUND', _MSG_INPUT_NOT_FOUND)
                data = stream.read(limite + 1)
        except OSError:
            raise EntradaInvalida('INPUT_NOT_FOUND', _MSG_INPUT_NOT_FOUND) from None
        if len(data) > limite:
            raise EntradaInvalida('INPUT_TOO_LARGE', _MSG_INPUT_TOO_LARGE)
        if suffix == '.docx':
            return data
        try:
            value = data.decode('utf-8')
        except UnicodeDecodeError:
            raise EntradaInvalida('INPUT_ENCODING', _MSG_INPUT_ENCODING) from None
    if not value.strip():
        raise EntradaInvalida('INPUT_EMPTY', _MSG_INPUT_EMPTY)
    try:
        tamano = len(value.encode('utf-8'))
    except UnicodeEncodeError:
        raise EntradaInvalida('INPUT_ENCODING', _MSG_INPUT_UNICODE) from None
    if tamano > _LIMITE_TEXTO:
        raise EntradaInvalida('INPUT_TOO_LARGE', _MSG_INPUT_TOO_LARGE)
    # Un NUL dentro de «16\x001» hacía que el motor certificara el artículo 16.
    if _CONTROLES.search(value):
        raise EntradaInvalida('INPUT_CONTROL', _MSG_INPUT_CONTROL)
    return value


def _salida_publica(c):
    """Distinguish engine evidence, detected citations and unverified mentions."""
    no_verificadas = c['citation_disclosure']['no_verificadas']
    detected_verified = c['veredicto'] == 'TODAS_VERIFICADAS'
    messages = {
        'TODAS_VERIFICADAS': 'Las citas con artículo detectadas fueron verificadas en el corpus local. No se certifican todas las referencias ni la vigencia actual.',
        'CON_PROBLEMAS': 'Hay citas detectadas que no pudieron verificarse completamente en el corpus local.',
        'SIN_CITAS': 'No se detectaron citas con artículo verificables; esto no acredita las menciones normativas del escrito.',
        'SIN_CORPUS': 'No se verificaron citas: no hay corpus disponible para contrastarlas.',
    }
    temporal = []
    day = date.fromisoformat(c['meta']['as_of'])
    for detail in c['detalles']:
        if detail['estado'] == 'VERIFICADA':
            retrieved = datetime.fromisoformat(detail['fecha_recuperacion'])
            temporal.append({'gid': detail['gid'], 'fecha_recuperacion': detail['fecha_recuperacion'],
                             'antiguedad_dias': (day - retrieved.date()).days})
    out = {k: c[k] for k in ('veredicto', 'detalles', 'citation_disclosure', 'problemas') if k in c}
    out.update({
        'mensaje': messages[c['veredicto']],
        'mensaje_motor': c.get('mensaje'),
        'alcance': 'Solo identidad, integridad y estado temporal registrado de citas con artículo detectadas. No se certifican interpretación, menciones no verificadas ni cambios posteriores a la captura de fuentes.',
        'alcance_motor': c.get('alcance'),
        'todas_citas_detectadas_verificadas': detected_verified,
        'todo_verificado': detected_verified and not no_verificadas,
        'certificacion_sustantiva': False,
        'certificacion_vigencia_actual': False,
        'no_verificadas': no_verificadas,
        'evidencia_temporal': temporal,
        'efectos_de_ejecucion': ['archivos temporales', 'instalación y uso del corpus local', 'cachés del motor'],
        'meta': {k: c['meta'][k] for k in ('origen', 'as_of', 'fecha_constancia', 'pack_hash',
                                        'total_citas', 'citas_verificadas', 'citas_fallidas') if k in c['meta']},
    })
    out['meta']['documento'] = 'escrito'
    out['meta']['certificacion_vigencia_actual'] = False
    # Redact local filesystem locators in messages, including missing-corpus reasons.
    def clean(value):
        if isinstance(value, dict): return {k: clean(v) for k, v in value.items()}
        if isinstance(value, list): return [clean(v) for v in value]
        if isinstance(value, str) and not value.startswith(('https://', 'http://')):
            value = re.sub(r'(?<![\w:/])/(?:[^\s,;\"\']+)', '<ruta-local>', value)
            value = re.sub(r'(?<![\w/])[A-Za-z]:[\\/][^\s,;\"\']+', '<ruta-local>', value)
        return value
    return clean(out)


def verificar_citas(args: dict, **kwargs) -> str:
    stdout, stderr, returncode = '', '', None
    try:
        contenido = _texto_input(args)
        es_docx = isinstance(contenido, bytes)
        expected_day = date.today().isoformat()
        datos = _carpeta_de_datos().resolve()
        installed = _asegurar_corpus(datos)
        runtime = Path(installed.get('generation', datos))
        with tempfile.TemporaryDirectory(dir=datos) as tmp:
            archivo = Path(tmp) / ('escrito.docx' if es_docx else 'escrito.md')
            if es_docx:
                archivo.write_bytes(contenido)
            else:
                archivo.write_text(contenido, encoding='utf-8')
            result = _dike(['constancia', str(archivo), '--as-of', expected_day, '--json'], runtime)
        stdout, stderr, returncode = result.stdout, result.stderr, result.returncode
        if returncode not in (0, 1):
            return json.dumps(_error_docx(stderr) if es_docx and _error_docx(stderr) else
                              _error_adaptador(None, stdout, stderr, returncode=returncode), ensure_ascii=False)
        try:
            c = _validar_constancia(json.loads(stdout), returncode, as_of=expected_day)
        except json.JSONDecodeError as exc:
            return json.dumps(_error_docx(stderr) if es_docx and _error_docx(stderr) else
                              _error_adaptador(exc, stdout, stderr, returncode=returncode), ensure_ascii=False)
        c = _degradar_cuerpos_en_conflicto(c)
        return json.dumps(_salida_publica(c), ensure_ascii=False)
    except Exception as exc:
        return json.dumps(_error_adaptador(exc, stdout, stderr, returncode=returncode), ensure_ascii=False)


def _error_docx(stderr: str):
    """Classify an engine-side .docx read failure by fixed markers; never forward stderr."""
    if 'ModuleNotFoundError' in stderr or 'falta la librería python-docx' in stderr:
        return {'error': 'ENGINE_EXIT_ERROR: Falta una dependencia del motor en el entorno de ejecución.',
                'error_code': 'ENGINE_EXIT_ERROR', 'todo_verificado': False}
    if any(m in stderr for m in ('DocumentoIlegible', 'PackageNotFoundError', 'BadZipFile')):
        return {'error': f'INPUT_ERROR: {_MSG_INPUT_DOCX}', 'error_code': 'INPUT_ERROR',
                'motivo': 'INPUT_DOCX', 'todo_verificado': False}
    return None


def _formatear_salida(out: dict) -> str:
    """Texto legible del comando: el tool sigue devolviendo JSON."""
    if 'error' in out:
        error = str(out['error'])
        message = error.split(': ', 1)[1] if ': ' in error else error
        return f'Diké no pudo revisar el escrito: {message}'
    veredicto = out.get('veredicto')
    meta = out.get('meta') or {}
    if veredicto in ('SIN_CITAS', 'SIN_CORPUS'):
        return f"Diké: {out.get('mensaje') or ''}"
    detalles = out.get('detalles') or []
    lines = [f"Diké: {meta.get('citas_verificadas')} de {meta.get('total_citas')} citas verificadas "
             f"({veredicto}) · corpus {meta.get('pack_hash')}"]
    fechas = []
    for d in detalles:
        cita = str(d.get('cita_raw') or '')[:120]
        if d.get('estado') == 'VERIFICADA':
            lines.append(f"✓ {cita} · {d.get('gid')} · {d.get('fuente_url')}")
            if d.get('fecha_recuperacion'):
                fechas.append(str(d['fecha_recuperacion'])[:10])
        else:
            lines.append(f"✗ {cita} · {d.get('resolucion')}")
    no_verificadas = out.get('no_verificadas') or []
    if no_verificadas:
        lines.append('Menciones sin artículo, no verificadas: ' + ', '.join(str(v) for v in no_verificadas))
    fecha = min(fechas) if fechas else '—'
    lines.append('No certifica que el artículo respalde el argumento ni que la copia '
                 f'(obtenida {fecha}) sea el texto vigente hoy.')
    return '\n'.join(lines)


def _comando(raw):
    arg = (raw or '').strip()
    if arg and len(arg) < 256 and not re.search(r'\s', arg):
        suffix = Path(arg).suffix.lower()
        if suffix in ('.md', '.txt', '.docx'):
            return _formatear_salida(json.loads(verificar_citas({'ruta': arg})))
        if suffix in _DOC_SUFFIXES:
            return f'Diké no pudo revisar el escrito: {_MSG_INPUT_EXTENSION}'
    return _formatear_salida(json.loads(verificar_citas({'texto': raw})))


def _escritor_hooks():
    """Carga escritor/hooks.py por ruta, con un nombre propio: así no depende de
    cómo Hermes importe el plugin ni puede tomar otro módulo `escritor` del path."""
    spec = importlib.util.spec_from_file_location(
        "dike_escritor_hooks", _RAIZ / "escritor" / "hooks.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def register(ctx):
    global _CTX
    _CTX = ctx
    ctx.register_tool(name='dike_verificar_citas', toolset='dike', schema=ESQUEMA, handler=verificar_citas)
    ctx.register_command('dike-verificar', _comando, 'Verifica citas contra el corpus local; no firma.',
                         args_hint='<texto o ruta .md/.txt/.docx>')
    carpeta = _RAIZ / 'skills'
    if carpeta.is_dir():
        for hija in sorted(carpeta.iterdir()):
            if (hija / 'SKILL.md').is_file():
                ctx.register_skill(hija.name, hija / 'SKILL.md')
    _escritor_hooks().register_hooks(ctx)
