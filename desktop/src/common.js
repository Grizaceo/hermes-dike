import { t } from './i18n.js'
// Compartido entre plugin.src.js y grafo3d.js: nombres de estilo,
// el error legible y el REST del contexto (ctx.rest del PluginContext: el
// objeto `host` del SDK no expone REST — solo navigate/request/state).

export let rest = null

export function setRest(r) {
  rest = r
}

// ctx.storage del SDK: preferencia por perfil (p.ej. la fuente del grafo).
export let storage = null

export function setStorage(s) {
  storage = s
}

// Nombres de estilo de la página. Los componentes (`dk-*`) están en
// estilos.css; aquí se combinan con utilidades de disposición.
export const S = {
  page: 'flex h-full flex-col gap-3 overflow-y-auto p-4',
  title: 'dk-titulo',
  sub: 'dk-meta',
  card: 'dk-panel flex flex-col gap-2 p-3',
  cardTitle: 'dk-rotulo',
  // Botones: primario (una acción principal por vista), con borde, plano,
  // de peligro y de solo icono.
  button: 'dk-btn dk-btn--primario self-start',
  ghost: 'dk-btn dk-btn--borde self-start',
  btn: 'dk-btn',
  btnPrimary: 'dk-btn dk-btn--primario',
  btnOutline: 'dk-btn dk-btn--borde',
  btnDanger: 'dk-btn dk-btn--borde dk-btn--peligro',
  btnIcon: 'dk-btn dk-btn--icono',
  btnSmall: 'dk-btn dk-btn--borde dk-btn--chico',
  link: 'dk-enlace',
  // Insignias: `S.chip + ' ' + S.chipOk`. chipOff es la neutra.
  chip: 'dk-insignia',
  chipOk: 'dk-insignia--ok',
  chipOff: '',
  chipBad: 'dk-insignia--mal',
  chipWarn: 'dk-insignia--aviso',
  chipInfo: 'dk-insignia--info',
  chipAcento: 'dk-insignia--acento',
  textarea: 'dk-campo min-h-40 w-full dk-mono',
  input: 'dk-campo',
  row: 'dk-fila flex items-start gap-2 py-1.5',
  mark: 'w-4 shrink-0 text-center font-bold',
  ok: 'dk-ok',
  bad: 'dk-mal',
  warn: 'dk-aviso-texto',
  meta: 'dk-meta min-w-0 break-all',
  mono: 'dk-mono',
  tabs: 'flex gap-1 border-b border-(--ui-stroke-secondary)',
  tab: 'dk-btn dk-pestana',
  section: 'dk-panel dk-panel--plano flex flex-col gap-1 p-2',
  sectionTitle: 'dk-rotulo',
  panel: 'dk-panel',
  floating: 'dk-panel dk-panel--flotante',
  toolbar: 'dk-barra',
  divider: 'dk-separador',
  notice: 'dk-aviso',
  noticeOk: 'dk-aviso dk-aviso--ok',
  noticeBad: 'dk-aviso dk-aviso--mal',
  noticeWarn: 'dk-aviso dk-aviso--aviso',
  empty: 'dk-vacio',
}

export function mensajeError(e) {
  return (e && (e.message || e.detail || e.error)) || String(e)
}

// Temporizadores con ámbito del plugin: ctx.setTimeout/setInterval del SDK se
// cancelan solos al descargar el plugin; sin ctx caen a los globales del
// navegador. Cada programar* devuelve una función cancel(); los sitios que
// antes guardaban el id numérico ahora guardan esa función y la llaman con
// cancelarTarea (idempotente).
const nativoTimeout = (fn, ms) => {
  const id = setTimeout(fn, ms)
  return () => clearTimeout(id)
}
const nativoInterval = (fn, ms) => {
  const id = setInterval(fn, ms)
  return () => clearInterval(id)
}
let _timeout = nativoTimeout
let _interval = nativoInterval

// Cada llamada fija AMBOS backends: un ctx sin setTimeout/setInterval (o
// null) vuelve a los temporizadores del navegador.
export function setTimers(ctx) {
  _timeout = ctx && typeof ctx.setTimeout === 'function'
    ? (fn, ms) => ctx.setTimeout(fn, ms)
    : nativoTimeout
  _interval = ctx && typeof ctx.setInterval === 'function'
    ? (fn, ms) => ctx.setInterval(fn, ms)
    : nativoInterval
}

export function programarTimeout(fn, ms) { return _timeout(fn, ms) }
export function programarInterval(fn, ms) { return _interval(fn, ms) }
export function cancelarTarea(t) { if (typeof t === 'function') t() }
