// Puente Grafo → Case Writer: encolar la cita canónica de un resultado de la
// búsqueda por contenido y cambiar a la pestaña del escritor. La consulta
// nunca se guarda ni viaja; el escritor la drena tras cargar el escrito.
import test from 'node:test'
import assert from 'node:assert/strict'
import { encolarCita, tomarCitas } from '../src/puente.js'

test('encolar y tomar devuelve los ítems en orden', () => {
  assert.equal(tomarCitas().length, 0)
  assert.equal(encolarCita({
    cita: 'artículo 161 del Código del Trabajo',
    gid: 'cl.norma.ct:art:0161',
    nodo_id: 'a:207436:art_0161',
    label: 'Código del Trabajo, art. 161',
  }), true)
  assert.equal(encolarCita({ cita: 'artículo 10 de la Ley 20.720' }), true)
  const cola = tomarCitas()
  assert.equal(cola.length, 2)
  assert.equal(cola[0].cita, 'artículo 161 del Código del Trabajo')
  assert.equal(cola[0].gid, 'cl.norma.ct:art:0161')
  assert.equal(cola[0].nodo_id, 'a:207436:art_0161')
  assert.equal(cola[1].gid, null)
  assert.equal(cola[1].nodo_id, null)
  assert.equal(cola[1].label, null)
})

test('tomar vacía la cola', () => {
  encolarCita({ cita: 'artículo 1 de la Ley 20.720' })
  assert.equal(tomarCitas().length, 1)
  assert.deepEqual(tomarCitas(), [])
})

test('tomar sobre cola vacía devuelve []', () => {
  assert.deepEqual(tomarCitas(), [])
})

test('el ítem encolado no lleva campos fuera de {cita, gid, nodo_id, label}', () => {
  encolarCita({
    cita: 'artículo 5 del Código Civil',
    gid: 'cl.norma.cc:art:0005',
    nodo_id: 'a:123:art_0005',
    label: 'Código Civil, art. 5',
    consulta: 'PREGUNTA SECRETA QUE NO DEBE VIAJAR',
    score: 99,
    terminos: ['x'],
  })
  const [item] = tomarCitas()
  assert.deepEqual(Object.keys(item).sort(),
    ['cita', 'gid', 'label', 'nodo_id'])
  assert.equal(JSON.stringify(item).includes('PREGUNTA SECRETA'), false)
})

test('citas vacías o nulas no se encolan', () => {
  assert.equal(encolarCita(null), false)
  assert.equal(encolarCita({}), false)
  assert.equal(encolarCita({ cita: '' }), false)
  assert.equal(encolarCita({ cita: '   ' }), false)
  assert.equal(encolarCita({ cita: 42 }), false)
  assert.deepEqual(tomarCitas(), [])
})
