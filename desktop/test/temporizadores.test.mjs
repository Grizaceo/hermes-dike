// Temporizadores con ámbito: programarTimeout/programarInterval devuelven
// cancel(); setTimers(ctx) los cambia por los del SDK y sin ctx vuelven a
// los del navegador.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  cancelarTarea, programarInterval, programarTimeout, setTimers,
} from '../src/common.js'

test('con ctx: delega en ctx.setTimeout/setInterval y cancelarTarea los libera', () => {
  const llamadas = []
  setTimers({
    setTimeout: (fn, ms) => {
      llamadas.push(['timeout', ms])
      return () => llamadas.push(['cancel-timeout'])
    },
    setInterval: (fn, ms) => {
      llamadas.push(['interval', ms])
      return () => llamadas.push(['cancel-interval'])
    },
  })
  const ct = programarTimeout(() => {}, 50)
  const ci = programarInterval(() => {}, 40)
  assert.deepEqual(llamadas, [['timeout', 50], ['interval', 40]])
  cancelarTarea(ct)
  cancelarTarea(ci)
  assert.deepEqual(llamadas.slice(2), [['cancel-timeout'], ['cancel-interval']])
})

test('sin ctx (o ctx parcial): vuelve a los temporizadores del navegador', async () => {
  setTimers(null)
  let corrio = false
  const ct = programarTimeout(() => { corrio = true }, 5)
  await new Promise((r) => setTimeout(r, 25))
  assert.equal(corrio, true)
  cancelarTarea(ct) // idempotente sobre un timeout ya disparado

  // ctx con solo setTimeout: el intervalo cae al nativo
  let intervalo = false
  setTimers({ setTimeout: (fn) => () => {} })
  const ci = programarInterval(() => { intervalo = true }, 5)
  await new Promise((r) => setTimeout(r, 25))
  assert.equal(intervalo, true)
  cancelarTarea(ci)
})
