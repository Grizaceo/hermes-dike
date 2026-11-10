// Lógica pura de la Pizarra Estratégica (sin React, testeable con node --test).

export const COLORES_NOTA = [
  { id: 'amarillo', hex: '#fef08a', borde: '#eab308', texto: 'Amarillo' },
  { id: 'verde', hex: '#bbf7d0', borde: '#22c55e', texto: 'Verde' },
  { id: 'azul', hex: '#bfdbfe', borde: '#3b82f6', texto: 'Azul' },
  { id: 'rojo', hex: '#fecaca', borde: '#ef4444', texto: 'Rojo' },
  { id: 'violeta', hex: '#e9d5ff', borde: '#a855f7', texto: 'Violeta' },
  { id: 'naranja', hex: '#fed7aa', borde: '#f97316', texto: 'Naranja' },
]

export const PLANTILLAS_PIZARRA = [
  {
    id: 'demanda',
    label: 'Demanda / Escrito Judicial',
    descripcion: 'Partes · Hechos · Fundamentos de Derecho · Petitorio',
    columnas: [
      { titulo: 'Partes y Comparecencia', tag: 'PARTES', color: '#bfdbfe', texto: 'Individualización del demandante, demandado y representación procesal.' },
      { titulo: 'Hechos de la Causa', tag: 'HECHO', color: '#bbf7d0', texto: 'Relación cronológica de hechos acreditados y circunstancias relevantes.' },
      { titulo: 'Fundamentos de Derecho', tag: 'NORMA', color: '#e9d5ff', texto: 'Artículos aplicables, doctrina y calificación jurídica de los hechos.' },
      { titulo: 'Petitorio y Otrosíes', tag: 'CONCLUSIÓN', color: '#fef08a', texto: 'Peticiones concretas sometidas al tribunal y medios de prueba en otrosíes.' },
    ],
    conectarSecuencia: true,
  },
  {
    id: 'sentencia',
    label: 'Sentencia Judicial',
    descripcion: 'Partes · Vistos · Considerandos · Por Tanto',
    columnas: [
      { titulo: 'Vistos y Partes', tag: 'PARTES', color: '#bfdbfe', texto: 'Identificación del proceso, pretensiones y defensas de las partes.' },
      { titulo: 'Hechos Acreditados', tag: 'HECHO', color: '#bbf7d0', texto: 'Hechos probados y valoración de la prueba rendida en el expediente.' },
      { titulo: 'Considerandos de Derecho', tag: 'NORMA', color: '#e9d5ff', texto: 'Subsunción normativa y análisis de las infracciones o causales.' },
      { titulo: 'Resolutivo (Por Tanto)', tag: 'CONCLUSIÓN', color: '#fef08a', texto: 'Decisión precisa sobre cada acción, excepción y costas.' },
    ],
    conectarSecuencia: true,
  },
  {
    id: 'contrato',
    label: 'Contrato / Convención',
    descripcion: 'Partes · Objeto · Obligaciones · Garantías y Terminación',
    columnas: [
      { titulo: 'Comparecientes', tag: 'PARTES', color: '#bfdbfe', texto: 'Partes contratantes, personerías y domicilios.' },
      { titulo: 'Objeto y Precio', tag: 'HECHO', color: '#bbf7d0', texto: 'Prestación principal, contraprestación, plazos y forma de pago.' },
      { titulo: 'Obligaciones y Prohibiciones', tag: 'NORMA', color: '#fed7aa', texto: 'Deberes específicos de cada parte y estándares de cumplimiento.' },
      { titulo: 'Garantías y Jurisdicción', tag: 'CONCLUSIÓN', color: '#fecaca', texto: 'Cláusula penal, causales de término, domicilio y arbitraje.' },
    ],
    conectarSecuencia: true,
  },
  {
    id: 'resolucion',
    label: 'Resolución / Reclamación Adm.',
    descripcion: 'Antecedentes · Marco Normativo · Motivación · Resolutivo',
    columnas: [
      { titulo: 'Antecedentes de Hecho', tag: 'HECHO', color: '#bfdbfe', texto: 'Acto administrativo impugnado, fiscalización o expediente.' },
      { titulo: 'Marco Normativo', tag: 'NORMA', color: '#bbf7d0', texto: 'Potestades legales, requisitos procedimentales y normas técnicas.' },
      { titulo: 'Análisis y Prueba', tag: 'PRUEBA', color: '#e9d5ff', texto: 'Motivación, proporcionalidad y examen de antecedentes.' },
      { titulo: 'Conclusión / Lo Pedido', tag: 'CONCLUSIÓN', color: '#fef08a', texto: 'Nulidad, modificación o confirmación solicitada.' },
    ],
    conectarSecuencia: true,
  },
]

export function crearIdNota(prefijo = 'nota') {
  return prefijo + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6)
}

export function construirNodosPlantilla(plantilla) {
  const cols = (plantilla && plantilla.columnas) || []
  const ancho = 230
  const alto = 165
  const gap = 34
  const nodos = cols.map((c, i) => ({
    id: crearIdNota('n' + i),
    x: 24 + i * (ancho + gap),
    y: 22,
    w: ancho,
    h: alto,
    titulo: c.titulo || 'Nota ' + (i + 1),
    tag: c.tag || 'NOTA',
    color: c.color || '#fef08a',
    texto: c.texto || '',
    minimizada: false,
  }))
  const aristas = []
  if (plantilla && plantilla.conectarSecuencia && nodos.length > 1) {
    for (let i = 0; i < nodos.length - 1; i++) {
      aristas.push({
        id: crearIdNota('e' + i),
        from: nodos[i].id,
        to: nodos[i + 1].id,
        label: i === 0 ? 'fundamenta' : i === 1 ? 'verifica' : 'sostiene',
      })
    }
  }
  return { nodos, aristas }
}
