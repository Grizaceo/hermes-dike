// Build del arnés de desarrollo: bundle IIFE de dev/entry.jsx con
// @hermes/plugin-sdk → dev/sdk-stub.js y react/react-dom resueltos desde la
// instalación de hermes-agent (no se copian al repo). Salida en dev/dist/.

import { build } from 'esbuild'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DEV = path.dirname(fileURLToPath(import.meta.url))
const DESKTOP = path.resolve(DEV, '..')

// React 19 no publica UMD: se toma de la instalación de hermes-agent
// (solo lectura, nada se copia al repo). DIKE_DEV_NODE_MODULES lo pisa.
const NM = process.env.DIKE_DEV_NODE_MODULES
  || '/home/gris96/.hermes/hermes-agent/node_modules'
if (!existsSync(path.join(NM, 'react', 'package.json'))
    || !existsSync(path.join(NM, 'react-dom', 'package.json'))) {
  console.error('dev:build: no encuentro react/react-dom en ' + NM +
    ' — define DIKE_DEV_NODE_MODULES o instala las deps del desktop de hermes.')
  process.exit(1)
}

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
  nodePaths: [NM, path.join(DESKTOP, 'node_modules')],
  alias: {
    '@hermes/plugin-sdk': path.join(DEV, 'sdk-stub.js'),
    // Igual que build.mjs de producción: ngraph no va en el bundle.
    'ngraph.graph': path.join(DESKTOP, 'src', 'ngraph-stub.js'),
    'ngraph.forcelayout': path.join(DESKTOP, 'src', 'ngraph-stub.js'),
  },
  loader: { '.md': 'text' },
  logLevel: 'info',
})

writeFileSync(path.join(dist, 'index.html'), `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Diké · dev harness</title>
<link rel="stylesheet" href="harness.css">
</head>
<body>
<div id="root"></div>
<script src="harness.js"></script>
</body>
</html>
`)

console.log('dev:build → ' + path.relative(process.cwd(), dist))
