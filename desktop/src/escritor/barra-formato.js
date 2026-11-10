import { t } from '../i18n.js'
// Barra superior tipo Word del Case Writer (2 filas, inspirada en el Case
// Writer original de Diké):
// Fila 1: Menú Archivo · Escribir/Leer · Selector de Documento/Caso + estado
//         de guardado · Deshacer/Rehacer · Tipografía y tamaño · Tema de hoja ·
//         Botón Verificar citas.
// Fila 2: Negrita, Cursiva, Tachado, Títulos H1–H3, Listas, Cita/Sangría,
//         Separador, inserción rápida de formalismos procesales y conteos.

import { jsx, jsxs } from 'react/jsx-runtime'
import { useEffect, useRef, useState } from 'react'
import { S } from '../common.js'
import { textoDelEditor } from './editor.js'

const FUENTES = [
  { get label() { return t('format.default.serif') }, value: "Georgia, 'Times New Roman', serif" },
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
  cargando: { get label() { return t('format.loading.label') }, cls: S.chip + ' ' + S.chipOff },
  guardado: { get label() { return t('format.saved') }, cls: S.chip + ' ' + S.chipOk },
  guardando: { get label() { return t('format.saving') }, cls: S.chip + ' ' + S.chipInfo },
  'sin-guardar': { get label() { return t('format.unsaved') }, cls: S.chip + ' ' + S.chipWarn },
  conflicto: { get label() { return t('format.save.conflict') }, cls: S.chip + ' ' + S.chipBad },
}

function Separador() {
  return jsx('div', { className: 'mx-1 h-5 w-px self-center bg-(--dk-superficie-2)' })
}

function BotonBarra({ onClick, activo, disabled, title, children }) {
  return jsx('button', {
    type: 'button',
    onClick,
    disabled,
    title,
    // aria-pressed solo en botones de alternancia; las acciones (↶, ―…)
    // no lo llevan. dk-btn toma el estado activo de aria-pressed.
    'aria-pressed': activo === undefined ? undefined : Boolean(activo),
    className: 'dk-btn',
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

  const opcionesCaso = [{ case_id: 'borrador', legal_question: t('format.draft.no.case') }]
    .concat(casos || [])
  const infoGuardado = TEXTO_GUARDADO[estadoDoc] || { label: estadoDoc, cls: 'bg-(--dk-superficie-2) text-(--dk-texto-2)' }

  const textoPlano = (docInfo && docInfo.texto) || (ed ? textoDelEditor(ed) : '')
  const numPalabras = textoPlano.trim() ? textoPlano.trim().split(/\s+/).length : 0
  const metaVerif = (verificacion && verificacion.resultado && verificacion.resultado.meta) || null

  return jsxs('div', {
    className: 'flex flex-col border-b border-(--dk-borde) bg-(--dk-elevada) text-(--dk-texto) select-none shrink-0',
    children: [
      // ── FILA 1: Archivo · Escribir/Leer · Documento/Caso · Fuente/Tamaño · Verificar ──
      jsxs('div', {
        className: 'flex flex-wrap items-center gap-1 border-b border-(--dk-borde-suave) px-3 py-1',
        children: [
          // Menú Archivo
          jsxs('div', { ref: refArchivo, className: 'relative', children: [
            jsx('button', {
              type: 'button',
              onClick: () => setMenuArchivo((v) => !v),
              'aria-expanded': menuArchivo,
              className: 'dk-btn',
              children: [t('format.file')],
            }),
            menuArchivo ? jsxs('div', {
              className: 'absolute left-0 top-full z-50 mt-1 w-64 rounded-md border border-(--dk-borde) bg-(--dk-elevada) py-1 shadow-xl text-xs',
              children: [
                jsx('button', {
                  type: 'button',
                  onClick: () => {
                    if (onCargarEscritoDemo) onCargarEscritoDemo()
                    setMenuArchivo(false)
                  },
                  className: 'flex w-full items-center gap-2 px-3 py-2 text-left text-(--dk-texto-2) hover:bg-(--dk-sobre)',
                  children: [t('format.load.demo.brief.ct')],
                }),
                jsx('button', {
                  type: 'button',
                  onClick: importarArchivoLocal,
                  className: 'flex w-full items-center gap-2 px-3 py-2 text-left text-(--dk-texto-2) hover:bg-(--dk-sobre)',
                  children: [t('format.open.file.md.txt.html')],
                }),
                jsx('button', {
                  type: 'button',
                  onClick: () => {
                    if (onGuardarAhora) onGuardarAhora()
                    setMenuArchivo(false)
                  },
                  className: 'flex w-full items-center gap-2 px-3 py-2 text-left text-(--dk-texto-2) hover:bg-(--dk-sobre)',
                  children: [t('format.save.now')],
                }),
                jsx('div', { className: 'my-1 h-px bg-(--dk-superficie-2)' }),
                jsx('button', {
                  type: 'button',
                  onClick: () => {
                    const editor = editorRef && editorRef.current
                    if (editor) exportarArchivo('md', 'text/markdown', textoDelEditor(editor))
                  },
                  className: 'flex w-full items-center gap-2 px-3 py-2 text-left text-(--dk-texto-2) hover:bg-(--dk-sobre)',
                  children: [t('format.export.markdown.md')],
                }),
                jsx('button', {
                  type: 'button',
                  onClick: () => {
                    const editor = editorRef && editorRef.current
                    if (editor) exportarArchivo('txt', 'text/plain', textoDelEditor(editor))
                  },
                  className: 'flex w-full items-center gap-2 px-3 py-2 text-left text-(--dk-texto-2) hover:bg-(--dk-sobre)',
                  children: [t('format.export.text.txt')],
                }),
                jsx('button', {
                  type: 'button',
                  onClick: () => {
                    const editor = editorRef && editorRef.current
                    if (editor) exportarArchivo('html', 'text/html', editor.getHTML())
                  },
                  className: 'flex w-full items-center gap-2 px-3 py-2 text-left text-(--dk-texto-2) hover:bg-(--dk-sobre)',
                  children: [t('format.export.html.html')],
                }),
                jsx('div', { className: 'my-1 h-px bg-(--dk-superficie-2)' }),
                jsx('button', {
                  type: 'button',
                  onClick: () => {
                    const editor = editorRef && editorRef.current
                    if (editor) editor.commands.setContent('<p></p>')
                    setMenuArchivo(false)
                  },
                  className: 'flex w-full items-center gap-2 px-3 py-2 text-left ' + S.bad + ' hover:bg-(--dk-sobre)',
                  children: [t('format.clear.brief')],
                }),
                jsx('button', {
                  type: 'button',
                  onClick: () => {
                    setMenuArchivo(false)
                    window.print()
                  },
                  className: 'flex w-full items-center gap-2 px-3 py-2 text-left text-(--dk-texto-2) hover:bg-(--dk-sobre)',
                  children: [t('format.print.save.pdf')],
                }),
              ],
            }) : null,
          ] }),

          // Toggle Escribir | Leer (exactamente como en imagen 2)
          jsxs('div', {
            className: 'flex items-center gap-0.5 rounded-md bg-(--dk-superficie-2) p-0.5 border border-(--dk-borde)',
            children: [
              jsx('button', {
                type: 'button',
                onClick: () => onCambiarModoVista && onCambiarModoVista('write'),
                'aria-pressed': modoVista !== 'read',
                className: 'flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium transition-colors cursor-pointer ' +
                  (modoVista !== 'read' ? 'bg-(--dk-elevada) text-(--dk-texto) shadow-2xs' : 'text-(--dk-texto-3) hover:text-(--dk-texto)'),
                children: [t('format.write')],
              }),
              jsx('button', {
                type: 'button',
                onClick: () => onCambiarModoVista && onCambiarModoVista('read'),
                'aria-pressed': modoVista === 'read',
                className: 'flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium transition-colors cursor-pointer ' +
                  (modoVista === 'read' ? 'bg-(--dk-elevada) text-(--dk-texto) shadow-2xs' : 'text-(--dk-texto-3) hover:text-(--dk-texto)'),
                children: [t('format.read')],
              }),
            ],
          }),

          jsx(Separador, {}),

          // Selector de Documento / Caso + Crear caso
          jsxs('div', { className: 'flex items-center gap-1.5', children: [
            jsx('span', { className: 'text-xs text-(--dk-texto-3)', children: t('format.brief.label') }),
            jsx('select', {
              value: caseId,
              onChange: (e) => onCambiarCaso && onCambiarCaso(e.target.value),
              ariaLabel: t('format.active.brief.or.case'),
              className: 'h-7 max-w-56 rounded border border-(--dk-borde) bg-(--dk-elevada) px-2 text-xs text-(--dk-texto) outline-none focus:border-(--dk-acento)',
              children: casos === null
                ? jsx('option', { value: caseId, children: t('format.loading.cases') })
                : opcionesCaso.map((c) => jsx('option', {
                    key: c.case_id,
                    value: c.case_id,
                    children: c.case_id === 'borrador'
                      ? t('format.default.draft.no.case')
                      : c.case_id + (c.legal_question ? ' — ' + String(c.legal_question).slice(0, 48) : ''),
                  })),
            }),
            jsx('button', {
              type: 'button',
              onClick: () => setModalNuevoCaso((v) => !v),
              title: t('format.create.or.load.a.case.for.this.brief'),
              className: 'dk-btn dk-btn--icono',
              'aria-label': t('format.create.or.link.a.case'),
              children: '+',
            }),
            jsx('span', {
              role: 'status',
              className: infoGuardado.cls,
              children: infoGuardado.label,
            }),
          ] }),

          jsx(Separador, {}),

          // Deshacer / Rehacer
          jsx(BotonBarra, {
            title: t('format.undo.ctrl.z'),
            disabled: !ed || !ed.can().undo(),
            onClick: () => comando((e) => e.chain().focus().undo().run()),
            children: '↶',
          }),
          jsx(BotonBarra, {
            title: t('format.redo.ctrl.y'),
            disabled: !ed || !ed.can().redo(),
            onClick: () => comando((e) => e.chain().focus().redo().run()),
            children: '↷',
          }),

          jsx(Separador, {}),

          // Selector de fuente del papel
          jsx('select', {
            value: (prefs && prefs.fuente) || FUENTES[0].value,
            onChange: (e) => onCambiarPrefs && onCambiarPrefs({ fuente: e.target.value }),
            title: t('format.brief.font'),
            className: 'h-7 max-w-40 rounded border border-(--dk-borde) bg-(--dk-elevada) px-1.5 text-xs text-(--dk-texto-2) cursor-pointer',
            children: FUENTES.map((f) => jsx('option', { key: f.label, value: f.value, children: f.label })),
          }),

          // Selector de tamaño de fuente
          jsx('select', {
            value: (prefs && prefs.tamano_fuente) || '12',
            onChange: (e) => onCambiarPrefs && onCambiarPrefs({ tamano_fuente: e.target.value }),
            title: t('format.font.size.pt'),
            className: 'h-7 w-16 rounded border border-(--dk-borde) bg-(--dk-elevada) px-1 text-xs text-(--dk-texto-2) cursor-pointer',
            children: TAMANOS.map((t) => jsx('option', { key: t, value: t, children: t + ' pt' })),
          }),

          // Acciones rápidas a la derecha de la fila 1
          jsxs('div', { className: 'ml-auto flex items-center gap-1.5', children: [
            metaVerif ? jsx('button', {
              type: 'button',
              onClick: () => onAbrirHerramienta && onAbrirHerramienta('citas'),
              title: t('format.open.citation.details'),
              className: S.chip + ' ' +
                ((metaVerif.citas_fallidas || 0) > 0 ? S.chipBad : S.chipOk) +
                ' cursor-pointer',
              children: t('format.citationCount', { ok: metaVerif.citas_verificadas || 0, total: metaVerif.total_citas || 0 }),
            }) : null,

            jsx('button', {
              type: 'button',
              onClick: onVerificar,
              disabled: verificando || estadoDoc === 'cargando',
              className: 'dk-btn dk-btn--primario',
              children: verificando ? t('writer.checking') : t('writer.check.citations'),
            }),

            jsx('button', {
              type: 'button',
              onClick: () => onAbrirHerramienta && onAbrirHerramienta('ajustes'),
              title: t('format.configure.suggestions.and.appearance'),
              'aria-label': t('format.writer.settings'),
              className: 'dk-btn dk-btn--chico',
              children: t('format.settings'),
            }),
          ] }),
        ],
      }),

      // Modal inline para crear o sembrar un caso NIF desde la barra
      modalNuevoCaso ? jsxs('div', {
        className: 'flex flex-wrap items-center gap-2 border-b border-(--dk-borde-suave) bg-(--dk-superficie) px-3 py-1.5 text-xs',
        children: [
          jsx('span', { className: 'font-semibold text-(--dk-texto)', children: t('format.link.a.case') }),
          jsx('input', {
            value: nuevoCaseId,
            onChange: (e) => setNuevoCaseId(e.target.value),
            placeholder: t('format.case.id.e.g.dismissal.case'),
            className: 'dk-campo w-44',
          }),
          jsx('input', {
            value: nuevaPregunta,
            onChange: (e) => setNuevaPregunta(e.target.value),
            placeholder: t('format.case.s.legal.question'),
            className: 'dk-campo flex-1 min-w-52',
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
            className: 'dk-btn dk-btn--primario',
            children: t('format.create.case'),
          }),
          onSembrarDemoCaso ? jsx('button', {
            type: 'button',
            onClick: () => {
              onSembrarDemoCaso()
              setModalNuevoCaso(false)
            },
            className: 'dk-btn dk-btn--borde',
            children: t('format.load.demo.case.ct'),
          }) : null,
          jsx('button', {
            type: 'button',
            onClick: () => setModalNuevoCaso(false),
            'aria-label': t('format.close'),
            className: 'dk-btn dk-btn--icono ml-auto',
            children: '✕',
          }),
        ],
      }) : null,

      // ── FILA 2: Formato de texto + Formalismos + Estadísticas rápidas ──
      jsxs('div', {
        className: 'flex flex-wrap items-center gap-0.5 px-3 py-1 bg-(--dk-superficie)',
        children: [
          jsx(BotonBarra, {
            title: t('format.bold.ctrl.b'),
            activo: ed && ed.isActive('bold'),
            onClick: () => comando((e) => e.chain().focus().toggleBold().run()),
            children: jsx('b', { className: 'font-serif text-sm', children: 'B' }),
          }),
          jsx(BotonBarra, {
            title: t('format.italic.ctrl.i'),
            activo: ed && ed.isActive('italic'),
            onClick: () => comando((e) => e.chain().focus().toggleItalic().run()),
            children: jsx('i', { className: 'font-serif text-sm', children: 'I' }),
          }),
          jsx(BotonBarra, {
            title: t('format.strikethrough'),
            activo: ed && ed.isActive('strike'),
            onClick: () => comando((e) => e.chain().focus().toggleStrike().run()),
            children: jsx('s', { className: 'font-serif text-sm', children: 'S' }),
          }),

          jsx(Separador, {}),

          jsx(BotonBarra, {
            title: t('format.heading.1'),
            activo: ed && ed.isActive('heading', { level: 1 }),
            onClick: () => comando((e) => e.chain().focus().toggleHeading({ level: 1 }).run()),
            children: 'H₁',
          }),
          jsx(BotonBarra, {
            title: t('format.heading.2'),
            activo: ed && ed.isActive('heading', { level: 2 }),
            onClick: () => comando((e) => e.chain().focus().toggleHeading({ level: 2 }).run()),
            children: 'H₂',
          }),
          jsx(BotonBarra, {
            title: t('format.heading.3'),
            activo: ed && ed.isActive('heading', { level: 3 }),
            onClick: () => comando((e) => e.chain().focus().toggleHeading({ level: 3 }).run()),
            children: 'H₃',
          }),
          jsx(BotonBarra, {
            title: t('format.paragraph'),
            activo: ed && ed.isActive('paragraph'),
            onClick: () => comando((e) => e.chain().focus().setParagraph().run()),
            children: '¶',
          }),

          jsx(Separador, {}),

          jsx(BotonBarra, {
            title: t('format.bullet.list'),
            activo: ed && ed.isActive('bulletList'),
            onClick: () => comando((e) => e.chain().focus().toggleBulletList().run()),
            children: t('format.list'),
          }),
          jsx(BotonBarra, {
            title: t('format.numbered.list'),
            activo: ed && ed.isActive('orderedList'),
            onClick: () => comando((e) => e.chain().focus().toggleOrderedList().run()),
            children: t('format.1.list'),
          }),
          jsx(BotonBarra, {
            title: t('format.block.quote'),
            activo: ed && ed.isActive('blockquote'),
            onClick: () => comando((e) => e.chain().focus().toggleBlockquote().run()),
            children: t('format.quote'),
          }),
          jsx(BotonBarra, {
            title: t('format.horizontal.rule'),
            onClick: () => comando((e) => e.chain().focus().setHorizontalRule().run()),
            children: '―',
          }),

          jsx(Separador, {}),

          // Menú de inserción rápida de formalismos procesales
          jsxs('div', { ref: refFormalismo, className: 'relative', children: [
            jsx('button', {
              type: 'button',
              onClick: () => setMenuFormalismos((v) => !v),
              'aria-expanded': menuFormalismos,
              className: 'dk-btn dk-btn--borde',
              title: t('format.insert.a.chilean.pleading.formula'),
              children: [t('format.pleading.formulas')],
            }),
            menuFormalismos ? jsxs('div', {
              className: 'absolute left-0 top-full z-40 mt-1 w-56 rounded-md border border-(--dk-borde) bg-(--dk-elevada) py-1 shadow-xl text-xs',
              children: FORMALISMOS_RAPIDOS.map((f) => jsx('button', {
                key: f.label,
                type: 'button',
                onClick: () => {
                  comando((e) => e.chain().focus().insertContent(f.texto).run())
                  setMenuFormalismos(false)
                },
                className: 'flex w-full items-center px-3 py-1.5 text-left font-mono text-xs text-(--dk-texto-2) hover:bg-(--dk-sobre)',
                children: f.label,
              })),
            }) : null,
          ] }),

          // Cargar escrito demo rápido si el documento está vacío
          numPalabras === 0 && onCargarEscritoDemo ? jsx('button', {
            type: 'button',
            onClick: onCargarEscritoDemo,
            className: 'dk-btn dk-btn--borde dk-btn--chico ml-1',
            children: t('format.load.demo.brief.label'),
          }) : null,

          // Resumen rápido a la derecha de la fila 2
          jsxs('div', {
            className: 'ml-auto flex items-center gap-3 text-xs text-(--dk-texto-3)',
            children: [
              jsx('span', { children: t('format.words', { n: numPalabras }) }),
              jsx('button', {
                type: 'button',
                onClick: () => onAbrirHerramienta && onAbrirHerramienta('estilo'),
                className: S.link + ' font-medium',
                title: t('format.open.plain.language.review'),
                children: t('format.style'),
              }),
              jsx('button', {
                type: 'button',
                onClick: () => onAbrirHerramienta && onAbrirHerramienta('privacidad'),
                className: S.link + ' font-medium',
                title: t('format.open.privacy.settings'),
                children: t('format.privacy'),
              }),
            ],
          }),
        ],
      }),
    ],
  })
}
