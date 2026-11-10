// Herramientas diferenciadas de Grafos en la barra lateral derecha del Case Writer:
// 1. Buscador y Lector del Grafo del Corpus (BM25 + Árbol IndexO + lectura de
//    unidades normativas + Llevar cita al escrito / Pizarra / Abrir en 3D).
// 2. Constructor de Paquetes de Grafos / Ordenamientos (dike-perfil-ordenamiento-v1:
//    perfiles por país, generador de plantilla, validador de perfil y constructor
//    de pack con informe C0–C3).
// 3. Fuentes del Grafo y Grafo Personal (GRE).

import { jsx, jsxs } from 'react/jsx-runtime'
import { useCallback, useEffect, useState } from 'react'
import { mensajeError, rest, S } from '../common.js'

// /grafo/buscar emite vigencia como {estado, motivo}; otros endpoints la
// emiten como string. Normalizar al estado legible antes de pintar.
const _vig = (v) => (v && typeof v === 'object' ? v.estado : v) || null

export function PanelHerramientasGrafos({
  onLlevarCitaAlEscrito,
  onAgregarAPizarra,
  onAbrirGrafo3D,
}) {
  const [herramienta, setHerramienta] = useState('corpus') // 'corpus' | 'constructor' | 'fuentes'

  return jsxs('div', {
    className: 'flex flex-col gap-3 p-3 text-xs text-slate-800',
    children: [
      // Selector de herramientas diferenciadas de grafos
      jsxs('div', {
        className: 'flex flex-col gap-1 rounded-md border border-slate-200 bg-slate-50 p-1.5',
        children: [
          jsx('div', { className: 'px-1 text-[10px] font-bold uppercase tracking-wider text-slate-400', children: 'Herramientas de Grafos' }),
          jsxs('div', { className: 'flex gap-1', children: [
            jsx('button', {
              type: 'button',
              onClick: () => setHerramienta('corpus'),
              className: 'flex-1 rounded py-1.5 px-2 text-[11px] font-semibold transition-colors cursor-pointer ' +
                (herramienta === 'corpus' ? 'bg-sky-600 text-white shadow-2xs' : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'),
              children: '🔍 Grafo del Corpus',
            }),
            jsx('button', {
              type: 'button',
              onClick: () => setHerramienta('constructor'),
              className: 'flex-1 rounded py-1.5 px-2 text-[11px] font-semibold transition-colors cursor-pointer ' +
                (herramienta === 'constructor' ? 'bg-indigo-600 text-white shadow-2xs' : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'),
              children: '🏗 Crear Grafo (Pack)',
            }),
            jsx('button', {
              type: 'button',
              onClick: () => setHerramienta('fuentes'),
              className: 'rounded py-1.5 px-2 text-[11px] font-semibold transition-colors cursor-pointer ' +
                (herramienta === 'fuentes' ? 'bg-emerald-600 text-white shadow-2xs' : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'),
              children: '◈ Capas / 3D',
            }),
          ] }),
        ],
      }),

      herramienta === 'corpus' ? jsx(SubHerramientaCorpus, {
        onLlevarCitaAlEscrito,
        onAgregarAPizarra,
        onAbrirGrafo3D,
      }) : null,

      herramienta === 'constructor' ? jsx(SubHerramientaConstructorOrdenamiento, {}) : null,

      herramienta === 'fuentes' ? jsx(SubHerramientaFuentes, { onAbrirGrafo3D }) : null,
    ],
  })
}

// ---------------------------------------------------------------------------
// 1. Sub-herramienta: Buscador y Lector de Nodos del Grafo del Corpus
// ---------------------------------------------------------------------------

function SubHerramientaCorpus({ onLlevarCitaAlEscrito, onAgregarAPizarra, onAbrirGrafo3D }) {
  const [q, setQ] = useState('')
  const [resultados, setResultados] = useState([])
  const [arbol, setArbol] = useState(null)
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState(null)
  const [articuloLeido, setArticuloLeido] = useState(null)
  const [leyendoId, setLeyendoId] = useState(null)

  const buscar = useCallback(() => {
    const limpio = q.trim()
    if (!limpio || ocupado) return
    setOcupado(true)
    setError(null)
    setArticuloLeido(null)
    rest('/grafo/buscar', {
      method: 'POST',
      body: { q: limpio, limite: 15 },
      timeoutMs: 120000,
    }).then((d) => {
      setResultados((d && d.resultados) || [])
      setArbol((d && d.arbol) || null)
    }).catch((e) => {
      setError(e)
      setResultados([])
    }).finally(() => setOcupado(false))
  }, [q, ocupado])

  const leerNodo = useCallback((r) => {
    const nid = r.nodo_id
    if (!nid) return
    setLeyendoId(nid)
    rest('/grafo/leer', {
      method: 'POST',
      body: { nodo_id: nid },
      timeoutMs: 120000,
    }).then((d) => {
      setArticuloLeido({ ...d, _res: r })
    }).catch((e) => {
      setError(e)
    }).finally(() => setLeyendoId(null))
  }, [])

  return jsxs('div', {
    className: 'flex flex-col gap-2.5',
    children: [
      jsxs('div', { className: 'flex items-center justify-between', children: [
        jsx('span', { className: 'text-[11px] text-slate-500', children: 'Búsqueda léxica BM25 + árbol de materias IndexO (sin modelo)' }),
        onAbrirGrafo3D ? jsx('button', {
          type: 'button',
          onClick: () => onAbrirGrafo3D(null),
          className: 'rounded border border-sky-300 bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-700 hover:bg-sky-100 cursor-pointer',
          children: 'Abrir lienzo Grafo 3D →',
        }) : null,
      ] }),

      jsxs('div', { className: 'flex gap-1.5', children: [
        jsx('input', {
          value: q,
          onChange: (e) => setQ(e.target.value),
          onKeyDown: (e) => { if (e.key === 'Enter') buscar() },
          placeholder: 'Ej. indemnización años de servicio artículo 163…',
          className: 'flex-1 rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-800 outline-none focus:border-sky-500',
        }),
        jsx('button', {
          type: 'button',
          onClick: buscar,
          disabled: ocupado || !q.trim(),
          className: 'rounded bg-sky-600 hover:bg-sky-700 disabled:opacity-50 px-3 py-1.5 text-xs font-semibold text-white cursor-pointer',
          children: ocupado ? '…' : 'Buscar',
        }),
      ] }),

      error ? jsx('div', { className: 'rounded border border-red-200 bg-red-50 p-2 text-xs text-red-700', children: mensajeError(error) }) : null,

      // Clasificación del Árbol de Derecho IndexO
      arbol && arbol.disponible && (arbol.clasificacion || []).length > 0 ? jsxs('div', {
        className: 'flex flex-col gap-1 rounded border border-sky-200 bg-sky-50/60 p-2',
        children: [
          jsx('span', { className: 'text-[10px] font-bold uppercase tracking-wider text-sky-800', children: 'Árbol de materias (IndexO)' }),
          jsxs('div', { className: 'flex flex-wrap gap-1', children:
            (arbol.clasificacion || []).map((m, i) => jsxs('span', {
              key: i,
              className: 'rounded bg-white border border-sky-200 px-1.5 py-0.5 text-[10px] text-sky-900',
              children: [
                jsx('b', { children: m.nombre || m.nodo }),
                (m.terminos || []).length ? ' (' + m.terminos.join(', ') + ')' : '',
              ],
            })),
          }),
        ],
      }) : null,

      // Visor del artículo leído y sus unidades normativas
      articuloLeido ? jsxs('div', {
        className: 'flex flex-col gap-2 rounded-md border border-indigo-300 bg-indigo-50/40 p-2.5',
        children: [
          jsxs('div', { className: 'flex items-center justify-between gap-2', children: [
            jsx('span', { className: 'font-bold text-indigo-900', children:
              (articuloLeido._res && articuloLeido._res.cita)
                || articuloLeido.cita || articuloLeido.gid || articuloLeido.nodo_id }),
            jsx('button', {
              type: 'button',
              onClick: () => setArticuloLeido(null),
              className: 'text-xs text-slate-500 hover:text-slate-800',
              children: '✕ cerrar lectura',
            }),
          ] }),
          jsx('div', {
            className: 'max-h-48 overflow-y-auto whitespace-pre-wrap rounded border border-slate-200 bg-white p-2 font-serif text-xs leading-relaxed text-slate-800',
            children: articuloLeido.texto || '(sin texto disponible)',
          }),
          (articuloLeido.unidades || []).length > 0 ? jsxs('details', { className: 'text-[11px]', children: [
            jsx('summary', { className: 'cursor-pointer font-medium text-indigo-800', children: `Unidades normativas mínimas (${articuloLeido.unidades.length})` }),
            jsxs('div', { className: 'mt-1 flex flex-col gap-1 max-h-40 overflow-y-auto', children:
              articuloLeido.unidades.map((u, ui) => jsxs('div', {
                key: u.id || ui,
                className: 'rounded border border-slate-200 bg-white p-1.5 text-[11px]',
                children: [
                  jsxs('div', { className: 'flex items-center justify-between gap-1 font-mono text-[10px] text-slate-500', children: [
                    jsx('span', { children: u.id }),
                    u.modalidad || u.modalidad_candidata ? jsx('span', { className: 'rounded bg-slate-100 px-1 uppercase', children: u.modalidad || u.modalidad_candidata }) : null,
                  ] }),
                  jsx('div', { className: 'mt-0.5 text-slate-700', children: u.texto }),
                ],
              })),
            }),
          ] }) : null,
        ],
      }) : null,

      // Lista de resultados
      jsxs('div', { className: 'flex flex-col gap-1.5', children: [
        resultados.map((r, i) => jsxs('div', {
          key: r.nodo_id || i,
          className: 'flex flex-col gap-1.5 rounded border border-slate-200 bg-white p-2.5',
          children: [
            jsxs('div', { className: 'flex items-start justify-between gap-2', children: [
              jsxs('div', { className: 'min-w-0 flex-1', children: [
                jsx('div', { className: 'font-semibold text-slate-800', children: r.cita || r.label || r.gid }),
                jsx('div', { className: 'font-mono text-[10px] text-slate-400', children: [r.nodo_id, r.gid].filter(Boolean).join(' · ') }),
              ] }),
              _vig(r.vigencia) ? jsx('span', {
                className: 'rounded px-1.5 py-0.5 text-[10px] font-medium ' +
                  (_vig(r.vigencia) === 'IN_FORCE' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-amber-50 text-amber-700 border border-amber-200'),
                children: _vig(r.vigencia) === 'IN_FORCE' ? 'vigente' : _vig(r.vigencia),
              }) : null,
            ] }),
            r.snippet ? jsx('div', { className: 'text-[11px] text-slate-600 leading-relaxed line-clamp-3', children: String(r.snippet).slice(0, 260) }) : null,
            jsxs('div', { className: 'flex flex-wrap items-center gap-1.5 pt-1', children: [
              jsx('button', {
                type: 'button',
                onClick: () => leerNodo(r),
                disabled: leyendoId === r.nodo_id,
                className: 'rounded border border-slate-300 bg-slate-50 hover:bg-slate-100 px-2 py-0.5 text-[11px] text-slate-700 cursor-pointer',
                children: leyendoId === r.nodo_id ? 'Leyendo…' : '📖 Leer artículo',
              }),
              r.citable !== false && r.cita && onLlevarCitaAlEscrito ? jsx('button', {
                type: 'button',
                onClick: () => onLlevarCitaAlEscrito(r),
                className: 'rounded bg-teal-600 hover:bg-teal-700 px-2 py-0.5 text-[11px] font-medium text-white cursor-pointer',
                title: 'Inserta la cita canónica al final del escrito y la pasa por el verificador',
                children: '+ Llevar al escrito',
              }) : null,
              onAgregarAPizarra ? jsx('button', {
                type: 'button',
                onClick: () => onAgregarAPizarra({
                  titulo: r.cita || r.label || 'Norma',
                  tag: 'NORMA',
                  color: '#bfdbfe',
                  texto: (r.cita ? r.cita + '.\n' : '') + (r.snippet ? String(r.snippet).slice(0, 240) : ''),
                  nodo_id: r.nodo_id,
                  gid: r.gid,
                }),
                className: 'rounded border border-sky-300 bg-sky-50 hover:bg-sky-100 px-2 py-0.5 text-[11px] text-sky-800 cursor-pointer',
                children: '+ Pizarra',
              }) : null,
              r.nodo_id && onAbrirGrafo3D ? jsx('button', {
                type: 'button',
                onClick: () => onAbrirGrafo3D({ nodo_id: r.nodo_id }),
                className: 'rounded border border-indigo-200 bg-indigo-50 hover:bg-indigo-100 px-2 py-0.5 text-[11px] text-indigo-700 cursor-pointer',
                children: '◈ Abrir en 3D',
              }) : null,
            ] }),
          ],
        })),
      ] }),
    ],
  })
}

// ---------------------------------------------------------------------------
// 2. Sub-herramienta: Constructor de Paquetes de Grafos / Ordenamientos
// ---------------------------------------------------------------------------

function SubHerramientaConstructorOrdenamiento() {
  const [catalogo, setCatalogo] = useState(null)
  const [jurInput, setJurInput] = useState('ar')
  const [perfilJson, setPerfilJson] = useState('')
  const [paqueteJson, setPaqueteJson] = useState('')
  const [textoNormaNombre, setTextoNormaNombre] = useState('xx-ley-1.txt')
  const [textoNormaContenido, setTextoNormaContenido] = useState('')
  const [validacion, setValidacion] = useState(null)
  const [resultadoBuild, setResultadoBuild] = useState(null)
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    rest('/ordenamiento/perfiles').then((d) => {
      setCatalogo(d)
      const xx = (d && d.perfiles || []).find((p) => p.jurisdiccion === 'xx') || (d && d.perfiles && d.perfiles[0])
      if (xx && xx.perfil) {
        setPerfilJson(JSON.stringify(xx.perfil, null, 2))
      }
      if (d && d.ejemplo_xx) {
        setPaqueteJson(JSON.stringify(d.ejemplo_xx.paquete, null, 2))
        const entradas = Object.entries(d.ejemplo_xx.textos || {})
        if (entradas.length) {
          setTextoNormaNombre(entradas[0][0].replace(/^textos\//, ''))
          setTextoNormaContenido(entradas[0][1])
        }
      }
    }).catch(setError)
  }, [])

  const generarPlantilla = useCallback(() => {
    setOcupado(true)
    setError(null)
    setValidacion(null)
    setResultadoBuild(null)
    rest('/ordenamiento/plantilla', {
      method: 'POST',
      body: { jur: jurInput.trim().toLowerCase() },
    }).then((d) => {
      setPerfilJson(JSON.stringify(d.perfil, null, 2))
      setPaqueteJson(JSON.stringify(d.paquete, null, 2))
    }).catch(setError).finally(() => setOcupado(false))
  }, [jurInput])

  const validarPerfilActual = useCallback(() => {
    setError(null)
    setValidacion(null)
    let obj
    try {
      obj = JSON.parse(perfilJson)
    } catch (e) {
      setError(new Error('El JSON del perfil tiene un error de sintaxis: ' + e.message))
      return
    }
    setOcupado(true)
    rest('/ordenamiento/validar-perfil', {
      method: 'POST',
      body: { perfil: obj },
    }).then(setValidacion).catch(setError).finally(() => setOcupado(false))
  }, [perfilJson])

  const construirYValidarPack = useCallback(() => {
    setError(null)
    setResultadoBuild(null)
    let objPerfil
    let objPaquete
    try {
      objPerfil = JSON.parse(perfilJson)
      objPaquete = JSON.parse(paqueteJson)
    } catch (e) {
      setError(new Error('JSON inválido en perfil o paquete: ' + e.message))
      return
    }
    const textos = {}
    if (catalogo && catalogo.ejemplo_xx && catalogo.ejemplo_xx.textos) {
      Object.assign(textos, catalogo.ejemplo_xx.textos)
    }
    if (textoNormaNombre.trim() && textoNormaContenido.trim()) {
      textos['textos/' + textoNormaNombre.trim().replace(/^textos\//, '')] = textoNormaContenido
    }
    setOcupado(true)
    rest('/ordenamiento/construir', {
      method: 'POST',
      body: { perfil: objPerfil, paquete: objPaquete, textos },
    }).then(setResultadoBuild).catch(setError).finally(() => setOcupado(false))
  }, [perfilJson, paqueteJson, textoNormaNombre, textoNormaContenido, catalogo])

  const perfiles = (catalogo && catalogo.perfiles) || []

  return jsxs('div', {
    className: 'flex flex-col gap-3',
    children: [
      jsx('div', {
        className: 'rounded border border-indigo-200 bg-indigo-50/70 p-2.5 text-[11px] text-indigo-950 leading-relaxed',
        children: 'Crea y valida paquetes de grafos normativos (dike-ordenamiento-pack-v1) para cualquier país o sistema jurídico. Todo corre offline con el detector de privacidad integrado.',
      }),

      // Perfiles instalados
      perfiles.length > 0 ? jsxs('div', {
        className: 'flex flex-col gap-1.5 rounded border border-slate-200 bg-white p-2.5',
        children: [
          jsx('div', { className: 'text-[10px] font-bold uppercase tracking-wider text-slate-400', children: 'Perfiles de ordenamiento incluidos' }),
          ...perfiles.map((p) => jsxs('div', {
            key: p.id,
            className: 'flex items-center justify-between gap-2 border-b border-slate-100 py-1.5 last:border-0',
            children: [
              jsxs('div', { className: 'min-w-0', children: [
                jsxs('div', { className: 'flex items-center gap-1.5', children: [
                  jsx('span', { className: 'font-bold text-slate-800', children: `${p.nombre} (${p.jurisdiccion})` }),
                  jsx('span', {
                    className: 'rounded px-1.5 py-0.2 text-[9px] font-semibold ' +
                      (p.valido ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'),
                    children: p.valido ? 'perfil válido' : 'con errores',
                  }),
                ] }),
                jsx('div', {
                  className: 'text-[10px] text-slate-500',
                  children: (p.tipos_norma || []).map((t) => t.etiqueta || t.id).join(' · '),
                }),
              ] }),
              jsx('button', {
                type: 'button',
                onClick: () => {
                  setPerfilJson(JSON.stringify(p.perfil, null, 2))
                  setValidacion(null)
                  setResultadoBuild(null)
                },
                className: 'rounded border border-slate-300 bg-slate-50 hover:bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-700 cursor-pointer shrink-0',
                children: 'Cargar en editor',
              }),
            ],
          })),
        ],
      }) : null,

      // Paso 1: Generar plantilla para nuevo país
      jsxs('div', {
        className: 'flex flex-wrap items-center gap-1.5 rounded border border-slate-200 bg-white p-2',
        children: [
          jsx('span', { className: 'text-[11px] font-semibold text-slate-700', children: '1. Nueva plantilla de país:' }),
          jsx('input', {
            value: jurInput,
            onChange: (e) => setJurInput(e.target.value),
            placeholder: 'código ISO (ej. ar, pe, es, mx)',
            className: 'w-24 rounded border border-slate-300 px-2 py-1 font-mono text-xs text-slate-800',
          }),
          jsx('button', {
            type: 'button',
            onClick: generarPlantilla,
            disabled: ocupado || !jurInput.trim(),
            className: 'rounded bg-slate-800 hover:bg-slate-900 px-2.5 py-1 text-[11px] font-medium text-white cursor-pointer',
            children: 'Generar plantilla',
          }),
        ],
      }),

      // Paso 2: Editor de perfil JSON y validación
      jsxs('div', {
        className: 'flex flex-col gap-1.5 rounded border border-slate-200 bg-white p-2.5',
        children: [
          jsxs('div', { className: 'flex items-center justify-between', children: [
            jsx('span', { className: 'text-[11px] font-semibold text-slate-700', children: '2. Perfil del ordenamiento (JSON)' }),
            jsx('button', {
              type: 'button',
              onClick: validarPerfilActual,
              disabled: ocupado || !perfilJson.trim(),
              className: 'rounded border border-indigo-300 bg-indigo-50 hover:bg-indigo-100 px-2.5 py-0.5 text-[11px] font-semibold text-indigo-700 cursor-pointer',
              children: 'Validar perfil',
            }),
          ] }),
          jsx('textarea', {
            value: perfilJson,
            onChange: (e) => setPerfilJson(e.target.value),
            rows: 6,
            className: 'w-full rounded border border-slate-300 bg-slate-50 p-2 font-mono text-[11px] text-slate-800 outline-none focus:border-indigo-500',
          }),
          validacion ? jsxs('div', {
            className: 'rounded p-2 text-[11px] ' +
              (validacion.ok ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-amber-50 text-amber-900 border border-amber-200'),
            children: [
              jsx('div', {
                className: 'font-bold',
                children: validacion.ok
                  ? '✓ Perfil válido conforme a dike-perfil-ordenamiento-v1'
                  : `✗ ${validacion.errores.length} observación(es) en el perfil:`,
              }),
              ...(validacion.errores || []).slice(0, 6).map((er, i) => jsx('div', {
                key: i,
                className: 'mt-0.5 font-mono text-[10px]',
                children: `[${er.codigo}] ${er.ruta}: ${er.explicacion}`,
              })),
            ],
          }) : null,
        ],
      }),

      // Paso 3: Construir y validar pack C0-C3
      jsxs('details', {
        className: 'rounded border border-slate-200 bg-white p-2.5',
        children: [
          jsx('summary', { className: 'cursor-pointer text-[11px] font-semibold text-slate-700', children: '3. Configuración de paquete y texto de norma (Construir grafo)' }),
          jsxs('div', { className: 'mt-2 flex flex-col gap-2', children: [
            jsx('div', { className: 'text-[10px] font-semibold uppercase text-slate-400', children: 'paquete.json' }),
            jsx('textarea', {
              value: paqueteJson,
              onChange: (e) => setPaqueteJson(e.target.value),
              rows: 4,
              className: 'w-full rounded border border-slate-300 bg-slate-50 p-1.5 font-mono text-[10px] text-slate-800',
            }),
            jsxs('div', { className: 'flex items-center gap-2', children: [
              jsx('span', { className: 'text-[10px] text-slate-500', children: 'Archivo:' }),
              jsx('input', {
                value: textoNormaNombre,
                onChange: (e) => setTextoNormaNombre(e.target.value),
                className: 'rounded border border-slate-300 px-2 py-0.5 font-mono text-[11px]',
              }),
            ] }),
            jsx('textarea', {
              value: textoNormaContenido,
              onChange: (e) => setTextoNormaContenido(e.target.value),
              rows: 4,
              placeholder: 'Artículo 1. Texto del primer artículo…\nArtículo 2. Texto del segundo artículo…',
              className: 'w-full rounded border border-slate-300 bg-slate-50 p-1.5 font-mono text-[10px] text-slate-800',
            }),
          ] }),
        ],
      }),

      jsx('button', {
        type: 'button',
        onClick: construirYValidarPack,
        disabled: ocupado || !perfilJson.trim() || !paqueteJson.trim(),
        className: 'rounded-md bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 py-2 px-3 text-xs font-semibold text-white cursor-pointer shadow-2xs',
        children: ocupado ? 'Construyendo y validando pack…' : '🏗 Construir pack de grafo y validar niveles C0–C3',
      }),

      error ? jsx('div', { className: 'rounded border border-red-200 bg-red-50 p-2 text-xs text-red-700', children: mensajeError(error) }) : null,

      resultadoBuild ? jsxs('div', {
        className: 'flex flex-col gap-1.5 rounded-md border p-2.5 text-[11px] ' +
          (resultadoBuild.ok ? 'border-emerald-300 bg-emerald-50/70 text-emerald-950' : 'border-amber-300 bg-amber-50 text-amber-950'),
        children: [
          jsx('div', {
            className: 'font-bold',
            children: resultadoBuild.ok
              ? `✓ Pack construido y validado — Nivel alcanzado: ${resultadoBuild.compatibilidad.nivelAlcanzado}`
              : `✗ Construcción detenida (${resultadoBuild.etapa || 'validación'}): ${resultadoBuild.error || 'revisa los errores'}`,
          }),
          resultadoBuild.construccion ? jsxs('div', { className: 'grid grid-cols-2 gap-1 text-[11px] mt-1', children: [
            jsx('div', { children: `Normas: ${resultadoBuild.construccion.normas}` }),
            jsx('div', { children: `Artículos acuñados: ${resultadoBuild.construccion.articulos}` }),
            jsx('div', { children: `Aristas: ${resultadoBuild.construccion.aristas}` }),
            jsx('div', { children: `Vigencias: ${resultadoBuild.construccion.ventanasVigencia}` }),
          ] }) : null,
          resultadoBuild.construccion && resultadoBuild.construccion.manifestCoreSha256
            ? jsx('div', { className: 'font-mono text-[10px] text-slate-600 break-all', children: 'manifestCoreSha256: ' + resultadoBuild.construccion.manifestCoreSha256 })
            : null,
        ],
      }) : null,
    ],
  })
}

// ---------------------------------------------------------------------------
// 3. Sub-herramienta: Fuentes del Grafo y Grafo Personal (GRE)
// ---------------------------------------------------------------------------

function SubHerramientaFuentes({ onAbrirGrafo3D }) {
  const [fuentes, setFuentes] = useState([])
  const [personal, setPersonal] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    rest('/grafo/fuentes').then(setFuentes).catch(setError)
    rest('/grafo/personal').then(setPersonal).catch(() => {})
  }, [])

  return jsxs('div', {
    className: 'flex flex-col gap-2.5',
    children: [
      jsxs('div', { className: 'flex flex-col gap-1.5 rounded border border-slate-200 bg-white p-2.5', children: [
        jsx('div', { className: 'text-[10px] font-bold uppercase tracking-wider text-slate-400', children: 'Capas de grafo disponibles' }),
        ...(fuentes || []).map((f) => jsxs('div', {
          key: f.id,
          className: 'flex items-center justify-between gap-2 border-b border-slate-100 py-1.5 last:border-0',
          children: [
            jsxs('div', { children: [
              jsx('div', { className: 'font-semibold text-slate-800', children: f.label }),
              jsx('div', { className: 'text-[10px] text-slate-500', children: f.local_only ? 'Capa local en este equipo' : 'Corpus sellado por hash' }),
            ] }),
            jsx('span', {
              className: 'rounded px-1.5 py-0.5 text-[10px] font-medium ' +
                (f.disponible ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-500'),
              children: f.disponible ? 'disponible' : 'no construida',
            }),
          ],
        })),
        onAbrirGrafo3D ? jsx('button', {
          type: 'button',
          onClick: () => onAbrirGrafo3D(null),
          className: 'mt-1 rounded bg-emerald-600 hover:bg-emerald-700 py-1.5 px-3 text-xs font-semibold text-white cursor-pointer',
          children: 'Abrir Explorador 3D a pantalla completa',
        }) : null,
      ] }),

      personal ? jsxs('div', { className: 'flex flex-col gap-1 rounded border border-slate-200 bg-white p-2.5', children: [
        jsx('div', { className: 'text-[10px] font-bold uppercase tracking-wider text-slate-400', children: 'Grafo de Revisión Personal (GRE)' }),
        jsx('div', {
          className: 'text-xs text-slate-700',
          children: `Nodos candidatos: ${(personal.candidates || personal.nodes || []).length} · Aristas: ${(personal.edges || []).length}`,
        }),
        jsx('div', { className: 'text-[11px] text-slate-500', children: 'Los candidatos del grafo personal viven en plugin-data fuera del corpus sellado.' }),
      ] }) : null,

      error ? jsx('div', { className: 'text-xs text-red-600', children: mensajeError(error) }) : null,
    ],
  })
}
