"""Backend del panel Diké para el dashboard web y la app Desktop.

Hermes lo monta en ``/api/plugins/dike/`` (dashboard web) o lo enruta al
plugin host del perfil activo (Desktop). Reutiliza el adaptador del agente
cargándolo por ruta: misma validación de entrada, mismo corpus sellado, mismo
subproceso del motor — que corre dentro de bubblewrap cuando el equipo lo
permite (``aislamiento.py``; sin red y con solo las rutas que cada op
necesita) y en modo degradado declarado cuando no. A propósito solo acepta
texto: la superficie HTTP no expone la lectura de archivos locales que el
adaptador sí permite por ``ruta``.
"""

from __future__ import annotations

import importlib.util
import json
import math
import os
import re
import sys
import tempfile
import threading
import time
import unicodedata
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, HTTPException

router = APIRouter()
_RAIZ = Path(__file__).resolve().parent.parent
_spec_textos = importlib.util.spec_from_file_location('dike_textos', _RAIZ / 'textos.py')
if 'dike_textos' not in sys.modules:
    _mod_textos = importlib.util.module_from_spec(_spec_textos)
    _spec_textos.loader.exec_module(_mod_textos)
    sys.modules['dike_textos'] = _mod_textos
_TEXTOS = sys.modules['dike_textos']


_CODIGOS_PANEL = {'UNIT_INDEX_NOT_FOUND', 'UNIT_ID_INVALID', 'STATUTE_NOT_FOUND', 'UNIT_NOT_FOUND', 'ARTICLE_NOT_FOUND', 'NODE_NOT_FOUND', 'QUERY_NO_TERMS'}

def _detalle_panel(detalle):
    if detalle.partition(': ')[0] in _CODIGOS_PANEL:
        return detalle
    return _detalle('PANEL_INPUT_ERROR', detail=detalle)


def _detalle(codigo, **datos):
    return codigo + ': ' + _TEXTOS.t(codigo, 'en', **datos)


_LEYES = 25
_ARTICULOS = 8544
# Secciones del NIF que la superficie web puede editar (las mismas listas del
# modelo + metadatos). Cualquier otra field_path la rechaza el motor o aquí.
_CAMPOS_NIF = {
    "legal_question", "problem_type", "confidence", "validated_by_human",
    "relevant_factors", "subjects", "norms", "norm_relations", "admin_acts",
    "principles", "deontic_positions", "conflicts", "hypotheses", "gaps",
    "facts.known", "facts.alleged", "facts.missing",
}
_CASE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")


_ADAPTADOR = None
_adaptador_lock = threading.Lock()


def _adaptador():
    """El adaptador del plugin (``__init__.py``), cargado por ruta una sola vez.

    Una sola instancia por proceso: así conserva entre peticiones lo que ya
    comprobó del corpus (el hash completo se calcula una vez, no en cada
    ``/verificar``) y el índice de nodos en memoria.
    """
    global _ADAPTADOR
    with _adaptador_lock:
        if _ADAPTADOR is None:
            spec = importlib.util.spec_from_file_location(
                "dike_adapter_http", _RAIZ / "__init__.py")
            mod = importlib.util.module_from_spec(spec)
            sys.modules[spec.name] = mod
            try:
                spec.loader.exec_module(mod)
            except Exception:
                sys.modules.pop(spec.name, None)
                raise
            _ADAPTADOR = mod
        return _ADAPTADOR


@router.get("/estado")
def estado():
    """Estado del corpus sin efectos secundarios: no instala ni descarga."""
    mod = _adaptador()
    datos = mod._carpeta_de_datos()
    corpus = mod._estado_corpus(datos)
    version = mod._version_plugin()
    return {
        "pack_hash": mod.PACK_HASH,
        "corpus_instalado": corpus["corpus_instalado"],
        "generation": corpus["generation"],
        "leyes": _LEYES,
        "articulos": _ARTICULOS,
        "version": version if version != "?" else None,
        "aislamiento": mod._aislamiento().estado(),
        "perfil_chat": mod._perfil_chat(),
    }


@router.post("/verificar")
def verificar(body: dict):
    texto = body.get("texto") if isinstance(body, dict) else None
    if not isinstance(texto, str) or not texto.strip():
        raise HTTPException(status_code=400, detail=_detalle('TEXT_MISSING'))
    return json.loads(_adaptador().verificar_citas({"texto": texto}))


# ---------------------------------------------------------------------------
# Case Writer: persistencia del escrito por caso (plugin-data, I/O directo:
# no pasa por el subproceso del motor porque no toca el corpus sellado).
# ---------------------------------------------------------------------------

_LIMITE_HTML = 2_000_000
_LIMITE_REGISTRO = 200_000
_escritos_lock = threading.Lock()


def _dir_escritos(mod) -> Path:
    return mod._carpeta_de_datos() / "escritos"


def _leer_escrito(mod, cid: str) -> dict | None:
    p = _dir_escritos(mod) / f"{cid}.json"
    if not p.is_file():
        return None
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        raise HTTPException(status_code=500, detail=_detalle('BRIEF_UNREADABLE'))
    return data if isinstance(data, dict) else None


@router.get("/escrito")
def escrito_obtener(case_id: str):
    if not isinstance(case_id, str) or not _CASE_ID.match(case_id.strip()):
        raise HTTPException(status_code=400, detail=_detalle('CASE_ID_INVALID'))
    cid = case_id.strip()
    data = _leer_escrito(_adaptador(), cid)
    if data is None:
        return {"case_id": cid, "existe": False, "html": "", "texto": "",
                "rev": 0, "actualizado": None, "registro": {}}
    return {
        "case_id": cid,
        "existe": True,
        "html": data.get("html") or "",
        "texto": data.get("texto") or "",
        "rev": int(data.get("rev") or 0),
        "actualizado": data.get("actualizado"),
        "registro": data.get("registro") or {},
    }


@router.post("/escrito")
def escrito_guardar(body: dict):
    cid = _case_id(body)
    html = _campo_json(body, "html", str)
    texto = _campo_json(body, "texto", str)
    rev_base = body.get("rev_base")
    registro = body.get("registro")
    if not isinstance(html, str):
        raise HTTPException(status_code=400, detail=_detalle('HTML_MISSING'))
    if not isinstance(texto, str):
        raise HTTPException(status_code=400, detail=_detalle('TEXT_MISSING'))
    if not isinstance(rev_base, int) or isinstance(rev_base, bool) or rev_base < 0:
        raise HTTPException(status_code=400, detail=_detalle('REV_BASE_INVALID'))
    if registro is not None and not isinstance(registro, dict):
        raise HTTPException(status_code=400, detail=_detalle('REGISTRY_INVALID'))
    mod = _adaptador()
    if len(texto.encode("utf-8")) > mod._LIMITE_TEXTO:
        raise HTTPException(status_code=400, detail=_detalle('TEXT_TOO_LARGE'))
    if len(html.encode("utf-8")) > _LIMITE_HTML:
        raise HTTPException(status_code=400, detail=_detalle('HTML_TOO_LARGE'))
    try:
        registro_bytes = len(json.dumps(registro, ensure_ascii=False).encode('utf-8'))
    except UnicodeEncodeError:
        raise HTTPException(status_code=400, detail=_detalle('REGISTRY_UNICODE_INVALID')) from None
    if registro is not None and registro_bytes > _LIMITE_REGISTRO:
        raise HTTPException(status_code=400, detail=_detalle('REGISTRY_TOO_LARGE'))

    # Lectura de rev + escritura bajo un lock de proceso: dos guardados
    # simultáneos con el mismo rev_base no pueden colar ambos.
    with _escritos_lock:
        actual = _leer_escrito(mod, cid)
        rev_actual = int(actual.get("rev") or 0) if actual else 0
        if rev_base != rev_actual:
            raise HTTPException(status_code=409, detail={"rev_actual": rev_actual})
        rev = rev_actual + 1
        actualizado = datetime.now(timezone.utc).isoformat(timespec="seconds")
        doc = {
            "case_id": cid,
            "html": html,
            "texto": texto,
            "rev": rev,
            "actualizado": actualizado,
            "registro": registro if registro is not None else {},
        }

        directorio = _dir_escritos(mod)
        directorio.mkdir(parents=True, exist_ok=True)
        os.chmod(directorio, 0o700)
        destino = directorio / f"{cid}.json"
        fd, tmp = tempfile.mkstemp(dir=directorio, prefix=f".{cid}.", suffix=".tmp")
        try:
            os.chmod(tmp, 0o600)
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                f.write(json.dumps(doc, ensure_ascii=False))
            os.replace(tmp, destino)
        except BaseException:
            try:
                os.unlink(tmp)
            except OSError:
                pass
            raise
        os.chmod(destino, 0o600)
    return {"rev": rev, "actualizado": actualizado}


# ---------------------------------------------------------------------------
# Panel: NIF (teoría del caso) y grafo (GRE personal + mapa del corpus)
# ---------------------------------------------------------------------------

def _limpio(texto: str) -> str:
    """Quita rutas locales y recorta: stderr del motor nunca sale tal cual."""
    return _adaptador()._limpio_panel(texto)


_CORPUS_MEMO_TTL = 60.0
_corpus_memo: dict[str, tuple[float, dict]] = {}
_corpus_memo_lock = threading.Lock()


def _asegurar_corpus_memo(mod, datos: Path) -> dict:
    """``_asegurar_corpus`` con memo de 60 s para consultas de solo lectura.

    La vista del grafo muestra metadatos del corpus y no certifica nada: la
    garantía de integridad que importa se aplica en cada ``/verificar``,
    que nunca pasa por esta memo. Ahorra ~4 s por consulta del usuario.
    """
    clave = str(datos)
    ahora = time.monotonic()
    with _corpus_memo_lock:
        hit = _corpus_memo.get(clave)
        if (hit is not None and ahora - hit[0] < _CORPUS_MEMO_TTL
                and Path(hit[1].get("generation") or "").is_dir()):
            return hit[1]
    instalado = mod._asegurar_corpus(datos)
    with _corpus_memo_lock:
        _corpus_memo[clave] = (time.monotonic(), instalado)
    return instalado


def _panel(args: list, *, corpus: bool = False, timeout: int = 90,
           memo: bool = False, entrada: str | None = None) -> dict:
    """Corre ``scripts/panel.py`` en el subproceso del motor (bubblewrap si aplica).

    Sin ``corpus`` el workspace es el plugin-data (casos NIF y grafo personal
    persisten ahí, fuera de la generación sellada). Con ``corpus`` se asegura
    la generación instalada y el panel lee el corpus sellado — nunca escribe.
    ``memo`` reusa la generación 60 s (solo endpoints de lectura del grafo).
    ``entrada`` va al stdin del subproceso (la búsqueda por contenido la usa
    para que la consulta no aparezca en argv ni en ``ps``): nunca se escribe
    a disco ni se loguea.
    """
    mod = _adaptador()
    datos = mod._carpeta_de_datos().resolve()
    if corpus:
        instalado = (_asegurar_corpus_memo(mod, datos) if memo
                     else mod._asegurar_corpus(datos))
        runtime = Path(instalado["generation"])
    else:
        instalado = None
        runtime = datos
    try:
        return mod._panel_json(args, runtime=runtime, timeout=timeout,
                               entrada=entrada, instalado=instalado)
    except mod._aislamiento().SandboxNoDisponible as exc:
        raise HTTPException(status_code=503, detail=_detalle('SANDBOX_UNAVAILABLE'))
    except mod.PanelError as exc:
        if exc.kind == "timeout":
            raise HTTPException(status_code=504,
                                detail=_detalle('ENGINE_TIMEOUT'))
        if exc.kind == "data":
            raise HTTPException(status_code=400, detail=_detalle_panel(exc.detalle))
        # 'engine' y cualquier kind futuro: fallo del subproceso.
        raise HTTPException(status_code=502,
                            detail=_detalle('ENGINE_ERROR', detail=exc.detalle or 'no output'))


def _campo_json(body, clave, tipo, defecto=None):
    """Valida el tipo antes de usar campos JSON en regex, conjuntos o conversiones."""
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail=_detalle('BODY_INVALID'))
    valor = body.get(clave, defecto)
    tipos = tipo if isinstance(tipo, tuple) else (tipo,)
    if type(valor) not in tipos:
        nombres = {str: _TEXTOS.t('type.text', 'en'), int: _TEXTOS.t('type.integer', 'en'),
                   float: _TEXTOS.t('type.number', 'en'), bool: _TEXTOS.t('type.boolean', 'en'), dict: _TEXTOS.t('type.object', 'en')}
        esperado = ' or '.join(nombres[t] for t in tipos)
        raise HTTPException(status_code=400, detail=_detalle('FIELD_TYPE_INVALID', field=clave, expected=esperado))
    if isinstance(valor, str):
        try:
            valor.encode('utf-8')
        except UnicodeEncodeError:
            raise HTTPException(status_code=400, detail=_detalle('FIELD_UNICODE_INVALID', field=clave)) from None
    if isinstance(valor, float) and not math.isfinite(valor):
        raise HTTPException(status_code=400, detail=_detalle('FIELD_NUMBER_INVALID', field=clave))
    return valor


def _case_id(body: dict) -> str:
    cid = body.get("case_id") if isinstance(body, dict) else None
    if not isinstance(cid, str) or not _CASE_ID.match(cid.strip()):
        raise HTTPException(status_code=400, detail=_detalle('CASE_ID_INVALID'))
    return cid.strip()


@router.get("/nif/casos")
def nif_casos():
    return _panel(["nif", "list"])


@router.post("/nif/init")
def nif_init(body: dict):
    cid = _case_id(body)
    pregunta = _campo_json(body, "pregunta", str, "")
    if not isinstance(pregunta, str) or not pregunta.strip():
        raise HTTPException(status_code=400, detail=_detalle('QUESTION_MISSING'))
    args = ["nif", "init", cid, pregunta.strip()]
    tipo = _campo_json(body, "problem_type", str, "")
    if isinstance(tipo, str) and tipo.strip():
        args.append(tipo.strip())
    return _panel(args)


@router.post("/nif/seed")
def nif_seed(body: dict):
    return _panel(["nif", "seed", _case_id(body)])


@router.get("/nif/snapshot")
def nif_snapshot(case_id: str):
    if not _CASE_ID.match(case_id.strip()):
        raise HTTPException(status_code=400, detail=_detalle('CASE_ID_INVALID'))
    return _panel(["nif", "snapshot", case_id.strip()])


@router.post("/nif/edit")
def nif_edit(body: dict):
    cid = _case_id(body)
    campo = _campo_json(body, "field_path", str)
    if campo not in _CAMPOS_NIF:
        raise HTTPException(status_code=400, detail=_detalle('NIF_FIELD_INVALID'))
    if "value" not in body:
        raise HTTPException(status_code=400, detail=_detalle('VALUE_MISSING'))
    valor = json.dumps(body["value"], ensure_ascii=False)
    _campo_json({"value": valor}, "value", str)
    args = ["nif", "edit", cid, campo, valor]
    razon = _campo_json(body, "reason", str, "")
    if isinstance(razon, str) and razon.strip():
        args.append(razon.strip())
    return _panel(args)


@router.post("/nif/gap")
def nif_gap(body: dict):
    cid = _case_id(body)
    indice = _campo_json(body, "gap_index", int)
    for campo in ("filled_by", "filled_with"):
        if not isinstance(body.get(campo), str) or not body[campo].strip():
            raise HTTPException(status_code=400, detail=_detalle('FIELD_MISSING', field=campo))
    return _panel(["nif", "gap", cid, str(indice),
                   _campo_json(body, "filled_by", str).strip(), _campo_json(body, "filled_with", str).strip()])


@router.post("/nif/validar")
def nif_validar(body: dict):
    cid = _case_id(body)
    if not isinstance(body.get("validated"), bool):
        raise HTTPException(status_code=400, detail=_detalle('VALIDATED_INVALID'))
    return _panel(["nif", "validate", cid, "1" if body["validated"] else "0"])


@router.post("/nif/confianza")
def nif_confianza(body: dict):
    cid = _case_id(body)
    valor = _campo_json(body, "confidence", (int, float))
    if not 0 <= valor <= 1:
        raise HTTPException(status_code=400, detail=_detalle('CONFIDENCE_INVALID'))
    return _panel(["nif", "confidence", cid, str(valor)])


@router.get("/grafo/personal")
def grafo_personal():
    return _panel(["grafo", "personal"])


@router.get("/grafo/corpus")
def grafo_corpus():
    return _panel(["grafo", "corpus"], corpus=True, timeout=300, memo=True)


@router.get("/grafo/corpus/norma/{code}")
def grafo_corpus_norma(code: str):
    if not code.isdigit():
        raise HTTPException(status_code=400, detail=_detalle('STATUTE_CODE_INVALID'))
    return _panel(["grafo", "corpus-norma", code], corpus=True, timeout=300, memo=True)


@router.get("/grafo/red")
def grafo_red(fuente: str = "corpus"):
    """La red del corpus sellado o de la capa ambiental local en una llamada.

    La respuesta se cachea en plugin-data por pack_hash: la primera lectura
    barre los ~8.500 artículos, las siguientes sirven el archivo."""
    if fuente not in ("corpus", "ambiental"):
        raise HTTPException(
            status_code=400,
            detail=_detalle('GRAPH_SOURCE_INVALID', source=fuente))
    mod = _adaptador()
    if fuente == "ambiental":
        return _red_ambiental(mod)
    # El nombre lleva la versión del contrato: un cambio de esquema no puede
    # servir una forma vieja guardada por una versión anterior del plugin.
    cache = mod._carpeta_de_datos() / "cache" / f"grafo_red_v3_{mod.PACK_HASH}.json"
    try:
        if cache.is_file():
            data = json.loads(cache.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                return data
    except (OSError, json.JSONDecodeError):
        pass
    data = _panel(["grafo", "red"], corpus=True, timeout=300)
    respuesta = {
        "fuente": "corpus",
        "pack_hash": mod.PACK_HASH,
        "local_only": False,
        "nodes": data.get("nodes") or [],
        "links": data.get("links") or [],
        "conteos": data.get("conteos") or {},
        "truncado": bool(data.get("truncado")),
    }
    try:
        cache.parent.mkdir(parents=True, exist_ok=True)
        tmp = cache.with_suffix(".tmp")
        tmp.write_text(json.dumps(respuesta, ensure_ascii=False), encoding="utf-8")
        tmp.replace(cache)
    except OSError:
        pass
    return respuesta


@router.post("/grafo/buscar")
def grafo_buscar(body: dict):
    """Búsqueda por contenido del corpus sellado (BM25 determinista, sin modelo).

    POST y no GET: un GET dejaría la consulta en los access logs del
    dashboard. La consulta viaja por stdin al subproceso del panel — nunca
    por argv (visible en ``ps``), ni se escribe a disco ni se loguea. Lee el
    corpus sellado y escribe solo la caché del índice BM25 bajo
    ``<generation>/home/.dike/bm25_cache/`` (fuera del subárbol ``users/``
    que verifica la integridad).
    """
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail=_detalle('BODY_INVALID'))
    q = body.get("q")
    if not isinstance(q, str):
        raise HTTPException(status_code=400, detail=_detalle('QUERY_MISSING'))
    q = q.strip()
    if not q or len(q) > 300:
        raise HTTPException(
            status_code=400, detail=_detalle('QUERY_LENGTH_INVALID'))
    if any(unicodedata.category(c).startswith("C") for c in q):
        raise HTTPException(status_code=400, detail=_detalle('QUERY_CONTROL'))
    limite = body.get("limite", 20)
    if isinstance(limite, bool) or not isinstance(limite, int):
        raise HTTPException(status_code=400, detail=_detalle('LIMIT_INVALID'))
    limite = max(1, min(50, limite))
    entrada = json.dumps({"q": q, "limite": limite}, ensure_ascii=False)
    return _panel(["grafo", "buscar"], corpus=True, memo=True,
                  timeout=120, entrada=entrada)


@router.post("/grafo/leer")
def grafo_leer(body: dict):
    """Lee el texto de un artículo del corpus sellado (cita, gid o nodo_id).

    Pasa por el handler ``leer_articulo`` del adaptador — el mismo que usa la
    herramienta del chat— así la ruta y el modelo comparten validación,
    sandbox y hash. Una resolución no RESOLVED vuelve 200 con su
    ``resolucion``; la interfaz decide qué mostrar.
    """
    mod = _adaptador()
    try:
        crudo = mod.leer_articulo(body if isinstance(body, dict) else {})
    except Exception:
        raise HTTPException(status_code=502, detail=_detalle('ENGINE_NO_OUTPUT'))
    try:
        data = json.loads(crudo) if isinstance(crudo, str) else crudo
    except json.JSONDecodeError:
        data = None
    if not isinstance(data, dict):
        raise HTTPException(status_code=502, detail=_detalle('ENGINE_RESPONSE_INVALID'))
    code = data.get("error_code")
    if code == "SANDBOX_UNAVAILABLE":
        raise HTTPException(status_code=503,
                            detail=_detalle('SANDBOX_UNAVAILABLE'))
    if code == "INPUT_ERROR":
        raise HTTPException(status_code=400,
                            detail=_detalle('INPUT_ERROR'))
    if "error" in data:
        raise HTTPException(status_code=502, detail=_detalle('ENGINE_ERROR', detail=_limpio(str(data.get('error')))))
    return data


def _ambiental_dir(mod) -> Path:
    """Datos locales del grafo ambiental (solo en este equipo, no publicados)."""
    return mod._carpeta_de_datos() / "grafo-local" / "ambiental"


def _leer_local(mod, nombre: str) -> dict:
    p = _ambiental_dir(mod) / nombre
    if not p.is_file():
        return {}
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}


def _red_ambiental(mod) -> dict:
    p = _ambiental_dir(mod) / "red.json"
    if not p.is_file():
        raise HTTPException(
            status_code=404,
            detail=_detalle('LOCAL_GRAPH_MISSING'))
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        raise HTTPException(status_code=500, detail=_detalle('LOCAL_GRAPH_UNREADABLE', detail=_limpio(str(e))))
    data["fuente"] = "ambiental"
    data["local_only"] = True
    data.setdefault("conteos", {})
    return data


@router.get("/grafo/fuentes")
def grafo_fuentes():
    """Fuentes disponibles para el grafo: corpus sellado y capa local."""
    mod = _adaptador()
    amb = _ambiental_dir(mod)
    construido = (_leer_local(mod, "construccion.json").get("construido")
                  if (amb / "red.json").is_file() else None)
    return [
        {"id": "corpus", "label": "Corpus Diké (25 leyes)",
         "disponible": True, "local_only": False},
        {"id": "ambiental", "label": "Ambiental local (solo en este equipo)",
         "disponible": bool(construido), "local_only": True,
         "construido": construido},
    ]


_UNIDAD_ID = re.compile(r"^[^\x00-\x1f]{4,400}#u\d{1,4}$")
_UNIDAD_AMB_ID = re.compile(r"^[^\x00-\x1f]{4,400}$")
_NODO_ID = re.compile(r"^[^\x00-\x1f#]{4,400}$")


@router.get("/grafo/nodo")
def grafo_nodo(id: str, fuente: str = "corpus"):
    """Ficha de un instrumento o artículo (url, sha256, conteos, vigencia)."""
    if not _NODO_ID.match(id or ""):
        raise HTTPException(status_code=400, detail=_detalle('NODE_ID_INVALID'))
    if fuente == "ambiental":
        red = _red_ambiental(_adaptador())
        nodo = next((n for n in red.get("nodes", []) if n.get("id") == id), None)
        if nodo is None:
            raise HTTPException(status_code=404, detail=_detalle('LOCAL_NODE_NOT_FOUND'))
        salidas = [l for l in red.get("links", []) if l.get("source") == id]
        return {**nodo, "n_salientes": len(salidas)}
    return _panel(["grafo", "nodo", id], corpus=True, timeout=60, memo=True)


@router.get("/grafo/unidades")
def grafo_unidades(articulo: str):
    """Nodos 'unidad' de un artículo + aristas contiene/excepciona."""
    if not _NODO_ID.match(articulo or ""):
        raise HTTPException(status_code=400, detail=_detalle('ARTICLE_ID_INVALID'))
    return _panel(["grafo", "unidades", articulo], corpus=True, timeout=60, memo=True)


@router.get("/grafo/unidad")
def grafo_unidad(id: str, fuente: str = "corpus"):
    """Texto y offsets de una unidad normativa mínima (no van en /grafo/red)."""
    if fuente == "ambiental":
        if not _UNIDAD_AMB_ID.match(id or ""):
            raise HTTPException(status_code=400, detail=_detalle('UNIT_ID_INVALID'))
        store = _leer_local(_adaptador(), "unidades.json")
        u = (store.get("textos") or {}).get(id)
        if u is None:
            raise HTTPException(status_code=404, detail=_detalle('LOCAL_UNIT_NOT_FOUND'))
        return {"id": id, **u}
    if not _UNIDAD_ID.match(id or ""):
        raise HTTPException(status_code=400, detail=_detalle('UNIT_ID_INVALID'))
    return _panel(["grafo", "unidad", id], corpus=True, timeout=60, memo=True)


@router.get("/grafo/evidencia")
def grafo_evidencia(link: str, fuente: str = "ambiental"):
    """Snippet de evidencia de UNA arista (src|dst|tipo) de la capa local."""
    if fuente != "ambiental":
        raise HTTPException(status_code=400,
                            detail=_detalle('EVIDENCE_SOURCE_INVALID'))
    if not re.fullmatch(r"[^\x00-\x1f]{4,1200}", link or ""):
        raise HTTPException(status_code=400, detail=_detalle('LINK_INVALID'))
    store = _leer_local(_adaptador(), "unidades.json")
    ev = (store.get("evidencias") or {}).get(link)
    if ev is None:
        raise HTTPException(status_code=404, detail=_detalle('EVIDENCE_NOT_FOUND'))
    return ev


# ---------------------------------------------------------------------------
# Privacidad del escrito (): detección, seudónimos estables y registro de
# envíos. I/O directo en plugin-data; el detector es puro Python (sin
# subproceso). Fail-closed: si el registro no se puede escribir, la ruta
# responde 5xx y el cliente no debe enviar nada.
# ---------------------------------------------------------------------------

def _privacidad():
    """Carga el paquete ``privacidad/`` por ruta como ``dike_privacidad``."""
    if "dike_privacidad" in sys.modules:
        return sys.modules["dike_privacidad"]
    spec = importlib.util.spec_from_file_location(
        "dike_privacidad",
        _RAIZ / "privacidad" / "__init__.py",
        submodule_search_locations=[str(_RAIZ / "privacidad")])
    mod = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = mod
    try:
        spec.loader.exec_module(mod)
    except Exception:
        sys.modules.pop(spec.name, None)
        raise
    return mod


def _texto_privacidad(body: dict) -> str:
    texto = body.get("texto") if isinstance(body, dict) else None
    if texto is None:
        texto = ""
    if not isinstance(texto, str):
        raise HTTPException(status_code=400, detail=_detalle('TEXT_TYPE_INVALID'))
    try:
        tamano = len(texto.encode("utf-8"))
    except UnicodeEncodeError:
        raise HTTPException(status_code=400, detail=_detalle('TEXT_UNICODE_INVALID')) from None
    if tamano > _adaptador()._LIMITE_TEXTO:
        raise HTTPException(status_code=400, detail=_detalle('TEXT_TOO_LARGE'))
    return texto


@router.post("/privacidad/detectar")
def privacidad_detectar(body: dict):
    """Detecta datos personales visibles; con case_id aplica decisiones."""
    mod = _adaptador()
    pv = _privacidad()
    texto = _texto_privacidad(body)
    estrategia = _campo_json(body, "estrategia", str, "media")
    cid = body.get("case_id")
    conservar, enmascarar = [], []
    if cid is not None:
        cid = _case_id({"case_id": cid})
        dec = pv.decisiones(mod._carpeta_de_datos(), cid)
        conservar = [d["valor"] for d in dec.values() if d["accion"] == "conservar"]
        enmascarar = [d["valor"] for d in dec.values() if d["accion"] == "enmascarar"]
    entidades = pv.detectar(texto, estrategia=estrategia,
                            conservar_valores=conservar,
                            enmascarar_valores=enmascarar)
    candidatos = pv.candidatos_sin_contexto(texto, entidades)
    conteos: dict[str, int] = {}
    for e in entidades:
        conteos[e["categoria"]] = conteos.get(e["categoria"], 0) + 1
    return {
        "entidades": entidades,
        "candidatos": candidatos,
        "conteos": conteos,
        "estrategia": estrategia if estrategia in pv.ESTRATEGIAS else "media",
        "paquetes": sorted(pv.PAQUETES),
        "version": pv.VERSION,
        "aviso": pv.AVISO,
    }


@router.post("/privacidad/decision")
def privacidad_decision(body: dict):
    """Guarda la decisión del abogado sobre un valor."""
    mod = _adaptador()
    pv = _privacidad()
    cid = _case_id(body)
    valor = _campo_json(body, "valor", str, "")
    accion = body.get("accion")
    if accion not in ("conservar", "enmascarar", "olvidar"):
        raise HTTPException(status_code=400,
                            detail=_detalle('PRIVACY_ACTION_INVALID'))
    if not valor.strip() and accion != "olvidar":
        raise HTTPException(status_code=400, detail=_detalle('PRIVACY_VALUE_EMPTY'))
    tipo = _campo_json(body, "tipo", str, "full_name")
    dec = pv.guardar_decision(mod._carpeta_de_datos(), cid, valor, accion, tipo)
    return {"ok": True, "decisiones": dec}


@router.post("/privacidad/seudonimizar")
def privacidad_seudonimizar(body: dict):
    """Texto con tokens estables + mapa local (no sale del equipo)."""
    mod = _adaptador()
    pv = _privacidad()
    cid = _case_id(body)
    texto = _texto_privacidad(body)
    estrategia = _campo_json(body, "estrategia", str, "media")
    return pv.seudonimizar(mod._carpeta_de_datos(), cid, texto, estrategia)


@router.post("/privacidad/envio")
def privacidad_envio(body: dict):
    """Registra un envío (sin contenido). Si no se puede registrar → 5xx."""
    mod = _adaptador()
    pv = _privacidad()
    cid = _case_id(body)
    destino = _campo_json(body, "destino", str, "")
    sha = _campo_json(body, "sha256", str, "")
    if not re.fullmatch(r"[0-9a-f]{64}", sha):
        raise HTTPException(status_code=400, detail=_detalle('SHA256_INVALID'))
    if len(destino) > 200:
        raise HTTPException(status_code=400, detail=_detalle('DESTINATION_TOO_LONG'))
    conteos = _campo_json(body, "conteos", dict, {})
    if any(not isinstance(k, str) or not re.fullmatch(r'[a-z_]{1,80}', k)
           or type(v) is not int or v < 0 for k, v in conteos.items()):
        raise HTTPException(status_code=400, detail=_detalle('COUNTS_INVALID'))
    try:
        pv.registrar_envio(mod._carpeta_de_datos(), cid, destino, sha,
                           conteos,
                           _campo_json(body, "estrategia", str, "media"),
                           _campo_json(body, "seudonimizado", bool, False))
    except OSError:
        raise HTTPException(status_code=500,
                            detail=_detalle('SEND_LOG_FAILED'))
    return {"ok": True}

# ---------------------------------------------------------------------------
# Predicción de texto (): L1 = continuación literal desde el corpus sellado.
# Índice en memoria construido al primer uso sobre la generación instalada,
# en SOLO LECTURA (nunca se escribe en la generación).
# ---------------------------------------------------------------------------

import unicodedata as _unicodedata_pred


def _normalizar_con_mapa(texto: str):
    """(texto_normalizado, mapa) — misma regla que la cola: NFD, sin marcas
    combinantes, minúsculas, espacios colapsados a uno y bordes recortados.
    ``mapa[i]`` = índice en el ORIGINAL del carácter del que sale ``norm[i]``
    (para 'ó' apunta a su base 'o'; un espacio colapsado apunta al primero
    del grupo). Exacto, nunca una proporción."""
    norm_chars: list = []
    mapa: list = []
    prev_espacio = True          # el inicio cuenta como "tras espacio"
    for i, ch in enumerate(texto):
        for d in _unicodedata_pred.normalize("NFD", ch):
            if _unicodedata_pred.category(d) == "Mn":
                continue         # marca combinante: sale con su base
            if d.isspace():
                if not prev_espacio:
                    norm_chars.append(" ")
                    mapa.append(i)
                    prev_espacio = True
                continue
            norm_chars.append(d.lower())
            mapa.append(i)       # origen: el carácter ORIGINAL i
            prev_espacio = False
    # bordes: un espacio colapsado puede quedar al final
    while norm_chars and norm_chars[0] == " ":
        norm_chars.pop(0)
        mapa.pop(0)
    while norm_chars and norm_chars[-1] == " ":
        norm_chars.pop()
        mapa.pop()
    return "".join(norm_chars), mapa


def _norm_cola(s: str) -> str:
    """La cola con la MISMA normalización que el índice (solo el texto,
    sin mapa: la cola nunca se re-proyecta al original)."""
    return _normalizar_con_mapa(s)[0]


class _IndiceCorpus:
    """Índice ligero: solo texto NORMALIZADO + procedencia + ruta del JSON.
    El texto original no vive en memoria: se relee del disco al acertar."""

    __slots__ = ("arts", "norm_textos")

    def __init__(self) -> None:
        self.arts = []            # [{gid, sha256, fuente_url, ruta}]
        self.norm_textos = []     # texto normalizado alineado con arts


_indice_cache: dict = {}
_indice_lock = threading.Lock()


def _fuente_url(art: dict) -> str:
    prov = art.get("provenance")
    if isinstance(prov, dict):
        for k in ("sourceUrl", "url", "fuente", "wasDerivedFrom"):
            if isinstance(prov.get(k), str) and prov[k]:
                return prov[k]
    return str(art.get("@id") or "")


def _cargar_indice(generacion: Path) -> _IndiceCorpus:
    clave = str(generacion)
    with _indice_lock:
        hit = _indice_cache.get(clave)
        if hit is not None:
            return hit
        idx = _IndiceCorpus()
        dir_art = next(generacion.glob("**/articulos"), None)
        if dir_art and dir_art.is_dir():
            for ruta in sorted(dir_art.glob("articulo_*.json")):
                try:
                    art = json.loads(ruta.read_text(encoding="utf-8"))
                except (OSError, json.JSONDecodeError):
                    continue
                texto = str(art.get("text") or "")
                if not texto.strip():
                    continue
                idx.arts.append({
                    "gid": str(art.get("@id") or ruta.stem),
                    "sha256": str(art.get("textSha256") or ""),
                    "fuente_url": _fuente_url(art),
                    "ruta": ruta,
                })
                idx.norm_textos.append(_normalizar_con_mapa(texto)[0])
        _indice_cache[clave] = idx
        return idx


def _cortar_palabra(s: str, tope: int) -> str:
    if len(s) <= tope:
        return s
    corte = s.rfind(" ", 0, tope + 1)
    return s[:corte if corte > 0 else tope]


@router.post("/prediccion/corpus")
def prediccion_corpus(body: dict):
    """Continuación literal tras el ancla más larga encontrada en el corpus.

    La respuesta es texto del corpus, no una cita verificada — la UI lo
    rotula siempre "sin verificar como cita".
    """
    cola = _campo_json(body, "cola", str, "")
    if len(cola) > 300:
        raise HTTPException(status_code=400, detail=_detalle('TAIL_TOO_LONG'))
    cola_n = _norm_cola(cola)
    if not cola_n:
        raise HTTPException(status_code=400, detail=_detalle('TAIL_EMPTY'))
    if len(cola_n) > 300:
        raise HTTPException(status_code=400, detail=_detalle('TAIL_TOO_LONG'))
    mod = _adaptador()
    datos = mod._carpeta_de_datos().resolve()
    instalado = _asegurar_corpus_memo(mod, datos)
    generacion = Path(instalado["generation"])
    idx = _cargar_indice(generacion)
    # ancla más larga: toda la cola primero, acortando por palabras
    palabras = cola_n.split()
    mejor = None
    for largo in range(len(palabras), 0, -1):
        ancla = " ".join(palabras[-largo:])
        if len(ancla) < 6:
            break
        for i, nt in enumerate(idx.norm_textos):
            pos = nt.find(ancla)
            if pos < 0:
                continue
            # el ancla debe empezar en límite de palabra del normalizado:
            # dentro de una palabra no es coincidencia válida.
            if pos > 0 and nt[pos - 1] != " ":
                continue
            fin_norm = pos + len(ancla)
            # mapa EXACTO norm→original, recalculado solo para el artículo
            # que acertó (solo el normalizado vive en memoria).
            try:
                original = json.loads(
                    idx.arts[i]["ruta"].read_text(encoding="utf-8")
                ).get("text") or ""
            except (OSError, json.JSONDecodeError):
                continue
            norm_art, mapa_art = _normalizar_con_mapa(original)
            if norm_art != nt:      # el texto en disco difiere del índice
                continue
            if fin_norm - 1 >= len(mapa_art):
                continue
            fin_original = mapa_art[fin_norm - 1] + 1
            # el índice mapeado es el de la base NFD: si el ancla termina en
            # una letra con tilde, la marca combinante queda tras ella — se
            # absorbe para no empezar la continuación en un char suelto.
            while (fin_original < len(original)
                   and _unicodedata_pred.category(
                       original[fin_original]) == "Mn"):
                fin_original += 1
            continuacion = _cortar_palabra(original[fin_original:].lstrip(), 200)
            if continuacion:
                mejor = {
                    "continuacion": continuacion,
                    "ancla": ancla,
                    "gid": idx.arts[i]["gid"],
                    "sha256": idx.arts[i]["sha256"],
                    "fuente_url": idx.arts[i]["fuente_url"],
                }
                break
        if mejor:
            break
    return mejor or {"continuacion": ""}


@router.post("/prediccion/evento")
def prediccion_evento(body: dict):
    """Telemetría opt-in de aceptación: solo metadatos, nunca texto."""
    capa = _campo_json(body, "capa", str, "")
    procedencia = _campo_json(body, "procedencia", dict, {})
    tipo = _campo_json(procedencia, "tipo", str, "")
    largo = _campo_json(body, "largo", int, 0)
    if largo < 0:
        raise HTTPException(status_code=400, detail=_detalle('LENGTH_INVALID'))
    evento = {
        "ts": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "capa": capa,
        "aceptada": _campo_json(body, "aceptada", bool, False),
        "largo": largo,
        "tipo": tipo,
    }
    mod = _adaptador()
    directorio = mod._carpeta_de_datos() / "prediccion"
    directorio.mkdir(parents=True, exist_ok=True)
    os.chmod(directorio, 0o700)
    ruta = directorio / "eventos.jsonl"
    with open(ruta, "a", encoding="utf-8") as f:
        f.write(json.dumps(evento, ensure_ascii=False) + "\n")
    os.chmod(ruta, 0o600)
    return {"ok": True}


# ---------------------------------------------------------------------------
# Escrito demo, Revisión de estilo (LexO Escribe Claro), Constructor de
# Ordenamientos y Preferencias de usuario (personalización para terceros)
# ---------------------------------------------------------------------------

_DEMO_FALLBACK = (
    "EN LO PRINCIPAL: demanda por despido improcedente. "
    "(Escrito SINTÉTICO de demostración; partes ficticias.)\n\n"
    "S. J. L. DEL TRABAJO DE SANTIAGO\n\n"
    "A. B. C., trabajadora, a US. respetuosamente digo:\n\n"
    "PRIMERO.- La demandada puso término a mi contrato invocando la causal "
    "de necesidades de la empresa del artículo 161 del Código del Trabajo.\n\n"
    "SEGUNDO.- El artículo 162 del Código del Trabajo dispone que, cuando el "
    "empleador invoque esa causal, el aviso deberá darse al trabajador, con "
    "copia a la Inspección del Trabajo respectiva, a lo menos con treinta "
    "días de anticipación.\n\n"
    "TERCERO.- Conforme al artículo 163 del Código del Trabajo, si el "
    "contrato hubiere estado vigente un año o más y el empleador le pusiere "
    "término por necesidades de la empresa, deberá pagar la indemnización "
    "por años de servicio.\n\n"
    "CUARTO.- El artículo 168 del Código del Trabajo permite al trabajador "
    "que considere improcedente la aplicación de la causal recurrir al "
    "juzgado competente, dentro del plazo de sesenta días hábiles contado "
    "desde la separación.\n\n"
    "QUINTO.- A mayor abundamiento, el artículo 60 obliga al empleador a lo "
    "solicitado.\n\n"
    "SEXTO.- Lo anterior se refuerza con el artículo 9999 del Código del "
    "Trabajo."
)


@router.get("/escrito/demo")
def escrito_demo():
    """Devuelve el escrito sintético de demostración en texto y HTML."""
    ruta = _RAIZ / "tests" / "fixtures" / "escrito_demo.md"
    try:
        texto = ruta.read_text(encoding="utf-8").strip() if ruta.is_file() else _DEMO_FALLBACK
    except OSError:
        texto = _DEMO_FALLBACK
    parrafos = [p.strip() for p in re.split(r"\n\s*\n", texto) if p.strip()]
    html = "".join(
        "<p>" + (p.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")) + "</p>"
        for p in parrafos
    )
    return {"texto": texto, "html": html}


def _escribe_claro():
    """Carga ``escritor/escribe_claro.py`` por ruta como ``dike_escribe_claro``."""
    if "dike_escribe_claro" in sys.modules:
        return sys.modules["dike_escribe_claro"]
    spec = importlib.util.spec_from_file_location(
        "dike_escribe_claro", _RAIZ / "escritor" / "escribe_claro.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = mod
    try:
        spec.loader.exec_module(mod)
    except Exception:
        sys.modules.pop(spec.name, None)
        raise
    return mod


@router.post("/estilo/analizar")
def estilo_analizar(body: dict):
    """Analiza claridad, voz pasiva, nominalizaciones, arcaísmos y alineación judicial."""
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail=_detalle('BODY_INVALID'))
    texto = _texto_privacidad(body)
    if not texto.strip():
        raise HTTPException(status_code=400, detail=_detalle('TEXT_MISSING'))
    contexto = body.get("contexto") or "escrito"
    if not isinstance(contexto, str):
        raise HTTPException(status_code=400, detail=_detalle('STYLE_CONTEXT_INVALID'))
    detallado = body.get("detallado", True)
    if not isinstance(detallado, bool):
        raise HTTPException(status_code=400, detail=_detalle('STYLE_DETAIL_INVALID'))
    ec = _escribe_claro()
    return ec.analizar_estilo(texto, contexto=contexto, detallado=detallado)


@router.post("/estilo/grafo")
def estilo_grafo(body: dict):
    """Extrae el grafo de estructura argumentativa (Hecho → Norma → Prueba → Conclusión)."""
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail=_detalle('BODY_INVALID'))
    texto = _texto_privacidad(body)
    if not texto.strip():
        raise HTTPException(status_code=400, detail=_detalle('TEXT_MISSING'))
    ec = _escribe_claro()
    return ec.extraer_grafo_argumentos(texto)


def _ordenamiento():
    """Carga ``ordenamiento/`` por ruta como ``dike_ordenamiento``."""
    if "dike_ordenamiento" in sys.modules:
        return sys.modules["dike_ordenamiento"]
    spec = importlib.util.spec_from_file_location(
        "dike_ordenamiento",
        _RAIZ / "ordenamiento" / "__init__.py",
        submodule_search_locations=[str(_RAIZ / "ordenamiento")])
    mod = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = mod
    try:
        spec.loader.exec_module(mod)
    except Exception:
        sys.modules.pop(spec.name, None)
        raise
    return mod


_JUR_ID = re.compile(r"^[a-z]{2,8}$")
_NOMBRE_TXT = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}\.txt$")


@router.get("/ordenamiento/perfiles")
def ordenamiento_perfiles():
    """Lista los perfiles de ordenamiento disponibles (referencia Chile y ejemplo xx)."""
    ord_mod = _ordenamiento()
    candidatos = [
        ("cl", _RAIZ / "ordenamiento" / "perfiles" / "cl.json", "referencia"),
        ("xx", _RAIZ / "ordenamiento" / "ejemplos" / "pais-ficticio" / "perfil-xx.json", "ejemplo"),
    ]
    perfiles = []
    for codigo, ruta, origen in candidatos:
        if not ruta.is_file():
            continue
        try:
            perfil = ord_mod.cargar_perfil(ruta)
            errores = ord_mod.validar_perfil(perfil)
            tipos = [
                {"id": t.get("codigo"), "etiqueta": t.get("nombre"), "nivel": t.get("nivel")}
                for t in ((perfil.get("normas") or {}).get("tipos") or [])
                if isinstance(t, dict)
            ]
            perfiles.append({
                "id": perfil.get("perfil") or codigo,
                "jurisdiccion": (perfil.get("identidad") or {}).get("jurisdiccion") or codigo,
                "nombre": perfil.get("nombre") or codigo.upper(),
                "idioma": ((perfil.get("identidad") or {}).get("idiomas") or ["es"])[0],
                "version": perfil.get("perfilVersion") or "1.0.0",
                "origen": origen,
                "valido": len(errores) == 0,
                "errores": errores,
                "tipos_norma": tipos,
                "perfil": perfil,
            })
        except Exception:
            continue
    # Incluir ejemplo de paquete y textos de muestra para pruebas rápidas
    ej_dir = _RAIZ / "ordenamiento" / "ejemplos" / "pais-ficticio"
    ejemplo = None
    try:
        paq_path = ej_dir / "paquete.json"
        if paq_path.is_file():
            paq = json.loads(paq_path.read_text(encoding="utf-8"))
            textos = {}
            for tp in sorted((ej_dir / "textos").glob("*.txt")):
                textos[f"textos/{tp.name}"] = tp.read_text(encoding="utf-8")
            ejemplo = {"paquete": paq, "textos": textos}
    except Exception:
        ejemplo = None
    return {"perfiles": perfiles, "ejemplo_xx": ejemplo}


@router.post("/ordenamiento/plantilla")
def ordenamiento_plantilla(body: dict):
    """Genera una plantilla de perfil y paquete para un código de jurisdicción."""
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail=_detalle('BODY_INVALID'))
    jur = _campo_json(body, "jur", str, "").strip().lower()
    if not _JUR_ID.match(jur):
        raise HTTPException(
            status_code=400,
            detail=_detalle('JURISDICTION_INVALID'),
        )
    ord_mod = _ordenamiento()
    return {
        "ok": True,
        "jur": jur,
        "perfil": ord_mod.plantilla_perfil(jur),
        "paquete": ord_mod.plantilla_paquete(),
    }


@router.post("/ordenamiento/validar-perfil")
def ordenamiento_validar_perfil(body: dict):
    """Valida un objeto JSON de perfil de ordenamiento contra dike-perfil-ordenamiento-v1."""
    if not isinstance(body, dict) or not isinstance(body.get("perfil"), dict):
        raise HTTPException(status_code=400, detail=_detalle('PROFILE_MISSING'))
    ord_mod = _ordenamiento()
    errores = ord_mod.validar_perfil(body["perfil"])
    return {"ok": len(errores) == 0, "errores": errores}


@router.post("/ordenamiento/construir")
def ordenamiento_construir(body: dict):
    """Construye y valida (C0–C3) un pack de normas en un directorio aislado."""
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail=_detalle('BODY_INVALID'))
    perfil = body.get("perfil")
    paquete = body.get("paquete")
    textos = body.get("textos")
    if not isinstance(perfil, dict):
        raise HTTPException(status_code=400, detail=_detalle('PROFILE_MISSING'))
    if not isinstance(paquete, dict):
        raise HTTPException(status_code=400, detail=_detalle('PACK_MISSING'))
    if not isinstance(textos, dict) or not textos or len(textos) > 25:
        raise HTTPException(status_code=400, detail=_detalle('FILES_COUNT_INVALID'))
    ord_mod = _ordenamiento()
    errores_perfil = ord_mod.validar_perfil(perfil)
    if errores_perfil:
        return {"ok": False, "etapa": "perfil", "errores": errores_perfil}

    mod = _adaptador()
    base_tmp = mod._carpeta_de_datos() / "tmp-ordenamiento"
    base_tmp.mkdir(parents=True, exist_ok=True)
    os.chmod(base_tmp, 0o700)
    with tempfile.TemporaryDirectory(dir=base_tmp, prefix="build-") as tmp_str:
        tmp = Path(tmp_str)
        dir_in = tmp / "entrada"
        dir_in.mkdir()
        (dir_in / "textos").mkdir()
        for rel_name, contenido in textos.items():
            if not isinstance(rel_name, str) or not isinstance(contenido, str):
                raise HTTPException(status_code=400, detail=_detalle('FILES_INVALID'))
            try:
                tamano = len(contenido.encode('utf-8'))
            except UnicodeEncodeError:
                raise HTTPException(status_code=400, detail=_detalle('STATUTE_UNICODE_INVALID')) from None
            if tamano > 200_000:
                raise HTTPException(status_code=400, detail=_detalle('STATUTE_TEXT_TOO_LARGE'))
            limpio = rel_name.removeprefix("textos/").strip()
            if not _NOMBRE_TXT.match(limpio):
                raise HTTPException(
                    status_code=400,
                    detail=_detalle('FILENAME_INVALID', name=rel_name))
            destino_txt = (dir_in / "textos" / limpio) if rel_name.startswith("textos/") else (dir_in / limpio)
            destino_txt.write_text(contenido, encoding="utf-8")

        perfil_path = dir_in / "perfil.json"
        config_path = dir_in / "paquete.json"
        perfil_path.write_text(json.dumps(perfil, ensure_ascii=False), encoding="utf-8")
        config_path.write_text(json.dumps(paquete, ensure_ascii=False), encoding="utf-8")
        salida_dir = tmp / "pack-salida"
        try:
            construccion = ord_mod.construir(perfil_path, config_path, salida_dir, force=True)
            informe = ord_mod.validar_pack(salida_dir, perfil_path)
        except (ValueError, FileNotFoundError, KeyError) as exc:
            return {"ok": False, "etapa": "construccion", "error": _limpio(str(exc))}
        return {
            "ok": informe.get("nivelAlcanzado") == "C1",
            "construccion": {
                "packId": construccion.get("packId"),
                "jurisdiccion": construccion.get("jurisdiccion"),
                "normas": construccion.get("normas"),
                "articulos": construccion.get("articulos"),
                "ventanasVigencia": construccion["vigencias"],
                "aristas": construccion["edges"],
                "manifestCoreSha256": construccion.get("manifestCoreSha256"),
            },
            "compatibilidad": {
                "nivelAlcanzado": informe.get("nivelAlcanzado"),
                "niveles": informe.get("niveles"),
                "gid": informe.get("gid"),
                "advertencias": informe.get("advertencias") or [],
            },
        }


_PREFS_DEFAULT = {
    "tema_papel": "clasico",
    "fuente": "Georgia, 'Times New Roman', serif",
    "tamano_fuente": "12",
    "ancho_hoja": "a4",
    "estrategia_privacidad": "media",
    "contexto_estilo": "escrito",
    "mostrar_pizarra": True,
    "mostrar_chat": True,
    "auto_detectar_privacidad": True,
    "auto_analizar_estilo": False,
}
_PREFS_TEMAS = {"clasico", "sepia", "nocturno"}
_PREFS_ANCHOS = {"a4", "carta", "ancho"}
_PREFS_ESTRATEGIAS = {"ligera", "media", "estricta"}
_PREFS_CONTEXTOS = {"escrito", "demanda", "sentencia", "general"}
_prefs_lock = threading.Lock()


def _ruta_prefs(mod) -> Path:
    return mod._carpeta_de_datos() / "preferencias.json"


@router.get("/preferencias")
def preferencias_obtener():
    """Lee las preferencias visuales y operativas del usuario."""
    mod = _adaptador()
    p = _ruta_prefs(mod)
    guardado = {}
    if p.is_file():
        try:
            data = json.loads(p.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                guardado = data
        except (OSError, json.JSONDecodeError):
            guardado = {}
    return {**_PREFS_DEFAULT, **guardado}


@router.post("/preferencias")
def preferencias_guardar(body: dict):
    """Guarda preferencias personalizadas del usuario en plugin-data."""
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail=_detalle('BODY_INVALID'))
    nuevo = {}
    if "tema_papel" in body:
        if _campo_json(body, "tema_papel", str) not in _PREFS_TEMAS:
            raise HTTPException(status_code=400, detail=_detalle('PAPER_THEME_INVALID'))
        nuevo["tema_papel"] = body["tema_papel"]
    if "fuente" in body:
        if len(_campo_json(body, "fuente", str)) > 120:
            raise HTTPException(status_code=400, detail=_detalle('FONT_INVALID'))
        nuevo["fuente"] = body["fuente"]
    if "tamano_fuente" in body:
        t = str(_campo_json(body, "tamano_fuente", (str, int)))
        if t not in {"10", "11", "12", "13", "14", "16", "18", "20"}:
            raise HTTPException(status_code=400, detail=_detalle('FONT_SIZE_INVALID'))
        nuevo["tamano_fuente"] = t
    if "ancho_hoja" in body:
        if _campo_json(body, "ancho_hoja", str) not in _PREFS_ANCHOS:
            raise HTTPException(status_code=400, detail=_detalle('PAGE_WIDTH_INVALID'))
        nuevo["ancho_hoja"] = body["ancho_hoja"]
    if "estrategia_privacidad" in body:
        if _campo_json(body, "estrategia_privacidad", str) not in _PREFS_ESTRATEGIAS:
            raise HTTPException(status_code=400, detail=_detalle('PRIVACY_STRATEGY_INVALID'))
        nuevo["estrategia_privacidad"] = body["estrategia_privacidad"]
    if "contexto_estilo" in body:
        if _campo_json(body, "contexto_estilo", str) not in _PREFS_CONTEXTOS:
            raise HTTPException(status_code=400, detail=_detalle('STYLE_CONTEXT_OPTION_INVALID'))
        nuevo["contexto_estilo"] = body["contexto_estilo"]
    for bkey in ("mostrar_pizarra", "mostrar_chat", "auto_detectar_privacidad", "auto_analizar_estilo"):
        if bkey in body:
            if not isinstance(body[bkey], bool):
                raise HTTPException(status_code=400, detail=_detalle('FIELD_BOOLEAN_INVALID', field=bkey))
            nuevo[bkey] = body[bkey]

    mod = _adaptador()
    destino = _ruta_prefs(mod)
    with _prefs_lock:
        nuevo = {**preferencias_obtener(), **nuevo}
        destino.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=destino.parent, prefix=".prefs.", suffix=".tmp")
        try:
            os.chmod(tmp, 0o600)
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                f.write(json.dumps(nuevo, ensure_ascii=False, indent=2))
            os.replace(tmp, destino)
        except BaseException:
            try:
                os.unlink(tmp)
            except OSError:
                pass
            raise
        os.chmod(destino, 0o600)
    return nuevo

