// Vista 3D del grafo del corpus (3d-force-graph + three, empaquetados en el
// bundle). Muestra primero solo los 25 instrumentos; un clic en un
// instrumento (o el interruptor "mostrar artículos") expande sus artículos.
// La lista de texto queda como fallback cuando WebGL no está disponible.

import ForceGraph3D from '3d-force-graph'
import { jsx, jsxs } from 'react/jsx-runtime'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { mensajeError, rest, S } from './common.js'

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
}
const NOMBRE_TIPO = {
  instrumento: 'Instrumento',
  articulo: 'Artículo',
  sentencia: 'Sentencia',
  resolucion: 'Resolución',
}
const NOMBRE_ESTADO = {
  verificada_estructura: 'verificada (estructura)',
  candidata: 'candidata',
  aprobada: 'aprobada',
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
function LienzoGrafo({ proyeccion, padres, conteos, alClickNodo, onFallo, apiRef }) {
  const hostEl = useRef(null)
  const engine = useRef(null)
  const [listo, setListo] = useState(false)
  const clickRef = useRef(alClickNodo)
  clickRef.current = alClickNodo
  const conteosRef = useRef(conteos)
  conteosRef.current = conteos
  const padresRef = useRef(padres)
  padresRef.current = padres
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
      .nodeVal((n) => (n.tipo === 'instrumento' ? 6 : 0.5))
      .nodeResolution(10)
      .nodeOpacity(0.95)
      .nodeColor((n) => COLORES_NODO[n.tipo] || '#cbd5e1')
      .nodeLabel((n) => n.tipo === 'instrumento'
        ? n.label + ' · ' + (conteosRef.current.get(n.id) || 0) + ' artículos'
        : n.label)
      .linkColor(colorArista)
      .linkLabel((l) => l.tipo + ' · ' + (NOMBRE_ESTADO[l.estado] || l.estado))
      .linkOpacity(0.5)
      .linkWidth((l) => (l.tipo === 'contiene' ? 0.4 : 1.2))
      .linkDirectionalArrowLength(2.5)
      .linkDirectionalArrowRelPos(0.85)
      .onNodeClick((n) => clickRef.current(n))
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

  return jsxs('div', { className: 'relative min-w-0', children: [
    jsx('div', { ref: hostEl, className: 'h-[55vh] min-h-[360px] w-full rounded-md bg-[#0b1020]' }),
    !listo ? jsx('div', { className: S.sub + ' absolute left-3 top-3', children: 'Dibujando el grafo…' }) : null,
  ] })
}

function TarjetaNodo({ nodo, conteos }) {
  if (!nodo) {
    return jsx('div', { className: S.sub, children:
      'Haz clic en un nodo (o búscalo) para ver su ficha. Un clic en un instrumento expande sus artículos.' })
  }
  const n = nodo
  return jsxs('div', { className: 'flex min-w-0 flex-col gap-1.5', children: [
    jsx('span', { className: S.chip + ' ' + S.chipOff, children: NOMBRE_TIPO[n.tipo] || n.tipo }),
    jsx('div', { className: 'font-medium', children: n.label }),
    n.instrumento ? jsx('div', { className: S.sub, children: 'Pertenece a: ' + n.instrumento }) : null,
    n.tipo === 'instrumento' ? jsx('div', { className: S.sub, children:
      (conteos.get(n.id) || 0) + ' artículos · clic de nuevo para plegar' }) : null,
    jsx('div', { className: 'break-all font-mono text-[0.6875rem] text-(--ui-text-tertiary)', children: n.id }),
    n.url ? jsx('a', { className: S.link, href: n.url, target: '_blank', rel: 'noopener noreferrer',
      children: 'Fuente original ↗' }) : null,
    n.sha256 ? jsx('div', { className: 'break-all font-mono text-[0.6875rem] text-(--ui-text-tertiary)',
      children: 'sha256 ' + n.sha256 }) : null,
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
  const [mostrarArts, setMostrarArts] = useState(false)
  const [query, setQuery] = useState('')
  const [fallo3d, setFallo3d] = useState(null)
  const [listaAbierta, setListaAbierta] = useState(false)
  const apiRef = useRef(null)

  const cargar = useCallback(() => {
    setRedErr(null)
    setPersonalErr(null)
    rest('/grafo/red?fuente=corpus').then(setRed).catch(setRedErr)
    rest('/grafo/personal').then(setPersonal).catch(setPersonalErr)
  }, [])
  useEffect(cargar, [cargar])

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
    return m
  }, [aristas])
  const conteos = useMemo(() => {
    const m = new Map()
    for (const l of aristas) if (l.tipo === 'contiene') m.set(l.source, (m.get(l.source) || 0) + 1)
    return m
  }, [aristas])

  const proyeccion = useMemo(() => {
    const vis = nodos.filter((n) =>
      n.tipo !== 'articulo' || mostrarArts || expandidos.has(padres.get(n.id)))
    const ids = new Set(vis.map((n) => n.id))
    return {
      nodes: vis,
      links: aristas.filter((l) => ids.has(l.source) && ids.has(l.target)),
    }
  }, [nodos, aristas, mostrarArts, expandidos, padres])

  const alClickNodo = useCallback((n) => {
    setSeleccion(n.id)
    if (n.tipo === 'instrumento') {
      setExpandidos((prev) => {
        const next = new Set(prev)
        if (next.has(n.id)) next.delete(n.id)
        else next.add(n.id)
        return next
      })
    }
  }, [])

  const alBuscar = useCallback((id) => {
    const n = indice.get(id)
    if (!n) return
    setSeleccion(id)
    if (n.tipo === 'articulo') {
      const padre = padres.get(id)
      if (padre) setExpandidos((prev) => new Set(prev).add(padre))
    }
    // enfocar reintenta hasta que el nodo tenga posición (reintento acotado).
    if (apiRef.current) apiRef.current.enfocar(id)
  }, [indice, padres])

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
        red ? jsx('div', { className: S.sub, children:
          'pack ' + red.pack_hash + ' · ' + (totales.nodes || 0) + ' nodos · ' + (totales.links || 0) + ' aristas' +
          (red.truncado ? ' · truncado' : '') }) : null,
      ] }),
      redErr
        ? jsx('div', { className: 'text-xs text-(--ui-danger)', children: mensajeError(redErr) })
        : !red
          ? jsx('div', { className: S.sub, children:
              'Cargando la red del corpus (la primera lectura barre ~8.500 artículos)…' })
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
                    jsx('input', { type: 'checkbox', checked: mostrarArts,
                      onChange: (e) => setMostrarArts(e.target.checked) }),
                    'mostrar artículos (' + (totales.nodes || 0) + ' nodos)',
                  ] }),
                  jsx('button', { type: 'button', className: S.link,
                    onClick: () => { if (apiRef.current) apiRef.current.zoomFit() },
                    children: 'encajar' }),
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
                      proyeccion, padres, conteos, alClickNodo, onFallo: alFallo3d, apiRef }),
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
                  jsx(TarjetaNodo, { nodo: actual, conteos }) }),
              ] }),
            ] }),
    ] }),
    jsxs('details', {
      className: S.card, open: listaAbierta,
      onToggle: (e) => setListaAbierta(e.currentTarget.open),
      children: [
        jsx('summary', { className: 'cursor-pointer ' + S.cardTitle + ' normal-case',
          children: 'Lista del corpus (texto)' }),
        listaAbierta ? jsx('div', { className: 'mt-2', children: jsx(ListaCorpus, {}) }) : null,
      ] }),
    jsxs('div', { className: S.card, children: [
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
    ] }),
  ] })
}
