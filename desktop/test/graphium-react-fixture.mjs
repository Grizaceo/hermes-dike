// Isolated real React boundary, with injected failure/delay and real native positive path.
import React,{useState} from 'react'
import {createRoot} from 'react-dom/client'
import {LienzoGraphium} from '../src/graphium-canvas.js'
import {setRest} from '../src/common.js'
import {GraphiumRenderer} from '../src/graphium-renderer.js'
import {SeccionGrafo} from '../src/grafo3d.js'
import {EditorNodo} from '../src/graph-node-editor.js'
import {projectToCss} from '../src/graphium-data.js'
const controls = new URLSearchParams(location.search).has('controls')

const f=window.reactFixture={mode:'fail',calls:0,permanentErrors:[],requestTimes:[],focused:[],bodies:[],rendered:[],api:{current:null}}
const originalFocus=GraphiumRenderer.prototype.focus
GraphiumRenderer.prototype.focus=function(id){f.focused.push(id);return originalFocus.call(this,id)}
const originalSetData=GraphiumRenderer.prototype.setData
GraphiumRenderer.prototype.setData=function(d){f.renderer=this;return originalSetData.call(this,d)}
f.point=(i=0)=>{const r=f.renderer;r.render();const p=projectToCss(...r.d.positions.subarray(i*3,i*3+3),r.view,r.proj,r.width,r.height),rect=r.canvas.getBoundingClientRect();return{x:p.x+rect.left,y:p.y+rect.top}}
let note={content:'',version:'empty'}
setRest(async(path,options={})=>{
  if(f.editorRequest)return f.editorRequest(path,options)
  if(controls){
    if(path==='/grafo/fuentes')return[{id:'corpus',disponible:true},{id:'vault',disponible:true}]
    if(path.startsWith('/grafo/red?')&&path.includes('vault')&&f.holdVaultRed)return new Promise(r=>{f.releaseVaultRed=()=>r({nodes:[{id:'stale:vault',tipo:'documento',label:'STALE VAULT'}],links:[],conteos:{nodes:1,links:0}})})
    if((path.startsWith('/grafo/nodo?')||path.startsWith('/grafo/unidad?'))&&f.detailRequest)return f.detailRequest(path)
    if(path.startsWith('/grafo/red?'))return{...projection(3),fuente:path.includes('vault')?'vault':'corpus',conteos:{nodes:999,links:999}}
    if(path==='/grafo/personal')return{candidates:[],edges:[]}
    if(path.startsWith('/grafo/unidades?'))return{nodes:[{id:'fixture:expanded',tipo:'unidad',label:'Unidad expandida ficticia',articulo:'fixture:0'}],links:[{source:'fixture:0',target:'fixture:expanded',tipo:'contiene',estado:'candidata'}]}
    if(path.startsWith('/grafo/nodo?'))return{titulo:'Documento ficticio público'}
    if(path.startsWith('/grafo/unidad?'))return{texto:null,texto_omitido:true}
    if(path==='/grafo/leer')return{texto:'FICTITIOUS PUBLIC ARTICLE',resolucion:'RESOLVED'}
    if(path.startsWith('/grafo/nota')){
      if(options.method==='POST'){note={content:options.body.content,version:'saved'};f.saved=note.content}
      return {...note}
    }
    if(path==='/grafo/corpus')return{packs:[]}
    if(path.startsWith('/grafo/vault/texto'))throw Error('Falta aprobación de anonimización')
    if(path==='/grafo/vault/layout'){
      f.vaultLayout=true
      const p=projection(3),ids=new Set(options.body.ids)
      options={...options,body:{nodes:p.nodes.filter(n=>ids.has(n.id)),links:p.links.filter(l=>ids.has(l.source)&&ids.has(l.target))}}
      path='/grafo/graphium/layout'
    }
  }
  f.calls++;f.requestTimes.push(performance.now());f.bodies.push(options.body)
  if(f.mode==='timeout'){const e=new Error('El motor tardó demasiado.');e.status=503;throw e}
  if(f.mode==='fail'){const e=new Error('El motor está ocupado; reintenta.');e.status=503;throw e}
  if(f.mode==='hold')await new Promise(resolve=>{f.release=resolve})
  const response=await fetch(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(options.body)})
  if(!response.ok){const e=new Error((await response.json()).detail);e.status=response.status;throw e}
  return response.json()
})
function projection(n){return{nodes:Array.from({length:n},(_,i)=>({id:'fixture:'+i,tipo:i?'unidad':'articulo',label:'Ficticio '+i})),links:Array.from({length:n-1},(_,i)=>({source:'fixture:0',target:'fixture:'+(i+1),tipo:'contiene',estado:'candidata'}))}}
function App(){
  const [graph,setGraph]=useState(()=>projection(2)),[permanent,setPermanent]=useState(null)
  f.setProjection=n=>setGraph(projection(n))
  return permanent?React.createElement('div',{id:'permanent'},permanent):React.createElement(LienzoGraphium,{proyeccion:graph,resalte:null,apiRef:f.api,onFallo:e=>{f.permanentErrors.push(e);setPermanent(e)},alClickNodo:n=>{f.selected=n.id}})
}
new MutationObserver(()=>{const c=document.querySelector('canvas');if(c?.dataset.graphiumNodes){const n=Number(c.dataset.graphiumNodes);if(f.rendered.at(-1)!==n)f.rendered.push(n)}}).observe(document.body,{subtree:true,attributes:true,attributeFilter:['data-graphium-nodes']})
if(controls)f.mode='normal'
function EditorApp(){
 const [props,setProps]=useState({nodo:{id:'folder:fixture',tipo:'carpeta',label:'Carpeta ficticia'},fuente:'vault',modo:'leer'})
 f.setEditor=setProps
 if(!f.editorRequest)f.editorRequest=async(path)=>{f.editorPath=path;if(path.includes('/vault/texto'))throw Error('La carpeta no contiene texto');return{id:'folder:fixture',tipo:'carpeta'}}
 return React.createElement('div',{style:{position:'relative',height:700}},React.createElement(EditorNodo,{...props,onCerrar:()=>{f.closed=true}}))
}
createRoot(document.getElementById('root')).render(React.createElement(React.StrictMode,null,React.createElement(new URLSearchParams(location.search).has('editor')?EditorApp:controls?SeccionGrafo:App)))
