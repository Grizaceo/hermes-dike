// Tests de la lógica pura del verificador del Case Writer.
// `npm test` en desktop/ (node --test). verificador.js no importa tiptap ni
// react; los docs de ProseMirror se construyen con el esquema real de
// StarterKit para ejercitar segmentosDeDoc contra el mismo traversal que usa
// editor.getText({ blockSeparator: '\n' }).

import assert from 'node:assert/strict'
import test from 'node:test'

import { getSchema, getText } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Node } from '@tiptap/pm/model'

import {
  AVISO_JUICIO, estadoCita, etiquetaCita, localizarCitas, mensajeVeredicto,
  offsetAPos, rangoAPos, rangosAPos, segmentosDeDoc, sha256Hex,
} from '../src/escritor/verificador.js'

const schema = getSchema([StarterKit])

function docDe(parrafos) {
  return Node.fromJSON(schema, {
    type: 'doc',
    content: parrafos.map((t) => ({
      type: 'paragraph',
      content: t === null ? [] : [{ type: 'text', text: t }],
    })),
  })
}

// --- localizarCitas ---------------------------------------------------------

test('localizarCitas encuentra todas las apariciones de cada cita', () => {
  const texto = 'abc cita-uno def cita-uno ghi cita-dos cita-uno'
  const detalles = [
    { cita_raw: 'cita-uno' },
    { cita_raw: 'cita-dos' },
  ]
  const out = localizarCitas(texto, detalles)
  assert.deepEqual(out, [
    { inicio: 4, fin: 12, indiceDetalle: 0 },
    { inicio: 17, fin: 25, indiceDetalle: 0 },
    { inicio: 30, fin: 38, indiceDetalle: 1 },
    { inicio: 39, fin: 47, indiceDetalle: 0 },
  ])
})

test('localizarCitas: cita no encontrada no produce rango', () => {
  const out = localizarCitas('texto sin la cita', [
    { cita_raw: 'art. 161' },
    { cita_raw: 'texto' },
  ])
  assert.deepEqual(out, [{ inicio: 0, fin: 5, indiceDetalle: 1 }])
})

test('localizarCitas no devuelve rangos solapados', () => {
  // 'art. 161 del Código' solapa con '161 del': gana la más larga al mismo
  // inicio; una segunda que empieza dentro de otra queda descartada.
  const texto = 'art. 161 del Código del Trabajo'
  const out = localizarCitas(texto, [
    { cita_raw: '161 del' },
    { cita_raw: 'art. 161 del Código' },
  ])
  assert.deepEqual(out, [
    { inicio: 0, fin: 'art. 161 del Código'.length, indiceDetalle: 1 },
  ])
})

test('localizarCitas ignora detalles sin cita_raw', () => {
  assert.deepEqual(localizarCitas('abc', [null, {}, { cita_raw: '' }]), [])
})

// --- estadoCita --------------------------------------------------------------

test('estadoCita: verificada solo con VERIFICADA y hash del texto actual', () => {
  const d = { estado: 'VERIFICADA', cita_raw: 'art. 161' }
  assert.equal(estadoCita(d, 'aaa', 'aaa', {}), 'verificada')
  assert.equal(estadoCita(d, 'aaa', 'bbb', {}), 'desactualizada')
  assert.equal(estadoCita(d, null, 'aaa', {}), 'desactualizada')
  assert.equal(estadoCita(d, 'aaa', null, {}), 'desactualizada')
})

test('estadoCita: FALLO del motor nunca muestra verificada', () => {
  for (const resolucion of ['AMBIGUOUS', 'UNRESOLVABLE', 'NO_ENCONTRADA']) {
    const d = { estado: 'FALLO', resolucion, cita_raw: 'x' }
    assert.equal(estadoCita(d, 'h', 'h', {}), 'fallo')
  }
})

test('estadoCita: el motor gana sobre retiro/escalada si el texto es el actual', () => {
  const d = { estado: 'VERIFICADA', cita_raw: 'art. 161' }
  const reg = {
    retiros: [{ cita_raw: 'art. 161', motivo: 'm', fecha: 'f' }],
    escaladas: [{ cita_raw: 'art. 161', nota: 'n', fecha: 'f' }],
  }
  // VERIFICADA + hash igual → verificada aunque el registro la tenga
  assert.equal(estadoCita(d, 'h', 'h', reg), 'verificada')
})

test('estadoCita: registro solo si el motor no la verificó sobre el texto actual', () => {
  const reg = {
    retiros: [{ cita_raw: 'art. 161', motivo: 'm', fecha: 'f' }],
    escaladas: [{ cita_raw: 'art. 1', nota: 'n', fecha: 'f' }],
  }
  // VERIFICADA pero texto distinto → manda el retiro
  const dv = { estado: 'VERIFICADA', cita_raw: 'art. 161' }
  assert.equal(estadoCita(dv, 'h', 'otro', reg), 'retirada')
  // FALLO con hash igual → manda el registro sobre el fallo
  const df = { estado: 'FALLO', cita_raw: 'art. 161', resolucion: 'AMBIGUOUS' }
  assert.equal(estadoCita(df, 'h', 'h', reg), 'retirada')
  assert.equal(estadoCita({ ...df, cita_raw: 'art. 1' }, 'h', 'h', reg), 'escalada')
})

// --- Etiquetas -----------------------------------------------------------------

test('etiqueta verificada incluye as_of, pack_hash, gid y fuente_url', () => {
  const d = { cita_raw: 'art. 161 CT', gid: 'leychile:codigo-trabajo:art_161',
    fuente_url: 'https://leychile.cl/N?i=1' }
  const meta = { as_of: '2026-11-08', pack_hash: 'af1422d66d1e6eee' }
  const t = etiquetaCita('verificada', d, meta, {})
  assert.ok(t.includes('vigente al 2026-11-08'))
  assert.ok(t.includes('corpus af1422d66d1e6eee'))
  assert.ok(t.includes(d.gid) && t.includes(d.fuente_url))
  assert.ok(t.startsWith('Probado por Diké:'))
})

test('etiquetas de fallo, desactualizada, retirada y escalada', () => {
  const d = { cita_raw: 'x', resolucion: 'AMBIGUOUS' }
  assert.equal(etiquetaCita('fallo', d, {}, {}), 'FALLO · AMBIGUOUS')
  assert.equal(etiquetaCita('desactualizada', d, {}, {}),
    'El texto cambió: verifica de nuevo')
  const reg = {
    retiros: [{ cita_raw: 'x', motivo: 'no aplica' }],
    escaladas: [{ cita_raw: 'x', nota: 'revisar con socio' }],
  }
  assert.equal(etiquetaCita('retirada', d, {}, reg), 'Retirada: no aplica')
  assert.equal(etiquetaCita('escalada', d, {}, reg),
    'Escalada para revisión humana: revisar con socio')
})

test('mensajes de veredicto y aviso de alcance fijos', () => {
  assert.ok(mensajeVeredicto('SIN_CITAS').includes('no significa que el escrito no cite'))
  assert.ok(mensajeVeredicto('SIN_CORPUS').includes('no es un resultado favorable'))
  assert.equal(mensajeVeredicto('TODAS_VERIFICADAS'), null)
  assert.ok(AVISO_JUICIO.includes('juicio del abogado'))
})

// --- Mapa offsets ↔ posiciones PM -------------------------------------------------

// docDe(['hola','arte']): para1 [0,6) texto en pos 1..5; para2 [6,12) texto
// en pos 7..11. getText = 'hola\narte': 'hola' 0..4, '\n' 4..5, 'arte' 5..9.
test('segmentosDeDoc cubre exactamente el texto de getText', () => {
  const doc = docDe(['hola mundo', 'art. 161 CT', null, 'fin'])
  const esperado = 'hola mundo\nart. 161 CT\n\nfin'
  assert.equal(getText(doc, { blockSeparator: '\n' }), esperado)
  const segs = segmentosDeDoc(doc)
  assert.equal(segs[segs.length - 1].t1, esperado.length)
  // los segmentos son contiguos y cubren [0, len)
  let t = 0
  for (const s of segs) {
    assert.equal(s.t0, t)
    t = s.t1
  }
  assert.equal(t, esperado.length)
})

test('offsetAPos mapea offsets de getText a posiciones del doc', () => {
  const doc = docDe(['hola', 'arte'])
  const segs = segmentosDeDoc(doc)
  assert.equal(getText(doc, { blockSeparator: '\n' }), 'hola\narte')
  assert.equal(offsetAPos(segs, 0), 1)   // 'h' → pos 1
  assert.equal(offsetAPos(segs, 3), 4)   // 'a' de hola → pos 4
  assert.equal(offsetAPos(segs, 4), 6)   // '\n' separador → límite antes de para2
  assert.equal(offsetAPos(segs, 5), 7)   // 'a' de arte → pos 7
  assert.equal(offsetAPos(segs, 9), 11)  // fin del texto → pos 11
})

test('rangosAPos da un rango por bloque y salta separadores', () => {
  const doc = docDe(['hola', 'arte'])
  const segs = segmentosDeDoc(doc)
  // rango dentro de un bloque
  assert.deepEqual(rangosAPos(segs, 0, 4), [{ from: 1, to: 5 }])
  // rango que cruza el separador: dos rangos intra-bloque
  assert.deepEqual(rangosAPos(segs, 2, 8), [
    { from: 3, to: 5 },
    { from: 7, to: 10 },
  ])
  // rango solo sobre el separador: nada que marcar
  assert.deepEqual(rangosAPos(segs, 4, 5), [])
  // rangoAPos (simple) abarca del primero al último
  assert.deepEqual(rangoAPos(segs, 2, 8), { from: 3, to: 10 })
})

test('mapeo con párrafo vacío intermedio', () => {
  const doc = docDe(['uno', null, 'tres'])
  const segs = segmentosDeDoc(doc)
  assert.equal(getText(doc, { blockSeparator: '\n' }), 'uno\n\ntres')
  // 'uno' 0..3, '\n' 3..4, '\n' 4..5, 'tres' 5..9; para3 texto en pos 8..12
  assert.deepEqual(rangosAPos(segs, 6, 9), [{ from: 9, to: 12 }])
  assert.deepEqual(rangoAPos(segs, 0, 3), { from: 1, to: 4 })
})

// --- sha256 -----------------------------------------------------------------

test('sha256Hex produce el digest esperado', async () => {
  const h = await sha256Hex('hola')
  assert.equal(h.length, 64)
  assert.match(h, /^[0-9a-f]+$/)
  assert.equal(h, await sha256Hex('hola'))
  assert.notEqual(h, await sha256Hex('hola '))
})
