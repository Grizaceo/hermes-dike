#!/usr/bin/env python3
"""Panel Diké — driver JSON del motor para la pestaña web y la página Desktop.

Corre en el subproceso del motor que lanza ``dashboard/plugin_api.py`` (vía
``__init__._panel_json`` → ``aislamiento.ejecutar``): con el ``_entorno`` del
adaptador (HOME, LEXO_CONFIG, DIKE_USER y DIKE_USERS_ROOT redirigidos al
plugin-data, y PYTHONPATH apuntando a ``motor/`` más los paquetes del
anfitrión), y dentro de bubblewrap cuando el equipo lo permite — sin red y
con solo las rutas que el op necesita. El motor vendorizado queda intacto:
este archivo es código del plugin, no del motor.

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
    python scripts/panel.py grafo buscar        # consulta por STDIN: {"q": str, "limite": int}

Casos NIF y el grafo personal viven en ``DIKE_USERS_ROOT/<DIKE_USER>/`` — el
plugin-data del perfil, FUERA de la generación sellada del corpus: escribir
ahí no toca la integridad que ``constancia`` verifica en cada llamada. El
corpus sellado solo se lee (``grafo corpus*``, ``grafo buscar``), nunca se
escribe. La consulta de ``grafo buscar`` llega por la entrada estándar como
JSON para que no aparezca en la lista de procesos (``ps``): no se escribe a
disco ni se registra en ninguna parte.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import sys
import unicodedata
from pathlib import Path

_MOTOR = Path(__file__).resolve().parent.parent / "motor"
if str(_MOTOR) not in sys.path:
    sys.path.insert(0, str(_MOTOR))

# scripts/ también entra al path: `canal_arbol` vive junto a este archivo y
# debe importarse igual cuando panel.py corre como script o como módulo.
_PANEL_DIR = Path(__file__).resolve().parent
if str(_PANEL_DIR) not in sys.path:
    sys.path.insert(0, str(_PANEL_DIR))

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


# Corpus ya cargado, por conjunto de carpetas. Solo lo llena ``precalentar``
# (el servidor del motor, antes de bifurcar un hijo por pedido); en un proceso
# de un solo uso queda vacío y cada op carga el corpus como siempre.
_CALIENTE: dict = {}


def _resolver(dirs=None):
    """(resolver, buscador BM25) del corpus instalado, o de ``dirs`` en tests."""
    from lexo_cli.starter.resolver import StarterCorpusResolver
    from lexo_cli.starter.retrieval import StarterCorpusRetriever
    clave = tuple(str(d) for d in (_corpus_dirs() if dirs is None else dirs))
    if clave not in _CALIENTE:
        resolver = StarterCorpusResolver([Path(d) for d in clave])
        return resolver, StarterCorpusRetriever(resolver)
    return _CALIENTE[clave]


def precalentar() -> None:
    """Carga el corpus y su índice de búsqueda una vez, para los hijos del servidor."""
    clave = tuple(str(d) for d in _corpus_dirs())
    if clave and clave not in _CALIENTE:
        resolver, buscador = _resolver()
        buscador.search("ley", limit=1)  # construye o carga el índice BM25
        _CALIENTE[clave] = (resolver, buscador)


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
# Resolución de ids de nodo: forma compacta a:CODE:EID / n:CODE (archivo
# directo) y @id largo heredado (glob + comparación) como respaldo.
# ---------------------------------------------------------------------------

def _candidatos_articulo(current: Path, aid: str):
    """Archivos candidatos del artículo `aid` (1 en forma compacta)."""
    if aid.startswith("a:") and aid.count(":") >= 2:
        code, eid = aid.split(":", 2)[1:]
        p = current / "articulos" / f"articulo_{code}_{eid}.json"
        if p.is_file():
            return [p]
        return []
    eid = aid.rsplit("/", 1)[-1]
    if not re.fullmatch(r"[\w.-]+", eid):
        return []
    return sorted((current / "articulos").glob(f"articulo_*_{eid}.json"))


def _es_articulo(data: dict, aid: str) -> bool:
    """¿Este JSON es el artículo pedido? Forma compacta o @id."""
    if aid.startswith("a:"):
        code = data.get("leychileCode") or (data.get("norma") or {}).get("leychileCode")
        eid = data.get("eId")
        if code is not None and eid is not None:
            return aid == f"a:{code}:{eid}"
        return True  # ruta directa por nombre de archivo
    return str(data.get("@id") or "") == aid


def _candidatos_norma(current: Path, nid: str):
    if nid.startswith("n:"):
        p = current / "normas" / f"norma_{nid[2:]}.json"
        return [p] if p.is_file() else []
    return sorted((current / "normas").glob("norma_*.json"))


# ---------------------------------------------------------------------------
# Búsqueda por contenido: BM25 determinista sobre el corpus sellado
# ---------------------------------------------------------------------------

_ROTULO_BUSQUEDA = "Resultado de búsqueda: es una pista, no una fuente verificada"


def _familias_texto(texto: str) -> set:
    """Familias morfológicas de los términos de un texto (como el retriever)."""
    from lexo_cli.starter.morfologia import familia
    from lexo_cli.starter.retrieval import terminos
    return {familia(t) for t in terminos(texto)}


def _terminos_presentes(consulta_terminos: list, familias: set) -> list:
    """Términos de la consulta con al menos un término de su familia en el texto.

    La comparación es por ``familia()`` — la misma que usa el retriever para
    acreditar variantes («resolución» calza con «resolutoria»). Se devuelve el
    término tal como lo escribió quien consulta, sin duplicados y en orden.
    """
    from lexo_cli.starter.morfologia import familia
    vistos: set = set()
    out: list = []
    for t in consulta_terminos:
        if t in vistos:
            continue
        vistos.add(t)
        if familia(t) in familias:
            out.append(t)
    return out


# ---------------------------------------------------------------------------
# Cita canónica de un resultado de búsqueda («Llevar al escrito», Fase 3)
# ---------------------------------------------------------------------------

# Cuerpo → nombre en prosa que `norm_reference` reconoce y resuelve al mismo
# alias. Una forma por tipo de norma; la verificación de ida y vuelta contra
# `resolve_norm_reference` es la que decide si la cita sirve.
_CUERPOS_CITA = {
    "cc": "Código Civil",
    "cpc": "Código de Procedimiento Civil",
    "ct": "Código del Trabajo",
    "ccom": "Código de Comercio",
    "ctrib": "Código Tributario",
    "cp": "Código Penal",
    "cpp": "Código Procesal Penal",
    "cot": "Código Orgánico de Tribunales",
    "cpr": "Constitución Política",
    "dfl_1122": "Código de Aguas",
}

# Sufijos de artículo que la gramática del verificador admite (los ordinales
# latinos del corpus). Una letra suelta tras el sufijo individualiza el
# artículo («152 quáter G»); sin sufijo no hay forma válida.
_SUFIJOS_ARTICULO = {
    "bis", "ter", "quater", "quinquies", "sexies", "septies", "octies",
    "nonies",
}

# Artículos nombrados con palabra (ninguno en el pack actual, pero la forma
# existe en la gramática).
_ORDINALES_CITA = {
    "primero", "segundo", "tercero", "cuarto", "quinto", "sexto", "septimo",
    "séptimo", "octavo", "noveno", "decimo", "décimo", "undecimo",
    "undécimo", "duodecimo", "duodécimo", "final",
}

_GID_RUNTIME_CITA = re.compile(r"cl\.norma\.([a-z0-9_-]+):art:(.+)\Z")
_PARTE_ARTICULO = re.compile(
    r"(\d+)(?:_([a-záéíóúñ]+))?(?:_([a-zñ]))?\Z")
_PARTE_TRANSITORIO = re.compile(r"t_(\d+)\Z")
_ALIAS_NUMERADO = re.compile(r"(ley|decreto|dfl|dl)_(\d+)\Z")
_NOMBRES_ALIAS = {
    "ley": "Ley", "decreto": "Decreto", "dfl": "DFL", "dl": "DL",
}


def _cuerpo_de_cita(alias: str) -> str | None:
    """Nombre del cuerpo en prosa que el verificador resuelve al alias."""
    if alias in _CUERPOS_CITA:
        return _CUERPOS_CITA[alias]
    m = _ALIAS_NUMERADO.fullmatch(alias)
    if m:
        tipo, digitos = m.groups()
        numero = (digitos[:-3] + "." + digitos[-3:]
                  if len(digitos) > 3 else digitos)
        return f"{_NOMBRES_ALIAS[tipo]} {numero}"
    return None


def _preposicion_cuerpo(alias: str) -> str:
    """«de la» ante femenino (ley, constitución); «del» en el resto."""
    if alias.startswith("ley_") or alias == "cpr":
        return "de la"
    return "del"


def _cita_de(gid: str, resolver=None):
    """Texto de cita canónico para un gid, o ``(None, motivo)``.

    Genera la forma «artículo N [sufijo [letra]] [transitorio] del/de la
    <cuerpo>» que la gramática del verificador reconoce y comprueba —cuando
    hay ``resolver``— que `resolve_norm_reference` la resuelve AL MISMO gid.
    Solo así la cita puede entrar al escrito: nunca nace verificada, la
    revisa el motor como cualquier otra. ``resolver=None`` devuelve la forma
    sin comprobarla (solo para inspección; `buscar` siempre pasa resolver).
    """
    from lexo_cli.starter.norm_reference import resolve_norm_reference

    par = _GID_RUNTIME_CITA.fullmatch(gid or "")
    if not par:
        return None, "gid sin forma runtime reconocible"
    alias, parte = par.groups()
    cuerpo = _cuerpo_de_cita(alias)
    if cuerpo is None:
        return None, "cuerpo sin forma de cita canónica"

    transitorio = _PARTE_TRANSITORIO.fullmatch(parte)
    if transitorio:
        cita = (f"artículo transitorio {int(transitorio.group(1))} "
                f"{_preposicion_cuerpo(alias)} {cuerpo}")
    else:
        m = _PARTE_ARTICULO.fullmatch(parte)
        if not m:
            if parte in _ORDINALES_CITA:
                cita = (f"artículo {parte} "
                        f"{_preposicion_cuerpo(alias)} {cuerpo}")
            else:
                return None, "forma de artículo no reconocida"
        else:
            numero, sufijo, letra = m.groups()
            if sufijo and len(sufijo) == 1 and not letra:
                # «0006_a»: letra suelta sin bis/ter — la gramática la
                # descartaría y resolvería el numeral base (artículo DISTINTO).
                return None, ("artículo letrado sin sufijo: la gramática del "
                              "verificador lo confundiría con el numeral base")
            if sufijo and sufijo not in _SUFIJOS_ARTICULO:
                return None, f"sufijo de artículo «{sufijo}» no reconocido"
            articulo = str(int(numero))
            if sufijo:
                articulo += f" {sufijo}"
                if letra:
                    articulo += f" {letra}"
            cita = (f"artículo {articulo} "
                    f"{_preposicion_cuerpo(alias)} {cuerpo}")

    if resolver is None:
        return cita, None
    try:
        res = resolve_norm_reference(cita, resolver)
    except Exception:
        res = None
    if res is not None and res.status == "RESOLVED" and res.gid == gid:
        return cita, None
    return None, f"«{cita}» no resolvió a este artículo"


def _explicar_arbol(consulta: str, retriever,
                    resultados: list, arbol_dir=None) -> dict:
    """Clasifica la consulta con el árbol de materias (canal_arbol).

    Explica, no reordena: el bloque ``arbol`` y las ``materias`` de cada
    resultado son metadatos de auditoría; ``resultados`` conserva el orden
    y los puntajes del BM25. Si el árbol no carga —falta el JSON, es
    inválido o el lexicón está vacío— la búsqueda sigue igual y se informa
    ``disponible: false`` con el motivo. Nunca lanza.

    ``arbol_dir`` (tests) apunta a un directorio con
    ``arbol_derecho_anclas.json`` y ``arbol_lexicon.json``; por defecto se
    usan los empaquetados en ``data/arbol/``.
    """
    try:
        import canal_arbol
    except Exception as e:
        return {"disponible": False,
                "motivo": f"canal_arbol no importable: {type(e).__name__}: {e}"[:200]}
    try:
        if arbol_dir is None:
            canal = canal_arbol.CanalArbol(retriever)
        else:
            d = Path(arbol_dir)
            canal = canal_arbol.CanalArbol(
                retriever,
                arbol_path=d / "arbol_derecho_anclas.json",
                lexicon_path=d / "arbol_lexicon.json")
    except Exception as e:
        return {"disponible": False,
                "motivo": f"{type(e).__name__}: {e}"[:200]}
    if canal.arbol is None:
        return {"disponible": False,
                "motivo": f"árbol no encontrado ({canal.arbol_path.name})"}
    if not canal.lexicon:
        return {"disponible": False,
                "motivo": "lexicón de materias ausente o vacío"}
    try:
        clasificacion = canal.clasificar(consulta, top=3)
    except Exception as e:
        return {"disponible": False,
                "motivo": f"clasificación falló: {type(e).__name__}: {e}"[:200]}

    clasif: list[dict] = []
    for c in clasificacion:
        clasif.append({
            "nodo": c["nodo"],
            "nombre": c["nombre"],
            "rama": c["rama"],
            "score": c["score"],
            "terminos": c["terminos"],
            "cobertura": c["cobertura"],
            "n_anclas": c["n_anclas"],
            "codigos": canal.territorio(c["nodo"])["codigos"],
        })
    ratio = None
    if len(clasif) >= 2 and clasif[1]["score"]:
        ratio = round(clasif[0]["score"] / clasif[1]["score"], 3)
    clara = ratio is not None and ratio >= 1.6

    anclas_por_nodo = {
        nid: set(gids) for nid, gids in canal.nodo_anclas.items()}
    for r in resultados:
        materias = []
        for c in clasif:
            nid = c["nodo"]
            if r["gid"] in anclas_por_nodo.get(nid, ()):
                relacion = "ancla"
            elif (canal_arbol.codigo_umj(r["gid"])
                    in canal.nodo_codigos.get(nid, set())):
                relacion = "territorio"
            else:
                continue
            materias.append({
                "nodo": nid,
                "nombre": c["nombre"],
                "relacion": relacion,
            })
        r["materias"] = materias

    return {
        "disponible": True,
        "nodos": len(canal.nodos),
        "anclas": sum(len(g) for g in canal.nodo_anclas.values()),
        "clasificacion": clasif,
        "ratio": ratio,
        "umbral": 1.6,
        "clara": clara,
        "nota": "Clasificación léxica por árbol de materias: explica, no reordena",
    }


def buscar(consulta: str, limite: int = 20, corpus_dirs=None,
            arbol_dir=None) -> dict:
    """Busca artículos del corpus sellado por contenido (BM25, sin modelo).

    Cada acierto del retriever se traduce al nodo ``a:CODE:EID`` que ``grafo
    red`` emite para el mismo archivo; un acierto sin nodo mapeable se
    descarta y se cuenta en ``sin_nodo``. Los resultados son pistas de
    lectura, no citas verificadas: el rótulo lo dice y la interfaz lo repite.

    ``corpus_dirs`` permite apuntar a otro conjunto de ``*/current`` (tests);
    por defecto usa ``_corpus_dirs()``. La consulta se valida aquí también:
    este script es la última línea antes del motor.

    ``arbol_dir`` (tests) inyecta el árbol de materias; por defecto se usan
    los JSON empaquetados en ``data/arbol/``. El bloque ``arbol`` explica la
    clasificación por materia y cada resultado lleva ``materias``; nada de
    eso toca el orden ni los puntajes del BM25, y un árbol ausente o inválido
    nunca tumba la búsqueda.
    """
    from lexo_cli.starter.retrieval import terminos

    if not isinstance(consulta, str):
        raise ValueError("la consulta debe ser texto.")
    q = consulta.strip()
    if not q:
        raise ValueError("la consulta está vacía.")
    if len(q) > 300:
        raise ValueError("la consulta supera los 300 caracteres.")
    if any(unicodedata.category(c).startswith("C") for c in q):
        raise ValueError("la consulta tiene caracteres de control.")
    consulta_terminos = terminos(q)
    if not consulta_terminos:
        raise ValueError("la consulta no tiene términos buscables.")
    if isinstance(limite, bool) or limite is None:
        limite = 20
    else:
        try:
            limite = int(limite)
        except (TypeError, ValueError):
            limite = 20
    limite = max(1, min(50, limite))

    dirs = [Path(d) for d in (corpus_dirs if corpus_dirs is not None else _corpus_dirs())]
    resolver, retriever = _resolver(dirs)
    hits = retriever.search(q, limit=limite)

    resultados: list[dict] = []
    sin_nodo = 0
    pack = ""
    nombres_cortos: dict[str, str] = {}
    for hit in hits:
        ev = resolver._by_gid.get(hit.gid)
        if ev is None:
            sin_nodo += 1
            continue
        nodo_id = f"a:{ev.leychile_code}:{ev.eid}"
        instrumento = f"n:{ev.leychile_code}"
        # El nodo existe en `grafo red` si el archivo del artículo sigue ahí
        # y describe ese mismo artículo: es la misma evidencia que el resolver
        # verificó (hash de texto, completitud, ventana temporal).
        ruta = Path(ev.source_path)
        try:
            articulo = json.loads(ruta.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            sin_nodo += 1
            continue
        if not _es_articulo(articulo, nodo_id):
            sin_nodo += 1
            continue
        current = ruta.parent.parent
        if not pack:
            pack = current.parent.name
        code = ev.leychile_code
        if code not in nombres_cortos:
            corto = ""
            nf = current / "normas" / f"norma_{code}.json"
            norma = _read_json(nf) if nf.is_file() else None
            if norma is not None:
                corto = _nombre_corto(norma.get("eli") or {})
            nombres_cortos[code] = corto or code
        rotulo = str(articulo.get("label") or articulo.get("eId") or ruta.stem)
        texto = ev.text or ""
        familias_art = _familias_texto(texto)
        unidades = []
        snippet = ""
        for u in _unidades(texto):
            presentes = _terminos_presentes(
                consulta_terminos, _familias_texto(u["texto"]))
            if presentes:
                if not snippet:
                    snippet = u["texto"]
                unidades.append({
                    "id": f"{nodo_id}#u{u['orden']:02d}",
                    "etiqueta": u["etiqueta"],
                    "terminos": presentes,
                })
            if len(unidades) >= 5:
                break
        resultados.append({
            "gid": hit.gid,
            "nodo_id": nodo_id,
            "instrumento": instrumento,
            "label": f"{nombres_cortos[code]}, art. {rotulo}",
            "score": hit.score,
            "canal": hit.channel,
            "evidencia": hit.evidence,
            "snippet": (snippet or texto)[:400],
            "terminos": _terminos_presentes(consulta_terminos, familias_art),
            "unidades": unidades,
            "sha256": ev.text_sha256,
            "url": (ev.provenance or {}).get("wasDerivedFrom")
                   or ev.source_url or None,
            # Vigencia que el resolver ya calculó para este gid (ventana
            # temporal del artículo): no se recalcula nada aquí.
            "vigencia": {
                "estado": ev.temporal_status,
                "motivo": ev.out_of_force_reason,
            },
        })

    max_score = max((r["score"] for r in resultados), default=0.0)
    finales: list[dict] = []
    for i, r in enumerate(resultados, 1):
        score = r["score"]
        if score == float("inf"):
            rel = 1.0
        elif max_score > 0 and score == score:
            rel = round(score / max_score, 3)
        else:
            rel = 0.0
        finales.append({
            "rank": i,
            "nodo_id": r["nodo_id"],
            "gid": r["gid"],
            "instrumento": r["instrumento"],
            "label": r["label"],
            "score": score,
            "score_rel": rel,
            "canal": r["canal"],
            "evidencia": r["evidencia"],
            "snippet": r["snippet"],
            "terminos": r["terminos"],
            "unidades": r["unidades"],
            "sha256": r["sha256"],
            "url": r["url"],
            "vigencia": r["vigencia"],
        })
    for r in finales:
        cita, cita_motivo = _cita_de(r["gid"], resolver)
        r["cita"] = cita
        r["cita_motivo"] = cita_motivo
    resultados = finales
    if not pack and dirs:
        pack = dirs[0].parent.name
    arbol = _explicar_arbol(q, retriever, resultados,
                            arbol_dir=arbol_dir)
    for r in resultados:
        r.setdefault("materias", [])
    return {
        "rotulo": _ROTULO_BUSQUEDA,
        "metodo": {
            "motor": "bm25-starter",
            "determinista": True,
            "modelo": None,
            "canales": ["cita_explicita", "lexico", "referencia", "contiguidad"],
            "pack": pack,
            "descripcion": "BM25 por cláusula sobre el corpus sellado, sin modelo",
        },
        "arbol": arbol,
        "total": len(resultados),
        "sin_nodo": sin_nodo,
        "resultados": resultados,
    }


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

# ---------------------------------------------------------------------------
# Lectura de un artículo y mapa gid→nodo (stdin JSON, como `grafo buscar`)
# ---------------------------------------------------------------------------

# Topes por encima del máximo medido del corpus instalado (2026-11-09):
# artículo más largo 27.535 caracteres y 115 unidades (articulo_242302_art_0019).
_MAX_TEXTO_LEER = 40_000
_MAX_UNIDADES_LEER = 300
_NODO_ID_LEER = re.compile(r"^a:\d+:[A-Za-z0-9_]+$")


def _norma_de(current: Path, code: str):
    """(titulo, nombre_corto) de la norma `code`, o ('', '') si no está."""
    n = _read_json(current / "normas" / f"norma_{code}.json") or {}
    eli = n.get("eli") or {}
    return (n.get("title") or "", _nombre_corto(eli))


def _articulo_json(ev) -> dict:
    """El JSON del archivo del artículo que el resolver ya verificó."""
    try:
        return json.loads(Path(ev.source_path).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}


def _payload_leer(ev, nodo_id: str) -> dict:
    """Respuesta RESOLVED de `grafo leer`: texto, vigencia y unidades."""
    import hashlib as _hl
    texto_completo = ev.text or ""
    # Integridad: el hash recalculado del texto fuente debe ser el registrado.
    real = _hl.sha256(texto_completo.encode("utf-8")).hexdigest()
    if real != (ev.text_sha256 or ""):
        raise ValueError("texto del artículo no coincide con su hash registrado")
    truncado = len(texto_completo) > _MAX_TEXTO_LEER
    texto = texto_completo[:_MAX_TEXTO_LEER] if truncado else texto_completo
    articulo = _articulo_json(ev)
    current = Path(ev.source_path).parent.parent
    titulo, corto = _norma_de(current, ev.leychile_code)
    unidades = []
    for u in _unidades(texto):
        if len(unidades) >= _MAX_UNIDADES_LEER:
            truncado = True
            break
        mod, regla = _modalidad(u["texto"])
        unidades.append({
            "id": f"{nodo_id}#u{u['orden']:02d}",
            "inicio": u["char_start"],
            "fin": u["char_end"],
            "texto": u["texto"],
            "etiqueta": u["etiqueta"],
            "modalidad_candidata": mod,
            "modalidad_regla": regla,
        })
    return {
        "resolucion": "RESOLVED",
        "gid": ev.gid,
        "nodo_id": nodo_id,
        "norma": {
            "codigo": ev.leychile_code,
            "titulo": titulo,
            "nombre_corto": corto,
        },
        "articulo": str(articulo.get("label") or articulo.get("eId")
                        or ev.eid),
        "texto": texto,
        # sha256 del texto devuelto (tras el recorte): el adaptador lo
        # recalcula sobre `texto`. La integridad de la fuente ya se verificó
        # arriba contra `ev.text_sha256` antes de recortar.
        "texto_sha256": _hl.sha256(texto.encode("utf-8")).hexdigest(),
        "fuente_url": ev.source_url,
        "fecha_recuperacion": ev.retrieved_at,
        "vigencia": {
            "desde": ev.temporal_from,
            "hasta": ev.temporal_to,
            "estado": ev.temporal_status,
            "motivo": ev.out_of_force_reason,
            "citabilidad": ev.citation_status,
        },
        "unidades": unidades,
        "truncado": truncado,
    }


def _ev_por_nodo_id(nodo_id: str, resolver):
    """Evidencia del artículo `a:CODE:EID`, o None si no está en el corpus."""
    from lexo_cli.starter.resolver import NormativeResolutionError
    for current in _corpus_dirs():
        for af in _candidatos_articulo(current, nodo_id):
            a = _read_json(af)
            if not isinstance(a, dict) or not _es_articulo(a, nodo_id):
                continue
            eli = a.get("@id")
            if not isinstance(eli, str) or not eli:
                continue
            try:
                return resolver.resolve_eli(eli)
            except NormativeResolutionError:
                return None
    return None


def leer(payload: dict) -> dict:
    """Resuelve UNA cita/gid/nodo_id y devuelve el artículo con sus unidades.

    Exactamente una de las tres claves. Una resolución que no es RESOLVED se
    devuelve tal cual (``resolucion`` + ``candidatos``/``motivo``/
    ``failure_kind``), sin texto; un ``nodo_id`` inexistente es UNRESOLVABLE
    con motivo ``NODO_INEXISTENTE``.
    """
    from lexo_cli.starter.norm_reference import resolve_norm_reference
    from lexo_cli.starter.resolver import NormativeResolutionError

    if not isinstance(payload, dict):
        raise ValueError("entrada inválida: se esperaba un objeto JSON.")
    claves = [k for k in ("cita", "gid", "nodo_id") if k in payload]
    if len(claves) != 1 or set(payload) - {"cita", "gid", "nodo_id"}:
        raise ValueError("indica exactamente uno de: cita, gid o nodo_id.")
    clave = claves[0]
    valor = payload[clave]
    if not isinstance(valor, str) or not valor.strip():
        raise ValueError(f"{clave} debe ser texto no vacío.")

    resolver, _ = _resolver()
    if clave == "cita":
        res = resolve_norm_reference(valor.strip(), resolver)
        if res.status != "RESOLVED" or not res.gid:
            return {"resolucion": res.status,
                    "candidatos": list(res.candidates or []),
                    "motivo": res.reason or "",
                    "failure_kind": res.failure_kind}
        ev = resolver.resolve(res.gid)
    elif clave == "gid":
        try:
            ev = resolver.resolve(valor.strip())
        except NormativeResolutionError as exc:
            return {"resolucion": "UNRESOLVABLE", "motivo": exc.code}
    else:
        nodo_id = valor.strip()
        if not _NODO_ID_LEER.fullmatch(nodo_id):
            return {"resolucion": "UNRESOLVABLE", "motivo": "NODO_INEXISTENTE"}
        ev = _ev_por_nodo_id(nodo_id, resolver)
        if ev is None:
            return {"resolucion": "UNRESOLVABLE", "motivo": "NODO_INEXISTENTE"}
    nodo_id = f"a:{ev.leychile_code}:{ev.eid}"
    return _payload_leer(ev, nodo_id)


def mapa_nodos() -> dict:
    """Mapa ``{gid: nodo_id}`` de todo el corpus (para enriquecer citas)."""
    resolver, _ = _resolver()
    return {"nodos": {gid: f"a:{ev.leychile_code}:{ev.eid}"
                     for gid, ev in resolver._by_gid.items()}}


def _grafo(args: list[str]) -> int:
    if not args:
        return _fail("grafo: falta el objetivo (personal|corpus|corpus-norma|"
                     "red|nodo|unidad|unidades|buscar|leer|nodos).")
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
        for current in _corpus_dirs():
            for af in _candidatos_articulo(current, aid):
                a = _read_json(af) or {}
                if not _es_articulo(a, aid):
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

    if op == "unidades":
        # Nodos 'unidad' de UN artículo + sus aristas contiene/excepciona:
        # la vista los pide al expandir el artículo, no en la red completa.
        if len(rest) != 1:
            return _fail("grafo unidades <id articulo>")
        aid = rest[0]
        for current in _corpus_dirs():
            for af in _candidatos_articulo(current, aid):
                a = _read_json(af) or {}
                if not _es_articulo(a, aid):
                    continue
                # Rótulo del instrumento para las labels de las unidades.
                corto = aid
                code = af.stem.split("_")[1]
                nf = current / "normas" / f"norma_{code}.json"
                if nf.is_file():
                    n = _read_json(nf) or {}
                    corto = _nombre_corto(n.get("eli") or {}) or corto
                rotulo_art = str(a.get("label") or a.get("eId") or af.stem)
                nodos_u: list[dict] = []
                aristas_u: list[dict] = []
                unidades = _unidades(a.get("text") or "")
                for i, u in enumerate(unidades):
                    uid = f"{aid}#u{u['orden']:02d}"
                    mod, regla = _modalidad(u["texto"])
                    nodos_u.append({
                        "id": uid,
                        "tipo": "unidad",
                        "label": f"{rotulo_art}, {u['etiqueta']}",
                        "clase": "normativa",
                        "etiqueta": u["etiqueta"],
                        "orden": u["orden"],
                        "articulo": aid,
                        "modalidad": mod,
                        "modalidad_estado": "candidata",
                        "modalidad_regla": regla,
                    })
                    aristas_u.append({
                        "source": aid, "target": uid,
                        "tipo": "contiene", "estado": "verificada_estructura",
                    })
                    if regla == "R-EXC" and i > 0:
                        aristas_u.append({
                            "source": uid, "target": f"{aid}#u{i:02d}",
                            "tipo": "excepciona", "estado": "candidata",
                        })
                _out({"nodes": nodos_u, "links": aristas_u,
                      "conteos": {"nodes": len(nodos_u), "links": len(aristas_u)}})
                return 0
        return _fail("artículo no encontrado en el corpus instalado.")

    if op == "nodo":
        # Ficha de un instrumento o artículo: url, sha256, conteos y vigencia.
        if len(rest) != 1:
            return _fail("grafo nodo <id>")
        nid = rest[0]
        for current in _corpus_dirs():
            for nf in _candidatos_norma(current, nid):
                n = _read_json(nf) or {}
                code = str(n.get("leychileCode") or nf.stem.removeprefix("norma_"))
                if not (nid == f"n:{code}" or str(n.get("@id") or "") == nid):
                    continue
                n_arts = len(list((current / "articulos").glob(f"articulo_{code}_*.json")))
                temporal = n.get("temporal") or {}
                _out({
                    "id": nid, "tipo": "instrumento",
                    "label": _nombre_corto(n.get("eli") or {}),
                    "titulo": n.get("title") or "",
                    "url": n.get("sourceDocumentUrl") or n.get("sourceUri") or None,
                    "sha256": hashlib.sha256(nf.read_bytes()).hexdigest(),
                    "n_articulos": n_arts,
                    "vigencia": {"estado": temporal.get("status") or "",
                                 "desde": temporal.get("from") or ""},
                })
                return 0
            for af in _candidatos_articulo(current, nid):
                a = _read_json(af) or {}
                if not _es_articulo(a, nid):
                    continue
                temporal = a.get("temporal") or {}
                _out({
                    "id": nid, "tipo": "articulo",
                    "label": str(a.get("label") or a.get("eId") or af.stem),
                    "url": (a.get("provenance") or {}).get("wasDerivedFrom") or None,
                    "sha256": a.get("textSha256")
                        or (a.get("citation") or {}).get("textSha256"),
                    "n_unidades": len(_unidades(a.get("text") or "")),
                    "vigencia": {"estado": temporal.get("status") or "",
                                 "desde": temporal.get("from") or ""},
                })
                return 0
        return _fail("nodo no encontrado en el corpus instalado.")

    if op == "red":
        # Payload DELGADO: un nodo por instrumento y uno por artículo con sus
        # conteos, aristas 'contiene' mínimas. Las unidades, el texto y los
        # hashes llegan por consulta (grafo unidades / grafo nodo / grafo
        # unidad): la red completa viaja por el IPC de la app y un cuerpo de
        # ~20 MB agotaba el timeout de 30 s del renderer.
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
                # Ids opacos CORTOS: con ~8.544 artículos el @id largo (~50
                # caracteres) inflaba el payload por encima del presupuesto
                # de 2,5 MB; a:CODE:EID localiza el archivo directamente.
                nid = f"n:{code}"
                archivos = sorted((current / "articulos").glob(f"articulo_{code}_*.json"))
                nodos.append({
                    "id": nid,
                    "tipo": "instrumento",
                    "label": corto,
                    "n_articulos": len(archivos),
                })
                for af in archivos:
                    a = _read_json(af) or {}
                    eid = str(a.get("eId") or af.stem[len("articulo_" + code + "_"):])
                    aid = f"a:{code}:{eid}"
                    rotulo = str(a.get("label") or a.get("eId") or af.stem)
                    nodos.append({
                        "id": aid,
                        "tipo": "articulo",
                        "label": f"{corto}, art. {rotulo}",
                        "instrumento": nid,
                        "n_unidades": len(_unidades(a.get("text") or "")),
                    })
                    aristas.append({
                        "source": nid,
                        "target": aid,
                        "tipo": "contiene",
                        "estado": "verificada_estructura",
                    })
        _out({
            "nodes": nodos,
            "links": aristas,
            "conteos": {"nodes": len(nodos), "links": len(aristas)},
            "truncado": False,
        })
        return 0

    if op == "buscar":
        # La consulta NO viaja por argv (quedaría visible en `ps` ni en logs):
        # llega por STDIN como JSON {"q": str, "limite": int}.
        if rest:
            return _fail("grafo buscar no lleva argumentos: la consulta va por stdin.")
        try:
            payload = json.loads(sys.stdin.read() or "{}")
        except json.JSONDecodeError:
            return _fail("entrada inválida: se esperaba JSON {\"q\": ..., \"limite\": ...}.")
        if not isinstance(payload, dict):
            return _fail("entrada inválida: se esperaba un objeto JSON.")
        try:
            _out(buscar(payload.get("q"), payload.get("limite", 20)))
        except ValueError as exc:
            return _fail(str(exc))
        return 0

    if op in ("leer", "nodos"):
        # La entrada NO viaja por argv: llega por STDIN como JSON, igual que
        # `grafo buscar`, para que citas e identificadores no queden en `ps`.
        if rest:
            return _fail(f"grafo {op} no lleva argumentos: la entrada va por stdin.")
        try:
            payload = json.loads(sys.stdin.read() or "{}")
        except json.JSONDecodeError:
            return _fail("entrada inválida: se esperaba JSON.")
        try:
            _out(leer(payload) if op == "leer" else mapa_nodos())
        except ValueError as exc:
            return _fail(str(exc))
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
