"""Privacidad del escrito (F2a): detección, seudónimos y registro de envíos.

Se carga por ruta desde `dashboard/plugin_api.py` como paquete
``dike_privacidad`` (ver ``_privacidad()`` allí) y desde los tests igual.
"""

from dike_privacidad.detector import (  # noqa: F401
    AVISO,
    ESTRATEGIAS,
    VERSION,
    candidatos_sin_contexto,
    detect_judge_names,
    detectar,
    normalizar_valor,
)
from dike_privacidad.patrones import PAQUETES, dv_rut_valido  # noqa: F401
from dike_privacidad.seudonimos import (  # noqa: F401
    decisiones,
    guardar_decision,
    seudonimizar,
)
from dike_privacidad.registro import registrar_envio  # noqa: F401
