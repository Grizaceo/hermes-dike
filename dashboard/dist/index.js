/* Diké — pestaña del dashboard web. El backend es /api/plugins/dike/
 * (dashboard/plugin_api.py); el mismo adaptador sirve a la página de la app
 * Desktop. Tres secciones: verificación de citas, mapa del corpus (grafo)
 * y tablero NIF de la teoría del caso.
 */
(function () {
  "use strict";

  var SDK = window.__HERMES_PLUGIN_SDK__;
  var React = SDK.React;
  var useCallback = React.useCallback;
  var useEffect = React.useEffect;
  var useState = React.useState;
  var h = React.createElement;
  var C = SDK.components;

  function mensajeError(e) {
    return (e && (e.message || e.detail)) || String(e);
  }

  function Estado(props) {
    var e = props.estado;
    var err = props.error;
    if (err) {
      return h("div", { className: "text-xs text-muted-foreground" },
        "El backend de Diké no responde en este perfil (" + mensajeError(err) + "). " +
        "Instálalo y habilítalo en el perfil activo: hermes -p <perfil> plugins install Grizaceo/hermes-dike --enable");
    }
    if (!e) {
      return h("div", { className: "text-xs text-muted-foreground" }, "Consultando el corpus…");
    }
    return h("div", { className: "flex flex-wrap items-center gap-2 text-xs" },
      h(C.Badge, { variant: e.corpus_instalado ? "default" : "secondary" },
        e.corpus_instalado ? "corpus instalado" : "corpus sin instalar"),
      h("span", { className: "text-muted-foreground" },
        "pack " + e.pack_hash + " · " + e.leyes + " leyes · " + e.articulos + " artículos" +
        (e.version ? " · v" + e.version : "")));
  }

  function Resultado(props) {
    var r = props.resultado;
    if (!r) return null;
    if (r.error) {
      var msg = String(r.error);
      if (msg.indexOf(": ") >= 0) msg = msg.split(": ").slice(1).join(": ");
      return h("div", { className: "rounded-md border border-destructive/40 p-3 text-sm" },
        "Diké no pudo revisar el escrito: " + msg);
    }
    if (r.veredicto === "SIN_CITAS" || r.veredicto === "SIN_CORPUS") {
      return h("div", { className: "text-sm text-muted-foreground" }, "Diké: " + (r.mensaje || ""));
    }
    var meta = r.meta || {};
    var detalles = r.detalles || [];
    var fechas = detalles.map(function (d) { return d.fecha_recuperacion; })
      .filter(Boolean).map(String).sort();
    var fecha = fechas.length ? fechas[0].slice(0, 10) : "—";
    return h("div", { className: "flex flex-col gap-2" },
      h("div", { className: "text-sm font-medium" },
        "Diké: " + meta.citas_verificadas + " de " + meta.total_citas +
        " citas verificadas (" + r.veredicto + ") · corpus " + meta.pack_hash),
      h("div", { className: "flex flex-col divide-y" },
        detalles.map(function (d, i) {
          var ok = d.estado === "VERIFICADA";
          return h("div", { key: i, className: "flex items-start gap-2 py-1.5 text-sm" },
            h("span", { className: ok ? "text-green-500" : "text-destructive" }, ok ? "✓" : "✗"),
            h("div", { className: "min-w-0" },
              h("div", null, d.cita_raw),
              h("div", { className: "text-xs text-muted-foreground break-all" },
                ok ? [d.gid, d.fuente_url].filter(Boolean).join(" · ") : d.resolucion)));
        })),
      (r.no_verificadas && r.no_verificadas.length)
        ? h("div", { className: "text-xs text-muted-foreground" },
            "Menciones sin artículo, no verificadas: " + r.no_verificadas.join(", "))
        : null,
      h("div", { className: "text-xs text-muted-foreground" },
        "No certifica que el artículo respalde el argumento ni que la copia (obtenida " +
        fecha + ") sea el texto vigente hoy."));
  }

  function SeccionEscrito(props) {
    var _a = useState(null), resultado = _a[0], setResultado = _a[1];
    var _b = useState(null), error = _b[0], setError = _b[1];
    var _c = useState(""), texto = _c[0], setTexto = _c[1];
    var _d = useState(false), ocupado = _d[0], setOcupado = _d[1];
    var _e = useState(null), estilo = _e[0], setEstilo = _e[1];

    var cargarDemo = useCallback(function () {
      SDK.fetchJSON("/api/plugins/dike/escrito/demo")
        .then(function (d) { if (d && d.texto) setTexto(d.texto); })
        .catch(function (e) { setError(e); });
    }, []);

    var verificar = useCallback(function () {
      var t = texto.trim();
      if (!t || ocupado) return;
      setOcupado(true);
      setError(null);
      SDK.fetchJSON("/api/plugins/dike/verificar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ texto: t }),
      })
        .then(setResultado)
        .catch(function (e) { setError(e); })
        .finally(function () { setOcupado(false); });
    }, [texto, ocupado]);

    var analizarEstilo = useCallback(function () {
      var t = texto.trim();
      if (!t || ocupado) return;
      setError(null);
      SDK.fetchJSON("/api/plugins/dike/estilo/analizar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ texto: t, contexto: "escrito", detallado: false }),
      })
        .then(setEstilo)
        .catch(function (e) { setError(e); });
    }, [texto, ocupado]);

    return h(C.Card, null,
      h(C.CardHeader, null, h(C.CardTitle, null, "Estudio de Escrito (Verificador + LexO Escribe Claro)")),
      h(C.CardContent, { className: "flex flex-col gap-3" },
        h("textarea", {
          className: "min-h-56 w-full rounded-md border bg-background p-3 font-serif text-sm leading-relaxed outline-none shadow-2xs",
          placeholder: "Comience a redactar o pegue el texto del escrito…",
          value: texto,
          onChange: function (ev) { setTexto(ev.target.value); },
        }),
        h("div", { className: "flex flex-wrap items-center gap-2" },
          h(C.Button, { onClick: verificar, disabled: ocupado || !texto.trim() },
            ocupado ? "Verificando…" : "Verificar citas"),
          h(C.Button, { variant: "secondary", onClick: analizarEstilo, disabled: ocupado || !texto.trim() },
            "Revisar estilo (Escribe Claro)"),
          h(C.Button, { variant: "outline", onClick: cargarDemo, disabled: ocupado },
            "Cargar escrito demo"),
          ocupado
            ? h("span", { className: "text-xs text-muted-foreground" },
                "La primera llamada instala el corpus (~1 min).")
            : null),
        error
          ? h("div", { className: "text-xs text-destructive" }, mensajeError(error))
          : null,
        estilo
          ? h("div", { className: "rounded-md border p-3 text-xs flex flex-col gap-1.5" },
              h("div", { className: "font-semibold" },
                "LexO Escribe Claro — Puntaje: " + estilo.score + "/100 · Alineación judicial: " +
                (estilo.global_stats && estilo.global_stats.judicial_alignment_score) + "/100"),
              h("div", { className: "text-muted-foreground" },
                "Oraciones: " + (estilo.global_stats && estilo.global_stats.total_sentences) +
                " · Promedio: " + (estilo.global_stats && estilo.global_stats.avg_words_per_sentence) + " pal/oración" +
                " · Arcaísmos: " + (estilo.global_stats && estilo.global_stats.archaism_count) +
                " · Nominalizaciones: " + (estilo.global_stats && estilo.global_stats.nominalization_count)),
              (estilo.suggestions || []).slice(0, 6).map(function (s, i) {
                return h("div", { key: i, className: "text-muted-foreground" }, "• " + s.message);
              }))
          : null,
        h(Resultado, { resultado: resultado })));
  }

  // ------------------------------------------------------------------
  // Grafo
  // ------------------------------------------------------------------

  function NormaDetalle(props) {
    var data = props.data;
    var err = props.error;
    if (err) return h("div", { className: "text-xs text-destructive" }, mensajeError(err));
    if (!data) return h("div", { className: "text-xs text-muted-foreground" }, "Cargando artículos…");
    var arts = data.articulos || [];
    return h("div", { className: "flex flex-col gap-1 pl-4" },
      h("div", { className: "text-xs text-muted-foreground" },
        (data.articulos_total || arts.length) + " artículos" +
        (data.articulos_truncados ? " (mostrando " + arts.length + ")" : "")),
      arts.map(function (a, i) {
        return h("details", { key: i, className: "text-xs" },
          h("summary", { className: "cursor-pointer py-0.5" },
            "art. " + (a.label || a.eId) +
            (a.estado ? " · " + a.estado : "") +
            (a.vigente_desde ? " · desde " + String(a.vigente_desde).slice(0, 10) : "")),
          h("div", { className: "pl-3 pb-1 text-muted-foreground whitespace-pre-wrap" },
            String(a.texto || "").slice(0, 1200)));
      }));
  }

  function NormaRow(props) {
    var n = props.norma;
    var _a = useState(false), abierta = _a[0], setAbierta = _a[1];
    var _b = useState(null), detalle = _b[0], setDetalle = _b[1];
    var _c = useState(null), error = _c[0], setError = _c[1];
    var _d = useState(false), cargando = _d[0], setCargando = _d[1];

    var abrir = useCallback(function () {
      if (abierta) { setAbierta(false); return; }
      setAbierta(true);
      if (detalle || cargando) return;
      setCargando(true);
      setError(null);
      SDK.fetchJSON("/api/plugins/dike/grafo/corpus/norma/" + n.leychileCode)
        .then(setDetalle)
        .catch(function (e) { setError(e); })
        .finally(function () { setCargando(false); });
    }, [abierta, detalle, cargando, n.leychileCode]);

    var rotulo = (n.tipo && n.numero ? n.tipo + " " + n.numero : n.tipo) +
      (n.anio ? "/" + n.anio : "") + " · " + n.articulos + " art.";
    return h("div", { className: "border-b border-border/60 py-1.5 last:border-0" },
      h("button", {
        className: "flex w-full items-start gap-2 text-left text-sm hover:bg-accent/40 rounded px-1 -mx-1",
        onClick: abrir,
      },
        h("span", { className: "mt-0.5 text-muted-foreground" }, abierta ? "▾" : "▸"),
        h("div", { className: "min-w-0" },
          h("div", null, rotulo + (n.estado ? " · " + n.estado : "")),
          h("div", { className: "text-xs text-muted-foreground truncate" }, n.titulo))),
      abierta ? h(NormaDetalle, { data: detalle, error: error }) : null);
  }

  function SeccionGrafo(props) {
    var _a = useState(null), corpus = _a[0], setCorpus = _a[1];
    var _b = useState(null), corpusErr = _b[0], setCorpusErr = _b[1];
    var _c = useState(null), personal = _c[0], setPersonal = _c[1];
    var _d = useState(null), personalErr = _d[0], setPersonalErr = _d[1];

    var cargar = useCallback(function () {
      setCorpusErr(null);
      setPersonalErr(null);
      SDK.fetchJSON("/api/plugins/dike/grafo/corpus")
        .then(setCorpus)
        .catch(function (e) { setCorpusErr(e); });
      SDK.fetchJSON("/api/plugins/dike/grafo/personal")
        .then(setPersonal)
        .catch(function (e) { setPersonalErr(e); });
    }, []);

    useEffect(function () { cargar(); }, [cargar]);

    var pack = corpus && corpus.packs && corpus.packs[0];
    var normas = (pack && pack.normas) || [];
    var edges = (pack && pack.edges) || {};
    var candidatos = (personal && personal.candidates) || [];
    var aristas = (personal && personal.edges) || [];

    return h("div", { className: "flex flex-col gap-4" },
      h(C.Card, null,
        h(C.CardHeader, null,
          h(C.CardTitle, null, "Corpus sellado"),
          pack ? h("div", { className: "text-xs text-muted-foreground" },
            Object.keys(edges).map(function (k) { return k + ": " + edges[k]; }).join(" · ") +
            " · vigencia: " + (pack.vigencia || 0)) : null),
        h(C.CardContent, null,
          corpusErr
            ? h("div", { className: "text-xs text-destructive" }, mensajeError(corpusErr))
            : !pack
              ? h("div", { className: "text-xs text-muted-foreground" }, "Leyendo el corpus…")
              : normas.map(function (n) { return h(NormaRow, { key: n.leychileCode, norma: n }); }))),
      h(C.Card, null,
        h(C.CardHeader, null, h(C.CardTitle, null, "Grafo personal (GRE)")),
        h(C.CardContent, { className: "flex flex-col gap-2 text-xs" },
          personalErr
            ? h("div", { className: "text-destructive" }, mensajeError(personalErr))
            : !personal
              ? h("div", { className: "text-muted-foreground" }, "Consultando…")
              : h("div", null,
                  candidatos.length + " candidatos · " + aristas.length + " aristas",
                  candidatos.length === 0
                    ? h("div", { className: "text-muted-foreground mt-1" },
                        "Sin candidatos todavía: el grafo personal se llena cuando agentes o el " +
                        "escrito alimentan evidencia al pipeline GRE.")
                    : candidatos.map(function (c, i) {
                        return h("div", { key: i, className: "border-b border-border/60 py-1 last:border-0" },
                          h("div", null, (c.candidate_id || "") + " · " + (c.state_human || c.state || "")),
                          h("div", { className: "text-muted-foreground" },
                            String(c.text || c.summary || "").slice(0, 160)));
                      })))));
  }

  // ------------------------------------------------------------------
  // NIF
  // ------------------------------------------------------------------

  var SECCIONES_NIF = [
    ["facts.known", "Hechos conocidos"], ["facts.alleged", "Hechos alegados"],
    ["facts.missing", "Hechos faltantes"], ["subjects", "Sujetos"],
    ["norms", "Normas"], ["norm_relations", "Relaciones entre normas"],
    ["admin_acts", "Actos administrativos"], ["principles", "Principios"],
    ["deontic_positions", "Posiciones deónticas"], ["conflicts", "Conflictos"],
    ["hypotheses", "Hipótesis"], ["gaps", "Vacíos"],
    ["relevant_factors", "Factores relevantes"],
  ];

  function ItemNif(props) {
    var v = props.valor;
    var texto = typeof v === "string" ? v : JSON.stringify(v);
    if (v && typeof v === "object" && !Array.isArray(v)) {
      texto = [v.label || v.id || v.name || "", v.description || v.text || v.filled_with || ""]
        .filter(Boolean).join(" — ") || JSON.stringify(v);
    } else if (v && typeof v === "object") {
      texto = JSON.stringify(v);
    }
    return h("div", { className: "border-b border-border/60 py-1 text-xs last:border-0" },
      h("div", { className: "whitespace-pre-wrap" }, String(texto).slice(0, 400)));
  }

  function SeccionNif(props) {
    var titulo = props.titulo;
    var valores = props.valores;
    var campo = props.campo;
    var onAgregar = props.onAgregar;
    var accionExtra = props.accionExtra;
    var _a = useState(""), nuevo = _a[0], setNuevo = _a[1];
    var _b = useState(false), editando = _b[0], setEditando = _b[1];
    var lista = Array.isArray(valores) ? valores : [];
    return h("div", { className: "rounded-md border p-2" },
      h("div", { className: "flex items-center justify-between text-xs font-medium uppercase tracking-wide text-muted-foreground" },
        h("span", null, titulo + " (" + lista.length + ")"),
        h("span", { className: "flex gap-2" },
          accionExtra,
          h("button", {
            className: "normal-case text-primary hover:underline",
            onClick: function () { setEditando(!editando); },
          }, editando ? "cerrar" : "+ agregar"))),
      lista.map(function (v, i) { return h(ItemNif, { key: i, valor: v }); }),
      lista.length === 0 ? h("div", { className: "text-xs text-muted-foreground py-1" }, "—") : null,
      editando
        ? h("div", { className: "flex flex-col gap-1 mt-1" },
            h("textarea", {
              className: "min-h-16 w-full rounded border bg-background p-1.5 font-mono text-xs",
              placeholder: campo === "subjects" || campo === "norms" || campo === "hypotheses" || campo === "gaps"
                ? 'JSON del ítem, ej. {"label": "Trabajador"}' : "Texto del ítem",
              value: nuevo,
              onChange: function (ev) { setNuevo(ev.target.value); },
            }),
            h(C.Button, {
              className: "self-start",
              onClick: function () {
                var raw = nuevo.trim();
                if (!raw) return;
                var valor;
                try { valor = JSON.parse(raw); }
                catch (e) {
                  valor = raw;  // las secciones de hechos son strings
                }
                onAgregar(campo, valor);
                setNuevo("");
                setEditando(false);
              },
            }, "Guardar"))
        : null);
  }

  function NifBoard(props) {
    var caso = props.caso;
    var _a = useState(null), data = _a[0], setData = _a[1];
    var _b = useState(null), error = _b[0], setError = _b[1];
    var _c = useState(""), conf = _c[0], setConf = _c[1];
    var _d = useState(false), ocupado = _d[0], setOcupado = _d[1];
    var onCambio = props.onCambio;

    var cargar = useCallback(function () {
      setError(null);
      SDK.fetchJSON("/api/plugins/dike/nif/snapshot?case_id=" + encodeURIComponent(caso.case_id))
        .then(setData)
        .catch(function (e) { setError(e); });
    }, [caso.case_id]);

    useEffect(function () { cargar(); }, [cargar]);

    var accion = useCallback(function (fn) {
      return function () {
        var args = arguments;
        if (ocupado) return;
        setOcupado(true);
        setError(null);
        Promise.resolve(fn.apply(null, args))
          .then(function () { cargar(); if (onCambio) onCambio(); })
          .catch(function (e) { setError(e); })
          .finally(function () { setOcupado(false); });
      };
    }, [ocupado, cargar, onCambio]);

    var post = function (ruta, body) {
      return SDK.fetchJSON("/api/plugins/dike" + ruta, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    };

    if (error && !data) {
      return h("div", { className: "text-xs text-destructive" }, mensajeError(error));
    }
    if (!data) return h("div", { className: "text-xs text-muted-foreground" }, "Cargando NIF…");

    var snap = data.snapshot || {};
    var nif = snap.nif;
    if (!snap.exists || !nif) {
      return h("div", { className: "text-sm text-muted-foreground" },
        "Este caso no tiene NIF todavía.");
    }
    var patches = (data.patches && data.patches.patches) || [];
    var gaps = nif.gaps || [];

    return h("div", { className: "flex flex-col gap-3" },
      h("div", { className: "flex flex-wrap items-center gap-2 text-xs" },
        h(C.Badge, { variant: nif.validated_by_human ? "default" : "secondary" },
          nif.validated_by_human ? "validado por humano" : "sin validación humana"),
        h("span", { className: "text-muted-foreground" },
          "v" + snap.version + " · confianza " + Math.round((nif.confidence || 0) * 100) + "%"),
        h("button", {
          className: "text-primary hover:underline",
          onClick: accion(function () {
            return post("/nif/validar", { case_id: caso.case_id, validated: !nif.validated_by_human });
          }),
        }, nif.validated_by_human ? "retirar validación" : "marcar validado"),
        h("span", { className: "flex items-center gap-1" },
          h("input", {
            type: "number", min: "0", max: "1", step: "0.05",
            className: "w-16 rounded border bg-background px-1 py-0.5 text-xs",
            placeholder: String(nif.confidence || 0),
            value: conf,
            onChange: function (ev) { setConf(ev.target.value); },
          }),
          h("button", {
            className: "text-primary hover:underline",
            onClick: accion(function () {
              return post("/nif/confianza", { case_id: caso.case_id, confidence: parseFloat(conf) });
            }),
          }, "fijar confianza"))),
      h("div", { className: "text-sm font-medium" }, nif.legal_question || caso.legal_question || ""),
      h("div", { className: "grid grid-cols-1 md:grid-cols-2 gap-2" },
        SECCIONES_NIF.map(function (par) {
          var campo = par[0], titulo = par[1];
          var valores;
          if (campo.indexOf("facts.") === 0) valores = (nif.facts || {})[campo.slice(6)] || [];
          else valores = nif[campo] || [];
          return h(SeccionNif, {
            key: campo, titulo: titulo, valores: valores, campo: campo,
            onAgregar: function (fp, v) {
              accion(function () {
                return post("/nif/edit", { case_id: caso.case_id, field_path: fp, value: v });
              })();
            },
          });
        })),
      gaps.length
        ? h("div", { className: "rounded-md border p-2" },
            h("div", { className: "text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1" },
              "Resolver vacíos"),
            gaps.map(function (g, i) {
              if (g.status === "filled") return null;
              return h(GapRow, {
                key: i, gap: g, index: i, ocupado: ocupado,
                onResolver: accion(function (idx, by, with_) {
                  return post("/nif/gap", {
                    case_id: caso.case_id, gap_index: idx,
                    filled_by: by, filled_with: with_,
                  });
                }),
              });
            }))
        : null,
      patches.length
        ? h("details", { className: "text-xs" },
            h("summary", { className: "cursor-pointer text-muted-foreground" },
              "Historial de parches (" + patches.length + ")"),
            patches.slice(-12).reverse().map(function (p, i) {
              return h("div", { key: i, className: "border-b border-border/40 py-1" },
                h("span", { className: "text-muted-foreground" },
                  (p.timestamp || "").slice(0, 19).replace("T", " ") + " · "),
                h("span", null, p.agent_id + " → " + p.field_path + " (" + p.operation + ")"),
                p.reason ? h("div", { className: "text-muted-foreground" }, p.reason) : null);
            }))
        : null,
      error ? h("div", { className: "text-xs text-destructive" }, mensajeError(error)) : null);
  }

  function GapRow(props) {
    var g = props.gap;
    var _a = useState(""), by = _a[0], setBy = _a[1];
    var _b = useState(""), with_ = _b[0], setWith = _b[1];
    return h("div", { className: "flex flex-col gap-1 border-b border-border/40 py-1.5 last:border-0 text-xs" },
      h("div", null, g.description || JSON.stringify(g)),
      h("div", { className: "text-muted-foreground" },
        "impacto " + (g.impact || "?") + (g.demanded_by ? " · pide " + g.demanded_by : "")),
      h("div", { className: "flex gap-1" },
        h("input", { className: "w-28 rounded border bg-background px-1.5 py-0.5",
          placeholder: "quién", value: by, onChange: function (e) { setBy(e.target.value); } }),
        h("input", { className: "flex-1 rounded border bg-background px-1.5 py-0.5",
          placeholder: "con qué se llena", value: with_, onChange: function (e) { setWith(e.target.value); } }),
        h("button", {
          className: "rounded border px-2 py-0.5 hover:bg-accent/40",
          disabled: props.ocupado || !by.trim() || !with_.trim(),
          onClick: function () { props.onResolver(props.index, by.trim(), with_.trim()); },
        }, "llenar")));
  }

  function SeccionNifPanel() {
    var _a = useState({ cases: [] }), lista = _a[0], setLista = _a[1];
    var _b = useState(null), error = _b[0], setError = _b[1];
    var _c = useState(null), casoSel = _c[0], setCasoSel = _c[1];
    var _d = useState(""), nuevoId = _d[0], setNuevoId = _d[1];
    var _e = useState(""), nuevaPregunta = _e[0], setNuevaPregunta = _e[1];
    var _f = useState(false), ocupado = _f[0], setOcupado = _f[1];

    var cargar = useCallback(function () {
      setError(null);
      SDK.fetchJSON("/api/plugins/dike/nif/casos")
        .then(function (d) {
          setLista(d);
          setCasoSel(function (prev) {
            if (prev) return prev;
            var cases = (d && d.cases) || [];
            return cases.length ? cases[0] : null;
          });
        })
        .catch(function (e) { setError(e); });
    }, []);

    useEffect(function () { cargar(); }, [cargar]);

    var post = function (ruta, body) {
      return SDK.fetchJSON("/api/plugins/dike" + ruta, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    };

    var casos = lista.cases || [];
    return h("div", { className: "flex flex-col gap-3" },
      h("div", { className: "flex flex-wrap items-center gap-2" },
        h("select", {
          className: "rounded-md border bg-background px-2 py-1.5 text-sm",
          value: casoSel ? casoSel.case_id : "",
          onChange: function (ev) {
            var c = casos.filter(function (x) { return x.case_id === ev.target.value; })[0];
            setCasoSel(c || null);
          },
        },
          casos.length === 0
            ? h("option", { value: "" }, "Sin casos")
            : casos.map(function (c) {
                return h("option", { key: c.case_id, value: c.case_id },
                  c.case_id + " — " + String(c.legal_question || "").slice(0, 60));
              })),
        h(C.Button, {
          disabled: ocupado,
          onClick: function () {
            setOcupado(true);
            post("/nif/seed", { case_id: "demo-caso" })
              .then(cargar)
              .catch(function (e) { setError(e); })
              .finally(function () { setOcupado(false); });
          },
        }, ocupado ? "…" : "Cargar caso demo"),
        h("span", { className: "flex items-center gap-1" },
          h("input", {
            className: "w-32 rounded-md border bg-background px-2 py-1.5 text-xs",
            placeholder: "id del caso",
            value: nuevoId,
            onChange: function (e) { setNuevoId(e.target.value); },
          }),
          h("input", {
            className: "w-64 rounded-md border bg-background px-2 py-1.5 text-xs",
            placeholder: "pregunta jurídica",
            value: nuevaPregunta,
            onChange: function (e) { setNuevaPregunta(e.target.value); },
          }),
          h(C.Button, {
            disabled: ocupado || !nuevoId.trim() || !nuevaPregunta.trim(),
            onClick: function () {
              setOcupado(true);
              post("/nif/init", { case_id: nuevoId.trim(), pregunta: nuevaPregunta.trim() })
                .then(function () { setNuevoId(""); setNuevaPregunta(""); cargar(); })
                .catch(function (e) { setError(e); })
                .finally(function () { setOcupado(false); });
            },
          }, "Nuevo caso"))),
      error ? h("div", { className: "text-xs text-destructive" }, mensajeError(error)) : null,
      casos.length === 0 && !error
        ? h("div", { className: "text-sm text-muted-foreground rounded-md border p-3" },
            "No hay casos todavía. Siembra el caso demo (despido injustificado, art. 161/168 CT) " +
            "o crea uno con la pregunta jurídica del caso.")
        : null,
      casoSel
        ? h(NifBoard, { caso: casoSel, onCambio: cargar })
        : null);
  }

  // ------------------------------------------------------------------

  function DikePage() {
    var _a = useState(null), estado = _a[0], setEstado = _a[1];
    var _b = useState(null), estadoError = _b[0], setEstadoError = _b[1];
    var _c = useState("escrito"), pestana = _c[0], setPestana = _c[1];

    var cargar = useCallback(function () {
      setEstadoError(null);
      SDK.fetchJSON("/api/plugins/dike/estado")
        .then(setEstado)
        .catch(function (e) { setEstadoError(e); });
    }, []);

    useEffect(function () { cargar(); }, [cargar]);

    var pestanas = [
      ["escrito", "Verificar escrito"],
      ["grafo", "Grafo"],
      ["nif", "NIF"],
    ];

    return h("div", { className: "flex flex-col gap-4 p-4 text-sm" },
      h("div", { className: "flex items-start justify-between gap-3" },
        h("div", null,
          h("h1", { className: "text-lg font-semibold" }, "Diké"),
          h("p", { className: "text-xs text-muted-foreground" },
            "Verificación local de citas, mapa del corpus y tablero NIF. No es consejo legal.")),
        h("button", { className: "text-xs text-muted-foreground hover:text-foreground",
          onClick: cargar }, "↻")),
      h(C.Card, null,
        h(C.CardContent, { className: "pt-4" }, h(Estado, { estado: estado, error: estadoError }))),
      h("div", { className: "flex gap-1 border-b" },
        pestanas.map(function (p) {
          var activa = pestana === p[0];
          return h("button", {
            key: p[0],
            className: "px-3 py-1.5 text-sm rounded-t-md " +
              (activa ? "bg-accent font-medium" : "text-muted-foreground hover:text-foreground"),
            onClick: function () { setPestana(p[0]); },
          }, p[1]);
        })),
      pestana === "escrito" ? h(SeccionEscrito) : null,
      pestana === "grafo" ? h(SeccionGrafo) : null,
      pestana === "nif" ? h(SeccionNifPanel) : null);
  }

  window.__HERMES_PLUGINS__.register("dike", DikePage);
})();
