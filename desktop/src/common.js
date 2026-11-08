// Compartido entre plugin.src.js y grafo3d.js: tokens de clase del tema,
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

export const S = {
  page: 'flex h-full flex-col gap-3 overflow-y-auto p-4 text-sm text-(--ui-text-primary)',
  title: 'text-base font-semibold',
  sub: 'text-xs text-(--ui-text-tertiary)',
  card: 'flex flex-col gap-2 rounded-md border border-(--ui-stroke-secondary) bg-(--ui-bg-secondary) p-3',
  cardTitle: 'text-xs font-medium uppercase tracking-wide text-(--ui-text-tertiary)',
  chip: 'inline-flex items-center rounded-sm px-1.5 py-0.5 text-[0.6875rem] font-medium',
  chipOk: 'bg-(--ui-success) text-(--ui-bg-primary)',
  chipOff: 'bg-(--ui-bg-quaternary) text-(--ui-text-secondary)',
  chipBad: 'bg-(--ui-danger) text-(--ui-bg-primary)',
  textarea: 'min-h-40 w-full rounded-md border border-(--ui-stroke-secondary) bg-(--ui-bg-primary) p-2 font-mono text-xs text-(--ui-text-primary) outline-none focus:border-(--ui-accent)',
  input: 'rounded-md border border-(--ui-stroke-secondary) bg-(--ui-bg-primary) px-2 py-1 text-xs text-(--ui-text-primary) outline-none focus:border-(--ui-accent)',
  button: 'self-start rounded-md bg-(--ui-accent) px-3 py-1.5 text-xs font-medium text-(--ui-bg-primary) disabled:opacity-50',
  ghost: 'self-start rounded-md border border-(--ui-stroke-secondary) px-3 py-1.5 text-xs text-(--ui-text-secondary)',
  link: 'text-(--ui-accent) hover:underline cursor-pointer',
  row: 'flex items-start gap-2 border-b border-(--ui-stroke-tertiary) py-1.5 last:border-0',
  mark: 'w-4 shrink-0 text-center font-bold',
  ok: 'text-(--ui-success)',
  bad: 'text-(--ui-danger)',
  meta: 'min-w-0 break-all text-xs text-(--ui-text-tertiary)',
  tabs: 'flex gap-1 border-b border-(--ui-stroke-secondary)',
  tab: 'px-3 py-1.5 text-xs rounded-t-md cursor-pointer',
  tabOn: 'bg-(--ui-bg-secondary) font-medium text-(--ui-text-primary)',
  tabOff: 'text-(--ui-text-tertiary) hover:text-(--ui-text-primary)',
  section: 'rounded-md border border-(--ui-stroke-secondary) p-2 flex flex-col gap-1',
  sectionTitle: 'text-[0.6875rem] font-medium uppercase tracking-wide text-(--ui-text-tertiary)',
}

export function mensajeError(e) {
  return (e && (e.message || e.detail || e.error)) || String(e)
}
