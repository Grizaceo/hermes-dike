import { etiquetaCodigo } from '../i18n.js'
// BuscadorCorpus: widget único de búsqueda en el corpus sellado (/grafo/buscar).
// Lo usan la Pizarra Estratégica (overlay flotante con debounce) y las
// Herramientas de Grafos (panel fijo con búsqueda manual y lector de
// artículo). Fetch, debounce, estados y la tarjeta de resultado viven aquí;
// cada contenedor aporta sus acciones por resultado vía `renderAcciones` y
// contenido extra (p. ej. el lector de artículo) vía `children`.

import { jsx, jsxs } from 'react/jsx-runtime'
import { useCallback, useEffect, useRef, useState } from 'react'
import { cancelarTarea, mensajeError, programarTimeout, rest, S } from '../common.js'
import { t } from '../i18n.js'

// /grafo/buscar emite vigencia como {estado, motivo}; otros endpoints la
// emiten como string. Normalizar al estado legible antes de pintar.
export const vigenciaEstado = (v) => (v && typeof v === 'object' ? v.estado : v) || null

// Insignia de vigencia lista para pintar; null si el resultado no la trae.
export function chipVigencia(v) {
  const e = vigenciaEstado(v)
  if (!e) return null
  return {
    clase: S.chip + ' ' + (e === 'IN_FORCE' ? S.chipOk : S.chipWarn),
    texto: etiquetaCodigo(e),
  }
}

export function BuscadorCorpus({
  limite = 12,
  debounceMs = 0,
  autoFoco = false,
  titulo = null,
  placeholder = t('busq.placeholder'),
  textoVacio = t('busq.vacio'),
  onCerrar = null,
  mostrarBuscar = false,
  children = null,
  renderAcciones = null,
}) {
  const [q, setQ] = useState('')
  const [resultados, setResultados] = useState([])
  const [arbol, setArbol] = useState(null)
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState(null)
  const timerRef = useRef(null)
  const seqRef = useRef(0)

  const ejecutar = useCallback((consulta) => {
    const limpio = (consulta || '').trim()
    if (!limpio) {
      seqRef.current += 1
      setResultados([])
      setArbol(null)
      setOcupado(false)
      return
    }
    const id = ++seqRef.current
    setOcupado(true)
    setError(null)
    rest('/grafo/buscar', {
      method: 'POST',
      body: { q: limpio, limite },
      timeoutMs: 120000,
    }).then((d) => {
      if (id !== seqRef.current) return
      setResultados((d && d.resultados) || [])
      setArbol((d && d.arbol) || null)
    }).catch((e) => {
      if (id !== seqRef.current) return
      setError(e)
      setResultados([])
    }).finally(() => {
      if (id === seqRef.current) setOcupado(false)
    })
  }, [limite])

  const buscar = useCallback(() => ejecutar(q), [ejecutar, q])

  const cambiar = (ev) => {
    const v = ev.target.value
    setQ(v)
    if (!debounceMs) return
    cancelarTarea(timerRef.current)
    timerRef.current = programarTimeout(() => ejecutar(v), debounceMs)
  }

  useEffect(() => () => cancelarTarea(timerRef.current), [])

  return jsxs('div', { className: 'flex min-h-0 flex-1 flex-col', children: [
    jsxs('div', { className: 'flex items-center gap-2 border-b border-(--dk-borde) px-3 py-2', children: [
      titulo ? jsx('span', { className: 'shrink-0 text-xs font-semibold text-(--dk-texto)', children: titulo }) : null,
      jsx('input', {
        className: 'min-w-0 flex-1 bg-transparent text-xs text-(--dk-texto) outline-none placeholder:text-(--dk-texto-3)',
        placeholder,
        value: q,
        autoFocus: autoFoco,
        onChange: cambiar,
        onKeyDown: (e) => { if (e.key === 'Enter') buscar() },
      }),
      mostrarBuscar ? jsx('button', {
        type: 'button',
        className: 'dk-btn dk-btn--primario dk-btn--chico shrink-0',
        disabled: ocupado || !q.trim(),
        onClick: buscar,
        children: ocupado ? '…' : t('busq.buscar'),
      }) : null,
      onCerrar ? jsx('button', {
        type: 'button',
        'aria-label': t('busq.cerrar'),
        className: 'dk-btn dk-btn--icono dk-btn--chico shrink-0',
        onClick: onCerrar,
        title: t('busq.cerrar'),
        children: '✕',
      }) : null,
    ] }),

    arbol && arbol.disponible && (arbol.clasificacion || []).length
      ? jsxs('div', { className: 'flex flex-wrap gap-1 border-b border-(--dk-borde-suave) px-3 py-1 text-xs text-(--dk-texto-2)', children: [
          jsx('span', { className: 'text-(--dk-texto-3)', children: t('busq.materias') }),
          ...(arbol.clasificacion || []).map((m, i) => jsx('span', {
            key: i,
            className: S.chip,
            children: m.nombre || m.nodo,
          })),
        ] })
      : null,

    children,

    jsxs('div', { className: 'flex-1 overflow-y-auto px-2.5 py-1.5 flex flex-col gap-1.5', children: [
      ocupado ? jsx('div', { className: 'py-4 text-center text-xs text-(--dk-texto-3)', children: t('busq.buscando') }) : null,
      error ? jsx('div', { className: S.noticeBad, children: mensajeError(error) }) : null,
      !ocupado && !error && resultados.length === 0 && q.trim()
        ? jsx('div', { className: 'py-4 text-center text-xs text-(--dk-texto-3)', children: t('busq.sinResultados', { q: q.trim() }) })
        : null,
      !ocupado && !q.trim()
        ? jsx('div', { className: 'py-3 text-center text-xs text-(--dk-texto-3)', children: textoVacio })
        : null,
      ...resultados.map((r, i) => {
        const vig = chipVigencia(r.vigencia)
        return jsxs('div', {
          key: (r.nodo_id || i),
          className: 'flex flex-col gap-1.5 rounded border border-(--dk-borde) bg-(--dk-elevada) p-2.5',
          children: [
            jsxs('div', { className: 'flex items-start justify-between gap-2', children: [
              jsxs('div', { className: 'min-w-0 flex-1', children: [
                jsx('div', { className: 'font-semibold text-(--dk-texto)', children: r.cita || r.label || r.gid }),
                jsx('div', { className: 'dk-mono text-(--dk-texto-3)', children: [r.nodo_id, r.gid].filter(Boolean).join(' · ') }),
              ] }),
              vig ? jsx('span', { className: vig.clase, children: vig.texto }) : null,
            ] }),
            r.snippet ? jsx('div', {
              className: 'text-xs text-(--dk-texto-2) leading-relaxed line-clamp-3',
              children: String(r.snippet).slice(0, 260),
            }) : null,
            renderAcciones ? jsx('div', {
              className: 'flex flex-wrap items-center gap-1.5 pt-1',
              children: renderAcciones(r),
            }) : null,
          ],
        })
      }),
    ] }),
  ] })
}
