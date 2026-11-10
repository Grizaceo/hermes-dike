// Lógica del guardado del escrito, separada del componente para poder
// probarla con node --test (sin navegador ni React).
//
// Dos piezas:
//  - guardarConReintento: un POST /escrito que, ante un 409 (rev_base
//    obsoleto), refresca la revisión con GET /escrito y reintenta UNA vez.
//    Si el reintento también choca, devuelve {conflicto:true} para que la
//    página muestre el estado de conflicto en vez de tragar el error.
//  - Pendiente: instantánea del último guardado que falló, guardada en
//    ctx.storage por caso. Si el componente se desmonta (cambio de pestaña)
//    con un guardado en vuelo que luego falla, el texto no se pierde: la
//    próxima carga del caso lo restaura y el guardado se reintenta.

import { storage } from '../common.js'

export function esConflicto(e) {
  if (!e) return false
  if (e.status === 409 || e.statusCode === 409) return true
  if (e.detail && typeof e.detail === 'object' && 'rev_actual' in e.detail) return true
  return /\b409\b|rev_actual/.test(String(e.message || e.detail || e.error || e))
}

// enviar(revBase?) → Promise<resp del POST>; con revBase definido lo usa como
// rev_base, si no, el llamador decide (típicamente la rev vigente del caso).
// revActual() → Promise<rev número | null>: lee la revisión vigente del caso.
export async function guardarConReintento(enviar, revActual) {
  try {
    return { ok: true, resp: await enviar() }
  } catch (e) {
    if (!esConflicto(e)) return { ok: false, error: e }
  }
  const rev = await Promise.resolve().then(() => revActual()).catch(() => null)
  if (rev == null) return { ok: false, conflicto: true }
  try {
    return { ok: true, resp: await enviar(rev), reintentado: true }
  } catch (e2) {
    return esConflicto(e2)
      ? { ok: false, conflicto: true, rev_actual: rev }
      : { ok: false, error: e2 }
  }
}

const CLAVE_PENDIENTE = (cid) => 'escrito.pendiente.' + cid

// escribe/lee/borra la instantánea pendiente de un caso. Todo es tolerante a
// fallos de storage: es un respaldo, nunca debe romper el flujo principal.
export function escribirPendiente(p) {
  try {
    if (storage && typeof storage.set === 'function' && p && p.case_id) {
      storage.set(CLAVE_PENDIENTE(p.case_id), p)
    }
  } catch { /* respaldo opcional */ }
}

export function leerPendiente(cid) {
  try {
    if (storage && typeof storage.get === 'function' && cid) {
      const p = storage.get(CLAVE_PENDIENTE(cid), null)
      // Solo se restaura una instantánea bien formada del mismo caso.
      if (p && typeof p === 'object' && p.case_id === cid
          && typeof p.html === 'string' && typeof p.texto === 'string') {
        return p
      }
    }
  } catch { /* respaldo opcional */ }
  return null
}

export function borrarPendiente(cid) {
  try {
    if (storage && typeof storage.remove === 'function' && cid) {
      storage.remove(CLAVE_PENDIENTE(cid))
    }
  } catch { /* respaldo opcional */ }
}

// ¿La instantánea pendiente trae algo que el documento recién cargado no
// tiene? `actual` = {texto, html, registro} tal como quedó tras cargar del
// servidor. Si todo coincide, el pendiente ya está aplicado y se descarta.
export function pendienteDiff(pendiente, actual) {
  if (!pendiente || typeof pendiente !== 'object' || !actual) return false
  if (pendiente.texto !== actual.texto) return true
  if (pendiente.html !== actual.html) return true
  try {
    return JSON.stringify(pendiente.registro || null)
      !== JSON.stringify(actual.registro || null)
  } catch {
    return true
  }
}
