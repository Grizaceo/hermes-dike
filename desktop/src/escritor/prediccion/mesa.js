// Mesa de predictores (F4): orquesta los predictores habilitados por capa.
// L0 síncrono primero; L1/L2 asíncronos con debounce y AbortController.
// Fail-closed: una predicción sin procedencia.tipo y fuente se descarta.

export const TOPE_SUGERENCIA = 200
export const DEBOUNCE_MS = 400

export function procedenciaValida(p) {
  return Boolean(p && p.procedencia && p.procedencia.tipo
    && p.procedencia.fuente)
}

// ¿Está el cursor dentro de una cita marcada? En el editor, las citas llevan
// la marca 'cita'; esta función la chequea contra el rango de marcas dado.
export function dentroDeCita(marcas, pos) {
  for (const m of marcas || []) {
    if (pos >= m.from && pos <= m.to) return true
  }
  return false
}

// Elige la mejor predicción: capa menor primero, dentro de la capa la de
// ancla (texto de origen) más larga.
export function elegir(candidatas) {
  const validas = (candidatas || []).filter(procedenciaValida)
    .map((p) => ({ ...p, texto: String(p.texto || '').slice(0, TOPE_SUGERENCIA) }))
    .filter((p) => p.texto.trim().length > 0)
  validas.sort((a, b) => a.capa.localeCompare(b.capa)
    || (b.procedencia.anclaLen || 0) - (a.procedencia.anclaLen || 0))
  return validas[0] || null
}

export function crearMesa({ predictores = [], debounceMs = DEBOUNCE_MS } = {}) {
  let timer = null
  let abort = null

  function cancelar() {
    if (timer) { clearTimeout(timer); timer = null }
    if (abort) { abort.abort(); abort = null }
  }

  // Sugiere para el estado actual. signal: {haySeleccion, enCita, caseId,
  // normas, seccionesNif}. Devuelve Prediccion|null via callback.
  function sugerir({ segmento, contexto, signal }, onPrediccion) {
    cancelar()
    if (signal && (signal.haySeleccion || signal.enCita)) {
      onPrediccion(null)
      return () => {}
    }
    const vivos = predictores.filter((p) => {
      try { return p.disponible(contexto) } catch { return false }
    })
    // L0 síncrono inmediato
    for (const p of vivos.filter((x) => x.capa === 'L0')) {
      try {
        const t0 = Date.now()
        const r = p.predecir({ segmento, contexto, signal })
        const usar = (pred) => {
          if (pred) {
            onPrediccion({ ...pred, capa: 'L0',
              latencia_ms: Date.now() - t0 })
            return true
          }
          return false
        }
        if (r && typeof r.then === 'function') {
          abort = new AbortController()
          r.then((pred) => { if (!abort.signal.aborted) usar(pred) })
            .catch(() => {})
        } else if (usar(r)) {
          return cancelar
        }
      } catch { /* predictor caído: se ignora */ }
    }
    // L1/L2 con debounce + abort
    const async_ = vivos.filter((x) => x.capa !== 'L0')
    if (async_.length) {
      timer = setTimeout(() => {
        abort = new AbortController()
        const sig = abort.signal
        for (const p of async_) {
          Promise.resolve()
            .then(() => p.predecir({ segmento, contexto,
              signal: { ...(signal || {}), abort: sig } }))
            .then((pred) => {
              if (!sig.aborted && pred) {
                onPrediccion({ ...pred, capa: p.capa })
              }
            })
            .catch(() => {})
        }
      }, debounceMs)
    }
    return cancelar
  }

  return { sugerir, cancelar }
}
