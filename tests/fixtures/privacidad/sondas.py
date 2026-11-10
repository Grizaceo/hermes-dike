"""Sondas de comportamiento del detector (SOLO datos sintéticos).

Copiadas de ``~/hermes-dike/.workshop/anonimizacion/matriz/matriz.py``
(función ``sondas()``, mismos textos). Cada sonda declara ``frags``:
fragmentos del texto con la cobertura esperada en estrategia ``estricta``:
``enmascarar`` (todos sus caracteres alfanuméricos dentro de entidades
``enmascarar``), ``conservar`` (intacto) y ``enmascarar_cola`` (solo la
cola tras el primer espacio se evalúa como ``enmascarar``).

Los RUT se generan con DV módulo 11 sobre cuerpos inventados, como en
``piimask_goldset.py``.
"""


def _dv(cuerpo: str) -> str:
    total, f = 0, 2
    for c in reversed(cuerpo):
        total += int(c) * f
        f = f + 1 if f < 7 else 2
    r = 11 - total % 11
    return "0" if r == 11 else "K" if r == 10 else str(r)


def _rut(cuerpo: str, puntos: bool = True) -> str:
    dv = _dv(cuerpo)
    if not puntos:
        return f"{cuerpo}-{dv}"
    return f"{int(cuerpo):,}".replace(",", ".") + f"-{dv}"


def sondas() -> list[dict]:
    rp, re_, rocr = _rut("15432876"), _rut("76543210"), _rut("10381620")
    sin_guion_ok = "15432876" + _dv("15432876")
    sin_guion_malo = "15432876" + str((int(_dv("15432876").replace("K", "10")) + 1) % 10)
    return [
        {"id": "rut_persona", "texto": f"El demandante Tomás Ibarra Lagos, RUN {rp}, domiciliado en la ciudad.",
         "frags": [(rp, "enmascarar"), ("Tomás Ibarra Lagos", "enmascarar")]},
        {"id": "rut_empresa", "texto": f"Inversiones Pehuén SpA, RUT {re_}, representada legalmente.",
         "frags": [(re_, "?"), ("Inversiones Pehuén SpA", "conservar")]},
        {"id": "ministro_de_fe", "texto": "Certificó el Ministro de Fe Rodrigo Salinas Pino la notificación.",
         "frags": [("Rodrigo Salinas Pino", "enmascarar")]},
        {"id": "jueces_sala", "texto": ("Pronunciada por la Segunda Sala de la Corte, integrada por los Ministros "
                                        "Sr. Arturo Venegas Rojas, Sra. Lucía Fernández Mora y el Abogado Integrante "
                                        "Sr. Ignacio Pardo Silva."),
         "frags": [("Arturo Venegas Rojas", "conservar"), ("Lucía Fernández Mora", "conservar"),
                   ("Ignacio Pardo Silva", "conservar")]},
        {"id": "rol_causa", "texto": "Vistos los autos Rol C-1234-2024 y RIT O-5678-2023 del tribunal.",
         "frags": [("C-1234-2024", "conservar"), ("O-5678-2023", "conservar")]},
        {"id": "rol_avaluo", "texto": "El inmueble rol de avalúo 1234-56 de la comuna de Ñuñoa fue embargado.",
         "frags": [("1234-56", "enmascarar")]},
        {"id": "ruc_con_cola", "texto": "Causa RUC 2400123456-7 de la Fiscalía Local.",
         "frags": [("2400123456-7", "conservar")]},
        {"id": "estructurales", "texto": "Comparece don Pedro Araya Soto\nPRIMERO: Que VISTOS y CONSIDERANDO lo expuesto.",
         "frags": [("Pedro Araya Soto", "enmascarar"), ("PRIMERO", "conservar"), ("VISTOS", "conservar"),
                   ("CONSIDERANDO", "conservar")]},
        {"id": "ocr_pegado", "texto": f"cédula Nº{rp.replace('.', '', 0)} y otra l{rocr[1:]} ilegible",
         "frags": [(rp, "enmascarar"), ("l" + rocr[1:], "enmascarar")]},
        {"id": "rut_sin_guion", "texto": f"RUN {sin_guion_ok} y folio {sin_guion_malo} del expediente.",
         "frags": [(sin_guion_ok, "enmascarar"), (sin_guion_malo, "conservar")]},
        {"id": "propagacion", "texto": ("La demandada Carla Mendoza Ruiz no asistió. Luego Mendoza Ruiz declaró. "
                                        "Firma: CARLA MENDOZA RUIZ."),
         "frags": [("Carla Mendoza Ruiz", "enmascarar"), ("Luego Mendoza Ruiz", "enmascarar_cola"),
                   ("CARLA MENDOZA RUIZ", "enmascarar")]},
        {"id": "sin_contexto", "texto": "Ayer llegó Joaquín Errázuriz Montt a la audiencia.",
         "frags": [("Joaquín Errázuriz Montt", "enmascarar")]},
        {"id": "direccion", "texto": "Domiciliado en calle Los Aromos 1234, Ñuñoa, Región Metropolitana.",
         "frags": [("Los Aromos 1234", "enmascarar")]},
        {"id": "contacto", "texto": "Fono +56 9 8765 4321, fijo +56 2 2345 6789, correo contacto.x@ejemplo.cl.",
         "frags": [("+56 9 8765 4321", "enmascarar"), ("+56 2 2345 6789", "enmascarar"),
                   ("contacto.x@ejemplo.cl", "enmascarar")]},
        {"id": "acentos", "texto": "Comparece el Sr. Íñigo Muñoz Núñez en representación.",
         "frags": [("Íñigo Muñoz Núñez", "enmascarar")]},
        {"id": "sensible", "texto": "El imputado padece esquizofrenia paranoide; hubo violencia intrafamiliar.",
         "frags": [("esquizofrenia paranoide", "enmascarar"), ("violencia intrafamiliar", "enmascarar")]},
        {"id": "ancho_cero", "texto": f"RUN 15.432\u200b.876-{_dv('15432876')} del actor.",
         "frags": [(f"15.432\u200b.876-{_dv('15432876')}", "enmascarar")]},
        {"id": "jueza_y_parte", "texto": "Ante la Jueza Marcela Godoy Paz y el Sr. Pablo Ortiz Leal, en representación.",
         "frags": [("Marcela Godoy Paz", "conservar"), ("Pablo Ortiz Leal", "enmascarar")]},
    ]


SONDAS = sondas()
