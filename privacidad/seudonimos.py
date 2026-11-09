"""Seudónimos estables por caso + decisiones del abogado (persistidos).

El mapa vive en `<plugin-data>/dike/privacidad/<case_id>.json` (dir 0700,
archivo 0600, escritura atómica bajo lock). Un mismo valor normalizado → el
mismo token en todo el caso y entre llamadas: es SEUDONIMIZACIÓN (reversible
con el mapa local), no anonimización.
"""

from __future__ import annotations

import hashlib
import json
import os
import tempfile
import threading
from datetime import datetime, timezone
from pathlib import Path

from dike_privacidad.detector import detectar, normalizar_valor

_lock = threading.Lock()

_PREFIJOS = {
    "full_name": "PERSONA",
    "rut": "RUT",
    "pasaporte": "PASAPORTE",
    "email": "EMAIL",
    "phone_cl": "TELEFONO",
    "phone_fixed": "TELEFONO",
    "phone_intl": "TELEFONO",
    "address": "DIRECCION",
    "patente_cl": "PATENTE",
    "rol_avaluo": "ROL_AVALUO",
}
_PREFIX_SENSIBLE = "DATO_SENSIBLE"
_PREFIX_DEFAULT = "DATO"


def _dir_privacidad(dir_datos: Path) -> Path:
    return Path(dir_datos) / "privacidad"


def _ruta_caso(dir_datos: Path, case_id: str) -> Path:
    return _dir_privacidad(dir_datos) / f"{case_id}.json"


def _leer(dir_datos: Path, case_id: str) -> dict:
    """Mapa + decisiones del caso. Solo un archivo INEXISTENTE da el estado
    vacío: un JSON corrupto levanta excepción (la ruta responde 5xx y no sale
    nada) — nunca se reinicia el mapa, que haría que [PERSONA_1] pasara a ser
    otra persona."""
    ruta = _ruta_caso(dir_datos, case_id)
    try:
        return json.loads(ruta.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {"mapa": {}, "decisiones": {}}


def _escribir(dir_datos: Path, case_id: str, doc: dict) -> None:
    directorio = _dir_privacidad(dir_datos)
    directorio.mkdir(parents=True, exist_ok=True)
    os.chmod(directorio, 0o700)
    destino = _ruta_caso(dir_datos, case_id)
    fd, tmp = tempfile.mkstemp(dir=directorio, prefix=f".{case_id}.", suffix=".tmp")
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


def _prefijo(tipo: str, categoria: str) -> str:
    if categoria == "sensible":
        return _PREFIX_SENSIBLE
    return _PREFIJOS.get(tipo, _PREFIX_DEFAULT)


def _token(mapa: dict, tipo: str, categoria: str, valor_norm: str) -> str:
    """Token estable para un valor normalizado dentro del caso."""
    if valor_norm in mapa:
        return mapa[valor_norm]["token"]
    prefijo = _prefijo(tipo, categoria)
    usados = {e["token"] for e in mapa.values()}
    n = 1
    while f"[{prefijo}_{n}]" in usados:
        n += 1
    return f"[{prefijo}_{n}]"


def decisiones(dir_datos: Path, case_id: str) -> dict:
    return _leer(dir_datos, case_id)["decisiones"]


def guardar_decision(dir_datos: Path, case_id: str, valor: str, accion: str,
                     tipo: str = "full_name") -> dict:
    """Registra la decisión del abogado sobre un valor (conservar/enmascarar/
    olvidar). Devuelve las decisiones vigentes."""
    with _lock:
        doc = _leer(dir_datos, case_id)
        clave = normalizar_valor(valor)
        if accion == "olvidar":
            doc["decisiones"].pop(clave, None)
        else:
            doc["decisiones"][clave] = {
                "valor": valor, "accion": accion, "tipo": tipo,
                "fecha": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            }
        _escribir(dir_datos, case_id, doc)
        return doc["decisiones"]


def seudonimizar(dir_datos: Path, case_id: str, texto: str,
                 estrategia: str = "media") -> dict:
    """Devuelve el texto con tokens estables en vez de datos personales."""
    with _lock:
        doc = _leer(dir_datos, case_id)
        mapa = doc["mapa"]
        decisiones_doc = doc["decisiones"]
        conservar = [d["valor"] for d in decisiones_doc.values()
                     if d["accion"] == "conservar"]
        enmascarar = [d["valor"] for d in decisiones_doc.values()
                      if d["accion"] == "enmascarar"]
        entidades = detectar(texto, estrategia=estrategia,
                             conservar_valores=conservar,
                             enmascarar_valores=enmascarar)

        sustituciones = []
        cubiertos = []
        for e in entidades:
            if e["accion"] != "enmascarar":
                continue
            vn = normalizar_valor(e["valor"])
            token = _token(mapa, e["tipo"], e["categoria"], vn)
            if vn not in mapa:
                mapa[vn] = {"token": token, "valor": e["valor"], "tipo": e["tipo"]}
            sustituciones.append({"inicio": e["inicio"], "fin": e["fin"],
                                  "token": token, "tipo": e["tipo"]})
            cubiertos.append((e["inicio"], e["fin"]))

        # Valores ya mapeados en el caso se enmascaran donde reaparezcan,
        # aunque en este texto no tengan contexto de detección — salvo los
        # que el abogado marcó 'conservar'.
        conservados = {normalizar_valor(d["valor"])
                       for d in decisiones_doc.values() if d["accion"] == "conservar"}
        import re as _re
        for vn, entrada in mapa.items():
            if vn in conservados:
                continue
            patron = _re.compile(
                r"(?<!\w)" + _re.escape(entrada["valor"]) + r"(?!\w)",
                _re.IGNORECASE | _re.UNICODE)
            for m in patron.finditer(texto):
                if any(max(m.start(), s) < min(m.end(), f) for s, f in cubiertos):
                    continue
                sustituciones.append({"inicio": m.start(), "fin": m.end(),
                                      "token": entrada["token"],
                                      "tipo": entrada["tipo"]})
                cubiertos.append(m.span())

        out = texto
        for s in sorted(sustituciones, key=lambda s: s["inicio"], reverse=True):
            out = out[:s["inicio"]] + s["token"] + out[s["fin"]:]
        _escribir(dir_datos, case_id, doc)

    conteos: dict[str, int] = {}
    for s in sustituciones:
        conteos[s["tipo"]] = conteos.get(s["tipo"], 0) + 1
    return {
        "texto": out,
        "sustituciones": sustituciones,
        "mapa": {e["token"]: e["valor"] for e in mapa.values()},
        "conteos": conteos,
        "sha256": hashlib.sha256(out.encode("utf-8")).hexdigest(),
    }
