// Lógica pura del módulo verificador del Case Writer: localizar citas en el
// texto, decidir el estado de cada una y mapear offsets del texto plano a
// posiciones ProseMirror. No importa tiptap ni react (testeable con
// `node --test`; los docs de PM entran por duck typing).

export const SEPARADOR_BLOQUE = '\n'

// --- Localización de citas -------------------------------------------------

// Todas las apariciones de cada detalle.cita_raw en `texto`, sin solapes:
// a igual inicio gana la cita más larga. Una cita que no aparece en el texto
// no produce rango (sigue listada en el panel sin marca).
export function localizarCitas(texto, detalles) {
  const hallazgos = []
  ;(detalles || []).forEach((d, indiceDetalle) => {
    const cita = d && d.cita_raw
    if (typeof cita !== 'string' || !cita.length) return
    let desde = 0
    for (;;) {
      const i = texto.indexOf(cita, desde)
      if (i < 0) break
      hallazgos.push({ inicio: i, fin: i + cita.length, indiceDetalle })
      desde = i + cita.length
    }
  })
  hallazgos.sort((a, b) =>
    a.inicio - b.inicio ||
    (b.fin - b.inicio) - (a.fin - a.inicio) ||
    a.indiceDetalle - b.indiceDetalle)
  const out = []
  let limite = -1
  for (const h of hallazgos) {
    if (h.inicio < limite) continue
    out.push(h)
    limite = h.fin
  }
  return out
}

// --- Estado de cada cita ---------------------------------------------------

// Orden estricto (fail-closed):
// 1. el motor gana: VERIFICADA sobre el texto actual (hashes iguales) →
//    'verificada', aunque el registro tenga un retiro/escalada anterior con el
//    mismo cita_raw;
// 2. retirada/escalada si el registro la trae;
// 3. desactualizada si el texto ya no es el verificado (o falta hash);
// 4. fallo.
// `registro` = { retiros: [{cita_raw, motivo, fecha}], escaladas: [{cita_raw, nota, fecha}] }.
export function estadoCita(detalle, hashVerificado, hashActual, registro) {
  const reg = registro || {}
  const raw = detalle && detalle.cita_raw
  const mismoTexto = hashVerificado && hashActual && hashVerificado === hashActual
  if (mismoTexto && detalle && detalle.estado === 'VERIFICADA') return 'verificada'
  if (raw && (reg.retiros || []).some((r) => r && r.cita_raw === raw)) return 'retirada'
  if (raw && (reg.escaladas || []).some((e) => e && e.cita_raw === raw)) return 'escalada'
  if (!mismoTexto) return 'desactualizada'
  return 'fallo'
}

function ultimoRegistro(registro, clave, citaRaw) {
  const lista = (registro && registro[clave]) || []
  for (let i = lista.length - 1; i >= 0; i -= 1) {
    if (lista[i] && lista[i].cita_raw === citaRaw) return lista[i]
  }
  return null
}

// --- Etiquetas (textos fijos, no suavizar) ----------------------------------

export const AVISO_JUICIO = 'verify.judgment'

export function mensajeVeredicto(veredicto) {
  return ({ SIN_CITAS: 'verify.SIN_CITAS', SIN_CORPUS: 'verify.SIN_CORPUS' })[veredicto] || null
}

// ¿La cita_raw coincide con una pista traída desde la búsqueda? La pista
// guarda la cita canónica insertada; el motor puede extender el raw con
// palabras siguientes, así que basta que el raw la cubra desde el inicio.
export function vieneDeBusqueda(citaRaw, registro) {
  const pistas = (registro && registro.pistas) || []
  const raw = typeof citaRaw === 'string' ? citaRaw.trim() : ''
  if (!raw) return false
  return pistas.some((p) => p && typeof p.cita === 'string' &&
    (raw === p.cita || raw.startsWith(p.cita)))
}

export function etiquetaCita(estado, detalle, meta, registro) {
  const d = detalle || {}
  const m = meta || {}
  const retiro = ultimoRegistro(registro, 'retiros', d.cita_raw)
  const escalada = ultimoRegistro(registro, 'escaladas', d.cita_raw)
  return {
    codigo: ({ verificada: 'verify.verificada', fallo: 'verify.fallo', desactualizada: 'verify.desactualizada', retirada: 'verify.retirada', escalada: 'verify.escalada' })[estado] || estado,
    datos: {
      date: m.as_of || '?', pack: m.pack_hash || '?',
      source: [d.gid, d.fuente_url].filter(Boolean).join(' · '),
      resolution: d.resolucion || '',
      reason: (retiro && retiro.motivo) || '',
      note: (escalada && escalada.nota) || '',
    },
    pista: vieneDeBusqueda(d.cita_raw, registro),
  }
}

// --- Hash del texto verificado ----------------------------------------------

export async function sha256Hex(texto) {
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256', new TextEncoder().encode(texto))
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

// --- Mapa offsets getText ↔ posiciones ProseMirror ---------------------------

// El texto que se verifica es `editor.getText({ blockSeparator: '\n' })`, que
// recorre el doc con nodesBetween: emite blockSeparator antes de cada nodo de
// bloque (salvo el primero) y el texto plano de cada nodo de texto (las hojas
// como hard_break no emiten nada). `segmentosDeDoc` replica ese recorrido y
// produce segmentos contiguos {t0, t1, p0, p1}: [t0, t1) es el tramo del texto
// plano y [p0, p1] su tramo en el doc (p0 == p1 en separadores: punto límite).
export function segmentosDeDoc(doc, blockSeparator = SEPARADOR_BLOQUE) {
  const segs = []
  let t = 0
  doc.nodesBetween(0, doc.content.size, (node, pos) => {
    if (node.isBlock && pos > 0) {
      segs.push({ t0: t, t1: t + blockSeparator.length, p0: pos, p1: pos })
      t += blockSeparator.length
    }
    if (node.isText) {
      segs.push({ t0: t, t1: t + node.nodeSize, p0: pos, p1: pos + node.nodeSize })
      t += node.nodeSize
    }
  })
  return segs
}

// Cursor entre caracteres: offset 0 = antes del primer char, offset L = fin.
export function offsetAPos(segmentos, offset) {
  if (!segmentos.length) return 0
  const ultimo = segmentos[segmentos.length - 1]
  if (offset >= ultimo.t1) return ultimo.p1
  for (const s of segmentos) {
    if (offset < s.t0) return s.p0
    if (offset < s.t1) {
      const d = Math.min(Math.max(offset - s.t0, 0), s.p1 - s.p0)
      return s.p0 + d
    }
  }
  return ultimo.p1
}

// Lista de rangos PM {from, to} para el rango de texto [inicio, fin): uno por
// tramo de texto solapado, cada uno dentro de un mismo textblock (una
// Decoration.inline no puede cruzar límites de bloque; los separadores se
// saltan). Vacía si el rango no cubre texto.
export function rangosAPos(segmentos, inicio, fin) {
  const out = []
  for (const s of segmentos) {
    if (s.p1 === s.p0) continue // separador: punto, no tramo
    const a = Math.max(inicio, s.t0)
    const b = Math.min(fin, s.t1)
    if (a < b) out.push({ from: s.p0 + (a - s.t0), to: s.p0 + (b - s.t0) })
  }
  return out
}

// Versión simple de un solo rango: null si el texto cae fuera o colapsa.
export function rangoAPos(segmentos, inicio, fin) {
  const lista = rangosAPos(segmentos, inicio, fin)
  if (!lista.length) return null
  return { from: lista[0].from, to: lista[lista.length - 1].to }
}
