import { t } from './i18n.js'
import { etiquetaCodigo } from './i18n.js'
// Vista 3D del grafo del corpus (3d-force-graph + three, empaquetados en el
// bundle). Muestra primero solo los 25 instrumentos; un clic en un
// instrumento (o el interruptor "mostrar artículos") expande sus artículos.
// La lista de texto queda como fallback cuando WebGL no está disponible.

import ForceGraph3D from '3d-force-graph'
import { jsx, jsxs } from 'react/jsx-runtime'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  cancelarTarea, mensajeError, programarInterval, programarTimeout,
  rest, storage, S,
} from './common.js'
import { tomarFoco } from './puente.js'
import { fragmentoEn, rangoFragmento } from './escritor/chat-logica.js'

const COLORES_NODO = {
  instrumento: '#60a5fa',
  articulo: '#a78bfa',
  sentencia: '#fb7185',
  resolucion: '#34d399',
}
const COLORES_ARISTA = {
  contiene: '#64748b',
  cita: '#fbbf24',
  aplica: '#38bdf8',
  revisa: '#f472b6',
  menciona: '#a3a3a3',
  excepciona: '#06b6d4',
}
const NOMBRE_TIPO = {
  get instrumento() { return t('graph.instrument') },
  get articulo() { return t('graph.article.label') },
  get sentencia() { return t('graph.judgment') },
  get resolucion() { return t('graph.decision') },
  get unidad() { return t('graph.unit.label') },
}
const NOMBRE_ESTADO = {
  get verificada_estructura() { return t('graph.structure.verified') },
  candidata: 'candidata',
  aprobada: 'aprobada',
}
// Color de las unidades por modalidad deóntica (candidata, sin validar).
const COLORES_MODALIDAD = {
  obligacion: '#f59e0b',
  prohibicion: '#ef4444',
  permiso: '#22c55e',
  potestad: '#a855f7',
  excepcion: '#06b6d4',
  sancion: '#e11d48',
  definicion: '#94a3b8',
  otra: '#64748b',
}

function colorNodo(n) {
  if (n.tipo === 'unidad' && n.clase === 'judicial') return '#fda4af'
  if (n.tipo === 'unidad') return COLORES_MODALIDAD[n.modalidad] || COLORES_MODALIDAD.otra
  return COLORES_NODO[n.tipo] || '#cbd5e1'
}

function idDe(x) {
  return x && typeof x === 'object' ? x.id : x
}

// Atenuación del foco: con resalte activo el resto baja a ~0.12/0.05.
function colorNodoResalte(n, resalte) {
  const base = colorNodo(n)
  if (!resalte) return base
  return resalte.ids.has(n.id) ? base : hexA(base, 0.12)
}

function colorAristaResalte(l, resalte) {
  if (!resalte) return colorArista(l)
  const k = idDe(l.source) + '|' + idDe(l.target) + '|' + l.tipo
  return resalte.links.has(k) ? colorArista(l) : hexA(colorArista(l), 0.05)
}

function hexA(hex, alpha) {
  const n = parseInt(hex.slice(1), 16)
  return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + alpha + ')'
}

function colorArista(l) {
  const base = COLORES_ARISTA[l.tipo] || '#64748b'
  const alpha = l.estado === 'candidata' ? 0.15 : l.estado === 'aprobada' ? 0.75 : 0.4
  return hexA(base, alpha)
}

function hayWebGL() {
  try {
    const c = document.createElement('canvas')
    return !!(c.getContext('webgl2') || c.getContext('webgl'))
  } catch (e) {
    return false
  }
}

// El lienzo vive mientras la pestaña esté visible; al desmontarse (cambio de
// pestaña o de página) se destruye el renderizador completo.
function LienzoGrafo({ proyeccion, padres, conteos, alClickNodo, alClickArista,
                      alHover, alFondo, resalte, onFallo, apiRef }) {
  const hostEl = useRef(null)
  const engine = useRef(null)
  const [listo, setListo] = useState(false)
  const clickRef = useRef(alClickNodo)
  clickRef.current = alClickNodo
  const conteosRef = useRef(conteos)
  conteosRef.current = conteos
  const padresRef = useRef(padres)
  padresRef.current = padres
  const clickAristaRef = useRef(alClickArista)
  clickAristaRef.current = alClickArista
  const hoverRef = useRef(alHover)
  hoverRef.current = alHover
  const fondoRef = useRef(alFondo)
  fondoRef.current = alFondo
  const resalteRef = useRef(resalte)
  resalteRef.current = resalte
  // Pool estable de nodos: reutilizar el mismo objeto por id conserva las
  // posiciones x/y/z que d3 va calculando entre cambios de proyección.
  const pool = useRef(new Map())
  const primerAjuste = useRef(false)

  useEffect(() => {
    if (!hostEl.current) return undefined
    if (!hayWebGL()) {
      onFallo(t('graph.webgl.unavailable.use.the.corpus.list.below'))
      return undefined
    }
    let graph
    let observer
    try {
      graph = new ForceGraph3D(hostEl.current)
    } catch (e) {
      onFallo(t('graph.could.not.start.the.3d.view') + mensajeError(e))
      return undefined
    }
    graph
      .backgroundColor('#0b1020')
      .showNavInfo(false)
      .nodeId('id')
      .nodeVal((n) => (n.tipo === 'instrumento' ? 6 : n.tipo === 'articulo' ? 1 : 0.4))
      .nodeResolution(6)
      .nodeOpacity(0.95)
      .nodeColor((n) => colorNodoResalte(n, resalteRef.current))
      .nodeLabel((n) => n.tipo === 'instrumento'
        ? n.label + ' · ' + (conteosRef.current.get(n.id) || 0) + t('graph.articles')
        : n.label)
      .linkColor((l) => colorAristaResalte(l, resalteRef.current))
      .linkLabel((l) => l.tipo + ' · ' + (NOMBRE_ESTADO[l.estado] || l.estado))
      .linkOpacity(0.5)
      .linkWidth((l) => (l.tipo === 'contiene' ? 0.4 : 1.2))
      .linkDirectionalArrowLength((l) => (l.tipo === 'contiene' ? 0 : 2.5))
      .linkDirectionalArrowRelPos(0.85)
      .onNodeClick((n) => clickRef.current(n))
      .onLinkClick((l) => { if (clickAristaRef.current) clickAristaRef.current(l) })
      .onNodeHover((n) => { if (hoverRef.current) hoverRef.current(n ? n.id : null) })
      .onBackgroundClick(() => { if (fondoRef.current) fondoRef.current() })
      .cooldownTicks(120)
      .warmupTicks(20)
      .onEngineStop(() => {
        // Solo el primer asentamiento reencuadra: después de una expansión o
        // un foco de búsqueda la cámara no se mueve sola (botón "encajar").
        if (!primerAjuste.current && engine.current) {
          primerAjuste.current = true
          engine.current.zoomToFit(400, 40)
        }
      })
    const ajustar = () => {
      if (hostEl.current && graph) {
        graph.width(hostEl.current.clientWidth).height(hostEl.current.clientHeight)
      }
    }
    ajustar()
    observer = new ResizeObserver(ajustar)
    observer.observe(hostEl.current)
    engine.current = graph
    apiRef.current = {
      enfocar: (id) => {
        const g = engine.current
        if (!g) return
        // Un nodo recién expandido tarda un tick en tener posición: reintenta
        // acotado (~2 s) en vez de un timeout fijo que puede llegar tarde.
        // Si el grafo se desmontó (cambio de pestaña) engine.current ya no es
        // `g` y el reintento muere en el siguiente tick sin tocar el engine
        // destruido.
        let intentos = 0
        const intentar = () => {
          if (engine.current !== g) return
          const n = g.graphData().nodes.find((x) => x.id === id)
          if (n && Number.isFinite(n.x)) {
            g.cameraPosition(
              { x: n.x + 60, y: (n.y || 0) + 40, z: (n.z || 0) + 150 },
              { x: n.x, y: n.y || 0, z: n.z || 0 },
              600)
          } else if (intentos < 40) {
            intentos += 1
            programarTimeout(intentar, 50)
          }
        }
        intentar()
      },
      zoomFit: () => {
        if (engine.current) engine.current.zoomToFit(400, 40)
      },
      orbita: () => {
        const g = engine.current
        if (!g) return
        const p = g.cameraPosition()
        const a = Math.atan2(p.z || 0, p.x || 0) + 0.008
        const r = Math.hypot(p.x || 0, p.z || 0) || 300
        g.cameraPosition({ x: r * Math.cos(a), y: p.y || 0, z: r * Math.sin(a) })
      },
      encuadrar: (ids) => {
        const g = engine.current
        if (!g) return
        const set = new Set(ids)
        const pts = g.graphData().nodes.filter((n) => set.has(n.id)
          && Number.isFinite(n.x))
        if (!pts.length) return
        const cx = pts.reduce((a, n) => a + n.x, 0) / pts.length
        const cy = pts.reduce((a, n) => a + (n.y || 0), 0) / pts.length
        const cz = pts.reduce((a, n) => a + (n.z || 0), 0) / pts.length
        g.cameraPosition(
          { x: cx + 80, y: cy + 60, z: cz + 220 },
          { x: cx, y: cy, z: cz }, 900)
      },
    }
    setListo(true)
    return () => {
      observer.disconnect()
      graph.pauseAnimation()
      graph._destructor()
      engine.current = null
      apiRef.current = null
    }
    // El grafo se crea una vez por montaje; los datos llegan por graphData.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const g = engine.current
    if (!listo || !g) return
    // Reutilizar el objeto de cada id conserva las posiciones de d3 entre
    // proyecciones; clonar todo reiniciaba el layout en cada expansión.
    const visibles = new Set()
    let agregados = false
    const nodes = proyeccion.nodes.map((n) => {
      visibles.add(n.id)
      const prev = pool.current.get(n.id)
      if (prev) {
        Object.assign(prev, n)
        return prev
      }
      agregados = true
      const nuevo = { ...n }
      // Artículo nuevo: nace junto a su instrumento (con un pequeño jitter).
      const padre = pool.current.get(padresRef.current.get(n.id))
      if (padre && Number.isFinite(padre.x)) {
        nuevo.x = padre.x + (Math.random() - 0.5) * 12
        nuevo.y = (padre.y || 0) + (Math.random() - 0.5) * 12
        nuevo.z = (padre.z || 0) + (Math.random() - 0.5) * 12
      }
      pool.current.set(n.id, nuevo)
      return nuevo
    })
    for (const id of [...pool.current.keys()]) {
      if (!visibles.has(id)) pool.current.delete(id)
    }
    // Las aristas sí son objetos frescos, pero con source/target como ids.
    g.graphData({
      nodes,
      links: proyeccion.links.map((l) => ({ ...l })),
    })
    if (agregados && g.d3ReheatSimulation) g.d3ReheatSimulation()
  }, [proyeccion, listo])

  // Recolorear sin reconstruir: refresh() relee los accesores de color.
  useEffect(() => {
    const g = engine.current
    if (g && g.refresh) g.refresh()
  }, [resalte, listo])

  return jsxs('div', { className: 'relative min-w-0', children: [
    jsx('div', { ref: hostEl, className: 'h-[55vh] min-h-[360px] w-full rounded-md bg-[#0b1020]' }),
    !listo ? jsx('div', { className: S.sub + ' absolute left-3 top-3', children: t('graph.drawing.graph') }) : null,
  ] })
}

function UnidadDetalle({ nodo, fuente }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  useEffect(() => {
    setData(null)
    setError(null)
    rest('/grafo/unidad?fuente=' + (fuente || 'corpus') + '&id=' + encodeURIComponent(nodo.id))
      .then(setData)
      .catch(setError)
  }, [nodo.id, fuente])
  if (error) return jsx('div', { className: 'text-xs dk-mal', children: mensajeError(error) })
  if (!data) return jsx('div', { className: S.sub, children: t('graph.loading.unit.text') })
  return jsxs('div', { className: 'flex min-w-0 flex-col gap-1.5', children: [
    jsx('div', { className: 'max-h-48 overflow-y-auto whitespace-pre-wrap rounded border border-(--ui-stroke-tertiary) p-1.5 text-xs',
      children: data.texto }),
    jsx('div', { className: S.sub, children:
      'offsets ' + data.char_start + '–' + data.char_end +
      (data.articulo_url ? ' · ' : '') }),
    data.articulo_url ? jsx('a', { className: S.link, href: data.articulo_url,
      target: '_blank', rel: 'noopener noreferrer', children: t('graph.source.article') }) : null,
    data.sha256 ? jsx('div', { className: 'break-all font-mono text-xs text-(--ui-text-tertiary)',
      children: t('graph.unit.sha.256') + data.sha256 }) : null,
    data.articulo_sha256 ? jsx('div', { className: 'break-all font-mono text-xs text-(--ui-text-tertiary)',
      children: t('graph.article.sha.256') + data.articulo_sha256 }) : null,
  ] })
}

function NodoDetalle({ nodo, fuente }) {
  // La red delgada no trae url/sha256/vigencia: la ficha los pide por nodo.
  const [data, setData] = useState(null)
  useEffect(() => {
    setData(null)
    rest('/grafo/nodo?fuente=' + (fuente || 'corpus') + '&id=' + encodeURIComponent(nodo.id))
      .then(setData)
      .catch(() => {})
  }, [nodo.id, fuente])
  if (!data) return null
  return jsxs('div', { className: 'flex min-w-0 flex-col gap-1.5', children: [
    data.titulo ? jsx('div', { className: S.sub, children: data.titulo }) : null,
    data.vigencia && data.vigencia.estado ? jsx('div', { className: S.sub, children:
      t('graph.in.force.label') + etiquetaCodigo(data.vigencia.estado) +
      (data.vigencia.desde ? t('graph.from') + data.vigencia.desde : '') }) : null,
    data.url ? jsx('a', { className: S.link, href: data.url, target: '_blank', rel: 'noopener noreferrer',
      children: t('graph.original.source') }) : null,
    data.sha256 ? jsx('div', { className: 'break-all font-mono text-xs text-(--ui-text-tertiary)',
      children: 'sha256 ' + data.sha256 }) : null,
  ] })
}

function TarjetaArista({ arista, fuente }) {
  // Ficha de una arista clicada: regla, estado, nivel y snippet de evidencia.
  const [ev, setEv] = useState(null)
  const [err, setErr] = useState(null)
  const clave = arista ? arista.source + '|' + arista.target + '|' + arista.tipo : ''
  useEffect(() => {
    setEv(null); setErr(null)
    if (!arista) return undefined
    if (!arista.evidencia && fuente !== 'ambiental') return undefined
    rest('/grafo/evidencia?fuente=' + (fuente || 'corpus') + '&link=' + encodeURIComponent(clave))
      .then(setEv)
      .catch(setErr)
    return undefined
  }, [clave, fuente, arista])
  if (!arista) return null
  const e = arista.evidencia || {}
  return jsxs('div', { className: 'flex min-w-0 flex-col gap-1.5', children: [
    jsx('span', { className: S.chip + ' ' + S.chipOff, children:
      (arista.tipo || '') + ' · ' + (arista.estado || '') }),
    jsx('div', { className: 'break-all font-mono text-xs text-(--ui-text-tertiary)',
      children: (arista.source && arista.source.id ? arista.source.id : arista.source) +
        ' → ' + (arista.target && arista.target.id ? arista.target.id : arista.target) }),
    e.regla ? jsx('div', { className: S.sub, children:
      t('graph.rule') + e.regla + (e.nivel ? t('graph.level') + e.nivel : '') }) : null,
    err ? jsx('div', { className: 'text-xs dk-mal', children: mensajeError(err) }) : null,
    ev ? jsxs('div', { className: 'max-h-40 overflow-y-auto whitespace-pre-wrap rounded border border-(--ui-stroke-tertiary) p-1.5 text-xs', children: [
      ev.snippet || '',
      ev.n_evidencias ? ' (' + ev.n_evidencias + t('graph.evidence.items') : '',
    ] }) : null,
  ] })
}

// Chip de vigencia del resultado: solo cuando el resolver no la da por
// vigente. OUT_OF_FORCE se distingue derogación de versión superada (el
// resolver mismo lo advierte: rotular «derogado» a una versión vencida cita mal).
function etiquetaVigencia(v) {
  const e = v && v.estado
  if (!e) return null
  return { texto: etiquetaCodigo(e) + (v.motivo ? ' · ' + etiquetaCodigo(v.motivo) : ''), malo: e === 'OUT_OF_FORCE' && v.motivo !== 'SUPERSEDED_VERSION' }
}

function vigenteDe(v) {
  return !v || !v.estado || v.estado === 'IN_FORCE'
}

function TarjetaNodo({ nodo, conteos, fuente, busqueda, onLlevar }) {
  if (!nodo) {
    return jsx('div', { className: S.sub, children:
      t('graph.select.or.search.for.a.node.to.see.its.details.select.an.article.') })
  }
  const n = nodo
  const esUnidad = n.tipo === 'unidad'
  return jsxs('div', { className: 'flex min-w-0 flex-col gap-1.5', children: [
    busqueda ? jsxs('div', { className: 'flex flex-col gap-0.5', children: [
      jsx('span', { className: S.chip + ' ' + S.chipOff, children:
        t('graph.search.lead.citation.not.yet.checked') }),
      (busqueda.terminos || []).length
        ? jsx('div', { className: S.sub, children: t('graph.terms') + busqueda.terminos.join(', ') })
        : null,
      jsxs('div', { className: 'flex flex-wrap items-center gap-1.5', children: [
        jsx('span', {
          title: busqueda.cita ? undefined : (busqueda.cita_motivo || t('graph.no.citation.form.available')),
          children: jsx('button', {
            type: 'button', className: S.ghost,
            disabled: !busqueda.cita || !onLlevar,
            onClick: () => { if (busqueda.cita && onLlevar) onLlevar(busqueda) },
            children: t('graph.add.to.brief'),
          }),
        }),
        jsx('span', { className: S.sub, children:
          vigenteDe(busqueda.vigencia)
            ? t('graph.added.as.an.unchecked.citation.citation.check.runs.next')
            : t('graph.citation.check.will.return.fallo.article.out.of.force') }),
      ] }),
    ] }) : null,
    jsxs('div', { className: 'flex flex-wrap items-center gap-1.5', children: [
      jsx('span', { className: S.chip + ' ' + S.chipOff, children: NOMBRE_TIPO[n.tipo] || n.tipo }),
      esUnidad ? jsx('span', {
        className: S.chip + ' ' + S.chipOff,
        style: { borderLeft: '3px solid ' + (COLORES_MODALIDAD[n.modalidad] || '#64748b') },
        children: (n.modalidad || 'otra') + (n.modalidad_regla ? ' · ' + n.modalidad_regla : ''),
      }) : null,
      esUnidad ? jsx('span', { className: S.chip + ' ' + S.chipOff, children: t('graph.candidate.label_text') }) : null,
    ] }),
    jsx('div', { className: 'font-medium', children: n.label }),
    n.tipo === 'instrumento' ? jsx('div', { className: S.sub, children:
      (n.n_articulos || conteos.get(n.id) || 0) + t('graph.articles') }) : null,
    n.tipo === 'articulo' ? jsx('div', { className: S.sub, children:
      (n.n_unidades || 0) + t('graph.units') +
      (fuente === 'corpus' ? t('graph.select.to.expand.collapse') : '') }) : null,
    n.tipo === 'resolucion' ? jsx('div', { className: S.sub, children:
      (n.organismo ? n.organismo + ' · ' : '') + 'N° ' + n.numero + '/' + n.anio +
      ' · ' + (n.menciones || 0) + t('graph.mentions') +
      (n.rca ? ' · RCA' : '') }) : null,
    n.tipo === 'resolucion' ? jsx('div', { className: S.sub, children:
      t('graph.no.local.text.inferred.from.mentions.in.judgments') }) : null,
    esUnidad && n.articulo ? jsx('div', { className: S.sub, children:
      t('graph.unit2') + (n.etiqueta || '') + (n.clase === 'judicial' ? t('graph.of.the.judgment') : t('graph.of.the.article')) }) : null,
    jsx('div', { className: 'break-all font-mono text-xs text-(--ui-text-tertiary)', children: n.id }),
    esUnidad ? jsx(UnidadDetalle, { nodo: n, fuente }) : jsx(NodoDetalle, { nodo: n, fuente }),
  ] })
}

// ---------------------------------------------------------------------------
// Lista de texto del corpus (fallback sin WebGL y vista tabular de siempre)
// ---------------------------------------------------------------------------

function NormaDetalle({ data, error }) {
  if (error) return jsx('div', { className: 'text-xs dk-mal', children: mensajeError(error) })
  if (!data) return jsx('div', { className: S.sub, children: t('graph.loading.articles') })
  const arts = data.articulos || []
  return jsxs('div', { className: 'flex flex-col gap-1 pl-4', children: [
    jsx('div', { className: S.sub, children:
      (data.articulos_total || arts.length) + t('graph.articles') +
      (data.articulos_truncados ? t('graph.showing') + arts.length + ')' : '') }),
    ...arts.map((a, i) => jsxs('details', { key: i, className: 'text-xs', children: [
      jsx('summary', { className: 'cursor-pointer py-0.5', children:
        'art. ' + (a.label || a.eId) +
        (a.estado ? ' · ' + etiquetaCodigo(a.estado) : '') +
        (a.vigente_desde ? t('graph.from2') + String(a.vigente_desde).slice(0, 10) : '') }),
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
          jsx('div', { children: rotulo + (norma.estado ? ' · ' + etiquetaCodigo(norma.estado) : '') }),
          jsx('div', { className: S.sub + ' truncate', children: norma.titulo }),
        ] }),
      ],
    }),
    abierta ? jsx(NormaDetalle, { data: detalle, error: error }) : null,
  ] })
}

function ListaCorpus() {
  const [corpus, setCorpus] = useState(null)
  const [error, setError] = useState(null)
  useEffect(() => {
    rest('/grafo/corpus').then(setCorpus).catch(setError)
  }, [])
  if (error) return jsx('div', { className: 'text-xs dk-mal', children: mensajeError(error) })
  const pack = corpus && corpus.packs && corpus.packs[0]
  if (!pack) return jsx('div', { className: S.sub, children: t('graph.loading.corpus.label') })
  return jsx('div', { className: 'flex flex-col', children:
    (pack.normas || []).map((n) => jsx(NormaRow, { key: n.leychileCode, norma: n })) })
}

// ---------------------------------------------------------------------------
// Texto del artículo (foco desde una nota del chat): lee /grafo/leer y
// resalta el rango de la unidad y, dentro, el fragmento citado.
// ---------------------------------------------------------------------------

// Segmenta `texto` por los rangos {ini, fin, cls} ('unit' | 'frag'), que ya
// vienen en offsets del texto original. Devuelve [{texto, cls}].
function _segmentos(texto, marcas) {
  const puntos = new Set([0, texto.length])
  for (const m of marcas) { puntos.add(m.ini); puntos.add(m.fin) }
  const orden = [...puntos].sort((a, b) => a - b)
  const out = []
  for (let i = 0; i < orden.length - 1; i += 1) {
    const a = orden[i]
    const b = orden[i + 1]
    if (a >= b) continue
    const en = marcas.filter((m) => m.ini <= a && a < m.fin)
    const cls = en.some((m) => m.cls === 'frag') ? 'frag' : (en.length ? 'unit' : '')
    out.push({ texto: texto.slice(a, b), cls })
  }
  return out
}

function TextoArticulo({ foco }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const nodoId = foco && foco.nodo_id
  useEffect(() => {
    setData(null)
    setError(null)
    if (!nodoId) return undefined
    let vivo = true
    rest('/grafo/leer', {
      method: 'POST', body: { nodo_id: nodoId }, timeoutMs: 120000,
    }).then((d) => { if (vivo) setData(d) })
      .catch((e) => { if (vivo) setError(e) })
    return () => { vivo = false }
  }, [nodoId])

  if (error) {
    return jsx('div', { className: 'text-xs dk-mal',
      children: t('graph.could.not.read.the.article') + mensajeError(error) })
  }
  if (!data) return jsx('div', { className: S.sub, children: t('graph.loading.article') })
  if (data.resolucion !== 'RESOLVED') {
    return jsx('div', { className: S.sub, children:
      t('graph.article.could.not.be.resolved.in.the.corpus') +
      etiquetaCodigo(data.resolucion || '?') + (data.motivo ? ': ' + etiquetaCodigo(data.motivo) : '') + ').' })
  }

  const texto = data.texto || ''
  const unidades = data.unidades || []
  const unidad = foco && foco.unidad_id
    ? unidades.find((u) => u.id === foco.unidad_id) : null
  const marcas = []
  if (unidad && Number.isFinite(unidad.inicio) && Number.isFinite(unidad.fin)) {
    marcas.push({ ini: unidad.inicio, fin: unidad.fin, cls: 'unit' })
  }
  let fragEstado = null
  if (foco && foco.fragmento) {
    fragEstado = fragmentoEn(foco.fragmento, texto)
    const rango = rangoFragmento(texto, foco.fragmento)
    if (rango) marcas.push({ ini: rango[0], fin: rango[1], cls: 'frag' })
  }
  const segmentos = _segmentos(texto, marcas)
  const etiquetaUnidad = unidad ? unidad.etiqueta : null

  return jsxs('div', { className: 'flex flex-col gap-1.5', children: [
    jsxs('div', { className: 'flex flex-wrap items-center gap-1.5', children: [
      jsx('span', { className: S.cardTitle, children: t('graph.article.text') }),
      jsx('span', { className: S.chip + ' ' + S.chipOff,
        children: (data.articulo || data.nodo_id || '') }),
      data.pack_hash ? jsx('span', { className: S.sub,
        children: 'pack ' + data.pack_hash }) : null,
    ] }),
    jsxs('div', { className: S.sub, children: [
      (data.norma && (data.norma.nombre_corto || data.norma.titulo)
        ? (data.norma.nombre_corto || data.norma.titulo) + ' — ' : ''),
      jsx('a', { href: data.fuente_url, target: '_blank', rel: 'noopener noreferrer',
        className: S.link, children: t('graph.source.label') }),
      t('graph.dated.copy.check.the.text.in.force.yourself'),
    ] }),
    unidad ? jsx('div', { className: S.sub, children:
      t('graph.highlighted.unit') + (etiquetaUnidad || foco.unidad_id) }) : null,
    fragEstado ? jsx('div', { className: S.sub, children:
      fragEstado.ok
        ? t('graph.passage.found.in.article')
        : t('graph.passage.not.found.in.this.article') +
          (fragEstado.motivo === 'corto' ? t('graph.too.short.to.compare')
            : fragEstado.motivo === 'largo' ? t('graph.too.long') : '') }) : null,
    jsxs('div', {
      className: 'max-h-72 overflow-y-auto whitespace-pre-wrap rounded-md '
        + 'border border-(--ui-stroke-secondary) p-2 text-xs leading-relaxed',
      children: segmentos.map((s, i) => jsx('span', {
        key: i,
        style: s.cls === 'frag'
          ? { background: 'rgba(250,204,21,0.35)' }
          : s.cls === 'unit' ? { background: 'rgba(96,165,250,0.18)' } : undefined,
        children: s.texto,
      })),
    }),
  ] })
}

// ---------------------------------------------------------------------------

export function SeccionGrafo({ onLlevarAlEscrito }) {
  const [red, setRed] = useState(null)
  const [redErr, setRedErr] = useState(null)
  const [personal, setPersonal] = useState(null)
  const [personalErr, setPersonalErr] = useState(null)
  const [seleccion, setSeleccion] = useState(null)
  const [expandidos, setExpandidos] = useState(() => new Set())
  const [unidadesMap, setUnidadesMap] = useState(() => new Map())
  const [ocultarArts, setOcultarArts] = useState(false)
  const [fuente, setFuenteState] = useState('corpus')
  const [fuentes, setFuentes] = useState(null)
  const [aristaSel, setAristaSel] = useState(null)
  const [hover, setHover] = useState(null)
  const [caminoOn, setCaminoOn] = useState(false)
  const [caminoIdx, setCaminoIdx] = useState(0)
  const [rotar, setRotar] = useState(false)
  // Última fuente elegida por perfil (ctx.storage del SDK).
  const setFuente = useCallback((f) => {
    setFuenteState(f)
    try { storage && storage.set('grafo.fuente', f) } catch (e) { /* opcional */ }
  }, [])
  const [query, setQuery] = useState('')
  const [modoBusqueda, setModoBusqueda] = useState('nombre')
  // null | {estado:'cargando'} | {estado:'error', mensaje} | {estado:'lista', data}
  const [busqueda, setBusqueda] = useState(null)
  // nodo_id -> resultado de la búsqueda que lo trajo (para la ficha y las unidades).
  const [busquedaPorNodo, setBusquedaPorNodo] = useState(() => new Map())
  // nodo_id de la materia cuyo filtro de resalte está activo (null = todos).
  const [materiaFiltro, setMateriaFiltro] = useState(null)
  const [fallo3d, setFallo3d] = useState(null)
  const [listaAbierta, setListaAbierta] = useState(false)
  const apiRef = useRef(null)
  // Foco pendiente del chat (una nota «abrir en el grafo»). Se lee una vez al
  // montar; la fuente se fuerza a corpus y la preferencia guardada no se toca.
  const [foco] = useState(() => tomarFoco())
  const focoAplicado = useRef(false)

  const cargar = useCallback(() => {
    setRedErr(null)
    setPersonalErr(null)
    setRed(null)
    setBusqueda(null)
    setBusquedaPorNodo(new Map())
    rest('/grafo/red?fuente=' + fuente, { timeoutMs: 120000 }).then(setRed).catch(setRedErr)
    rest('/grafo/personal').then(setPersonal).catch(setPersonalErr)
  }, [fuente])
  useEffect(cargar, [cargar])
  useEffect(() => {
    rest('/grafo/fuentes').then((fs) => {
      setFuentes(fs)
      // Un foco pendiente fuerza corpus: no se restaura la fuente guardada
      // (ni se sobrescribe — setFuenteState, no setFuente).
      if (foco) return
      const amb = fs && fs.find((f) => f.id === 'ambiental' && f.disponible)
      let elegida = null
      try { elegida = storage && storage.get('grafo.fuente') } catch (e) { elegida = null }
      if (elegida === 'ambiental' && amb) setFuenteState('ambiental')
      else if (elegida === 'corpus') setFuenteState('corpus')
      else if (amb) setFuenteState('ambiental')
    }).catch(() => {})
  }, [foco])

  // Aplica el foco una vez que la red del corpus está cargada: selecciona y
  // expande el artículo (como alElegirResultado) y enfoca la cámara. Mientras
  // `red` carga el panel «Texto del artículo» ya muestra su propio estado.
  useEffect(() => {
    if (!foco || focoAplicado.current) return
    if (fuente !== 'corpus') { setFuenteState('corpus'); return }
    if (!red) return
    focoAplicado.current = true
    setSeleccion(foco.nodo_id)
    if (!expandidos.has(foco.nodo_id)) {
      setExpandidos((prev) => new Set(prev).add(foco.nodo_id))
      if (!unidadesMap.has(foco.nodo_id)) {
        rest('/grafo/unidades?articulo=' + encodeURIComponent(foco.nodo_id))
          .then((d) => setUnidadesMap((prev) => new Map(prev).set(foco.nodo_id, d)))
          .catch(() => {})
      }
    }
    if (apiRef.current) apiRef.current.enfocar(foco.nodo_id)
  }, [foco, fuente, red, expandidos, unidadesMap])

  const alFallo3d = useCallback((msg) => {
    setFallo3d(msg)
    setListaAbierta(true)
  }, [])

  const nodos = useMemo(() => (red && red.nodes) || [], [red])
  const aristas = useMemo(() => (red && red.links) || [], [red])
  const indice = useMemo(() => new Map(nodos.map((n) => [n.id, n])), [nodos])
  const padres = useMemo(() => {
    const m = new Map()
    for (const l of aristas) if (l.tipo === 'contiene') m.set(l.target, l.source)
    for (const id of expandidos) {
      const d = unidadesMap.get(id)
      if (d) {
        for (const l of d.links || []) {
          if (l.tipo === 'contiene') m.set(l.target, l.source)
        }
      }
    }
    return m
  }, [aristas, expandidos, unidadesMap])
  const conteos = useMemo(() => {
    const m = new Map()
    for (const l of aristas) if (l.tipo === 'contiene') m.set(l.source, (m.get(l.source) || 0) + 1)
    return m
  }, [aristas])

  // En ambiental TODO va visible: artículos, unidades, sentencias y
  // resoluciones. En corpus las unidades se traen por /grafo/unidades al clic.
  const proyeccion = useMemo(() => {
    const nodes = nodos.filter((n) => {
      if (fuente === 'ambiental') return n.tipo !== 'articulo' || !ocultarArts
      return n.tipo === 'articulo' ? !ocultarArts : true
    })
    const links = [...aristas]
    if (fuente === 'corpus' && !ocultarArts) {
      for (const id of expandidos) {
        const d = unidadesMap.get(id)
        if (d) {
          nodes.push(...(d.nodes || []))
          links.push(...(d.links || []))
        }
      }
    }
    const ids = new Set(nodes.map((n) => n.id))
    return {
      nodes,
      links: links.filter((l) => ids.has(l.source) && ids.has(l.target)),
    }
  }, [nodos, aristas, ocultarArts, expandidos, unidadesMap])

  const alClickNodo = useCallback((n) => {
    setSeleccion(n.id)
    // Clic en un artículo (corpus): trae (o pliega) sus unidades mínimas.
    if (n.tipo === 'articulo' && fuente === 'corpus') {
      if (expandidos.has(n.id)) {
        setExpandidos((prev) => {
          const next = new Set(prev)
          next.delete(n.id)
          return next
        })
      } else {
        setExpandidos((prev) => new Set(prev).add(n.id))
        if (!unidadesMap.has(n.id)) {
          rest('/grafo/unidades?articulo=' + encodeURIComponent(n.id))
            .then((d) => setUnidadesMap((prev) => new Map(prev).set(n.id, d)))
            .catch(() => {})
        }
      }
    }
  }, [expandidos, unidadesMap, fuente])

  const alClickArista = useCallback((l) => { setAristaSel(l) }, [])
  const alFondo = useCallback(() => { setSeleccion(null); setCaminoOn(false); setRotar(false) }, [])
  const alHover = useCallback((id) => setHover(id), [])

  // Resalte del foco: camino demo > selección > hover > resultados de la
  // búsqueda por contenido. Lo elegido, sus vecinos y las aristas entre ellos
  // quedan a color pleno; el resto atenúa.
  const resalte = useMemo(() => {
    const cam = red && (red.caminos_demo || [])[caminoIdx]
    if (caminoOn && cam && (cam.ids || []).length) {
      return { ids: new Set(cam.ids), links: new Set(cam.links || []) }
    }
    const foco = seleccion || hover
    if (foco) {
      const ids = new Set([foco])
      // Si el nodo vino de la búsqueda por contenido, sus unidades con
      // términos también quedan encendidas.
      const res = busquedaPorNodo.get(foco)
      if (res) {
        for (const u of res.unidades || []) ids.add(u.id)
      }
      const links = new Set()
      for (const l of proyeccion.links) {
        const s = idDe(l.source)
        const t = idDe(l.target)
        if (s === foco) { ids.add(t); links.add(s + '|' + t + '|' + l.tipo) }
        if (t === foco) { ids.add(s); links.add(s + '|' + t + '|' + l.tipo) }
      }
      return { ids, links }
    }
    // Sin camino ni selección ni hover: los resultados de la búsqueda
    // por contenido iluminan sus artículos y los instrumentos que los contienen.
    // Con filtro de materia activo solo encienden los resultados de esa
    // materia (la lista sigue completa y en el mismo orden).
    const data = busqueda && busqueda.estado === 'lista' ? busqueda.data : null
    const lista = (data && data.resultados) || []
    if (!lista.length) return null
    const ids = new Set()
    for (const r of lista) {
      if (materiaFiltro
          && !(r.materias || []).some((m) => m.nodo === materiaFiltro)) continue
      ids.add(r.nodo_id)
      ids.add(r.instrumento)
    }
    if (!ids.size) return null
    const links = new Set()
    for (const l of proyeccion.links) {
      if (l.tipo !== 'contiene') continue
      const s = idDe(l.source)
      const t = idDe(l.target)
      if (ids.has(s) && ids.has(t)) links.add(s + '|' + t + '|' + l.tipo)
    }
    return { ids, links }
  }, [caminoOn, caminoIdx, red, seleccion, hover, proyeccion, busqueda, busquedaPorNodo, materiaFiltro])

  // Órbita lenta para el video; se apaga con cualquier interacción.
  useEffect(() => {
    if (!rotar) return undefined
    const tarea = programarInterval(() => {
      if (apiRef.current && apiRef.current.orbita) apiRef.current.orbita()
    }, 40)
    return () => cancelarTarea(tarea)
  }, [rotar])

  const alBuscar = useCallback((id) => {
    const n = indice.get(id)
    if (!n) return
    setSeleccion(id)
    // enfocar reintenta hasta que el nodo tenga posición (reintento acotado).
    if (apiRef.current) apiRef.current.enfocar(id)
  }, [indice])

  // Búsqueda por contenido: POST /grafo/buscar (BM25, solo corpus sellado).
  // Se dispara con Enter o el botón — nunca por tecla — y el resultado es una
  // pista, no una fuente verificada (el rótulo viaja en la respuesta).
  const buscarContenido = useCallback(() => {
    const q = query.trim()
    if (!q || fuente !== 'corpus') return
    setBusqueda({ estado: 'cargando' })
    setBusquedaPorNodo(new Map())
    setMateriaFiltro(null)
    rest('/grafo/buscar', {
      method: 'POST',
      body: { q, limite: 20 },
      timeoutMs: 120000,
    })
      .then((data) => {
        setBusqueda({ estado: 'lista', data })
        const ids = []
        for (const r of (data && data.resultados) || []) {
          ids.push(r.nodo_id)
          ids.push(r.instrumento)
        }
        if (apiRef.current && apiRef.current.encuadrar) apiRef.current.encuadrar(ids)
      })
      .catch((e) => {
        setBusqueda({ estado: 'error', mensaje: mensajeError(e) })
        setBusquedaPorNodo(new Map())
        setMateriaFiltro(null)
      })
  }, [query, fuente])

  // Clic en un resultado: selecciona el artículo, lo deja SIEMPRE expandido
  // (nunca pliega — a diferencia del clic directo sobre el nodo, que alterna)
  // y enfoca la cámara.
  const alElegirResultado = useCallback((r) => {
    setBusquedaPorNodo((prev) => new Map(prev).set(r.nodo_id, r))
    setSeleccion(r.nodo_id)
    if (fuente === 'corpus' && !expandidos.has(r.nodo_id)) {
      setExpandidos((prev) => new Set(prev).add(r.nodo_id))
      if (!unidadesMap.has(r.nodo_id)) {
        rest('/grafo/unidades?articulo=' + encodeURIComponent(r.nodo_id))
          .then((d) => setUnidadesMap((prev) => new Map(prev).set(r.nodo_id, d)))
          .catch(() => {})
      }
    }
    if (apiRef.current) apiRef.current.enfocar(r.nodo_id)
  }, [expandidos, unidadesMap, fuente])

  // «Llevar al escrito»: el plugin.src encola la cita canónica y cambia de
  // pestaña; aquí solo se reenvía el resultado (con su cita, nunca la consulta).
  const alLlevar = useCallback((r) => {
    if (onLlevarAlEscrito && r && r.cita) onLlevarAlEscrito(r)
  }, [onLlevarAlEscrito])

  const q = query.trim().toLocaleLowerCase()
  const coincidencias = q
    ? nodos.filter((n) =>
        n.label.toLocaleLowerCase().includes(q) || n.id.toLocaleLowerCase().includes(q))
      .slice(0, 40)
    : []
  const actual = seleccion ? indice.get(seleccion) : null
  const arbolData = busqueda && busqueda.estado === 'lista' && busqueda.data
    ? busqueda.data.arbol || null
    : null
  const candidatos = (personal && personal.candidates) || []
  const aristasP = (personal && personal.edges) || []
  const totales = (red && red.conteos) || {}

  return jsxs('div', { className: 'flex flex-col gap-3', children: [
    jsxs('div', { className: S.card, children: [
      jsxs('div', { className: 'flex flex-wrap items-center justify-between gap-2', children: [
        jsx('div', { className: S.cardTitle, children: t('graph.corpus.graph') }),
        jsxs('select', {
          className: S.input,
          title: t('graph.graph.source'),
          value: fuente,
          onChange: (e) => {
            setFuente(e.target.value)
            setExpandidos(new Set())
            setAristaSel(null)
            setSeleccion(null)
            if (e.target.value !== 'corpus' && modoBusqueda === 'contenido') {
              setModoBusqueda('nombre')
            }
          },
          children: [
            jsx('option', { value: 'corpus', children: t('graph.dik.corpus.25.laws') }),
            jsx('option', {
              value: 'ambiental',
              disabled: !(fuentes && fuentes.find((f) => f.id === 'ambiental' && f.disponible)),
              title: t('graph.only.on.this.device.unpublished'),
              children: t('graph.local.environmental.graph.this.device'),
            }),
          ] }),
        fuente === 'ambiental' ? jsx('span', { className: S.chip + ' ' + S.chipOff,
          children: t('graph.local.unpublished.pseudonymized.judgments')
            + t('graph.candidate.relations.unvalidated') }) : null,
        red ? jsx('div', { className: S.sub, children:
          (red.pack_hash ? 'pack ' + red.pack_hash + ' · ' : '') +
          (totales.nodes || 0) + t('graph.nodes') + (totales.links || 0) + t('graph.edges') +
          (red.truncado ? t('graph.truncated') : '') }) : null,
      ] }),
      redErr
        ? jsxs('div', { className: 'flex flex-col items-start gap-1.5', children: [
            jsx('div', { className: 'text-xs dk-mal', children: mensajeError(redErr) }),
            jsx('button', { type: 'button', className: S.ghost, onClick: cargar,
              children: t('graph.retry') }),
          ] })
        : !red
          ? jsx('div', { className: S.sub, children:
              t('graph.loading.corpus.graph.the.first.load.may.take.a.minute.while.the.c') })
          : jsxs('div', { className: 'grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1fr)_17rem]', children: [
              jsxs('div', { className: 'min-w-0', children: [
                jsxs('div', { className: 'mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs', children: [
                  Object.keys(COLORES_NODO).map((tipo) => jsxs('span', {
                    key: tipo, className: 'flex items-center gap-1.5 ' + S.sub, children: [
                      jsx('span', { className: 'inline-block h-2.5 w-2.5 rounded-full',
                        style: { background: COLORES_NODO[tipo] } }),
                      NOMBRE_TIPO[tipo],
                    ] })),
                  jsxs('label', { className: 'flex items-center gap-1.5 ' + S.sub, children: [
                    jsx('input', { type: 'checkbox', checked: ocultarArts,
                      onChange: (e) => setOcultarArts(e.target.checked) }),
                    t('graph.hide.articles'),
                  ] }),
                  jsx('span', { className: S.sub, children: '|' }),
                  jsx('span', { className: S.sub, children: t('graph.candidate.label.unvalidated') }),
                  Object.keys(COLORES_MODALIDAD).map((mod) => jsxs('span', {
                    key: mod, className: 'flex items-center gap-1 ' + S.sub, children: [
                      jsx('span', { className: 'inline-block h-2 w-2 rounded-full',
                        style: { background: COLORES_MODALIDAD[mod] } }),
                      mod,
                    ] })),
                  jsx('button', { type: 'button', className: S.link,
                    onClick: () => { if (apiRef.current) apiRef.current.zoomFit() },
                    children: t('graph.fit') }),
                  fuente === 'ambiental' && red && (red.caminos_demo || []).length
                    ? jsxs('span', { className: 'flex items-center gap-1', children: [
                        jsxs('select', {
                          className: S.input,
                          title: t('graph.highlighted.path'),
                          value: caminoIdx,
                          onChange: (e) => {
                            const i = Number(e.target.value)
                            setCaminoIdx(i)
                            const cm = (red.caminos_demo || [])[i]
                            if (caminoOn && cm && apiRef.current) {
                              apiRef.current.encuadrar(cm.ids)
                            }
                          },
                          children: (red.caminos_demo || []).map((cm, i) =>
                            jsx('option', { key: i, value: i,
                              children: cm.titulo + ' · ' + cm.relajacion })),
                        }),
                        jsx('button', {
                          type: 'button',
                          className: caminoOn ? S.chip + ' ' + S.chipOk : S.link,
                          onClick: () => {
                            const on = !caminoOn
                            setCaminoOn(on)
                            setRotar(false)
                            const cm = (red.caminos_demo || [])[caminoIdx]
                            if (on && cm && apiRef.current) {
                              apiRef.current.encuadrar(cm.ids)
                            }
                          },
                          children: t('graph.highlighted.path2'),
                        }),
                      ] })
                    : null,
                  fuente === 'ambiental' ? jsxs('label', {
                    className: 'flex items-center gap-1.5 ' + S.sub, children: [
                      jsx('input', { type: 'checkbox', checked: rotar,
                        onChange: (e) => setRotar(e.target.checked) }),
                      t('graph.rotate'),
                    ] }) : null,
                  jsx('span', { className: S.sub + ' ml-auto', children:
                    proyeccion.nodes.length + t('graph.visible') + proyeccion.links.length + t('graph.edges') }),
                ] }),
                fallo3d
                  ? jsxs('div', { className: S.card, children: [
                      jsx('div', { className: 'text-xs dk-mal', children: fallo3d }),
                      jsx('div', { className: S.sub, children:
                        t('graph.the.3d.graph.needs.webgl.the.list.below.has.the.same.corpus') }),
                    ] })
                  : jsx(LienzoGrafo, {
                      proyeccion, padres, conteos, alClickNodo, alClickArista,
                      alHover, alFondo, resalte, onFallo: alFallo3d, apiRef }),
              ] }),
              jsxs('div', { className: 'flex min-w-0 flex-col gap-2', children: [
                jsxs('div', { className: 'flex items-center gap-1', children: [
                  jsx('select', {
                    className: S.input,
                    title: t('graph.search.mode'),
                    value: modoBusqueda,
                    onChange: (e) => setModoBusqueda(e.target.value),
                    children: [
                      jsx('option', { value: 'nombre', children: t('graph.by.name') }),
                      jsx('option', {
                        value: 'contenido',
                        disabled: fuente !== 'corpus',
                        children: t('graph.by.content'),
                      }),
                    ],
                  }),
                  jsx('input', {
                    className: S.input + ' w-full',
                    placeholder: modoBusqueda === 'contenido'
                      ? t('graph.search.article.text')
                      : t('graph.search.law.code.or.article'),
                    value: query,
                    onChange: (e) => setQuery(e.target.value),
                    onKeyDown: (e) => {
                      if (e.key === 'Enter' && modoBusqueda === 'contenido') {
                        buscarContenido()
                      }
                    },
                  }),
                  modoBusqueda === 'contenido' ? jsx('button', {
                    type: 'button',
                    className: S.ghost,
                    disabled: !query.trim() || busqueda?.estado === 'cargando',
                    onClick: buscarContenido,
                    children: busqueda?.estado === 'cargando' ? t('graph.searching.label') : t('graph.search.label'),
                  }) : null,
                ] }),
                modoBusqueda === 'contenido' && fuente !== 'corpus'
                  ? jsx('div', { className: S.sub, children:
                      t('graph.text.search.covers.the.dik.corpus.only') })
                  : null,
                modoBusqueda === 'nombre' && q ? jsxs('div', { className: 'max-h-44 overflow-y-auto rounded-md border border-(--ui-stroke-secondary)', children: [
                  coincidencias.map((n) => jsxs('button', {
                    key: n.id, type: 'button',
                    className: 'block w-full px-2 py-1 text-left text-xs hover:bg-(--ui-bg-quaternary) truncate',
                    onClick: () => alBuscar(n.id),
                    children: [
                      jsx('span', { style: { color: COLORES_NODO[n.tipo] }, children: '● ' }),
                      n.label,
                    ] })),
                  coincidencias.length === 0
                    ? jsx('div', { className: S.sub + ' p-2', children: t('graph.no.matches') }) : null,
                ] }) : null,
                modoBusqueda === 'contenido' && busqueda ? jsxs('div', {
                  className: 'flex max-h-72 flex-col gap-1 overflow-y-auto rounded-md border border-(--ui-stroke-secondary) p-1.5',
                  children: [
                    busqueda.estado === 'cargando'
                      ? jsx('div', { className: S.sub + ' p-1', children: t('graph.searching.corpus') })
                      : null,
                    busqueda.estado === 'error'
                      ? jsx('div', { className: 'text-xs dk-mal p-1', children: busqueda.mensaje })
                      : null,
                    busqueda.estado === 'lista' ? jsxs('div', { className: 'flex flex-col gap-1', children: [
                      jsx('span', { className: S.chip + ' ' + S.chipOff,
                        children:
                          (busqueda.data && busqueda.data.rotulo) ||
                          t('graph.search.lead.citation.not.yet.checked') }),
                      arbolData
                        ? (arbolData.disponible
                          ? jsxs('div', { className: 'flex flex-col gap-0.5 px-1', children: [
                              jsxs('div', { className: 'flex flex-wrap items-center gap-1', children: [
                                jsx('span', { className: S.sub, children: t('graph.query.subjects') }),
                                ...(arbolData.clasificacion || []).map((c) => jsx('button', {
                                  key: c.nodo, type: 'button',
                                  className: S.chip + ' ' + (materiaFiltro === c.nodo ? S.chipOk : S.chipOff),
                                  title: t('graph.terms') + (c.terminos || []).join(', ') +
                                    t('graph.coverage') + Math.round((c.cobertura || 0) * 100) + '%',
                                  onClick: () => setMateriaFiltro(
                                    (prev) => (prev === c.nodo ? null : c.nodo)),
                                  children: c.nombre + ' · ' + c.score,
                                })),
                                !arbolData.clara
                                  ? jsx('span', { className: S.chip + ' ' + S.chipOff,
                                      children: t('graph.ambiguous.classification') })
                                  : null,
                              ] }),
                              ...(arbolData.clasificacion || []).map((c) => jsx('div', {
                                key: 't-' + c.nodo,
                                className: S.sub + ' truncate',
                                children: c.nombre + ' — ' +
                                  ((c.terminos || []).join(', ') || t('graph.no.terms')) +
                                  t('graph.coverage') + Math.round((c.cobertura || 0) * 100) + '%',
                              })),
                              jsx('div', { className: S.sub + ' truncate', children:
                                t('graph.subject.classification.explains.matches.it.does.not.change.their.') }),
                            ] })
                          : jsx('div', { className: S.sub + ' px-1', children:
                              t('graph.subject.tree.unavailable') +
                              (arbolData.motivo ? ' — ' + arbolData.motivo : '') }))
                        : null,
                      ((busqueda.data && busqueda.data.resultados) || []).length === 0
                        ? jsx('div', { className: S.sub + ' p-1', children: t('graph.no.results') })
                        : null,
                      ((busqueda.data && busqueda.data.resultados) || []).map((r) => {
                        const metodo = (busqueda.data && busqueda.data.metodo) || {}
                        const rel = Math.max(0, Math.min(1, r.score_rel || 0))
                        const vig = etiquetaVigencia(r.vigencia)
                        const fueraDelFiltro = materiaFiltro
                          && !(r.materias || []).some((m) => m.nodo === materiaFiltro)
                        return jsxs('div', {
                          key: r.nodo_id, role: 'button', tabIndex: 0,
                          className: 'flex w-full cursor-pointer flex-col gap-0.5 rounded px-1.5 py-1 text-left text-xs hover:bg-(--ui-bg-quaternary)' +
                            (fueraDelFiltro ? ' opacity-40' : ''),
                          onClick: () => alElegirResultado(r),
                          onKeyDown: (e) => {
                            // Solo la fila misma: las teclas del botón
                            // «Llevar al escrito» no deben elegir el resultado.
                            if (e.target !== e.currentTarget) return
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault()
                              alElegirResultado(r)
                            }
                          },
                          children: [
                            jsxs('div', { className: 'flex items-center gap-1.5', children: [
                              jsx('span', { className: S.sub, children: '#' + r.rank }),
                              jsx('span', { className: 'min-w-0 flex-1 truncate', children: r.label }),
                              jsx('span', { className: S.chip + ' ' + S.chipOff, children: r.canal }),
                              vig ? jsx('span', {
                                className: S.chip + ' ' + (vig.malo ? S.chipBad : S.chipOff),
                                children: vig.texto,
                              }) : null,
                            ] }),
                            jsxs('div', { className: 'flex items-center gap-1.5', children: [
                              jsx('span', {
                                className: 'inline-block h-1.5 rounded-sm bg-(--ui-accent)',
                                style: { width: Math.max(3, Math.round(rel * 64)) + 'px' },
                              }),
                              jsx('span', { className: S.sub, children: Math.round(rel * 100) + '%' }),
                            ] }),
                            (r.terminos || []).length
                              ? jsx('div', { className: S.sub + ' truncate', children:
                                  t('graph.terms') + r.terminos.join(', ') })
                              : null,
                            (r.unidades || []).length
                              ? jsx('div', { className: S.sub + ' truncate', children:
                                  t('graph.units2') + r.unidades.map((u) => u.etiqueta).join(', ') })
                              : null,
                            (r.materias || []).length
                              ? jsx('div', { className: 'flex flex-wrap gap-1', children:
                                  r.materias.map((m, i) => jsx('span', {
                                    key: m.nodo + '-' + i,
                                    className: S.chip + ' ' + S.chipOff,
                                    children: (m.relacion === 'ancla' ? t('graph.anchor') : t('graph.territory')) +
                                      ' · ' + m.nombre,
                                  })) })
                              : null,
                            jsx('div', { className: S.sub + ' truncate', children:
                              (metodo.motor || 'bm25') + t('graph.channel') + (r.canal || '') +
                              (r.evidencia ? ' — ' + r.evidencia : '') }),
                            jsxs('div', { className: 'flex flex-wrap items-center gap-1.5', children: [
                              jsx('span', {
                                title: r.cita ? undefined : (r.cita_motivo || t('graph.no.citation.form.available')),
                                children: jsx('button', {
                                  type: 'button', className: S.ghost,
                                  disabled: !r.cita,
                                  onClick: (e) => {
                                    e.stopPropagation()
                                    alLlevar(r)
                                  },
                                  children: t('graph.add.to.brief'),
                                }),
                              }),
                              jsx('span', { className: S.sub, children:
                                vigenteDe(r.vigencia)
                                  ? t('graph.added.as.an.unchecked.citation.citation.check.runs.next')
                                  : t('graph.citation.check.will.return.fallo.article.out.of.force') }),
                            ] }),
                          ],
                        })
                      }),
                    ] }) : null,
                  ] }) : null,
                foco ? jsx('div', { className: 'rounded-md border border-(--ui-stroke-secondary) p-2', children:
                  jsx(TextoArticulo, { foco }) }) : null,
                jsx('div', { className: 'rounded-md border border-(--ui-stroke-secondary) p-2', children:
                  jsx(TarjetaNodo, {
                    nodo: actual, conteos, fuente,
                    busqueda: seleccion ? busquedaPorNodo.get(seleccion) || null : null,
                    onLlevar: alLlevar,
                  }) }),
                aristaSel ? jsx('div', { className: 'rounded-md border border-(--ui-stroke-secondary) p-2', children:
                  jsx(TarjetaArista, { arista: aristaSel, fuente }) }) : null,
                caminoOn && red && (red.caminos_demo || [])[caminoIdx] ? jsxs('div', {
                  className: 'rounded-md border border-(--ui-stroke-secondary) p-2 flex flex-col gap-1',
                  children: [
                    jsx('div', { className: S.cardTitle, children:
                      t('graph.highlighted.path2') + ((red.caminos_demo || [])[caminoIdx].relajacion || '') }),
                    ...(red.caminos_demo[caminoIdx].ids || []).map((id, i) => {
                      const n = indice.get(id)
                      const paso = i > 0
                        ? ' ' + ((red.caminos_demo[caminoIdx].links[i - 1] || '').split('|')[2] || '→') + ' '
                        : ''
                      return jsxs('button', {
                        key: id, type: 'button',
                        className: 'text-left text-xs hover:bg-(--ui-bg-quaternary) truncate ' + S.link,
                        onClick: () => { if (apiRef.current) apiRef.current.enfocar(id) },
                        children: [
                          (i + 1) + '. ' + (n ? n.label : id),
                          paso ? jsx('span', { className: S.sub, children: ' ·' + paso.trim() }) : null,
                        ] })
                    }),
                  ] }) : null,
              ] }),
            ] }),
    ] }),
    fuente === 'corpus' ? jsxs('details', {
      className: S.card, open: listaAbierta,
      onToggle: (e) => setListaAbierta(e.currentTarget.open),
      children: [
        jsx('summary', { className: 'cursor-pointer ' + S.cardTitle + ' normal-case',
          children: t('graph.corpus.list.text') }),
        listaAbierta ? jsx('div', { className: 'mt-2', children: jsx(ListaCorpus, {}) }) : null,
      ] }) : null,
    fuente === 'corpus' ? jsxs('div', { className: S.card, children: [
      jsx('div', { className: S.cardTitle, children: t('graph.personal.review.graph') }),
      personalErr
        ? jsx('div', { className: 'text-xs dk-mal', children: mensajeError(personalErr) })
        : !personal
          ? jsx('div', { className: S.sub, children: t('graph.loading.label') })
          : jsxs('div', { className: 'flex flex-col gap-1', children: [
              jsx('div', { className: S.sub, children: candidatos.length + t('graph.candidates') + aristasP.length + t('graph.edges') }),
              candidatos.length === 0
                ? jsx('div', { className: S.sub, children:
                    t('graph.no.candidates.yet.the.personal.review.graph.collects.evidence.fro') +
                    t('graph.brief') })
                : jsx('div', { className: 'flex flex-col', children:
                    candidatos.map((c, i) => jsxs('div', { key: i, className: S.row, children: [
                      jsxs('div', { className: 'min-w-0', children: [
                        jsx('div', { children: (c.candidate_id || '') + ' · ' + (c.state_human || c.state || '') }),
                        jsx('div', { className: S.meta, children: String(c.text || c.summary || '').slice(0, 160) }),
                      ] }),
                    ] })) }),
            ] }),
    ] }) : null,
  ] })
}
