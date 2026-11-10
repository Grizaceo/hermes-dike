// Case Writer (Estudio de Escritos):
// 1. Barra superior de documento y formato tipo Word (Archivo, Escribir/Leer,
//    Documento/Caso, Deshacer/Rehacer, Tipografía, Tamaño, Formalismos, Verificar).
// 2. Pizarra Estratégica superior colapsable y redimensionable (notas adhesivas,
//    plantillas procesales, conexiones dirigidas y LexO Search sobre el corpus).
// 3. Hoja central tipo Word (A4/Carta/Ancho, temas Papel Clásico / Sepia / Tinta)
//    con marcas de citas y privacidad en línea + barra inferior de estado y custodia.
// 4. Barra vertical derecha de herramientas diferenciadas:
//    - Verificador de Citas Diké (probar → reparar → retirar → escalar)
//    - Privacidad y Seudonimización (anonimizado local antes de salir al modelo)
//    - Revisión de Estilo — LexO Escribe Claro (ScribeClaro + Grafo Argumentativo)
//    - NIF Interactivo + NIF Vivo (propuestas del modelo y tablero del caso)
//    - Herramientas de Grafos (Buscador del Corpus + Constructor de Ordenamientos)
//    - Personalización y Copilot Jurídico (predicción por capas L0/L1/L2)
// 5. Panel lateral derecho conectado con Hermes (Chat del escrito con sobre
//    <dike-escritor v="1">, notas al pie verificadas contra el grafo y seudonimización).

import { jsx, jsxs } from 'react/jsx-runtime'
import { useCallback, useEffect, useRef, useState } from 'react'
import { mensajeError, rest, storage, S } from '../common.js'
import {
  borrarRangos, fijarMarcas, montarEditor, reemplazarRangos, textoDelEditor,
} from './editor.js'
import {
  AVISO_JUICIO, estadoCita, etiquetaCita, localizarCitas, mensajeVeredicto,
  rangoAPos, rangosAPos, segmentosDeDoc, sha256Hex,
} from './verificador.js'
import { ModuloPrivacidad } from './privacidad.js'
import { ChatEscritor } from './chat.js'
import { NifInteractivoEscritor } from './nif-propuestas.js'
import { PrediccionPanel } from './prediccion.js'
import { PizarraEstrategica } from './pizarra.js'
import { BarraFormato } from './barra-formato.js'
import { PanelEscribeClaro } from './escribe-claro-panel.js'
import { PanelHerramientasGrafos } from './grafos-herramientas.js'
import { tomarCitas } from '../puente.js'

const BORRADOR = 'borrador'
const DEBOUNCE_GUARDADO = 800
const DEBOUNCE_INFO = 300
const MAX_INTENTOS_REPARAR = 2

const ESTILOS_ESTADO = {
  verificada: { chip: 'chipOk', texto: 'verificada' },
  fallo: { chip: 'chipBad', texto: 'FALLO' },
  desactualizada: { chip: 'chipOff', texto: 'desactualizada' },
  retirada: { chip: 'chipOff', texto: 'retirada' },
  escalada: { chip: 'chipOff', texto: 'escalada' },
}

const TEMAS_HOJA = {
  clasico: {
    label: 'Papel clásico',
    entorno: '#e5e7eb',
    hojaBg: '#ffffff',
    hojaTexto: '#1a1a1a',
    hojaBorde: 'rgba(0,0,0,0.08)',
  },
  sepia: {
    label: 'Sepia lectura',
    entorno: '#e4ddd0',
    hojaBg: '#fdf6e3',
    hojaTexto: '#2b2118',
    hojaBorde: 'rgba(120,90,40,0.18)',
  },
  nocturno: {
    label: 'Tinta oscura',
    entorno: '#0f172a',
    hojaBg: '#1e293b',
    hojaTexto: '#f1f5f9',
    hojaBorde: 'rgba(148,163,184,0.2)',
  },
}

const ANCHOS_HOJA = {
  a4: { label: 'A4 (210 mm)', width: '210mm', padding: '2.2cm 2.6cm' },
  carta: { label: 'Carta (216 mm)', width: '216mm', padding: '2.0cm 2.4cm' },
  ancho: { label: 'Ancho fluido', width: '100%', padding: '1.6rem 2.2rem' },
}

const HERRAMIENTAS_BARRA = [
  {
    id: 'citas',
    icono: '✓',
    label: 'Verificador de Citas',
    titulo: 'Verificador de Citas Diké',
    headerCls: 'bg-emerald-50 border-emerald-200 text-emerald-800',
    activeCls: 'bg-emerald-600 text-white shadow-xs',
  },
  {
    id: 'privacidad',
    icono: '🛡',
    label: 'Privacidad y Anonimizado',
    titulo: 'Seudonimización y Privacidad (Ley 21.719)',
    headerCls: 'bg-amber-50 border-amber-200 text-amber-900',
    activeCls: 'bg-amber-600 text-white shadow-xs',
  },
  {
    id: 'estilo',
    icono: '✍',
    label: 'Revisión de Estilo (LexO Escribe Claro)',
    titulo: 'Revisión de Estilo · LexO Escribe Claro',
    headerCls: 'bg-teal-50 border-teal-200 text-teal-800',
    activeCls: 'bg-teal-600 text-white shadow-xs',
  },
  {
    id: 'nif',
    icono: '⑂',
    label: 'NIF Interactivo y NIF Vivo',
    titulo: 'Tablero NIF Interactivo y Propuestas',
    headerCls: 'bg-indigo-50 border-indigo-200 text-indigo-800',
    activeCls: 'bg-indigo-600 text-white shadow-xs',
  },
  {
    id: 'grafos',
    icono: '◈',
    label: 'Herramientas de Grafos y Ordenamientos',
    titulo: 'Grafos del Corpus y Constructor de Ordenamientos',
    headerCls: 'bg-sky-50 border-sky-200 text-sky-900',
    activeCls: 'bg-sky-600 text-white shadow-xs',
  },
  {
    id: 'ajustes',
    icono: '⚙',
    label: 'Copilot y Personalización',
    titulo: 'Personalización de Estudio y Predicción',
    headerCls: 'bg-violet-50 border-violet-200 text-violet-900',
    activeCls: 'bg-violet-600 text-white shadow-xs',
  },
]

function esConflicto(e) {
  if (!e) return false
  if (e.status === 409 || e.statusCode === 409) return true
  if (e.detail && typeof e.detail === 'object' && 'rev_actual' in e.detail) return true
  return /\b409\b|rev_actual/.test(String(e.message || e.detail || e.error || e))
}

// --- Panel de una cita en FALLO: probar → reparar → retirar → escalar ---------

function AccionesFallo({ detalle, acciones, onAccion }) {
  const a = acciones || {}
  const [reparar, setReparar] = useState(detalle.cita_raw || '')
  const [motivo, setMotivo] = useState('')
  const [nota, setNota] = useState('')
  const agotados = (a.intentos || 0) >= MAX_INTENTOS_REPARAR
  return jsxs('div', { className: 'flex flex-col gap-1.5 mt-1.5 rounded border border-red-200 bg-red-50/40 p-2', children: [
    jsxs('div', { className: 'flex flex-wrap items-center gap-1.5', children: [
      jsx('input', {
        className: 'flex-1 min-w-36 rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800 outline-none',
        value: reparar,
        placeholder: 'texto de reemplazo',
        disabled: agotados,
        onChange: (e) => setReparar(e.target.value),
      }),
      jsx('button', {
        type: 'button',
        className: 'rounded border border-slate-300 bg-white hover:bg-slate-100 px-2 py-1 text-xs text-slate-700 disabled:opacity-40 cursor-pointer',
        disabled: agotados || a.ocupado || !reparar.trim(),
        onClick: () => onAccion('probar', reparar.trim()),
        children: a.ocupado ? 'probando…' : 'Probar reemplazo',
      }),
      jsx('button', {
        type: 'button',
        className: 'rounded bg-emerald-600 hover:bg-emerald-700 px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-40 cursor-pointer',
        disabled: !a.probado || agotados || reparar.trim() !== a.probadoTexto,
        onClick: () => onAccion('aplicar', a.probadoTexto),
        children: 'Aplicar',
      }),
    ] }),
    a.resumenPrueba
      ? jsx('div', { className: 'text-[11px] text-slate-600', children: a.resumenPrueba })
      : null,
    agotados
      ? jsx('div', { className: 'text-xs text-red-700 font-medium', children:
          'Dos intentos de reparación sin éxito: conviene escalar.' })
      : null,
    jsxs('div', { className: 'flex flex-wrap items-center gap-1.5', children: [
      jsx('input', {
        className: 'flex-1 min-w-28 rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800 outline-none',
        value: motivo,
        placeholder: 'motivo para retirarla',
        onChange: (e) => setMotivo(e.target.value),
      }),
      jsx('button', {
        type: 'button',
        className: 'rounded border border-slate-300 bg-white hover:bg-slate-100 px-2 py-1 text-xs text-slate-700 disabled:opacity-40 cursor-pointer',
        disabled: !motivo.trim(),
        onClick: () => { onAccion('retirar', motivo.trim()); setMotivo('') },
        children: 'Retirar',
      }),
      jsx('input', {
        className: 'flex-1 min-w-28 rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800 outline-none',
        value: nota,
        placeholder: 'nota para revisión humana',
        onChange: (e) => setNota(e.target.value),
      }),
      jsx('button', {
        type: 'button',
        className: 'rounded border border-slate-300 bg-white hover:bg-slate-100 px-2 py-1 text-xs text-slate-700 disabled:opacity-40 cursor-pointer',
        disabled: !nota.trim(),
        onClick: () => { onAccion('escalar', nota.trim()); setNota('') },
        children: 'Escalar',
      }),
    ] }),
  ] })
}

// --- Sección principal del Case Writer ----------------------------------------

export function SeccionEscritor({ onAbrirGrafo }) {
  const hostRef = useRef(null)
  const editorRef = useRef(null)
  const revRef = useRef(0)
  const [chatSesion, setChatSesion] = useState(null)
  const registroRef = useRef({})
  const casoRef = useRef(BORRADOR)
  const textoGuardadoRef = useRef('')
  const timerGuardado = useRef(null)
  const timerInfo = useRef(null)
  const infoDocRef = useRef({ texto: '', hash: null })
  const verificacionRef = useRef(null)
  const verificarRef = useRef(null)

  const [casos, setCasos] = useState(null)
  const [caseId, setCaseId] = useState(BORRADOR)
  const [estadoDoc, setEstadoDoc] = useState('cargando')
  const [error, setError] = useState(null)
  const [aviso, setAviso] = useState(null)
  const [verificacion, setVerificacion] = useState(null)
  const [docInfo, setDocInfo] = useState({ texto: '', hash: null })
  const [verificando, setVerificando] = useState(false)
  const [acciones, setAcciones] = useState({})
  const [conflictoRev, setConflictoRev] = useState(null)
  const [registro, setRegistro] = useState({})

  // Estado de estudio / interfaz tipo imagen 2
  const [modoVista, setModoVista] = useState('write') // 'write' | 'read'
  const [herramientaActiva, setHerramientaActiva] = useState(null) // null | 'citas' | 'privacidad' | 'estilo' | 'nif' | 'grafos' | 'ajustes'
  const [chatAbierto, setChatAbierto] = useState(true)
  const [prefs, setPrefs] = useState({
    tema_papel: 'clasico',
    fuente: "Georgia, 'Times New Roman', serif",
    tamano_fuente: '12',
    ancho_hoja: 'a4',
    estrategia_privacidad: 'media',
    contexto_estilo: 'escrito',
    mostrar_pizarra: true,
    mostrar_chat: true,
    auto_detectar_privacidad: true,
    auto_analizar_estilo: false,
  })

  // Cargar preferencias de usuario al montar
  useEffect(() => {
    rest('/preferencias').then((d) => {
      if (d && typeof d === 'object') {
        setPrefs((p) => ({ ...p, ...d }))
        if (typeof d.mostrar_chat === 'boolean') setChatAbierto(d.mostrar_chat)
      }
    }).catch(() => {})
  }, [])

  const guardarPrefs = useCallback((parche) => {
    setPrefs((prev) => {
      const sig = { ...prev, ...parche }
      rest('/preferencias', { method: 'POST', body: sig }).catch(() => {})
      if (storage && typeof storage.set === 'function') {
        try { storage.set('dike.preferencias', sig) } catch {}
      }
      return sig
    })
    if ('mostrar_chat' in parche) setChatAbierto(Boolean(parche.mostrar_chat))
  }, [])

  const actualizarInfoDoc = useCallback((ed) => {
    const texto = textoDelEditor(ed)
    sha256Hex(texto).then((hash) => {
      const info = { texto, hash }
      infoDocRef.current = info
      setDocInfo(info)
    }).catch(() => {})
  }, [])

  const programarInfoDoc = useCallback((ed) => {
    clearTimeout(timerInfo.current)
    timerInfo.current = setTimeout(() => actualizarInfoDoc(ed), DEBOUNCE_INFO)
  }, [actualizarInfoDoc])

  const estadoRef = useRef('cargando')
  estadoRef.current = estadoDoc

  const guardar = useCallback(() => {
    const ed = editorRef.current
    clearTimeout(timerGuardado.current)
    if (!ed || estadoRef.current === 'conflicto') return Promise.resolve()
    setEstadoDoc('guardando')
    const texto = textoDelEditor(ed)
    return rest('/escrito', {
      method: 'POST',
      body: {
        case_id: casoRef.current,
        html: ed.getHTML(),
        texto,
        rev_base: revRef.current,
        registro: registroRef.current,
      },
    }).then((resp) => {
      revRef.current = resp.rev
      textoGuardadoRef.current = texto
      setEstadoDoc('guardado')
    }).catch((e) => {
      if (esConflicto(e)) {
        setEstadoDoc('conflicto')
        const d = e && e.detail
        setConflictoRev(d && typeof d === 'object' ? d.rev_actual : null)
      } else {
        setEstadoDoc('sin-guardar')
        setError(e)
      }
    })
  }, [])

  const programarGuardado = useCallback(() => {
    clearTimeout(timerGuardado.current)
    timerGuardado.current = setTimeout(() => { guardar() }, DEBOUNCE_GUARDADO)
  }, [guardar])

  // Sincronizar cambios en registro (privacidad, pizarra, predicción, NIF)
  const actualizarRegistro = useCallback((updater) => {
    const base = registroRef.current || {}
    const nuevo = typeof updater === 'function' ? updater(base) : updater
    registroRef.current = nuevo
    setRegistro(nuevo)
    if (estadoRef.current !== 'cargando' && estadoRef.current !== 'conflicto') {
      setEstadoDoc('sin-guardar')
      programarGuardado()
    }
  }, [programarGuardado])

  const insertarCitaEnEscrito = useCallback((p) => {
    const ed = editorRef.current
    if (!ed || !p || !p.cita) return
    const ahora = new Date().toISOString()
    const seguro = String(p.cita)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
    ed.chain().insertContentAt(ed.state.doc.content.size, '<p>' + seguro + '.</p>').run()
    const reg = registroRef.current || {}
    registroRef.current = {
      ...reg,
      pistas: [
        ...(reg.pistas || []),
        { cita: p.cita, gid: p.gid, nodo_id: p.nodo_id, fecha: ahora, origen: 'busqueda' },
      ],
    }
    setRegistro(registroRef.current)
    estadoRef.current = 'sin-guardar'
    setEstadoDoc('sin-guardar')
    programarGuardado()
    setAviso('Cita traída desde la búsqueda: es una pista; se está verificando.')
    if (verificarRef.current) verificarRef.current()
  }, [programarGuardado])

  const cargarEscrito = useCallback((cid) => {
    const ed = editorRef.current
    if (!ed) return
    setEstadoDoc('cargando')
    setError(null)
    setAviso(null)
    setVerificacion(null)
    setAcciones({})
    setConflictoRev(null)
    rest('/escrito?case_id=' + encodeURIComponent(cid)).then((d) => {
      casoRef.current = cid
      if (d && d.existe) {
        ed.commands.setContent(d.html || d.texto || '')
        revRef.current = d.rev
        registroRef.current = d.registro || {}
      } else {
        ed.commands.setContent('')
        revRef.current = 0
        registroRef.current = {}
      }
      textoGuardadoRef.current = textoDelEditor(ed)
      setRegistro(registroRef.current)
      setEstadoDoc('guardado')
      actualizarInfoDoc(ed)
      const pendientes = tomarCitas()
      if (pendientes.length) {
        const ahora = new Date().toISOString()
        const nuevas = []
        for (const p of pendientes) {
          const seguro = String(p.cita).replace(/&/g, '&amp;')
            .replace(/</g, '&lt;').replace(/>/g, '&gt;')
          ed.chain().insertContentAt(ed.state.doc.content.size,
            '<p>' + seguro + '.</p>').run()
          nuevas.push({
            cita: p.cita, gid: p.gid, nodo_id: p.nodo_id,
            fecha: ahora, origen: 'busqueda',
          })
        }
        const reg = registroRef.current
        registroRef.current = {
          ...reg, pistas: [...(reg.pistas || []), ...nuevas],
        }
        setRegistro(registroRef.current)
        estadoRef.current = 'sin-guardar'
        setEstadoDoc('sin-guardar')
        programarGuardado()
        setAviso('Cita traída desde la búsqueda: es una pista; se está verificando.')
        if (verificarRef.current) verificarRef.current()
      }
    }).catch((e) => {
      setEstadoDoc('sin-guardar')
      setError(e)
    })
  }, [actualizarInfoDoc, programarGuardado])

  const recargarListaCasos = useCallback((seleccionarId = null) => {
    return rest('/nif/casos').then((d) => {
      const lista = (d && d.cases) || []
      setCasos(lista)
      if (seleccionarId) {
        setCaseId(seleccionarId)
        cargarEscrito(seleccionarId)
      }
      return lista
    }).catch(() => {
      setCasos([])
      return []
    })
  }, [cargarEscrito])

  // Montaje del editor Tiptap (una sola vez) + primera carga
  useEffect(() => {
    const ed = montarEditor({
      element: hostRef.current,
      content: '',
      placeholder: 'Comience a redactar su escrito aquí…',
      onUpdate: (editor) => {
        const texto = textoDelEditor(editor)
        if (texto === textoGuardadoRef.current) {
          setEstadoDoc((s) => (s === 'guardando' || s === 'conflicto' ? s : 'guardado'))
        } else if (estadoRef.current !== 'conflicto' && estadoRef.current !== 'cargando') {
          setEstadoDoc('sin-guardar')
          programarGuardado()
        }
        if (infoDocRef.current.texto !== texto) {
          infoDocRef.current = { texto, hash: null }
          setDocInfo(infoDocRef.current)
        }
        programarInfoDoc(editor)
        if (editorRef.prediccionPedir) editorRef.prediccionPedir(editor)
      },
      onAceptarPrediccion: (s) => {
        if (editorRef.prediccionAceptada) editorRef.prediccionAceptada(s)
      },
    })
    editorRef.current = ed
    rest('/nif/casos').then((d) => {
      const lista = (d && d.cases) || []
      setCasos(lista)
      if (lista.length) {
        const cid = lista[0].case_id
        setCaseId(cid)
        cargarEscrito(cid)
      } else {
        cargarEscrito(BORRADOR)
      }
    }).catch(() => {
      setCasos([])
      cargarEscrito(BORRADOR)
    })
    return () => {
      clearTimeout(timerGuardado.current)
      clearTimeout(timerInfo.current)
      // Al desmontar (otra pestaña, Grafo 3D) el debounce pendiente se pierde:
      // volcar los cambios de registro/documento antes de destruir el editor.
      if (estadoRef.current === 'sin-guardar') {
        guardar()
      }
      ed.destroy()
      editorRef.current = null
    }
  }, [cargarEscrito, guardar, programarGuardado, programarInfoDoc])

  // Modo Escribir vs Leer
  useEffect(() => {
    const ed = editorRef.current
    if (!ed) return
    ed.setEditable(modoVista !== 'read', false)
  }, [modoVista])

  // Recalcular marcas de citas en el documento
  useEffect(() => {
    const ed = editorRef.current
    if (!ed) return
    const v = verificacionRef.current
    if (!v) {
      fijarMarcas(ed, [])
      return
    }
    const detalles = v.resultado.detalles || []
    const info = infoDocRef.current
    const segs = segmentosDeDoc(ed.state.doc)
    const marcas = []
    for (const h of localizarCitas(info.texto, detalles)) {
      const estado = estadoCita(detalles[h.indiceDetalle], v.hash, info.hash, registroRef.current)
      for (const r of rangosAPos(segs, h.inicio, h.fin)) {
        marcas.push({ from: r.from, to: r.to, estado })
      }
    }
    fijarMarcas(ed, marcas)
  }, [verificacion, docInfo, registro])
  verificacionRef.current = verificacion

  const verificar = useCallback(() => {
    const ed = editorRef.current
    if (!ed || verificando) return
    setVerificando(true)
    setError(null)
    const texto = textoDelEditor(ed)
    rest('/verificar', { method: 'POST', body: { texto }, timeoutMs: 320000 })
      .then((resultado) => sha256Hex(texto).then((hash) => {
        setVerificacion({ resultado, hash })
        setAcciones({})
        actualizarInfoDoc(ed)
        // Si hay fallos, abrir automáticamente el panel lateral de citas
        if (resultado && resultado.meta && resultado.meta.citas_fallidas > 0) {
          setHerramientaActiva((prev) => prev || 'citas')
        }
      }))
      .catch(setError)
      .finally(() => setVerificando(false))
  }, [verificando, actualizarInfoDoc])
  verificarRef.current = verificar

  const cambiarCaso = useCallback((cid) => {
    clearTimeout(timerGuardado.current)
    const continuar = () => {
      setCaseId(cid)
      cargarEscrito(cid)
    }
    if (estadoRef.current === 'sin-guardar') {
      guardar().then(() => {
        if (estadoRef.current !== 'conflicto') continuar()
      })
    } else {
      continuar()
    }
  }, [cargarEscrito, guardar])

  const crearNuevoCasoNif = useCallback((nuevoId, pregunta) => {
    rest('/nif/init', {
      method: 'POST',
      body: { case_id: nuevoId, pregunta },
      timeoutMs: 60000,
    }).then(() => recargarListaCasos(nuevoId)).catch(setError)
  }, [recargarListaCasos])

  const sembrarCasoDemo = useCallback(() => {
    rest('/nif/seed', {
      method: 'POST',
      body: { case_id: 'demo-panel' },
      timeoutMs: 60000,
    }).then(() => recargarListaCasos('demo-panel')).catch(setError)
  }, [recargarListaCasos])

  const cargarEscritoDemo = useCallback(() => {
    const ed = editorRef.current
    if (!ed) return
    rest('/escrito/demo').then((d) => {
      if (d && (d.html || d.texto)) {
        ed.commands.setContent(d.html || d.texto)
        setAviso('Escrito sintético de demostración cargado. Pulsa «Verificar citas» para probar el motor.')
      }
    }).catch(setError)
  }, [])

  const insertarTextoEnEditor = useCallback((texto) => {
    const ed = editorRef.current
    if (!ed || !texto) return
    const limpio = String(texto).trim()
    if (!limpio) return
    const parrafos = limpio
      .split(/\n\s*\n/)
      .map((p) => '<p>' + p.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br/>') + '</p>')
      .join('')
    ed.chain().focus().insertContentAt(ed.state.doc.content.size, parrafos).run()
  }, [])

  const agregarNotaAPizarra = useCallback((datosNota) => {
    const actual = (registroRef.current && registroRef.current.pizarra) || {}
    const nodos = Array.isArray(actual.nodos) ? actual.nodos : []
    const idx = nodos.length
    const nueva = {
      id: 'nota-' + Date.now().toString(36) + '-' + idx,
      x: 24 + (idx % 4) * 248,
      y: 22 + Math.floor(idx / 4) * 175,
      w: 232,
      h: 155,
      titulo: datosNota.titulo || 'Nota ' + (idx + 1),
      tag: datosNota.tag || 'NOTA',
      color: datosNota.color || '#bfdbfe',
      texto: datosNota.texto || '',
      nodo_id: datosNota.nodo_id || null,
      gid: datosNota.gid || null,
      minimizada: false,
    }
    actualizarRegistro((r) => ({
      ...(r || {}),
      pizarra: { ...actual, nodos: [...nodos, nueva], colapsada: false },
    }))
  }, [actualizarRegistro])

  const recargarTrasConflicto = useCallback(() => {
    cargarEscrito(casoRef.current)
  }, [cargarEscrito])

  const fijarRegistro = useCallback((nuevo) => {
    registroRef.current = nuevo
    setRegistro(nuevo)
    return guardar()
  }, [guardar])

  // Acción sobre una cita del panel (índice en resultado.detalles)
  const accionCita = useCallback((indice, tipo, valor) => {
    const ed = editorRef.current
    const v = verificacionRef.current
    if (!ed || !v) return
    const detalle = (v.resultado.detalles || [])[indice]
    if (!detalle) return
    const ahora = () => new Date().toISOString()
    const ubicar = () => {
      const texto = textoDelEditor(ed)
      const segs = segmentosDeDoc(ed.state.doc)
      return localizarCitas(texto, [detalle])
        .map((h) => rangoAPos(segs, h.inicio, h.fin))
        .filter(Boolean)
    }
    if (tipo === 'probar') {
      const prev = acciones[indice] || {}
      setAcciones((m) => ({ ...m, [indice]: { ...prev, ocupado: true } }))
      rest('/verificar', { method: 'POST', body: { texto: valor }, timeoutMs: 320000 })
        .then((res) => {
          const dets = res.detalles || []
          const ok = dets.length >= 1 && dets.every((d) => d.estado === 'VERIFICADA')
          const primerFallo = dets.find((d) => d.estado !== 'VERIFICADA')
          setAcciones((m) => ({
            ...m,
            [indice]: {
              intentos: (prev.intentos || 0) + 1,
              ocupado: false,
              probado: ok,
              probadoTexto: ok ? valor : null,
              resumenPrueba: ok
                ? 'El motor verificó el reemplazo: aplícalo y vuelve a verificar el escrito.'
                : 'FALLO del reemplazo: ' +
                  ((primerFallo && primerFallo.resolucion) || res.veredicto || 'sin detalle'),
            },
          }))
        })
        .catch((e) => setAcciones((m) => ({
          ...m,
          [indice]: { ...prev, ocupado: false, resumenPrueba: 'Error: ' + mensajeError(e) },
        })))
      return
    }
    if (tipo === 'aplicar') {
      reemplazarRangos(ed, ubicar(), valor)
      setAcciones((m) => ({ ...m, [indice]: { intentos: 0, probado: false } }))
      return
    }
    if (tipo === 'retirar') {
      const rangos = ubicar()
      if (rangos.length) {
        borrarRangos(ed, rangos)
        setAviso('Cita retirada del texto: la frase puede quedar rota, revísala.')
      }
      const reg = registroRef.current
      fijarRegistro({
        ...reg,
        retiros: [...(reg.retiros || []),
          { cita_raw: detalle.cita_raw, motivo: valor, fecha: ahora() }],
      })
      return
    }
    if (tipo === 'escalar') {
      const reg = registroRef.current
      fijarRegistro({
        ...reg,
        escaladas: [...(reg.escaladas || []),
          { cita_raw: detalle.cita_raw, nota: valor, fecha: ahora() }],
      })
    }
  }, [acciones, fijarRegistro])

  // --- Derivados de vista ---------------------------------------------------

  const v = verificacion
  const res = v && v.resultado
  const meta = (res && res.meta) || {}
  const detalles = (res && res.detalles) || []
  const msgVeredicto = res && mensajeVeredicto(res.veredicto)

  const temaActual = TEMAS_HOJA[prefs.tema_papel] || TEMAS_HOJA.clasico
  const anchoActual = ANCHOS_HOJA[prefs.ancho_hoja] || ANCHOS_HOJA.a4
  const cfgHerramienta = HERRAMIENTAS_BARRA.find((h) => h.id === herramientaActiva) || null
  const pizarraEstado = (registro && registro.pizarra) || { nodos: [], aristas: [], colapsada: false, altura: 225 }

  return jsxs('div', {
    className: 'flex flex-col flex-1 min-h-0 overflow-hidden rounded-md border border-slate-300 bg-white shadow-xs',
    style: { minHeight: '760px' },
    children: [
      // 1. Barra de formato y documento estilo Word (2 filas, como imagen 2)
      jsx(BarraFormato, {
        editorRef,
        caseId,
        casos,
        onCambiarCaso: cambiarCaso,
        onCrearCaso: crearNuevoCasoNif,
        onSembrarDemoCaso: sembrarCasoDemo,
        onCargarEscritoDemo: cargarEscritoDemo,
        onGuardarAhora: guardar,
        estadoDoc,
        verificando,
        onVerificar: verificar,
        verificacion,
        modoVista,
        onCambiarModoVista: setModoVista,
        prefs,
        onCambiarPrefs: guardarPrefs,
        docInfo,
        onAbrirHerramienta: (id) => setHerramientaActiva((prev) => (prev === id ? null : id)),
      }),

      // 2. Pizarra Estratégica encima del editor (colapsable y redimensionable)
      modoVista !== 'read' && prefs.mostrar_pizarra !== false
        ? jsx(PizarraEstrategica, {
            pizarra: pizarraEstado,
            onChange: (nuevaPizarra) => actualizarRegistro((r) => ({ ...(r || {}), pizarra: nuevaPizarra })),
            onInsertarTexto: insertarTextoEnEditor,
            onLlevarCitaAlEscrito: insertarCitaEnEscrito,
            onAbrirGrafo,
          })
        : null,

      // Banners de conflicto, error o aviso
      estadoDoc === 'conflicto' ? jsxs('div', {
        className: 'flex items-center gap-3 border-b border-amber-300 bg-amber-50 px-4 py-1.5 text-xs text-amber-900 shrink-0',
        children: [
          jsx('span', { className: 'flex-1', children:
            'Otro proceso guardó este escrito' +
            (conflictoRev != null ? ' (rev ' + conflictoRev + ')' : '') + '.' }),
          jsx('button', {
            type: 'button',
            onClick: recargarTrasConflicto,
            className: 'rounded border border-amber-400 bg-white px-2 py-0.5 font-medium text-amber-900 hover:bg-amber-100 cursor-pointer',
            children: 'descargar y perder mis cambios',
          }),
        ],
      }) : null,

      error ? jsxs('div', {
        className: 'flex items-center justify-between border-b border-red-200 bg-red-50 px-4 py-1.5 text-xs text-red-700 shrink-0',
        children: [
          jsx('span', { children: mensajeError(error) }),
          jsx('button', { type: 'button', onClick: () => setError(null), className: 'text-red-500 hover:text-red-800', children: '✕' }),
        ],
      }) : null,

      aviso ? jsxs('div', {
        className: 'flex items-center justify-between border-b border-sky-200 bg-sky-50 px-4 py-1 text-xs text-sky-800 shrink-0',
        children: [
          jsx('span', { children: aviso }),
          jsx('button', { type: 'button', onClick: () => setAviso(null), className: 'text-sky-600 hover:text-sky-900', children: '✕' }),
        ],
      }) : null,

      // 3. Área principal: Centro (Hoja Word) + Cajón de Herramienta + Barra de Iconos + Chat Hermes
      jsxs('div', {
        className: 'flex flex-1 min-h-0 overflow-hidden',
        children: [
          // ── COLUMNA CENTRAL: Lienzo gris con Hoja de Papel tipo Word ──
          jsxs('div', {
            className: 'flex flex-col flex-1 min-w-0 min-h-0 overflow-hidden',
            children: [
              // Entorno gris desplazable con la hoja centrada
              jsxs('div', {
                className: 'flex-1 overflow-y-auto flex justify-center py-6 px-4',
                style: { backgroundColor: temaActual.entorno },
                children: [
                  jsxs('div', {
                    className: 'dike-editor-page transition-all',
                    style: {
                      width: anchoActual.width,
                      maxWidth: '100%',
                      minHeight: '297mm',
                      backgroundColor: temaActual.hojaBg,
                      color: temaActual.hojaTexto,
                      border: '1px solid ' + temaActual.hojaBorde,
                      boxShadow: '0 2px 12px rgba(0, 0, 0, 0.14)',
                      padding: anchoActual.padding,
                      fontFamily: prefs.fuente || "Georgia, 'Times New Roman', serif",
                      fontSize: (prefs.tamano_fuente || '12') + 'pt',
                      lineHeight: '1.65',
                    },
                    children: [
                      modoVista === 'read' ? jsxs('div', {
                        className: 'mb-4 flex items-center justify-between rounded border border-slate-200 bg-slate-50 px-3 py-1.5 font-sans text-xs text-slate-600',
                        children: [
                          jsx('span', { children: '📖 Modo lectura — edición bloqueada para revisar texto y citas' }),
                          jsx('button', {
                            type: 'button',
                            onClick: () => setModoVista('write'),
                            className: 'font-semibold text-indigo-600 hover:underline cursor-pointer',
                            children: 'Volver a Escribir',
                          }),
                        ],
                      }) : null,
                      // Contenedor Tiptap ProseMirror
                      jsx('div', { ref: hostRef }),
                    ],
                  }),
                ],
              }),

              // Barra flotante de estado de citas (como CitationStatus en imagen 2)
              res ? jsxs('div', {
                className: 'flex flex-wrap items-center justify-between gap-2 border-t px-3 py-1.5 text-xs shrink-0 ' +
                  (res.error || (meta.citas_fallidas || 0) > 0
                    ? 'border-amber-200 bg-amber-50 text-amber-900'
                    : 'border-emerald-200 bg-emerald-50 text-emerald-900'),
                children: [
                  res.error
                    ? jsx('span', { children: 'Diké no pudo revisar el escrito: ' + String(res.error) })
                    : jsxs('div', { className: 'flex flex-wrap items-center gap-2', children: [
                        jsx('span', { className: 'font-semibold', children:
                          `🛡 Diké: ${meta.citas_verificadas || 0} de ${meta.total_citas || 0} citas verificadas` +
                          (res.veredicto ? ` (${res.veredicto})` : '') }),
                        jsx('span', { className: 'text-[11px] opacity-80', children:
                          `corpus ${meta.pack_hash || '?'}` + (meta.as_of ? ` · al ${meta.as_of}` : '') }),
                      ] }),
                  jsx('button', {
                    type: 'button',
                    onClick: () => setHerramientaActiva('citas'),
                    className: 'rounded bg-white/80 hover:bg-white px-2 py-0.5 text-[11px] font-semibold border border-current/20 cursor-pointer',
                    children: herramientaActiva === 'citas' ? 'Viendo detalle en barra derecha' : 'Ver detalle y reparar citas →',
                  }),
                ],
              }) : null,

              // Barra inferior de custodia y persistencia local (como PersistenceBar en imagen 2)
              jsxs('div', {
                className: 'flex flex-wrap items-center gap-2 border-t border-slate-200 bg-slate-50 px-3 py-1 text-[11px] text-slate-600 select-none shrink-0',
                children: [
                  jsx('span', { className: 'text-slate-400', children: 'Datos:' }),
                  jsx('span', {
                    className: 'inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-0.5 font-medium text-slate-700',
                    children: '🔒 Guardado local en este equipo (plugin-data)',
                  }),
                  jsx('span', {
                    className: 'text-slate-400 hidden sm:inline truncate',
                    children: 'El escrito vive en tu equipo; hacia el modelo viaja seudonimizado.',
                  }),
                  jsxs('div', { className: 'ml-auto flex items-center gap-1.5', children: [
                    jsx('span', { className: 'text-slate-400', children: 'Papel:' }),
                    ...Object.entries(TEMAS_HOJA).map(([tid, tmeta]) => jsx('button', {
                      key: tid,
                      type: 'button',
                      onClick: () => guardarPrefs({ tema_papel: tid }),
                      className: 'rounded px-1.5 py-0.2 text-[10px] cursor-pointer ' +
                        (prefs.tema_papel === tid ? 'bg-slate-800 text-white font-semibold' : 'text-slate-500 hover:bg-slate-200'),
                      children: tmeta.label.split(' ')[1] || tmeta.label,
                    })),
                  ] }),
                ],
              }),
            ],
          }),

          // ── CAJÓN DESLIZANTE DE LA HERRAMIENTA ACTIVA (a la izquierda de la barra de iconos) ──
          jsxs('div', {
            className: (herramientaActiva ? 'flex ' : 'hidden ') +
              'w-[400px] xl:w-[430px] shrink-0 flex-col border-l border-slate-200 bg-white overflow-hidden',
            children: [
              // Cabecera del cajón
              cfgHerramienta ? jsxs('div', {
                className: 'flex items-center justify-between border-b px-3 py-2 shrink-0 ' + cfgHerramienta.headerCls,
                children: [
                  jsxs('div', { className: 'flex items-center gap-2 min-w-0', children: [
                    jsx('span', { className: 'text-sm font-bold', children: cfgHerramienta.icono }),
                    jsx('span', { className: 'text-xs font-bold uppercase tracking-wide truncate', children: cfgHerramienta.titulo }),
                  ] }),
                  jsx('button', {
                    type: 'button',
                    onClick: () => setHerramientaActiva(null),
                    title: 'Cerrar panel de herramienta',
                    className: 'rounded p-1 text-xs opacity-70 hover:opacity-100 hover:bg-black/5 cursor-pointer',
                    children: '✕',
                  }),
                ],
              }) : null,

              // Contenido del cajón (Privacidad y Predicción permanecen montados para mantener efectos)
              jsxs('div', {
                className: 'flex-1 min-h-0 overflow-y-auto',
                children: [
                  // 1. Herramienta: Verificador de Citas Diké
                  herramientaActiva === 'citas' ? jsxs('div', {
                    className: 'flex flex-col gap-3 p-3 text-xs text-slate-800',
                    children: [
                      jsxs('div', { className: 'flex items-center justify-between gap-2', children: [
                        jsx('span', { className: 'text-slate-600', children: 'Verificación determinista contra las 25 leyes del corpus sellado.' }),
                        jsx('button', {
                          type: 'button',
                          onClick: verificar,
                          disabled: verificando || estadoDoc === 'cargando',
                          className: 'rounded bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 px-3 py-1 text-xs font-semibold text-white cursor-pointer shrink-0',
                          children: verificando ? 'Verificando…' : 'Verificar citas',
                        }),
                      ] }),

                      !res && !verificando ? jsx('div', {
                        className: 'rounded border border-dashed border-slate-300 p-4 text-center text-slate-500',
                        children: 'Pulsa «Verificar citas» para comprobar todas las referencias normativas del escrito.',
                      }) : null,

                      res && res.error ? jsxs('div', {
                        className: 'rounded border border-red-200 bg-red-50 p-2.5 text-red-800',
                        children: [
                          jsx('span', { className: S.chip + ' ' + S.chipBad, children: 'sin revisar' }),
                          jsx('div', { className: 'mt-1', children: 'Diké no pudo revisar el escrito: ' + String(res.error) }),
                        ],
                      }) : null,

                      res && !res.error ? jsxs('div', { className: 'flex flex-col gap-2', children: [
                        jsx('div', { className: 'font-semibold text-slate-900', children:
                          'Diké: ' + (meta.citas_verificadas || 0) + ' de ' + (meta.total_citas || 0) +
                          ' citas verificadas' + (res.veredicto ? ' (' + res.veredicto + ')' : '') +
                          ' · corpus ' + (meta.pack_hash || '?') +
                          (meta.as_of ? ' · al ' + meta.as_of : '') }),
                        msgVeredicto ? jsx('div', { className: 'text-[11px] text-slate-600', children: msgVeredicto }) : null,

                        ...detalles.map((d, i) => {
                          const estado = estadoCita(d, v.hash, docInfo.hash, registro)
                          const es = ESTILOS_ESTADO[estado] || ESTILOS_ESTADO.fallo
                          return jsxs('div', { key: i, className: 'flex items-start gap-2 border-b border-slate-200 py-2 last:border-0', children: [
                            jsx('span', {
                              className: 'w-4 shrink-0 text-center font-bold ' + (estado === 'verificada' ? 'text-emerald-600' : (estado === 'fallo' ? 'text-red-600' : 'text-slate-400')),
                              children: estado === 'verificada' ? '✓' : (estado === 'fallo' ? '✗' : '·'),
                            }),
                            jsxs('div', { className: 'min-w-0 flex-1', children: [
                              jsxs('div', { className: 'flex flex-wrap items-center gap-1.5', children: [
                                jsx('span', { className: 'font-medium text-slate-900', children: d.cita_raw }),
                                estado === 'verificada' && d.nodo_id && onAbrirGrafo
                                  ? jsx('button', {
                                      type: 'button',
                                      className: S.chip + ' ' + S[es.chip] + ' cursor-pointer',
                                      title: 'Abrir el artículo en el grafo 3D',
                                      onClick: () => onAbrirGrafo({ nodo_id: d.nodo_id }),
                                      children: es.texto + ' · grafo',
                                    })
                                  : jsx('span', { className: S.chip + ' ' + S[es.chip], children: es.texto }),
                              ] }),
                              jsx('div', { className: 'mt-0.5 break-all text-[11px] text-slate-500', children: etiquetaCita(estado, d, meta, registro) }),
                              estado === 'fallo'
                                ? jsx(AccionesFallo, { detalle: d, acciones: acciones[i], onAccion: (t, val) => accionCita(i, t, val) })
                                : null,
                            ] }),
                          ] })
                        }),

                        (res.problemas && res.problemas.length) ? jsxs('div', {
                          className: 'rounded border border-amber-200 bg-amber-50 p-2',
                          children: [
                            jsx('div', { className: 'text-[10px] font-bold uppercase text-amber-800', children: 'Problemas del motor' }),
                            ...res.problemas.map((p, i) => jsx('div', { key: i, className: 'text-[11px] text-amber-900', children: String(p) })),
                          ],
                        }) : null,

                        (res.no_verificadas && res.no_verificadas.length) ? jsx('div', {
                          className: 'text-[11px] text-slate-500',
                          children: 'Menciones sin artículo, no verificadas: ' + res.no_verificadas.join(', '),
                        }) : null,

                        ((registro.retiros && registro.retiros.length) || (registro.escaladas && registro.escaladas.length)) ? jsxs('details', {
                          className: 'text-xs',
                          children: [
                            jsx('summary', { className: 'cursor-pointer text-slate-500', children:
                              'Registro: ' + ((registro.retiros || []).length) + ' retiradas · ' +
                              ((registro.escaladas || []).length) + ' escaladas' }),
                            ...(registro.retiros || []).map((r, i) => jsxs('div', { key: 'r' + i, className: 'py-0.5 text-[11px]', children: [
                              jsx('span', { className: 'text-slate-400', children: String(r.fecha || '').slice(0, 19).replace('T', ' ') + ' · ' }),
                              jsx('span', { children: 'Retirada — ' + r.cita_raw + ' · ' + r.motivo }),
                            ] })),
                            ...(registro.escaladas || []).map((e, i) => jsxs('div', { key: 'e' + i, className: 'py-0.5 text-[11px]', children: [
                              jsx('span', { className: 'text-slate-400', children: String(e.fecha || '').slice(0, 19).replace('T', ' ') + ' · ' }),
                              jsx('span', { children: 'Escalada — ' + e.cita_raw + ' · ' + e.nota }),
                            ] })),
                          ],
                        }) : null,

                        jsx('div', { className: 'text-[11px] text-slate-400 pt-1 border-t border-slate-100', children: AVISO_JUICIO }),
                        res.alcance ? jsx('div', { className: 'text-[11px] text-slate-400', children: res.alcance }) : null,
                      ] }) : null,
                    ],
                  }) : null,

                  // 2. Herramienta: Privacidad y Anonimizado (siempre montada para mantener autodetección)
                  jsx('div', {
                    className: herramientaActiva === 'privacidad' ? 'p-3' : 'hidden',
                    children: jsx(ModuloPrivacidad, {
                      editorRef,
                      caseId,
                      docInfo,
                      registro,
                      setRegistro: actualizarRegistro,
                    }),
                  }),

                  // 3. Herramienta: Revisión de Estilo — LexO Escribe Claro
                  herramientaActiva === 'estilo' ? jsx(PanelEscribeClaro, {
                    editorRef,
                    docInfo,
                    contextoInicial: prefs.contexto_estilo,
                    autoAnalizarInicial: prefs.auto_analizar_estilo,
                    onEnviarAPizarra: (nuevaPizarra) => {
                      actualizarRegistro((r) => ({ ...(r || {}), pizarra: nuevaPizarra }))
                      guardarPrefs({ mostrar_pizarra: true })
                    },
                  }) : null,

                  // 4. Herramienta: NIF Interactivo + NIF Vivo
                  herramientaActiva === 'nif' ? jsx(NifInteractivoEscritor, {
                    editorRef,
                    caseId,
                    registro,
                    setRegistro: actualizarRegistro,
                    sesion: chatSesion,
                    tieneNif: caseId !== BORRADOR,
                    onCrearCaso: crearNuevoCasoNif,
                    onSembrarDemoCaso: sembrarCasoDemo,
                    onAgregarAPizarra: agregarNotaAPizarra,
                    onInsertarTexto: insertarTextoEnEditor,
                  }) : null,

                  // 5. Herramienta: Grafos (Corpus BM25 + Constructor de Ordenamientos + 3D)
                  herramientaActiva === 'grafos' ? jsx(PanelHerramientasGrafos, {
                    onLlevarCitaAlEscrito: insertarCitaEnEscrito,
                    onAgregarAPizarra: agregarNotaAPizarra,
                    onAbrirGrafo3D: (foco) => {
                      if (onAbrirGrafo) onAbrirGrafo(foco || { nodo_id: 'n:207436' })
                    },
                  }) : null,

                  // 6. Herramienta: Personalización de Usuario + Predicción (siempre montada para ghost text)
                  jsxs('div', {
                    className: herramientaActiva === 'ajustes' ? 'flex flex-col gap-3 p-3 text-xs text-slate-800' : 'hidden',
                    children: [
                      // Bloque de personalización pensado para usuarios terceros
                      jsxs('div', {
                        className: 'flex flex-col gap-2.5 rounded-md border border-slate-200 bg-slate-50 p-3',
                        children: [
                          jsx('div', { className: 'text-[10px] font-bold uppercase tracking-wider text-slate-500', children: 'Personalización del Estudio (Preferencias de Usuario)' }),
                          jsxs('div', { className: 'flex items-center justify-between gap-2', children: [
                            jsx('label', { className: 'text-slate-700', children: 'Tema de la hoja:' }),
                            jsx('select', {
                              value: prefs.tema_papel,
                              onChange: (e) => guardarPrefs({ tema_papel: e.target.value }),
                              className: 'rounded border border-slate-300 bg-white px-2 py-1 text-xs',
                              children: Object.entries(TEMAS_HOJA).map(([k, v]) =>
                                jsx('option', { key: k, value: k, children: v.label })),
                            }),
                          ] }),
                          jsxs('div', { className: 'flex items-center justify-between gap-2', children: [
                            jsx('label', { className: 'text-slate-700', children: 'Formato de página:' }),
                            jsx('select', {
                              value: prefs.ancho_hoja,
                              onChange: (e) => guardarPrefs({ ancho_hoja: e.target.value }),
                              className: 'rounded border border-slate-300 bg-white px-2 py-1 text-xs',
                              children: Object.entries(ANCHOS_HOJA).map(([k, v]) =>
                                jsx('option', { key: k, value: k, children: v.label })),
                            }),
                          ] }),
                          jsxs('div', { className: 'flex items-center justify-between gap-2', children: [
                            jsx('label', { className: 'text-slate-700', children: 'Estrategia de privacidad inicial:' }),
                            jsx('select', {
                              value: prefs.estrategia_privacidad,
                              onChange: (e) => {
                                const est = e.target.value
                                guardarPrefs({ estrategia_privacidad: est })
                                actualizarRegistro((r) => ({ ...(r || {}), privacidad: { ...(r || {}).privacidad, estrategia: est } }))
                              },
                              className: 'rounded border border-slate-300 bg-white px-2 py-1 text-xs',
                              children: [
                                jsx('option', { key: 'ligera', value: 'ligera', children: 'Ligera (solo críticos)' }),
                                jsx('option', { key: 'media', value: 'media', children: 'Media (críticos + altos)' }),
                                jsx('option', { key: 'estricta', value: 'estricta', children: 'Estricta (+ medios y nombres)' }),
                              ],
                            }),
                          ] }),
                          jsxs('label', { className: 'flex items-center gap-2 text-slate-700 pt-1', children: [
                            jsx('input', {
                              type: 'checkbox',
                              checked: prefs.mostrar_pizarra !== false,
                              onChange: (e) => guardarPrefs({ mostrar_pizarra: e.target.checked }),
                            }),
                            'Mostrar Pizarra Estratégica encima del escrito',
                          ] }),
                          jsxs('label', { className: 'flex items-center gap-2 text-slate-700', children: [
                            jsx('input', {
                              type: 'checkbox',
                              checked: chatAbierto,
                              onChange: (e) => guardarPrefs({ mostrar_chat: e.target.checked }),
                            }),
                            'Mostrar panel de Chat Hermes a la derecha',
                          ] }),
                        ],
                      }),

                      // Panel de Predicción por capas (L0/L1/L2)
                      jsx(PrediccionPanel, {
                        editorRef,
                        caseId,
                        docInfo,
                        verificacion,
                        registro,
                        setRegistro: actualizarRegistro,
                        sesion: chatSesion,
                      }),
                    ],
                  }),
                ],
              }),
            ],
          }),

          // ── BARRA VERTICAL DE HERRAMIENTAS A LA DERECHA (estilo VS Code / imagen 2) ──
          jsxs('div', {
            className: 'flex w-11 shrink-0 flex-col items-center gap-1.5 border-l border-slate-200 bg-slate-50 py-2 select-none',
            children: [
              ...HERRAMIENTAS_BARRA.map((t) => {
                const activa = herramientaActiva === t.id
                let badge = null
                if (t.id === 'citas' && res && !res.error) {
                  const fallos = meta.citas_fallidas || 0
                  badge = fallos > 0
                    ? jsx('span', { className: 'absolute -top-1 -right-1 rounded-full bg-red-600 px-1 text-[9px] font-bold text-white', children: String(fallos) })
                    : (meta.total_citas > 0
                        ? jsx('span', { className: 'absolute -top-1 -right-1 rounded-full bg-emerald-600 px-1 text-[9px] font-bold text-white', children: String(meta.citas_verificadas) })
                        : null)
                }
                return jsxs('button', {
                  key: t.id,
                  type: 'button',
                  title: t.label,
                  onClick: () => setHerramientaActiva((prev) => (prev === t.id ? null : t.id)),
                  className: 'relative flex h-8 w-8 items-center justify-center rounded-lg text-sm font-semibold transition-colors cursor-pointer ' +
                    (activa ? t.activeCls : 'text-slate-500 hover:bg-slate-200/80 hover:text-slate-900'),
                  children: [
                    jsx('span', { children: t.icono }),
                    badge,
                  ],
                })
              }),

              jsx('div', { className: 'my-1 h-px w-6 bg-slate-200' }),

              // Botón para mostrar/ocultar el panel de Chat Hermes a la derecha
              jsx('button', {
                type: 'button',
                title: chatAbierto ? 'Ocultar panel de Chat Hermes' : 'Mostrar panel de Chat Hermes a la derecha',
                onClick: () => guardarPrefs({ mostrar_chat: !chatAbierto }),
                className: 'flex h-8 w-8 items-center justify-center rounded-lg text-sm transition-colors cursor-pointer ' +
                  (chatAbierto ? 'bg-slate-800 text-white shadow-xs' : 'text-slate-500 hover:bg-slate-200 hover:text-slate-900'),
                children: '💬',
              }),
            ],
          }),

          // ── PANEL DERECHO CONECTADO CON HERMES (Chat del escrito, siempre montado) ──
          jsx('div', {
            className: (chatAbierto ? 'flex ' : 'hidden ') +
              'w-[340px] xl:w-[375px] shrink-0 flex-col border-l border-slate-200 bg-white overflow-hidden',
            children: jsx(ChatEscritor, {
              editorRef,
              caseId,
              docInfo,
              verificacion,
              registro,
              setRegistro: actualizarRegistro,
              estrategiaPriv: ((registro || {}).privacidad || {}).estrategia || prefs.estrategia_privacidad,
              rev: revRef.current,
              onSesion: setChatSesion,
              onAbrirGrafo,
              onAbrirPrivacidad: () => setHerramientaActiva('privacidad'),
              modoDock: true,
            }),
          }),
        ],
      }),
    ],
  })
}
