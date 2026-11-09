<!-- vitrina:translation-of README.md sha256=10329205678f406913b6bea77663bc7fcbfe64521a06a2a2b92872c76f999204 -->
# Diké para Hermes

[English](README.md)

Un plugin de Hermes Agent que contrasta las citas de artículo de la ley chilena
de un escrito jurídico con una copia local de las normas identificada por hash,
y se niega a certificar lo que no puede probar.

## Estado

- **Entrada de hackathon** para el Hermes Agent Plugin Hackathon de Nous
  Research (noviembre de 2026). Enviado al catálogo de plugins de Hermes en
  [NousResearch/hermes-agent#150360](https://github.com/NousResearch/hermes-agent/pull/150360);
  todavía no aparece en él.
- **Solo Linux.** Probado con Hermes Agent v0.23.0 (requires_hermes
  `>=0.23.0`). Versión 0.7.0: la página Desktop abre en un **Case Writer**
  — un editor de escritos con la revisión de citas como módulo, un paso de
  seudonimización que ves y controlas, un chat sobre el escrito que corre en
  tu propio Hermes y propuestas de NIF que aceptas una por una — junto al
  grafo 3D del corpus de 25 leyes y al tablero de caso.
- **El motor no es nuevo.** Es [Diké](https://github.com/Grizaceo/dike),
  copiado sin cambios; `VENDORED.json` indica el commit y el hash de cada
  archivo. [PREEXISTING.md](PREEXISTING.md) dice qué existía antes del
  hackathon y qué se hizo durante él.
- **Perfiles de sistemas jurídicos (framework, aditivo).** `ordenamiento/`
  permite que un pack declare su perfil jurisdiccional y lo valida nivel por
  nivel (C0–C1 hoy, C2–C3 planificados); Chile es el perfil de referencia. Ver
  [docs/legal-systems.md](docs/legal-systems.md). Los packs no `cl` aún no
  se verifican con `/dike-verificar`.

## Cómo correrlo

```bash
hermes plugins install Grizaceo/hermes-dike
hermes plugins enable dike
```

Después pídele a Hermes que revise las citas de un escrito, o corre la
herramienta tú mismo con el texto después del comando:

```text
/dike-verificar Conforme al artículo 161 del Código del Trabajo y al artículo 9999 del Código del Trabajo.
```

La primera llamada desempaca y revisa el corpus en la carpeta de datos del
plugin, y tarda un rato. Las siguientes funcionan sin red.

La misma revisión tiene además una pestaña **Diké** en el dashboard web y una
página en la barra lateral de la app Desktop (la mitad de escritorio es
optativa: actívala en Capabilities → Plugins). La página Desktop tiene tres
pestañas: el **Case Writer**, un mapa de solo lectura del grafo del corpus
sellado (sus 25 normas, 8.544 artículos y aristas) con búsqueda por
contenido sobre los artículos — chips de materia que explican qué materias
activó la consulta, qué términos las encendieron y si cada resultado es
ancla o territorio de ellas, sin reordenar nada —, y un tablero de caso — el
NIF — donde la teoría de cada caso es versionada, con parches atribuidos y
marca de validación humana. Todas llaman al mismo motor por el backend
`/api/plugins/dike` del plugin.

El chat del Case Writer responde desde el perfil `lexo-lawyer` cuando existe
y tiene Diké habilitado; si no, desde el perfil activo si tiene Diké. Usa el
modelo que ese perfil tenga configurado.

## Cómo funciona

El plugin le da al agente una herramienta, `dike_verificar_citas`. Recibe
`texto` (el texto pegado) o `ruta` (un archivo `.md`, `.txt` o `.docx`). Una
ruta relativa se resuelve contra la carpeta de trabajo de la sesión cuando
Hermes la informa; las sesiones del gateway no la informan, así que ahí la
ruta tiene que ser absoluta. Las páginas del dashboard y de Desktop llegan al
mismo adaptador por HTTP — solo texto, nunca lectura de archivos. Las rutas
de NIF y grafo del panel corren `scripts/panel.py` en el mismo subproceso
aislado: los tableros de caso son almacenes SQLite versionados dentro de la
carpeta de datos del plugin (fuera del corpus sellado), y las rutas del grafo
del corpus solo leen la generación instalada ya verificada.

Junto a la verificación, `scripts/ordenamiento.py` (solo stdlib, offline)
genera la plantilla, valida y construye packs de normas para otros sistemas
jurídicos: un perfil declara la fuente oficial, los códigos de unidad, las
plantillas de IRI y la regla de año de la jurisdicción; `validar-pack` luego
califica el pack — hoy C0 (manifiesto y hashes) y C1 (vocabulario del
núcleo), con C2/C3 planificados. El perfil `cl` reproduce el pack sellado
`chile-base`. Detalles en [docs/legal-systems.md](docs/legal-systems.md).

1. El plugin corre el motor de Diké como subproceso (`dike constancia --json`)
   con un entorno mínimo: sin las credenciales del agente y con una carpeta
   personal dentro de los datos del plugin. El motor nunca se importa en
   Hermes.
2. El motor encuentra cada cita de artículo y la resuelve contra el corpus:
   25 normas y 8.544 artículos de Ley Chile ([claims.json](claims.json)). Para
   cada una revisa el hash del texto y si el artículo estaba vigente en la
   fecha de referencia.
3. El plugin valida la respuesta del motor contra un contrato fijo: conteos,
   veredicto y la evidencia que debe traer cada cita verificada. Una respuesta
   malformada se informa como error, nunca como aprobada.

Con el escrito sintético de `tests/fixtures/escrito_demo.md`, que tiene seis
citas, la herramienta devuelve:

| Cita | Resultado |
|---|---|
| artículo 161, 162, 163 y 168 del Código del Trabajo | **verificadas**: identificador (`cl.norma.ct:art:0161`…), URL de la fuente en Ley Chile, SHA-256 del texto |
| artículo 60 | **rechazada**, `AMBIGUOUS`: no nombra la norma, y el artículo 60 existe en más de un código |
| artículo 9999 del Código del Trabajo | **rechazada**, `UNRESOLVABLE`: no está en el corpus |

La respuesta también dice lo que no cubre. `certificacion_sustantiva` siempre
es `false`: la herramienta no revisa que el artículo respalde el argumento.
`certificacion_vigencia_actual` siempre es `false`: el corpus es una copia
fechada, tomada de Ley Chile en agosto de 2026, y cada cita verificada trae
su fecha de obtención.

Un modelo al que se le pregunta si existe el artículo 9999 del Código del
Trabajo puede responder cualquier cosa con seguridad. Esta herramienta
responde desde un corpus sellado cuya integridad recomprueba en cada
llamada ([docs/DISCLOSURES.md](docs/DISCLOSURES.md)), y cuando no tiene
evidencia lo dice. Un prompt o una skill pueden
pedirle al modelo que tenga cuidado; no pueden llevar el corpus, revisar sus
hashes ni rechazar en nombre del motor.

El **Case Writer** de la página Desktop — editor, módulo verificador, paso
de privacidad, chat, NIF vivo y el predictor experimental — se describe en
[docs/case-writer.es.md](docs/case-writer.es.md); lo que envía y escribe está
en [docs/DISCLOSURES.md](docs/DISCLOSURES.md).

## Cómo se hizo

- **Lo que decidí y revisé yo (Cristóbal Muñoz):** _lo completa el
  mantenedor._
- **Antes del hackathon:** el motor de Diké y el corpus, y el adaptador del
  plugin con sus 73 tests, en la carpeta `hermes-plugin/` de
  [Grizaceo/dike](https://github.com/Grizaceo/dike) (octubre de 2026). Ver
  [PREEXISTING.md](PREEXISTING.md).
- **Lo que escribió una IA durante el hackathon:** Claude Code (Claude Opus
  5.5) movió el adaptador a este repositorio, escribió
  `scripts/vendor_engine.py` y la revisión de `VENDORED.json` que reemplaza la
  antigua prueba de copia, adaptó los tests a la nueva estructura, actualizó el
  manifiesto y redactó este README.
- **Verificado por Claude Code en esta sesión (todavía no lo comprobé yo):** los 73 tests ([claims.json](claims.json));
  `hermes plugins validate . --install-deps` y `hermes plugins doctor . --ci`
  en Hermes v0.22.7; los tests de punta a punta con la red desactivada
  (`unshare -rn`).
- **Lo que escribió una IA después de publicar:** Devin (Claude Opus 5.5)
  escribió la entrada del catálogo y su pull request, el banner del catálogo,
  estas correcciones del README, los cambios del adaptador de la versión
  0.3.0, las superficies del panel de la 0.4.0 (pestaña del dashboard,
  página de Desktop y backend `/api/plugins/dike`) y el tablero NIF con las
  vistas de grafo de la 0.5.0 (`scripts/panel.py`, las rutas `/nif/*` y
  `/grafo/*` y las dos mitades de UI), que lista
  [PREEXISTING.md](PREEXISTING.md), con sus tests, más el grafo 3D del
  corpus de la 0.6.0 (`/grafo/red` y la página Desktop empaquetada con
  esbuild). Claude Code
  (Claude Opus 5.5) revisó la entrada de forma independiente, solo lectura,
  antes de esos cambios.
- **Verificado por Devin (todavía no lo comprobé yo):** en Hermes v0.23.0, la
  instalación desde GitHub con `hermes plugins install Grizaceo/hermes-dike`
  y `/dike-verificar` sobre el escrito de demostración; `validate
  --install-deps` y `doctor --ci` en el commit fijado; de nuevo los tests y
  los de punta a punta sin red; para la 0.3.0, la suite
  ([claims.json](claims.json)), `validate` y `doctor` sobre el árbol nuevo, y
  un `.docx` revisado por un plugin que Hermes instaló con sus dependencias;
  para la 0.4.0, las rutas `estado` y `verificar` llamadas contra el paquete
  instalado (4 de 6 en el escrito de demostración).
  También si un modelo real elige la
  herramienta cuando se le pide revisar las citas de un escrito sin decirle
  su nombre: las corridas y sus resultados están en el pull request del
  catálogo.
- **Lo que escribió una IA para la 0.7.0:** Devin (Claude Opus 5.5) escribió
  el Case Writer (editor, módulo verificador, módulo de privacidad, chat,
  NIF vivo y la arquitectura del predictor), los dos hooks, sus tests y las
  divulgaciones. El detector de privacidad está portado, no es nuevo: viene
  del trabajo previo en `dpp-ai-compliance-lab`, `graph-legal-ir`,
  `lexo-case-writer` y `dike-desk`, con su procedencia en `VENDORED.json`; el
  predictor determinista está portado de `lexo-case-writer`.
- **Verificado por Devin para la 0.7.0 (todavía no lo comprobé yo):** los
  tests y el bundle reproducible ([claims.json](claims.json)); `hermes
  plugins validate` sobre una copia limpia; dos turnos reales de chat en el
  perfil `lexo-lawyer` con el sobre, donde se inyectaron las instrucciones y
  `pre_tool_call` bloqueó el intento del modelo de usar la terminal (líneas
  de auditoría, sin contenido). Un turno completo escrito en la app Desktop no
  se probó por automatización (el teclado sintético no llega a la app).
- **No verificado:** versiones de Hermes anteriores a v0.22.7; macOS.

## Límites

- **Ley chilena, 25 normas.** Las citas de otras normas vuelven sin
  verificar. La salida está en español.
- **Otros sistemas jurídicos se validan como pack, no se verifican como
  citas.** El framework `ordenamiento/` revisa packs de otras jurisdicciones
  hasta el nivel C1 hoy (C2/C3 no se evalúan), pero `/dike-verificar` no
  puede verificar sus citas hasta que la gramática dike-id acepte prefijos
  distintos de `cl`.
- **Solo citas de artículo.** Una mención como "Ley 19.496" sin artículo
  aparece en `no_verificadas`, no se verifica.
- **La ausencia no es prueba.** Una cita que el corpus no puede resolver puede
  existir igual en la ley.
- **Una copia fechada, no el texto oficial de hoy.** Cada respuesta nombra el
  corpus por su `pack_hash` y da la fecha de obtención de cada fuente.
- **Las etiquetas deónticas y de relaciones son candidatas.** Las reglas de
  modalidad y las de relación de la capa local (cita, menciona, revisa,
  aplica) siguen la postura NIF `deontic_validated: false`: lo que no
  resuelve se cuenta, no se adivina.
- **Mover `plugin-data/dike` no migra el corpus.** Una carpeta de datos
  copiada o movida a otra ruta devuelve `SIN_CORPUS`; borra
  `plugin-data/dike/generations` y el corpus se reinstala en la próxima llamada.
- **`.pdf` y otros formatos: pasa el texto.** `ruta` acepta `.md`, `.txt`
  y `.docx`; para un `.pdf` u otro formato, extrae el texto y pásalo en
  `texto`. `/dike-verificar` trata un token único de ruta como `ruta` y todo
  lo demás como texto.
- **La búsqueda es léxica (BM25), no semántica; no cruza el salto
  concepto→norma.** Los resultados son pistas de lectura, rotulados como
  tales — nunca citas verificadas.
- **El árbol tiene 51 anclas y no cambia el ranking (medido); explica la
  clasificación, no la mejora.**
- **No es instantáneo.** Cada llamada vuelve a revisar el corpus instalado y
  arranca el motor, así que tarda varios segundos.
- **Disco.** El corpus instalado ocupa unos 300 MB en la carpeta de datos del
  plugin ([claims.json](claims.json)).
- **Los casos NIF son datos del perfil.** Los tableros viven en los datos del
  plugin del perfil activo; no se sincronizan, no se firman, y un caso marcado
  `validated_by_human` registra quién movió la marca, no una opinión legal.
- **No es un sandbox.** El subproceso conserva tus permisos del sistema
  operativo. Lo que el plugin lee, escribe y ejecuta está en
  [docs/DISCLOSURES.md](docs/DISCLOSURES.md).
- **No firma.** Diké puede firmar constancias de citas verificadas; este
  plugin nunca lo hace y nunca toca llaves de firma.
- **Seudonimización, no anonimización.** El detector es por reglas: no
  encuentra todos los nombres sin contexto (te los lista como candidatos) y
  el mapa de tokens queda en este equipo. Revisa la vista previa antes de
  enviar.
- **El modelo del chat es el de tu perfil.** Dónde corre (tu equipo o un
  proveedor) depende de la configuración de ese perfil; la página lo
  muestra. Los hooks alejan al chat de las herramientas; no hacen que el
  modelo acierte. El estado de las citas lo fija solo el motor.
- **La predicción es experimental y está apagada por defecto.** Planeado, no
  construido: un modelo ajustado que prediga texto jurídico como los
  asistentes de código predicen código (limitado por fondos), que el mismo
  modelo que servirá los embeddings de IndexO actúe como predictor para
  unificar la arquitectura, y un modelo de chat destilado o ajustado para
  usar bien la arquitectura de Diké (requiere un servidor de entrenamiento).

## Licencia

El código está bajo la [licencia MIT](LICENSE). El corpus de `corpus/` deriva
de Ley Chile (Biblioteca del Congreso Nacional de Chile) y no lo cubre la
licencia MIT; sus condiciones y su procedencia están en
[corpus/README.md](corpus/README.md). Ese archivo está copiado sin cambios de
Grizaceo/dike, así que sus menciones de un `Dockerfile`, de
`scripts/producto/` y del commit `a605d56` se refieren a ese repositorio.
