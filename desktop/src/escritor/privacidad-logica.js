// Lógica pura del módulo Privacidad (sin tiptap ni react):
// agrupar entidades para la vista, aplicar decisiones optimistas y
// rehidratar respuestas del modelo con el mapa local.

// rehidratar(textoModelo, mapa): mapa {token: valor} — reemplaza los tokens
// [PERSONA_1]… por los valores reales SOLO para mostrar en pantalla.
export function rehidratar(textoModelo, mapa) {
  if (!textoModelo || !mapa) return textoModelo || ''
  let out = textoModelo
  // tokens más largos primero por si uno es prefijo de otro ([RUT_1] vs [RUT_10])
  for (const token of Object.keys(mapa).sort((a, b) => b.length - a.length)) {
    out = out.split(token).join(mapa[token])
  }
  return out
}

// agruparPorTipo(entidades): [{tipo, items:[entidad]}] ordenado por cantidad
// desc y luego alfabético; dentro, por posición en el texto.
export function agruparPorTipo(entidades) {
  const grupos = new Map()
  for (const e of entidades || []) {
    if (!grupos.has(e.tipo)) grupos.set(e.tipo, [])
    grupos.get(e.tipo).push(e)
  }
  return [...grupos.entries()]
    .map(([tipo, items]) => ({
      tipo,
      items: items.slice().sort((a, b) => a.inicio - b.inicio),
    }))
    .sort((a, b) => b.items.length - a.items.length || a.tipo.localeCompare(b.tipo))
}

// claseDecoracion(entidad): clase de la marca inline según acción/severidad.
export function claseDecoracion(e) {
  if (e.accion === 'conservar') return 'conservada'
  return e.severidad || 'low'
}

// aplicarDecisionVista(entidades, valor, accion): vista optimista tras
// /privacidad/decision — mismo valor normalizado cambia de acción.
export function aplicarDecisionVista(entidades, valor, accion) {
  const norm = (v) => (v || '').toLowerCase().normalize('NFD')
    .replace(/[̀-ͯ]/g, '').split(/\s+/).join(' ').trim()
  const clave = norm(valor)
  return (entidades || []).map((e) => {
    if (norm(e.valor) !== clave) return e
    if (accion === 'olvidar') return { ...e }
    if (accion === 'conservar') return { ...e, accion: 'conservar', motivo: 'decision_abogado' }
    if (accion === 'enmascarar') {
      const copia = { ...e, accion: 'enmascarar' }
      delete copia.motivo
      return copia
    }
    return e
  })
}

// marcasParaEditor(entidades, candidatos, rangoAPos): decorations en
// posiciones ProseMirror para entidades y candidatos sin contexto.
export function marcasParaEditor(entidades, candidatos, rangoAPos) {
  const marcas = []
  for (const e of entidades || []) {
    const r = rangoAPos(e.inicio, e.fin)
    if (r) {
      marcas.push({
        from: r.from, to: r.to,
        clase: claseDecoracion(e),
        title: e.tipo + (e.motivo ? ' · ' + e.motivo : ''),
      })
    }
  }
  for (const c of candidatos || []) {
    const r = rangoAPos(c.inicio, c.fin)
    if (r) marcas.push({ from: r.from, to: r.to, clase: 'candidato', title: 'posible persona' })
  }
  return marcas
}
