// insertarHtmlEnCursor: inserta donde está el cursor y solo añade al final
// cuando el documento está vacío. Editor falso: basta isEmpty/state/chain.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { insertarHtmlEnCursor } from '../src/escritor/editor.js'

function editorFalso({ vacio, tamano = 40, desde = 7 }) {
  const llamadas = []
  return {
    _llamadas: llamadas,
    isEmpty: vacio,
    state: {
      doc: { content: { size: tamano } },
      selection: { from: desde },
    },
    chain() {
      const encadenar = {
        focus() { llamadas.push('focus'); return encadenar },
        insertContentAt(pos, html) {
          llamadas.push(['insertContentAt', pos, html])
          return encadenar
        },
        run() { llamadas.push('run') },
      }
      return encadenar
    },
  }
}

test('documento con contenido: inserta en la posición del cursor', () => {
  const ed = editorFalso({ vacio: false, tamano: 40, desde: 7 })
  insertarHtmlEnCursor(ed, '<p>cita</p>')
  assert.deepEqual(ed._llamadas, [
    'focus',
    ['insertContentAt', 7, '<p>cita</p>'],
    'run',
  ])
})

test('documento vacío: añade al final, no en el cursor', () => {
  const ed = editorFalso({ vacio: true, tamano: 2, desde: 1 })
  insertarHtmlEnCursor(ed, '<p>hola</p><p>mundo</p>')
  assert.deepEqual(ed._llamadas, [
    'focus',
    ['insertContentAt', 2, '<p>hola</p><p>mundo</p>'],
    'run',
  ])
})
