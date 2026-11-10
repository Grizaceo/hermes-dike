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
import { anidarTextos, fijarIdioma, idiomaActual, t, useIdioma } from './i18n.js'

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
        t('shell.estado.sinBackend') +
        (perfil ? ' (' + perfil + ')' : '') + ': ' + mensajeError(err) + '.' }),
      jsx('div', { className: S.sub, children: t('shell.estado.ayuda') }),
      jsx('button', { type: 'button', className: S.ghost, onClick: cargar, children: t('shell.estado.reintentar') }),
    ]})
  }
  if (!estado) return jsx('div', { className: S.sub, children: t('shell.estado.cargando') })
  const aislado = estado.aislamiento && estado.aislamiento.modo === 'bwrap'
  const motivo = (estado.aislamiento && estado.aislamiento.motivo) || ''
  return jsxs('div', { className: 'flex flex-wrap items-center gap-2', children: [
    jsx('span', {
      className: S.chip + ' ' + (estado.corpus_instalado ? S.chipOk : S.chipOff),
      children: estado.corpus_instalado ? t('shell.estado.corpusOk') : t('shell.estado.corpusNo'),
    }),
    jsx('span', {
      className: S.chip + ' ' + (aislado ? S.chipOk : S.chipOff),
      children: aislado ? t('shell.estado.aislado') : t('shell.estado.sinAislamiento', { motivo }),
    }),
    jsx('span', { className: S.sub, children:
      t('shell.estado.pack', {
        pack: estado.pack_hash,
        leyes: estado.leyes,
        articulos: estado.articulos,
        version: estado.version ? ' · v' + estado.version : '',
      }) }),
  ]})
}

// ---------------------------------------------------------------------------
// NIF (la vista Grafo vive en grafo3d.js)
// ---------------------------------------------------------------------------

const SECCIONES_NIF = [
  ['facts.known', 'nif.seccion.factsKnown'], ['facts.alleged', 'nif.seccion.factsAlleged'],
  ['facts.missing', 'nif.seccion.factsMissing'], ['subjects', 'nif.seccion.subjects'],
  ['norms', 'nif.seccion.norms'], ['norm_relations', 'nif.seccion.normRelations'],
  ['admin_acts', 'nif.seccion.adminActs'], ['principles', 'nif.seccion.principles'],
  ['deontic_positions', 'nif.seccion.deonticPositions'], ['conflicts', 'nif.seccion.conflicts'],
  ['hypotheses', 'nif.seccion.hypotheses'], ['gaps', 'nif.seccion.gaps'],
  ['relevant_factors', 'nif.seccion.relevantFactors'],
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
        children: editando ? t('nif.cerrar') : t('nif.agregar'),
      }),
    ] }),
    ...lista.map((v, i) => jsx(ItemNif, { key: i, valor: v })),
    lista.length === 0 ? jsx('div', { className: S.sub, children: '—' }) : null,
    editando ? jsxs('div', { className: 'flex flex-col gap-1 mt-1', children: [
      jsx('textarea', {
        className: 'min-h-16 w-full rounded border border-(--ui-stroke-secondary) bg-(--ui-bg-primary) p-1.5 font-mono text-xs',
        placeholder: SECCIONES_OBJETO.has(campo)
          ? t('nif.placeholderJson') : t('nif.placeholderTexto'),
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
        children: t('nif.guardar'),
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
      t('nif.impacto', { impacto: gap.impact || '?' }) +
      (gap.demanded_by ? ' · ' + t('nif.pide', { quien: gap.demanded_by }) : '') }),
    jsxs('div', { className: 'flex gap-1', children: [
      jsx('input', { className: S.input + ' w-28', placeholder: t('nif.quien'), value: by,
        onChange: (e) => setBy(e.target.value) }),
      jsx('input', { className: S.input + ' flex-1', placeholder: t('nif.conQue'), value: with_,
        onChange: (e) => setWith(e.target.value) }),
      jsx('button', {
        type: 'button',
        className: S.ghost,
        disabled: ocupado || !by.trim() || !with_.trim(),
        onClick: () => onResolver(index, by.trim(), with_.trim()),
        children: t('nif.llenar'),
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
  if (!data) return jsx('div', { className: S.sub, children: t('nif.cargando') })

  const snap = data.snapshot || {}
  const nif = snap.nif
  if (!snap.exists || !nif) {
    return jsx('div', { className: 'text-sm text-(--ui-text-secondary)', children: t('nif.sinNif') })
  }
  const patches = (data.patches && data.patches.patches) || []
  const gaps = nif.gaps || []

  return jsxs('div', { className: 'flex flex-col gap-3', children: [
    jsxs('div', { className: 'flex flex-wrap items-center gap-2', children: [
      jsx('span', {
        className: S.chip + ' ' + (nif.validated_by_human ? S.chipOk : S.chipOff),
        children: nif.validated_by_human ? t('nif.validado') : t('nif.sinValidar'),
      }),
      jsx('span', { className: S.sub, children:
        t('nif.versionConf', { version: snap.version, pct: Math.round((nif.confidence || 0) * 100) }) }),
      jsx('button', {
        type: 'button', className: S.link,
        onClick: accion(() => post('/nif/validar', { case_id: caso.case_id, validated: !nif.validated_by_human })),
        children: nif.validated_by_human ? t('nif.quitarValidacion') : t('nif.marcarValidado'),
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
          children: t('nif.fijarConfianza'),
        }),
      ] }),
    ] }),
    jsx('div', { className: 'font-medium', children: nif.legal_question || caso.legal_question || '' }),
    jsx('div', { className: 'grid grid-cols-1 md:grid-cols-2 gap-2', children:
      SECCIONES_NIF.map(([campo, claveTitulo]) => {
        const valores = campo.startsWith('facts.')
          ? ((nif.facts || {})[campo.slice(6)] || [])
          : (nif[campo] || [])
        return jsx(SeccionNif, {
          key: campo, titulo: t(claveTitulo), valores, campo,
          onAgregar: (fp, v) => accion(() => post('/nif/edit', {
            case_id: caso.case_id, field_path: fp, value: v,
          }))(),
        })
      }) }),
    gaps.length
      ? jsxs('div', { className: S.section, children: [
          jsx('div', { className: S.sectionTitle, children: t('nif.resolverVacios') }),
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
            children: t('nif.historial', { n: patches.length }) }),
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
          ? jsx('option', { value: '', children: t('nif.sinCasos') })
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
        children: ocupado ? '…' : t('nif.cargarDemo'),
      }),
      jsx('input', { className: S.input + ' w-32', placeholder: t('nif.idCaso'),
        value: nuevoId, onChange: (e) => setNuevoId(e.target.value) }),
      jsx('input', { className: S.input + ' w-64', placeholder: t('nif.pregunta'),
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
        children: t('nif.nuevoCaso'),
      }),
    ] }),
    error ? jsx('div', { className: 'text-xs dk-mal', children: mensajeError(error) }) : null,
    casos.length === 0 && !error
      ? jsx('div', { className: S.card, children: t('nif.vacio') })
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
          setGuardadoMsg(t('prefs.guardadas'))
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
            jsx('div', { className: S.cardTitle, children: t('prefs.titulo') }),
            guardadoMsg ? jsx('span', { className: S.chip + ' ' + S.chipOk, children: guardadoMsg }) : null,
          ] }),
          jsx('div', { className: S.sub, children: t('prefs.ayuda') }),
          jsxs('div', { className: 'grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1 text-xs', children: [
            jsxs('label', { className: 'flex flex-col gap-1', children: [
              jsx('span', { className: S.sub, children: t('prefs.temaPapel') }),
              jsx('select', {
                className: S.input,
                value: p.tema_papel || 'clasico',
                onChange: (e) => actualizarPref({ tema_papel: e.target.value }),
                children: [
                  jsx('option', { key: 'clasico', value: 'clasico', children: t('prefs.temaClasico') }),
                  jsx('option', { key: 'sepia', value: 'sepia', children: t('prefs.temaSepia') }),
                  jsx('option', { key: 'nocturno', value: 'nocturno', children: t('prefs.temaNocturno') }),
                ],
              }),
            ] }),
            jsxs('label', { className: 'flex flex-col gap-1', children: [
              jsx('span', { className: S.sub, children: t('prefs.formatoHoja') }),
              jsx('select', {
                className: S.input,
                value: p.ancho_hoja || 'a4',
                onChange: (e) => actualizarPref({ ancho_hoja: e.target.value }),
                children: [
                  jsx('option', { key: 'a4', value: 'a4', children: t('prefs.a4') }),
                  jsx('option', { key: 'carta', value: 'carta', children: t('prefs.carta') }),
                  jsx('option', { key: 'ancho', value: 'ancho', children: t('prefs.ancho') }),
                ],
              }),
            ] }),
            jsxs('label', { className: 'flex flex-col gap-1', children: [
              jsx('span', { className: S.sub, children: t('prefs.estrategia') }),
              jsx('select', {
                className: S.input,
                value: p.estrategia_privacidad || 'media',
                onChange: (e) => actualizarPref({ estrategia_privacidad: e.target.value }),
                children: [
                  jsx('option', { key: 'ligera', value: 'ligera', children: t('prefs.ligera') }),
                  jsx('option', { key: 'media', value: 'media', children: t('prefs.media') }),
                  jsx('option', { key: 'estricta', value: 'estricta', children: t('prefs.estricta') }),
                ],
              }),
            ] }),
            jsxs('label', { className: 'flex flex-col gap-1', children: [
              jsx('span', { className: S.sub, children: t('prefs.contextoEstilo') }),
              jsx('select', {
                className: S.input,
                value: p.contexto_estilo || 'escrito',
                onChange: (e) => actualizarPref({ contexto_estilo: e.target.value }),
                children: [
                  jsx('option', { key: 'escrito', value: 'escrito', children: t('prefs.ctxEscrito') }),
                  jsx('option', { key: 'demanda', value: 'demanda', children: t('prefs.ctxDemanda') }),
                  jsx('option', { key: 'sentencia', value: 'sentencia', children: t('prefs.ctxSentencia') }),
                  jsx('option', { key: 'general', value: 'general', children: t('prefs.ctxGeneral') }),
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
              t('prefs.mostrarPizarra'),
            ] }),
            jsxs('label', { className: 'flex items-center gap-1.5', children: [
              jsx('input', {
                type: 'checkbox',
                checked: p.mostrar_chat !== false,
                onChange: (e) => actualizarPref({ mostrar_chat: e.target.checked }),
              }),
              t('prefs.mostrarChat'),
            ] }),
          ] }),
        ] }),

        // Diagnóstico de instalación para usuarios terceros
        jsxs('div', { className: S.card, children: [
          jsx('div', { className: S.cardTitle, children: t('prefs.estadoTitulo') }),
          estado ? jsxs('div', { className: 'flex flex-col gap-1.5 text-xs', children: [
            jsx('div', { children: t('prefs.versionPack', { version: estado.version || '0.9.0', pack: estado.pack_hash }) }),
            jsx('div', { children: t('prefs.cobertura', { leyes: estado.leyes, articulos: estado.articulos }) }),
            jsx('div', { children: t('prefs.perfilChat', { perfil: estado.perfil_chat || t('prefs.perfilActivo') }) }),
            jsxs('div', { className: S.sub, children: [
              t('prefs.fijarPerfil'),
              ' hermes -p <perfil> config set plugins.entries.dike.settings.perfil_chat <perfil-abogado>',
            ] }),
          ] }) : jsx('div', { className: S.sub, children: t('prefs.consultando') }),
        ] }),
      ] }),

      // Columna 2: Paquete para crear grafos / ordenamientos (dike-perfil-ordenamiento-v1)
      jsxs('div', { className: S.card, children: [
        jsx('div', { className: S.cardTitle, children: t('prefs.grafosTitulo') }),
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
    // Idioma de la interfaz: elección guardada del usuario → locale del host
    // si es español → inglés. ctx.i18n.onLocaleChange re-evalúa al cambiar.
    const resolverIdioma = () => {
      const guardado = ctx.storage ? ctx.storage.get('idioma', null) : null
      if (guardado === 'es' || guardado === 'en') return guardado
      const opciones = (host.i18n && host.i18n.languageOptions ? host.i18n.languageOptions() : [])
      const activo = (opciones.find(o => o.active) || opciones[0] || {}).id || ''
      return activo === 'es' ? 'es' : 'en'
    }
    fijarIdioma(resolverIdioma())
    if (ctx.i18n && ctx.i18n.onLocaleChange) {
      ctx.i18n.onLocaleChange(() => fijarIdioma(resolverIdioma()))
    }
    if (ctx.i18n && ctx.i18n.register) {
      ctx.i18n.register(anidarTextos())
    }

    function DikePage() {
      useIdioma() // re-render de la página entera al cambiar de idioma
      const [pestana, setPestana] = useState(() => tomarPestana() || 'escritor')
      const pestanas = [
        ['escritor', t('shell.pestana.escritor')],
        ['grafo', t('shell.pestana.grafo')],
        ['nif', t('shell.pestana.nif')],
        ['personalizacion', t('shell.pestana.personalizacion')],
      ]
      const cambiarIdioma = (v) => {
        fijarIdioma(v)
        if (ctx.storage) ctx.storage.set('idioma', v)
      }
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
                  jsx('span', { className: S.sub + ' hidden md:inline', children: t('shell.subtitulo') }),
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
              jsxs('div', { className: 'flex items-center gap-2', children: [
                jsx('div', { role: 'group', 'aria-label': t('shell.idioma'),
                  className: 'flex items-center gap-0.5', children: [
                  jsx('button', {
                    type: 'button', className: 'dk-btn dk-btn--chico dk-btn--borde',
                    'aria-pressed': idiomaActual() === 'en',
                    onClick: () => cambiarIdioma('en'), children: 'EN',
                  }),
                  jsx('button', {
                    type: 'button', className: 'dk-btn dk-btn--chico dk-btn--borde',
                    'aria-pressed': idiomaActual() === 'es',
                    onClick: () => cambiarIdioma('es'), children: 'ES',
                  }),
                ] }),
                jsx(Estado, {}),
              ] }),
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
