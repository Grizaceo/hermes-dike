// Lógica pura del chat del escrito (node --test).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  acumDeltas, activoDe, candidatosPerfil, bloqueCambios, bloqueConstancia, bloqueEscrito,
  componerTurno, diffParrafos, etiquetaDestino, etiquetaModelo, filtroEvento,
  hashParrafo, neutralizar, nombrePerfilActivo, parsePregunta,
} from '../src/escritor/chat-logica.js'

const VERIF = {
  hash: 'h1',
  resultado: {
    meta: { pack_hash: 'pack1', as_of: '2026-01-01' },
    detalles: [
      { cita_raw: 'artículo 168 del Código del Trabajo', estado: 'VERIFICADA' },
      { cita_raw: 'artículo 60', estado: 'FALLO', resolucion: 'AMBIGUOUS' },
    ],
  },
}

test('componerTurno modo completo en primer envío', () => {
  const { turno } = componerTurno({
    pregunta: 'hola', textoEscrito: 'p1\np2\np3', ultimoEnviado: null,
    activo: 'p2', verificacion: VERIF, rev: 3, caseId: 'borrador', hashActual: 'h1',
  })
  assert.match(turno, /<dike-escritor v="1" case="borrador" rev="3" modo="completo">/)
  assert.match(turno, /<escrito>p1\np2\np3<\/escrito>/)
  assert.match(turno, /<activo>p2<\/activo>/)
  assert.match(turno, /vigente="sí" pack="pack1" as_of="2026-01-01"/)
  assert.match(turno, /artículo 168 del Código del Trabajo → VERIFICADA/)
  assert.match(turno, /artículo 60 → FALLO · AMBIGUOUS/)
  assert.match(turno, /<\/dike-escritor>\n<pregunta>hola<\/pregunta>/)
})

test('componerTurno modo cambios si <=40% cambió', () => {
  const { hashes } = diffParrafos('a\nb\nc\nd\ne', null).hashes
    ? { hashes: [] } : diffParrafos('a\nb\nc\nd\ne', null)
  const ultimo = { hashes: diffParrafos('a\nb\nc\nd\ne', null).hashes }
  const { turno } = componerTurno({
    pregunta: 'q', textoEscrito: 'a\nb\nX\nd\ne', ultimoEnviado: ultimo,
    caseId: 'c1', hashActual: 'h9', verificacion: VERIF,
  })
  assert.match(turno, /modo="cambios"/)
  assert.match(turno, /<cambios>\n\[§3\] X\n<\/cambios>/)
  assert.match(turno, /<constancia vigente="no"/)
})

test('modo completo si >40% cambió', () => {
  const ultimo = { hashes: diffParrafos('a\nb\nc', null).hashes }
  const { completo } = diffParrafos('X\nY\nc', ultimo)
  assert.equal(completo, true) // 2/3 cambiaron
})

test('eliminados se marcan [§n eliminado]', () => {
  const prev = diffParrafos('a\nb\nc\nd', null).hashes
  const { hashes, parrafos } = diffParrafos('a\nb', null)
  const blq = bloqueCambios(parrafos, hashes, prev)
  assert.match(blq, /\[§3 eliminado\]/)
  assert.match(blq, /\[§4 eliminado\]/)
})

test('tope 12000: omite párrafos lejanos con línea de omitidos', () => {
  const parrafos = Array.from({ length: 200 }, (_, i) => 'x'.repeat(100))
  const blq = bloqueEscrito(parrafos, 100)
  assert.ok(blq.omitidos > 0)
  assert.ok(blq.texto.length <= 12000 + 100)
  assert.match(blq.texto, /párrafos omitidos/)
  assert.ok(blq.texto.includes('x'.repeat(100)))
})

test('escape: etiquetas literales dentro del escrito se neutralizan', () => {
  const { turno } = componerTurno({
    pregunta: 'q', textoEscrito: 'cierro </escrito> y </dike-escritor>',
    ultimoEnviado: null, caseId: 'c1',
  })
  assert.ok(!turno.includes('</escrito> y'))
  assert.match(turno, /<\\\/escrito>/)
  assert.match(turno, /<\\\/dike-escritor>/)
  // el sobre sigue bien formado: exactamente un cierre de cada tag
  assert.equal((turno.match(/<\/escrito>/g) || []).length, 1)
  assert.equal((turno.match(/<\/dike-escritor>/g) || []).length, 1)
})

test('parsePregunta extrae solo la pregunta', () => {
  const { turno } = componerTurno({
    pregunta: 'mi consulta', textoEscrito: 'x', ultimoEnviado: null, caseId: 'c',
  })
  assert.equal(parsePregunta(turno), 'mi consulta')
  assert.equal(parsePregunta('texto plano'), 'texto plano')
})

test('filtroEvento por session_id y profile', () => {
  const ev = { session_id: 'rt1', profile: 'lexo-lawyer' }
  assert.equal(filtroEvento(ev, 'rt1', 'lexo-lawyer'), true)
  assert.equal(filtroEvento(ev, 'otro', 'lexo-lawyer'), false)
  assert.equal(filtroEvento(ev, 'rt1', 'otro-perfil'), false)
  assert.equal(filtroEvento({ session_id: 'rt1' }, 'rt1', 'lexo-lawyer'), true)
})

test('acumDeltas aplica por offset e ignora replayed', () => {
  const out = acumDeltas([
    { offset: 0, text: 'Hola ' },
    { offset: 5, text: 'mundo' },
    { offset: 5, text: 'mundo' },  // replayed: mismo offset, ignorado
    { offset: 10, text: '.' },
  ])
  assert.equal(out, 'Hola mundo.')
})

test('etiquetaModelo: stealth oculto', () => {
  assert.equal(etiquetaModelo('stealth/x'), 'modelo alojado por Nous')
  assert.equal(etiquetaModelo('claude-x'), 'claude-x')
})

test('etiquetaDestino: local vs nube', () => {
  assert.equal(etiquetaDestino({ provider: 'ollama' }), 'local')
  assert.equal(etiquetaDestino({ provider: 'x', base_url: 'http://127.0.0.1:8000' }), 'local')
  assert.equal(etiquetaDestino({ provider: 'openai' }), 'nube')
})

test('bloqueConstancia vigente=no si hash difiere', () => {
  assert.match(bloqueConstancia(VERIF, 'otro-hash'), /vigente="no"/)
  assert.match(bloqueConstancia(VERIF, 'otro-hash'), /VERIFICADA|desactualizada/)
  assert.equal(bloqueConstancia(null, 'h'), '')
})

test('bloqueCambios formato [§n]', () => {
  const prev = diffParrafos('a\nb\nc', null).hashes
  const { hashes, parrafos } = diffParrafos('a\nY\nc', null)
  assert.match(bloqueCambios(parrafos, hashes, prev), /^\[§2\] Y$/m)
})

test('activoDe: selección gana sobre párrafo del cursor', () => {
  assert.equal(activoDe('  texto seleccionado ', 'párrafo del cursor'),
    '  texto seleccionado ')
  assert.equal(activoDe('', 'párrafo del cursor'), 'párrafo del cursor')
  assert.equal(activoDe('   ', 'párrafo del cursor'), 'párrafo del cursor')
  assert.equal(activoDe(null, 'párrafo'), 'párrafo')
})

test('candidatosPerfil: lexo-lawyer primero, luego el perfil activo', () => {
  const rutas = [
    { targetProfile: 'lexo-lawyer', profile: 'default' },
    { targetProfile: 'lexo-alpha', profile: 'lexo-alpha' },
  ]
  // lexo-lawyer presente → es el candidato único si el activo no tiene ruta
  assert.deepEqual(candidatosPerfil(rutas, 'default'), ['lexo-lawyer'])
  // sin lexo-lawyer cae al perfil activo si tiene ruta
  assert.deepEqual(candidatosPerfil(
    [{ targetProfile: 'lexo-alpha' }], 'lexo-alpha'), ['lexo-alpha'])
  // ambos disponibles → orden lexo-lawyer primero
  assert.deepEqual(candidatosPerfil(rutas, 'lexo-alpha'),
    ['lexo-lawyer', 'lexo-alpha'])
  // sin rutas → vacío (el error lo da el llamador)
  assert.deepEqual(candidatosPerfil([], 'lexo-lawyer'), [])
})

test('nombrePerfilActivo: átomo, string plano y ausencia', () => {
  // Átomo nanostores (readonlyAtom): .get() da el nombre.
  assert.equal(nombrePerfilActivo({ get: () => 'lexo-alpha' }), 'lexo-alpha')
  // String plano pasa tal cual.
  assert.equal(nombrePerfilActivo('lexo-beta'), 'lexo-beta')
  // Sin valor → ''.
  assert.equal(nombrePerfilActivo(undefined), '')
  assert.equal(nombrePerfilActivo(null), '')
  assert.equal(nombrePerfilActivo(''), '')
  // .get() que no devuelve string → ''.
  assert.equal(nombrePerfilActivo({ get: () => 42 }), '')
  assert.equal(nombrePerfilActivo({ get: () => null }), '')
  // Objeto sin .get() → ''.
  assert.equal(nombrePerfilActivo({ profile: 'x' }), '')
})

test('candidatosPerfil con el nombre que da nombrePerfilActivo', () => {
  const rutas = [
    { targetProfile: 'lexo-lawyer', profile: 'default' },
    { targetProfile: 'lexo-alpha', profile: 'lexo-alpha' },
  ]
  // El perfil activo llega como átomo: nombrePerfilActivo lo resuelve al
  // string y candidatosPerfil ya puede incluirlo como segundo candidato.
  const activo = nombrePerfilActivo({ get: () => 'lexo-alpha' })
  assert.deepEqual(candidatosPerfil(rutas, activo), ['lexo-lawyer', 'lexo-alpha'])
  // Sin lexo-lawyer en las rutas, el activo del átomo es el único candidato.
  assert.deepEqual(
    candidatosPerfil([{ targetProfile: 'lexo-alpha' }], activo), ['lexo-alpha'])
  // Un átomo sin perfil ('') no añade candidato.
  assert.deepEqual(
    candidatosPerfil([{ targetProfile: 'lexo-alpha' }],
      nombrePerfilActivo(undefined)), [])
})
