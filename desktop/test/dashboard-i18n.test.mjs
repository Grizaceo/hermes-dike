// Tests for dashboard/dist/index.js: the i18n table T, the t() keys it
// references, the confidence validator and the dashboard registration call.
// The bundle is plain JS with no build step; these tests read it as text and
// evaluate marked sections in a fresh vm context — nothing executes the IIFE
// against a real React tree.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import vm from 'node:vm'

const here = dirname(fileURLToPath(import.meta.url))
const SRC = readFileSync(join(here, '../../dashboard/dist/index.js'), 'utf8')

function bloque(marca) {
  const ini = `// ${marca}:begin`
  const fin = `// ${marca}:end`
  const a = SRC.indexOf(ini)
  const b = SRC.indexOf(fin)
  assert.ok(a >= 0 && b > a, `falta el bloque ${marca}`)
  return SRC.slice(a + ini.length, b)
}

const T = JSON.parse(bloque('i18n:T').match(/var T = (\{[\s\S]*\});/)[1])
const fueraDeT = SRC.replace(bloque('i18n:T'), '')

function placeholders(s) {
  return [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
}

test('T tiene las mismas claves en en y es', () => {
  assert.deepEqual(Object.keys(T.en).sort(), Object.keys(T.es).sort())
})

test('cada clave usa los mismos placeholders en ambos idiomas', () => {
  for (const k of Object.keys(T.en)) {
    assert.deepEqual(placeholders(T.en[k]), placeholders(T.es[k]), k)
  }
})

test('toda clave de T se usa y toda llamada t() existe', () => {
  const usadas = new Set()
  for (const m of fueraDeT.matchAll(/\bt\(\s*["']([^"']+)["']/g)) usadas.add(m[1])
  const enT = new Set(Object.keys(T.en))
  for (const k of usadas) assert.ok(enT.has(k), `t('${k}') no existe en T`)
  for (const k of enT) assert.ok(usadas.has(k), `clave sin uso: ${k}`)
})

test('no quedan literales en español fuera de T', () => {
  // «Diké» es nombre propio del producto: igual en ambos idiomas.
  const limpio = fueraDeT.replace(/Diké/g, 'Dike')
  const m = limpio.match(/[áéíóúñü¿¡]/)
  if (m) {
    const ctx = limpio.slice(Math.max(0, m.index - 40), m.index + 10)
    assert.fail(`carácter español fuera de T: …${ctx}…`)
  }
})

test('confianzaValida acepta solo números finitos en [0, 1]', () => {
  const ctx = vm.createContext({})
  vm.runInContext(bloque('dike:confianza-validar'), ctx)
  const f = ctx.confianzaValida
  assert.equal(typeof f, 'function')
  for (const malo of ['', '   ', null, undefined, 'abc', 'NaN', 'Infinity', '-Infinity',
    '1.5', '-0.1', 1.5, -0.1, NaN, Infinity]) {
    assert.equal(f(malo), null, JSON.stringify(malo))
  }
  assert.equal(f('0'), 0)
  assert.equal(f('0.5'), 0.5)
  assert.equal(f('1'), 1)
  assert.equal(f(0.75), 0.75)
  assert.equal(f(' 0.25 '), 0.25)
})

test('el bundle se registra como pestaña «dike» con un SDK stub', () => {
  const registrados = []
  const React = {
    createElement: () => null,
    useState: () => [null, () => {}],
    useEffect: () => {},
    useCallback: (f) => f,
    useMemo: (f) => f,
    useRef: () => ({ current: null }),
  }
  const sdk = {
    React,
    components: {},
    hooks: {},
    utils: {},
    useI18n: () => ({ locale: 'en' }),
    fetchJSON: async () => ({}),
  }
  const win = {
    __HERMES_PLUGIN_SDK__: sdk,
    __HERMES_PLUGINS__: { register: (n, c) => registrados.push([n, c]) },
    localStorage: { getItem: () => null, setItem: () => {} },
  }
  const ctx = vm.createContext({ window: win, console })
  vm.runInContext(SRC, ctx, { filename: 'index.js' })
  assert.equal(registrados.length, 1)
  assert.equal(registrados[0][0], 'dike')
  assert.equal(typeof registrados[0][1], 'function')
})
