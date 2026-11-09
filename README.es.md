<!-- vitrina:translation-of README.md sha256=66c1a226997c8c6b83faa7ca6140576e3ea1cb5ca6b1feb5f364f6ebc0aeb06f -->
# Diké para Hermes

[English](README.md)

Un plugin de Hermes Agent que verifica las citas de artículos de leyes chilenas
de un escrito contra una copia local sellada e identificada por hash de las
normas, y se niega a certificar lo que no puede probar.

## Estado

- **Entrada del hackathon** Hermes Agent Plugin Hackathon de Nous Research.
  **Está en el catálogo de plugins de Hermes**
  ([pull request](https://github.com/NousResearch/hermes-agent/pull/150360))
  en una versión anterior que trae solo la verificación de citas. Esta versión
  agrega el Case Writer de Desktop; mover el pin del catálogo a ella requiere
  un nuevo pull request al catálogo.
- **Solo Linux.** Requiere Hermes Agent v0.23.0 o posterior.
- **El motor no es nuevo.** Es [Diké](https://github.com/Grizaceo/dike),
  vendorizado sin cambios; `VENDORED.json` indica el commit y el hash de cada
  archivo. [PREEXISTING.md](PREEXISTING.md) dice qué existía antes del
  hackathon y qué se construyó durante él.

## Inicio rápido

```bash
hermes plugins install dike      # el pin revisado del catálogo
hermes plugins enable dike
```

`hermes plugins install Grizaceo/hermes-dike` instala en cambio el último
`main`, como fuente no revisada. Después pídele a Hermes que revise las citas
de un escrito, o corre tú la verificación con el texto tras el comando:

```text
/dike-verificar Conforme al artículo 161 del Código del Trabajo y al artículo 9999 del Código del Trabajo.
```

La primera llamada desempaqueta y comprueba el corpus en la carpeta de datos
del plugin, lo que toma cerca de un minuto; las siguientes funcionan sin red.
En la app Desktop, activa la página del plugin en **Capabilities → Plugins**
para tener el Case Writer.

## Cómo funciona

### Por qué es un plugin y no un prompt

Pregúntale a un modelo si existe el artículo 9999 del Código del Trabajo y
puede contestar cualquier cosa con seguridad. Diké responde desde un corpus
sellado y, cuando no tiene evidencia, lo dice. Un prompt o una skill pueden
pedirle a un modelo que tenga cuidado. No pueden:

- cargar 8.544 artículos de 25 normas y comprobar sus hashes antes de responder;
- dar siempre la misma respuesta, con la red apagada;
- negarse por contrato, para que una cita ambigua o desconocida nunca pase;
- impedir que el modelo use herramientas al hablar de un escrito (requiere hooks);
- seudonimizar un escrito antes de que salga y registrar un hash de lo que salió.

### La verificación de citas

1. El agente recibe una herramienta, `dike_verificar_citas`. Acepta `texto`
   (el texto) o `ruta` (un archivo `.md`, `.txt` o `.docx`).
   `/dike-verificar` corre la misma verificación sobre el texto que sigue al
   comando, sin modelo.
2. El plugin corre el motor como subproceso con un entorno mínimo, sin
   credenciales del agente y con su carpeta personal dentro de los datos del
   plugin. El motor encuentra cada cita de artículo y la resuelve contra el
   corpus: identidad, hash del texto y vigencia en la fecha de referencia.
3. El plugin valida la respuesta del motor contra un contrato fijo y falla
   cerrado: una respuesta mal formada es un error, nunca un pase. Además
   rechaza entradas con caracteres de control invisibles y no certifica una
   cita cuyo texto nombra dos normas distintas.

Sobre el escrito sintético de `tests/fixtures/escrito_demo.md`, con seis
citas:

| Cita | Resultado |
|---|---|
| artículo 161, 162, 163 y 168 del Código del Trabajo | **verificadas**: identificador (`cl.norma.ct:art:0161`…), URL de la fuente en Ley Chile, SHA-256 del texto |
| artículo 60 | **rechazada**, `AMBIGUOUS`: no nombra la norma, y el artículo 60 existe en más de un código |
| artículo 9999 del Código del Trabajo | **rechazada**, `UNRESOLVABLE`: no está en el corpus |

`certificacion_sustantiva` es siempre `false`: la herramienta no comprueba que
un artículo respalde el argumento. `certificacion_vigencia_actual` es siempre
`false`: el corpus es una copia fechada, y cada cita verificada lleva su fecha
de obtención.

### La página de Desktop

Tres pestañas sobre el mismo motor, a través del backend del plugin en
`/api/plugins/dike`:

- **Case Writer.** Un editor de escritos donde solo el motor puede marcar una
  cita como verificada. Antes de que un texto salga de la máquina, un paso de
  seudonimización que ves y controlas reemplaza los datos personales por
  marcadores estables. Un chat sobre el escrito corre en tu propio gateway de
  Hermes; dos hooks del plugin le dan instrucciones fijas y bloquean toda
  herramienta salvo las skills, el descubrimiento de herramientas y la
  verificación de citas, que ahí acepta solo texto. Ver
  [docs/case-writer.es.md](docs/case-writer.es.md).
- **Grafo del corpus.** Un mapa 3D de solo lectura de las normas, sus
  artículos y sus unidades normativas mínimas, cada una con una etiqueta
  candidata (obligación, prohibición, permiso…) que asignan reglas regex, más
  una búsqueda BM25 determinista cuyos resultados son pistas, nunca citas
  verificadas.
- **Tablero del caso.** La teoría del caso (hechos, normas, hipótesis y
  vacíos), versionada y con cada cambio atribuido. El chat puede proponer
  cambios; entran solo cuando los aceptas.

Lo que el plugin lee, escribe y ejecuta: [docs/DISCLOSURES.md](docs/DISCLOSURES.md).
Para otros ordenamientos, `scripts/ordenamiento.py` y la skill
`dike-ordenamiento` validan packs de normas a partir de un perfil
declarativo; sus citas todavía no se pueden verificar
([docs/legal-systems.es.md](docs/legal-systems.es.md)).

## Cómo se construyó

- **Lo que decidí y revisé yo (Cristóbal Muñoz):** _lo completa el
  mantenedor._
- **Antes del hackathon:** el motor Diké y su corpus, y la primera versión de
  este adaptador con sus 73 tests, en la carpeta `hermes-plugin/` de
  [Grizaceo/dike](https://github.com/Grizaceo/dike) (octubre de 2026). Ver
  [PREEXISTING.md](PREEXISTING.md).
- **Escrito por IA durante el hackathon:** Claude Code (Claude Opus 5.5) movió
  el adaptador a este repositorio, escribió `scripts/vendor_engine.py` y el
  primer README, y después revisó la entrada como lo haría un jurado y
  corrigió lo que encontró (las guardas de dos normas y de caracteres de
  control, tres huecos de los hooks del chat, estos documentos). Devin
  (Claude Opus 5.5) escribió la entrada del catálogo y el banner, la pestaña
  del Dashboard y la página de Desktop, el tablero del caso, el grafo 3D, el
  Case Writer con sus hooks, su módulo de privacidad y su predictor, la
  búsqueda por contenido y el framework de ordenamientos. El detector de
  privacidad y la capa determinista del predictor se portaron de proyectos
  anteriores (fuentes, commits y licencias en `VENDORED.json`).
- **Verificado por IA (todavía no lo comprobé yo)** (comandos y valores en
  [claims.json](claims.json)): la suite de tests en Hermes v0.23.0;
  `hermes plugins validate --install-deps` y `doctor` sobre este árbol; una
  instalación desde un clon local, con el escrito de demo verificado con la
  red apagada; los conteos del corpus, el bundle reproducible de Desktop y el
  benchmark de privacidad; dos turnos reales de chat en una sesión del Case
  Writer, donde se inyectaron las instrucciones y se bloqueó el intento del
  modelo de usar la terminal; para la versión del catálogo, la instalación
  desde GitHub y un modelo real que eligió la herramienta por su cuenta.
- **No verificado:** macOS, versiones de Hermes anteriores a v0.23.0 y un
  turno de chat escrito a mano en la app Desktop.

## Límites

- **Derecho chileno, 25 normas, solo citas con artículo.** Las citas de otras
  normas vuelven sin verificar; una mención como «Ley 19.496» sin artículo va
  en `no_verificadas`. La salida está en español.
- **Una copia fechada, no el texto oficial de hoy.** El corpus se tomó de Ley
  Chile en agosto de 2026. Cada respuesta lo identifica por `pack_hash` y da
  la fecha de obtención de cada fuente. La ausencia no prueba nada: una cita
  que el corpus no resuelve puede existir en la ley.
- **Una cita por oración o por línea.** Si dos citas quedan en líneas
  seguidas sin punto, coma ni viñeta, el motor puede pegarle la primera norma
  a la segunda cita. El plugin entonces no la certifica y explica por qué, en
  vez de adivinar.
- **No es instantáneo.** El motor arranca en cada llamada: unos 15 a 20
  segundos cada una, y cerca de un minuto la primera
  ([claims.json](claims.json)).
- **Qué significa «comprobado por integridad».** Cada llamada compara los
  nombres, tamaños y fechas de modificación de los archivos del corpus
  instalado con el registro de la instalación, y recalcula todos los hashes
  cuando difieren; además, un SHA-256 completo corre una vez por proceso. Un
  cambio que conserva tamaño y fecha de modificación se detecta al iniciar el
  siguiente proceso.
- **Disco.** Unos 300 MB por perfil de Hermes.
- **Seudonimización, no anonimización.** El detector se basa en reglas y no
  encuentra todos los nombres sin contexto, así que te muestra candidatos. El
  mapa de marcadores se queda en esta máquina. Lee la vista previa antes de
  enviar.
- **El modelo del chat es el de tu perfil.** El chat corre en el perfil
  llamado `lexo-lawyer` si existe y tiene Diké habilitado, o si no en el
  perfil activo. Los hooks mantienen al chat lejos de las herramientas; no
  hacen que el modelo acierte. El estado de una cita lo fija solo el motor.
- **Etiquetas y resultados de búsqueda son pistas.** Las etiquetas deónticas
  y las relaciones del grafo salen de reglas y quedan sin validar hasta que
  las revise un abogado; la búsqueda por contenido es léxica (BM25), no
  semántica. La predicción es experimental y viene apagada.
- **`.pdf` y otros formatos: pasa el texto.** `ruta` acepta `.md`, `.txt` y
  `.docx`.
- **Mover `plugin-data/dike` no migra el corpus.** Una carpeta de datos movida
  informa `SIN_CORPUS`; borra `plugin-data/dike/generations` y se reinstala en
  la siguiente llamada.
- **No es un sandbox, y no firma.** El subproceso conserva los permisos de tu
  sistema operativo. Diké puede firmar registros de citas verificadas; este
  plugin nunca lo hace y nunca toca claves de firma.

## Licencia

El código está bajo la [licencia MIT](LICENSE). El corpus en `corpus/` deriva
de Ley Chile (Biblioteca del Congreso Nacional de Chile) y no lo cubre la
licencia MIT; sus términos y su procedencia están en
[corpus/README.md](corpus/README.md). Ese archivo se copió sin cambios desde
Grizaceo/dike, así que sus menciones de un `Dockerfile`, de
`scripts/producto/` y del commit `a605d56` se refieren a ese repositorio.
