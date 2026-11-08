#!/usr/bin/env python3
"""Construye la red ambiental local del grafo 3D desde app_anon_v2.db.

Salida (solo plugin-data, nunca el repo): red.json, unidades.json y
construccion.json en <plugin-data>/dike/grafo-local/ambiental/ (dir 700,
archivos 600). Rechaza correr si el sha256 de la DB no coincide con
aprobacion_anonimizacion.json. Los textos y evidencias viven en
unidades.json, no en red.json (payload delgado como el corpus).
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import sqlite3
import sys
import time
from collections import Counter, defaultdict
from pathlib import Path

FUENTES = Path.home() / ".hermes/profiles/lexo-alpha/plugin-data/dike/grafo-local/fuentes"
SALIDA = Path.home() / ".hermes/profiles/lexo-alpha/plugin-data/dike/grafo-local/ambiental"
DB = FUENTES / "app_anon_v2.db"
APROBACION = FUENTES / "aprobacion_anonimizacion.json"

# ---------------------------------------------------------------------------
# Reglas deterministas (candidatas, sin validar — misma postura que la NIF)
# ---------------------------------------------------------------------------

_NUM = r"(\d{1,3})(?:\s*(bis|ter|qu[áa]ter))?"
_SEP = r"(?:\s*,\s*|\s+y\s+|\s+e\s+|\s+o\s+)"
RX_CITA = re.compile(
    r"\bart(?:[íi]culo|\.)s?\s+((?:\d{1,3}(?:\s*(?:bis|ter|qu[áa]ter))?"
    r"(?:\s+inciso\s+(?:primero|segundo|tercero|cuarto|quinto|sexto|final|\d+))?"
    r"(?:\s*,\s*|\s+y\s+|\s+e\s+|\s+o\s+)*)+)",
    re.IGNORECASE)
RX_NUM_ITEM = re.compile(
    r"(\d{1,3})(?:\s*(bis|ter|qu[áa]ter))?"
    r"(?:\s+inciso\s+(primero|segundo|tercero|cuarto|quinto|sexto|final|\d+))?",
    re.IGNORECASE)
RX_SENTENCIA_FIN = re.compile(r"[.;]\s+[A-ZÁÉÍÓÚÑ]")

# Cuerpos legales → instrumento. (id regla irrelevante; se usa el orden).
CUERPOS = [
    ("ley_19300", "cl.norma.ley_19300", re.compile(
        r"Ley\s*(?:N[°º.]?\s*)?19\.?300|LBGMA|"
        r"Ley (?:sobre )?Bases Generales del Medio Ambiente", re.IGNORECASE)),
    ("ley_20417_losma", "cl.norma.ley_20417", re.compile(
        r"LOSMA|Ley Org[áa]nica de la Superintendencia(?: del Medio Ambiente)?",
        re.IGNORECASE)),
    ("ley_20600", "cl.norma.ley_20600", re.compile(
        r"Ley\s*(?:N[°º.]?\s*)?20\.?600", re.IGNORECASE)),
    ("ds_40_2012", "cl.norma.ds_40_2012", re.compile(
        r"(?:D\.?\s?S\.?|Decreto Supremo)\s*(?:N[°º.]?\s*)?40(?:\s*/\s*2012|,?\s*de\s*2012)?|"
        r"RSEIA|Reglamento del (?:SEIA|Sistema de Evaluaci[óo]n de Impacto Ambiental)",
        re.IGNORECASE)),
    ("ley_20417_ambiguo", None, re.compile(
        r"Ley\s*(?:N[°º.]?\s*)?20\.?417", re.IGNORECASE)),
]
RX_DE_BODY = re.compile(r"(?:de la|del|de)\s+", re.IGNORECASE)

_ORDINALES = {"primero": 1, "segundo": 2, "tercero": 3, "cuarto": 4,
              "quinto": 5, "sexto": 6}
_SUF = {"bis": "bis", "ter": "ter", "quáter": "qua", "quater": "qua"}

RX_RES = re.compile(
    r"\b(?:Resoluci[óo]n|Res\.)\s+(?:Exenta\s+|Ex\.\s*)?(?:N[°º.]?\s*)?"
    r"(\d{1,5})(?:\s*/\s*(\d{4})|,?\s+de\s+(?:fecha\s+)?"
    r"(?:\d{1,2}\s+de\s+\w+\s+(?:de|del)\s+)?(\d{4}))?", re.IGNORECASE)
RX_RCA = re.compile(r"\bRCA\s*(?:N[°º.]?\s*)?(\d{1,6})(?:\s*/\s*(\d{4}))?",
                    re.IGNORECASE)
ORGANISMOS = [
    ("SMA", re.compile(r"SMA|Superintendencia del Medio Ambiente", re.IGNORECASE)),
    ("SEA", re.compile(r"SEA|Servicio de Evaluaci[óo]n Ambiental|Director Ejecutivo",
                       re.IGNORECASE)),
    ("COEVA", re.compile(r"Comisi[óo]n de Evaluaci[óo]n|COEVA", re.IGNORECASE)),
    ("Comité de Ministros", re.compile(r"Comit[ée] de Ministros", re.IGNORECASE)),
    ("DGA", re.compile(r"\bDGA\b")),
    ("CONAF", re.compile(r"\bCONAF\b")),
    ("SEREMI", re.compile(r"\bSeremi", re.IGNORECASE)),
]
RX_REVISA_VERBO = re.compile(r"\b(reclam\w*|impugn\w*|recurr\w*)\b", re.IGNORECASE)
RX_REVISA_CONTRA = re.compile(r"\b(en contra de|contra)\b", re.IGNORECASE)
RX_APLICA = re.compile(
    r"\b(aplic\w*|fund[aó]\w*|conforme a|en virtud de|de acuerdo (?:con|a)|"
    r"infracci[óo]n\w*|sancion\w*|formul\w* cargos?)\b", re.IGNORECASE)
RX_SPLIT_SENT = re.compile(r"[.;]\s+(?=[A-ZÁÉÍÓÚÑ])")

_MODALIDADES = [
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


def _inciso_num(uid: str) -> int:
    """Número de inciso desde `...:inc:N` tolerando sufijo hash `:inc:N:hash`."""
    m = re.search(r":inc:(\d+)", uid)
    return int(m.group(1)) if m else 0


def modalidad(texto: str) -> tuple[str, str | None]:
    lower = texto.lower()
    for rid, mod, rx in _MODALIDADES:
        if rx.search(lower):
            return mod, rid
    return "otra", None


def unidades_de(texto: str) -> list[str]:
    """Líneas no vacías, como en el corpus."""
    return [m.group().strip() for m in re.finditer(r"[^\n]*\S[^\n]*", texto)]


def organismo_en(ventana: str) -> str | None:
    for org, rx in ORGANISMOS:
        if rx.search(ventana):
            return org
    return None


def rotulo_sentencia(sid: str) -> str:
    """Etiqueta humana desde el id (sin texto del fallo)."""
    partes = sid.split(".")[-1].split("_")
    sig = partes[0].lower()
    tri = {"sta": "STA", "cs": "CS"}.get(sig)
    if tri is None:
        m = re.match(r"(\d)ta", sig)
        tri = f"{m.group(1)}TA" if m else sig.upper()
    rol = next((p.upper().replace("R-", "R-") for p in partes
                if re.match(r"(s\dta_)?r-\d", p, re.IGNORECASE)), "")
    if not rol:
        for i, p in enumerate(partes):
            if p == "r" and i + 2 < len(partes):
                rol = f"R-{partes[i+1]}-{partes[i+2]}"
                break
    resto = [p for p in partes if p not in (sig,)
             and not re.match(r"(s\dta_)?r-\d+", p, re.IGNORECASE)
             and p != "r" and not p.isdigit() and p != "sentencia"
             and not re.match(r"^\d{4}$", p)]
    nombre = " ".join(resto[:2]).title() if resto else ""
    return f"{tri} {rol}".strip() + (f" · {nombre}" if nombre else "")


def construir(db_path: Path = DB, salida: Path = SALIDA,
              aprobacion: Path = APROBACION) -> dict:
    ap = json.loads(aprobacion.read_text(encoding="utf-8"))
    sha = hashlib.sha256(db_path.read_bytes()).hexdigest()
    if sha != ap.get("sha256"):
        raise SystemExit(
            f"SHA256 de la base no coincide con la aprobación "
            f"({sha[:16]}… != {str(ap.get('sha256'))[:16]}…); no se construye.")
    t0 = time.time()
    con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    nodos_db = {r[0]: (r[1], r[2] or "")
                for r in con.execute("SELECT id, type, title FROM nodes")}
    docs = {r[0]: r[1] for r in con.execute(
        "SELECT doc_id, canonical_text FROM documents")}
    aristas_db = [r for r in con.execute(
        "SELECT type, from_id, to_id, meta_json FROM edges")]
    considerandos = [r for r in con.execute(
        "SELECT considering_id, document_id, ordinal, char_start, char_end "
        "FROM considering_units")]
    resolutivos = [r for r in con.execute(
        "SELECT resolutive_id, document_id, ordinal, char_start, char_end "
        "FROM resolutive_units")]
    con.close()

    c = Counter()
    nodos: list[dict] = []
    aristas: list[dict] = []
    textos: dict[str, dict] = {}   # id → {texto, ...} para /grafo/unidad local
    evidencias: dict[str, dict] = {}  # "src|dst" → {snippet, ...}

    def ev(doc: str, start: int, end: int, regla: str,
           snippet_src: str = "") -> dict:
        texto = docs.get(doc, "")
        start, end = max(0, start), min(len(texto), max(start, end))
        clave = None
        return {"doc": doc, "char_start": start, "char_end": end,
                "regla": regla}

    def link(src: str, dst: str, tipo: str, estado: str,
             evid: dict | None = None, regla: str = "",
             doc_texto: str = "") -> None:
        l = {"source": src, "target": dst, "tipo": tipo, "estado": estado}
        if evid:
            l["evidencia"] = evid
            clave = f"{src}|{dst}|{tipo}"
            if clave not in evidencias and doc_texto:
                evidencias[clave] = {
                    "regla": evid["regla"], "estado": estado,
                    "nivel": evid.get("nivel"),
                    "char_start": evid["char_start"],
                    "char_end": evid["char_end"],
                    "snippet": doc_texto[evid["char_start"]:evid["char_end"]],
                }
            elif clave in evidencias:
                evidencias[clave]["n_evidencias"] = (
                    evidencias[clave].get("n_evidencias", 1) + 1)
        aristas.append(l)
        c[f"link_{tipo}"] += 1
        if regla:
            c[f"regla_{regla}"] += 1

    # --- Instrumentos y unidades normativas ---------------------------------
    instrumentos = [i for i, (t, _) in nodos_db.items() if t == "Instrumento"]
    arts: dict[str, dict] = {}
    incisos_por_art: dict[str, list[str]] = defaultdict(list)
    for nid in instrumentos:
        titulo = nodos_db[nid][1] or nid
        nodos.append({"id": nid, "tipo": "instrumento", "label": titulo,
                      "n_articulos": 0})
        c["nodo_instrumento"] += 1
    for nid, (t, _) in nodos_db.items():
        if t != "UnidadNormativa":
            continue
        if ":inc:" in nid:
            incisos_por_art[nid.split(":inc:", 1)[0]].append(nid)
        else:
            arts[nid] = nodos_db[nid]
    for nid in arts:
        m = re.match(r"(.+):art:(\d+)([a-z]*)$", nid)
        inst = m.group(1) if m else nid.split(":")[0]
        rot = arts[nid][1] or (f"art. {int(m.group(2))}" if m else nid)
        nodos.append({"id": nid, "tipo": "articulo", "label": rot,
                      "instrumento": inst, "n_unidades": 0})
        c["nodo_articulo"] += 1
    contiene = {(f, t) for ty, f, t, _ in aristas_db
                if ty in ("INSTRUMENT_CONTAINS_UNIT", "UNIT_CONTAINS_UNIT")}
    for f, t in sorted(contiene):
        aristas.append({"source": f, "target": t, "tipo": "contiene",
                        "estado": "verificada_estructura"})
        c["link_contiene"] += 1
    # Unidad normativa: el inciso, o el artículo sin incisos como unidad única
    for nid in arts:
        texto = docs.get(nid) or ""
        hijos = sorted(incisos_por_art.get(nid, []),
                       key=_inciso_num)
        for orden, uid in enumerate(hijos, 1):
            ut = docs.get(uid) or ""
            mod, regla = modalidad(ut)
            nodos.append({
                "id": uid, "tipo": "unidad", "clase": "normativa",
                "label": f"{arts[nid][1] or nid}, inciso {orden}",
                "etiqueta": f"inciso {orden}", "orden": orden,
                "articulo": nid, "modalidad": mod,
                "modalidad_estado": "candidata", "modalidad_regla": regla,
            })
            if ut:
                textos[uid] = {"texto": ut}
            c[f"modalidad_{mod}"] += 1
            c["nodo_unidad_normativa"] += 1
        if not hijos:
            mod, regla = modalidad(texto)
            uid = f"{nid}#u01"
            nodos.append({
                "id": uid, "tipo": "unidad", "clase": "normativa",
                "label": f"{arts[nid][1] or nid}, inciso 1",
                "etiqueta": "inciso 1", "orden": 1,
                "articulo": nid, "modalidad": mod,
                "modalidad_estado": "candidata", "modalidad_regla": regla,
            })
            aristas.append({"source": nid, "target": uid,
                            "tipo": "contiene",
                            "estado": "verificada_estructura"})
            c["link_contiene"] += 1
            if texto:
                textos[uid] = {"texto": texto}
            c[f"modalidad_{mod}"] += 1
            c["nodo_unidad_normativa"] += 1
    # n_unidades de cada artículo
    n_uni = Counter(l["target"] for l in aristas
                    if l["tipo"] == "contiene"
                    and any(n["id"] == l["target"] and n["tipo"] == "unidad"
                            for n in nodos))
    hijos_cont = Counter(t.split(":inc:", 1)[0] if ":inc:" in t else t
                         for _, t in ((l["source"], l["target"])
                                      for l in aristas
                                      if l["tipo"] == "contiene"))
    for n in nodos:
        if n["tipo"] == "articulo":
            propios = len(incisos_por_art.get(n["id"], [])) or 1
            n["n_unidades"] = propios
    for n in nodos:
        if n["tipo"] == "instrumento":
            n["n_articulos"] = sum(
                1 for l in aristas
                if l["tipo"] == "contiene" and l["source"] == n["id"])
    nodo_ids = {n["id"] for n in nodos}

    def articulo_id(inst: str, num: int, suf: str) -> str:
        return f"{inst}:art:{num:04d}{_SUF.get(suf.lower(), '')}"

    # --- Sentencias y unidades judiciales ------------------------------------
    unidades_jud: list[dict] = []  # {id, doc, ordinal, cs, ce, texto}
    for sid in sorted(i for i, (t, _) in nodos_db.items() if t == "Sentencia"):
        rot = rotulo_sentencia(sid)
        nodos.append({"id": sid, "tipo": "sentencia", "label": rot})
        c["nodo_sentencia"] += 1
    for cid, doc, ordinal, cs, ce in considerandos:
        uid = f"{doc}#cons{ordinal:02d}"
        unidades_jud.append({"id": uid, "doc": doc, "ordinal": ordinal,
                             "cs": cs or 0, "ce": ce or 0,
                             "etiqueta": f"considerando {ordinal}"})
    for rid, doc, ordinal, cs, ce in resolutivos:
        uid = f"{doc}#reso{ordinal:02d}"
        unidades_jud.append({"id": uid, "doc": doc, "ordinal": ordinal,
                             "cs": cs or 0, "ce": ce or 0,
                             "etiqueta": f"resolutivo {ordinal}"})
    for u in unidades_jud:
        texto = docs.get(u["doc"], "")[u["cs"]:u["ce"]]
        nodos.append({"id": u["id"], "tipo": "unidad", "clase": "judicial",
                      "label": u["etiqueta"], "etiqueta": u["etiqueta"],
                      "orden": u["ordinal"], "articulo": u["doc"]})
        aristas.append({"source": u["doc"], "target": u["id"],
                        "tipo": "contiene",
                        "estado": "verificada_estructura"})
        textos[u["id"]] = {"texto": texto}
        c["link_contiene"] += 1
        c["nodo_unidad_judicial"] += 1

    # --- R-CITA-ART -----------------------------------------------------------
    por_unidad = defaultdict(list)  # uid -> [(target, evid, nivel)]
    for u in unidades_jud:
        doc_txt = docs.get(u["doc"], "")
        frag = doc_txt[u["cs"]:u["ce"]]
        for m in RX_CITA.finditer(frag):
            lista = m.group(1)
            items = list(RX_NUM_ITEM.finditer(lista))
            if not items:
                continue
            fin_num = items[-1].end()
            ventana = m.end()
            fin_ventana = min(len(frag), ventana + 140)
            cuerpo_txt = frag[ventana:fin_ventana]
            cruce = RX_SENTENCIA_FIN.search(cuerpo_txt)
            if cruce:
                cuerpo_txt = cuerpo_txt[:cruce.start()]
            mbody = RX_DE_BODY.search(cuerpo_txt)
            inst = None
            ambiguo = False
            if mbody:
                resto = cuerpo_txt[mbody.end():]
                for _, destino, rx in CUERPOS:
                    mb = rx.match(resto)
                    if mb:
                        inst = destino
                        fin_cuerpo = ventana + mbody.end() + mb.end()
                        ambiguo = destino is None
                        break
            else:
                c["sin_cuerpo"] += 1
                continue
            if ambiguo:
                c["ambiguos_20417"] += 1
                continue
            if inst is None:
                c["sin_cuerpo"] += 1
                continue
            for it in items:
                num = int(it.group(1))
                suf = (it.group(2) or "").lower()
                inc_tok = (it.group(3) or "").lower()
                aid = articulo_id(inst, num, suf)
                target = None
                nivel = None
                if aid in nodo_ids:
                    target = aid
                    if inc_tok:
                        hijos = sorted(incisos_por_art.get(aid, []),
                                       key=_inciso_num)
                        k = None
                        if inc_tok == "final":
                            k = len(hijos) if hijos else None
                        elif inc_tok.isdigit():
                            k = int(inc_tok)
                        else:
                            k = _ORDINALES.get(inc_tok)
                        if k and 1 <= k <= len(hijos):
                            target = hijos[k - 1]
                elif inst in nodo_ids:
                    target, nivel = inst, "ley"
                if target is None:
                    continue
                e = {"doc": u["doc"],
                     "char_start": u["cs"] + m.start(),
                     "char_end": u["cs"] + fin_cuerpo,
                     "regla": "R-CITA-ART"}
                if nivel:
                    e["nivel"] = nivel
                por_unidad[u["id"]].append((target, e))
    cita_de: dict[str, set] = defaultdict(set)
    for uid, refs in por_unidad.items():
        doc_txt = docs.get(next(u["doc"] for u in unidades_jud
                                if u["id"] == uid), "")
        vistos = set()
        for target, e in refs:
            if target in vistos:
                continue
            vistos.add(target)
            cita_de[uid].add(target)
            link(uid, target, "cita", "candidata", e,
                 regla="R-CITA-ART", doc_texto=doc_txt)

    # --- R-CITA-LEY (aristas DOC_CITES_UNIT de la base) -----------------------
    for ty, f, t, meta in aristas_db:
        if ty != "DOC_CITES_UNIT":
            continue
        meta_d = json.loads(meta or "{}")
        s, e = meta_d.get("j2_start_offset"), meta_d.get("j2_end_offset")
        if s is None or e is None:
            continue
        dueno = next((u for u in unidades_jud
                      if u["doc"] == f and u["cs"] <= s < u["ce"]), None)
        if dueno is None:
            c["fuera_de_unidad"] += 1
            continue
        inst = t
        if any(tg.startswith(inst + ":") or tg == inst
               for tg in cita_de.get(dueno["id"], ())):
            c["cita_ley_dedupe"] += 1
            continue
        evid = {"doc": f, "char_start": s, "char_end": e,
                "regla": "R-CITA-LEY", "nivel": "ley"}
        link(dueno["id"], inst, "cita", "candidata", evid,
             regla="R-CITA-LEY", doc_texto=docs.get(f, ""))

    # --- R-RES ----------------------------------------------------------------
    resoluciones: dict[str, dict] = {}
    menciones = []  # (res_id, uid, m_start, m_end, doc)
    res_pos: dict[str, list] = {}  # uid -> [(rid, s, e)] para R-APLICA
    for u in unidades_jud:
        doc_txt = docs.get(u["doc"], "")
        frag = doc_txt[u["cs"]:u["ce"]]
        for m in RX_RES.finditer(frag):
            num = int(m.group(1))
            anio = m.group(2) or m.group(3)
            if not anio:
                c["sin_anio"] += 1
                continue
            ventana_org = frag[m.end():m.end() + 160]
            org = organismo_en(ventana_org)
            if org:
                rid = f"res:{org}:{num}/{anio}"
                rot = f"Res. N° {num}/{anio} · {org}"
            else:
                rid = f"res:?:{num}/{anio}@{u['doc']}"
                rot = f"Res. N° {num}/{anio}"
            if rid not in resoluciones:
                resoluciones[rid] = {"id": rid, "tipo": "resolucion",
                                     "label": rot,
                                     "organismo": org, "numero": num,
                                     "anio": int(anio), "menciones": 0,
                                     "rca": False}
            resoluciones[rid]["menciones"] += 1
            resoluciones[rid]["organismo"] = (resoluciones[rid]["organismo"]
                                              or org)
            prev = frag[max(0, m.start() - 220):m.start()]
            mv = RX_REVISA_VERBO.search(prev)
            tipo_l = ("revisa" if mv and RX_REVISA_CONTRA.search(prev[mv.end():])
                      else "menciona")
            menciones.append((rid, u["id"], u["cs"] + m.start(),
                              u["cs"] + m.end(), u["doc"], tipo_l))
            res_pos.setdefault(u["id"], []).append(
                (rid, u["cs"] + m.start(), u["cs"] + m.end()))
        for m in RX_RCA.finditer(frag):
            num = int(m.group(1))
            anio = m.group(2)
            if not anio:
                c["sin_anio"] += 1
                continue
            ventana_org = frag[m.end():m.end() + 160]
            org = organismo_en(ventana_org)
            rid = f"rca:{num}/{anio}" if org or True else None
            rot = f"RCA {num}/{anio}"
            if rid not in resoluciones:
                resoluciones[rid] = {"id": rid, "tipo": "resolucion",
                                     "label": rot,
                                     "organismo": org or "SEA",
                                     "numero": num, "anio": int(anio),
                                     "menciones": 0, "rca": True}
            resoluciones[rid]["menciones"] += 1
            menciones.append((rid, u["id"], u["cs"] + m.start(),
                              u["cs"] + m.end(), u["doc"], "menciona"))
            res_pos.setdefault(u["id"], []).append(
                (rid, u["cs"] + m.start(), u["cs"] + m.end()))
    vistos_res = set()
    for rid, uid, s, e, doc, tipo_l in menciones:
        if (rid, uid, tipo_l) in vistos_res:
            resoluciones[rid]["menciones"] -= 0
            continue
        vistos_res.add((rid, uid, tipo_l))
        evid = {"doc": doc, "char_start": s, "char_end": e,
                "regla": "R-RES-REV" if tipo_l == "revisa" else "R-RES-MEN"}
        link(uid, rid, tipo_l, "candidata", evid,
             regla="R-RES-REV" if tipo_l == "revisa" else "R-RES-MEN",
             doc_texto=docs.get(doc, ""))
    for r in resoluciones.values():
        nodos.append(r)
        c["nodo_resolucion"] += 1
        textos[r["id"]] = {"sin_texto": True}

    # --- R-APLICA --------------------------------------------------------------
    res_por_uid = defaultdict(set)
    for rid, uid, s, e, doc, _ in menciones:
        res_por_uid[uid].add(rid)
    aplica_vistos = set()
    for u in unidades_jud:
        doc_txt = docs.get(u["doc"], "")
        frag = doc_txt[u["cs"]:u["ce"]]
        pos = 0
        for sent in RX_SPLIT_SENT.split(frag):
            base = u["cs"] + pos
            pos += len(sent) + 2
            if not RX_APLICA.search(sent):
                continue
            limite = base + len(sent) + 2
            for rid, rs, re_ in res_pos.get(u["id"], ()):
                if not (base <= rs < limite):
                    continue  # la mención debe estar en la MISMA oración
                for target, e0 in por_unidad.get(u["id"], ()):
                    e_start, e_end = e0["char_start"], e0["char_end"]
                    if not (base <= e_start < limite):
                        continue
                    if (rid, target) in aplica_vistos:
                        continue
                    aplica_vistos.add((rid, target))
                    evid = {"doc": u["doc"], "char_start": e_start,
                            "char_end": e_end, "regla": "R-APLICA"}
                    link(rid, target, "aplica", "candidata", evid,
                         regla="R-APLICA", doc_texto=doc_txt)

    nodos.sort(key=lambda n: n["id"])
    red = {"fuente": "ambiental", "local_only": True,
           "nodes": nodos, "links": aristas,
           "conteos": {"nodes": len(nodos), "links": len(aristas)},
           "truncado": False}
    salida.mkdir(parents=True, exist_ok=True)
    os.chmod(salida, 0o700)
    (salida / "red.json").write_text(
        json.dumps(red, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8")
    os.chmod(salida / "red.json", 0o600)
    (salida / "unidades.json").write_text(
        json.dumps({"textos": textos, "evidencias": evidencias},
                   ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8")
    os.chmod(salida / "unidades.json", 0o600)
    construccion = {
        "sha256_fuente": sha,
        "reglas": ["R-CITA-ART", "R-CITA-LEY", "R-RES-REV", "R-RES-MEN",
                   "R-APLICA"] + [r[0] for r in _MODALIDADES],
        "conteos": dict(sorted(c.items())),
        "nodos_por_tipo": dict(Counter(n["tipo"] for n in nodos)),
        "construido": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "segundos": round(time.time() - t0, 2),
    }
    (salida / "construccion.json").write_text(
        json.dumps(construccion, ensure_ascii=False, indent=2),
        encoding="utf-8")
    os.chmod(salida / "construccion.json", 0o600)
    return construccion


if __name__ == "__main__":
    info = construir()
    print(json.dumps(info, ensure_ascii=False, indent=2))
