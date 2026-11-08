// Módulo Privacidad del Case Writer (F2a): el abogado VE y CONTROLA qué datos
// personales salen del escrito antes de que el texto llegue a un modelo.
// Fail-closed: si el detector o el registro de envío fallan, nada sale.

import { jsx, jsxs } from 'react/jsx-runtime'
import { useCallback, useEffect, useRef, useState } from 'react'
import { mensajeError, rest, S } from '../common.js'
import { fijarMarcasPrivacidad, textoDelEditor } from './editor.js'
import { rangoAPos, segmentosDeDoc, sha256Hex } from './verificador.js'
import {
  agruparPorTipo, aplicarDecisionVista, marcasParaEditor, rehidratar,
} from './privacidad-logica.js'

export { rehidratar }

const DEBOUNCE_DETECTAR = 1500

const ESTRATEGIAS = [
  { id: 'ligera', texto: 'ligera (solo críticos)' },
  { id: 'media', texto: 'media (críticos + altos)' },
  { id: 'estricta', texto: 'estricta (+ medios)' },
]

const MOTIVOS = {
  juez: 'juez (público)',
  ancla_causa: 'ancla de causa',
  institucion: 'institución',
  decision_abogado: 'decisión del abogado',
  por_estrategia: 'bajo la estrategia',
}

// puedeEnviar: false si el último intento de detección/registro falló.
// F2b lo consulta antes de enviar texto al modelo.
let _puedeEnviar = true
export function puedeEnviar() { return _puedeEnviar }

// prepararEnvio: seudonimiza (o no, si el abogado lo apagó con confirmación),
// registra el envío y devuelve {texto, mapa, sha256}. Cualquier error ⇒
// rechaza la promesa: nada sale del equipo.
export function prepararEnvio({ caseId, texto, destino, seudonimizar, estrategia }) {
  if (seudonimizar === false) {
    return sha256Hex(texto).then((sha256) =>
      rest('/privacidad/envio', {
        method: 'POST',
        body: { case_id: caseId, destino, sha256, conteos: {},
                estrategia: estrategia || 'media', seudonimizado: false },
      }).then(() => ({ texto, mapa: {}, sha256 })))
  }
  return rest('/privacidad/seudonimizar', {
    method: 'POST',
    body: { case_id: caseId, texto, estrategia: estrategia || 'media' },
  }).then((r) => rest('/privacidad/envio', {
    method: 'POST',
    body: { case_id: caseId, destino, sha256: r.sha256,
            conteos: r.conteos, estrategia: estrategia || 'media',
            seudonimizado: true },
  }).then(() => ({ texto: r.texto, mapa: r.mapa, sha256: r.sha256 })))
}


export function ModuloPrivacidad({ editorRef, caseId, docInfo, registro, setRegistro }) {
  const cfg = (registro && registro.privacidad) || {}
  const seudOn = cfg.seudonimizar !== false
  const confirmo = Boolean(cfg.acepto_datos)
  const estrategia = cfg.estrategia || 'media'

  const [deteccion, setDeteccion] = useState(null)
  const [error, setError] = useState(null)
  const [ocupado, setOcupado] = useState(false)
  const [verMarcas, setVerMarcas] = useState(false)
  const [vistaSalida, setVistaSalida] = useState(null)
  const [confirmarOff, setConfirmarOff] = useState(false)
  const timer = useRef(null)
  const detRef = useRef(null)
  detRef.current = deteccion

  const guardarCfg = useCallback((parche) => {
    setRegistro((r) => ({ ...(r || {}), privacidad: { ...(r || {}).privacidad, ...parche } }))
  }, [setRegistro])

  const detectar = useCallback(() => {
    const ed = editorRef.current
    if (!ed) return
    const texto = textoDelEditor(ed)
    setOcupado(true)
    setError(null)
    rest('/privacidad/detectar', {
      method: 'POST',
      body: { case_id: caseId, texto, estrategia },
    }).then((d) => {
      _puedeEnviar = true
      setDeteccion(d)
    }).catch((e) => {
      _puedeEnviar = false
      setError(e)
    }).finally(() => setOcupado(false))
  }, [editorRef, caseId, estrategia])

  // Debounce ~1,5 s cuando el hash del documento cambia.
  useEffect(() => {
    if (!(docInfo && docInfo.hash)) return
    clearTimeout(timer.current)
    timer.current = setTimeout(detectar, DEBOUNCE_DETECTAR)
    return () => clearTimeout(timer.current)
  }, [docInfo && docInfo.hash, detectar])

  // Marcas inline de privacidad en el editor.
  useEffect(() => {
    const ed = editorRef.current
    if (!ed) return
    if (!verMarcas || !deteccion) {
      fijarMarcasPrivacidad(ed, [])
      return
    }
    const segs = segmentosDeDoc(ed.state.doc)
    fijarMarcasPrivacidad(ed, marcasParaEditor(
      deteccion.entidades, deteccion.candidatos,
      (i, f) => rangoAPos(segs, i, f)))
  }, [verMarcas, deteccion, editorRef])

  const decidir = useCallback((valor, accion, tipo) => {
    rest('/privacidad/decision', {
      method: 'POST',
      body: { case_id: caseId, valor, accion, tipo },
    }).then(() => {
      setDeteccion((d) => d && {
        ...d, entidades: aplicarDecisionVista(d.entidades, valor, accion),
      })
      detectar()
    }).catch(setError)
  }, [caseId, detectar])

  const enmascararSeleccion = useCallback(() => {
    const ed = editorRef.current
    if (!ed) return
    const { from, to } = ed.state.selection
    const valor = ed.state.doc.textBetween(from, to, ' ', ' ')
    if (!valor.trim()) return
    decidir(valor, 'enmascarar', 'full_name')
  }, [editorRef, decidir])

  const verSalida = useCallback(() => {
    const ed = editorRef.current
    if (!ed) return
    setVistaSalida('cargando')
    rest('/privacidad/seudonimizar', {
      method: 'POST',
      body: { case_id: caseId, texto: textoDelEditor(ed), estrategia },
    }).then((r) => setVistaSalida(r)).catch((e) => {
      _puedeEnviar = false
      setVistaSalida(null)
      setError(e)
    })
  }, [editorRef, caseId, estrategia])

  const conteos = (deteccion && deteccion.conteos) || {}
  const grupos = agruparPorTipo(deteccion && deteccion.entidades)
  const candidatos = (deteccion && deteccion.candidatos) || []

  return jsxs('div', { className: S.card, children: [
    jsxs('div', { className: 'flex flex-wrap items-center gap-2', children: [
      jsx('div', { className: S.cardTitle, children: 'Privacidad' }),
      jsxs('label', { className: 'flex items-center gap-1.5 text-xs', children: [
        jsx('input', {
          type: 'checkbox', checked: seudOn,
          onChange: (e) => {
            if (!e.target.checked) {
              setConfirmarOff(true)
            } else {
              guardarCfg({ seudonimizar: true, acepto_datos: false })
              setConfirmarOff(false)
            }
          },
        }),
        'Seudonimizar antes de enviar al modelo',
      ] }),
      jsx('select', {
        className: S.input, value: estrategia,
        onChange: (e) => { guardarCfg({ estrategia: e.target.value }); detectar() },
        children: ESTRATEGIAS.map((o) =>
          jsx('option', { key: o.id, value: o.id, children: o.texto })),
      }),
      jsx('button', {
        type: 'button', className: S.ghost, onClick: detectar, disabled: ocupado,
        children: ocupado ? 'detectando…' : 'Detectar datos',
      }),
      jsx('button', {
        type: 'button', className: S.ghost, onClick: () => setVerMarcas(!verMarcas),
        children: verMarcas ? 'Ocultar datos en el escrito' : 'Ver datos personales en el escrito',
      }),
      jsx('button', {
        type: 'button', className: S.ghost, onClick: verSalida,
        children: 'Vista de lo que sale',
      }),
      jsx('button', {
        type: 'button', className: S.ghost, onClick: enmascararSeleccion,
        children: 'Enmascarar selección',
      }),
    ] }),

    confirmarOff ? jsxs('label', { className: 'flex items-center gap-1.5 text-xs text-(--ui-danger)', children: [
      jsx('input', {
        type: 'checkbox', checked: confirmo,
        onChange: (e) => {
          if (e.target.checked) {
            guardarCfg({ seudonimizar: false, acepto_datos: true })
            setConfirmarOff(false)
          }
        },
      }),
      'Entiendo que el texto saldrá con datos personales',
    ] }) : null,

    error ? jsx('div', { className: 'text-xs text-(--ui-danger)', children:
      'Privacidad no disponible: ' + mensajeError(error) +
      ' — el texto no debe salir hasta resolverlo.' }) : null,

    deteccion ? jsxs('div', { className: 'flex flex-col gap-2', children: [
      jsxs('div', { className: 'flex flex-wrap gap-1.5', children: [
        ...Object.entries(conteos).map(([cat, n]) => jsxs('span', {
          key: cat, className: S.chip + ' ' + S.chipOff, children: [cat + ': ' + n],
        })),
        candidatos.length
          ? jsx('span', { className: S.chip + ' ' + S.chipBad, children:
              candidatos.length + ' posibles personas' })
          : null,
      ] }),

      grupos.map((g) => jsxs('div', { key: g.tipo, className: 'flex flex-col gap-1', children: [
        jsx('div', { className: 'text-xs font-medium uppercase tracking-wide text-(--ui-text-tertiary)', children: g.tipo }),
        ...g.items.map((e, i) => jsxs('div', { key: i, className: 'flex flex-wrap items-center gap-2 text-sm', children: [
          jsx('span', { className: 'font-mono text-xs', children: e.valor }),
          jsx('button', {
            type: 'button', className: S.link,
            onClick: () => decidir(e.valor, e.accion === 'enmascarar' ? 'conservar' : 'enmascarar', e.tipo),
            children: e.accion === 'enmascarar' ? 'enmascarar' : 'conservar',
          }),
          e.motivo ? jsx('span', { className: S.sub, children: '(' + (MOTIVOS[e.motivo] || e.motivo) + ')' }) : null,
        ] })),
      ] })),

      candidatos.length ? jsxs('div', { className: 'flex flex-col gap-1', children: [
        jsx('div', { className: 'text-xs font-medium uppercase tracking-wide text-(--ui-text-tertiary)',
          children: 'Posibles personas sin contexto' }),
        ...candidatos.map((c, i) => jsxs('div', { key: i, className: 'flex items-center gap-2 text-sm', children: [
          jsx('span', { children: c.valor }),
          jsx('button', {
            type: 'button', className: S.link,
            onClick: () => decidir(c.valor, 'enmascarar', 'full_name'),
            children: 'Enmascarar',
          }),
        ] })),
      ] }) : null,

      jsx('div', { className: S.sub, children: deteccion.aviso }),
    ] }) : jsx('div', { className: S.sub, children:
        'Sin detección aún: edita el escrito o pulsa «Detectar datos».' }),

    vistaSalida && vistaSalida !== 'cargando' ? jsxs('div', { className: 'flex flex-col gap-1', children: [
      jsx('div', { className: S.cardTitle, children: 'Vista de lo que sale' }),
      jsx('pre', { className: 'max-h-48 overflow-auto whitespace-pre-wrap font-mono text-xs',
        children: vistaSalida.texto }),
      jsxs('div', { className: S.sub, children: [
        Object.keys(vistaSalida.mapa || {}).length + ' valores seudonimizados · destino: aún sin destino (el chat llega en la fase siguiente)',
      ] }),
      jsx('button', { type: 'button', className: S.link, onClick: () => setVistaSalida(null), children: 'cerrar' }),
    ] }) : vistaSalida === 'cargando' ? jsx('div', { className: S.sub, children: 'preparando vista…' }) : null,
  ] })
}
