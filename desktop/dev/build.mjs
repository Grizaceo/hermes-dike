// Build del arnés de desarrollo: bundle IIFE de dev/entry.jsx con
// @hermes/plugin-sdk → dev/sdk-stub.js y react/react-dom de las
// devDependencies. Salida en dev/dist/.

import { build } from 'esbuild'
import { compile } from '@tailwindcss/node'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { estilosPlugin } from '../estilos.mjs'

const DEV = path.dirname(fileURLToPath(import.meta.url))
const DESKTOP = path.resolve(DEV, '..')

const dist = path.join(DEV, 'dist')
mkdirSync(dist, { recursive: true })

await build({
  entryPoints: [path.join(DEV, 'entry.jsx')],
  outfile: path.join(dist, 'harness.js'),
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  alias: {
    '@hermes/plugin-sdk': path.join(DEV, 'sdk-stub.js'),
    // Igual que build.mjs de producción: ngraph no va en el bundle.
    'ngraph.graph': path.join(DESKTOP, 'src', 'ngraph-stub.js'),
    'ngraph.forcelayout': path.join(DESKTOP, 'src', 'ngraph-stub.js'),
  },
  loader: { '.md': 'text' },
  plugins: [estilosPlugin],
  logLevel: 'info',
})

// La app trae el reset de Tailwind (preflight) y la página cuenta con él: sin
// él los botones salen con el aspecto del navegador. La página no lo lleva en
// su hoja; aquí hace de «CSS de la app».
const reset = await compile("@import 'tailwindcss/preflight.css' layer(base);",
  { base: DESKTOP, onDependency() {} })
writeFileSync(path.join(dist, 'app-base.css'), reset.build([]))

writeFileSync(path.join(dist, 'index.html'), `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Diké · dev harness</title>
<link rel="stylesheet" href="app-base.css">
<link rel="stylesheet" href="harness.css">
</head>
<body>
<div id="root"></div>
<script src="harness.js"></script>
</body>
</html>
`)

console.log('dev:build → ' + path.relative(process.cwd(), dist))
