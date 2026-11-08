// Diké — mitad Desktop del paquete unificado (plugins/dike/desktop/plugin.js).
// La app la copia a ~/.hermes/desktop-plugins/dike/ y la trata como un plugin
// de disco opt-in: hay que activarla en Capabilities → Plugins. La página y la
// fila de la barra llaman al mismo backend que la pestaña web
// (/api/plugins/dike → dashboard/plugin_api.py), que corre por perfil: si el
// perfil activo no tiene el plugin instalado, la página lo explica en vez de
// fallar. Solo envía texto; los archivos se revisan por la herramienta o por
// /dike-verificar.

import { host, PALETTE_AREA, ROUTES_AREA, SIDEBAR_NAV_AREA } from '@hermes/plugin-sdk'
import { jsx, jsxs } from 'react/jsx-runtime'
import { useCallback, useEffect, useState } from 'react'

const ID = 'dike'

const S = {
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
  button: 'self-start rounded-md bg-(--ui-accent) px-3 py-1.5 text-xs font-medium text-(--ui-bg-primary) disabled:opacity-50',
  ghost: 'self-start rounded-md border border-(--ui-stroke-secondary) px-3 py-1.5 text-xs text-(--ui-text-secondary)',
  row: 'flex items-start gap-2 border-b border-(--ui-stroke-tertiary) py-1.5 last:border-0',
  mark: 'w-4 shrink-0 text-center font-bold',
  ok: 'text-(--ui-success)',
  bad: 'text-(--ui-danger)',
  meta: 'min-w-0 break-all text-xs text-(--ui-text-tertiary)',
}

function mensajeError(e) {
  return (e && (e.message || e.detail || e.error)) || String(e)
}

export default {
  id: ID,
  name: 'Diké',
  description: 'Verificación local de citas de la ley chilena contra el corpus Ley Chile.',
  defaultEnabled: true,

  register(ctx) {
    function Estado() {
      const [estado, setEstado] = useState(null)
      const [err, setErr] = useState(null)
      const cargar = useCallback(() => {
        setErr(null)
        ctx.rest('/estado').then(setEstado).catch(setErr)
      }, [])
      useEffect(cargar, [cargar])
      if (err) {
        return jsxs('div', { className: 'flex flex-col gap-2', children: [
          jsx('div', { className: S.sub, children:
            'El backend de Diké no responde en este perfil (' + mensajeError(err) + ').' }),
          jsx('div', { className: S.sub, children:
            'Instálalo y habilítalo en el perfil activo: ' +
            'hermes -p <perfil> plugins install Grizaceo/hermes-dike --enable' }),
          jsx('button', { type: 'button', className: S.ghost, onClick: cargar, children: 'Reintentar' }),
        ]})
      }
      if (!estado) return jsx('div', { className: S.sub, children: 'Consultando el corpus…' })
      return jsxs('div', { className: 'flex flex-wrap items-center gap-2', children: [
        jsx('span', {
          className: S.chip + ' ' + (estado.corpus_instalado ? S.chipOk : S.chipOff),
          children: estado.corpus_instalado ? 'corpus instalado' : 'corpus sin instalar',
        }),
        jsx('span', { className: S.sub, children:
          'pack ' + estado.pack_hash + ' · ' + estado.leyes + ' leyes · ' + estado.articulos +
          ' artículos' + (estado.version ? ' · v' + estado.version : '') }),
      ]})
    }

    function Resultado(props) {
      const r = props.resultado
      if (!r) return null
      if (r.error) {
        let msg = String(r.error)
        if (msg.includes(': ')) msg = msg.split(': ').slice(1).join(': ')
        return jsxs('div', { className: S.card, children: [
          jsx('span', { className: S.chip + ' ' + S.chipBad, children: 'sin revisar' }),
          jsx('div', { children: 'Diké no pudo revisar el escrito: ' + msg }),
        ]})
      }
      if (r.veredicto === 'SIN_CITAS' || r.veredicto === 'SIN_CORPUS') {
        return jsx('div', { className: S.sub, children: 'Diké: ' + (r.mensaje || '') })
      }
      const meta = r.meta || {}
      const detalles = r.detalles || []
      const fechas = detalles.map(d => d.fecha_recuperacion).filter(Boolean).map(String).sort()
      const fecha = fechas.length ? fechas[0].slice(0, 10) : '—'
      return jsxs('div', { className: 'flex flex-col gap-2', children: [
        jsxs('div', { className: 'font-medium', children: [
          'Diké: ' + meta.citas_verificadas + ' de ' + meta.total_citas +
          ' citas verificadas (' + r.veredicto + ') · corpus ' + meta.pack_hash,
        ] }),
        jsx('div', { className: 'flex flex-col', children:
          detalles.map((d, i) => {
            const ok = d.estado === 'VERIFICADA'
            return jsxs('div', { key: i, className: S.row, children: [
              jsx('span', { className: S.mark + ' ' + (ok ? S.ok : S.bad), children: ok ? '✓' : '✗' }),
              jsxs('div', { className: 'min-w-0', children: [
                jsx('div', { children: d.cita_raw }),
                jsx('div', { className: S.meta, children:
                  ok ? [d.gid, d.fuente_url].filter(Boolean).join(' · ') : d.resolucion }),
              ]}),
            ]})
          }) }),
        (r.no_verificadas && r.no_verificadas.length)
          ? jsx('div', { className: S.sub, children:
              'Menciones sin artículo, no verificadas: ' + r.no_verificadas.join(', ') })
          : null,
        jsx('div', { className: S.sub, children:
          'No certifica que el artículo respalde el argumento ni que la copia (obtenida ' +
          fecha + ') sea el texto vigente hoy.' }),
      ]})
    }

    function DikePage() {
      const [texto, setTexto] = useState('')
      const [resultado, setResultado] = useState(null)
      const [error, setError] = useState(null)
      const [ocupado, setOcupado] = useState(false)
      const [tick, setTick] = useState(0)

      const verificar = useCallback(() => {
        const t = texto.trim()
        if (!t || ocupado) return
        setOcupado(true)
        setError(null)
        ctx.rest('/verificar', { method: 'POST', body: { texto: t }, timeoutMs: 320000 })
          .then((r) => { setResultado(r); setTick(n => n + 1) })
          .catch(setError)
          .finally(() => setOcupado(false))
      }, [texto, ocupado])

      return jsxs('div', { className: S.page, children: [
        jsxs('div', { children: [
          jsx('div', { className: S.title, children: 'Diké' }),
          jsx('div', { className: S.sub, children:
            'Verificación local de citas de la ley chilena. No es consejo legal.' }),
        ] }),
        jsxs('div', { className: S.card, children: [
          jsx('div', { className: S.cardTitle, children: 'Corpus' }),
          jsx(Estado, { key: tick }),
        ] }),
        jsxs('div', { className: S.card, children: [
          jsx('div', { className: S.cardTitle, children: 'Verificar un escrito' }),
          jsx('textarea', {
            className: S.textarea,
            placeholder: 'Pega el texto del escrito…',
            value: texto,
            onChange: (ev) => setTexto(ev.target.value),
          }),
          jsxs('div', { className: 'flex items-center gap-3', children: [
            jsx('button', {
              type: 'button',
              className: S.button,
              onClick: verificar,
              disabled: ocupado || !texto.trim(),
              children: ocupado ? 'Verificando…' : 'Verificar citas',
            }),
            ocupado
              ? jsx('span', { className: S.sub, children: 'La primera llamada instala el corpus (~1 min).' })
              : null,
          ] }),
          error ? jsx('div', { className: 'text-xs text-(--ui-danger)', children: mensajeError(error) }) : null,
          jsx(Resultado, { resultado: resultado }),
        ] }),
      ] })
    }

    ctx.registerMany([
      {
        id: 'page',
        area: ROUTES_AREA,
        data: { path: '/dike' },
        render: () => jsx(DikePage, {}),
      },
      {
        id: 'nav',
        area: SIDEBAR_NAV_AREA,
        order: 60,
        data: { path: '/dike', label: 'Diké', codicon: 'law' },
      },
      {
        id: 'open',
        area: PALETTE_AREA,
        data: {
          id: 'dike.open',
          label: 'Diké: verificar citas',
          keywords: ['dike', 'citas', 'legal', 'verificar'],
          run: () => host.navigate('/dike'),
        },
      },
    ])
  },
}
