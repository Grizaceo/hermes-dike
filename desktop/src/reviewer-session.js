// Deterministic UI lifecycle; offsets on the wire are exact Unicode code points.
export function fromUTF16(text,offset){
 if(!Number.isInteger(offset)||offset<0||offset>text.length)throw Error('INVALID_RANGE')
 if(offset>0&&offset<text.length&&/[\uD800-\uDBFF]/.test(text[offset-1])&&/[\uDC00-\uDFFF]/.test(text[offset]))throw Error('INVALID_RANGE')
 return Array.from(text.slice(0,offset)).length
}
export function toUTF16(text,offset){
 const chars=Array.from(text)
 if(!Number.isInteger(offset)||offset<0||offset>chars.length)throw Error('INVALID_RANGE')
 return chars.slice(0,offset).join('').length
}
// Fuente de un documento según su identificador opaco: l: lo agregó la persona
// desde su equipo; v: viene del inventario del vault.
export function sourceOf(id){return typeof id==='string'&&id.startsWith('l:')?'local':'vault'}
// Bytes → base64 por tramos (String.fromCharCode no admite millones de argumentos).
export function toBase64(bytes){
 let out=''
 for(let i=0;i<bytes.length;i+=0x8000)out+=String.fromCharCode.apply(null,bytes.subarray(i,i+0x8000))
 return btoa(out)
}
export const LOCAL_TYPES=['.md','.txt','.docx']
export const LOCAL_MAX_BYTES=8*1024*1024
// Motivo por el que un archivo no se puede agregar, o '' si se puede.
export function localFileProblem(name,size){
 const dot=String(name||'').lastIndexOf('.'),ext=dot<0?'':String(name).slice(dot).toLowerCase()
 if(!LOCAL_TYPES.includes(ext))return 'Solo se pueden agregar archivos .md, .txt o .docx. De un PDF u otro formato, guarda primero su texto.'
 if(size>LOCAL_MAX_BYTES)return 'El archivo supera los 8 MB.'
 if(!size)return 'El archivo está vacío.'
 return ''
}
export class ReviewSession {
 constructor(api,onChange=()=>{}){this.api=api;this.onChange=onChange;this.epoch=0;this.state={doc:null,draft:null,busy:false,error:'',message:'',caseId:null,id:null}}
 update(patch){this.state={...this.state,...patch};this.onChange(this.state)}
 canLeave(confirm=()=>window.confirm('¿Descartar el pasaje sin guardar?')){return (!this.state.busy||!this.state.doc)&&(!this.state.draft||confirm())}
 async open(id,caseId,confirm){
  if(!this.canLeave(confirm))return false
  const epoch=++this.epoch
  this.update({id,caseId,doc:null,draft:null,error:'',message:'',busy:true})
  try{const doc=await this.api('/reviewer/document?id='+encodeURIComponent(id)+'&case_id='+encodeURIComponent(caseId)+'&source='+sourceOf(id));if(epoch===this.epoch)this.update({doc})}
  catch(e){if(epoch===this.epoch)this.update({error:String(e.message||e)})}
  finally{if(epoch===this.epoch)this.update({busy:false})}
  return true
 }
 select(start,end){
  const d=this.state.doc;if(!d||this.state.busy)return
  const a=fromUTF16(d.text,start),b=fromUTF16(d.text,end)
  if(b<=a) return
  if(b-a>16000){this.update({error:'Pasaje mayor a 16.000 puntos de código.'});return}
  this.update({draft:{start_offset:a,end_offset:b,text:d.text.slice(start,end),version:0},error:'',message:''})
 }
 edit(a){if(this.state.busy||!this.canLeave())return;this.update({draft:{annotation_id:a.annotation_id,start_offset:a.start_offset,end_offset:a.end_offset,text:a.text,version:a.version},error:'',message:''})}
 cancel(){++this.epoch;this.update({busy:false,message:'Operación cancelada en esta vista; si se envió un guardado, comprueba su estado al reabrir.'})}
 dispose(){++this.epoch;this.onChange=()=>{}}
 async save(author='human:local',label='hecho_relevante'){
  const {doc,draft,caseId,id,busy}=this.state
  if(!doc||!draft||busy)return false
  const epoch=this.epoch;this.update({busy:true,error:'',message:''})
  try{
   const a=await this.api('/reviewer/annotation',{method:'POST',body:{id,source:sourceOf(id),case_id:caseId,source_sha256:doc.sha256,annotation:{...draft,author,labels:[label]}}})
   if(epoch!==this.epoch)return false
   this.update({draft:null,doc:{...doc,annotations:[...doc.annotations.filter(x=>x.annotation_id!==a.annotation_id),a]},message:'Pasaje guardado; documento fuente intacto.'});return true
  }catch(e){if(epoch===this.epoch)this.update({error:String(e.message||e)});return false}
  finally{if(epoch===this.epoch)this.update({busy:false})}
 }
 async action(op,annotation_id){
  if(!['export','proposal'].includes(op))throw Error('INVALID_ACTION')
  const {doc,id,caseId,busy}=this.state;if(!doc||busy)return null
  const epoch=this.epoch;this.update({busy:true,error:''})
  try{const result=await this.api('/reviewer/'+op,{method:'POST',body:{id,source:sourceOf(id),case_id:caseId,source_sha256:doc.sha256,annotation_id}});return epoch===this.epoch?result:null}
  catch(e){if(epoch===this.epoch)this.update({error:String(e.message||e)});return null}
  finally{if(epoch===this.epoch)this.update({busy:false})}
 }
}
