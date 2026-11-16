// A discoverable document-first entry point; no new backend or permission store.
import {jsx,jsxs} from 'react/jsx-runtime'
import {useCallback,useEffect,useMemo,useRef,useState} from 'react'
import {mensajeError,rest} from './common.js'
import {Reviewer} from './reviewer.js'

const box={border:'1px solid var(--ui-stroke-secondary, ButtonBorder)',borderRadius:8,padding:12,minWidth:0}
const field={fontSize:12,padding:7,color:'inherit',background:'var(--ui-bg-editor, Canvas)',border:'1px solid var(--ui-stroke-secondary, ButtonBorder)',borderRadius:5,minWidth:0}
const button={...field,cursor:'pointer'}
const PAGE_SIZE=50

export function SeccionReviewer({guardRef,onAbrirEscrito}){
 const localGuard=useRef(()=>true),guard=guardRef||localGuard,generation=useRef(0)
 const [documents,setDocuments]=useState([]),[selected,setSelected]=useState(null),[query,setQuery]=useState(''),[page,setPage]=useState(0),[busy,setBusy]=useState(false),[error,setError]=useState('')
 const load=useCallback(async()=>{
  const current=++generation.current
  setBusy(true);setError('')
  try{
   // Existing metadata-only inventory: never fetch each document to populate a list.
   const data=await rest('/grafo/red?fuente=vault',{timeoutMs:60000})
   if(data?.fuente!=='vault'||!Array.isArray(data.nodes))throw Error('Inventario documental no disponible.')
   const rows=data.nodes.filter(n=>n.tipo==='documento'&&typeof n.id==='string'&&n.id.startsWith('v:')).map(n=>({id:n.id,label:typeof n.label==='string'?n.label:n.id}))
   if(current===generation.current){setDocuments(rows);setPage(0)}
  }catch(e){if(current===generation.current)setError(mensajeError(e))}
  finally{if(current===generation.current)setBusy(false)}
 },[])
 useEffect(()=>{load();return()=>{++generation.current}},[load])
 const matches=useMemo(()=>{const q=query.trim().toLocaleLowerCase();return q?documents.filter(n=>(n.label+' '+n.id).toLocaleLowerCase().includes(q)):documents},[documents,query])
 const pageCount=Math.max(1,Math.ceil(matches.length/PAGE_SIZE)),currentPage=Math.min(page,pageCount-1)
 const shown=matches.slice(currentPage*PAGE_SIZE,(currentPage+1)*PAGE_SIZE)
 const open=doc=>{if(doc.id===selected?.id)return;if(!guard.current())return;setSelected(doc)}
 return jsxs('section',{'data-reviewer-workspace':true,'aria-label':'Legal Reviewer',style:{display:'flex',flexDirection:'column',gap:12,flex:1,minHeight:0},children:[
  jsxs('header',{style:box,children:[
   jsx('h2',{style:{margin:'0 0 6px',fontSize:20},children:'Legal Reviewer · Revisión de documentos'}),
   jsx('div',{children:'Documento → pasaje anotado → evidencia del caso → escrito'}),
   jsx('p',{style:{fontSize:12,color:'var(--ui-text-secondary)',marginBottom:0},children:'Preparación privada, sin promoción al LKG. Abre un documento, indica el caso, selecciona el texto y guarda el pasaje. Llevar al escrito conserva su referencia de evidencia; no certifica su validez jurídica.'}),
   jsx('button',{'data-reviewer-writer':true,type:'button',style:{...button,marginTop:8},onClick:onAbrirEscrito,children:'Ir a Escritos (Case Writer)'}),
  ]}),
  jsxs('div',{style:{display:'flex',flexWrap:'wrap',gap:12,alignItems:'flex-start'},children:[
   jsxs('aside',{style:{...box,flex:'1 1 260px',maxWidth:380},children:[
    jsx('h3',{style:{marginTop:0,fontSize:14},children:'Documentos de la vault conectada'}),
    jsx('p',{style:{fontSize:11,color:'var(--ui-text-secondary)'},children:'Esta lista es un inventario de metadatos, no una autorización. Cada apertura exige aprobación de anonimización y hash vigente. Ambiental local y el corpus no habilitan texto en este revisor.'}),
    jsx('input',{'aria-label':'Buscar documento para revisar',style:{...field,width:'100%',boxSizing:'border-box'},placeholder:'Buscar por título o identificador',value:query,onChange:e=>{setQuery(e.target.value);setPage(0)}}),
    jsx('button',{'data-reviewer-refresh':true,type:'button',style:{...button,marginTop:6},disabled:busy,onClick:load,children:busy?'Cargando inventario…':'Reintentar / actualizar lista'}),
    error?jsx('div',{role:'alert',style:{fontSize:12,marginTop:8},children:'No se pudo cargar la vault de este perfil: '+error+'. Conecta una fuente documental autorizada; no se cambia ningún permiso desde aquí.'}):null,
    jsx('div',{'data-reviewer-count':true,role:'status',style:{fontSize:11,margin:'8px 0'},children:matches.length+' de '+documents.length+' documentos · página '+(currentPage+1)+' de '+pageCount}),
    !busy&&!error&&!matches.length?jsx('p',{children:documents.length?'No hay documentos que coincidan.':'No hay documentos en la fuente conectada.'}):null,
    jsx('div',{style:{maxHeight:430,overflow:'auto',display:'flex',flexDirection:'column',gap:5},children:shown.map(doc=>jsx('button',{'data-reviewer-document':doc.id,type:'button','aria-pressed':selected?.id===doc.id,style:{...button,textAlign:'left',overflowWrap:'anywhere',borderColor:selected?.id===doc.id?'var(--ui-accent, Highlight)':'var(--ui-stroke-secondary, ButtonBorder)'},onClick:()=>open(doc),children:jsxs('span',{children:[jsx('strong',{children:doc.label}),jsx('small',{style:{display:'block'},children:doc.id+' · abrir y comprobar permiso'})]})},doc.id))}),
    jsxs('nav',{'aria-label':'Páginas de documentos',style:{display:'flex',gap:5,marginTop:8},children:[
     jsx('button',{type:'button',style:button,disabled:currentPage===0,onClick:()=>setPage(currentPage-1),children:'Anterior'}),
     jsx('button',{type:'button',style:button,disabled:currentPage+1>=pageCount,onClick:()=>setPage(currentPage+1),children:'Siguiente'}),
    ]}),
   ]}),
   jsx('div',{style:{...box,flex:'3 1 500px'},children:selected?jsxs('div',{children:[jsx('h3',{style:{marginTop:0,fontSize:15},children:selected.label}),jsx(Reviewer,{id:selected.id,guardRef:guard},selected.id)]}):jsx('p',{'data-reviewer-empty':true,children:'Elige un documento de la lista para comenzar. No se lee su contenido hasta que lo abras; si no está autorizado, se bloqueará la lectura.'})}),
  ]}),
 ]})
}
