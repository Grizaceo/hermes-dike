// L2: continuación con modelo, opt-in por caso. La instrucción es fija y va
// en el bundle; el destino se clasifica leyendo la config efectiva: local
// solo si auxiliary.dike_prediccion.base_url es loopback o el provider es
// llamacpp|ollama|lmstudio Y no hay fallback_chain. Nube ⇒ opt-in explícito
// y el input pasa por prepararEnvio (seudonimización). Local ⇒ sin
// seudonimizar pero el envío se registra igual.

export const INSTRUCCIONES_L2 =
  'Continúa el texto jurídico del abogado con a lo más una frase corta, en ' +
  'el mismo idioma y registro. No inventes hechos, nombres, fechas ni ' +
  'citas: si la continuación requiere una cita, escribe [VERIFICAR CITA]. ' +
  'Responde solo con la continuación, sin comillas ni explicación.'

const PROVIDERS_LOCALES = new Set(['llamacpp', 'ollama', 'lmstudio'])

function esLoopback(url) {
  return /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\]|::1)(:|\/|$)/i
    .test(String(url || '').trim())
}

// Clasifica el destino de la tarea auxiliary.dike_prediccion a partir de la
// config efectiva (objeto ya leído). 'local' | 'nube'.
export function clasificarDestino(config) {
  const aux = config && (config.auxiliary || config.aux)
  const tarea = aux && (aux.dike_prediccion || aux['dike-prediccion'])
  if (!tarea || typeof tarea !== 'object') return 'nube'
  // una cadena de fallback ya puede salir del equipo
  if (tarea.fallback_chain || tarea.fallback || tarea.fallbacks) return 'nube'
  if (esLoopback(tarea.base_url)) return 'local'
  const provider = String(tarea.provider || '').toLowerCase()
  if (PROVIDERS_LOCALES.has(provider)) return 'local'
  return 'nube'
}

// Lee la config efectiva por config.get; si el transporte no la deja leer,
// se trata como nube (fail-closed).
export async function leerDestino(requestProfile, ruta) {
  const intentos = [
    { key: 'full' }, { key: 'auxiliary' }, {},
  ]
  for (const params of intentos) {
    try {
      const cfg = await requestProfile(ruta, 'config.get', params, 10000)
      if (cfg) return clasificarDestino(cfg.full || cfg)
    } catch { /* siguiente forma */ }
  }
  return 'nube'
}

export function componerInputL2({ segmento, contexto }) {
  const normas = (contexto && contexto.normas) || []
  const secciones = (contexto && contexto.seccionesNif) || []
  return '<dike-prediccion>\n<contexto>'
    + (normas.length ? 'normas verificadas del caso: ' + normas.join('; ') + '\n' : '')
    + (secciones.length ? 'secciones del NIF: ' + secciones.join('; ') + '\n' : '')
    + '</contexto>\n<segmento>' + String(segmento || '') + '</segmento>\n'
    + '</dike-prediccion>'
}

// Predictor de modelo. deps: {requestProfile, ruta, destino, prepararEnvio,
// registrarLocal} — destino 'local'|'nube' ya resuelto por el panel.
export function crearPredictorModelo(deps) {
  return {
    id: 'modelo',
    capa: 'L2',
    etiqueta: 'modelo · ' + (deps.destino === 'local' ? 'local' : 'nube'),
    disponible: () => Boolean(deps.ruta),
    async predecir({ segmento, contexto, signal }) {
      const input = componerInputL2({ segmento, contexto })
      const t0 = Date.now()
      let texto = input
      if (deps.destino === 'nube') {
        // nube: el input pasa por el pipeline de privacidad antes de salir
        const envio = await deps.prepararEnvio({ texto: input })
        texto = envio.texto
      } else if (deps.registrarLocal) {
        await deps.registrarLocal(input)
      }
      const r = await deps.requestProfile(deps.ruta, 'llm.oneshot', {
        task: 'dike_prediccion', instructions: INSTRUCCIONES_L2,
        input: texto, max_tokens: 48, temperature: 0.2,
      }, 20000)
      const cont = r && String(r.text || '').trim()
      if (!cont) return null
      return {
        texto: cont.slice(0, 200),
        capa: 'L2',
        procedencia: {
          tipo: 'modelo', fuente: 'auxiliary.dike_prediccion · '
            + (deps.destino === 'local' ? 'local' : 'nube'),
        },
        latencia_ms: Date.now() - t0,
      }
    },
  }
}
