"""Carga y validación del perfil de ordenamiento (formato dike-perfil-ordenamiento-v1).

``validar_perfil`` deriva los campos obligatorios del JSON Schema
``esquemas/perfil.v1.schema.json``: ambos piden lo mismo por construcción.
"""
from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path

_DIR = Path(__file__).resolve().parent
RAIZ = _DIR.parent
ESQUEMA_PATH = _DIR / "esquemas" / "perfil.v1.schema.json"
NUCLEO_PATH = _DIR / "nucleo" / "nucleo.json"

_RE_JUR = re.compile(r"^[a-z]{2}$")
_RE_SUBDIV = re.compile(r"^[a-z]{2}-[a-z0-9]{1,3}$")
_RE_SHA = re.compile(r"^[0-9a-f]{64}$")
_RE_PLACEHOLDER = re.compile(r"\{(\w+)\}")

_CAMPOS_NORMA = {"jur", "tipo", "numero", "anio"}
_CAMPOS_UNIDAD = {"norma", "eId"}
_CAMPOS_VIGENCIA = {"recurso"}
_REGLAS_ARISTA = {"actual", "legada-lexo-cl"}
_REGLAS_ANIO = {"publicacion", "promulgacion", "declarado"}
_RELACIONES = {"equivalente", "mas_estrecho", "mas_amplio", "relacionado"}
_FORMATO = "dike-perfil-ordenamiento-v1"


def _error(codigo: str, ruta: str, explicacion: str) -> dict:
    return {"codigo": codigo, "ruta": ruta, "explicacion": explicacion}


def _esquema() -> dict:
    return json.loads(ESQUEMA_PATH.read_text(encoding="utf-8"))


def _nucleo() -> dict:
    return json.loads(NUCLEO_PATH.read_text(encoding="utf-8"))


def _resolver_ref(esquema: dict, raiz: dict) -> dict:
    ref = esquema.get("$ref")
    if not ref:
        return esquema
    if ref.startswith("#/$defs/"):
        return raiz["$defs"][ref.rsplit("/", 1)[1]]
    if ref == "#":
        return raiz
    return esquema


def _faltantes(valor, esquema: dict, raiz: dict, ruta: str, errores: list) -> None:
    esquema = _resolver_ref(esquema, raiz)
    if not isinstance(esquema, dict):
        return
    if isinstance(valor, dict):
        for req in esquema.get("required", []):
            if req not in valor:
                errores.append(_error(
                    "falta_campo", f"{ruta}.{req}",
                    f"falta el campo obligatorio «{req}»"))
        for clave, sub in esquema.get("properties", {}).items():
            if clave in valor:
                _faltantes(valor[clave], sub, raiz, f"{ruta}.{clave}", errores)
    elif isinstance(valor, list):
        items = esquema.get("items")
        if isinstance(items, dict):
            for i, elemento in enumerate(valor):
                _faltantes(elemento, items, raiz, f"{ruta}[{i}]", errores)


def _sin_completar(valor, ruta: str, errores: list) -> None:
    if isinstance(valor, dict):
        for clave, sub in valor.items():
            _sin_completar(sub, f"{ruta}.{clave}", errores)
    elif isinstance(valor, list):
        for i, elemento in enumerate(valor):
            _sin_completar(elemento, f"{ruta}[{i}]", errores)
    elif isinstance(valor, str) and valor.startswith("COMPLETAR"):
        errores.append(_error(
            "sin_completar", ruta,
            f"el valor empieza por «COMPLETAR»: hay que completarlo con los datos del ordenamiento"))


def _texto(valor) -> str:
    return valor if isinstance(valor, str) else ""


def _lista(valor) -> list:
    return valor if isinstance(valor, list) else []


def _dict(valor) -> dict:
    return valor if isinstance(valor, dict) else {}


def _chequear_plantilla(plantilla, permitidos: set, ruta: str, errores: list) -> None:
    if not isinstance(plantilla, str):
        return
    for nombre in _RE_PLACEHOLDER.findall(plantilla):
        if nombre not in permitidos:
            errores.append(_error(
                "plantilla_invalida", ruta,
                f"placeholder «{{{nombre}}}» no permitido; válidos: "
                + ", ".join("{" + p + "}" for p in sorted(permitidos))))


def _semanticos(d: dict, esquema: dict, errores: list) -> None:
    nucleo = _nucleo()
    codigos_unidad = set(nucleo["codigosUnidad"])
    niveles_nucleo = set(nucleo["niveles"])
    terminos_nucleo = set(nucleo["terminos"])

    if "formato" in d and d["formato"] != _FORMATO:
        errores.append(_error(
            "tipo_invalido", "$.formato",
            f"formato debe ser «{_FORMATO}»"))

    identidad = _dict(d.get("identidad"))
    jur = identidad.get("jurisdiccion")
    if isinstance(jur, str) and not _RE_JUR.fullmatch(jur):
        errores.append(_error(
            "jurisdiccion_invalida", "$.identidad.jurisdiccion",
            "la jurisdicción debe ser un código ISO 3166-1 alfa-2 en minúscula (^[a-z]{2}$)"))
    sub = identidad.get("subdivision")
    if sub is not None and not (isinstance(sub, str) and _RE_SUBDIV.fullmatch(sub)):
        errores.append(_error(
            "jurisdiccion_invalida", "$.identidad.subdivision",
            "la subdivisión debe ser ISO 3166-2 en minúscula (^[a-z]{2}-[a-z0-9]{1,3}$) o null"))

    normas = _dict(d.get("normas"))
    niveles_declarados = {n.get("nivel") for n in _lista(normas.get("niveles")) if isinstance(n, dict)}
    for i, tipo in enumerate(_lista(normas.get("tipos"))):
        if not isinstance(tipo, dict):
            continue
        if "nivel" in tipo and tipo["nivel"] not in niveles_declarados:
            errores.append(_error(
                "nivel_inexistente", f"$.normas.tipos[{i}].nivel",
                f"el nivel {tipo['nivel']!r} no está declarado en normas.niveles"))
    for i, unidad in enumerate(_lista(normas.get("unidades"))):
        if isinstance(unidad, dict) and "codigo" in unidad and unidad["codigo"] not in codigos_unidad:
            errores.append(_error(
                "codigo_unidad_desconocido", f"$.normas.unidades[{i}].codigo",
                f"el código de unidad «{unidad['codigo']}» no existe en el núcleo v1"))
    for i, nivel in enumerate(_lista(normas.get("niveles"))):
        if not isinstance(nivel, dict) or "mapeaA" not in nivel:
            continue
        mapea = nivel["mapeaA"]
        if not (isinstance(mapea, str) and mapea.startswith("nucleo:")
                and mapea.split(":", 1)[1] in niveles_nucleo):
            errores.append(_error(
                "mapeo_desconocido", f"$.normas.niveles[{i}].mapeaA",
                f"«{mapea}» no apunta a un nivel del núcleo; formato esperado «nucleo:<Nivel>»"))

    acunacion = _dict(normas.get("acunacion"))
    _chequear_plantilla(acunacion.get("plantillaNorma"), _CAMPOS_NORMA,
                        "$.normas.acunacion.plantillaNorma", errores)
    _chequear_plantilla(acunacion.get("plantillaUnidad"), _CAMPOS_UNIDAD,
                        "$.normas.acunacion.plantillaUnidad", errores)
    _chequear_plantilla(acunacion.get("plantillaVigencia"), _CAMPOS_VIGENCIA,
                        "$.normas.acunacion.plantillaVigencia", errores)
    regla_arista = acunacion.get("reglaArista")
    if regla_arista is not None and regla_arista not in _REGLAS_ARISTA:
        errores.append(_error(
            "regla_desconocida", "$.normas.acunacion.reglaArista",
            f"reglaArista «{regla_arista}» desconocida; válidas: " + ", ".join(sorted(_REGLAS_ARISTA))))
    regla_anio = normas.get("reglaAnio")
    if regla_anio is not None and regla_anio not in _REGLAS_ANIO:
        errores.append(_error(
            "regla_desconocida", "$.normas.reglaAnio",
            f"reglaAnio «{regla_anio}» desconocida; válidas: " + ", ".join(sorted(_REGLAS_ANIO))))

    patron = normas.get("patronArticulo")
    if isinstance(patron, str):
        try:
            grupos = re.compile(patron).groups
        except re.error as exc:
            errores.append(_error(
                "regex_invalida", "$.normas.patronArticulo",
                f"la expresión regular no compila: {exc}"))
        else:
            if grupos < 1:
                errores.append(_error(
                    "regex_invalida", "$.normas.patronArticulo",
                    "la expresión regular no tiene ningún grupo de captura para el número de artículo"))

    for i, extension in enumerate(_lista(d.get("extensiones"))):
        if not isinstance(extension, dict):
            continue
        termino = extension.get("termino")
        if isinstance(termino, str) and termino in terminos_nucleo:
            errores.append(_error(
                "termino_duplicado", f"$.extensiones[{i}].termino",
                f"«{termino}» ya es un término del núcleo; las extensiones solo declaran términos nuevos"))
        mapea = extension.get("mapeaA")
        if mapea is not None and mapea not in terminos_nucleo:
            errores.append(_error(
                "mapeo_desconocido", f"$.extensiones[{i}].mapeaA",
                f"«{mapea}» no existe en los términos del núcleo v1"))
        relacion = extension.get("relacion")
        if relacion is not None and relacion not in _RELACIONES:
            errores.append(_error(
                "tipo_invalido", f"$.extensiones[{i}].relacion",
                f"relación «{relacion}» desconocida; válidas: " + ", ".join(sorted(_RELACIONES))))

    referencias = _dict(d.get("referencias"))
    for nombre, ref in referencias.items():
        if not isinstance(ref, dict):
            continue
        ruta_rel = ref.get("ruta")
        sha = ref.get("sha256")
        if not isinstance(ruta_rel, str) or not ruta_rel:
            continue
        archivo = (RAIZ / ruta_rel)
        if not archivo.is_file():
            errores.append(_error(
                "referencia_ausente", f"$.referencias.{nombre}.ruta",
                f"el archivo referenciado «{ruta_rel}» no existe en la raíz del plugin"))
            continue
        if isinstance(sha, str) and _RE_SHA.fullmatch(sha):
            digest = hashlib.sha256(archivo.read_bytes()).hexdigest()
            if digest != sha:
                errores.append(_error(
                    "referencia_alterada", f"$.referencias.{nombre}.sha256",
                    f"el sha256 de «{ruta_rel}» no coincide con el declarado en el perfil"))


def validar_perfil(d: dict, esquema: dict | None = None) -> list[dict]:
    """Devuelve la lista de errores ``{codigo, ruta, explicacion}``; vacía si el perfil es válido."""
    if not isinstance(d, dict):
        return [_error("tipo_invalido", "$", "el perfil debe ser un objeto JSON")]
    esquema = esquema if esquema is not None else _esquema()
    errores: list[dict] = []
    _faltantes(d, esquema, esquema, "$", errores)
    _sin_completar(d, "$", errores)
    _semanticos(d, esquema, errores)
    return errores


def cargar_perfil(ruta) -> dict:
    """Carga un perfil desde un archivo JSON (o devuelve el dict si ya lo es)."""
    if isinstance(ruta, dict):
        return ruta
    return json.loads(Path(ruta).read_text(encoding="utf-8"))


def plantilla_perfil(jur: str) -> dict:
    """Perfil esqueleto para un ordenamiento nuevo: campos dependientes del país en «COMPLETAR»."""
    nucleo = _nucleo()
    return {
        "formato": _FORMATO,
        "perfil": jur,
        "perfilVersion": "1.0.0",
        "nucleoVersion": nucleo["version"],
        "nombre": "COMPLETAR: nombre del ordenamiento jurídico",
        "identidad": {
            "jurisdiccion": jur,
            "subdivision": None,
            "idiomas": ["COMPLETAR"],
            "fuentesOficiales": [{
                "id": "COMPLETAR",
                "nombre": "COMPLETAR: nombre de la fuente oficial",
                "url": "COMPLETAR: https://…",
                "atribucion": "COMPLETAR: atribución exigida por la fuente",
                "idLocal": "idFuente",
                "licenciaTextos": "COMPLETAR",
                "usoIA": "COMPLETAR"
            }]
        },
        "normas": {
            "tipos": [{"codigo": "COMPLETAR", "nombre": "COMPLETAR", "nivel": 1}],
            "niveles": [
                {"nivel": 1, "nombre": "Constitucional", "mapeaA": "nucleo:NivelConstitucional"},
                {"nivel": 2, "nombre": "Legal", "mapeaA": "nucleo:NivelLegal"},
                {"nivel": 3, "nombre": "Reglamentario", "mapeaA": "nucleo:NivelReglamentario"},
                {"nivel": 4, "nombre": "Administrativo", "mapeaA": "nucleo:NivelAdministrativo"}
            ],
            "unidades": [
                {"nombreLocal": "COMPLETAR", "codigo": codigo}
                for codigo in nucleo["codigosUnidad"]
            ],
            "patronArticulo": "COMPLETAR: regex con un grupo para el número, p. ej. ^Artículo\\s+(\\d+)",
            "acunacion": {
                "plantillaNorma": "eli/{jur}/{tipo}/{numero}/{anio}",
                "plantillaUnidad": "{norma}/{eId}",
                "plantillaVigencia": "{recurso}/vigencia",
                "reglaArista": "actual"
            },
            "reglaAnio": "COMPLETAR",
            "excepciones": []
        },
        "extensiones": [],
        "formatosReconocidos": ["lexo-starter-graph-v1", "dike-ordenamiento-pack-v1"],
        "vigencia": {
            "estados": ["VIGENTE", "DEROGADA", "FUTURA", "ULTRAACTIVA", "DESCONOCIDA"],
            "desconocidaPermitida": True
        },
        "privacidad": {"paquete": "COMPLETAR"}
    }


def plantilla_paquete() -> dict:
    """Configuración esqueleto de un paquete de normas (formato dike-paquete-normas-v1)."""
    return {
        "formato": "dike-paquete-normas-v1",
        "datasetVersion": "COMPLETAR: AAAA-MM-DD",
        "normas": [{
            "idFuente": "COMPLETAR",
            "tipo": "COMPLETAR: código de normas.tipos del perfil",
            "numero": "COMPLETAR",
            "anio": "COMPLETAR",
            "titulo": "COMPLETAR: título oficial",
            "fuenteUri": "COMPLETAR: URI de la norma en la fuente",
            "fuenteDocumentoUrl": "COMPLETAR: URL del documento oficial",
            "vigenteDesde": "COMPLETAR: AAAA-MM-DD",
            "fechaPublicacion": "COMPLETAR (opcional): AAAA-MM-DD",
            "articulosArchivo": "COMPLETAR: ruta .txt relativa al directorio de este archivo"
        }]
    }
