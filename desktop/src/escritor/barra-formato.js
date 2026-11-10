// Barra superior tipo Word del Case Writer (2 filas, inspirada en el Case
// Writer original de Diké):
// Fila 1: Menú Archivo · Escribir/Leer · Selector de Documento/Caso + estado
//         de guardado · Deshacer/Rehacer · Tipografía y tamaño · Tema de hoja ·
//         Botón Verificar citas.
// Fila 2: Negrita, Cursiva, Tachado, Títulos H1–H3, Listas, Cita/Sangría,
//         Separador, inserción rápida de formalismos procesales y conteos.

import { jsx, jsxs } from 'react/jsx-runtime'
import { useEffect, useRef, useState } from 'react'
import { textoDelEditor } from './editor.js'

const FUENTES = [
  { label: 'Predeterminada (Serif)', value: "Georgia, 'Times New Roman', serif" },
  { label: 'Times New Roman', value: "'Times New Roman', Times, serif" },
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'Arial / Sans', value: 'Arial, Helvetica, sans-serif' },
  { label: 'Verdana', value: 'Verdana, Geneva, sans-serif' },
  { label: 'Courier New (Mono)', value: "'Courier New', Courier, monospace" },
]

const TAMANOS = ['10', '11', '12', '13', '14', '16', '18', '20']

const FORMALISMOS_RAPIDOS = [
  { label: 'EN LO PRINCIPAL:', texto: 'EN LO PRINCIPAL: ' },
  { label: 'PRIMER OTROSÍ:', texto: 'PRIMER OTROSÍ: ' },
  { label: 'SEGUNDO OTROSÍ:', texto: 'SEGUNDO OTROSÍ: ' },
  { label: 'S. J. L.', texto: 'S. J. L.\n\n' },
  { label: 'VISTOS:', texto: 'VISTOS:\n\n' },
  { label: 'CONSIDERANDO:', texto: 'CONSIDERANDO:\n\n' },
  { label: 'POR TANTO,', texto: 'POR TANTO,\nEn mérito de lo expuesto y de lo dispuesto en las normas citadas, RUEGO A US.: ' },
]

const TEXTO_GUARDADO = {
  cargando: { label: 'cargando…', cls: 'bg-slate-100 text-slate-500' },
  guardado: { label: 'guardado', cls: 'bg-emerald-50 text-emerald-700 border border-emerald-200' },
  guardando: { label: 'guardando…', cls: 'bg-sky-50 text-sky-700 border border-sky-200' },
  'sin-guardar': { label: 'sin guardar', cls: 'bg-amber-50 text-amber-700 border border-amber-200' },
  conflicto: { label: 'conflicto', cls: 'bg-red-50 text-red-700 border border-red-200' },
}

function Separador() {
  return jsx('div', { className: 'mx-1 h-5 w-px self-center bg-slate-300' })
}

function BotonBarra({ onClick, activo, disabled, title, children }) {
  return jsx('button', {
    type: 'button',
    onClick,
    disabled,
    title,
    className:
      'flex h-7 min-w-7 items-center justify-center rounded px-1.5 text-xs font-medium transition-colors cursor-pointer disabled:opacity-35 disabled:cursor-not-allowed ' +
      (activo
        ? 'bg-indigo-100 text-indigo-700 font-semibold'
        : 'text-slate-700 hover:bg-slate-200/80'),
    children,
  })
}

export function BarraFormato({
  editorRef,
  caseId,
  casos,
  onCambiarCaso,
  onCrearCaso,
  onSembrarDemoCaso,
  onCargarEscritoDemo,
  onGuardarAhora,
  estadoDoc,
  verificando,
  onVerificar,
  verificacion,
  modoVista,
  onCambiarModoVista,
  prefs,
  onCambiarPrefs,
  docInfo,
  onAbrirHerramienta,
}) {
  const [menuArchivo, setMenuArchivo] = useState(false)
  const [menuFormalismos, setMenuFormalismos] = useState(false)
  const [modalNuevoCaso, setModalNuevoCaso] = useState(false)
  const [nuevoCaseId, setNuevoCaseId] = useState('')
  const [nuevaPregunta, setNuevaPregunta] = useState('')
  const [, setTick] = useState(0)
  const refArchivo = useRef(null)
  const refFormalismo = useRef(null)

  const ed = editorRef && editorRef.current

  useEffect(() => {
    const cerrar = (ev) => {
      if (refArchivo.current && !refArchivo.current.contains(ev.target)) {
        setMenuArchivo(false)
      }
      if (refFormalismo.current && !refFormalismo.current.contains(ev.target)) {
        setMenuFormalismos(false)
      }
    }
    document.addEventListener('mousedown', cerrar)
    return () => document.removeEventListener('mousedown', cerrar)
  }, [])

  const comando = (fn) => {
    const editor = editorRef && editorRef.current
    if (!editor) return
    fn(editor)
    setTick((t) => t + 1)
  }

  const exportarArchivo = (ext, mime, contenido) => {
    const blob = new Blob([contenido], { type: mime + ';charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `escrito-${caseId || 'borrador'}.${ext}`
    a.click()
    URL.revokeObjectURL(url)
    setMenuArchivo(false)
  }

  const importarArchivoLocal = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.txt,.md,.html,.json'
    input.onchange = async (ev) => {
      const f = ev.target.files && ev.target.files[0]
      const editor = editorRef && editorRef.current
      if (!f || !editor) return
      const raw = await f.text()
      const ext = (f.name.split('.').pop() || '').toLowerCase()
      if (ext === 'json') {
        try {
          const parsed = JSON.parse(raw)
          editor.commands.setContent(parsed.html || parsed.texto || parsed)
        } catch {
          editor.commands.setContent(raw)
        }
      } else if (ext === 'html') {
        editor.commands.setContent(raw)
      } else {
        const html = raw
          .split(/\n\s*\n/)
          .filter((p) => p.trim())
          .map((p) => '<p>' + p.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</p>')
          .join('')
        editor.commands.setContent(html || '<p></p>')
      }
    }
    input.click()
    setMenuArchivo(false)
  }

  const opcionesCaso = [{ case_id: 'borrador', legal_question: 'borrador (sin caso)' }]
    .concat(casos || [])
  const infoGuardado = TEXTO_GUARDADO[estadoDoc] || { label: estadoDoc, cls: 'bg-slate-100 text-slate-600' }

  const textoPlano = (docInfo && docInfo.texto) || (ed ? textoDelEditor(ed) : '')
  const numPalabras = textoPlano.trim() ? textoPlano.trim().split(/\s+/).length : 0
  const metaVerif = (verificacion && verificacion.resultado && verificacion.resultado.meta) || null

  return jsxs('div', {
    className: 'flex flex-col border-b border-slate-300 bg-white text-slate-800 select-none shrink-0',
    children: [
      // ── FILA 1: Archivo · Escribir/Leer · Documento/Caso · Fuente/Tamaño · Verificar ──
      jsxs('div', {
        className: 'flex flex-wrap items-center gap-1 border-b border-slate-100 px-3 py-1',
        children: [
          // Menú Archivo
          jsxs('div', { ref: refArchivo, className: 'relative', children: [
            jsx('button', {
              type: 'button',
              onClick: () => setMenuArchivo((v) => !v),
              className: 'flex items-center gap-1 rounded px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 cursor-pointer',
              children: ['📄 Archivo ▾'],
            }),
            menuArchivo ? jsxs('div', {
              className: 'absolute left-0 top-full z-50 mt-1 w-64 rounded-md border border-slate-200 bg-white py-1 shadow-xl text-xs',
              children: [
                jsx('button', {
                  type: 'button',
                  onClick: () => {
                    if (onCargarEscritoDemo) onCargarEscritoDemo()
                    setMenuArchivo(false)
                  },
                  className: 'flex w-full items-center gap-2 px-3 py-2 text-left text-slate-700 hover:bg-slate-100',
                  children: ['✨ Cargar escrito de demostración (CT)'],
                }),
                jsx('button', {
                  type: 'button',
                  onClick: importarArchivoLocal,
                  className: 'flex w-full items-center gap-2 px-3 py-2 text-left text-slate-700 hover:bg-slate-100',
                  children: ['📂 Abrir archivo (.md, .txt, .html)…'],
                }),
                jsx('button', {
                  type: 'button',
                  onClick: () => {
                    if (onGuardarAhora) onGuardarAhora()
                    setMenuArchivo(false)
                  },
                  className: 'flex w-full items-center gap-2 px-3 py-2 text-left text-slate-700 hover:bg-slate-100',
                  children: ['💾 Guardar ahora'],
                }),
                jsx('div', { className: 'my-1 h-px bg-slate-200' }),
                jsx('button', {
                  type: 'button',
                  onClick: () => {
                    const editor = editorRef && editorRef.current
                    if (editor) exportarArchivo('md', 'text/markdown', textoDelEditor(editor))
                  },
                  className: 'flex w-full items-center gap-2 px-3 py-2 text-left text-slate-700 hover:bg-slate-100',
                  children: ['⬇ Exportar como Markdown (.md)'],
                }),
                jsx('button', {
                  type: 'button',
                  onClick: () => {
                    const editor = editorRef && editorRef.current
                    if (editor) exportarArchivo('txt', 'text/plain', textoDelEditor(editor))
                  },
                  className: 'flex w-full items-center gap-2 px-3 py-2 text-left text-slate-700 hover:bg-slate-100',
                  children: ['⬇ Exportar como Texto (.txt)'],
                }),
                jsx('button', {
                  type: 'button',
                  onClick: () => {
                    const editor = editorRef && editorRef.current
                    if (editor) exportarArchivo('html', 'text/html', editor.getHTML())
                  },
                  className: 'flex w-full items-center gap-2 px-3 py-2 text-left text-slate-700 hover:bg-slate-100',
                  children: ['⬇ Exportar como HTML (.html)'],
                }),
                jsx('div', { className: 'my-1 h-px bg-slate-200' }),
                jsx('button', {
                  type: 'button',
                  onClick: () => {
                    const editor = editorRef && editorRef.current
                    if (editor) editor.commands.setContent('<p></p>')
                    setMenuArchivo(false)
                  },
                  className: 'flex w-full items-center gap-2 px-3 py-2 text-left text-red-600 hover:bg-red-50',
                  children: ['🧹 Vaciar escrito actual'],
                }),
                jsx('button', {
                  type: 'button',
                  onClick: () => {
                    setMenuArchivo(false)
                    window.print()
                  },
                  className: 'flex w-full items-center gap-2 px-3 py-2 text-left text-slate-700 hover:bg-slate-100',
                  children: ['🖨 Imprimir / Guardar PDF'],
                }),
              ],
            }) : null,
          ] }),

          // Toggle Escribir | Leer (exactamente como en imagen 2)
          jsxs('div', {
            className: 'flex items-center gap-0.5 rounded-md bg-slate-100 p-0.5 border border-slate-200',
            children: [
              jsx('button', {
                type: 'button',
                onClick: () => onCambiarModoVista && onCambiarModoVista('write'),
                className: 'flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium transition-colors cursor-pointer ' +
                  (modoVista !== 'read' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-500 hover:text-slate-800'),
                children: ['✎ Escribir'],
              }),
              jsx('button', {
                type: 'button',
                onClick: () => onCambiarModoVista && onCambiarModoVista('read'),
                className: 'flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium transition-colors cursor-pointer ' +
                  (modoVista === 'read' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-500 hover:text-slate-800'),
                children: ['📖 Leer'],
              }),
            ],
          }),

          jsx(Separador, {}),

          // Selector de Documento / Caso + Crear caso
          jsxs('div', { className: 'flex items-center gap-1.5', children: [
            jsx('span', { className: 'text-xs text-slate-500', children: 'Documento' }),
            jsx('select', {
              value: caseId,
              onChange: (e) => onCambiarCaso && onCambiarCaso(e.target.value),
              ariaLabel: 'Documento o caso activo',
              className: 'h-7 max-w-56 rounded border border-slate-300 bg-white px-2 text-xs text-slate-800 outline-none focus:border-indigo-500',
              children: casos === null
                ? jsx('option', { value: caseId, children: 'Cargando casos…' })
                : opcionesCaso.map((c) => jsx('option', {
                    key: c.case_id,
                    value: c.case_id,
                    children: c.case_id === 'borrador'
                      ? 'default — borrador (sin caso)'
                      : c.case_id + (c.legal_question ? ' — ' + String(c.legal_question).slice(0, 48) : ''),
                  })),
            }),
            jsx('button', {
              type: 'button',
              onClick: () => setModalNuevoCaso((v) => !v),
              title: 'Crear o sembrar un caso NIF para vincular el escrito',
              className: 'flex h-7 w-7 items-center justify-center rounded border border-slate-300 bg-white text-xs text-slate-700 hover:bg-slate-100 cursor-pointer',
              children: '+',
            }),
            jsx('span', {
              className: 'rounded px-1.5 py-0.5 text-[10px] font-medium ' + infoGuardado.cls,
              children: infoGuardado.label,
            }),
          ] }),

          jsx(Separador, {}),

          // Deshacer / Rehacer
          jsx(BotonBarra, {
            title: 'Deshacer (Ctrl+Z)',
            disabled: !ed || !ed.can().undo(),
            onClick: () => comando((e) => e.chain().focus().undo().run()),
            children: '↶',
          }),
          jsx(BotonBarra, {
            title: 'Rehacer (Ctrl+Y)',
            disabled: !ed || !ed.can().redo(),
            onClick: () => comando((e) => e.chain().focus().redo().run()),
            children: '↷',
          }),

          jsx(Separador, {}),

          // Selector de fuente del papel
          jsx('select', {
            value: (prefs && prefs.fuente) || FUENTES[0].value,
            onChange: (e) => onCambiarPrefs && onCambiarPrefs({ fuente: e.target.value }),
            title: 'Tipografía de la hoja del escrito',
            className: 'h-7 max-w-40 rounded border border-slate-300 bg-white px-1.5 text-xs text-slate-700 cursor-pointer',
            children: FUENTES.map((f) => jsx('option', { key: f.label, value: f.value, children: f.label })),
          }),

          // Selector de tamaño de fuente
          jsx('select', {
            value: (prefs && prefs.tamano_fuente) || '12',
            onChange: (e) => onCambiarPrefs && onCambiarPrefs({ tamano_fuente: e.target.value }),
            title: 'Tamaño de letra (pt)',
            className: 'h-7 w-16 rounded border border-slate-300 bg-white px-1 text-xs text-slate-700 cursor-pointer',
            children: TAMANOS.map((t) => jsx('option', { key: t, value: t, children: t + ' pt' })),
          }),

          // Acciones rápidas a la derecha de la fila 1
          jsxs('div', { className: 'ml-auto flex items-center gap-1.5', children: [
            metaVerif ? jsx('button', {
              type: 'button',
              onClick: () => onAbrirHerramienta && onAbrirHerramienta('citas'),
              title: 'Abrir detalle de verificación de citas',
              className: 'rounded px-2 py-1 text-[11px] font-medium cursor-pointer ' +
                ((metaVerif.citas_fallidas || 0) > 0
                  ? 'bg-red-50 text-red-700 border border-red-200'
                  : 'bg-emerald-50 text-emerald-700 border border-emerald-200'),
              children: `✓ ${metaVerif.citas_verificadas || 0}/${metaVerif.total_citas || 0} citas`,
            }) : null,

            jsx('button', {
              type: 'button',
              onClick: onVerificar,
              disabled: verificando || estadoDoc === 'cargando',
              className: 'rounded-md bg-teal-700 hover:bg-teal-800 disabled:opacity-50 px-3 py-1 text-xs font-semibold text-white shadow-2xs cursor-pointer transition-colors',
              children: verificando ? 'Verificando…' : 'Verificar citas',
            }),

            jsx('button', {
              type: 'button',
              onClick: () => onAbrirHerramienta && onAbrirHerramienta('ajustes'),
              title: 'Configurar copilot jurídico (predicción) y personalización de vista',
              className: 'flex h-7 w-7 items-center justify-center rounded border border-slate-200 text-slate-600 hover:bg-slate-100 cursor-pointer',
              children: '⚙',
            }),
          ] }),
        ],
      }),

      // Modal inline para crear o sembrar un caso NIF desde la barra
      modalNuevoCaso ? jsxs('div', {
        className: 'flex flex-wrap items-center gap-2 border-b border-indigo-100 bg-indigo-50/70 px-3 py-1.5 text-xs',
        children: [
          jsx('span', { className: 'font-semibold text-indigo-800', children: 'Vincular caso NIF:' }),
          jsx('input', {
            value: nuevoCaseId,
            onChange: (e) => setNuevoCaseId(e.target.value),
            placeholder: 'id-del-caso (ej. causa-despido)',
            className: 'h-7 w-44 rounded border border-indigo-200 bg-white px-2 text-xs text-slate-800 outline-none',
          }),
          jsx('input', {
            value: nuevaPregunta,
            onChange: (e) => setNuevaPregunta(e.target.value),
            placeholder: 'Pregunta jurídica del caso…',
            className: 'h-7 flex-1 min-w-52 rounded border border-indigo-200 bg-white px-2 text-xs text-slate-800 outline-none',
          }),
          jsx('button', {
            type: 'button',
            disabled: !nuevoCaseId.trim() || !nuevaPregunta.trim(),
            onClick: () => {
              if (!onCrearCaso) return
              onCrearCaso(nuevoCaseId.trim(), nuevaPregunta.trim())
              setNuevoCaseId('')
              setNuevaPregunta('')
              setModalNuevoCaso(false)
            },
            className: 'rounded bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white disabled:opacity-40 cursor-pointer',
            children: 'Crear caso',
          }),
          onSembrarDemoCaso ? jsx('button', {
            type: 'button',
            onClick: () => {
              onSembrarDemoCaso()
              setModalNuevoCaso(false)
            },
            className: 'rounded border border-indigo-300 bg-white px-2.5 py-1 text-xs text-indigo-700 hover:bg-indigo-100 cursor-pointer',
            children: 'Cargar caso demo (CT)',
          }) : null,
          jsx('button', {
            type: 'button',
            onClick: () => setModalNuevoCaso(false),
            className: 'ml-auto text-slate-500 hover:text-slate-800 px-1',
            children: '✕',
          }),
        ],
      }) : null,

      // ── FILA 2: Formato de texto + Formalismos + Estadísticas rápidas ──
      jsxs('div', {
        className: 'flex flex-wrap items-center gap-0.5 px-3 py-1 bg-slate-50/50',
        children: [
          jsx(BotonBarra, {
            title: 'Negrita (Ctrl+B)',
            activo: ed && ed.isActive('bold'),
            onClick: () => comando((e) => e.chain().focus().toggleBold().run()),
            children: jsx('b', { className: 'font-serif text-sm', children: 'B' }),
          }),
          jsx(BotonBarra, {
            title: 'Cursiva (Ctrl+I)',
            activo: ed && ed.isActive('italic'),
            onClick: () => comando((e) => e.chain().focus().toggleItalic().run()),
            children: jsx('i', { className: 'font-serif text-sm', children: 'I' }),
          }),
          jsx(BotonBarra, {
            title: 'Tachado',
            activo: ed && ed.isActive('strike'),
            onClick: () => comando((e) => e.chain().focus().toggleStrike().run()),
            children: jsx('s', { className: 'font-serif text-sm', children: 'S' }),
          }),

          jsx(Separador, {}),

          jsx(BotonBarra, {
            title: 'Título 1',
            activo: ed && ed.isActive('heading', { level: 1 }),
            onClick: () => comando((e) => e.chain().focus().toggleHeading({ level: 1 }).run()),
            children: 'H₁',
          }),
          jsx(BotonBarra, {
            title: 'Título 2',
            activo: ed && ed.isActive('heading', { level: 2 }),
            onClick: () => comando((e) => e.chain().focus().toggleHeading({ level: 2 }).run()),
            children: 'H₂',
          }),
          jsx(BotonBarra, {
            title: 'Título 3',
            activo: ed && ed.isActive('heading', { level: 3 }),
            onClick: () => comando((e) => e.chain().focus().toggleHeading({ level: 3 }).run()),
            children: 'H₃',
          }),
          jsx(BotonBarra, {
            title: 'Párrafo normal',
            activo: ed && ed.isActive('paragraph'),
            onClick: () => comando((e) => e.chain().focus().setParagraph().run()),
            children: '¶',
          }),

          jsx(Separador, {}),

          jsx(BotonBarra, {
            title: 'Lista con viñetas',
            activo: ed && ed.isActive('bulletList'),
            onClick: () => comando((e) => e.chain().focus().toggleBulletList().run()),
            children: '• Lista',
          }),
          jsx(BotonBarra, {
            title: 'Lista numerada',
            activo: ed && ed.isActive('orderedList'),
            onClick: () => comando((e) => e.chain().focus().toggleOrderedList().run()),
            children: '1. Lista',
          }),
          jsx(BotonBarra, {
            title: 'Bloque de cita / sangría',
            activo: ed && ed.isActive('blockquote'),
            onClick: () => comando((e) => e.chain().focus().toggleBlockquote().run()),
            children: '❝ Cita',
          }),
          jsx(BotonBarra, {
            title: 'Línea divisoria horizontal',
            onClick: () => comando((e) => e.chain().focus().setHorizontalRule().run()),
            children: '―',
          }),

          jsx(Separador, {}),

          // Menú de inserción rápida de formalismos procesales
          jsxs('div', { ref: refFormalismo, className: 'relative', children: [
            jsx('button', {
              type: 'button',
              onClick: () => setMenuFormalismos((v) => !v),
              className: 'flex h-7 items-center gap-1 rounded border border-slate-200 bg-white px-2 text-[11px] font-medium text-slate-700 hover:bg-slate-100 cursor-pointer',
              title: 'Insertar encabezado o fórmula procesal chilena',
              children: ['§ Formalismo ▾'],
            }),
            menuFormalismos ? jsxs('div', {
              className: 'absolute left-0 top-full z-40 mt-1 w-56 rounded-md border border-slate-200 bg-white py-1 shadow-xl text-xs',
              children: FORMALISMOS_RAPIDOS.map((f) => jsx('button', {
                key: f.label,
                type: 'button',
                onClick: () => {
                  comando((e) => e.chain().focus().insertContent(f.texto).run())
                  setMenuFormalismos(false)
                },
                className: 'flex w-full items-center px-3 py-1.5 text-left font-mono text-[11px] text-slate-700 hover:bg-slate-100',
                children: f.label,
              })),
            }) : null,
          ] }),

          // Cargar escrito demo rápido si el documento está vacío
          numPalabras === 0 && onCargarEscritoDemo ? jsx('button', {
            type: 'button',
            onClick: onCargarEscritoDemo,
            className: 'ml-1 rounded border border-teal-200 bg-teal-50 px-2 py-0.5 text-[11px] font-medium text-teal-800 hover:bg-teal-100 cursor-pointer',
            children: '✨ Cargar escrito demo',
          }) : null,

          // Resumen rápido a la derecha de la fila 2
          jsxs('div', {
            className: 'ml-auto flex items-center gap-3 text-[11px] text-slate-500',
            children: [
              jsx('span', { children: `${numPalabras} palabras` }),
              jsx('button', {
                type: 'button',
                onClick: () => onAbrirHerramienta && onAbrirHerramienta('estilo'),
                className: 'text-teal-700 hover:underline cursor-pointer font-medium',
                title: 'Abrir revisión de estilo LexO Escribe Claro',
                children: '✍ Escribe Claro',
              }),
              jsx('button', {
                type: 'button',
                onClick: () => onAbrirHerramienta && onAbrirHerramienta('privacidad'),
                className: 'text-amber-700 hover:underline cursor-pointer font-medium',
                title: 'Abrir control de seudonimización y privacidad',
                children: '🛡 Privacidad',
              }),
            ],
          }),
        ],
      }),
    ],
  })
}
