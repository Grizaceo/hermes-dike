// Mock de la API del plugin para el arnés offline: mismas rutas que
// dashboard/plugin_api.py, estado en memoria. Sin red, sin backend.
// El test harness.test.mjs verifica que cubre cada rest('…') de src/.

import * as F from './fixtures.js'

let lento = false
export function setMockLento(v) { lento = !!v }
export function mockLento() { return lento }

function errHttp(status, detail) {
  const e = new Error(typeof detail === 'string' ? detail
    : (detail && detail.detail) || ('HTTP ' + status))
  e.status = status
  e.detail = detail
  return e
}

const delay = () => (lento ? new Promise((r) => setTimeout(r, 1500)) : Promise.resolve())

// Estado en memoria ----------------------------------------------------------
const escritos = new Map() // case_id -> {rev, html, texto, registro}
const nifCasos = new Map() // case_id -> snapshot NIF
const prefs = { ...F.PREFERENCIAS_DEFAULT }
let demoSembrado = false

function escritoDe(caseId) {
  if (!escritos.has(caseId)) {
    escritos.set(caseId, { rev: 1, html: '', texto: '', registro: null })
  }
  return escritos.get(caseId)
}

function nifDe(caseId) {
  if (!nifCasos.has(caseId)) nifCasos.set(caseId, F.nifDemo(caseId))
  return nifCasos.get(caseId)
}

// Enrutador ------------------------------------------------------------------
// Devuelve {status, body} o lanza errHttp. `q` = query params, `body` = JSON.
function ruta(metodo, pathname, q, body) {
  const get = (k, d) => (q.has(k) ? q.get(k) : d)

  // -- estado y preferencias -------------------------------------------------
  if (metodo === 'GET' && pathname === '/estado') return F.ESTADO
  if (metodo === 'GET' && pathname === '/preferencias') return { ...prefs }
  if (metodo === 'POST' && pathname === '/preferencias') {
    for (const k of Object.keys(prefs)) {
      if (body && body[k] !== undefined) prefs[k] = body[k]
    }
    return { ...prefs }
  }

  // -- escritos --------------------------------------------------------------
  if (metodo === 'GET' && pathname === '/escrito') {
    const cid = get('case_id', 'borrador')
    const e = escritoDe(cid)
    return {
      existe: Boolean(e.texto || e.html), rev: e.rev,
      html: e.html, texto: e.texto, registro: e.registro,
      case_id: cid,
    }
  }
  if (metodo === 'POST' && pathname === '/escrito') {
    const cid = (body && body.case_id) || 'borrador'
    const e = escritoDe(cid)
    const revBase = body && body.rev_base
    if (revBase !== undefined && revBase !== e.rev) {
      throw errHttp(409, { detail: 'conflicto de revisión', rev_actual: e.rev })
    }
    e.html = (body && body.html) || ''
    e.texto = (body && body.texto) || ''
    e.registro = (body && body.registro) || e.registro
    e.rev += 1
    return { rev: e.rev, actualizado: true }
  }
  if (metodo === 'GET' && pathname === '/escrito/demo') {
    return { html: F.demoHtml(), texto: F.DEMO_TEXTO }
  }

  // -- verificador ------------------------------------------------------------
  if (metodo === 'POST' && pathname === '/verificar') {
    return F.resultadoVerificar(body && body.texto)
  }

  // -- casos NIF --------------------------------------------------------------
  if (metodo === 'GET' && pathname === '/nif/casos') {
    const cases = [...F.CASOS_NIF.cases]
    for (const [cid] of nifCasos) {
      if (!cases.some((c) => c.case_id === cid)) {
        cases.push({ case_id: cid,
          legal_question: 'Caso creado en el arnés', created_at: '2026-01-13T10:00:00Z' })
      }
    }
    return { cases }
  }
  if (metodo === 'POST' && pathname === '/nif/init') {
    const cid = (body && (body.case_id || body.id)) || 'caso-nuevo'
    nifCasos.set(cid, {
      snapshot: { exists: false, version: 0, nif: null, patches: [] },
      patches: { patches: [] },
    })
    return { case_id: cid, ok: true }
  }
  if (metodo === 'POST' && pathname === '/nif/seed') {
    demoSembrado = true
    nifCasos.set('causa-despido-1', F.nifDemo('causa-despido-1'))
    return { case_id: 'causa-despido-1', ok: true }
  }
  if (metodo === 'GET' && pathname === '/nif/snapshot') {
    return nifDe(get('case_id', 'causa-despido-1'))
  }
  if (metodo === 'POST' && pathname === '/nif/edit') {
    const d = nifDe((body && body.case_id) || 'causa-despido-1')
    d.snapshot.version = (d.snapshot.version || 0) + 1
    if (body && body.patch) {
      d.snapshot.patches = (d.snapshot.patches || []).concat([body.patch])
      d.patches.patches = (d.patches.patches || []).concat([
        { ...body.patch, status: 'pendiente' }])
    }
    return { ok: true, snapshot: d.snapshot }
  }
  if (metodo === 'POST' && pathname === '/nif/gap') {
    return { ok: true }
  }
  if (metodo === 'POST' && pathname === '/nif/validar') {
    const d = nifDe((body && body.case_id) || 'causa-despido-1')
    if (d.snapshot.nif) {
      d.snapshot.nif.validated_by_human = Boolean(body && body.validated)
    }
    return { ok: true, snapshot: d.snapshot }
  }
  if (metodo === 'POST' && pathname === '/nif/confianza') {
    const d = nifDe((body && body.case_id) || 'causa-despido-1')
    if (d.snapshot.nif && body && typeof body.confidence === 'number') {
      d.snapshot.nif.confidence = body.confidence
    }
    return { ok: true, snapshot: d.snapshot }
  }

  // -- grafo ------------------------------------------------------------------
  if (metodo === 'GET' && pathname === '/grafo/personal') {
    return { candidates: [], edges: [] }
  }
  if (metodo === 'GET' && pathname === '/grafo/corpus') {
    return { packs: [{ normas: F.NORMAS_CORPUS }] }
  }
  if (metodo === 'GET' && pathname.startsWith('/grafo/corpus/norma/')) {
    const code = pathname.slice('/grafo/corpus/norma/'.length)
    return {
      articulos_total: 3,
      articulos_truncados: false,
      articulos: [
        { label: 'art. 0001', eId: 'a:' + code + ':art_0001', estado: 'vigente',
          vigente_desde: '2020-01-01', texto: 'Artículo primero de ejemplo.' },
        { label: 'art. 0002', eId: 'a:' + code + ':art_0002', estado: 'vigente',
          vigente_desde: '2021-06-01', texto: 'Artículo segundo de ejemplo.' },
        { label: 'art. 0003', eId: 'a:' + code + ':art_0003', estado: 'derogado',
          vigente_desde: null, texto: 'Artículo tercero derogado.' },
      ],
    }
  }
  if (metodo === 'GET' && pathname === '/grafo/red') {
    const fuente = get('fuente', 'corpus')
    if (fuente === 'ambiental') {
      return { nodes: [], links: [], conteos: { nodes: 0, links: 0 },
        truncado: false, fuente, pack_hash: null, local_only: true,
        caminos_demo: [] }
    }
    return F.GRAFO_CORPUS
  }
  if (metodo === 'POST' && pathname === '/grafo/buscar') {
    return F.BUSQUEDA_CORPUS
  }
  if (metodo === 'POST' && pathname === '/grafo/leer') {
    return F.TEXTO_ARTICULO
  }
  if (metodo === 'GET' && pathname === '/grafo/fuentes') return F.GRAFO_FUENTES
  if (metodo === 'GET' && pathname === '/grafo/nodo') {
    return { ...F.NODO_DETALLE, id: get('id', F.NODO_DETALLE.id) }
  }
  if (metodo === 'GET' && pathname === '/grafo/unidades') {
    return { nodes: [
      { id: 'a:207436:art_0161#u01', tipo: 'unidad', label: 'u01', modalidad: 'definicion', clase: 'normativa' },
      { id: 'a:207436:art_0161#u02', tipo: 'unidad', label: 'u02', modalidad: 'obligacion', clase: 'normativa' },
    ], links: [
      { source: get('articulo'), target: 'a:207436:art_0161#u01', tipo: 'contiene', estado: 'verificada_estructura' },
      { source: get('articulo'), target: 'a:207436:art_0161#u02', tipo: 'contiene', estado: 'verificada_estructura' },
    ] }
  }
  if (metodo === 'GET' && pathname === '/grafo/unidad') return F.UNIDAD_DETALLE
  if (metodo === 'GET' && pathname === '/grafo/evidencia') {
    return { snippet: 'la causal de necesidades de la empresa',
      n_evidencias: 2, regla: 'r-cita-expresa', nivel: 'alta' }
  }

  // -- estilo ------------------------------------------------------------------
  if (metodo === 'POST' && pathname === '/estilo/analizar') return F.ANALISIS_ESTILO
  if (metodo === 'POST' && pathname === '/estilo/grafo') return F.GRAFO_ESTILO

  // -- privacidad ---------------------------------------------------------------
  if (metodo === 'POST' && pathname === '/privacidad/detectar') return F.PRIVACIDAD_DETECTAR
  if (metodo === 'POST' && pathname === '/privacidad/decision') return { ok: true }
  if (metodo === 'POST' && pathname === '/privacidad/seudonimizar') {
    return {
      texto: String((body && body.texto) || '')
        .replace(/11\.111\.111-1/g, '[RUT_1]')
        .replace(/María José Pérez González/g, '[PERSONA_1]'),
      mapa: { '[RUT_1]': '11.111.111-1', '[PERSONA_1]': 'María José Pérez González' },
      sha256: 'd'.repeat(64),
      conteos: { rut: 1, nombre: 1 },
    }
  }
  if (metodo === 'POST' && pathname === '/privacidad/envio') return { ok: true }

  // -- predicción ---------------------------------------------------------------
  // /prediccion/corpus es POST-only {cola: 1–300} en el backend real.
  if (metodo === 'POST' && pathname === '/prediccion/corpus') {
    const cola = String((body && body.cola) || '')
    if (!cola.trim()) throw errHttp(400, 'cola vacía.')
    if (cola.length > 300) throw errHttp(400, 'cola demasiado larga.')
    return F.PREDICCION_CORPUS
  }
  if (metodo === 'POST' && pathname === '/prediccion/evento') return { ok: true }

  // -- ordenamientos --------------------------------------------------------------
  if (metodo === 'GET' && pathname === '/ordenamiento/perfiles') return F.ORDENAMIENTOS_PERFILES
  if (metodo === 'POST' && pathname === '/ordenamiento/plantilla') {
    return { perfil: { jurisdiccion: 'xx' }, paquete: 'xx-1.0.0' }
  }
  if (metodo === 'POST' && pathname === '/ordenamiento/validar-perfil') {
    return { ok: true, errores: [] }
  }
  if (metodo === 'POST' && pathname === '/ordenamiento/construir') return F.CONSTRUCCION_OK

  throw errHttp(404, 'ruta no implementada en el mock: ' + metodo + ' ' + pathname)
}

// rest(path, opts) — misma forma que ctx.rest del SDK.
export function createMockRest() {
  return async (path, opts = {}) => {
    const [pathname, qs] = String(path).split('?')
    const q = new URLSearchParams(qs || '')
    const metodo = (opts.method || 'GET').toUpperCase()
    await delay()
    const body = opts.body !== undefined ? opts.body : undefined
    return ruta(metodo, pathname, q, body)
  }
}
