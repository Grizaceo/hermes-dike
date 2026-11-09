// Puente en memoria Grafo → Case Writer: citas traídas de la búsqueda por
// contenido con «Llevar al escrito». Solo memoria del módulo: sin persistencia
// ni storage, y la consulta de búsqueda NUNCA viaja por aquí (solo la cita
// canónica, el gid y las etiquetas del resultado).

let cola = []

// encolarCita({cita, gid, nodo_id, label}) -> true si quedó encolada.
// La cita debe ser texto no vacío; el resto se sanea a los cuatro campos.
export function encolarCita(item) {
  if (!item || typeof item.cita !== 'string' || !item.cita.trim()) return false
  cola.push({
    cita: item.cita,
    gid: typeof item.gid === 'string' ? item.gid : null,
    nodo_id: typeof item.nodo_id === 'string' ? item.nodo_id : null,
    label: typeof item.label === 'string' ? item.label : null,
  })
  return true
}

// tomarCitas() -> array con todo lo encolado y vacía la cola.
export function tomarCitas() {
  const out = cola
  cola = []
  return out
}
