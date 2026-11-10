// Datos de ejemplo del mock: formas reales de plugin_api.py con valores
// pequeños y verificables a ojo (el demo del README, 3 casos, ~40 nodos).

export const PACK_HASH = 'af1422d66d1e6eee0f1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f70a1b2'

export const ESTADO = {
  version: '0.9.0',
  corpus_instalado: true,
  pack_hash: PACK_HASH,
  leyes: 25,
  articulos: 8544,
  aislamiento: { modo: 'bwrap', motivo: null },
  perfil_chat: 'dev',
  demo_disponible: true,
}

// El demo del README tal cual (tests/fixtures/escrito_demo.md lo embebe el
// build vía loader 'text'; aquí va el HTML equivalente para /escrito/demo).
export const DEMO_TEXTO = `EN LO PRINCIPAL: demanda por despido improcedente. (Escrito SINTÉTICO de demostración; partes ficticias.)

S. J. L. DEL TRABAJO DE SANTIAGO

A. B. C., trabajadora, a US. respetuosamente digo:

PRIMERO.- La demandada puso término a mi contrato invocando la causal de necesidades de la empresa del artículo 161 del Código del Trabajo.

SEGUNDO.- El artículo 162 del Código del Trabajo dispone que, cuando el empleador invoque esa causal, el aviso deberá darse al trabajador, con copia a la Inspección del Trabajo respectiva, a lo menos con treinta días de anticipación.

TERCERO.- Conforme al artículo 163 del Código del Trabajo, si el contrato hubiere estado vigente un año o más y el empleador le pusiere término por necesidades de la empresa, deberá pagar la indemnización por años de servicio.

CUARTO.- El artículo 168 del Código del Trabajo permite al trabajador que considere improcedente la aplicación de la causal recurrir al juzgado competente, dentro del plazo de sesenta días hábiles contado desde la separación.

QUINTO.- A mayor abundamiento, el artículo 60 obliga al empleador a lo solicitado.

SEXTO.- Lo anterior se refuerza con el artículo 9999 del Código del Trabajo.`

export function demoHtml() {
  const ps = DEMO_TEXTO.split(/\n{2,}/).map((p) =>
    '<p>' + p.replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</p>').join('')
  return '<div class="ProseMirror">' + ps + '</div>'
}

// La tabla del README: 4 verificadas + 2 rechazadas.
const DETALLES_VERIFICAR = [
  { cita_raw: 'artículo 161 del Código del Trabajo', estado: 'VERIFICADA',
    gid: 'cl.norma.ct:art:0161', fuente_url: 'https://www.bcn.cl/leychile/navegar?idNorma=207436',
    resolucion: 'RESOLVED', fecha_recuperacion: '2026-01-15' },
  { cita_raw: 'artículo 162 del Código del Trabajo', estado: 'VERIFICADA',
    gid: 'cl.norma.ct:art:0162', fuente_url: 'https://www.bcn.cl/leychile/navegar?idNorma=207436',
    resolucion: 'RESOLVED', fecha_recuperacion: '2026-01-15' },
  { cita_raw: 'artículo 163 del Código del Trabajo', estado: 'VERIFICADA',
    gid: 'cl.norma.ct:art:0163', fuente_url: 'https://www.bcn.cl/leychile/navegar?idNorma=207436',
    resolucion: 'RESOLVED', fecha_recuperacion: '2026-01-15' },
  { cita_raw: 'artículo 168 del Código del Trabajo', estado: 'VERIFICADA',
    gid: 'cl.norma.ct:art:0168', fuente_url: 'https://www.bcn.cl/leychile/navegar?idNorma=207436',
    resolucion: 'RESOLVED', fecha_recuperacion: '2026-01-15' },
  { cita_raw: 'artículo 60 obliga al empleador', estado: 'AMBIGUOUS',
    gid: null, fuente_url: null, resolucion: 'AMBIGUOUS', fecha_recuperacion: null },
  { cita_raw: 'artículo 9999 del Código del Trabajo', estado: 'UNRESOLVABLE',
    gid: null, fuente_url: null, resolucion: 'UNRESOLVABLE', fecha_recuperacion: null },
]

export function resultadoVerificar(texto) {
  // Cita suelta (etiqueta corta) → resultado de una sola cita.
  const corto = String(texto || '').trim().length < 200
    && /art[ií]culo/i.test(texto || '') && !/\n/.test(texto || '')
  const detalles = corto ? [{
    cita_raw: String(texto).trim(), estado: 'VERIFICADA',
    gid: 'cl.norma.ct:art:0161',
    fuente_url: 'https://www.bcn.cl/leychile/navegar?idNorma=207436',
    resolucion: 'RESOLVED', fecha_recuperacion: '2026-01-15',
  }] : DETALLES_VERIFICAR
  const verificadas = detalles.filter((d) => d.estado === 'VERIFICADA').length
  const fallidas = detalles.length - verificadas
  return {
    veredicto: fallidas ? 'CON_PROBLEMAS' : 'TODAS_VERIFICADAS',
    meta: {
      citas_verificadas: verificadas, total_citas: detalles.length,
      citas_fallidas: fallidas, pack_hash: PACK_HASH, as_of: '2026-01-15',
    },
    detalles,
    no_verificadas: [],
    problemas: [],
  }
}

// ---------------------------------------------------------------------------
// Casos NIF
// ---------------------------------------------------------------------------

export const CASOS_NIF = {
  cases: [
    { case_id: 'causa-despido-1', legal_question: '¿Procede el despido por necesidades de la empresa?',
      created_at: '2026-01-10T10:00:00Z' },
    { case_id: 'causa-cuenta-2', legal_question: '¿Es exigible la cuenta de luz impaga del arrendatario?',
      created_at: '2026-01-11T10:00:00Z' },
    { case_id: 'causa-contrato-3', legal_question: '¿Cláusula de no competencia válida en contrato de servicios?',
      created_at: '2026-01-12T10:00:00Z' },
  ],
}

export function nifDemo(caseId) {
  return {
    snapshot: {
      exists: true,
      version: 3,
      nif: {
        legal_question: '¿Procede el despido por necesidades de la empresa?',
        validated_by_human: false,
        confidence: 0.72,
        facts: {
          known: [
            { label: 'Trabajadora con contrato vigente desde 2021', text: 'contrato desde 2021' },
            { label: 'Despido invocando art. 161 CT', text: 'causal necesidades empresa' },
          ],
          alleged: ['La empresa adujo reestructuración no acreditada'],
          missing: ['RUT de la demandada', 'Fecha exacta de término'],
        },
        subjects: ['Trabajadora (demandante)', 'Empresa XYZ SpA (demandada)'],
        norms: [
          { label: 'Art. 161 CT', verified: true },
          { label: 'Art. 162 CT', verified: true },
          { label: 'Art. 168 CT', verified: false },
        ],
        hypotheses: ['Despido improcedente por falta de prueba de la causal'],
        gaps: ['No hay prueba del envío del aviso a la Inspección del Trabajo'],
        conflicts: [],
        principles: ['Primacía de la realidad', 'Protección del trabajador'],
        deontic_positions: [
          { label: 'Deber de avisar (art. 162)', candidate: 'obligacion' },
          { label: 'Derecho a indemnización (art. 163)', candidate: 'permiso' },
        ],
      },
      patches: [
        { id: 'p1', kind: 'add', section: 'facts.missing', value: 'RUT de la demandada', origin: 'escrito' },
      ],
    },
    patches: { patches: [
      { id: 'p1', kind: 'add', section: 'facts.missing', value: 'RUT de la demandada', origin: 'escrito', status: 'pendiente' },
    ] },
  }
}

// ---------------------------------------------------------------------------
// Grafo 3D / corpus
// ---------------------------------------------------------------------------

export const NORMAS_CORPUS = [
  { leychileCode: '207436', tipo: 'Código del Trabajo', numero: '', anio: '',
    titulo: 'Código del Trabajo', articulos: 160, estado: 'vigente' },
  { leychileCode: '2059', tipo: 'Ley', numero: '21.383', anio: '',
    titulo: 'Aprueba Código Procesal Penal', articulos: 4, estado: 'vigente' },
  { leychileCode: '32853', tipo: 'Ley', numero: '21.459', anio: '',
    titulo: 'Establece normas sobre protección de datos personales', articulos: 14, estado: 'vigente' },
  { leychileCode: '65704', tipo: 'Ley', numero: '20.720', anio: '',
    titulo: 'Regime de protección del consumidor financiero', articulos: 12, estado: 'vigente' },
  { leychileCode: '17428', tipo: 'Código Civil', numero: '', anio: '',
    titulo: 'Código Civil', articulos: 2500, estado: 'vigente' },
  { leychileCode: '6958', tipo: 'Ley', numero: '19.628', anio: '',
    titulo: 'Protección de la vida privada', articulos: 24, estado: 'vigente' },
  { leychileCode: '29229', tipo: 'Ley', numero: '20.066', anio: '',
    titulo: 'Trata de la violencia intrafamiliar', articulos: 18, estado: 'vigente' },
  { leychileCode: '26979', tipo: 'Ley', numero: '21.196', anio: '',
    titulo: 'Interrupción voluntaria del embarazo', articulos: 8, estado: 'vigente' },
]

export const GRAFO_CORPUS = (() => {
  const nodes = []
  const links = []
  const artsPorLey = {
    '207436': ['art_0001', 'art_0161', 'art_0162', 'art_0163', 'art_0168'],
    '2059': ['art_0001', 'art_0002'],
    '32853': ['art_0001', 'art_0002', 'art_0003'],
    '65704': ['art_0001'],
    '17428': ['art_0144', 'art_0145', 'art_0146'],
    '6958': ['art_0001', 'art_0002'],
    '29229': ['art_0001', 'art_0002'],
    '26979': ['art_0001'],
  }
  for (const n of NORMAS_CORPUS) {
    nodes.push({ id: 'i:' + n.leychileCode, tipo: 'instrumento',
      label: n.titulo, n_articulos: n.articulos })
    for (const a of artsPorLey[n.leychileCode] || []) {
      nodes.push({ id: 'a:' + n.leychileCode + ':' + a, tipo: 'articulo',
        label: a.replace('art_', 'art. ') })
      links.push({ source: 'i:' + n.leychileCode, target: 'a:' + n.leychileCode + ':' + a,
        tipo: 'contiene', estado: 'verificada_estructura' })
    }
  }
  // Sentencias y resoluciones para que el grafo tenga los 4 tipos.
  nodes.push({ id: 's:1', tipo: 'sentencia', label: 'Corte Suprema, rol 1234-2024' })
  nodes.push({ id: 'r:1', tipo: 'resolucion', label: 'Resolución 452/2024',
    organismo: 'Corte Suprema', numero: '452', anio: '2024',
    menciones: 3, rca: false })
  links.push({ source: 's:1', target: 'a:207436:art_0161', tipo: 'cita', estado: 'aprobada' })
  links.push({ source: 'r:1', target: 'a:207436:art_0161', tipo: 'menciona', estado: 'candidata' })
  return {
    nodes, links,
    conteos: { nodes: nodes.length, links: links.length },
    truncado: false, fuente: 'corpus', pack_hash: PACK_HASH,
    local_only: false, caminos_demo: [],
  }
})()

export const GRAFO_FUENTES = [
  { id: 'corpus', label: 'Corpus Diké (25 leyes)', disponible: true,
    local_only: false, construido: true },
  { id: 'ambiental', label: 'Ambiental local (solo en este equipo)',
    disponible: false, local_only: true, construido: false },
]

export const BUSQUEDA_CORPUS = {
  rotulo: 'Resultado de búsqueda: es una pista, no una fuente verificada',
  metodo: { motor: 'bm25' },
  resultados: [
    { rank: 1, nodo_id: 'a:207436:art_0161', instrumento: 'i:207436',
      label: 'Código del Trabajo, art. 161', cita: 'artículo 161 del Código del Trabajo',
      canal: 'exacta', score_rel: 0.92, terminos: ['despido', 'necesidades'],
      unidades: [{ etiqueta: 'u03', id: 'a:207436:art_0161#u03' }],
      materias: [{ nodo: 'derecho-laboral', nombre: 'Derecho laboral', relacion: 'ancla' }],
      evidencia: 'la causal de necesidades de la empresa',
      vigencia: { estado: 'IN_FORCE' }, gid: 'cl.norma.ct:art:0161' },
    { rank: 2, nodo_id: 'a:207436:art_0162', instrumento: 'i:207436',
      label: 'Código del Trabajo, art. 162', cita: 'artículo 162 del Código del Trabajo',
      canal: 'exacta', score_rel: 0.81, terminos: ['aviso', 'anticipación'],
      unidades: [], materias: [{ nodo: 'derecho-laboral', nombre: 'Derecho laboral', relacion: 'territorio' }],
      evidencia: 'aviso con copia a la Inspección del Trabajo',
      vigencia: { estado: 'IN_FORCE' }, gid: 'cl.norma.ct:art:0162' },
    { rank: 3, nodo_id: 'a:17428:art_0144', instrumento: 'i:17428',
      label: 'Código Civil, art. 144', cita: 'artículo 144 del Código Civil',
      canal: 'parcial', score_rel: 0.44, terminos: ['obligación'],
      unidades: [], materias: [],
      evidencia: null, cita_motivo: 'sin número de ley en el texto',
      vigencia: { estado: 'OUT_OF_FORCE', motivo: 'SUPERSEDED_VERSION' },
      gid: 'cl.norma.cc:art:0144' },
  ],
  arbol: {
    disponible: true, clara: true,
    clasificacion: [
      { nodo: 'derecho-laboral', nombre: 'Derecho laboral', score: 8.4,
        cobertura: 0.83, terminos: ['despido', 'trabajador', 'contrato'] },
      { nodo: 'derecho-civil', nombre: 'Derecho civil', score: 2.1,
        cobertura: 0.2, terminos: ['obligación'] },
    ],
  },
}

export const NODO_DETALLE = {
  id: 'a:207436:art_0161', tipo: 'articulo', label: 'art. 161',
  titulo: 'Necesidades de la empresa',
  vigencia: { estado: 'IN_FORCE' },
  url: 'https://www.bcn.cl/leychile/navegar?idNorma=207436',
  sha256: 'a1b2c3d4e5f6' + '0'.repeat(52),
}

export const UNIDAD_DETALLE = {
  id: 'a:207436:art_0161#u03',
  texto: 'Son necesidades de la empresa las que deriven de las circunstancias de la empresa, establecimiento o servicio.',
  char_start: 120, char_end: 230,
  sha256: 'f'.repeat(64), articulo_sha256: 'a1b2c3d4e5f6' + '0'.repeat(52),
  articulo_url: 'https://www.bcn.cl/leychile/navegar?idNorma=207436',
}

export const TEXTO_ARTICULO = {
  resolucion: 'RESOLVED', nodo_id: 'a:207436:art_0161', articulo: 'art. 161',
  pack_hash: PACK_HASH,
  texto: 'Artículo 161. Son necesidades de la empresa las que deriven de las circunstancias de la empresa, establecimiento o servicio. En caso de terminación de contrato de trabajo por esta causal, el empleador deberá acreditar la situación que la motiva.',
  unidades: [
    { id: 'a:207436:art_0161#u01', etiqueta: 'u01', inicio: 0, fin: 60, modalidad: 'definicion', clase: 'normativa' },
    { id: 'a:207436:art_0161#u02', etiqueta: 'u02', inicio: 61, fin: 160, modalidad: 'obligacion', clase: 'normativa' },
  ],
  norma: { nombre_corto: 'Código del Trabajo' },
  fuente_url: 'https://www.bcn.cl/leychile/navegar?idNorma=207436',
}

// ---------------------------------------------------------------------------
// Estilo / privacidad / predicción / ordenamientos / preferencias
// ---------------------------------------------------------------------------

export const ANALISIS_ESTILO = {
  score: 78,
  global_stats: {
    total_sentences: 6, sentences_exceeding_limit: 1,
    avg_sentence_length: 22, passive_voices: 2,
    nominalizations: 3, archaisms: 1,
  },
  suggestions: [
    { category: 'long_sentence', term: 'oración larga',
      replacement: 'divide la oración', message: 'La oración PRIMERO supera el límite recomendado.' },
    { category: 'archaism', term: 'hubiere', replacement: 'haya',
      message: 'Forma verbal arcaica detectada.' },
  ],
  sentences: [
    { text: 'La demandada puso término a mi contrato invocando la causal de necesidades de la empresa del artículo 161 del Código del Trabajo.',
      word_count: 24, exceeds_limit: true, is_passive: false,
      nominalizations: 1, archaisms: 0 },
  ],
  coherence_warnings: ['El escrito alterna registro formal e informal.'],
}

export const GRAFO_ESTILO = {
  nodes: [
    { id: 'n1', node_type: 'claim', text: 'Despido improcedente', paragraph_index: 0, markers_found: [] },
    { id: 'n2', node_type: 'premise', text: 'Art. 161 CT exige prueba', paragraph_index: 1, markers_found: [] },
    { id: 'n3', node_type: 'conclusion', text: 'Corresponde indemnización', paragraph_index: 3, markers_found: [] },
  ],
  edges: [
    { source_id: 'n2', target_id: 'n1', relation_type: 'supports' },
    { source_id: 'n1', target_id: 'n3', relation_type: 'leads_to' },
  ],
  counts: { hecho: 1, norma: 1, prueba: 0, conclusion: 1, orphan: 0 },
  coverage_ratio: 0.82,
  has_complete_chain: true,
  coherence_warnings: [],
  // /estilo/grafo puede llevar truncado + relaciones_omitidas en escritos largos.
  truncado: false, relaciones_omitidas: 0,
}

export const PRIVACIDAD_DETECTAR = {
  entidades: [
    { valor: '11.111.111-1', tipo: 'rut', inicio: 10, fin: 21,
      accion: 'enmascarar', severidad: 'high', motivo: 'identificador personal' },
    { valor: 'María José Pérez González', tipo: 'nombre', inicio: 30, fin: 52,
      accion: 'enmascarar', severidad: 'medium', motivo: 'nombre propio' },
    { valor: 'Av. Libertador Bernardo O\'Higgins 1234', tipo: 'direccion', inicio: 60, fin: 95,
      accion: 'enmascarar', severidad: 'medium', motivo: 'dirección' },
    { valor: 'el demandante', tipo: 'referencia', inicio: 100, fin: 114,
      accion: 'conservar', severidad: 'low', motivo: 'referencia genérica' },
  ],
  candidatos: [{ valor: 'Testigo Uno', tipo: 'posible_persona', inicio: 120, fin: 131 }],
  conteos: { rut: 1, nombre: 1, direccion: 1, referencia: 1, posible_persona: 1 },
  estrategia: 'media',
  aviso: 'Seudonimización local: los datos no salen del equipo.',
  version: '0.9.0',
  paquetes: { personas: 3, ruts: 1 },
}

export const PREDICCION_CORPUS = {
  continuacion: ' la empresa deberá acreditar la causal con antecedentes fehacientes.',
  ancla: 'necesidades de la empresa',
  gid: 'cl.norma.ct:art:0161',
  sha256: 'b'.repeat(64),
  fuente_url: 'https://www.bcn.cl/leychile/navegar?idNorma=207436',
}

export const ORDENAMIENTOS_PERFILES = {
  perfiles: [
    // tipos_norma llega como objetos {id, etiqueta} desde el backend real.
    { id: 'cl', jurisdiccion: 'cl', nombre: 'Chile', idioma: 'es',
      version: '1.0.0', origen: 'dike', valido: true, errores: [],
      tipos_norma: [
        { id: 'ley', etiqueta: 'Ley' },
        { id: 'decreto', etiqueta: 'Decreto' },
      ], perfil: {} },
  ],
  ejemplo_xx: { paquete: 'xx-1.0.0', textos: { ordenamiento: 'Texto de ejemplo.' } },
}

export const PREFERENCIAS_DEFAULT = {
  tema_papel: 'clasico', ancho_hoja: 'a4',
  estrategia_privacidad: 'media', contexto_estilo: 'escrito',
}

export const CONSTRUCCION_OK = {
  ok: true, etapa: 'fin', errores: [],
  construccion: {
    normas: 8, articulos: 37, aristas: 52,
    ventanasVigencia: 12, manifestCoreSha256: 'c'.repeat(64),
    packId: 'dike-pack-1.0.0', jurisdiccion: 'cl',
  },
  compatibilidad: { nivelAlcanzado: 'completo' },
}
