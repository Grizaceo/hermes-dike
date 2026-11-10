// Diké — mitad Desktop del paquete unificado (plugins/dike/desktop/plugin.js).
// FUENTE: desktop/plugin.js se genera con `npm run build` en desktop/ (esbuild
// empaqueta este archivo + grafo3d.js + three/3d-force-graph en un solo ESM).
// La app la copia a ~/.hermes/desktop-plugins/dike/ y la trata como un plugin
// de disco opt-in: hay que activarla en Capabilities → Plugins. La página y la
// fila de la barra llaman al mismo backend que la pestaña web
// (/api/plugins/dike → dashboard/plugin_api.py), que corre por perfil: si el
// perfil activo no tiene el plugin instalado, la página lo explica en vez de
// fallar. Tres pestañas: Case Writer (escrito + verificador), grafo 3D del
// corpus y tablero NIF.

import { host, PALETTE_AREA, ROUTES_AREA, SIDEBAR_NAV_AREA } from '@hermes/plugin-sdk'
import { jsx, jsxs } from 'react/jsx-runtime'
import { useCallback, useEffect, useState } from 'react'
import ESTILOS from 'dike:estilos'
import { mensajeError, programarTimeout, rest, setRest, setStorage, setTimers, S } from './common.js'
import { SeccionEscritor } from './escritor/escritor.js'
import { PanelHerramientasGrafos } from './escritor/grafos-herramientas.js'
import { SeccionGrafo } from './grafo3d.js'
import { encolarCita, pedirFoco, tomarPestana } from './puente.js'

const ID = 'dike'

function Estado() {
  const [estado, setEstado] = useState(null)
  const [err, setErr] = useState(null)
  const cargar = useCallback(() => {
    setErr(null)
    rest('/estado').then(setEstado).catch(setErr)
  }, [])
  useEffect(cargar, [cargar])
  if (err) {
    // host.state.profile: perfil al que está enrutado el gateway activo.
    const perfil = (host.state && host.state.profile && host.state.profile.get()) || ''
    return jsxs('div', { className: 'flex flex-col gap-2', children: [
      jsx('div', { className: S.sub, children:
        'El backend de Diké no responde en el perfil activo' +
        (perfil ? ' (' + perfil + ')' : '') + ': ' + mensajeError(err) + '.' }),
      jsx('div', { className: S.sub, children:
        'Comprueba que el plugin Diké esté instalado y habilitado en el perfil activo ' +
        'con versión 0.4.0 o superior (la pestaña del panel existe desde esa versión).' }),
      jsx('button', { type: 'button', className: S.ghost, onClick: cargar, children: 'Reintentar' }),
    ]})
  }
  if (!estado) return jsx('div', { className: S.sub, children: 'Consultando el corpus…' })
  const aislado = estado.aislamiento && estado.aislamiento.modo === 'bwrap'
  const motivo = (estado.aislamiento && estado.aislamiento.motivo) || ''
  return jsxs('div', { className: 'flex flex-wrap items-center gap-2', children: [
    jsx('span', {
      className: S.chip + ' ' + (estado.corpus_instalado ? S.chipOk : S.chipOff),
      children: estado.corpus_instalado ? 'corpus instalado' : 'corpus sin instalar',
    }),
    jsx('span', {
      className: S.chip + ' ' + (aislado ? S.chipOk : S.chipOff),
      children: aislado ? 'aislado (bubblewrap)' : 'sin aislamiento: ' + motivo,
    }),
    jsx('span', { className: S.sub, children:
      'pack ' + estado.pack_hash + ' · ' + estado.leyes + ' leyes · ' + estado.articulos +
      ' artículos' + (estado.version ? ' · v' + estado.version : '') }),
  ]})
}

// ---------------------------------------------------------------------------
// NIF (la vista Grafo vive en grafo3d.js)
// ---------------------------------------------------------------------------

const SECCIONES_NIF = [
  ['facts.known', 'Hechos conocidos'], ['facts.alleged', 'Hechos alegados'],
  ['facts.missing', 'Hechos faltantes'], ['subjects', 'Sujetos'],
  ['norms', 'Normas'], ['norm_relations', 'Relaciones entre normas'],
  ['admin_acts', 'Actos administrativos'], ['principles', 'Principios'],
  ['deontic_positions', 'Posiciones deónticas'], ['conflicts', 'Conflictos'],
  ['hypotheses', 'Hipótesis'], ['gaps', 'Vacíos'],
  ['relevant_factors', 'Factores relevantes'],
]

const SECCIONES_OBJETO = new Set(['subjects', 'norms', 'hypotheses', 'gaps', 'conflicts', 'admin_acts', 'deontic_positions', 'principles', 'norm_relations', 'relevant_factors'])

function ItemNif({ valor }) {
  const v = valor
  let texto
  if (typeof v === 'string') texto = v
  else if (v && typeof v === 'object' && !Array.isArray(v)) {
    texto = [v.label || v.id || v.name || '', v.description || v.text || v.filled_with || '']
      .filter(Boolean).join(' — ') || JSON.stringify(v)
  } else texto = JSON.stringify(v)
  return jsx('div', { className: 'border-b border-(--ui-stroke-tertiary) py-1 text-xs last:border-0', children:
    jsx('div', { className: 'whitespace-pre-wrap', children: String(texto).slice(0, 400) }) })
}

function SeccionNif({ titulo, valores, campo, onAgregar }) {
  const [nuevo, setNuevo] = useState('')
  const [editando, setEditando] = useState(false)
  const lista = Array.isArray(valores) ? valores : []
  return jsxs('div', { className: S.section, children: [
    jsxs('div', { className: 'flex items-center justify-between', children: [
      jsx('span', { className: S.sectionTitle, children: titulo + ' (' + lista.length + ')' }),
      jsx('button', {
        type: 'button',
        className: S.link + ' normal-case',
        onClick: () => setEditando(!editando),
        children: editando ? 'cerrar' : '+ agregar',
      }),
    ] }),
    ...lista.map((v, i) => jsx(ItemNif, { key: i, valor: v })),
    lista.length === 0 ? jsx('div', { className: S.sub, children: '—' }) : null,
    editando ? jsxs('div', { className: 'flex flex-col gap-1 mt-1', children: [
      jsx('textarea', {
        className: 'min-h-16 w-full rounded border border-(--ui-stroke-secondary) bg-(--ui-bg-primary) p-1.5 font-mono text-xs',
        placeholder: SECCIONES_OBJETO.has(campo)
          ? 'JSON del ítem, ej. {"label": "Trabajador"}' : 'Texto del ítem',
        value: nuevo,
        onChange: (ev) => setNuevo(ev.target.value),
      }),
      jsx('button', {
        type: 'button',
        className: S.ghost,
        onClick: () => {
          const raw = nuevo.trim()
          if (!raw) return
          let valor
          try { valor = JSON.parse(raw) } catch (e) { valor = raw }
          onAgregar(campo, valor)
          setNuevo('')
          setEditando(false)
        },
        children: 'Guardar',
      }),
    ] }) : null,
  ] })
}

function GapRow({ gap, index, ocupado, onResolver }) {
  const [by, setBy] = useState('')
  const [with_, setWith] = useState('')
  return jsxs('div', { className: 'flex flex-col gap-1 border-b border-(--ui-stroke-tertiary) py-1.5 last:border-0 text-xs', children: [
    jsx('div', { children: gap.description || JSON.stringify(gap) }),
    jsx('div', { className: S.sub, children:
      'impacto ' + (gap.impact || '?') + (gap.demanded_by ? ' · pide ' + gap.demanded_by : '') }),
    jsxs('div', { className: 'flex gap-1', children: [
      jsx('input', { className: S.input + ' w-28', placeholder: 'quién', value: by,
        onChange: (e) => setBy(e.target.value) }),
      jsx('input', { className: S.input + ' flex-1', placeholder: 'con qué se llena', value: with_,
        onChange: (e) => setWith(e.target.value) }),
      jsx('button', {
        type: 'button',
        className: S.ghost,
        disabled: ocupado || !by.trim() || !with_.trim(),
        onClick: () => onResolver(index, by.trim(), with_.trim()),
        children: 'llenar',
      }),
    ] }),
  ] })
}

function NifBoard({ caso, onCambio }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [conf, setConf] = useState('')
  const [ocupado, setOcupado] = useState(false)

  const cargar = useCallback(() => {
    setError(null)
    rest('/nif/snapshot?case_id=' + encodeURIComponent(caso.case_id))
      .then(setData)
      .catch(setError)
  }, [caso.case_id])
  useEffect(cargar, [cargar])

  const accion = useCallback((fn) => (...args) => {
    if (ocupado) return
    setOcupado(true)
    setError(null)
    Promise.resolve(fn(...args))
      .then(() => { cargar(); if (onCambio) onCambio() })
      .catch(setError)
      .finally(() => setOcupado(false))
  }, [ocupado, cargar, onCambio])

  const post = (ruta, body) => rest(ruta, { method: 'POST', body, timeoutMs: 60000 })

  if (error && !data) {
    return jsx('div', { className: 'text-xs dk-mal', children: mensajeError(error) })
  }
  if (!data) return jsx('div', { className: S.sub, children: 'Cargando NIF…' })

  const snap = data.snapshot || {}
  const nif = snap.nif
  if (!snap.exists || !nif) {
    return jsx('div', { className: 'text-sm text-(--ui-text-secondary)', children: 'Este caso no tiene NIF todavía.' })
  }
  const patches = (data.patches && data.patches.patches) || []
  const gaps = nif.gaps || []

  return jsxs('div', { className: 'flex flex-col gap-3', children: [
    jsxs('div', { className: 'flex flex-wrap items-center gap-2', children: [
      jsx('span', {
        className: S.chip + ' ' + (nif.validated_by_human ? S.chipOk : S.chipOff),
        children: nif.validated_by_human ? 'validado por humano' : 'sin validación humana',
      }),
      jsx('span', { className: S.sub, children:
        'v' + snap.version + ' · confianza ' + Math.round((nif.confidence || 0) * 100) + '%' }),
      jsx('button', {
        type: 'button', className: S.link,
        onClick: accion(() => post('/nif/validar', { case_id: caso.case_id, validated: !nif.validated_by_human })),
        children: nif.validated_by_human ? 'retirar validación' : 'marcar validado',
      }),
      jsxs('span', { className: 'flex items-center gap-1', children: [
        jsx('input', {
          type: 'number', min: '0', max: '1', step: '0.05', className: S.input + ' w-16',
          placeholder: String(nif.confidence || 0), value: conf,
          onChange: (e) => setConf(e.target.value),
        }),
        jsx('button', {
          type: 'button', className: S.link,
          onClick: accion(() => post('/nif/confianza', { case_id: caso.case_id, confidence: parseFloat(conf) })),
          children: 'fijar confianza',
        }),
      ] }),
    ] }),
    jsx('div', { className: 'font-medium', children: nif.legal_question || caso.legal_question || '' }),
    jsx('div', { className: 'grid grid-cols-1 md:grid-cols-2 gap-2', children:
      SECCIONES_NIF.map(([campo, titulo]) => {
        const valores = campo.startsWith('facts.')
          ? ((nif.facts || {})[campo.slice(6)] || [])
          : (nif[campo] || [])
        return jsx(SeccionNif, {
          key: campo, titulo, valores, campo,
          onAgregar: (fp, v) => accion(() => post('/nif/edit', {
            case_id: caso.case_id, field_path: fp, value: v,
          }))(),
        })
      }) }),
    gaps.length
      ? jsxs('div', { className: S.section, children: [
          jsx('div', { className: S.sectionTitle, children: 'Resolver vacíos' }),
          ...gaps.map((g, i) => g.status === 'filled' ? null : jsx(GapRow, {
            key: i, gap: g, index: i, ocupado,
            onResolver: accion((idx, by, with_) => post('/nif/gap', {
              case_id: caso.case_id, gap_index: idx, filled_by: by, filled_with: with_,
            })),
          })),
        ] })
      : null,
    patches.length
      ? jsxs('details', { className: 'text-xs', children: [
          jsx('summary', { className: 'cursor-pointer ' + S.sub,
            children: 'Historial de parches (' + patches.length + ')' }),
          ...patches.slice(-12).reverse().map((p, i) => jsxs('div', {
            key: i, className: 'border-b border-(--ui-stroke-tertiary) py-1',
            children: [
              jsx('span', { className: S.sub, children:
                (p.timestamp || '').slice(0, 19).replace('T', ' ') + ' · ' }),
              jsx('span', { children: p.agent_id + ' → ' + p.field_path + ' (' + p.operation + ')' }),
              p.reason ? jsx('div', { className: S.sub, children: p.reason }) : null,
            ],
          })),
        ] })
      : null,
    error ? jsx('div', { className: 'text-xs dk-mal', children: mensajeError(error) }) : null,
  ] })
}

function SeccionNifPanel() {
  const [lista, setLista] = useState({ cases: [] })
  const [error, setError] = useState(null)
  const [casoSel, setCasoSel] = useState(null)
  const [nuevoId, setNuevoId] = useState('')
  const [nuevaPregunta, setNuevaPregunta] = useState('')
  const [ocupado, setOcupado] = useState(false)

  const cargar = useCallback(() => {
    setError(null)
    rest('/nif/casos')
      .then((d) => {
        setLista(d)
        setCasoSel((prev) => {
          if (prev) return prev
          const cases = (d && d.cases) || []
          return cases.length ? cases[0] : null
        })
      })
      .catch(setError)
  }, [])
  useEffect(cargar, [cargar])

  const post = (ruta, body) => rest(ruta, { method: 'POST', body, timeoutMs: 60000 })

  const casos = lista.cases || []
  return jsxs('div', { className: 'flex flex-col gap-3', children: [
    jsxs('div', { className: 'flex flex-wrap items-center gap-2', children: [
      jsx('select', {
        className: S.input,
        value: casoSel ? casoSel.case_id : '',
        onChange: (ev) => {
          const c = casos.filter(x => x.case_id === ev.target.value)[0]
          setCasoSel(c || null)
        },
        children: casos.length === 0
          ? jsx('option', { value: '', children: 'Sin casos' })
          : casos.map(c => jsx('option', {
              key: c.case_id, value: c.case_id,
              children: c.case_id + ' — ' + String(c.legal_question || '').slice(0, 60),
            })),
      }),
      jsx('button', {
        type: 'button', className: S.ghost, disabled: ocupado,
        onClick: () => {
          setOcupado(true)
          post('/nif/seed', { case_id: 'demo-caso' })
            .then(cargar).catch(setError).finally(() => setOcupado(false))
        },
        children: ocupado ? '…' : 'Cargar caso demo',
      }),
      jsx('input', { className: S.input + ' w-32', placeholder: 'id del caso',
        value: nuevoId, onChange: (e) => setNuevoId(e.target.value) }),
      jsx('input', { className: S.input + ' w-64', placeholder: 'pregunta jurídica',
        value: nuevaPregunta, onChange: (e) => setNuevaPregunta(e.target.value) }),
      jsx('button', {
        type: 'button', className: S.button,
        disabled: ocupado || !nuevoId.trim() || !nuevaPregunta.trim(),
        onClick: () => {
          setOcupado(true)
          post('/nif/init', { case_id: nuevoId.trim(), pregunta: nuevaPregunta.trim() })
            .then(() => { setNuevoId(''); setNuevaPregunta(''); cargar() })
            .catch(setError).finally(() => setOcupado(false))
        },
        children: 'Nuevo caso',
      }),
    ] }),
    error ? jsx('div', { className: 'text-xs dk-mal', children: mensajeError(error) }) : null,
    casos.length === 0 && !error
      ? jsx('div', { className: S.card, children:
          'No hay casos todavía. Siembra el caso demo (despido injustificado, art. 161/168 CT) ' +
          'o crea uno con la pregunta jurídica del caso.' })
      : null,
    casoSel ? jsx(NifBoard, { caso: casoSel, onCambio: cargar }) : null,
  ] })
}

// ---------------------------------------------------------------------------
// Sección de Personalización y Ordenamientos para terceros
// ---------------------------------------------------------------------------

function SeccionPersonalizacionTerceros({ onAbrirGrafo, onLlevarAlEscrito }) {
  const [prefs, setPrefs] = useState(null)
  const [estado, setEstado] = useState(null)
  const [guardadoMsg, setGuardadoMsg] = useState('')

  useEffect(() => {
    rest('/preferencias').then(setPrefs).catch(() => {})
    rest('/estado').then(setEstado).catch(() => {})
  }, [])

  const actualizarPref = useCallback((parche) => {
    setPrefs((prev) => {
      const nuevo = { ...(prev || {}), ...parche }
      rest('/preferencias', { method: 'POST', body: nuevo })
        .then(() => {
          setGuardadoMsg('Preferencias guardadas')
          programarTimeout(() => setGuardadoMsg(''), 2000)
        })
        .catch(() => {})
      return nuevo
    })
  }, [])

  const p = prefs || {}

  return jsxs('div', {
    className: 'grid grid-cols-1 lg:grid-cols-2 gap-4',
    children: [
      // Columna 1: Personalización del plugin y diagnóstico para terceros
      jsxs('div', { className: 'flex flex-col gap-3', children: [
        jsxs('div', { className: S.card, children: [
          jsxs('div', { className: 'flex items-center justify-between', children: [
            jsx('div', { className: S.cardTitle, children: 'Personalización de Experiencia (Estudio Diké)' }),
            guardadoMsg ? jsx('span', { className: S.chip + ' ' + S.chipOk, children: guardadoMsg }) : null,
          ] }),
          jsx('div', { className: S.sub, children:
            'Ajusta la apariencia de la hoja del Case Writer, la estrategia de privacidad inicial y los paneles visibles.' }),
          jsxs('div', { className: 'grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1 text-xs', children: [
            jsxs('label', { className: 'flex flex-col gap-1', children: [
              jsx('span', { className: S.sub, children: 'Tema del papel' }),
              jsx('select', {
                className: S.input,
                value: p.tema_papel || 'clasico',
                onChange: (e) => actualizarPref({ tema_papel: e.target.value }),
                children: [
                  jsx('option', { key: 'clasico', value: 'clasico', children: 'Papel clásico (blanco sobre gris)' }),
                  jsx('option', { key: 'sepia', value: 'sepia', children: 'Sepia lectura cálida' }),
                  jsx('option', { key: 'nocturno', value: 'nocturno', children: 'Tinta oscura (modo noche)' }),
                ],
              }),
            ] }),
            jsxs('label', { className: 'flex flex-col gap-1', children: [
              jsx('span', { className: S.sub, children: 'Formato de hoja' }),
              jsx('select', {
                className: S.input,
                value: p.ancho_hoja || 'a4',
                onChange: (e) => actualizarPref({ ancho_hoja: e.target.value }),
                children: [
                  jsx('option', { key: 'a4', value: 'a4', children: 'A4 Estándar (210 mm)' }),
                  jsx('option', { key: 'carta', value: 'carta', children: 'Carta Judicial (216 mm)' }),
                  jsx('option', { key: 'ancho', value: 'ancho', children: 'Ancho completo fluido' }),
                ],
              }),
            ] }),
            jsxs('label', { className: 'flex flex-col gap-1', children: [
              jsx('span', { className: S.sub, children: 'Estrategia de seudonimización por defecto' }),
              jsx('select', {
                className: S.input,
                value: p.estrategia_privacidad || 'media',
                onChange: (e) => actualizarPref({ estrategia_privacidad: e.target.value }),
                children: [
                  jsx('option', { key: 'ligera', value: 'ligera', children: 'Ligera (solo críticos: RUT, correo, fono)' }),
                  jsx('option', { key: 'media', value: 'media', children: 'Media (críticos + altos)' }),
                  jsx('option', { key: 'estricta', value: 'estricta', children: 'Estricta (+ medios y nombres)' }),
                ],
              }),
            ] }),
            jsxs('label', { className: 'flex flex-col gap-1', children: [
              jsx('span', { className: S.sub, children: 'Contexto de LexO Escribe Claro' }),
              jsx('select', {
                className: S.input,
                value: p.contexto_estilo || 'escrito',
                onChange: (e) => actualizarPref({ contexto_estilo: e.target.value }),
                children: [
                  jsx('option', { key: 'escrito', value: 'escrito', children: 'Escrito judicial (máx. 30 pal/oración)' }),
                  jsx('option', { key: 'demanda', value: 'demanda', children: 'Demanda (máx. 25 pal/oración)' }),
                  jsx('option', { key: 'sentencia', value: 'sentencia', children: 'Sentencia (máx. 20 pal/oración)' }),
                  jsx('option', { key: 'general', value: 'general', children: 'General (máx. 25 pal/oración)' }),
                ],
              }),
            ] }),
          ] }),
          jsxs('div', { className: 'flex flex-wrap gap-4 pt-1 text-xs', children: [
            jsxs('label', { className: 'flex items-center gap-1.5', children: [
              jsx('input', {
                type: 'checkbox',
                checked: p.mostrar_pizarra !== false,
                onChange: (e) => actualizarPref({ mostrar_pizarra: e.target.checked }),
              }),
              'Mostrar Pizarra Estratégica al abrir el Case Writer',
            ] }),
            jsxs('label', { className: 'flex items-center gap-1.5', children: [
              jsx('input', {
                type: 'checkbox',
                checked: p.mostrar_chat !== false,
                onChange: (e) => actualizarPref({ mostrar_chat: e.target.checked }),
              }),
              'Anclar Chat Hermes a la derecha',
            ] }),
          ] }),
        ] }),

        // Diagnóstico de instalación para usuarios terceros
        jsxs('div', { className: S.card, children: [
          jsx('div', { className: S.cardTitle, children: 'Estado del Entorno para Terceros' }),
          estado ? jsxs('div', { className: 'flex flex-col gap-1.5 text-xs', children: [
            jsx('div', { children: `Versión del plugin: v${estado.version || '0.9.0'} · Pack sellado: ${estado.pack_hash}` }),
            jsx('div', { children: `Cobertura instalada: ${estado.leyes} leyes chilenas · ${estado.articulos} artículos` }),
            jsx('div', { children: `Perfil configurado para el chat (perfil_chat): ${estado.perfil_chat || '(usa el perfil activo de Hermes)'}` }),
            jsx('div', { className: S.sub, children:
              'Para fijar un perfil dedicado de abogado: hermes -p <perfil> config set plugins.entries.dike.settings.perfil_chat <perfil-abogado>' }),
          ] }) : jsx('div', { className: S.sub, children: 'Consultando estado…' }),
        ] }),
      ] }),

      // Columna 2: Paquete para crear grafos / ordenamientos (dike-perfil-ordenamiento-v1)
      jsxs('div', { className: S.card, children: [
        jsx('div', { className: S.cardTitle, children: 'Constructor de Grafos y Ordenamientos Jurídicos' }),
        jsx(PanelHerramientasGrafos, {
          onLlevarCitaAlEscrito: onLlevarAlEscrito,
          onAbrirGrafo3D: onAbrirGrafo,
        }),
      ] }),
    ],
  })
}

export default {
  id: ID,
  name: 'Diké',
  description: 'Verificación local de citas de la ley chilena, mapa del corpus y tablero NIF.',
  defaultEnabled: true,

  register(ctx) {
    setRest(ctx.rest)
    setStorage(ctx.storage || null)
    // Los temporizadores de la página usan los del SDK: se cancelan solos
    // cuando el plugin se descarga (cambio de perfil, desactivación).
    setTimers(ctx)
    // La página lleva su propia hoja de estilos (desktop/estilos.mjs): la app
    // solo trae las clases que ella misma usa. Se retira al descargar el plugin.
    const hoja = document.createElement('style')
    hoja.dataset.plugin = ID
    hoja.textContent = ESTILOS
    document.head.appendChild(hoja)
    ctx.onDispose(() => hoja.remove())
    function DikePage() {
      const [pestana, setPestana] = useState(() => tomarPestana() || 'escritor')
      const pestanas = [
        ['escritor', 'Escritos (Case Writer)'],
        ['grafo', 'Grafo 3D'],
        ['nif', 'Tablero NIF'],
        ['personalizacion', 'Ordenamientos y Ajustes'],
      ]
      // «Abrir en el grafo» desde una nota del chat o una cita verificada:
      // deja el foco en memoria y cambia a la pestaña Grafo.
      const onAbrirGrafo = (foco) => {
        if (foco) {
          if (pedirFoco(foco)) setPestana('grafo')
        } else {
          setPestana('grafo')
        }
      }
      const onLlevarAlEscrito = (r) => {
        if (encolarCita(r)) setPestana('escritor')
      }
      // `.dike-raiz` acota la hoja de estilos: va en un contenedor propio
      // porque sus reglas alcanzan a los descendientes, no a la raíz misma.
      return jsx('div', { className: 'dike-raiz', style: { height: '100%' }, children: jsxs('div', {
        className: 'flex h-full flex-col gap-2 overflow-y-auto p-2',
        children: [
          // Barra superior compacta estilo Estudio Diké (imagen 2)
          jsxs('div', {
            className: S.panel + ' flex flex-wrap items-center justify-between gap-3 px-3 py-1.5 shrink-0',
            children: [
              jsxs('div', { className: 'flex items-center gap-3', children: [
                jsxs('div', { className: 'flex items-baseline gap-2', children: [
                  jsx('span', { className: 'text-base font-bold tracking-tight', children: 'Diké' }),
                  jsx('span', { className: S.sub + ' hidden md:inline', children: 'Estudio jurídico local · No es consejo legal' }),
                ] }),
                jsx('div', { className: 'flex items-center gap-1',
                  role: 'tablist',
                  children: pestanas.map(([id, label]) => jsx('button', {
                    key: id,
                    type: 'button',
                    role: 'tab',
                    'aria-selected': pestana === id,
                    className: S.tab,
                    onClick: () => setPestana(id),
                    children: label,
                  })),
                }),
              ] }),
              jsx(Estado, {}),
            ],
          }),

          pestana === 'escritor' ? jsx(SeccionEscritor, { onAbrirGrafo }) : null,
          pestana === 'grafo' ? jsx(SeccionGrafo, { onLlevarAlEscrito }) : null,
          pestana === 'nif' ? jsx(SeccionNifPanel, {}) : null,
          pestana === 'personalizacion' ? jsx(SeccionPersonalizacionTerceros, {
            onAbrirGrafo,
            onLlevarAlEscrito,
          }) : null,
        ],
      }) })
    }

    ctx.registerMany([
      {
        id: 'page',
        area: ROUTES_AREA,
        data: { path: '/dike' },
        render: () => jsx(DikePage, {}),
      },
      {
        id: 'nav',
        area: SIDEBAR_NAV_AREA,
        order: 60,
        data: { path: '/dike', label: 'Diké', codicon: 'law' },
      },
      {
        id: 'open',
        area: PALETTE_AREA,
        data: {
          id: 'dike.open',
          label: 'Diké: verificar citas',
          keywords: ['dike', 'citas', 'legal', 'verificar', 'nif', 'grafo'],
          run: () => host.navigate('/dike'),
        },
      },
    ])
  },
}
