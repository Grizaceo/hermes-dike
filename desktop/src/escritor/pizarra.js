// Pizarra Estratégica del Case Writer: lienzo superior colapsable y
// redimensionable para planificar el escrito con notas adhesivas, plantillas
// procesales, tarjetas de normas desde el corpus (LexO Search) y conexiones
// dirigidas entre bloques. Se persiste por caso en registro.pizarra.

import { jsx, jsxs } from 'react/jsx-runtime'
import { useCallback, useEffect, useRef, useState } from 'react'
import { mensajeError, rest, S } from '../common.js'
import {
  COLORES_NOTA, PLANTILLAS_PIZARRA, construirNodosPlantilla, crearIdNota as crearId,
} from './pizarra-logica.js'

export { COLORES_NOTA, PLANTILLAS_PIZARRA, construirNodosPlantilla }

// /grafo/buscar emite vigencia como {estado, motivo}; otros endpoints la
// emiten como string. Normalizar al estado legible antes de pintar.
const _vig = (v) => (v && typeof v === 'object' ? v.estado : v) || null

// La vista de la pizarra (zoom/pan) se persiste dentro de registro.pizarra.
const zoomDeEstado = (e) => {
  const z = Number(e && e.zoom)
  return Number.isFinite(z) && z >= 0.4 && z <= 2.5 ? z : 1
}
const panDeEstado = (e) => {
  const p = e && e.pan
  return p && Number.isFinite(p.x) && Number.isFinite(p.y)
    ? { x: Math.round(p.x), y: Math.round(p.y) }
    : { x: 0, y: 0 }
}

function BuscadorCorpusPizarra({ onAgregarNota, onLlevarAlEscrito, onCerrar }) {
  const [q, setQ] = useState('')
  const [resultados, setResultados] = useState([])
  const [arbol, setArbol] = useState(null)
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState(null)
  const timerRef = useRef(null)
  const seqRef = useRef(0)

  const ejecutar = useCallback((consulta) => {
    const limpio = (consulta || '').trim()
    if (!limpio) {
      seqRef.current += 1
      setResultados([])
      setArbol(null)
      return
    }
    const id = ++seqRef.current
    setOcupado(true)
    setError(null)
    rest('/grafo/buscar', {
      method: 'POST',
      body: { q: limpio, limite: 12 },
      timeoutMs: 120000,
    }).then((d) => {
      if (id !== seqRef.current) return
      setResultados((d && d.resultados) || [])
      setArbol((d && d.arbol) || null)
    }).catch((e) => {
      if (id !== seqRef.current) return
      setError(e)
      setResultados([])
    }).finally(() => {
      if (id === seqRef.current) setOcupado(false)
    })
  }, [])

  const cambiar = (ev) => {
    const v = ev.target.value
    setQ(v)
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => ejecutar(v), 350)
  }

  useEffect(() => () => clearTimeout(timerRef.current), [])

  return jsxs('div', {
    className: 'absolute top-2 right-3 z-30 flex w-96 flex-col rounded-lg border border-slate-700 bg-slate-900 text-slate-100 shadow-2xl',
    style: { maxHeight: '260px' },
    children: [
      jsxs('div', { className: 'flex items-center gap-2 border-b border-slate-700 px-3 py-2', children: [
        jsx('span', { className: 'text-xs font-semibold text-sky-400', children: 'LexO Search · Corpus Diké' }),
        jsx('input', {
          className: 'flex-1 bg-transparent text-xs text-slate-100 outline-none placeholder-slate-400',
          placeholder: 'Buscar en las 25 leyes (ej. despido necesidades empresa)…',
          value: q,
          autoFocus: true,
          onChange: cambiar,
          onKeyDown: (e) => { if (e.key === 'Enter') ejecutar(q) },
        }),
        jsx('button', {
          type: 'button',
          className: 'text-xs text-slate-400 hover:text-white px-1',
          onClick: onCerrar,
          title: 'Cerrar buscador',
          children: '✕',
        }),
      ] }),
      arbol && arbol.disponible && (arbol.clasificacion || []).length
        ? jsxs('div', { className: 'flex flex-wrap gap-1 border-b border-slate-800 px-3 py-1 text-[10px] text-slate-300', children: [
            jsx('span', { className: 'text-slate-400', children: 'Materias:' }),
            ...(arbol.clasificacion || []).slice(0, 3).map((m, i) => jsx('span', {
              key: i,
              className: 'rounded bg-slate-800 px-1.5 py-0.5 text-sky-300',
              children: m.nombre || m.nodo,
            })),
          ] })
        : null,
      jsxs('div', { className: 'flex-1 overflow-y-auto px-2.5 py-1.5 flex flex-col gap-1.5', children: [
        ocupado ? jsx('div', { className: 'py-4 text-center text-xs text-slate-400', children: 'Buscando en el corpus sellado (BM25)…' }) : null,
        error ? jsx('div', { className: 'rounded bg-red-950/60 p-2 text-xs text-red-300', children: mensajeError(error) }) : null,
        !ocupado && !error && resultados.length === 0 && q.trim()
          ? jsx('div', { className: 'py-4 text-center text-xs text-slate-400', children: 'Sin resultados para «' + q.trim() + '».' })
          : null,
        !ocupado && !q.trim()
          ? jsx('div', { className: 'py-3 text-center text-[11px] text-slate-400', children: 'Escribe términos jurídicos para traer normas a la pizarra o al escrito.' })
          : null,
        ...resultados.map((r, i) => jsxs('div', {
          key: (r.nodo_id || i),
          className: 'flex items-start justify-between gap-2 rounded border border-slate-800 bg-slate-800/60 p-2 hover:border-slate-600',
          children: [
            jsxs('div', { className: 'min-w-0 flex-1', children: [
              jsxs('div', { className: 'flex items-center gap-1.5', children: [
                jsx('span', { className: 'truncate text-xs font-semibold text-sky-300', children: r.cita || r.label || r.gid }),
                _vig(r.vigencia) ? jsx('span', {
                  className: 'rounded px-1 py-0.5 text-[9px] uppercase ' +
                    (_vig(r.vigencia) === 'IN_FORCE' ? 'bg-emerald-900/70 text-emerald-300' : 'bg-amber-900/70 text-amber-300'),
                  children: _vig(r.vigencia) === 'IN_FORCE' ? 'vigente' : _vig(r.vigencia),
                }) : null,
              ] }),
              r.snippet ? jsx('div', {
                className: 'mt-0.5 line-clamp-2 text-[11px] text-slate-300',
                children: String(r.snippet).slice(0, 180),
              }) : null,
            ] }),
            jsxs('div', { className: 'flex flex-col gap-1 shrink-0', children: [
              jsx('button', {
                type: 'button',
                className: 'rounded bg-sky-600 hover:bg-sky-500 px-2 py-0.5 text-[10px] font-medium text-white',
                title: 'Crear tarjeta de norma en la pizarra',
                onClick: () => onAgregarNota({
                  titulo: r.cita || r.label || r.gid || 'Norma',
                  tag: 'NORMA',
                  color: '#bfdbfe',
                  texto: (r.cita ? r.cita + '.\n' : '') + (r.snippet ? String(r.snippet).slice(0, 260) : ''),
                  nodo_id: r.nodo_id,
                  gid: r.gid,
                }),
                children: '+ Pizarra',
              }),
              r.citable !== false && r.cita && onLlevarAlEscrito
                ? jsx('button', {
                    type: 'button',
                    className: 'rounded border border-slate-600 hover:bg-slate-700 px-2 py-0.5 text-[10px] text-slate-200',
                    title: 'Insertar cita canónica en el escrito y verificar',
                    onClick: () => onLlevarAlEscrito(r),
                    children: '+ Escrito',
                  })
                : null,
            ] }),
          ],
        })),
      ] }),
    ],
  })
}

export function PizarraEstrategica({
  pizarra,
  onChange,
  onInsertarTexto,
  onLlevarCitaAlEscrito,
  onAbrirGrafo,
}) {
  const estado = pizarra || {}
  const nodos = Array.isArray(estado.nodos) ? estado.nodos : []
  const aristas = Array.isArray(estado.aristas) ? estado.aristas : []
  const colapsada = Boolean(estado.colapsada)
  const altura = Number(estado.altura) || 235

  const [menuPlantillas, setMenuPlantillas] = useState(false)
  const [buscadorAbierto, setBuscadorAbierto] = useState(false)
  const [conectandoDesde, setConectandoDesde] = useState(null)
  const [zoom, setZoom] = useState(() => zoomDeEstado(estado))
  const [pan, setPan] = useState(() => panDeEstado(estado))
  const dragRef = useRef(null)
  const resizeBarRef = useRef(null)
  const canvasRef = useRef(null)

  const actualizar = useCallback((parche) => {
    if (onChange) onChange({ ...estado, nodos, aristas, colapsada, altura, ...parche })
  }, [estado, nodos, aristas, colapsada, altura, onChange])

  // Resincronizar la vista cuando llega el registro persistido del caso
  // (carga inicial asíncrona o cambio de caso sin remontar).
  useEffect(() => {
    setZoom(zoomDeEstado(estado))
    setPan(panDeEstado(estado))
  }, [estado.zoom, estado.pan])

  // Arrastre de notas y redimensionado de la pizarra
  useEffect(() => {
    const onMove = (ev) => {
      if (dragRef.current) {
        const d = dragRef.current
        const dx = (ev.clientX - d.startX) / zoom
        const dy = (ev.clientY - d.startY) / zoom
        if (d.modo === 'mover') {
          const nuevos = d.nodosBase.map((n) => n.id === d.id
            ? { ...n, x: Math.max(4, Math.round(d.origX + dx)), y: Math.max(4, Math.round(d.origY + dy)) }
            : n)
          actualizar({ nodos: nuevos })
        } else if (d.modo === 'tamano') {
          const nuevos = d.nodosBase.map((n) => n.id === d.id
            ? { ...n, w: Math.max(160, Math.round(d.origW + dx)), h: Math.max(95, Math.round(d.origH + dy)) }
            : n)
          actualizar({ nodos: nuevos })
        } else if (d.modo === 'pan') {
          const next = {
            x: Math.round(d.panX + (ev.clientX - d.startX)),
            y: Math.round(d.panY + (ev.clientY - d.startY)),
          }
          d.lastPan = next
          setPan(next)
        }
      }
      if (resizeBarRef.current) {
        const r = resizeBarRef.current
        const nuevaAltura = Math.max(130, Math.min(520, r.origAltura + (ev.clientY - r.startY)))
        actualizar({ altura: nuevaAltura })
      }
    }
    const onUp = () => {
      const d = dragRef.current
      dragRef.current = null
      resizeBarRef.current = null
      if (d && d.modo === 'pan' && d.lastPan) {
        actualizar({ pan: d.lastPan })
      }
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [zoom, actualizar])

  const agregarNota = useCallback((datos = {}) => {
    const idx = nodos.length
    const col = idx % 4
    const fila = Math.floor(idx / 4)
    const colorDefault = COLORES_NOTA[idx % COLORES_NOTA.length].hex
    const nueva = {
      id: crearId('nota'),
      x: datos.x != null ? datos.x : 24 + col * 248,
      y: datos.y != null ? datos.y : 20 + fila * 175,
      w: datos.w || 232,
      h: datos.h || 155,
      titulo: datos.titulo || 'Nota ' + (idx + 1),
      tag: datos.tag || 'NOTA',
      color: datos.color || colorDefault,
      texto: datos.texto || '',
      nodo_id: datos.nodo_id || null,
      gid: datos.gid || null,
      minimizada: false,
    }
    actualizar({ nodos: [...nodos, nueva], colapsada: false })
  }, [nodos, actualizar])

  const aplicarPlantilla = useCallback((pl) => {
    const { nodos: ns, aristas: as } = construirNodosPlantilla(pl)
    setPan({ x: 0, y: 0 })
    setZoom(1)
    actualizar({ nodos: ns, aristas: as, colapsada: false, zoom: 1, pan: { x: 0, y: 0 } })
    setMenuPlantillas(false)
  }, [actualizar])

  const editarNodo = useCallback((id, parche) => {
    actualizar({
      nodos: nodos.map((n) => (n.id === id ? { ...n, ...parche } : n)),
    })
  }, [nodos, actualizar])

  const eliminarNodo = useCallback((id) => {
    actualizar({
      nodos: nodos.filter((n) => n.id !== id),
      aristas: aristas.filter((e) => e.from !== id && e.to !== id),
    })
    if (conectandoDesde === id) setConectandoDesde(null)
  }, [nodos, aristas, conectandoDesde, actualizar])

  const clickConectar = useCallback((id) => {
    if (!conectandoDesde) {
      setConectandoDesde(id)
      return
    }
    if (conectandoDesde === id) {
      setConectandoDesde(null)
      return
    }
    const yaExiste = aristas.some((a) => a.from === conectandoDesde && a.to === id)
    if (!yaExiste) {
      actualizar({
        aristas: [...aristas, { id: crearId('arista'), from: conectandoDesde, to: id, label: 'apoya' }],
      })
    }
    setConectandoDesde(null)
  }, [conectandoDesde, aristas, actualizar])

  const volcarAlEscrito = useCallback(() => {
    if (!onInsertarTexto || !nodos.length) return
    const ordenados = [...nodos].sort((a, b) => (a.y - b.y) || (a.x - b.x))
    const bloques = ordenados
      .map((n) => {
        const tit = (n.titulo || '').trim()
        const txt = (n.texto || '').trim()
        if (!txt && !tit) return ''
        return (tit ? tit.toUpperCase() + ':\n' : '') + txt
      })
      .filter(Boolean)
    if (bloques.length) onInsertarTexto(bloques.join('\n\n'))
  }, [nodos, onInsertarTexto])

  const mapaNodos = new Map(nodos.map((n) => [n.id, n]))

  return jsxs('div', {
    className: 'flex flex-col border-b border-slate-300 bg-white select-none shrink-0',
    children: [
      // Barra superior de la Pizarra Estratégica (estilo imagen 2)
      jsxs('div', {
        className: 'flex flex-wrap items-center gap-1.5 border-b border-slate-200 bg-slate-50 px-3 py-1 text-xs',
        children: [
          jsx('button', {
            type: 'button',
            onClick: () => actualizar({ colapsada: !colapsada }),
            className: 'flex items-center gap-1 rounded px-2 py-1 font-medium text-slate-700 hover:bg-slate-200/70 transition-colors cursor-pointer',
            children: [
              jsx('span', { children: colapsada ? '▾' : '▴' }),
              jsx('span', { children: 'Pizarra Estratégica' }),
              nodos.length > 0
                ? jsx('span', {
                    className: 'ml-1 rounded-full bg-slate-200 px-1.5 py-0.2 text-[10px] text-slate-600',
                    children: String(nodos.length),
                  })
                : null,
            ],
          }),

          jsx('button', {
            type: 'button',
            onClick: () => agregarNota({}),
            className: 'flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-0.5 text-xs text-slate-700 hover:bg-slate-100 cursor-pointer shadow-2xs',
            title: 'Agregar nota adhesiva a la pizarra',
            children: ['+ Nota'],
          }),

          // Selector de Plantillas
          jsxs('div', { className: 'relative', children: [
            jsx('button', {
              type: 'button',
              onClick: () => setMenuPlantillas((v) => !v),
              className: 'flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-0.5 text-xs text-slate-700 hover:bg-slate-100 cursor-pointer shadow-2xs',
              title: 'Cargar estructura de escrito en la pizarra',
              children: ['⊞ Plantillas ▾'],
            }),
            menuPlantillas ? jsxs('div', {
              className: 'absolute left-0 top-full z-40 mt-1 w-72 rounded-md border border-slate-200 bg-white py-1 shadow-xl',
              children: [
                jsx('div', { className: 'px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400', children: 'Estructuras jurídicas' }),
                ...PLANTILLAS_PIZARRA.map((pl) => jsxs('button', {
                  key: pl.id,
                  type: 'button',
                  onClick: () => aplicarPlantilla(pl),
                  className: 'flex w-full flex-col px-3 py-1.5 text-left hover:bg-slate-100',
                  children: [
                    jsx('span', { className: 'text-xs font-semibold text-slate-800', children: pl.label }),
                    jsx('span', { className: 'text-[10px] text-slate-500', children: pl.descripcion }),
                  ],
                })),
              ],
            }) : null,
          ] }),

          // Botón LexO Search (conectado al corpus sellado BM25)
          jsx('button', {
            type: 'button',
            onClick: () => {
              if (colapsada) actualizar({ colapsada: false })
              setBuscadorAbierto((v) => !v)
            },
            className: 'flex items-center gap-1 rounded border px-2 py-0.5 text-xs cursor-pointer transition-colors ' +
              (buscadorAbierto
                ? 'border-sky-500 bg-sky-50 text-sky-700 font-medium'
                : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100'),
            title: 'Buscar normas en el corpus de Diké y agregarlas como tarjetas',
            children: ['🔍 LexO Search'],
          }),

          nodos.length > 0 ? jsx('button', {
            type: 'button',
            onClick: volcarAlEscrito,
            className: 'flex items-center gap-1 rounded border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-xs text-emerald-800 hover:bg-emerald-100 cursor-pointer',
            title: 'Insertar el contenido ordenado de las notas en el escrito',
            children: ['↳ Llevar notas al escrito'],
          }) : null,

          conectandoDesde ? jsx('span', {
            className: 'rounded bg-indigo-100 px-2 py-0.5 text-[11px] font-medium text-indigo-700',
            children: 'Haz clic en otra nota para conectarlas (o en la misma para cancelar)',
          }) : null,

          // Botón limpiar a la derecha (como el icono de papelera en imagen 2)
          jsxs('div', { className: 'ml-auto flex items-center gap-1', children: [
            nodos.length > 0 ? jsx('button', {
              type: 'button',
              onClick: () => actualizar({ nodos: [], aristas: [] }),
              className: 'rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 cursor-pointer',
              title: 'Limpiar pizarra',
              children: '🗑',
            }) : null,
          ] }),
        ],
      }),

      // Lienzo interactivo con grilla punteada (solo cuando no está colapsada)
      !colapsada ? jsxs('div', {
        ref: canvasRef,
        onMouseDown: (ev) => {
          if (ev.target === canvasRef.current || ev.target.getAttribute('data-fondo') === '1') {
            setMenuPlantillas(false)
            dragRef.current = {
              modo: 'pan',
              startX: ev.clientX,
              startY: ev.clientY,
              panX: pan.x,
              panY: pan.y,
            }
          }
        },
        className: 'relative w-full overflow-hidden',
        style: {
          height: altura + 'px',
          backgroundColor: '#fafafa',
          backgroundImage: 'radial-gradient(#cbd5e1 1px, transparent 1px)',
          backgroundSize: '16px 16px',
          cursor: 'grab',
        },
        children: [
          // Estado vacío con invitación rápida
          nodos.length === 0 ? jsxs('div', {
            'data-fondo': '1',
            className: 'pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1 text-center',
            children: [
              jsx('div', { className: 'text-xs font-medium text-slate-400', children: 'Pizarra Estratégica vacía — planifica los bloques de tu escrito antes de redactar' }),
              jsx('div', { className: 'text-[11px] text-slate-400', children: 'Usa «+ Nota», elige «Plantillas» (Demanda, Sentencia, Contrato) o abre «LexO Search» para traer artículos.' }),
            ],
          }) : null,

          // Capa transformada por pan/zoom
          jsxs('div', {
            'data-fondo': '1',
            style: {
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: '0 0',
              width: '100%',
              height: '100%',
              position: 'relative',
            },
            children: [
              // Aristas dirigidas SVG entre tarjetas
              jsx('svg', {
                className: 'pointer-events-none absolute inset-0 h-[1200px] w-[2400px] overflow-visible',
                children: [
                  jsx('defs', {
                    children: jsx('marker', {
                      id: 'dike-arrow',
                      viewBox: '0 0 10 10',
                      refX: '8',
                      refY: '5',
                      markerWidth: '6',
                      markerHeight: '6',
                      orient: 'auto-start-reverse',
                      children: jsx('path', { d: 'M 0 1 L 10 5 L 0 9 z', fill: '#6366f1' }),
                    }),
                  }),
                  ...aristas.map((ar) => {
                    const n1 = mapaNodos.get(ar.from)
                    const n2 = mapaNodos.get(ar.to)
                    if (!n1 || !n2) return null
                    const x1 = n1.x + (n1.w || 220)
                    const y1 = n1.y + (n1.minimizada ? 18 : (n1.h || 150) / 2)
                    const x2 = n2.x
                    const y2 = n2.y + (n2.minimizada ? 18 : (n2.h || 150) / 2)
                    const cx1 = x1 + Math.max(30, Math.abs(x2 - x1) * 0.4)
                    const cx2 = x2 - Math.max(30, Math.abs(x2 - x1) * 0.4)
                    const d = `M ${x1} ${y1} C ${cx1} ${y1}, ${cx2} ${y2}, ${x2} ${y2}`
                    const mx = (x1 + x2) / 2
                    const my = (y1 + y2) / 2 - 6
                    return jsxs('g', { key: ar.id, children: [
                      jsx('path', {
                        d,
                        fill: 'none',
                        stroke: '#6366f1',
                        strokeWidth: '2',
                        strokeDasharray: '4 2',
                        markerEnd: 'url(#dike-arrow)',
                      }),
                      ar.label ? jsx('text', {
                        x: mx,
                        y: my,
                        textAnchor: 'middle',
                        fill: '#4f46e5',
                        fontSize: '10',
                        fontWeight: '600',
                        children: ar.label,
                      }) : null,
                    ] })
                  }),
                ],
              }),

              // Notas / Tarjetas en el lienzo
              ...nodos.map((n) => {
                const esOrigen = conectandoDesde === n.id
                return jsxs('div', {
                  key: n.id,
                  style: {
                    position: 'absolute',
                    left: n.x + 'px',
                    top: n.y + 'px',
                    width: (n.w || 230) + 'px',
                    height: n.minimizada ? 'auto' : (n.h || 155) + 'px',
                    backgroundColor: n.color || '#fef08a',
                    boxShadow: esOrigen
                      ? '0 0 0 2px #4f46e5, 0 4px 12px rgba(0,0,0,0.12)'
                      : '0 2px 6px rgba(0,0,0,0.10)',
                  },
                  className: 'flex flex-col rounded-md border border-slate-300/90 text-slate-800 transition-shadow',
                  children: [
                    // Cabecera arrastrable de la tarjeta
                    jsxs('div', {
                      onMouseDown: (ev) => {
                        if (ev.target.tagName === 'BUTTON' || ev.target.tagName === 'INPUT') return
                        ev.stopPropagation()
                        dragRef.current = {
                          modo: 'mover',
                          id: n.id,
                          startX: ev.clientX,
                          startY: ev.clientY,
                          origX: n.x,
                          origY: n.y,
                          nodosBase: nodos,
                        }
                      },
                      className: 'flex items-center gap-1 border-b border-black/10 px-2 py-1 cursor-move',
                      children: [
                        jsx('span', {
                          className: 'rounded bg-black/10 px-1 py-0.2 text-[9px] font-bold uppercase tracking-wider text-slate-700',
                          children: n.tag || 'NOTA',
                        }),
                        jsx('input', {
                          value: n.titulo || '',
                          onChange: (ev) => editarNodo(n.id, { titulo: ev.target.value }),
                          className: 'min-w-0 flex-1 bg-transparent text-xs font-semibold text-slate-800 outline-none',
                          placeholder: 'Título…',
                        }),
                        // Cambiar color
                        jsx('button', {
                          type: 'button',
                          title: 'Cambiar color de la nota',
                          onClick: () => {
                            const idx = COLORES_NOTA.findIndex((c) => c.hex === n.color)
                            const sig = COLORES_NOTA[(idx + 1) % COLORES_NOTA.length]
                            editarNodo(n.id, { color: sig.hex })
                          },
                          className: 'rounded px-1 text-[10px] text-slate-600 hover:bg-black/10',
                          children: '🎨',
                        }),
                        // Conectar con otra tarjeta
                        jsx('button', {
                          type: 'button',
                          title: esOrigen ? 'Cancelar conexión' : 'Conectar con otra tarjeta',
                          onClick: () => clickConectar(n.id),
                          className: 'rounded px-1 text-[10px] ' +
                            (esOrigen ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-black/10'),
                          children: '🔗',
                        }),
                        // Insertar esta tarjeta en el escrito
                        onInsertarTexto ? jsx('button', {
                          type: 'button',
                          title: 'Insertar texto de esta nota en el escrito',
                          onClick: () => {
                            const txt = (n.texto || n.titulo || '').trim()
                            if (txt) onInsertarTexto(txt)
                          },
                          className: 'rounded px-1 text-[10px] font-bold text-emerald-800 hover:bg-black/10',
                          children: '↳',
                        }) : null,
                        // Abrir en el grafo si es tarjeta de norma con nodo_id
                        n.nodo_id && onAbrirGrafo ? jsx('button', {
                          type: 'button',
                          title: 'Abrir artículo en el grafo 3D',
                          onClick: () => onAbrirGrafo({ nodo_id: n.nodo_id }),
                          className: 'rounded px-1 text-[10px] text-sky-800 hover:bg-black/10',
                          children: '◈',
                        }) : null,
                        // Minimizar
                        jsx('button', {
                          type: 'button',
                          title: n.minimizada ? 'Expandir nota' : 'Minimizar nota',
                          onClick: () => editarNodo(n.id, { minimizada: !n.minimizada }),
                          className: 'rounded px-1 text-[10px] text-slate-600 hover:bg-black/10',
                          children: n.minimizada ? '▢' : '–',
                        }),
                        // Cerrar/Eliminar
                        jsx('button', {
                          type: 'button',
                          title: 'Eliminar nota',
                          onClick: () => eliminarNodo(n.id),
                          className: 'rounded px-1 text-[10px] text-slate-600 hover:bg-red-200 hover:text-red-700',
                          children: '✕',
                        }),
                      ],
                    }),

                    // Cuerpo de texto de la tarjeta
                    !n.minimizada ? jsx('textarea', {
                      value: n.texto || '',
                      onChange: (ev) => editarNodo(n.id, { texto: ev.target.value }),
                      placeholder: 'Escribe ideas, hechos o artículos para esta sección…',
                      className: 'flex-1 w-full resize-none bg-transparent p-2 text-xs leading-relaxed text-slate-800 outline-none',
                    }) : null,

                    // Esquina de redimensionado de tarjeta
                    !n.minimizada ? jsx('div', {
                      onMouseDown: (ev) => {
                        ev.stopPropagation()
                        dragRef.current = {
                          modo: 'tamano',
                          id: n.id,
                          startX: ev.clientX,
                          startY: ev.clientY,
                          origW: n.w || 230,
                          origH: n.h || 155,
                          nodosBase: nodos,
                        }
                      },
                      title: 'Arrastrar para cambiar tamaño',
                      className: 'absolute bottom-0 right-0 h-3.5 w-3.5 cursor-nwse-resize text-right pr-0.5 text-[9px] leading-none text-slate-500/70',
                      children: '◢',
                    }) : null,
                  ],
                })
              }),
            ],
          }),

          // Controles de zoom abajo a la izquierda (exactamente como en la imagen 2)
          jsxs('div', {
            className: 'absolute bottom-2 left-2 z-20 flex flex-col overflow-hidden rounded border border-slate-300 bg-white shadow-sm',
            children: [
              jsx('button', {
                type: 'button',
                title: 'Acercar',
                onClick: () => {
                  const z = Math.min(1.6, +(zoom + 0.15).toFixed(2))
                  setZoom(z)
                  actualizar({ zoom: z })
                },
                className: 'border-b border-slate-200 px-2 py-1 text-xs font-bold text-slate-700 hover:bg-slate-100',
                children: '+',
              }),
              jsx('button', {
                type: 'button',
                title: 'Alejar',
                onClick: () => {
                  const z = Math.max(0.55, +(zoom - 0.15).toFixed(2))
                  setZoom(z)
                  actualizar({ zoom: z })
                },
                className: 'border-b border-slate-200 px-2 py-1 text-xs font-bold text-slate-700 hover:bg-slate-100',
                children: '−',
              }),
              jsx('button', {
                type: 'button',
                title: 'Restablecer vista',
                onClick: () => {
                  setZoom(1)
                  setPan({ x: 0, y: 0 })
                  actualizar({ zoom: 1, pan: { x: 0, y: 0 } })
                },
                className: 'px-2 py-1 text-[10px] text-slate-700 hover:bg-slate-100',
                children: '⛶',
              }),
            ],
          }),

          // Panel flotante LexO Search
          buscadorAbierto ? jsx(BuscadorCorpusPizarra, {
            onAgregarNota: (item) => agregarNota(item),
            onLlevarAlEscrito: onLlevarCitaAlEscrito,
            onCerrar: () => setBuscadorAbierto(false),
          }) : null,
        ],
      }) : null,

      // Tirador inferior para redimensionar la altura de la pizarra (estilo imagen 2)
      !colapsada ? jsx('div', {
        onMouseDown: (ev) => {
          ev.preventDefault()
          resizeBarRef.current = { startY: ev.clientY, origAltura: altura }
        },
        title: 'Arrastra para ajustar la altura de la Pizarra Estratégica',
        className: 'flex h-2.5 w-full cursor-row-resize items-center justify-center border-t border-slate-200 bg-slate-100 hover:bg-slate-200',
        children: jsx('span', { className: 'text-[10px] tracking-widest text-slate-400', children: '⋮⋮⋮' }),
      }) : null,
    ],
  })
}
