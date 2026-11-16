import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
const load=async()=>import('../src/graph-workspace.js')
test('node inspector resolves expanded units, preserves literal identity and refreshes current metadata',async()=>{
 const {graphNodeIndex}=await load()
 const index=graphNodeIndex([{id:'art:01',label:'Artículo'}],new Map([['art:01',{nodes:[{id:'unit:01',label:'Unidad antigua'}]}]]),[{id:'unit:01',label:'Unidad actual'}])
 assert.equal(index.get('unit:01').label,'Unidad actual')
 assert.equal(index.get('art:01').label,'Artículo')
 assert.equal(index.has('art:1'),false)
})
test('observatory layout has scoped responsive viewport and explicit inspector geometry',async()=>{
 const {graphWorkspaceCSS}=await load()
 assert.match(graphWorkspaceCSS,/\[data-graph-workspace\]/)
 assert.match(graphWorkspaceCSS,/@media/)
 assert.match(graphWorkspaceCSS,/grid-template-columns/)
 assert.match(graphWorkspaceCSS,/data-graph-inspector/)
 assert.match(graphWorkspaceCSS,/data-graph-categories/)
})
