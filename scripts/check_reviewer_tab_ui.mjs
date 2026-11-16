// Actual registered Diké page -> visible reviewer tab -> real HTTP/SQLite/Tiptap.
import {spawn} from 'node:child_process'
import {mkdtemp,rm,writeFile} from 'node:fs/promises'
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
async function click(selector){await until(`!!document.querySelector(${JSON.stringify(selector)})`);await ev('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');const p=await ev(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});el.scrollIntoView({block:'center'});const r=el.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`); const hit=await ev(`(()=>{const el=document.elementFromPoint(${p.x},${p.y});return {tag:el?.tagName,tab:el?.closest('[data-dike-tab]')?.getAttribute('data-dike-tab'),text:el?.textContent?.slice(0,80)}})()`); if(selector.startsWith('[data-dike-tab=')&&hit.tab!==selector.match(/^\[data-dike-tab=([^\]]+)\]$/)?.[1])throw Error('Tab hit target mismatch '+JSON.stringify({selector,p,hit}));await cdp('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...p});await cdp('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...p})}
try{
 for(const port of [8878,9435]){let busy=false;try{await fetch('http://127.0.0.1:'+port);busy=true}catch{}if(busy)throw Error('Test port occupied '+port)}
 profile=await mkdtemp(join(tmpdir(),'reviewer-tab-cdp-'))
 const server=launch(process.env.PYTHON||'python',['scripts/reviewer_e2e_server.py'],{REVIEWER_TEST_PORT:'8878',HERMES_HOME:join(profile,'hermes'),HOME:profile})
 assert.equal((await ready('http://127.0.0.1:8878/health',server)).marker,'dike-reviewer-e2e')
 const ids=await (await fetch('http://127.0.0.1:8878/fixture')).json()
 const chrome=launch('chromium',['--headless=new','--no-sandbox','--disable-background-networking',`--user-data-dir=${profile}/chromium`,'--remote-debugging-port=9435','--window-size=1447,1050','about:blank'])
 const targets=await ready('http://127.0.0.1:9435/json/list',chrome)
 ws=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl)
 await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j})
 ws.onmessage=e=>{const m=JSON.parse(e.data),p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(m.error):p.resolve(m.result)}}
 await cdp('Page.enable');await cdp('Runtime.enable');await cdp('Page.navigate',{url:'http://127.0.0.1:8878/tab'})
 await until('!!document.querySelector("[data-dike-tab=reviewer]")')
 // The fixture intentionally returns 404 for /estado; await its settled header
 // before measuring a tab, otherwise that async status changes its geometry.
 await until('document.body.innerText.includes("El backend de Diké no responde en el perfil activo (fixture)")')
 await until('!!document.querySelector(".tiptap")')
 assert.equal(await ev('document.querySelector("[data-dike-tab=reviewer]").textContent'),'Legal Reviewer')
 await click('[data-dike-tab=reviewer]')
 await until('document.querySelectorAll("[data-reviewer-document]").length===3')
 assert.equal(await ev('fixture.calls.some(x=>x.path.startsWith("/reviewer/document"))'),false,'listing must not read source text')
 const doc=k=>'[data-reviewer-document="'+ids[k]+'"]'
 await click(doc('A'));await until('!!document.querySelector("[data-review-source]")')
 const point=await ev(`(()=>{const el=document.querySelector('[data-review-source]');el.scrollIntoView();const range=document.createRange();const t=el.firstChild;range.setStart(t,t.textContent.indexOf('El café'));range.setEnd(t,t.textContent.indexOf('El café')+2);const r=range.getBoundingClientRect();return {x:r.x+3,y:r.y+r.height/2}})()`)
 await cdp('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:3,...point});await cdp('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:3,...point})
 await until('!!document.querySelector("[data-review-draft]")')
 await ev('window.confirm=()=>false');await click('[data-dike-tab=nif]')
 assert.equal(await ev('document.querySelector("[data-dike-tab=reviewer]").getAttribute("aria-selected")'),'true')
 await click(doc('B'));assert.equal(await ev('document.querySelector("[data-review-source]").textContent.startsWith("Ficción")'),true)
 await click('[data-review-save]');await until('document.querySelectorAll("[data-review-annotation]").length===1')
 await click('[data-review-export]');await until('!!document.querySelector("[data-review-output]")')
 assert.ok(await ev('JSON.parse(document.querySelector("[data-review-output]").value).evidence_ref.hash'))
 const shot=await cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:true})
 await writeFile(join(root,'.workshop/reviewer-tab-fixture.png'),Buffer.from(shot.data,'base64'))
 await click('[data-reviewer-writer]')
 await until('document.querySelector("[data-dike-tab=escritor]").getAttribute("aria-selected")==="true"')
 await until('document.querySelector(".tiptap")?.innerText.includes("El café")')
 await click('[data-dike-tab=reviewer]');await until('document.querySelectorAll("[data-reviewer-document]").length===3')
 await click(doc('A'));await until('document.querySelectorAll("[data-review-annotation]").length===1')
 await click(doc('B'));await until('document.querySelector("[data-review-source]")?.textContent.includes("Documento B")')
 assert.equal(await ev('document.querySelectorAll("[data-review-annotation]").length'),0)
 await click(doc('C'));await until('document.querySelector("[data-reviewer]")?.textContent.includes("DOCUMENT_DENIED")')
 assert.equal(await ev('!!document.querySelector("[data-review-source]")'),false)
 assert.equal(await ev('fixture.calls.some(x=>x.path.includes("/nif/edit"))'),false)
 // Documento agregado desde el equipo: archivo real → input de archivo → HTTP → disco del fixture.
 const localFile=join(profile,'Contrato local.md'),pdfFile=join(profile,'sentencia.pdf')
 await writeFile(localFile,'Contrato local ficticio 😀\r\nCláusula única: el café se paga al contado.\r\nFin.')
 await writeFile(pdfFile,'%PDF-1.7 ficticio')
 const setFile=async path=>{const {root:{nodeId}}=await cdp('DOM.getDocument');const {nodeId:input}=await cdp('DOM.querySelector',{nodeId,selector:'[data-reviewer-file]'});assert.ok(input,'no hay input de archivo');await cdp('DOM.setFileInputFiles',{nodeId:input,files:[path]})}
 await setFile(pdfFile)
 await until('document.querySelector("[data-reviewer-workspace]").textContent.includes("Solo se pueden agregar archivos .md, .txt o .docx")')
 assert.equal(await ev('fixture.calls.some(x=>x.path==="/reviewer/local"&&x.body)'),false,'un PDF no debe llegar al backend')
 await setFile(localFile)
 await until('document.querySelectorAll("[data-reviewer-locals] [data-reviewer-document]").length===1')
 await until('document.querySelector("[data-review-source]")?.textContent.includes("Contrato local ficticio")')
 const upload=await ev('JSON.stringify(fixture.calls.find(x=>x.path==="/reviewer/local"&&x.body).body)')
 assert.deepEqual(Object.keys(JSON.parse(upload)).sort(),['data_b64','name']);assert.equal(JSON.parse(upload).name,'Contrato local.md')
 assert.equal(await ev('fixture.calls.some(x=>x.path.startsWith("/reviewer/document")&&x.path.endsWith("&source=local"))'),true)
 assert.equal(await ev('document.querySelector("[data-review-source]").textContent.includes("\\r\\n")'),true,'el texto conserva sus CRLF')
 const lp=await ev(`(()=>{const el=document.querySelector('[data-review-source]');el.scrollIntoView();const range=document.createRange();const t=el.firstChild;const i=t.textContent.indexOf('Cláusula');range.setStart(t,i);range.setEnd(t,i+2);const r=range.getBoundingClientRect();return {x:r.x+3,y:r.y+r.height/2}})()`)
 await cdp('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:3,...lp});await cdp('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:3,...lp})
 await until('document.querySelector("[data-review-draft]")?.textContent.includes("Cláusula única")')
 await click('[data-review-save]');await until('document.querySelectorAll("[data-review-annotation]").length===1')
 await click('[data-review-export]');await until('document.querySelector("[data-review-output]")?.value.includes("local:l:")')
 const ref=JSON.parse(await ev('document.querySelector("[data-review-output]").value')).evidence_ref
 assert.match(ref.locator,/^local:l:[0-9a-f]{32}#cp=\d+:\d+$/);assert.match(ref.hash,/^[0-9a-f]{64}$/)
 const localShot=await cdp('Page.captureScreenshot',{format:'png',captureBeyondViewport:true})
 await writeFile(join(root,'.workshop/reviewer-local-fixture.png'),Buffer.from(localShot.data,'base64'))
 await ev('window.confirm=()=>true');await click('[data-reviewer-remove]')
 await until('document.querySelector("[data-reviewer-locals]").textContent.includes("Todavía no has agregado documentos")')
 assert.equal(await ev('!!document.querySelector("[data-review-source]")'),false,'el documento quitado deja de mostrarse')
 assert.equal(await ev('document.querySelector("[data-reviewer-workspace]").textContent.includes("1 pasaje(s) borrado(s)")'),true)
 assert.equal(await ev('fixture.calls.some(x=>x.path.includes("/nif/edit"))'),false)
 console.log(JSON.stringify({result:'PASS',scope:'actual registered page in isolated fictitious host, not native Desktop',checks:['visible Legal Reviewer tab','inventory without body reads','document selection','tab/document draft guards','save/export','navigate and insert in actual Case Writer','SQLite reopen','document B isolation','unapproved document denied','local file add/open/annotate/export/remove','PDF refused before upload'],screenshot:join(root,'.workshop/reviewer-tab-fixture.png')},null,2))
}finally{clearTimeout(watchdog);ws?.close();for(const p of owned.reverse())p.kill('SIGTERM');if(profile){await pause(250);await rm(profile,{recursive:true,force:true})}}
