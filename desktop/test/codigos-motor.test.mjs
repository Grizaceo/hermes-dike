import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { TEXTOS, etiquetaCodigo, fijarIdioma } from '../src/i18n.js'
const codes = JSON.parse(readFileSync(new URL('./fixtures/codigos-motor.json', import.meta.url)))
const source = readFileSync(new URL('../../dashboard/dist/index.js', import.meta.url), 'utf8')
const T = JSON.parse(source.match(/var T = (\{[\s\S]*?\});\n  \/\/ i18n:T:end/)[1])
const helper = source.split('// dike:codigo:begin')[1].split('// dike:codigo:end')[0]
for (const lang of ['en', 'es']) {
  test('engine codes have labels in both interfaces: ' + lang, () => {
    fijarIdioma(lang)
    const ctx = vm.createContext({ T, _idioma: lang })
    vm.runInContext(helper, ctx)
    for (const code of codes) {
      assert.ok(TEXTOS[lang]['codigo.' + code], code)
      assert.equal(etiquetaCodigo(code), ctx.etiquetaCodigo(code), code)
      assert.ok(etiquetaCodigo(code).includes('(' + code + ')'), code)
    }
    assert.equal(etiquetaCodigo('FUTURE_UNKNOWN_CODE'), 'FUTURE_UNKNOWN_CODE')
    assert.equal(ctx.etiquetaCodigo('FUTURE_UNKNOWN_CODE'), 'FUTURE_UNKNOWN_CODE')
  })
}

test('backend verdicts, adapter reasons and engine temporal returns have labels', () => {
  const backend = readFileSync(new URL('../../__init__.py', import.meta.url), 'utf8')
  const adapter = backend.split('def _error_adaptador(')[1].split('# ── Validaci')[0]
  const contract = backend.match(/if verdict not in \(([^)]+)\)/)[1]
  const guard = backend.split('def _degradar_cuerpos_en_conflicto')[1] || ''
  const resolver = readFileSync(new URL('../../motor/lexo_cli/starter/resolver.py', import.meta.url), 'utf8')
  const statuses = [...(adapter + contract + guard.slice(0, 3500)).matchAll(/'([A-Z][A-Z_]+)'/g)].map(m => m[1])
  statuses.push(...[...resolver.matchAll(/return "([A-Z][A-Z_]+)"/g)].map(m => m[1]))
  for (const code of new Set(statuses)) {
    for (const lang of ['en', 'es']) assert.ok(TEXTOS[lang]['codigo.' + code], code + ': ' + lang)
  }
})
