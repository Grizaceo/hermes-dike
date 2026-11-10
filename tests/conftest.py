"""Corpus real compartido solo por pruebas de lectura; motores cerrados por módulo."""
import importlib.util
import sys
import shutil
from pathlib import Path

import pytest

ROOT = Path(__file__).parents[1]


@pytest.fixture(scope='session')
def corpus_instalado(tmp_path_factory):
    datos = tmp_path_factory.mktemp('corpus-compartido')
    spec = importlib.util.spec_from_file_location('dike_corpus_tests', ROOT / '__init__.py')
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    mod._asegurar_corpus(datos)
    yield datos
    # Ningún consumidor de la fixture compartida puede alterar el corpus sellado.
    mod._PROC_VERIFIED.clear()
    mod._asegurar_corpus(datos)


@pytest.fixture(scope='module')
def adaptador_real(corpus_instalado, request):
    nombre = 'dike_integracion_' + request.module.__name__
    spec = importlib.util.spec_from_file_location(nombre, ROOT / '__init__.py')
    mod = importlib.util.module_from_spec(spec)
    sys.modules[nombre] = mod
    spec.loader.exec_module(mod)
    mod._carpeta_de_datos = lambda: corpus_instalado
    return mod


def _modulo_de_la_copia(base, ruta, paquete=False):
    """Réplica de ``__init__._modulo_de_esta_copia``: el mismo nombre por copia.

    tests/test_configuracion_runtime.py comprueba que ambas den el mismo módulo.
    """
    import hashlib
    archivos = sorted(ruta.parent.rglob('*.py')) if paquete else [ruta]
    partes = [str(ruta.resolve())]
    for f in archivos:
        st = f.stat()
        partes.append(f'{f.name}:{st.st_mtime_ns}:{st.st_size}')
    nombre = f"{base}_{hashlib.sha256('|'.join(partes).encode()).hexdigest()[:12]}"
    mod = sys.modules.get(nombre)
    if mod is None:
        spec = importlib.util.spec_from_file_location(nombre, ruta)
        mod = importlib.util.module_from_spec(spec)
        sys.modules[nombre] = mod
        spec.loader.exec_module(mod)
    return mod


@pytest.fixture(scope='session')
def modulo_de_la_copia():
    return _modulo_de_la_copia


@pytest.fixture(scope='module', autouse=True)
def cerrar_motores_del_modulo():
    yield
    for nombre, mod in list(sys.modules.items()):
        if nombre.startswith('dike_aislamiento') and hasattr(mod, 'cerrar_servidores'):
            mod.cerrar_servidores()


@pytest.fixture(scope='module')
def corpus_privado(corpus_instalado, tmp_path_factory):
    destino = tmp_path_factory.mktemp('corpus-privado')
    shutil.copytree(corpus_instalado, destino, dirs_exist_ok=True)
    return destino
