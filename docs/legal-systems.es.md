<!-- vitrina:translation-of legal-systems.md sha256=e688baf80dde5ee743db92fa2ca11852e792a537aaceab21458d4e580606f845 -->
# Sistemas jurídicos (ordenamientos)

[English](legal-systems.md)

Diké modela grafos de normas para **sistemas jurídicos** (ordenamientos) mediante
un perfil declarativo (`dike-perfil-ordenamiento-v1`) y un vocabulario de núcleo
común v1. Chile es el perfil de referencia; un país ficticio `xx` viene como
ejemplo trabajado. Todo corre por `scripts/ordenamiento.py` (solo biblioteca
estándar, offline, sin descargas) y el pack que construye se valida nivel por
nivel.

## Los cuatro pasos

1. **Plantilla.** `python scripts/ordenamiento.py plantilla --jur xx --dir <dir>`
   escribe `perfil-xx.json` (campos `COMPLETAR`) y `paquete.json` (la config del
   constructor).
2. **Validar el perfil.** `validar-perfil <perfil.json>` devuelve errores con
   explicación y ruta JSON (`$.normas.tipos[2].nivel`); exit 0 si está limpio.
3. **Construir el pack.** `construir --perfil P --config C --salida DIR` divide
   cada texto de norma con el `patronArticulo` del perfil, acuña los IRI de los
   nodos con las plantillas del perfil, escribe JSON canónico y un MANIFEST con
   sha256 por archivo. Rechaza textos truncados, números de artículo
   duplicados o no positivos, packs vacíos, rutas `articulosArchivo` inseguras,
   y corre el detector de privacidad del plugin: un identificador personal
   crítico hace fallar la construcción.
4. **Validar el pack.** `validar-pack --perfil P --pack DIR [--texto]` emite el
   informe `dike-informe-compatibilidad-v1` y sale con 0 solo en nivel C1 o
   superior.

## Qué prueba el perfil `cl`

`ordenamiento/perfiles/cl.json` reproduce el pack público sellado
`corpus/chile-base-*.tar.gz`: C0 y C1 en verde, con 25 leyes, 8.544 artículos,
8.569 ventanas temporales y 17.068 aristas re-acuñadas desde las plantillas
del perfil — incluida la regla legada de ids de arista que el pack sellado
precede — y tres excepciones de año declaradas (códigos Ley Chile 1058072,
207436, 172986). La prueba es `tests/test_ordenamiento.py::test_chile_base_c1`.

## Niveles C0–C3

Los niveles son acumulativos; cada nivel tiene su prueba.

- **C0 formato y manifiesto** — JSON canónico; MANIFEST lista cada archivo con
  sha256 y bytes; `manifestCoreSha256` se recomputa; sin rutas inseguras; sin
  symlinks.
- **C1 núcleo** — `pack.json` declara un `format` reconocido y, en los packs
  `dike-ordenamiento-pack-v1`, el perfil declarado debe coincidir con el usado
  para validar; cada nodo es una clase del núcleo; las claves son términos del
  núcleo o extensiones declaradas; los `@id` se re-acuñan con las plantillas
  del perfil; la regla de año se cumple o hay una excepción declarada.
- **C2 vigencia y procedencia** — *aún no evaluado* (planificado; ver abajo).
- **C3 extensiones mapeadas** — *aún no evaluado* (planificado; ver abajo).

`nivelAlcanzado` informa el nivel más alto superado completo; C2/C3 siempre
leen `no_evaluado` y nunca cuentan como pase. El campo `gid` del informe declara
que los packs no `cl` aún no son verificables por la gramática dike-id (2.0.0
solo acepta `cl`): está declarado, no es un pase.

## Límites

- **Los packs no `cl` no se verifican todavía con `/dike-verificar`**: la
  gramática dike-id vendorizada solo acepta el prefijo `cl`, y `motor/` no lo
  toca este framework.
- **C2 y C3 no se evalúan**; los estados de vigencia más allá de la ventana
  declarada y el cumplimiento del mapeo de extensiones son trabajo futuro.
- **No hay constructor de sentencias** ni de actos administrativos; solo normas.
- **Nada se descarga**: los textos de las normas salen de la fuente oficial de
  cada país bajo sus propias condiciones.

## Qué viene después

> **Grafos de varios sistemas jurídicos (plan, no implementado).** Cada pack
> declara su perfil de sistema jurídico y su versión del núcleo. Un nivel de
> compatibilidad C3 garantiza que todo término propio de un sistema declara a
> qué término común corresponde y con qué relación (equivalente, más estrecho,
> más amplio o relacionado). Sobre esa base, una versión futura podrá: (1)
> **conectar** grafos mediante citas entre sistemas jurídicos, que hoy se
> marcan como «otro sistema» y no como error; (2) publicar **crosswalks**
> revisados por personas entre instituciones de dos sistemas, como tablas con
> evidencia y no como inferencias de un modelo; y (3) **comparar** sistemas
> jurídicos solo sobre los términos marcados como comparables. Los términos sin
> correspondencia quedan fuera de toda comparación, porque forzar una
> equivalencia sería inventar derecho. Nada de esto está construido. Un mapeo
> declarado no acredita que dos instituciones sean equivalentes en sus
> efectos: eso exige revisión jurídica, como todo lo que entra al grafo
> canónico.
