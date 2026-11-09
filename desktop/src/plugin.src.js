// Diké — mitad Desktop del paquete unificado (plugins/dike/desktop/plugin.js).
// FUENTE: desktop/plugin.js se genera con `npm run build` en desktop/ (esbuild
// empaqueta este archivo + grafo3d.js + three/3d-force-graph en un solo ESM).
// La app la copia a ~/.hermes/desktop-plugins/dike/ y la trata como un plugin
// de disco opt-in: hay que activarla en Capabilities → Plugins. La página y la
// fila de la barra llaman al mismo backend que la pestaña web
// (/api/plugins/dike → dashboard/plugin_api.py), que corre por perfil: si el
// perfil activo no tiene el plugin instalado, la página lo explica en vez de
// fallar. Tres pestañas: Case Writer (escrito + verificador), grafo 3D del
// corpus y tablero NIF.

import { host, PALETTE_AREA, ROUTES_AREA, SIDEBAR_NAV_AREA } from '@hermes/plugin-sdk'
import { jsx, jsxs } from 'react/jsx-runtime'
import { useCallback, useEffect, useState } from 'react'
import { mensajeError, rest, setRest, setStorage, S } from './common.js'
import { SeccionEscritor } from './escritor/escritor.js'
import { SeccionGrafo } from './grafo3d.js'
import { encolarCita } from './puente.js'

const ID = 'dike'

function Estado() {
  const [estado, setEstado] = useState(null)
  const [err, setErr] = useState(null)
  const cargar = useCallback(() => {
    setErr(null)
    rest('/estado').then(setEstado).catch(setErr)
  }, [])
  useEffect(cargar, [cargar])
  if (err) {
    // host.state.profile: perfil al que está enrutado el gateway activo.
    const perfil = (host.state && host.state.profile && host.state.profile.get()) || ''
    return jsxs('div', { className: 'flex flex-col gap-2', children: [
      jsx('div', { className: S.sub, children:
        'El backend de Diké no responde en el perfil activo' +
        (perfil ? ' (' + perfil + ')' : '') + ': ' + mensajeError(err) + '.' }),
      jsx('div', { className: S.sub, children:
        'Comprueba que el plugin Diké esté instalado y habilitado en el perfil activo ' +
        'con versión 0.4.0 o superior (la pestaña del panel existe desde esa versión).' }),
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

// ---------------------------------------------------------------------------
// NIF (la vista Grafo vive en grafo3d.js)
// ---------------------------------------------------------------------------

const SECCIONES_NIF = [
  ['facts.known', 'Hechos conocidos'], ['facts.alleged', 'Hechos alegados'],
  ['facts.missing', 'Hechos faltantes'], ['subjects', 'Sujetos'],
  ['norms', 'Normas'], ['norm_relations', 'Relaciones entre normas'],
  ['admin_acts', 'Actos administrativos'], ['principles', 'Principios'],
  ['deontic_positions', 'Posiciones deónticas'], ['conflicts', 'Conflictos'],
  ['hypotheses', 'Hipótesis'], ['gaps', 'Vacíos'],
  ['relevant_factors', 'Factores relevantes'],
]

const SECCIONES_OBJETO = new Set(['subjects', 'norms', 'hypotheses', 'gaps', 'conflicts', 'admin_acts', 'deontic_positions', 'principles', 'norm_relations', 'relevant_factors'])

function ItemNif({ valor }) {
  const v = valor
  let texto
  if (typeof v === 'string') texto = v
  else if (v && typeof v === 'object' && !Array.isArray(v)) {
    texto = [v.label || v.id || v.name || '', v.description || v.text || v.filled_with || '']
      .filter(Boolean).join(' — ') || JSON.stringify(v)
  } else texto = JSON.stringify(v)
  return jsx('div', { className: 'border-b border-(--ui-stroke-tertiary) py-1 text-xs last:border-0', children:
    jsx('div', { className: 'whitespace-pre-wrap', children: String(texto).slice(0, 400) }) })
}

function SeccionNif({ titulo, valores, campo, onAgregar }) {
  const [nuevo, setNuevo] = useState('')
  const [editando, setEditando] = useState(false)
  const lista = Array.isArray(valores) ? valores : []
  return jsxs('div', { className: S.section, children: [
    jsxs('div', { className: 'flex items-center justify-between', children: [
      jsx('span', { className: S.sectionTitle, children: titulo + ' (' + lista.length + ')' }),
      jsx('button', {
        type: 'button',
        className: S.link + ' normal-case',
        onClick: () => setEditando(!editando),
        children: editando ? 'cerrar' : '+ agregar',
      }),
    ] }),
    ...lista.map((v, i) => jsx(ItemNif, { key: i, valor: v })),
    lista.length === 0 ? jsx('div', { className: S.sub, children: '—' }) : null,
    editando ? jsxs('div', { className: 'flex flex-col gap-1 mt-1', children: [
      jsx('textarea', {
        className: 'min-h-16 w-full rounded border border-(--ui-stroke-secondary) bg-(--ui-bg-primary) p-1.5 font-mono text-xs',
        placeholder: SECCIONES_OBJETO.has(campo)
          ? 'JSON del ítem, ej. {"label": "Trabajador"}' : 'Texto del ítem',
        value: nuevo,
        onChange: (ev) => setNuevo(ev.target.value),
      }),
      jsx('button', {
        type: 'button',
        className: S.ghost,
        onClick: () => {
          const raw = nuevo.trim()
          if (!raw) return
          let valor
          try { valor = JSON.parse(raw) } catch (e) { valor = raw }
          onAgregar(campo, valor)
          setNuevo('')
          setEditando(false)
        },
        children: 'Guardar',
      }),
    ] }) : null,
  ] })
}

function GapRow({ gap, index, ocupado, onResolver }) {
  const [by, setBy] = useState('')
  const [with_, setWith] = useState('')
  return jsxs('div', { className: 'flex flex-col gap-1 border-b border-(--ui-stroke-tertiary) py-1.5 last:border-0 text-xs', children: [
    jsx('div', { children: gap.description || JSON.stringify(gap) }),
    jsx('div', { className: S.sub, children:
      'impacto ' + (gap.impact || '?') + (gap.demanded_by ? ' · pide ' + gap.demanded_by : '') }),
    jsxs('div', { className: 'flex gap-1', children: [
      jsx('input', { className: S.input + ' w-28', placeholder: 'quién', value: by,
        onChange: (e) => setBy(e.target.value) }),
      jsx('input', { className: S.input + ' flex-1', placeholder: 'con qué se llena', value: with_,
        onChange: (e) => setWith(e.target.value) }),
      jsx('button', {
        type: 'button',
        className: S.ghost,
        disabled: ocupado || !by.trim() || !with_.trim(),
        onClick: () => onResolver(index, by.trim(), with_.trim()),
        children: 'llenar',
      }),
    ] }),
  ] })
}

function NifBoard({ caso, onCambio }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [conf, setConf] = useState('')
  const [ocupado, setOcupado] = useState(false)

  const cargar = useCallback(() => {
    setError(null)
    rest('/nif/snapshot?case_id=' + encodeURIComponent(caso.case_id))
      .then(setData)
      .catch(setError)
  }, [caso.case_id])
  useEffect(cargar, [cargar])

  const accion = useCallback((fn) => (...args) => {
    if (ocupado) return
    setOcupado(true)
    setError(null)
    Promise.resolve(fn(...args))
      .then(() => { cargar(); if (onCambio) onCambio() })
      .catch(setError)
      .finally(() => setOcupado(false))
  }, [ocupado, cargar, onCambio])

  const post = (ruta, body) => rest(ruta, { method: 'POST', body, timeoutMs: 60000 })

  if (error && !data) {
    return jsx('div', { className: 'text-xs text-(--ui-danger)', children: mensajeError(error) })
  }
  if (!data) return jsx('div', { className: S.sub, children: 'Cargando NIF…' })

  const snap = data.snapshot || {}
  const nif = snap.nif
  if (!snap.exists || !nif) {
    return jsx('div', { className: 'text-sm text-(--ui-text-secondary)', children: 'Este caso no tiene NIF todavía.' })
  }
  const patches = (data.patches && data.patches.patches) || []
  const gaps = nif.gaps || []

  return jsxs('div', { className: 'flex flex-col gap-3', children: [
    jsxs('div', { className: 'flex flex-wrap items-center gap-2', children: [
      jsx('span', {
        className: S.chip + ' ' + (nif.validated_by_human ? S.chipOk : S.chipOff),
        children: nif.validated_by_human ? 'validado por humano' : 'sin validación humana',
      }),
      jsx('span', { className: S.sub, children:
        'v' + snap.version + ' · confianza ' + Math.round((nif.confidence || 0) * 100) + '%' }),
      jsx('button', {
        type: 'button', className: S.link,
        onClick: accion(() => post('/nif/validar', { case_id: caso.case_id, validated: !nif.validated_by_human })),
        children: nif.validated_by_human ? 'retirar validación' : 'marcar validado',
      }),
      jsxs('span', { className: 'flex items-center gap-1', children: [
        jsx('input', {
          type: 'number', min: '0', max: '1', step: '0.05', className: S.input + ' w-16',
          placeholder: String(nif.confidence || 0), value: conf,
          onChange: (e) => setConf(e.target.value),
        }),
        jsx('button', {
          type: 'button', className: S.link,
          onClick: accion(() => post('/nif/confianza', { case_id: caso.case_id, confidence: parseFloat(conf) })),
          children: 'fijar confianza',
        }),
      ] }),
    ] }),
    jsx('div', { className: 'font-medium', children: nif.legal_question || caso.legal_question || '' }),
    jsx('div', { className: 'grid grid-cols-1 md:grid-cols-2 gap-2', children:
      SECCIONES_NIF.map(([campo, titulo]) => {
        const valores = campo.startsWith('facts.')
          ? ((nif.facts || {})[campo.slice(6)] || [])
          : (nif[campo] || [])
        return jsx(SeccionNif, {
          key: campo, titulo, valores, campo,
          onAgregar: (fp, v) => accion(() => post('/nif/edit', {
            case_id: caso.case_id, field_path: fp, value: v,
          }))(),
        })
      }) }),
    gaps.length
      ? jsxs('div', { className: S.section, children: [
          jsx('div', { className: S.sectionTitle, children: 'Resolver vacíos' }),
          ...gaps.map((g, i) => g.status === 'filled' ? null : jsx(GapRow, {
            key: i, gap: g, index: i, ocupado,
            onResolver: accion((idx, by, with_) => post('/nif/gap', {
              case_id: caso.case_id, gap_index: idx, filled_by: by, filled_with: with_,
            })),
          })),
        ] })
      : null,
    patches.length
      ? jsxs('details', { className: 'text-xs', children: [
          jsx('summary', { className: 'cursor-pointer ' + S.sub,
            children: 'Historial de parches (' + patches.length + ')' }),
          ...patches.slice(-12).reverse().map((p, i) => jsxs('div', {
            key: i, className: 'border-b border-(--ui-stroke-tertiary) py-1',
            children: [
              jsx('span', { className: S.sub, children:
                (p.timestamp || '').slice(0, 19).replace('T', ' ') + ' · ' }),
              jsx('span', { children: p.agent_id + ' → ' + p.field_path + ' (' + p.operation + ')' }),
              p.reason ? jsx('div', { className: S.sub, children: p.reason }) : null,
            ],
          })),
        ] })
      : null,
    error ? jsx('div', { className: 'text-xs text-(--ui-danger)', children: mensajeError(error) }) : null,
  ] })
}

function SeccionNifPanel() {
  const [lista, setLista] = useState({ cases: [] })
  const [error, setError] = useState(null)
  const [casoSel, setCasoSel] = useState(null)
  const [nuevoId, setNuevoId] = useState('')
  const [nuevaPregunta, setNuevaPregunta] = useState('')
  const [ocupado, setOcupado] = useState(false)

  const cargar = useCallback(() => {
    setError(null)
    rest('/nif/casos')
      .then((d) => {
        setLista(d)
        setCasoSel((prev) => {
          if (prev) return prev
          const cases = (d && d.cases) || []
          return cases.length ? cases[0] : null
        })
      })
      .catch(setError)
  }, [])
  useEffect(cargar, [cargar])

  const post = (ruta, body) => rest(ruta, { method: 'POST', body, timeoutMs: 60000 })

  const casos = lista.cases || []
  return jsxs('div', { className: 'flex flex-col gap-3', children: [
    jsxs('div', { className: 'flex flex-wrap items-center gap-2', children: [
      jsx('select', {
        className: S.input,
        value: casoSel ? casoSel.case_id : '',
        onChange: (ev) => {
          const c = casos.filter(x => x.case_id === ev.target.value)[0]
          setCasoSel(c || null)
        },
        children: casos.length === 0
          ? jsx('option', { value: '', children: 'Sin casos' })
          : casos.map(c => jsx('option', {
              key: c.case_id, value: c.case_id,
              children: c.case_id + ' — ' + String(c.legal_question || '').slice(0, 60),
            })),
      }),
      jsx('button', {
        type: 'button', className: S.ghost, disabled: ocupado,
        onClick: () => {
          setOcupado(true)
          post('/nif/seed', { case_id: 'demo-caso' })
            .then(cargar).catch(setError).finally(() => setOcupado(false))
        },
        children: ocupado ? '…' : 'Cargar caso demo',
      }),
      jsx('input', { className: S.input + ' w-32', placeholder: 'id del caso',
        value: nuevoId, onChange: (e) => setNuevoId(e.target.value) }),
      jsx('input', { className: S.input + ' w-64', placeholder: 'pregunta jurídica',
        value: nuevaPregunta, onChange: (e) => setNuevaPregunta(e.target.value) }),
      jsx('button', {
        type: 'button', className: S.button,
        disabled: ocupado || !nuevoId.trim() || !nuevaPregunta.trim(),
        onClick: () => {
          setOcupado(true)
          post('/nif/init', { case_id: nuevoId.trim(), pregunta: nuevaPregunta.trim() })
            .then(() => { setNuevoId(''); setNuevaPregunta(''); cargar() })
            .catch(setError).finally(() => setOcupado(false))
        },
        children: 'Nuevo caso',
      }),
    ] }),
    error ? jsx('div', { className: 'text-xs text-(--ui-danger)', children: mensajeError(error) }) : null,
    casos.length === 0 && !error
      ? jsx('div', { className: S.card, children:
          'No hay casos todavía. Siembra el caso demo (despido injustificado, art. 161/168 CT) ' +
          'o crea uno con la pregunta jurídica del caso.' })
      : null,
    casoSel ? jsx(NifBoard, { caso: casoSel, onCambio: cargar }) : null,
  ] })
}

// ---------------------------------------------------------------------------

export default {
  id: ID,
  name: 'Diké',
  description: 'Verificación local de citas de la ley chilena, mapa del corpus y tablero NIF.',
  defaultEnabled: true,

  register(ctx) {
    setRest(ctx.rest)
    setStorage(ctx.storage || null)
    function DikePage() {
      const [pestana, setPestana] = useState('escritor')
      const pestanas = [
        ['escritor', 'Case Writer'],
        ['grafo', 'Grafo'],
        ['nif', 'NIF'],
      ]
      return jsxs('div', { className: S.page, children: [
        jsxs('div', { children: [
          jsx('div', { className: S.title, children: 'Diké' }),
          jsx('div', { className: S.sub, children:
            'Verificación local de citas, mapa del corpus y tablero NIF. No es consejo legal.' }),
        ] }),
        jsxs('div', { className: S.card, children: [
          jsx('div', { className: S.cardTitle, children: 'Corpus' }),
          jsx(Estado, {}),
        ] }),
        jsxs('div', { className: S.tabs, children:
          pestanas.map(([id, label]) => jsx('button', {
            key: id, type: 'button',
            className: S.tab + ' ' + (pestana === id ? S.tabOn : S.tabOff),
            onClick: () => setPestana(id),
            children: label,
          })),
        }),
        pestana === 'escritor' ? jsx(SeccionEscritor, {}) : null,
        pestana === 'grafo' ? jsx(SeccionGrafo, {
          // «Llevar al escrito»: encola la cita canónica (nunca la consulta)
          // y cambia de pestaña; el escritor la inserta y la verifica.
          onLlevarAlEscrito: (r) => {
            if (encolarCita(r)) setPestana('escritor')
          },
        }) : null,
        pestana === 'nif' ? jsx(SeccionNifPanel, {}) : null,
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
          keywords: ['dike', 'citas', 'legal', 'verificar', 'nif', 'grafo'],
          run: () => host.navigate('/dike'),
        },
      },
    ])
  },
}
