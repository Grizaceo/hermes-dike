// La hoja de estilos propia de la página: acotada a `.dike-raiz`, sin tocar
// la app, y con todos los componentes `dk-*` que el código nombra.
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { generarEstilos } from '../estilos.mjs'

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src')
const css = await generarEstilos()

function fuentes(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? fuentes(path.join(dir, e.name))
      : e.name.endsWith('.js') ? [readFileSync(path.join(dir, e.name), 'utf8')] : [])
}

test('ninguna regla sale de la raíz de la página', () => {
  assert.ok(!css.includes(':root'), 'las variables del tema no pueden ir en :root')
  // Selectores de regla (no at-rules ni declaraciones) a cualquier nivel de
  // anidación de @layer/@media/@supports. El respaldo de @property para
  // navegadores sin soporte (`*, ::before…`) solo da valor inicial a variables
  // --tw-* y vive dentro de un @supports que Electron no cumple.
  const sinComentarios = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const fuera = [...sinComentarios.matchAll(/(?:^|[{}])\s*([^{}@;]+?)\s*\{/g)]
    .map((m) => m[1].trim())
    .filter((s) => !s.startsWith('.dike-raiz') && !/^(from|to|\d+%)/.test(s) && !s.startsWith('*, ::before'))
  assert.deepEqual(fuera, [])
})

test('la hoja no trae el reset de Tailwind', () => {
  assert.ok(!/\bbox-sizing:\s*border-box/.test(css.split('@layer components')[0]))
  assert.ok(!css.includes('-webkit-text-size-adjust'))
})

test('cada componente dk-* que el código nombra existe en estilos.css', () => {
  // `(?<!-)` excluye las referencias a variables `(--dk-*)`: son valores,
  // no clases; las clases `dk-*` siempre empiezan tras comilla, espacio o
  // inicio de cadena.
  const usados = new Set(fuentes(SRC).flatMap((f) => f.match(/(?<!-)\bdk-[a-z0-9]+(?:--[a-z0-9]+)?\b/g) || []))
  assert.ok(usados.size > 10, 'common.js debería nombrar los componentes')
  const faltan = [...usados].filter((c) => !css.includes('.' + c))
  assert.deepEqual(faltan, [])
})

test('las utilidades que la app no trae sí están en la hoja', () => {
  // Clases que Hermes Desktop v0.23 no compila y la página usa.
  for (const clase of ['.dike-raiz .flex', '.dike-raiz .min-h-40']) {
    assert.ok(css.includes(clase), clase)
  }
})

test('la hoja es la misma en dos generaciones', async () => {
  assert.equal(await generarEstilos(), css)
})

// ── Guarda de literales de color ──────────────────────────────────────────
// Ninguna utilidad de color de la paleta clara (slate/indigo/emerald/…) ni
// color arbitrario (`bg-[#…]`) puede volver a `src/`: la página se pinta con
// los tokens `--dk-*` / clases `dk-*`, que responden a los dos temas de la
// app. Excepciones declaradas abajo, cada una con su motivo.
const RE_COLOR = /(?:^|[\s'"`])((?:[a-z-]+:)*(?:bg|text|border|ring|from|to|via|fill|stroke|divide|placeholder|caret|accent|decoration|outline)-(?:slate|gray|zinc|neutral|stone|mauve|olive|mist|taupe|indigo|violet|purple|fuchsia|pink|rose|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|white|black)(?:-\d{2,3})?(?:\/\d{1,3})?|(?:bg|text|border|ring|from|to)-\[(?:#|rgb|rgba|hsl|hsla|oklch|color-mix|var\()[^\s'"]*\])/g

const COLORES_PERMITIDOS = [
  {
    archivo: 'grafo3d.js',
    motivo: 'fondo del lienzo 3D: superficie de render WebGL, no cromo de la interfaz',
    permitir: (archivo, hallazgo) => archivo.endsWith('grafo3d.js') && hallazgo === 'bg-[#0b1020]',
  },
]

test('ninguna utilidad de color literal queda en src/ fuera de la lista blanca', () => {
  const archivos = []
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.name.endsWith('.js')) archivos.push(p)
    }
  }
  walk(SRC)

  const infractores = []
  for (const archivo of archivos) {
    const rel = path.relative(SRC, archivo)
    const fuente = readFileSync(archivo, 'utf8')
    for (const m of fuente.matchAll(RE_COLOR)) {
      const hallazgo = m[1]
      const excusa = COLORES_PERMITIDOS.find((p) => p.permitir(rel, hallazgo))
      if (!excusa) infractores.push(`${rel}: ${hallazgo}`)
    }
  }
  assert.deepEqual(infractores, [], 'usa las variables --dk-* o las clases dk-* en su lugar')
})
