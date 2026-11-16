// Real React reader and Tiptap writer, fictional HTTP data only.
import {jsx,jsxs} from 'react/jsx-runtime'
import {useRef,useState} from 'react'
import {createRoot} from 'react-dom/client'
import {EditorNodo} from '../src/graph-node-editor.js'
import {setRest} from '../src/common.js'
import {insertarCitasPendientes} from '../src/puente.js'
import {montarEditor} from '../src/escritor/editor.js'
const calls=[]
setRest(async(path,opts={})=>{
 calls.push({path,body:opts.body})
 const response=await fetch(path,{method:opts.method||'GET',headers:{'Content-Type':'application/json'},...(opts.body?{body:JSON.stringify(opts.body)}:{})})
 const data=await response.json();if(!response.ok)throw Error(data.detail?.code||JSON.stringify(data.detail));return data
})
const ids=await (await fetch('/fixture')).json()
function App(){
 const [open,setOpen]=useState(true),[id,setId]=useState(ids.A),guard=useRef(()=>true)
 return jsxs('main',{style:{position:'relative',height:900},children:[
  jsx('button',{'data-fixture-reopen':true,onClick:()=>setOpen(true),children:'Reabrir lector'}),
  jsx('button',{'data-fixture-B':true,onClick:()=>{if(guard.current())setId(ids.B)},children:'Abrir B'}),
  open?jsx(EditorNodo,{nodo:{id,tipo:'documento',label:id},fuente:'vault',modo:'lector',guardRef:guard,onCerrar:()=>setOpen(false)}):null,
 ]})
}
createRoot(document.getElementById('reader')).render(jsx(App,{}))
const editor=montarEditor({element:document.getElementById('writer'),content:'<p>Borrador ficticio intacto.</p>',onUpdate:()=>{}})
document.getElementById('consume').onclick=()=>{window.fixture.pistas=insertarCitasPendientes(editor,'borrador')}
window.fixture={calls,ids,editor,pistas:[]}
