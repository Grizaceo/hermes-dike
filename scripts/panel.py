#!/usr/bin/env python3
"""Panel Diké — driver JSON del motor para la pestaña web y la página Desktop.

Corre en el MISMO subproceso aislado que ``python -m lexo_cli``: lo lanza
``dashboard/plugin_api.py`` con el ``_entorno`` del adaptador (HOME,
LEXO_CONFIG, DIKE_USER y DIKE_USERS_ROOT redirigidos al plugin-data, y
PYTHONPATH apuntando a ``motor/`` más los paquetes del anfitrión). El motor
vendorizado queda intacto: este archivo es código del plugin, no del motor.

    python scripts/panel.py nif list
    python scripts/panel.py nif init <case_id> "<pregunta>" [problem_type]
    python scripts/panel.py nif seed <case_id>
    python scripts/panel.py nif snapshot <case_id>
    python scripts/panel.py nif edit <case_id> <field_path> <valor-json> [reason]
    python scripts/panel.py nif gap <case_id> <gap_index> <filled_by> <filled_with>
    python scripts/panel.py nif validate <case_id> <0|1>
    python scripts/panel.py nif confidence <case_id> <0.0-1.0>
    python scripts/panel.py grafo personal
    python scripts/panel.py grafo corpus
    python scripts/panel.py grafo corpus-norma <leychileCode>

Casos NIF y el grafo personal viven en ``DIKE_USERS_ROOT/<DIKE_USER>/`` — el
plugin-data del perfil, FUERA de la generación sellada del corpus: escribir
ahí no toca la integridad que ``constancia`` verifica en cada llamada. El
corpus sellado solo se lee (``grafo corpus*``), nunca se escribe.
"""

from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path

_MOTOR = Path(__file__).resolve().parent.parent / "motor"
if str(_MOTOR) not in sys.path:
    sys.path.insert(0, str(_MOTOR))

_CASE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
_MAX_ARTICULOS = 300


def _out(data) -> None:
    print(json.dumps(data, ensure_ascii=False, default=str))


def _fail(message: str) -> int:
    _out({"error": message})
    return 0


def _case_id(raw: str) -> str | None:
    return raw if _CASE_ID.match(raw) else None


def _users_root() -> Path:
    return Path(os.environ.get("DIKE_USERS_ROOT") or (Path.home() / ".dike" / "users")).expanduser()


def _user() -> str:
    return os.environ.get("DIKE_USER") or "default"


def _corpus_dirs() -> list[Path]:
    """``<users_root>/<user>/starter/*/current`` — los corpus instalados."""
    base = _users_root() / _user() / "starter"
    if not base.is_dir():
        return []
    return sorted(p for p in base.glob("*/current") if p.is_dir())


def _read_json(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


# ---------------------------------------------------------------------------
# NIF — tablero de la teoría del caso (lexo_cli.nif_studio.service)
# ---------------------------------------------------------------------------

def _nif(args: list[str]) -> int:
    from lexo_cli.nif_studio import service

    if not args:
        return _fail("nif: falta la operación (list|init|seed|snapshot|edit|gap|validate|confidence).")
    op, rest = args[0], args[1:]

    if op == "list":
        _out({"cases": service.list_cases()})
        return 0

    if op == "init":
        if len(rest) < 2:
            return _fail("nif init <case_id> <pregunta> [problem_type]")
        cid = _case_id(rest[0])
        if cid is None:
            return _fail("case_id inválido: usa letras, números, punto, guion o guion bajo.")
        problem = rest[2] if len(rest) > 2 else "mixto"
        _out(service.init_case(cid, rest[1], problem_type=problem))
        return 0

    if op == "seed":
        if len(rest) != 1:
            return _fail("nif seed <case_id>")
        cid = _case_id(rest[0])
        if cid is None:
            return _fail("case_id inválido.")
        _out(service.seed_demo(cid))
        return 0

    if op == "snapshot":
        if len(rest) != 1:
            return _fail("nif snapshot <case_id>")
        cid = _case_id(rest[0])
        if cid is None:
            return _fail("case_id inválido.")
        _out({
            "snapshot": service.nif_snapshot(cid),
            "patches": service.patches_since(cid),
        })
        return 0

    if op == "edit":
        if len(rest) < 3:
            return _fail("nif edit <case_id> <field_path> <valor-json> [reason]")
        cid = _case_id(rest[0])
        if cid is None:
            return _fail("case_id inválido.")
        try:
            value = json.loads(rest[2])
        except json.JSONDecodeError:
            return _fail("valor-json no es JSON válido.")
        reason = rest[3] if len(rest) > 3 else "Edición del usuario"
        _out(service.user_edit(cid, rest[1], value, reason=reason))
        return 0

    if op == "gap":
        if len(rest) != 4:
            return _fail("nif gap <case_id> <gap_index> <filled_by> <filled_with>")
        cid = _case_id(rest[0])
        if cid is None:
            return _fail("case_id inválido.")
        try:
            index = int(rest[1])
        except ValueError:
            return _fail("gap_index debe ser entero.")
        _out(service.fill_gap(cid, index, rest[2], rest[3]))
        return 0

    if op == "validate":
        if len(rest) != 2:
            return _fail("nif validate <case_id> <0|1>")
        cid = _case_id(rest[0])
        if cid is None:
            return _fail("case_id inválido.")
        _out(service.set_validated(cid, rest[1] in ("1", "true", "True")))
        return 0

    if op == "confidence":
        if len(rest) != 2:
            return _fail("nif confidence <case_id> <0.0-1.0>")
        cid = _case_id(rest[0])
        if cid is None:
            return _fail("case_id inválido.")
        try:
            value = float(rest[1])
        except ValueError:
            return _fail("confidence debe ser número.")
        _out(service.set_confidence(cid, value))
        return 0

    return _fail(f"nif: operación desconocida '{op}'.")


# ---------------------------------------------------------------------------
# Grafo — relaciones evidenciadas personales (GRE) y mapa del corpus sellado
# ---------------------------------------------------------------------------

def _grafo(args: list[str]) -> int:
    if not args:
        return _fail("grafo: falta el objetivo (personal|corpus|corpus-norma).")
    op, rest = args[0], args[1:]

    if op == "personal":
        from lexo_cli.pichanga.isolation import UserWorkspace
        from lexo_cli.pichanga.pipeline import PersonalPichangaPipeline
        from lexo_cli.starter.userconfig import active_user, active_users_root

        pipe = PersonalPichangaPipeline(
            UserWorkspace(active_users_root(), active_user() or "default"))
        candidates = []
        for c in pipe.list_candidates():
            item = c.to_dict()
            item["state_human"] = {
                "PENDING": "Pendiente", "ACCEPTED": "Aceptado",
                "CORRECTED": "Corregido", "REJECTED": "Rechazado",
                "DEFERRED": "Diferido", "EXPIRED": "Expirado",
                "INVALID": "Evidencia inválida",
                "PERSONAL_APPROVED": "Aprobado por ti",
            }.get(item.get("state"), item.get("state"))
            candidates.append(item)
        _out({"candidates": candidates, "edges": pipe.graph_edges()})
        return 0

    if op == "corpus":
        packs = []
        for current in _corpus_dirs():
            pack = _read_json(current / "pack.json") or {}
            # Un solo barrido de articulos/: el código de la norma va en el nombre.
            por_norma: dict[str, int] = {}
            articulos_dir = current / "articulos"
            if articulos_dir.is_dir():
                for af in articulos_dir.glob("articulo_*_art_*.json"):
                    partes = af.stem.split("_")
                    if len(partes) >= 3:
                        por_norma[partes[1]] = por_norma.get(partes[1], 0) + 1
            normas = []
            for nf in sorted((current / "normas").glob("norma_*.json")):
                n = _read_json(nf) or {}
                eli = n.get("eli") or {}
                code = str(n.get("leychileCode") or nf.stem.removeprefix("norma_"))
                temporal = n.get("temporal") or {}
                normas.append({
                    "leychileCode": code,
                    "titulo": n.get("title") or "",
                    "tipo": eli.get("type") or "",
                    "numero": eli.get("number") or "",
                    "anio": eli.get("year") or "",
                    "estado": temporal.get("status") or "",
                    "publicacion": n.get("publicationDate") or "",
                    "articulos": por_norma.get(code, 0),
                    "fuente": n.get("sourceDocumentUrl") or "",
                })
            edges_dir = current / "edges"
            edge_types: dict[str, int] = {}
            if edges_dir.is_dir():
                for ef in edges_dir.glob("edge_*.json"):
                    m = re.match(r"^edge_\d+_(.+)$", ef.stem)
                    tipo = m.group(1) if m else ef.stem
                    edge_types[tipo] = edge_types.get(tipo, 0) + 1
            vigencia = len(list((current / "vigencia").glob("vigencia_*.json"))) \
                if (current / "vigencia").is_dir() else 0
            packs.append({
                "pack": (pack.get("@id") or current.parent.name),
                "version": pack.get("version") or "",
                "normas": normas,
                "edges": edge_types,
                "vigencia": vigencia,
            })
        _out({"packs": packs})
        return 0

    if op == "corpus-norma":
        if len(rest) != 1 or not re.fullmatch(r"[0-9]+", rest[0]):
            return _fail("grafo corpus-norma <leychileCode>")
        code = rest[0]
        for current in _corpus_dirs():
            norma = _read_json(current / "normas" / f"norma_{code}.json")
            if norma is None:
                continue
            articulos = []
            files = sorted((current / "articulos").glob(f"articulo_{code}_*.json"))
            for af in files[:_MAX_ARTICULOS]:
                a = _read_json(af) or {}
                articulos.append({
                    "eId": a.get("eId") or af.stem,
                    "label": a.get("label") or "",
                    "texto": a.get("text") or "",
                    "vigente_desde": (a.get("temporal") or {}).get("from") or "",
                    "estado": (a.get("temporal") or {}).get("status") or "",
                })
            _out({
                "pack": current.parent.name,
                "norma": norma,
                "articulos": articulos,
                "articulos_total": len(files),
                "articulos_truncados": max(0, len(files) - len(articulos)),
            })
            return 0
        return _fail(f"norma {code} no está en el corpus instalado.")

    return _fail(f"grafo: objetivo desconocido '{op}'.")


def main() -> int:
    # HOME y DIKE_* ya vienen redirigidos por _entorno; crear lo que el motor
    # espera encontrar evita fallos de "directorio inexistente" en el primer uso.
    for var in ("HOME", "DIKE_USERS_ROOT"):
        if os.environ.get(var):
            Path(os.environ[var]).mkdir(parents=True, exist_ok=True)
    try:
        if len(sys.argv) < 3:
            return _fail("uso: panel.py <nif|grafo> <op> [args...]")
        group, rest = sys.argv[1], sys.argv[2:]
        if group == "nif":
            return _nif(rest)
        if group == "grafo":
            return _grafo(rest)
        return _fail(f"grupo desconocido '{group}' (nif|grafo).")
    except Exception as exc:  # crash del motor: stderr con traceback, exit 2
        import traceback
        traceback.print_exc()
        return 2


if __name__ == "__main__":
    sys.exit(main())
