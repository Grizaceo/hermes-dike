// Pizarra Estratégica del Case Writer: lienzo superior colapsable y
// redimensionable para planificar el escrito con notas adhesivas, plantillas
// procesales, tarjetas de normas desde el corpus (LexO Search) y conexiones
// dirigidas entre bloques. Se persiste por caso en registro.pizarra.

import { jsx, jsxs } from 'react/jsx-runtime'
import { useCallback, useEffect, useRef, useState } from 'react'
import { S } from '../common.js'
import { t } from '../i18n.js'
import { BuscadorCorpus } from './buscador-corpus.js'
import {
  COLORES_NOTA, PLANTILLAS_PIZARRA, construirNodosPlantilla, crearIdNota as crearId,
} from './pizarra-logica.js'

export { COLORES_NOTA, PLANTILLAS_PIZARRA, construirNodosPlantilla }


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


// Overlay flotante del buscador del corpus: la lógica vive en
// BuscadorCorpus (compartida con Herramientas de Grafos); aquí solo el
// marco posicional y las acciones propias de la pizarra.
function BuscadorCorpusPizarra({ onAgregarNota, onLlevarAlEscrito, onCerrar }) {
  return jsx('div', {
    className: 'absolute top-2 right-3 z-30 flex w-96 flex-col ' + S.floating,
    style: { maxHeight: '260px' },
    children: jsx(BuscadorCorpus, {
      limite: 12,
      debounceMs: 350,
      autoFoco: true,
      titulo: t('piz.tituloBusqueda'),
      placeholder: t('piz.placeholderBusqueda'),
      textoVacio: t('piz.vacioBusqueda'),
      onCerrar,
      renderAcciones: (r) => [
        jsx('button', {
          type: 'button',
          className: 'dk-btn dk-btn--borde dk-btn--chico',
          title: t('piz.crearNorma'),
          onClick: () => onAgregarNota({
            titulo: r.cita || r.label || r.gid || t('piz.normaFallback'),
            tag: t('piz.tagNorma'),
            color: (COLORES_NOTA.find((c) => c.id === 'azul') || COLORES_NOTA[0]).hex,
            texto: (r.cita ? r.cita + '.\n' : '') + (r.snippet ? String(r.snippet).slice(0, 260) : ''),
            nodo_id: r.nodo_id,
            gid: r.gid,
          }),
          children: '+ ' + t('piz.titulo'),
        }),
        r.citable !== false && r.cita && onLlevarAlEscrito
          ? jsx('button', {
              type: 'button',
              className: 'dk-btn dk-btn--borde dk-btn--chico',
              title: t('piz.insertarCita'),
              onClick: () => onLlevarAlEscrito(r),
              children: t('piz.escritoBoton'),
            })
          : null,
      ],
    }),
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
      titulo: datos.titulo || t('piz.tituloNota', { n: idx + 1 }),
      tag: datos.tag || t('piz.tagNota'),
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
    className: 'flex flex-col border-b border-(--dk-borde) bg-(--dk-elevada) select-none shrink-0',
    children: [
      // Barra superior de la Pizarra Estratégica (estilo imagen 2)
      jsxs('div', {
        className: 'flex flex-wrap items-center gap-1.5 border-b border-(--dk-borde) bg-(--dk-superficie) px-3 py-1 text-xs',
        children: [
          jsx('button', {
            type: 'button',
            onClick: () => actualizar({ colapsada: !colapsada }),
            className: 'flex items-center gap-1 rounded px-2 py-1 font-medium text-(--dk-texto-2) hover:bg-(--dk-sobre) transition-colors cursor-pointer',
            children: [
              jsx('span', { children: colapsada ? '▾' : '▴' }),
              jsx('span', { children: t('piz.titulo') }),
              nodos.length > 0
                ? jsx('span', {
                    className: 'ml-1 rounded-full bg-(--dk-superficie-2) px-1.5 py-0.2 text-xs text-(--dk-texto-2)',
                    children: String(nodos.length),
                  })
                : null,
            ],
          }),

          jsx('button', {
            type: 'button',
            onClick: () => agregarNota({}),
            className: 'flex items-center gap-1 rounded border border-(--dk-borde) bg-(--dk-elevada) px-2 py-0.5 text-xs text-(--dk-texto-2) hover:bg-(--dk-sobre) cursor-pointer shadow-2xs',
            title: t('piz.agregarNotaTitulo'),
            children: [t('piz.botonNota')],
          }),

          // Selector de Plantillas
          jsxs('div', { className: 'relative', children: [
            jsx('button', {
              type: 'button',
              onClick: () => setMenuPlantillas((v) => !v),
              className: 'flex items-center gap-1 rounded border border-(--dk-borde) bg-(--dk-elevada) px-2 py-0.5 text-xs text-(--dk-texto-2) hover:bg-(--dk-sobre) cursor-pointer shadow-2xs',
              title: t('piz.cargarEstructura'),
              children: ['⊞ ' + t('piz.plantillas') + ' ▾'],
            }),
            menuPlantillas ? jsxs('div', {
              className: 'absolute left-0 top-full z-40 mt-1 w-72 rounded-md border border-(--dk-borde) bg-(--dk-elevada) py-1 shadow-xl',
              children: [
                jsx('div', { className: 'px-3 py-1 text-xs font-semibold uppercase tracking-wider text-(--dk-texto-3)', children: t('piz.estructuras') }),
                ...PLANTILLAS_PIZARRA.map((pl) => jsxs('button', {
                  key: pl.id,
                  type: 'button',
                  onClick: () => aplicarPlantilla(pl),
                  className: 'flex w-full flex-col px-3 py-1.5 text-left hover:bg-(--dk-sobre)',
                  children: [
                    jsx('span', { className: 'text-xs font-semibold text-(--dk-texto)', children: pl.label }),
                    jsx('span', { className: 'text-xs text-(--dk-texto-3)', children: pl.descripcion }),
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
            'aria-pressed': buscadorAbierto,
            className: 'dk-btn',
            title: t('piz.buscarNormas'),
            children: ['LexO Search'],
          }),

          nodos.length > 0 ? jsx('button', {
            type: 'button',
            onClick: volcarAlEscrito,
            className: 'dk-btn dk-btn--borde',
            title: t('piz.llevarNotasTitulo'),
            children: [t('piz.llevarNotas')],
          }) : null,

          conectandoDesde ? jsx('span', {
            className: S.chip + ' ' + S.chipInfo,
            children: t('piz.conectarHint'),
          }) : null,

          // Botón limpiar a la derecha (como el icono de papelera en imagen 2)
          jsxs('div', { className: 'ml-auto flex items-center gap-1', children: [
            nodos.length > 0 ? jsx('button', {
              type: 'button',
              onClick: () => actualizar({ nodos: [], aristas: [] }),
              className: 'dk-btn dk-btn--borde dk-btn--peligro dk-btn--chico',
              title: t('piz.limpiarTitulo'),
              children: t('piz.limpiar'),
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
              jsx('div', { className: 'text-xs font-medium text-(--dk-texto-3)', children: t('piz.vacio') }),
              jsx('div', { className: 'text-xs text-(--dk-texto-3)', children: t('piz.vacioAyuda') }),
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
                  className: 'flex flex-col rounded-md border border-(--dk-borde) text-(--dk-texto) transition-shadow',
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
                      className: 'flex items-center gap-1 border-b border-(--dk-borde-suave) px-2 py-1 cursor-move',
                      children: [
                        jsx('span', {
                          className: 'rounded bg-(--dk-superficie-2) px-1 py-0.2 text-xs font-bold uppercase tracking-wider text-(--dk-texto-2)',
                          children: n.tag || t('piz.tagNota'),
                        }),
                        jsx('input', {
                          value: n.titulo || '',
                          onChange: (ev) => editarNodo(n.id, { titulo: ev.target.value }),
                          className: 'min-w-0 flex-1 bg-transparent text-xs font-semibold text-(--dk-texto) outline-none',
                          placeholder: t('piz.tituloPlaceholder'),
                        }),
                        // Cambiar color
                        jsx('button', {
                          type: 'button',
                          title: t('piz.colorNota'),
                          'aria-label': t('piz.colorNota'),
                          onClick: () => {
                            const idx = COLORES_NOTA.findIndex((c) => c.hex === n.color)
                            const sig = COLORES_NOTA[(idx + 1) % COLORES_NOTA.length]
                            editarNodo(n.id, { color: sig.hex })
                          },
                          className: 'dk-btn dk-btn--chico',
                          children: '◐',
                        }),
                        // Conectar con otra tarjeta
                        jsx('button', {
                          type: 'button',
                          title: esOrigen ? t('piz.cancelarConexion') : t('piz.conectar'),
                          'aria-label': esOrigen ? t('piz.cancelarConexion') : t('piz.conectar'),
                          'aria-pressed': esOrigen,
                          onClick: () => clickConectar(n.id),
                          className: 'dk-btn dk-btn--chico',
                          children: '↔',
                        }),
                        // Insertar esta tarjeta en el escrito
                        onInsertarTexto ? jsx('button', {
                          type: 'button',
                          title: t('piz.insertarTexto'),
                          'aria-label': t('piz.insertarTexto'),
                          onClick: () => {
                            const txt = (n.texto || n.titulo || '').trim()
                            if (txt) onInsertarTexto(txt)
                          },
                          className: 'dk-btn dk-btn--chico',
                          children: '¶',
                        }) : null,
                        // Abrir en el grafo si es tarjeta de norma con nodo_id
                        n.nodo_id && onAbrirGrafo ? jsx('button', {
                          type: 'button',
                          title: t('piz.abrirGrafo'),
                          'aria-label': t('piz.abrirGrafo'),
                          onClick: () => onAbrirGrafo({ nodo_id: n.nodo_id }),
                          className: 'dk-btn dk-btn--chico',
                          children: '◈',
                        }) : null,
                        // Minimizar
                        jsx('button', {
                          type: 'button',
                          title: n.minimizada ? t('piz.expandir') : t('piz.minimizar'),
                          'aria-label': n.minimizada ? t('piz.expandir') : t('piz.minimizar'),
                          onClick: () => editarNodo(n.id, { minimizada: !n.minimizada }),
                          className: 'dk-btn dk-btn--chico',
                          children: n.minimizada ? '▢' : '–',
                        }),
                        // Cerrar/Eliminar
                        jsx('button', {
                          type: 'button',
                          title: t('piz.eliminar'),
                          'aria-label': t('piz.eliminar'),
                          onClick: () => eliminarNodo(n.id),
                          className: 'dk-btn dk-btn--chico dk-btn--peligro',
                          children: '✕',
                        }),
                      ],
                    }),

                    // Cuerpo de texto de la tarjeta
                    !n.minimizada ? jsx('textarea', {
                      value: n.texto || '',
                      onChange: (ev) => editarNodo(n.id, { texto: ev.target.value }),
                      placeholder: t('piz.textoPlaceholder'),
                      className: 'flex-1 w-full resize-none bg-transparent p-2 text-xs leading-relaxed text-(--dk-texto) outline-none',
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
                      title: t('piz.redimensionar'),
                      className: 'absolute bottom-0 right-0 h-3.5 w-3.5 cursor-nwse-resize text-right pr-0.5 text-xs leading-none text-(--dk-texto-3)',
                      children: '◢',
                    }) : null,
                  ],
                })
              }),
            ],
          }),

          // Controles de zoom abajo a la izquierda (exactamente como en la imagen 2)
          jsxs('div', {
            className: 'absolute bottom-2 left-2 z-20 flex flex-col overflow-hidden rounded border border-(--dk-borde) bg-(--dk-elevada) shadow-sm',
            children: [
              jsx('button', {
                type: 'button',
                title: t('piz.acercar'),
                onClick: () => {
                  const z = Math.min(1.6, +(zoom + 0.15).toFixed(2))
                  setZoom(z)
                  actualizar({ zoom: z })
                },
                className: 'border-b border-(--dk-borde) px-2 py-1 text-xs font-bold text-(--dk-texto-2) hover:bg-(--dk-sobre)',
                children: '+',
              }),
              jsx('button', {
                type: 'button',
                title: t('piz.alejar'),
                onClick: () => {
                  const z = Math.max(0.55, +(zoom - 0.15).toFixed(2))
                  setZoom(z)
                  actualizar({ zoom: z })
                },
                className: 'border-b border-(--dk-borde) px-2 py-1 text-xs font-bold text-(--dk-texto-2) hover:bg-(--dk-sobre)',
                children: '−',
              }),
              jsx('button', {
                type: 'button',
                title: t('piz.restablecer'),
                onClick: () => {
                  setZoom(1)
                  setPan({ x: 0, y: 0 })
                  actualizar({ zoom: 1, pan: { x: 0, y: 0 } })
                },
                className: 'px-2 py-1 text-xs text-(--dk-texto-2) hover:bg-(--dk-sobre)',
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
        title: t('piz.altura'),
        className: 'flex h-2.5 w-full cursor-row-resize items-center justify-center border-t border-(--dk-borde) bg-(--dk-superficie-2) hover:bg-(--dk-sobre)',
        children: jsx('span', { className: 'text-xs tracking-widest text-(--dk-texto-3)', children: '⋮⋮⋮' }),
      }) : null,
    ],
  })
}
