"""Framework de ordenamientos jurídicos: perfiles, núcleo v1, validador y constructor.

Se carga por ruta como paquete, con un nombre por copia del plugin
(``dike_ordenamiento_<firma>``; igual que ``privacidad/``): solo stdlib, sin red,
sin importar Hermes.
"""
from .acunacion import BASE, contexto_efectivo, id_arista, id_norma, id_unidad, id_vigencia, jur_efectivo
from .construir import construir
from .jsonld import claves_no_definidas
from .perfil import cargar_perfil, plantilla_paquete, plantilla_perfil, validar_perfil
from .validar import validar_pack

__all__ = [
    "BASE",
    "cargar_perfil",
    "claves_no_definidas",
    "construir",
    "contexto_efectivo",
    "id_arista",
    "id_norma",
    "id_unidad",
    "id_vigencia",
    "jur_efectivo",
    "plantilla_paquete",
    "plantilla_perfil",
    "validar_pack",
    "validar_perfil",
]
