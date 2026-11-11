"""Constructor de packs de ordenamiento por perfil (offline, sin red).

Port generalizado de ``construir_paquete_normas.py`` (~/dike @ 885ca85,
registrado en VENDORED.json): misma estructura de nodos que ``chile-base``
(normas / articulos / vigencia / edges / provenance), JSON canónico,
``textSha256`` por artículo y MANIFEST con sha256 por archivo. Las reglas
M1 (rutas de ``articulosArchivo``) y el gate de privacidad se reimplementaron
aquí porque el árbol upstream tiene esos cambios sin commit.
"""
from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import re
import sys
from datetime import UTC, datetime
from pathlib import Path

from . import acunacion
from . import perfil as _perfil

RAIZ = Path(__file__).resolve().parents[1]
TERMINAL = (".", ":", ";", "!", "?", '"', "”", "»", ")", "]")
_RE_FECHA = re.compile(r"^\d{4}-\d{2}-\d{2}")
_RE_IDFUENTE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")


def canon(v) -> bytes:
    return json.dumps(v, ensure_ascii=False, sort_keys=True,
                      separators=(",", ":"), allow_nan=False).encode("utf-8")


def write_json(path: Path, value) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(canon(value))


def sha_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def sha_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _dividir_articulos(texto: str, patron: str) -> list[tuple[int, str]]:
    """Divide un texto corrido en (número, texto) por el patrón del perfil."""
    rx = re.compile(patron, re.MULTILINE)
    hits = list(rx.finditer(texto))
    if not hits:
        raise ValueError("sin artículos: el patrón no encontró ningún encabezado")
    out = []
    for i, hit in enumerate(hits):
        start = hit.start()
        end = hits[i + 1].start() if i + 1 < len(hits) else len(texto)
        cuerpo = " ".join(texto[start:end].split())
        try:
            numero = int(hit.group(1))
        except (IndexError, ValueError) as exc:
            raise ValueError(f"encabezado sin número válido: {hit.group(0)!r}") from exc
        if numero <= 0:
            raise ValueError(f"número de artículo no positivo: {numero}")
        out.append((numero, cuerpo))
    vistos = set()
    for numero, _ in out:
        if numero in vistos:
            raise ValueError(f"artículo duplicado en la entrada: {numero}")
        vistos.add(numero)
    return out


def _resolver_articulos_archivo(spec: dict, cfg_dir: Path) -> Path:
    """Resuelve ``articulosArchivo`` dentro del directorio de la configuración (M1).

    Reglas: la ruta es relativa; el componente final no puede ser un symlink;
    un directorio padre que sea symlink y resuelva dentro del directorio de la
    config se permite; cualquier resolución fuera → error.
    """
    crudo = spec.get("articulosArchivo")
    if not isinstance(crudo, str) or not crudo.strip():
        raise ValueError("norma: articulosArchivo es obligatorio")
    ruta = Path(crudo)
    if ruta.is_absolute():
        raise ValueError(
            f"articulosArchivo debe ser relativo al directorio de la configuración: {crudo!r}")
    base = cfg_dir.resolve()
    candidato = cfg_dir / ruta
    if os.path.islink(candidato):
        raise ValueError(
            f"articulosArchivo no puede terminar en un symlink: {crudo!r}")
    resuelto = candidato.resolve()
    if resuelto != base and base not in resuelto.parents:
        raise ValueError(
            f"articulosArchivo se resuelve fuera del directorio de la configuración: {crudo!r}")
    if not resuelto.is_file():
        raise ValueError(f"articulosArchivo no existe: {crudo!r}")
    return resuelto


def _cargar_privacidad():
    """El paquete ``privacidad/`` de esta copia del plugin, o None si no está.

    Mismo nombre por copia que ``dashboard/plugin_api.py`` (``dike_privacidad_<firma>``):
    en un proceso que sirve varios perfiles no se reutiliza la privacidad de
    otra copia ni de otra versión del plugin.
    """
    paquete = RAIZ / "privacidad" / "__init__.py"
    if not paquete.is_file():
        return None
    partes = [str(paquete.resolve())]
    for f in sorted(paquete.parent.rglob("*.py")):
        st = f.stat()
        partes.append(f"{f.name}:{st.st_mtime_ns}:{st.st_size}")
    nombre = "dike_privacidad_" + hashlib.sha256("|".join(partes).encode()).hexdigest()[:12]
    if nombre in sys.modules:
        return sys.modules[nombre]
    spec = importlib.util.spec_from_file_location(
        nombre, paquete, submodule_search_locations=[str(RAIZ / "privacidad")])
    if spec is None or spec.loader is None:
        return None
    mod = importlib.util.module_from_spec(spec)
    sys.modules[nombre] = mod
    try:
        spec.loader.exec_module(mod)
    except BaseException:
        sys.modules.pop(nombre, None)
        raise
    return mod


def _paquetes_privacidad(perfil: dict, pv) -> tuple:
    paquete = str((perfil.get("privacidad") or {}).get("paquete") or "")
    paquetes = ["generico"]
    if pv is not None and paquete and paquete != "generico" and paquete in getattr(pv, "PAQUETES", {}):
        paquetes.append(paquete)
    return tuple(paquetes)


def _gate_privacidad(pv, paquetes: tuple, texto: str, id_fuente: str) -> None:
    """Una norma pública no debería traer identificadores personales críticos."""
    if pv is None:
        raise ValueError(
            "no se pudo cargar el detector de privacidad del plugin; "
            "el constructor no sella sin él")
    for hallazgo in pv.detectar(texto, paquetes=paquetes):
        if (hallazgo.get("categoria") == "identificador_directo"
                and hallazgo.get("severidad") == "critical"):
            raise ValueError(
                f"la norma {id_fuente} contiene un identificador personal "
                f"({hallazgo.get('tipo', 'desconocido')}): una norma pública no debería "
                "traerlo; revisa la fuente")


def _norma_etiqueta(spec: dict, idx: int) -> str:
    return str(spec.get("idFuente") or f"normas[{idx}]")


def _preparar_norma(spec: dict, idx: int, perfil: dict, patron: str,
                    tipos_validos: set, cfg_dir: Path, pv, paquetes: tuple) -> dict:
    etiqueta = _norma_etiqueta(spec, idx)
    id_fuente = str(spec.get("idFuente") or "").strip()
    if not id_fuente:
        raise ValueError(f"{etiqueta}: idFuente es obligatorio")
    if not _RE_IDFUENTE.fullmatch(id_fuente):
        raise ValueError(f"{etiqueta}: idFuente tiene caracteres no permitidos: {id_fuente!r}")
    tipo = str(spec.get("tipo") or "").strip()
    if tipo not in tipos_validos:
        raise ValueError(
            f"{etiqueta}: tipo «{tipo}» no está declarado en normas.tipos del perfil")
    numero = str(spec.get("numero") or "").strip()
    if not numero:
        raise ValueError(f"{etiqueta}: numero es obligatorio")
    try:
        anio = int(spec.get("anio"))
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{etiqueta}: anio debe ser un año entero: {spec.get('anio')!r}") from exc
    titulo = str(spec.get("titulo") or "").strip()
    if not titulo:
        raise ValueError(f"{etiqueta}: titulo es obligatorio")
    fuente_uri = str(spec.get("fuenteUri") or "").strip()
    if not fuente_uri:
        raise ValueError(f"{etiqueta}: fuenteUri es obligatoria (procedencia)")
    doc_url = str(spec.get("fuenteDocumentoUrl") or fuente_uri).strip()
    vigente_desde = str(spec.get("vigenteDesde") or "").strip()
    if not _RE_FECHA.fullmatch(vigente_desde):
        raise ValueError(f"{etiqueta}: vigenteDesde debe ser fecha ISO AAAA-MM-DD: {vigente_desde!r}")
    fecha_pub = spec.get("fechaPublicacion")
    if fecha_pub is not None and not _RE_FECHA.fullmatch(str(fecha_pub)):
        raise ValueError(f"{etiqueta}: fechaPublicacion debe ser fecha ISO AAAA-MM-DD: {fecha_pub!r}")

    archivo = _resolver_articulos_archivo(spec, cfg_dir)
    texto = archivo.read_text(encoding="utf-8")
    _gate_privacidad(pv, paquetes, texto, id_fuente)
    articulos = _dividir_articulos(texto, patron)
    if not articulos:
        raise ValueError(f"{etiqueta}: cero artículos (paquete vacío no se sella)")
    for numero_art, cuerpo in articulos:
        if not cuerpo or not cuerpo.endswith(TERMINAL):
            raise ValueError(
                f"{etiqueta} art. {numero_art}: texto truncado (no cierra la frase); "
                "revisa la descarga antes de sellar")
    return {
        "idFuente": id_fuente, "tipo": tipo, "numero": numero, "anio": anio,
        "titulo": titulo, "fuenteUri": fuente_uri, "fuenteDocumentoUrl": doc_url,
        "vigenteDesde": vigente_desde,
        "fechaPublicacion": str(fecha_pub) if fecha_pub is not None else None,
        "articulos": articulos, "articulosArchivo": spec.get("articulosArchivo"),
    }


def _nombre_unidad_articulo(perfil: dict) -> str:
    for unidad in (perfil.get("normas") or {}).get("unidades") or []:
        if isinstance(unidad, dict) and unidad.get("codigo") == "art":
            return str(unidad.get("nombreLocal") or "artículo")
    return "artículo"


def construir(perfil, config, salida, *, obtenido: str | None = None, force: bool = False) -> dict:
    """Construye un pack ``dike-ordenamiento-pack-v1`` desde un perfil y una configuración.

    ``perfil`` y ``config`` aceptan ruta (str/Path) o dict ya cargado. ``obtenido``
    fija ``generatedAtTime``/``retrievedAt``: dos corridas con el mismo valor dan
    un ``MANIFEST.json`` byte-idéntico.
    """
    perfil_d = _perfil.cargar_perfil(perfil)
    errores = _perfil.validar_perfil(perfil_d)
    if errores:
        primero = errores[0]
        raise ValueError(
            f"perfil inválido ({len(errores)} errores); primero: "
            f"{primero['explicacion']} ({primero['ruta']})")

    if isinstance(config, dict):
        cfg = config
        cfg_dir = Path.cwd().resolve()
    else:
        cfg_path = Path(config)
        cfg = json.loads(cfg_path.read_text(encoding="utf-8"))
        cfg_dir = cfg_path.resolve().parent

    if cfg.get("formato") != "dike-paquete-normas-v1":
        raise ValueError("config: formato debe ser «dike-paquete-normas-v1»")
    dataset = str(cfg.get("datasetVersion") or "")
    if not _RE_FECHA.fullmatch(dataset):
        raise ValueError("config: datasetVersion debe ser fecha ISO AAAA-MM-DD")
    normas_cfg = cfg.get("normas") or []
    if not normas_cfg:
        raise ValueError("config: normas[] vacío")

    out = Path(salida)
    if out.is_dir() and not force and any(p.is_file() for p in out.rglob("*")):
        raise ValueError(f"directorio de salida no vacío: {out} (usa force=True para reconstruir)")

    escritas: list[str] = []
    identidades = set()

    def _escribir(path: Path, value) -> None:
        identidad = value.get('@id')
        if identidad is not None:
            if identidad in identidades:
                raise ValueError(f'identidad duplicada: {identidad}')
            identidades.add(identidad)
        write_json(path, value)
        escritas.append(path.relative_to(out).as_posix())

    obtenido = obtenido or datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
    identidad = perfil_d.get("identidad") or {}
    jur_dominio = str(identidad.get("jurisdiccion") or perfil_d.get("perfil") or "")
    jur_perfil = str(perfil_d.get("perfil") or jur_dominio)
    fuentes = (identidad.get("fuentesOficiales") or [{}])
    fuente = fuentes[0] if fuentes else {}
    id_local = str(fuente.get("idLocal") or "idFuente")
    fuente_url = str(fuente.get("url") or "")
    fuente_atribucion = str(fuente.get("atribucion") or fuente.get("nombre") or "")
    licencia_textos = str(fuente.get("licenciaTextos") or "")
    licencia_ia = str(fuente.get("usoIA") or "")

    tipos_validos = {
        t.get("codigo") for t in (perfil_d.get("normas") or {}).get("tipos") or []
        if isinstance(t, dict)
    }
    patron = str((perfil_d.get("normas") or {}).get("patronArticulo") or "")
    pv = _cargar_privacidad()
    paquetes = _paquetes_privacidad(perfil_d, pv)

    preparadas = [
        _preparar_norma(spec, i, perfil_d, patron, tipos_validos, cfg_dir, pv, paquetes)
        for i, spec in enumerate(normas_cfg)
    ]

    fuentes, normas = set(), set()
    for norma in preparadas:
        id_fuente = norma['idFuente']
        if id_fuente in fuentes:
            raise ValueError(f'idFuente duplicado: {id_fuente}')
        fuentes.add(id_fuente)
        identidad = acunacion.id_norma(perfil_d, {
            'jurisdiction': jur_dominio, 'type': norma['tipo'],
            'number': norma['numero'], 'year': norma['anio'],
        })
        if identidad in normas:
            raise ValueError(f'identidad duplicada: {identidad}')
        normas.add(identidad)

    for d in ("normas", "articulos", "vigencia", "provenance", "edges"):
        (out / d).mkdir(parents=True, exist_ok=True)

    sello = sha_bytes(canon({"jur": jur_dominio, "dataset": dataset, "obtenido": obtenido}))[:16]
    prov_activity_id = f"{acunacion.BASE}prov/build/{jur_dominio}/{sello}"
    prov_fuente_id = f"{acunacion.BASE}prov/fuente/{jur_dominio}/{fuente.get('id', 'fuente')}"

    norm_count = art_count = edge_count = vig_count = 0
    ids_fuente = []
    etiqueta_art = _nombre_unidad_articulo(perfil_d)

    for n in preparadas:
        ids_fuente.append(n["idFuente"])
        eli = {
            "jurisdiction": jur_dominio,
            "type": n["tipo"],
            "number": n["numero"],
            "year": n["anio"],
            "date_entry_in_force": n["vigenteDesde"],
            "date_no_longer_in_force": None,
            "date_publication": n["fechaPublicacion"],
        }
        nid = acunacion.id_norma(perfil_d, eli)
        temporal_norma = {
            "from": n["vigenteDesde"], "to": None, "status": "VIGENTE",
            "derivation": "declarada en la configuración del paquete",
        }
        _escribir(out / "normas" / f"norma_{n['idFuente']}.json", {
            "@context": "../context.jsonld",
            "@id": nid, "@type": "LegalResource",
            id_local: n["idFuente"],
            "eli": eli,
            "title": n["titulo"],
            "sourceUri": n["fuenteUri"],
            "sourceDocumentUrl": n["fuenteDocumentoUrl"],
            "temporal": temporal_norma,
            "provenance": {
                "@type": "prov:Entity",
                "wasDerivedFrom": n["fuenteUri"],
                "generatedAtTime": obtenido,
                "datasetVersion": dataset,
                "wasGeneratedBy": prov_activity_id,
            },
        })
        norm_count += 1
        vig_count += 1
        _escribir(out / "vigencia" / f"vigencia_norma_{n['idFuente']}.json", {
            "@id": acunacion.id_vigencia(perfil_d, nid), "@type": "TemporalWindow",
            "resource": nid, "from": n["vigenteDesde"], "to": None,
            "status": "VIGENTE",
            "derivation": temporal_norma["derivation"],
        })

        for numero_art, cuerpo in n["articulos"]:
            eid = f"art_{numero_art:04d}"
            aid = acunacion.id_unidad(perfil_d, nid, eid)
            digest = sha_text(cuerpo)
            _escribir(out / "articulos" / f"articulo_{n['idFuente']}_{eid}.json", {
                "@context": "../context.jsonld",
                "@id": aid, "@type": "Article",
                "eId": eid, "isPartOf": nid, "label": str(numero_art),
                "text": cuerpo, "textSha256": digest,
                "citation": {
                    "status": "CITABLE", "completenessVerified": True,
                    "textSha256": digest,
                    "verificationMethod": (
                        f"texto de entrada {n['articulosArchivo']}; cierre de frase "
                        f"verificado; obtenido {obtenido}"),
                },
                "temporal": dict(temporal_norma),
                "provenance": {
                    "@type": "prov:Entity",
                    "wasDerivedFrom": n["fuenteUri"],
                    "generatedAtTime": obtenido,
                    "datasetVersion": dataset,
                    "retrievedAt": obtenido,
                    "sourceLabel": f"{etiqueta_art.capitalize()} {numero_art}",
                    "wasGeneratedBy": prov_activity_id,
                },
            })
            art_count += 1
            vig_count += 1
            _escribir(out / "vigencia" / f"vigencia_articulo_{n['idFuente']}_{eid}.json", {
                "@id": acunacion.id_vigencia(perfil_d, aid), "@type": "TemporalWindow",
                "resource": aid, "from": n["vigenteDesde"], "to": None,
                "status": "VIGENTE",
                "derivation": temporal_norma["derivation"],
            })

            dataset_target = f"{acunacion.BASE}prov/dataset/{jur_dominio}/{dataset}"
            for tipo_arista, origen, destino in (
                    ("CONTAINS", nid, aid), ("DERIVED_FROM", aid, dataset_target)):
                edge_count += 1
                _escribir(out / "edges" / f"edge_{edge_count:05d}_{tipo_arista.lower()}.json", {
                    "@id": acunacion.id_arista(perfil_d, tipo_arista, origen, destino),
                    "@type": "Edge", "type": tipo_arista,
                    "source": origen, "target": destino,
                })

    perfil_sha = sha_text(canon(perfil_d).decode("utf-8"))
    _escribir(out / "pack.json", {
        "@id": f"{acunacion.BASE}packages/{jur_perfil}/v1",
        "format": "dike-ordenamiento-pack-v1",
        "perfil": {"id": jur_perfil, "version": perfil_d.get("perfilVersion"),
                   "sha256": perfil_sha},
        "nucleo": (perfil_d.get("nucleoVersion") or "1.0.0"),
        "idsFuente": sorted(ids_fuente),
        "version": "1.0.0",
    })
    _escribir(out / "context.jsonld", acunacion.contexto_efectivo(perfil_d))
    _escribir(out / "provenance" / "build_activity.json", {
        "@id": prov_activity_id, "@type": "prov:Activity",
        "generatedAtTime": obtenido, "datasetVersion": dataset,
        "wasDerivedFrom": fuente_url, "used": prov_fuente_id,
    })
    _escribir(out / "provenance" / "fuente.json", {
        "@id": prov_fuente_id, "@type": "prov:Entity",
        "attribution": fuente_atribucion,
        "source": fuente_url,
        "note": str(fuente.get("nombre") or ""),
        "licenciaTextos": licencia_textos,
        "licenciaUsoIA": licencia_ia,
    })
    _escribir(out / "BUILD_REPORT.json", {
        "@id": f"{acunacion.BASE}reports/{jur_dominio}-build/{sello}",
        "normCount": norm_count, "articleCount": art_count,
        "vigenciaCount": vig_count, "edgeCount": edge_count,
        "attribution": fuente_atribucion,
        "datasetVersion": dataset, "retrievedAt": obtenido,
        "nota": "Paquete de ordenamiento por perfil; no es un manifiesto de fuente oficial.",
    })

    escritas_set = set(escritas)
    ajenos = sorted(
        p.relative_to(out).as_posix()
        for p in out.rglob("*")
        if p.is_file() and p.name != "MANIFEST.json"
        and "__pycache__" not in p.parts
        and p.relative_to(out).as_posix() not in escritas_set
    )
    if ajenos:
        muestra = ", ".join(ajenos[:5])
        raise ValueError(
            "el directorio de salida contiene archivos ajenos a esta "
            f"construcción: {muestra}{'…' if len(ajenos) > 5 else ''}; "
            "usa un directorio vacío")

    files = []
    for rel in sorted(escritas):
        if rel == "MANIFEST.json":
            continue
        path = out / rel
        files.append({"path": rel, "bytes": path.stat().st_size,
                      "sha256": sha_file(path)})
    core = {
        "@id": f"{acunacion.BASE}packages/{jur_perfil}/v1/manifest",
        "format": "dike-ordenamiento-pack-manifest-v1",
        "packageVersion": "1.0.0",
        "source": fuente_atribucion,
        "dataSource": {"endpoint": fuente_url, "datasetVersion": dataset,
                       "retrievedAt": obtenido},
        "componentLicenses": {
            "legalTexts": {"copyrightStatus": licencia_textos,
                           "attributionRequired": True},
            "aiUse": {"warning": licencia_ia},
        },
        "files": files,
    }
    core["manifestCoreSha256"] = sha_text(canon(core).decode("utf-8"))
    _escribir(out / "MANIFEST.json", core)

    return {"ok": True, "salida": str(out),
            "packId": f"{acunacion.BASE}packages/{jur_perfil}/v1",
            "jurisdiccion": jur_dominio,
            "manifestCoreSha256": core['manifestCoreSha256'], "normas": norm_count,
            "articulos": art_count, "vigencias": vig_count,
            "edges": edge_count, "datasetVersion": dataset}
