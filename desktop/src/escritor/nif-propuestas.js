// NIF vivo (F3): el modelo propone actualizaciones del NIF a partir del
// escrito; el abogado acepta, edita o rechaza cada una. Nada entra al NIF
// sin aceptación humana; las normas quedan "sin verificar" hasta que Diké
// las verifique. El prompt del modelo viaja empaquetado en el bundle.

import { jsx, jsxs } from 'react/jsx-runtime'
import { useCallback, useEffect, useRef, useState } from 'react'
import { host } from '@hermes/plugin-sdk'
import { mensajeError, rest, S } from '../common.js'
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
  'facts.known': 'Hechos acreditados', 'facts.alleged': 'Hechos alegados',
  'facts.missing': 'Hechos por conocer', subjects: 'Sujetos', norms: 'Normas',
  hypotheses: 'Hipótesis', gaps: 'Vacíos', principles: 'Principios',
  conflicts: 'Conflictos',
}
const ORDEN = [
  'facts.known', 'facts.alleged', 'facts.missing', 'subjects', 'norms',
  'hypotheses', 'gaps', 'principles', 'conflicts',
]


function ChipSeccion({ fp, n }) {
  return jsxs('span', { className: S.chip + ' ' + S.chipOff, children: [
    ETIQUETAS[fp] || fp, ' · ', n,
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
    ? 'Elige o crea un caso con NIF.'
    : !sesion
      ? 'Abre primero el chat del escrito: las propuestas usan su modelo.'
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
        throw new Error('Activa la seudonimización o confirma en el módulo ' +
          'Privacidad que aceptas enviar datos personales.')
      }
      const envio = await prepararEnvio({
        caseId, texto: input,
        destino: (sesion.perfil || 'perfil sin resolver') + ' · '
          + (modeloLabel || 'modelo') + ' · NIF',
        seudonimizar, estrategia: cfgPriv.estrategia || 'media',
      })
      if (!puedeEnviar()) throw new Error('privacidad bloqueó el envío')
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
    if (!forma.ok && forma.motivo === 'forma o enum inválido en value') {
      setError(new Error('Valor editado inválido: ' + forma.motivo)); return
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
          estado: ok ? 'verificada' : 'no verificada', label } }))
      })
      .catch(() => setVerifica((v) => ({ ...v, [key]: {
        estado: 'no verificada', label } })))
  }, [])

  if (!tieneNif) {
    return jsxs('div', { className: S.card, children: [
      jsx('div', { className: S.cardTitle, children: 'NIF vivo' }),
      jsx('div', { className: 'text-xs text-(--ui-text-secondary)', children:
        'Elige o crea un caso con NIF.' }),
      jsx('div', { className: 'text-xs', children:
        'El modelo propone; nada entra al NIF sin tu aceptación.' }),
    ] })
  }

  return jsxs('div', { className: S.card, children: [
    jsxs('div', { className: 'flex items-center gap-2', children: [
      jsx('div', { className: S.cardTitle, children: 'NIF vivo' }),
      jsx('div', { className: 'text-xs text-(--ui-text-secondary)', children:
        'El modelo propone; nada entra al NIF sin tu aceptación.' }),
      jsx('button', {
        type: 'button', className: S.button,
        disabled: Boolean(deshabilitado) || ocupado,
        title: deshabilitado || '',
        onClick: proponer,
        children: ocupado ? 'Pidiendo propuestas…' : 'Proponer NIF desde el escrito',
      }),
    ] }),
    deshabilitado && tieneNif ? jsx('div', { className: 'text-xs',
      children: deshabilitado }) : null,
    error ? jsx('div', { className: 'text-xs dk-mal',
      children: mensajeError(error) }) : null,

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
                  children: ETIQUETAS[p.field_path] || p.field_path }),
                editando === idx
                  ? jsxs('div', { className: 'flex flex-col gap-1', children: [
                      jsx('textarea', {
                        className: S.input, rows: 2, value: textoEdit,
                        onChange: (e) => setTextoEdit(e.target.value) }),
                      jsxs('div', { className: 'flex gap-1', children: [
                        jsx('button', { type: 'button', className: S.button,
                          onClick: () => guardarEdicion(p, idx),
                          children: 'Guardar' }),
                        jsx('button', { type: 'button', className: S.button,
                          onClick: () => setEditando(null),
                          children: 'Cancelar' }),
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
                    onClick: () => aceptar(p, idx), children: 'Aceptar' }),
                  jsx('button', { type: 'button', className: S.button,
                    onClick: () => { setEditando(idx)
                      setTextoEdit(typeof p.value === 'string'
                        ? p.value : JSON.stringify(p.value)) },
                    children: 'Editar' }),
                  jsx('button', { type: 'button', className: S.button,
                    onClick: () => rechazar(p, idx), children: 'Rechazar' }),
                ] }) : null,
              verifica[keyNorma] ? jsxs('div', { className: 'mt-1 text-xs',
                children: [
                  'Norma «' + (verifica[keyNorma].label || '') + '»: ',
                  jsx('b', { children: verifica[keyNorma].estado }),
                  verifica[keyNorma].estado === 'sin verificar'
                    ? jsx('button', { type: 'button', className: S.button,
                        onClick: () => verificarNorma(
                          verifica[keyNorma].label, keyNorma),
                        children: 'Verificar norma' }) : null,
                ] }) : null,
            ] })
        }),
      ] }) : null,

    descartadas.length ? jsxs('details', { className: 'text-xs', children: [
      jsxs('summary', { children: [
        descartadas.length, ' descartadas por la validación'] }),
      descartadas.map((d, i) => jsxs('div', { key: i, children: [
        (d.field_path || '?') + ': ' + (d.motivo || ''),
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
  ['facts.known', 'Hechos conocidos', 'HECHO', '#bbf7d0'],
  ['facts.alleged', 'Hechos alegados', 'HECHO', '#bfdbfe'],
  ['facts.missing', 'Hechos faltantes', 'HECHO', '#fed7aa'],
  ['norms', 'Normas', 'NORMA', '#e9d5ff'],
  ['subjects', 'Sujetos', 'PARTES', '#bfdbfe'],
  ['hypotheses', 'Hipótesis', 'CONCLUSIÓN', '#fef08a'],
  ['gaps', 'Vacíos probatorios/normativos', 'PRUEBA', '#fecaca'],
  ['conflicts', 'Conflictos', 'NORMA', '#fecaca'],
  ['principles', 'Principios', 'NORMA', '#e9d5ff'],
  ['deontic_positions', 'Posiciones deónticas', 'NORMA', '#bbf7d0'],
]

function formatearItemNif(v) {
  if (typeof v === 'string') return v
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    return [v.label || v.id || v.name || '', v.description || v.text || v.filled_with || '']
      .filter(Boolean).join(' — ') || JSON.stringify(v)
  }
  return JSON.stringify(v)
}

export function NifInteractivoEscritor({
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
          jsx('div', { className: 'font-bold', children: 'Vincular o crear Tablero NIF' }),
          jsx('div', { className: 'dk-meta', children: 'El documento actual está en «borrador». Crea un caso NIF o carga el caso demo para habilitar el tablero interactivo.' }),
          jsx('input', {
            value: nuevoId,
            onChange: (e) => setNuevoId(e.target.value),
            placeholder: 'ID del caso (ej. causa-despido-1)',
            className: S.input,
          }),
          jsx('input', {
            value: nuevaPregunta,
            onChange: (e) => setNuevaPregunta(e.target.value),
            placeholder: 'Pregunta jurídica principal…',
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
              children: 'Crear caso NIF',
            }),
            onSembrarDemoCaso ? jsx('button', {
              type: 'button',
              onClick: onSembrarDemoCaso,
              className: 'dk-btn dk-btn--borde',
              children: 'Cargar caso demo (CT)',
            }) : null,
          ] }),
        ],
      }) : null,

      error ? jsx('div', { className: S.noticeBad, children: mensajeError(error) }) : null,

      // 3. Tablero NIF interactivo del caso activo
      tieneNif && nif ? jsxs('div', {
        className: 'flex flex-col gap-2.5 rounded-md border border-(--dk-borde) bg-(--dk-elevada) p-2.5',
        children: [
          jsxs('div', { className: 'flex flex-wrap items-center justify-between gap-1.5 border-b border-(--dk-borde-suave) pb-2', children: [
            jsxs('div', { className: 'flex items-center gap-1.5', children: [
              jsx('span', {
                className: S.chip + ' ' + (nif.validated_by_human ? S.chipOk : S.chipOff),
                children: nif.validated_by_human ? '✓ validado por humano' : 'borrador NIF',
              }),
              jsx('span', {
                className: 'dk-meta',
                children: `v${snap.version || 1} · confianza ${Math.round((nif.confidence || 0) * 100)}%`,
              }),
            ] }),
            jsx('button', {
              type: 'button',
              onClick: () => alternarValidacion(nif.validated_by_human),
              className: S.link,
              children: nif.validated_by_human ? 'Retirar validación' : 'Marcar validado',
            }),
          ] }),

          nif.legal_question ? jsx('div', {
            className: 'rounded bg-(--dk-superficie) p-2 text-xs font-medium text-(--dk-texto) border border-(--dk-borde)',
            children: nif.legal_question,
          }) : null,

          // Acordeón interactivo de secciones del NIF
          ...SECCIONES_TABLERO_NIF.map(([campo, titulo, tagPizarra, colorPizarra]) => {
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
                    ? jsx('div', { className: 'text-xs text-(--dk-texto-3) italic', children: 'Sin elementos registrados en esta sección.' })
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
                                title: 'Enviar este elemento a la Pizarra Estratégica',
                                onClick: () => onAgregarAPizarra({
                                  titulo: titulo,
                                  tag: tagPizarra,
                                  color: colorPizarra,
                                  texto: txt,
                                }),
                                className: 'rounded border border-(--dk-borde) bg-(--dk-superficie) hover:bg-(--dk-sobre) px-1.5 py-0.5 text-xs text-(--dk-texto-2) cursor-pointer',
                                children: '+ Pizarra',
                              }) : null,
                              onInsertarTexto ? jsx('button', {
                                type: 'button',
                                title: 'Insertar en el escrito',
                                onClick: () => onInsertarTexto(txt),
                                className: 'dk-btn dk-btn--borde dk-btn--chico',
                                children: '+ Escrito',
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
                      placeholder: 'Agregar a ' + titulo.toLowerCase() + '…',
                      className: 'flex-1 rounded border border-(--dk-borde) px-2 py-1 text-xs text-(--dk-texto) outline-none',
                    }),
                    jsx('button', {
                      type: 'button',
                      onClick: () => agregarItem(campo),
                      disabled: ocupado || !nuevoValor.trim(),
                      className: 'dk-btn dk-btn--primario dk-btn--chico',
                      children: '+ Agregar',
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
