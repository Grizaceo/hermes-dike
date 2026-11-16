import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
test('Graphium observatory has its own scoped dark canvas token, opaque overlays and responsive viewport',async()=>{
 const {graphiumTheme}=await import('../src/graphium-theme.js')
 assert.equal(graphiumTheme.canvas,'var(--graph-canvas-bg, #06090f)')
 assert.match(graphiumTheme.surface,/--ui-bg-elevated/)
 const canvas=await readFile(new URL('../src/graphium-canvas.js',import.meta.url),'utf8')
 assert.match(canvas,/data-graphium-viewport/)
 assert.match(canvas,/graphiumTheme.canvas/)
})
test('visible node shader uses a soft halo but picking retains exact integer identity',async()=>{
 const renderer=await readFile(new URL('../src/graphium-renderer.js',import.meta.url),'utf8')
 assert.match(renderer,/smoothstep/)
 assert.match(renderer,/instance&255/)
 assert.match(renderer,/if\(picking\)/)
})
