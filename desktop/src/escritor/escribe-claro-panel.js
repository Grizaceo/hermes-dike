// Panel de Revisión de Estilo — LexO Escribe Claro (ScribeClaro):
// Analiza legibilidad, voz pasiva, nominalizaciones, arcaísmos judiciales y
// alineación judicial ("copiabilidad") + Grafo de Estructura Argumentativa
// (Hecho → Norma → Prueba → Conclusión) con envío directo a la Pizarra.

import { jsx, jsxs } from 'react/jsx-runtime'
import { useCallback, useEffect, useRef, useState } from 'react'
import { cancelarTarea, mensajeError, programarTimeout, rest, S } from '../common.js'
import { reemplazarRangos, textoDelEditor } from './editor.js'
import { COLORES_NOTA } from './pizarra-logica.js'
import { localizarCitas, rangoAPos, segmentosDeDoc } from './verificador.js'

const ETIQUETA_CAT = {
  arcaismo: 'Arcaísmos y fórmulas burocráticas',
  nominalizacion: 'Nominalizaciones verbales',
  legibilidad: 'Legibilidad y extensión',
  voz_pasiva: 'Voz pasiva',
  alineacion_judicial: 'Alineación judicial',
}

// Tonos de las categorías del grafo argumentativo: `color` es el papel de la
// ficha en la Pizarra (misma paleta pastel de notas, null = color por defecto)
// y `badge` la insignia de conteo/resumen.
const colorNota = (id) => {
  const c = COLORES_NOTA.find((x) => x.id === id)
  return c ? c.hex : null
}
const META_NODO_ARG = {
  hecho: { label: 'HECHO', corto: 'H', color: colorNota('verde'), badge: S.chip + ' ' + S.chipOk },
  norma: { label: 'NORMA', corto: 'N', color: colorNota('azul'), badge: S.chip + ' ' + S.chipInfo },
  prueba: { label: 'PRUEBA', corto: 'P', color: colorNota('naranja'), badge: S.chip + ' ' + S.chipWarn },
  conclusion: { label: 'CONCLUSIÓN', corto: 'C', color: colorNota('amarillo'), badge: S.chip + ' ' + S.chipAcento },
  orphan: { label: 'SIN TIPO', corto: '?', color: null, badge: S.chip + ' ' + S.chipOff },
}

function colorPuntaje(score) {
  if (score >= 75) return S.ok
  if (score >= 50) return S.warn
  return S.bad
}

function barraPuntaje(score) {
  if (score >= 75) return 'bg-(--dk-ok)'
  if (score >= 50) return 'bg-(--dk-aviso)'
  return 'bg-(--dk-mal)'
}

function FilaMetrica({ label, valor, sub, claseValor }) {
  return jsxs('div', {
    className: 'flex items-center justify-between border-b border-(--dk-borde-suave) py-1.5 text-xs last:border-0',
    children: [
      jsx('span', { className: 'text-(--dk-texto-2)', children: label }),
      jsxs('div', { className: 'flex items-center gap-1.5', children: [
        sub ? jsx('span', { className: 'text-xs text-(--dk-texto-3)', children: sub }) : null,
        jsx('span', { className: 'font-semibold ' + (claseValor || 'text-(--dk-texto)'), children: String(valor) }),
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
    className: 'flex flex-col gap-3 p-3 text-xs text-(--dk-texto)',
    children: [
      // Selector de sub-pestaña: Estilo y Claridad vs Teoría del Caso (Argumentos)
      jsxs('div', {
        className: 'flex items-center gap-1 rounded-md bg-(--dk-superficie-2) p-1 border border-(--dk-borde)',
        children: [
          jsx('button', {
            type: 'button',
            onClick: () => setSubTab('estilo'),
            'aria-pressed': subTab === 'estilo',
            className: 'flex-1 rounded py-1 text-xs font-semibold transition-colors cursor-pointer ' +
              (subTab === 'estilo' ? 'bg-(--dk-elevada) text-(--dk-texto) shadow-2xs' : 'text-(--dk-texto-2) hover:text-(--dk-texto)'),
            children: 'Estilo y Claridad',
          }),
          jsx('button', {
            type: 'button',
            onClick: () => setSubTab('argumentos'),
            'aria-pressed': subTab === 'argumentos',
            className: 'flex-1 rounded py-1 text-xs font-semibold transition-colors cursor-pointer ' +
              (subTab === 'argumentos' ? 'bg-(--dk-elevada) text-(--dk-texto) shadow-2xs' : 'text-(--dk-texto-2) hover:text-(--dk-texto)'),
            children: 'Estructura Argumentativa',
          }),
        ],
      }),

      // Controles de análisis
      jsxs('div', {
        className: 'flex flex-wrap items-center gap-2 rounded-md border border-(--dk-borde) bg-(--dk-superficie) p-2',
        children: [
          jsx('label', { className: 'text-xs font-medium text-(--dk-texto-2)', children: 'Contexto:' }),
          jsx('select', {
            value: contexto,
            onChange: (e) => {
              const nuevo = e.target.value
              setContexto(nuevo)
              ejecutarAnalisis(nuevo)
            },
            className: 'rounded border border-(--dk-borde) bg-(--dk-elevada) px-2 py-1 text-xs text-(--dk-texto-2)',
            children: [
              jsx('option', { key: 'escrito', value: 'escrito', children: 'Escrito judicial (máx. 30 pal/oración)' }),
              jsx('option', { key: 'demanda', value: 'demanda', children: 'Demanda (máx. 25 pal/oración)' }),
              jsx('option', { key: 'sentencia', value: 'sentencia', children: 'Sentencia (máx. 20 pal/oración)' }),
              jsx('option', { key: 'general', value: 'general', children: 'General (máx. 25 pal/oración)' }),
            ],
          }),
          jsxs('label', { className: 'flex items-center gap-1 text-xs text-(--dk-texto-2) ml-auto', children: [
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
            className: 'dk-btn dk-btn--primario',
            children: ocupado ? 'Analizando…' : 'Analizar ahora',
          }),
        ],
      }),

      error ? jsx('div', { className: S.noticeBad, children: mensajeError(error) }) : null,

      // ── VISTA 1: ESTILO Y CLARIDAD ──
      subTab === 'estilo' ? jsxs('div', { className: 'flex flex-col gap-3', children: [
        !resultado && !ocupado ? jsx('div', {
          className: 'rounded-md border border-dashed border-(--dk-borde) p-5 text-center text-xs text-(--dk-texto-3)',
          children: 'Pulsa «Analizar ahora» para evaluar legibilidad, voz pasiva, nominalizaciones, arcaísmos y alineación judicial con LexO Escribe Claro.',
        }) : null,

        resultado && !vistaOraciones ? jsxs('div', { className: 'flex flex-col gap-3', children: [
          // Medidor de puntaje global
          jsxs('div', {
            className: 'flex flex-col items-center rounded-md border border-(--dk-borde) bg-(--dk-superficie) p-3',
            children: [
              jsxs('div', { className: 'flex items-baseline gap-1', children: [
                jsx('span', { className: 'text-3xl font-black ' + colorPuntaje(resultado.score), children: String(resultado.score) }),
                jsx('span', { className: 'text-xs text-(--dk-texto-3)', children: '/ 100' }),
              ] }),
              jsx('span', { className: 'text-xs uppercase tracking-wider text-(--dk-texto-3) mt-0.5', children: 'Puntaje ScribeClaro de Claridad Jurídica' }),
              jsx('div', {
                className: 'mt-2 h-2 w-full overflow-hidden rounded-full bg-(--dk-superficie-2)',
                children: jsx('div', {
                  className: 'h-full rounded-full transition-all ' + barraPuntaje(resultado.score),
                  style: { width: Math.max(4, Math.min(100, resultado.score)) + '%' },
                }),
              }),
            ],
          }),

          // Métricas globales
          stats ? jsxs('div', {
            className: 'rounded-md border border-(--dk-borde) bg-(--dk-elevada) px-3 py-2',
            children: [
              jsx('div', { className: 'pb-1 dk-rotulo', children: 'Métricas del escrito' }),
              jsx(FilaMetrica, { label: 'Total de oraciones', valor: stats.total_sentences, sub: stats.total_words + ' palabras' }),
              jsx(FilaMetrica, {
                label: 'Promedio palabras / oración',
                valor: stats.avg_words_per_sentence,
                sub: 'máx. ' + stats.max_words_per_sentence,
                claseValor: stats.avg_words_per_sentence > stats.max_words_per_sentence ? S.warn : S.ok,
              }),
              jsx(FilaMetrica, {
                label: 'Oraciones que exceden el límite',
                valor: stats.sentences_exceeding_limit,
                claseValor: stats.sentences_exceeding_limit > 0 ? S.warn : S.ok,
              }),
              jsx(FilaMetrica, {
                label: 'Voz pasiva perifrástica',
                valor: Math.round((stats.passive_ratio || 0) * 100) + '%',
                claseValor: (stats.passive_ratio || 0) > 0.15 ? S.warn : S.ok,
              }),
              jsx(FilaMetrica, {
                label: 'Nominalizaciones detectadas',
                valor: stats.nominalization_count,
                claseValor: stats.nominalization_count > 0 ? S.warn : S.ok,
              }),
              jsx(FilaMetrica, {
                label: 'Arcaísmos y fórmulas burocráticas',
                valor: stats.archaism_count,
                claseValor: stats.archaism_count > 0 ? S.bad : S.ok,
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
            className: 'flex flex-col gap-2 rounded-md border border-(--dk-borde) bg-(--dk-elevada) p-2.5',
            children: [
              jsxs('div', { className: 'flex items-center justify-between', children: [
                jsx('span', { className: 'dk-rotulo', children: `Sugerencias (${sugerencias.length})` }),
                oraciones.length > 0 ? jsx('button', {
                  type: 'button',
                  onClick: () => setVistaOraciones(true),
                  className: S.link + ' font-medium',
                  children: `Ver desglose por oración (${oraciones.length}) →`,
                }) : null,
              ] }),
              sugerencias.length === 0
                ? jsx('div', { className: 'py-2 text-center text-xs ' + S.ok + ' font-medium', children: '✓ Sin observaciones de estilo — redacción clara y directa.' })
                : categorias.map((cat) => {
                    const lista = sugerencias.filter((s) => s.category === cat)
                    return jsxs('div', {
                      key: cat,
                      className: 'flex flex-col gap-1 border-t border-(--dk-borde-suave) pt-2 first:border-0 first:pt-0',
                      children: [
                        jsxs('div', { className: 'flex items-center gap-1.5', children: [
                          jsx('span', { className: S.chip, children: String(lista.length) }),
                          jsx('span', { className: 'text-xs font-semibold text-(--dk-texto-2)', children: ETIQUETA_CAT[cat] || cat }),
                        ] }),
                        ...lista.map((s, idx) => jsxs('div', {
                          key: idx,
                          className: 'flex flex-col gap-1 rounded border border-(--dk-borde) bg-(--dk-superficie) p-2 text-xs',
                          children: [
                            jsx('div', { className: 'text-(--dk-texto-2) leading-relaxed', children: s.message }),
                            s.term && s.replacement ? jsxs('div', { className: 'flex items-center gap-2 mt-0.5', children: [
                              jsx('button', {
                                type: 'button',
                                onClick: () => reemplazarTermino(s.term, s.replacement),
                                className: 'dk-btn dk-btn--borde dk-btn--chico',
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
            className: S.noticeWarn + ' flex flex-col gap-1',
            children: [
              jsx('div', { className: 'dk-rotulo', children: 'Observaciones de alineación y formato' }),
              ...(resultado.coherence_warnings || []).map((w, i) => jsx('div', {
                key: i,
                className: 'leading-relaxed',
                children: '• ' + w,
              })),
            ],
          }) : null,
        ] }) : null,

        // Vista detallada por oración
        resultado && vistaOraciones ? jsxs('div', { className: 'flex flex-col gap-2', children: [
          jsxs('div', { className: 'flex items-center justify-between border-b border-(--dk-borde) pb-1.5', children: [
            jsx('button', {
              type: 'button',
              onClick: () => setVistaOraciones(false),
              className: S.link + ' font-semibold',
              children: '← Volver al resumen',
            }),
            jsx('span', { className: 'text-xs text-(--dk-texto-3)', children: `${oraciones.length} oraciones analizadas` }),
          ] }),
          ...oraciones.map((o, idx) => {
            const tieneObs = o.exceeds_limit || o.is_passive || (o.nominalizations || []).length > 0 || (o.archaisms || []).length > 0
            return jsxs('div', {
              key: idx,
              className: 'rounded border p-2 text-xs ' +
                (tieneObs ? 'border-(--dk-aviso) bg-(--dk-superficie)' : 'border-(--dk-borde) bg-(--dk-elevada)'),
              children: [
                jsxs('div', { className: 'flex items-start gap-1.5', children: [
                  jsx('span', { className: 'font-mono text-xs text-(--dk-texto-3) shrink-0', children: '#' + (idx + 1) }),
                  jsx('div', { className: 'flex-1 text-(--dk-texto) leading-relaxed', children: o.text }),
                ] }),
                jsxs('div', { className: 'mt-1.5 flex flex-wrap gap-1', children: [
                  jsx('span', {
                    className: S.chip + ' ' + (o.exceeds_limit ? S.chipWarn : S.chipOk),
                    children: o.word_count + ' palabras' + (o.exceeds_limit ? ' (excede límite)' : ''),
                  }),
                  o.is_passive ? jsx('span', {
                    className: S.chip + ' ' + S.chipInfo,
                    children: 'Voz pasiva',
                  }) : null,
                  ...(o.nominalizations || []).map((n, ni) => jsx('span', {
                    key: 'n' + ni,
                    className: S.chip + ' ' + S.chipAcento,
                    children: `nominalización: ${n.noun_phrase} → ${n.suggested_verb}`,
                  })),
                  ...(o.archaisms || []).map((a, ai) => jsx('button', {
                    key: 'a' + ai,
                    type: 'button',
                    onClick: () => reemplazarTermino(a.term, a.replacement),
                    className: S.chip + ' ' + S.chipBad + ' cursor-pointer',
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
          className: 'rounded-md border border-dashed border-(--dk-borde) p-5 text-center text-xs text-(--dk-texto-3)',
          children: 'Pulsa «Analizar ahora» para extraer la cadena argumentativa (Hecho → Norma → Prueba → Conclusión) de los párrafos del escrito.',
        }) : null,

        grafoArg ? jsxs('div', { className: 'flex flex-col gap-2.5', children: [
          jsxs('div', { className: 'flex flex-wrap items-center justify-between gap-2 rounded-md border border-(--dk-borde) bg-(--dk-superficie) p-2.5', children: [
            jsxs('div', { className: 'flex items-center gap-2', children: [
              jsx('span', {
                className: S.chip + ' ' + (grafoArg.coverage_ratio >= 0.7 ? S.chipOk : S.chipWarn),
                children: Math.round((grafoArg.coverage_ratio || 0) * 100) + '% cobertura argumentativa',
              }),
              grafoArg.has_complete_chain ? jsx('span', {
                className: S.chip + ' ' + S.chipOk,
                children: '✓ Cadena Hecho → Norma → Conclusión',
              }) : null,
            ] }),
            onEnviarAPizarra && (grafoArg.nodes || []).length > 0 ? jsx('button', {
              type: 'button',
              onClick: volcarGrafoAPizarra,
              className: 'dk-btn dk-btn--borde',
              title: 'Crear tarjetas conectadas en la Pizarra Estratégica a partir de los párrafos del escrito',
              children: 'Enviar estructura a la Pizarra',
            }) : null,
          ] }),

          // Contadores por tipo
          jsxs('div', { className: 'flex flex-wrap gap-1.5', children:
            ['hecho', 'norma', 'prueba', 'conclusion', 'orphan'].map((t) => {
              const meta = META_NODO_ARG[t]
              const n = (grafoArg.counts && grafoArg.counts[t]) || 0
              return jsx('span', {
                key: t,
                className: 'rounded border px-2 py-0.5 text-xs font-semibold ' + meta.badge,
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
                className: 'rounded border border-(--dk-borde) bg-(--dk-elevada) p-2 text-xs',
                children: [
                  jsxs('div', { className: 'flex items-center justify-between gap-2 mb-1', children: [
                    jsx('span', { className: 'rounded border px-1.5 py-0.2 text-xs font-bold ' + meta.badge, children: meta.label }),
                    jsx('span', { className: 'text-xs text-(--dk-texto-3)', children: 'Párrafo ' + (n.paragraph_index + 1) }),
                  ] }),
                  jsx('div', { className: 'text-(--dk-texto-2) leading-relaxed', children: n.text }),
                  (n.markers_found || []).length > 0 ? jsxs('div', { className: 'mt-1 flex flex-wrap gap-1', children:
                    n.markers_found.map((m, mi) => jsx('span', {
                      key: mi,
                      className: 'rounded bg-(--dk-superficie-2) px-1.5 py-0.2 font-mono text-xs text-(--dk-texto-2)',
                      children: '«' + m + '»',
                    })),
                  }) : null,
                ],
              })
            }),
          }),

          // Avisos de coherencia argumentativa
          (grafoArg.coherence_warnings || []).length > 0 ? jsxs('div', {
            className: S.noticeWarn + ' flex flex-col gap-1',
            children: [
              jsx('div', { className: 'dk-rotulo', children: 'Avisos de estructura' }),
              ...(grafoArg.coherence_warnings || []).map((w, i) => jsx('div', {
                key: i,
                children: '• ' + (w.message || w),
              })),
            ],
          }) : null,
        ] }) : null,
      ] }) : null,
    ],
  })
}
