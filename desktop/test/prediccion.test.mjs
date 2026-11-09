// Mesa + L0 + L2 (lógica pura, node --test).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { crearMesa, elegir, procedenciaValida, dentroDeCita, TOPE_SUGERENCIA } from '../src/escritor/prediccion/mesa.js'
import { predictFormalismo, predictContenidoJuridico, sufijoPendiente, segmentoActual, textoAInsertar } from '../src/escritor/prediccion/l0.js'
import { clasificarDestino, componerInputL2, INSTRUCCIONES_L2 } from '../src/escritor/prediccion/l2.js'

const ESPERA = (ms) => new Promise((r) => setTimeout(r, ms))

test('mesa: L0 síncrono gana a L1/L2; prioridad de capas', async () => {
  const p = (capa, texto, anclaLen = 0) => ({
    texto, capa, procedencia: { tipo: 'corpus', fuente: 'x', anclaLen } })
  assert.equal(elegir([p('L2', 'nube'), p('L0', 'det')]).capa, 'L0')
  assert.equal(elegir([p('L1', 'a', 5), p('L1', 'b', 9)]).procedencia.anclaLen, 9)
  // sin procedencia.tipo/fuente se descarta
  assert.equal(procedenciaValida({ texto: 'x' }), false)
  assert.equal(elegir([{ texto: 'x', capa: 'L0', procedencia: {} }]), null)
  // tope 200 caracteres
  assert.equal(elegir([p('L0', 'x'.repeat(300))]).texto.length, TOPE_SUGERENCIA)
})

test('mesa: no sugiere con selección ni dentro de cita', async () => {
  let llamado = 0
  const mesa = crearMesa({ predictores: [{
    id: 't', capa: 'L1', disponible: () => true,
    predecir: () => { llamado++; return { texto: 'x', capa: 'L1',
      procedencia: { tipo: 'corpus', fuente: 'y' } } },
  }], debounceMs: 10 })
  let out = 'sin-cambio'
  mesa.sugerir({ segmento: 's', contexto: {},
    signal: { haySeleccion: true } }, (p) => { out = p })
  assert.equal(out, null)
  mesa.sugerir({ segmento: 's', contexto: {},
    signal: { enCita: true } }, (p) => { out = p })
  assert.equal(out, null)
  assert.equal(llamado, 0)
  assert.equal(dentroDeCita([{ from: 5, to: 9 }], 7), true)
  assert.equal(dentroDeCita([{ from: 5, to: 9 }], 12), false)
})

test('mesa: abort — cada llamada cancela la anterior', async () => {
  let pendientes = 0
  const mesa = crearMesa({ predictores: [{
    id: 't', capa: 'L1', disponible: () => true,
    predecir: async () => { pendientes++; await ESPERA(30)
      return { texto: 'v', capa: 'L1', procedencia: { tipo: 'corpus', fuente: 'y' } } },
  }], debounceMs: 10 })
  const outs = []
  mesa.sugerir({ segmento: 'a', contexto: {}, signal: {} }, (p) => outs.push(p))
  mesa.sugerir({ segmento: 'ab', contexto: {}, signal: {} }, (p) => outs.push(p))
  await ESPERA(80)
  assert.equal(outs.length, 1)          // solo la última llegó
})

test('L0: formalismo por prefijo con sufijo alineado', () => {
  assert.equal(predictFormalismo('En lo pr').ghostTexto, 'incipal: ')
  assert.equal(sufijoPendiente('En lo principal: ', '  en lo pr'), 'incipal: ')
  assert.equal(segmentoActual('EN LO PRINCIPAL: demanda de resti'),
    ' demanda de resti')
  assert.equal(textoAInsertar('Demanda de restitución', 'demanda de resti'),
    'tución')
  // ambigüedad: "en lo" casa principal y subsidiario → opciones, no ghost
  const r = predictFormalismo('en lo ')
  assert.equal(r.ghost, null)
  assert.equal(r.ambiguo, true)
  assert.ok(r.opciones.length >= 2)
})

test('L0: acción procesal con fundamentos de procedencia norma', () => {
  const r = predictContenidoJuridico('Robo con violencia')
  assert.ok(r.accion)
  assert.ok(r.fundamentos.length > 0)
  assert.equal(r.fundamentos[0].procedencia.tipo, 'norma')
  assert.match(r.fundamentos[0].label, /artículo \d+/)
  // prosa sin disparador procesal no dispara acciones
  assert.equal(predictContenidoJuridico(
    'el contrato adolece de un error de transcripción en la restitución')
    .accion, null)
})

test('L2: clasificación local/nube', () => {
  const cfg = (t) => ({ auxiliary: { dike_prediccion: t } })
  assert.equal(clasificarDestino(cfg({ base_url: 'http://127.0.0.1:11434/v1' })),
    'local')
  assert.equal(clasificarDestino(cfg({ base_url: 'http://localhost:8080' })),
    'local')
  assert.equal(clasificarDestino(cfg({ provider: 'ollama' })), 'local')
  assert.equal(clasificarDestino(cfg({ provider: 'llamacpp' })), 'local')
  assert.equal(clasificarDestino(cfg({ provider: 'lmstudio' })), 'local')
  // fallback_chain ⇒ nube aunque sea local
  assert.equal(clasificarDestino(cfg({ base_url: 'http://127.0.0.1:1',
    fallback_chain: ['x'] })), 'nube')
  assert.equal(clasificarDestino(cfg({ provider: 'nous' })), 'nube')
  assert.equal(clasificarDestino({}), 'nube')
  assert.equal(clasificarDestino(null), 'nube')
})

test('L2: composición del input', () => {
  const input = componerInputL2({
    segmento: 'El actor interpone',
    contexto: { normas: ['artículo 168'], seccionesNif: ['facts.known'] },
  })
  assert.match(input, /<dike-prediccion>/)
  assert.match(input, /normas verificadas del caso: artículo 168/)
  assert.match(input, /secciones del NIF: facts\.known/)
  assert.match(input, /<segmento>El actor interpone<\/segmento>/)
  assert.match(INSTRUCCIONES_L2, /\[VERIFICAR CITA\]/)
})
