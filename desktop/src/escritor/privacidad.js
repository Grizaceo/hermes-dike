// Módulo Privacidad del Case Writer (F2a): el abogado VE y CONTROLA qué datos
// personales salen del escrito antes de que el texto llegue a un modelo.
// Fail-closed: si el detector o el registro de envío fallan, nada sale.

import { jsx, jsxs } from 'react/jsx-runtime'
import { useCallback, useEffect, useRef, useState } from 'react'
import { cancelarTarea, mensajeError, programarTimeout, rest, S } from '../common.js'
import { t } from '../i18n.js'
import { fijarMarcasPrivacidad, textoDelEditor } from './editor.js'
import { rangoAPos, segmentosDeDoc, sha256Hex } from './verificador.js'
import {
  agruparPorTipo, aplicarDecisionVista, marcasParaEditor, rehidratar,
} from './privacidad-logica.js'

export { rehidratar }

const DEBOUNCE_DETECTAR = 1500

const ESTRATEGIAS = [
  { id: 'ligera', texto: 'priv.estrategiaLigera' },
  { id: 'media', texto: 'priv.estrategiaMedia' },
  { id: 'estricta', texto: 'priv.estrategiaEstricta' },
]

const MOTIVOS = {
  juez: 'priv.motivo.juez',
  ancla_causa: 'priv.motivo.ancla_causa',
  institucion: 'priv.motivo.institucion',
  decision_abogado: 'priv.motivo.decision_abogado',
  por_estrategia: 'priv.motivo.por_estrategia',
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
    cancelarTarea(timer.current)
    timer.current = programarTimeout(detectar, DEBOUNCE_DETECTAR)
    return () => cancelarTarea(timer.current)
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
      (i, f) => rangoAPos(segs, i, f)).map(m => ({ ...m, title: m.title === 'POSSIBLE_PERSON' ? t('priv.possiblePerson') : m.title })))
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
      jsx('div', { className: S.cardTitle, children: t('format.privacy') }),
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
        t('priv.seudonimizar'),
      ] }),
      jsx('select', {
        className: S.input, value: estrategia,
        onChange: (e) => { guardarCfg({ estrategia: e.target.value }); detectar() },
        children: ESTRATEGIAS.map((o) =>
          jsx('option', { key: o.id, value: o.id, children: t(o.texto) })),
      }),
      jsx('button', {
        type: 'button', className: S.ghost, onClick: detectar, disabled: ocupado,
        children: ocupado ? t('priv.detectando') : t('priv.detectar'),
      }),
      jsx('button', {
        type: 'button', className: S.ghost, onClick: () => setVerMarcas(!verMarcas),
        children: verMarcas ? t('priv.ocultarMarcas') : t('priv.verMarcas'),
      }),
      jsx('button', {
        type: 'button', className: S.ghost, onClick: verSalida,
        children: t('priv.vistaSalida'),
      }),
      jsx('button', {
        type: 'button', className: S.ghost, onClick: enmascararSeleccion,
        children: t('priv.enmascararSeleccion'),
      }),
    ] }),

    confirmarOff ? jsxs('label', { className: 'flex items-center gap-1.5 text-xs dk-mal', children: [
      jsx('input', {
        type: 'checkbox', checked: confirmo,
        onChange: (e) => {
          if (e.target.checked) {
            guardarCfg({ seudonimizar: false, acepto_datos: true })
            setConfirmarOff(false)
          }
        },
      }),
      t('priv.entiendo'),
    ] }) : null,

    error ? jsx('div', { className: 'text-xs dk-mal', children:
      t('priv.error', { error: mensajeError(error) }) }) : null,

    deteccion ? jsxs('div', { className: 'flex flex-col gap-2', children: [
      jsxs('div', { className: 'flex flex-wrap gap-1.5', children: [
        ...Object.entries(conteos).map(([cat, n]) => jsxs('span', {
          key: cat, className: S.chip + ' ' + S.chipOff, children: [cat + ': ' + n],
        })),
        candidatos.length
          ? jsx('span', { className: S.chip + ' ' + S.chipBad, children:
              t('priv.posiblesPersonas', { n: candidatos.length }) })
          : null,
      ] }),

      grupos.map((g) => jsxs('div', { key: g.tipo, className: 'flex flex-col gap-1', children: [
        jsx('div', { className: 'text-xs font-medium uppercase tracking-wide text-(--ui-text-tertiary)', children: g.tipo }),
        ...g.items.map((e, i) => jsxs('div', { key: i, className: 'flex flex-wrap items-center gap-2 text-sm', children: [
          jsx('span', { className: 'font-mono text-xs', children: e.valor }),
          jsx('button', {
            type: 'button', className: S.link,
            onClick: () => decidir(e.valor, e.accion === 'enmascarar' ? 'conservar' : 'enmascarar', e.tipo),
            children: e.accion === 'enmascarar' ? t('priv.enmascarar') : t('priv.conservar'),
          }),
          e.motivo ? jsx('span', { className: S.sub, children: '(' + (MOTIVOS[e.motivo] ? t(MOTIVOS[e.motivo]) : e.motivo) + ')' }) : null,
        ] })),
      ] })),

      candidatos.length ? jsxs('div', { className: 'flex flex-col gap-1', children: [
        jsx('div', { className: 'text-xs font-medium uppercase tracking-wide text-(--ui-text-tertiary)',
          children: t('priv.posiblesSinContexto') }),
        ...candidatos.map((c, i) => jsxs('div', { key: i, className: 'flex items-center gap-2 text-sm', children: [
          jsx('span', { children: c.valor }),
          jsx('button', {
            type: 'button', className: S.link,
            onClick: () => decidir(c.valor, 'enmascarar', 'full_name'),
            children: t('priv.enmascarar'),
          }),
        ] })),
      ] }) : null,

      jsx('div', { className: S.sub, children: deteccion.aviso }),
    ] }) : jsx('div', { className: S.sub, children:
        t('priv.sinDeteccion') }),

    vistaSalida && vistaSalida !== 'cargando' ? jsxs('div', { className: 'flex flex-col gap-1', children: [
      jsx('div', { className: S.cardTitle, children: 'Vista de lo que sale' }),
      jsx('pre', { className: 'max-h-48 overflow-auto whitespace-pre-wrap font-mono text-xs',
        children: vistaSalida.texto }),
      jsxs('div', { className: S.sub, children: [
        t('priv.valoresMapa', { n: Object.keys(vistaSalida.mapa || {}).length }),
      ] }),
      jsx('button', { type: 'button', className: S.link, onClick: () => setVistaSalida(null), children: t('format.close') }),
    ] }) : vistaSalida === 'cargando' ? jsx('div', { className: S.sub, children: t('priv.preparando') }) : null,
  ] })
}
