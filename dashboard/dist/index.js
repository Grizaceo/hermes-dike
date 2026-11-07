/* Diké — pestaña del dashboard web. El backend es /api/plugins/dike/
 * (dashboard/plugin_api.py); el mismo adaptador sirve a la página de la app
 * Desktop. Solo envía texto: los archivos se revisan por la herramienta o por
 * /dike-verificar.
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

  function DikePage() {
    var _a = useState(null), estado = _a[0], setEstado = _a[1];
    var _b = useState(null), estadoError = _b[0], setEstadoError = _b[1];
    var _c = useState(""), texto = _c[0], setTexto = _c[1];
    var _d = useState(null), resultado = _d[0], setResultado = _d[1];
    var _e = useState(null), error = _e[0], setError = _e[1];
    var _f = useState(false), ocupado = _f[0], setOcupado = _f[1];

    var cargar = useCallback(function () {
      setEstadoError(null);
      SDK.fetchJSON("/api/plugins/dike/estado")
        .then(setEstado)
        .catch(function (e) { setEstadoError(e); });
    }, []);

    useEffect(function () { cargar(); }, [cargar]);

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
        .then(function (r) { setResultado(r); cargar(); })
        .catch(function (e) { setError(e); })
        .finally(function () { setOcupado(false); });
    }, [texto, ocupado, cargar]);

    return h("div", { className: "flex flex-col gap-4 p-4 text-sm" },
      h("div", null,
        h("h1", { className: "text-lg font-semibold" }, "Diké"),
        h("p", { className: "text-xs text-muted-foreground" },
          "Verificación local de citas de la ley chilena. No es consejo legal.")),
      h(C.Card, null,
        h(C.CardHeader, null, h(C.CardTitle, null, "Corpus")),
        h(C.CardContent, null, h(Estado, { estado: estado, error: estadoError }))),
      h(C.Card, null,
        h(C.CardHeader, null, h(C.CardTitle, null, "Verificar un escrito")),
        h(C.CardContent, { className: "flex flex-col gap-3" },
          h("textarea", {
            className: "min-h-40 w-full rounded-md border bg-background p-2 font-mono text-xs outline-none",
            placeholder: "Pega el texto del escrito…",
            value: texto,
            onChange: function (ev) { setTexto(ev.target.value); },
          }),
          h("div", { className: "flex items-center gap-3" },
            h(C.Button, { onClick: verificar, disabled: ocupado || !texto.trim() },
              ocupado ? "Verificando…" : "Verificar citas"),
            ocupado
              ? h("span", { className: "text-xs text-muted-foreground" },
                  "La primera llamada instala el corpus (~1 min).")
              : null),
          error
            ? h("div", { className: "text-xs text-destructive" }, mensajeError(error))
            : null,
          h(Resultado, { resultado: resultado }))));
  }

  window.__HERMES_PLUGINS__.register("dike", DikePage);
})();
