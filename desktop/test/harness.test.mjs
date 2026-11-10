// El arnés no puede quedarse viejo en silencio: este test construye
// dev/dist y verifica que el mock cubre cada ruta rest('…') de src/.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const DESKTOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SRC = path.join(DESKTOP, 'src')
const DIST = path.join(DESKTOP, 'dev', 'dist')

function* jsFiles(dir) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name)
    if (statSync(p).isDirectory()) yield* jsFiles(p)
    else if (name.endsWith('.js')) yield p
  }
}

// Literales rest('/ruta…') de src/ → pathnames (sin query).
function rutasDeSrc() {
  const out = new Set()
  for (const file of jsFiles(SRC)) {
    const texto = readFileSync(file, 'utf8')
    for (const m of texto.matchAll(/\brest\(\s*'([^']+)'/g)) {
      const lit = m[1]
      const pathname = lit.split('?')[0].replace(/\s*\+.*$/, '').trim()
      if (pathname.startsWith('/')) out.add(pathname)
    }
  }
  return [...out].sort()
}

test('dev:build produce dist/harness.js e index.html', () => {
  execFileSync(process.execPath, ['dev/build.mjs'], { cwd: DESKTOP, stdio: 'pipe' })
  assert.ok(existsSync(path.join(DIST, 'harness.js')), 'falta dist/harness.js')
  assert.ok(existsSync(path.join(DIST, 'index.html')), 'falta dist/index.html')
  assert.ok(statSync(path.join(DIST, 'harness.js')).size > 100_000,
    'harness.js sospechosamente pequeño')
})

test('el mock cubre cada rest() de src/ (GET o POST)', async () => {
  const { createMockRest } = await import('../dev/mock-api.js')
  const rest = createMockRest()
  const rutas = rutasDeSrc()
  assert.ok(rutas.length >= 20, 'el escáner encontró pocas rutas: ' + rutas.length)
  const faltantes = []
  for (const ruta of rutas) {
    let ok = false
    for (const metodo of ['GET', 'POST']) {
      try {
        await rest(ruta, { method: metodo, body: {} })
        ok = true
        break
      } catch (e) {
        if (!(e && e.status === 404)) { ok = true; break }
      }
    }
    if (!ok) faltantes.push(ruta)
  }
  assert.deepEqual(faltantes, [],
    'rutas de src/ sin mock (agrega el fixture en dev/mock-api.js): ' + faltantes.join(', '))
})

test('el texto demo del mock coincide con tests/fixtures/escrito_demo.md', async () => {
  const { DEMO_TEXTO } = await import('../dev/fixtures.js')
  const real = readFileSync(
    path.join(DESKTOP, '..', 'tests', 'fixtures', 'escrito_demo.md'), 'utf8').trim()
  assert.equal(DEMO_TEXTO.trim(), real)
})

test('el demo emite veredictos del contrato público', async () => {
  const { resultadoVerificar, DEMO_TEXTO } = await import('../dev/fixtures.js')
  for (const text of [DEMO_TEXTO, '']) {
    assert.ok(['TODAS_VERIFICADAS', 'CON_PROBLEMAS', 'SIN_CITAS', 'SIN_CORPUS'].includes(resultadoVerificar(text).veredicto))
  }
})
