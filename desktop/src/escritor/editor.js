// Montaje del editor Tiptap del Case Writer (variante B: Editor plano, sin
// @tiptap/react ni react-dom) + plugin de marcas de citas y placeholder
// visible sin CSS externo (Decoration.widget, como en la variante C del probe).

import { Editor, Extension } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

export const SEPARADOR = '\n'

// --- Marcas de citas (Decoration.inline por estado) ---------------------------

const claveMarcas = new PluginKey('dike-marcas-citas')

// Sin hoja de estilo: colores inline sobre las vars del tema con fallback.
const ESTILOS_MARCA = {
  verificada:
    'background:rgba(34,197,94,.18);border-bottom:2px solid var(--ui-success,rgb(34,197,94));border-radius:2px',
  fallo:
    'background:rgba(239,68,68,.14);border-bottom:2px solid var(--ui-danger,rgb(239,68,68));border-radius:2px',
  desactualizada:
    'border-bottom:2px dotted var(--ui-stroke-tertiary,rgb(156,163,175));opacity:.7',
  escalada:
    'border-bottom:2px solid var(--ui-accent,rgb(139,92,246));border-radius:2px',
}

const MarcasCitas = Extension.create({
  name: 'dikeMarcasCitas',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: claveMarcas,
        state: {
          init: () => [],
          apply(tr, marcas) {
            const nuevas = tr.getMeta(claveMarcas)
            if (nuevas) return nuevas
            if (!tr.docChanged || !marcas.length) return marcas
            // El doc cambió sin actualizar marcas: remapear para no quedar
            // desalineadas hasta que la UI recalcule estados. Defensa en esta
            // misma capa: nada queda 'verificada' sobre texto modificado.
            const remapeadas = []
            for (const m of marcas) {
              const from = tr.mapping.map(m.from, 1)
              const to = tr.mapping.map(m.to, -1)
              if (from < to) {
                remapeadas.push({
                  ...m, from, to,
                  estado: m.estado === 'verificada' ? 'desactualizada' : m.estado,
                })
              }
            }
            return remapeadas
          },
        },
        props: {
          decorations(state) {
            const marcas = claveMarcas.getState(state) || []
            const decos = []
            for (const m of marcas) {
              if (m.from >= m.to) continue
              decos.push(Decoration.inline(m.from, m.to, {
                class: 'dike-cita-' + m.estado,
                style: ESTILOS_MARCA[m.estado] || '',
              }))
            }
            return DecorationSet.create(state.doc, decos)
          },
        },
      }),
    ]
  },
})

// marcas: [{from, to, estado}] en posiciones ProseMirror.
export function fijarMarcas(editor, marcas) {
  editor.view.dispatch(editor.state.tr.setMeta(claveMarcas, marcas))
}

// --- Marcas de privacidad (otra PluginKey; subrayado punteado por severidad) --
// No pisa las marcas de citas: es otro set de decorations con estilo propio.

const clavePriv = new PluginKey('dike-marcas-privacidad')

const ESTILOS_PRIV = {
  critical: 'border-bottom:2px dotted rgb(220,38,38);border-radius:2px',
  high: 'border-bottom:2px dotted rgb(217,119,6);border-radius:2px',
  medium: 'border-bottom:1px dotted rgb(107,114,128);border-radius:2px',
  low: 'border-bottom:1px dotted rgb(156,163,175);border-radius:2px',
  conservada: 'border-bottom:2px dotted rgb(34,197,94);border-radius:2px',
  candidato: 'background:rgba(217,119,6,.10);border-bottom:1px dashed rgb(217,119,6);border-radius:2px',
}

const MarcasPrivacidad = Extension.create({
  name: 'dikeMarcasPrivacidad',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: clavePriv,
        state: {
          init: () => [],
          apply(tr, marcas) {
            const nuevas = tr.getMeta(clavePriv)
            if (nuevas) return nuevas
            if (!tr.docChanged || !marcas.length) return marcas
            const remapeadas = []
            for (const m of marcas) {
              const from = tr.mapping.map(m.from, 1)
              const to = tr.mapping.map(m.to, -1)
              if (from < to) remapeadas.push({ ...m, from, to })
            }
            return remapeadas
          },
        },
        props: {
          decorations(state) {
            const marcas = clavePriv.getState(state) || []
            const decos = []
            for (const m of marcas) {
              if (m.from >= m.to) continue
              decos.push(Decoration.inline(m.from, m.to, {
                class: 'dike-priv-' + m.clase,
                style: ESTILOS_PRIV[m.clase] || '',
                title: m.title || '',
              }))
            }
            return DecorationSet.create(state.doc, decos)
          },
        },
      }),
    ]
  },
})

// marcas: [{from, to, clase, title}] en posiciones ProseMirror.
export function fijarMarcasPrivacidad(editor, marcas) {
  editor.view.dispatch(editor.state.tr.setMeta(clavePriv, marcas))
}

// --- Placeholder visible sin CSS ----------------------------------------------

// @tiptap/extension-placeholder solo pone data-placeholder/is-editor-empty en
// attrs (invisible sin hoja de estilo); este plugin dibuja el texto como
// widget inline al inicio de un doc vacío.
function pluginPlaceholderVacio(texto) {
  return new Plugin({
    key: new PluginKey('dike-placeholder'),
    props: {
      decorations(state) {
        const doc = state.doc
        if (!texto || doc.childCount !== 1 || doc.firstChild.content.size !== 0) {
          return null
        }
        const span = document.createElement('span')
        span.textContent = texto
        span.setAttribute('style',
          'color:var(--ui-text-tertiary,#9ca3af);pointer-events:none;user-select:none')
        return DecorationSet.create(doc, [
          Decoration.widget(1, span, { side: -1 }),
        ])
      },
    },
  })
}

// --- Ghost text de predicción (tercera PluginKey) -----------------------------
// El widget muestra la sugerencia al final de la selección vacía, con el
// rótulo capa+procedencia. Tab acepta (inserción literal), Esc descarta, y
// cualquier otra tecla la borra. La sugerencia la fija el módulo de
// predicción con fijarGhost(); la aceptación delega en onAceptar.

const claveGhost = new PluginKey('dike-prediccion-ghost')

export function pluginGhostTexto({ onAceptar }) {
  return new Plugin({
    key: claveGhost,
    state: {
      init: () => null,
      apply: (tr, valor) => {
        const meta = tr.getMeta(claveGhost)
        if (meta !== undefined) return meta
        if (tr.docChanged || tr.selectionSet) return null
        return valor
      },
    },
    props: {
      decorations(state) {
        const s = claveGhost.getState(state)
        if (!s || !state.selection.empty) return null
        const pos = state.selection.to
        const span = document.createElement('span')
        span.className = 'dike-ghost'
        span.textContent = s.texto
        span.setAttribute('style',
          'color:var(--ui-text-tertiary,#9ca3af);pointer-events:none;' +
          'user-select:none;font-style:italic')
        const rotulo = document.createElement('span')
        rotulo.textContent = '  [Tab] ' + s.rotulo
        rotulo.setAttribute('style',
          'color:var(--ui-text-tertiary,#9ca3af);font-size:0.75em;' +
          'font-style:normal;pointer-events:none;user-select:none')
        const envoltura = document.createElement('span')
        envoltura.appendChild(span)
        envoltura.appendChild(rotulo)
        return DecorationSet.create(state.doc, [
          Decoration.widget(pos, envoltura, { side: 1 }),
        ])
      },
      handleKeyDown(view, event) {
        const s = claveGhost.getState(view.state)
        if (!s) return false   // sin sugerencia, Tab/Esc quedan libres
        if (event.key === 'Tab') {
          const pos = view.state.selection.to
          view.dispatch(view.state.tr
            .insertText(s.texto, pos)
            .setMeta(claveGhost, null))
          if (onAceptar) onAceptar(s)
          event.preventDefault()
          return true
        }
        if (event.key === 'Escape') {
          view.dispatch(view.state.tr.setMeta(claveGhost, null))
          event.preventDefault()
          return true
        }
        return false
      },
    },
  })
}

// Fija (o borra con null) la sugerencia visible.
//   {texto, rotulo, procedencia} — rotulo = capa + fuente legible.
export function fijarGhost(editor, sugerencia) {
  if (!editor || !editor.view) return
  editor.view.dispatch(editor.view.state.tr.setMeta(claveGhost, sugerencia))
}

// --- Montaje ------------------------------------------------------------------

export function montarEditor({ element, content, placeholder, onUpdate,
  onAceptarPrediccion }) {
  const pluginPh = pluginPlaceholderVacio(placeholder)
  const pluginGhost = pluginGhostTexto({ onAceptar: onAceptarPrediccion })
  return new Editor({
    element,
    extensions: [
      StarterKit,
      Placeholder.configure({ placeholder: placeholder || 'Escribe el escrito…' }),
      MarcasCitas,
      MarcasPrivacidad,
      Extension.create({
        name: 'dikePlaceholderWidget',
        addProseMirrorPlugins: () => [pluginPh],
      }),
      Extension.create({
        name: 'dikeGhostTexto',
        addProseMirrorPlugins: () => [pluginGhost],
      }),
    ],
    content: content || '',
    editorProps: {
      attributes: {
        lang: 'es-CL',
        spellcheck: 'true',
        style: 'white-space:pre-wrap;outline:none;min-height:10rem;' +
          'font-family:inherit;font-size:inherit;line-height:1.55;' +
          'color:var(--ui-text-primary)',
      },
    },
    onUpdate: ({ editor }) => {
      if (onUpdate) onUpdate(editor)
    },
  })
}

export function textoDelEditor(editor) {
  return editor.getText({ blockSeparator: SEPARADOR })
}

// Reemplaza los rangos [{from,to}] por `texto` en una sola transacción
// (de atrás hacia adelante para no desplazar posiciones).
export function reemplazarRangos(editor, rangos, texto) {
  const tr = editor.state.tr
  for (const r of [...rangos].sort((a, b) => b.from - a.from)) {
    tr.insertText(texto, r.from, r.to)
  }
  editor.view.dispatch(tr)
}

// Borra los rangos [{from,to}] en una sola transacción.
export function borrarRangos(editor, rangos) {
  const tr = editor.state.tr
  for (const r of [...rangos].sort((a, b) => b.from - a.from)) {
    tr.delete(r.from, r.to)
  }
  editor.view.dispatch(tr)
}
