// L1: continuación literal desde el corpus Diké sellado (local, en el
// plugin host). La sugerencia llega rotulada "texto del corpus, sin
// verificar como cita" — la procedencia declara gid + sha256 del artículo.

import { rest } from '../../common.js'

export function crearPredictorCorpus() {
  return {
    id: 'corpus-dike',
    capa: 'L1',
    etiqueta: 'texto del corpus, sin verificar como cita',
    disponible: () => true,
    async predecir({ segmento }) {
      // POST /prediccion/corpus {cola}: el backend exige 1–300 caracteres.
      // ctx.rest no admite signal: la mesa ya descarta el resultado si el
      // AbortController se disparó mientras la petición estaba en vuelo.
      const cola = String(segmento || '').trim().split(/\s+/).slice(-4)
        .join(' ').slice(-300)
      if (cola.length < 8) return null
      const t0 = Date.now()
      const r = await rest('/prediccion/corpus', {
        method: 'POST', body: { cola }, timeoutMs: 5000,
      }).catch(() => null)
      if (!r || !r.continuacion) return null
      return {
        texto: r.continuacion,
        capa: 'L1',
        procedencia: {
          tipo: 'corpus', fuente: r.fuente_url || r.gid || 'corpus Diké',
          gid: r.gid, sha256: r.sha256,
          anclaLen: (r.ancla || cola).length,
        },
        latencia_ms: Date.now() - t0,
      }
    },
  }
}
