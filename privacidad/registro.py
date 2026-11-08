"""Registro de envíos (auditoría sin contenido).

Append JSONL a `<plugin-data>/dike/privacidad/envios.jsonl` (0600). Nunca
guarda texto del usuario ni del modelo: solo metadatos del envío. Si no se
puede escribir, levanta excepción — el cliente NO debe enviar (fail-closed).
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path

_LIMITE = 1_000_000


def registrar_envio(dir_datos: Path, case_id: str, destino: str, sha256: str,
                    conteos: dict, estrategia: str, seudonimizado: bool) -> dict:
    directorio = Path(dir_datos) / "privacidad"
    directorio.mkdir(parents=True, exist_ok=True)
    os.chmod(directorio, 0o700)
    ruta = directorio / "envios.jsonl"
    if ruta.is_file() and ruta.stat().st_size > _LIMITE:
        ruta.replace(directorio / "envios.jsonl.1")
    linea = {
        "ts": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "case_id": case_id,
        "destino": destino,
        "sha256": sha256,
        "conteos": conteos,
        "estrategia": estrategia,
        "seudonimizado": bool(seudonimizado),
    }
    fd = os.open(ruta, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
    with os.fdopen(fd, "a", encoding="utf-8") as f:
        f.write(json.dumps(linea, ensure_ascii=False) + "\n")
    os.chmod(ruta, 0o600)
    return linea
