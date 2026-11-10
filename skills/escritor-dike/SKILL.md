---
name: escritor-dike
description: "Cómo fundamentar en el chat del escrito de Diké: leer el artículo en el corpus sellado con dike_leer_articulo, citar con notas al pie que abren el nodo exacto del grafo, y separar lo verificado de la lectura del modelo."
version: 1.0.0
metadata:
  hermes:
    tags: [dike, escrito, citas, notas-al-pie, chile]
---

# Fundamentar un escrito con Diké (escritor-dike)

Diké verifica tres cosas de una cita: que el artículo existe y estaba vigente en una copia fechada
del corpus (motor), que un fragmento está literalmente en ese artículo (comprobación de la
interfaz) y que el enlace lleva al nodo correcto del grafo. **No verifica que el artículo sirva para
los hechos.** Eso es un argumento tuyo y lo decide el abogado.

## Herramientas

| Herramienta | Para qué | Qué no hace |
|---|---|---|
| `dike_verificar_citas` (`texto`) | Estado de cada cita del escrito: `VERIFICADA` o `FALLO` con su motivo. | No dice qué dice el artículo. |
| `dike_leer_articulo` (`cita`, `gid` o `nodo_id`, uno solo) | Texto del artículo, sus unidades (`id`, `inicio`, `fin`, `texto`), `nodo_id`, fuente, fecha y vigencia en la copia. | No certifica pertinencia ni vigencia actual. |
| `dike_buscar_corpus` (`consulta`, `limite` ≤ 10) | Artículos candidatos por contenido (BM25 determinista). | Sus resultados son pistas, no citas verificadas: léelos antes de usarlos. |

Ninguna acepta rutas de archivo.

## Contrato de las notas al pie

1. Lee el artículo con `dike_leer_articulo` antes de afirmar qué dice o si sirve.
2. Marca la frase con `[^n]` y pon al final de la respuesta una nota por línea:

   ```text
   [^1]: dike:a:207436:art_0161#u02 «fragmento literal copiado de la unidad» (artículo 161 del Código del Trabajo)
   ```

   - `a:207436:art_0161` es el `nodo_id` devuelto; `#u02`, el `id` de la unidad. Omite `#uNN` si
     el fragmento abarca varias unidades.
   - El fragmento se copia tal cual de lo que devolvió la herramienta en esta conversación: entre
     20 y 400 caracteres, sin parafrasear, sin cortes ni puntos suspensivos. Nunca de memoria.
   - Entre paréntesis va la cita en la forma «artículo N del <cuerpo legal>», para que el motor la
     verifique.
3. Si no pudiste leer el artículo, no hay nota: escribe `[PENDIENTE: evidencia]`.
4. La pertinencia se escribe «Lectura del modelo: …». Nunca «correcto», «aplicable» ni «verificado».

## Qué ve el abogado

Por cada nota, la interfaz muestra si el nodo existe, si el fragmento está literalmente en esa
unidad o artículo y el estado del motor para la cita entre paréntesis, siempre con la línea «La
pertinencia para el caso es una lectura del modelo; decides tú», y un botón «Verifícalo tú: abrir en
el grafo» que abre el artículo con la unidad y el fragmento resaltados.
