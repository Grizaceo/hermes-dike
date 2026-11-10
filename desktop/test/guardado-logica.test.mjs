// Lógica del guardado del escrito: reintento único tras 409 y la instantánea
// pendiente en storage. Sin navegador ni React (node --test).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { setStorage } from '../src/common.js'
import {
  borrarPendiente, escribirPendiente, esConflicto, guardarConReintento,
  leerPendiente, pendienteDiff,
} from '../src/escritor/guardado-logica.js'

const conflicto = (rev) => {
  const e = new Error('conflicto')
  e.status = 409
  e.detail = { rev_actual: rev }
  return e
}

test('esConflicto reconoce 409 por status, statusCode, detail o mensaje', () => {
  assert.equal(esConflicto(null), false)
  assert.equal(esConflicto(new Error('otro')), false)
  assert.equal(esConflicto(conflicto(3)), true)
  assert.equal(esConflicto({ statusCode: 409 }), true)
  assert.equal(esConflicto({ detail: { rev_actual: 7 } }), true)
  assert.equal(esConflicto(new Error('HTTP 409 rev_actual=2')), true)
})

test('guardarConReintento: éxito a la primera no reintenta', async () => {
  let llamadas = 0
  const r = await guardarConReintento(
    async () => { llamadas++; return { rev: 4 } },
    async () => { throw new Error('no debe llamarse') })
  assert.deepEqual(r, { ok: true, resp: { rev: 4 } })
  assert.equal(llamadas, 1)
})

test('guardarConReintento: 409 refresca rev y reintenta una vez', async () => {
  const revs = []
  let revActualLlamadas = 0
  const r = await guardarConReintento(
    async (revBase) => {
      revs.push(revBase)
      if (revs.length === 1) throw conflicto(9)
      return { rev: 10 }
    },
    async () => { revActualLlamadas++; return 9 })
  assert.equal(r.ok, true)
  assert.equal(r.reintentado, true)
  assert.deepEqual(revs, [undefined, 9])
  assert.equal(revActualLlamadas, 1)
})

test('guardarConReintento: segundo 409 devuelve conflicto con rev_actual', async () => {
  const r = await guardarConReintento(
    async () => { throw conflicto(5) },
    async () => 5)
  assert.equal(r.ok, false)
  assert.equal(r.conflicto, true)
  assert.equal(r.rev_actual, 5)
})

test('guardarConReintento: revActual ilegible también es conflicto', async () => {
  const r = await guardarConReintento(
    async () => { throw conflicto(1) },
    async () => null)
  assert.equal(r.ok, false)
  assert.equal(r.conflicto, true)
})

test('guardarConReintento: error que no es 409 no reintenta', async () => {
  let revActualLlamadas = 0
  const r = await guardarConReintento(
    async () => { throw new Error('red caída') },
    async () => { revActualLlamadas++; return 1 })
  assert.equal(r.ok, false)
  assert.equal(r.error.message, 'red caída')
  assert.equal(revActualLlamadas, 0)
})

// --- Instantánea pendiente en storage --------------------------------------

function storageFalso() {
  const m = new Map()
  return {
    get: (k, fb) => (m.has(k) ? m.get(k) : fb),
    set: (k, v) => m.set(k, v),
    remove: (k) => m.delete(k),
    _map: m,
  }
}

test('pendiente: escribir/leer/borrar ida y vuelta por caso', () => {
  setStorage(storageFalso())
  const p = { case_id: 'caso-a', html: '<p>hola</p>', texto: 'hola',
    registro: { pistas: [] } }
  escribirPendiente(p)
  assert.deepEqual(leerPendiente('caso-a'), p)
  assert.equal(leerPendiente('caso-b'), null)
  borrarPendiente('caso-a')
  assert.equal(leerPendiente('caso-a'), null)
})

test('pendiente: formas inválidas se leen como null', () => {
  const s = storageFalso()
  setStorage(s)
  escribirPendiente({ case_id: 'x' }) // sin html/texto
  // forzar una entrada mal formada directo en el mapa
  s._map.set('escrito.pendiente.mal', { case_id: 'otro', html: 1 })
  s._map.set('escrito.pendiente.vacio', null)
  assert.equal(leerPendiente('x'), null)
  assert.equal(leerPendiente('mal'), null)
  assert.equal(leerPendiente('vacio'), null)
})

test('pendiente: tolera storage ausente o que lanza', () => {
  setStorage(null)
  escribirPendiente({ case_id: 'a', html: '', texto: '' })
  assert.equal(leerPendiente('a'), null)
  borrarPendiente('a') // no lanza
  setStorage({
    get: () => { throw new Error('storage roto') },
    set: () => { throw new Error('storage roto') },
    remove: () => { throw new Error('storage roto') },
  })
  assert.equal(leerPendiente('a'), null)
  escribirPendiente({ case_id: 'a', html: '', texto: '' })
  borrarPendiente('a')
})

test('pendienteDiff: detecta cambios de texto, html o registro', () => {
  const base = { texto: 'abc', html: '<p>abc</p>', registro: { x: 1 } }
  assert.equal(pendienteDiff(base, { ...base }), false)
  assert.equal(pendienteDiff({ ...base, texto: 'abc ' }, base), true)
  // mismo texto pero formato distinto (p. ej. negrita) también cuenta
  assert.equal(pendienteDiff({ ...base, html: '<p><b>abc</b></p>' }, base), true)
  assert.equal(pendienteDiff({ ...base, registro: { x: 2 } }, base), true)
  assert.equal(pendienteDiff(null, base), false)
  assert.equal(pendienteDiff(base, null), false)
})
