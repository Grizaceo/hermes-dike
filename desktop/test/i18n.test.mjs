// i18n.test.mjs — paridad de diccionarios, placeholders y cobertura de claves.
//
// Limitación conocida del guard de literales: el regex mira strings con
// acentos o signos ¿¡ dentro de comillas/backticks; un literal español sin
// acentos ("Guardar", "Cerrar") pasa desapercibido, y una clave construida
// dinámicamente (t('x.' + v)) tampoco se detecta. Los tests de cobertura de
// claves t() sí ven las llamadas estáticas.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TEXTOS, t, fijarIdioma, anidarTextos } from '../src/i18n.js'

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src')

function* archivos(dir) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n)
    if (statSync(p).isDirectory()) yield* archivos(p)
    else if (/\.(js|jsx)$/.test(n)) yield p
  }
}

const EXENTOS_LITERAL = new Set([
  'src/i18n.js',           // los diccionarios viven aquí
  'src/escritor/prediccion/l0.js', // plantillas y catálogo: contenido legal, no interfaz
])

test('mismo conjunto de claves en en y es', () => {
  const en = Object.keys(TEXTOS.en).sort()
  const es = Object.keys(TEXTOS.es).sort()
  assert.deepEqual(en, es)
})

test('mismos placeholders {var} por clave', () => {
  const vars = (s) => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort()
  for (const k of Object.keys(TEXTOS.en)) {
    assert.deepEqual(vars(TEXTOS.en[k]), vars(TEXTOS.es[k]), k)
  }
})

test('t() resuelve, sustituye vars y cae a la otra lengua', () => {
  fijarIdioma('es')
  assert.equal(t('shell.pestana.nif'), 'Tablero NIF')
  assert.equal(t('shell.pestana.nif', {}), 'Tablero NIF')
  assert.equal(t('shell.estado.sinAislamiento', { motivo: 'x' }), 'sin aislamiento: x')
  fijarIdioma('en')
  assert.equal(t('shell.pestana.nif'), 'Case board')
  assert.equal(t('shell.estado.sinAislamiento', { motivo: 'x' }), 'not sandboxed: x')
  // clave inexistente → devuelve la clave
  assert.equal(t('no.existe'), 'no.existe')
})

test('anidarTextos produce árboles resolubles por ctx.i18n', () => {
  const arbol = anidarTextos()
  assert.equal(arbol.en.shell.pestana.nif, 'Case board')
  assert.equal(arbol.es.nif.seccion.gaps, 'Vacíos')
})

test('toda clave t() usada en src/ existe en ambos diccionarios', () => {
  const usadas = new Set()
  const re = /\bt\(\s*['"`]([\w.]*[\w])['"`]/g
  for (const f of archivos(SRC)) {
    if (f.endsWith('i18n.js')) continue
    for (const m of readFileSync(f, 'utf8').matchAll(re)) usadas.add(m[1])
  }
  const faltan = [...usadas].filter(k => !(k in TEXTOS.en) || !(k in TEXTOS.es))
  assert.deepEqual(faltan, [], `claves sin traducir: ${faltan.join(', ')}`)
})

test('ninguna clave del diccionario queda sin uso', () => {
  // Una clave cuenta como usada si aparece como literal en src/, ya sea en
  // t('clave') o como dato que luego pasa por t() (p.ej. SECCIONES_NIF,
  // MOTIVOS, opciones de <select>).
  const usadas = new Set()
  const re = /\bt\(\s*['"`]([\w.]*[\w])['"`]/g
  for (const f of archivos(SRC)) {
    if (f.endsWith('i18n.js')) continue
    const texto = readFileSync(f, 'utf8')
    for (const m of texto.matchAll(re)) usadas.add(m[1])
  }
  const huerfanas = Object.keys(TEXTOS.en).filter(k => {
    if (usadas.has(k) || k.startsWith('proposal.') || k.startsWith('codigo.')) return false
    // clave transportada como dato: el literal 'clave' aparece en src/
    const reClave = new RegExp(`['"\`]${k.replace(/\./g, '\\.')}['"\`]`)
    for (const f of archivos(SRC)) {
      if (f.endsWith('i18n.js')) continue
      if (reClave.test(readFileSync(f, 'utf8'))) return false
    }
    return true
  })
  assert.deepEqual(huerfanas, [], `claves sin uso: ${huerfanas.join(', ')}`)
})

test('sin literales de interfaz en español fuera de i18n.js y l0.js', () => {
  // Regex: comilla/backtick seguida de texto con acento o ¿¡. No ve "Guardar"
  // sin tilde ni strings armados por concatenación de variables.
  const re = /['"`][^'"`\n]*[áéíóúñüÁÉÍÓÚÑÜ¿¡][^'"`\n]*['"`]/g
  const culpables = []
  for (const f of archivos(SRC)) {
    const rel = 'src/' + f.slice(SRC.length + 1).replace(/\\/g, '/')
    if (EXENTOS_LITERAL.has(rel)) continue
    const lineas = readFileSync(f, 'utf8').split('\n')
    lineas.forEach((l, i) => {
      // Legal templates and the Spanish model protocol are data, not UI.
      if (l.trim().startsWith('//')) return
      if (rel.endsWith('barra-formato.js') && /(?:label|texto): '(?:PRIMER OTROSÍ|SEGUNDO OTROSÍ|POR TANTO)/.test(l)) return
      if (rel.endsWith('pizarra-logica.js') && /titulo: /.test(l)) return
      if (rel.endsWith('chat-logica.js') && /párrafos omitidos|'sí'/.test(l)) return
      if (rel.endsWith('prediccion/l2.js') && /(?:Continúa el texto|citas: si la continuación|Responde solo con la continuación)/.test(l)) return
      if (re.test(l.replace(/Diké/g, 'Dike'))) culpables.push(`${rel}:${i + 1}: ${l.trim().slice(0, 90)}`)
      re.lastIndex = 0
    })
  }
  assert.deepEqual(culpables, [], `literales en español:\n${culpables.join('\n')}`)
})
