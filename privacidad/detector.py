"""Detector de datos personales (pipeline fail-closed, offsets al texto original).

Procedencia (ver VENDORED.json):
- dpp-ai-compliance-lab `patterns.py`/`anonimiza_server.py` @0d1e386 (MIT):
  registro de patrones, resolución de solapes por severidad, estrategias.
- graph-legal-ir `privacy/pii.py` (working tree): nombre antes de RUN de
  persona (<50 millones), propagación de nombres, `detect_judge_names`
  (jueces y sala se conservan; «Ministro de Fe» no es juez), palabras
  estructurales que no continúan un nombre, whitelist institucional.
- lexo-case-writer `piiMask.ts` @7c13a89 (MIT): lista blanca RIT/RUC/ROL antes
  de cualquier patrón y cola RUT con DV módulo 11 dentro de un identificador.
- dike-desk `residual-mask.ts` @e3348d2: post-pasada de tratamientos.
"""

from __future__ import annotations

import bisect
import re
import unicodedata
from collections.abc import Iterable

from dike_privacidad.nombres_pila import NOMBRES_PILA
from dike_privacidad.patrones import patrones_de, dv_rut_valido

VERSION = "privacidad-f2a-2"

AVISO = (
    "Seudonimización, no anonimización: el mapa queda en este equipo. "
    "Un detector por reglas no encuentra todos los nombres sin contexto; "
    "revisa la lista de posibles personas."
)

ESTRATEGIAS = {
    "ligera": {"critical"},
    "media": {"critical", "high"},
    "estricta": {"critical", "high", "medium"},
}
_ESTRATEGIA_DEFAULT = "media"
_SEV_ORDEN = {"critical": 0, "high": 1, "medium": 2, "low": 3}
_CERO_ANCHO = {"\u200b", "\u200c", "\u200d", "\u2060", "\ufeff"}


# ---------------------------------------------------------------------------
# Normalización con mapa de offsets al texto ORIGINAL (NFKC + ancho cero)
# ---------------------------------------------------------------------------

def normalizar(texto: str) -> tuple[str, list[tuple[int, int]]]:
    """(texto normalizado, mapa) — mapa[i] = (inicio, fin) en el original."""
    out: list[str] = []
    mapa: list[tuple[int, int]] = []
    for i, ch in enumerate(texto):
        if ch in _CERO_ANCHO:
            continue
        if ord(ch) < 128:
            out.append(ch)
            mapa.append((i, i + 1))
            continue
        for c in unicodedata.normalize("NFKC", ch):
            out.append(c)
            mapa.append((i, i + 1))
    return "".join(out), mapa


def _a_original(mapa, ns: int, ne: int) -> tuple[int, int]:
    return mapa[ns][0], mapa[ne - 1][1]


class _Ocupados:
    """Spans ocupados ordenados: solape en ~O(log n) con bisect.

    Invariante: lo que se agrega no se solapa entre sí, así que un candidato
    solo puede topar con el span que lo contiene (predecesor) o con el
    primero que empieza dentro (sucesor) — salvo cadenas que se revisan
    hacia atrás hasta que `fin <= inicio`.
    """

    def __init__(self, spans: Iterable[tuple[int, int]] = ()):
        self.spans = sorted(spans)
        self.starts = [s for s, _ in self.spans]

    def hay(self, ns: int, ne: int) -> bool:
        i = bisect.bisect_right(self.starts, ns)
        j = i - 1
        while j >= 0 and self.spans[j][1] > ns:
            if self.spans[j][0] < ne:
                return True
            j -= 1
        j = i
        while j < len(self.spans) and self.spans[j][0] < ne:
            if self.spans[j][1] > ns:
                return True
            j += 1
        return False

    def agregar(self, ns: int, ne: int) -> None:
        i = bisect.bisect(self.starts, ns)
        self.starts.insert(i, ns)
        self.spans.insert(i, (ns, ne))

    def __iter__(self):
        return iter(self.spans)


# ---------------------------------------------------------------------------
# Vocabulario (graph-legal-ir pii.py / dike-desk residual-mask.ts / piiMask.ts)
# ---------------------------------------------------------------------------

_PALABRAS_NO_CONTINUACION = frozenset({
    "primero", "segundo", "tercero", "cuarto", "quinto", "sexto", "séptimo", "septimo",
    "octavo", "noveno", "décimo", "decimo", "undécimo", "duodécimo", "vigésimo",
    "trigésimo", "cuadragésimo", "quincuagésimo", "sexagésimo", "septuagésimo",
    "octogésimo", "nonagésimo", "centésimo",
    "considerando", "considerandos", "vistos", "visto", "resuelve", "resolviendo",
    "se", "por", "tanto", "con", "lo", "que", "en", "sentencia", "tribunal", "corte",
    "rol", "ley", "decreto", "artículo", "articulo", "ministerio", "servicio",
    "superintendencia", "municipalidad", "dirección", "direccion",
    "regístrese", "registrese", "notifíquese", "notifiquese", "archívese", "archivese",
    "comuníquese", "pronunciada", "acordada", "redacción", "redaccion", "autoriza",
    "rut", "run",
    "sr", "sra", "srta", "sres", "sras", "señor", "señora", "señorita", "don", "doña",
    "dr", "dra",
    "fuente", "cuadro", "tabla", "figura", "gráfico", "grafico", "anexo", "nota", "imagen",
})

_PERSONA_WHITELIST = frozenset({
    "ley", "decreto", "articulo", "artículo", "tribunal", "corte", "juzgado",
    "ministerio", "servicio", "direccion", "dirección", "republica", "república",
    "gobierno", "estado", "municipalidad", "municipio", "region", "región",
    "comision", "comisión", "consejo", "sociedad", "empresa", "compania", "compañía",
    "fundacion", "fundación", "codigo", "código", "reglamento", "contraloria",
    "contraloría", "resolucion", "resolución", "auto", "providencia", "sentencia",
    "conaf", "sma", "senapred",
    "ministro", "ministra", "juez", "jueza", "magistrado", "magistrada", "relator",
    "relatora", "secretario", "secretaria", "abogado", "abogada", "fiscal", "perito",
    "perita", "apoderado", "apoderada", "notario", "notaria", "receptor", "receptora",
    "presidente", "presidenta", "vicepresidente", "vicepresidenta", "superintendente",
    "superintendenta", "director", "directora", "alcalde", "alcaldesa", "intendente",
    "seremi", "delegado", "delegada", "gobernador", "gobernadora", "diputado",
    "diputada", "senador", "senadora", "contralor", "contralora", "defensor",
    "defensora", "procurador", "procuradora", "subsecretario", "subsecretaria",
    "jefe", "jefa", "regional", "ministerial", "nacional", "general", "ejecutivo",
    "ejecutiva", "titular", "suplente", "subrogante", "instructor", "instructora",
    "redactor", "redactora", "integrante", "tercero", "tercera", "técnico",
    "técnica", "tecnico", "tecnica", "científico", "científica", "judicial",
    "público", "pública", "publico", "publica",
    "sr", "sra", "srta", "sres", "sras", "señor", "señora", "señorita", "don",
    "doña", "dr", "dra", "primer", "primero", "primera", "segundo", "segunda",
    "ilustre", "excelentísima", "excma",
    "superintendencia", "subsecretaría", "subsecretaria", "secretaría", "fiscalía",
    "fiscalia", "defensoría", "defensoria", "tesorería", "intendencia", "gobernación",
    "junta", "comité", "comite", "asociación", "asociacion", "corporación",
    "corporacion", "cooperativa", "comunidad", "agrupación", "organización",
    "sindicato", "universidad", "instituto", "minera", "inmobiliaria", "inversiones",
    "constructora", "agrícola", "agricola", "forestal", "pesquera", "banco",
    "humedal", "parque", "reserva", "santuario", "proyecto", "programa", "plan",
    "prueba", "audiencia", "informe", "acta", "expediente", "oficio", "recurso",
    "reclamación", "reclamacion", "demanda", "causa", "sala", "pleno", "medio",
    "ambiente", "medioambiente",
})

_PALABRAS_INICIALES_NO_NOMBRE = frozenset({
    "que", "considerando", "vistos", "con", "por", "para", "en", "el", "la",
    "los", "las", "y", "comparece", "comparecen", "señala", "indica", "según",
    "segun", "a", "al", "se",
})

_PALABRAS_CORTE = frozenset(
    set(_PERSONA_WHITELIST) | set(_PALABRAS_NO_CONTINUACION) | {
        "chile", "chilena", "chileno", "santiago", "apelaciones", "suprema",
        "trabajo", "civil", "penal", "familia", "garantia", "letras",
        "constitucional", "politica", "justicia", "derechos", "humanos",
        "ambiente", "salud", "impuestos", "internos", "aguas", "oficina",
        "caso", "oriente", "poniente", "norte", "sur", "centro", "metropolitana",
        "ministros", "encargado", "encargada", "conservador", "conservadora",
        "administrador", "administradora", "familiar", "hospital", "rit", "ruc",
    })

_PARTICULAS = frozenset({"de", "del", "la", "los", "las", "y", "e"})
_FOLD_TAB = {i: None for i in range(0x300, 0x370)}  # diacríticos U+0300–U+036F


def _fold(palabra: str) -> str:
    return unicodedata.normalize("NFD", palabra.casefold()).translate(_FOLD_TAB)


def normalizar_valor(valor: str) -> str:
    """Comparación estable de valores: minúscula, sin tilde, espacios colapsados."""
    return " ".join(_fold(p) for p in valor.split() if p.strip())



def buscar_valores(texto: str, valores):
    """Coincidencias sin tilde ni diferencias de espacios, con offsets originales."""
    if not valores:
        return
    letras, mapa = [], []
    for palabra in re.finditer(r"\S+", texto):
        if letras:
            letras.append(" ")
            mapa.append((mapa[-1][1], palabra.start()))
        for i in range(palabra.start(), palabra.end()):
            plegado = _fold(texto[i])
            if not plegado and mapa:
                mapa[-1] = (mapa[-1][0], i + 1)
            for letra in plegado:
                letras.append(letra)
                mapa.append((i, i + 1))
    normalizado = "".join(letras)
    for valor in valores:
        clave = normalizar_valor(valor)
        if not clave:
            continue
        for hallazgo in re.finditer(r"(?<!\w)" + re.escape(clave) + r"(?!\w)", normalizado):
            yield clave, mapa[hallazgo.start()][0], mapa[hallazgo.end() - 1][1]


def _es_palabra_corte(word: str) -> bool:
    return word.casefold() in _PALABRAS_CORTE or _fold(word) in _PALABRAS_CORTE


def _looks_like_proper_name(name: str) -> bool:
    words = [w for w in name.split() if w.casefold() not in _PARTICULAS]
    return bool(words) and all(w[0].isupper() for w in words)


def _proper_name_prefix_len(name: str) -> int:
    end = 0
    for m in re.finditer(r"\S+", name):
        word = m.group(0)
        if word.casefold() in _PARTICULAS:
            if end == 0:
                return 0
            continue
        if not word[0].isupper() or _es_palabra_corte(word):
            break
        end = m.end()
    return end


# ---------------------------------------------------------------------------
# Patrones de nombres y sala (graph-legal-ir pii.py)
# ---------------------------------------------------------------------------

_PALABRA_NOMBRE = r"(?:[A-ZÁÉÍÓÚÑ][a-záéíóúñü]+|[A-ZÁÉÍÓÚÑ]{2,})"
_SEP_NOMBRE = r"(?:[ \t]+|[ \t]*\n[ \t]*)"
_NO_CONT = r"(?!(?i:" + "|".join(sorted(_PALABRAS_NO_CONTINUACION, key=len, reverse=True)) + r")(?!\w))"
_PARTICULA = r"(?:de" + _SEP_NOMBRE + r"la|de" + _SEP_NOMBRE + r"los|de" + _SEP_NOMBRE + r"las|del|de|y|e)"
_CONT_NOMBRE = r"(?:" + _SEP_NOMBRE + r"(?:" + _PARTICULA + _SEP_NOMBRE + r")?" + _NO_CONT + _PALABRA_NOMBRE + r")"
_NOMBRE_EXT = r"(" + _PALABRA_NOMBRE + _CONT_NOMBRE + r"{0,5})"
_NOMBRE_EXT_2 = r"(" + _PALABRA_NOMBRE + _CONT_NOMBRE + r"{1,5})"
_TRATAMIENTOS = r"(?:Sr|Sra|Srta|Sres|Sras|Señor|Señora|Señorita|señor|señora|señorita)"
_CARGOS = (
    r"(?:[Mm]inistr[oa]|[Jj]ueza?|[Mm]agistrad[oa]|[Rr]elatora?|[Ss]ecretari[oa]|[Aa]bogad[oa]|"
    r"[Ff]iscal|[Pp]erit[oa]|[Aa]poderad[oa]|[Nn]otari[oa]|[Rr]eceptora?|[Pp]residenta?|[Pp]residente)")
_MODIFICADORES = (
    r"(?:[Tt]itular|[Ss]uplente|[Ss]ubrogante|[Rr]edactora?|[Pp]residenta?|[Pp]residente|[Ii]ntegrante|"
    r"[Tt]écnic[oa]|[Aa]bogad[oa]|[Cc]ientífic[oa]|[Jj]udicial|[Pp]úblic[oa]|[Ii]nstructora?|"
    r"[Ss]eñora?|[Dd]on|[Dd]oña)")

PERSONA_TRATAMIENTO_PATTERN = re.compile(
    r"(?<!\w)" + _TRATAMIENTOS + r"\.?" + _SEP_NOMBRE + r"(?:" + _CARGOS + _SEP_NOMBRE + r")*"
    + _NO_CONT + _NOMBRE_EXT, re.UNICODE)
PERSONA_CARGO_PATTERN = re.compile(
    r"(?<!\w)" + _CARGOS + r"(?:" + _SEP_NOMBRE + _MODIFICADORES + r")*" + _SEP_NOMBRE
    + r"(?:" + _TRATAMIENTOS + r"\.?" + _SEP_NOMBRE + r")?" + _NO_CONT + _NOMBRE_EXT,
    re.UNICODE)
_PERSONA_TITULOS = (
    r"demandante|demandado|demandada|recurrente|recurrido|recurrida|"
    r"requirente|requerido|requerida|denunciante|denunciado|denunciada|"
    r"querellante|querellado|querellada|imputado|imputada|actor|actora|"
    r"ejecutor|ejecutora|curador|curadora|síndico|síndica|"
    r"guardador|guardadora|perito|perita|ministro de fe|"
    r"trabajador|trabajadora|empleado|empleada|cliente|proveedor|compareciente")
PERSONA_CONTEXT_PATTERN = re.compile(
    r"(?i)(?<!\w)(?:" + _PERSONA_TITULOS + r")[ \t]*:?[ \t]+" + _NOMBRE_EXT, re.UNICODE)
PERSONA_DON_PATTERN = re.compile(
    r"(?i)(?<!\w)(?:don|doña)\s+" + _NOMBRE_EXT, re.UNICODE)
# El grupo 2 (millones) distingue personas (<50) de entidades (RUT empresa).
PERSONA_ANTES_DE_RUN_PATTERN = re.compile(
    _NOMBRE_EXT_2 + r",?" + _SEP_NOMBRE
    + r"(?:RUN|RUT|Run|Rut|R\.U\.N\.?|R\.U\.T\.?|C\.I\.|[Cc]édula(?:[ \t]+(?:de|nacional)[ \t]+identidad)?)"
    + r"[ \t]*(?:N[°ºo]\.?[ \t]*)?:?[ \t]*([lI]?\d{1,2}|[lI])(?:\.\d{3}){2}-[\dkK](?!\w)",
    re.UNICODE)
_MILLONES_MAX_PERSONA = 50

_ROL_JUEZ = (
    r"(?:[Mm]inistr[oa]s?|[Jj]ue(?:z|za|ces)|[Mm]agistrad[oa]s?|[Aa]bogad[oa]s?" + _SEP_NOMBRE + r"[Ii]ntegrantes?)"
    r"(?:[ \t]*\(as?\))?")
_INICIO_SALA = re.compile(
    r"(?<!\w)(?:" + _ROL_JUEZ + r"|(?P<integrada>[Ii]ntegrad[oa]s?" + _SEP_NOMBRE + r"por))(?!\w)",
    re.UNICODE)
_CONTEXTO_SALA = re.compile(r"(?i)tribunal|corte|sala|pronunciad")
_RELLENO_SALA = re.compile(
    r"(?:[\s,;]+|\([a-z]{1,3}\)|[A-ZÁÉÍÓÚÑ]\.|" + _ROL_JUEZ + r"(?!\w)|"
    r"(?:Srta|Sras|Sres|Sra|Sr|Señoras|Señores|Señora|Señor)(?!\w)\.?|"
    r"(?<!\w)(?:y|e|el|la|los|las|señor|señora|señores|señoras|don|doña|Don|Doña|[Pp]residenta?|[Pp]residente|"
    r"[Rr]edactora?|[Tt]itular|[Ss]uplente|[Ss]ubrogante|[Tt]écnic[oa]|[Cc]ientífic[oa]|[Aa]bogad[oa])(?!\w))+",
    re.UNICODE)
_NOMBRE_SALA = re.compile(_NO_CONT + _NOMBRE_EXT, re.UNICODE)
_FIRMA_JUEZ = re.compile(
    r"(?:^|\n)[ \t]*" + _NOMBRE_EXT_2 + r"[ \t]*,?[ \t]*\n[ \t]*" + _ROL_JUEZ + r"(?!\w)",
    re.UNICODE)
_MAX_SALA = 15


def detect_judge_names(texto: str) -> list[str]:
    """Nombres de jueces e integración de sala: se CONSERVAN (públicos)."""
    names: list[str] = []
    for start in _INICIO_SALA.finditer(texto):
        before = texto[max(0, start.start() - 120):start.start()]
        if start.group("integrada") and not _CONTEXTO_SALA.search(before):
            continue
        trigger = start.group(0)
        is_list = bool(start.group("integrada")) or "(" in trigger or re.search(r"(?:s|ces)\W*$", trigger)
        pos, found = start.end(), 0
        while found < (_MAX_SALA if is_list else 1):
            filler = _RELLENO_SALA.match(texto, pos)
            if filler:
                pos = filler.end()
            m = _NOMBRE_SALA.match(texto, pos)
            if not m:
                break
            length = _proper_name_prefix_len(m.group(1))
            if length == 0 or _es_palabra_corte(m.group(1).split()[0]):
                break
            names.append(m.group(1)[:length])
            pos, found = m.start(1) + length, found + 1
    for m in _FIRMA_JUEZ.finditer(texto):
        length = _proper_name_prefix_len(m.group(1))
        if length and not _es_palabra_corte(m.group(1).split()[0]):
            names.append(m.group(1)[:length])
    return names


def _kept_index(names: Iterable[str]) -> list[tuple[str, ...]]:
    index = []
    for name in names:
        for part in re.split(r"\s+y\s+", name):
            words = tuple(w.casefold() for w in part.split())
            if sum(w not in _PARTICULAS for w in words) >= 2:
                index.append(words)
    return index


def _is_kept(name: str, kept: list[tuple[str, ...]]) -> bool:
    words = tuple(w.casefold() for w in name.split())
    if not kept or sum(w not in _PARTICULAS for w in words) < 2:
        return False
    n = len(words)
    return any(k[i:i + n] == words for k in kept for i in range(len(k) - n + 1))


# ---------------------------------------------------------------------------
# Lista blanca de anclas de causa (piiMask.ts)
# ---------------------------------------------------------------------------

_CAUSA_PATTERN = re.compile(
    r"(?<!\w)(?:RIT|RUC|ROL)[\s:.-]*[A-Z]?[\s:.-]*\d{1,3}(?:[\s:.-]+\d{1,8}){1,3}(?!\w)")
_RUT_TAIL = re.compile(r"(\d{1,2}(?:\.\d{3}){2}|\d{7,8})-([\dkK])(?!\w)")


def _split_causa_rut(frag: str):
    m = _RUT_TAIL.search(frag)
    if not m:
        return None
    if not dv_rut_valido(m.group(1).replace(".", ""), m.group(2)):
        return None
    return m.start(), m.end()


# ---------------------------------------------------------------------------
# Residual mask (dike-desk residual-mask.ts)
# ---------------------------------------------------------------------------

_HONORIFIC = re.compile(
    r"(?<![\w])(?:Sr|Sra|Srta|Sres|Sras|señor|señora|señores|señoras|don|doña)\.?\s+",
    re.IGNORECASE | re.UNICODE)
_CAP_WORD = re.compile(r"[A-ZÁÉÍÓÚÑÜ][a-záéíóúñü]+")
_PARTICULA_RE = re.compile(r"(?:de|del|la|las|los|y|e)\s+")


def _residual_spans(texto: str, ocupados: _Ocupados) -> list[tuple[int, int]]:
    spans = []
    for m in _HONORIFIC.finditer(texto):
        pos = m.end()
        if ocupados.hay(pos - 1, pos + 1):
            continue
        words, end, cursor = 0, pos, pos
        while words < 4:
            w = _CAP_WORD.match(texto, cursor)
            if not w:
                break
            if words == 0 and _es_palabra_corte(w.group(0)):
                break
            end = w.end()
            words += 1
            sp = re.match(r"\s+", texto[end:])
            if not sp:
                break
            part = _PARTICULA_RE.match(texto, end + sp.end())
            cursor = end + sp.end() + (part.end() if part else 0)
        if words:
            span = (pos, end)
            if not ocupados.hay(*span):
                spans.append(span)
                ocupados.agregar(*span)
    return spans


# ---------------------------------------------------------------------------
# Nombre antes de RUN y propagación (graph-legal-ir)
# ---------------------------------------------------------------------------

def _spans_antes_de_run(texto: str, kept) -> list[tuple[int, int, str]]:
    spans = []
    for m in PERSONA_ANTES_DE_RUN_PATTERN.finditer(texto):
        millones = m.group(2).replace("l", "1").replace("I", "1")
        if not millones.isdigit() or int(millones) >= _MILLONES_MAX_PERSONA:
            continue
        start, name = m.start(1), m.group(1)
        while name.split() and name.split()[0].casefold() in _PALABRAS_INICIALES_NO_NOMBRE:
            first = name.split()[0]
            skip = name.index(first) + len(first)
            skip += len(name[skip:]) - len(name[skip:].lstrip())
            start, name = start + skip, name[skip:]
        if not name or _es_palabra_corte(name.split()[0]) or not _looks_like_proper_name(name):
            continue
        if _is_kept(name, kept):
            continue
        spans.append((start, start + len(name), name))
    return spans


def _propagar_nombres(texto: str, nombres: Iterable[str], kept, ocupados):
    variants: set[str] = set()
    for name in nombres:
        words = name.split()
        for chosen in (words, words[-2:] if len(words) >= 3 else []):
            if not chosen or chosen[0].casefold() in _PARTICULAS:
                continue
            if any(_es_palabra_corte(w) for w in chosen) or not _looks_like_proper_name(" ".join(chosen)):
                continue
            if _is_kept(" ".join(chosen), kept):
                continue
            variants.add(" ".join(chosen))
            variants.add(" ".join(chosen).upper())
            variants.add(" ".join(
                w if w.casefold() in _PARTICULAS else w[:1] + w[1:].lower() for w in chosen))
    protected = [
        f.span()
        for words in kept
        for f in re.finditer(
            r"(?<!\w)" + _SEP_NOMBRE.join(re.escape(w) for w in words) + r"(?!\w)",
            texto, re.IGNORECASE | re.UNICODE)
    ]
    nuevos = []
    for variant in sorted(variants, key=len, reverse=True):
        if len(variant) < 6:
            continue
        pat = re.compile(
            r"(?<!\w)" + _SEP_NOMBRE.join(re.escape(w) for w in variant.split()) + r"(?!\w)",
            re.UNICODE)
        for m in pat.finditer(texto):
            span = m.span()
            if any(span[0] < e and s < span[1] for s, e in protected):
                continue
            if ocupados.hay(*span):
                continue
            nuevos.append((span[0], span[1], variant))
            ocupados.agregar(*span)
    return nuevos


# ---------------------------------------------------------------------------
# Nombres sin contexto (lexo-case-writer piiMask.ts `nombresSinContexto`)
# ---------------------------------------------------------------------------

# Conectores del nombre: «de la», «de los», «de las», «del», «de», «y»
# (NOMBRE_CONECTOR de piiMask; «e» no está en la lista original).
_NOMBRE_CONECTOR = r"(?i:de la|de los|de las|del|de|y)"
_CONECTORES_NOMBRE = frozenset({"de", "del", "la", "los", "las", "y"})
# Secuencia de 2 a 6 palabras de nombre unidas por espacios (nunca salto de
# línea), sin preceder letra, «_» ni «[».
_SECUENCIA_NOMBRE = re.compile(
    r"(?<![^\W\d_]|[_\[])" + _PALABRA_NOMBRE
    + r"(?:[ \t]+(?:(?:" + _NOMBRE_CONECTOR + r")[ \t]+)?" + _PALABRA_NOMBRE + r"){1,5}",
    re.UNICODE)


def _nombres_sin_contexto(norm: str) -> list[tuple[int, int]]:
    """Rangos [inicio, fin) de nombres de pila + apellido sin contexto.

    Port de ``nombresSinContexto`` (piiMask.ts): el primer token no-conector
    cuyo ``_fold`` está en NOMBRES_PILA abre el nombre; se extiende mientras
    el token no sea palabra de corte; un nombre de pila solo no cuenta.
    """
    found = []
    for m in _SECUENCIA_NOMBRE.finditer(norm):
        base = m.start()
        tokens = [
            (w.group(0), base + w.start(), base + w.end(),
             w.group(0).casefold() in _CONECTORES_NOMBRE)
            for w in re.finditer(r"\S+", m.group(0))
        ]
        i = next((k for k, t in enumerate(tokens)
                  if not t[3] and _fold(t[0]) in NOMBRES_PILA), -1)
        if i < 0:
            continue
        last = i
        for j in range(i + 1, len(tokens)):
            if tokens[j][3]:
                continue
            if _es_palabra_corte(tokens[j][0]):
                break
            last = j
        if last == i:
            continue
        found.append((tokens[i][1], tokens[last][2]))
    return found


# ---------------------------------------------------------------------------
# Resolución de solapes (dpp _resolve_overlaps)
# ---------------------------------------------------------------------------

def _resolver_solapes(hallazgos: list[dict]) -> list[dict]:
    orden = sorted(hallazgos, key=lambda f: (
        f["inicio"], _SEV_ORDEN.get(f["severidad"], 99), -(f["fin"] - f["inicio"])))
    result = []
    ocupados = _Ocupados()
    for f in orden:
        if ocupados.hay(f["inicio"], f["fin"]):
            continue
        result.append(f)
        ocupados.agregar(f["inicio"], f["fin"])
    result.sort(key=lambda f: f["inicio"])
    return result


def _h(ns, ne, valor, tipo, categoria, severidad, regla, accion="enmascarar", motivo=None):
    d = {"inicio": ns, "fin": ne, "valor": valor, "tipo": tipo,
         "categoria": categoria, "severidad": severidad, "regla": regla,
         "accion": accion}
    if motivo:
        d["motivo"] = motivo
    return d


# ---------------------------------------------------------------------------
# Pipeline principal — todo en espacio normalizado; offsets originales al final
# ---------------------------------------------------------------------------

def detectar(texto: str, estrategia: str = _ESTRATEGIA_DEFAULT,
             paquetes=("generico", "cl"), conservar_valores=(),
             enmascarar_valores=()) -> list[dict]:
    """Entidades ordenadas, sin solapes, offsets del texto ORIGINAL.

    Pipeline: normalización (mapa al original) → lista blanca RIT/RUC/ROL →
    patrones → nombres antes de RUN → propagación → jueces conservados →
    post-pasada de tratamientos → decisiones del abogado.
    """
    if estrategia not in ESTRATEGIAS:
        estrategia = _ESTRATEGIA_DEFAULT
    severidades = ESTRATEGIAS[estrategia]
    norm, mapa = normalizar(texto)
    crudo: list[dict] = []  # hallazgos en offsets NORMALIZADOS

    # 1. Lista blanca de causa: sus spans protegen lo de adentro.
    causas = [m.span() for m in _CAUSA_PATTERN.finditer(norm)]
    _causa_starts = [s for s, _ in causas]

    def en_causa(ns, ne):
        # la causa que podría contener [ns,ne) es la de mayor inicio <= ns
        i = bisect.bisect_right(_causa_starts, ns) - 1
        while i >= 0 and causas[i][1] > ns:
            if causas[i][0] <= ns and ne <= causas[i][1]:
                return True
            i -= 1
        return False

    # La cola RUT personal (DV válido) dentro de un identificador sí es PII.
    for cs, ce in causas:
        tail = _split_causa_rut(norm[cs:ce])
        if tail:
            ts, te = cs + tail[0], cs + tail[1]
            crudo.append(_h(ts, te, norm[ts:te], "rut", "identificador_directo",
                            "critical", "rut_en_causa"))

    # 2. Patrones regulares.
    for p in patrones_de(paquetes):
        for m in p.regex.finditer(norm):
            g = p.grupo if (p.grupo and m.groups()) else 0
            ns, ne = m.start(g), m.end(g)
            if ns >= ne:
                continue
            if p.categoria != "ancla_causa" and en_causa(ns, ne):
                continue  # la ancla de causa gana la posición
            if p.regla == "rut_sin_guion" and not dv_rut_valido(m.group(1), m.group(2)):
                continue
            valor = norm[ns:ne]
            if p.tipo == "full_name":
                keep = _proper_name_prefix_len(valor)
                if keep == 0 or _es_palabra_corte(valor.split()[0]):
                    continue
                ne = ns + keep
                valor = norm[ns:ne]
                if not _looks_like_proper_name(valor):
                    continue
            if p.categoria == "ancla_causa":
                crudo.append(_h(ns, ne, valor, p.tipo, p.categoria, p.severidad,
                                p.regla, accion="conservar", motivo="ancla_causa"))
            else:
                crudo.append(_h(ns, ne, valor, p.tipo, p.categoria, p.severidad, p.regla))

    # Anclas de causa que ningún patrón cubrió (p. ej. «RUC 9-4-1234567-8»):
    # el whitelist ya las marcó; se emiten como conservar/ancla_causa.
    _TIPO_CAUSA = re.compile(r"(?i)RIT|RUC|ROL")
    anclas_idx = _Ocupados(
        [(h["inicio"], h["fin"]) for h in crudo if h["categoria"] == "ancla_causa"])
    for cs, ce in causas:
        if anclas_idx.hay(cs, ce):
            continue
        pref = _TIPO_CAUSA.search(norm[cs:ce])
        tipo = {"rit": "rit", "ruc": "ruc", "rol": "rol_generic"}.get(
            (pref.group(0).lower() if pref else "rol"), "rol_generic")
        # Si la cola es un RUT personal válido, la ancla cubre solo el prefijo
        # (piiMask: prefijo + [RUT_ANONIMIZADO]).
        ancla_fin = ce
        for h in crudo:
            if h["regla"] == "rut_en_causa" and h["inicio"] >= cs and h["fin"] <= ce:
                ancla_fin = h["inicio"]
                break
        if ancla_fin > cs:
            crudo.append(_h(cs, ancla_fin, norm[cs:ancla_fin], tipo,
                            "ancla_causa", "high", "lista_blanca_causa",
                            accion="conservar", motivo="ancla_causa"))

    # 3. Jueces: nombres conservados; protegen propagación y ocupan spans.
    kept = _kept_index(detect_judge_names(norm))
    spans_juez = [
        f.span()
        for words in kept
        for f in re.finditer(
            r"(?<!\w)" + _SEP_NOMBRE.join(re.escape(w) for w in words) + r"(?!\w)",
            norm, re.IGNORECASE | re.UNICODE)
    ]

    juez_idx = _Ocupados(spans_juez)
    ocupados = _Ocupados(
        [(h["inicio"], h["fin"]) for h in crudo] + spans_juez + causas)

    # 3b. Nombres por contexto (graph-legal-ir): tratamiento, cargo y títulos
    # procesales. El grupo 1 es el nombre; se recorta a su prefijo propio y se
    # descarta si empieza en palabra estructural o es nombre de juez.
    for pat in (PERSONA_TRATAMIENTO_PATTERN, PERSONA_CARGO_PATTERN,
                PERSONA_DON_PATTERN, PERSONA_CONTEXT_PATTERN):
        for m in pat.finditer(norm):
            name = m.group(1)
            keep = _proper_name_prefix_len(name)
            if keep == 0 or _es_palabra_corte(name.split()[0]):
                continue
            ns, ne = m.start(1), m.start(1) + keep
            valor = norm[ns:ne]
            es_juez = _is_kept(valor, kept) or juez_idx.hay(ns, ne)
            if es_juez:
                crudo.append(_h(ns, ne, valor, "full_name", "persona", "high",
                                "nombre_contexto", accion="conservar",
                                motivo="juez"))
                ocupados.agregar(ns, ne)
                continue
            if ocupados.hay(ns, ne):
                continue
            crudo.append(_h(ns, ne, valor, "full_name", "persona", "high",
                            "nombre_contexto"))
            ocupados.agregar(ns, ne)

    # 4. Nombre antes de RUN de persona (< 50 millones).
    nombres: list[str] = []
    for ns, ne, name in _spans_antes_de_run(norm, kept):
        if ocupados.hay(ns, ne):
            continue
        crudo.append(_h(ns, ne, norm[ns:ne], "full_name", "persona", "high",
                        "nombre_antes_de_run"))
        nombres.append(name)
        ocupados.agregar(ns, ne)

    # Nombres detectados por patrones (para propagar).
    for h in crudo:
        if h["tipo"] == "full_name" and h["regla"] != "nombre_propagado":
            nombres.append(h["valor"])

    # 5. Propagación al resto del texto (sin pisar jueces ni lo ya ocupado).
    for ns, ne, _v in _propagar_nombres(norm, nombres, kept, ocupados):
        crudo.append(_h(ns, ne, norm[ns:ne], "full_name", "persona", "high",
                        "nombre_propagado"))

    # 5b. Nombres sin contexto (gazetteer): severidad medium ⇒ se enmascara
    # en estricta y queda como candidato en media/ligera. No alimenta la
    # propagación ni pisa jueces ni spans ya ocupados.
    for ns, ne in _nombres_sin_contexto(norm):
        if ocupados.hay(ns, ne):
            continue
        valor = norm[ns:ne]
        if _is_kept(valor, kept) or juez_idx.hay(ns, ne):
            continue
        crudo.append(_h(ns, ne, valor, "full_name", "persona", "medium",
                        "nombre_gazetteer"))
        ocupados.agregar(ns, ne)

    # 6. Post-pasada de tratamientos (residual-mask).
    for ns, ne in _residual_spans(norm, ocupados):
        crudo.append(_h(ns, ne, norm[ns:ne], "full_name", "persona", "medium",
                        "residual_tratamiento"))

    # 7. Decisiones del abogado: enmascarar valores no detectados.
    enmascarar_norm = {normalizar_valor(v): v for v in enmascarar_valores if v}
    conservar_norm = {normalizar_valor(v) for v in conservar_valores if v}
    for _, ns, ne in buscar_valores(norm, enmascarar_norm):
        if ocupados.hay(ns, ne):
            continue
        crudo.append(_h(ns, ne, norm[ns:ne], "full_name", "persona", "high",
                        "decision_abogado"))
        ocupados.agregar(ns, ne)

    # 8. Sin solapes + conversión a offsets del original.
    juez_orig = _Ocupados([_a_original(mapa, s, e) for s, e in spans_juez])
    finales = _resolver_solapes(crudo)
    out = []
    for h in finales:
        os_, oe = _a_original(mapa, h["inicio"], h["fin"])
        h["inicio"], h["fin"] = os_, oe
        h["valor"] = texto[os_:oe]
        # motivo de conservación
        if h["accion"] == "enmascarar":
            if juez_orig.hay(os_, oe):
                h["accion"], h["motivo"] = "conservar", "juez"
            elif h["severidad"] not in severidades:
                h["accion"], h["motivo"] = "conservar", "por_estrategia"
        if normalizar_valor(h["valor"]) in conservar_norm:
            h["accion"], h["motivo"] = "conservar", "decision_abogado"
        elif normalizar_valor(h["valor"]) in enmascarar_norm:
            h["accion"] = "enmascarar"
            h.pop("motivo", None)
        out.append(h)
    return out


# ---------------------------------------------------------------------------
# Candidatos sin contexto: señal para el abogado; no se enmascaran solos.
# ---------------------------------------------------------------------------

_SECUENCIA_CAND = re.compile(
    r"(?<![\w\[])" + _PALABRA_NOMBRE + r"(?:[ \t]+(?:(?:" + _PARTICULA + r")[ \t]+)?"
    + _PALABRA_NOMBRE + r"){1,3}", re.UNICODE)


def candidatos_sin_contexto(texto: str, entidades: list[dict]) -> list[dict]:
    """Secuencias de 2–4 palabras capitalizadas que no son vocabulario ni
    entidad ya detectada. Las conservadas solo por estrategia (p. ej. el
    gazetteer en media) NO bloquean: siguen visibles como candidatos."""
    norm, mapa = normalizar(texto)
    ocupados = [(e["inicio"], e["fin"]) for e in entidades
                if not (e["accion"] == "conservar" and e.get("motivo") == "por_estrategia")]
    out = []
    for m in _SECUENCIA_CAND.finditer(norm):
        ns, ne = m.span()
        os_, oe = _a_original(mapa, ns, ne)
        if any(max(os_, s) < min(oe, e2) for s, e2 in ocupados):
            continue
        valor = norm[ns:ne]
        keep = _proper_name_prefix_len(valor)
        if keep == 0 or keep != len(valor):
            # debe ser íntegramente nombre propio (salvo partículas internas)
            if _proper_name_prefix_len(valor) == 0:
                continue
        if _es_palabra_corte(valor.split()[0]) or not _looks_like_proper_name(valor):
            continue
        out.append({"inicio": os_, "fin": oe, "valor": texto[os_:oe]})
    # sin duplicados por valor
    vistos, res = set(), []
    for c in out:
        k = normalizar_valor(c["valor"])
        if k in vistos:
            continue
        vistos.add(k)
        res.append(c)
    return res
