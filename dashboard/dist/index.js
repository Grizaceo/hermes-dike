/* Diké — web dashboard tab. The backend is /api/plugins/dike/
 * (dashboard/plugin_api.py); the same adapter serves the Desktop app page.
 * Three sections: citation check on a brief, the sealed corpus map and the
 * case board. All user-visible strings live in T below: English is canonical,
 * Spanish is the alternative the user can switch to (dike.idioma).
 */
(function () {
  "use strict";

  var SDK = window.__HERMES_PLUGIN_SDK__;
  if (!SDK) return;
  var React = SDK.React;
  var useCallback = React.useCallback;
  var useEffect = React.useEffect;
  var useState = React.useState;
  var h = React.createElement;
  var C = SDK.components;
  var useI18n = SDK.useI18n || function () { return { locale: "en" }; };

  // i18n:T:begin
  var T = {
    "en": {
      "idioma.grupo": "Language",
      "cabecera.sub": "Local citation checks, corpus map and case board. Not legal advice.",
      "accion.actualizar": "Refresh",
      "tab.escrito": "Check brief",
      "tab.grafo": "Corpus graph",
      "tab.nif": "Case board",
      "tab.nif_pista": "Case board (NIF: facts, norms, hypotheses and gaps)",
      "comun.cargando": "Loading…",
      "estado.error": "The Diké backend is not responding in this profile ({error}). Install and enable it in the active profile: hermes -p <profile> plugins install Grizaceo/hermes-dike --enable",
      "estado.cargando": "Loading status…",
      "estado.instalado": "corpus installed",
      "estado.sin_instalar": "corpus not installed",
      "estado.pack": "corpus pack {hash} · {leyes} laws · {articulos} articles",
      "estado.aislado": "sandboxed (bubblewrap)",
      "estado.no_aislado": "not sandboxed: {motivo}",
      "aislamiento.NO_INSTALADO": "bubblewrap not installed",
      "aislamiento.USERNS_DENEGADO": "user namespaces denied",
      "aislamiento.OTRO": "sandbox unavailable",
      "escrito.titulo": "Brief check (citation check + plain-language review)",
      "escrito.ph": "Start writing or paste the brief text…",
      "escrito.aria": "Brief text",
      "escrito.verificar": "Check citations",
      "escrito.verificando": "Checking…",
      "escrito.estilo": "Review style (plain language)",
      "escrito.demo": "Load demo brief",
      "escrito.primera": "The first check installs the corpus (~1 min).",
      "escrito.estilo_titulo": "Plain-language review — Score: {score}/100 · Judicial alignment: {alineacion}/100",
      "escrito.estilo_stats": "Sentences: {n} · Average: {avg} words/sentence · Archaisms: {arca} · Nominalizations: {nom}",
      "escrito.vacio": "The citation check and the plain-language review appear here once you run them on the text above.",
      "res.error": "Diké could not check the brief: {msg}",
      "res.resumen": "Diké: {v} of {total} citations verified ({veredicto}) · corpus {hash}",
      "res.no_verificadas": "Mentions without an article, not verified: {lista}",
      "res.nota": "It does not certify that the article supports the argument, nor that the copy (retrieved {fecha}) is the text in force today.",
      "cita.ok": "verified",
      "cita.fallo": "not verified",
      "codigo.AMBIGUOUS": "ambiguous",
      "codigo.UNRESOLVABLE": "could not be resolved",
      "codigo.PROVENANCE_INCOMPLETE": "incomplete provenance",
      "codigo.NOT_IN_FORCE": "not in force",
      "codigo.TEMPORAL_UNKNOWN": "temporal status unknown",
      "codigo.HISTORICAL_TEXT_UNAVAILABLE": "historical text unavailable",
      "grafo.corpus": "Sealed corpus",
      "grafo.vigencia": "in-force records: {n}",
      "grafo.cargando": "Reading the corpus…",
      "grafo.sin_pack": "No corpus pack installed yet — the first citation check installs it.",
      "grafo.sin_normas": "This pack lists no statutes.",
      "grafo.articulos": "{n} articles",
      "grafo.mostrando": "(showing {n})",
      "grafo.cargando_art": "Loading articles…",
      "grafo.desde": "from {fecha}",
      "grafo.personal": "Personal review graph",
      "grafo.candidatos": "{c} candidates · {a} edges",
      "grafo.vacio_personal": "No candidates yet: the personal review graph fills as agents or the brief feed evidence into it.",
      "nif.cargando": "Loading case board…",
      "nif.vacio_caso": "This case has no board yet.",
      "nif.humano": "human-validated",
      "nif.sin_humano": "not human-validated",
      "nif.version": "v{v} · confidence {c}%",
      "nif.validar": "Mark as validated",
      "nif.retirar": "Remove validation",
      "nif.confianza_aria": "Confidence, 0 to 1",
      "nif.fijar": "Set confidence",
      "nif.resolver": "Resolve gaps",
      "nif.historial": "Patch history ({n})",
      "nif.agregar": "+ add",
      "nif.cerrar": "Close",
      "nif.guardar": "Save",
      "nif.item_json": "Item JSON, e.g. {\"label\": \"Employee\"}",
      "nif.item_texto": "Item text",
      "nif.item_aria": "New item",
      "nif.impacto": "Impact {x}",
      "nif.pide": "demanded by {x}",
      "nif.quien": "who",
      "nif.con_que": "filled with",
      "nif.llenar": "Fill",
      "nif.casos_aria": "Case",
      "nif.sin_casos": "No cases",
      "nif.demo_caso": "Load demo case",
      "nif.id_caso": "case id",
      "nif.pregunta": "legal question",
      "nif.nuevo_caso": "New case",
      "nif.vacio_casos": "No cases yet. Load the demo case (unfair dismissal, art. 161/168 Labour Code) or create one with the case's legal question.",
      "nifsec.facts.known": "Known facts",
      "nifsec.facts.alleged": "Alleged facts",
      "nifsec.facts.missing": "Missing facts",
      "nifsec.subjects": "Subjects",
      "nifsec.norms": "Norms",
      "nifsec.norm_relations": "Relations between norms",
      "nifsec.admin_acts": "Administrative acts",
      "nifsec.principles": "Principles",
      "nifsec.deontic_positions": "Deontic positions",
      "nifsec.conflicts": "Conflicts",
      "nifsec.hypotheses": "Hypotheses",
      "nifsec.gaps": "Gaps",
      "nifsec.relevant_factors": "Relevant factors"
    },
    "es": {
      "idioma.grupo": "Idioma",
      "cabecera.sub": "Verificación local de citas, mapa del corpus y tablero del caso. No es consejo legal.",
      "accion.actualizar": "Actualizar",
      "tab.escrito": "Verificar escrito",
      "tab.grafo": "Grafo",
      "tab.nif": "Tablero",
      "tab.nif_pista": "Tablero del caso (NIF: hechos, normas, hipótesis y vacíos)",
      "comun.cargando": "Consultando…",
      "estado.error": "El backend de Diké no responde en este perfil ({error}). Instálalo y habilítalo en el perfil activo: hermes -p <perfil> plugins install Grizaceo/hermes-dike --enable",
      "estado.cargando": "Consultando el corpus…",
      "estado.instalado": "corpus instalado",
      "estado.sin_instalar": "corpus sin instalar",
      "estado.pack": "pack {hash} · {leyes} leyes · {articulos} artículos",
      "estado.aislado": "en sandbox (bubblewrap)",
      "estado.no_aislado": "sin sandbox: {motivo}",
      "aislamiento.NO_INSTALADO": "bubblewrap no instalado",
      "aislamiento.USERNS_DENEGADO": "namespaces de usuario denegadas",
      "aislamiento.OTRO": "sandbox no disponible",
      "escrito.titulo": "Verificación del escrito (citas + Escribe Claro)",
      "escrito.ph": "Comience a redactar o pegue el texto del escrito…",
      "escrito.aria": "Texto del escrito",
      "escrito.verificar": "Verificar citas",
      "escrito.verificando": "Verificando…",
      "escrito.estilo": "Revisar estilo (Escribe Claro)",
      "escrito.demo": "Cargar escrito demo",
      "escrito.primera": "La primera llamada instala el corpus (~1 min).",
      "escrito.estilo_titulo": "Escribe Claro — Puntaje: {score}/100 · Alineación judicial: {alineacion}/100",
      "escrito.estilo_stats": "Oraciones: {n} · Promedio: {avg} pal/oración · Arcaísmos: {arca} · Nominalizaciones: {nom}",
      "escrito.vacio": "La verificación de citas y la revisión de estilo aparecen aquí cuando las ejecutas sobre el texto de arriba.",
      "res.error": "Diké no pudo revisar el escrito: {msg}",
      "res.resumen": "Diké: {v} de {total} citas verificadas ({veredicto}) · corpus {hash}",
      "res.no_verificadas": "Menciones sin artículo, no verificadas: {lista}",
      "res.nota": "No certifica que el artículo respalde el argumento ni que la copia (obtenida {fecha}) sea el texto vigente hoy.",
      "cita.ok": "verificada",
      "cita.fallo": "no verificada",
      "codigo.AMBIGUOUS": "ambigua",
      "codigo.UNRESOLVABLE": "no se pudo resolver",
      "codigo.PROVENANCE_INCOMPLETE": "procedencia incompleta",
      "codigo.NOT_IN_FORCE": "no vigente",
      "codigo.TEMPORAL_UNKNOWN": "estado temporal desconocido",
      "codigo.HISTORICAL_TEXT_UNAVAILABLE": "texto histórico no disponible",
      "grafo.corpus": "Corpus sellado",
      "grafo.vigencia": "registros de vigencia: {n}",
      "grafo.cargando": "Leyendo el corpus…",
      "grafo.sin_pack": "Todavía no hay corpus instalado: la primera verificación de citas lo instala.",
      "grafo.sin_normas": "Este pack no tiene normas.",
      "grafo.articulos": "{n} artículos",
      "grafo.mostrando": "(mostrando {n})",
      "grafo.cargando_art": "Cargando artículos…",
      "grafo.desde": "desde {fecha}",
      "grafo.personal": "Grafo personal",
      "grafo.candidatos": "{c} candidatos · {a} aristas",
      "grafo.vacio_personal": "Sin candidatos todavía: el grafo personal se llena cuando agentes o el escrito alimentan evidencia.",
      "nif.cargando": "Cargando tablero…",
      "nif.vacio_caso": "Este caso no tiene tablero todavía.",
      "nif.humano": "validado por humano",
      "nif.sin_humano": "sin validación humana",
      "nif.version": "v{v} · confianza {c}%",
      "nif.validar": "Marcar validado",
      "nif.retirar": "Retirar validación",
      "nif.confianza_aria": "Confianza, de 0 a 1",
      "nif.fijar": "Fijar confianza",
      "nif.resolver": "Resolver vacíos",
      "nif.historial": "Historial de parches ({n})",
      "nif.agregar": "+ agregar",
      "nif.cerrar": "Cerrar",
      "nif.guardar": "Guardar",
      "nif.item_json": "JSON del ítem, ej. {\"label\": \"Trabajador\"}",
      "nif.item_texto": "Texto del ítem",
      "nif.item_aria": "Ítem nuevo",
      "nif.impacto": "impacto {x}",
      "nif.pide": "pide {x}",
      "nif.quien": "quién",
      "nif.con_que": "con qué se llena",
      "nif.llenar": "Llenar",
      "nif.casos_aria": "Caso",
      "nif.sin_casos": "Sin casos",
      "nif.demo_caso": "Cargar caso demo",
      "nif.id_caso": "id del caso",
      "nif.pregunta": "pregunta jurídica",
      "nif.nuevo_caso": "Nuevo caso",
      "nif.vacio_casos": "No hay casos todavía. Siembra el caso demo (despido injustificado, art. 161/168 CT) o crea uno con la pregunta jurídica del caso.",
      "nifsec.facts.known": "Hechos conocidos",
      "nifsec.facts.alleged": "Hechos alegados",
      "nifsec.facts.missing": "Hechos faltantes",
      "nifsec.subjects": "Sujetos",
      "nifsec.norms": "Normas",
      "nifsec.norm_relations": "Relaciones entre normas",
      "nifsec.admin_acts": "Actos administrativos",
      "nifsec.principles": "Principios",
      "nifsec.deontic_positions": "Posiciones deónticas",
      "nifsec.conflicts": "Conflictos",
      "nifsec.hypotheses": "Hipótesis",
      "nifsec.gaps": "Vacíos",
      "nifsec.relevant_factors": "Factores relevantes"
    }
  };
  // i18n:T:end

  var IDIOMA_KEY = "dike.idioma";
  var _idioma = "en";

  function t(key, vars) {
    var s = T[_idioma] && T[_idioma][key];
    if (typeof s !== "string") s = T.es[key];
    if (typeof s !== "string") s = T.en[key];
    if (typeof s !== "string") s = key;
    if (vars) {
      for (var k in vars) {
        s = s.split("{" + k + "}").join(String(vars[k]));
      }
    }
    return s;
  }

  function idiomaGuardado() {
    try {
      var v = window.localStorage.getItem(IDIOMA_KEY);
      if (v === "en" || v === "es") return v;
    } catch (e) {}
    return null;
  }

  function elegirIdioma(lang) {
    _idioma = lang;
    try { window.localStorage.setItem(IDIOMA_KEY, lang); } catch (e) {}
  }

  // dike:confianza-validar:begin
  function confianzaValida(raw) {
    var s = String(raw == null ? "" : raw).trim();
    if (!s) return null;
    var n = Number(s);
    return isFinite(n) && n >= 0 && n <= 1 ? n : null;
  }
  // dike:confianza-validar:end

  function mensajeError(e) {
    var raw = (e && (e.message || e.detail)) || String(e);
    var m = String(raw).match(/^\d{3}:\s*([\s\S]*)$/);
    var body = m ? m[1] : String(raw);
    try {
      var parsed = JSON.parse(body);
      if (parsed && typeof parsed.detail === "string") return parsed.detail;
      if (parsed && Array.isArray(parsed.detail)) {
        return parsed.detail.map(function (d) {
          return d && d.msg ? String(d.msg) : JSON.stringify(d);
        }).join("; ");
      }
      if (parsed && parsed.detail != null) {
        return typeof parsed.detail === "string" ? parsed.detail : JSON.stringify(parsed.detail);
      }
    } catch (err) {}
    return body;
  }

  function post(url, body) {
    return SDK.fetchJSON(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  function Estado(props) {
    var e = props.estado;
    var err = props.error;
    if (err) {
      return h("div", { className: "text-xs text-muted-foreground" },
        t("estado.error", { error: mensajeError(err) }));
    }
    if (!e) {
      return h("div", { className: "text-xs text-muted-foreground" }, t("estado.cargando"));
    }
    var aisl = e.aislamiento || {};
    var glosasAislamiento = {
      NO_INSTALADO: t("aislamiento.NO_INSTALADO"),
      USERNS_DENEGADO: t("aislamiento.USERNS_DENEGADO"),
      OTRO: t("aislamiento.OTRO"),
    };
    var textoAislamiento = aisl.modo === "bwrap"
      ? t("estado.aislado")
      : t("estado.no_aislado", { motivo: glosasAislamiento[aisl.motivo] || aisl.motivo || "?" });
    return h("div", { className: "flex flex-wrap items-center gap-2 text-xs" },
      h(C.Badge, { tone: e.corpus_instalado ? "default" : "secondary" },
        e.corpus_instalado ? t("estado.instalado") : t("estado.sin_instalar")),
      h("span", { className: "text-muted-foreground" },
        t("estado.pack", {
          hash: e.pack_hash, leyes: e.leyes, articulos: e.articulos,
        }) + (e.version ? " · v" + e.version : "")),
      h("span", { className: "text-muted-foreground" }, textoAislamiento));
  }

  function Resultado(props) {
    var r = props.resultado;
    if (!r) return null;
    if (r.error) {
      var msg = String(r.error);
      if (msg.indexOf(": ") >= 0) msg = msg.split(": ").slice(1).join(": ");
      return h("div", { className: "rounded-md border border-destructive/40 p-3 text-sm" },
        t("res.error", { msg: msg }));
    }
    if (r.veredicto === "SIN_CITAS" || r.veredicto === "SIN_CORPUS") {
      return h("div", { className: "text-sm text-muted-foreground" }, "Diké: " + (r.mensaje || ""));
    }
    var meta = r.meta || {};
    var detalles = r.detalles || [];
    var fechas = detalles.map(function (d) { return d.fecha_recuperacion; })
      .filter(Boolean).map(String).sort();
    var fecha = fechas.length ? fechas[0].slice(0, 10) : "—";
    var glosas = {
      AMBIGUOUS: t("codigo.AMBIGUOUS"),
      UNRESOLVABLE: t("codigo.UNRESOLVABLE"),
      PROVENANCE_INCOMPLETE: t("codigo.PROVENANCE_INCOMPLETE"),
      NOT_IN_FORCE: t("codigo.NOT_IN_FORCE"),
      TEMPORAL_UNKNOWN: t("codigo.TEMPORAL_UNKNOWN"),
      HISTORICAL_TEXT_UNAVAILABLE: t("codigo.HISTORICAL_TEXT_UNAVAILABLE"),
    };
    return h("div", { className: "flex flex-col gap-2" },
      h("div", { className: "text-sm font-medium" },
        t("res.resumen", {
          v: meta.citas_verificadas, total: meta.total_citas,
          veredicto: r.veredicto, hash: meta.pack_hash,
        })),
      h("div", { className: "flex flex-col divide-y" },
        detalles.map(function (d, i) {
          var ok = d.estado === "VERIFICADA";
          var sub;
          if (ok) {
            sub = [d.gid, d.fuente_url].filter(Boolean).join(" · ");
          } else {
            var codigos = [d.estado, d.resolucion].filter(Boolean).map(String);
            sub = codigos.join(" · ");
            if (d.resolucion && glosas[d.resolucion]) sub += " — " + glosas[d.resolucion];
            if (d.motivo_adaptador) sub += (sub ? " — " : "") + d.motivo_adaptador;
          }
          return h("div", { key: i, className: "flex items-start gap-2 py-1.5 text-sm" },
            h("span", { className: ok ? "text-green-500" : "text-destructive" },
              ok ? "✓ " + t("cita.ok") : "✗ " + t("cita.fallo")),
            h("div", { className: "min-w-0" },
              h("div", null, d.cita_raw),
              h("div", { className: "text-xs text-muted-foreground break-all" }, sub)));
        })),
      (r.no_verificadas && r.no_verificadas.length)
        ? h("div", { className: "text-xs text-muted-foreground" },
            t("res.no_verificadas", { lista: r.no_verificadas.join(", ") }))
        : null,
      h("div", { className: "text-xs text-muted-foreground" },
        t("res.nota", { fecha: fecha })));
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
      var txt = texto.trim();
      if (!txt || ocupado) return;
      setOcupado(true);
      setError(null);
      post("/api/plugins/dike/verificar", { texto: txt })
        .then(setResultado)
        .catch(function (e) { setError(e); })
        .finally(function () { setOcupado(false); });
    }, [texto, ocupado]);

    var analizarEstilo = useCallback(function () {
      var txt = texto.trim();
      if (!txt || ocupado) return;
      setError(null);
      post("/api/plugins/dike/estilo/analizar", {
        texto: txt, contexto: "escrito", detallado: false,
      })
        .then(setEstilo)
        .catch(function (e) { setError(e); });
    }, [texto, ocupado]);

    var hayTexto = !!texto.trim();
    return h(C.Card, null,
      h(C.CardHeader, null, h(C.CardTitle, null, t("escrito.titulo"))),
      h(C.CardContent, { className: "flex flex-col gap-3" },
        h("textarea", {
          className: "min-h-56 w-full rounded-md border bg-background p-3 font-serif text-sm leading-relaxed outline-none shadow-2xs",
          placeholder: t("escrito.ph"),
          "aria-label": t("escrito.aria"),
          value: texto,
          onChange: function (ev) { setTexto(ev.target.value); },
        }),
        h("div", { className: "flex flex-wrap items-center gap-2" },
          h(C.Button, { size: "sm", onClick: verificar, disabled: ocupado || !hayTexto },
            ocupado ? t("escrito.verificando") : t("escrito.verificar")),
          h(C.Button, { size: "sm", outlined: true, onClick: analizarEstilo, disabled: ocupado || !hayTexto },
            t("escrito.estilo")),
          h(C.Button, { size: "sm", ghost: true, onClick: cargarDemo, disabled: ocupado },
            t("escrito.demo")),
          ocupado
            ? h("span", { className: "text-xs text-muted-foreground" }, t("escrito.primera"))
            : null),
        error
          ? h("div", { className: "text-xs text-destructive" }, mensajeError(error))
          : null,
        estilo
          ? h("div", { className: "rounded-md border p-3 text-xs flex flex-col gap-1.5" },
              h("div", { className: "font-semibold" },
                t("escrito.estilo_titulo", {
                  score: estilo.score,
                  alineacion: estilo.global_stats && estilo.global_stats.judicial_alignment_score,
                })),
              h("div", { className: "text-muted-foreground" },
                t("escrito.estilo_stats", {
                  n: estilo.global_stats && estilo.global_stats.total_sentences,
                  avg: estilo.global_stats && estilo.global_stats.avg_words_per_sentence,
                  arca: estilo.global_stats && estilo.global_stats.archaism_count,
                  nom: estilo.global_stats && estilo.global_stats.nominalization_count,
                })),
              (estilo.suggestions || []).slice(0, 6).map(function (s, i) {
                return h("div", { key: i, className: "text-muted-foreground" }, "• " + s.message);
              }))
          : null,
        !resultado && !ocupado && !error
          ? h("div", { className: "text-xs text-muted-foreground" }, t("escrito.vacio"))
          : null,
        h(Resultado, { resultado: resultado })));
  }

  // ------------------------------------------------------------------
  // Corpus graph
  // ------------------------------------------------------------------

  function NormaDetalle(props) {
    var data = props.data;
    var err = props.error;
    if (err) return h("div", { className: "text-xs text-destructive" }, mensajeError(err));
    if (!data) return h("div", { className: "text-xs text-muted-foreground" }, t("grafo.cargando_art"));
    var arts = data.articulos || [];
    return h("div", { className: "flex flex-col gap-1 pl-4" },
      h("div", { className: "text-xs text-muted-foreground" },
        t("grafo.articulos", { n: data.articulos_total || arts.length }) +
        (data.articulos_truncados ? " " + t("grafo.mostrando", { n: arts.length }) : "")),
      arts.map(function (a, i) {
        return h("details", { key: i, className: "text-xs" },
          h("summary", { className: "cursor-pointer py-0.5" },
            "art. " + (a.label || a.eId) +
            (a.estado ? " · " + a.estado : "") +
            (a.vigente_desde ? " · " + t("grafo.desde", { fecha: String(a.vigente_desde).slice(0, 10) }) : "")),
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
      (n.anio ? "/" + n.anio : "") + " · " + t("grafo.articulos", { n: n.articulos });
    return h("div", { className: "border-b border-border/60 py-1.5 last:border-0" },
      h("button", {
        type: "button",
        className: "flex w-full items-start gap-2 text-left text-sm hover:bg-accent/40 rounded px-1 -mx-1",
        "aria-expanded": abierta,
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
          h(C.CardTitle, null, t("grafo.corpus")),
          pack ? h("div", { className: "text-xs text-muted-foreground" },
            Object.keys(edges).map(function (k) { return k + ": " + edges[k]; }).join(" · ") +
            " · " + t("grafo.vigencia", { n: pack.vigencia || 0 })) : null),
        h(C.CardContent, null,
          corpusErr
            ? h("div", { className: "text-xs text-destructive" }, mensajeError(corpusErr))
            : !corpus
              ? h("div", { className: "text-xs text-muted-foreground" }, t("grafo.cargando"))
              : !pack
                ? h("div", { className: "text-xs text-muted-foreground" }, t("grafo.sin_pack"))
                : normas.length === 0
                  ? h("div", { className: "text-xs text-muted-foreground" }, t("grafo.sin_normas"))
                  : normas.map(function (n) { return h(NormaRow, { key: n.leychileCode, norma: n }); }))),
      h(C.Card, null,
        h(C.CardHeader, null, h(C.CardTitle, null, t("grafo.personal"))),
        h(C.CardContent, { className: "flex flex-col gap-2 text-xs" },
          personalErr
            ? h("div", { className: "text-destructive" }, mensajeError(personalErr))
            : !personal
              ? h("div", { className: "text-muted-foreground" }, t("comun.cargando"))
              : h("div", null,
                  t("grafo.candidatos", { c: candidatos.length, a: aristas.length }),
                  candidatos.length === 0
                    ? h("div", { className: "text-muted-foreground mt-1" }, t("grafo.vacio_personal"))
                    : candidatos.map(function (c, i) {
                        return h("div", { key: i, className: "border-b border-border/60 py-1 last:border-0" },
                          h("div", null, (c.candidate_id || "") + " · " + (c.state_human || c.state || "")),
                          h("div", { className: "text-muted-foreground" },
                            String(c.text || c.summary || "").slice(0, 160)));
                      })))));
  }

  // ------------------------------------------------------------------
  // Case board
  // ------------------------------------------------------------------

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
    var _a = useState(""), nuevo = _a[0], setNuevo = _a[1];
    var _b = useState(false), editando = _b[0], setEditando = _b[1];
    var lista = Array.isArray(valores) ? valores : [];
    return h("div", { className: "rounded-md border p-2" },
      h("div", { className: "flex items-center justify-between text-xs font-medium uppercase tracking-wide text-muted-foreground" },
        h("span", null, titulo + " (" + lista.length + ")"),
        h("span", { className: "flex gap-2" },
          h(C.Button, {
            size: "sm", ghost: true, className: "normal-case",
            onClick: function () { setEditando(!editando); },
          }, editando ? t("nif.cerrar") : t("nif.agregar")))),
      lista.map(function (v, i) { return h(ItemNif, { key: i, valor: v }); }),
      lista.length === 0 ? h("div", { className: "text-xs text-muted-foreground py-1" }, "—") : null,
      editando
        ? h("div", { className: "flex flex-col gap-1 mt-1" },
            h("textarea", {
              className: "min-h-16 w-full rounded border bg-background p-1.5 font-mono text-xs",
              placeholder: campo === "subjects" || campo === "norms" || campo === "hypotheses" || campo === "gaps"
                ? t("nif.item_json") : t("nif.item_texto"),
              "aria-label": t("nif.item_aria"),
              value: nuevo,
              onChange: function (ev) { setNuevo(ev.target.value); },
            }),
            h(C.Button, {
              size: "sm",
              className: "self-start",
              onClick: function () {
                var raw = nuevo.trim();
                if (!raw) return;
                var valor;
                try { valor = JSON.parse(raw); }
                catch (e) {
                  valor = raw;  // fact sections are plain strings
                }
                onAgregar(campo, valor);
                setNuevo("");
                setEditando(false);
              },
            }, t("nif.guardar")))
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

    var confValida = confianzaValida(conf);

    if (error && !data) {
      return h("div", { className: "text-xs text-destructive" }, mensajeError(error));
    }
    if (!data) return h("div", { className: "text-xs text-muted-foreground" }, t("nif.cargando"));

    var snap = data.snapshot || {};
    var nif = snap.nif;
    if (!snap.exists || !nif) {
      return h("div", { className: "text-sm text-muted-foreground" },
        t("nif.vacio_caso"));
    }
    var patches = (data.patches && data.patches.patches) || [];
    var gaps = nif.gaps || [];
    var secciones = [
      ["facts.known", t("nifsec.facts.known")],
      ["facts.alleged", t("nifsec.facts.alleged")],
      ["facts.missing", t("nifsec.facts.missing")],
      ["subjects", t("nifsec.subjects")],
      ["norms", t("nifsec.norms")],
      ["norm_relations", t("nifsec.norm_relations")],
      ["admin_acts", t("nifsec.admin_acts")],
      ["principles", t("nifsec.principles")],
      ["deontic_positions", t("nifsec.deontic_positions")],
      ["conflicts", t("nifsec.conflicts")],
      ["hypotheses", t("nifsec.hypotheses")],
      ["gaps", t("nifsec.gaps")],
      ["relevant_factors", t("nifsec.relevant_factors")],
    ];

    return h("div", { className: "flex flex-col gap-3" },
      h("div", { className: "flex flex-wrap items-center gap-2 text-xs" },
        h(C.Badge, { tone: nif.validated_by_human ? "default" : "secondary" },
          nif.validated_by_human ? t("nif.humano") : t("nif.sin_humano")),
        h("span", { className: "text-muted-foreground" },
          t("nif.version", { v: snap.version, c: Math.round((nif.confidence || 0) * 100) })),
        h(C.Button, {
          size: "sm", ghost: true,
          onClick: accion(function () {
            return post("/api/plugins/dike/nif/validar", { case_id: caso.case_id, validated: !nif.validated_by_human });
          }),
        }, nif.validated_by_human ? t("nif.retirar") : t("nif.validar")),
        h("span", { className: "flex items-center gap-1" },
          h("input", {
            type: "number", min: "0", max: "1", step: "0.05",
            className: "w-16 rounded border bg-background px-1 py-0.5 text-xs",
            "aria-label": t("nif.confianza_aria"),
            placeholder: String(nif.confidence || 0),
            value: conf,
            onChange: function (ev) { setConf(ev.target.value); },
          }),
          h(C.Button, {
            size: "sm", outlined: true,
            disabled: ocupado || confValida === null,
            onClick: accion(function () {
              return post("/api/plugins/dike/nif/confianza", { case_id: caso.case_id, confidence: confValida });
            }),
          }, t("nif.fijar")))),
      h("div", { className: "text-sm font-medium" }, nif.legal_question || caso.legal_question || ""),
      h("div", { className: "grid grid-cols-1 md:grid-cols-2 gap-2" },
        secciones.map(function (par) {
          var campo = par[0], titulo = par[1];
          var valores;
          if (campo.indexOf("facts.") === 0) valores = (nif.facts || {})[campo.slice(6)] || [];
          else valores = nif[campo] || [];
          return h(SeccionNif, {
            key: campo, titulo: titulo, valores: valores, campo: campo,
            onAgregar: function (fp, v) {
              accion(function () {
                return post("/api/plugins/dike/nif/edit", { case_id: caso.case_id, field_path: fp, value: v });
              })();
            },
          });
        })),
      gaps.length
        ? h("div", { className: "rounded-md border p-2" },
            h("div", { className: "text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1" },
              t("nif.resolver")),
            gaps.map(function (g, i) {
              if (g.status === "filled") return null;
              return h(GapRow, {
                key: i, gap: g, index: i, ocupado: ocupado,
                onResolver: accion(function (idx, by, with_) {
                  return post("/api/plugins/dike/nif/gap", {
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
              t("nif.historial", { n: patches.length })),
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
        t("nif.impacto", { x: g.impact || "?" }) +
        (g.demanded_by ? " · " + t("nif.pide", { x: g.demanded_by }) : "")),
      h("div", { className: "flex gap-1" },
        h("input", { className: "w-28 rounded border bg-background px-1.5 py-0.5",
          placeholder: t("nif.quien"), "aria-label": t("nif.quien"),
          value: by, onChange: function (e) { setBy(e.target.value); } }),
        h("input", { className: "flex-1 rounded border bg-background px-1.5 py-0.5",
          placeholder: t("nif.con_que"), "aria-label": t("nif.con_que"),
          value: with_, onChange: function (e) { setWith(e.target.value); } }),
        h(C.Button, {
          size: "sm",
          disabled: props.ocupado || !by.trim() || !with_.trim(),
          onClick: function () { props.onResolver(props.index, by.trim(), with_.trim()); },
        }, t("nif.llenar"))));
  }

  function SeccionNifPanel() {
    var _a = useState(null), lista = _a[0], setLista = _a[1];
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

    var casos = (lista && lista.cases) || [];
    return h("div", { className: "flex flex-col gap-3" },
      h("div", { className: "flex flex-wrap items-center gap-2" },
        h("select", {
          className: "rounded-md border bg-background px-2 py-1.5 text-sm",
          "aria-label": t("nif.casos_aria"),
          disabled: !lista,
          value: casoSel ? casoSel.case_id : "",
          onChange: function (ev) {
            var c = casos.filter(function (x) { return x.case_id === ev.target.value; })[0];
            setCasoSel(c || null);
          },
        },
          casos.length === 0
            ? h("option", { value: "" }, t("nif.sin_casos"))
            : casos.map(function (c) {
                return h("option", { key: c.case_id, value: c.case_id },
                  c.case_id + " — " + String(c.legal_question || "").slice(0, 60));
              })),
        h(C.Button, {
          size: "sm", outlined: true,
          disabled: ocupado,
          onClick: function () {
            setOcupado(true);
            post("/api/plugins/dike/nif/seed", { case_id: "demo-caso" })
              .then(cargar)
              .catch(function (e) { setError(e); })
              .finally(function () { setOcupado(false); });
          },
        }, ocupado ? "…" : t("nif.demo_caso")),
        h("span", { className: "flex items-center gap-1" },
          h("input", {
            className: "w-32 rounded-md border bg-background px-2 py-1.5 text-xs",
            placeholder: t("nif.id_caso"), "aria-label": t("nif.id_caso"),
            value: nuevoId,
            onChange: function (e) { setNuevoId(e.target.value); },
          }),
          h("input", {
            className: "w-64 rounded-md border bg-background px-2 py-1.5 text-xs",
            placeholder: t("nif.pregunta"), "aria-label": t("nif.pregunta"),
            value: nuevaPregunta,
            onChange: function (e) { setNuevaPregunta(e.target.value); },
          }),
          h(C.Button, {
            size: "sm",
            disabled: ocupado || !nuevoId.trim() || !nuevaPregunta.trim(),
            onClick: function () {
              setOcupado(true);
              post("/api/plugins/dike/nif/init", { case_id: nuevoId.trim(), pregunta: nuevaPregunta.trim() })
                .then(function () { setNuevoId(""); setNuevaPregunta(""); cargar(); })
                .catch(function (e) { setError(e); })
                .finally(function () { setOcupado(false); });
            },
          }, t("nif.nuevo_caso")))),
      error ? h("div", { className: "text-xs text-destructive" }, mensajeError(error)) : null,
      !lista && !error
        ? h("div", { className: "text-sm text-muted-foreground" }, t("comun.cargando"))
        : null,
      lista && casos.length === 0 && !error
        ? h("div", { className: "text-sm text-muted-foreground rounded-md border p-3" },
            t("nif.vacio_casos"))
        : null,
      casoSel
        ? h(NifBoard, { caso: casoSel, onCambio: cargar })
        : null);
  }

  // ------------------------------------------------------------------

  function DikePage() {
    var i18n = useI18n();
    var _a = useState(null), estado = _a[0], setEstado = _a[1];
    var _b = useState(null), estadoError = _b[0], setEstadoError = _b[1];
    var _c = useState("escrito"), pestana = _c[0], setPestana = _c[1];
    var _d = useState(function () {
      return idiomaGuardado() || (i18n.locale === "es" ? "es" : "en");
    }), idioma = _d[0], setIdiomaState = _d[1];
    _idioma = idioma;

    var cargar = useCallback(function () {
      setEstadoError(null);
      SDK.fetchJSON("/api/plugins/dike/estado")
        .then(setEstado)
        .catch(function (e) { setEstadoError(e); });
    }, []);

    useEffect(function () { cargar(); }, [cargar]);

    var pestanas = [
      ["escrito", t("tab.escrito"), null],
      ["grafo", t("tab.grafo"), null],
      ["nif", t("tab.nif"), t("tab.nif_pista")],
    ];

    return h("div", { className: "flex flex-col gap-4 p-4 text-sm" },
      h("div", { className: "flex items-start justify-between gap-3" },
        h("div", null,
          h("h1", { className: "text-lg font-semibold" }, "Diké"),
          h("p", { className: "text-xs text-muted-foreground" }, t("cabecera.sub"))),
        h("div", { className: "flex items-center gap-2" },
          h("div", { className: "flex items-center gap-1", role: "group", "aria-label": t("idioma.grupo") },
            ["en", "es"].map(function (l) {
              return h("button", {
                key: l, type: "button",
                className: "px-1.5 py-0.5 text-xs rounded " +
                  (idioma === l ? "bg-accent font-medium" : "text-muted-foreground hover:text-foreground"),
                "aria-pressed": idioma === l,
                onClick: function () {
                  if (l !== idioma) { elegirIdioma(l); setIdiomaState(l); }
                },
              }, l === "en" ? "EN" : "ES");
            })),
          h(C.Button, { size: "xs", ghost: true, "aria-label": t("accion.actualizar"),
            title: t("accion.actualizar"), onClick: cargar }, "↻"))),
      h(C.Card, null,
        h(C.CardContent, { className: "pt-4" }, h(Estado, { estado: estado, error: estadoError }))),
      h("div", { className: "flex gap-1 border-b" },
        pestanas.map(function (p) {
          var activa = pestana === p[0];
          return h("button", {
            key: p[0], type: "button",
            className: "px-3 py-1.5 text-sm rounded-t-md " +
              (activa ? "bg-accent font-medium" : "text-muted-foreground hover:text-foreground"),
            "aria-pressed": activa,
            title: p[2] || undefined,
            onClick: function () { setPestana(p[0]); },
          }, p[1]);
        })),
      pestana === "escrito" ? h(SeccionEscrito) : null,
      pestana === "grafo" ? h(SeccionGrafo) : null,
      pestana === "nif" ? h(SeccionNifPanel) : null);
  }

  window.__HERMES_PLUGINS__.register("dike", DikePage);
})();
