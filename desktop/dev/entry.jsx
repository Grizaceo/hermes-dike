// Entrada del arnés: toolbar (tema/idioma/red lenta) + monta la página del
// plugin con el ctx del sdk-stub y el mock de la API. Sin red ni backend.

import { jsx, jsxs } from 'react/jsx-runtime'
import { Profiler, useState } from 'react'
import { createRoot } from 'react-dom/client'
import plugin from '../src/plugin.src.js'
import { createCtx, host, setIdiomaArnes, idiomaArnes, PALETTE_AREA,
  ROUTES_AREA, SIDEBAR_NAV_AREA } from './sdk-stub.js'
import { createMockRest, setMockLento } from './mock-api.js'
import { pedirPestana } from '../src/puente.js'
import './harness.css'

const params = new URLSearchParams(location.search)

function temaInicial() {
  const t = params.get('theme')
  if (t === 'dark' || t === 'light') return t
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}
function aplicaTema(t) {
  document.documentElement.classList.toggle('dark', t === 'dark')
}
function aplicaIdioma(l) { setIdiomaArnes(l) }

aplicaTema(temaInicial())
const idioma0 = params.get('lang') === 'es' ? 'es' : 'en'
aplicaIdioma(idioma0)
setMockLento(params.get('slow') === '1')
if (params.get('tab')) pedirPestana(params.get('tab'))

// Registra el plugin con el ctx stub y localiza la contribución de página.
const mockRest = createMockRest()
const demosCargados = new Set()
const rest = async (path, opts = {}) => {
  const data = await mockRest(path, opts)
  if (params.get('demo') === '1' && path.startsWith('/escrito?') && !opts.method && !demosCargados.has(path)) {
    const demo = await mockRest('/escrito/demo')
    demosCargados.add(path)
    const saved = await mockRest('/escrito', { method: 'POST', body: { case_id: data.case_id, rev_base: data.rev, ...demo } })
    return { ...data, ...demo, rev: saved.rev, existe: true }
  }
  return data
}
if (params.get('verificar') === '1') {
  const observer = new MutationObserver(() => {
    const editor = document.querySelector('.ProseMirror')
    const button = document.querySelector('[data-dike-check]')
    if (!editor?.textContent?.trim() || !button || button.disabled) return
    observer.disconnect()
    button.click()
  })
  observer.observe(document.getElementById('root'), { childList: true, subtree: true, attributes: true })
}
const ctx = createCtx({ rest })
plugin.register(ctx)
const contribuciones = globalThis.__dikeContribs || []
const pagina = contribuciones.find((c) => c.area === ROUTES_AREA)
if (!pagina || typeof pagina.render !== 'function') {
  throw new Error('el plugin no registró una página en ' + ROUTES_AREA)
}

function Barra() {
  const [tema, setTema] = useState(temaInicial())
  const [lang, setLang] = useState(idioma0)
  const [lento, setLento] = useState(params.get('slow') === '1')
  const cambiar = (k, v, fn) => () => {
    const u = new URLSearchParams(location.search)
    u.set(k, v)
    history.replaceState(null, '', '?' + u.toString())
    fn(v)
  }
  return jsxs('div', { id: 'barra', children: [
    jsx('span', { className: 'titulo', children: 'Diké · arnés' }),
    jsx('button', { type: 'button', 'aria-pressed': tema === 'dark',
      onClick: cambiar('theme', tema === 'dark' ? 'light' : 'dark', (v) => { setTema(v); aplicaTema(v) }),
      children: 'Tema: ' + (tema === 'dark' ? 'oscuro' : 'claro') }),
    jsx('button', { type: 'button', 'aria-pressed': lang === 'es',
      onClick: cambiar('lang', lang === 'es' ? 'en' : 'es', (v) => { setLang(v); aplicaIdioma(v) }),
      children: 'Idioma: ' + (lang === 'es' ? 'ES' : 'EN') }),
    jsx('button', { type: 'button', 'aria-pressed': lento,
      onClick: cambiar('slow', lento ? '0' : '1', (v) => { const on = v === '1'; setLento(on); setMockLento(on) }),
      children: 'Red lenta' }),
    jsx('span', { className: 'params', children: location.search || '(sin params)' }),
  ] })
}

const barraEl = document.createElement('div')
document.body.prepend(barraEl)
createRoot(barraEl).render(jsx(Barra, {}))

const page = pagina.render()
globalThis.__dikeCommits = []
createRoot(document.getElementById('root')).render(params.get('perf') === '1'
  ? jsx(Profiler, { id: 'page', onRender: (_id, phase, duration) => {
      globalThis.__dikeCommits.push({ phase, duration })
    }, children: page })
  : page)

// Superficie de depuración para capturas/scripts: estado del mock y host.
globalThis.__dike = { host, ctx, rest, contribuciones }
