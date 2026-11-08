"""Patrones de detección de datos personales (port con procedencia).

Procedencia (ver VENDORED.json):
- dpp-ai-compliance-lab `patterns.py` @0d1e386 (MIT): registro de 24 patrones
  con severidad; aquí reorganizado en paquetes ``generico`` y ``cl``.
- graph-legal-ir `privacy/pii.py` (working tree): borde izquierdo del RUT
  tolerante a OCR, patrones de nombre por contexto y palabras estructurales.
- lexo-case-writer `piiMask.ts` @7c13a89 (MIT): validación módulo 11 del DV.

Cada patrón: ``regla`` (id estable), ``tipo`` (tipo canónico de salida),
``categoria`` (identificador_directo/persona/ubicacion/sensible/ancla_causa/
metadata), ``severidad`` (critical/high/medium/low).
"""

from __future__ import annotations

import re
from dataclasses import dataclass


@dataclass(frozen=True)
class Patron:
    regla: str
    tipo: str
    categoria: str
    severidad: str
    regex: re.Pattern
    grupo: int = 0  # grupo de captura que es la entidad (0 = todo el match)


# ---------------------------------------------------------------------------
# Paquete genérico
# ---------------------------------------------------------------------------

_GENERICO = [
    Patron("email", "email", "identificador_directo", "critical",
           re.compile(r"(?<!\w)[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}(?!\w)")),
    # Teléfono internacional E.164 conservador: exige '+' y 9-15 dígitos con
    # separadores razonables; sin '+' no se afirma nada.
    Patron("telefono_intl", "phone_intl", "identificador_directo", "critical",
           re.compile(r"(?<![\w.])\+\d{1,3}[\s.\-]?\(?\d{2,4}\)?[\s.\-]?\d{3,4}[\s.\-]?\d{3,4}(?!\w)")),
    # Nombre con tratamiento (Sr./Don/Dr.…)
    Patron("nombre_tratamiento", "full_name", "persona", "high",
           re.compile(r"(?:(?:Sr\.?|Sra\.?|Srta\.?|Don|Doña|Dra\.?|Dr\.?)\s+"
                      r"[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+){1,2})")),
    # Nombre por contexto procesal: el contexto queda fuera, la entidad es
    # el grupo 1. Instituciones y palabras estructurales excluidas.
    Patron("nombre_contexto", "full_name", "persona", "high",
           re.compile(
               r"\b(?:"
               r"[Ii]mputad[oa]|[Vv]íctima|[Vv]ictima|[Dd]efensor|[Dd]efensora|"
               r"[Pp]erito|[Tt]estigo|[Ff]iscal|[Ss]ecretario|[Rr]elator|"
               r"[Ee]valuad[oa]|[Rr]eclamante|[Rr]eclamad[oa]|"
               r"[Qq]uerellante|[Qq]uerellad[oa]|"
               r"[Cc]ondenad[oa]|[Aa]cusad[oa]|[Aa]bsuelt[oa]|"
               r"[Cc]ónyuge|[Cc]onyuge|[Dd]etenid[oa]|"
               r"[Ff]irmado|[Ss]uscrito|[Ff]uncionari[oa]|"
               r"[Dd]emandante|[Dd]emandad[oa]|[Rr]ecurrente|[Rr]ecurrid[oa]|"
               r"[Dd]enunciante|[Dd]enunciad[oa]|[Aa]ctor|[Aa]ctora|"
               r"Asistente\s+social|mi\s+[Dd]efendid[oa]|"
               r"presentad[oa]\s+por|"
               r"seguid[oa]\s+(?:en\s+)?contra(?:\s+de)?|"
               r"causa\s+contra|juicio\s+oral\s+contra|"
               r"ministro\s+de\s+fe|"
               r"[Cc]omparece|[Cc]ompareciente|"
               r"[Ss]entencia\s*[:\.]?\s*|[Rr]esoluci[óo]n\s*[:\.]?\s*|"
               r"[Aa]uto\s*[:\.]?\s*|[Dd]ecreto\s*[:\.]?\s*|"
               r"[Oo]ficio\s*[:\.]?\s*|[Cc]ircular\s*[:\.]?\s*"
               r")"
               r"[:\s]*"
               r"(?:(?:por|penal|p[úu]blic[oa]|digitalmente|forense|don|doña)\b[:\s]+){0,3}"
               r"((?!Defensoría|Fiscalía|Policía|Tribunal|Ministerio|Servicio|Corporación"
               r"|Fundación|Laboratorio|Instituto|Hospital|Centro|Registro|Unidad|Comisaría)"
               r"[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:[ \t]+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+){1,3})"
               r"(?!\s+(?:Penal|Pública|Nacional|Regional|de\s+la|de\s+Chile|del\s+))"),
           grupo=1),
    # Dirección con vía explícita + número. El tipo de vía es insensible, pero
    # el nombre de la calle exige mayúscula («calle o camino público» no es
    # dirección); «N° 123» no debe cortar el match.
    Patron("direccion", "address", "ubicacion", "high",
           re.compile(r"(?i:calle|av\.?|avenida|pasaje|psje\.?|pje\.?|camino|villa"
                      r"|poblaci[óo]n|condominio|parcela)\s+"
                      r"[A-ZÁÉÍÓÚÑ0-9][\w\s,.'’°º#-]+?\d{1,5}(?:\s*-?\s*[A-Za-z](?!\w)|(?!\w))")),
    # Dirección «Nombre 123, Ciudad» sin prefijo de vía
    Patron("direccion_ciudad", "address", "ubicacion", "high",
           re.compile(
               r"(?<![A-Za-zÁÉÍÓÚÑáéíóúñ])"
               r"[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:[ ][A-ZÁÉÍÓÚÑ][a-záéíóúñ]+){0,2}"
               r"[ ]\d{1,5}\s*,\s*"
               r"[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:[ ][A-ZÁÉÍÓÚÑ][a-záéíóúñ]+){0,1}")),
    # Código verificable de documento (metadata)
    Patron("codigo_verificable", "codigo_verificable", "metadata", "low",
           re.compile(r"(?i)(?:c[óo]digo\s+de\s+verificaci[óo]n|c[óo]digo\s+verificaci[óo]n"
                      r"|hash\s+de\s+documento)\s*[:\s]*[A-Fa-f0-9]{8,64}")),
]


# ---------------------------------------------------------------------------
# Paquete Chile
# ---------------------------------------------------------------------------

# Borde izquierdo (?<![\d.]) y no (?<!\w): el OCR deja RUN pegados a letras
# («Nº12.345.678-9») que así también se detectan (graph-legal-ir).
_RUT = r"(?<![\d.])(?:\d{1,2}(?:\.\d{3}){2}|\d{7,8})-[\dkK](?!\w)"

_CL = [
    Patron("rut", "rut", "identificador_directo", "critical", re.compile(_RUT)),
    # RUT sin puntos ni guion exigibles solo vía DV (ver detector: el match se
    # valida con módulo 11 antes de emitirse).
    Patron("rut_sin_guion", "rut", "identificador_directo", "critical",
           re.compile(r"(?<!\w)(\d{7,8})\s*([\dkK])(?!\w)"), grupo=0),
    Patron("pasaporte", "pasaporte", "identificador_directo", "critical",
           re.compile(r"(?i)\bpasaporte\s*(?:N[°º]|Nro\.?|No\.?)?\s*[:\s]*"
                      r"([A-Z]{0,2}\d{5,9}|[A-Z0-9]{6,9})\b"), grupo=1),
    Patron("telefono_cl", "phone_cl", "identificador_directo", "critical",
           re.compile(r"(?<!\w)(?:\+56[\s.-]?)?9(?:[\s.-]?\d){8}(?!\w)")),
    Patron("telefono_fijo_cl", "phone_fixed", "identificador_directo", "critical",
           re.compile(r"(?<!\w)(?:\+56[\s.-]?[2-8][\s.-]?(?:\d[\s.-]?){7}\d"
                      r"|[2-8]\s\d{3,4}\s\d{4})(?!\w)")),
    Patron("patente", "patente_cl", "identificador_directo", "high",
           re.compile(r"(?i)\b(?:patente|placa)\s+[A-Z]{2,4}[.-]?\d{2,4}\b")),

    # --- Anclas de causa: RIT/RUC/ROL se CONSERVAN (ancla_causa) ----------
    Patron("rit", "rit", "ancla_causa", "high",
           re.compile(r"(?i)(?:\bRIT|(?<!\w)[Cc]ausa|[Rr]ef[.:]?)\s*"
                      r"(?:N[°º]|O\s*N[°º]|Nro\.?|No\.?)?\s*[:\s]*"
                      r"(\d{1,6}[-–]\d{4})(?!\w)"), grupo=1),
    Patron("rit_bare", "rit", "ancla_causa", "high",
           re.compile(r"(?<![\d.\-/–])\d{3,6}[-–](?:19|20)\d{2}(?![\d\-–])")),
    Patron("ruc", "ruc", "ancla_causa", "high",
           re.compile(r"(?i)\bRUC\s*(?:N[°º]|O\s*N[°º]|Nro\.?)?\s*[:\s]*"
                      r"\d{6,}[-–]\d{1,2}(?!\w)")),
    Patron("rol", "rol_generic", "ancla_causa", "high",
           re.compile(r"(?i)\bROL\s*(?:N[°º]|O\s*N[°º])?\s*[:\s]*"
                      r"[A-Z]?\d{1,6}[-–]\d{4}(?!\w)")),

    # --- Datos sensibles Art. 2 lit. g) Ley 21.719 ------------------------
    Patron("salud_mental", "salud_mental", "sensible", "critical",
           re.compile(
               r"(?i)\b(?:"
               r"esquizofrenia(?:\s+\w+)?|"
               r"trastorno\s+(?:bipolar|depresivo(?:\s+\w+)?|de\s+\w+(?:\s+\w+)?"
               r"|de\s+personalidad|de\s+estrés\s+postraumático)|"
               r"depresi[óo]n(?:\s+(?:severa|mayor|moderada|leve|grave|cr[óo]nica|reactiva|post\w*))?|"
               r"ansiedad(?:\s+(?:generalizada|severa|grave|cr[óo]nica))?|"
               r"psicosis|psic[óo]tic[oa]|demencia|"
               r"discapacidad\s+(?:mental|intelectual|ps[íi]quica)|"
               r"enajenación\s+mental|inimputabilidad|inimputable"
               r")\b")),
    Patron("vif", "vif", "sensible", "critical",
           re.compile(r"(?i)\b(?:violencia\s+intrafamiliar|VIF|maltrato\s+habitual|femicidio)\b")),
    Patron("nna", "nna", "sensible", "critical",
           re.compile(
               r"(?i)\b(?:menor(?:es)?\s+de\s+\d{1,2}\s+años|menor(?:es)?\s+de\s+edad"
               r"|niñ[oa]s?(?:\s+\w+)?\s+(?:de\s+)?\d{1,2}\s*años|NNA)\b")),
    Patron("socioeconomico", "socioeconomico", "sensible", "critical",
           re.compile(
               r"(?i)\b(?:"
               r"situaci[óo]n\s+socioecon[óo]mica|nivel\s+socioecon[óo]mico|"
               r"calificaci[óo]n\s+socioecon[óo]mica|"
               r"registro\s+social\s+de\s+hogares|\bRSH\b|"
               r"ficha\s+(?:de\s+protecci[óo]n\s+social|CAS)|"
               r"tramo\s+(?:de\s+ingreso|Fonasa|[A-D])|Fonasa\s+[A-D]|"
               r"quintil|percentil\s+socioecon[óo]mico|"
               r"beneficiari[oa]\s+de\s+gratuidad"
               r")\b")),
    Patron("biometrico", "biometrico", "sensible", "critical",
           re.compile(
               r"(?i)\b(?:"
               r"dato[s]?\s+biom[ée]tric[oa]s?|biom[ée]tric[oa]s?|"
               r"huella[s]?\s+(?:dactilar(?:es)?|digital(?:es)?)|"
               r"reconocimiento\s+facial|geometr[íi]a\s+facial|"
               r"escaneo\s+de\s+iris|perfil\s+gen[ée]tico|"
               r"muestra\s+de\s+ADN|\bADN\b"
               r")\b")),
    Patron("origen_etnico", "origen_etnico", "sensible", "critical",
           re.compile(
               r"(?i)\b(?:"
               r"origen\s+(?:étnico|racial|étnico\s+o\s+racial)|pueblo[s]?\s+originario[s]?|"
               r"afrodescendiente[s]?|"
               r"mapuche|aimara|aymara|quechua|rapa\s+nui|diaguita|colla|"
               r"atacameñ[oa]s?|kawésqar|yag[áa]n|likan\s*antai"
               r")\b")),
    Patron("afiliacion", "afiliacion", "sensible", "critical",
           re.compile(
               r"(?i)\b(?:"
               r"afiliaci[óo]n\s+(?:pol[íi]tica|sindical|gremial)|"
               r"militancia\s+pol[íi]tica|"
               r"afiliad[oa]\s+al?\s+(?:partido|sindicato)|"
               r"convicciones\s+(?:ideol[óo]gicas|filos[óo]ficas)"
               r")\b")),
    Patron("religion", "religion", "sensible", "critical",
           re.compile(
               r"(?i)\b(?:"
               r"creencias?\s+religiosas?|convicciones?\s+religiosas?|"
               r"confesi[óo]n\s+religiosa|religi[óo]n\s*[:]"
               r")")),
    Patron("orientacion_sexual", "orientacion_sexual", "sensible", "critical",
           re.compile(
               r"(?i)\b(?:"
               r"orientaci[óo]n\s+sexual|identidad\s+de\s+género|vida\s+sexual"
               r")\b")),
]


PAQUETES = {"generico": _GENERICO, "cl": _CL}


def patrones_de(paquetes) -> list[Patron]:
    """Patrones de los paquetes pedidos, en orden estable."""
    out: list[Patron] = []
    for nombre in paquetes:
        out.extend(PAQUETES.get(nombre, ()))
    return out


# ---------------------------------------------------------------------------
# Validación módulo 11 del dígito verificador (lexo-case-writer piiMask.ts)
# ---------------------------------------------------------------------------

def dv_rut_valido(cuerpo: str, dv: str) -> bool:
    """Dígito verificador chileno (módulo 11) para un cuerpo de RUT."""
    digitos = re.sub(r"[.\s]", "", cuerpo)
    if not digitos.isdigit():
        return False
    total, factor = 0, 2
    for c in reversed(digitos):
        total += int(c) * factor
        factor = factor + 1 if factor < 7 else 2
    resto = 11 - (total % 11)
    esperado = "0" if resto == 11 else "K" if resto == 10 else str(resto)
    return esperado == dv.upper()
