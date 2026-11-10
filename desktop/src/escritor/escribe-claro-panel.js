// Panel de Revisión de Estilo — LexO Escribe Claro (ScribeClaro):
// Analiza legibilidad, voz pasiva, nominalizaciones, arcaísmos judiciales y
// alineación judicial ("copiabilidad") + Grafo de Estructura Argumentativa
// (Hecho → Norma → Prueba → Conclusión) con envío directo a la Pizarra.

import { jsx, jsxs } from 'react/jsx-runtime'
import { useCallback, useEffect, useRef, useState } from 'react'
import { cancelarTarea, mensajeError, programarTimeout, rest, S } from '../common.js'
import { reemplazarRangos, textoDelEditor } from './editor.js'
import { localizarCitas, rangoAPos, segmentosDeDoc } from './verificador.js'

const ETIQUETA_CAT = {
  arcaismo: 'Arcaísmos y fórmulas burocráticas',
  nominalizacion: 'Nominalizaciones verbales',
  legibilidad: 'Legibilidad y extensión',
  voz_pasiva: 'Voz pasiva',
  alineacion_judicial: 'Alineación judicial',
}

const META_NODO_ARG = {
  hecho: { label: 'HECHO', corto: 'H', color: '#bbf7d0', badge: 'bg-emerald-100 text-emerald-800 border-emerald-300' },
  norma: { label: 'NORMA', corto: 'N', color: '#bfdbfe', badge: 'bg-sky-100 text-sky-800 border-sky-300' },
  prueba: { label: 'PRUEBA', corto: 'P', color: '#fed7aa', badge: 'bg-amber-100 text-amber-800 border-amber-300' },
  conclusion: { label: 'CONCLUSIÓN', corto: 'C', color: '#fef08a', badge: 'bg-violet-100 text-violet-800 border-violet-300' },
  orphan: { label: 'SIN TIPO', corto: '?', color: '#f1f5f9', badge: 'bg-slate-100 text-slate-600 border-slate-300' },
}

function colorPuntaje(score) {
  if (score >= 75) return 'text-emerald-600'
  if (score >= 50) return 'text-amber-600'
  return 'text-red-600'
}

function barraPuntaje(score) {
  if (score >= 75) return 'bg-emerald-500'
  if (score >= 50) return 'bg-amber-500'
  return 'bg-red-500'
}

function FilaMetrica({ label, valor, sub, claseValor }) {
  return jsxs('div', {
    className: 'flex items-center justify-between border-b border-slate-100 py-1.5 text-xs last:border-0',
    children: [
      jsx('span', { className: 'text-slate-600', children: label }),
      jsxs('div', { className: 'flex items-center gap-1.5', children: [
        sub ? jsx('span', { className: 'text-[10px] text-slate-400', children: sub }) : null,
        jsx('span', { className: 'font-semibold ' + (claseValor || 'text-slate-800'), children: String(valor) }),
      ] }),
    ],
  })
}

export function PanelEscribeClaro({
  editorRef,
  docInfo,
  contextoInicial,
  autoAnalizarInicial,
  onEnviarAPizarra,
}) {
  const [subTab, setSubTab] = useState('estilo') // 'estilo' | 'argumentos'
  const [contexto, setContexto] = useState(contextoInicial || 'escrito')
  const [autoAnalizar, setAutoAnalizar] = useState(Boolean(autoAnalizarInicial))
  const [vistaOraciones, setVistaOraciones] = useState(false)
  const [resultado, setResultado] = useState(null)
  const [grafoArg, setGrafoArg] = useState(null)
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState(null)
  const timerRef = useRef(null)
  // Guardia de secuencia: si el usuario sigue escribiendo mientras el
  // análisis está en vuelo, la respuesta vieja no puede pisar la nueva.
  const analisisSeq = useRef(0)

  const ejecutarAnalisis = useCallback((ctx = contexto) => {
    const ed = editorRef && editorRef.current
    if (!ed) return
    const texto = textoDelEditor(ed).trim()
    if (!texto) {
      setResultado(null)
      setGrafoArg(null)
      return
    }
    const seq = ++analisisSeq.current
    setOcupado(true)
    setError(null)
    Promise.all([
      rest('/estilo/analizar', {
        method: 'POST',
        body: { texto, contexto: ctx, detallado: true },
      }),
      rest('/estilo/grafo', {
        method: 'POST',
        body: { texto },
      }),
    ]).then(([resEstilo, resGrafo]) => {
      if (seq !== analisisSeq.current) return
      setResultado(resEstilo)
      setGrafoArg(resGrafo)
    }).catch((e) => {
      if (seq !== analisisSeq.current) return
      setError(e)
    }).finally(() => {
      if (seq === analisisSeq.current) setOcupado(false)
    })
  }, [editorRef, contexto])

  useEffect(() => {
    if (!autoAnalizar) return
    if (!(docInfo && docInfo.texto && docInfo.texto.trim())) return
    cancelarTarea(timerRef.current)
    timerRef.current = programarTimeout(() => ejecutarAnalisis(contexto), 1200)
    return () => cancelarTarea(timerRef.current)
  }, [autoAnalizar, docInfo && docInfo.texto, contexto, ejecutarAnalisis])

  const reemplazarTermino = useCallback((termino, reemplazo) => {
    const ed = editorRef && editorRef.current
    if (!ed || !termino || !reemplazo) return
    const texto = textoDelEditor(ed)
    const segs = segmentosDeDoc(ed.state.doc)
    const hallazgos = localizarCitas(texto, [{ cita_raw: termino }])
    if (!hallazgos.length) return
    const primero = hallazgos[0]
    const rango = rangoAPos(segs, primero.inicio, primero.fin)
    if (!rango) return
    // Preservar mayúscula inicial si el original la tenía
    const original = texto.slice(primero.inicio, primero.fin)
    const textoFinal = original[0] && original[0] === original[0].toUpperCase() && original[0] !== original[0].toLowerCase()
      ? reemplazo.charAt(0).toUpperCase() + reemplazo.slice(1)
      : reemplazo
    reemplazarRangos(ed, [rango], textoFinal)
    programarTimeout(() => ejecutarAnalisis(contexto), 250)
  }, [editorRef, contexto, ejecutarAnalisis])

  const volcarGrafoAPizarra = useCallback(() => {
    if (!grafoArg || !onEnviarAPizarra) return
    const nodosOrig = grafoArg.nodes || []
    if (!nodosOrig.length) return
    const nodosPizarra = nodosOrig.map((n, i) => {
      const meta = META_NODO_ARG[n.node_type] || META_NODO_ARG.orphan
      const col = i % 4
      const fila = Math.floor(i / 4)
      return {
        id: 'arg-' + n.id,
        x: 24 + col * 248,
        y: 22 + fila * 175,
        w: 232,
        h: 155,
        titulo: `${meta.label} · §${n.paragraph_index + 1}`,
        tag: meta.label,
        color: meta.color,
        texto: n.text,
        minimizada: false,
      }
    })
    const aristasPizarra = (grafoArg.edges || []).map((e, i) => ({
      id: 'arg-edge-' + i,
      from: 'arg-' + e.source_id,
      to: 'arg-' + e.target_id,
      label: e.relation_type,
    }))
    onEnviarAPizarra({ nodos: nodosPizarra, aristas: aristasPizarra, colapsada: false })
  }, [grafoArg, onEnviarAPizarra])

  const stats = (resultado && resultado.global_stats) || null
  const sugerencias = (resultado && resultado.suggestions) || []
  const oraciones = (resultado && resultado.sentences) || []
  const categorias = Array.from(new Set(sugerencias.map((s) => s.category)))

  return jsxs('div', {
    className: 'flex flex-col gap-3 p-3 text-xs text-slate-800',
    children: [
      // Selector de sub-pestaña: Estilo y Claridad vs Teoría del Caso (Argumentos)
      jsxs('div', {
        className: 'flex items-center gap-1 rounded-md bg-slate-100 p-1 border border-slate-200',
        children: [
          jsx('button', {
            type: 'button',
            onClick: () => setSubTab('estilo'),
            className: 'flex-1 rounded py-1 text-xs font-semibold transition-colors cursor-pointer ' +
              (subTab === 'estilo' ? 'bg-teal-600 text-white shadow-2xs' : 'text-slate-600 hover:text-slate-900'),
            children: '✍ Estilo y Claridad',
          }),
          jsx('button', {
            type: 'button',
            onClick: () => setSubTab('argumentos'),
            className: 'flex-1 rounded py-1 text-xs font-semibold transition-colors cursor-pointer ' +
              (subTab === 'argumentos' ? 'bg-violet-600 text-white shadow-2xs' : 'text-slate-600 hover:text-slate-900'),
            children: '◈ Estructura Argumentativa',
          }),
        ],
      }),

      // Controles de análisis
      jsxs('div', {
        className: 'flex flex-wrap items-center gap-2 rounded-md border border-slate-200 bg-slate-50 p-2',
        children: [
          jsx('label', { className: 'text-[11px] font-medium text-slate-600', children: 'Contexto:' }),
          jsx('select', {
            value: contexto,
            onChange: (e) => {
              const nuevo = e.target.value
              setContexto(nuevo)
              ejecutarAnalisis(nuevo)
            },
            className: 'rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700',
            children: [
              jsx('option', { key: 'escrito', value: 'escrito', children: 'Escrito judicial (máx. 30 pal/oración)' }),
              jsx('option', { key: 'demanda', value: 'demanda', children: 'Demanda (máx. 25 pal/oración)' }),
              jsx('option', { key: 'sentencia', value: 'sentencia', children: 'Sentencia (máx. 20 pal/oración)' }),
              jsx('option', { key: 'general', value: 'general', children: 'General (máx. 25 pal/oración)' }),
            ],
          }),
          jsxs('label', { className: 'flex items-center gap-1 text-[11px] text-slate-600 ml-auto', children: [
            jsx('input', {
              type: 'checkbox',
              checked: autoAnalizar,
              onChange: (e) => setAutoAnalizar(e.target.checked),
            }),
            'Auto',
          ] }),
          jsx('button', {
            type: 'button',
            onClick: () => ejecutarAnalisis(contexto),
            disabled: ocupado,
            className: 'rounded bg-teal-600 hover:bg-teal-700 disabled:opacity-50 px-3 py-1 text-xs font-semibold text-white cursor-pointer',
            children: ocupado ? 'Analizando…' : 'Analizar ahora',
          }),
        ],
      }),

      error ? jsx('div', { className: 'rounded border border-red-200 bg-red-50 p-2 text-xs text-red-700', children: mensajeError(error) }) : null,

      // ── VISTA 1: ESTILO Y CLARIDAD ──
      subTab === 'estilo' ? jsxs('div', { className: 'flex flex-col gap-3', children: [
        !resultado && !ocupado ? jsx('div', {
          className: 'rounded-md border border-dashed border-slate-300 p-5 text-center text-xs text-slate-500',
          children: 'Pulsa «Analizar ahora» para evaluar legibilidad, voz pasiva, nominalizaciones, arcaísmos y alineación judicial con LexO Escribe Claro.',
        }) : null,

        resultado && !vistaOraciones ? jsxs('div', { className: 'flex flex-col gap-3', children: [
          // Medidor de puntaje global
          jsxs('div', {
            className: 'flex flex-col items-center rounded-md border border-slate-200 bg-slate-50/70 p-3',
            children: [
              jsxs('div', { className: 'flex items-baseline gap-1', children: [
                jsx('span', { className: 'text-3xl font-black ' + colorPuntaje(resultado.score), children: String(resultado.score) }),
                jsx('span', { className: 'text-xs text-slate-400', children: '/ 100' }),
              ] }),
              jsx('span', { className: 'text-[10px] uppercase tracking-wider text-slate-500 mt-0.5', children: 'Puntaje ScribeClaro de Claridad Jurídica' }),
              jsx('div', {
                className: 'mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-200',
                children: jsx('div', {
                  className: 'h-full rounded-full transition-all ' + barraPuntaje(resultado.score),
                  style: { width: Math.max(4, Math.min(100, resultado.score)) + '%' },
                }),
              }),
            ],
          }),

          // Métricas globales
          stats ? jsxs('div', {
            className: 'rounded-md border border-slate-200 bg-white px-3 py-2',
            children: [
              jsx('div', { className: 'pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400', children: 'Métricas del escrito' }),
              jsx(FilaMetrica, { label: 'Total de oraciones', valor: stats.total_sentences, sub: stats.total_words + ' palabras' }),
              jsx(FilaMetrica, {
                label: 'Promedio palabras / oración',
                valor: stats.avg_words_per_sentence,
                sub: 'máx. ' + stats.max_words_per_sentence,
                claseValor: stats.avg_words_per_sentence > stats.max_words_per_sentence ? 'text-amber-600' : 'text-emerald-600',
              }),
              jsx(FilaMetrica, {
                label: 'Oraciones que exceden el límite',
                valor: stats.sentences_exceeding_limit,
                claseValor: stats.sentences_exceeding_limit > 0 ? 'text-amber-600' : 'text-emerald-600',
              }),
              jsx(FilaMetrica, {
                label: 'Voz pasiva perifrástica',
                valor: Math.round((stats.passive_ratio || 0) * 100) + '%',
                claseValor: (stats.passive_ratio || 0) > 0.15 ? 'text-amber-600' : 'text-emerald-600',
              }),
              jsx(FilaMetrica, {
                label: 'Nominalizaciones detectadas',
                valor: stats.nominalization_count,
                claseValor: stats.nominalization_count > 0 ? 'text-amber-600' : 'text-emerald-600',
              }),
              jsx(FilaMetrica, {
                label: 'Arcaísmos y fórmulas burocráticas',
                valor: stats.archaism_count,
                claseValor: stats.archaism_count > 0 ? 'text-red-600' : 'text-emerald-600',
              }),
              jsx(FilaMetrica, {
                label: 'Alineación judicial («copiabilidad»)',
                valor: stats.judicial_alignment_score + '/100',
                claseValor: colorPuntaje(stats.judicial_alignment_score),
              }),
            ],
          }) : null,

          // Sugerencias accionables con reemplazo en 1 clic
          jsxs('div', {
            className: 'flex flex-col gap-2 rounded-md border border-slate-200 bg-white p-2.5',
            children: [
              jsxs('div', { className: 'flex items-center justify-between', children: [
                jsx('span', { className: 'text-[10px] font-bold uppercase tracking-wider text-slate-400', children: `Sugerencias (${sugerencias.length})` }),
                oraciones.length > 0 ? jsx('button', {
                  type: 'button',
                  onClick: () => setVistaOraciones(true),
                  className: 'text-[11px] font-medium text-teal-700 hover:underline cursor-pointer',
                  children: `Ver desglose por oración (${oraciones.length}) →`,
                }) : null,
              ] }),
              sugerencias.length === 0
                ? jsx('div', { className: 'py-2 text-center text-xs text-emerald-600 font-medium', children: '✓ Sin observaciones de estilo — redacción clara y directa.' })
                : categorias.map((cat) => {
                    const lista = sugerencias.filter((s) => s.category === cat)
                    return jsxs('div', {
                      key: cat,
                      className: 'flex flex-col gap-1 border-t border-slate-100 pt-2 first:border-0 first:pt-0',
                      children: [
                        jsxs('div', { className: 'flex items-center gap-1.5', children: [
                          jsx('span', { className: 'rounded bg-teal-50 px-1.5 py-0.5 text-[10px] font-bold text-teal-800 border border-teal-200', children: String(lista.length) }),
                          jsx('span', { className: 'text-xs font-semibold text-slate-700', children: ETIQUETA_CAT[cat] || cat }),
                        ] }),
                        ...lista.map((s, idx) => jsxs('div', {
                          key: idx,
                          className: 'flex flex-col gap-1 rounded border border-slate-200 bg-slate-50/70 p-2 text-[11px]',
                          children: [
                            jsx('div', { className: 'text-slate-700 leading-relaxed', children: s.message }),
                            s.term && s.replacement ? jsxs('div', { className: 'flex items-center gap-2 mt-0.5', children: [
                              jsx('button', {
                                type: 'button',
                                onClick: () => reemplazarTermino(s.term, s.replacement),
                                className: 'rounded bg-teal-600 hover:bg-teal-700 px-2 py-0.5 text-[10px] font-medium text-white cursor-pointer',
                                children: `Reemplazar «${s.term}» por «${s.replacement}»`,
                              }),
                            ] }) : null,
                          ],
                        })),
                      ],
                    })
                  }),
            ],
          }),

          // Avisos de coherencia / formato de citas
          (resultado.coherence_warnings || []).length > 0 ? jsxs('div', {
            className: 'flex flex-col gap-1 rounded-md border border-amber-200 bg-amber-50 p-2.5',
            children: [
              jsx('div', { className: 'text-[10px] font-bold uppercase tracking-wider text-amber-800', children: 'Observaciones de alineación y formato' }),
              ...(resultado.coherence_warnings || []).map((w, i) => jsx('div', {
                key: i,
                className: 'text-[11px] text-amber-900 leading-relaxed',
                children: '• ' + w,
              })),
            ],
          }) : null,
        ] }) : null,

        // Vista detallada por oración
        resultado && vistaOraciones ? jsxs('div', { className: 'flex flex-col gap-2', children: [
          jsxs('div', { className: 'flex items-center justify-between border-b border-slate-200 pb-1.5', children: [
            jsx('button', {
              type: 'button',
              onClick: () => setVistaOraciones(false),
              className: 'text-xs font-semibold text-teal-700 hover:underline cursor-pointer',
              children: '← Volver al resumen',
            }),
            jsx('span', { className: 'text-[11px] text-slate-500', children: `${oraciones.length} oraciones analizadas` }),
          ] }),
          ...oraciones.map((o, idx) => {
            const tieneObs = o.exceeds_limit || o.is_passive || (o.nominalizations || []).length > 0 || (o.archaisms || []).length > 0
            return jsxs('div', {
              key: idx,
              className: 'rounded border p-2 text-[11px] ' +
                (tieneObs ? 'border-amber-200 bg-amber-50/40' : 'border-slate-200 bg-white'),
              children: [
                jsxs('div', { className: 'flex items-start gap-1.5', children: [
                  jsx('span', { className: 'font-mono text-[10px] text-slate-400 shrink-0', children: '#' + (idx + 1) }),
                  jsx('div', { className: 'flex-1 text-slate-800 leading-relaxed', children: o.text }),
                ] }),
                jsxs('div', { className: 'mt-1.5 flex flex-wrap gap-1', children: [
                  jsx('span', {
                    className: 'rounded px-1.5 py-0.5 text-[10px] font-medium ' +
                      (o.exceeds_limit ? 'bg-amber-100 text-amber-800' : 'bg-emerald-50 text-emerald-700'),
                    children: o.word_count + ' palabras' + (o.exceeds_limit ? ' (excede límite)' : ''),
                  }),
                  o.is_passive ? jsx('span', {
                    className: 'rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-medium text-sky-800',
                    children: 'Voz pasiva',
                  }) : null,
                  ...(o.nominalizations || []).map((n, ni) => jsx('span', {
                    key: 'n' + ni,
                    className: 'rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-medium text-violet-800',
                    children: `nominalización: ${n.noun_phrase} → ${n.suggested_verb}`,
                  })),
                  ...(o.archaisms || []).map((a, ai) => jsx('button', {
                    key: 'a' + ai,
                    type: 'button',
                    onClick: () => reemplazarTermino(a.term, a.replacement),
                    className: 'rounded bg-red-100 hover:bg-red-200 px-1.5 py-0.5 text-[10px] font-medium text-red-800 cursor-pointer',
                    title: 'Clic para reemplazar en el escrito',
                    children: `arcaísmo: «${a.term}» → «${a.replacement}»`,
                  })),
                ] }),
              ],
            })
          }),
        ] }) : null,
      ] }) : null,

      // ── VISTA 2: TEORÍA DEL CASO / ESTRUCTURA ARGUMENTATIVA ──
      subTab === 'argumentos' ? jsxs('div', { className: 'flex flex-col gap-3', children: [
        !grafoArg && !ocupado ? jsx('div', {
          className: 'rounded-md border border-dashed border-slate-300 p-5 text-center text-xs text-slate-500',
          children: 'Pulsa «Analizar ahora» para extraer la cadena argumentativa (Hecho → Norma → Prueba → Conclusión) de los párrafos del escrito.',
        }) : null,

        grafoArg ? jsxs('div', { className: 'flex flex-col gap-2.5', children: [
          jsxs('div', { className: 'flex flex-wrap items-center justify-between gap-2 rounded-md border border-violet-200 bg-violet-50/70 p-2.5', children: [
            jsxs('div', { className: 'flex items-center gap-2', children: [
              jsx('span', {
                className: 'rounded px-2 py-0.5 text-xs font-bold ' +
                  (grafoArg.coverage_ratio >= 0.7 ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'),
                children: Math.round((grafoArg.coverage_ratio || 0) * 100) + '% cobertura argumentativa',
              }),
              grafoArg.has_complete_chain ? jsx('span', {
                className: 'rounded bg-violet-600 px-2 py-0.5 text-[10px] font-semibold text-white',
                children: '✓ Cadena Hecho → Norma → Conclusión',
              }) : null,
            ] }),
            onEnviarAPizarra && (grafoArg.nodes || []).length > 0 ? jsx('button', {
              type: 'button',
              onClick: volcarGrafoAPizarra,
              className: 'rounded bg-violet-700 hover:bg-violet-800 px-2.5 py-1 text-[11px] font-semibold text-white cursor-pointer',
              title: 'Crear tarjetas conectadas en la Pizarra Estratégica a partir de los párrafos del escrito',
              children: '↳ Enviar estructura a la Pizarra',
            }) : null,
          ] }),

          // Contadores por tipo
          jsxs('div', { className: 'flex flex-wrap gap-1.5', children:
            ['hecho', 'norma', 'prueba', 'conclusion', 'orphan'].map((t) => {
              const meta = META_NODO_ARG[t]
              const n = (grafoArg.counts && grafoArg.counts[t]) || 0
              return jsx('span', {
                key: t,
                className: 'rounded border px-2 py-0.5 text-[10px] font-semibold ' + meta.badge,
                children: `${meta.corto} · ${meta.label}: ${n}`,
              })
            }),
          }),

          // Lista de bloques clasificados
          jsxs('div', { className: 'flex flex-col gap-1.5', children:
            (grafoArg.nodes || []).map((n) => {
              const meta = META_NODO_ARG[n.node_type] || META_NODO_ARG.orphan
              return jsxs('div', {
                key: n.id,
                className: 'rounded border border-slate-200 bg-white p-2 text-[11px]',
                children: [
                  jsxs('div', { className: 'flex items-center justify-between gap-2 mb-1', children: [
                    jsx('span', { className: 'rounded border px-1.5 py-0.2 text-[9px] font-bold ' + meta.badge, children: meta.label }),
                    jsx('span', { className: 'text-[10px] text-slate-400', children: 'Párrafo ' + (n.paragraph_index + 1) }),
                  ] }),
                  jsx('div', { className: 'text-slate-700 leading-relaxed', children: n.text }),
                  (n.markers_found || []).length > 0 ? jsxs('div', { className: 'mt-1 flex flex-wrap gap-1', children:
                    n.markers_found.map((m, mi) => jsx('span', {
                      key: mi,
                      className: 'rounded bg-slate-100 px-1.5 py-0.2 font-mono text-[9px] text-slate-600',
                      children: '«' + m + '»',
                    })),
                  }) : null,
                ],
              })
            }),
          }),

          // Avisos de coherencia argumentativa
          (grafoArg.coherence_warnings || []).length > 0 ? jsxs('div', {
            className: 'flex flex-col gap-1 rounded border border-amber-200 bg-amber-50 p-2',
            children: [
              jsx('div', { className: 'text-[10px] font-bold uppercase text-amber-800', children: 'Avisos de estructura' }),
              ...(grafoArg.coherence_warnings || []).map((w, i) => jsx('div', {
                key: i,
                className: 'text-[11px] text-amber-900',
                children: '• ' + (w.message || w),
              })),
            ],
          }) : null,
        ] }) : null,
      ] }) : null,
    ],
  })
}
