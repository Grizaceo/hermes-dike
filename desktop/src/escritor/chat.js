// Chat del escrito (F2b): sesión por caso en el perfil del abogado, con el
// escrito viajando seudonimizado en cada turno. El estado de las citas lo
// fija Diké, nunca el modelo. Fail-closed: sin perfil con Diké habilitado no
// hay chat (sin hooks no se puede garantizar que el modelo no use tools).

import { jsx, jsxs } from 'react/jsx-runtime'
import { useCallback, useEffect, useRef, useState } from 'react'
import { host } from '@hermes/plugin-sdk'
import { mensajeError, rest, S } from '../common.js'
import { textoDelEditor } from './editor.js'
import { estadoCita, etiquetaCita, sha256Hex } from './verificador.js'
import { prepararEnvio, puedeEnviar, rehidratar } from './privacidad.js'
import {
  acumDeltas, activoDe, candidatosPerfil, componerTurno, etiquetaDestino,
  etiquetaModelo, filtroEvento, nombrePerfilActivo, parsePregunta,
} from './chat-logica.js'

const PERFIL_DEFAULT = 'lexo-lawyer'
const TIMEOUT_RPC = 60000

// Resuelve el descriptor de ruta del perfil (requestProfile exige el objeto,
// no el nombre, en topologías con más de una fuente).
async function resolverRuta(perfil) {
  const rutas = await host.profileRoutes()
  const lista = (rutas && (rutas.routes || rutas)) || []
  return lista.find((r) => r.targetProfile === perfil || r.profile === perfil) || null
}

function tituloSesion(caseId) {
  return 'Diké · Escrito · ' + caseId
}

const ESTILOS_ESTADO_RESP = {
  verificada: 'chipOk', fallo: 'chipBad', desactualizada: 'chipOff',
  retirada: 'chipOff', escalada: 'chipOff',
}


export function ChatEscritor({ editorRef, caseId, docInfo, verificacion,
  registro, setRegistro, estrategiaPriv, rev, onSesion }) {
  const [perfilOk, setPerfilOk] = useState(null) // null | true | {error}
  const [perfilElegido, setPerfilElegido] = useState(null) // perfil que responde
  const [sesion, setSesion] = useState(null)     // {session_id, stored_id, info}
  const rutaRef = useRef(null)                   // PluginProfileRoute
  const [modelo, setModelo] = useState(null)     // {id, destino}
  const [mensajes, setMensajes] = useState([])   // [{rol, texto, citas?, verif?}]
  const [stream, setStream] = useState('')       // delta acumulado en curso
  const [pregunta, setPregunta] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState(null)
  const releaseRef = useRef(null)
  const sesionRef = useRef(null)
  sesionRef.current = sesion
  const deltasRef = useRef([])
  const caseRef = useRef(caseId)
  caseRef.current = caseId
  const cfgRef = useRef(null)
  cfgRef.current = { estrategiaPriv, registro }

  // --- Verificación de perfil + apertura de sesión --------------------------
  useEffect(() => {
    let muerto = false
    setPerfilOk(null)
    setSesion(null)
    setMensajes([])
    ;(async () => {
      try {
        // candidatos: lexo-lawyer primero, luego el perfil activo de la app;
        // los hooks viajan con el plugin, así que cualquier perfil con Diké
        // habilitado es seguro — el primero con dike-verificar responde.
        const rutas = await host.profileRoutes()
        const listaRutas = (rutas && (rutas.routes || rutas)) || []
        const activo = nombrePerfilActivo(host.state && host.state.profile)
        const candidatos = candidatosPerfil(listaRutas, activo)
        let ruta = null
        let perfilObjetivo = null
        const paso = async (nombre, fn) => {
          try { return await fn() }
          catch (e) { throw new Error(nombre + ': ' + mensajeError(e)) }
        }
        const tieneDike = async (r, objetivo) => {
          try {
            const plugins = await host.requestProfile(r, 'plugins.list',
              {}, TIMEOUT_RPC)
            const lista = (plugins && (plugins.plugins
              || plugins.items || plugins)) || []
            const d = lista.find((p) => (p.name || p.plugin) === 'dike')
            return Boolean(d && d.enabled !== false && d.status !== 'disabled')
          } catch (e1) {
            try {
              const cat = await host.requestProfile(r, 'commands.catalog',
                { profile: objetivo }, TIMEOUT_RPC)
              const plano = JSON.stringify(cat)
              return /["'\s\/-]dike-verificar["'\s\/]/i.test(plano)
                || /"name"\s*:\s*"dike-verificar"/i.test(plano)
            } catch { return false }
          }
        }
        for (const candidato of candidatos) {
          const r = listaRutas.find((x) =>
            (x.targetProfile || x.profile) === candidato)
          if (!r) continue
          if (await tieneDike(r, candidato)) {
            ruta = r
            perfilObjetivo = candidato
            break
          }
        }
        if (!ruta) {
          throw new Error('El chat del escrito necesita un perfil con Diké ' +
            'habilitado (lexo-lawyer o el perfil activo): sin sus hooks no ' +
            'se puede garantizar que el modelo no use herramientas.')
        }
        const perfil = perfilObjetivo
        setPerfilElegido(perfil)
        rutaRef.current = ruta
        releaseRef.current = await host.retainProfile(ruta)
        const titulo = tituloSesion(caseId)
        // Patrón Bot Mode: profile va dentro de params; el create canónico
        // solo acepta {profile,title,hidden,follow_profile_config} — el
        // marcador 'dike-escritor' viaja en session.resume (source libre).
        const previas = await paso('session.list', () =>
          host.requestProfile(ruta, 'session.list',
            { profile: perfilObjetivo, title: titulo, limit: 50,
              include_hidden: true }, TIMEOUT_RPC))
        const filas = (previas && (previas.sessions || previas.items || previas)) || []
        let s
        if (filas.length) {
          const stored = filas[0].stored_session_id || filas[0].id
            || filas[0].session_id || filas[0].resolved_id
          s = await paso('session.resume', () =>
            host.requestProfile(ruta, 'session.resume', {
              profile: perfilObjetivo, session_id: stored,
              source: 'dike-escritor', display_projection: true,
            }, TIMEOUT_RPC))
        } else {
          s = await paso('session.create', () =>
            host.requestProfile(ruta, 'session.create', {
              profile: perfilObjetivo, title: titulo,
              hidden: true, follow_profile_config: true,
            }, TIMEOUT_RPC))
          // el create canónico siempre sale como 'gui'; el resume intenta
          // re-etiquetar, pero la marca real que leen los hooks es el sobre
          // '<dike-escritor v="1">' al inicio de cada mensaje (hooks.py).
          const rid = s && (s.session_id || (s.info && s.info.session_id))
          if (rid) {
            s = await paso('session.resume-source', () =>
              host.requestProfile(ruta, 'session.resume', {
                profile: perfilObjetivo, session_id: rid,
                source: 'dike-escritor', display_projection: true,
              }, TIMEOUT_RPC)).catch(() => s)
          }
        }
        if (muerto) return
        const sid = s.session_id || (s.info && s.info.session_id)
        setSesion({ session_id: sid, stored_id: s.stored_session_id, info: s.info })
        // lo que manda al modelo = el runtime id; el padre lo usa para NIF
        if (typeof onSesion === 'function') {
          onSesion({ session_id: sid, stored_id: s.stored_session_id,
            ruta: rutaRef.current, perfil: perfilObjetivo })
        }
        const info = s.info || {}
        const modelId = info.model || info.model_id || s.model
        setModelo({ id: modelId, destino: etiquetaDestino(info) })
        setPerfilOk(true)
        // historial al reabrir: viene en el snapshot (session.history no
        // existe en el transporte canónico)
        const msgs = (s.display_messages || s.messages
          || (s.info && s.info.messages) || []) || []
        if (muerto) return
        const render = []
        for (const m of msgs) {
          const rol = m.role || m.rol
          const texto = m.text || m.content || m.body || ''
          if (rol === 'user') {
            const q = parsePregunta(texto)
            if (q) render.push({ rol: 'user', texto: q })
          } else if (rol === 'assistant') {
            render.push({ rol: 'assistant', texto })
          }
        }
        // el historial viene sin rehidratar (los tokens persisten por caso)
        setMensajes(render)
      } catch (e) {
        if (!muerto) {
          setPerfilOk({ error: e })
          setError(e)
        }
      }
    })()
    return () => {
      muerto = true
      if (releaseRef.current) { releaseRef.current(); releaseRef.current = null }
    }
  }, [caseId])

  // --- Suscripción a eventos del gateway ------------------------------------
  useEffect(() => {
    const onEvent = host && host.onEvent
    if (!onEvent || typeof onEvent !== 'function') return
    const tipos = ['message.delta', 'message.complete']
    const offs = tipos.map((tipo) => onEvent.call(host, tipo, (ev) => {
      const s = sesionRef.current
      if (!s || !filtroEvento(ev, s.session_id, null)) return
      if (tipo === 'message.delta') {
        deltasRef.current.push({ offset: ev.offset || 0, text: ev.text || '' })
        setStream(acumDeltas(deltasRef.current))
      } else if (tipo === 'message.complete') {
        const texto = ev.text || acumDeltas(deltasRef.current)
        deltasRef.current = []
        setStream('')
        finalizarRespuesta(texto)
      }
    }))
    return () => offs.forEach((off) => { if (typeof off === 'function') off() })
  }, [])

  const finalizarRespuesta = useCallback((textoCrudo) => {
    const cid = caseRef.current
    setMensajes((ms) => [...ms, {
      rol: 'assistant', texto: textoCrudo, verificando: true,
    }])
    setOcupado(false)
    // verifica las citas de la respuesta SIN rehidratar
    sha256Hex(textoCrudo).then((hash) =>
      rest('/verificar', { method: 'POST', body: { texto: textoCrudo }, timeoutMs: 320000 })
        .then((res) => ({ res, hash }))
        .catch(() => null)
    ).then((out) => {
      setMensajes((ms) => ms.map((m, i) => i === ms.length - 1 ? {
        ...m, verificando: false,
        verif: out || { fallo: true },
      } : m))
    })
  }, [])

  const enviar = useCallback(() => {
    const ed = editorRef.current
    const s = sesionRef.current
    const q = pregunta.trim()
    if (!ed || !s || !q || ocupado) return
    const cid = caseRef.current
    setOcupado(true)
    setError(null)
    deltasRef.current = []
    const textoEscrito = textoDelEditor(ed)
    const ultimo = (registro && registro.chat && registro.chat.ultimoEnviado) || null
    const sel = ed.view && ed.view.state.selection
    const activo = activoDe(
      sel && !sel.empty
        ? sel.$from.doc.textBetween(sel.from, sel.to, '\n', '\n') : '',
      sel && sel.$from && sel.$from.parent ? (sel.$from.parent.textContent || '') : '')
    const hashP = docInfo && docInfo.hash
    const { turno, hashes } = componerTurno({
      pregunta: q, textoEscrito, ultimoEnviado: ultimo, activo,
      verificacion, rev, caseId: cid, hashActual: hashP,
    })
    const destino = PERFIL_DEFAULT + ' · ' + etiquetaModelo(modelo && modelo.id)
    const cfgPriv = (registro && registro.privacidad) || {}
    const seudonimizar = cfgPriv.seudonimizar !== false
    if (!seudonimizar && cfgPriv.acepto_datos !== true) {
      setError(new Error('Activa la seudonimización o confirma en el módulo ' +
        'Privacidad que aceptas enviar datos personales.'))
      setOcupado(false)
      return
    }
    prepararEnvio({
      caseId: cid, texto: turno, destino,
      seudonimizar, estrategia: cfgPriv.estrategia || 'media',
    }).then((envio) => {
      if (!puedeEnviar()) throw new Error('privacidad bloqueó el envío')
      return host.requestProfile(rutaRef.current, 'prompt.submit',
        { session_id: s.session_id, text: envio.texto,
          profile: (rutaRef.current && rutaRef.current.targetProfile) || PERFIL_DEFAULT },
        TIMEOUT_RPC)
        .then(() => {
          setMensajes((ms) => [...ms, { rol: 'user', texto: q }])
          setPregunta('')
          setRegistro((r) => {
            const chatAnterior = (r && r.chat) || {}
            return { ...(r || {}), chat: {
              ...chatAnterior,
              ultimoEnviado: { hashes },
              // acumulado: unión de mapas — un token ya asignado no cambia
              mapa: { ...(chatAnterior.mapa || {}), ...(envio.mapa || {}) },
            } }
          })
        })
    }).catch((e) => { setError(e); setOcupado(false) })
  }, [pregunta, ocupado, editorRef, docInfo, verificacion, registro, setRegistro, modelo])

  const detener = useCallback(() => {
    const s = sesionRef.current
    if (!s) return
    host.requestProfile(rutaRef.current, 'session.interrupt',
      { session_id: s.session_id,
        profile: (rutaRef.current && rutaRef.current.targetProfile) || PERFIL_DEFAULT },
      TIMEOUT_RPC).catch(() => {})
    setOcupado(false)
  }, [])

  const insertar = useCallback((texto) => {
    const ed = editorRef.current
    if (!ed) return
    const mapa = (registro && registro.chat && registro.chat.mapa) || {}
    const rehid = rehidratar(texto, mapa)
    const { from } = ed.state.selection
    ed.chain().focus().insertContentAt(from, rehid).run()
  }, [editorRef, registro])

  if (perfilOk && perfilOk.error) {
    return jsx('div', { className: S.card, children:
      jsx('div', { className: 'text-xs text-(--ui-danger)',
        children: mensajeError(perfilOk.error) }) })
  }

  return jsxs('div', { className: S.card, children: [
    jsxs('div', { className: 'flex items-center gap-2', children: [
      jsx('div', { className: S.cardTitle, children: 'Chat del escrito' }),
      perfilElegido ? jsx('span', { className: 'text-xs '
        + 'text-(--ui-text-secondary)',
        children: '· ' + perfilElegido }) : null,
      modelo ? jsx('span', { className: S.sub, children:
        etiquetaModelo(modelo.id) + ' · ' + modelo.destino }) : null,
    ] }),
    jsx('div', { className: S.sub, children:
      'El estado de las citas lo fija Diké, no el modelo.' }),
    perfilOk === null ? jsx('div', { className: S.sub, children: 'abriendo sesión…' }) : null,

    jsxs('div', { className: 'flex max-h-80 flex-col gap-2 overflow-auto', children: [
      ...mensajes.map((m, i) => jsxs('div', {
        key: i,
        className: m.rol === 'user' ? 'text-sm' : 'rounded border border-(--ui-stroke-secondary) p-2 text-sm',
        children: [
          m.rol === 'user'
            ? jsxs('span', { children: [jsx('b', { children: 'Tú: ' }), rehidratar(m.texto, {})] })
            : jsxs('div', { className: 'flex flex-col gap-1', children: [
                jsx('div', { className: 'whitespace-pre-wrap', children:
                  rehidratar(m.texto,
                    (registro && registro.chat && registro.chat.mapa) || {}) }),
                m.verificando ? jsx('span', { className: S.chip + ' ' + S.chipOff,
                  children: 'verificando citas…' }) : null,
                m.verif && m.verif.fallo ? jsx('div', { className: 'text-xs text-(--ui-danger)',
                  children: 'No se pudieron verificar las citas de esta respuesta: trátalas como no verificadas.' }) : null,
                m.verif && m.verif.res ? jsxs('div', { className: 'flex flex-wrap gap-1', children:
                    (m.verif.res.detalles || []).map((d, j) => {
                      const est = estadoCita(d, m.verif.hash, m.verif.hash, registro)
                      return jsx('span', {
                        key: j,
                        className: S.chip + ' ' + (S[ESTILOS_ESTADO_RESP[est]] || S.chipOff),
                        title: etiquetaCita(est, d, (m.verif.res.meta || {}), registro),
                        children: d.cita_raw,
                      })
                    }) }) : null,
                jsx('button', {
                  type: 'button', className: S.link,
                  onClick: () => insertar(m.texto), children: 'Insertar en el escrito',
                }),
              ] }),
        ],
      })),
      stream ? jsx('div', { className: 'rounded border border-(--ui-stroke-secondary) p-2 text-sm whitespace-pre-wrap', children: stream }) : null,
    ] }),

    error ? jsx('div', { className: 'text-xs text-(--ui-danger)', children: mensajeError(error) }) : null,

    jsxs('div', { className: 'flex items-center gap-2', children: [
      jsx('input', {
        className: S.input + ' flex-1', value: pregunta,
        placeholder: 'Pregunta sobre el escrito…',
        disabled: !sesion || ocupado,
        onChange: (e) => setPregunta(e.target.value),
        onKeyDown: (e) => { if (e.key === 'Enter') enviar() },
      }),
      jsx('button', {
        type: 'button', className: S.button, onClick: enviar,
        disabled: !sesion || ocupado || !pregunta.trim(),
        children: ocupado ? '…' : 'Enviar',
      }),
      jsx('button', {
        type: 'button', className: S.ghost, onClick: detener,
        disabled: !ocupado, children: 'Detener',
      }),
    ] }),
  ] })
}
