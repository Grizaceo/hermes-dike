import assert from 'node:assert/strict'
import test from 'node:test'
import * as graph from '../src/graphium-data.js'
import {GraphiumRenderer} from '../src/graphium-renderer.js'

function eventRenderer() {
  const events=new Map(), calls=[]
  const canvas={addEventListener:(name,fn)=>events.set(name,fn),removeEventListener:()=>{},setPointerCapture:()=>{},hasPointerCapture:()=>false,getBoundingClientRect:()=>({left:10,top:20}),style:{}}
  const renderer=Object.assign(Object.create(GraphiumRenderer.prototype),{canvas,listeners:[],callbacks:{onNode:n=>calls.push(['select',n]),onNodeContext:(n,at)=>calls.push(['context',n,at])},d:{nodes:[{id:' literal:node '}],ids:[' literal:node ']},camera:{yaw:0,pitch:0,target:[0,0,0],dist:100},height:500,pick:()=>0,requestDraw:()=>{}})
  renderer.bindEvents()
  const emit=(name,extra={})=>events.get(name)({clientX:100,clientY:120,pointerId:1,button:2,preventDefault:()=>{},...extra})
  return {emit,calls,renderer}
}

test('right click dispatches a literal node and menu coordinates, never a left selection',()=>{
  const {emit,calls}=eventRenderer()
  emit('pointerdown');emit('pointerup')
  assert.deepEqual(calls,[['context',{id:' literal:node '},{clientX:100,clientY:120}]])
})

test('right drag still pans and never opens the node menu',()=>{
  const {emit,calls,renderer}=eventRenderer()
  emit('pointerdown');emit('pointermove',{clientX:130});emit('pointerup',{clientX:130})
  assert.notEqual(renderer.camera.target[0],0)
  assert.deepEqual(calls,[])
})

test('left click keeps node selection and prevents the native browser context menu',()=>{
  const {emit,calls}=eventRenderer()
  emit('pointerdown',{button:0});emit('pointerup',{button:0})
  assert.deepEqual(calls,[['select',{id:' literal:node '}]])
  let prevented=false
  emit('contextmenu',{preventDefault:()=>{prevented=true}})
  assert.equal(prevented,true)
})

test('Graphium neighborhood and category filters preserve source metadata and are reversible',()=>{
  assert.equal(typeof graph.graphViewProjection,'function')
  const p={nodes:[{id:'a',tipo:'ley'},{id:'b',tipo:'articulo'},{id:'c',tipo:'sentencia'},{id:'d',tipo:'articulo'}],links:[{source:'a',target:'b'},{source:'b',target:'c'},{source:'c',target:'d'}]}
  assert.deepEqual(graph.graphViewProjection(p,{isolate:{id:'a',hops:1}}).nodes.map(n=>n.id),['a','b'])
  assert.deepEqual(graph.graphViewProjection(p,{isolate:{id:'a',hops:2}}).nodes.map(n=>n.id),['a','b','c'])
  assert.deepEqual(graph.graphViewProjection(p,{onlyKind:'articulo'}).nodes.map(n=>n.id),['b','d'])
  assert.deepEqual(graph.graphViewProjection(p,{hiddenKinds:new Set(['articulo'])}).nodes.map(n=>n.id),['a','c'])
  assert.equal(graph.graphViewProjection(p,{}),p)
  assert.equal(p.nodes.length,4)
})

const key = (value,extra={}) => ({key:value,target:{closest:()=>null},...extra})

test('F focuses graph search and R resets view without changing the graph',()=>{
  assert.equal(typeof graph.graphShortcut,'function','graph shortcuts must be implemented')
  assert.equal(graph.graphShortcut(key('f')),'search')
  assert.equal(graph.graphShortcut(key('F')),'search')
  assert.equal(graph.graphShortcut(key('r')),'reset')
  assert.equal(graph.graphShortcut(key('R')),'reset')
  assert.equal(graph.graphShortcut(key('e')),'edit')
  assert.equal(graph.graphShortcut(key('x')),null)
})

test('graph shortcuts leave text inputs, composition, modifiers and handled events alone',()=>{
  assert.equal(typeof graph.graphShortcut,'function')
  for(const extra of [{ctrlKey:true},{metaKey:true},{altKey:true},{repeat:true},{isComposing:true},{defaultPrevented:true},{target:{isContentEditable:true}},{target:{closest:()=>({})}}]) {
    assert.equal(graph.graphShortcut(key('f',extra)),null)
    assert.equal(graph.graphShortcut(key('r',extra)),null)
  }
})

test('hiding a node removes only its visual node and incident edges, preserving source objects',()=>{
  assert.equal(typeof graph.visibleProjection,'function','reversible node hiding must be implemented')
  const nodes=Object.freeze([Object.freeze({id:' a '}),Object.freeze({id:'b'}),Object.freeze({id:'c'})])
  const links=Object.freeze([Object.freeze({source:' a ',target:'b'}),Object.freeze({source:'b',target:'c'})])
  const p=Object.freeze({nodes,links,authority:'documentary'})
  const visible=graph.visibleProjection(p,new Set([' a ']))
  assert.deepEqual(visible.nodes,[nodes[1],nodes[2]])
  assert.deepEqual(visible.links,[links[1]])
  assert.equal(visible.authority,'documentary')
  assert.equal(p.nodes.length,3)
  assert.equal(visible.nodes[0],nodes[1])
  assert.equal(graph.visibleProjection(p,new Set()),p)
})

test('hide-all and restore preserve literal IDs and never leave dangling edges',()=>{
  assert.equal(typeof graph.visibleProjection,'function')
  const p={nodes:[{id:'a'},{id:'b'}],links:[{source:{id:'a'},target:'b'}]}
  assert.deepEqual(graph.visibleProjection(p,new Set(['b'])),{nodes:[p.nodes[0]],links:[]})
  assert.deepEqual(graph.visibleProjection(p,new Set(['a','b'])),{nodes:[],links:[]})
  assert.equal(graph.visibleProjection(p,new Set()),p)
})
