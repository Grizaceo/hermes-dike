// Herramientas diferenciadas de Grafos en la barra lateral derecha del Case Writer:
// 1. Buscador y Lector del Grafo del Corpus (BM25 + Árbol IndexO + lectura de
//    unidades normativas + Llevar cita al escrito / Pizarra / Abrir en 3D).
// 2. Constructor de Paquetes de Grafos / Ordenamientos (dike-perfil-ordenamiento-v1:
//    perfiles por país, generador de plantilla, validador de perfil y constructor
//    de pack con informe C0–C3).
// 3. Fuentes del Grafo y Grafo Personal (GRE).

import { jsx, jsxs } from 'react/jsx-runtime'
import { useCallback, useEffect, useState } from 'react'
import { mensajeError, rest, S } from '../common.js'
import { t } from '../i18n.js'

import { BuscadorCorpus } from './buscador-corpus.js'

export function PanelHerramientasGrafos({
  onLlevarCitaAlEscrito,
  onAgregarAPizarra,
  onAbrirGrafo3D,
}) {
  const [herramienta, setHerramienta] = useState('corpus') // 'corpus' | 'constructor' | 'fuentes'

  return jsxs('div', {
    className: 'flex flex-col gap-3 p-3 text-xs text-(--dk-texto)',
    children: [
      // Selector de herramientas diferenciadas de grafos
      jsxs('div', {
        className: 'flex flex-col gap-1 rounded-md border border-(--dk-borde) bg-(--dk-superficie) p-1.5',
        children: [
          jsx('div', { className: 'px-1 dk-rotulo', children: t('graf.titulo') }),
          jsxs('div', { className: 'flex gap-1', children: [
            jsx('button', {
              type: 'button',
              onClick: () => setHerramienta('corpus'),
              'aria-pressed': herramienta === 'corpus',
              className: 'dk-btn dk-btn--borde flex-1',
              children: t('graf.corpus'),
            }),
            jsx('button', {
              type: 'button',
              onClick: () => setHerramienta('constructor'),
              'aria-pressed': herramienta === 'constructor',
              className: 'dk-btn dk-btn--borde flex-1',
              children: t('graf.crearPack'),
            }),
            jsx('button', {
              type: 'button',
              onClick: () => setHerramienta('fuentes'),
              'aria-pressed': herramienta === 'fuentes',
              className: 'dk-btn dk-btn--borde flex-1',
              children: t('graf.fuentes'),
            }),
          ] }),
        ],
      }),

      herramienta === 'corpus' ? jsx(SubHerramientaCorpus, {
        onLlevarCitaAlEscrito,
        onAgregarAPizarra,
        onAbrirGrafo3D,
      }) : null,

      herramienta === 'constructor' ? jsx(SubHerramientaConstructorOrdenamiento, {}) : null,

      herramienta === 'fuentes' ? jsx(SubHerramientaFuentes, { onAbrirGrafo3D }) : null,
    ],
  })
}

// ---------------------------------------------------------------------------
// 1. Sub-herramienta: Buscador y Lector de Nodos del Grafo del Corpus
// ---------------------------------------------------------------------------

function SubHerramientaCorpus({ onLlevarCitaAlEscrito, onAgregarAPizarra, onAbrirGrafo3D }) {
  const [articuloLeido, setArticuloLeido] = useState(null)
  const [leyendoId, setLeyendoId] = useState(null)
  const [errorLector, setErrorLector] = useState(null)

  const leerNodo = useCallback((r) => {
    const nid = r.nodo_id
    if (!nid) return
    setLeyendoId(nid)
    setErrorLector(null)
    rest('/grafo/leer', {
      method: 'POST',
      body: { nodo_id: nid },
      timeoutMs: 120000,
    }).then((d) => {
      setArticuloLeido({ ...d, _res: r })
    }).catch((e) => {
      setErrorLector(e)
    }).finally(() => setLeyendoId(null))
  }, [])

  return jsxs('div', {
    className: 'flex flex-col gap-2.5',
    children: [
      jsxs('div', { className: 'flex items-center justify-between', children: [
        jsx('span', { className: 'text-xs text-(--dk-texto-3)', children: t('graf.busquedaNota') }),
        onAbrirGrafo3D ? jsx('button', {
          type: 'button',
          onClick: () => onAbrirGrafo3D(null),
          className: 'dk-btn dk-btn--borde dk-btn--chico',
          children: t('graf.abrir3d'),
        }) : null,
      ] }),

      jsx(BuscadorCorpus, {
        limite: 15,
        mostrarBuscar: true,
        placeholder: t('graf.placeholder'),
        children: jsxs('div', { className: 'contents', children: [
          articuloLeido ? jsxs('div', {
            className: S.panel + ' mx-2.5 mt-1.5 flex flex-col gap-2',
            children: [
              jsxs('div', { className: 'flex items-center justify-between gap-2', children: [
                jsx('span', { className: 'font-bold text-(--dk-texto)', children:
                  (articuloLeido._res && articuloLeido._res.cita)
                    || articuloLeido.cita || articuloLeido.gid || articuloLeido.nodo_id }),
                jsx('button', {
                  type: 'button',
                  onClick: () => setArticuloLeido(null),
                  'aria-label': t('graf.cerrarLectura'),
                  className: 'dk-btn dk-btn--icono dk-btn--chico',
                  children: '✕',
                }),
              ] }),
              jsx('div', {
                className: 'max-h-48 overflow-y-auto whitespace-pre-wrap rounded border border-(--dk-borde) bg-(--dk-elevada) p-2 font-serif text-xs leading-relaxed text-(--dk-texto)',
                children: articuloLeido.texto || '(sin texto disponible)',
              }),
              (articuloLeido.unidades || []).length > 0 ? jsxs('details', { className: 'text-xs', children: [
                jsx('summary', { className: 'cursor-pointer font-medium text-(--dk-acento)', children: t('graf.unidades', { n: articuloLeido.unidades.length }) }),
                jsxs('div', { className: 'mt-1 flex flex-col gap-1 max-h-40 overflow-y-auto', children:
                  articuloLeido.unidades.map((u, ui) => jsxs('div', {
                    key: u.id || ui,
                    className: 'rounded border border-(--dk-borde) bg-(--dk-elevada) p-1.5 text-xs',
                    children: [
                      jsxs('div', { className: 'flex items-center justify-between gap-1 dk-mono text-(--dk-texto-3)', children: [
                        jsx('span', { children: u.id }),
                        u.modalidad || u.modalidad_candidata ? jsx('span', { className: 'rounded bg-(--dk-superficie-2) px-1 uppercase', children: u.modalidad || u.modalidad_candidata }) : null,
                      ] }),
                      jsx('div', { className: 'mt-0.5 text-(--dk-texto-2)', children: u.texto }),
                    ],
                  })),
                }),
              ] }) : null,
            ],
          }) : null,
          errorLector ? jsx('div', { className: 'mx-2.5 mt-1.5 ' + S.noticeBad, children: mensajeError(errorLector) }) : null,
        ] }),
        renderAcciones: (r) => [
          jsx('button', {
            type: 'button',
            onClick: () => leerNodo(r),
            disabled: leyendoId === r.nodo_id,
            className: 'dk-btn dk-btn--borde dk-btn--chico',
            children: leyendoId === r.nodo_id ? t('graf.leyendo') : t('graf.leer'),
          }),
          r.citable !== false && r.cita && onLlevarCitaAlEscrito ? jsx('button', {
            type: 'button',
            onClick: () => onLlevarCitaAlEscrito(r),
            className: 'dk-btn dk-btn--borde dk-btn--chico',
            title: t('graf.llevarTitulo'),
            children: t('graf.llevar'),
          }) : null,
          onAgregarAPizarra ? jsx('button', {
            type: 'button',
            onClick: () => onAgregarAPizarra({
              titulo: r.cita || r.label || t('piz.normaFallback'),
              tag: 'NORMA',
              color: '#bfdbfe',
              texto: (r.cita ? r.cita + '.\n' : '') + (r.snippet ? String(r.snippet).slice(0, 240) : ''),
              nodo_id: r.nodo_id,
              gid: r.gid,
            }),
            className: 'dk-btn dk-btn--borde dk-btn--chico',
            children: t('nifp.masPizarra'),
          }) : null,
          r.nodo_id && onAbrirGrafo3D ? jsx('button', {
            type: 'button',
            onClick: () => onAbrirGrafo3D({ nodo_id: r.nodo_id }),
            className: 'dk-btn dk-btn--borde dk-btn--chico',
            children: t('graf.abrir3dBoton'),
          }) : null,
        ],
      }),
    ],
  })
}


// ---------------------------------------------------------------------------
// 2. Sub-herramienta: Constructor de Paquetes de Grafos / Ordenamientos
// ---------------------------------------------------------------------------

function SubHerramientaConstructorOrdenamiento() {
  const [catalogo, setCatalogo] = useState(null)
  const [jurInput, setJurInput] = useState('ar')
  const [perfilJson, setPerfilJson] = useState('')
  const [paqueteJson, setPaqueteJson] = useState('')
  const [textoNormaNombre, setTextoNormaNombre] = useState('xx-ley-1.txt')
  const [textoNormaContenido, setTextoNormaContenido] = useState('')
  const [validacion, setValidacion] = useState(null)
  const [resultadoBuild, setResultadoBuild] = useState(null)
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    rest('/ordenamiento/perfiles').then((d) => {
      setCatalogo(d)
      const xx = (d && d.perfiles || []).find((p) => p.jurisdiccion === 'xx') || (d && d.perfiles && d.perfiles[0])
      if (xx && xx.perfil) {
        setPerfilJson(JSON.stringify(xx.perfil, null, 2))
      }
      if (d && d.ejemplo_xx) {
        setPaqueteJson(JSON.stringify(d.ejemplo_xx.paquete, null, 2))
        const entradas = Object.entries(d.ejemplo_xx.textos || {})
        if (entradas.length) {
          setTextoNormaNombre(entradas[0][0].replace(/^textos\//, ''))
          setTextoNormaContenido(entradas[0][1])
        }
      }
    }).catch(setError)
  }, [])

  const generarPlantilla = useCallback(() => {
    setOcupado(true)
    setError(null)
    setValidacion(null)
    setResultadoBuild(null)
    rest('/ordenamiento/plantilla', {
      method: 'POST',
      body: { jur: jurInput.trim().toLowerCase() },
    }).then((d) => {
      setPerfilJson(JSON.stringify(d.perfil, null, 2))
      setPaqueteJson(JSON.stringify(d.paquete, null, 2))
    }).catch(setError).finally(() => setOcupado(false))
  }, [jurInput])

  const validarPerfilActual = useCallback(() => {
    setError(null)
    setValidacion(null)
    let obj
    try {
      obj = JSON.parse(perfilJson)
    } catch (e) {
      setError(new Error(t('graf.errorJsonPerfil', { error: e.message })))
      return
    }
    setOcupado(true)
    rest('/ordenamiento/validar-perfil', {
      method: 'POST',
      body: { perfil: obj },
    }).then(setValidacion).catch(setError).finally(() => setOcupado(false))
  }, [perfilJson])

  const construirYValidarPack = useCallback(() => {
    setError(null)
    setResultadoBuild(null)
    let objPerfil
    let objPaquete
    try {
      objPerfil = JSON.parse(perfilJson)
      objPaquete = JSON.parse(paqueteJson)
    } catch (e) {
      setError(new Error(t('graf.errorJson', { error: e.message })))
      return
    }
    const textos = {}
    if (catalogo && catalogo.ejemplo_xx && catalogo.ejemplo_xx.textos) {
      Object.assign(textos, catalogo.ejemplo_xx.textos)
    }
    if (textoNormaNombre.trim() && textoNormaContenido.trim()) {
      textos['textos/' + textoNormaNombre.trim().replace(/^textos\//, '')] = textoNormaContenido
    }
    setOcupado(true)
    rest('/ordenamiento/construir', {
      method: 'POST',
      body: { perfil: objPerfil, paquete: objPaquete, textos },
    }).then(setResultadoBuild).catch(setError).finally(() => setOcupado(false))
  }, [perfilJson, paqueteJson, textoNormaNombre, textoNormaContenido, catalogo])

  const perfiles = (catalogo && catalogo.perfiles) || []

  return jsxs('div', {
    className: 'flex flex-col gap-3',
    children: [
      jsx('div', {
        className: S.notice,
        children: t('graf.intro'),
      }),

      // Perfiles instalados
      perfiles.length > 0 ? jsxs('div', {
        className: 'flex flex-col gap-1.5 rounded border border-(--dk-borde) bg-(--dk-elevada) p-2.5',
        children: [
          jsx('div', { className: 'dk-rotulo', children: t('graf.perfiles') }),
          ...perfiles.map((p) => jsxs('div', {
            key: p.id,
            className: 'flex items-center justify-between gap-2 border-b border-(--dk-borde-suave) py-1.5 last:border-0',
            children: [
              jsxs('div', { className: 'min-w-0', children: [
                jsxs('div', { className: 'flex items-center gap-1.5', children: [
                  jsx('span', { className: 'font-bold text-(--dk-texto)', children: `${p.nombre} (${p.jurisdiccion})` }),
                  jsx('span', {
                    className: S.chip + ' ' + (p.valido ? S.chipOk : S.chipWarn),
                    children: p.valido ? t('graf.perfilValido') : t('graf.perfilErrores'),
                  }),
                ] }),
                jsx('div', {
                  className: 'text-xs text-(--dk-texto-3)',
                  children: (p.tipos_norma || []).map((t) => t.etiqueta || t.id).join(' · '),
                }),
              ] }),
              jsx('button', {
                type: 'button',
                onClick: () => {
                  setPerfilJson(JSON.stringify(p.perfil, null, 2))
                  setValidacion(null)
                  setResultadoBuild(null)
                },
                className: 'dk-btn dk-btn--borde dk-btn--chico shrink-0',
                children: t('graf.cargarEditor'),
              }),
            ],
          })),
        ],
      }) : null,

      // Paso 1: Generar plantilla para nuevo país
      jsxs('div', {
        className: 'flex flex-wrap items-center gap-1.5 rounded border border-(--dk-borde) bg-(--dk-elevada) p-2',
        children: [
          jsx('span', { className: 'text-xs font-semibold text-(--dk-texto-2)', children: t('graf.paso1') }),
          jsx('input', {
            value: jurInput,
            onChange: (e) => setJurInput(e.target.value),
            placeholder: t('graf.isoPlaceholder'),
            className: 'w-24 rounded border border-(--dk-borde) px-2 py-1 font-mono text-xs text-(--dk-texto)',
          }),
          jsx('button', {
            type: 'button',
            onClick: generarPlantilla,
            disabled: ocupado || !jurInput.trim(),
            className: 'dk-btn',
            children: t('graf.generar'),
          }),
        ],
      }),

      // Paso 2: Editor de perfil JSON y validación
      jsxs('div', {
        className: 'flex flex-col gap-1.5 rounded border border-(--dk-borde) bg-(--dk-elevada) p-2.5',
        children: [
          jsxs('div', { className: 'flex items-center justify-between', children: [
            jsx('span', { className: 'text-xs font-semibold text-(--dk-texto-2)', children: t('graf.paso2') }),
            jsx('button', {
              type: 'button',
              onClick: validarPerfilActual,
              disabled: ocupado || !perfilJson.trim(),
              className: 'dk-btn dk-btn--borde dk-btn--chico',
              children: t('graf.validar'),
            }),
          ] }),
          jsx('textarea', {
            value: perfilJson,
            onChange: (e) => setPerfilJson(e.target.value),
            rows: 6,
            className: 'w-full rounded border border-(--dk-borde) bg-(--dk-superficie) p-2 font-mono text-xs text-(--dk-texto) outline-none focus:border-(--dk-acento)',
          }),
          validacion ? jsxs('div', {
            className: (validacion.ok ? S.noticeOk : S.noticeWarn) + ' text-xs',
            children: [
              jsx('div', {
                className: 'font-bold',
                children: validacion.ok
                  ? '✓ Perfil válido conforme a dike-perfil-ordenamiento-v1'
                  : `✗ ${validacion.errores.length} observación(es) en el perfil:`,
              }),
              ...(validacion.errores || []).slice(0, 6).map((er, i) => jsx('div', {
                key: i,
                className: 'mt-0.5 font-mono text-xs',
                children: `[${er.codigo}] ${er.ruta}: ${er.explicacion}`,
              })),
            ],
          }) : null,
        ],
      }),

      // Paso 3: Construir y validar pack C0-C3
      jsxs('details', {
        className: 'rounded border border-(--dk-borde) bg-(--dk-elevada) p-2.5',
        children: [
          jsx('summary', { className: 'cursor-pointer text-xs font-semibold text-(--dk-texto-2)', children: t('graf.paso3') }),
          jsxs('div', { className: 'mt-2 flex flex-col gap-2', children: [
            jsx('div', { className: 'dk-rotulo', children: 'paquete.json' }),
            jsx('textarea', {
              value: paqueteJson,
              onChange: (e) => setPaqueteJson(e.target.value),
              rows: 4,
              className: 'w-full rounded border border-(--dk-borde) bg-(--dk-superficie) p-1.5 font-mono text-xs text-(--dk-texto)',
            }),
            jsxs('div', { className: 'flex items-center gap-2', children: [
              jsx('span', { className: 'text-xs text-(--dk-texto-3)', children: t('graf.archivo') }),
              jsx('input', {
                value: textoNormaNombre,
                onChange: (e) => setTextoNormaNombre(e.target.value),
                className: 'rounded border border-(--dk-borde) px-2 py-0.5 font-mono text-xs',
              }),
            ] }),
            jsx('textarea', {
              value: textoNormaContenido,
              onChange: (e) => setTextoNormaContenido(e.target.value),
              rows: 4,
              placeholder: t('graf.normaPlaceholder'),
              className: 'w-full rounded border border-(--dk-borde) bg-(--dk-superficie) p-1.5 font-mono text-xs text-(--dk-texto)',
            }),
          ] }),
        ],
      }),

      jsx('button', {
        type: 'button',
        onClick: construirYValidarPack,
        disabled: ocupado || !perfilJson.trim() || !paqueteJson.trim(),
        className: 'dk-btn dk-btn--primario',
        children: ocupado ? t('graf.construyendo') : t('graf.construir'),
      }),

      error ? jsx('div', { className: S.noticeBad, children: mensajeError(error) }) : null,

      resultadoBuild ? jsxs('div', {
        className: (resultadoBuild.ok ? S.noticeOk : S.noticeWarn) + ' flex flex-col gap-1.5 text-xs',
        children: [
          jsx('div', {
            className: 'font-bold',
            children: resultadoBuild.ok
              ? t('graf.packOk', { nivel: resultadoBuild.compatibilidad.nivelAlcanzado })
              : t('graf.construccionDetenida', { etapa: resultadoBuild.etapa || t('graf.etapaValidacion'), error: resultadoBuild.error || t('graf.revisaErrores') }),
          }),
          resultadoBuild.construccion ? jsxs('div', { className: 'grid grid-cols-2 gap-1 text-xs mt-1', children: [
            jsx('div', { children: t('graf.normas', { n: resultadoBuild.construccion.normas }) }),
            jsx('div', { children: t('graf.articulos', { n: resultadoBuild.construccion.articulos }) }),
            jsx('div', { children: t('graf.aristas', { n: resultadoBuild.construccion.aristas }) }),
            jsx('div', { children: t('graf.vigencias', { n: resultadoBuild.construccion.ventanasVigencia }) }),
          ] }) : null,
          resultadoBuild.construccion && resultadoBuild.construccion.manifestCoreSha256
            ? jsx('div', { className: 'font-mono text-xs text-(--dk-texto-2) break-all', children: 'manifestCoreSha256: ' + resultadoBuild.construccion.manifestCoreSha256 })
            : null,
        ],
      }) : null,
    ],
  })
}

// ---------------------------------------------------------------------------
// 3. Sub-herramienta: Fuentes del Grafo y Grafo Personal (GRE)
// ---------------------------------------------------------------------------

function SubHerramientaFuentes({ onAbrirGrafo3D }) {
  const [fuentes, setFuentes] = useState(null)
  const [personal, setPersonal] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    rest('/grafo/fuentes').then(setFuentes).catch(setError)
    rest('/grafo/personal').then(setPersonal).catch(() => {})
  }, [])

  return jsxs('div', {
    className: 'flex flex-col gap-2.5',
    children: [
      jsxs('div', { className: 'flex flex-col gap-1.5 rounded border border-(--dk-borde) bg-(--dk-elevada) p-2.5', children: [
        jsx('div', { className: 'dk-rotulo', children: t('graf.capas') }),
        fuentes === null && !error ? jsx('div', {
          className: 'py-2 text-center text-xs text-(--dk-texto-3)',
          children: t('graf.capasCargando'),
        }) : null,
        Array.isArray(fuentes) && !fuentes.length && !error ? jsx('div', {
          className: 'py-2 text-center text-xs text-(--dk-texto-3)',
          children: t('graf.capasVacio'),
        }) : null,
        ...(fuentes || []).map((f) => jsxs('div', {
          key: f.id,
          className: 'flex items-center justify-between gap-2 border-b border-(--dk-borde-suave) py-1.5 last:border-0',
          children: [
            jsxs('div', { children: [
              jsx('div', { className: 'font-semibold text-(--dk-texto)', children: f.label }),
              jsx('div', { className: 'text-xs text-(--dk-texto-3)', children: f.local_only ? t('graf.capaLocal') : t('graf.capaSellada') }),
            ] }),
            jsx('span', {
              className: S.chip + ' ' + (f.disponible ? S.chipOk : S.chipOff),
              children: f.disponible ? t('graf.disponible') : t('graf.noConstruida'),
            }),
          ],
        })),
        onAbrirGrafo3D ? jsx('button', {
          type: 'button',
          onClick: () => onAbrirGrafo3D(null),
          className: 'mt-1 dk-btn',
          children: t('graf.explorador'),
        }) : null,
      ] }),

      personal ? jsxs('div', { className: 'flex flex-col gap-1 rounded border border-(--dk-borde) bg-(--dk-elevada) p-2.5', children: [
        jsx('div', { className: 'dk-rotulo', children: t('graf.gre') }),
        jsx('div', {
          className: 'text-xs text-(--dk-texto-2)',
          children: t('graf.greConteo', { nodos: (personal.candidates || personal.nodes || []).length, aristas: (personal.edges || []).length }),
        }),
        jsx('div', { className: 'text-xs text-(--dk-texto-3)', children: t('graf.greNota') }),
      ] }) : null,

      error ? jsx('div', { className: S.bad, children: mensajeError(error) }) : null,
    ],
  })
}
