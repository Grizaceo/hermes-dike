import assert from 'node:assert/strict'
import test from 'node:test'

const modulePath = '../src/graphium-data.js'
const load = () => import(modulePath)
function fixture(edgeKind='["cita","candidata"]') {
  const footer = new TextEncoder().encode(JSON.stringify({edge_kinds:[edgeKind]}))
  const raw = new ArrayBuffer(32+2*28+8+4+footer.length)
  const dv = new DataView(raw)
  ;[0x4e494247,1,2,1,1,1,1,footer.length].forEach((v,i)=>dv.setUint32(i*4,v,true))
  new Float32Array(raw,32,6).set([0,0,0,10,10,10])
  for(let i=0;i<2;i++) { dv.setFloat32(32+24+i*16+8,3,true); dv.setUint32(32+24+i*16+12,0x60a5faeb,true) }
  new Uint32Array(raw,32+56,2).set([0,1])
  new Uint8Array(raw,100).set(footer)
  return raw
}

test('decoder preserves original typed positions and binary counts', async()=>{
  const {decodeGbin} = await load(); const d=decodeGbin(fixture())
  assert.equal(d.nodeCount,2); assert.equal(d.edgeCount,1)
  assert.deepEqual([...d.positions],[0,0,0,10,10,10])
  assert.deepEqual([...d.edgePairs],[0,1])
})
test('decoder rejects incompatible version, truncation, invalid indices and nonfinite positions',async()=>{
  const {decodeGbin}=await load()
  for (const edit of [r=>new DataView(r).setUint32(4,2,true), r=>new DataView(r).setUint32(88,99,true),r=>new DataView(r).setFloat32(32,NaN,true)]) {
    const raw=fixture(); edit(raw); assert.throws(()=>decodeGbin(raw))
  }
  assert.throws(()=>decodeGbin(fixture().slice(0,35)))
})
test('stable mapping is literal, independent from node metadata order',async()=>{
  const {mapSnapshot}=await load(); const raw=fixture()
  const b64=Buffer.from(raw).toString('base64')
  const metadata=[{id:' b '},{id:'a'}]
  const d=mapSnapshot({engine:'graphium-rust',gbin_b64:b64,node_ids:['a',' b ']},{nodes:metadata,links:[]})
  assert.equal(d.nodes[0],metadata[1]); assert.equal(d.nodes[1],metadata[0])
  assert.equal(d.indexById.get(' b '),1)
  assert.throws(()=>mapSnapshot({engine:'python',gbin_b64:b64,node_ids:['a',' b ']},{nodes:metadata,links:[]}))
  assert.throws(()=>mapSnapshot({engine:'graphium-rust',gbin_b64:b64,node_ids:['a','a']},{nodes:metadata,links:[]}))
})
test('binary edge selection resolves exact tipo and status, not original edge order',async()=>{
  const {mapSnapshot,edgeAt}=await load()
  const first={source:'b',target:'a',tipo:'cita',estado:'aprobada'}
  const second={source:'a',target:'b',tipo:'cita',estado:'candidata'}
  const d=mapSnapshot({engine:'graphium-rust',gbin_b64:Buffer.from(fixture()).toString('base64'),node_ids:['a','b']}, {nodes:[{id:'a'},{id:'b'}],links:[first,second]})
  assert.equal(edgeAt(d,0),second)
})
test('empty edge type and status stay literal, while absent values receive defaults',async()=>{
  const {mapSnapshot,edgeAt}=await load()
  const link={source:'a',target:'b',tipo:'',estado:''}
  const d=mapSnapshot({engine:'graphium-rust',gbin_b64:Buffer.from(fixture('["",""]')).toString('base64'),node_ids:['a','b']},{nodes:[{id:'a'},{id:'b'}],links:[link]})
  assert.equal(edgeAt(d,0),link)
})
test('wire projection minimizes metadata and includes only explicit cached positions',async()=>{
  const {wireProjection}=await load()
  const pool=new Map([['a',[1,2,3]]])
  const p={nodes:[{id:'a',tipo:'',label:'',text:'must not be sent'},{id:'b'}],links:[{source:'a',target:'b',tipo:'',estado:'',evidence:{private:'not sent'}}]}
  assert.deepEqual(wireProjection(p,pool),{nodes:[{id:'a',tipo:'',label:'',position:[1,2,3]},{id:'b',tipo:'node',label:'b'}],links:[{source:'a',target:'b',tipo:'',estado:''}]})
})

test('renderer refuses unavailable WebGL2 rather than falling back to JS physics',async()=>{
  const {GraphiumRenderer}=await import('../src/graphium-renderer.js')
  assert.throws(()=>new GraphiumRenderer({getContext:()=>null},{}),/WebGL2/)
})

test('subset bounds, projection and edge hit testing work without JS physics',async()=>{
  const {boundsOf,mat4Perspective,mat4LookAt,projectToCss,nearestEdge}=await load()
  const d={positions:new Float32Array([0,0,0,10,10,10]),nodeCount:2,edgeCount:1,edgePairs:new Uint32Array([0,1])}
  assert.deepEqual(boundsOf(d,[0]).center,[0,0,0])
  const view=mat4LookAt(new Float32Array(16),[0,0,100],[0,0,0],[0,1,0])
  const proj=mat4Perspective(new Float32Array(16),Math.PI/3,1,1,10000)
  const p=projectToCss(0,0,0,view,proj,500,500)
  assert.equal(p.x,250); assert.equal(p.y,250)
  assert.equal(nearestEdge(d,250,250,view,proj,500,500),0)
  assert.equal(nearestEdge(d,0,0,view,proj,500,500),-1)
})
