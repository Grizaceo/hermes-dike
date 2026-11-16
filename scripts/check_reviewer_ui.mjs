// Real Chromium acceptance: React reader -> selection -> SQLite -> Tiptap.
import {spawn} from 'node:child_process'
import {mkdtemp,rm,readFile,mkdir} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import assert from 'node:assert/strict'
const root=resolve(import.meta.dirname,'..'),owned=[],pending=new Map(),pause=ms=>new Promise(r=>setTimeout(r,ms))
let ws,seq=0,profile
const watchdog=setTimeout(()=>{owned.forEach(p=>p.kill());process.exit(2)},60000)
function launch(cmd,args,env={}){const p=spawn(cmd,args,{cwd:root,env:{...process.env,...env},stdio:['ignore','pipe','pipe']});p.stderr.on('data',b=>p.error=String(b));owned.push(p);return p}
async function ready(url,p){for(let i=0;i<100;i++){if(p.exitCode!==null)throw Error(p.error);try{const r=await fetch(url);if(r.ok)return r.json()}catch{}await pause(50)}throw Error('Not ready '+url)}
function cdp(method,params={}){return new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}))})}
async function ev(expression){const r=await cdp('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value}
async function until(expression){for(let i=0;i<120;i++){if(await ev(expression))return;await pause(50)}throw Error('Timed out '+expression+' BODY '+await ev('document.body.innerText'))}
async function click(selector){await until(`!!document.querySelector(${JSON.stringify(selector)})`);const p=await ev(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});el.scrollIntoView({block:'center'});const r=el.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);await cdp('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...p});await cdp('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...p})}
try{
 for(const port of [8877,9434]){let busy=false;try{await fetch('http://127.0.0.1:'+port);busy=true}catch{}if(busy)throw Error('Test port occupied '+port)}
 profile=await mkdtemp(join(tmpdir(),'reviewer-cdp-'))
 const server=launch(process.env.PYTHON||'python',['scripts/reviewer_e2e_server.py'],{HERMES_HOME:join(profile,'hermes'),HOME:profile})
 assert.equal((await ready('http://127.0.0.1:8877/health',server)).marker,'dike-reviewer-e2e')
 const chrome=launch('chromium',['--headless=new','--no-sandbox','--disable-background-networking',`--user-data-dir=${profile}/chromium`,'--remote-debugging-port=9434','--window-size=1280,1000','about:blank'])
 const targets=await ready('http://127.0.0.1:9434/json/list',chrome)
 ws=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl)
 await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j})
 ws.onmessage=e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(m.error):p.resolve(m.result)}}
 await mkdir(join(profile,'downloads'))
 await cdp('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:join(profile,'downloads')})
 await cdp('Page.enable');await cdp('Runtime.enable');await cdp('Page.navigate',{url:'http://127.0.0.1:8877/'})
 await until('!!document.querySelector("[data-node-review]")')
 await click('[data-node-review]');await until('!!document.querySelector("[data-review-source]")')
 // Mouse triple-click selects the line through the browser, no fake API selection.
 const point=await ev(`(()=>{const el=document.querySelector('[data-review-source]');el.scrollIntoView();const range=document.createRange();const t=el.firstChild;range.setStart(t,t.textContent.indexOf('El café'));range.setEnd(t,t.textContent.indexOf('El café')+2);const r=range.getBoundingClientRect();return {x:r.x+3,y:r.y+r.height/2}})()`)
 await cdp('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:3,...point});await cdp('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:3,...point})
 await until('!!document.querySelector("[data-review-draft]")')
 const selected=await ev('document.querySelector("[data-review-draft] blockquote").textContent');assert.ok(selected.includes('El café é se entregó.'))
 // Closing with a dirty selection must consult the guard and preserve on Cancel.
 await ev('window.confirm=()=>false');await click('[data-node-close]');assert.equal(await ev('!!document.querySelector("[data-review-draft]")'),true)
 // Two same-tick Ctrl+S must submit just one mutation.
 await ev(`(()=>{const el=document.querySelector('[data-review-draft]');el.dispatchEvent(new KeyboardEvent('keydown',{key:'s',ctrlKey:true,bubbles:true}));el.dispatchEvent(new KeyboardEvent('keydown',{key:'s',ctrlKey:true,bubbles:true}))})()`)
 await until('document.querySelectorAll("[data-review-annotation]").length===1')
 assert.equal(await ev('fixture.calls.filter(x=>x.path==="/reviewer/annotation").length'),1)
 const saved=await ev('fixture.calls.find(x=>x.path==="/reviewer/annotation").body');assert.equal(saved.annotation.text,selected)
 await click('[data-node-close]');await click('[data-fixture-reopen]');await click('[data-node-review]');await until('document.querySelectorAll("[data-review-annotation]").length===1')
 assert.equal(await ev('document.querySelector("[data-review-annotation] blockquote").textContent'),selected)
 await click('[data-review-export]');await until('!!document.querySelector("[data-review-output]")')
 const exported=await ev('JSON.parse(document.querySelector("[data-review-output]").value)');assert.equal(exported.evidence.snippet_exact,selected);assert.equal(exported.evidence.confidence,null)
 await click('#consume');assert.ok((await ev('fixture.editor.getText()')).includes(selected.replace(/\r\n|\r/g,'\n').trim()));assert.equal(await ev('fixture.pistas[0].cita'),exported.cita);assert.equal(await ev('fixture.pistas[0].evidencia.hash'),exported.evidence_ref.hash)
 assert.equal(await ev(`(async()=>{const r=await fetch('/escrito',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({case_id:'borrador',html:fixture.editor.getHTML(),texto:fixture.editor.getText(),rev_base:0,registro:{pistas:fixture.pistas}})});return r.status})()`),200)
 const written=await ev(`(async()=>{const r=await fetch('/escrito?case_id=borrador');return await r.json()})()`)
 assert.equal(written.registro.pistas[0].cita,exported.cita);assert.equal(written.registro.pistas[0].evidencia.hash,exported.evidence_ref.hash)
 await ev(`fixture.editor.commands.setContent(${JSON.stringify(written.html)})`)
 assert.ok((await ev('fixture.editor.getText()')).includes(selected.replace(/\r\n|\r/g,'\n').trim()))
 await click('[data-review-proposal]');await until('JSON.parse(document.querySelector("[data-review-output]").value).applied===false')
 const proposal=await ev('JSON.parse(document.querySelector("[data-review-output]").value)');assert.equal(proposal.status,'PENDING_EXTERNAL_HITL_5');assert.equal(await ev('fixture.calls.some(x=>x.path.includes("/nif/"))'),false)
 await click('[data-review-download]')
 let downloaded
 for(let i=0;i<60;i++){try{downloaded=JSON.parse(await readFile(join(profile,'downloads/pasaje-borrador.json'),'utf8'));break}catch{}await pause(50)}
 assert.equal(downloaded?.status,'PENDING_EXTERNAL_HITL_5');assert.equal(downloaded.evidence.evidence_ref.hash,exported.evidence_ref.hash)
 // Refresh persistence in a new page context; DB is the only annotation source.
 await cdp('Page.reload');await click('[data-node-review]');await until('document.querySelectorAll("[data-review-annotation]").length===1')
 await click('[data-fixture-B]');await until('document.querySelector("[data-review-source]")?.textContent.includes("Documento B")');assert.equal(await ev('document.querySelectorAll("[data-review-annotation]").length'),0)
 console.log(JSON.stringify({result:'PASS',browser:'Chromium headless',selection:selected,annotation_id:exported.annotation_id,writer_evidence:exported.evidence_ref,proposal_status:proposal.status,checks:['real mouse selection','dirty close cancelled','double Ctrl+S single write','SQLite reopen','reload persistence','exact export','real Tiptap writer insertion','case scoped evidence bridge','pending proposal no NIF calls','document B isolation']},null,2))
}finally{clearTimeout(watchdog);ws?.close();for(const p of owned.reverse())p.kill('SIGTERM');if(profile){await pause(250);await rm(profile,{recursive:true,force:true})}}
