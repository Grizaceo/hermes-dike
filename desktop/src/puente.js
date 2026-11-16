// Puente en memoria Grafo → Case Writer: citas traídas de la búsqueda por
// contenido con «Llevar al escrito». Solo memoria del módulo: sin persistencia
// ni storage, y la consulta de búsqueda NUNCA viaja por aquí (solo la cita
// canónica, el gid y las etiquetas del resultado).

let cola = []

// Tope de la cola: tomarCitas() la vuelca entera en el escrito al abrirlo;
// sin límite, citas encoladas y nunca visitadas se acumularían en memoria.
const TOPE_COLA = 20

// encolarCita({cita, gid, nodo_id, label}) -> true si quedó encolada.
// La cita debe ser texto no vacío; el resto se sanea a los cuatro campos.
export function encolarCita(item) {
  if (!item || typeof item.cita !== 'string' || !item.cita.trim()) return false
  if (cola.length >= TOPE_COLA) return false
  cola.push({
    cita: item.cita,
    gid: typeof item.gid === 'string' ? item.gid : null,
    nodo_id: typeof item.nodo_id === 'string' ? item.nodo_id : null,
    label: typeof item.label === 'string' ? item.label : null,
    ...(typeof item.case_id === 'string' ? {case_id:item.case_id} : {}),
    ...(item.evidencia && typeof item.evidencia === 'object' ? {evidencia:structuredClone(item.evidencia)} : {}),
  })
  return true
}

// tomarCitas() -> array con todo lo encolado y vacía la cola.
export function tomarCitas(caseId) {
  const out = caseId === undefined ? cola : cola.filter(p=>!p.case_id || p.case_id===caseId)
  cola = caseId === undefined ? [] : cola.filter(p=>p.case_id && p.case_id!==caseId)
  return out
}

// Writer bridge shared by the actual Case Writer and browser acceptance.
export function insertarCitasPendientes(ed,caseId){
  const selected=cola.filter(p=>!p.case_id||p.case_id===caseId),nuevas=[],fecha=new Date().toISOString()
  for(const p of selected){
    const seguro=p.cita.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    // The writer renders line breaks as hardBreak nodes; original CRLF and
    // exact offsets remain in p.cita/registro and the EvidenceRef, never reused
    // as offsets over the rendered editor text.
    const content=p.evidencia?{type:'paragraph',content:p.cita.split(/\r\n|\r|\n/).flatMap((line,i)=>[...(i?[{type:'hardBreak'}]:[]),...(line?[{type:'text',text:line}]:[])])}:'<p>'+seguro+'.</p>'
    if(!ed.chain().insertContentAt(ed.state.doc.content.size,content).run())throw Error('No se pudo insertar el pasaje; permanece en la cola.')
    cola.splice(cola.indexOf(p),1)
    nuevas.push({cita:p.cita,gid:p.gid,nodo_id:p.nodo_id,fecha,origen:p.evidencia?'reviewer':'busqueda',...(p.evidencia?{evidencia:p.evidencia,case_id:caseId}:{})})
  }
  return nuevas
}

// --- Foco del grafo (Chat/Notas → pestaña Grafo) --------------------------
// Un solo foco pendiente en memoria: la última petición gana y se consume al
// leerla. Sin persistencia ni storage.

const RE_NODO = /^a:\d+:[A-Za-z0-9_]+$/
let foco = null

const _texto = (v) => (typeof v === 'string' && v ? v : null)

// pedirFoco({nodo_id, unidad_id?, fragmento?}) -> true si quedó encolado.
// nodo_id es obligatorio y debe tener la forma a:CODE:EID; unidad_id y
// fragmento se sanea a string o null.
export function pedirFoco(item) {
  if (!item || typeof item.nodo_id !== 'string' || !RE_NODO.test(item.nodo_id)) {
    return false
  }
  foco = {
    nodo_id: item.nodo_id,
    unidad_id: _texto(item.unidad_id),
    fragmento: _texto(item.fragmento),
  }
  return true
}

// tomarFoco() -> el foco pendiente y lo limpia (una sola lectura lo consume).
export function tomarFoco() {
  const out = foco
  foco = null
  return out
}

// --- Pestana inicial de la página -----------------------------------------
// Mismo patrón que el foco: una petición en memoria que se consume al leerla.
// La usa el arnés de desarrollo (?tab=grafo) y cualquier futuro deep-link
// «abrir Diké en tal pestaña»; en producción nadie la pide y devuelve null.

const PESTANAS = new Set(['escritor', 'reviewer', 'grafo', 'nif', 'personalizacion'])
let pestana = null

// pedirPestana(id) -> true si el id es una pestaña conocida.
export function pedirPestana(id) {
  if (typeof id !== 'string' || !PESTANAS.has(id)) return false
  pestana = id
  return true
}

// tomarPestana() -> la pestaña pedida y la limpia (una lectura la consume).
export function tomarPestana() {
  const out = pestana
  pestana = null
  return out
}
