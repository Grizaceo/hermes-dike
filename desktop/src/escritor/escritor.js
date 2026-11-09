// Case Writer: editor Tiptap + verificador Diké como módulo (estilo Shield:
// probar → reparar → retirar con motivo → escalar). El escrito persiste en
// /escrito (plugin-data) con control optimista de revisión; las marcas del
// texto solo salen de una verificación del motor sobre el texto actual.

import { jsx, jsxs } from 'react/jsx-runtime'
import { useCallback, useEffect, useRef, useState } from 'react'
import { mensajeError, rest, S } from '../common.js'
import {
  borrarRangos, fijarMarcas, montarEditor, reemplazarRangos, textoDelEditor,
} from './editor.js'
import {
  AVISO_JUICIO, estadoCita, etiquetaCita, localizarCitas, mensajeVeredicto,
  rangoAPos, rangosAPos, segmentosDeDoc, sha256Hex,
} from './verificador.js'
import { ModuloPrivacidad } from './privacidad.js'
import { ChatEscritor } from './chat.js'
import { NifPropuestas } from './nif-propuestas.js'
import { PrediccionPanel } from './prediccion.js'

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

const TEXTO_GUARDADO = {
  cargando: 'cargando…',
  guardado: 'guardado',
  guardando: 'guardando…',
  'sin-guardar': 'sin guardar',
  conflicto: 'conflicto (recargar)',
}

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
  return jsxs('div', { className: 'flex flex-col gap-1.5 mt-1', children: [
    // Reparar: probar el reemplazo solo contra el motor; si lo da VERIFICADA
    // se habilita Aplicar (el texto cambia → todo queda desactualizada).
    jsxs('div', { className: 'flex flex-wrap items-center gap-1.5', children: [
      jsx('input', {
        className: S.input + ' flex-1 min-w-40', value: reparar,
        placeholder: 'texto de reemplazo', disabled: agotados,
        onChange: (e) => setReparar(e.target.value),
      }),
      jsx('button', {
        type: 'button', className: S.ghost,
        disabled: agotados || a.ocupado || !reparar.trim(),
        onClick: () => onAccion('probar', reparar.trim()),
        children: a.ocupado ? 'probando…' : 'Probar reemplazo',
      }),
      jsx('button', {
        type: 'button', className: S.button,
        // Solo se aplica el texto exacto que el motor verificó: si el input
        // cambia después de probar, el botón se apaga solo.
        disabled: !a.probado || agotados || reparar.trim() !== a.probadoTexto,
        onClick: () => onAccion('aplicar', a.probadoTexto),
        children: 'Aplicar',
      }),
    ] }),
    a.resumenPrueba
      ? jsx('div', { className: S.sub, children: a.resumenPrueba })
      : null,
    agotados
      ? jsx('div', { className: 'text-xs text-(--ui-danger)', children:
          'Dos intentos de reparación sin éxito: conviene escalar.' })
      : null,
    // Retirar con motivo + escalar con nota.
    jsxs('div', { className: 'flex flex-wrap items-center gap-1.5', children: [
      jsx('input', {
        className: S.input + ' flex-1 min-w-32', value: motivo,
        placeholder: 'motivo para retirarla',
        onChange: (e) => setMotivo(e.target.value),
      }),
      jsx('button', {
        type: 'button', className: S.ghost, disabled: !motivo.trim(),
        onClick: () => { onAccion('retirar', motivo.trim()); setMotivo('') },
        children: 'Retirar',
      }),
      jsx('input', {
        className: S.input + ' flex-1 min-w-32', value: nota,
        placeholder: 'nota para revisión humana',
        onChange: (e) => setNota(e.target.value),
      }),
      jsx('button', {
        type: 'button', className: S.ghost, disabled: !nota.trim(),
        onClick: () => { onAccion('escalar', nota.trim()); setNota('') },
        children: 'Escalar',
      }),
    ] }),
  ] })
}

// --- Sección principal --------------------------------------------------------

export function SeccionEscritor() {
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
    }).catch((e) => {
      setEstadoDoc('sin-guardar')
      setError(e)
    })
  }, [actualizarInfoDoc])

  // Montaje del editor (una vez) + primera carga.
  useEffect(() => {
    const ed = montarEditor({
      element: hostRef.current,
      content: '',
      placeholder: 'Escribe o pega el escrito…',
      onUpdate: (editor) => {
        const texto = textoDelEditor(editor)
        if (texto === textoGuardadoRef.current) {
          setEstadoDoc((s) => (s === 'guardando' || s === 'conflicto' ? s : 'guardado'))
        } else if (estadoRef.current !== 'conflicto' && estadoRef.current !== 'cargando') {
          // setContent de la carga también emite onUpdate: ahí estadoRef es
          // 'cargando' y no hay que programar un guardado espurio.
          setEstadoDoc('sin-guardar')
          programarGuardado()
        }
        // Invalidar el hash de inmediato: nada queda 'verificada' ni un tick
        // sobre texto ya modificado; el recálculo va con debounce.
        if (infoDocRef.current.texto !== texto) {
          infoDocRef.current = { texto, hash: null }
          setDocInfo(infoDocRef.current)
        }
        programarInfoDoc(editor)
        // predicción: el panel decide si pide sugerencia (apagada por
        // defecto — sin efecto salvo opt-in)
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
      ed.destroy()
      editorRef.current = null
    }
  }, [cargarEscrito, programarGuardado, programarInfoDoc])

  // Recalcular marcas: verificación, texto o registro cambiaron.
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
        // El resultado describe el texto verificado (hash); la comparación de
        // los estados se hace contra el texto ACTUAL del editor, que pudo
        // cambiar mientras el motor respondía — recalcular desde ahí.
        setVerificacion({ resultado, hash })
        setAcciones({}) // los índices de detalle cambian con cada verificación
        actualizarInfoDoc(ed)
      }))
      .catch(setError)
      .finally(() => setVerificando(false))
  }, [verificando, actualizarInfoDoc])

  const cambiarCaso = useCallback((cid) => {
    clearTimeout(timerGuardado.current)
    const continuar = () => {
      setCaseId(cid)
      cargarEscrito(cid)
    }
    // Cambios sin guardar: intentar persistir antes de cambiar; si hay
    // conflicto quedarse en el caso actual para resolverlo.
    if (estadoRef.current === 'sin-guardar') {
      guardar().then(() => {
        if (estadoRef.current !== 'conflicto') continuar()
      })
    } else {
      continuar()
    }
  }, [cargarEscrito, guardar])

  const recargarTrasConflicto = useCallback(() => {
    cargarEscrito(casoRef.current)
  }, [cargarEscrito])

  const fijarRegistro = useCallback((nuevo) => {
    registroRef.current = nuevo
    setRegistro(nuevo)
    return guardar()
  }, [guardar])

  // Acción sobre una cita del panel (índice en resultado.detalles).
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
          // El candidato es válido solo si TODAS sus citas quedan VERIFICADA
          // (y hay al menos una — un texto sin citas no repara nada).
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

  // --- Render ---------------------------------------------------------------

  const v = verificacion
  const res = v && v.resultado
  const meta = (res && res.meta) || {}
  const detalles = (res && res.detalles) || []
  const msgVeredicto = res && mensajeVeredicto(res.veredicto)
  const opciones = [{ case_id: BORRADOR, legal_question: 'borrador (sin caso)' }]
    .concat(casos || [])

  return jsxs('div', { className: 'flex flex-col gap-3', children: [
    jsxs('div', { className: 'flex flex-wrap items-center gap-2', children: [
      jsx('select', {
        className: S.input,
        value: caseId,
        onChange: (e) => cambiarCaso(e.target.value),
        children: casos === null
          ? jsx('option', { value: caseId, children: 'Cargando casos…' })
          : opciones.map((c) => jsx('option', {
              key: c.case_id, value: c.case_id,
              children: c.case_id === BORRADOR
                ? 'borrador (sin caso)'
                : c.case_id + ' — ' + String(c.legal_question || '').slice(0, 60),
            })),
      }),
      jsx('span', { className: S.sub, children: TEXTO_GUARDADO[estadoDoc] || estadoDoc }),
      estadoDoc === 'conflicto'
        ? jsxs('span', { className: 'flex items-center gap-1', children: [
            jsx('span', { className: 'text-xs text-(--ui-danger)', children:
              'Otro proceso guardó este escrito' +
              (conflictoRev != null ? ' (rev ' + conflictoRev + ')' : '') + '.' }),
            jsx('button', {
              type: 'button', className: S.link, onClick: recargarTrasConflicto,
              children: 'descargar y perder mis cambios',
            }),
          ] })
        : null,
      jsx('button', {
        type: 'button', className: S.button, onClick: verificar,
        disabled: verificando || estadoDoc === 'cargando',
        children: verificando ? 'Verificando…' : 'Verificar citas',
      }),
      verificando
        ? jsx('span', { className: S.sub, children:
            'La primera llamada instala el corpus (~1 min).' })
        : null,
    ] }),

    error ? jsx('div', { className: 'text-xs text-(--ui-danger)', children: mensajeError(error) }) : null,
    aviso ? jsx('div', { className: S.sub, children: aviso }) : null,

    jsxs('div', { className: S.card, children: [
      jsx('div', { className: S.cardTitle, children: 'Escrito' }),
      jsx('div', { ref: hostRef }),
    ] }),

    jsx(ModuloPrivacidad, {
      editorRef, caseId, docInfo, registro, setRegistro,
    }),

    jsx(ChatEscritor, {
      editorRef, caseId, docInfo, verificacion, registro, setRegistro,
      estrategiaPriv: ((registro || {}).privacidad || {}).estrategia,
      rev: revRef.current,
      onSesion: setChatSesion,
    }),

    jsx(NifPropuestas, {
      editorRef, caseId, registro, setRegistro,
      sesion: chatSesion,
      tieneNif: caseId !== 'borrador',
    }),

    jsx(PrediccionPanel, {
      editorRef, caseId, docInfo, verificacion, registro, setRegistro,
      sesion: chatSesion,
    }),

    res && res.error
      ? jsxs('div', { className: S.card, children: [
          jsx('span', { className: S.chip + ' ' + S.chipBad, children: 'sin revisar' }),
          jsx('div', { children: 'Diké no pudo revisar el escrito: ' + String(res.error) }),
        ] })
      : null,

    res && !res.error ? jsxs('div', { className: 'flex flex-col gap-2', children: [
      jsxs('div', { className: 'font-medium', children: [
        'Diké: ' + (meta.citas_verificadas || 0) + ' de ' + (meta.total_citas || 0) +
        ' citas verificadas' + (res.veredicto ? ' (' + res.veredicto + ')' : '') +
        ' · corpus ' + (meta.pack_hash || '?') +
        (meta.as_of ? ' · al ' + meta.as_of : ''),
      ] }),
      msgVeredicto ? jsx('div', { className: S.sub, children: msgVeredicto }) : null,

      detalles.map((d, i) => {
        const estado = estadoCita(d, v.hash, docInfo.hash, registro)
        const es = ESTILOS_ESTADO[estado] || ESTILOS_ESTADO.fallo
        return jsxs('div', { key: i, className: S.row, children: [
          jsx('span', {
            className: S.mark + ' ' + (estado === 'verificada' ? S.ok : (estado === 'fallo' ? S.bad : '')),
            children: estado === 'verificada' ? '✓' : (estado === 'fallo' ? '✗' : '·'),
          }),
          jsxs('div', { className: 'min-w-0', children: [
            jsxs('div', { className: 'flex items-center gap-2', children: [
              jsx('div', { children: d.cita_raw }),
              jsx('span', { className: S.chip + ' ' + S[es.chip], children: es.texto }),
            ] }),
            jsx('div', { className: S.meta, children: etiquetaCita(estado, d, meta, registro) }),
            estado === 'fallo'
              ? jsx(AccionesFallo, { detalle: d, acciones: acciones[i], onAccion: (t, val) => accionCita(i, t, val) })
              : null,
          ] }),
        ] })
      }),

      (res.problemas && res.problemas.length)
        ? jsxs('div', { className: S.section, children: [
            jsx('div', { className: S.sectionTitle, children: 'Problemas del motor' }),
            ...res.problemas.map((p, i) => jsx('div', { key: i, className: 'text-xs', children: String(p) })),
          ] })
        : null,

      (res.no_verificadas && res.no_verificadas.length)
        ? jsx('div', { className: S.sub, children:
            'Menciones sin artículo, no verificadas: ' + res.no_verificadas.join(', ') })
        : null,

      ((registro.retiros && registro.retiros.length) || (registro.escaladas && registro.escaladas.length))
        ? jsxs('details', { className: 'text-xs', children: [
            jsx('summary', { className: 'cursor-pointer ' + S.sub, children:
              'Registro: ' + ((registro.retiros || []).length) + ' retiradas · ' +
              ((registro.escaladas || []).length) + ' escaladas' }),
            ...(registro.retiros || []).map((r, i) => jsxs('div', { key: 'r' + i, className: 'py-0.5', children: [
              jsx('span', { className: S.sub, children: String(r.fecha || '').slice(0, 19).replace('T', ' ') + ' · ' }),
              jsx('span', { children: 'Retirada — ' + r.cita_raw + ' · ' + r.motivo }),
            ] })),
            ...(registro.escaladas || []).map((e, i) => jsxs('div', { key: 'e' + i, className: 'py-0.5', children: [
              jsx('span', { className: S.sub, children: String(e.fecha || '').slice(0, 19).replace('T', ' ') + ' · ' }),
              jsx('span', { children: 'Escalada — ' + e.cita_raw + ' · ' + e.nota }),
            ] })),
          ] })
        : null,

      jsx('div', { className: S.sub, children: AVISO_JUICIO }),
      res.alcance ? jsx('div', { className: S.sub, children: res.alcance }) : null,
    ] }) : null,
  ] })
}
