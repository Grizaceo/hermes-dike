// Stub de @hermes/plugin-sdk para el arnés offline de desktop/dev.
// Implementa solo lo que la página toca: host.* (state, navigate,
// profileRoutes, requestProfile, retainProfile, onEvent, i18n) y el ctx que
// recibe register() (rest, storage, registerMany, timers con scope, i18n).
// Respuestas fijas tipo "canned"; el mock de la API vive en mock-api.js.

export const PALETTE_AREA = 'palette'
export const ROUTES_AREA = 'routes'
export const SIDEBAR_NAV_AREA = 'sidebar'

// ---------------------------------------------------------------------------
// Estado del arnés (el toolbar de index.html lo cambia)
// ---------------------------------------------------------------------------

let idioma = 'en'
const oyentesIdioma = new Set()

export function setIdiomaArnes(v) {
  idioma = v === 'es' ? 'es' : 'en'
  for (const f of [...oyentesIdioma]) f()
}
export function idiomaArnes() { return idioma }

// ---------------------------------------------------------------------------
// host
// ---------------------------------------------------------------------------

const oyentes = new Map() // tipo -> Set<fn>
let sesionDev = null
const navegaciones = []

function emite(tipo, ev) {
  for (const f of oyentes.get(tipo) || []) f(ev)
}

function canned(method, params) {
  switch (method) {
    case 'plugins.list':
      return { plugins: [{ name: 'dike', enabled: true, status: 'ok' }] }
    case 'commands.catalog':
      return { commands: [{ name: 'dike-verificar', description: 'Verificar citas' }] }
    case 'session.list':
      return { sessions: sesionDev ? [{
        id: sesionDev, stored_session_id: sesionDev,
        title: 'Diké · Escrito · dev', hidden: true,
      }] : [] }
    case 'session.create': {
      sesionDev = 'ses-dev-' + Math.random().toString(36).slice(2, 8)
      return { session_id: sesionDev,
        info: { session_id: sesionDev, title: params && params.title } }
    }
    case 'session.resume':
      return { session_id: sesionDev || 'ses-dev-1',
        info: { session_id: sesionDev || 'ses-dev-1' } }
    case 'session.interrupt':
      return { ok: true }
    case 'config.get':
      return { auxiliary: { dike_prediccion: {
        provider: 'ollama', base_url: 'http://127.0.0.1:11434' } } }
    case 'llm.oneshot':
      return { text: ' La causal invocada exige prueba del hecho en que se funda.' }
    default:
      throw new Error('sdk-stub: método no implementado ' + method)
  }
}

export const host = {
  state: { profile: { get: () => 'dev', listen: (f) => f && f('dev') } },
  navigate: (path) => { navegaciones.push(path); return true },
  profileRoutes: async () => ({ routes: [{ targetProfile: 'dev', profile: 'dev' }] }),
  requestProfile: async (_ruta, method, params) => {
    if (method === 'prompt.submit') {
      // Respuesta de asistente simulada con citas para ver el verificador.
      const sid = params && params.session_id
      const texto = 'La demanda se funda en el artículo 161 del Código del ' +
        'Trabajo y el artículo 162 del Código del Trabajo. Conviene revisar ' +
        'también el artículo 163 del Código del Trabajo y el artículo 168 ' +
        'del Código del Trabajo.'
      setTimeout(() => {
        emite('message.delta', { session_id: sid, offset: 0, text: texto })
        emite('message.complete', { session_id: sid, text: texto })
      }, 400)
      return { ok: true }
    }
    return canned(method, params)
  },
  retainProfile: async () => () => {},
  onEvent: (tipo, listener) => {
    if (!oyentes.has(tipo)) oyentes.set(tipo, new Set())
    oyentes.get(tipo).add(listener)
    return () => oyentes.get(tipo) && oyentes.get(tipo).delete(listener)
  },
  i18n: {
    registerAppLocale: () => () => {},
    languageOptions: () => [
      { id: 'en', endonym: 'English', active: idioma === 'en' },
      { id: 'es', endonym: 'Español', active: idioma === 'es' },
    ],
  },
  notify: () => {},
}

// ---------------------------------------------------------------------------
// ctx (lo que recibe plugin.register)
// ---------------------------------------------------------------------------

function resuelveMensaje(mensajes, key, args) {
  let actual = mensajes
  for (const parte of key.split('.')) {
    if (actual && typeof actual === 'object' && parte in actual) actual = actual[parte]
    else return key
  }
  if (typeof actual === 'function') return actual(...args)
  if (typeof actual !== 'string') return key
  return args.reduce((s, a, i) => s.split('{' + i + '}').join(String(a)), actual)
}

export function createCtx({ rest }) {
  const bundles = new Map() // locale -> messages (merge simple)
  const oyentesI18n = new Set()
  const guardados = []

  const i18n = {
    register: (porLocale) => {
      for (const [loc, msgs] of Object.entries(porLocale || {})) {
        bundles.set(loc, { ...(bundles.get(loc) || {}), ...(msgs || {}) })
      }
      return () => {}
    },
    t: (key, ...args) => {
      const orden = idioma === 'es' ? ['es', 'en'] : ['en', 'es']
      for (const loc of orden) {
        const msgs = bundles.get(loc)
        if (msgs) {
          const v = resuelveMensaje(msgs, key, args)
          if (v !== key) return v
        }
      }
      return key
    },
    onLocaleChange: (f) => {
      oyentesI18n.add(f)
      return () => oyentesI18n.delete(f)
    },
    registerAppLocale: () => () => {},
  }
  // El cambio de idioma del arnés también avisa a los oyentes de ctx.i18n.
  oyentesIdioma.add(() => { for (const f of [...oyentesI18n]) f() })

  const storage = {
    get: (k, fb) => {
      try {
        const v = localStorage.getItem('hermes.plugin.dike.' + k)
        return v == null ? fb : JSON.parse(v)
      } catch { return fb }
    },
    set: (k, v) => {
      try { localStorage.setItem('hermes.plugin.dike.' + k, JSON.stringify(v)) }
      catch { /* almacenamiento lleno: preferencia no crítica */ }
    },
    remove: (k) => { try { localStorage.removeItem('hermes.plugin.dike.' + k) } catch {} },
  }

  const ctx = {
    source: 'plugin:dike',
    rest,
    storage,
    register: (c) => {
      globalThis.__dikeContribs = (globalThis.__dikeContribs || []).concat([c])
      return () => {}
    },
    registerMany: (cs) => {
      globalThis.__dikeContribs = (globalThis.__dikeContribs || []).concat(cs || [])
      return () => {}
    },
    registerSettingsPage: () => () => {},
    onDispose: (fn) => { guardados.push(fn); return () => {} },
    onEvent: host.onEvent,
    setTimeout: (fn, ms) => {
      const id = setTimeout(fn, ms)
      return () => clearTimeout(id)
    },
    setInterval: (fn, ms) => {
      const id = setInterval(fn, ms)
      return () => clearInterval(id)
    },
    addEventListener: (target, type, listener, opts) => {
      target.addEventListener(type, listener, opts)
      return () => target.removeEventListener(type, listener, opts)
    },
    socket: () => () => {},
    os: {
      notify: () => {}, openExternal: async () => false,
      revealPath: async () => false, pickSavePath: async () => null,
      pickOpenPath: async () => null, writeClipboard: async () => false,
    },
    pet: { say: () => () => {}, clear: () => {}, visible: { get: () => false, listen: () => () => {} } },
    runAction: () => ({ ok: false, error: 'dev' }),
    listActions: () => [],
    preview: undefined,
    files: undefined,
    i18n,
  }
  return ctx
}
