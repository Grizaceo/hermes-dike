// L0 determinista — port de legalCopilot.ts (lexo-case-writer @ 7c13a89, MIT).
// Solo lo que el escrito sostiene como encabezado/acción del numerus clausus:
// formalismos procesales y acciones con sus fundamentos típicos (ubicación
// normativa, nunca texto legal ni vigencia afirmada). Sin config ni
// aprendizaje: catálogo estático, umbral de dominancia fijo.
// Procedencia registrada en VENDORED.json.

const UMBRAL_DOMINANCIA = 0.4
const BONO_INICIO_DOC = 0.5
const SCORE_MINIMO = 1.5
const LARGO_PREFIJO_NOMBRE = 10
const PALABRAS_ENUNCIADO = 4
const VENTANA_DISPARADOR = 4

const CODE_SHORT = {
  codigo_civil: 'Código Civil', cpc: 'CPC',
  codigo_trabajo: 'Código del Trabajo', constitucion: 'Constitución',
  codigo_penal: 'Código Penal', cpp: 'CPP', cot: 'COT',
  ley_19880: 'Ley N° 19.880',
}
const CODE_NOMBRE = {
  codigo_civil: 'Código Civil', cpc: 'Código de Procedimiento Civil',
  codigo_trabajo: 'Código del Trabajo',
  constitucion: 'Constitución Política de la República',
  codigo_penal: 'Código Penal', cpp: 'Código Procesal Penal',
  cot: 'Código Orgánico de Tribunales', ley_19880: 'Ley N° 19.880',
}
const CODE_FEMENINO = new Set(['constitucion', 'ley_19880'])
function conPreposicion(code) {
  const nombre = CODE_NOMBRE[code] || CODE_SHORT[code] || code
  return CODE_FEMENINO.has(code) ? 'de la ' + nombre : 'del ' + nombre
}
function refCanonica(code, num) {
  return 'Artículo ' + num + ' ' + conPreposicion(code)
}

const norm = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/\s+/g, ' ').trim()
const normClave = norm
const SEPARADORES_SEGMENTO = /[:;]/g

// Tramo en curso: lo escrito después del último ':' o ';' del párrafo.
export function segmentoActual(texto) {
  SEPARADORES_SEGMENTO.lastIndex = 0
  let corte = 0
  for (let m = SEPARADORES_SEGMENTO.exec(texto); m;
    m = SEPARADORES_SEGMENTO.exec(texto)) {
    corte = m.index + m[0].length
  }
  return texto.slice(corte)
}

const DISPARADORES_PROCESALES = [
  'demanda', 'demando', 'demandar', 'deduzco', 'deducir', 'interpongo',
  'interponer', 'recurso', 'recurro', 'excepcion', 'opongo', 'oponer',
  'accion', 'denuncia', 'denuncio', 'querella', 'querello', 'solicito',
  'tutela', 'vengo en', 'en lo principal', 'otrosi', 'tipo penal',
]

function contieneClave(texto, clave) {
  let desde = 0
  for (;;) {
    const i = texto.indexOf(clave, desde)
    if (i < 0) return false
    const antes = i === 0 ? ' ' : texto[i - 1]
    const despues = i + clave.length >= texto.length
      ? ' ' : texto[i + clave.length]
    if (!/[a-z0-9]/.test(antes) && !/[a-z0-9]/.test(despues)) return true
    desde = i + 1
  }
}

const palabrasDe = (t) => t.split(/[^a-z0-9]+/).filter(Boolean)

const frasesCache = new Map()
function fraseFija(bruto) {
  let v = frasesCache.get(bruto)
  if (!v) {
    const texto = normClave(bruto)
    v = { texto, palabras: palabrasDe(texto) }
    frasesCache.set(bruto, v)
  }
  return v
}

function indicesDeFrase(palabras, frase) {
  const out = []
  for (let i = 0; i + frase.length <= palabras.length; i++) {
    let ok = true
    for (let k = 0; k < frase.length; k++) {
      if (palabras[i + k] !== frase[k]) { ok = false; break }
    }
    if (ok) out.push(i)
  }
  return out
}

function distanciaPalabras(a, la, b, lb) {
  if (a >= b + lb) return a - (b + lb)
  if (b >= a + la) return b - (a + la)
  return 0
}

// Sufijo del texto canónico que falta por teclear, alineado carácter a
// carácter (lo ya escrito nunca se reescribe; espacios se absorben).
export function sufijoPendiente(completo, tecleado) {
  const c = completo.normalize('NFC')
  const t = tecleado.normalize('NFC')
  let i = 0
  let j = 0
  while (j < t.length) {
    if (/\s/.test(t[j])) {
      if (i < c.length && /\s/.test(c[i])) i++
      j++
      continue
    }
    if (i >= c.length) return ''
    if (/\s/.test(c[i])) { i++; continue }
    i++
    j++
  }
  return c.slice(i)
}

// Texto a insertar: el sufijo pendiente si ya se empezó, el texto íntegro si
// no solapa con nada de lo escrito.
export function textoAInsertar(canonico, tramo) {
  const q = norm(tramo)
  if (!q) return canonico
  if (norm(canonico).startsWith(q)) return sufijoPendiente(canonico, tramo)
  return canonico
}

// clave genérica: {texto, generica:true} — la réplica de g() del original.
const g = (texto) => ({ texto, generica: true })
const textoClave = (c) => (typeof c === 'string' ? c : c.texto)
const esGenerica = (c) => typeof c !== 'string'

const FORMALISMO = [
  {
    id: "formal-en-lo-principal",
    label: "En lo principal",
    cierre: ": ",
    description: "Encabezado de la petición principal",
  },
  {
    id: "formal-en-lo-subsidiario",
    label: "En lo subsidiario",
    cierre: ": ",
    description: "Petición subsidiaria a la principal",
  },
  {
    id: "formal-primer-otrosi",
    label: "Primer otrosí",
    cierre: ": ",
    description: "Primera petición accesoria",
  },
  {
    id: "formal-segundo-otrosi",
    label: "Segundo otrosí",
    cierre: ": ",
    description: "Segunda petición accesoria",
  },
  {
    id: "formal-tercer-otrosi",
    label: "Tercer otrosí",
    cierre: ": ",
    description: "Tercera petición accesoria",
  },
  {
    id: "formal-otrosi",
    label: "Otrosí",
    cierre: ": ",
    description: "Petición accesoria genérica",
  },
  {
    id: "formal-por-tanto",
    label: "Por tanto",
    cierre: ": ",
    description: "Cierre de la petición",
  },
  {
    id: "formal-sirvase",
    label: "Sírvase S.S.",
    cierre: " ",
    description: "Fórmula de petición al tribunal",
  },
  {
    id: "formal-pido-a-ss",
    label: "Pido a S.S.",
    cierre: " ",
    description: "Fórmula de petición al tribunal",
  },
  {
    id: "formal-que-tenga-a-bien",
    label: "Que tenga a bien",
    cierre: " ",
    description: "Fórmula de petición al tribunal",
  },
  {
    id: "formal-por-tanto-ruego",
    label: "Por tanto, ruego a S.S.",
    cierre: " ",
    description: "Cierre de petición formal",
  },
  {
    id: "formal-individualizacion",
    label: "Individualización de las partes",
    cierre: "",
    description: "Preludio que individualiza a las partes",
    plantilla:
      "Que vengo en deducir la presente acción en contra de [NOMBRE], [RUT], [DOMICILIO], [PROFESIÓN U OFICIO], todos de mi representación, en virtud de los antecedentes de hecho y de derecho que paso a exponer:",
  },
  {
    id: "formal-comparecencia",
    label: "Comparecencia",
    cierre: "",
    description: "Fórmula de comparecencia",
    plantilla: "Que, en mi calidad de [ROL], vengo en comparecer ante S.S. y exponer:",
  },
];
const ACCIONES = [
  {
    id: "accion-indemnizacion-perjuicios",
    nombre: "Demanda de indemnización de perjuicios",
    claves: [g("indemnizacion"), g("perjuicio"), g("perjuicios"), g("daño"), g("daños")],
    area: "civil",
    fundamentos: [
      { codigo: "codigo_civil", articulo: "2314", institucion: "Responsabilidad extracontractual" },
      { codigo: "codigo_civil", articulo: "2329", institucion: "Responsabilidad por daño causado" },
      { codigo: "codigo_civil", articulo: "1556", institucion: "Indemnización contractual: daño emergente y lucro cesante" },
      { codigo: "codigo_civil", articulo: "1557", institucion: "Mora como requisito de la indemnización" },
      { codigo: "codigo_civil", articulo: "1558", institucion: "Extensión del daño según haya dolo o culpa" },
    ],
  },
  {
    id: "accion-restitucion",
    nombre: "Demanda de restitución",
    claves: [g("restitucion"), g("restituir"), g("devolucion"), g("entrega")],
    area: "civil",
    fundamentos: [
      { codigo: "constitucion", articulo: "19 N°24", institucion: "Derecho de propiedad" },
      { codigo: "codigo_civil", articulo: "889", institucion: "Acción reivindicatoria" },
      { codigo: "codigo_civil", articulo: "582", institucion: "Dominio" },
      { codigo: "codigo_civil", articulo: "700", institucion: "Posesión" },
      { codigo: "codigo_civil", articulo: "2195", institucion: "Precario" },
    ],
  },
  {
    id: "accion-reivindicatoria",
    nombre: "Demanda reivindicatoria",
    claves: ["reivindicatoria", g("reivindicacion"), g("reivindicar")],
    area: "civil",
    fundamentos: [
      { codigo: "codigo_civil", articulo: "889", institucion: "Acción reivindicatoria" },
      { codigo: "codigo_civil", articulo: "582", institucion: "Dominio" },
      { codigo: "codigo_civil", articulo: "700", institucion: "Posesión" },
      { codigo: "codigo_civil", articulo: "893", institucion: "Legitimación activa del dueño" },
    ],
  },
  {
    id: "accion-peticion-herencia",
    nombre: "Demanda de petición de herencia",
    claves: [g("herencia"), "peticion de herencia", g("sucesion")],
    area: "civil",
    fundamentos: [
      { codigo: "codigo_civil", articulo: "1264", institucion: "Acción de petición de herencia" },
      { codigo: "codigo_civil", articulo: "1265", institucion: "Extensión a los aumentos de la herencia" },
      { codigo: "codigo_civil", articulo: "1269", institucion: "Prescripción de la acción" },
    ],
  },
  {
    id: "accion-resolucion-contrato",
    nombre: "Demanda de resolución de contrato",
    claves: [g("resolucion"), g("resolver"), g("incumplimiento"), "termino de contrato"],
    area: "civil",
    fundamentos: [
      { codigo: "codigo_civil", articulo: "1489", institucion: "Condición resolutoria tácita" },
      { codigo: "codigo_civil", articulo: "1545", institucion: "Ley del contrato" },
      { codigo: "codigo_civil", articulo: "1546", institucion: "Buena fe contractual" },
      { codigo: "codigo_civil", articulo: "1552", institucion: "Excepción de contrato no cumplido" },
    ],
  },
  {
    id: "accion-nulidad",
    nombre: "Demanda de nulidad absoluta",
    claves: [g("nulidad"), g("nulo"), g("anulacion"), "objeto ilicito"],
    area: "civil",
    fundamentos: [
      { codigo: "codigo_civil", articulo: "1681", institucion: "Nulidad: concepto y bipartición" },
      { codigo: "codigo_civil", articulo: "1682", institucion: "Causales de nulidad absoluta" },
      { codigo: "codigo_civil", articulo: "1683", institucion: "Quiénes pueden alegar la nulidad absoluta" },
      { codigo: "codigo_civil", articulo: "1687", institucion: "Efectos de la nulidad judicialmente declarada" },
    ],
  },
  {
    id: "accion-despido-injustificado",
    nombre: "Demanda por despido injustificado, indebido o improcedente",
    claves: [g("despido"), "despido injustificado", "despido arbitrario", "termino de relacion laboral"],
    area: "laboral",
    fundamentos: [
      { codigo: "codigo_trabajo", articulo: "168", institucion: "Acción por despido injustificado, indebido o improcedente" },
      { codigo: "codigo_trabajo", articulo: "160", institucion: "Causales de caducidad sin derecho a indemnización" },
      { codigo: "codigo_trabajo", articulo: "162", institucion: "Aviso de término y cotizaciones previsionales" },
      { codigo: "codigo_trabajo", articulo: "163", institucion: "Indemnización por años de servicio" },
    ],
  },
  {
    id: "accion-tutela-laboral",
    nombre: "Denuncia de tutela laboral",
    claves: [g("tutela"), "tutela laboral", "garantias fundamentales", "acoso laboral"],
    area: "laboral",
    fundamentos: [
      { codigo: "codigo_trabajo", articulo: "485", institucion: "Procedimiento de tutela de derechos fundamentales" },
      { codigo: "codigo_trabajo", articulo: "493", institucion: "Prueba indiciaria: carga del denunciado" },
      { codigo: "codigo_trabajo", articulo: "489", institucion: "Tutela por despido vulneratorio" },
      { codigo: "constitucion", articulo: "19 N°1", institucion: "Integridad física y psíquica" },
    ],
  },
  {
    id: "recurso-proteccion",
    nombre: "Recurso de protección",
    claves: [g("proteccion"), "recurso de proteccion", "garantias constitucionales"],
    area: "constitucional",
    fundamentos: [
      { codigo: "constitucion", articulo: "20", institucion: "Recurso de protección" },
      { codigo: "constitucion", articulo: "19 N°24", institucion: "Derecho de propiedad" },
    ],
  },
  {
    id: "recurso-apelacion",
    nombre: "Recurso de apelación",
    claves: [g("apelacion"), g("apelar")],
    area: "procesal",
    fundamentos: [
      { codigo: "cpc", articulo: "186", institucion: "Recurso de apelación: objeto" },
      { codigo: "cpc", articulo: "187", institucion: "Resoluciones apelables" },
      { codigo: "cpc", articulo: "189", institucion: "Plazo y forma de interposición" },
    ],
  },
  {
    id: "recurso-reposicion",
    nombre: "Recurso de reposición",
    claves: [g("reposicion"), g("reponer")],
    area: "procesal",
    fundamentos: [
      { codigo: "cpc", articulo: "181", institucion: "Reposición contra autos y decretos" },
    ],
  },
  {
    id: "recurso-queja",
    nombre: "Recurso de queja",
    claves: [g("queja"), "recurso de queja", "falta o abuso"],
    area: "procesal",
    fundamentos: [
      { codigo: "cot", articulo: "545", institucion: "Recurso de queja: faltas o abusos graves" },
    ],
  },
  {
    id: "recurso-nulidad-penal",
    nombre: "Recurso de nulidad (penal)",
    claves: ["nulidad penal", "recurso de nulidad", "anular el juicio", "vicio del juicio"],
    area: "penal",
    fundamentos: [
      { codigo: "cpp", articulo: "372", institucion: "Recurso de nulidad: objeto" },
      { codigo: "cpp", articulo: "373", institucion: "Causales del recurso de nulidad" },
      { codigo: "cpp", articulo: "374", institucion: "Motivos absolutos de nulidad" },
    ],
  },
  {
    id: "accion-pauliana",
    nombre: "Acción pauliana (revocatoria)",
    claves: ["pauliana", "revocatoria", g("fraude"), "fraudatoria", "accion pauliana"],
    area: "civil",
    fundamentos: [
      { codigo: "codigo_civil", articulo: "2468", institucion: "Acción pauliana o revocatoria" },
    ],
  },
  {
    id: "accion-interdicto",
    nombre: "Interdicto (posesorio)",
    claves: ["interdicto", "interdictos", "posesorio", "perturbacion de la posesion"],
    area: "civil",
    fundamentos: [
      { codigo: "codigo_civil", articulo: "916", institucion: "Objeto de las acciones posesorias" },
      { codigo: "codigo_civil", articulo: "918", institucion: "Posesión útil para accionar" },
      { codigo: "codigo_civil", articulo: "920", institucion: "Prescripción de las acciones posesorias" },
    ],
  },
  {
    id: "accion-particion",
    nombre: "Demanda de partición",
    claves: [g("particion"), g("dividir"), "liquidacion de comunidad"],
    area: "civil",
    fundamentos: [
      { codigo: "codigo_civil", articulo: "1317", institucion: "Acción de partición: imprescriptible e irrenunciable" },
      { codigo: "cot", articulo: "227", institucion: "Arbitraje forzoso en la partición de bienes" },
    ],
  },
  {
    id: "accion-nulidad-despido",
    nombre: "Demanda de nulidad de despido",
    claves: ["nulidad de despido", "nulidad del despido", "despido nulo"],
    area: "laboral",
    fundamentos: [
      { codigo: "codigo_trabajo", articulo: "162", institucion: "Nulidad del despido por cotizaciones impagas (Ley Bustos)" },
      { codigo: "codigo_trabajo", articulo: "177", institucion: "Convalidación del despido" },
    ],
  },
  {
    id: "excepcion-incompetencia",
    nombre: "Excepción de incompetencia",
    claves: [g("incompetencia"), g("incompetente"), "excepcion de incompetencia"],
    area: "procesal",
    fundamentos: [
      { codigo: "cpc", articulo: "303", institucion: "Excepciones dilatorias admisibles" },
      { codigo: "cpc", articulo: "305", institucion: "Oportunidad para oponerlas" },
    ],
  },
  {
    id: "excepcion-litispendencia",
    nombre: "Excepción de litispendencia",
    claves: ["litispendencia", "litis pendencia", "misma causa", "mismo asunto"],
    area: "procesal",
    fundamentos: [
      { codigo: "cpc", articulo: "303", institucion: "Excepciones dilatorias admisibles" },
      { codigo: "cpc", articulo: "305", institucion: "Oportunidad para oponerlas" },
    ],
  },
  {
    id: "excepcion-cosa-juzgada",
    nombre: "Excepción de cosa juzgada",
    claves: ["cosa juzgada", "autoridad de cosa juzgada", "excepcion de cosa juzgada"],
    area: "procesal",
    fundamentos: [
      { codigo: "cpc", articulo: "175", institucion: "Cosa juzgada: acción y excepción" },
      { codigo: "cpc", articulo: "177", institucion: "Triple identidad y legitimación" },
    ],
  },
  {
    id: "excepcion-prescripcion",
    nombre: "Excepción de prescripción",
    claves: [g("prescripcion"), g("prescribir"), "excepcion de prescripcion"],
    area: "civil",
    fundamentos: [
      { codigo: "codigo_civil", articulo: "2492", institucion: "Prescripción: concepto" },
      { codigo: "codigo_civil", articulo: "2493", institucion: "La prescripción debe ser alegada" },
      { codigo: "codigo_civil", articulo: "2514", institucion: "Prescripción extintiva: cómputo" },
      { codigo: "codigo_civil", articulo: "2515", institucion: "Plazos de la prescripción extintiva" },
    ],
  },
  {
    id: "excepcion-pago",
    nombre: "Excepción de pago",
    claves: [g("pago"), "excepcion de pago", "pago efectivo", "pago de la obligacion"],
    area: "civil",
    fundamentos: [
      { codigo: "codigo_civil", articulo: "1568", institucion: "Pago efectivo" },
      { codigo: "codigo_civil", articulo: "1698", institucion: "Carga de la prueba de la extinción" },
    ],
  },
  {
    id: "excepcion-nulidad-contrato",
    nombre: "Excepción de nulidad del contrato",
    claves: ["nulidad del contrato", "nulidad contractual", "excepcion de nulidad"],
    area: "civil",
    fundamentos: [
      { codigo: "codigo_civil", articulo: "1681", institucion: "Nulidad: concepto y bipartición" },
      { codigo: "codigo_civil", articulo: "1682", institucion: "Causales de nulidad absoluta" },
      { codigo: "codigo_civil", articulo: "1683", institucion: "Quiénes pueden alegar la nulidad absoluta" },
    ],
  },
  {
    id: "accion-nulidad-relativa",
    nombre: "Demanda de nulidad relativa",
    claves: ["nulidad relativa", "anulabilidad", "vicio del consentimiento", g("error"), g("fuerza"), g("dolo")],
    area: "civil",
    fundamentos: [
      { codigo: "codigo_civil", articulo: "1682", institucion: "Nulidad absoluta y, residualmente, relativa" },
      { codigo: "codigo_civil", articulo: "1684", institucion: "Nulidad relativa: legitimación y saneamiento" },
      { codigo: "codigo_civil", articulo: "1451", institucion: "Vicios del consentimiento" },
      { codigo: "codigo_civil", articulo: "1691", institucion: "Cuadrienio para pedir la rescisión" },
    ],
  },
  {
    id: "accion-jactancia",
    nombre: "Acción de jactancia",
    claves: ["jactancia", g("jactarse"), "accion de jactancia"],
    area: "civil",
    fundamentos: [
      { codigo: "cpc", articulo: "269", institucion: "Acción de jactancia" },
      { codigo: "cpc", articulo: "270", institucion: "Qué se entiende por jactancia" },
    ],
  },
  {
    id: "recurso-rectificacion",
    nombre: "Recurso de aclaración, rectificación o enmienda",
    claves: [g("rectificacion"), g("aclaracion"), g("enmienda"), "aclarar la sentencia"],
    area: "procesal",
    fundamentos: [
      { codigo: "cpc", articulo: "182", institucion: "Desasimiento del tribunal; aclaración, rectificación y enmienda" },
    ],
  },
  {
    id: "recurso-casacion-forma",
    nombre: "Recurso de casación en la forma",
    claves: ["casacion en la forma", "vicio de forma"],
    area: "procesal",
    fundamentos: [
      { codigo: "cpc", articulo: "766", institucion: "Casación en la forma: procedencia" },
      { codigo: "cpc", articulo: "768", institucion: "Causales taxativas de casación en la forma" },
    ],
  },
  {
    id: "recurso-casacion-fondo",
    nombre: "Recurso de casación en el fondo",
    claves: ["casacion en el fondo", "infraccion de ley"],
    area: "procesal",
    fundamentos: [
      { codigo: "cpc", articulo: "767", institucion: "Casación en el fondo: infracción de ley" },
    ],
  },
  {
    id: "recurso-hecho",
    nombre: "Recurso de hecho",
    claves: ["recurso de hecho", "denegada la apelacion"],
    area: "procesal",
    fundamentos: [
      { codigo: "cpc", articulo: "203", institucion: "Recurso de hecho por apelación denegada" },
      { codigo: "cpc", articulo: "196", institucion: "Apelación concedida en un efecto que no corresponde" },
    ],
  },
  {
    id: "recurso-reposicion-apelacion-subsidiaria",
    nombre: "Recurso de reposición con apelación en subsidio",
    claves: ["reposicion con apelacion subsidiaria", "apelacion subsidiaria"],
    area: "procesal",
    fundamentos: [
      { codigo: "cpc", articulo: "181", institucion: "Reposición contra autos y decretos" },
      { codigo: "cpc", articulo: "189", institucion: "Apelación deducida en subsidio de la reposición" },
    ],
  },
  {
    id: "recurso-unificacion-jurisprudencia",
    nombre: "Recurso de unificación de jurisprudencia",
    claves: ["unificacion de jurisprudencia", "unificar jurisprudencia"],
    area: "laboral",
    fundamentos: [
      { codigo: "codigo_trabajo", articulo: "483", institucion: "Unificación de jurisprudencia: procedencia" },
    ],
  },
  {
    id: "recurso-administrativo-reposicion",
    nombre: "Recurso administrativo de reposición",
    claves: ["reposicion administrativa", "recurso de reposicion administrativo"],
    area: "administrativo",
    fundamentos: [
      { codigo: "ley_19880", articulo: "59", institucion: "Reposición y jerárquico: procedencia y plazo" },
    ],
  },
  {
    id: "recurso-administrativo-jerarquico",
    nombre: "Recurso administrativo jerárquico",
    claves: ["recurso jerarquico", g("jerarquico")],
    area: "administrativo",
    fundamentos: [
      { codigo: "ley_19880", articulo: "59", institucion: "Reposición y jerárquico: procedencia y plazo" },
    ],
  },
  {
    id: "recurso-administrativo-revision",
    nombre: "Recurso administrativo de revisión",
    claves: ["revision administrativa", "recurso de revision"],
    area: "administrativo",
    fundamentos: [
      { codigo: "ley_19880", articulo: "60", institucion: "Recurso extraordinario de revisión" },
    ],
  },
  {
    id: "tipo-penal-homicidio",
    nombre: "Tipo penal: homicidio",
    claves: ["homicidio", g("matar"), "muerte de una persona", "dar muerte"],
    area: "penal",
    fundamentos: [
      { codigo: "codigo_penal", articulo: "391", institucion: "Homicidio simple y calificado" },
    ],
  },
  {
    id: "tipo-penal-hurto",
    nombre: "Tipo penal: hurto",
    claves: [g("hurto"), "apoderarse", "cosa mueble ajena", "sin violencia"],
    area: "penal",
    fundamentos: [
      { codigo: "codigo_penal", articulo: "432", institucion: "Definición de hurto y robo" },
      { codigo: "codigo_penal", articulo: "446", institucion: "Penalidad del hurto según el valor" },
    ],
  },
  {
    id: "tipo-penal-robo",
    nombre: "Tipo penal: robo",
    claves: [g("robo"), "con violencia", "con intimidacion", "con fuerza en las cosas"],
    area: "penal",
    fundamentos: [
      { codigo: "codigo_penal", articulo: "432", institucion: "Definición de hurto y robo" },
      { codigo: "codigo_penal", articulo: "436", institucion: "Robo con violencia o intimidación" },
    ],
  },
  {
    id: "tipo-penal-estafa",
    nombre: "Tipo penal: estafa",
    claves: [g("estafa"), "defraudar", "engaño", "perjuicio patrimonial"],
    area: "penal",
    fundamentos: [
      { codigo: "codigo_penal", articulo: "468", institucion: "Estafa por engaño" },
      { codigo: "codigo_penal", articulo: "473", institucion: "Defraudación residual" },
    ],
  },
];

const SIN_PREDICCION = { ghost: null, ghostTexto: '', opciones: [], ambiguo: false }

// Predicción por prefijo del encabezado procesal. Devuelve el ghost
// inequívoco, o las opciones cuando hay ambigüedad.
export function predictFormalismo(prefijo, { alInicioDoc = false } = {}) {
  const tramo = segmentoActual(prefijo)
  const q = norm(tramo)
  if (!q) return SIN_PREDICCION
  const scored = []
  for (const f of FORMALISMO) {
    if (f.plantilla) continue
    if (!norm(f.label).startsWith(q)) continue
    let score = 1.0
    if (alInicioDoc && f.id === 'formal-en-lo-principal') score += BONO_INICIO_DOC
    scored.push({ f, score })
  }
  if (!scored.length) return SIN_PREDICCION
  scored.sort((a, b) => b.score - a.score || a.f.id.localeCompare(b.f.id))
  const top = scored[0]
  const gap = top.score - ((scored[1] && scored[1].score) || 0)
  if (gap >= UMBRAL_DOMINANCIA) {
    const item = { id: top.f.id, label: top.f.label,
      insert: { texto: top.f.label + top.f.cierre },
      description: top.f.description }
    const ghostTexto = sufijoPendiente(item.insert.texto, tramo)
    if (!ghostTexto) return SIN_PREDICCION
    return { ghost: item, ghostTexto, opciones: [], ambiguo: false }
  }
  return { ghost: null, ghostTexto: '', ambiguo: true,
    opciones: scored.slice(0, 8).map((s) => ({ id: s.f.id,
      label: s.f.label, insert: { texto: s.f.label + s.f.cierre },
      description: s.f.description })) }
}

function puntuarAcciones(texto) {
  const t = normClave(segmentoActual(texto))
  if (!t) return []
  const palabras = palabrasDe(t)
  const enunciado = palabras.length <= PALABRAS_ENUNCIADO
  const disparadores = []
  if (!enunciado) {
    for (const d of DISPARADORES_PROCESALES) {
      const { palabras: frase } = fraseFija(d)
      if (!frase.length) continue
      for (const i of indicesDeFrase(palabras, frase)) {
        disparadores.push([i, frase.length])
      }
    }
    if (!disparadores.length) return []
  }
  const habilitada = (inicio, largo) => enunciado ||
    disparadores.some(([d, m]) =>
      distanciaPalabras(inicio, largo, d, m) <= VENTANA_DISPARADOR)
  const out = []
  for (const accion of ACCIONES) {
    const { texto: nombre, palabras: nombrePalabras } = fraseFija(accion.nombre)
    let score = 0
    if (t.length >= LARGO_PREFIJO_NOMBRE && nombre.startsWith(t)) score += 3
    if (contieneClave(t, nombre)) score += nombrePalabras.length * 2
    for (const clave of accion.claves) {
      const { texto: c, palabras: frase } = fraseFija(textoClave(clave))
      if (!contieneClave(t, c)) continue
      const apariciones = indicesDeFrase(palabras, frase)
      if (!apariciones.some((i) => habilitada(i, frase.length))) continue
      score += esGenerica(clave) ? 0.5 : frase.length * 2
    }
    if (score > 0) out.push({ accion, score })
  }
  out.sort((a, b) => b.score - a.score || a.accion.id.localeCompare(b.accion.id))
  return out
}

const SIN_CONTENIDO = { accion: null, accionGhostTexto: '', fundamentos: [],
  ambiguo: false, opciones: [] }

// Predicción de acción procesal + fundamentos típicos (ubicación normativa,
// nunca texto legal). Los fundamentos se rotulan con procedencia 'norma'.
export function predictContenidoJuridico(texto) {
  const candidatas = puntuarAcciones(texto)
  const top = candidatas[0]
  if (!top || top.score < SCORE_MINIMO) return SIN_CONTENIDO
  const segunda = candidatas[1]
  if (segunda && top.score - segunda.score < UMBRAL_DOMINANCIA) {
    return { ...SIN_CONTENIDO, ambiguo: true,
      opciones: candidatas
        .filter((c) => top.score - c.score < UMBRAL_DOMINANCIA).slice(0, 6)
        .map((c) => ({ id: c.accion.id, label: c.accion.nombre })) }
  }
  const accion = top.accion
  const segmento = segmentoActual(texto)
  const accionGhostTexto = normClave(accion.nombre)
    .startsWith(normClave(segmento))
    ? sufijoPendiente(accion.nombre, segmento) : ''
  return {
    accion: { id: accion.id, label: accion.nombre,
      insert: { texto: accion.nombre } },
    accionGhostTexto,
    fundamentos: accion.fundamentos.map((f) => ({
      id: accion.id + '-' + f.codigo + '-' + f.articulo,
      label: 'artículo ' + f.articulo + ' ' + conPreposicion(f.codigo),
      institucion: f.institucion,
      // ubicación normativa como sugerencia de fundamento — sin vigencia
      procedencia: { tipo: 'norma', fuente: 'catálogo numerus clausus',
        ref: f.codigo + ':' + f.articulo },
    })),
    ambiguo: false, opciones: [],
  }
}
