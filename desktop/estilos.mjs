// Hoja de estilos propia de la página Desktop.
//
// La app compila Tailwind solo sobre su propio código: una clase que la app
// no usa no existe en su CSS, y una página de plugin que la use queda sin
// estilo (en Hermes Desktop v0.23, 182 de las 411 clases de esta página no
// tenían regla). Por eso la página lleva su hoja: las utilidades que usa
// `src/`, generadas con Tailwind, más sus componentes propios
// (`src/estilos.css`), todo acotado a `.dike-raiz` para no tocar nada de la
// app. `src/plugin.src.js` la inyecta al registrarse y la retira al
// descargarse; el arnés de `dev/` usa la misma.

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { compile } from '@tailwindcss/node'
import { Scanner } from '@tailwindcss/oxide'

const DESKTOP = path.dirname(fileURLToPath(import.meta.url))

// Sin el reset de Tailwind (preflight): la tipografía y los controles base
// son los de la app. Solo el tema (variables) y las utilidades.
// Los componentes propios (src/estilos.css) van antes que las utilidades, para
// que una utilidad pueda ajustar un componente y no al revés.
const ENTRADA = `@layer theme, components, utilities;
@import 'tailwindcss/theme.css' layer(theme);
@import './src/estilos.css' layer(components);
.dike-raiz { @tailwind utilities; }`

export async function generarEstilos() {
  const compilador = await compile(ENTRADA, { base: DESKTOP, onDependency() {} })
  const clases = new Scanner({
    sources: [{ base: path.join(DESKTOP, 'src'), pattern: '**/*.js', negated: false }],
  }).scan()
  const css = compilador.build(clases)
  // Las variables del tema también quedan dentro de la raíz: definidas en
  // :root pisarían las de la app (su fuente, sus radios) en toda la ventana.
  if (css.split(':root, :host').length !== 2) {
    throw new Error('estilos: no encuentro el bloque de variables del tema de Tailwind')
  }
  return css.replace(':root, :host', '.dike-raiz')
}

// Plugin de esbuild: `import ESTILOS from '#dike-estilos'` es la hoja como texto.
// El especificador no lleva «:» a propósito: `hermes plugins validate` rechaza
// todo import con forma de esquema de URL (`x:`) en desktop/, también en src/.
export const estilosPlugin = {
  name: 'dike-estilos',
  setup(build) {
    build.onResolve({ filter: /^#dike-estilos$/ }, () => ({ path: 'estilos', namespace: 'dike' }))
    build.onLoad({ filter: /.*/, namespace: 'dike' }, async () => ({
      contents: await generarEstilos(), loader: 'text',
    }))
  },
}
