"""Reglas de acuñación de IRIs y contexto efectivo de un pack.

``BASE`` replica la base de ``motor/…/starter_graph/iris.py`` sin importarla:
los packs viven bajo ``https://dike.invalid/``.
"""
from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path

BASE = "https://dike.invalid/"
VOCAB = "https://dike.invalid/vocab/"
LEXO_BASE = "https://lexo.cl/"

_DIR = Path(__file__).resolve().parent
_NUCLEO_CTX_PATH = _DIR / "nucleo" / "context.jsonld"

_RE_CAMPO = re.compile(r"\{(\w+)\}")


def _rellenar(plantilla: str, campos: dict) -> str:
    return _RE_CAMPO.sub(lambda m: str(campos.get(m.group(1), m.group(0))), plantilla)


def _nucleo_contexto() -> dict:
    return json.loads(_NUCLEO_CTX_PATH.read_text(encoding="utf-8"))["@context"]


def jur_efectivo(perfil: dict) -> str:
    """Jurisdicción para acuñar IRIs: ``jur`` más ``-subdivision`` si el perfil la declara."""
    identidad = perfil.get("identidad") or {}
    jur = str(identidad.get("jurisdiccion") or perfil.get("perfil") or "")
    subdivision = identidad.get("subdivision")
    return f"{jur}-{subdivision}" if subdivision else jur


def id_norma(perfil: dict, eli: dict) -> str:
    """``@id`` de un LegalResource: ``BASE + plantillaNorma`` con ``{jur,tipo,numero,anio}``."""
    plantilla = (perfil.get("normas") or {}).get("acunacion", {}).get("plantillaNorma", "")
    path = _rellenar(plantilla, {
        "jur": jur_efectivo(perfil),
        "tipo": eli.get("type"),
        "numero": eli.get("number"),
        "anio": eli.get("year"),
    })
    return BASE + path


def id_unidad(perfil: dict, is_part_of: str, eid: str) -> str:
    """``@id`` de un Article: ``plantillaUnidad`` con ``{norma}`` = IRI de la norma y ``{eId}``."""
    plantilla = (perfil.get("normas") or {}).get("acunacion", {}).get("plantillaUnidad", "{norma}/{eId}")
    return _rellenar(plantilla, {"norma": is_part_of, "eId": eid})


def id_vigencia(perfil: dict, recurso: str) -> str:
    """``@id`` de una TemporalWindow: ``plantillaVigencia`` con ``{recurso}`` = IRI del recurso."""
    plantilla = (perfil.get("normas") or {}).get("acunacion", {}).get("plantillaVigencia", "{recurso}/vigencia")
    return _rellenar(plantilla, {"recurso": recurso})


def id_arista(perfil: dict, tipo: str, source: str, target: str) -> str:
    """``@id`` de una Edge según ``reglaArista`` del perfil."""
    regla = ((perfil.get("normas") or {}).get("acunacion") or {}).get("reglaArista", "actual")
    if regla == "legada-lexo-cl":
        # Regla anterior a ARCH-004: sha256(source+target+type)[:20] sobre IRIs con base lexo.cl.
        src = LEXO_BASE + source[len(BASE):] if source.startswith(BASE) else source
        tgt = LEXO_BASE + target[len(BASE):] if target.startswith(BASE) else target
        digest = hashlib.sha256(f"{src}{tgt}{tipo}".encode("utf-8")).hexdigest()[:20]
    else:
        # Regla actual (build.py): sha256(type\nsource\ntarget)[:24].
        digest = hashlib.sha256(f"{tipo}\n{source}\n{target}".encode("utf-8")).hexdigest()[:24]
    return f"{BASE}edges/{digest}"


def contexto_efectivo(perfil: dict) -> dict:
    """Contexto JSON-LD del pack: el del núcleo más las extensiones bajo ``vocab/<jur>/``."""
    ctx = dict(_nucleo_contexto())
    jur = str(perfil.get("perfil") or "")
    for extension in perfil.get("extensiones") or []:
        termino = extension.get("termino")
        if isinstance(termino, str) and termino:
            ctx[termino] = f"{VOCAB}{jur}/{termino}"
    return {"@context": ctx}
