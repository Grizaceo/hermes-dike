import {build} from '../desktop/node_modules/esbuild/lib/main.js'
import {resolve} from 'node:path'
const modules=process.argv[2]
if(!modules)throw Error('Pass an isolated node_modules directory containing react and react-dom; no test dependencies are installed in the product.')
await build({entryPoints:['desktop/test/graphium-react-fixture.mjs'],outfile:'.workshop/graphium-react-fixture.js',bundle:true,format:'esm',platform:'browser',alias:{react:resolve(modules,'react'),'react-dom':resolve(modules,'react-dom')},logLevel:'info'})
