// Sustituto de ngraph.graph / ngraph.forcelayout en el bundle: three-forcegraph
// los importa estáticamente pero solo los usa con forceEngine: 'ngraph' (esta
// vista usa el motor d3 por defecto). ngraph.forcelayout compila física con
// `new Function`, que el chequeo del bundle rechaza y la vista no necesita.
export default function ngraphNoIncluido() {
  throw new Error("forceEngine 'ngraph' no está incluido en este bundle; usa el motor d3")
}
