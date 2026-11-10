// Chat del escrito (F2b): sesión por caso en el perfil del abogado, con el
// escrito viajando seudonimizado en cada turno. El estado de las citas lo
// fija Diké, nunca el modelo. Fail-closed: sin perfil con Diké habilitado no
// hay chat (sin hooks no se puede garantizar que el modelo no use tools).

import { jsx, jsxs } from 'react/jsx-runtime'
import { useCallback, useEffect, useRef, useState } from 'react'
import { host } from '@hermes/plugin-sdk'
import { mensajeError, rest, S } from '../common.js'
import { t } from '../i18n.js'
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
            title: t('chat.estadoMotor'),
            children: citaDet.estado,
          })
        : null,
      jsx('button', {
        type: 'button', className: S.link, disabled: nodoInexistente,
        title: nodoInexistente ? t('chat.nodoInexistente')
          : t('chat.verificarGrafo'),
        onClick: abrir,
        children: t('chat.verificarGrafo'),
      }),
    ] }),
    jsxs('div', { className: S.sub, children: [
      nodoOk === null ? t('chat.comprobando') : nodoInexistente ? t('chat.nodoNoExiste') : null,
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
    jsx('div', { className: S.cardTitle, children: t('chat.notas') }),
    ...notas.map((n) => jsx(NotaItem, {
      key: n.n, nota: n, verif, onAbrirGrafo })),
    ...invalidas.map((iv) => jsx('div', {
      key: 'inv' + iv.n, className: 'text-xs ' + S.bad,
      children: t('chat.notaInvalida', { n: iv.n }) }),
    ),
    jsx('div', { className: S.sub, children:
      t('chat.pertenencia') }),
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
          catch (e) { throw new Error(t('chat.errorPaso', { nombre, error: mensajeError(e) })) }
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
          throw new Error(t('chat.errorPerfil', {
            activo: activo ? ' («' + activo + '»)' : '',
          }))
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
      setError(new Error(t('nifp.errorPrivacidad')))
      setOcupado(false)
      return
    }
    prepararEnvio({
      caseId: cid, texto: turno, destino,
      seudonimizar, estrategia: cfgPriv.estrategia || 'media',
    }).then((envio) => {
      if (!puedeEnviar()) throw new Error(t('chat.errorPrivacidadEnvio'))
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
        ? 'flex h-full w-full flex-col border-l border-(--dk-borde) bg-(--dk-elevada) text-(--dk-texto)'
        : S.card,
      children: [
        jsxs('div', { className: 'flex items-center gap-2 border-b border-(--dk-borde) px-3 py-2 text-xs', children: [
          jsx('span', { className: 'font-semibold text-(--dk-texto)', children: 'Hermes' }),
          jsx('span', { className: 'h-2 w-2 rounded-full bg-(--dk-aviso)', title: t('chat.sinPerfil') }),
        ] }),
        jsxs('div', { className: 'p-3 flex flex-col gap-2', children: [
          jsx('div', { className: S.noticeWarn + ' leading-relaxed',
            children: mensajeError(perfilOk.error) }),
        ] }),
      ],
    })
  }

  return jsxs('div', {
    className: modoDock
      ? 'flex h-full w-full flex-col bg-(--dk-elevada) text-(--dk-texto) overflow-hidden'
      : S.card,
    children: [
      // Cabecera superior estilo Hermes Chat (imagen 2)
      jsxs('div', {
        className: 'flex items-center gap-2 border-b border-(--dk-borde) px-3 h-9 text-xs shrink-0 bg-(--dk-superficie)',
        children: [
          jsx('span', { className: 'font-semibold text-(--dk-texto)', children: 'Hermes' }),
          jsx('span', {
            className: 'text-(--dk-texto-3) truncate',
            children: perfilElegido || 'abriendo…',
          }),
          jsx('span', {
            className: 'h-2 w-2 rounded-full shrink-0 ' +
              (perfilOk === true ? 'bg-(--dk-ok)' : 'bg-(--dk-superficie-2)'),
            title: modelo
              ? etiquetaModelo(modelo.id) + ' · ' + modelo.destino
              : 'conectando sesión del escrito',
          }),
          modelo ? jsx('span', {
            className: 'text-xs text-(--dk-texto-3) truncate',
            children: etiquetaModelo(modelo.id) + ' · ' + modelo.destino,
          }) : null,
          jsxs('div', { className: 'ml-auto flex items-center gap-1', children: [
            mensajes.length > 0 ? jsx('button', {
              type: 'button',
              onClick: () => setMensajes([]),
              className: 'rounded px-1.5 py-0.5 text-xs text-(--dk-texto-3) hover:bg-(--dk-sobre) hover:text-(--dk-texto) cursor-pointer',
              title: t('chat.limpiarTitulo'),
              children: t('chat.limpiar'),
            }) : null,
            jsx('button', {
              type: 'button',
              onClick: () => setVerContexto((v) => !v),
              'aria-pressed': verContexto,
              className: 'dk-btn dk-btn--chico',
              title: t('chat.contextoTitulo'),
              children: t('chat.contexto'),
            }),
          ] }),
        ],
      }),

      // Inspector de transparencia: qué viaja en el sobre <dike-escritor v="1">
      verContexto ? jsxs('div', {
        className: 'border-b border-(--dk-borde) bg-(--dk-superficie) px-3 py-2 text-xs text-(--dk-texto-2) flex flex-col gap-1 shrink-0',
        children: [
          jsx('div', { className: 'font-semibold text-(--dk-texto)', children: t('chat.contextoTitulo2') }),
          jsx('div', { children: t('chat.contextoCaso', { caso: caseId, largo: largoEscrito, citas: numCitasVerif }) }),
          jsx('div', {
            children: seudOn
              ? t('chat.contextoPrivOn', { estrategia: estrategiaActiva })
              : t('chat.contextoPrivOff'),
          }),
          jsx('div', { className: 'text-xs text-(--dk-texto-3)', children: t('chat.contextoNota') }),
          onAbrirPrivacidad ? jsx('button', {
            type: 'button',
            onClick: onAbrirPrivacidad,
            className: S.link + ' self-start dk-meta',
            children: t('chat.configurarPriv'),
          }) : null,
        ],
      }) : null,

      // Área de conversación desplazable
      jsxs('div', {
        className: 'flex-1 overflow-y-auto px-3 py-2.5 flex flex-col gap-2.5 min-h-0',
        children: [
          // Tarjeta informativa de privacidad y destino (inspirada en la imagen 2)
          (!avisoCerrado && mensajes.length === 0) ? jsxs('div', {
            className: 'rounded-md border border-(--dk-borde) bg-(--dk-superficie) p-3 text-xs text-(--dk-texto-2) flex flex-col gap-2',
            children: [
              jsx('div', { className: 'font-semibold text-(--dk-texto)', children: t('chat.antesTitulo') }),
              jsx('div', { className: 'leading-relaxed text-(--dk-texto-2) text-xs', children:
                t('chat.antesCuerpo') }),
              jsxs('div', { className: 'flex flex-col gap-1 rounded border border-(--dk-borde) bg-(--dk-elevada) p-2 text-xs', children: [
                jsxs('div', { className: 'flex items-center justify-between', children: [
                  jsx('span', { className: 'font-medium text-(--dk-texto)', children: t('chat.destino') }),
                  jsx('span', { className: 'font-mono text-(--dk-texto-2)', children: (perfilElegido || t('chat.perfilActivo')) + (modelo ? ' · ' + modelo.destino : '') }),
                ] }),
                jsxs('div', { className: 'flex items-center justify-between', children: [
                  jsx('span', { className: 'font-medium text-(--dk-texto)', children: t('chat.seudonimizacion') }),
                  jsx('span', {
                    className: 'font-semibold ' + (seudOn ? S.ok : S.warn),
                    children: seudOn ? t('chat.privActiva', { estrategia: estrategiaActiva }) : t('chat.privApagada'),
                  }),
                ] }),
              ] }),
              jsxs('div', { className: 'flex items-center gap-2 pt-0.5', children: [
                jsx('button', {
                  type: 'button',
                  onClick: () => setAvisoCerrado(true),
                  className: 'dk-btn dk-btn--primario dk-btn--chico',
                  children: t('chat.entendido'),
                }),
                onAbrirPrivacidad ? jsx('button', {
                  type: 'button',
                  onClick: onAbrirPrivacidad,
                  className: S.link + ' dk-meta',
                  children: t('chat.verSalida'),
                }) : null,
              ] }),
            ],
          }) : jsx('div', {
            className: 'text-xs text-(--dk-texto-3)',
            children: t('chat.subtitulo'),
          }),

          perfilOk === null ? jsx('div', { className: S.sub, children: t('chat.abriendo') }) : null,

          ...mensajes.map((m, i) => {
            // Las notas al pie se separan del cuerpo para verificarlas contra el
            // grafo; «Insertar en el escrito» sigue insertando el texto crudo.
            const notas = m.rol === 'assistant' ? parsearNotas(m.texto)
              : { cuerpo: m.texto, notas: [], invalidas: [] }
            return jsxs('div', {
              key: i,
              className: m.rol === 'user'
                ? 'self-end max-w-[90%] rounded-lg border border-(--dk-borde-suave) bg-(--dk-superficie-2) px-2.5 py-1.5 text-xs text-(--dk-texto)'
                : 'rounded-lg border border-(--dk-borde) bg-(--dk-superficie) p-2.5 text-xs text-(--dk-texto)',
              children: [
                m.rol === 'user'
                  ? jsxs('span', { children: [jsx('b', { children: t('chat.te') }), rehidratar(m.texto, {})] })
                  : jsxs('div', { className: 'flex flex-col gap-1.5', children: [
                      jsx('div', { className: 'whitespace-pre-wrap leading-relaxed', children:
                        rehidratar(notas.cuerpo,
                          (registro && registro.chat && registro.chat.mapa) || {}) }),
                      m.verificando ? jsx('span', { className: S.chip + ' ' + S.chipOff,
                        children: t('chat.verificando') }) : null,
                      m.verif && m.verif.fallo ? jsx('div', { className: 'text-xs ' + S.bad,
                        children: t('chat.verifFallo') }) : null,
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
                        type: 'button', className: S.link + ' text-left text-xs font-medium pt-0.5',
                        onClick: () => insertar(m.texto), children: t('chat.insertar'),
                      }),
                    ] }),
              ],
            })
          }),

          stream ? jsx('div', {
            className: 'rounded-lg border border-(--dk-borde) bg-(--dk-superficie) p-2.5 text-xs whitespace-pre-wrap text-(--dk-texto)',
            children: stream,
          }) : null,

          jsx('div', { ref: endRef }),
        ],
      }),

      error ? jsx('div', { className: S.noticeBad + ' shrink-0', children: mensajeError(error) }) : null,

      // Barra de entrada inferior estilo imagen 2 («Escribe a Hermes…»)
      jsxs('div', {
        className: 'flex items-center gap-1.5 border-t border-(--dk-borde) bg-(--dk-elevada) p-2 shrink-0',
        children: [
          jsx('input', {
            className: S.input + ' flex-1',
            value: pregunta,
            placeholder: t('chat.placeholder'),
            disabled: !sesion || ocupado,
            onChange: (e) => setPregunta(e.target.value),
            onKeyDown: (e) => { if (e.key === 'Enter') enviar() },
          }),
          !ocupado
            ? jsx('button', {
                type: 'button',
                onClick: enviar,
                disabled: !sesion || ocupado || !pregunta.trim(),
                'aria-label': t('chat.enviar'),
                title: t('chat.enviar'),
                className: 'dk-btn dk-btn--primario dk-btn--icono shrink-0',
                children: '➤',
              })
            : jsx('button', {
                type: 'button',
                onClick: detener,
                title: t('chat.detener'),
                className: S.btnDanger + ' shrink-0',
                children: t('chat.detenerBtn'),
              }),
        ],
      }),
    ],
  })
}
