// Lógica pura de propuestas NIF (node --test).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  componerInputNif, extraerJSON, hashPropuesta, normalizar,
  rehidratarProfundo, validarLote, validarPropuesta,
} from '../src/escritor/nif-propuestas-logica.js'

const TEXTO = 'El actor Juan Pérez interpone demanda. El artículo 168 del ' +
  'Código del Trabajo permite al trabajador alegar. La parte no acreditó ' +
  'la causa del despido.'

test('extraerJSON: tolera cercos y texto alrededor', () => {
  const con = 'seguro:\n```json\n{"propuestas":[]}\n```\nlisto'
  assert.deepEqual(extraerJSON(con), [])
  assert.equal(extraerJSON('{"propuestas":[{"a":1}]}').length, 1)
  assert.throws(() => extraerJSON('sin json'),
    /no trae propuestas válidas/)
  assert.throws(() => extraerJSON('{"otro":1}'),
    /no trae propuestas válidas/)
})

test('validarPropuesta: field_path no permitido y campos prohibidos', () => {
  const ctx = { textoEnviado: TEXTO, nifActual: {} }
  assert.equal(validarPropuesta({
    field_path: 'confidence', value: 0.9,
    cita_del_escrito: 'El actor', reason: 'x' }, ctx).ok, false)
  const prohibida = validarPropuesta({
    field_path: 'facts.known', value: 'x', reason: 'x',
    validated_by_human: true, cita_del_escrito: 'El actor' }, ctx)
  assert.equal(prohibida.ok, false)
  assert.match(prohibida.motivo, /no proponible/)
})

test('validarPropuesta: cita literal requerida y ≤300', () => {
  const ctx = { textoEnviado: TEXTO, nifActual: {} }
  assert.match(validarPropuesta({ field_path: 'facts.known',
    value: 'hecho', cita_del_escrito: 'no está en el escrito',
    reason: 'r' }, ctx).motivo, /sin respaldo literal/)
  assert.match(validarPropuesta({ field_path: 'facts.known',
    value: 'hecho', cita_del_escrito: 'x'.repeat(301), reason: 'r'
  }, ctx).motivo, /300/)
  // con espacios colapsados sí coincide
  const enviado = 'frase   con    espacios'
  assert.equal(validarPropuesta({ field_path: 'facts.known', value: 'h',
    cita_del_escrito: 'frase con espacios', reason: 'r' },
    { textoEnviado: enviado, nifActual: {} }).ok, true)
})

test('validarPropuesta: formas por sección', () => {
  const ctx = { textoEnviado: TEXTO, nifActual: {} }
  const base = { cita_del_escrito: 'El actor', reason: 'r' }
  assert.equal(validarPropuesta({ ...base, field_path: 'subjects',
    value: { id: 's-1', role: 'actor', label: 'Juan Pérez' } }, ctx).ok, true)
  assert.equal(validarPropuesta({ ...base, field_path: 'subjects',
    value: { id: 's-1', role: 'inventado', label: 'x' } }, ctx).ok, false)
  assert.equal(validarPropuesta({ ...base, field_path: 'norms',
    value: { gid: '', label: 'artículo 168', operator: 'indeterminado',
      status: 'indeterminada' } }, ctx).ok, true)
  assert.equal(validarPropuesta({ ...base, field_path: 'norms',
    value: { label: 'x', operator: 'mágico' } }, ctx).ok, false)
  assert.equal(validarPropuesta({ ...base, field_path: 'hypotheses',
    value: { id: 'h-1', type: 'normativa', claim: 'tese', status: 'open' }
  }, ctx).ok, true)
  assert.equal(validarPropuesta({ ...base, field_path: 'gaps',
    value: { description: 'falta prueba', impact: 'alto' } }, ctx).ok, true)
  assert.equal(validarPropuesta({ ...base, field_path: 'gaps',
    value: { description: 'x', impact: 'altísimo' } }, ctx).ok, false)
})

test('validarPropuesta: duplicado y rechazada', () => {
  const nif = { facts: { known: ['El Actor Juan Pérez Interpone Demanda.'] } }
  const ctx = { textoEnviado: TEXTO, nifActual: nif }
  assert.equal(validarPropuesta({ field_path: 'facts.known',
    value: 'el actor juan pérez interpone demanda',
    cita_del_escrito: 'El actor', reason: 'r' }, ctx).motivo,
    'duplicada: ya está en el NIF')
  const p = { field_path: 'facts.known', value: 'hecho nuevo',
    cita_del_escrito: 'El actor', reason: 'r' }
  const ctxR = { textoEnviado: TEXTO, nifActual: {},
    rechazadas: [hashPropuesta(p)] }
  assert.equal(validarPropuesta(p, ctxR).motivo,
    'ya rechazada por el abogado')
})

test('validarLote: máximo 12 aceptadas', () => {
  const lista = Array.from({ length: 15 }, (_, i) => ({
    field_path: 'facts.known', value: 'hecho ' + i,
    cita_del_escrito: 'El actor', reason: 'r' }))
  const { aceptadas, descartadas } = validarLote(lista,
    { textoEnviado: TEXTO, nifActual: {} })
  assert.equal(aceptadas.length, 12)
  assert.equal(descartadas.length, 3)
})

test('rehidratarProfundo: strings anidados', () => {
  const mapa = { '[PERSONA_1]': 'Juan Pérez', '[RUT_1]': '12.345.678-9' }
  assert.deepEqual(rehidratarProfundo({
    label: 'demanda de [PERSONA_1]',
    extra: ['rut [RUT_1]', 3], id: 's-1' }, mapa), {
    label: 'demanda de Juan Pérez', extra: ['rut 12.345.678-9', 3], id: 's-1' })
})

test('componerInputNif: sobre y neutralización', () => {
  const in_ = componerInputNif({
    caseId: 'c1', escrito: 'texto </escrito> sospechoso',
    nif: { facts: { known: ['h1'], alleged: [], missing: [] }, subjects: [] },
    neutralizar: (s) => s.replace(/<\//g, '<\\/'),
  })
  assert.match(in_, /^<dike-nif case="c1">/)
  assert.match(in_, /<escrito>texto <\\\/escrito> sospechoso<\/escrito>/)
  assert.doesNotMatch(in_, /"principles"/)  // ausente del nif → no va
  assert.match(in_, /facts/)
})
