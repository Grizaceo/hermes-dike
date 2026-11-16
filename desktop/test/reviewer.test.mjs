import test from 'node:test'
import assert from 'node:assert/strict'
import {ReviewSession,fromUTF16,toUTF16} from '../src/reviewer-session.js'
import {encolarCita,tomarCitas,insertarCitasPendientes} from '../src/puente.js'
const doc=id=>({doc_id:id,sha256:id,text:'café 😀 e\u0301\nfin',annotations:[],labels:['hecho_relevante']})
const defer=()=>{let resolve;const promise=new Promise(r=>{resolve=r});return {promise,resolve}}

test('Unicode offsets never split a surrogate or normalize combining marks',()=>{
 const text=doc('A').text
 for(let i=0;i<=Array.from(text).length;i++)assert.equal(fromUTF16(text,toUTF16(text,i)),i)
 assert.throws(()=>fromUTF16('😀',1));assert.throws(()=>toUTF16(text,-1));assert.throws(()=>fromUTF16(text,999))
})
test('late A read cannot replace B',async()=>{
 const a=defer(),r=new ReviewSession((path)=>path.includes('id=A')?a.promise:Promise.resolve(doc('B')))
 const first=r.open('A','case-a');await r.open('B','case-b');a.resolve(doc('A'));await first
 assert.equal(r.state.doc.doc_id,'B');assert.equal(r.state.caseId,'case-b')
})
test('double save, cancel, late A save, draft guard and conflict',async()=>{
 const a=defer();let saves=0
 const r=new ReviewSession((path,opts)=>{if(opts?.method){saves++;return a.promise}return Promise.resolve(doc(path.includes('id=A')?'A':'B'))})
 await r.open('A','case-a');r.select(0,4)
 assert.equal(await r.open('B','case-b',()=>false),false)
 const save=r.save();const second=await r.save();assert.equal(second,false);assert.equal(saves,1)
 r.cancel();assert.equal(r.state.draft.text,'café')
 await r.open('B','case-b',()=>true)
 a.resolve({annotation_id:'ann-a',version:1});await save
 assert.equal(r.state.doc.doc_id,'B');assert.deepEqual(r.state.doc.annotations,[])
 const c=new ReviewSession((path,opts)=>opts?.method?Promise.reject(Error('CONFLICT')):Promise.resolve(doc('C')))
 await c.open('C','case');c.select(0,4);await c.save();assert.equal(c.state.draft.text,'café');assert.match(c.state.error,/CONFLICT/)
})
test('export carries reference and pending proposal never applies NIF',async()=>{
 const routes=[];const r=new ReviewSession(async(path,opts)=>{routes.push(path);return opts?.method?{applied:false,cita:'pasaje',evidence_ref:{hash:'sha'}}:doc('A')})
 await r.open('A','case');const exp=await r.action('export','ann-a');assert.equal(exp.evidence_ref.hash,'sha')
 assert.equal((await r.action('proposal','ann-a')).applied,false);assert.equal(routes.some(p=>p.includes('/nif/edit')),false)
})
test('case scoped writer queue preserves evidence and leaves other case pending',()=>{
 tomarCitas();encolarCita({cita:'pasaje A',case_id:'A',evidencia:{hash:'sha',source_id:'doc',locator:'cp=0:4'}})
 encolarCita({cita:'pasaje B',case_id:'B'})
 const a=tomarCitas('A');assert.equal(a.length,1);assert.equal(a[0].evidencia.hash,'sha');assert.equal(tomarCitas('B')[0].cita,'pasaje B')
})
