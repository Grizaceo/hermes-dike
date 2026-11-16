// React boundary: native-only projections, transient-error recovery and stable coordinates.
import {jsx,jsxs} from 'react/jsx-runtime'
import {useEffect,useMemo,useRef,useState} from 'react'
import {mapSnapshot,wireProjection} from './graphium-data.js'
import {GraphiumRenderer} from './graphium-renderer.js'
import {rest,mensajeError,S} from './common.js'
import {graphiumTheme} from './graphium-theme.js'

export function LienzoGraphium({proyeccion,fuente,conteos,alClickNodo,alContextoNodo,alClickArista,alHover,alFondo,resalte,onFallo,apiRef,nodeColor,edgeColor}) {
  const host=useRef(null),renderer=useRef(null),current=useRef({}),queue=useRef(Promise.resolve()),pendingFocus=useRef(null),pool=useRef(new Map()),resetLayout=useRef(false),pendingFit=useRef(null)
  const [loading,setLoading]=useState(true),[error,setError]=useState(null),[attempt,setAttempt]=useState(0)
  const wire=useMemo(()=>fuente==='vault'?{ids:proyeccion.nodes.map(n=>n.id)}:wireProjection(proyeccion),[proyeccion,fuente])
  const signature=useMemo(()=>JSON.stringify(wire),[wire])
  current.current={proyeccion,fuente,conteos,alClickNodo,alContextoNodo,alClickArista,alHover,alFondo,onFallo,nodeColor,edgeColor,resalte}
  useEffect(()=>{
    let engine
    // Own a fresh canvas per effect lifecycle. StrictMode may reuse the host,
    // but never a GPU context deliberately lost by the previous cleanup.
    const canvas=document.createElement('canvas')
    Object.assign(canvas.style,{width:'100%',height:'100%',display:'block',touchAction:'none'})
    canvas.style.background=graphiumTheme.canvas
    canvas.style.borderRadius='10px'
    canvas.tabIndex=0
    canvas.setAttribute('aria-label','Grafo jurídico Graphium: F busca, R restablece; clic derecho abre menú; arrastrar rota, Mayús arrastrar desplaza, rueda acerca')
    host.current.appendChild(canvas)
    try {
      engine=new GraphiumRenderer(canvas,{
        onNode:n=>current.current.alClickNodo?.(n),onNodeContext:(n,at)=>current.current.alContextoNodo?.(n,at),onEdge:l=>current.current.alClickArista?.(l),
        onHover:id=>current.current.alHover?.(id),onBackground:()=>current.current.alFondo?.(),
        onError:message=>current.current.onFallo(message),
        onCameraInteraction:()=>{pendingFocus.current=null;pendingFit.current=null},
        nodeColor:n=>current.current.nodeColor?.(n),edgeColor:l=>l?current.current.edgeColor?.(l):undefined,
        nodeLabel:n=>n.label+(n.tipo==='instrumento'?' · '+(current.current.conteos?.get(n.id)||0)+' artículos':''),
      })
      renderer.current=engine
      apiRef.current={
        estado:()=>({dist:engine.camera.dist,nodes:engine.d?.nodeCount||0,ready:!!engine.d}),
        enfocar:id=>{pendingFocus.current={id,expires:performance.now()+2000};if(engine.d?.indexById.has(id)){engine.focus(id);pendingFocus.current=null}},
        resetView:({ids=[]}={})=>{pendingFocus.current=null;engine.camera.yaw=.35;engine.camera.pitch=.22;engine.fit();pendingFit.current=ids.length && (ids.length!==engine.d?.nodeCount || ids.some(id=>!engine.d?.indexById.has(id)))?new Set(ids):null},
        zoomFit:()=>{pendingFocus.current=null;engine.fit()},orbita:()=>{pendingFocus.current=null;engine.orbit()},
        encuadrar:ids=>{pendingFocus.current=null;engine.fit(ids)},
      }
    }catch(failure){current.current.onFallo(mensajeError(failure));setLoading(false)}
    return ()=>{engine?.destroy();canvas.remove();renderer.current=null;apiRef.current=null;pool.current.clear()}
  },[])
  useEffect(()=>{
    let active=true
    setLoading(true);setError(null)
    queue.current=queue.current.catch(()=>{}).then(async()=>{
      if(!active||!renderer.current)return
      const projection=current.current.proyeccion
      const vault=current.current.fuente==='vault'
      const body=vault?{ids:projection.nodes.map(n=>n.id),positions:Object.fromEntries(projection.nodes.filter(n=>pool.current.has(n.id)).map(n=>[n.id,pool.current.get(n.id)]))}:wireProjection(projection,pool.current)
      try {
        let result
        for(let retry=0;retry<3;retry++) {
          if(!active)return
          try {result=await rest(vault?'/grafo/vault/layout':'/grafo/graphium/layout',{method:'POST',body,timeoutMs:120000});break}
          catch(failure) {
            const transient=failure?.code==='GRAPH_BUSY' || /ocupado|\bbusy\b/i.test(mensajeError(failure))
            if(!transient||retry===2)throw failure
            const seconds=Number(failure?.retryAfter??failure?.headers?.get?.('Retry-After')??failure?.headers?.['retry-after']??1)
            const delay=Number.isFinite(seconds)&&seconds>0?Math.max(1000,seconds*1000):1000
            if(delay>30000)throw failure
            await new Promise(resolve=>setTimeout(resolve,delay))
          }
        }
        if(!active||!renderer.current)return
        const d=mapSnapshot(result,projection)
        for(let i=0;i<d.nodeCount;i++)pool.current.set(d.ids[i],[...d.positions.subarray(i*3,i*3+3)])
        if(pool.current.size>200000)for(const id of pool.current.keys()){if(pool.current.size<=200000)break;if(!d.indexById.has(id))pool.current.delete(id)}
        renderer.current.setData(d);renderer.current.setHighlight(current.current.resalte)
        if(resetLayout.current){renderer.current.fit();resetLayout.current=false}
        if(pendingFit.current && pendingFit.current.size===d.nodeCount && d.ids.every(id=>pendingFit.current.has(id))){renderer.current.fit();pendingFit.current=null}
        const focus=pendingFocus.current
        if(focus && performance.now()>focus.expires)pendingFocus.current=null
        else if(focus && d.indexById.has(focus.id)){renderer.current.focus(focus.id);pendingFocus.current=null}
        setLoading(false)
      }catch(failure){if(active){setLoading(false);setError('Graphium Rust: '+mensajeError(failure))}}
    })
    return ()=>{active=false}
  },[signature,attempt])
  useEffect(()=>{renderer.current?.setHighlight(resalte)},[resalte])
  return jsxs('div',{'data-graphium-viewport':true,className:'relative min-w-0',style:{position:'relative',border:graphiumTheme.border,borderRadius:10,overflow:'hidden',background:graphiumTheme.canvas},children:[
    jsx('button',{type:'button',className:S.ghost,style:{position:'absolute',right:12,top:12,zIndex:2,border:graphiumTheme.border,borderRadius:7,padding:'6px 10px',fontSize:11,background:graphiumTheme.surface,color:graphiumTheme.text},disabled:loading,'data-graphium-reset':true,
      title:'Recalcula solo las posiciones visuales en Rust; no cambia datos ni su estado de revisión.',
      onClick:()=>{pool.current.clear();pendingFocus.current=null;resetLayout.current=true;setAttempt(n=>n+1)},children:'Recalcular distribución'}),
    jsx('div',{ref:host,className:'w-full rounded-md',style:{height:'62vh',minHeight:360,width:'100%'}}),
    loading?jsx('div',{className:S.sub+' absolute left-3 top-3',style:{position:'absolute',left:12,top:12,zIndex:2,padding:'6px 10px',border:graphiumTheme.border,borderRadius:7,background:graphiumTheme.surface,color:graphiumTheme.text,fontSize:11},children:'Graphium Rust · calculando grafo…'}):null,
    error?jsxs('div',{role:'alert',className:S.card,style:{position:'relative',background:graphiumTheme.surface,color:graphiumTheme.text,padding:12},children:[
      jsx('div',{children:error}),jsx('div',{className:S.sub,children:'No se actualizó el grafo. No se cambió a otro motor ni se certificó conocimiento.'}),
      jsx('button',{type:'button',className:S.ghost,'data-graphium-retry':true,onClick:()=>setAttempt(n=>n+1),children:'Reintentar'}),
      jsxs('details',{children:[jsx('summary',{children:'Lista de nodos (primeros 200)'}),...proyeccion.nodes.slice(0,200).map(n=>jsx('button',{type:'button',className:S.link,onClick:()=>current.current.alClickNodo?.(n),children:n.label||n.id},n.id))]}),
    ]}):null,
  ]})
}
