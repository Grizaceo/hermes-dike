import {jsx,jsxs} from 'react/jsx-runtime'
import {useEffect,useRef,useState} from 'react'
import {rest} from './common.js'
import {encolarCita} from './puente.js'
import {ReviewSession} from './reviewer-session.js'

const field={fontSize:11,padding:5,color:'inherit',background:'var(--ui-bg-editor, Canvas)',border:'1px solid var(--ui-stroke-secondary, ButtonBorder)',borderRadius:4,minWidth:0}
const btn={...field,cursor:'pointer'}
export function Reviewer({id,guardRef}){
 const [view,setView]=useState(null),[caseInput,setCaseInput]=useState('borrador'),[author,setAuthor]=useState('human:local'),[label,setLabel]=useState('hecho_relevante'),[output,setOutput]=useState(null)
 const session=useRef(null),source=useRef(null)
 if(!session.current)session.current=new ReviewSession((...args)=>rest(...args),setView)
 const r=session.current,s=view||r.state
 if(guardRef)guardRef.current=()=>r.canLeave()
 useEffect(()=>{r.onChange=setView;r.open(id,caseInput);setOutput(null);return()=>{r.dispose();if(guardRef)guardRef.current=()=>true}},[id])
 const select=()=>{
  const el=source.current,sel=window.getSelection()
  if(!el||!sel?.rangeCount||sel.isCollapsed)return
  const range=sel.getRangeAt(0)
  if(!el.contains(range.startContainer)||!el.contains(range.endContainer))return
  const prefix=range.cloneRange();prefix.selectNodeContents(el);prefix.setEnd(range.startContainer,range.startOffset)
  try{r.select(prefix.toString().length,prefix.toString().length+range.toString().length)}catch(e){r.update({error:e.message})}
 }
 const action=async(op,a)=>{
  const result=await r.action(op,a.annotation_id);if(!result)return
  if(op==='export'){
   encolarCita({cita:result.cita,nodo_id:s.id,label:'Pasaje revisado',case_id:s.caseId,evidencia:result.evidence_ref})
   r.update({message:'Encolado para el escrito del caso '+s.caseId+'. Abre ese caso en Case Writer; no se guarda automáticamente.'})
  }
  setOutput(result)
 }
 return jsxs('div',{'data-reviewer':true,style:{display:'flex',flexDirection:'column',flex:1,minHeight:0,overflow:'auto',gap:8,padding:12},onKeyDown:e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'){e.preventDefault();e.stopPropagation();r.save(author,label)}},children:[
  jsxs('div',{style:{display:'flex',flexWrap:'wrap',gap:5},children:[
   jsx('input',{'aria-label':'Caso del pasaje',style:field,value:caseInput,onChange:e=>setCaseInput(e.target.value)}),
   jsx('button',{'data-review-open':true,style:btn,onClick:()=>{r.open(id,caseInput).then(ok=>{if(ok)setOutput(null)})},children:'Abrir caso'}),
   jsx('input',{'aria-label':'Revisor declarado',style:field,maxLength:120,value:author,onChange:e=>setAuthor(e.target.value)}),
   jsx('select',{'aria-label':'Etiqueta de trabajo',style:field,value:label,onChange:e=>setLabel(e.target.value),children:(s.doc?.labels||['hecho_relevante']).map(x=>jsx('option',{value:x,children:x},x))}),
  ]}),
  jsx('div',{style:{fontSize:10,overflowWrap:'anywhere'},children:'Caso: '+(s.caseId||'—')+' · '+(s.id||id)+' · Preparación privada. Revisor declarado, no autenticación ni certificación jurídica.'}),
  s.error?jsx('div',{role:'alert',children:s.error}):null,
  s.message?jsx('div',{role:'status',children:s.message}):null,
  s.busy?jsx('button',{'data-review-cancel':true,style:btn,onClick:()=>r.cancel(),children:'Cancelar espera'}):null,
  s.doc?jsxs('div',{children:[
   jsx('div',{style:{fontSize:10},children:'Selecciona texto con el ratón. SHA256 '+s.doc.sha256}),
   jsx('pre',{ref:source,'data-review-source':true,tabIndex:0,onMouseUp:select,onKeyUp:select,style:{whiteSpace:'pre-wrap',overflowWrap:'anywhere',maxHeight:190,overflow:'auto',fontSize:12,padding:8,border:field.border,userSelect:'text'},children:s.doc.text}),
  ]}):null,
  s.draft?jsxs('div',{'data-review-draft':true,children:[
   jsx('blockquote',{style:{margin:4,whiteSpace:'pre-wrap'},children:s.draft.text}),
   jsx('small',{children:'Rango ['+s.draft.start_offset+', '+s.draft.end_offset+') · puntos de código Unicode; texto sin normalizar'}),
   jsx('button',{'data-review-save':true,style:btn,disabled:s.busy,onClick:()=>r.save(author,label),children:'Guardar pasaje (Ctrl+S)'}),
  ]}):null,
  jsx('div',{'data-review-annotations':true,children:s.doc?.annotations.map(a=>jsxs('article',{'data-review-annotation':a.annotation_id,style:{border:field.border,padding:8,marginBottom:6},children:[
   jsx('blockquote',{style:{margin:0,whiteSpace:'pre-wrap'},children:a.text}),
   jsx('small',{children:a.state+' · v'+a.version+' · '+a.locator}),
   jsxs('div',{style:{display:'flex',flexWrap:'wrap',gap:4},children:[
    jsx('button',{'data-review-edit':true,style:btn,disabled:s.busy||a.state==='obsolete',onClick:()=>r.edit(a),children:'Revisar etiquetas'}),
    jsx('button',{'data-review-export':true,style:btn,disabled:s.busy||a.state==='obsolete',onClick:()=>action('export',a),children:'Llevar al escrito'}),
    jsx('button',{'data-review-proposal':true,style:btn,disabled:s.busy||a.state==='obsolete',onClick:()=>action('proposal',a),children:'Proponer al caso / NIF'}),
   ]}),
  ]},a.annotation_id))}),
  output?jsxs('div',{children:[
   jsx('strong',{children:output.status?'Propuesta pendiente: NO aplicada. Requiere HITL-5 y custodia.':'Exportación del pasaje; integridad no equivale a validez jurídica.'}),
   jsx('textarea',{'data-review-output':true,'aria-label':'JSON exportable del pasaje',readOnly:true,value:JSON.stringify(output,null,2),style:{...field,width:'100%',height:100,boxSizing:'border-box'}}),
   jsx('button',{'data-review-download':true,style:btn,onClick:()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(output,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='pasaje-'+s.caseId+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)},children:'Descargar JSON'}),
  ]}):null,
 ]})
}
