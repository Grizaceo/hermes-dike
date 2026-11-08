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
import sys
from pathlib import Path

from fastapi import APIRouter, HTTPException

router = APIRouter()
_RAIZ = Path(__file__).resolve().parent.parent
_LEYES = 25
_ARTICULOS = 8544


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
