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
  etiquetaModelo, filtroEvento, fragmentoEn, nombrePerfilActivo, parsePregunta,
  parsearNotas,
} from './chat-logica.js'

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

// Caché por nodo_id de las lecturas /grafo/leer dentro del componente: varias
// notas pueden citar el mismo artículo y no hay que releerlo.
const _leerCache = new Map()
function leerArticulo(nodoId) {
  if (!_leerCache.has(nodoId)) {
    const p = rest('/grafo/leer', {
      method: 'POST', body: { nodo_id: nodoId }, timeoutMs: 120000,
    }).catch((e) => {
      // Un error no se cachea: la próxima renderización reintenta la lectura.
      _leerCache.delete(nodoId)
      return { __error: e }
    })
    _leerCache.set(nodoId, p)
  }
  return _leerCache.get(nodoId)
}

// Texto contra el que se compara el fragmento: el de la unidad si la nota la
// señala, o el del artículo completo.
function textoParaNota(data, unidadId) {
  if (!data || data.resolucion !== 'RESOLVED') return null
  if (unidadId) {
    const u = (data.unidades || []).find((x) => x.id === unidadId)
    if (u && typeof u.texto === 'string') return u.texto
  }
  return typeof data.texto === 'string' ? data.texto : null
}

// Una nota al pie: verifica el nodo, el fragmento contra el artículo y la
// cita contra la verificación del motor. Nunca afirma pertinencia.
function NotaItem({ nota, verif, onAbrirGrafo }) {
  const [nodoOk, setNodoOk] = useState(null)   // null | true | false
  const [frag, setFrag] = useState(null)      // null | {ok, motivo}
  const [leerMal, setLeerMal] = useState(false)   // la lectura /grafo/leer falló
  const [leerRes, setLeerRes] = useState(null)    // resolucion no RESOLVED
  const [citaDet, setCitaDet] = useState(undefined) // undefined | detalle
  const nodoId = nota.nodo_id

  useEffect(() => {
    let vivo = true
    setNodoOk(null); setFrag(null); setLeerMal(false); setLeerRes(null)
    rest('/grafo/nodo?id=' + encodeURIComponent(nodoId))
      .then(() => { if (vivo) setNodoOk(true) })
      .catch(() => { if (vivo) setNodoOk(false) })
    leerArticulo(nodoId).then((data) => {
      if (!vivo) return
      if (data && data.__error) { setLeerMal(true); setFrag(null); return }
      if (!data || data.resolucion !== 'RESOLVED') {
        setLeerRes((data && data.resolucion) || 'UNRESOLVABLE'); setFrag(null); return
      }
      const texto = textoParaNota(data, nota.unidad_id)
      setFrag(texto == null ? { ok: false, motivo: 'ausente' }
        : fragmentoEn(nota.fragmento, texto))
    }).catch(() => { if (vivo) { setLeerMal(true); setFrag(null) } })
    return () => { vivo = false }
  }, [nodoId, nota.unidad_id, nota.fragmento])

  useEffect(() => {
    const detalles = (verif && verif.res && verif.res.detalles) || []
    const c = (nota.cita || '').trim()
    setCitaDet(c ? detalles.find((d) => (d.cita_raw || '').trim() === c) : undefined)
  }, [nota.cita, verif])

  const nodoInexistente = nodoOk === false || leerRes != null
  const fragTexto = leerMal ? 'No se pudo leer el artículo'
    : leerRes != null ? 'Nodo inexistente'
    : frag == null ? 'comprobando fragmento…'
    : frag.ok ? 'Fragmento encontrado en el artículo'
    : 'El fragmento no está en ese artículo' +
      (frag.motivo === 'corto' ? ' (muy corto para comparar)'
        : frag.motivo === 'largo' ? ' (demasiado largo)' : '')
  const abrir = () => onAbrirGrafo &&
    onAbrirGrafo({ nodo_id: nodoId, unidad_id: nota.unidad_id,
      fragmento: nota.fragmento })

  return jsxs('div', { className: 'flex flex-col gap-0.5 text-xs', children: [
    jsxs('div', { className: 'flex flex-wrap items-center gap-1.5', children: [
      jsx('span', { className: S.sub, children: '[^' + nota.n + ']' }),
      jsx('code', { className: S.sub, children: nodoId + (nota.unidad_id ? ' ' + nota.unidad_id.split('#')[1] : '') }),
      citaDet
        ? jsx('span', {
            className: S.chip + ' ' + (citaDet.estado === 'VERIFICADA' ? S.chipOk : S.chipOff),
            title: 'Estado que fijó el motor para esta cita',
            children: citaDet.estado,
          })
        : null,
      jsx('button', {
        type: 'button', className: S.link, disabled: nodoInexistente,
        title: nodoInexistente ? 'El nodo no existe en el corpus'
          : 'Verifícalo tú: abrir en el grafo',
        onClick: abrir,
        children: 'Verifícalo tú: abrir en el grafo',
      }),
    ] }),
    jsxs('div', { className: S.sub, children: [
      nodoOk === null ? 'comprobando nodo…' : nodoInexistente ? 'Nodo inexistente' : null,
      nodoOk === true ? jsx('span', { children: (nodoOk === true ? ' · ' : '') + fragTexto }) : null,
    ] }),
  ] })
}

// Bloque «Notas» de una respuesta del asistente: las notas válidas con su
// verificación y las líneas con formato no reconocible. Siempre recuerda que
// la pertinencia es una lectura del modelo, no una conclusión.
function NotasAlPie({ notas, invalidas, verif, onAbrirGrafo }) {
  if (!notas.length && !invalidas.length) return null
  return jsxs('div', { className: 'flex flex-col gap-1 rounded border '
    + 'border-(--ui-stroke-secondary) p-2', children: [
    jsx('div', { className: S.cardTitle, children: 'Notas' }),
    ...notas.map((n) => jsx(NotaItem, {
      key: n.n, nota: n, verif, onAbrirGrafo })),
    ...invalidas.map((iv) => jsx('div', {
      key: 'inv' + iv.n, className: 'text-xs text-(--ui-danger)',
      children: 'Nota con formato no reconocible: [^' + iv.n + ']' }),
    ),
    jsx('div', { className: S.sub, children:
      'La pertinencia para el caso es una lectura del modelo; decides tú.' }),
  ] })
}


export function ChatEscritor({ editorRef, caseId, docInfo, verificacion,
  registro, setRegistro, estrategiaPriv, rev, onSesion, onAbrirGrafo,
  onAbrirPrivacidad, modoDock = true }) {
  const [perfilOk, setPerfilOk] = useState(null) // null | true | {error}
  const [perfilElegido, setPerfilElegido] = useState(null) // perfil que responde
  const perfilRef = useRef(null)                    // perfil resuelto (callbacks)
  const [sesion, setSesion] = useState(null)     // {session_id, stored_id, info}
  const rutaRef = useRef(null)                   // PluginProfileRoute
  const [modelo, setModelo] = useState(null)     // {id, destino}
  const [mensajes, setMensajes] = useState([])   // [{rol, texto, citas?, verif?}]
  const [stream, setStream] = useState('')       // delta acumulado en curso
  const [pregunta, setPregunta] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState(null)
  const [verContexto, setVerContexto] = useState(false)
  const [avisoCerrado, setAvisoCerrado] = useState(false)
  const releaseRef = useRef(null)
  const endRef = useRef(null)
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
    perfilRef.current = null
    ;(async () => {
      try {
        // candidato: el setting perfil_chat si está configurado, si no el
        // perfil activo de la app. Los hooks viajan con el plugin, así que
        // cualquier perfil con Diké habilitado es seguro — el primero con
        // dike-verificar responde.
        const rutas = await host.profileRoutes()
        const listaRutas = (rutas && (rutas.routes || rutas)) || []
        const activo = nombrePerfilActivo(host.state && host.state.profile)
        let perfilConfigurado = ''
        try {
          const est = await rest('/estado')
          perfilConfigurado = (est && est.perfil_chat) || ''
        } catch { /* sin /estado el chat sigue con el perfil activo */ }
        const candidatos = candidatosPerfil(listaRutas, activo, perfilConfigurado)
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
            'habilitado: configura el setting perfil_chat del plugin o usa el ' +
            'perfil activo' + (activo ? ' («' + activo + '»)' : '') +
            '. Sin sus hooks no se puede garantizar que el modelo no use ' +
            'herramientas.')
        }
        const perfil = perfilObjetivo
        setPerfilElegido(perfil)
        perfilRef.current = perfil
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
    const destino = (perfilRef.current || 'perfil sin resolver') +
      ' · ' + etiquetaModelo(modelo && modelo.id)
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
          profile: perfilRef.current ||
            (rutaRef.current && (rutaRef.current.targetProfile
              || rutaRef.current.profile)) },
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
        profile: perfilRef.current ||
          (rutaRef.current && (rutaRef.current.targetProfile
            || rutaRef.current.profile)) },
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

  useEffect(() => {
    if (endRef.current && typeof endRef.current.scrollIntoView === 'function') {
      endRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [mensajes.length, ocupado, stream])

  const cfgPriv = (registro && registro.privacidad) || {}
  const seudOn = cfgPriv.seudonimizar !== false
  const estrategiaActiva = cfgPriv.estrategia || 'media'
  const largoEscrito = ((docInfo && docInfo.texto) || '').length
  const numCitasVerif = (((verificacion && verificacion.resultado && verificacion.resultado.meta) || {}).citas_verificadas) || 0

  if (perfilOk && perfilOk.error) {
    return jsxs('div', {
      className: modoDock
        ? 'flex h-full w-full flex-col border-l border-slate-200 bg-white text-slate-800'
        : S.card,
      children: [
        jsxs('div', { className: 'flex items-center gap-2 border-b border-slate-200 px-3 py-2 text-xs', children: [
          jsx('span', { className: 'font-semibold text-slate-800', children: 'Hermes' }),
          jsx('span', { className: 'h-2 w-2 rounded-full bg-amber-500', title: 'sin perfil con Diké' }),
        ] }),
        jsxs('div', { className: 'p-3 flex flex-col gap-2', children: [
          jsx('div', { className: 'rounded border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900 leading-relaxed',
            children: mensajeError(perfilOk.error) }),
        ] }),
      ],
    })
  }

  return jsxs('div', {
    className: modoDock
      ? 'flex h-full w-full flex-col bg-white text-slate-800 overflow-hidden'
      : S.card,
    children: [
      // Cabecera superior estilo Hermes Chat (imagen 2)
      jsxs('div', {
        className: 'flex items-center gap-2 border-b border-slate-200 px-3 h-9 text-xs shrink-0 bg-slate-50/60',
        children: [
          jsx('span', { className: 'font-semibold text-slate-800', children: 'Hermes' }),
          jsx('span', {
            className: 'text-slate-500 truncate',
            children: perfilElegido || 'abriendo…',
          }),
          jsx('span', {
            className: 'h-2 w-2 rounded-full shrink-0 ' +
              (perfilOk === true ? 'bg-emerald-500' : 'bg-slate-300'),
            title: modelo
              ? etiquetaModelo(modelo.id) + ' · ' + modelo.destino
              : 'conectando sesión del escrito',
          }),
          modelo ? jsx('span', {
            className: 'text-[10px] text-slate-400 truncate',
            children: etiquetaModelo(modelo.id) + ' · ' + modelo.destino,
          }) : null,
          jsxs('div', { className: 'ml-auto flex items-center gap-1', children: [
            mensajes.length > 0 ? jsx('button', {
              type: 'button',
              onClick: () => setMensajes([]),
              className: 'rounded px-1.5 py-0.5 text-[10px] text-slate-500 hover:bg-slate-200/70 hover:text-slate-800 cursor-pointer',
              title: 'Limpiar vista de conversación',
              children: 'Limpiar',
            }) : null,
            jsx('button', {
              type: 'button',
              onClick: () => setVerContexto((v) => !v),
              className: 'rounded p-1 text-xs cursor-pointer ' +
                (verContexto ? 'bg-indigo-100 text-indigo-700' : 'text-slate-500 hover:bg-slate-200/70 hover:text-slate-800'),
              title: 'Qué ve el agente en este turno (seudonimizado antes de salir)',
              children: '👁',
            }),
          ] }),
        ],
      }),

      // Inspector de transparencia: qué viaja en el sobre <dike-escritor v="1">
      verContexto ? jsxs('div', {
        className: 'border-b border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-600 flex flex-col gap-1 shrink-0',
        children: [
          jsx('div', { className: 'font-semibold text-slate-800', children: 'Lo que ve el agente en este turno (sobre <dike-escritor v="1">)' }),
          jsx('div', { children: `Caso: ${caseId} · Escrito: ${largoEscrito} caracteres · Citas verificadas: ${numCitasVerif}` }),
          jsx('div', {
            children: seudOn
              ? `Privacidad activa: seudonimización «${estrategiaActiva}» antes de enviar.`
              : 'Privacidad desactivada por confirmación expresa del abogado.',
          }),
          jsx('div', { className: 'text-[10px] text-slate-500', children: 'El estado de las citas lo fija Diké, no el modelo. Hooks fail-closed bloquean herramientas de terminal y archivos.' }),
          onAbrirPrivacidad ? jsx('button', {
            type: 'button',
            onClick: onAbrirPrivacidad,
            className: 'self-start text-[11px] font-medium text-indigo-600 hover:underline cursor-pointer',
            children: 'Configurar reglas de seudonimización →',
          }) : null,
        ],
      }) : null,

      // Área de conversación desplazable
      jsxs('div', {
        className: 'flex-1 overflow-y-auto px-3 py-2.5 flex flex-col gap-2.5 min-h-0',
        children: [
          // Tarjeta informativa de privacidad y destino (inspirada en la imagen 2)
          (!avisoCerrado && mensajes.length === 0) ? jsxs('div', {
            className: 'rounded-md border border-slate-300 bg-slate-50 p-3 text-xs text-slate-700 flex flex-col gap-2',
            children: [
              jsx('div', { className: 'font-semibold text-slate-900', children: 'Antes de escribir: ¿a dónde va lo que escribas?' }),
              jsx('div', { className: 'leading-relaxed text-slate-600 text-[11px]', children:
                'Diké seudonimiza los datos personales (RUT, correo, teléfono, nombres con contexto) antes de enviar al perfil de Hermes. ' +
                'El estado de las citas lo fija Diké, no el modelo.' }),
              jsxs('div', { className: 'flex flex-col gap-1 rounded border border-slate-200 bg-white p-2 text-[11px]', children: [
                jsxs('div', { className: 'flex items-center justify-between', children: [
                  jsx('span', { className: 'font-medium text-slate-800', children: 'Destino del perfil:' }),
                  jsx('span', { className: 'font-mono text-slate-600', children: (perfilElegido || 'activo') + (modelo ? ' · ' + modelo.destino : '') }),
                ] }),
                jsxs('div', { className: 'flex items-center justify-between', children: [
                  jsx('span', { className: 'font-medium text-slate-800', children: 'Seudonimización:' }),
                  jsx('span', {
                    className: seudOn ? 'font-semibold text-emerald-700' : 'font-semibold text-amber-700',
                    children: seudOn ? `Activa (${estrategiaActiva})` : 'Apagada por el usuario',
                  }),
                ] }),
              ] }),
              jsxs('div', { className: 'flex items-center gap-2 pt-0.5', children: [
                jsx('button', {
                  type: 'button',
                  onClick: () => setAvisoCerrado(true),
                  className: 'rounded bg-slate-700 hover:bg-slate-800 px-2.5 py-1 text-[11px] font-medium text-white cursor-pointer',
                  children: 'Entendido, continuar',
                }),
                onAbrirPrivacidad ? jsx('button', {
                  type: 'button',
                  onClick: onAbrirPrivacidad,
                  className: 'text-[11px] text-indigo-600 hover:underline cursor-pointer',
                  children: 'Ver datos que salen',
                }) : null,
              ] }),
            ],
          }) : jsx('div', {
            className: 'text-[11px] text-slate-400',
            children: 'Chat del escrito · El estado de las citas lo fija Diké, no el modelo.',
          }),

          perfilOk === null ? jsx('div', { className: S.sub, children: 'abriendo sesión…' }) : null,

          ...mensajes.map((m, i) => {
            // Las notas al pie se separan del cuerpo para verificarlas contra el
            // grafo; «Insertar en el escrito» sigue insertando el texto crudo.
            const notas = m.rol === 'assistant' ? parsearNotas(m.texto)
              : { cuerpo: m.texto, notas: [], invalidas: [] }
            return jsxs('div', {
              key: i,
              className: m.rol === 'user'
                ? 'self-end max-w-[90%] rounded-lg bg-indigo-50 border border-indigo-100 px-2.5 py-1.5 text-xs text-slate-800'
                : 'rounded-lg border border-slate-200 bg-slate-50/70 p-2.5 text-xs text-slate-800',
              children: [
                m.rol === 'user'
                  ? jsxs('span', { children: [jsx('b', { className: 'text-indigo-900', children: 'Tú: ' }), rehidratar(m.texto, {})] })
                  : jsxs('div', { className: 'flex flex-col gap-1.5', children: [
                      jsx('div', { className: 'whitespace-pre-wrap leading-relaxed', children:
                        rehidratar(notas.cuerpo,
                          (registro && registro.chat && registro.chat.mapa) || {}) }),
                      m.verificando ? jsx('span', { className: S.chip + ' ' + S.chipOff,
                        children: 'verificando citas…' }) : null,
                      m.verif && m.verif.fallo ? jsx('div', { className: 'text-xs text-(--ui-danger)',
                        children: 'No se pudieron verificar las citas de esta respuesta: trátalas como no verificadas.' }) : null,
                      m.verif && m.verif.res ? jsxs('div', { className: 'flex flex-wrap gap-1', children:
                          (m.verif.res.detalles || []).map((d, j) => {
                            const est = estadoCita(d, m.verif.hash, m.verif.hash, registro)
                            const chip = {
                              key: j,
                              className: S.chip + ' ' + (S[ESTILOS_ESTADO_RESP[est]] || S.chipOff),
                              title: etiquetaCita(est, d, (m.verif.res.meta || {}), registro)
                                + (d.nodo_id ? ' · clic para abrir en el grafo' : ''),
                              children: d.cita_raw,
                            }
                            return est === 'verificada' && d.nodo_id && onAbrirGrafo
                              ? jsx('button', {
                                  type: 'button', className: chip.className + ' cursor-pointer',
                                  title: chip.title,
                                  onClick: () => onAbrirGrafo({ nodo_id: d.nodo_id }),
                                  children: d.cita_raw,
                                })
                              : jsx('span', chip)
                          }) }) : null,
                      jsx(NotasAlPie, {
                        notas: notas.notas, invalidas: notas.invalidas,
                        verif: m.verif, onAbrirGrafo,
                      }),
                      jsx('button', {
                        type: 'button', className: S.link + ' text-left text-[11px] font-medium pt-0.5',
                        onClick: () => insertar(m.texto), children: '↳ Insertar en el escrito',
                      }),
                    ] }),
              ],
            })
          }),

          stream ? jsx('div', {
            className: 'rounded-lg border border-indigo-200 bg-indigo-50/30 p-2.5 text-xs whitespace-pre-wrap text-slate-800',
            children: stream,
          }) : null,

          jsx('div', { ref: endRef }),
        ],
      }),

      error ? jsx('div', { className: 'border-t border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-700', children: mensajeError(error) }) : null,

      // Barra de entrada inferior estilo imagen 2 («Escribe a Hermes…»)
      jsxs('div', {
        className: 'flex items-center gap-1.5 border-t border-slate-200 bg-white p-2 shrink-0',
        children: [
          jsx('input', {
            className: 'flex-1 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-800 outline-none focus:border-indigo-500 disabled:bg-slate-100',
            value: pregunta,
            placeholder: 'Escribe a Hermes…',
            disabled: !sesion || ocupado,
            onChange: (e) => setPregunta(e.target.value),
            onKeyDown: (e) => { if (e.key === 'Enter') enviar() },
          }),
          !ocupado
            ? jsx('button', {
                type: 'button',
                onClick: enviar,
                disabled: !sesion || ocupado || !pregunta.trim(),
                title: 'Enviar mensaje a Hermes (seudonimizado)',
                className: 'flex h-8 w-8 items-center justify-center rounded-md bg-slate-800 hover:bg-slate-900 disabled:opacity-35 text-white text-xs cursor-pointer shrink-0',
                children: '➤',
              })
            : jsx('button', {
                type: 'button',
                onClick: detener,
                title: 'Detener generación',
                className: 'rounded-md border border-red-300 bg-red-50 hover:bg-red-100 px-2.5 py-1.5 text-xs font-medium text-red-700 cursor-pointer shrink-0',
                children: 'Detener',
              }),
        ],
      }),
    ],
  })
}
