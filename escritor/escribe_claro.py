"""LexO Escribe Claro: analizador determinista de estilo, claridad y estructura argumentativa.

Portado de LexO-ClearWriter (ScribeClaro / guías de lenguaje claro del PJUD y
Academia Judicial de Chile) a biblioteca estándar de Python (sin spaCy ni
servidores externos). Corre 100 % local y sin red.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

CONTEXTOS_VALIDOS = ("general", "escrito", "demanda", "sentencia")


@dataclass
class ConfigEstilo:
    max_words_per_sentence: int = 25
    max_passive_ratio: float = 0.10
    weight_readability: float = 0.35
    weight_passive: float = 0.20
    weight_nominalizations: float = 0.20
    weight_archaisms: float = 0.15
    weight_judicial_alignment: float = 0.10


_OVERRIDES_CONTEXTO: dict[str, dict] = {
    "sentencia": {
        "max_words_per_sentence": 20,
        "max_passive_ratio": 0.08,
        "weight_readability": 0.30,
        "weight_passive": 0.20,
        "weight_nominalizations": 0.20,
        "weight_archaisms": 0.15,
        "weight_judicial_alignment": 0.15,
    },
    "demanda": {
        "max_words_per_sentence": 25,
        "max_passive_ratio": 0.10,
        "weight_readability": 0.35,
        "weight_passive": 0.20,
        "weight_nominalizations": 0.20,
        "weight_archaisms": 0.15,
        "weight_judicial_alignment": 0.10,
    },
    "escrito": {
        "max_words_per_sentence": 30,
        "max_passive_ratio": 0.15,
        "weight_readability": 0.35,
        "weight_passive": 0.15,
        "weight_nominalizations": 0.20,
        "weight_archaisms": 0.15,
        "weight_judicial_alignment": 0.15,
    },
    "general": {},
}


def config_para_contexto(contexto: str) -> ConfigEstilo:
    cfg = ConfigEstilo()
    for k, v in _OVERRIDES_CONTEXTO.get(str(contexto or "general").lower(), {}).items():
        setattr(cfg, k, v)
    return cfg


# ---------------------------------------------------------------------------
# Diccionario de nominalizaciones (sustantivo verbal -> verbo activo sugerido)
# ---------------------------------------------------------------------------

NOMINALIZATION_MAP: dict[str, str] = {
    "realización": "realizar",
    "notificación": "notificar",
    "presentación": "presentar",
    "resolución": "resolver",
    "determinación": "determinar",
    "aplicación": "aplicar",
    "modificación": "modificar",
    "aprobación": "aprobar",
    "declaración": "declarar",
    "investigación": "investigar",
    "verificación": "verificar",
    "acreditación": "acreditar",
    "interposición": "interponer",
    "tramitación": "tramitar",
    "fundamentación": "fundamentar",
    "argumentación": "argumentar",
    "valoración": "valorar",
    "ponderación": "ponderar",
    "revocación": "revocar",
    "ratificación": "ratificar",
    "liquidación": "liquidar",
    "compensación": "compensar",
    "indemnización": "indemnizar",
    "inhabilitación": "inhabilitar",
    "tipificación": "tipificar",
    "calificación": "calificar",
    "especificación": "especificar",
    "comunicación": "comunicar",
    "constitución": "constituir",
    "ejecución": "ejecutar",
    "celebración": "celebrar",
    "suscripción": "suscribir",
    "emisión": "emitir",
    "admisión": "admitir",
    "exclusión": "excluir",
    "inclusión": "incluir",
    "decisión": "decidir",
    "revisión": "revisar",
    "conclusión": "concluir",
    "remisión": "remitir",
    "cumplimiento": "cumplir",
    "incumplimiento": "incumplir",
    "conocimiento": "conocer",
    "reconocimiento": "reconocer",
    "establecimiento": "establecer",
    "procedimiento": "proceder",
    "otorgamiento": "otorgar",
    "requerimiento": "requerir",
    "pronunciamiento": "pronunciar",
    "sometimiento": "someter",
    "desistimiento": "desistir",
    "planteamiento": "plantear",
    "observancia": "observar",
    "procedencia": "proceder",
    "improcedencia": "no proceder",
    "pertinencia": "pertenecer",
    "comparecencia": "comparecer",
    "permanencia": "permanecer",
    "evaluación": "evaluar",
    "fiscalización": "fiscalizar",
    "autorización": "autorizar",
    "habilitación": "habilitar",
    "imposición": "imponer",
    "mitigación": "mitigar",
    "compensación ambiental": "compensar ambientalmente",
    "restauración": "restaurar",
    "remediación": "remediar",
    "sanción": "sancionar",
    "formulación": "formular",
    "adecuación": "adecuar",
    "incorporación": "incorporar",
    "ejecución de medidas": "ejecutar las medidas",
    "implementación": "implementar",
    "dictación": "dictar",
    "paralización": "paralizar",
    "acumulación": "acumular",
    "fraccionamiento": "fraccionar",
    "absolución": "absolver",
    "constatación": "constatar",
    "inspección": "inspeccionar",
    "afectación": "afectar",
    "suspensión": "suspender",
    "omisión": "omitir",
    "anulación": "anular",
    "intervención": "intervenir",
    "delimitación": "delimitar",
    "rectificación": "rectificar",
    "individualización": "individualizar",
    "coordinación": "coordinar",
    "subdivisión": "subdividir",
    "condenación": "condenar",
    "colaboración": "colaborar",
    "desestimación": "desestimar",
    "reclamación": "reclamar",
    "participación": "participar",
    "actuación": "actuar",
    "regularización": "regularizar",
    "impugnación": "impugnar",
    "contaminación": "contaminar",
    "exigencia": "exigir",
    "vulneración": "vulnerar",
    "infracción": "infringir",
}

_VERBOSE_NOM_RE = re.compile(
    r"\b(?:la|el|las|los|una|un)\s+("
    + "|".join(re.escape(n) for n in sorted(NOMINALIZATION_MAP, key=len, reverse=True))
    + r")\s+(?:de|del)\b",
    re.IGNORECASE,
)


# ---------------------------------------------------------------------------
# Diccionario de arcaísmos judiciales y fórmulas burocráticas
# ---------------------------------------------------------------------------

ENVIRONMENTAL_WHITELIST: frozenset[str] = frozenset({
    "RCA", "SEIA", "SMA", "CONAF", "CONAMA", "SEA", "MMA", "SAG", "SERNAPESCA",
    "DGA", "SERNAGEOMIN", "EIA", "Plan de Manejo", "Declaración de Impacto Ambiental",
    "DIA", "Estudio de Impacto Ambiental", "Resolución de Calificación Ambiental",
    "otrosí", "RSEIA", "COEVA", "PAC", "MUT", "PAS", "UTA", "PJUD", "DFZ",
    "IFA", "ICE", "ICSARA", "LOSMA", "LOCM", "CPR", "LGUC", "SHOA", "PdC",
    "ETFA", "CITSU", "SEREMI", "CONADI", "CGR", "ONEMI", "MOP",
})

ARCHAISM_MAP: dict[str, str] = {
    "fojas": "página(s) del expediente",
    "foja": "página del expediente",
    "autos": "expediente",
    "auto de prueba": "resolución que recibe la causa a prueba",
    "ha lugar": "se acoge",
    "no ha lugar": "se rechaza",
    "provéase": "resuélvase",
    "decretar autos en relación": "ordenar la vista de la causa",
    "autos en relación": "vista de la causa",
    "téngase presente": "téngase en consideración",
    "póngase en conocimiento": "comuníquese",
    "líbrese oficio": "envíese comunicación oficial",
    "ofíciese": "comuníquese por oficio",
    "despáchese": "envíese",
    "notifíquese por el estado diario": "notifíquese por el medio correspondiente",
    "cítese a las partes a oír sentencia": "fíjese fecha para sentencia",
    "in limine": "de plano",
    "a quo": "de primera instancia",
    "ad quem": "de segunda instancia",
    "litis contestatio": "contestación de la demanda",
    "prima facie": "a primera vista",
    "ultra petita": "más allá de lo pedido",
    "onus probandi": "carga de la prueba",
    "res judicata": "cosa juzgada",
    "stare decisis": "precedente vinculante",
    "erga omnes": "respecto de todos",
    "habida cuenta": "considerando",
    "en mérito de lo expuesto": "por lo expuesto",
    "en virtud de lo anterior": "por lo anterior",
    "en razón de lo expuesto": "por lo señalado",
    "atendido lo anterior": "considerando lo anterior",
    "evacuado el traslado": "respondido el traslado",
    "trabada la litis": "trabada la controversia",
    "venido en grado de apelación": "en apelación",
    "toda vez que": "porque",
    "en lo que dice relación con": "sobre",
    "a mayor abundamiento de lo expuesto": "además",
    "a mayor abundamiento": "además",
    "al efecto": "para ello",
    "en lo sucesivo": "en adelante",
    "en ese orden de ideas": "en ese sentido",
    "sin perjuicio de lo anterior": "además",
    "ut supra": "como se señaló antes",
    "supra": "antes mencionado",
    "precedentemente": "anteriormente",
    "guarismos": "números",
    "en ejercicio de su representación": "en representación de",
    "consta en el expediente administrativo acompañado en autos": "consta en el expediente",
    "acompañado en autos": "adjunto en el expediente",
    "en la especie": "en este caso",
    "en el caso de marras": "en este caso",
    "en comento": "en cuestión",
    "a su turno": "a su vez",
    "por lo demás": "además",
    "en atención a lo expuesto": "considerando lo expuesto",
    "en atención a": "considerando",
    "atendido que": "dado que",
    "a propósito de": "sobre",
    "en lo que interesa": "en lo relevante",
    "cabe consignar": "conviene señalar",
    "cabe hacer presente": "conviene señalar",
    "resulta menester": "es necesario",
    "conforme consta en": "según consta en",
    "de conformidad con lo dispuesto en": "según lo dispuesto en",
    "en el marco de lo dispuesto en": "según lo dispuesto en",
    "al tenor de": "según el texto de",
    "al alero de": "bajo el amparo de",
    "con anterioridad a": "antes de",
    "con posterioridad a": "después de",
    "para los efectos del artículo": "según el artículo",
    "para los efectos de": "para",
    "a los efectos de": "para",
    "así las cosas": "por lo tanto",
    "se colige": "se concluye",
    "es dable": "es posible",
    "es menester": "es necesario",
    "es preciso señalar": "conviene señalar",
    "en orden a": "con el fin de",
    "por ende": "por lo tanto",
    "a este respecto": "al respecto",
    "el referido proyecto": "el proyecto",
    "la referida resolución": "la resolución",
    "el referido instrumento": "el instrumento",
    "el mencionado proyecto": "el proyecto",
    "la mencionada normativa": "la normativa",
    "en razón de lo normado": "según la norma",
    "conforme lo estatuido": "según lo dispuesto",
    "en conformidad a lo normado": "según lo normado",
    "en razón de lo preceptuado": "según lo preceptuado",
    "de acuerdo a lo preceptuado": "según lo preceptuado",
    "de conformidad con lo estatuido": "conforme a lo establecido",
    "en razón de lo establecido en": "según lo establecido en",
    "ha sido objeto de evaluación": "fue evaluado",
    "fue objeto de calificación": "fue calificado",
    "es objeto de revisión": "se revisa",
    "fue objeto de observaciones": "recibió observaciones",
    "el órgano de la Administración del Estado": "el organismo público",
    "los órganos de la Administración del Estado": "los organismos públicos",
    "la dictación de": "la emisión de",
    "conforme al mérito del proceso": "según los antecedentes",
    "en el mérito del proceso": "según los antecedentes",
    "en base a": "con base en",
    "de acuerdo a lo indicado": "según lo indicado",
    "en virtud de lo establecido en": "según lo establecido en",
    "en aras de": "para",
    "en lo que respecta a": "sobre",
    "en lo que se refiere a": "sobre",
    "en relación con lo anterior": "sobre lo anterior",
    "con el mérito de los antecedentes expuestos": "según los antecedentes",
    "con el mérito de los antecedentes": "según los antecedentes",
    "sin perjuicio de lo cual": "sin embargo",
    "es del caso señalar": "conviene señalar",
    "conforme a lo preceptuado en": "según lo preceptuado en",
    "en virtud de los antecedentes analizados": "según los antecedentes analizados",
    "haciendo presente que": "indicando que",
    "haciéndose presente que": "indicando que",
}

_ARCHAISM_LOOKUP = {k.lower(): v for k, v in ARCHAISM_MAP.items()}
_ARCHAISM_PATTERN = re.compile(
    r"\b(" + "|".join(re.escape(t) for t in sorted(ARCHAISM_MAP, key=len, reverse=True)) + r")\b",
    re.IGNORECASE,
)

_NORM_CITATION_ERRORS: list[tuple[re.Pattern[str], str]] = [
    (
        re.compile(r"\bLey\s+(\d{4,6})\b(?!\s*N)", re.IGNORECASE),
        "Cita de ley sin 'N°' o punto de millar: usar 'Ley N°{n}' (ej. Ley N°19.300)",
    ),
    (
        re.compile(r"\barticulo\b", re.IGNORECASE),
        "Falta tilde en 'artículo'",
    ),
    (
        re.compile(r"\bDS\s+N°\s*\d+\b(?!\s*/\d{4})", re.IGNORECASE),
        "Decreto Supremo citado sin año: usar formato 'DS N°X/AAAA' (ej. DS N°40/2012)",
    ),
]


# ---------------------------------------------------------------------------
# Voz pasiva perifrástica en español (determinista por morfología verbal)
# ---------------------------------------------------------------------------

_PASSIVE_RE = re.compile(
    r"\b(?:es|son|era|eran|fue|fueron|será|serán|sería|serían|sea|sean|"
    r"fuera|fueran|fuese|fuesen|sido|siendo|está|están|estuvo|estuvieron|"
    r"estaba|estaban)\s+"
    r"(?:(?:no|ya|también|asimismo|debidamente|oportunamente|legalmente|"
    r"previamente|efectivamente|\w+mente)\s+){0,2}"
    r"(?:[a-záéíóúñ]{3,}(?:ado|ada|ados|adas|ido|ida|idos|idas)|"
    r"resuelt[oa]s?|escrit[oa]s?|dich[oa]s?|hech[oa]s?|vist[oa]s?|"
    r"puest[oa]s?|dispuest[oa]s?|impuest[oa]s?|interpuest[oa]s?|"
    r"expuest[oa]s?|propuest[oa]s?|compuest[oa]s?|abiert[oa]s?|"
    r"cubiert[oa]s?|descubiert[oa]s?|suscrit[oa]s?|prescrit[oa]s?|"
    r"descrit[oa]s?|inscrit[oa]s?|proveíd[oa]s?|satisfech[oa]s?)\b",
    re.IGNORECASE,
)


# ---------------------------------------------------------------------------
# Alineación judicial ("copiabilidad")
# ---------------------------------------------------------------------------

_FIRST_PERSON_RE = re.compile(
    r"\b(yo\b|nosotros\b|mi\s+parte\b|mi\s+contrato\b|mi\s+representad[oa]\b|"
    r"nuestra\s+parte\b|estimamos\b|consideramos\b|creemos\b|sostenemos\b|"
    r"pedimos\b|solicitamos(?!\s+a\s+vuestra|\s+a\s+us)|rogamos\b|digo\b)",
    re.IGNORECASE,
)

_EMOTIONAL_RE = re.compile(
    r"\b(injusto|injusta|aberrante|absurdo|absurda|escandaloso|escandalosa|"
    r"inaceptable|incomprensible|lamentable|vergonzoso|vergonzosa|"
    r"dramático|dramática|terrible|desproporcionado|desproporcionada)\b",
    re.IGNORECASE,
)

_NORM_ANCHOR_RE = re.compile(
    r"\b(art[íi]culo|art\.|arts\.|"
    r"ley\s+n[°o]?\s*\d|código|decreto|d\.l\.|d\.s\.|d\.f\.l\.|reglamento|"
    r"inciso|literal|letra|n[°o]\s*\d|numeral\s+\d)",
    re.IGNORECASE,
)

_FACT_MARKER_RE = re.compile(
    r"\b(consta\s+que|se\s+acredit[oó]|se\s+prob[oó]|"
    r"ha\s+quedado\s+establecido|los\s+antecedentes\s+demuestran|"
    r"de\s+autos\s+consta|de\s+los\s+antecedentes\s+consta|"
    r"se\s+encuentra\s+acreditado|en\s+la\s+especie|"
    r"de\s+los\s+antecedentes\s+se\s+desprende|"
    r"se\s+ha\s+acreditado\s+en\s+autos|"
    r"consta\s+de\s+autos\s+que|"
    r"se\s+advierte\s+que|se\s+aprecia\s+que|se\s+colige\s+que|"
    r"a\s+la\s+luz\s+de\s+los\s+antecedentes|se\s+desprende\s+de\s+autos)\b",
    re.IGNORECASE,
)

_CONCLUSION_MARKER_RE = re.compile(
    r"\b(por\s+tanto|en\s+consecuencia|se\s+resuelve|se\s+acoge|"
    r"se\s+rechaza|procede\s+acoger|procede\s+rechazar|"
    r"en\s+m[eé]rito\s+de\s+lo\s+expuesto|por\s+estas\s+consideraciones|"
    r"por\s+estas\s+razones|en\s+m[eé]rito\s+de\s+los\s+antecedentes|"
    r"por\s+lo\s+expuesto\s+y\s+considerando|"
    r"as[ií]\s+las\s+cosas|cabe\s+concluir|fuerza\s+concluir|"
    r"resulta\s+forzoso\s+concluir|se\s+impone\s+concluir)\b",
    re.IGNORECASE,
)


# ---------------------------------------------------------------------------
# Segmentación de oraciones (preservando abreviaturas jurídicas chilenas)
# ---------------------------------------------------------------------------

_ABREV_RE = re.compile(
    r"\b(art|arts|inc|núm|num|sr|sra|srta|dr|dra|abog|proc|excmo|iltmo|iltma|"
    r"s\.j\.l|j\.l|c\.a|c\.s|d\.l|d\.s|d\.f\.l|pág|págs|fs|foj|etc|ej|v\.gr|"
    r"n°|no|nro|vs|atte|ud|uds|us)\.",
    re.IGNORECASE,
)
_WORD_RE = re.compile(r"[A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9]+(?:[.-][A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9]+)*")


def segmentar_oraciones(texto: str) -> list[dict]:
    """Divide el texto en oraciones con offsets (start, end, text, word_count)."""
    if not texto or not texto.strip():
        return []
    protegido = _ABREV_RE.sub(lambda m: m.group(0)[:-1] + "\u0000", texto)
    oraciones: list[dict] = []
    inicio = 0
    # Corte por salto de línea o signo de puntuación final (. ! ? ;) seguido de espacio/fin
    for m in re.finditer(r"(?:\n+|(?<=[.!?;])\s+)", protegido):
        segmento = texto[inicio:m.start()].strip()
        if segmento:
            offset_real = texto.find(segmento, inicio)
            palabras = _WORD_RE.findall(segmento)
            if palabras:
                oraciones.append({
                    "text": segmento,
                    "start": offset_real if offset_real >= 0 else inicio,
                    "end": (offset_real + len(segmento)) if offset_real >= 0 else m.start(),
                    "word_count": len(palabras),
                })
        inicio = m.end()
    cola = texto[inicio:].strip()
    if cola:
        offset_real = texto.find(cola, inicio)
        palabras = _WORD_RE.findall(cola)
        if palabras:
            oraciones.append({
                "text": cola,
                "start": offset_real if offset_real >= 0 else inicio,
                "end": (offset_real + len(cola)) if offset_real >= 0 else len(texto),
                "word_count": len(palabras),
            })
    return oraciones


def detectar_arcaismos(texto: str) -> list[dict]:
    """Detecta arcaísmos judiciales y fórmulas burocráticas con offsets exactos."""
    hits: list[dict] = []
    vistos: set[int] = set()
    for m in _ARCHAISM_PATTERN.finditer(texto):
        pos = m.start()
        if pos in vistos:
            continue
        vistos.add(pos)
        encontrado = m.group(0)
        if encontrado in ENVIRONMENTAL_WHITELIST or encontrado.upper() in ENVIRONMENTAL_WHITELIST:
            continue
        reemplazo = _ARCHAISM_LOOKUP.get(encontrado.lower(), "")
        if reemplazo:
            hits.append({
                "term": encontrado,
                "replacement": reemplazo,
                "position": pos,
                "end": m.end(),
            })
    hits.sort(key=lambda h: h["position"])
    return hits


def detectar_nominalizaciones_oracion(texto_oracion: str, idx: int) -> list[dict]:
    hits: list[dict] = []
    vistos: set[str] = set()
    for m in _VERBOSE_NOM_RE.finditer(texto_oracion):
        sust = m.group(1).lower()
        if sust in vistos:
            continue
        vistos.add(sust)
        verbo = NOMINALIZATION_MAP.get(sust)
        if verbo:
            hits.append({
                "noun_phrase": m.group(0).strip(),
                "suggested_verb": verbo,
                "sentence_index": idx,
            })
    for m in _WORD_RE.finditer(texto_oracion):
        palabra = m.group(0).lower()
        if palabra in NOMINALIZATION_MAP and palabra not in vistos:
            vistos.add(palabra)
            hits.append({
                "noun_phrase": m.group(0),
                "suggested_verb": NOMINALIZATION_MAP[palabra],
                "sentence_index": idx,
            })
    return hits


def calcular_alineacion_judicial(oraciones: list[dict]) -> tuple[float, list[str]]:
    if not oraciones:
        return 100.0, []
    total = len(oraciones)
    penalizacion = 0.0
    bonificacion = 0.0
    avisos: list[str] = []

    primera_persona = 0
    emocional = 0
    sin_ancla = 0
    marcadores_hecho = 0
    marcadores_conclusion = 0

    for s in oraciones:
        t = s["text"]
        if _FIRST_PERSON_RE.search(t):
            primera_persona += 1
        if _EMOTIONAL_RE.search(t):
            emocional += 1
        if not _NORM_ANCHOR_RE.search(t):
            sin_ancla += 1
        if _FACT_MARKER_RE.search(t):
            marcadores_hecho += 1
        if _CONCLUSION_MARKER_RE.search(t):
            marcadores_conclusion += 1

    if primera_persona:
        penalizacion += (primera_persona / total) * 30.0
        avisos.append(
            f"Primera persona detectada en {primera_persona} oración(es): "
            "el tribunal incorpora mejor pasajes redactados en tercera persona impersonal."
        )
    if emocional:
        penalizacion += (emocional / total) * 25.0
        avisos.append(
            f"Lenguaje emocional o subjetivo en {emocional} oración(es): "
            "prefiera calificativos estrictamente normativos o probatorios."
        )
    if total > 3 and (sin_ancla / total) > 0.7:
        penalizacion += 15.0
        avisos.append(
            f"{sin_ancla} de {total} oraciones carecen de ancla normativa "
            "(artículo, ley, código o decreto)."
        )
    if marcadores_hecho:
        bonificacion += min(10.0, marcadores_hecho * 3.0)
    if marcadores_conclusion:
        bonificacion += min(5.0, marcadores_conclusion * 2.0)

    puntaje = max(0.0, min(100.0, 100.0 - penalizacion + bonificacion))
    return round(puntaje, 1), avisos


def detectar_errores_cita_formato(texto: str) -> list[str]:
    avisos: list[str] = []
    for patron, msg in _NORM_CITATION_ERRORS:
        m = patron.search(texto)
        if m:
            avisos.append(f"{msg} (encontrado: «{m.group(0)}»)")
    return avisos


def analizar_estilo(
    texto: str,
    *,
    contexto: str = "escrito",
    detallado: bool = True,
) -> dict:
    """Ejecuta el análisis completo de LexO Escribe Claro sobre ``texto``."""
    ctx = str(contexto or "escrito").lower()
    if ctx not in CONTEXTOS_VALIDOS:
        ctx = "escrito"
    cfg = config_para_contexto(ctx)
    oraciones_base = segmentar_oraciones(texto)
    arcaismos = detectar_arcaismos(texto)
    puntaje_judicial, avisos_alineacion = calcular_alineacion_judicial(oraciones_base)
    avisos_citas = detectar_errores_cita_formato(texto)

    oraciones: list[dict] = []
    for idx, s in enumerate(oraciones_base):
        es_pasiva = bool(_PASSIVE_RE.search(s["text"]))
        noms = detectar_nominalizaciones_oracion(s["text"], idx)
        arcs_oracion = [
            a for a in arcaismos
            if s["start"] <= a["position"] < s["end"]
        ]
        oraciones.append({
            "text": s["text"],
            "word_count": s["word_count"],
            "exceeds_limit": s["word_count"] > cfg.max_words_per_sentence,
            "is_passive": es_pasiva,
            "nominalizations": noms,
            "archaisms": arcs_oracion,
        })

    total = len(oraciones)
    total_palabras = sum(s["word_count"] for s in oraciones)
    promedio = round(total_palabras / max(total, 1), 1)
    excedidas = sum(1 for s in oraciones if s["exceeds_limit"])
    pasivas = sum(1 for s in oraciones if s["is_passive"])
    ratio_pasiva = round(pasivas / max(total, 1), 3)
    total_noms = sum(len(s["nominalizations"]) for s in oraciones)
    total_arcs = len(arcaismos)

    stats = {
        "total_sentences": total,
        "total_words": total_palabras,
        "avg_words_per_sentence": promedio,
        "max_words_per_sentence": cfg.max_words_per_sentence,
        "sentences_exceeding_limit": excedidas,
        "passive_ratio": ratio_pasiva,
        "nominalization_count": total_noms,
        "archaism_count": total_arcs,
        "judicial_alignment_score": puntaje_judicial,
    }

    # Sub-puntajes (0–100)
    sc_legib = 100.0 * (1.0 - excedidas / total) if total > 0 else 100.0
    if ratio_pasiva <= cfg.max_passive_ratio:
        sc_pasiva = 100.0
    else:
        sc_pasiva = max(0.0, 100.0 - (ratio_pasiva - cfg.max_passive_ratio) * 500.0)
    sc_nom = max(0.0, 100.0 - (total_noms / max(total, 1)) * 30.0)
    sc_arc = max(0.0, 100.0 - total_arcs * 15.0)
    score = round(
        cfg.weight_readability * sc_legib
        + cfg.weight_passive * sc_pasiva
        + cfg.weight_nominalizations * sc_nom
        + cfg.weight_archaisms * sc_arc
        + cfg.weight_judicial_alignment * puntaje_judicial,
        1,
    )

    sugerencias: list[dict] = []
    if excedidas > 0:
        for s in [x for x in oraciones if x["exceeds_limit"]][:4]:
            extracto = s["text"][:85] + "…" if len(s["text"]) > 85 else s["text"]
            sugerencias.append({
                "category": "legibilidad",
                "severity": "warning",
                "message": (
                    f"Oración con {s['word_count']} palabras "
                    f"(límite para {ctx}: {cfg.max_words_per_sentence}). "
                    f"Considere dividirla: «{extracto}»"
                ),
            })

    if ratio_pasiva > cfg.max_passive_ratio:
        pct = round(ratio_pasiva * 100, 1)
        sugerencias.append({
            "category": "voz_pasiva",
            "severity": "warning",
            "message": (
                f"El {pct}% de las oraciones usa voz pasiva "
                f"(máximo recomendado: {cfg.max_passive_ratio * 100:.0f}%). "
                "Prefiera sujeto activo + verbo directo."
            ),
        })

    for s in oraciones:
        for nom in s["nominalizations"]:
            sugerencias.append({
                "category": "nominalizacion",
                "severity": "info",
                "term": nom["noun_phrase"],
                "replacement": nom["suggested_verb"],
                "message": (
                    f"Nominalización detectada: «{nom['noun_phrase']}» → "
                    f"considere el verbo activo «{nom['suggested_verb']}»."
                ),
            })

    for arc in arcaismos:
        sugerencias.append({
            "category": "arcaismo",
            "severity": "info",
            "term": arc["term"],
            "replacement": arc["replacement"],
            "position": arc["position"],
            "end": arc["end"],
            "message": (
                f"Fórmula arcaica o burocrática: «{arc['term']}» → "
                f"reemplazo claro sugerido: «{arc['replacement']}»."
            ),
        })

    if puntaje_judicial < 70:
        sugerencias.append({
            "category": "alineacion_judicial",
            "severity": "warning",
            "message": (
                f"Alineación judicial baja ({puntaje_judicial}/100). "
                "Revise el uso de primera persona, adjetivos subjetivos y "
                "la presencia de anclas normativas."
            ),
        })

    return {
        "context": ctx,
        "score": score,
        "global_stats": stats,
        "suggestions": sugerencias,
        "archaisms": arcaismos,
        "coherence_warnings": avisos_alineacion + avisos_citas,
        "sentences": oraciones if detallado else None,
    }


# ---------------------------------------------------------------------------
# Extractor de estructura argumentativa (Hecho -> Norma -> Prueba -> Conclusión)
# ---------------------------------------------------------------------------

_MARCADORES_ARG: dict[str, re.Pattern[str]] = {
    "hecho": re.compile(
        r"\b(consta\s+(?:que|en|de)|se\s+acredit[oó]|se\s+prob[oó]|ha\s+quedado\s+establecido|"
        r"los\s+antecedentes\s+demuestran|de\s+autos\s+consta|se\s+encuentra\s+acreditado|"
        r"resulta\s+establecido|está\s+acreditado|quedó\s+demostrado|"
        r"de\s+los\s+documentos\s+acompañados|con\s+fecha\s+\d|el\s+día\s+\d|"
        r"puso\s+término|trabajador[oa]?|demandad[oa]|hechos?)\b",
        re.IGNORECASE,
    ),
    "norma": re.compile(
        r"\b(art[íi]culo|art\.\s*\d|conforme\s+al|en\s+virtud\s+del|"
        r"según\s+el\s+art|según\s+lo\s+dispuesto|ley\s+n[°o]?\s*\d|"
        r"decreto\s+supremo|d\.l\.|d\.s\.|d\.f\.l\.|reglamento|"
        r"código\s+(?:civil|penal|del\s+trabajo|de\s+procedimiento|orgánico|de\s+comercio|tributario)|"
        r"inciso|literal\s+[a-z]|letra\s+[a-z]\)|numeral\s+\d|dispone\s+que)\b",
        re.IGNORECASE,
    ),
    "prueba": re.compile(
        r"\b(informe\s+pericial|la\s+prueba\s+documental|el\s+testigo|"
        r"declaración\s+de|el\s+documento\s+acompañado|el\s+certificado|"
        r"el\s+acta|la\s+escritura|de\s+acuerdo\s+a\s+la\s+prueba|"
        r"según\s+la\s+prueba|el\s+perito|la\s+pericia|el\s+informe\s+técnico|"
        r"la\s+documentación|los\s+antecedentes\s+adjuntos|copia\s+a\s+la\s+inspección|"
        r"el\s+contrato|la\s+factura|el\s+correo|finiquito|carta\s+de\s+aviso)\b",
        re.IGNORECASE,
    ),
    "conclusion": re.compile(
        r"\b(por\s+tanto|en\s+consecuencia|se\s+resuelve|se\s+acoge|"
        r"se\s+rechaza|procede\s+acoger|procede\s+rechazar|"
        r"en\s+mérito\s+de\s+lo\s+expuesto|por\s+estas\s+consideraciones|"
        r"fallo|resuelvo|resuelve|se\s+declara|se\s+condena|"
        r"por\s+lo\s+expuesto|por\s+lo\s+anterior|deberá\s+pagar|"
        r"obliga\s+al|ha\s+lugar|no\s+ha\s+lugar|solicito\s+a\s+us)\b",
        re.IGNORECASE,
    ),
}

_ORDEN_DESEMPATE = ("hecho", "norma", "prueba", "conclusion")

_ARISTAS_PERMITIDAS: dict[tuple[str, str], str] = {
    ("hecho", "norma"): "fundamenta",
    ("norma", "prueba"): "verifica",
    ("prueba", "conclusion"): "sostiene",
    ("hecho", "conclusion"): "implica",
    ("norma", "conclusion"): "apoya",
    ("hecho", "prueba"): "apoya",
}


def extraer_grafo_argumentos(texto: str) -> dict:
    """Extrae el grafo de estructura argumentativa (Hecho/Norma/Prueba/Conclusión)."""
    parrafos = [p.strip() for p in re.split(r"\n\s*\n|\n", texto or "") if p.strip()]
    if len(parrafos) <= 1 and texto and texto.strip():
        parrafos = [s["text"] for s in segmentar_oraciones(texto)]

    nodos: list[dict] = []
    avisos: list[dict] = []

    for idx, par in enumerate(parrafos):
        mejor_tipo = "orphan"
        mejor_puntaje = 0
        mejores_marcadores: list[str] = []

        for t in _ORDEN_DESEMPATE:
            encontrados = [m.group(0).strip() for m in _MARCADORES_ARG[t].finditer(par)]
            if len(encontrados) > mejor_puntaje:
                mejor_puntaje = len(encontrados)
                mejor_tipo = t
                mejores_marcadores = encontrados

        confianza = round(min(1.0, mejor_puntaje / 3.0), 2) if mejor_puntaje > 0 else 0.0
        nodos.append({
            "id": f"{mejor_tipo}_{idx}",
            "node_type": mejor_tipo,
            "text": par[:400],
            "paragraph_index": idx,
            "confidence": confianza,
            "markers_found": mejores_marcadores[:5],
        })

    aristas: list[dict] = []
    existentes: set[tuple[str, str]] = set()
    for i in range(len(nodos) - 1):
        src, tgt = nodos[i], nodos[i + 1]
        rel = _ARISTAS_PERMITIDAS.get((src["node_type"], tgt["node_type"]))
        if rel:
            aristas.append({
                "source_id": src["id"],
                "target_id": tgt["id"],
                "relation_type": rel,
            })
            existentes.add((src["id"], tgt["id"]))

    nodos_conc = [n for n in nodos if n["node_type"] == "conclusion"]
    nodos_prueba = [n for n in nodos if n["node_type"] == "prueba"]
    nodos_hecho = [n for n in nodos if n["node_type"] == "hecho"]
    nodos_norma = [n for n in nodos if n["node_type"] == "norma"]

    # Solo antecedentes cercanos: el producto cartesiano inventaba millones de enlaces.
    for c in nodos_conc:
        indice = c['paragraph_index']
        for apoyo in nodos[max(0, indice - 8):indice]:
            relacion = {'prueba': 'sostiene', 'hecho': 'implica'}.get(apoyo['node_type'])
            par = (apoyo['id'], c['id'])
            if relacion and par not in existentes:
                aristas.append({'source_id': apoyo['id'], 'target_id': c['id'],
                                'relation_type': relacion})
                existentes.add(par)
    posibles = len(nodos_conc) * (len(nodos_prueba) + len(nodos_hecho))
    conservadas = sum(a['relation_type'] in ('sostiene', 'implica') for a in aristas)
    omitidas = max(0, posibles - conservadas)
    if omitidas:
        avisos.append({'severity': 'info', 'paragraph_index': None,
                       'message': f'Grafo acotado a antecedentes de los 8 párrafos anteriores; '
                                  f'{omitidas} relaciones lejanas o posteriores omitidas.'})

    for n in [x for x in nodos if x["node_type"] == "orphan"]:
        extracto = n["text"][:80] + "…" if len(n["text"]) > 80 else n["text"]
        avisos.append({
            "severity": "info",
            "paragraph_index": n["paragraph_index"],
            "message": f"Párrafo {n['paragraph_index'] + 1} sin marcador argumentativo explícito: «{extracto}»",
        })

    if nodos and not nodos_conc:
        avisos.append({
            "severity": "warning",
            "paragraph_index": None,
            "message": "No se detectó petición o conclusión explícita (ej. «por tanto», «procede acoger»).",
        })
    if nodos and not nodos_hecho:
        avisos.append({
            "severity": "warning",
            "paragraph_index": None,
            "message": "No se detectaron marcadores de hecho acreditado en el escrito.",
        })

    con_tipo = sum(1 for n in nodos if n["node_type"] != "orphan")
    cobertura = round(con_tipo / max(len(nodos), 1), 3) if nodos else 0.0
    if nodos and cobertura < 0.6:
        avisos.append({
            "severity": "warning",
            "paragraph_index": None,
            "message": f"Cobertura argumentativa de {cobertura:.0%}: más del 40% de los bloques no declara función (hecho, norma, prueba o conclusión).",
        })

    tipos_presentes = {n["node_type"] for n in nodos}
    cadena_completa = {"hecho", "norma", "conclusion"}.issubset(tipos_presentes) and bool(aristas)

    return {
        "nodes": nodos,
        "edges": aristas,
        "truncado": bool(omitidas),
        "relaciones_omitidas": omitidas,
        "coverage_ratio": cobertura,
        "coherence_warnings": avisos,
        "has_complete_chain": cadena_completa,
        "counts": {
            "hecho": len(nodos_hecho),
            "norma": len(nodos_norma),
            "prueba": len(nodos_prueba),
            "conclusion": len(nodos_conc),
            "orphan": len(nodos) - con_tipo,
        },
    }
