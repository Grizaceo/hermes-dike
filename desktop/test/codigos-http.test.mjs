import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { TEXTOS, fijarIdioma, t } from '../src/i18n.js'
import { mensajeError } from '../src/common.js'
const inventory = JSON.parse(readFileSync(new URL('./fixtures/codigos-http.json', import.meta.url)))
const source = readFileSync(new URL('../../dashboard/dist/index.js', import.meta.url), 'utf8')
const T = JSON.parse(source.match(/var T = (\{[\s\S]*?\});\n  \/\/ i18n:T:end/)[1])
const helper = source.split('// dike:error:begin')[1].split('// dike:error:end')[0]
for (const lang of ['en', 'es']) test('HTTP errors: ' + lang, () => {
  fijarIdioma(lang)
  const ctx = vm.createContext({ T, t: (key, vars) => {
    let value = T[lang][key]
    for (const [k, v] of Object.entries(vars || {})) value = value.split('{' + k + '}').join(v)
    return value
  } })
  vm.runInContext(helper, ctx)
  for (const dict of [TEXTOS[lang], T[lang]]) {
    for (const key of Object.keys(dict).filter(k => k.startsWith('err.'))) {
      assert.ok(inventory.some(e => key === 'err.' + e.code), key)
    }
  }
  for (const entry of inventory) {
    const sentence = entry.en.replace(/\{\w+\}/g, 'example')
    const expected = entry[lang].replace(/\{\w+\}/g, 'example')
    assert.equal(mensajeError(new Error(entry.code + ': ' + sentence)), expected, entry.code)
    if (T[lang]['err.' + entry.code]) {
      assert.equal(ctx.mensajeError({ detail: entry.code + ': ' + sentence }), expected, entry.code)
      assert.equal(ctx.mensajeError(new Error('400: ' + JSON.stringify({ detail: entry.code + ': ' + sentence }))), expected, entry.code)
    }
  }
  for (const fn of [mensajeError, ctx.mensajeError]) {
    assert.equal(fn(new Error('NEW_CODE: New English sentence')), 'New English sentence')
    assert.equal(fn(new Error('Connection failed')), 'Connection failed')
  }
})
