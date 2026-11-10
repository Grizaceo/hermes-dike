// Lógica pura de las propuestas NIF del Case Writer (node --test).
// El modelo propone; el abogado decide. Nada entra al NIF sin aceptación.

export const SECCIONES = [
  'facts.known', 'facts.alleged', 'facts.missing', 'subjects', 'norms',
  'hypotheses', 'gaps', 'principles', 'conflicts',
]

// Enums replicados de shared/schemas/nif.py (valores exactos).
export const ROLES = [
  'actor', 'demandado', 'organismo', 'tribunal', 'tercero', 'querellante',
  'parte',
]
export const OPERADORES = [
  'obligacion', 'prohibicion', 'permiso', 'potestad', 'sancion', 'excepcion',
  'indeterminado',
]
export const ESTADOS_NORMA = ['vigente', 'derogada', 'modificada', 'indeterminada']
export const TIPOS_HIPOTESIS = [
  'normativa', 'jurisprudencial', 'administrativa', 'procedimental', 'doctrinal',
]
export const ESTADOS_HIPOTESIS = [
  'open', 'supported', 'disputed', 'rejected', 'needs_more_evidence',
]
export const IMPACTOS = ['alto', 'medio', 'bajo']

export const MAX_PROPUESTAS = 12

const PROHIBIDAS = ['confidence', 'validated_by_human']

export function normalizar(s) {
  return String(s || '').normalize('NFKD')
    .replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^\p{L}\p{N} ]/gu, '').replace(/\s+/g, ' ').trim()
}

// Extrae el JSON de la respuesta tolerando cercos ``` y texto alrededor.
export function extraerJSON(texto) {
  const src = String(texto || '')
  let limpio = src.replace(/```(?:json)?\s*([\s\S]*?)```/g, '$1')
  const ini = limpio.indexOf('{')
  const fin = limpio.lastIndexOf('}')
  if (ini < 0 || fin <= ini) {
    throw new Error('MODEL_PROPOSALS_INVALID')
  }
  let obj
  try {
    obj = JSON.parse(limpio.slice(ini, fin + 1))
  } catch {
    throw new Error('MODEL_PROPOSALS_INVALID')
  }
  if (!obj || !Array.isArray(obj.propuestas)) {
    throw new Error('MODEL_PROPOSALS_INVALID')
  }
  return obj.propuestas
}

const colapsar = (s) => String(s || '').replace(/\s+/g, ' ').trim()

function camposProhibidos(obj, vistos = new Set()) {
  if (!obj || typeof obj !== 'object' || vistos.has(obj)) return null
  vistos.add(obj)
  for (const k of Object.keys(obj)) {
    if (PROHIBIDAS.includes(k) || k.startsWith('deontic_')) return k
    const dentro = camposProhibidos(obj[k], vistos)
    if (dentro) return dentro
  }
  return null
}

export function formaValida(fieldPath, value) {
  const obj = (v) => v && typeof v === 'object' && !Array.isArray(v)
  const strNoVacia = (v) => typeof v === 'string' && v.trim().length > 0
  switch (fieldPath) {
    case 'facts.known': case 'facts.alleged': case 'facts.missing':
    case 'principles':
      return strNoVacia(value)
    case 'subjects':
      return obj(value) && strNoVacia(value.id) && strNoVacia(value.label)
        && ROLES.includes(value.role)
    case 'norms':
      return obj(value) && strNoVacia(value.label)
        && (!('operator' in value) || OPERADORES.includes(value.operator))
        && (!('status' in value) || ESTADOS_NORMA.includes(value.status))
        && (!('exceptions' in value) || Array.isArray(value.exceptions))
    case 'hypotheses':
      return obj(value) && strNoVacia(value.id) && strNoVacia(value.claim)
        && (!('type' in value) || TIPOS_HIPOTESIS.includes(value.type))
        && (!('status' in value) || ESTADOS_HIPOTESIS.includes(value.status))
        && (!('evidence_for' in value) || Array.isArray(value.evidence_for))
        && (!('evidence_against' in value) || Array.isArray(value.evidence_against))
    case 'gaps':
      return obj(value) && strNoVacia(value.description)
        && (!('impact' in value) || IMPACTOS.includes(value.impact))
    case 'conflicts':
      return obj(value) && strNoVacia(value.description)
    default:
      return false
  }
}

// Texto comparable de un ítem ya presente en el NIF según su sección.
function textoExistente(fieldPath, item) {
  if (typeof item === 'string') return item
  if (!item || typeof item !== 'object') return ''
  return item.label || item.claim || item.description || ''
}

// Clave estable de la propuesta para el registro de rechazadas.
export function hashPropuesta(p) {
  return p.field_path + '|' + normalizar(JSON.stringify(p.value))
    + '|' + normalizar(p.cita_del_escrito)
}

export function validarPropuesta(p, { textoEnviado, nifActual, rechazadas } = {}) {
  if (!p || typeof p !== 'object') return { ok: false, motivo: 'PROPOSAL_INVALID' }
  const fp = p.field_path
  if (!SECCIONES.includes(fp)) {
    return { ok: false, motivo: 'FIELD_NOT_ALLOWED', dato: String(fp) }
  }
  const prohibido = camposProhibidos(p)
  if (prohibido) {
    return { ok: false, motivo: 'FIELD_NOT_PROPOSABLE', dato: prohibido }
  }
  if (!formaValida(fp, p.value)) {
    return { ok: false, motivo: 'VALUE_INVALID' }
  }
  const cita = String(p.cita_del_escrito || '').trim()
  if (!cita || cita.length > 300) {
    return { ok: false, motivo: 'QUOTE_LENGTH_INVALID' }
  }
  const enviado = colapsar(textoEnviado)
  if (!enviado.includes(colapsar(cita))) {
    return { ok: false, motivo: 'QUOTE_NOT_IN_BRIEF' }
  }
  // duplicado del NIF actual (texto normalizado igual)
  const seccion = (nifActual && (nifActual[fp]
    || (fp.startsWith('facts.')
      && nifActual.facts && nifActual.facts[fp.split('.')[1]]))) || []
  const textoNuevo = normalizar(
    fp === 'subjects' ? p.value.label
    : fp === 'norms' ? p.value.label
    : fp === 'hypotheses' ? p.value.claim
    : fp === 'gaps' || fp === 'conflicts' ? p.value.description
    : p.value)
  for (const item of seccion) {
    if (textoNuevo && normalizar(textoExistente(fp, item)) === textoNuevo) {
      return { ok: false, motivo: 'PROPOSAL_DUPLICATE' }
    }
  }
  if (rechazadas && rechazadas.includes(hashPropuesta(p))) {
    return { ok: false, motivo: 'PROPOSAL_REJECTED' }
  }
  return { ok: true, motivo: '' }
}

// Separa propuestas válidas de descartadas; tope MAX_PROPUESTAS aceptadas.
export function validarLote(lista, ctx) {
  const aceptadas = []
  const descartadas = []
  for (const p of lista || []) {
    const v = aceptadas.length >= MAX_PROPUESTAS
      ? { ok: false, motivo: 'PROPOSAL_LIMIT' }
      : validarPropuesta(p, ctx)
    ;(v.ok ? aceptadas : descartadas).push({ ...p, motivo: v.motivo })
  }
  return { aceptadas, descartadas }
}

// Rehidrata todos los strings de value (profundo) antes de guardar/mostrar.
export function rehidratarProfundo(value, mapa) {
  const aplicar = (s) => String(s).replace(/\[[A-Z_]+_\d+\]/g, (tok) =>
    Object.prototype.hasOwnProperty.call(mapa, tok) ? mapa[tok] : tok)
  const walk = (v) => {
    if (typeof v === 'string') return aplicar(v)
    if (Array.isArray(v)) return v.map(walk)
    if (v && typeof v === 'object') {
      const out = {}
      for (const [k, val] of Object.entries(v)) out[k] = walk(val)
      return out
    }
    return v
  }
  return walk(value)
}

// Input <dike-nif> con el subconjunto de secciones del snapshot.
export function componerInputNif({ caseId, nif, escrito, neutralizar }) {
  const secciones = {}
  for (const fp of SECCIONES) {
    const parte = nif && (nif[fp] !== undefined ? nif[fp]
      : (fp.startsWith('facts.') && nif.facts
        ? nif.facts[fp.split('.')[1]] : undefined))
    if (parte !== undefined) secciones[fp] = parte
  }
  const nz = neutralizar || ((s) => s)
  return '<dike-nif case="' + caseId + '">\n'
    + '<nif>' + nz(JSON.stringify(secciones)) + '</nif>\n'
    + '<escrito>' + nz(String(escrito || '')) + '</escrito>\n'
    + '</dike-nif>'
}
