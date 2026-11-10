// Lógica pura del módulo Privacidad (node --test): rehidratar, agrupar por
// tipo, decisiones optimistas en la vista y marcas para el editor.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  agruparPorTipo, aplicarDecisionVista, claseDecoracion, marcasParaEditor,
  rehidratar,
} from '../src/escritor/privacidad-logica.js'

test('rehidratar reemplaza tokens por valores del mapa', () => {
  const mapa = { '[PERSONA_1]': 'Ana Rojas', '[RUT_1]': '15.432.876-9', '[PERSONA_10]': 'Z' }
  const out = rehidratar('comparece [PERSONA_1], cédula [RUT_1], junto a [PERSONA_10]', mapa)
  assert.equal(out, 'comparece Ana Rojas, cédula 15.432.876-9, junto a Z')
})

test('rehidratar sin mapa devuelve el texto', () => {
  assert.equal(rehidratar('abc [PERSONA_1]', null), 'abc [PERSONA_1]')
  assert.equal(rehidratar('', {}), '')
})

test('agruparPorTipo agrupa y ordena por cantidad', () => {
  const ents = [
    { tipo: 'rut', inicio: 5, fin: 9, valor: 'a' },
    { tipo: 'full_name', inicio: 0, fin: 3, valor: 'b' },
    { tipo: 'rut', inicio: 1, fin: 4, valor: 'c' },
  ]
  const g = agruparPorTipo(ents)
  assert.equal(g[0].tipo, 'rut')
  assert.equal(g[0].items[0].valor, 'c') // orden por inicio dentro del grupo
  assert.equal(g[1].tipo, 'full_name')
})

test('aplicarDecisionVista cambia acción solo del mismo valor normalizado', () => {
  const ents = [
    { valor: 'Ana Rojas', accion: 'enmascarar', severidad: 'high' },
    { valor: 'Otro Nombre', accion: 'enmascarar', severidad: 'high' },
  ]
  const out = aplicarDecisionVista(ents, 'ana  rojas ', 'conservar')
  assert.equal(out[0].accion, 'conservar')
  assert.equal(out[0].motivo, 'decision_abogado')
  assert.equal(out[1].accion, 'enmascarar')
  // enmascarar de vuelta quita el motivo
  const out2 = aplicarDecisionVista(out, 'Ana Rojas', 'enmascarar')
  assert.equal(out2[0].accion, 'enmascarar')
  assert.equal(out2[0].motivo, undefined)
})

test('claseDecoracion: conservada o por severidad', () => {
  assert.equal(claseDecoracion({ accion: 'conservar' }), 'conservada')
  assert.equal(claseDecoracion({ accion: 'enmascarar', severidad: 'critical' }), 'critical')
  assert.equal(claseDecoracion({ accion: 'enmascarar' }), 'low')
})

test('marcasParaEditor: entidades + candidatos con título', () => {
  const rango = (i, f) => ({ from: i + 1, to: f + 1 })
  const marcas = marcasParaEditor(
    [{ inicio: 2, fin: 8, tipo: 'rut', accion: 'enmascarar', severidad: 'critical' }],
    [{ inicio: 10, fin: 16, valor: 'Posible Nombre' }], rango)
  assert.equal(marcas.length, 2)
  assert.equal(marcas[0].clase, 'critical')
  assert.equal(marcas[1].clase, 'candidato')
})
