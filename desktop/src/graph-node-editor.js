// Graphium-style floating editor. Sources are read-only; notes are profile sidecars.
import {jsx,jsxs} from 'react/jsx-runtime'
import {useEffect,useRef,useState} from 'react'
import {rest,mensajeError} from './common.js'
import {Reviewer} from './reviewer.js'

const bg='var(--ui-bg-elevated, Canvas)',fg='var(--ui-text-primary, CanvasText)',muted='var(--ui-text-tertiary, CanvasText)',border='1px solid var(--ui-stroke-secondary, ButtonBorder)'
const button={border,borderRadius:5,padding:'5px 9px',background:'var(--ui-bg-editor, Canvas)',color:fg,fontSize:12,cursor:'pointer',whiteSpace:'nowrap'}

export function EditorNodo({nodo,fuente,modo,onCerrar,guardRef}) {
  const [data,setData]=useState(null),[content,setContent]=useState(''),[error,setError]=useState(null),[saving,setSaving]=useState(false),[status,setStatus]=useState('')
  const [pos,setPos]=useState({x:24,y:32}),[attempt,setAttempt]=useState(0),[reviewing,setReviewing]=useState(false)
  const reviewGuard=useRef(()=>true)
  const initial=useRef(''),panel=useRef(null),drag=useRef(null),generation=useRef(0),saveLock=useRef(false)
  useEffect(()=>{
    let active=true
    ++generation.current;saveLock.current=false;setSaving(false)
    setData(null);setError(null);setContent('');setStatus('');initial.current=''
    const request=modo==='nota'
      ?rest('/grafo/nota?fuente='+encodeURIComponent(fuente)+'&id='+encodeURIComponent(nodo.id))
      :fuente==='vault' && nodo.tipo!=='carpeta'
        ?rest('/grafo/vault/texto?id='+encodeURIComponent(nodo.id))
        :fuente==='corpus' && nodo.tipo==='articulo'
          ?rest('/grafo/leer',{method:'POST',body:{nodo_id:nodo.id},timeoutMs:120000})
          :rest((nodo.tipo==='unidad'?'/grafo/unidad':'/grafo/nodo')+'?fuente='+encodeURIComponent(fuente)+'&id='+encodeURIComponent(nodo.id))
    request.then(result=>{
      if(!active)return
      if(modo!=='nota' && result.resolucion && result.resolucion!=='RESOLVED')throw Error('No se pudo resolver este nodo ('+result.resolucion+'). '+(result.motivo||''))
      const withheld=result.texto_omitido===true
      const text=withheld?'':typeof result.content==='string'?result.content:typeof result.texto==='string'?result.texto:''
      initial.current=text;setContent(text);setData({...result,metadataOnly:modo!=='nota' && (withheld || (typeof result.content!=='string' && typeof result.texto!=='string'))})
    }).catch(e=>{if(active)setError(mensajeError(e))})
    return()=>{active=false;++generation.current}
  },[nodo.id,nodo.tipo,fuente,modo,attempt])
  const dirty=modo==='nota' && content!==initial.current
  const canLeave=()=>!saving && reviewGuard.current() && (!dirty || window.confirm('¿Descartar los cambios sin guardar de esta nota?'))
  if(guardRef)guardRef.current=canLeave
  useEffect(()=>{if(guardRef)guardRef.current=canLeave;return()=>{if(guardRef)guardRef.current=()=>true}},[guardRef,dirty,saving])
  const close=()=>{if(canLeave())onCerrar()}
  const save=async()=>{
    if(modo!=='nota' || !data || saving || saveLock.current || !dirty)return
    const epoch=generation.current
    saveLock.current=true;setSaving(true);setError(null)
    try {
      const result=await rest('/grafo/nota',{method:'POST',body:{fuente,id:nodo.id,content,version:data.version}})
      if(epoch!==generation.current)return
      initial.current=content;setData(result);setStatus('Guardado · archivo fuente intacto')
    }catch(e){if(epoch===generation.current)setError(mensajeError(e))}finally{if(epoch===generation.current){saveLock.current=false;setSaving(false)}}
  }
  const headerDown=e=>{
    if(e.button!==0 || e.target.closest('button'))return
    const bounds=panel.current.getBoundingClientRect(),parent=panel.current.parentElement.getBoundingClientRect()
    drag.current={x:e.clientX,y:e.clientY,left:pos.x,top:pos.y,maxX:Math.max(8,parent.width-bounds.width-8),maxY:Math.max(8,Math.min(parent.height,window.innerHeight-parent.top)-bounds.height-8)}
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const headerMove=e=>{
    const d=drag.current;if(!d)return
    setPos({x:Math.max(8,Math.min(d.maxX,d.left+e.clientX-d.x)),y:Math.max(8,Math.min(d.maxY,d.top+e.clientY-d.y))})
  }
  const fields=[['Identificador',data?.id||nodo.id],['Tipo',data?.tipo||nodo.tipo],['Autoridad',data?.authority||'Sin nueva certificación'],['Relaciones salientes',data?.n_salientes],['Ruta relativa',data?.relative_path]]
  return jsxs('section',{
    ref:panel,'data-node-editor':true,role:'dialog','aria-modal':false,'aria-label':modo==='nota'?'Editor de anotaciones':'Lector de nodo',
    style:{position:'absolute',left:pos.x,top:pos.y,width:'min(560px, calc(100% - 24px))',height:'min(440px, 70vh)',maxWidth:'calc(100% - 16px)',maxHeight:'80vh',minHeight:220,zIndex:110,background:bg,color:fg,border,borderRadius:10,boxShadow:'0 14px 40px color-mix(in srgb, var(--ui-text-primary, CanvasText) 24%, transparent)',display:'flex',flexDirection:'column',overflow:'hidden',resize:'both'},
    onKeyDown:e=>{e.stopPropagation();if(e.key==='Escape'){e.preventDefault();close()}if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'&&modo==='nota'){e.preventDefault();save()}},
    children:[
      jsxs('header',{'data-node-drag':true,onPointerDown:headerDown,onPointerMove:headerMove,onPointerUp:()=>{drag.current=null},onPointerCancel:()=>{drag.current=null},style:{display:'flex',alignItems:'center',gap:8,padding:'8px 12px',borderBottom:border,cursor:'move',touchAction:'none'},children:[
        jsx('strong',{style:{fontSize:12,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',flex:1,minWidth:0},children:nodo.label||nodo.id}),
        jsx('span',{style:{fontSize:10,border,padding:'2px 5px',borderRadius:4,whiteSpace:'nowrap'},children:modo==='nota'?'Nota adjunta':data?.metadataOnly?'Ficha':'Solo lectura'}),
        dirty?jsx('span',{style:{fontSize:10,color:'var(--ui-accent, Highlight)'},children:'●'}):null,
        modo==='nota'?jsx('button',{type:'button','data-node-save':true,style:{...button,background:'var(--ui-accent, Highlight)',color:'var(--ui-accent-foreground, HighlightText)'},disabled:!data||saving||!dirty,onClick:save,children:saving?'Guardando…':'Guardar (Ctrl+S)'}):null,
        jsx('button',{type:'button','data-node-close':true,'aria-label':'Cerrar editor',style:button,disabled:saving,onClick:close,children:'×'}),
      ]}),
      jsx('div',{style:{fontSize:10,color:muted,padding:'5px 12px',borderBottom:border,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'},title:modo==='nota'?'Anotación privada: no modifica la fuente ni el LKG.':'La lectura no autoriza modificar el corpus.',children:status||(modo==='nota'?'Nota privada · '+fuente+' · '+nodo.id:'Fuente: '+fuente+' · solo lectura')}),
      error?jsxs('div',{role:'alert',style:{fontSize:12,padding:12,color:'var(--ui-danger, CanvasText)',overflow:'auto'},children:[jsx('p',{children:error}),!data?jsx('button',{type:'button','data-node-retry':true,style:button,onClick:()=>setAttempt(n=>n+1),children:'Reintentar apertura'}):null]}):null,
      !data && !error?jsx('div',{style:{padding:12,fontSize:12},children:'Cargando…'}):null,
      data?.metadataOnly?jsxs('div',{'data-node-metadata':true,style:{padding:12,fontSize:12,overflow:'auto',flex:1},children:[
        jsx('p',{style:{margin:'0 0 12px',color:muted},children:'Esta fuente ofrece una ficha, no el texto del documento. No hay texto autorizado disponible para mostrar.'}),
        jsx('dl',{style:{margin:0},children:fields.filter(([,v])=>v!==undefined && v!==null).map(([label,value])=>jsxs('div',{style:{marginBottom:8},children:[jsx('dt',{style:{fontSize:10,color:muted},children:label}),jsx('dd',{style:{margin:0,overflowWrap:'anywhere'},children:String(value)})]},label))}),
      ]}):null,
      modo!=='nota' && fuente==='vault' && data && !data.metadataOnly?jsx('button',{'data-node-review':true,style:button,onClick:()=>{if(reviewGuard.current())setReviewing(v=>!v)},children:reviewing?'Volver al lector':'Anotar pasaje'}):null,
      reviewing && modo!=='nota' && fuente==='vault'?jsx(Reviewer,{id:nodo.id,guardRef:reviewGuard}):null,
      data&&!data.metadataOnly&&!reviewing?jsx('textarea',{'data-node-note':modo==='nota'?true:undefined,'data-node-source':modo!=='nota'?true:undefined,'aria-label':modo==='nota'?'Anotación del nodo':'Texto del nodo',autoFocus:true,spellCheck:false,style:{flex:1,minHeight:0,width:'100%',boxSizing:'border-box',resize:'none',border:0,outline:'none',padding:12,background:'transparent',color:fg,fontFamily:'ui-monospace, monospace',fontSize:12.5,lineHeight:1.55},readOnly:modo!=='nota'||saving,value:content,onChange:e=>{setContent(e.target.value);setStatus('')}}):null,
    ],
  })
}
