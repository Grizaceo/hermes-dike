// Vista 3D del grafo del corpus (3d-force-graph + three, empaquetados en el
// bundle). Muestra primero solo los 25 instrumentos; un clic en un
// instrumento (o el interruptor "mostrar artículos") expande sus artículos.
// La lista de texto queda como fallback cuando WebGL no está disponible.

import ForceGraph3D from '3d-force-graph'
import { jsx, jsxs } from 'react/jsx-runtime'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { mensajeError, rest, storage, S } from './common.js'

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
  instrumento: 'Instrumento',
  articulo: 'Artículo',
  sentencia: 'Sentencia',
  resolucion: 'Resolución',
  unidad: 'Unidad',
}
const NOMBRE_ESTADO = {
  verificada_estructura: 'verificada (estructura)',
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
      onFallo('WebGL no está disponible: no se puede dibujar el grafo 3D. Abajo queda la lista de texto.')
      return undefined
    }
    let graph
    let observer
    try {
      graph = new ForceGraph3D(hostEl.current)
    } catch (e) {
      onFallo('No se pudo iniciar el renderizador 3D: ' + mensajeError(e))
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
        ? n.label + ' · ' + (conteosRef.current.get(n.id) || 0) + ' artículos'
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
        let intentos = 0
        const intentar = () => {
          const n = g.graphData().nodes.find((x) => x.id === id)
          if (n && Number.isFinite(n.x)) {
            g.cameraPosition(
              { x: n.x + 60, y: (n.y || 0) + 40, z: (n.z || 0) + 150 },
              { x: n.x, y: n.y || 0, z: n.z || 0 },
              600)
          } else if (intentos < 40) {
            intentos += 1
            setTimeout(intentar, 50)
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
    !listo ? jsx('div', { className: S.sub + ' absolute left-3 top-3', children: 'Dibujando el grafo…' }) : null,
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
  if (error) return jsx('div', { className: 'text-xs text-(--ui-danger)', children: mensajeError(error) })
  if (!data) return jsx('div', { className: S.sub, children: 'Cargando el texto de la unidad…' })
  return jsxs('div', { className: 'flex min-w-0 flex-col gap-1.5', children: [
    jsx('div', { className: 'max-h-48 overflow-y-auto whitespace-pre-wrap rounded border border-(--ui-stroke-tertiary) p-1.5 text-xs',
      children: data.texto }),
    jsx('div', { className: S.sub, children:
      'offsets ' + data.char_start + '–' + data.char_end +
      (data.articulo_url ? ' · ' : '') }),
    data.articulo_url ? jsx('a', { className: S.link, href: data.articulo_url,
      target: '_blank', rel: 'noopener noreferrer', children: 'Artículo fuente ↗' }) : null,
    data.sha256 ? jsx('div', { className: 'break-all font-mono text-[0.6875rem] text-(--ui-text-tertiary)',
      children: 'sha256 unidad ' + data.sha256 }) : null,
    data.articulo_sha256 ? jsx('div', { className: 'break-all font-mono text-[0.6875rem] text-(--ui-text-tertiary)',
      children: 'sha256 artículo ' + data.articulo_sha256 }) : null,
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
      'Vigencia: ' + data.vigencia.estado +
      (data.vigencia.desde ? ' desde ' + data.vigencia.desde : '') }) : null,
    data.url ? jsx('a', { className: S.link, href: data.url, target: '_blank', rel: 'noopener noreferrer',
      children: 'Fuente original ↗' }) : null,
    data.sha256 ? jsx('div', { className: 'break-all font-mono text-[0.6875rem] text-(--ui-text-tertiary)',
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
    jsx('div', { className: 'break-all font-mono text-[0.6875rem] text-(--ui-text-tertiary)',
      children: (arista.source && arista.source.id ? arista.source.id : arista.source) +
        ' → ' + (arista.target && arista.target.id ? arista.target.id : arista.target) }),
    e.regla ? jsx('div', { className: S.sub, children:
      'regla ' + e.regla + (e.nivel ? ' · nivel ' + e.nivel : '') }) : null,
    err ? jsx('div', { className: 'text-xs text-(--ui-danger)', children: mensajeError(err) }) : null,
    ev ? jsxs('div', { className: 'max-h-40 overflow-y-auto whitespace-pre-wrap rounded border border-(--ui-stroke-tertiary) p-1.5 text-xs', children: [
      ev.snippet || '',
      ev.n_evidencias ? ' (' + ev.n_evidencias + ' evidencias)' : '',
    ] }) : null,
  ] })
}

function TarjetaNodo({ nodo, conteos, fuente }) {
  if (!nodo) {
    return jsx('div', { className: S.sub, children:
      'Haz clic en un nodo (o búscalo) para ver su ficha. Un clic en un artículo expande sus unidades.' })
  }
  const n = nodo
  const esUnidad = n.tipo === 'unidad'
  return jsxs('div', { className: 'flex min-w-0 flex-col gap-1.5', children: [
    jsxs('div', { className: 'flex flex-wrap items-center gap-1.5', children: [
      jsx('span', { className: S.chip + ' ' + S.chipOff, children: NOMBRE_TIPO[n.tipo] || n.tipo }),
      esUnidad ? jsx('span', {
        className: S.chip + ' ' + S.chipOff,
        style: { borderLeft: '3px solid ' + (COLORES_MODALIDAD[n.modalidad] || '#64748b') },
        children: (n.modalidad || 'otra') + (n.modalidad_regla ? ' · ' + n.modalidad_regla : ''),
      }) : null,
      esUnidad ? jsx('span', { className: S.chip + ' ' + S.chipOff, children: 'candidata' }) : null,
    ] }),
    jsx('div', { className: 'font-medium', children: n.label }),
    n.tipo === 'instrumento' ? jsx('div', { className: S.sub, children:
      (n.n_articulos || conteos.get(n.id) || 0) + ' artículos' }) : null,
    n.tipo === 'articulo' ? jsx('div', { className: S.sub, children:
      (n.n_unidades || 0) + ' unidades' +
      (fuente === 'corpus' ? ' · clic para expandir/plegar' : '') }) : null,
    n.tipo === 'resolucion' ? jsx('div', { className: S.sub, children:
      (n.organismo ? n.organismo + ' · ' : '') + 'N° ' + n.numero + '/' + n.anio +
      ' · ' + (n.menciones || 0) + ' menciones' +
      (n.rca ? ' · RCA' : '') }) : null,
    n.tipo === 'resolucion' ? jsx('div', { className: S.sub, children:
      'sin texto local: inferida de menciones en sentencias' }) : null,
    esUnidad && n.articulo ? jsx('div', { className: S.sub, children:
      'Unidad ' + (n.etiqueta || '') + (n.clase === 'judicial' ? ' de la sentencia' : ' del artículo') }) : null,
    jsx('div', { className: 'break-all font-mono text-[0.6875rem] text-(--ui-text-tertiary)', children: n.id }),
    esUnidad ? jsx(UnidadDetalle, { nodo: n, fuente }) : jsx(NodoDetalle, { nodo: n, fuente }),
  ] })
}

// ---------------------------------------------------------------------------
// Lista de texto del corpus (fallback sin WebGL y vista tabular de siempre)
// ---------------------------------------------------------------------------

function NormaDetalle({ data, error }) {
  if (error) return jsx('div', { className: 'text-xs text-(--ui-danger)', children: mensajeError(error) })
  if (!data) return jsx('div', { className: S.sub, children: 'Cargando artículos…' })
  const arts = data.articulos || []
  return jsxs('div', { className: 'flex flex-col gap-1 pl-4', children: [
    jsx('div', { className: S.sub, children:
      (data.articulos_total || arts.length) + ' artículos' +
      (data.articulos_truncados ? ' (mostrando ' + arts.length + ')' : '') }),
    ...arts.map((a, i) => jsxs('details', { key: i, className: 'text-xs', children: [
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

function ListaCorpus() {
  const [corpus, setCorpus] = useState(null)
  const [error, setError] = useState(null)
  useEffect(() => {
    rest('/grafo/corpus').then(setCorpus).catch(setError)
  }, [])
  if (error) return jsx('div', { className: 'text-xs text-(--ui-danger)', children: mensajeError(error) })
  const pack = corpus && corpus.packs && corpus.packs[0]
  if (!pack) return jsx('div', { className: S.sub, children: 'Leyendo el corpus…' })
  return jsx('div', { className: 'flex flex-col', children:
    (pack.normas || []).map((n) => jsx(NormaRow, { key: n.leychileCode, norma: n })) })
}

// ---------------------------------------------------------------------------

export function SeccionGrafo() {
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
  const [rotar, setRotar] = useState(false)
  // Última fuente elegida por perfil (ctx.storage del SDK).
  const setFuente = useCallback((f) => {
    setFuenteState(f)
    try { storage && storage.set('grafo.fuente', f) } catch (e) { /* opcional */ }
  }, [])
  const [query, setQuery] = useState('')
  const [fallo3d, setFallo3d] = useState(null)
  const [listaAbierta, setListaAbierta] = useState(false)
  const apiRef = useRef(null)

  const cargar = useCallback(() => {
    setRedErr(null)
    setPersonalErr(null)
    setRed(null)
    rest('/grafo/red?fuente=' + fuente, { timeoutMs: 120000 }).then(setRed).catch(setRedErr)
    rest('/grafo/personal').then(setPersonal).catch(setPersonalErr)
  }, [fuente])
  useEffect(cargar, [cargar])
  useEffect(() => {
    rest('/grafo/fuentes').then((fs) => {
      setFuentes(fs)
      const amb = fs && fs.find((f) => f.id === 'ambiental' && f.disponible)
      let elegida = null
      try { elegida = storage && storage.get('grafo.fuente') } catch (e) { elegida = null }
      if (elegida === 'ambiental' && amb) setFuenteState('ambiental')
      else if (elegida === 'corpus') setFuenteState('corpus')
      else if (amb) setFuenteState('ambiental')
    }).catch(() => {})
  }, [])

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

  // Resalte del foco: camino demo > selección > hover. El nodo elegido, sus
  // vecinos y las aristas entre ellos quedan a color pleno; el resto atenúa.
  const resalte = useMemo(() => {
    if (caminoOn && red && (red.camino_demo || []).length) {
      return { ids: new Set(red.camino_demo),
               links: new Set(red.camino_demo_links || []) }
    }
    const foco = seleccion || hover
    if (!foco) return null
    const ids = new Set([foco])
    const links = new Set()
    for (const l of proyeccion.links) {
      const s = idDe(l.source)
      const t = idDe(l.target)
      if (s === foco) { ids.add(t); links.add(s + '|' + t + '|' + l.tipo) }
      if (t === foco) { ids.add(s); links.add(s + '|' + t + '|' + l.tipo) }
    }
    return { ids, links }
  }, [caminoOn, red, seleccion, hover, proyeccion])

  // Órbita lenta para el video; se apaga con cualquier interacción.
  useEffect(() => {
    if (!rotar) return undefined
    const id = setInterval(() => {
      if (apiRef.current && apiRef.current.orbita) apiRef.current.orbita()
    }, 40)
    return () => clearInterval(id)
  }, [rotar])

  const alBuscar = useCallback((id) => {
    const n = indice.get(id)
    if (!n) return
    setSeleccion(id)
    // enfocar reintenta hasta que el nodo tenga posición (reintento acotado).
    if (apiRef.current) apiRef.current.enfocar(id)
  }, [indice])

  const q = query.trim().toLocaleLowerCase()
  const coincidencias = q
    ? nodos.filter((n) =>
        n.label.toLocaleLowerCase().includes(q) || n.id.toLocaleLowerCase().includes(q))
      .slice(0, 40)
    : []
  const actual = seleccion ? indice.get(seleccion) : null
  const candidatos = (personal && personal.candidates) || []
  const aristasP = (personal && personal.edges) || []
  const totales = (red && red.conteos) || {}

  return jsxs('div', { className: 'flex flex-col gap-3', children: [
    jsxs('div', { className: S.card, children: [
      jsxs('div', { className: 'flex flex-wrap items-center justify-between gap-2', children: [
        jsx('div', { className: S.cardTitle, children: 'Red del corpus (3D)' }),
        jsxs('select', {
          className: S.input,
          title: 'Fuente del grafo',
          value: fuente,
          onChange: (e) => { setFuente(e.target.value); setExpandidos(new Set()); setAristaSel(null); setSeleccion(null) },
          children: [
            jsx('option', { value: 'corpus', children: 'Corpus Diké (25 leyes)' }),
            jsx('option', {
              value: 'ambiental',
              disabled: !(fuentes && fuentes.find((f) => f.id === 'ambiental' && f.disponible)),
              title: 'solo en este equipo — no publicada',
              children: 'Ambiental local (solo en este equipo)',
            }),
          ] }),
        fuente === 'ambiental' ? jsx('span', { className: S.chip + ' ' + S.chipOff,
          children: 'local — no publicado · sentencias anonimizadas · '
            + 'relaciones candidatas, sin validar' }) : null,
        red ? jsx('div', { className: S.sub, children:
          (red.pack_hash ? 'pack ' + red.pack_hash + ' · ' : '') +
          (totales.nodes || 0) + ' nodos · ' + (totales.links || 0) + ' aristas' +
          (red.truncado ? ' · truncado' : '') }) : null,
      ] }),
      redErr
        ? jsxs('div', { className: 'flex flex-col items-start gap-1.5', children: [
            jsx('div', { className: 'text-xs text-(--ui-danger)', children: mensajeError(redErr) }),
            jsx('button', { type: 'button', className: S.ghost, onClick: cargar,
              children: 'Reintentar' }),
          ] })
        : !red
          ? jsx('div', { className: S.sub, children:
              'Cargando la red del corpus: la primera carga puede tardar hasta un minuto mientras se verifica el corpus…' })
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
                    'ocultar artículos',
                  ] }),
                  jsx('span', { className: S.sub, children: '|' }),
                  jsx('span', { className: S.sub, children: 'modalidad deóntica (candidata, sin validar):' }),
                  Object.keys(COLORES_MODALIDAD).map((mod) => jsxs('span', {
                    key: mod, className: 'flex items-center gap-1 ' + S.sub, children: [
                      jsx('span', { className: 'inline-block h-2 w-2 rounded-full',
                        style: { background: COLORES_MODALIDAD[mod] } }),
                      mod,
                    ] })),
                  jsx('button', { type: 'button', className: S.link,
                    onClick: () => { if (apiRef.current) apiRef.current.zoomFit() },
                    children: 'encajar' }),
                  fuente === 'ambiental' && red && (red.camino_demo || []).length
                    ? jsx('button', {
                        type: 'button',
                        className: caminoOn ? S.chip + ' ' + S.chipOk : S.link,
                        onClick: () => {
                          const on = !caminoOn
                          setCaminoOn(on)
                          setRotar(false)
                          if (on && apiRef.current) {
                            apiRef.current.encuadrar(red.camino_demo)
                          }
                        },
                        children: 'camino destacado',
                      })
                    : null,
                  fuente === 'ambiental' ? jsxs('label', {
                    className: 'flex items-center gap-1.5 ' + S.sub, children: [
                      jsx('input', { type: 'checkbox', checked: rotar,
                        onChange: (e) => setRotar(e.target.checked) }),
                      'rotar',
                    ] }) : null,
                  jsx('span', { className: S.sub + ' ml-auto', children:
                    proyeccion.nodes.length + ' visibles · ' + proyeccion.links.length + ' aristas' }),
                ] }),
                fallo3d
                  ? jsxs('div', { className: S.card, children: [
                      jsx('div', { className: 'text-xs text-(--ui-danger)', children: fallo3d }),
                      jsx('div', { className: S.sub, children:
                        'El grafo 3D necesita WebGL. La lista de texto de abajo tiene el mismo corpus.' }),
                    ] })
                  : jsx(LienzoGrafo, {
                      proyeccion, padres, conteos, alClickNodo, alClickArista,
                      alHover, alFondo, resalte, onFallo: alFallo3d, apiRef }),
              ] }),
              jsxs('div', { className: 'flex min-w-0 flex-col gap-2', children: [
                jsx('input', {
                  className: S.input + ' w-full',
                  placeholder: 'Buscar ley, código o artículo…',
                  value: query,
                  onChange: (e) => setQuery(e.target.value),
                }),
                q ? jsxs('div', { className: 'max-h-44 overflow-y-auto rounded-md border border-(--ui-stroke-secondary)', children: [
                  coincidencias.map((n) => jsxs('button', {
                    key: n.id, type: 'button',
                    className: 'block w-full px-2 py-1 text-left text-xs hover:bg-(--ui-bg-quaternary) truncate',
                    onClick: () => alBuscar(n.id),
                    children: [
                      jsx('span', { style: { color: COLORES_NODO[n.tipo] }, children: '● ' }),
                      n.label,
                    ] })),
                  coincidencias.length === 0
                    ? jsx('div', { className: S.sub + ' p-2', children: 'Sin coincidencias.' }) : null,
                ] }) : null,
                jsx('div', { className: 'rounded-md border border-(--ui-stroke-secondary) p-2', children:
                  jsx(TarjetaNodo, { nodo: actual, conteos, fuente }) }),
                aristaSel ? jsx('div', { className: 'rounded-md border border-(--ui-stroke-secondary) p-2', children:
                  jsx(TarjetaArista, { arista: aristaSel, fuente }) }) : null,
                caminoOn && red && (red.camino_demo || []).length ? jsxs('div', {
                  className: 'rounded-md border border-(--ui-stroke-secondary) p-2 flex flex-col gap-1',
                  children: [
                    jsx('div', { className: S.cardTitle, children: 'Camino destacado' }),
                    ...red.camino_demo.map((id, i) => {
                      const n = indice.get(id)
                      const paso = i > 0
                        ? ' ' + ((red.camino_demo_links[i - 1] || '').split('|')[2] || '→') + ' '
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
          children: 'Lista del corpus (texto)' }),
        listaAbierta ? jsx('div', { className: 'mt-2', children: jsx(ListaCorpus, {}) }) : null,
      ] }) : null,
    fuente === 'corpus' ? jsxs('div', { className: S.card, children: [
      jsx('div', { className: S.cardTitle, children: 'Grafo personal (GRE)' }),
      personalErr
        ? jsx('div', { className: 'text-xs text-(--ui-danger)', children: mensajeError(personalErr) })
        : !personal
          ? jsx('div', { className: S.sub, children: 'Consultando…' })
          : jsxs('div', { className: 'flex flex-col gap-1', children: [
              jsx('div', { className: S.sub, children: candidatos.length + ' candidatos · ' + aristasP.length + ' aristas' }),
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
    ] }) : null,
  ] })
}
