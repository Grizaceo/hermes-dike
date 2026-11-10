"""Tests del framework de ordenamientos (brief-minimo.md, sección Tests).

El paquete ``ordenamiento/`` se carga por ruta como ``dike_ordenamiento``, igual
que ``privacidad/`` se carga como ``dike_privacidad``.
"""
import copy
import importlib.util
import json
import os
import re
import shutil
import subprocess
import sys
import tarfile
from pathlib import Path

import pytest

ROOT = Path(__file__).parents[1]
ORD_DIR = ROOT / "ordenamiento"
PERFIL_CL = ORD_DIR / "perfiles" / "cl.json"
EJEMPLO = ORD_DIR / "ejemplos" / "pais-ficticio"
PERFIL_XX = EJEMPLO / "perfil-xx.json"
PAQUETE_XX = EJEMPLO / "paquete.json"
CORPUS_TAR = ROOT / "corpus" / "chile-base-af1422d66d1e6eee.tar.gz"
OBTENIDO = "2026-11-09T00:00:00Z"


def _cargar_paquete():
    if "dike_ordenamiento" in sys.modules:
        return sys.modules["dike_ordenamiento"]
    spec = importlib.util.spec_from_file_location(
        "dike_ordenamiento", ORD_DIR / "__init__.py",
        submodule_search_locations=[str(ORD_DIR)])
    mod = importlib.util.module_from_spec(spec)
    sys.modules["dike_ordenamiento"] = mod
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture(scope="module")
def mod():
    return _cargar_paquete()


@pytest.fixture(scope="module")
def perfil_cl(mod):
    return mod.cargar_perfil(PERFIL_CL)


@pytest.fixture(scope="module")
def perfil_xx(mod):
    return mod.cargar_perfil(PERFIL_XX)


@pytest.fixture(scope="module")
def pack_xx(mod, tmp_path_factory):
    salida = tmp_path_factory.mktemp("pack-xx") / "pack"
    mod.construir(PERFIL_XX, PAQUETE_XX, salida, obtenido=OBTENIDO)
    return salida


@pytest.fixture(scope="session")
def chile_base(tmp_path_factory):
    destino = tmp_path_factory.mktemp("chile-base-src")
    with tarfile.open(CORPUS_TAR) as tar:
        tar.extractall(destino, filter="data")
    return destino / "chile-base"


def _codigos(errores):
    return {e["codigo"] for e in errores}


def _canon(v) -> bytes:
    return json.dumps(v, ensure_ascii=False, sort_keys=True,
                      separators=(",", ":"), allow_nan=False).encode()


def _escribir_json(path: Path, valor) -> None:
    path.write_bytes(_canon(valor))


def _copia_pack(origen: Path, destino: Path) -> Path:
    shutil.copytree(origen, destino)
    return destino


# ---------------------------------------------------------------- 1-2: perfiles

def test_perfiles_validan(mod, perfil_cl, perfil_xx):
    assert mod.validar_perfil(perfil_cl) == []
    assert mod.validar_perfil(perfil_xx) == []


def test_plantilla_perfil_no_valida(mod):
    plantilla = mod.plantilla_perfil("xx")
    errores = mod.validar_perfil(plantilla)
    assert errores, "la plantilla debería tener errores hasta completarse"
    for e in errores:
        assert e.get("ruta") and e.get("explicacion"), e
    assert any(e["codigo"] == "sin_completar" for e in errores)


# ------------------------------------------------- 3: paridad schema ↔ Python

def _restricciones_requeridas(esquema, doc, ruta_esq, ruta_doc, salida):
    """Junta cada ``required`` del esquema con su ruta en el documento."""
    esquema = esquema
    if "$ref" in esquema:
        ref = esquema["$ref"]
        if ref.startswith("#/$defs/"):
            esquema = _RAIZ_ESQUEMA["$defs"][ref.rsplit("/", 1)[1]]
    if isinstance(doc, dict):
        for req in esquema.get("required", []):
            salida.append((ruta_esq + ["required"], req, ruta_doc + "." + req))
        for clave, sub in esquema.get("properties", {}).items():
            if clave in doc:
                _restricciones_requeridas(sub, doc[clave],
                                          ruta_esq + ["properties", clave],
                                          ruta_doc + "." + clave, salida)
    elif isinstance(doc, list):
        items = esquema.get("items")
        if isinstance(items, dict):
            for i, elemento in enumerate(doc):
                _restricciones_requeridas(items, elemento,
                                          ruta_esq + ["items"],
                                          f"{ruta_doc}[{i}]", salida)


_RAIZ_ESQUEMA = json.loads((ORD_DIR / "esquemas" / "perfil.v1.schema.json")
                           .read_text(encoding="utf-8"))


def _navegar_esquema(raiz, ruta):
    nodo = raiz
    for paso in ruta:
        while isinstance(nodo, dict) and "$ref" in nodo:
            ref = nodo["$ref"]
            if ref.startswith("#/$defs/"):
                nodo = raiz["$defs"][ref.rsplit("/", 1)[1]]
            else:
                break
        nodo = nodo[paso]
    return nodo


_TOKEN_RUTA = re.compile(r"([^\.\[\]]+)|\[(\d+)\]")


def _borrar_en_doc(doc, ruta_doc: str):
    """Borra el campo indicado por una ruta tipo ``$.a.b[0].c``."""
    tokens = [t for t in _TOKEN_RUTA.findall(ruta_doc) if t != ("", "")]
    if tokens and tokens[0][0] == "$":
        tokens = tokens[1:]
    actual = doc
    for i, (nombre, idx) in enumerate(tokens):
        ultimo = i == len(tokens) - 1
        if nombre:
            if ultimo:
                del actual[nombre]
                return
            actual = actual[nombre]
        else:
            j = int(idx)
            if ultimo:
                del actual[j]
                return
            actual = actual[j]


def test_paridad_schema_python(mod, perfil_cl):
    restricciones = []
    _restricciones_requeridas(_RAIZ_ESQUEMA, perfil_cl, [], "$", restricciones)
    assert restricciones, "el esquema debería declarar campos required"
    for ruta_req, clave, ruta_doc in restricciones:
        doc_sin = copy.deepcopy(perfil_cl)
        _borrar_en_doc(doc_sin, ruta_doc)
        errores = mod.validar_perfil(doc_sin)
        faltantes = [e for e in errores
                     if e["codigo"] == "falta_campo" and e["ruta"] == ruta_doc]
        assert faltantes, f"falta_campo esperado en {ruta_doc} (required {clave})"

        esquema_sin = copy.deepcopy(_RAIZ_ESQUEMA)
        lista_req = _navegar_esquema(esquema_sin, ruta_req)
        assert clave in lista_req
        lista_req.remove(clave)
        errores_sin = mod.validar_perfil(doc_sin, esquema=esquema_sin)
        assert not [e for e in errores_sin
                    if e["codigo"] == "falta_campo" and e["ruta"] == ruta_doc], \
            f"{ruta_doc} no debería seguir siendo falta_campo sin el required en el esquema"


# ------------------------------------------------------- 4: mutantes del perfil

def _mutar_perfil(perfil_cl, fn):
    d = copy.deepcopy(perfil_cl)
    fn(d)
    return d


def test_mutantes_perfil(mod, perfil_cl):
    casos = [
        ("jurisdicción chl", lambda d: d["identidad"].__setitem__("jurisdiccion", "chl"),
         "jurisdiccion_invalida"),
        ("tipo nivel 9", lambda d: d["normas"]["tipos"][0].__setitem__("nivel", 9),
         "nivel_inexistente"),
        ("unidad zzz", lambda d: d["normas"]["unidades"][0].__setitem__("codigo", "zzz"),
         "codigo_unidad_desconocido"),
        ("plantilla {foo}",
         lambda d: d["normas"]["acunacion"].__setitem__(
             "plantillaNorma", "eli/{jur}/{foo}/{numero}/{anio}"),
         "plantilla_invalida"),
        ("reglaArista otra",
         lambda d: d["normas"]["acunacion"].__setitem__("reglaArista", "otra"),
         "regla_desconocida"),
        ("patronArticulo sin grupo",
         lambda d: d["normas"].__setitem__("patronArticulo", "^Artículo\\s+\\d+"),
         "regex_invalida"),
        ("sha de referencia alterado",
         lambda d: d["referencias"]["materias"].__setitem__("sha256", "0" * 64),
         "referencia_alterada"),
    ]
    for nombre, mutar, esperado in casos:
        errores = mod.validar_perfil(_mutar_perfil(perfil_cl, mutar))
        assert esperado in _codigos(errores), f"{nombre}: esperado {esperado}, hubo {_codigos(errores)}"


# ------------------------------------------------------------- 5: chile-base

def _informe_chile(mod, chile_base, perfil):
    return mod.validar_pack(chile_base, perfil)


def test_chile_base_c1(mod, perfil_cl, chile_base):
    informe = _informe_chile(mod, chile_base, perfil_cl)
    c0 = informe["niveles"]["C0"]
    c1 = informe["niveles"]["C1"]
    assert c0["ok"], c0["errores"][:3]
    assert c1["ok"], c1["errores"][:3]

    por_tipo = c1["conteos"]["porTipo"]
    ids = c1["conteos"]["idsReacuniados"]["porTipo"]
    assert por_tipo["LegalResource"] == 25
    assert por_tipo["Article"] == 8544
    assert por_tipo["TemporalWindow"] == 8569
    assert por_tipo["Edge"] == 17068
    for clase, esperado in (("LegalResource", 25), ("Article", 8544),
                            ("TemporalWindow", 8569), ("Edge", 17068)):
        assert ids[clase]["ok"] == esperado and ids[clase]["total"] == esperado

    aplicadas = {e["idLocal"] for e in informe["excepcionesAplicadas"]}
    assert aplicadas == {"1058072", "207436", "172986"}

    assert informe["niveles"]["C2"]["estado"] == "no_evaluado"
    assert informe["niveles"]["C3"]["estado"] == "no_evaluado"
    assert informe["nivelAlcanzado"] == "C1"

    del_contexto = [a for a in informe["advertencias"]
                    if a["codigo"] == "contexto_pack_incompleto"]
    assert len(del_contexto) == 1


# ------------------------------------------------- 6-7: mutantes del perfil cl

def test_cl_sin_excepciones(mod, perfil_cl, chile_base):
    perfil = copy.deepcopy(perfil_cl)
    perfil["normas"]["excepciones"] = []
    informe = _informe_chile(mod, chile_base, perfil)
    assert not informe["niveles"]["C1"]["ok"]
    anios = [e for e in informe["niveles"]["C1"]["errores"]
             if e["codigo"] == "anio_fuera_de_regla"]
    assert len(anios) == 3


def test_cl_regla_arista_actual(mod, perfil_cl, chile_base):
    perfil = copy.deepcopy(perfil_cl)
    perfil["normas"]["acunacion"]["reglaArista"] = "actual"
    informe = _informe_chile(mod, chile_base, perfil)
    assert not informe["niveles"]["C1"]["ok"]
    assert informe["niveles"]["C1"]["conteosErrores"]["id_no_reacuna"] == 17068


# ------------------------------------------------------------- 8: mutantes C0

def _mutante_copia(pack_xx, tmp_path, nombre):
    return _copia_pack(pack_xx, tmp_path / nombre)


def test_c0_byte_articulo(mod, perfil_xx, pack_xx, tmp_path):
    pack = _mutante_copia(pack_xx, tmp_path, "byte")
    objetivo = pack / "articulos" / "articulo_xx-ley-1_art_0001.json"
    datos = bytearray(objetivo.read_bytes())
    i = datos.index(b"Ficticia")
    datos[i] = ord("X")
    objetivo.write_bytes(bytes(datos))
    informe = mod.validar_pack(pack, perfil_xx)
    assert "archivo_alterado" in informe["niveles"]["C0"]["conteosErrores"]


def test_c0_archivo_extra(mod, perfil_xx, pack_xx, tmp_path):
    pack = _mutante_copia(pack_xx, tmp_path, "extra")
    _escribir_json(pack / "extra.json", {"hola": "mundo"})
    informe = mod.validar_pack(pack, perfil_xx)
    assert "archivo_no_listado" in informe["niveles"]["C0"]["conteosErrores"]


def test_c0_ruta_insegura(mod, perfil_xx, pack_xx, tmp_path):
    pack = _mutante_copia(pack_xx, tmp_path, "insegura")
    man = json.loads((pack / "MANIFEST.json").read_bytes())
    man["files"].append({"path": "../x.txt", "bytes": 0, "sha256": "0" * 64})
    _escribir_json(pack / "MANIFEST.json", man)
    informe = mod.validar_pack(pack, perfil_xx)
    assert "archivo_inseguro" in informe["niveles"]["C0"]["conteosErrores"]


def test_c0_symlink(mod, perfil_xx, pack_xx, tmp_path):
    pack = _mutante_copia(pack_xx, tmp_path, "symlink")
    os.symlink("pack.json", pack / "enlace.json")
    informe = mod.validar_pack(pack, perfil_xx)
    assert "symlink_en_pack" in informe["niveles"]["C0"]["conteosErrores"]


def test_c0_atribucion_alterada(mod, perfil_xx, pack_xx, tmp_path):
    pack = _mutante_copia(pack_xx, tmp_path, "atribucion")
    man = json.loads((pack / "MANIFEST.json").read_bytes())
    man["source"] = "Otra atribución inventada"
    _escribir_json(pack / "MANIFEST.json", man)
    informe = mod.validar_pack(pack, perfil_xx)
    assert "manifiesto_core_distinto" in informe["niveles"]["C0"]["conteosErrores"]


# ------------------------------------------------------------- 9: mutantes C1

def _reescribir_nodo(pack: Path, relativo: str, fn) -> None:
    p = pack / relativo
    nodo = json.loads(p.read_bytes())
    fn(nodo)
    _escribir_json(p, nodo)


def test_c1_id_articulo(mod, perfil_xx, pack_xx, tmp_path):
    pack = _mutante_copia(pack_xx, tmp_path, "idart")
    _reescribir_nodo(pack, "articulos/articulo_xx-ley-1_art_0001.json",
                     lambda n: n.__setitem__("@id", n["@id"] + "x"))
    informe = mod.validar_pack(pack, perfil_xx)
    assert "id_no_reacuna" in informe["niveles"]["C1"]["conteosErrores"]


def test_c1_tipo_arista_foo(mod, perfil_xx, pack_xx, tmp_path):
    pack = _mutante_copia(pack_xx, tmp_path, "foo")
    _reescribir_nodo(pack, "edges/edge_00001_contains.json",
                     lambda n: n.__setitem__("type", "FOO"))
    informe = mod.validar_pack(pack, perfil_xx)
    assert "tipo_arista_desconocido" in informe["niveles"]["C1"]["conteosErrores"]


def test_c1_clave_no_declarada(mod, perfil_xx, pack_xx, tmp_path):
    pack = _mutante_copia(pack_xx, tmp_path, "clave")
    _reescribir_nodo(pack, "normas/norma_xx-ley-1.json",
                     lambda n: n.__setitem__("campoInventado", "x"))
    informe = mod.validar_pack(pack, perfil_xx)
    assert "termino_no_declarado" in informe["niveles"]["C1"]["conteosErrores"]


def test_c1_tipo_norma_fuera_perfil(mod, perfil_xx, pack_xx, tmp_path):
    pack = _mutante_copia(pack_xx, tmp_path, "tiponorma")
    _reescribir_nodo(pack, "normas/norma_xx-ley-1.json",
                     lambda n: n["eli"].__setitem__("type", "constitucion"))
    informe = mod.validar_pack(pack, perfil_xx)
    assert "tipo_norma_desconocido" in informe["niveles"]["C1"]["conteosErrores"]


def test_c1_text_sha(mod, perfil_xx, pack_xx, tmp_path):
    pack = _mutante_copia(pack_xx, tmp_path, "sha")
    _reescribir_nodo(pack, "articulos/articulo_xx-ley-1_art_0001.json",
                     lambda n: n.__setitem__("textSha256", "0" * 64))
    informe = mod.validar_pack(pack, perfil_xx)
    assert "text_sha_distinto" in informe["niveles"]["C1"]["conteosErrores"]


def test_c1_pack_json_ausente(mod, perfil_xx, pack_xx, tmp_path):
    pack = _mutante_copia(pack_xx, tmp_path, "sinpackjson")
    (pack / "pack.json").unlink()
    informe = mod.validar_pack(pack, perfil_xx)
    assert "formato_ausente" in informe["niveles"]["C1"]["conteosErrores"]
    assert "archivo_ausente" in informe["niveles"]["C0"]["conteosErrores"]


# ------------------------------------------------------------- 10: construir xx

def test_construir_force_rebuild_identico(mod, perfil_xx, tmp_path):
    salida = tmp_path / "pack"
    mod.construir(PERFIL_XX, PAQUETE_XX, salida, obtenido=OBTENIDO)
    manifiesto1 = (salida / "MANIFEST.json").read_bytes()
    mod.construir(PERFIL_XX, PAQUETE_XX, salida, obtenido=OBTENIDO, force=True)
    assert (salida / "MANIFEST.json").read_bytes() == manifiesto1


def test_construir_force_archivo_ajeno(mod, perfil_xx, tmp_path):
    salida = tmp_path / "pack"
    mod.construir(PERFIL_XX, PAQUETE_XX, salida, obtenido=OBTENIDO)
    ajeno = salida / "notas.txt"
    ajeno.write_text("contenido ajeno", encoding="utf-8")
    with pytest.raises(ValueError, match="ajenos"):
        mod.construir(PERFIL_XX, PAQUETE_XX, salida, obtenido=OBTENIDO, force=True)
    assert ajeno.read_text(encoding="utf-8") == "contenido ajeno"


def test_gate_privacidad_falla_cerrado(mod, perfil_xx, tmp_path, monkeypatch):
    sub = sys.modules["dike_ordenamiento.construir"]
    monkeypatch.setattr(sub, "_cargar_privacidad", lambda: None)
    config = _config_minima(tmp_path, texto="Artículo 1. Texto de prueba que cierra bien.")
    with pytest.raises(ValueError, match="no se pudo cargar el detector"):
        mod.construir(perfil_xx, config, tmp_path / "pack", obtenido=OBTENIDO)


def test_construir_ficticio_determinista(mod, perfil_xx, tmp_path):
    salida1 = tmp_path / "pack1"
    salida2 = tmp_path / "pack2"
    mod.construir(PERFIL_XX, PAQUETE_XX, salida1, obtenido=OBTENIDO)
    mod.construir(PERFIL_XX, PAQUETE_XX, salida2, obtenido=OBTENIDO)
    assert (salida1 / "MANIFEST.json").read_bytes() == \
        (salida2 / "MANIFEST.json").read_bytes()

    informe = mod.validar_pack(salida1, perfil_xx)
    assert informe["nivelAlcanzado"] == "C1", informe["niveles"]["C1"]["errores"][:3]
    por_tipo = informe["niveles"]["C1"]["conteos"]["porTipo"]
    assert por_tipo["LegalResource"] == 2
    assert por_tipo["Article"] == 5

    ctx_pack = json.loads((salida1 / "context.jsonld").read_bytes())
    for sub in ("normas", "articulos", "vigencia", "edges", "provenance"):
        for p in sorted((salida1 / sub).glob("*.json")):
            nodo = json.loads(p.read_bytes())
            assert mod.claves_no_definidas(nodo, ctx_pack) == [], p


# ------------------------------------------------------------- 11: M1 rutas

def _resolver(mod, spec, cfg_dir):
    import importlib
    cons = importlib.import_module("dike_ordenamiento.construir")
    return cons._resolver_articulos_archivo(spec, Path(cfg_dir))


def test_m1_rutas(mod, tmp_path):
    cfg_dir = tmp_path / "cfg"
    (cfg_dir / "textos").mkdir(parents=True)
    (cfg_dir / "textos" / "x.txt").write_text("texto", encoding="utf-8")

    with pytest.raises(ValueError, match="fuera del directorio"):
        _resolver(mod, {"articulosArchivo": "../x.txt"}, cfg_dir)
    with pytest.raises(ValueError, match="relativo"):
        _resolver(mod, {"articulosArchivo": str(tmp_path / "x.txt")}, cfg_dir)

    afuera = tmp_path / "afuera.txt"
    afuera.write_text("x", encoding="utf-8")
    os.symlink(afuera, cfg_dir / "textos" / "enlace.txt")
    with pytest.raises(ValueError, match="symlink"):
        _resolver(mod, {"articulosArchivo": "textos/enlace.txt"}, cfg_dir)

    (cfg_dir / "real").mkdir()
    (cfg_dir / "real" / "x.txt").write_text("x", encoding="utf-8")
    os.symlink("real", cfg_dir / "alias")
    resuelto = _resolver(mod, {"articulosArchivo": "alias/x.txt"}, cfg_dir)
    assert resuelto.is_file()


# ------------------------------------------------- 12-14: reglas del constructor

def _config_minima(tmp_path, texto_archivo="articulos.txt", texto=None):
    cfg_dir = tmp_path / "cfgmin"
    cfg_dir.mkdir(parents=True, exist_ok=True)
    if texto is not None:
        (cfg_dir / texto_archivo).write_text(texto, encoding="utf-8")
    config = {
        "formato": "dike-paquete-normas-v1",
        "datasetVersion": "2026-11-09",
        "normas": [{
            "idFuente": "xx-ley-1", "tipo": "ley", "numero": "1", "anio": 2020,
            "titulo": "Ley mínima de prueba", "fuenteUri": "https://example.invalid/x",
            "fuenteDocumentoUrl": "https://example.invalid/x.pdf",
            "vigenteDesde": "2020-01-01", "fechaPublicacion": "2020-01-15",
            "articulosArchivo": texto_archivo,
        }],
    }
    cfg_path = cfg_dir / "config.json"
    _escribir_json(cfg_path, config)
    return cfg_path


def test_salida_no_vacia(mod, perfil_xx, tmp_path):
    config = _config_minima(tmp_path, texto="Artículo 1. Texto de prueba que cierra bien.")
    salida = tmp_path / "salida"
    salida.mkdir()
    (salida / "ocupa.txt").write_text("x")
    with pytest.raises(ValueError, match="no vacío"):
        mod.construir(perfil_xx, config, salida, obtenido=OBTENIDO)
    with pytest.raises(ValueError, match="ajenos"):
        mod.construir(perfil_xx, config, salida, obtenido=OBTENIDO, force=True)
    assert (salida / "ocupa.txt").read_text() == "x"


def _rut_valido() -> str:
    spec = importlib.util.spec_from_file_location(
        "dike_privacidad", ROOT / "privacidad" / "__init__.py",
        submodule_search_locations=[str(ROOT / "privacidad")])
    pv = importlib.util.module_from_spec(spec)
    sys.modules.setdefault("dike_privacidad", pv)
    spec.loader.exec_module(pv)
    for cuerpo in range(10000000, 99999999):
        digitos = str(cuerpo)
        total, factor = 0, 2
        for c in reversed(digitos):
            total += int(c) * factor
            factor = factor + 1 if factor < 7 else 2
        resto = 11 - (total % 11)
        dv = "0" if resto == 11 else "k" if resto == 10 else str(resto)
        if pv.dv_rut_valido(digitos, dv):
            return f"{digitos[:2]}.{digitos[2:5]}.{digitos[5:]}-{dv}"
    raise AssertionError("sin RUT válido")


def test_texto_con_rut_rechazado(mod, perfil_cl, tmp_path):
    rut = _rut_valido()
    texto = f"Artículo 1. Comparece el titular {rut} en este ejemplo sintético."
    config = _config_minima(tmp_path / "rut", texto=texto)
    with pytest.raises(ValueError) as excinfo:
        mod.construir(perfil_cl, config, tmp_path / "rut" / "pack", obtenido=OBTENIDO)
    mensaje = str(excinfo.value)
    assert "identificador personal" in mensaje
    assert rut not in mensaje


def test_sin_articulos_y_truncado(mod, perfil_xx, tmp_path):
    config = _config_minima(tmp_path / "vacío", texto="Texto sin encabezados de artículo.")
    with pytest.raises(ValueError, match="sin artículos"):
        mod.construir(perfil_xx, config, tmp_path / "vacío" / "pack", obtenido=OBTENIDO)

    config = _config_minima(tmp_path / "truncado",
                            texto="Artículo 1. Esta frase queda cortada sin cierre")
    with pytest.raises(ValueError, match="truncado"):
        mod.construir(perfil_xx, config, tmp_path / "truncado" / "pack", obtenido=OBTENIDO)


# ------------------------------------------------------------- 15: claves JSON-LD

def test_claves_no_definidas(mod, perfil_cl, chile_base):
    ctx_pack = json.loads((chile_base / "context.jsonld").read_bytes())
    muestra_lr = json.loads(sorted((chile_base / "normas").glob("*.json"))[0].read_bytes())
    perdidas = mod.claves_no_definidas(muestra_lr, ctx_pack)
    assert "title" in perdidas and "temporal" in perdidas

    ctx_efectivo = mod.contexto_efectivo(perfil_cl)
    muestras = []
    for sub in ("normas", "articulos", "vigencia", "edges", "provenance"):
        archivos = sorted((chile_base / sub).glob("*.json"))
        muestras.append(json.loads(archivos[0].read_bytes()))
        muestras.append(json.loads(archivos[len(archivos) // 2].read_bytes()))
    for nodo in muestras:
        assert mod.claves_no_definidas(nodo, ctx_efectivo) == [], nodo.get("@id")


# ------------------------------------------------------------- 16: CLI

def test_cli(mod, perfil_xx, tmp_path):
    script = ROOT / "scripts" / "ordenamiento.py"
    py = sys.executable

    plantilla_dir = tmp_path / "cli-plantilla"
    r = subprocess.run([py, str(script), "plantilla", "--jur", "xx", "--dir", str(plantilla_dir)],
                       capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    assert (plantilla_dir / "perfil-xx.json").is_file()
    assert (plantilla_dir / "paquete.json").is_file()

    r = subprocess.run([py, str(script), "validar-perfil", str(PERFIL_CL)],
                       capture_output=True, text=True)
    assert r.returncode == 0, r.stdout + r.stderr

    r = subprocess.run([py, str(script), "validar-perfil", str(plantilla_dir / "perfil-xx.json")],
                       capture_output=True, text=True)
    assert r.returncode == 1

    salida = tmp_path / "cli-pack"
    r = subprocess.run([py, str(script), "construir", "--perfil", str(PERFIL_XX),
                        "--config", str(PAQUETE_XX), "--salida", str(salida),
                        "--obtenido", OBTENIDO], capture_output=True, text=True)
    assert r.returncode == 0, r.stdout + r.stderr

    r = subprocess.run([py, str(script), "validar-pack", "--perfil", str(PERFIL_XX),
                        "--pack", str(salida)], capture_output=True, text=True)
    assert r.returncode == 0, r.stdout + r.stderr

    # un mutante debe dar exit 1
    _reescribir_nodo(salida, "normas/norma_xx-ley-1.json",
                     lambda n: n["eli"].__setitem__("type", "constitucion"))
    r = subprocess.run([py, str(script), "validar-pack", "--perfil", str(PERFIL_XX),
                        "--pack", str(salida)], capture_output=True, text=True)
    assert r.returncode == 1


# ------------------------------------------------------------- 17: skill

def test_skill_existe():
    skill = ROOT / "skills" / "dike-ordenamiento" / "SKILL.md"
    assert skill.is_file()
    texto = skill.read_text(encoding="utf-8")
    frontmatter = texto.split("---", 2)[1]
    assert re.search(r"^name:", frontmatter, re.MULTILINE)
    assert re.search(r"^description:", frontmatter, re.MULTILINE)


@pytest.mark.parametrize('misma_fuente', [True, False])
def test_constructor_rechaza_identidades_duplicadas(mod, perfil_xx, tmp_path, misma_fuente):
    cfg = json.loads(PAQUETE_XX.read_text())
    primera = cfg['normas'][0]
    otra = copy.deepcopy(primera)
    if not misma_fuente:
        otra['idFuente'] = 'otra-fuente'
    cfg['normas'] = [primera, otra]
    config = tmp_path / 'paquete.json'
    shutil.copytree(EJEMPLO / 'textos', tmp_path / 'textos')
    config.write_text(json.dumps(cfg))
    with pytest.raises(ValueError, match='duplicad'):
        mod.construir(perfil_xx, config, tmp_path / 'salida')
    assert not (tmp_path / 'salida').exists()


def test_c1_no_oculta_nodos_con_el_mismo_id(mod, perfil_xx, pack_xx, tmp_path):
    pack = _copia_pack(pack_xx, tmp_path / 'duplicado')
    norma = next((pack / 'normas').glob('*.json'))
    duplicado = json.loads(norma.read_text())
    duplicado['title'] = 'Texto que contradice la otra fuente'
    _escribir_json(pack / 'normas' / 'otra.json', duplicado)
    informe = mod.validar_pack(pack, perfil_xx)
    assert 'id_duplicado' in informe['niveles']['C1']['conteosErrores']


@pytest.mark.parametrize('ruta,valor', [
    (('nombre',), 42), (('normas', 'patronArticulo'), None),
    (('normas',), []), (('identidad', 'fuentesOficiales'), [None]),
    (('vigencia', 'desconocidaPermitida'), 1),
    (('normas', 'tipos'), [{'codigo': 'ley', 'nombre': 'Ley', 'nivel': True}]),
    (('perfil',), 'invalid'),
    (('extensiones',), [{'termino': 'nuevo', 'mapeaA': 'Article', 'relacion': 'inventada'}]),
])
def test_perfil_rechaza_tipos_enums_y_patrones(mod, perfil_xx, ruta, valor):
    perfil = copy.deepcopy(perfil_xx)
    nodo = perfil
    for clave in ruta[:-1]:
        nodo = nodo[clave]
    nodo[ruta[-1]] = valor
    errores = mod.validar_perfil(perfil)
    assert errores
    assert any(e['ruta'].startswith('$.' + ruta[0]) for e in errores)


@pytest.mark.parametrize('forma', ['absoluta', 'padre', 'enlace'])
def test_referencias_no_leen_fuera_del_plugin(mod, perfil_xx, tmp_path, monkeypatch, forma):
    raiz = tmp_path / 'plugin'
    raiz.mkdir()
    externo = tmp_path / 'externo.txt'
    externo.write_text('referencia sintética')
    (raiz / 'enlace').symlink_to(externo)
    perfil_mod = sys.modules['dike_ordenamiento.perfil']
    monkeypatch.setattr(perfil_mod, 'RAIZ', raiz)
    ruta = {'absoluta': str(externo), 'padre': '../externo.txt', 'enlace': 'enlace'}[forma]
    perfil = copy.deepcopy(perfil_xx)
    perfil['referencias'] = {'materias': {'ruta': ruta, 'sha256': '0' * 64}}
    original = Path.read_bytes
    def leer(path):
        assert path != externo, 'leyó la referencia antes de comprobar su ubicación'
        return original(path)
    monkeypatch.setattr(Path, 'read_bytes', leer)
    assert 'referencia_insegura' in _codigos(mod.validar_perfil(perfil))
