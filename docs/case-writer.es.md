<!-- vitrina:translation-of case-writer.md sha256=9621a47f6764187ccc8ce1adfded4a5930ca6919cb939d684fe43585c077546a -->
# El Case Writer (Desktop)

[English](case-writer.md)

- **Editor y verificador.** El escrito se edita en el lugar y se guarda por
  caso. "Verificar citas" corre el mismo motor; cada cita queda marcada en el
  texto, y solo un `VERIFICADA` del motor sobre el texto actual exacto se
  muestra como verificada: cualquier edición la deja "desactualizada". Una
  cita fallida se puede reparar (el reemplazo debe pasar por el motor antes
  de poder aplicarse), retirar con motivo o escalar.
- **Desde la búsqueda.** En la búsqueda por contenido de la pestaña Grafo,
  «Llevar al escrito» agrega la cita canónica del artículo como un párrafo
  nuevo al final del escrito y la pasa por el verificador como cualquier
  otra cita: nunca llega verificada, y un artículo derogado o aún no vigente
  se espera que vuelva FALLO. La cita es una pista que se traslada, no una
  fuente verificada, y la consulta de búsqueda nunca se guarda. Los artículos
  cuyo gid no tiene una forma que la gramática del verificador acepte no se
  pueden llevar al escrito: el botón queda deshabilitado con el motivo — 204
  artículos con letra sin sufijo (p. ej. `art. 54 a`) y 1 `bis e` en el
  corpus actual, porque la gramática los resolvería a otro artículo.
- **Privacidad.** Antes de que un texto salga hacia un modelo, un detector
  por reglas marca números de identificación, correos, teléfonos,
  direcciones, patentes, nombres con contexto y datos sensibles, conserva los
  roles de causa y los jueces, y reemplaza lo demás con tokens estables
  (`[PERSONA_1]`). Ves la lista, conservas o enmascaras cada valor,
  enmascaras una selección y revisas exactamente lo que sale. Sobre el
  goldset sintético obtiene F1 0,979, sobre el detector del que se portó
  (0,9425), con recall 1,0 en RUT, correos y teléfonos
  ([claims.json](../claims.json)); el goldset tiene poca diversidad, así que
  es un control de regresión, no una prueba de que generalice.
- **Chat sobre el escrito.** Cada turno envía tu pregunta con el escrito (o
  solo los párrafos que cambiaron) dentro de un sobre `<dike-escritor v="1">`.
  Dos hooks del plugin reconocen ese sobre: `pre_llm_call` agrega
  instrucciones fail-closed al mensaje del usuario (nunca al system prompt) y
  `pre_tool_call` bloquea toda herramienta salvo las skills, el
  descubrimiento de herramientas y el verificador, que ahí acepta solo texto
  (nunca una ruta de archivo), así que el chat no puede usar la terminal ni
  los archivos del perfil. Si las instrucciones no se pueden leer, se bloquea
  cada turno de esa sesión. Los demás chats no cambian. Las citas de cada respuesta pasan por el motor antes de poder
  mostrarse como verificadas.
- **Tablero del caso (NIF) vivo.** A pedido, el modelo propone
  actualizaciones de la teoría del caso, el NIF (hechos
  conocidos, alegados y faltantes, normas, sujetos, hipótesis, vacíos). Cada
  propuesta debe citar literalmente el escrito y respetar el esquema del
  NIF; nada entra al tablero hasta que la aceptas.
- **Predicción (experimental, apagada por defecto).** Un predictor por capas:
  frases procesales deterministas, continuaciones literales desde el corpus
  y, solo con tu opt-in, una continuación del modelo que se seudonimiza si
  saldría del equipo.

## Elegir el perfil donde corre el chat

El chat del Case Writer corre en un perfil de Hermes que tiene Diké
habilitado y un modelo configurado. Por defecto es el **perfil activo**: el
que la app Desktop tiene conectada. Dos formas de cambiarlo:

- **Correr todo en un perfil dedicado.** Créalo, instala y habilita Diké
  ahí, dale un modelo y abre la app Desktop con ese perfil. `--clone` copia
  el `config.yaml` del perfil activo (que lleva el modelo), el `.env`, el
  `SOUL.md` y las skills; `--clone-from <nombre>` clona otra fuente, y
  `--no-skills` hace un perfil liviano (configura un modelo después):

  ```bash
  hermes profile create abogado-dike --clone
  hermes -p abogado-dike plugins install Grizaceo/hermes-dike --ref <sha>
  hermes -p abogado-dike plugins enable dike
  ```

- **Dejar el panel en un perfil y el chat en otro.** Fija el setting
  `perfil_chat` del plugin en el perfil que sirve el panel al nombre del
  perfil que debe correr el chat (ese perfil igual necesita Diké y un
  modelo):

  ```bash
  hermes -p <perfil-del-panel> config set plugins.entries.dike.settings.perfil_chat abogado-dike
  ```

  Deja `perfil_chat` vacío (`""`) para usar el perfil activo. La misma clave
  está en el `config.yaml` de ese perfil, en
  `plugins.entries.dike.settings.perfil_chat`.

## Planeado: un solo contrato de recuperación para búsqueda y predicción

No está implementado. Fija la forma para que un recuperador posterior se
pueda enchufar sin tocar la interfaz ni el verificador.

- **El contrato es la respuesta actual de `/grafo/buscar`.** Un recuperador
  recibe una consulta y un límite, y devuelve `rotulo`, `metodo` (`motor`,
  `determinista`, `modelo`) y `resultados` con `nodo_id`, `gid`, `score`,
  `score_rel`, `canal`, `cita`, `vigencia` y `materias`. Todo recuperador
  nuevo devuelve esa misma forma, con `metodo.modelo` nombrando su modelo, y
  aparece como una fuente `local_only` aparte. Nunca reemplaza en silencio
  al BM25.
- **Regla de admisión.** Un recuperador con modelo, como el índice denso e5
  de IndexO, entra solo si supera el recall@10 del BM25 en un goldset
  aparte. `normas_qrels_v1` no cuenta: está dentro de la muestra del BM25.
  Medido el 2026-11-08 con esa suite, el índice e5 solo llegó a 0,032
  frente a 0,952 del BM25, y todas las fusiones probadas dieron menos. No
  se admite.
- **La predicción lo reutiliza.** Las capas de corpus del predictor (L3/L4)
  pueden llamar al mismo contrato con el párrafo actual como consulta. Cada
  sugerencia lleva `procedencia: {tipo: 'busqueda', gid, motor}` y nunca se
  marca verificada. Una cita que inserte pasa por el verificador como una
  traída desde la búsqueda. La consulta nunca sale del equipo.
