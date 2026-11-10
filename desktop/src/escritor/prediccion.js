// Predicción (experimental, F4): panel del Case Writer con el interruptor
// general APAGADO por defecto, sub-interruptores L0/L1/L2 y telemetría.
// Estado por caso en registro.prediccion. Las sugerencias son propuestas:
// ni el modelo ni el corpus verifican citas.
// Ajuste fino de un modelo propio (pares contexto→continuación
// seudonimizados): trabajo PLANEADO, limitado por fondos — no implementado.

import { jsx, jsxs } from 'react/jsx-runtime'
import { useCallback, useEffect, useRef, useState } from 'react'
import { host } from '@hermes/plugin-sdk'
import { rest, S } from '../common.js'
import { t } from '../i18n.js'
import { fijarGhost } from './editor.js'
import { prepararEnvio, puedeEnviar } from './privacidad.js'
import { crearMesa, elegir } from './prediccion/mesa.js'
import { predictFormalismo, predictContenidoJuridico } from './prediccion/l0.js'
import { crearPredictorCorpus } from './prediccion/l1.js'
import { crearPredictorModelo, leerDestino } from './prediccion/l2.js'

function cfgDe(registro) {
  return (registro && registro.prediccion) || {}
}

const ETIQUETA_CAPA = {
  L0: 'formalismo procesal (determinista)',
  L1: 'texto del corpus, sin verificar como cita',
  L2: 'modelo',
}

function predictorL0() {
  return {
    id: 'formalismo',
    capa: 'L0',
    etiqueta: ETIQUETA_CAPA.L0,
    disponible: () => true,
    predecir({ segmento, signal }) {
      const alInicio = !(signal && signal.noInicioDoc)
      const r1 = predictFormalismo(segmento, { alInicioDoc: alInicio })
      if (r1.ghostTexto) {
        return Promise.resolve({
          texto: r1.ghostTexto, capa: 'L0',
          procedencia: { tipo: 'formalismo',
            fuente: t('pred.fuenteFormalismos'),
            ref: r1.ghost.id, anclaLen: segmento.length },
          latencia_ms: 0,
        })
      }
      const r2 = predictContenidoJuridico(segmento)
      if (r2.accionGhostTexto) {
        return Promise.resolve({
          texto: r2.accionGhostTexto, capa: 'L0',
          procedencia: { tipo: 'formalismo',
            fuente: t('pred.fuenteAcciones'),
            ref: r2.accion.id, anclaLen: segmento.length },
          latencia_ms: 0,
        })
      }
      return Promise.resolve(null)
    },
  }
}

export function PrediccionPanel({ editorRef, caseId, docInfo, verificacion,
  registro, setRegistro, sesion }) {
  const cfg = cfgDe(registro)
  const [destinoL2, setDestinoL2] = useState(null) // 'local'|'nube'|null
  const mesaRef = useRef(null)
  const cancelarRef = useRef(null)
  // registro cambia con cada gesto de la pizarra/privacidad/NIF: la mesa de
  // predictores NO debe reconstruirse por eso (cancelaría la sugerencia en
  // vuelo). prepararEnvio lee la privacidad vigente por este ref.
  const registroRef = useRef(registro)
  registroRef.current = registro

  const activo = cfg.activo === true
  const l0on = activo && cfg.l0 !== false
  const l1on = activo && cfg.l1 !== false
  const l2on = activo && cfg.l2 === true
    && (destinoL2 === 'local' || cfg.l2_optin === true)
  const telemetria = activo && cfg.telemetria === true

  // destino L2 una sola vez por sesión del chat
  useEffect(() => {
    setDestinoL2(null)
    if (!l2on || !sesion || !sesion.ruta) return
    let muerto = false
    leerDestino(host.requestProfile.bind(host), sesion.ruta)
      .then((d) => { if (!muerto) setDestinoL2(d) })
    return () => { muerto = true }
  }, [l2on, sesion])

  const fijarCfg = useCallback((cambio) => {
    setRegistro((r) => ({ ...(r || {}),
      prediccion: { ...cfgDe(r), ...cambio } }))
  }, [setRegistro])

  const registrarEvento = useCallback((capa, aceptada, largo, tipo) => {
    if (!telemetria) return
    rest('/prediccion/evento', { method: 'POST', body: {
      capa, aceptada, largo, procedencia: { tipo },
    } }).catch(() => {})
  }, [telemetria])

  // mesa con los predictores habilitados (re-creada al cambiar la config)
  useEffect(() => {
    const predictores = []
    if (l0on) predictores.push(predictorL0())
    if (l1on) predictores.push(crearPredictorCorpus())
    if (l2on && destinoL2) {
      predictores.push(crearPredictorModelo({
        requestProfile: host.requestProfile.bind(host),
        ruta: sesion && sesion.ruta,
        destino: destinoL2,
        prepararEnvio: ({ texto }) => {
          const cfgPriv = ((registroRef.current || {}).privacidad) || {}
          return prepararEnvio({
            caseId, texto,
            destino: (sesion && sesion.perfil || t('pred.perfilSinResolver'))
              + t('pred.destinoNubeCorto'),
            seudonimizar: cfgPriv.seudonimizar !== false,
            estrategia: cfgPriv.estrategia || 'media',
          })
        },
        registrarLocal: (texto) => rest('/prediccion/evento', {
          method: 'POST', body: { capa: 'L2', aceptada: false,
            largo: texto.length, procedencia: { tipo: 'modelo' } },
        }).catch(() => {}),
      }))
    }
    mesaRef.current = crearMesa({ predictores })
    return () => { if (mesaRef.current) mesaRef.current.cancelar() }
  }, [l0on, l1on, l2on, destinoL2, sesion, caseId])

  // onUpdate del editor: el editor avisa; aquí se pide la sugerencia.
  const pedir = useCallback((editor) => {
    if (!activo || !editor) return
    const sel = editor.view.state.selection
    const $from = sel.$from
    const textoParrafo = $from.parent.textContent || ''
    const offset = editor.view.state.doc.textBetween(
      $from.start(), sel.from, '\n', '\n')
    // marcas de cita en curso: el ghost nunca aparece dentro de una cita
    const marcas = []
    editor.view.state.doc.descendants((node, pos) => {
      node.marks.forEach((m) => { if (m.type.name === 'cita') {
        marcas.push({ from: pos, to: pos + node.nodeSize }) } })
    })
    const ctx = {
      normas: (((verificacion || {}).resultado || {}).detalles || [])
        .filter((d) => d.estado === 'VERIFICADA').map((d) => d.cita_raw),
      seccionesNif: [], caseId,
    }
    if (cancelarRef.current) cancelarRef.current()
    cancelarRef.current = mesaRef.current.sugerir({
      segmento: offset,
      contexto: ctx,
      signal: {
        haySeleccion: !sel.empty,
        enCita: marcas.some((m) => sel.from >= m.from && sel.from <= m.to),
      },
    }, (pred) => {
      const mejor = elegir(pred ? [pred] : [])
      fijarGhost(editor, mejor ? {
        texto: mejor.texto,
        rotulo: ETIQUETA_CAPA[mejor.capa] + ' · '
          + (mejor.procedencia.fuente || ''),
        capa: mejor.capa, procedencia: mejor.procedencia,
      } : null)
    })
  }, [activo, mesaRef, caseId, verificacion])

  // el editor llama esto desde su onUpdate cuando hay predicción activa
  useEffect(() => {
    editorRef.prediccionPedir = pedir
    editorRef.prediccionAceptada = (s) =>
      registrarEvento(s.capa || 'L0', true,
        (s.texto || '').length, (s.procedencia || {}).tipo || '')
    return () => {
      editorRef.prediccionPedir = null
      editorRef.prediccionAceptada = null
    }
  }, [editorRef, pedir, registrarEvento])

  return jsxs('div', { className: S.card, children: [
    jsxs('div', { className: 'flex flex-wrap items-center gap-2', children: [
      jsx('div', { className: S.cardTitle, children: t('pred.titulo') }),
      jsxs('label', { className: 'flex items-center gap-1 text-sm', children: [
        jsx('input', { type: 'checkbox', checked: activo,
          onChange: (e) => fijarCfg({ activo: e.target.checked }) }),
        t('pred.activar'),
      ] }),
      activo ? jsxs('label', { className: 'flex items-center gap-1 text-xs',
        children: [
          jsx('input', { type: 'checkbox', checked: cfg.l0 !== false,
            onChange: (e) => fijarCfg({ l0: e.target.checked }) }),
          t('pred.l0'),
        ] }) : null,
      activo ? jsxs('label', { className: 'flex items-center gap-1 text-xs',
        children: [
          jsx('input', { type: 'checkbox', checked: cfg.l1 !== false,
            onChange: (e) => fijarCfg({ l1: e.target.checked }) }),
          t('pred.l1'),
        ] }) : null,
      activo ? jsxs('label', { className: 'flex items-center gap-1 text-xs',
        children: [
          jsx('input', { type: 'checkbox', checked: cfg.l2 === true,
            onChange: (e) => {
              if (e.target.checked && destinoL2 === 'nube'
                && cfg.l2_optin !== true) {
                fijarCfg({ l2: true })
                return
              }
              fijarCfg({ l2: e.target.checked })
            } }),
          t('pred.l2') + ' ',
          destinoL2 ? '(' + (destinoL2 === 'local' ? 'local' : t('pred.destinoNube')) + ')'
            : '(' + t('pred.sinSesion') + ')',
        ] }) : null,
      activo ? jsxs('label', { className: 'flex items-center gap-1 text-xs',
        children: [
          jsx('input', { type: 'checkbox', checked: cfg.telemetria === true,
            onChange: (e) => fijarCfg({ telemetria: e.target.checked }) }),
          t('pred.telemetria'),
        ] }) : null,
    ] }),
    cfg.l2 && destinoL2 === 'nube' && cfg.l2_optin !== true
      ? jsxs('div', { className: 'flex items-center gap-2 text-xs', children: [
          t('pred.avisoNube'),
          jsx('button', { type: 'button', className: S.button,
            onClick: () => fijarCfg({ l2_optin: true }),
            children: t('pred.aceptoNube') }),
        ] }) : null,
    jsx('div', { className: 'text-xs text-(--ui-text-secondary)', children:
      t('pred.nota') }),
  ] })
}
