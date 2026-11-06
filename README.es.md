<!-- vitrina:translation-of README.md sha256=8ea27e16446f93d7e6cda93092b32585c7da8c20dbcfeaee764ddc5f07fa825f -->
# Diké para Hermes

[English](README.md)

Un plugin de Hermes Agent que contrasta cada cita de artículo de la ley chilena
de un escrito jurídico con una copia local de las normas identificada por hash,
y se niega a certificar lo que no puede probar.

## Estado

- **Entrada de hackathon** para el Hermes Agent Plugin Hackathon de Nous
  Research (noviembre de 2026). Todavía no está en el catálogo de plugins de
  Hermes.
- **Solo Linux.** Probado con Hermes Agent v0.22.7 sobre Python 3.11.16.
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
`texto` (el texto pegado) o `ruta` (un archivo `.md` o `.txt`).

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
fechada, obtenida el 2026-08-18.

Un modelo al que se le pregunta si existe el artículo 9999 del Código del
Trabajo puede responder cualquier cosa con seguridad. Esta herramienta
responde desde un corpus sellado cuya integridad vuelve a revisar en cada
llamada, y cuando no tiene evidencia lo dice.

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
- **No verificado:** la instalación desde GitHub (el repositorio todavía no
  está publicado); versiones de Hermes anteriores a v0.22.7; versiones de
  Python distintas de 3.11.16; macOS; que un modelo real elija la herramienta
  por su cuenta (los tests la llaman directamente).

## Límites

- **Ley chilena, 25 normas.** Las citas de otras normas vuelven sin
  verificar. La salida está en español.
- **Solo citas de artículo.** Una mención como "Ley 19.496" sin artículo
  aparece en `no_verificadas`, no se verifica.
- **La ausencia no es prueba.** Una cita que el corpus no puede resolver puede
  existir igual en la ley.
- **Una copia fechada, no el texto oficial de hoy.** Cada respuesta nombra el
  corpus por su `pack_hash` y da la fecha de obtención de cada fuente.
- **No es un sandbox.** El subproceso conserva tus permisos del sistema
  operativo. Lo que el plugin lee, escribe y ejecuta está en
  [docs/DISCLOSURES.md](docs/DISCLOSURES.md).
- **No firma.** Diké puede firmar constancias de citas verificadas; este
  plugin nunca lo hace y nunca toca llaves de firma.

## Licencia

El código está bajo la [licencia MIT](LICENSE). El corpus de `corpus/` deriva
de Ley Chile (Biblioteca del Congreso Nacional de Chile) y no lo cubre la
licencia MIT; sus condiciones y su procedencia están en
[corpus/README.md](corpus/README.md).
