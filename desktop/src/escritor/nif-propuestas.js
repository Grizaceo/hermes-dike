// NIF vivo (F3): el modelo propone actualizaciones del NIF a partir del
// escrito; el abogado acepta, edita o rechaza cada una. Nada entra al NIF
// sin aceptación humana; las normas quedan "sin verificar" hasta que Diké
// las verifique. El prompt del modelo viaja empaquetado en el bundle.

import { jsx, jsxs } from 'react/jsx-runtime'
import { useCallback, useEffect, useState } from 'react'
import { host } from '@hermes/plugin-sdk'
import { mensajeError, rest, S } from '../common.js'
import { textoDelEditor } from './editor.js'
import { prepararEnvio, puedeEnviar, rehidratar } from './privacidad.js'
import { neutralizar } from './chat-logica.js'
import {
  componerInputNif, extraerJSON, formaValida, hashPropuesta,
  rehidratarProfundo, validarLote,
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

  const cargarSnapshot = useCallback(() => {
    if (!tieneNif) return Promise.resolve(null)
    return rest('/nif/snapshot?case_id=' + encodeURIComponent(caseId), {})
      .then((s) => { setSnapshot(s); return s })
      .catch(() => { setSnapshot(null); return null })
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
        destino: (sesion.perfil || 'lexo-lawyer') + ' · '
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
    error ? jsx('div', { className: 'text-xs text-(--ui-danger)',
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
