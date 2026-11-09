// Build del plugin Desktop: un solo ESM autocontenido en desktop/plugin.js.
// El runtime loader de la app solo admite imports a @hermes/plugin-sdk y a
// react*; todo lo demás (three, 3d-force-graph y sus dependencias) va en línea.
// Tras compilar escribe BUNDLE.json con sha256 y versiones fijadas.
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { build } from 'esbuild'

await build({
  entryPoints: ['src/plugin.src.js'],
  outfile: 'plugin.js',
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2020',
  minify: false,
  legalComments: 'linked',
  sourcemap: false,
  // El prompt de NIF vivo viaja literal en el bundle (escritor/nif_propuestas.md)
  loader: { '.md': 'text' },
  external: [
    '@hermes/plugin-sdk',
    'react',
    'react/jsx-runtime',
    'react/jsx-dev-runtime',
  ],
  alias: {
    // Solo se usan con forceEngine 'ngraph' (aquí siempre d3) y compilan con
    // `new Function`, vetado por scripts/check_desktop_bundle.py.
    'ngraph.graph': './src/ngraph-stub.js',
    'ngraph.forcelayout': './src/ngraph-stub.js',
  },
  logLevel: 'info',
})

// El security scan del instalador marca caracteres unicode invisibles aunque
// vivan en comentarios de terceros (prosemirror-model trae un U+200B). Antes
// del sha se sustituye cada uno por su escape literal: es neutro en strings,
// regex, templates y comentarios, y deja el texto del archivo sin invisibles.
let fuente = readFileSync('plugin.js', 'utf8')
fuente = fuente.replace(/[\u200B\u200C\u200D\u2060\uFEFF]/g, (c) =>
  '\\u' + c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0'))
writeFileSync('plugin.js', fuente)

const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
const bundle = readFileSync('plugin.js')
writeFileSync('BUNDLE.json', JSON.stringify({
  artifact: 'desktop/plugin.js',
  sha256: createHash('sha256').update(bundle).digest('hex'),
  bytes: bundle.length,
  built_with: { esbuild: pkg.devDependencies.esbuild },
  bundled: { ...pkg.dependencies },
  external: [
    '@hermes/plugin-sdk',
    'react',
    'react/jsx-runtime',
    'react/jsx-dev-runtime',
  ],
  stubbed: ['ngraph.graph', 'ngraph.forcelayout'],
  licenses: 'desktop/THIRD_PARTY_LICENSES.txt',
  check: 'python3 scripts/check_desktop_bundle.py',
}, null, 2) + '\n')
console.log('BUNDLE.json actualizado')
