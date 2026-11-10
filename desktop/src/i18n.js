// i18n de la página: inglés canónico, español opcional.
//
// - `t(clave, vars)` resuelve `{nombre}` con vars; respaldo es → en → clave.
// - El idioma inicial lo decide plugin.src.js: elección guardada del usuario
//   (ctx.storage 'idioma') → locale del host si es español → 'en'.
// - `useIdioma()` re-renderiza toda la página al cambiar (switch EN/ES).
// - Los diccionarios se registran también con ctx.i18n.register para las
//   etiquetas de sidebar/paleta del host.
//
// Lo que NO se traduce (contenido legal, no interfaz): nombres de leyes,
// textos de artículos, citas, códigos del motor (VERIFICADA/FALLO/…),
// plantillas y catálogo de predicción (l0.js), el escrito demo, comandos.

import { useSyncExternalStore } from 'react'

// Las entradas se agregan por archivo migrado; ver test/i18n.test.mjs.
// Claves planas namespaced por área; `{var}` se sustituye en t().
export const TEXTOS = {
  en: {
    // shell — cabecera, pestañas y estado del entorno
    'shell.subtitulo': 'Local legal studio · Not legal advice',
    'shell.pestana.escritor': 'Case Writer',
    'shell.pestana.grafo': 'Corpus graph',
    'shell.pestana.nif': 'Case board',
    'shell.pestana.personalizacion': 'Legal systems & settings',
    'shell.estado.sinBackend': 'The Diké backend is not responding on the active profile',
    'shell.estado.ayuda': 'Check that the Diké plugin is installed and enabled on the active profile (version 0.4.0 or later; the panel tab exists since that version).',
    'shell.estado.reintentar': 'Retry',
    'shell.estado.cargando': 'Checking the corpus…',
    'shell.estado.corpusOk': 'corpus installed',
    'shell.estado.corpusNo': 'corpus not installed',
    'shell.estado.aislado': 'sandboxed (bubblewrap)',
    'shell.estado.sinAislamiento': 'not sandboxed: {motivo}',
    'shell.estado.pack': 'pack {pack} · {leyes} laws · {articulos} articles{version}',
    'shell.idioma': 'Interface language',
    // nif — tablero de caso y panel de casos
    'nif.seccion.factsKnown': 'Known facts',
    'nif.seccion.factsAlleged': 'Alleged facts',
    'nif.seccion.factsMissing': 'Missing facts',
    'nif.seccion.subjects': 'Subjects',
    'nif.seccion.norms': 'Norms',
    'nif.seccion.normRelations': 'Relations between norms',
    'nif.seccion.adminActs': 'Administrative acts',
    'nif.seccion.principles': 'Principles',
    'nif.seccion.deonticPositions': 'Deontic positions',
    'nif.seccion.conflicts': 'Conflicts',
    'nif.seccion.hypotheses': 'Hypotheses',
    'nif.seccion.gaps': 'Gaps',
    'nif.seccion.relevantFactors': 'Relevant factors',
    'nif.cerrar': 'close',
    'nif.agregar': '+ add',
    'nif.placeholderJson': 'Item JSON, e.g. {"label": "Employee"}',
    'nif.placeholderTexto': 'Item text',
    'nif.guardar': 'Save',
    'nif.impacto': 'impact {impacto}',
    'nif.pide': 'asked by {quien}',
    'nif.quien': 'who',
    'nif.conQue': 'what fills it',
    'nif.llenar': 'fill',
    'nif.cargando': 'Loading case board…',
    'nif.sinNif': 'This case has no case board yet.',
    'nif.validado': 'validated by a human',
    'nif.sinValidar': 'not human-validated',
    'nif.versionConf': 'v{version} · confidence {pct}%',
    'nif.quitarValidacion': 'remove validation',
    'nif.marcarValidado': 'mark validated',
    'nif.fijarConfianza': 'set confidence',
    'nif.resolverVacios': 'Resolve gaps',
    'nif.historial': 'Patch history ({n})',
    'nif.sinCasos': 'No cases',
    'nif.cargarDemo': 'Load demo case',
    'nif.idCaso': 'case id',
    'nif.pregunta': 'legal question',
    'nif.nuevoCaso': 'New case',
    'nif.vacio': 'No cases yet. Load the demo case (wrongful dismissal, art. 161/168 CT) or create one with the case\'s legal question.',
    // prefs — personalización y estado del entorno
    'prefs.guardadas': 'Preferences saved',
    'prefs.titulo': 'Experience customization (Diké Studio)',
    'prefs.ayuda': 'Adjust the Case Writer page look, the default privacy strategy and the visible panels.',
    'prefs.temaPapel': 'Paper theme',
    'prefs.temaClasico': 'Classic paper (white on gray)',
    'prefs.temaSepia': 'Warm sepia reading',
    'prefs.temaNocturno': 'Dark ink (night mode)',
    'prefs.formatoHoja': 'Page format',
    'prefs.a4': 'A4 Standard (210 mm)',
    'prefs.carta': 'Judicial letter (216 mm)',
    'prefs.ancho': 'Fluid full width',
    'prefs.estrategia': 'Default pseudonymization strategy',
    'prefs.ligera': 'Light (critical only: national ID, email, phone)',
    'prefs.media': 'Medium (critical + high)',
    'prefs.estricta': 'Strict (+ medium and names)',
    'prefs.contextoEstilo': 'Plain-language review context',
    'prefs.ctxEscrito': 'Judicial brief (max 30 words/sentence)',
    'prefs.ctxDemanda': 'Complaint (max 25 words/sentence)',
    'prefs.ctxSentencia': 'Judgment (max 20 words/sentence)',
    'prefs.ctxGeneral': 'General (max 25 words/sentence)',
    'prefs.mostrarPizarra': 'Show Strategy board when opening Case Writer',
    'prefs.mostrarChat': 'Dock Hermes chat on the right',
    'prefs.estadoTitulo': 'Environment status for third parties',
    'prefs.versionPack': 'Plugin version: v{version} · Sealed corpus pack: {pack}',
    'prefs.cobertura': 'Installed coverage: {leyes} Chilean laws · {articulos} articles',
    'prefs.perfilChat': 'Profile configured for chat (perfil_chat): {perfil}',
    'prefs.perfilActivo': '(uses the active Hermes profile)',
    'prefs.fijarPerfil': 'To set a dedicated lawyer profile:',
    'prefs.consultando': 'Checking status…',
    'prefs.grafosTitulo': 'Graph and legal-system builder',
    // pred — sugerencias experimentales (L0/L1/L2)
    'pred.titulo': 'Suggestions (experimental)',
    'pred.activar': 'Enable suggestions',
    'pred.l0': 'L0 templates',
    'pred.l1': 'L1 local corpus',
    'pred.l2': 'L2 model',
    'pred.destinoNube': 'cloud',
    'pred.sinSesion': 'no chat session',
    'pred.telemetria': 'Log acceptances (no content)',
    'pred.avisoNube': 'Model prediction would send the paragraph to the cloud.',
    'pred.aceptoNube': 'I agree to send the paragraph to the cloud',
    'pred.nota': 'Suggestions are proposals: the model and the corpus do not verify citations. Fine-tuning a custom model: planned, limited by funding.',
    'pred.fuenteFormalismos': 'procedural-form catalog',
    'pred.fuenteAcciones': 'procedural-action catalog',
    'pred.destinoNubeCorto': ' · prediction · cloud',
    'pred.perfilSinResolver': 'unresolved profile',
    // busq — buscador del corpus sellado
    'busq.placeholder': 'Search the sealed corpus…',
    'busq.vacio': 'Type legal terms to search the corpus.',
    'busq.vigente': 'in force',
    'busq.buscar': 'Search',
    'busq.cerrar': 'Close search',
    'busq.materias': 'Subjects:',
    'busq.buscando': 'Searching the sealed corpus…',
    'busq.sinResultados': 'No results for “{q}”.',
    // priv — seudonimización y privacidad
    'priv.titulo': 'Privacy',
    'priv.seudonimizar': 'Pseudonymize before sending to the model',
    'priv.estrategiaLigera': 'light (critical only)',
    'priv.estrategiaMedia': 'medium (critical + high)',
    'priv.estrategiaEstricta': 'strict (+ medium)',
    'priv.detectar': 'Detect personal data',
    'priv.detectando': 'detecting…',
    'priv.verMarcas': 'Show personal data in the brief',
    'priv.ocultarMarcas': 'Hide personal data in the brief',
    'priv.vistaSalida': 'Preview of what leaves',
    'priv.enmascararSeleccion': 'Mask selection',
    'priv.entiendo': 'I understand the text will leave with personal data',
    'priv.error': 'Privacy unavailable: {error} — the text must not leave until this is resolved.',
    'priv.posiblesPersonas': '{n} possible people',
    'priv.enmascarar': 'Mask',
    'priv.conservar': 'Keep',
    'priv.motivo.juez': 'judge (public)',
    'priv.motivo.ancla_causa': 'cause anchor',
    'priv.motivo.institucion': 'institution',
    'priv.motivo.decision_abogado': 'lawyer decision',
    'priv.motivo.por_estrategia': 'under the strategy',
    'priv.posiblesSinContexto': 'Possible people without context',
    'priv.sinDeteccion': 'No detection yet: edit the brief or press “Detect personal data”.',
    'priv.valoresMapa': '{n} pseudonymized values · destination: none yet (chat arrives in a later phase)',
    'priv.cerrar': 'close',
    'priv.preparando': 'preparing preview…',
  },
  es: {
    'shell.subtitulo': 'Estudio jurídico local · No es consejo legal',
    'shell.pestana.escritor': 'Escritos (Case Writer)',
    'shell.pestana.grafo': 'Grafo 3D',
    'shell.pestana.nif': 'Tablero NIF',
    'shell.pestana.personalizacion': 'Ordenamientos y Ajustes',
    'shell.estado.sinBackend': 'El backend de Diké no responde en el perfil activo',
    'shell.estado.ayuda': 'Comprueba que el plugin Diké esté instalado y habilitado en el perfil activo con versión 0.4.0 o superior (la pestaña del panel existe desde esa versión).',
    'shell.estado.reintentar': 'Reintentar',
    'shell.estado.cargando': 'Consultando el corpus…',
    'shell.estado.corpusOk': 'corpus instalado',
    'shell.estado.corpusNo': 'corpus sin instalar',
    'shell.estado.aislado': 'aislado (bubblewrap)',
    'shell.estado.sinAislamiento': 'sin aislamiento: {motivo}',
    'shell.estado.pack': 'pack {pack} · {leyes} leyes · {articulos} artículos{version}',
    'shell.idioma': 'Idioma de la interfaz',
    'nif.seccion.factsKnown': 'Hechos conocidos',
    'nif.seccion.factsAlleged': 'Hechos alegados',
    'nif.seccion.factsMissing': 'Hechos faltantes',
    'nif.seccion.subjects': 'Sujetos',
    'nif.seccion.norms': 'Normas',
    'nif.seccion.normRelations': 'Relaciones entre normas',
    'nif.seccion.adminActs': 'Actos administrativos',
    'nif.seccion.principles': 'Principios',
    'nif.seccion.deonticPositions': 'Posiciones deónticas',
    'nif.seccion.conflicts': 'Conflictos',
    'nif.seccion.hypotheses': 'Hipótesis',
    'nif.seccion.gaps': 'Vacíos',
    'nif.seccion.relevantFactors': 'Factores relevantes',
    'nif.cerrar': 'cerrar',
    'nif.agregar': '+ agregar',
    'nif.placeholderJson': 'JSON del ítem, ej. {"label": "Trabajador"}',
    'nif.placeholderTexto': 'Texto del ítem',
    'nif.guardar': 'Guardar',
    'nif.impacto': 'impacto {impacto}',
    'nif.pide': 'pide {quien}',
    'nif.quien': 'quién',
    'nif.conQue': 'con qué se llena',
    'nif.llenar': 'llenar',
    'nif.cargando': 'Cargando NIF…',
    'nif.sinNif': 'Este caso no tiene NIF todavía.',
    'nif.validado': 'validado por humano',
    'nif.sinValidar': 'sin validación humana',
    'nif.versionConf': 'v{version} · confianza {pct}%',
    'nif.quitarValidacion': 'retirar validación',
    'nif.marcarValidado': 'marcar validado',
    'nif.fijarConfianza': 'fijar confianza',
    'nif.resolverVacios': 'Resolver vacíos',
    'nif.historial': 'Historial de parches ({n})',
    'nif.sinCasos': 'Sin casos',
    'nif.cargarDemo': 'Cargar caso demo',
    'nif.idCaso': 'id del caso',
    'nif.pregunta': 'pregunta jurídica',
    'nif.nuevoCaso': 'Nuevo caso',
    'nif.vacio': 'No hay casos todavía. Siembra el caso demo (despido injustificado, art. 161/168 CT) o crea uno con la pregunta jurídica del caso.',
    'prefs.guardadas': 'Preferencias guardadas',
    'prefs.titulo': 'Personalización de Experiencia (Estudio Diké)',
    'prefs.ayuda': 'Ajusta la apariencia de la hoja del Case Writer, la estrategia de privacidad inicial y los paneles visibles.',
    'prefs.temaPapel': 'Tema del papel',
    'prefs.temaClasico': 'Papel clásico (blanco sobre gris)',
    'prefs.temaSepia': 'Sepia lectura cálida',
    'prefs.temaNocturno': 'Tinta oscura (modo noche)',
    'prefs.formatoHoja': 'Formato de hoja',
    'prefs.a4': 'A4 Estándar (210 mm)',
    'prefs.carta': 'Carta Judicial (216 mm)',
    'prefs.ancho': 'Ancho completo fluido',
    'prefs.estrategia': 'Estrategia de seudonimización por defecto',
    'prefs.ligera': 'Ligera (solo críticos: RUT, correo, fono)',
    'prefs.media': 'Media (críticos + altos)',
    'prefs.estricta': 'Estricta (+ medios y nombres)',
    'prefs.contextoEstilo': 'Contexto de LexO Escribe Claro',
    'prefs.ctxEscrito': 'Escrito judicial (máx. 30 pal/oración)',
    'prefs.ctxDemanda': 'Demanda (máx. 25 pal/oración)',
    'prefs.ctxSentencia': 'Sentencia (máx. 20 pal/oración)',
    'prefs.ctxGeneral': 'General (máx. 25 pal/oración)',
    'prefs.mostrarPizarra': 'Mostrar Pizarra Estratégica al abrir el Case Writer',
    'prefs.mostrarChat': 'Anclar Chat Hermes a la derecha',
    'prefs.estadoTitulo': 'Estado del Entorno para Terceros',
    'prefs.versionPack': 'Versión del plugin: v{version} · Pack sellado: {pack}',
    'prefs.cobertura': 'Cobertura instalada: {leyes} leyes chilenas · {articulos} artículos',
    'prefs.perfilChat': 'Perfil configurado para el chat (perfil_chat): {perfil}',
    'prefs.perfilActivo': '(usa el perfil activo de Hermes)',
    'prefs.fijarPerfil': 'Para fijar un perfil dedicado de abogado:',
    'prefs.consultando': 'Consultando estado…',
    'prefs.grafosTitulo': 'Constructor de Grafos y Ordenamientos Jurídicos',
    'pred.titulo': 'Predicción (experimental)',
    'pred.activar': 'Activar sugerencias',
    'pred.l0': 'L0 formalismos',
    'pred.l1': 'L1 corpus local',
    'pred.l2': 'L2 modelo',
    'pred.destinoNube': 'nube',
    'pred.sinSesion': 'sin sesión de chat',
    'pred.telemetria': 'Registrar aceptaciones (sin contenido)',
    'pred.avisoNube': 'La predicción con modelo enviaría el párrafo a la nube.',
    'pred.aceptoNube': 'Acepto enviar el párrafo a la nube',
    'pred.nota': 'Las sugerencias son propuestas: el modelo y el corpus no verifican citas. Ajuste fino de un modelo propio: planeado, limitado por fondos.',
    'pred.fuenteFormalismos': 'catálogo de formalismos procesales',
    'pred.fuenteAcciones': 'catálogo de acciones procesales',
    'pred.destinoNubeCorto': ' · predicción · nube',
    'pred.perfilSinResolver': 'perfil sin resolver',
    'busq.placeholder': 'Buscar en el corpus sellado…',
    'busq.vacio': 'Escribe términos jurídicos para buscar en el corpus.',
    'busq.vigente': 'vigente',
    'busq.buscar': 'Buscar',
    'busq.cerrar': 'Cerrar buscador',
    'busq.materias': 'Materias:',
    'busq.buscando': 'Buscando en el corpus sellado…',
    'busq.sinResultados': 'Sin resultados para «{q}».',
    'priv.titulo': 'Privacidad',
    'priv.seudonimizar': 'Seudonimizar antes de enviar al modelo',
    'priv.estrategiaLigera': 'ligera (solo críticos)',
    'priv.estrategiaMedia': 'media (críticos + altos)',
    'priv.estrategiaEstricta': 'estricta (+ medios)',
    'priv.detectar': 'Detectar datos',
    'priv.detectando': 'detectando…',
    'priv.verMarcas': 'Ver datos personales en el escrito',
    'priv.ocultarMarcas': 'Ocultar datos en el escrito',
    'priv.vistaSalida': 'Vista de lo que sale',
    'priv.enmascararSeleccion': 'Enmascarar selección',
    'priv.entiendo': 'Entiendo que el texto saldrá con datos personales',
    'priv.error': 'Privacidad no disponible: {error} — el texto no debe salir hasta resolverlo.',
    'priv.posiblesPersonas': '{n} posibles personas',
    'priv.enmascarar': 'Enmascarar',
    'priv.conservar': 'conservar',
    'priv.motivo.juez': 'juez (público)',
    'priv.motivo.ancla_causa': 'ancla de causa',
    'priv.motivo.institucion': 'institución',
    'priv.motivo.decision_abogado': 'decisión del abogado',
    'priv.motivo.por_estrategia': 'bajo la estrategia',
    'priv.posiblesSinContexto': 'Posibles personas sin contexto',
    'priv.sinDeteccion': 'Sin detección aún: edita el escrito o pulsa «Detectar datos».',
    'priv.valoresMapa': '{n} valores seudonimizados · destino: aún sin destino (el chat llega en la fase siguiente)',
    'priv.cerrar': 'cerrar',
    'priv.preparando': 'preparando vista…',
  },
}

// Convierte las claves planas en el árbol anidado que espera ctx.i18n.register.
export function anidarTextos() {
  const salida = { en: {}, es: {} }
  for (const loc of ['en', 'es']) {
    for (const [k, v] of Object.entries(TEXTOS[loc])) {
      const partes = k.split('.')
      let o = salida[loc]
      for (let i = 0; i < partes.length - 1; i++) {
        o = o[partes[i]] = o[partes[i]] || {}
      }
      o[partes[partes.length - 1]] = v
    }
  }
  return salida
}

let idioma = 'en'
const oyentes = new Set()

export function fijarIdioma(nuevo) {
  const v = nuevo === 'es' ? 'es' : 'en'
  if (v === idioma) return
  idioma = v
  for (const fn of oyentes) fn()
}

export function idiomaActual() {
  return idioma
}

export function useIdioma() {
  return useSyncExternalStore(
    (fn) => { oyentes.add(fn); return () => oyentes.delete(fn) },
    idiomaActual,
  )
}

export function t(clave, vars) {
  const dict = TEXTOS[idioma] || TEXTOS.en
  let s = dict[clave] ?? TEXTOS.en[clave] ?? TEXTOS.es[clave] ?? clave
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      s = s.split('{' + k + '}').join(String(v ?? ''))
    }
  }
  return s
}
