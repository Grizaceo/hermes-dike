// Lógica pura del chat del escrito (sin tiptap ni react): componer el turno
// XML, diff de párrafos, filtro de eventos del gateway, acumulación de deltas,
// etiqueta del modelo y extracción de <pregunta> del historial.

const TOPE_ESCRITO = 12000
const UMBRAL_CAMBIOS = 0.4

// Hash simple y estable por párrafo (no criptográfico: solo para el diff).
export function hashParrafo(t) {
  let h = 0
  for (let i = 0; i < t.length; i += 1) {
    h = (Math.imul(h, 31) + t.charCodeAt(i)) | 0
  }
  return (h >>> 0).toString(16)
}

export function parrafosDe(texto) {
  return (texto || '').split('\n')
}

// Neutraliza etiquetas literales que romperían el sobre del turno.
export function neutralizar(s) {
  return String(s || '')
    .replace(/<\/escrito>/g, '<\\/escrito>')
    .replace(/<\/dike-escritor>/g, '<\\/dike-escritor>')
    .replace(/<dike-escritor\b/g, '<dike-escritor\\')
    .replace(/<\/constancia>/g, '<\\/constancia>')
    .replace(/<\/pregunta>/g, '<\\/pregunta>')
    .replace(/<\/activo>/g, '<\\/activo>')
    .replace(/<\/cambios>/g, '<\\/cambios>')
}

// ultimoEnviado = {hashes: [h1..hN], texto} del último envío (o null).
// Devuelve {hashes, modo, omitidos, completo:boolean}
export function diffParrafos(texto, ultimoEnviado) {
  const parrafos = parrafosDe(texto)
  const hashes = parrafos.map(hashParrafo)
  const prev = (ultimoEnviado && ultimoEnviado.hashes) || []
  let cambiados = 0
  for (let i = 0; i < parrafos.length; i += 1) {
    if (prev[i] !== hashes[i]) cambiados += 1
  }
  if (prev.length > parrafos.length) cambiados += prev.length - parrafos.length
  const fraccion = parrafos.length || prev.length
    ? cambiados / Math.max(parrafos.length, prev.length) : 0
  const completo = !ultimoEnviado || fraccion > UMBRAL_CAMBIOS
  return { hashes, parrafos, completo, cambiados, fraccion }
}

// Bloque <escrito> en modo completo con tope: párrafos alrededor del activo.
export function bloqueEscrito(parrafos, indiceActivo) {
  const total = parrafos.join('\n').length
  if (total <= TOPE_ESCRITO) {
    return { texto: parrafos.join('\n'), omitidos: 0 }
  }
  const act = indiceActivo >= 0 ? indiceActivo : 0
  const incluidos = new Set([act])
  let largo = parrafos[act] ? parrafos[act].length : 0
  // expande alternando hacia arriba y hacia abajo desde el activo
  let up = act - 1
  let down = act + 1
  while (true) {
    let agrego = false
    if (down < parrafos.length && largo + parrafos[down].length + 1 <= TOPE_ESCRITO) {
      incluidos.add(down); largo += parrafos[down].length + 1; down += 1; agrego = true
    }
    if (up >= 0 && largo + parrafos[up].length + 1 <= TOPE_ESCRITO) {
      incluidos.add(up); largo += parrafos[up].length + 1; up -= 1; agrego = true
    }
    if (!agrego) break
  }
  const partes = []
  let omitidos = 0
  let racha = 0
  for (let i = 0; i < parrafos.length; i += 1) {
    if (incluidos.has(i)) {
      if (racha) { partes.push(`[… ${racha} párrafos omitidos …]`); racha = 0 }
      partes.push(parrafos[i])
    } else {
      omitidos += 1; racha += 1
    }
  }
  if (racha) partes.push(`[… ${racha} párrafos omitidos …]`)
  return { texto: partes.join('\n'), omitidos }
}

// Bloque <cambios> en modo cambios: [§n] nuevo texto / [§n eliminado].
export function bloqueCambios(parrafos, hashes, prevHashes) {
  const lineas = []
  for (let i = 0; i < parrafos.length; i += 1) {
    if (prevHashes[i] !== hashes[i]) {
      lineas.push(`[§${i + 1}] ${parrafos[i]}`)
    }
  }
  for (let i = parrafos.length; i < prevHashes.length; i += 1) {
    lineas.push(`[§${i + 1} eliminado]`)
  }
  return lineas.join('\n')
}

// Bloque <constancia> desde la verificación guardada ({resultado, hash}).
// vigente="no" si el hash verificado difiere del actual.
// Selección si hay texto seleccionado; si no, el párrafo del cursor.
export function activoDe(seleccion, parrafoCursor) {
  return (seleccion && seleccion.trim()) ? seleccion : (parrafoCursor || '')
}

export function bloqueConstancia(verificacion, hashActual) {
  if (!verificacion || !verificacion.resultado) return ''
  const res = verificacion.resultado
  const meta = res.meta || {}
  const vigente = verificacion.hash && hashActual && verificacion.hash === hashActual
    ? 'sí' : 'no'
  const lineas = []
  for (const d of res.detalles || []) {
    const estado = d.estado === 'VERIFICADA' && vigente === 'sí'
      ? 'VERIFICADA'
      : (d.estado === 'VERIFICADA' ? 'desactualizada' : 'FALLO · ' + (d.resolucion || '?'))
    lineas.push(`${d.cita_raw} → ${estado}`)
  }
  return `<constancia vigente="${vigente}" pack="${meta.pack_hash || '?'}" as_of="${meta.as_of || '?'}">\n${lineas.join('\n')}\n</constancia>`
}

// Turno completo: <dike-escritor …>…</dike-escritor>\n<pregunta>…</pregunta>
export function componerTurno({ pregunta, textoEscrito, ultimoEnviado, activo,
  verificacion, rev, caseId, hashActual }) {
  const { hashes, parrafos, completo } = diffParrafos(textoEscrito, ultimoEnviado)
  const prev = (ultimoEnviado && ultimoEnviado.hashes) || []
  const modo = completo ? 'completo' : 'cambios'
  const partes = [
    `<dike-escritor v="1" case="${caseId}" rev="${rev != null ? rev : 0}" modo="${modo}">`,
  ]
  if (completo) {
    const idxActivo = activo ? parrafos.findIndex((p) => p.includes(activo)) : -1
    const blq = bloqueEscrito(parrafos, idxActivo)
    partes.push(`<escrito>${neutralizar(blq.texto)}</escrito>`)
  } else {
    partes.push(`<cambios>\n${neutralizar(bloqueCambios(parrafos, hashes, prev))}\n</cambios>`)
  }
  if (activo) partes.push(`<activo>${neutralizar(activo)}</activo>`)
  const constancia = bloqueConstancia(verificacion, hashActual)
  if (constancia) partes.push(constancia)
  partes.push('</dike-escritor>')
  partes.push(`<pregunta>${neutralizar(pregunta)}</pregunta>`)
  return { turno: partes.join('\n'), hashes }
}

// Extrae el contenido de <pregunta> de un turno guardado (historial).
export function parsePregunta(turno) {
  if (!turno) return ''
  const m = /<pregunta>([\s\S]*?)<\/pregunta>\s*$/.exec(turno)
  if (m) return m[1]
  // texto plano sin sobre: se muestra tal cual
  return turno.includes('<dike-escritor') ? '' : turno
}

// Filtro de eventos del gateway: solo los de ESTA sesión runtime y perfil.
export function filtroEvento(ev, sessionId, profile) {
  if (!ev || typeof ev !== 'object') return false
  if (ev.session_id !== sessionId) return false
  if (profile && ev.profile && ev.profile !== profile) return false
  return true
}

// Acumula message.delta por offset: ignora replayed ya aplicados.
// deltas: [{offset, text}] en orden de llegada → texto acumulado.
export function acumDeltas(deltas) {
  const orden = deltas.slice().sort((a, b) => (a.offset || 0) - (b.offset || 0))
  let out = ''
  let visto = 0
  for (const d of orden) {
    const off = d.offset || 0
    const texto = d.text || ''
    if (off < visto) {
      // replayed o parcial: solo lo que pasa de lo ya visto
      const saltar = visto - off
      if (saltar < texto.length) {
        out += texto.slice(saltar)
        visto += texto.length - saltar
      }
      continue
    }
    if (off > visto) {
      // hueco: pega igual (los deltas no siempre traen offset contiguo)
      out += texto
      visto = off + texto.length
      continue
    }
    out += texto
    visto += texto.length
  }
  return out
}

// Etiqueta del modelo para mostrar: stealth/* nunca se muestra.
export function etiquetaModelo(modelId) {
  if (!modelId) return '?'
  if (String(modelId).startsWith('stealth/')) return 'modelo alojado por Nous'
  return String(modelId)
}

// Destino: 'nube' salvo provider reconociblemente local.
export function etiquetaDestino(info) {
  const prov = String((info && (info.provider || info.model_provider)) || '')
  const base = String((info && (info.base_url || info.api_base)) || '')
  if (/llamacpp|ollama|lmstudio/i.test(prov)) return 'local'
  if (/localhost|127\.0\.0\.1|\[?::1\]?/.test(base)) return 'local'
  return 'nube'
}
