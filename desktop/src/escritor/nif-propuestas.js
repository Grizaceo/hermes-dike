import { useIdioma } from '../i18n.js'
import { memo } from 'react'
import { etiquetaCodigo } from '../i18n.js'
// NIF vivo (F3): el modelo propone actualizaciones del NIF a partir del
// escrito; el abogado acepta, edita o rechaza cada una. Nada entra al NIF
// sin aceptación humana; las normas quedan "sin verificar" hasta que Diké
// las verifique. El prompt del modelo viaja empaquetado en el bundle.

import { jsx, jsxs } from 'react/jsx-runtime'
import { useCallback, useEffect, useRef, useState } from 'react'
import { host } from '@hermes/plugin-sdk'
import { mensajeError, rest, S } from '../common.js'
import { t } from '../i18n.js'
import { textoDelEditor } from './editor.js'
import { prepararEnvio, puedeEnviar, rehidratar } from './privacidad.js'
import { neutralizar } from './chat-logica.js'
import {
  componerInputNif, extraerJSON, formaValida, hashPropuesta,
  rehidratarProfundo, validarLote, validarPropuesta,
} from './nif-propuestas-logica.js'
import PROMPT_NIF from '../../../escritor/nif_propuestas.md'

const TIMEOUT_RPC = 120000
const ETIQUETAS = {
  'facts.known': 'nif.seccion.factsKnown', 'facts.alleged': 'nif.seccion.factsAlleged',
  'facts.missing': 'nif.seccion.factsMissing', subjects: 'nif.seccion.subjects',
  norms: 'nif.seccion.norms', hypotheses: 'nif.seccion.hypotheses',
  gaps: 'nif.seccion.gaps', principles: 'nif.seccion.principles',
  conflicts: 'nif.seccion.conflicts',
}
const ORDEN = [
  'facts.known', 'facts.alleged', 'facts.missing', 'subjects', 'norms',
  'hypotheses', 'gaps', 'principles', 'conflicts',
]


function ChipSeccion({ fp, n }) {
  return jsxs('span', { className: S.chip + ' ' + S.chipOff, children: [
    (ETIQUETAS[fp] ? t(ETIQUETAS[fp]) : fp), ' · ', n,
  ] })
}

function TextoValor({ fp, value }) {
  if (typeof value === 'string') return jsx('span', { children: value })
  if (!value || typeof value !== 'object') return null
  const filas = Object.entries(value)
    .filter(([, v]) => v !== '' && v !== null && !(Array.isArray(v) && !v.length))
  return jsx('div', { className: 'text-sm', children: filas.map(([k, v], i) =>
    jsxs('div', { key: i, children: [
      jsx('b', { children: k + ': ' }),
      Array.isArray(v) ? v.join('; ') : String(v),
    ] })) })
}


export function NifPropuestas({ editorRef, caseId, registro, setRegistro,
  sesion, modeloLabel, tieneNif }) {
  const [snapshot, setSnapshot] = useState(null)
  const [propuestas, setPropuestas] = useState(null)   // validadas
  const [descartadas, setDescartadas] = useState([])
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState(null)
  const [verifica, setVerifica] = useState({})         // idx → estado norma
  const [editando, setEditando] = useState(null)       // idx
  const [textoEdit, setTextoEdit] = useState('')

  const rechazadas = (registro && registro.nif_rechazadas) || []
  const mapa = (registro && registro.chat && registro.chat.mapa) || {}
  const deshabilitado = !tieneNif
    ? t('nifp.deshabilitadoCaso')
    : !sesion
      ? t('nifp.deshabilitadoChat')
      : null

  // Guardia de secuencia: un cambio de caso rápido no puede dejar el
  // snapshot del caso anterior pintado bajo el caseId nuevo.
  const snapSeq = useRef(0)
  const cargarSnapshot = useCallback(() => {
    if (!tieneNif) { setSnapshot(null); return Promise.resolve(null) }
    const seq = ++snapSeq.current
    return rest('/nif/snapshot?case_id=' + encodeURIComponent(caseId), {})
      .then((s) => {
        if (seq === snapSeq.current) setSnapshot(s)
        return s
      })
      .catch(() => {
        if (seq === snapSeq.current) setSnapshot(null)
        return null
      })
  }, [caseId, tieneNif])

  useEffect(() => { setPropuestas(null); setDescartadas([]); setError(null)
    cargarSnapshot() }, [caseId])

  const proponer = useCallback(async () => {
    const ed = editorRef.current
    if (!ed || !sesion || ocupado) return
    setOcupado(true); setError(null); setPropuestas(null); setDescartadas([])
    try {
      const snap = await cargarSnapshot()
      const input = componerInputNif({
        caseId, nif: snap, escrito: textoDelEditor(ed), neutralizar,
      })
      const cfgPriv = (registro && registro.privacidad) || {}
      const seudonimizar = cfgPriv.seudonimizar !== false
      if (!seudonimizar && cfgPriv.acepto_datos !== true) {
        throw new Error(t('nifp.errorPrivacidad'))
      }
      const envio = await prepararEnvio({
        caseId, texto: input,
        destino: (sesion.perfil || t('pred.perfilSinResolver')) + ' · '
          + (modeloLabel || t('nifp.modelo')) + ' · ' + t('nifp.tablero'),
        seudonimizar, estrategia: cfgPriv.estrategia || 'media',
      })
      if (!puedeEnviar()) throw new Error(t('extra.privacy.blocked.sending'))
      const params = {
        instructions: PROMPT_NIF, input: envio.texto,
        session_id: sesion.session_id, temperature: 0.2, max_tokens: 3000,
      }
      let resp
      try {
        resp = await llamadaOneshot(sesion, params)
      } catch (e1) {
        // el transporte canónico puede rechazar session_id/params extras:
        // reintenta con lo mínimo (profile en params)
        resp = await llamadaOneshot(sesion, {
          instructions: PROMPT_NIF, input: envio.texto,
          temperature: 0.2, max_tokens: 3000, profile: sesion.perfil,
        })
      }
      const lista = extraerJSON(resp && resp.text)
      const { aceptadas, descartadas: desc } = validarLote(lista, {
        textoEnviado: input, nifActual: snap, rechazadas,
      })
      setPropuestas(aceptadas)
      setDescartadas(desc)
      if (!aceptadas.length && !desc.length) setPropuestas([])
    } catch (e) {
      setError(e)
    } finally {
      setOcupado(false)
    }
  }, [editorRef, sesion, ocupado, caseId, registro, modeloLabel, rechazadas])

  function llamadaOneshot(ses, params) {
    const ruta = ses && ses.ruta
    if (!ruta) return Promise.reject(new Error('sin ruta al perfil'))
    return host.requestProfile(ruta, 'llm.oneshot', params, TIMEOUT_RPC)
  }

  const aceptar = useCallback((p, idx) => {
    const valor = rehidratarProfundo(p.value, mapa)
    return rest('/nif/edit', { method: 'POST', body: {
      case_id: caseId, field_path: p.field_path, value: valor,
      reason: 'Propuesta del Case Writer aceptada por el abogado: '
        + String(p.reason || ''),
    } }).then(() => {
      setPropuestas((ps) => (ps || []).filter((_, i) => i !== idx))
      cargarSnapshot()
      if (p.field_path === 'norms') {
        setVerifica((v) => ({ ...v, ['n' + idx]: { estado: 'sin verificar',
          label: valor.label } }))
      }
    }).catch((e) => setError(e))
  }, [caseId, mapa, cargarSnapshot])

  const rechazar = useCallback((p, idx) => {
    setPropuestas((ps) => (ps || []).filter((_, i) => i !== idx))
    setRegistro((r) => ({ ...(r || {}),
      nif_rechazadas: [...rechazadas, hashPropuesta(p)] }))
  }, [rechazadas, setRegistro])

  const guardarEdicion = useCallback((p, idx) => {
    let v
    try { v = JSON.parse(textoEdit) } catch { v = textoEdit }
    const res = validarPropuesta({
      ...p, value: v, cita_del_escrito: p.cita_del_escrito || 'ok',
    }, { textoEnviado: p.cita_del_escrito || 'ok', nifActual: snapshot })
    // el valor editado se revalida en forma/enums, sin exigir cita literal
    const forma = validarPropuesta({ ...p, value: v,
      cita_del_escrito: p.cita_del_escrito || ' ' },
      { textoEnviado: p.cita_del_escrito || ' ', nifActual: snapshot,
        rechazadas: [] })
    if (!forma.ok && forma.motivo === 'VALUE_INVALID') {
      setError(new Error(t('extra.invalid.edited.value') + t('proposal.' + forma.motivo))); return
    }
    setPropuestas((ps) => (ps || []).map((x, i) =>
      i === idx ? { ...x, value: v } : x))
    setEditando(null)
  }, [textoEdit, snapshot])

  const verificarNorma = useCallback((label, key) => {
    setVerifica((v) => ({ ...v, [key]: { estado: 'verificando', label } }))
    rest('/verificar', { method: 'POST', body: { texto: label },
      timeoutMs: 320000 })
      .then((r) => {
        const ok = (r.detalles || []).some((d) => d.estado === 'VERIFICADA')
        setVerifica((v) => ({ ...v, [key]: {
          estado: ok ? 'VERIFICADA' : 'NOT_VERIFIED', label } }))
      })
      .catch(() => setVerifica((v) => ({ ...v, [key]: {
        estado: 'NOT_VERIFIED', label } })))
  }, [])

  if (!tieneNif) {
    return jsxs('div', { className: S.card, children: [
      jsx('div', { className: S.cardTitle, children: t('nifp.suggestions') }),
      jsx('div', { className: 'text-xs text-(--ui-text-secondary)', children:
        'Elige o crea un caso con NIF.' }),
      jsx('div', { className: 'text-xs', children:
        t('nifp.onlyAccepted') }),
    ] })
  }

  return jsxs('div', { className: S.card, children: [
    jsxs('div', { className: 'flex items-center gap-2', children: [
      jsx('div', { className: S.cardTitle, children: t('nifp.suggestions') }),
      jsx('div', { className: 'text-xs text-(--ui-text-secondary)', children:
        t('nifp.onlyAccepted') }),
      jsx('button', {
        type: 'button', className: S.button,
        disabled: Boolean(deshabilitado) || ocupado,
        title: deshabilitado || '',
        onClick: proponer,
        children: ocupado ? t('nifp.pidiendo') : t('nifp.proponer'),
      }),
    ] }),
    deshabilitado && tieneNif ? jsx('div', { className: 'text-xs',
      children: deshabilitado }) : null,
    error ? jsx('div', { className: 'text-xs dk-mal',
      children: mensajePropuesta(error) }) : null,

    propuestas && !propuestas.length && !descartadas.length
      ? jsx('div', { className: 'text-sm', children:
          'Sin propuestas nuevas y fundadas.' }) : null,

    propuestas && propuestas.length ? jsxs('div', {
      className: 'flex flex-col gap-2', children: [
        jsxs('div', { className: 'flex flex-wrap gap-1', children:
          ORDEN.filter((fp) => propuestas.some((p) => p.field_path === fp))
            .map((fp) => jsx(ChipSeccion, { key: fp, fp,
              n: propuestas.filter((p) => p.field_path === fp).length })) }),
        propuestas.map((p, idx) => {
          const valor = rehidratarProfundo(p.value, mapa)
          const keyNorma = 'n' + idx
          return jsxs('div', {
            key: idx,
            className: 'rounded border border-(--ui-stroke-secondary) p-2',
            children: [
              jsxs('div', { className: 'flex items-center gap-2', children: [
                jsx('span', { className: S.chip + ' ' + S.chipOff,
                  children: (ETIQUETAS[p.field_path] ? t(ETIQUETAS[p.field_path]) : p.field_path) }),
                editando === idx
                  ? jsxs('div', { className: 'flex flex-col gap-1', children: [
                      jsx('textarea', {
                        className: S.input, rows: 2, value: textoEdit,
                        onChange: (e) => setTextoEdit(e.target.value) }),
                      jsxs('div', { className: 'flex gap-1', children: [
                        jsx('button', { type: 'button', className: S.button,
                          onClick: () => guardarEdicion(p, idx),
                          children: t('nif.guardar') }),
                        jsx('button', { type: 'button', className: S.button,
                          onClick: () => setEditando(null),
                          children: t('nifp.cancelar') }),
                      ] }),
                    ] })
                  : jsxs('div', { className: 'flex-1', children: [
                      jsx(TextoValor, { fp: p.field_path, value: valor }),
                      p.reason ? jsx('div', {
                        className: 'text-xs text-(--ui-text-secondary)',
                        children: rehidratar(p.reason, mapa) }) : null,
                      p.cita_del_escrito ? jsxs('div', {
                        className: 'mt-1 rounded bg-(--ui-bg-tertiary) p-1 text-xs',
                        children: ['«',
                          rehidratar(p.cita_del_escrito, mapa), '»'] }) : null,
                    ] }),
              ] }),
              editando !== idx ? jsxs('div', { className: 'mt-1 flex gap-1',
                children: [
                  jsx('button', { type: 'button', className: S.button,
                    onClick: () => aceptar(p, idx), children: t('nifp.aceptar') }),
                  jsx('button', { type: 'button', className: S.button,
                    onClick: () => { setEditando(idx)
                      setTextoEdit(typeof p.value === 'string'
                        ? p.value : JSON.stringify(p.value)) },
                    children: t('nifp.editar') }),
                  jsx('button', { type: 'button', className: S.button,
                    onClick: () => rechazar(p, idx), children: t('nifp.rechazar') }),
                ] }) : null,
              verifica[keyNorma] ? jsxs('div', { className: 'mt-1 text-xs',
                children: [
                  t('nifp.normPrefix') + (verifica[keyNorma].label || '') + t('nifp.normSuffix'),
                  jsx('b', { children: etiquetaCodigo(verifica[keyNorma].estado) }),
                  verifica[keyNorma].estado === 'sin verificar'
                    ? jsx('button', { type: 'button', className: S.button,
                        onClick: () => verificarNorma(
                          verifica[keyNorma].label, keyNorma),
                        children: t('nifp.verificarNorma') }) : null,
                ] }) : null,
            ] })
        }),
      ] }) : null,

    descartadas.length ? jsxs('details', { className: 'text-xs', children: [
      jsxs('summary', { children: [
        t('nifp.descartadas', { n: descartadas.length })] }),
      descartadas.map((d, i) => jsxs('div', { key: i, children: [
        (d.field_path || '?') + ': ' + t('proposal.' + d.motivo),
      ] })),
    ] }) : null,
  ] })
}

// ---------------------------------------------------------------------------
// NIF Interactivo en la barra de herramientas del Case Writer:
// Combina propuestas del modelo (NIF vivo) + edición interactiva del tablero
// NIF del caso activo + envío de hechos/normas/hipótesis a la Pizarra.
// ---------------------------------------------------------------------------

const SECCIONES_TABLERO_NIF = [
  ['facts.known', 'nif.seccion.factsKnown', 'style.fact.label', '#bbf7d0'],
  ['facts.alleged', 'nif.seccion.factsAlleged', 'style.fact.label', '#bfdbfe'],
  ['facts.missing', 'nif.seccion.factsMissing', 'style.fact.label', '#fed7aa'],
  ['norms', 'nif.seccion.norms', 'style.norm', '#e9d5ff'],
  ['subjects', 'nif.seccion.subjects', 'nifp.tagPartes', '#bfdbfe'],
  ['hypotheses', 'nif.seccion.hypotheses', 'style.conclusion', '#fef08a'],
  ['gaps', 'nif.seccion.gaps', 'style.evidence', '#fecaca'],
  ['conflicts', 'nif.seccion.conflicts', 'style.norm', '#fecaca'],
  ['principles', 'nif.seccion.principles', 'style.norm', '#e9d5ff'],
  ['deontic_positions', 'nif.seccion.deonticPositions', 'style.norm', '#bbf7d0'],
]

function formatearItemNif(v) {
  if (typeof v === 'string') return v
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    return [v.label || v.id || v.name || '', v.description || v.text || v.filled_with || '']
      .filter(Boolean).join(' — ') || JSON.stringify(v)
  }
  return JSON.stringify(v)
}

function NifInteractivoEscritorImpl({
  editorRef,
  caseId,
  registro,
  setRegistro,
  sesion,
  tieneNif,
  onCrearCaso,
  onSembrarDemoCaso,
  onAgregarAPizarra,
  onInsertarTexto,
}) {
  useIdioma()
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [ocupado, setOcupado] = useState(false)
  const [seccionAbierta, setSeccionAbierta] = useState('facts.known')
  const [nuevoValor, setNuevoValor] = useState('')
  const [nuevoId, setNuevoId] = useState('')
  const [nuevaPregunta, setNuevaPregunta] = useState('')

  const cargar = useCallback(() => {
    if (!tieneNif) {
      setData(null)
      return
    }
    setError(null)
    rest('/nif/snapshot?case_id=' + encodeURIComponent(caseId))
      .then(setData)
      .catch(setError)
  }, [caseId, tieneNif])

  useEffect(() => { cargar() }, [cargar])

  const agregarItem = useCallback((campo) => {
    const raw = nuevoValor.trim()
    if (!raw || ocupado || !tieneNif) return
    let valor = raw
    if (!campo.startsWith('facts.')) {
      try {
        valor = JSON.parse(raw)
      } catch {
        if (campo === 'norms' || campo === 'subjects') valor = { label: raw }
        else if (campo === 'hypotheses' || campo === 'gaps' || campo === 'conflicts') valor = { description: raw }
      }
    }
    setOcupado(true)
    setError(null)
    rest('/nif/edit', {
      method: 'POST',
      body: { case_id: caseId, field_path: campo, value: valor },
      timeoutMs: 60000,
    }).then(() => {
      setNuevoValor('')
      cargar()
    }).catch(setError).finally(() => setOcupado(false))
  }, [nuevoValor, ocupado, tieneNif, caseId, cargar])

  const alternarValidacion = useCallback((validadoActual) => {
    if (!tieneNif || ocupado) return
    setOcupado(true)
    rest('/nif/validar', {
      method: 'POST',
      body: { case_id: caseId, validated: !validadoActual },
      timeoutMs: 60000,
    }).then(cargar).catch(setError).finally(() => setOcupado(false))
  }, [tieneNif, ocupado, caseId, cargar])

  const snap = (data && data.snapshot) || {}
  const nif = snap.nif || null

  return jsxs('div', {
    className: 'flex flex-col gap-3 p-3 text-xs text-(--dk-texto)',
    children: [
      // 1. Propuestas de NIF Vivo desde el escrito
      jsx(NifPropuestas, {
        editorRef,
        caseId,
        registro,
        setRegistro,
        sesion,
        tieneNif,
      }),

      // 2. Si está en borrador sin caso NIF, permitir crear o sembrar caso aquí mismo
      !tieneNif ? jsxs('div', {
        className: S.notice + ' flex flex-col gap-2',
        children: [
          jsx('div', { className: 'font-bold', children: t('nifp.vincularTitulo') }),
          jsx('div', { className: 'dk-meta', children: t('nifp.vincularAyuda') }),
          jsx('input', {
            value: nuevoId,
            onChange: (e) => setNuevoId(e.target.value),
            placeholder: t('nifp.idCaso'),
            className: S.input,
          }),
          jsx('input', {
            value: nuevaPregunta,
            onChange: (e) => setNuevaPregunta(e.target.value),
            placeholder: t('nifp.pregunta'),
            className: S.input,
          }),
          jsxs('div', { className: 'flex flex-wrap gap-1.5', children: [
            jsx('button', {
              type: 'button',
              disabled: !nuevoId.trim() || !nuevaPregunta.trim(),
              onClick: () => {
                if (onCrearCaso) onCrearCaso(nuevoId.trim(), nuevaPregunta.trim())
                setNuevoId('')
                setNuevaPregunta('')
              },
              className: 'dk-btn dk-btn--primario',
              children: t('format.create.case'),
            }),
            onSembrarDemoCaso ? jsx('button', {
              type: 'button',
              onClick: onSembrarDemoCaso,
              className: 'dk-btn dk-btn--borde',
              children: t('format.load.demo.case.ct'),
            }) : null,
          ] }),
        ],
      }) : null,

      error ? jsx('div', { className: S.noticeBad, children: mensajePropuesta(error) }) : null,

      // 3. Tablero NIF interactivo del caso activo
      tieneNif && nif ? jsxs('div', {
        className: 'flex flex-col gap-2.5 rounded-md border border-(--dk-borde) bg-(--dk-elevada) p-2.5',
        children: [
          jsxs('div', { className: 'flex flex-wrap items-center justify-between gap-1.5 border-b border-(--dk-borde-suave) pb-2', children: [
            jsxs('div', { className: 'flex items-center gap-1.5', children: [
              jsx('span', {
                className: S.chip + ' ' + (nif.validated_by_human ? S.chipOk : S.chipOff),
                children: nif.validated_by_human ? t('nifp.validado') : t('nifp.borrador'),
              }),
              jsx('span', {
                className: 'dk-meta',
                children: t('nif.versionConf', { version: snap.version || 1, pct: Math.round((nif.confidence || 0) * 100) }),
              }),
            ] }),
            jsx('button', {
              type: 'button',
              onClick: () => alternarValidacion(nif.validated_by_human),
              className: S.link,
              children: nif.validated_by_human ? t('nif.quitarValidacion') : t('nif.marcarValidado'),
            }),
          ] }),

          nif.legal_question ? jsx('div', {
            className: 'rounded bg-(--dk-superficie) p-2 text-xs font-medium text-(--dk-texto) border border-(--dk-borde)',
            children: nif.legal_question,
          }) : null,

          // Acordeón interactivo de secciones del NIF
          ...SECCIONES_TABLERO_NIF.map(([campo, claveTitulo, claveTag, colorPizarra]) => {
            const titulo = t(claveTitulo)
            const tagPizarra = t(claveTag)
            const lista = campo.startsWith('facts.')
              ? ((nif.facts || {})[campo.slice(6)] || [])
              : (nif[campo] || [])
            const abierta = seccionAbierta === campo
            return jsxs('div', {
              key: campo,
              className: 'rounded border border-(--dk-borde) overflow-hidden',
              children: [
                jsxs('button', {
                  type: 'button',
                  onClick: () => setSeccionAbierta(abierta ? null : campo),
                  className: 'flex w-full items-center justify-between bg-(--dk-superficie) px-2.5 py-1.5 text-left hover:bg-(--dk-sobre) cursor-pointer',
                  children: [
                    jsx('span', { className: 'text-xs font-semibold text-(--dk-texto-2)', children: titulo }),
                    jsx('span', {
                      className: 'rounded-full bg-(--dk-superficie-2) px-1.5 py-0.2 text-xs font-bold text-(--dk-texto-2)',
                      children: String(lista.length),
                    }),
                  ],
                }),
                abierta ? jsxs('div', { className: 'flex flex-col gap-1.5 p-2 bg-(--dk-elevada)', children: [
                  lista.length === 0
                    ? jsx('div', { className: 'text-xs text-(--dk-texto-3) italic', children: t('nifp.seccionVacia') })
                    : lista.map((item, idx) => {
                        const txt = formatearItemNif(item)
                        return jsxs('div', {
                          key: idx,
                          className: 'flex items-start justify-between gap-1.5 border-b border-(--dk-borde-suave) pb-1.5 last:border-0',
                          children: [
                            jsx('div', { className: 'flex-1 text-xs text-(--dk-texto-2) leading-relaxed whitespace-pre-wrap', children: txt }),
                            jsxs('div', { className: 'flex items-center gap-1 shrink-0', children: [
                              onAgregarAPizarra ? jsx('button', {
                                type: 'button',
                                title: t('nifp.aPizarra'),
                                onClick: () => onAgregarAPizarra({
                                  titulo: titulo,
                                  tag: tagPizarra,
                                  color: colorPizarra,
                                  texto: txt,
                                }),
                                className: 'rounded border border-(--dk-borde) bg-(--dk-superficie) hover:bg-(--dk-sobre) px-1.5 py-0.5 text-xs text-(--dk-texto-2) cursor-pointer',
                                children: t('nifp.masPizarra'),
                              }) : null,
                              onInsertarTexto ? jsx('button', {
                                type: 'button',
                                title: t('nifp.aEscrito'),
                                onClick: () => onInsertarTexto(txt),
                                className: 'dk-btn dk-btn--borde dk-btn--chico',
                                children: t('piz.escritoBoton'),
                              }) : null,
                            ] }),
                          ],
                        })
                      }),
                  // Agregar nuevo elemento a la sección
                  jsxs('div', { className: 'flex gap-1 pt-1', children: [
                    jsx('input', {
                      value: nuevoValor,
                      onChange: (e) => setNuevoValor(e.target.value),
                      onKeyDown: (e) => { if (e.key === 'Enter') agregarItem(campo) },
                      placeholder: t('nifp.agregarA', { seccion: titulo.toLowerCase() }),
                      className: 'flex-1 rounded border border-(--dk-borde) px-2 py-1 text-xs text-(--dk-texto) outline-none',
                    }),
                    jsx('button', {
                      type: 'button',
                      onClick: () => agregarItem(campo),
                      disabled: ocupado || !nuevoValor.trim(),
                      className: 'dk-btn dk-btn--primario dk-btn--chico',
                      children: t('nif.agregar'),
                    }),
                  ] }),
                ] }) : null,
              ],
            })
          }),
        ],
      }) : null,
    ],
  })
}

function mensajePropuesta(error) { const code = error && error.message; const key = 'proposal.' + code; return t(key) === key ? mensajeError(error) : t(key) }

export const NifInteractivoEscritor = memo(NifInteractivoEscritorImpl)
