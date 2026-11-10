"""Privacidad del escrito: detección, seudónimos y registro de envíos.

Se carga por ruta como paquete, con un nombre por copia del plugin
(``dike_privacidad_<firma>``, ver ``_privacidad()`` en `dashboard/plugin_api.py`);
los tests lo cargan como ``dike_privacidad``. Por eso los imports internos son
relativos: no dependen del nombre con que se cargó.
"""

from .detector import (  # noqa: F401
    AVISO,
    ESTRATEGIAS,
    VERSION,
    candidatos_sin_contexto,
    detect_judge_names,
    detectar,
    normalizar_valor,
)
from .patrones import PAQUETES, dv_rut_valido  # noqa: F401
from .seudonimos import (  # noqa: F401
    decisiones,
    guardar_decision,
    seudonimizar,
)
from .registro import registrar_envio  # noqa: F401
