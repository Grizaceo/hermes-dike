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
    python scripts/panel.py grafo red

Casos NIF y el grafo personal viven en ``DIKE_USERS_ROOT/<DIKE_USER>/`` — el
plugin-data del perfil, FUERA de la generación sellada del corpus: escribir
ahí no toca la integridad que ``constancia`` verifica en cada llamada. El
corpus sellado solo se lee (``grafo corpus*``), nunca se escribe.
"""

from __future__ import annotations

import hashlib
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


# Rótulos cortos de los instrumentos del pack chile-base. Para 'codigo' y
# 'constitucion' el eli.number es un slug, no una numeración.
_NOMBRES_CODIGO = {
    "constitucion": "Constitución",
    "codigo-aguas": "Código de Aguas",
    "codigo-civil": "Código Civil",
    "codigo-comercio": "Código de Comercio",
    "codigo-del-trabajo": "Código del Trabajo",
    "codigo-organico-tribunales": "Código Orgánico de Tribunales",
    "codigo-penal": "Código Penal",
    "codigo-procesal-penal": "Código Procesal Penal",
    "codigo-tributario": "Código Tributario",
    "cpc": "Código de Procedimiento Civil",
}


def _nombre_corto(eli: dict) -> str:
    """'Código del Trabajo', 'Ley 20.720', 'DL 3.500', 'Constitución'."""
    tipo = str(eli.get("type") or "").strip()
    numero = str(eli.get("number") or "").strip()
    if numero in _NOMBRES_CODIGO:
        return _NOMBRES_CODIGO[numero]
    if tipo == "constitucion":
        return "Constitución"
    digitos = numero if numero.isdigit() else re.sub(r"^\D+", "", numero)
    if digitos.isdigit():
        numero = f"{int(digitos):,}".replace(",", ".")
    nombre = {"ley": "Ley", "decreto-ley": "DL"}.get(tipo, tipo.capitalize() or "Norma")
    return f"{nombre} {numero}".strip()


# ---------------------------------------------------------------------------
# Unidades normativas mínimas (una por inciso/línea) y modalidad deóntica
# ---------------------------------------------------------------------------

_LINEA_UNIDAD = re.compile(r"[^\n]*\S[^\n]*")
_LETRA_UNIDAD = re.compile(r"^([a-zñ])\)\s")
_NUMERO_UNIDAD = re.compile(r"^(\d+)[\.\)°º]\s")
_NUMERO_EN_UNIDAD = re.compile(r"^N[°º]\s*(\d+)")


def _unidades(texto: str) -> list[dict]:
    """Una unidad por línea no vacía del texto del artículo, en orden.

    Los offsets son exactos: ``texto[char_start:char_end]`` es el texto de la
    unidad (la línea sin espacios extremos)."""
    unidades: list[dict] = []
    incisos = 0
    for m in _LINEA_UNIDAD.finditer(texto):
        raw = m.group()
        lead = len(raw) - len(raw.lstrip())
        u = raw.strip()
        start = m.start() + lead
        letra = _LETRA_UNIDAD.match(u)
        numero = _NUMERO_UNIDAD.match(u) or _NUMERO_EN_UNIDAD.match(u)
        if letra:
            etiqueta = f"letra {letra.group(1)})"
        elif numero:
            etiqueta = f"número {numero.group(1)}"
        else:
            incisos += 1
            etiqueta = f"inciso {incisos}"
        unidades.append({
            "texto": u,
            "etiqueta": etiqueta,
            "orden": len(unidades) + 1,
            "char_start": start,
            "char_end": start + len(u),
        })
    return unidades


# Reglas de modalidad deóntica, en orden de precedencia: gana la primera que
# calza y su id queda en `modalidad_regla`. Las etiquetas son CANDIDATAS
# deterministas — la misma postura que `deontic_validated: false` del NIF:
# ninguna modalidad pasa por validación humana en esta fase.
_MODALIDADES: list[tuple[str, str, "re.Pattern[str]"]] = [
    ("R-EXC", "excepcion", re.compile(
        r"^(no obstante|sin perjuicio|con todo|salvo|exceptúa|exceptua|"
        r"lo dispuesto en (el|los) inciso)")),
    ("R-PRO", "prohibicion", re.compile(
        r"\b(se proh[ií]be|proh[ií]bese|queda(n)? prohibid[oa]s?|"
        r"no podr[áa]n?|no se podr[áa]|en ning[úu]n caso)\b")),
    ("R-SAN", "sancion", re.compile(
        r"\b(ser[áa]n? sancionad[oa]s?|ser[áa]n? castigad[oa]s?|multa de|"
        r"presidio|reclusi[óo]n|pena de)\b")),
    ("R-OBL", "obligacion", re.compile(
        r"\b(deber[áa]n?|estar[áa]n? obligad[oa]s?|ser[áa] obligatori[oa]|"
        r"tendr[áa]n? la obligaci[óo]n)\b")),
    ("R-POT", "potestad", re.compile(
        r"\b(corresponder[áa] (al|a la|a los|a las)|compete (al|a la)|"
        r"estar[áa] facultad[oa])\b")),
    ("R-PER", "permiso", re.compile(
        r"\b(podr[áa]n?|se permite|tendr[áa]n? derecho|es l[íi]cito)\b")),
    ("R-DEF", "definicion", re.compile(
        r"\b(se entender[áa] por|entiéndese por|entiendese por|"
        r"para (los )?efectos de (esta|la presente) ley)\b")),
]


def _modalidad(linea: str) -> tuple[str, str | None]:
    """(modalidad, regla) de una unidad; ('otra', None) si ninguna regla calza."""
    lower = linea.lower()
    for rid, mod, rx in _MODALIDADES:
        if rx.search(lower):
            return mod, rid
    return "otra", None


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

    if op == "unidad":
        # Texto y offsets de UNA unidad: /grafo/red no lleva texto de unidades;
        # la ficha del panel lo pide aquí al hacer clic.
        if len(rest) != 1:
            return _fail("grafo unidad <id>")
        uid = rest[0]
        m = re.fullmatch(r"(.+)#u(\d+)", uid)
        if not m:
            return _fail("id de unidad inválido.")
        aid, num = m.group(1), int(m.group(2))
        eid = aid.rsplit("/", 1)[-1]
        if not re.fullmatch(r"[\w.-]+", eid):
            return _fail("id de unidad inválido.")
        for current in _corpus_dirs():
            for af in (current / "articulos").glob(f"articulo_*_{eid}.json"):
                a = _read_json(af) or {}
                if str(a.get("@id") or "") != aid:
                    continue
                texto = a.get("text") or ""
                unidades = _unidades(texto)
                if not 1 <= num <= len(unidades):
                    return _fail(f"la unidad {num} no existe en ese artículo.")
                u = unidades[num - 1]
                mod, regla = _modalidad(u["texto"])
                _out({
                    "id": uid,
                    "texto": u["texto"],
                    "char_start": u["char_start"],
                    "char_end": u["char_end"],
                    "etiqueta": u["etiqueta"],
                    "orden": u["orden"],
                    "articulo": aid,
                    "articulo_url": (a.get("provenance") or {}).get("wasDerivedFrom") or None,
                    "articulo_sha256": a.get("textSha256")
                        or (a.get("citation") or {}).get("textSha256"),
                    "sha256": hashlib.sha256(u["texto"].encode("utf-8")).hexdigest(),
                    "modalidad": mod,
                    "modalidad_regla": regla,
                    "modalidad_estado": "candidata",
                })
                return 0
        return _fail("unidad no encontrada en el corpus instalado.")

    if op == "red":
        # La red completa del corpus en UNA lectura: un nodo por instrumento,
        # uno por artículo y una arista 'contiene' por artículo. El contrato
        # ya admite tipos que esta fase no emite (sentencia, resolucion;
        # cita, aplica, revisa; candidata, aprobada).
        nodos: list[dict] = []
        aristas: list[dict] = []
        for current in _corpus_dirs():
            normas_dir = current / "normas"
            if not normas_dir.is_dir():
                continue
            for nf in sorted(normas_dir.glob("norma_*.json")):
                n = _read_json(nf) or {}
                eli = n.get("eli") or {}
                code = str(n.get("leychileCode") or nf.stem.removeprefix("norma_"))
                corto = _nombre_corto(eli) or (n.get("title") or code)
                nid = str(n.get("@id") or f"norma:{code}")
                nodos.append({
                    "id": nid,
                    "tipo": "instrumento",
                    "label": corto,
                    "instrumento": None,
                    "url": n.get("sourceDocumentUrl") or n.get("sourceUri") or None,
                    "sha256": hashlib.sha256(nf.read_bytes()).hexdigest(),
                })
                archivos = sorted((current / "articulos").glob(f"articulo_{code}_*.json"))
                for af in archivos:
                    a = _read_json(af) or {}
                    aid = str(a.get("@id") or af.stem)
                    rotulo = str(a.get("label") or a.get("eId") or af.stem)
                    rotulo_art = f"{corto}, art. {rotulo}"
                    nodos.append({
                        "id": aid,
                        "tipo": "articulo",
                        "label": rotulo_art,
                        "instrumento": corto,
                        "url": (a.get("provenance") or {}).get("wasDerivedFrom") or None,
                        "sha256": a.get("textSha256")
                            or (a.get("citation") or {}).get("textSha256"),
                    })
                    aristas.append({
                        "source": nid,
                        "target": aid,
                        "tipo": "contiene",
                        "estado": "verificada_estructura",
                    })
                    unidades = _unidades(a.get("text") or "")
                    for i, u in enumerate(unidades):
                        uid = f"{aid}#u{u['orden']:02d}"
                        mod, regla = _modalidad(u["texto"])
                        nodos.append({
                            "id": uid,
                            "tipo": "unidad",
                            "label": f"{rotulo_art}, {u['etiqueta']}",
                            "instrumento": corto,
                            "url": None,
                            "sha256": hashlib.sha256(u["texto"].encode("utf-8")).hexdigest(),
                            "clase": "normativa",
                            "etiqueta": u["etiqueta"],
                            "orden": u["orden"],
                            "articulo": aid,
                            "modalidad": mod,
                            "modalidad_estado": "candidata",
                            "modalidad_regla": regla,
                        })
                        aristas.append({
                            "source": aid,
                            "target": uid,
                            "tipo": "contiene",
                            "estado": "verificada_estructura",
                        })
                        if regla == "R-EXC" and i > 0:
                            aristas.append({
                                "source": uid,
                                "target": f"{aid}#u{i:02d}",
                                "tipo": "excepciona",
                                "estado": "candidata",
                            })
        _out({
            "nodes": nodos,
            "links": aristas,
            "conteos": {"nodes": len(nodos), "links": len(aristas)},
            "truncado": False,
        })
        return 0

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
