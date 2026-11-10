import { t } from '../i18n.js'
import { etiquetaCodigo } from '../i18n.js'
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
import {
  cancelarTarea, mensajeError, programarTimeout, rest, storage, S,
} from '../common.js'
import {
  borrarPendiente, escribirPendiente, guardarConReintento, leerPendiente,
  pendienteDiff,
} from './guardado-logica.js'
import {
  borrarRangos, fijarMarcas, insertarHtmlEnCursor, montarEditor,
  reemplazarRangos, textoDelEditor,
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
    get label() { return t('writer.classic.paper') },
    entorno: '#e5e7eb',
    hojaBg: '#ffffff',
    hojaTexto: '#1a1a1a',
    hojaBorde: 'rgba(0,0,0,0.08)',
  },
  sepia: {
    get label() { return t('writer.warm.sepia') },
    entorno: '#e4ddd0',
    hojaBg: '#fdf6e3',
    hojaTexto: '#2b2118',
    hojaBorde: 'rgba(120,90,40,0.18)',
  },
  nocturno: {
    get label() { return t('writer.dark.ink') },
    entorno: '#0f172a',
    hojaBg: '#1e293b',
    hojaTexto: '#f1f5f9',
    hojaBorde: 'rgba(148,163,184,0.2)',
  },
}

const ANCHOS_HOJA = {
  a4: { label: 'A4 (210 mm)', width: '210mm', padding: '2.2cm 2.6cm' },
  carta: { get label() { return t('writer.letter.216.mm') }, width: '216mm', padding: '2.0cm 2.4cm' },
  ancho: { get label() { return t('writer.full.width') }, width: '100%', padding: '1.6rem 2.2rem' },
}

const HERRAMIENTAS_BARRA = [
  {
    id: 'citas',
    icono: '§',
    get label() { return t('writer.citation.check') },
    get titulo() { return t('writer.citation.check2') },
  },
  {
    id: 'privacidad',
    icono: '⊘',
    get label() { return t('writer.privacy.label') },
    get titulo() { return t('writer.privacy.and.pseudonymization.ley.21.719') },
  },
  {
    id: 'estilo',
    icono: 'Aa',
    get label() { return t('writer.plain.language.review') },
    get titulo() { return t('writer.plain.language.review2') },
  },
  {
    id: 'nif',
    icono: '▦',
    get label() { return t('writer.case.board.label') },
    get titulo() { return t('writer.case.board.and.suggested.updates') },
  },
  {
    id: 'grafos',
    icono: '◈',
    get label() { return t('writer.graphs.and.legal.systems') },
    get titulo() { return t('writer.corpus.graph.and.legal.systems') },
  },
  {
    id: 'ajustes',
    icono: '✦',
    get label() { return t('writer.settings.label') },
    get titulo() { return t('writer.settings.and.suggestions') },
  },
]

// --- Panel de una cita en FALLO: probar → reparar → retirar → escalar ---------

function AccionesFallo({ detalle, acciones, onAccion }) {
  const a = acciones || {}
  const [reparar, setReparar] = useState(detalle.cita_raw || '')
  const [motivo, setMotivo] = useState('')
  const [nota, setNota] = useState('')
  const agotados = (a.intentos || 0) >= MAX_INTENTOS_REPARAR
  return jsxs('div', { className: 'flex flex-col gap-1.5 mt-1.5 p-2 ' + S.noticeBad, children: [
    jsxs('div', { className: 'flex flex-wrap items-center gap-1.5', children: [
      jsx('input', {
        className: 'flex-1 min-w-36 rounded border border-(--dk-borde) bg-(--dk-elevada) px-2 py-1 text-xs text-(--dk-texto) outline-none',
        value: reparar,
        placeholder: t('writer.replacement.text'),
        disabled: agotados,
        onChange: (e) => setReparar(e.target.value),
      }),
      jsx('button', {
        type: 'button',
        className: 'dk-btn dk-btn--borde dk-btn--chico',
        disabled: agotados || a.ocupado || !reparar.trim(),
        onClick: () => onAccion('probar', reparar.trim()),
        children: a.ocupado ? t('writer.testing') : t('writer.test.replacement'),
      }),
      jsx('button', {
        type: 'button',
        className: 'dk-btn dk-btn--chico',
        disabled: !a.probado || agotados || reparar.trim() !== a.probadoTexto,
        onClick: () => onAccion('aplicar', a.probadoTexto),
        children: t('writer.apply'),
      }),
    ] }),
    a.resumenPrueba
      ? jsx('div', { className: 'text-xs text-(--dk-texto-2)', children: a.resumenPrueba })
      : null,
    agotados
      ? jsx('div', { className: S.bad + ' font-medium', children:
          t('writer.two.repair.attempts.failed.request.human.review') })
      : null,
    jsxs('div', { className: 'flex flex-wrap items-center gap-1.5', children: [
      jsx('input', {
        className: 'flex-1 min-w-28 rounded border border-(--dk-borde) bg-(--dk-elevada) px-2 py-1 text-xs text-(--dk-texto) outline-none',
        value: motivo,
        placeholder: t('writer.reason.for.removal'),
        onChange: (e) => setMotivo(e.target.value),
      }),
      jsx('button', {
        type: 'button',
        className: 'rounded border border-(--dk-borde) bg-(--dk-elevada) hover:bg-(--dk-sobre) px-2 py-1 text-xs text-(--dk-texto-2) disabled:opacity-40 cursor-pointer',
        disabled: !motivo.trim(),
        onClick: () => { onAccion('retirar', motivo.trim()); setMotivo('') },
        children: t('writer.remove'),
      }),
      jsx('input', {
        className: 'flex-1 min-w-28 rounded border border-(--dk-borde) bg-(--dk-elevada) px-2 py-1 text-xs text-(--dk-texto) outline-none',
        value: nota,
        placeholder: t('writer.note.for.human.review'),
        onChange: (e) => setNota(e.target.value),
      }),
      jsx('button', {
        type: 'button',
        className: 'rounded border border-(--dk-borde) bg-(--dk-elevada) hover:bg-(--dk-sobre) px-2 py-1 text-xs text-(--dk-texto-2) disabled:opacity-40 cursor-pointer',
        disabled: !nota.trim(),
        onClick: () => { onAccion('escalar', nota.trim()); setNota('') },
        children: t('writer.request.review'),
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
  // Guardado serializado: cada POST espera al anterior para que rev_base
  // nunca quede obsoleto por una escritura en vuelo. revPorCaso guarda la
  // revisión confirmada por caso (el editor solo muestra uno a la vez).
  const colaGuardadoRef = useRef(Promise.resolve())
  const revPorCasoRef = useRef({})
  const cargaSeqRef = useRef(0)
  const montadoRef = useRef(false)

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
      if (!montadoRef.current) return
      const info = { texto, hash }
      infoDocRef.current = info
      setDocInfo(info)
    }).catch(() => {})
  }, [])

  const programarInfoDoc = useCallback((ed) => {
    cancelarTarea(timerInfo.current)
    timerInfo.current = programarTimeout(() => actualizarInfoDoc(ed), DEBOUNCE_INFO)
  }, [actualizarInfoDoc])

  const estadoRef = useRef('cargando')
  estadoRef.current = estadoDoc

  // Ejecuta un guardado ya encolado. payload es una instantánea capturada al
  // pedir el guardado (caso, html, texto, registro): no lee el editor, así el
  // guardado de desmontaje sigue siendo correcto tras destruirlo.
  const enviarGuardado = useCallback(async (payload) => {
    const revDe = () => revPorCasoRef.current[payload.case_id] || 0
    const r = await guardarConReintento(
      (revBase) => rest('/escrito', {
        method: 'POST',
        body: {
          case_id: payload.case_id,
          html: payload.html,
          texto: payload.texto,
          rev_base: revBase === undefined ? revDe() : revBase,
          registro: payload.registro,
        },
      }),
      async () => {
        const d = await rest('/escrito?case_id=' +
          encodeURIComponent(payload.case_id))
        const rev = d && typeof d.rev === 'number' ? d.rev : null
        if (rev != null) revPorCasoRef.current[payload.case_id] = rev
        return rev
      })
    const esActual = payload.case_id === casoRef.current
    if (r.ok) {
      const rev = r.resp && typeof r.resp.rev === 'number' ? r.resp.rev : revDe()
      revPorCasoRef.current[payload.case_id] = rev
      // El guardado quedó en el servidor: cualquier pendiente de ese caso
      // (incluso de una sesión anterior) ya no hace falta.
      borrarPendiente(payload.case_id)
      if (esActual) {
        revRef.current = rev
        textoGuardadoRef.current = payload.texto
        if (montadoRef.current) setEstadoDoc('guardado')
      }
      return
    }
    // Falló: guardar la instantánea para que el próximo montaje la recupere.
    escribirPendiente(payload)
    if (!montadoRef.current || !esActual) return
    if (r.conflicto) {
      setEstadoDoc('conflicto')
      setConflictoRev(r.rev_actual != null ? r.rev_actual : null)
    } else {
      setEstadoDoc('sin-guardar')
      setError(r.error)
    }
  }, [])

  const guardar = useCallback(() => {
    cancelarTarea(timerGuardado.current)
    const ed = editorRef.current
    if (!ed || estadoRef.current === 'conflicto') return Promise.resolve()
    // El guardado es del caso visible (casoRef): reflejar «guardando» solo
    // si el componente sigue montado.
    if (montadoRef.current) setEstadoDoc('guardando')
    const payload = {
      case_id: casoRef.current,
      html: ed.getHTML(),
      texto: textoDelEditor(ed),
      registro: registroRef.current,
    }
    const promesa = colaGuardadoRef.current
      .then(() => enviarGuardado(payload))
    colaGuardadoRef.current = promesa.catch(() => {})
    return promesa
  }, [enviarGuardado])

  const programarGuardado = useCallback(() => {
    cancelarTarea(timerGuardado.current)
    timerGuardado.current = programarTimeout(() => { guardar() }, DEBOUNCE_GUARDADO)
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
    insertarHtmlEnCursor(ed, '<p>' + seguro + '.</p>')
    const reg = registroRef.current || {}
    registroRef.current = {
      ...reg,
      pistas: [
        ...(reg.pistas || []),
        { cita: p.cita, gid: p.gid, nodo_id: p.nodo_id, fecha: ahora, origen: 'busqueda' },
      ],
    }
    setRegistro(registroRef.current)
    if (estadoRef.current !== 'conflicto') {
      estadoRef.current = 'sin-guardar'
      setEstadoDoc('sin-guardar')
      programarGuardado()
    }
    setAviso(t('writer.search.lead.added.checking.the.citation'))
    if (verificarRef.current) verificarRef.current()
  }, [programarGuardado])

  const cargarEscrito = useCallback((cid) => {
    const ed = editorRef.current
    if (!ed) return
    // Guardia de secuencia (como pizarra.js): si el usuario cambió de caso
    // antes de que respondiera la carga anterior, la respuesta vieja se
    // descarta — el editor nunca muestra un caso que no es el seleccionado.
    const seq = ++cargaSeqRef.current
    setEstadoDoc('cargando')
    setError(null)
    setAviso(null)
    setVerificacion(null)
    setAcciones({})
    setConflictoRev(null)
    rest('/escrito?case_id=' + encodeURIComponent(cid)).then((d) => {
      // Además de la secuencia hace falta el montaje: si el componente se
      // fue (otra pestaña) con la carga en vuelo, `ed` ya está destruido y
      // setContent/estado no deben tocarlo.
      if (seq !== cargaSeqRef.current || !montadoRef.current) return
      casoRef.current = cid
      const rev = d && typeof d.rev === 'number' ? d.rev : 0
      revPorCasoRef.current[cid] = rev
      revRef.current = rev
      const htmlServidor = (d && d.existe) ? (d.html || d.texto || '') : ''
      const registroServidor = (d && d.existe && d.registro) || {}
      ed.commands.setContent(htmlServidor)
      registroRef.current = registroServidor
      textoGuardadoRef.current = textoDelEditor(ed)
      setRegistro(registroRef.current)

      // Guardado que falló al desmontar: si la instantánea difiere de lo que
      // trajo el servidor, restaurarla y reintentar el guardado.
      const pend = leerPendiente(cid)
      const restaura = pend && pendienteDiff(pend, {
        texto: textoGuardadoRef.current,
        html: htmlServidor,
        registro: registroRef.current,
      })
      if (pend && !restaura) borrarPendiente(cid)
      if (restaura) {
        ed.commands.setContent(pend.html || '')
        registroRef.current = pend.registro || {}
        setRegistro(registroRef.current)
        estadoRef.current = 'sin-guardar'
        setEstadoDoc('sin-guardar')
        setAviso(t('writer.unsaved.changes.recovered.retrying.save'))
        programarGuardado()
      } else {
        setEstadoDoc('guardado')
      }
      actualizarInfoDoc(ed)

      // Citas encoladas desde otra pestaña (Grafo/NIF): se aplican recién
      // cargado el caso, sin cursor del usuario — van al final, no al cursor.
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
        setAviso(t('writer.search.lead.added.checking.the.citation'))
        if (verificarRef.current) verificarRef.current()
      }
    }).catch((e) => {
      if (seq !== cargaSeqRef.current || !montadoRef.current) return
      setEstadoDoc('sin-guardar')
      setError(e)
    })
  }, [actualizarInfoDoc, programarGuardado])

  const recargarListaCasos = useCallback((seleccionarId = null) => {
    // El encadenamiento «recargar y seleccionar» solo corre si nadie pidió
    // otra carga de escrito entretanto: una respuesta tardía de /nif/casos no
    // puede robarle el editor al caso que el usuario acaba de elegir.
    const seq = cargaSeqRef.current
    return rest('/nif/casos').then((d) => {
      const lista = (d && d.cases) || []
      setCasos(lista)
      if (seleccionarId && cargaSeqRef.current === seq) {
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
      placeholder: t('writer.start.writing.your.brief.here'),
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
    montadoRef.current = true
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
      montadoRef.current = false
      cancelarTarea(timerGuardado.current)
      cancelarTarea(timerInfo.current)
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
    cancelarTarea(timerGuardado.current)
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
      if (!montadoRef.current) return
      if (d && (d.html || d.texto)) {
        ed.commands.setContent(d.html || d.texto)
        setAviso(t('writer.demo.brief.loaded.select.check.citations.to.try.the.engine'))
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
    insertarHtmlEnCursor(ed, parrafos)
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
    // «Descartar mis cambios» también descarta la instantánea pendiente:
    // si no, la próxima carga la restauraría y el conflicto volvería.
    borrarPendiente(casoRef.current)
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
                ? t('writer.replacement.verified.apply.it.then.check.the.brief.again')
                : t('writer.failedReplacement') +
                  (etiquetaCodigo((primerFallo && primerFallo.resolucion) || res.veredicto) || t('writer.noDetail')),
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
        setAviso(t('writer.citation.removed.review.the.sentence.for.missing.text'))
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
    className: 'dk-writer ' + (herramientaActiva ? 'dk-writer--tool ' : '') + 'flex flex-col flex-1 min-h-0 overflow-hidden rounded-md border border-(--dk-borde) bg-(--dk-elevada) shadow-xs',
    style: { minHeight: '620px' },
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
        className: 'flex items-center gap-3 border-b px-4 py-1.5 text-xs shrink-0 ' + S.noticeWarn,
        children: [
          jsx('span', { className: 'flex-1', children:
            t('writer.another.process.saved.this.brief') +
            (conflictoRev != null ? ' (rev ' + conflictoRev + ')' : '') + '.' }),
          jsx('button', {
            type: 'button',
            onClick: recargarTrasConflicto,
            className: 'dk-btn dk-btn--borde dk-btn--chico',
            children: t('writer.reload.and.discard.my.changes'),
          }),
        ],
      }) : null,

      error ? jsxs('div', {
        className: 'flex items-center justify-between border-b px-4 py-1.5 text-xs shrink-0 ' + S.noticeBad,
        role: 'alert',
        children: [
          jsx('span', { children: mensajeError(error) }),
          jsx('button', { type: 'button', 'aria-label': t('writer.dismiss.error'), onClick: () => setError(null), className: 'dk-btn dk-btn--icono dk-btn--chico', children: '✕' }),
        ],
      }) : null,

      aviso ? jsxs('div', {
        className: 'flex items-center justify-between border-b px-4 py-1 text-xs shrink-0 ' + S.notice,
        role: 'status',
        children: [
          jsx('span', { children: aviso }),
          jsx('button', { type: 'button', 'aria-label': t('writer.dismiss.notice'), onClick: () => setAviso(null), className: 'dk-btn dk-btn--icono dk-btn--chico', children: '✕' }),
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
                style: { backgroundColor: 'var(--dk-superficie-2)' },
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
                      padding: 'clamp(20px, 3vw, 70px) clamp(20px, 3vw, 80px)',
                      fontFamily: prefs.fuente || "Georgia, 'Times New Roman', serif",
                      fontSize: (prefs.tamano_fuente || '12') + 'pt',
                      lineHeight: '1.65',
                    },
                    children: [
                      modoVista === 'read' ? jsxs('div', {
                        className: 'mb-4 flex items-center justify-between rounded border border-(--dk-borde) bg-(--dk-superficie) px-3 py-1.5 font-sans text-xs text-(--dk-texto-2)',
                        children: [
                          jsx('span', { children: t('writer.read.mode.review.the.text.and.citations') }),
                          jsx('button', {
                            type: 'button',
                            onClick: () => setModoVista('write'),
                            className: S.link + ' font-semibold cursor-pointer',
                            children: t('writer.return.to.writing'),
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
                  (res.error || (meta.citas_fallidas || 0) > 0 ? S.noticeWarn : S.noticeOk),
                role: 'status',
                children: [
                  res.error
                    ? jsx('span', { children: t('writer.could.not.check.the.brief') + mensajeError(res.error) + (res.motivo ? ' · ' + etiquetaCodigo(res.motivo) : '') })
                    : jsxs('div', { className: 'flex flex-wrap items-center gap-2', children: [
                        jsx('span', { className: 'font-semibold', children:
                          t('writer.count', { ok: meta.citas_verificadas || 0, total: meta.total_citas || 0 }) +
                          (res.veredicto ? ` (${etiquetaCodigo(res.veredicto)})` : '') }),
                        jsx('span', { className: 'text-xs opacity-80', children:
                          `corpus ${meta.pack_hash || '?'}` + (meta.as_of ? t('writer.asOf') + meta.as_of : '') }),
                      ] }),
                  jsx('button', {
                    type: 'button',
                    onClick: () => setHerramientaActiva('citas'),
                    className: 'dk-btn dk-btn--borde dk-btn--chico',
                    children: herramientaActiva === 'citas' ? t('writer.citation.details.open') : t('writer.review.and.repair.citations'),
                  }),
                ],
              }) : null,

              // Barra inferior de custodia y persistencia local (como PersistenceBar en imagen 2)
              jsxs('div', {
                className: 'flex flex-wrap items-center gap-2 border-t border-(--dk-borde) bg-(--dk-superficie) px-3 py-1 text-xs text-(--dk-texto-2) select-none shrink-0',
                children: [
                  jsx('span', { className: 'text-(--dk-texto-3)', children: t('writer.data') }),
                  jsx('span', {
                    className: 'inline-flex items-center gap-1 rounded border border-(--dk-borde) bg-(--dk-elevada) px-2 py-0.5 font-medium text-(--dk-texto-2)',
                    children: t('writer.saved.on.this.device'),
                  }),
                  jsx('span', {
                    className: 'text-(--dk-texto-3) hidden sm:inline truncate',
                    children: t('writer.brief.stored.on.this.device.privacy.settings.control.what.is.sent'),
                  }),
                  jsxs('div', { className: 'ml-auto flex items-center gap-1.5', children: [
                    jsx('span', { className: 'text-(--dk-texto-3)', children: t('writer.paper.label') }),
                    ...Object.entries(TEMAS_HOJA).map(([tid, tmeta]) => jsx('button', {
                      key: tid,
                      type: 'button',
                      onClick: () => guardarPrefs({ tema_papel: tid }),
                      'aria-pressed': prefs.tema_papel === tid,
                      'aria-label': t('writer.paper.theme') + ' ' + tmeta.label,
                      className: 'dk-btn dk-btn--chico',
                      children: t('paper.' + tid),
                    })),
                  ] }),
                ],
              }),
            ],
          }),

          // ── CAJÓN DESLIZANTE DE LA HERRAMIENTA ACTIVA (a la izquierda de la barra de iconos) ──
          jsxs('div', {
            className: (herramientaActiva ? 'flex ' : 'hidden ') +
              'dk-tool-drawer shrink-0 flex-col border-l border-(--dk-borde) bg-(--dk-elevada) overflow-hidden',
            children: [
              // Cabecera del cajón
              cfgHerramienta ? jsxs('div', {
                className: 'flex items-center justify-between border-b border-(--dk-borde) bg-(--dk-superficie) px-3 py-2 shrink-0',
                children: [
                  jsxs('div', { className: 'flex items-center gap-2 min-w-0', children: [
                    jsx('span', { className: 'text-sm font-bold text-(--dk-texto-2)', children: cfgHerramienta.icono }),
                    jsx('span', { className: 'text-xs font-semibold text-(--dk-texto)', children: cfgHerramienta.titulo }),
                  ] }),
                  jsx('button', {
                    type: 'button',
                    onClick: () => setHerramientaActiva(null),
                    title: t('writer.close.tool.panel'),
                    'aria-label': t('writer.close.tool.panel'),
                    className: 'dk-btn dk-btn--icono dk-btn--chico',
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
                    className: 'flex flex-col gap-3 p-3 text-xs text-(--dk-texto)',
                    children: [
                      jsxs('div', { className: 'flex items-center justify-between gap-2', children: [
                        jsx('span', { className: 'text-(--dk-texto-2)', children: t('writer.check.against.the.25.laws.in.the.corpus.pack') }),
                        jsx('button', {
                          type: 'button',
                          onClick: verificar,
                          disabled: verificando || estadoDoc === 'cargando',
                          className: 'dk-btn dk-btn--borde dk-btn--chico shrink-0',
                          children: verificando ? t('writer.checking') : t('writer.check.citations'),
                        }),
                      ] }),

                      !res && !verificando ? jsx('div', {
                        className: 'rounded border border-dashed border-(--dk-borde) p-4 text-center text-(--dk-texto-3)',
                        children: t('writer.select.check.citations.to.check.the.brief.s.article.references'),
                      }) : null,

                      res && res.error ? jsxs('div', {
                        className: S.noticeBad,
                        children: [
                          jsx('span', { className: S.chip + ' ' + S.chipBad, children: t('writer.unchecked') }),
                          jsx('div', { className: 'mt-1', children: t('writer.could.not.check.the.brief') + mensajeError(res.error) + (res.motivo ? ' · ' + etiquetaCodigo(res.motivo) : '') }),
                        ],
                      }) : null,

                      res && !res.error ? jsxs('div', { className: 'flex flex-col gap-2', children: [
                        jsx('div', { className: 'font-semibold text-(--dk-texto)', children:
                          t('writer.dik') + (meta.citas_verificadas || 0) + t('writer.of') + (meta.total_citas || 0) +
                          t('writer.verifiedSuffix') + (res.veredicto ? ' (' + etiquetaCodigo(res.veredicto) + ')' : '') +
                          ' · corpus ' + (meta.pack_hash || '?') +
                          (meta.as_of ? t('writer.asOf') + meta.as_of : '') }),
                        msgVeredicto ? jsx('div', { className: 'text-xs text-(--dk-texto-2)', children: t(msgVeredicto) }) : null,

                        ...detalles.map((d, i) => {
                          const estado = estadoCita(d, v.hash, docInfo.hash, registro)
                          const es = ESTILOS_ESTADO[estado] || ESTILOS_ESTADO.fallo
                          return jsxs('div', { key: i, className: 'flex items-start gap-2 border-b border-(--dk-borde) py-2 last:border-0', children: [
                            jsx('span', {
                              className: 'w-4 shrink-0 text-center font-bold ' + (estado === 'verificada' ? S.ok : (estado === 'fallo' ? S.bad : 'text-(--dk-texto-3)')),
                              'aria-hidden': 'true',
                              children: estado === 'verificada' ? '✓' : (estado === 'fallo' ? '✗' : '·'),
                            }),
                            jsxs('div', { className: 'min-w-0 flex-1', children: [
                              jsxs('div', { className: 'flex flex-wrap items-center gap-1.5', children: [
                                jsx('span', { className: 'font-medium text-(--dk-texto)', children: d.cita_raw }),
                                estado === 'verificada' && d.nodo_id && onAbrirGrafo
                                  ? jsx('button', {
                                      type: 'button',
                                      className: S.chip + ' ' + S[es.chip] + ' cursor-pointer',
                                      title: t('writer.open.article.in.corpus.graph'),
                                      onClick: () => onAbrirGrafo({ nodo_id: d.nodo_id }),
                                      children: etiquetaCodigo(estado === 'verificada' ? 'VERIFICADA' : estado === 'fallo' ? 'FALLO' : estado) + t('writer.graph'),
                                    })
                                  : jsx('span', { className: S.chip + ' ' + S[es.chip], children: etiquetaCodigo(estado === 'verificada' ? 'VERIFICADA' : estado === 'fallo' ? 'FALLO' : estado) }),
                              ] }),
                              jsx('div', { className: 'mt-0.5 break-all text-xs text-(--dk-texto-3)', children: (() => { const e = etiquetaCita(estado, d, meta, registro); return t(e.codigo, { ...e.datos, resolution: etiquetaCodigo(e.datos.resolution) }) + (e.pista ? t('verify.lead') : '') })() }),
                              estado === 'fallo'
                                ? jsx(AccionesFallo, { detalle: d, acciones: acciones[i], onAccion: (t, val) => accionCita(i, t, val) })
                                : null,
                            ] }),
                          ] })
                        }),

                        (res.problemas && res.problemas.length) ? jsxs('div', {
                          className: S.noticeWarn,
                          children: [
                            jsx('div', { className: 'dk-rotulo', children: t('writer.engine.problems') }),
                            ...res.problemas.map((p, i) => jsx('div', { key: i, className: 'text-xs', children: String(p) })),
                          ],
                        }) : null,

                        (res.no_verificadas && res.no_verificadas.length) ? jsx('div', {
                          className: 'text-xs text-(--dk-texto-3)',
                          children: t('writer.references.without.an.article.unchecked') + res.no_verificadas.join(', '),
                        }) : null,

                        ((registro.retiros && registro.retiros.length) || (registro.escaladas && registro.escaladas.length)) ? jsxs('details', {
                          className: 'text-xs',
                          children: [
                            jsx('summary', { className: 'cursor-pointer text-(--dk-texto-3)', children:
                              t('writer.custody', { removed: (registro.retiros || []).length, review: (registro.escaladas || []).length }) }),
                            ...(registro.retiros || []).map((r, i) => jsxs('div', { key: 'r' + i, className: 'py-0.5 text-xs', children: [
                              jsx('span', { className: 'text-(--dk-texto-3)', children: String(r.fecha || '').slice(0, 19).replace('T', ' ') + ' · ' }),
                              jsx('span', { children: t('writer.removed') + r.cita_raw + ' · ' + r.motivo }),
                            ] })),
                            ...(registro.escaladas || []).map((e, i) => jsxs('div', { key: 'e' + i, className: 'py-0.5 text-xs', children: [
                              jsx('span', { className: 'text-(--dk-texto-3)', children: String(e.fecha || '').slice(0, 19).replace('T', ' ') + ' · ' }),
                              jsx('span', { children: t('writer.sent.for.review') + e.cita_raw + ' · ' + e.nota }),
                            ] })),
                          ],
                        }) : null,

                        jsx('div', { className: 'text-xs text-(--dk-texto-3) pt-1 border-t border-(--dk-borde-suave)', children: t(AVISO_JUICIO) }),
                        res.alcance ? jsx('div', { className: 'text-xs text-(--dk-texto-3)', children: res.alcance }) : null,
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
                    className: herramientaActiva === 'ajustes' ? 'flex flex-col gap-3 p-3 text-xs text-(--dk-texto)' : 'hidden',
                    children: [
                      // Bloque de personalización pensado para usuarios terceros
                      jsxs('div', {
                        className: 'flex flex-col gap-2.5 rounded-md border border-(--dk-borde) bg-(--dk-superficie) p-3',
                        children: [
                          jsx('div', { className: 'dk-rotulo', children: t('writer.writer.settings') }),
                          jsxs('div', { className: 'flex items-center justify-between gap-2', children: [
                            jsx('label', { className: 'text-(--dk-texto-2)', children: t('writer.paper.theme') }),
                            jsx('select', {
                              value: prefs.tema_papel,
                              onChange: (e) => guardarPrefs({ tema_papel: e.target.value }),
                              className: 'rounded border border-(--dk-borde) bg-(--dk-elevada) px-2 py-1 text-xs',
                              children: Object.entries(TEMAS_HOJA).map(([k, v]) =>
                                jsx('option', { key: k, value: k, children: v.label })),
                            }),
                          ] }),
                          jsxs('div', { className: 'flex items-center justify-between gap-2', children: [
                            jsx('label', { className: 'text-(--dk-texto-2)', children: t('writer.page.format') }),
                            jsx('select', {
                              value: prefs.ancho_hoja,
                              onChange: (e) => guardarPrefs({ ancho_hoja: e.target.value }),
                              className: 'rounded border border-(--dk-borde) bg-(--dk-elevada) px-2 py-1 text-xs',
                              children: Object.entries(ANCHOS_HOJA).map(([k, v]) =>
                                jsx('option', { key: k, value: k, children: v.label })),
                            }),
                          ] }),
                          jsxs('div', { className: 'flex items-center justify-between gap-2', children: [
                            jsx('label', { className: 'text-(--dk-texto-2)', children: t('writer.default.privacy.strategy') }),
                            jsx('select', {
                              value: prefs.estrategia_privacidad,
                              onChange: (e) => {
                                const est = e.target.value
                                guardarPrefs({ estrategia_privacidad: est })
                                actualizarRegistro((r) => ({ ...(r || {}), privacidad: { ...(r || {}).privacidad, estrategia: est } }))
                              },
                              className: 'rounded border border-(--dk-borde) bg-(--dk-elevada) px-2 py-1 text-xs',
                              children: [
                                jsx('option', { key: 'ligera', value: 'ligera', children: t('writer.light.critical.only') }),
                                jsx('option', { key: 'media', value: 'media', children: t('writer.medium.critical.and.high') }),
                                jsx('option', { key: 'estricta', value: 'estricta', children: t('writer.strict.also.medium.and.names') }),
                              ],
                            }),
                          ] }),
                          jsxs('label', { className: 'flex items-center gap-2 text-(--dk-texto-2) pt-1', children: [
                            jsx('input', {
                              type: 'checkbox',
                              checked: prefs.mostrar_pizarra !== false,
                              onChange: (e) => guardarPrefs({ mostrar_pizarra: e.target.checked }),
                            }),
                            t('writer.show.strategy.board.above.the.brief'),
                          ] }),
                          jsxs('label', { className: 'flex items-center gap-2 text-(--dk-texto-2)', children: [
                            jsx('input', {
                              type: 'checkbox',
                              checked: chatAbierto,
                              onChange: (e) => guardarPrefs({ mostrar_chat: e.target.checked }),
                            }),
                            t('writer.show.hermes.chat'),
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
            className: 'flex w-20 shrink-0 flex-col items-center gap-1 overflow-y-auto border-l border-(--dk-borde) bg-(--dk-superficie) py-2 select-none',
            children: [
              ...HERRAMIENTAS_BARRA.map((tool) => {
                const activa = herramientaActiva === tool.id
                let badge = null
                if (tool.id === 'citas' && res && !res.error) {
                  const fallos = meta.citas_fallidas || 0
                  badge = fallos > 0
                    ? jsx('span', { className: 'absolute -top-1 -right-1 rounded-full bg-(--dk-mal) px-1 text-xs font-bold text-(--dk-sobre-solido)', children: String(fallos) })
                    : (meta.total_citas > 0
                        ? jsx('span', { className: 'absolute -top-1 -right-1 rounded-full bg-(--dk-ok) px-1 text-xs font-bold text-(--dk-sobre-solido)', children: String(meta.citas_verificadas) })
                        : null)
                }
                return jsxs('button', {
                  key: tool.id,
                  type: 'button',
                  title: tool.label,
                  'aria-label': tool.label,
                  'aria-pressed': activa,
                  onClick: () => setHerramientaActiva((prev) => (prev === tool.id ? null : tool.id)),
                  className: 'dk-btn dk-tool-button relative',
                  children: [
                    jsx('span', { children: t('rail.' + tool.id) }),
                    badge,
                  ],
                })
              }),

              jsx('div', { className: 'my-1 h-px w-6 bg-(--dk-superficie-2)' }),

              // Botón para mostrar/ocultar el panel de Chat Hermes a la derecha
              jsx('button', {
                type: 'button',
                title: chatAbierto ? t('writer.hide.hermes.chat') : t('writer.show.hermes.chat'),
                'aria-label': chatAbierto ? t('writer.hide.hermes.chat') : t('writer.show.hermes.chat'),
                'aria-pressed': chatAbierto,
                onClick: () => guardarPrefs({ mostrar_chat: !chatAbierto }),
                className: 'dk-btn dk-tool-button',
                children: t('rail.chat'),
              }),
            ],
          }),

          // ── PANEL DERECHO CONECTADO CON HERMES (Chat del escrito, siempre montado) ──
          jsx('div', {
            className: (chatAbierto ? '' : 'hidden ') +
              'dk-chat-dock shrink-0 flex-col border-l border-(--dk-borde) bg-(--dk-elevada) overflow-hidden',
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
