<!-- vitrina:translation-of README.md sha256=a1fb9dc4a5564c102fbc1368c3a12f1d1dfc8d8b817303a6ffa7249d1d4fe45a -->
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
- **Solo Linux.** Probado con Hermes Agent v0.22.7 y v0.23.0.
- **El motor no es nuevo.** Es [Diké](https://github.com/Grizaceo/dike),
  copiado sin cambios; `VENDORED.json` indica el commit y el hash de cada
  archivo. [PREEXISTING.md](PREEXISTING.md) dice qué existía antes del
  hackathon y qué se hizo durante él.

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

## Cómo funciona

El plugin le da al agente una herramienta, `dike_verificar_citas`. Recibe
`texto` (el texto pegado) o `ruta` (un archivo `.md`, `.txt` o `.docx`). Una
ruta relativa se resuelve contra la carpeta de trabajo de la sesión cuando
Hermes la informa; las sesiones del gateway no la informan, así que ahí la
ruta tiene que ser absoluta.

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
  estas correcciones del README y los cambios del adaptador de la versión
  0.3.0 que lista [PREEXISTING.md](PREEXISTING.md), con sus tests. Claude Code
  (Claude Opus 5.5) revisó la entrada de forma independiente, solo lectura,
  antes de esos cambios.
- **Verificado por Devin (todavía no lo comprobé yo):** en Hermes v0.23.0, la
  instalación desde GitHub con `hermes plugins install Grizaceo/hermes-dike`
  y `/dike-verificar` sobre el escrito de demostración; `validate
  --install-deps` y `doctor --ci` en el commit fijado; de nuevo los tests y
  los de punta a punta sin red; para la 0.3.0, la suite
  ([claims.json](claims.json)), `validate` y `doctor` sobre el árbol nuevo, y
  un `.docx` revisado por un plugin que Hermes instaló con sus dependencias.
  También si un modelo real elige la
  herramienta cuando se le pide revisar las citas de un escrito sin decirle
  su nombre: las corridas y sus resultados están en el pull request del
  catálogo.
- **No verificado:** versiones de Hermes anteriores a v0.22.7; macOS.

## Límites

- **Ley chilena, 25 normas.** Las citas de otras normas vuelven sin
  verificar. La salida está en español.
- **Solo citas de artículo.** Una mención como "Ley 19.496" sin artículo
  aparece en `no_verificadas`, no se verifica.
- **La ausencia no es prueba.** Una cita que el corpus no puede resolver puede
  existir igual en la ley.
- **Una copia fechada, no el texto oficial de hoy.** Cada respuesta nombra el
  corpus por su `pack_hash` y da la fecha de obtención de cada fuente.
- **Mover `plugin-data/dike` no migra el corpus.** Una carpeta de datos
  copiada o movida a otra ruta devuelve `SIN_CORPUS`; borra
  `plugin-data/dike/generations` y el corpus se reinstala en la próxima llamada.
- **`.pdf` y otros formatos: pasa el texto.** `ruta` acepta `.md`, `.txt`
  y `.docx`; para un `.pdf` u otro formato, extrae el texto y pásalo en
  `texto`. `/dike-verificar` trata un token único de ruta como `ruta` y todo
  lo demás como texto.
- **No es instantáneo.** Cada llamada vuelve a revisar el corpus instalado y
  arranca el motor, así que tarda varios segundos.
- **Disco.** El corpus instalado ocupa unos 300 MB en la carpeta de datos del
  plugin ([claims.json](claims.json)).
- **No es un sandbox.** El subproceso conserva tus permisos del sistema
  operativo. Lo que el plugin lee, escribe y ejecuta está en
  [docs/DISCLOSURES.md](docs/DISCLOSURES.md).
- **No firma.** Diké puede firmar constancias de citas verificadas; este
  plugin nunca lo hace y nunca toca llaves de firma.

## Licencia

El código está bajo la [licencia MIT](LICENSE). El corpus de `corpus/` deriva
de Ley Chile (Biblioteca del Congreso Nacional de Chile) y no lo cubre la
licencia MIT; sus condiciones y su procedencia están en
[corpus/README.md](corpus/README.md). Ese archivo está copiado sin cambios de
Grizaceo/dike, así que sus menciones de un `Dockerfile`, de
`scripts/producto/` y del commit `a605d56` se refieren a ese repositorio.
