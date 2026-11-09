"""Validador de packs de ordenamiento por niveles C0/C1 (offline, solo stdlib).

C0: manifiesto, hashes, rutas seguras, sin symlinks, JSON canónico.
C1: formato reconocido, clases y claves del núcleo, re-acuñación de @id,
    regla de año con excepciones declaradas.
C2 y C3 quedan ``no_evaluado`` (ver docs/legal-systems.md): nunca cuentan como pase.
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path, PurePosixPath

from . import acunacion, jsonld
from . import perfil as _perfil

_DIR = Path(__file__).resolve().parent
_NUCLEO_PATH = _DIR / "nucleo" / "nucleo.json"

_DIRS_NODOS = ("normas", "articulos", "vigencia", "edges", "provenance")
_SUFFIX_JSON = (".json", ".jsonld")
_MAX_ERRORES_POR_CODIGO = 20
_GID_NOTA = ("no evaluado: el pack no trae campo gid; la gramática dike-id 2.0.0 "
             "solo acepta cl (ver docs/legal-systems.md)")


def canon(v) -> bytes:
    return json.dumps(v, ensure_ascii=False, sort_keys=True,
                      separators=(",", ":"), allow_nan=False).encode("utf-8")


def _sha(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def _error(codigo: str, ruta: str, explicacion: str) -> dict:
    return {"codigo": codigo, "ruta": ruta, "explicacion": explicacion}


def _nucleo() -> dict:
    return json.loads(_NUCLEO_PATH.read_text(encoding="utf-8"))


def _id_local(perfil: dict) -> str:
    fuentes = ((perfil.get("identidad") or {}).get("fuentesOficiales") or [{}])
    return str(fuentes[0].get("idLocal") or "idFuente") if fuentes else "idFuente"


def _jur_dominio(perfil: dict) -> str:
    return str((perfil.get("identidad") or {}).get("jurisdiccion")
               or perfil.get("perfil") or "")


def _perfil_sha(perfil: dict) -> str:
    return _sha(canon(perfil))


def _recortar(errores: list) -> tuple[list, int, dict]:
    """Limita la lista por código a 20; devuelve (lista, truncados, conteos por código)."""
    conteos: dict[str, int] = {}
    por_codigo: dict[str, list] = {}
    for e in errores:
        por_codigo.setdefault(e["codigo"], []).append(e)
    salida = []
    truncados = 0
    for codigo, grupo in por_codigo.items():
        conteos[codigo] = len(grupo)
        salida.extend(grupo[:_MAX_ERRORES_POR_CODIGO])
        truncados += max(0, len(grupo) - _MAX_ERRORES_POR_CODIGO)
    return salida, truncados, conteos


def _es_archivo_json(path: Path) -> bool:
    return path.is_file() and not path.is_symlink() and path.suffix in _SUFFIX_JSON


def _c0(pack: Path, errores: list) -> dict:
    """Comprueba manifiesto, integridad de archivos, rutas, symlinks y JSON canónico."""
    conteos = {"archivosManifiesto": 0, "jsonCanonicos": 0}
    man_path = pack / "MANIFEST.json"
    if not man_path.is_file():
        errores.append(_error(
            "manifiesto_ausente", "MANIFEST.json",
            "el pack no tiene MANIFEST.json: no se puede verificar su integridad"))
        return {"ok": False, "errores": errores, "conteos": conteos}
    try:
        man = json.loads(man_path.read_bytes())
    except Exception as exc:
        errores.append(_error(
            "manifiesto_invalido", "MANIFEST.json",
            f"MANIFEST.json no es JSON válido: {exc}"))
        return {"ok": False, "errores": errores, "conteos": conteos}
    if not isinstance(man, dict):
        errores.append(_error(
            "manifiesto_invalido", "MANIFEST.json", "MANIFEST.json debe ser un objeto JSON"))
        return {"ok": False, "errores": errores, "conteos": conteos}

    core = {k: v for k, v in man.items() if k != "manifestCoreSha256"}
    if man.get("manifestCoreSha256") != _sha(canon(core)):
        errores.append(_error(
            "manifiesto_core_distinto", "MANIFEST.json",
            "manifestCoreSha256 no se recomputa desde el resto del manifiesto "
            "(manifiesto manipulado o corrupto)"))

    listados = set()
    for item in man.get("files") or []:
        if not isinstance(item, dict):
            continue
        rel = str(item.get("path") or "")
        pp = PurePosixPath(rel)
        if not rel or pp.is_absolute() or ".." in pp.parts:
            errores.append(_error(
                "archivo_inseguro", f"MANIFEST.json/files/{rel!r}",
                f"ruta insegura en el manifiesto: {rel!r}"))
            continue
        listados.add(rel)
        conteos["archivosManifiesto"] += 1
        p = pack / rel
        if p.is_symlink() or not p.is_file():
            errores.append(_error(
                "archivo_ausente", rel,
                "el archivo declarado en el manifiesto no existe en el pack"))
            continue
        datos = p.read_bytes()
        if _sha(datos) != item.get("sha256") or len(datos) != item.get("bytes"):
            errores.append(_error(
                "archivo_alterado", rel,
                "el sha256 o el tamaño no coincide con el declarado en el manifiesto"))

    for dirpath, dirnames, filenames in os.walk(pack, followlinks=False):
        for nombre in dirnames + filenames:
            p = Path(dirpath) / nombre
            if p.is_symlink():
                errores.append(_error(
                    "symlink_en_pack", str(p.relative_to(pack)),
                    "el pack contiene un symlink; los packs no pueden tenerlos"))

    en_disco = {
        p.relative_to(pack).as_posix()
        for p in pack.rglob("*")
        if p.is_file() and not p.is_symlink()
        and p.name not in ("MANIFEST.json", "SNAPSHOT.json")
        and "__pycache__" not in p.parts
    }
    for extra in sorted(en_disco - listados):
        errores.append(_error(
            "archivo_no_listado", extra,
            "archivo en disco no declarado en MANIFEST.json (salvo MANIFEST.json y SNAPSHOT.json)"))

    for p in sorted(pack.rglob("*")):
        if "__pycache__" in p.parts or p.is_symlink() or not _es_archivo_json(p):
            continue
        rel = p.relative_to(pack).as_posix()
        datos = p.read_bytes()
        try:
            valor = json.loads(datos)
        except Exception as exc:
            errores.append(_error(
                "json_invalido", rel, f"el archivo no es JSON válido: {exc}"))
            continue
        conteos["jsonCanonicos"] += 1
        if canon(valor) != datos:
            errores.append(_error(
                "json_no_canonico", rel,
                "el JSON no es canónico byte a byte (orden de claves, espacios o escapes)"))

    return {"ok": not errores, "errores": errores, "conteos": conteos}


def _excepcion_anio(perfil: dict, id_local_valor, anio) -> dict | None:
    for exc in (perfil.get("normas") or {}).get("excepciones") or []:
        if not isinstance(exc, dict):
            continue
        if (exc.get("campo") == "anio"
                and str(exc.get("idLocal")) == str(id_local_valor)
                and str(exc.get("valor")) == str(anio)):
            return exc
    return None


def _anio_esperado(perfil: dict, nodo: dict, eli: dict):
    regla = ((perfil.get("normas") or {}).get("reglaAnio")) or "declarado"
    if regla == "publicacion":
        fecha = eli.get("date_publication") or nodo.get("publicationDate")
        return str(fecha)[:4] if fecha else None
    if regla == "promulgacion":
        fecha = nodo.get("promulgationDate")
        return str(fecha)[:4] if fecha else None
    return None


def _c1(pack: Path, perfil: dict, errores: list, advertencias: list) -> dict:
    """Comprueba formato, clases del núcleo, claves declaradas y re-acuñación de @id."""
    excepciones_aplicadas: list = []
    nucleo = _nucleo()
    clases = set(nucleo["clases"])
    tipos_arista = set(nucleo["tiposArista"])
    ctx_efectivo = acunacion.contexto_efectivo(perfil)
    id_local = _id_local(perfil)
    jur = _jur_dominio(perfil)
    formatos = set(perfil.get("formatosReconocidos") or [])
    tipos_norma = {
        t.get("codigo") for t in (perfil.get("normas") or {}).get("tipos") or []
        if isinstance(t, dict)
    }

    nodos: dict[str, dict] = {}
    rutas: dict[str, str] = {}
    for sub in _DIRS_NODOS:
        directorio = pack / sub
        if not directorio.is_dir():
            continue
        for p in sorted(directorio.glob("*.json")):
            if p.is_symlink():
                continue
            rel = p.relative_to(pack).as_posix()
            try:
                nodo = json.loads(p.read_bytes())
            except Exception:
                continue
            if not isinstance(nodo, dict):
                continue
            nid = nodo.get("@id")
            if isinstance(nid, str):
                nodos[nid] = nodo
                rutas[nid] = rel
            else:
                errores.append(_error(
                    "tipo_nodo_desconocido", rel,
                    "el nodo no tiene un @id utilizable"))
    ids = set(nodos)

    pack_json_path = pack / "pack.json"
    pack_json = None
    if pack_json_path.is_file() and not pack_json_path.is_symlink():
        try:
            pack_json = json.loads(pack_json_path.read_bytes())
        except Exception:
            pack_json = None
    formato = pack_json.get("format") if isinstance(pack_json, dict) else None
    if not formato:
        errores.append(_error(
            "formato_ausente", "pack.json",
            "pack.json falta, no es JSON válido o no declara «format»"))
    else:
        if formato not in formatos:
            errores.append(_error(
                "formato_no_reconocido", "pack.json",
                f"formato «{formato}» no está en formatosReconocidos del perfil"))
        info_perfil = pack_json.get("perfil") or {}
        if (formato == "dike-ordenamiento-pack-v1"
                and info_perfil.get("id") == perfil.get("perfil")
                and info_perfil.get("sha256") != _perfil_sha(perfil)):
            advertencias.append(_error(
                "perfil_sha_distinto", "pack.json",
                "el sha256 del perfil declarado en pack.json no coincide con el perfil usado"))
        if formato == "dike-ordenamiento-pack-v1" and info_perfil.get("id") not in (None, perfil.get("perfil")):
            errores.append(_error(
                "perfil_distinto", "pack.json",
                f"el pack declara el perfil «{info_perfil.get('id')}» pero se valida contra «{perfil.get('perfil')}»"))

    ids_reacuniados = {"ok": 0, "total": 0}
    por_tipo: dict[str, int] = {}
    ids_por_tipo: dict[str, dict] = {}

    for nid, nodo in nodos.items():
        rel = rutas[nid]
        tipos = nodo.get("@type")
        tipos = tipos if isinstance(tipos, list) else [tipos]
        tipo_principal = next((t for t in tipos if isinstance(t, str)), None)
        if tipo_principal not in clases:
            errores.append(_error(
                "clase_desconocida", f"{rel}#@type",
                f"@type «{tipo_principal}» no es una clase del núcleo v1"))
            continue
        por_tipo[tipo_principal] = por_tipo.get(tipo_principal, 0) + 1

        def acuña(esperado: str | None, que: str) -> None:
            if esperado is None:
                return
            ids_reacuniados["total"] += 1
            stat = ids_por_tipo.setdefault(tipo_principal, {"ok": 0, "total": 0})
            stat["total"] += 1
            if nid == esperado:
                stat["ok"] += 1
                ids_reacuniados["ok"] += 1
            else:
                errores.append(_error(
                    "id_no_reacuna", f"{rel}#@id",
                    f"el @id no se reproduce con la regla de acuñación del perfil ({que})"))

        if tipo_principal == "LegalResource":
            if id_local not in nodo:
                errores.append(_error(
                    "campo_faltante", f"{rel}#{id_local}",
                    f"LegalResource sin el campo «{id_local}» que declara el perfil"))
            eli = nodo.get("eli") if isinstance(nodo.get("eli"), dict) else {}
            if eli.get("jurisdiction") != jur:
                errores.append(_error(
                    "jurisdiccion_distinta", f"{rel}#eli.jurisdiction",
                    f"eli.jurisdiction «{eli.get('jurisdiction')}» no es la jurisdicción del perfil «{jur}»"))
            if eli.get("type") not in tipos_norma:
                errores.append(_error(
                    "tipo_norma_desconocido", f"{rel}#eli.type",
                    f"eli.type «{eli.get('type')}» no está en normas.tipos del perfil"))
            acuña(acunacion.id_norma(perfil, eli), "plantillaNorma")
            esperado_anio = _anio_esperado(perfil, nodo, eli)
            if esperado_anio and str(eli.get("year")) != esperado_anio:
                exc = _excepcion_anio(perfil, nodo.get(id_local), eli.get("year"))
                if exc is None:
                    errores.append(_error(
                        "anio_fuera_de_regla", f"{rel}#eli.year",
                        f"eli.year «{eli.get('year')}» no sigue la reglaAnio del perfil "
                        f"(esperado «{esperado_anio}») ni tiene excepción declarada"))
                else:
                    excepciones_aplicadas.append({
                        "idLocal": exc.get("idLocal"), "campo": exc.get("campo"),
                        "valor": exc.get("valor"), "nodo": nid,
                        "motivo": exc.get("motivo")})
        elif tipo_principal == "Article":
            is_part_of = nodo.get("isPartOf")
            eid = nodo.get("eId")
            if not eid:
                errores.append(_error(
                    "campo_faltante", f"{rel}#eId", "Article sin eId"))
            elif not is_part_of:
                errores.append(_error(
                    "isPartOf_ausente", f"{rel}#isPartOf", "Article sin isPartOf"))
            elif is_part_of not in ids:
                errores.append(_error(
                    "isPartOf_ausente", f"{rel}#isPartOf",
                    "isPartOf apunta a una norma que no está en el pack"))
            else:
                acuña(acunacion.id_unidad(perfil, is_part_of, eid), "plantillaUnidad")
            texto = nodo.get("text")
            if not isinstance(texto, str):
                errores.append(_error(
                    "campo_faltante", f"{rel}#text", "Article sin text"))
            elif nodo.get("textSha256") != _sha(texto.encode("utf-8")):
                errores.append(_error(
                    "text_sha_distinto", f"{rel}#textSha256",
                    "textSha256 no es el sha256 del text del artículo"))
        elif tipo_principal == "TemporalWindow":
            recurso = nodo.get("resource")
            if not recurso:
                errores.append(_error(
                    "campo_faltante", f"{rel}#resource", "TemporalWindow sin resource"))
            elif recurso not in ids:
                errores.append(_error(
                    "recurso_ausente", f"{rel}#resource",
                    "resource apunta a un nodo que no está en el pack"))
            else:
                acuña(acunacion.id_vigencia(perfil, recurso), "plantillaVigencia")
        elif tipo_principal == "Edge":
            tipo_arista = nodo.get("type")
            if tipo_arista not in tipos_arista:
                errores.append(_error(
                    "tipo_arista_desconocido", f"{rel}#type",
                    f"type «{tipo_arista}» no está en los tipos de arista del núcleo"))
            acuña(acunacion.id_arista(perfil, str(tipo_arista),
                                      str(nodo.get("source")), str(nodo.get("target"))),
                  "reglaArista")
            if nodo.get("source") not in ids:
                errores.append(_error(
                    "fuente_arista_ausente", f"{rel}#source",
                    "source de la arista no es un nodo del pack (el target puede ser externo)"))

        for ruta_clave in jsonld.claves_no_definidas(nodo, ctx_efectivo):
            errores.append(_error(
                "termino_no_declarado", f"{rel}#{ruta_clave}",
                "la clave no es un término del núcleo ni una extensión declarada del perfil"))

    ctx_pack = None
    ctx_pack_path = pack / "context.jsonld"
    if ctx_pack_path.is_file() and not ctx_pack_path.is_symlink():
        try:
            ctx_pack = json.loads(ctx_pack_path.read_bytes())
        except Exception:
            ctx_pack = None
    if ctx_pack is not None:
        sin_definir = 0
        for nodo in nodos.values():
            sin_definir += len(jsonld.claves_no_definidas(nodo, ctx_pack))
        if sin_definir:
            advertencias.append(_error(
                "contexto_pack_incompleto", "context.jsonld",
                f"el context.jsonld propio del pack deja {sin_definir} claves sin definir "
                "(no se reescribe un pack sellado)"))

    return {
        "ok": not errores,
        "errores": errores,
        "excepcionesAplicadas": excepciones_aplicadas,
        "conteos": {
            "nodos": len(nodos),
            "porTipo": por_tipo,
            "idsReacuniados": {**ids_reacuniados, "porTipo": ids_por_tipo},
        },
    }


def validar_pack(dir_pack, perfil) -> dict:
    """Informe de compatibilidad ``dike-informe-compatibilidad-v1`` de un pack contra un perfil."""
    pack = Path(dir_pack)
    perfil_d = _perfil.cargar_perfil(perfil)
    perfil_info = {
        "id": perfil_d.get("perfil"),
        "version": perfil_d.get("perfilVersion"),
        "sha256": _perfil_sha(perfil_d),
    }

    errores_c0: list = []
    c0 = _c0(pack, errores_c0)
    errores_c0, trunc_c0, conteos_c0 = _recortar(errores_c0)
    c0["errores"] = errores_c0
    c0["truncados"] = trunc_c0
    c0["conteosErrores"] = conteos_c0

    errores_c1: list = []
    advertencias: list = []
    c1 = _c1(pack, perfil_d, errores_c1, advertencias)
    errores_c1, trunc_c1, conteos_c1 = _recortar(errores_c1)
    c1["errores"] = errores_c1
    c1["truncados"] = trunc_c1
    c1["conteosErrores"] = conteos_c1

    if c0["ok"] and c1["ok"]:
        nivel = "C1"
    elif c0["ok"]:
        nivel = "C0"
    else:
        nivel = "ninguno"

    return {
        "formato": "dike-informe-compatibilidad-v1",
        "pack": str(pack),
        "perfil": perfil_info,
        "niveles": {
            "C0": c0,
            "C1": {**c1, "advertencias": advertencias},
            "C2": {"estado": "no_evaluado", "nota": "fase posterior (ver docs/legal-systems.md)"},
            "C3": {"estado": "no_evaluado", "nota": "fase posterior (ver docs/legal-systems.md)"},
        },
        "nivelAlcanzado": nivel,
        "excepcionesAplicadas": c1["excepcionesAplicadas"],
        "advertencias": advertencias,
        "gid": _GID_NOTA,
    }
