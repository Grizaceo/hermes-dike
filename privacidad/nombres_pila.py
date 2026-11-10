"""Gazetteer de nombres de pila chilenos (sin tilde, minúsculas).

Procedencia: port verbatim del set ``NOMBRES_PILA`` de lexo-case-writer,
repo ``~/.hermes/profiles/lexo-alpha/_legal_repos/lexo-case-writer``,
commit ``7c13a89``, archivo ``src/lib/nombresPila.ts``
(sha256 ``ec1dc6bc3b648db05896db6b25aebda420c15b9d0c015a2df2a26179acb461bd``),
licencia MIT. Los nombres se copiaron programáticamente del TS (344).

Los usa ``detector`` para reconocer secuencias «Nombre Apellido» SIN
contexto procesal ni tratamiento (port de ``nombresSinContexto`` de
``piiMask.ts``): no es un NER ni un diccionario de apellidos — un nombre
de pila fuera de la lista no se enmascara por esta vía.
"""

from __future__ import annotations

NOMBRES_PILA: frozenset[str] = frozenset({
    "adriana", "agustin", "ailen", "alba", "alberto", "aldo", "alejandra", "alejandro", "alfonso", "alfredo",
    "alicia", "almendra", "amalia", "amanda", "amaro", "ana", "andrea", "andres", "angel", "angela",
    "angelica", "anibal", "antonella", "antonia", "antonio", "aracely", "ariela", "armando", "arturo", "aurelio",
    "aurora", "barbara", "bastian", "beatriz", "belen", "benjamin", "bernardita", "bernardo", "berta", "blanca",
    "braulio", "brenda", "bruno", "byron", "camila", "camilo", "candela", "carla", "carlos", "carmen",
    "carolay", "carolina", "catalina", "cecilia", "celeste", "cesar", "christian", "cinthia", "clara", "clarisa",
    "claudia", "claudio", "colomba", "constanza", "consuelo", "cristian", "cristina", "cristobal", "cristofer", "dafne",
    "daniel", "daniela", "dante", "dario", "david", "dayana", "delia", "denise", "diana", "diego",
    "dolores", "dominga", "edgardo", "edith", "edmundo", "eduardo", "elena", "eliana", "elias", "elisa",
    "elizabeth", "elsa", "emilia", "emiliano", "emilio", "emma", "enrique", "erika", "ernesto", "erwin",
    "esperanza", "esteban", "estefania", "ester", "eugenia", "eugenio", "eva", "evelyn", "exequiel", "fabian",
    "fabiola", "felipa", "felipe", "fernanda", "fernando", "fidel", "flavio", "florencia", "florencio", "francisca",
    "francisco", "franco", "freddy", "fresia", "gabriel", "gabriela", "gaspar", "genoveva", "gerardo", "german",
    "gilberto", "giovanna", "gladys", "gloria", "gonzalo", "grace", "graciela", "gregorio", "guillermo", "gustavo",
    "haydee", "hector", "helena", "hernan", "hugo", "humberto", "ida", "ignacio", "ines", "ingrid",
    "irene", "irma", "isaac", "isabel", "isidora", "ismael", "ivan", "ivette", "ivonne", "jacqueline",
    "jaime", "jairo", "javier", "javiera", "jeremy", "jessica", "jimena", "joaquin", "joel", "jonathan",
    "jorge", "jose", "josefa", "josefina", "juan", "juana", "julia", "julio", "karen", "karina",
    "karla", "katherine", "katia", "kevin", "laura", "leandro", "leonardo", "leonor", "leopoldo", "lidia",
    "lilian", "liliana", "lionel", "lisandro", "lissette", "lorena", "lorenzo", "lucas", "lucia", "lucio",
    "luis", "luisa", "luz", "macarena", "magdalena", "maite", "manuel", "mara", "marcela", "marcelo",
    "marco", "marcos", "margarita", "maria", "mariana", "mariela", "mario", "marisol", "marlene", "marta",
    "martin", "mateo", "matias", "matilde", "mauricio", "mauro", "maximiliano", "melissa", "mercedes", "miguel",
    "mireya", "miriam", "moises", "monica", "nahuel", "natalia", "nelson", "nestor", "nicolas", "nicole",
    "noemi", "nora", "norberto", "norma", "octavio", "odette", "olga", "omar", "orlando", "oscar",
    "osvaldo", "pablo", "paloma", "pamela", "paola", "patricia", "patricio", "patrick", "paula", "paulina",
    "paulo", "pedro", "penelope", "pia", "pilar", "priscila", "rafael", "ramon", "raul", "rebeca",
    "reinaldo", "renato", "rene", "ricardo", "rigoberto", "rita", "roberto", "robinson", "rocio", "rodolfo",
    "rodrigo", "rolando", "romina", "rosa", "rosario", "rosendo", "ruben", "ruth", "sabina", "sabrina",
    "salvador", "samanta", "samuel", "sandra", "sandro", "santiago", "sara", "saul", "sebastian", "segundo",
    "selena", "sergio", "silvana", "silvia", "silvio", "simon", "sofia", "sol", "soledad", "sonia",
    "stephanie", "susana", "tadeo", "tamara", "tania", "teodoro", "teresa", "tomas", "ulises", "ursula",
    "valentin", "valentina", "valeria", "vanessa", "vania", "veronica", "vicente", "victor", "victoria", "violeta",
    "viviana", "vladimir", "vladimiro", "waldo", "walter", "wendy", "wilson", "xavier", "ximena", "yasmin",
    "yerko", "yessica", "yolanda", "zoila"
})
