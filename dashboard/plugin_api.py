"""Backend del panel Diké para el dashboard web y la app Desktop.

Hermes lo monta en ``/api/plugins/dike/`` (dashboard web) o lo enruta al
plugin host del perfil activo (Desktop). Reutiliza el adaptador del agente
cargándolo por ruta: misma validación de entrada, mismo corpus sellado, mismo
subproceso del motor. A propósito solo acepta texto: la superficie HTTP no
expone la lectura de archivos locales que el adaptador sí permite por ``ruta``.
"""

from __future__ import annotations

import importlib.util
import json
import re
import subprocess
import sys
from pathlib import Path

from fastapi import APIRouter, HTTPException

router = APIRouter()
_RAIZ = Path(__file__).resolve().parent.parent
_PANEL = _RAIZ / "scripts" / "panel.py"
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
_RUTA_LOCAL = re.compile(r"(?<![\w:/])/(?:[^\s,;\"']+)|(?<![\w/])[A-Za-z]:[\\/][^\s,;\"']+")


def _adaptador():
    """Carga ``__init__.py`` del plugin como módulo, sin efectos al importar."""
    spec = importlib.util.spec_from_file_location("dike_adapter_http", _RAIZ / "__init__.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = mod
    try:
        spec.loader.exec_module(mod)
    except Exception:
        sys.modules.pop(spec.name, None)
        raise
    return mod


def _version() -> str | None:
    try:
        import yaml
        data = yaml.safe_load((_RAIZ / "plugin.yaml").read_text(encoding="utf-8"))
        return str(data.get("version")) if isinstance(data, dict) else None
    except Exception:
        return None


@router.get("/estado")
def estado():
    """Estado del corpus sin efectos secundarios: no instala ni descarga."""
    mod = _adaptador()
    datos = mod._carpeta_de_datos()
    esperado = ""
    sums = mod._CORPUS / "SHA256SUMS"
    if sums.is_file():
        partes = sums.read_text(encoding="utf-8").split()
        if len(partes) >= 2:
            esperado = partes[0]
    generacion = datos / "generations" / esperado if esperado else None
    instalado = bool(generacion and generacion.is_dir())
    return {
        "pack_hash": mod.PACK_HASH,
        "corpus_instalado": instalado,
        "generation": generacion.name if instalado else None,
        "leyes": _LEYES,
        "articulos": _ARTICULOS,
        "version": _version(),
    }


@router.post("/verificar")
def verificar(body: dict):
    texto = body.get("texto") if isinstance(body, dict) else None
    if not isinstance(texto, str) or not texto.strip():
        raise HTTPException(status_code=400, detail="Falta el campo texto.")
    return json.loads(_adaptador().verificar_citas({"texto": texto}))


# ---------------------------------------------------------------------------
# Panel: NIF (teoría del caso) y grafo (GRE personal + mapa del corpus)
# ---------------------------------------------------------------------------

def _limpio(texto: str) -> str:
    """Quita rutas locales y recorta: stderr del motor nunca sale tal cual."""
    return _RUTA_LOCAL.sub("<ruta-local>", str(texto))[:400]


def _panel(args: list, *, corpus: bool = False, timeout: int = 90) -> dict:
    """Corre ``scripts/panel.py`` en el subproceso aislado del motor.

    Sin ``corpus`` el workspace es el plugin-data (casos NIF y grafo personal
    persisten ahí, fuera de la generación sellada). Con ``corpus`` se asegura
    la generación instalada y el panel lee el corpus sellado — nunca escribe.
    """
    mod = _adaptador()
    datos = mod._carpeta_de_datos().resolve()
    if corpus:
        instalado = mod._asegurar_corpus(datos)
        runtime = Path(instalado["generation"])
    else:
        runtime = datos
    try:
        proc = subprocess.run(
            [sys.executable, str(_PANEL), *args],
            env=mod._entorno(runtime), cwd=str(runtime),
            capture_output=True, text=True, encoding="utf-8",
            errors="replace", timeout=timeout,
        )
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="El motor tardó demasiado.")
    salida = proc.stdout.strip()
    try:
        data = json.loads(salida) if salida else {}
    except json.JSONDecodeError:
        data = None
    if proc.returncode != 0 or not isinstance(data, dict):
        detalle = _limpio(proc.stderr or salida)
        raise HTTPException(status_code=502, detail=f"motor: {detalle or 'sin salida'}")
    if data.get("error"):
        raise HTTPException(status_code=400, detail=_limpio(data["error"]))
    return data


def _case_id(body: dict) -> str:
    cid = body.get("case_id") if isinstance(body, dict) else None
    if not isinstance(cid, str) or not _CASE_ID.match(cid.strip()):
        raise HTTPException(status_code=400, detail="case_id inválido.")
    return cid.strip()


@router.get("/nif/casos")
def nif_casos():
    return _panel(["nif", "list"])


@router.post("/nif/init")
def nif_init(body: dict):
    cid = _case_id(body)
    pregunta = body.get("pregunta") if isinstance(body, dict) else None
    if not isinstance(pregunta, str) or not pregunta.strip():
        raise HTTPException(status_code=400, detail="Falta el campo pregunta.")
    args = ["nif", "init", cid, pregunta.strip()]
    tipo = body.get("problem_type")
    if isinstance(tipo, str) and tipo.strip():
        args.append(tipo.strip())
    return _panel(args)


@router.post("/nif/seed")
def nif_seed(body: dict):
    return _panel(["nif", "seed", _case_id(body)])


@router.get("/nif/snapshot")
def nif_snapshot(case_id: str):
    if not _CASE_ID.match(case_id.strip()):
        raise HTTPException(status_code=400, detail="case_id inválido.")
    return _panel(["nif", "snapshot", case_id.strip()])


@router.post("/nif/edit")
def nif_edit(body: dict):
    cid = _case_id(body)
    campo = body.get("field_path")
    if campo not in _CAMPOS_NIF:
        raise HTTPException(status_code=400, detail="field_path no editable desde el panel.")
    if "value" not in body:
        raise HTTPException(status_code=400, detail="Falta el campo value.")
    args = ["nif", "edit", cid, campo, json.dumps(body["value"], ensure_ascii=False)]
    razon = body.get("reason")
    if isinstance(razon, str) and razon.strip():
        args.append(razon.strip())
    return _panel(args)


@router.post("/nif/gap")
def nif_gap(body: dict):
    cid = _case_id(body)
    try:
        indice = int(body.get("gap_index"))
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="gap_index debe ser entero.")
    for campo in ("filled_by", "filled_with"):
        if not isinstance(body.get(campo), str) or not body[campo].strip():
            raise HTTPException(status_code=400, detail=f"Falta el campo {campo}.")
    return _panel(["nif", "gap", cid, str(indice),
                   body["filled_by"].strip(), body["filled_with"].strip()])


@router.post("/nif/validar")
def nif_validar(body: dict):
    cid = _case_id(body)
    if not isinstance(body.get("validated"), bool):
        raise HTTPException(status_code=400, detail="validated debe ser booleano.")
    return _panel(["nif", "validate", cid, "1" if body["validated"] else "0"])


@router.post("/nif/confianza")
def nif_confianza(body: dict):
    cid = _case_id(body)
    try:
        valor = float(body.get("confidence"))
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="confidence debe ser número.")
    return _panel(["nif", "confidence", cid, str(valor)])


@router.get("/grafo/personal")
def grafo_personal():
    return _panel(["grafo", "personal"])


@router.get("/grafo/corpus")
def grafo_corpus():
    return _panel(["grafo", "corpus"], corpus=True, timeout=300)


@router.get("/grafo/corpus/norma/{code}")
def grafo_corpus_norma(code: str):
    if not code.isdigit():
        raise HTTPException(status_code=400, detail="code debe ser el leychileCode numérico.")
    return _panel(["grafo", "corpus-norma", code], corpus=True, timeout=300)


@router.get("/grafo/red")
def grafo_red(fuente: str = "corpus"):
    """La red del grafo en una sola llamada (hoy solo el corpus sellado).

    La respuesta se cachea en plugin-data por pack_hash: la primera lectura
    barre los ~8.500 artículos, las siguientes sirven el archivo."""
    if fuente != "corpus":
        raise HTTPException(
            status_code=400,
            detail=f"fuente '{fuente}' no existe: solo 'corpus' está implementada.")
    mod = _adaptador()
    # El nombre lleva la versión del contrato: un cambio de esquema no puede
    # servir una forma vieja guardada por una versión anterior del plugin.
    cache = mod._carpeta_de_datos() / "cache" / f"grafo_red_v1_{mod.PACK_HASH}.json"
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
