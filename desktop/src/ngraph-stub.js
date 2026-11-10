// Sustituto de ngraph.graph / ngraph.forcelayout en el bundle: three-forcegraph
// los importa estáticamente pero solo los usa con forceEngine: 'ngraph' (esta
// vista usa el motor d3 por defecto). ngraph.forcelayout compila física con
// `new Function`, que el chequeo del bundle rechaza y la vista no necesita.
export default function ngraphNoIncluido() {
  throw new Error("forceEngine 'ngraph' is not included in this bundle; use the d3 engine")
}
