<!-- vitrina:translation-of README.md sha256=c879e3a0a3b9c405afaf03bc278ac663a08dd25056547a879a13f7ef4c0726e1 -->
# Diké para Hermes

[English](README.md)

Un plugin de Hermes Agent que verifica las citas de artículos de leyes chilenas de un
escrito contra una copia local sellada e identificada por hash de las normas, y se niega a
certificar lo que no puede probar.

## Estado

- **Entrada del hackathon** Hermes Agent Plugin Hackathon de Nous Research, **listada en el
  catálogo de plugins de Hermes** ([pull
  request](https://github.com/NousResearch/hermes-agent/pull/150360)) en una versión
  anterior que trae solo la verificación de citas. Esta versión agrega el Case Writer de
  Desktop; mover el pin del catálogo requiere un nuevo pull request al catálogo.
- **Solo Linux.** Requiere Hermes Agent v0.23.0 o posterior.
- **El motor no es nuevo.** Es [Diké](https://github.com/Grizaceo/dike), vendorizado sin
  cambios; `VENDORED.json` indica el commit y el hash de cada archivo.
  [PREEXISTING.md](PREEXISTING.md) dice qué existía antes del hackathon y qué se construyó
  durante él.

## Inicio rápido

`hermes plugins install dike` instala el **pin del catálogo, la versión 0.2.0**: una release
anterior que trae solo la verificación de citas. Para esta versión, instala desde GitHub
fijada a un commit:

```bash
hermes plugins install Grizaceo/hermes-dike --ref <commit-de-40-caracteres>
hermes plugins enable dike
```

Un clon local funciona igual (`hermes plugins install file:///ruta/al/clon --ref
<commit-de-40-caracteres> --yes-deps`). Ejecuta `/dike-estado` para confirmar la
instalación. Después pídele a Hermes que revise las citas de un escrito, o corre tú la
verificación con el texto, o con la ruta de un archivo `.md`, `.txt` o `.docx`, tras el
comando:

```text
/dike-verificar Conforme al artículo 161 del Código del Trabajo y al artículo 9999 del Código del Trabajo.
```

La primera llamada desempaqueta y comprueba el corpus (cerca de un minuto). Después el
plugin funciona sin red: la primera verificación tras iniciar Hermes toma unos 13 segundos,
mientras el motor verifica el corpus, y las siguientes menos de un segundo. Las respuestas
salen en inglés; pon `idioma: es` en los ajustes del plugin para tenerlas en español. En la
app Desktop, activa la página en **Capabilities → Plugins**.

## Cómo funciona

### Por qué es un plugin y no un prompt

Pregúntale a un modelo si existe el artículo 9999 del Código del Trabajo y puede contestar
cualquier cosa con seguridad. Diké responde desde un corpus sellado y, cuando no tiene
evidencia, lo dice. Un prompt puede pedirle a un modelo que tenga cuidado. No puede:

- cargar 8.544 artículos de 25 normas y comprobar sus hashes antes de responder;
- dar siempre la misma respuesta, con la red apagada;
- negarse por contrato, para que una cita ambigua o desconocida nunca pase;
- impedir que el modelo use herramientas al hablar de un escrito (requiere hooks);
- seudonimizar un escrito antes de que salga y registrar un hash de lo que salió.

### La verificación de citas

1. El agente recibe tres herramientas. `dike_verificar_citas` acepta `texto` (el texto) o
   `ruta` (un archivo); `/dike-verificar` corre la misma verificación sin modelo. Dos
   compañeras de solo lectura sirven el corpus: `dike_leer_articulo` devuelve el texto y las
   unidades normativas de un artículo, y `dike_buscar_corpus` corre una búsqueda léxica
   determinista cuyos resultados son pistas, nunca citas verificadas.
2. El motor corre en un proceso hijo con un entorno mínimo, sin credenciales del agente y,
   cuando hay bubblewrap, dentro de un sandbox sin red. Encuentra cada cita de artículo y la
   resuelve contra el corpus: identidad, hash del texto y vigencia en la fecha de
   referencia. El motor vuelve a verificar todo el corpus cada vez que arranca, así que el
   plugin mantiene un proceso del motor por sesión, dentro del sandbox, que bifurca un hijo
   de vida corta por pedido; solo el primer pedido espera esa verificación.
3. El plugin valida la respuesta del motor contra un contrato fijo y falla cerrado: una
   respuesta mal formada es un error, nunca un pase. Además rechaza entradas con caracteres
   de control invisibles y no certifica una cita cuyo texto nombra dos normas distintas.

Sobre el escrito sintético de `tests/fixtures/escrito_demo.md`, con seis citas:

| Cita | Resultado |
|---|---|
| artículo 161, 162, 163 y 168 del Código del Trabajo | **verificadas**: identificador (`cl.norma.ct:art:0161`…), URL de la fuente en Ley Chile, SHA-256 del texto |
| artículo 60 | **rechazada**, `AMBIGUOUS`: no nombra la norma, y el artículo 60 existe en más de un código |
| artículo 9999 del Código del Trabajo | **rechazada**, `UNRESOLVABLE`: no está en el corpus |

`certificacion_sustantiva` y `certificacion_vigencia_actual` son siempre `false`: la
herramienta no comprueba que un artículo respalde el argumento, y el corpus es una copia
fechada (cada cita verificada lleva su fecha de obtención).

### La página de Desktop

Cuatro pestañas sobre el mismo motor, a través del backend del plugin en
`/api/plugins/dike`. La página está en inglés, con el español a un clic, y sigue el tema de
la app.

- **Case Writer.** Un editor de escritos donde solo el motor puede marcar una cita como
  verificada. Antes de que un texto salga de la máquina, un paso de seudonimización que ves
  y controlas reemplaza los datos personales por marcadores estables. Un chat sobre el
  escrito corre en tu propio gateway de Hermes; dos hooks del plugin le dan instrucciones
  fijas y bloquean toda herramienta salvo las skills, el descubrimiento de herramientas y
  las tres herramientas del plugin, que ahí aceptan solo texto. Las afirmaciones del chat
  sobre artículos llevan notas al pie que abren el nodo exacto del grafo para que revises el
  texto; si un artículo es pertinente es lectura del modelo y decisión tuya. Ver
  [docs/case-writer.es.md](docs/case-writer.es.md).
- **Grafo del corpus.** Un mapa 3D de solo lectura de las normas, sus artículos y sus
  unidades normativas mínimas, cada una con una etiqueta candidata (obligación, prohibición,
  permiso…) que asignan reglas regex, más la misma búsqueda léxica.
- **Tablero del caso.** La teoría del caso (hechos, normas, hipótesis y vacíos), versionada
  y con cada cambio atribuido. El chat puede proponer cambios; entran solo cuando los
  aceptas.
- **Ordenamientos y ajustes.** Valida packs de normas de otros ordenamientos a partir de un
  perfil declarativo; sus citas todavía no se pueden verificar
  ([docs/legal-systems.es.md](docs/legal-systems.es.md)).

Lo que lee, escribe y ejecuta: [docs/DISCLOSURES.md](docs/DISCLOSURES.md). Cómo está
organizado el código: [docs/architecture.md](docs/architecture.md).

## Cómo se construyó

- **Lo que decidí y revisé yo (Cristóbal Muñoz):** _lo completa el mantenedor._
- **Antes del hackathon:** el motor Diké y su corpus, y la primera versión de este adaptador
  con sus 73 tests, en la carpeta `hermes-plugin/` de
  [Grizaceo/dike](https://github.com/Grizaceo/dike) (octubre de 2026). Ver
  [PREEXISTING.md](PREEXISTING.md).
- **Escrito por IA durante el hackathon:**
  - Claude Code (Claude Opus 5.5) movió el adaptador aquí, escribió
    `scripts/vendor_engine.py` y el primer README, y después revisó la entrada como lo haría
    un jurado y corrigió lo que encontró.
  - Devin (Claude Opus 5.5) escribió la entrada del catálogo, la pestaña del Dashboard y la
    página de Desktop: tablero del caso, grafo 3D, Case Writer con sus hooks, módulo de
    privacidad y predictor, búsqueda por contenido y framework de ordenamientos.
  - En la última ronda Claude Code (Claude Fable 5.2) dirigió dos auditorías y escribió el
    servidor del motor y la hoja de estilos de la página; Codex (gpt-6.1-sol) corrigió el
    lado Python, reorganizó los tests y puso el texto del plugin en inglés; Devin
    (swe-2-flash-max) corrigió y tradujo las dos interfaces.
  - El detector de privacidad y la capa determinista del predictor se portaron de proyectos
    anteriores (fuentes y licencias en `VENDORED.json`).
- **Verificado por IA (todavía no lo comprobé yo)** (comandos y valores en
  [claims.json](claims.json)): las suites de tests en Hermes v0.23.0; `hermes plugins
  validate` y `doctor`; una instalación desde un clon local, con el escrito de demo
  verificado con la red apagada; los conteos del corpus, el bundle reproducible de Desktop,
  la latencia del servidor del motor y el benchmark de privacidad; dos turnos reales de chat
  en una sesión del Case Writer, donde se bloqueó el intento del modelo de usar la terminal.
- **No verificado:** macOS, versiones de Hermes anteriores a v0.23.0 y la página de Desktop
  dentro de la app después de la última ronda: se revisó en un arnés de navegador con los
  tokens de tema de la app (`desktop/dev/`).

## Límites

- **Derecho chileno, 25 normas, solo citas con artículo.** Las citas de otras normas vuelven
  sin verificar; una mención como «Ley 19.496» sin artículo va en `no_verificadas`. Para un
  `.pdf`, pasa su texto.
- **Inglés alrededor de derecho en español.** El texto propio del plugin está en inglés o en
  español. Los nombres de las normas, el texto de los artículos, los mensajes y códigos de
  resultado del motor (`VERIFICADA`, `FALLO`…) y la revisión de lenguaje claro quedan en
  español.
- **Una copia fechada, no el texto oficial de hoy.** El corpus se tomó de Ley Chile en
  agosto de 2026. Cada respuesta lo identifica por `pack_hash` y da la fecha de obtención de
  cada fuente. La ausencia no prueba nada: una cita que el corpus no resuelve puede existir
  en la ley.
- **Una cita por oración o por línea.** Si dos citas quedan en líneas seguidas sin punto,
  coma ni viñeta, el motor puede pegarle la primera norma a la segunda cita. El plugin
  entonces no la certifica y explica por qué, en vez de adivinar.
- **Qué significa «comprobado por integridad».** Cada llamada compara los nombres, tamaños y
  fechas de modificación de los archivos del corpus instalado con el registro de la
  instalación, y recalcula todos los hashes cuando difieren; además, un SHA-256 completo
  corre una vez por proceso, y el motor verifica cada archivo cada vez que arranca su
  servidor. Un cambio que conserva tamaño y fecha de modificación se detecta en el siguiente
  arranque del servidor (tras 10 minutos sin uso, un día nuevo o un reinicio); hasta
  entonces el motor responde desde la copia que verificó en memoria.
- **Memoria y disco.** Unos 300 MB de disco por perfil de Hermes, y unos 170 MB de memoria
  mientras corre el servidor del motor.
- **Seudonimización, no anonimización.** El detector, basado en reglas, no encuentra todos
  los nombres sin contexto, así que te muestra candidatos. El mapa de marcadores se queda en
  esta máquina. Lee la vista previa antes de enviar.
- **El modelo del chat es el de tu perfil** (el perfil activo, o el fijado en
  `perfil_chat`). Los hooks mantienen al chat lejos de las herramientas; no hacen que el
  modelo acierte. El estado de una cita lo fija solo el motor.
- **Etiquetas y resultados de búsqueda son pistas.** Las etiquetas candidatas y las
  relaciones del grafo salen de reglas, sin validar hasta que las revise un abogado; la
  búsqueda es léxica (BM25), no semántica. La predicción es experimental y viene apagada.
- **Aislamiento y no firma.** El motor corre dentro de bubblewrap cuando está disponible, o
  en un modo degradado declarado si no. Diké puede firmar registros de citas verificadas;
  este plugin nunca lo hace y nunca toca claves de firma.

## Licencia

El código está bajo la [licencia MIT](LICENSE). El corpus en `corpus/` deriva de Ley Chile
(Biblioteca del Congreso Nacional de Chile) y no lo cubre la licencia MIT; sus términos y su
procedencia están en [corpus/README.md](corpus/README.md), copiado sin cambios desde
Grizaceo/dike (sus menciones de un `Dockerfile` y de `scripts/producto/` se refieren a ese
repositorio).
