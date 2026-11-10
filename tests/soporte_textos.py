"""Carga por ruta para las pruebas del catálogo y del backend."""
import importlib.util
from pathlib import Path

ROOT = Path(__file__).parents[1]


def cargar(nombre, ruta):
    spec = importlib.util.spec_from_file_location(nombre, ROOT / ruta)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod
