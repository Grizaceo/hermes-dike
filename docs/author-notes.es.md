<!-- vitrina:translation-of author-notes.md sha256=991570c150f15fe5ca5efa704a61d0a74fb8f8b2d51f6965326f4f784959cb9e -->
# Notas del autor

[English](author-notes.md)

Por Cristóbal Muñoz, quien decidió y revisó lo que hace este plugin.

Este proyecto inició más bien como aplicaciones locales separadas, en mi
experimentación por ver cómo cruzar el derecho y la IA.

## El grafo de conocimiento

Lo primero que se ideó y trabajó durante la primera mitad del año fue trabajar
en grafos de conocimiento aplicados al derecho. Un grafo es la intersección
entre dos cosas: el trabajo previo del abogado, acumulable en un grafo de
conocimiento que él mismo aprueba y edita, y el retrieval y las respuestas
generados por modelos de IA. El grafo creado es siempre el límite duro. La idea
es fail-closed: el sistema prefiere abstenerse a responder solo desde lo que el
modelo recuerde de su entrenamiento. En este sentido, los grafos de
conocimiento buscan ser la bisagra que permita a los juristas tener aún el
control sobre qué y cómo razona un modelo, aprovechando aun así las ventajas y
la velocidad de un LLM para potenciar su trabajo.

Los grafos de conocimiento se construyeron a partir de API oficiales nacionales
de Chile que dan acceso a la normativa, la jurisprudencia y las resoluciones
administrativas. La adquisición y la creación están detenidas actualmente, dado
que en Chile se sigue debatiendo el correcto uso de esa información mediante IA
y un servicio como el que Diké propone.

## Los módulos alrededor del grafo

Una vez aterrizada la idea del grafo y tomando forma, me di cuenta de que no
bastaba por sí mismo para estar a la altura del servicio que podía ofrecer Diké
para aprovechar la IA en 2026. Por eso se empezaron a crear módulos alrededor
del grafo, que lo tuvieran de base para su trabajo y que permitieran integrar
un stack completo de trabajo jurídico basado en grafos.

- **El Case Writer** fue pensado desde un inicio como un Word agéntico, en el
  que poder conversar con un chat de IA limitado, con las herramientas de grafo
  de conocimiento construidas como nativas, para acelerar la escritura mediante
  los consejos y revisiones hechos por el modelo, teniendo el contexto de lo
  escrito y acceso a los grafos de conocimiento.
- **La Pizarra estratégica.** Se agregó al Case Writer una pizarra tipo canvas
  para facilitar a los abogados la construcción de la teoría del caso como nos
  fue enseñada en las aulas de derecho: con una pizarra indicando requisito por
  requisito o hecho por hecho, para poder visualizar la teoría del caso
  construida.
- **El NIF (Normative Interactive Framework).** Me di cuenta de que la pizarra
  del Case Writer se quedaba un poco corta como medio de construcción de la
  teoría del caso, dado que el modelo en el Case Writer está más bien pensado
  para aconsejar que para proponer. Por ello se diseñó el NIF, como un espacio
  pensado para que el modelo construya la teoría del caso a partir de lo que
  entiende del escrito en el Case Writer y del demás contexto que le dé el
  abogado, y a la vez el abogado pueda simplemente revisar el NIF y corregir lo
  que el modelo entiende por teoría del caso. Así pueden hablar el mismo idioma
  al trabajar en el caso, y las malas interpretaciones o los problemas de
  entendimiento no hacen que, al final de todo el trabajo, el abogado se dé
  cuenta de que el modelo no estaba hablando de lo mismo.

  En cuanto a la forma de construir el NIF por el modelo, de manera local se
  concibió, y se sigue trabajando en, una adaptación de la clásica metodología
  de la investigación jurídica al trabajo agéntico con modelos de IA,
  aprovechando múltiples perfiles: una metodología agéntica de la investigación
  jurídica. Por temas de tiempo no se pudieron agregar todos los perfiles
  jurídicos para la utilización correcta de esa metodología, pero se hizo una
  versión adaptada. A futuro seguiré trabajando en el plugin para agregarle
  dicha metodología correctamente.
- **El verificador de citas**, en el core de Diké, es la forma determinista del
  sistema para evitar que el modelo diga o responda cosas de las que no está
  seguro, afectando el juicio del abogado en el proceso.

## Lo que se creó o ajustó para esta hackatón

- **La seudonimización.** Si bien ya tenía un conjunto de scripts, protocolos y
  skills para anonimizar documentos, para esta hackatón se sistematizó en una
  herramienta dentro del Case Writer.
- **La construcción de grafos.** Las herramientas, scripts, skills y otros para
  crear grafos estaban segmentados en mis perfiles de Hermes; aquí se
  empaquetaron para que terceros puedan crear sus propios grafos
  correspondientes a sus jurisdicciones.
- **LexO Escribe Claro** está inspirada en una herramienta judicial de IA usada
  en mi país, Chile, para que magistrados y operadores jurídicos redacten de
  forma entendible para legos y el común de la gente, y así mejorar el acceso a
  la justicia. La idea se trasladó al Case Writer: si el Poder Judicial está
  redactando así, es ideal que los abogados también redacten así sus demandas,
  para facilitar el trabajo a la magistratura (dar los argumentos en bandeja
  facilita el trabajo del juez y mejora las probabilidades propias en el caso)
  y a la vez colaborar con mejorar el acceso a la justicia.

## Lo que decidí y cómo lo revisé

Todos los módulos incluidos en el plugin fueron planeados y pensados por mí. Lo
mismo otros que los complementan y que por temas de tiempo no se agregaron a la
hackatón: los scrapers de sentencias, resoluciones administrativas o leyes, y
en especial el predictor de texto. Ese predictor se piensa como el GitHub
Copilot de los inicios de la IA, que en vez de hacer el código por sí mismo
daba recomendaciones: la idea es trasladar eso al derecho, con recomendaciones
inteligentes y context aware para escribir documentos legales a medida que el
abogado escribe. Por temas de tiempo, y porque no cuento con los fondos para
entrenar un modelo especializado para probar el concepto en la nube, se dejó
como función experimental.

Me asistieron herramientas de IA como Hermes para crear lo que visualizo, pero
cada una de las funciones fue probada y pensada para asistirme en mi profesión
como egresado de derecho, bajo un punto de vista: qué cosas un abogado estaría
dispuesto a aceptar como ayuda, sin perder el foco de que es el abogado el
llamado a ejercer la profesión, y no un modelo de IA.

Por lo mismo, cada módulo fue decidido y revisado por mí desde una perspectiva
jurídica, es decir, en cuanto a su utilidad para un abogado. Si bien he
trabajado y aprendido a programar por mi cuenta, admito que mis conocimientos
aún son iniciales. Las pruebas fueron más bien un dogfooding hecho por mí en mi
calidad de abogado, y no una revisión de problemas debajo del código que
fallarían silenciosamente y que, como abogado usuario de la interfaz, no
notaría.

## Por qué Hermes, y por qué el nombre

Pretendo seguir trabajando en el plugin, independiente de los resultados de la
hackatón. En cierto punto del año en que trabajaba en el grafo, el Case Writer
y el legal-reviewer (la herramienta que uso para formar nodos y aristas en un
grafo, o para extraer las citas de un documento, que se importan
automáticamente al Case Writer), me di cuenta de que perdía mucho tiempo
depurando las herramientas y los chats agénticos que intentaba integrar como
stack propio, en vez de trabajar en lo que más sé, que es el derecho.

Por ello, a la mitad decidí dejar de crear mi propio stack agéntico y usar
Hermes como base, aprovechando en especial su función estrella de generar y
guardar skills automáticamente al final de cada sesión. Es algo propio de los
abogados: luego de trabajar en una causa de un área que no conocen, la
siguiente les es mucho más fácil, porque el derecho es repetitivo, algo muy
similar a cómo funcionan los harness y las skills de los modelos de IA. Por eso
elegí Hermes como motor agéntico del stack jurídico que trato de construir, y de
ahí que se llame Diké (Dike o Dicea), siguiendo la idea de usar dioses griegos
iniciada por Hermes. Antes se llamaba LexO, por «lex orchestration», pero era
un nombre provisional.
