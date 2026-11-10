import assert from 'node:assert/strict'
import test from 'node:test'

import {
  COLORES_NOTA, PLANTILLAS_PIZARRA, construirNodosPlantilla,
} from '../src/escritor/pizarra-logica.js'

test('PLANTILLAS_PIZARRA incluye demanda, sentencia, contrato y resolucion', () => {
  const ids = PLANTILLAS_PIZARRA.map((p) => p.id)
  assert.deepEqual(ids, ['demanda', 'sentencia', 'contrato', 'resolucion'])
  assert.ok(COLORES_NOTA.length >= 6)
})

test('construirNodosPlantilla crea nodos y aristas en secuencia', () => {
  const demanda = PLANTILLAS_PIZARRA.find((p) => p.id === 'demanda')
  const { nodos, aristas } = construirNodosPlantilla(demanda)
  assert.equal(nodos.length, 4)
  assert.equal(aristas.length, 3)
  assert.equal(aristas[0].from, nodos[0].id)
  assert.equal(aristas[0].to, nodos[1].id)
  assert.ok(nodos.every((n) => n.x >= 0 && n.y >= 0 && n.w > 100 && n.h > 80))
})
