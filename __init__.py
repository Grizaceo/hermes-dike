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
            "ruta": {"type": "string", "description": "Ruta de un archivo .md o .txt con el escrito (alternativa a `texto`)."},
        },
    },
}


def _carpeta_de_datos() -> Path:
    try:
        from plugins.plugin_storage import plugin_data_dir
        return Path(plugin_data_dir("dike"))
    except Exception:
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
    if hashlib.sha256(paquete.read_bytes()).hexdigest() != esperado:
        raise ValueError('corpus package checksum mismatch')
    generation = datos / 'generations' / esperado
    generation.parent.mkdir(parents=True, exist_ok=True)
    with (datos / 'install.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        marker = generation / 'installed.json'
        if generation.exists():
            record = json.loads(marker.read_text())
            if record.get('package_sha256') != esperado:
                raise ValueError('installed generation mismatch')
            actual = {str(p.relative_to(generation)): hashlib.sha256(p.read_bytes()).hexdigest()
                      for p in (generation / 'users').rglob('*') if p.is_file()}
            if actual != record.get('files'):
                raise ValueError('installed corpus integrity mismatch')
            return {'generation': str(generation)}
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
            (stage / 'installed.json').write_text(json.dumps({'package_sha256': esperado, 'files': files}))
            stage.rename(generation)
        return {'generation': str(generation)}


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


def _texto_input(args):
    if not isinstance(args, dict) or set(args) - {'texto', 'ruta'}:
        raise ValueError('invalid input fields')
    if ('texto' in args) == ('ruta' in args):
        raise ValueError('provide exactly one of texto or ruta')
    value = args.get('texto') if 'texto' in args else args.get('ruta')
    if not isinstance(value, str) or not value.strip():
        raise ValueError('input must be a nonempty string')
    if 'ruta' in args:
        # P2-2: check symlinks on the original path, then resolve for safety.
        path = Path(value).expanduser()
        if path.suffix.lower() not in ('.md', '.txt') or any(p.is_symlink() for p in [path, *path.parents]):
            raise ValueError('only regular .md/.txt files without symlinks are accepted')
        # P2-2: resolve after symlink check to handle any remaining edge cases.
        path = path.resolve()
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        with os.fdopen(fd, 'rb') as stream:
            info = os.fstat(stream.fileno())
            if not stat.S_ISREG(info.st_mode) or info.st_size > _LIMITE_TEXTO:
                raise ValueError('not a regular file or file too large')
            value = stream.read(_LIMITE_TEXTO + 1).decode('utf-8')
    if not value.strip() or len(value.encode('utf-8')) > _LIMITE_TEXTO:
        raise ValueError('empty input or input exceeds 400000 UTF-8 bytes')
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
            value = re.sub(r'[A-Za-z]:[\\/][^\s,;\"\']+', '<ruta-local>', value)
        return value
    return clean(out)


def verificar_citas(args: dict, **kwargs) -> str:
    stdout, stderr, returncode = '', '', None
    try:
        texto = _texto_input(args)
        expected_day = date.today().isoformat()
        datos = _carpeta_de_datos().resolve()
        installed = _asegurar_corpus(datos)
        runtime = Path(installed.get('generation', datos))
        with tempfile.TemporaryDirectory(dir=datos) as tmp:
            archivo = Path(tmp) / 'escrito.md'
            archivo.write_text(texto, encoding='utf-8')
            result = _dike(['constancia', str(archivo), '--as-of', expected_day, '--json'], runtime)
        stdout, stderr, returncode = result.stdout, result.stderr, result.returncode
        if returncode not in (0, 1):
            return json.dumps(_error_adaptador(None, stdout, stderr, returncode=returncode), ensure_ascii=False)
        c = _validar_constancia(json.loads(stdout), returncode, as_of=expected_day)
        return json.dumps(_salida_publica(c), ensure_ascii=False)
    except Exception as exc:
        return json.dumps(_error_adaptador(exc, stdout, stderr, returncode=returncode), ensure_ascii=False)


def _comando(raw):
    return verificar_citas({'texto': raw})


def register(ctx):
    ctx.register_tool(name='dike_verificar_citas', toolset='dike', schema=ESQUEMA, handler=verificar_citas)
    ctx.register_command('dike-verificar', _comando, 'Verifica citas contra el corpus local; no firma.')
    carpeta = _RAIZ / 'skills'
    if carpeta.is_dir():
        for hija in sorted(carpeta.iterdir()):
            if (hija / 'SKILL.md').is_file():
                ctx.register_skill(hija.name, hija / 'SKILL.md')
