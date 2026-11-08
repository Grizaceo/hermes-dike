"""Goldset sintético portado de lexo-case-writer `piiMask.goldset.ts` @7c13a89 (MIT).

Ningún dato es real: RUT generados con DV módulo 11 sobre cuerpos inventados.
Cada caso declara `pii` (fragmentos que no pueden sobrevivir) y `keep`
(fragmentos legales que deben quedar intactos). Las categorías
`nombre_sin_contexto` y `nombre_fuera_de_lista` no se enmascaran solas en F2a:
van a `candidatos` para que el abogado decida (se mide que aparezcan ahí).
"""

from dike_privacidad.patrones import dv_rut_valido


def _dv(cuerpo: str) -> str:
    for d in "0123456789K":
        if dv_rut_valido(cuerpo, d):
            return d
    raise ValueError(cuerpo)


def _rut(cuerpo: str, con_puntos: bool = True) -> str:
    dv = _dv(cuerpo)
    if not con_puntos:
        return f"{cuerpo}-{dv}"
    b = cuerpo.zfill(8).lstrip("0") or "0"
    grupos = f"{int(b):,}".replace(",", ".")
    return f"{grupos}-{dv}"


R1 = _rut("15432876")
R2 = _rut("9876543", con_puntos=False)
R3 = _rut("20111222")

GOLDSET = [
    {"text": f"Comparece doña Ana Rojas Vidal, cédula {R1}, y expone.",
     "pii": [{"value": R1, "category": "rut"},
             {"value": "Ana Rojas Vidal", "category": "nombre_con_contexto"}],
     "keep": ["Comparece", "expone"]},
    {"text": f"El trabajador, RUT {R2}, ingresó el 1 de marzo.",
     "pii": [{"value": R2, "category": "rut"}], "keep": ["1 de marzo"]},
    {"text": "Se notificó al correo ana.rojas.v@ejemplo.cl y al fono +56 9 8765 4321.",
     "pii": [{"value": "ana.rojas.v@ejemplo.cl", "category": "email"},
             {"value": "8765 4321", "category": "telefono"}], "keep": ["Se notificó"]},
    {"text": "Teléfono fijo +56 2 2345 6789, celular 987654321.",
     "pii": [{"value": "2345 6789", "category": "telefono"},
             {"value": "987654321", "category": "telefono"}], "keep": []},
    {"text": f"La sociedad, representada por don Pedro Soto Lagos, RUT {R3}.",
     "pii": [{"value": "Pedro Soto Lagos", "category": "nombre_con_contexto"},
             {"value": R3, "category": "rut"}], "keep": ["La sociedad"]},

    {"text": "El demandante Luis Fernández Mora solicita la nulidad del despido.",
     "pii": [{"value": "Luis Fernández Mora", "category": "nombre_con_contexto"}],
     "keep": ["nulidad del despido"]},
    {"text": "La trabajadora Carla Muñoz Pinto fue despedida verbalmente.",
     "pii": [{"value": "Carla Muñoz Pinto", "category": "nombre_con_contexto"}],
     "keep": ["despedida verbalmente"]},
    {"text": "Declaró el perito Jorge Alarcón Ruiz ante el tribunal.",
     "pii": [{"value": "Jorge Alarcón Ruiz", "category": "nombre_con_contexto"}],
     "keep": ["ante el tribunal"]},
    {"text": "La señora Marta Ibáñez presentó el recurso.",
     "pii": [{"value": "Marta Ibáñez", "category": "nombre_con_contexto"}],
     "keep": ["presentó el recurso"]},
    {"text": "En lo principal, don JUAN PÉREZ SOTO deduce demanda.",
     "pii": [{"value": "JUAN PÉREZ SOTO", "category": "nombre_con_contexto"}],
     "keep": ["deduce demanda"]},
    {"text": "Demandante: Sofía Castro Leiva\nDemandado: Comercial Andes Ltda.",
     "pii": [{"value": "Sofía Castro Leiva", "category": "nombre_con_contexto"}],
     "keep": ["Demandado"]},
    {"text": "EL DEMANDADO ROBERTO PAREDES CID NO COMPARECIÓ.",
     "pii": [{"value": "ROBERTO PAREDES CID", "category": "nombre_con_contexto"}],
     "keep": []},

    {"text": "Rodrigo Díaz Fuentes firmó el contrato el 2 de enero.",
     "pii": [{"value": "Rodrigo Díaz Fuentes", "category": "nombre_sin_contexto"}],
     "keep": ["firmó el contrato"]},
    {"text": "Según Paula Herrera, el finiquito nunca se pagó.",
     "pii": [{"value": "Paula Herrera", "category": "nombre_sin_contexto"}],
     "keep": ["finiquito"]},
    {"text": "Correo enviado por Tomás Vergara a la jefatura.",
     "pii": [{"value": "Tomás Vergara", "category": "nombre_sin_contexto"}],
     "keep": ["a la jefatura"]},
    {"text": "El gerente Camila Rojas Araya visitó la faena el lunes.",
     "pii": [{"value": "Camila Rojas Araya", "category": "nombre_sin_contexto"}],
     "keep": ["visitó la faena"]},
    {"text": "Entrevistamos a Matías González Soto y a Valentina Pizarro.",
     "pii": [{"value": "Matías González Soto", "category": "nombre_sin_contexto"},
             {"value": "Valentina Pizarro", "category": "nombre_sin_contexto"}],
     "keep": ["Entrevistamos a"]},
    {"text": "VICENTE ARAYA MORALES firmó el finiquito sin reservas.",
     "pii": [{"value": "VICENTE ARAYA MORALES", "category": "nombre_sin_contexto"}],
     "keep": ["firmó el finiquito"]},
    {"text": "Informe de Javiera Contreras Núñez, recibido el lunes.",
     "pii": [{"value": "Javiera Contreras Núñez", "category": "nombre_sin_contexto"}],
     "keep": ["recibido el lunes"]},
    {"text": "Se reunió con Felipe Muñoz del Río en la oficina.",
     "pii": [{"value": "Felipe Muñoz del Río", "category": "nombre_sin_contexto"}],
     "keep": ["en la oficina"]},
    {"text": "Ximena Barrera comunicó el despido por correo.",
     "pii": [{"value": "Ximena Barrera", "category": "nombre_sin_contexto"}],
     "keep": ["comunicó el despido"]},
    {"text": "El contrato lo redactó Claudio Bravo Silva.",
     "pii": [{"value": "Claudio Bravo Silva", "category": "nombre_sin_contexto"}],
     "keep": ["El contrato lo redactó"]},
    {"text": "Declaró Eulalia Trincado ante la inspección.",
     "pii": [{"value": "Eulalia Trincado", "category": "nombre_fuera_de_lista"}],
     "keep": ["ante la inspección"]},
    {"text": "Wilfredo Painemal Huenchumilla recibió la carta.",
     "pii": [{"value": "Wilfredo Painemal Huenchumilla", "category": "nombre_fuera_de_lista"}],
     "keep": ["recibió la carta"]},
    {"text": "La testigo Yasna Calfuqueo no concurrió.",
     "pii": [{"value": "Yasna Calfuqueo", "category": "nombre_fuera_de_lista"}],
     "keep": ["no concurrió"]},

    {"text": "Domiciliado en calle Los Aromos N° 123, comuna de Ñuñoa.",
     "pii": [{"value": "Los Aromos N° 123", "category": "direccion"}],
     "keep": ["comuna de"]},
    {"text": "Con domicilio en Avenida Providencia 1234, oficina 501, Providencia.",
     "pii": [{"value": "Providencia 1234", "category": "direccion"}],
     "keep": []},
    {"text": "Vive en pasaje Las Lilas 45, depto. 302.",
     "pii": [{"value": "Las Lilas 45", "category": "direccion"}], "keep": []},
    {"text": "La oficina queda en Av. Los Leones 890.",
     "pii": [{"value": "Los Leones 890", "category": "direccion"}],
     "keep": ["La oficina queda"]},
    {"text": "Con domicilio en Huérfanos 1160, Santiago.",
     "pii": [{"value": "Huérfanos 1160", "category": "direccion"}], "keep": []},

    {"text": "Conforme al artículo 162 del Código del Trabajo y la Ley 20.417.",
     "pii": [], "keep": ["artículo 162", "Código del Trabajo", "Ley 20.417"]},
    {"text": "Causa RIT O-1234-2024 del Juzgado de Letras del Trabajo de Santiago.",
     "pii": [], "keep": ["RIT O-1234-2024", "Juzgado de Letras del Trabajo de Santiago"]},
    {"text": "La Corte Suprema acogió el recurso en la causa Rol 12.345-2023.",
     "pii": [], "keep": ["Corte Suprema", "Rol 12.345-2023"]},
    {"text": "El demandante interpuso recurso de apelación dentro de plazo.",
     "pii": [], "keep": ["interpuso recurso de apelación"]},
    {"text": "La demandada contestó la demanda y opuso excepciones.",
     "pii": [], "keep": ["contestó la demanda"]},
    {"text": "Decreto Supremo N° 40 de 2012, a fojas 123 del expediente.",
     "pii": [], "keep": ["N° 40", "fojas 123"]},
    {"text": "Se prohíbe estacionar en la calle o camino público a menos de 10 metros.",
     "pii": [], "keep": ["calle o camino público", "10 metros"]},
    {"text": "El trabajador tiene derecho a 15 días hábiles de feriado.",
     "pii": [], "keep": ["15 días hábiles"]},
    {"text": "EN LO PRINCIPAL: DEMANDA; PRIMER OTROSÍ: ACOMPAÑA DOCUMENTOS.",
     "pii": [], "keep": ["EN LO PRINCIPAL", "ACOMPAÑA DOCUMENTOS"]},
    {"text": "El Juzgado de Letras de Santiago ordenó la notificación personal.",
     "pii": [], "keep": ["Juzgado de Letras de Santiago", "notificación personal"]},
    {"text": "La Corte de Apelaciones de San Miguel confirmó la sentencia.",
     "pii": [], "keep": ["Corte de Apelaciones de San Miguel"]},
    {"text": "Cruz Roja Chilena presentó un informe al Servicio de Impuestos Internos.",
     "pii": [], "keep": ["Cruz Roja Chilena", "Servicio de Impuestos Internos"]},
    {"text": "Conforme al Código Civil Chileno y la Constitución Política de la República.",
     "pii": [], "keep": ["Código Civil Chileno", "Constitución Política de la República"]},
    {"text": "Banco de Chile y Universidad de Chile fueron citados a declarar.",
     "pii": [], "keep": ["Banco de Chile", "Universidad de Chile"]},
    {"text": "El Hospital Santiago Oriente informó a la Superintendencia de Salud.",
     "pii": [], "keep": ["Hospital Santiago Oriente", "Superintendencia de Salud"]},
    {"text": "Ministerio de Justicia y Derechos Humanos, Región de Los Lagos.",
     "pii": [], "keep": ["Ministerio de Justicia y Derechos Humanos", "Región de Los Lagos"]},
    {"text": "El Tribunal Constitucional rechazó el requerimiento en la causa Rol 1234-2020.",
     "pii": [], "keep": ["Tribunal Constitucional", "Rol 1234-2020"]},
]
