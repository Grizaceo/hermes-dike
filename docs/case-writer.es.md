<!-- vitrina:translation-of case-writer.md sha256=812515a6e0feba205f018ff135f94dcb0d6148f7a94d5e82f8627d67f92b509c -->
# El Case Writer (Desktop)

[English](case-writer.md)

- **Editor y verificador.** El escrito se edita en el lugar y se guarda por
  caso. "Verificar citas" corre el mismo motor; cada cita queda marcada en el
  texto, y solo un `VERIFICADA` del motor sobre el texto actual exacto se
  muestra como verificada: cualquier edición la deja "desactualizada". Una
  cita fallida se puede reparar (el reemplazo debe pasar por el motor antes
  de poder aplicarse), retirar con motivo o escalar, siguiendo el bucle de
  Diké Shield.
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
  goldset sintético iguala al detector del que se portó (F1 0,94, recall
  1,0 en RUT, correos y teléfonos; [claims.json](../claims.json)).
- **Chat sobre el escrito.** Cada turno envía tu pregunta con el escrito (o
  solo los párrafos que cambiaron) dentro de un sobre `<dike-escritor v="1">`.
  Dos hooks del plugin reconocen ese sobre: `pre_llm_call` agrega
  instrucciones fail-closed al mensaje del usuario (nunca al system prompt) y
  `pre_tool_call` bloquea toda herramienta salvo las skills y el verificador,
  así que el chat no puede usar la terminal del perfil. Los demás chats no
  cambian. Las citas de cada respuesta pasan por el motor antes de poder
  mostrarse como verificadas.
- **NIF vivo.** A pedido, el modelo propone actualizaciones del NIF (hechos
  conocidos, alegados y faltantes, normas, sujetos, hipótesis, vacíos). Cada
  propuesta debe citar literalmente el escrito y respetar el esquema del
  NIF; nada entra al tablero hasta que la aceptas.
- **Predicción (experimental, apagada por defecto).** Un predictor por capas:
  frases procesales deterministas, continuaciones literales desde el corpus
  y, solo con tu opt-in, una continuación del modelo que se seudonimiza si
  saldría del equipo.
