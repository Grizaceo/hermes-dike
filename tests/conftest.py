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


@pytest.fixture(scope='module', autouse=True)
def cerrar_motores_del_modulo():
    yield
    aislamiento = sys.modules.get('dike_aislamiento')
    if aislamiento is not None:
        aislamiento.cerrar_servidores()


@pytest.fixture(scope='module')
def corpus_privado(corpus_instalado, tmp_path_factory):
    destino = tmp_path_factory.mktemp('corpus-privado')
    shutil.copytree(corpus_instalado, destino, dirs_exist_ok=True)
    return destino
