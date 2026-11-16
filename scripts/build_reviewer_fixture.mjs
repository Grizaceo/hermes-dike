import {build} from '../desktop/node_modules/esbuild/lib/main.js'
import {resolve} from 'node:path'
// La página importa su hoja de estilos como '#dike-estilos' (desktop/estilos.mjs).
import {estilosPlugin} from '../desktop/estilos.mjs'
const modules=process.argv[2]
if(!modules)throw Error('Pass isolated node_modules with react/react-dom')
await build({entryPoints:['desktop/test/reviewer-fixture.js'],outfile:'.workshop/reviewer-fixture.js',bundle:true,format:'esm',platform:'browser',alias:{react:resolve(modules,'react'),'react-dom':resolve(modules,'react-dom')},logLevel:'info'})
await build({entryPoints:['desktop/test/reviewer-tab-fixture.js'],outfile:'.workshop/reviewer-tab-fixture.js',bundle:true,format:'esm',platform:'browser',plugins:[estilosPlugin,...(process.env.REVIEWER_TEST_BUNDLE?[{name:'installed-dike-bundle',setup(b){b.onResolve({filter:/\/src\/plugin\.src\.js$/},()=>({path:resolve(process.env.REVIEWER_TEST_BUNDLE)}))}}]:[])],loader:{'.md':'text'},alias:{react:resolve(modules,'react'),'react-dom':resolve(modules,'react-dom'),'@hermes/plugin-sdk':resolve('desktop/test/reviewer-sdk-fixture.js')},logLevel:'info'})
