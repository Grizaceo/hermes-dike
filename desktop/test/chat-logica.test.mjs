// Lógica pura del chat del escrito (node --test).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  acumDeltas, activoDe, candidatosPerfil, bloqueCambios, bloqueConstancia, bloqueEscrito,
  componerTurno, diffParrafos, etiquetaDestino, etiquetaModelo, filtroEvento,
  fragmentoEn, hashParrafo, neutralizar, nombrePerfilActivo, normalizarFragmento,
  parsePregunta, parsearNotas, rangoFragmento,
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

test('candidatosPerfil: perfil_chat configurado o perfil activo', () => {
  const rutas = [
    { targetProfile: 'mi-perfil', profile: 'default' },
    { targetProfile: 'lexo-alpha', profile: 'lexo-alpha' },
  ]
  // Sin perfil_chat → el perfil activo es el único candidato.
  assert.deepEqual(candidatosPerfil(rutas, 'lexo-alpha', ''), ['lexo-alpha'])
  assert.deepEqual(candidatosPerfil(rutas, 'lexo-alpha'), ['lexo-alpha'])
  // Con perfil_chat → ese perfil, no el activo.
  assert.deepEqual(candidatosPerfil(rutas, 'lexo-alpha', 'mi-perfil'), ['mi-perfil'])
  // perfil_chat sin ruta disponible → vacío (el error lo da el llamador).
  assert.deepEqual(candidatosPerfil(rutas, 'lexo-alpha', 'inexistente'), [])
  // perfil_chat igual al activo → un solo candidato, sin duplicar.
  assert.deepEqual(candidatosPerfil(rutas, 'lexo-alpha', 'lexo-alpha'), ['lexo-alpha'])
  // sin rutas → vacío.
  assert.deepEqual(candidatosPerfil([], 'lexo-alpha', 'mi-perfil'), [])
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
    { targetProfile: 'mi-perfil', profile: 'default' },
    { targetProfile: 'lexo-alpha', profile: 'lexo-alpha' },
  ]
  // El perfil activo llega como átomo: nombrePerfilActivo lo resuelve al
  // string y, sin perfil_chat, es el único candidato.
  const activo = nombrePerfilActivo({ get: () => 'lexo-alpha' })
  assert.deepEqual(candidatosPerfil(rutas, activo, ''), ['lexo-alpha'])
  // Con perfil_chat configurado, ese perfil gana sobre el activo.
  assert.deepEqual(candidatosPerfil(rutas, activo, 'mi-perfil'), ['mi-perfil'])
  // Un perfil activo vacío no añade candidato.
  assert.deepEqual(
    candidatosPerfil(rutas, nombrePerfilActivo(undefined), ''), [])
})

// --- Notas al pie y fragmentos ---------------------------------------------

test('parsearNotas separa cuerpo, notas válidas e inválidas', () => {
  const texto = [
    'El artículo 161 exige aviso.',
    '',
    '[^1]: dike:a:207436:art_0161#u02 «El empleador podrá poner término al contrato» (artículo 161 del Código del Trabajo)',
    '[^2]: dike:a:207436:art_0162 "La indemnización se calcula"',
    '[^9]: esto empieza como nota pero no sigue el formato',
    'texto final',
  ].join('\n')
  const { cuerpo, notas, invalidas } = parsearNotas(texto)
  assert.equal(notas.length, 2)
  assert.equal(invalidas.length, 1)
  assert.equal(notas[0].n, 1)
  assert.equal(notas[0].nodo_id, 'a:207436:art_0161')
  assert.equal(notas[0].unidad_id, 'a:207436:art_0161#u02')
  assert.equal(notas[0].fragmento, 'El empleador podrá poner término al contrato')
  assert.equal(notas[0].cita, 'artículo 161 del Código del Trabajo')
  assert.equal(notas[1].unidad_id, null)
  assert.equal(notas[1].fragmento, 'La indemnización se calcula')
  // el cuerpo conserva todo menos las líneas de nota (válidas e inválidas)
  assert.ok(cuerpo.includes('El artículo 161 exige aviso.'))
  assert.ok(cuerpo.includes('texto final'))
  assert.ok(!cuerpo.includes('dike:a:207436'))
  assert.ok(!cuerpo.includes('[^1]:'))
})

test('parsearNotas normaliza el número de unidad a #uNN', () => {
  const { notas } = parsearNotas('[^3]: dike:a:5:art_0007#u7 «fragmento suficientemente largo aquí»')
  assert.equal(notas[0].unidad_id, 'a:5:art_0007#u07')
})

test('parsearNotas sin notas devuelve el texto intacto', () => {
  const { cuerpo, notas, invalidas } = parsearNotas('solo texto\nsin notas')
  assert.equal(cuerpo, 'solo texto\nsin notas')
  assert.deepEqual(notas, [])
  assert.deepEqual(invalidas, [])
})

test('fragmentoEn: encontrado, corto, largo y ausente', () => {
  const articulo = 'El empleador podrá poner término al contrato de trabajo. ' +
    'La indemnización se calculará conforme a la ley.'
  const fragOk = 'podrá poner término al contrato de trabajo. La indemnización'
  assert.deepEqual(fragmentoEn(fragOk, articulo), { ok: true, motivo: null })
  assert.equal(fragmentoEn('corto', articulo).motivo, 'corto')
  assert.equal(fragmentoEn('x'.repeat(401), articulo).motivo, 'largo')
  assert.equal(fragmentoEn('este fragmento no está en el artículo para nada', articulo).motivo, 'ausente')
})

test('normalizarFragmento unifica espacios y comillas sin doblar acentos', () => {
  assert.equal(normalizarFragmento('  «a»   “b”  ‘c’  '), '"a" "b" \'c\'')
  // conserva mayúsculas y acentos (la comparación es literal)
  assert.equal(normalizarFragmento('  El Código   del Trabajo  '), 'El Código del Trabajo')
})

test('rangoFragmento devuelve offsets del texto original', () => {
  const texto = 'Intro. El empleador podrá poner término al contrato. Fin.'
  const frag2 = 'El empleador podrá poner término al contrato'
  const r = rangoFragmento(texto, frag2)
  assert.ok(Array.isArray(r))
  assert.equal(texto.slice(r[0], r[1]), frag2)
  assert.equal(rangoFragmento(texto, 'no está'), null)
  assert.equal(rangoFragmento(texto, 'corto'), null)
})
