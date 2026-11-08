// Diké — mitad Desktop del paquete unificado (plugins/dike/desktop/plugin.js).
// La app la copia a ~/.hermes/desktop-plugins/dike/ y la trata como un plugin
// de disco opt-in: hay que activarla en Capabilities → Plugins. La página y la
// fila de la barra llaman al mismo backend que la pestaña web
// (/api/plugins/dike → dashboard/plugin_api.py), que corre por perfil: si el
// perfil activo no tiene el plugin instalado, la página lo explica en vez de
// fallar. Tres secciones: verificar citas, mapa del corpus (grafo) y tablero
// NIF de la teoría del caso.

import { host, PALETTE_AREA, ROUTES_AREA, SIDEBAR_NAV_AREA } from '@hermes/plugin-sdk'
import { jsx, jsxs } from 'react/jsx-runtime'
import { useCallback, useEffect, useState } from 'react'

const ID = 'dike'

// ctx.rest del PluginContext: el objeto `host` del SDK no expone REST — solo
// navigate/request/state. Se asigna en register() antes de que nada renderice.
let rest = null

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

function mensajeError(e) {
  return (e && (e.message || e.detail || e.error)) || String(e)
}

function Estado() {
  const [estado, setEstado] = useState(null)
  const [err, setErr] = useState(null)
  const cargar = useCallback(() => {
    setErr(null)
    rest('/estado').then(setEstado).catch(setErr)
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

function Resultado({ resultado }) {
  const r = resultado
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

function SeccionEscrito() {
  const [texto, setTexto] = useState('')
  const [resultado, setResultado] = useState(null)
  const [error, setError] = useState(null)
  const [ocupado, setOcupado] = useState(false)

  const verificar = useCallback(() => {
    const t = texto.trim()
    if (!t || ocupado) return
    setOcupado(true)
    setError(null)
    rest('/verificar', { method: 'POST', body: { texto: t }, timeoutMs: 320000 })
      .then(setResultado)
      .catch(setError)
      .finally(() => setOcupado(false))
  }, [texto, ocupado])

  return jsxs('div', { className: S.card, children: [
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
  ] })
}

// ---------------------------------------------------------------------------
// Grafo
// ---------------------------------------------------------------------------

function NormaDetalle({ data, error }) {
  if (error) return jsx('div', { className: 'text-xs text-(--ui-danger)', children: mensajeError(error) })
  if (!data) return jsx('div', { className: S.sub, children: 'Cargando artículos…' })
  const arts = data.articulos || []
  return jsxs('div', { className: 'flex flex-col gap-1 pl-4', children: [
    jsx('div', { className: S.sub, children:
      (data.articulos_total || arts.length) + ' artículos' +
      (data.articulos_truncados ? ' (mostrando ' + arts.length + ')' : '') }),
    ...arts.map((a, i) => jsx('details', { key: i, className: 'text-xs', children: [
      jsx('summary', { className: 'cursor-pointer py-0.5', children:
        'art. ' + (a.label || a.eId) +
        (a.estado ? ' · ' + a.estado : '') +
        (a.vigente_desde ? ' · desde ' + String(a.vigente_desde).slice(0, 10) : '') }),
      jsx('div', { className: S.sub + ' pl-3 pb-1 whitespace-pre-wrap',
        children: String(a.texto || '').slice(0, 1200) }),
    ] })),
  ] })
}

function NormaRow({ norma }) {
  const [abierta, setAbierta] = useState(false)
  const [detalle, setDetalle] = useState(null)
  const [error, setError] = useState(null)
  const [cargando, setCargando] = useState(false)

  const abrir = useCallback(() => {
    if (abierta) { setAbierta(false); return }
    setAbierta(true)
    if (detalle || cargando) return
    setCargando(true)
    setError(null)
    rest('/grafo/corpus/norma/' + norma.leychileCode)
      .then(setDetalle)
      .catch(setError)
      .finally(() => setCargando(false))
  }, [abierta, detalle, cargando, norma.leychileCode])

  const rotulo = (norma.tipo && norma.numero ? norma.tipo + ' ' + norma.numero : norma.tipo) +
    (norma.anio ? '/' + norma.anio : '') + ' · ' + norma.articulos + ' art.'
  return jsxs('div', { className: 'border-b border-(--ui-stroke-tertiary) py-1.5 last:border-0', children: [
    jsxs('button', {
      type: 'button',
      className: 'flex w-full items-start gap-2 text-left hover:opacity-80',
      onClick: abrir,
      children: [
        jsx('span', { className: S.sub, children: abierta ? '▾' : '▸' }),
        jsxs('div', { className: 'min-w-0', children: [
          jsx('div', { children: rotulo + (norma.estado ? ' · ' + norma.estado : '') }),
          jsx('div', { className: S.sub + ' truncate', children: norma.titulo }),
        ] }),
      ],
    }),
    abierta ? jsx(NormaDetalle, { data: detalle, error: error }) : null,
  ] })
}

function SeccionGrafo() {
  const [corpus, setCorpus] = useState(null)
  const [corpusErr, setCorpusErr] = useState(null)
  const [personal, setPersonal] = useState(null)
  const [personalErr, setPersonalErr] = useState(null)

  const cargar = useCallback(() => {
    setCorpusErr(null)
    setPersonalErr(null)
    rest('/grafo/corpus').then(setCorpus).catch(setCorpusErr)
    rest('/grafo/personal').then(setPersonal).catch(setPersonalErr)
  }, [])
  useEffect(cargar, [cargar])

  const pack = corpus && corpus.packs && corpus.packs[0]
  const normas = (pack && pack.normas) || []
  const edges = (pack && pack.edges) || {}
  const candidatos = (personal && personal.candidates) || []
  const aristas = (personal && personal.edges) || []

  return jsxs('div', { className: 'flex flex-col gap-3', children: [
    jsxs('div', { className: S.card, children: [
      jsxs('div', { className: 'flex items-center justify-between', children: [
        jsx('div', { className: S.cardTitle, children: 'Corpus sellado' }),
        pack ? jsx('div', { className: S.sub, children:
          Object.keys(edges).map(k => k + ': ' + edges[k]).join(' · ') +
          ' · vigencia: ' + (pack.vigencia || 0) }) : null,
      ] }),
      corpusErr
        ? jsx('div', { className: 'text-xs text-(--ui-danger)', children: mensajeError(corpusErr) })
        : !pack
          ? jsx('div', { className: S.sub, children: 'Leyendo el corpus…' })
          : jsx('div', { className: 'flex flex-col', children:
              normas.map(n => jsx(NormaRow, { key: n.leychileCode, norma: n })) }),
    ] }),
    jsxs('div', { className: S.card, children: [
      jsx('div', { className: S.cardTitle, children: 'Grafo personal (GRE)' }),
      personalErr
        ? jsx('div', { className: 'text-xs text-(--ui-danger)', children: mensajeError(personalErr) })
        : !personal
          ? jsx('div', { className: S.sub, children: 'Consultando…' })
          : jsxs('div', { className: 'flex flex-col gap-1', children: [
              jsx('div', { className: S.sub, children: candidatos.length + ' candidatos · ' + aristas.length + ' aristas' }),
              candidatos.length === 0
                ? jsx('div', { className: S.sub, children:
                    'Sin candidatos todavía: el grafo personal se llena cuando agentes o el ' +
                    'escrito alimentan evidencia al pipeline GRE.' })
                : jsx('div', { className: 'flex flex-col', children:
                    candidatos.map((c, i) => jsxs('div', { key: i, className: S.row, children: [
                      jsxs('div', { className: 'min-w-0', children: [
                        jsx('div', { children: (c.candidate_id || '') + ' · ' + (c.state_human || c.state || '') }),
                        jsx('div', { className: S.meta, children: String(c.text || c.summary || '').slice(0, 160) }),
                      ] }),
                    ] })) }),
            ] }),
    ] }),
  ] })
}

// ---------------------------------------------------------------------------
// NIF
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
      ? jsx('details', { className: 'text-xs', children: [
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
    rest = ctx.rest
    function DikePage() {
      const [pestana, setPestana] = useState('escrito')
      const pestanas = [
        ['escrito', 'Verificar escrito'],
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
        pestana === 'escrito' ? jsx(SeccionEscrito, {}) : null,
        pestana === 'grafo' ? jsx(SeccionGrafo, {}) : null,
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
