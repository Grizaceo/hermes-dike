// Diké visor using Graphium's GBIN + instanced billboard approach and camera math.
// Graphium 0.2.0 MIT attribution and source provenance: ../../graphium/README.md.
import {boundsOf,mat4Perspective,mat4LookAt,nearestEdge,edgeAt} from './graphium-data.js'

const NODE_VS=`#version 300 es
precision highp float;
layout(location=0) in vec2 corner;
layout(location=1) in vec3 position;
layout(location=2) in vec4 color;
layout(location=3) in float radius;
uniform mat4 view; uniform mat4 proj; uniform vec2 viewport;
out vec2 uv; out vec4 tint; flat out int instance;
void main(){vec4 p=proj*view*vec4(position,1.);p.xy+=corner*radius*2./viewport*p.w;gl_Position=p;uv=corner;tint=color;instance=gl_InstanceID+1;}`
const NODE_FS=`#version 300 es
precision highp float; precision highp int;
in vec2 uv; in vec4 tint; flat in int instance; uniform bool picking;out vec4 outputColor;
void main(){if(dot(uv,uv)>1.)discard;if(picking){outputColor=vec4(float(instance&255),float((instance>>8)&255),float((instance>>16)&255),255.)/255.;}else{float r=length(uv);float core=1.-smoothstep(.40,.72,r);float halo=(1.-smoothstep(.55,1.,r))*.35;outputColor=vec4(mix(tint.rgb,min(vec3(1.),tint.rgb*1.25),core*.45),tint.a*max(core,halo));}}`
const LINE_VS=`#version 300 es
precision highp float;
layout(location=0) in vec3 position;layout(location=1) in vec4 color;uniform mat4 view;uniform mat4 proj;out vec4 tint;
void main(){gl_Position=proj*view*vec4(position,1.);tint=color;}`
const LINE_FS=`#version 300 es
precision highp float;in vec4 tint;out vec4 outputColor;void main(){outputColor=tint;}`

const ARROW_VS=`#version 300 es
precision highp float;
layout(location=0) in vec3 source;layout(location=1) in vec3 target;layout(location=2) in vec4 color;layout(location=3) in float arrowEnabled;
uniform mat4 view;uniform mat4 proj;uniform vec2 viewport;out vec4 tint;
void main(){vec4 a=proj*view*vec4(source,1.),b=proj*view*vec4(target,1.);tint=vec4(color.rgb,color.a*arrowEnabled);if(a.w<=0.||b.w<=0.){gl_Position=vec4(2.,2.,2.,1.);return;}vec2 delta=(b.xy/b.w-a.xy/a.w)*viewport;float len=length(delta);vec2 dir=len>.001?delta/len:vec2(1.,0.);vec2 side=vec2(-dir.y,dir.x);vec4 mid=mix(a,b,.85);vec2 offset=gl_VertexID==0?dir*5.:(-dir*4.+side*(gl_VertexID==1?3.:-3.));mid.xy+=offset*2./viewport*mid.w;gl_Position=mid;}`

function rgba(value,fallback) {
  if(typeof value!=='string') return fallback
  if(/^#[0-9a-f]{6}$/i.test(value)) return [parseInt(value.slice(1,3),16)/255,parseInt(value.slice(3,5),16)/255,parseInt(value.slice(5,7),16)/255,1]
  const m=value.match(/^rgba?\(([^)]+)\)$/)
  if(m) {const a=m[1].split(',').map(Number);return [a[0]/255,a[1]/255,a[2]/255,a[3]??1]}
  return fallback
}

export class GraphiumRenderer {
  constructor(canvas,callbacks={}) {
    this.canvas=canvas;this.callbacks=callbacks;this.gl=canvas.getContext('webgl2',{antialias:true,alpha:true})
    if(!this.gl || this.gl.isContextLost()) throw new Error('WebGL2 no está disponible; queda la lista de texto.')
    this.resources=[];this.listeners=[];this.dead=false;this.frame=0;this.d=null
    this.view=new Float32Array(16);this.proj=new Float32Array(16)
    this.camera={yaw:.35,pitch:.22,dist:800,target:[0,0,0]}
    this.width=1;this.height=1;this.hover=-1;this.lastHover=0
    try {
      this.nodeProgram=this.program(NODE_VS,NODE_FS);this.lineProgram=this.program(LINE_VS,LINE_FS);this.arrowProgram=this.program(ARROW_VS,LINE_FS)
      const gl=this.gl
      this.nodeVao=this.track('VertexArray',gl.createVertexArray());gl.bindVertexArray(this.nodeVao)
      this.buffer(new Float32Array([-1,-1,1,-1,1,1,-1,-1,1,1,-1,1]),0,2)
      this.posBuf=this.buffer(new Float32Array(),1,3,1)
      this.colorBuf=this.buffer(new Float32Array(),2,4,1)
      this.radiusBuf=this.buffer(new Float32Array(),3,1,1)
      this.lineVao=this.track('VertexArray',gl.createVertexArray());gl.bindVertexArray(this.lineVao)
      this.linePosBuf=this.buffer(new Float32Array(),0,3)
      this.lineColorBuf=this.buffer(new Float32Array(),1,4)
      this.arrowVao=this.track('VertexArray',gl.createVertexArray());gl.bindVertexArray(this.arrowVao)
      gl.bindBuffer(gl.ARRAY_BUFFER,this.linePosBuf)
      for(const [index,offset] of [[0,0],[1,12]]){gl.enableVertexAttribArray(index);gl.vertexAttribPointer(index,3,gl.FLOAT,false,24,offset);gl.vertexAttribDivisor(index,1)}
      gl.bindBuffer(gl.ARRAY_BUFFER,this.lineColorBuf);gl.enableVertexAttribArray(2);gl.vertexAttribPointer(2,4,gl.FLOAT,false,32,0);gl.vertexAttribDivisor(2,1)
      this.arrowFlagsBuf=this.buffer(new Float32Array(),3,1,1)
      gl.bindVertexArray(null)
      this.pickFbo=this.track('Framebuffer',gl.createFramebuffer())
      this.pickTexture=this.track('Texture',gl.createTexture())
      this.pickDepth=this.track('Renderbuffer',gl.createRenderbuffer())
      this.resizeObserver=new ResizeObserver(()=>this.resize())
      this.resizeObserver.observe(canvas)
      this.bindEvents();this.resize()
    } catch(error) {this.destroy();throw error}
  }
  track(kind,item) {if(!item)throw new Error('No se pudo reservar un recurso WebGL2');this.resources.push([kind,item]);return item}
  program(vs,fs) {
    const gl=this.gl,shaders=[]
    try {
      for(const [kind,src] of [[gl.VERTEX_SHADER,vs],[gl.FRAGMENT_SHADER,fs]]) {
        const shader=gl.createShader(kind);shaders.push(shader);gl.shaderSource(shader,src);gl.compileShader(shader)
        if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader)||'Error compilando shader')
      }
      const p=this.track('Program',gl.createProgram());shaders.forEach(s=>gl.attachShader(p,s));gl.linkProgram(p)
      if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(p)||'Error enlazando shader')
      return p
    } finally {shaders.forEach(s=>gl.deleteShader(s))}
  }
  buffer(data,location,size,divisor=0) {
    const gl=this.gl,b=this.track('Buffer',gl.createBuffer());gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,data,gl.DYNAMIC_DRAW)
    gl.enableVertexAttribArray(location);gl.vertexAttribPointer(location,size,gl.FLOAT,false,0,0);gl.vertexAttribDivisor(location,divisor);return b
  }
  upload(buffer,data) {const gl=this.gl;gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,data,gl.DYNAMIC_DRAW)}
  setData(d) {
    if(this.dead)return
    const firstData = this.d === null
    this.d=d;this.upload(this.posBuf,d.positions);this.upload(this.radiusBuf,d.radii)
    const positions=new Float32Array(d.edgeCount*6)
    for(let e=0;e<d.edgeCount;e++) {
      positions.set(d.positions.subarray(d.edgePairs[e*2]*3,d.edgePairs[e*2]*3+3),e*6)
      positions.set(d.positions.subarray(d.edgePairs[e*2+1]*3,d.edgePairs[e*2+1]*3+3),e*6+3)
    }
    const arrows=new Float32Array(d.edgeCount)
    for(let e=0;e<d.edgeCount;e++)arrows[e]=edgeAt(d,e)?.tipo==='contiene'?0:1
    this.upload(this.arrowFlagsBuf,arrows)
    this.upload(this.linePosBuf,positions);this.prepareColors();this.setHighlight(this.highlight||null)
    if (firstData) this.fit()
  }
  prepareColors() {
    const d=this.d,style=getComputedStyle(this.canvas)
    const accent=rgba(style.getPropertyValue('--ui-accent').trim(),[1,1,1,1])
    const muted=rgba(style.getPropertyValue('--ui-text-tertiary').trim(),accent)
    this.baseNodeColors=new Float32Array(d.colors)
    this.baseLineColors=new Float32Array(d.edgeCount*8)
    this.edgeKeys=new Array(d.edgeCount)
    for(let i=0;i<d.nodeCount;i++)this.baseNodeColors.set(rgba(this.callbacks.nodeColor?.(d.nodes[i]),[...d.colors.subarray(i*4,i*4+4)]),i*4)
    for(let e=0;e<d.edgeCount;e++) {
      const link=edgeAt(d,e),color=rgba(this.callbacks.edgeColor?.(link),muted)
      this.edgeKeys[e]=link?`${link.source}|${link.target}|${link.tipo}`:''
      this.baseLineColors.set(color,e*8);this.baseLineColors.set(color,e*8+4)
    }
  }
  setHighlight(highlight) {
    this.highlight=highlight
    const d=this.d;if(!d||this.dead)return
    const colors=new Float32Array(this.baseNodeColors),lineColors=new Float32Array(this.baseLineColors)
    if(highlight)for(let i=0;i<d.nodeCount;i++)if(!highlight.ids.has(d.ids[i]))colors[i*4+3]*=.12
    for(let e=0;e<d.edgeCount;e++) {
      const alpha=highlight?(highlight.links.has(this.edgeKeys[e])?1:.05):.45
      lineColors[e*8+3]*=alpha;lineColors[e*8+7]*=alpha
    }
    this.upload(this.colorBuf,colors);this.upload(this.lineColorBuf,lineColors);this.requestDraw()
  }
  matrices() {
    const c=this.camera,t=c.target,cp=Math.cos(c.pitch)
    mat4LookAt(this.view,[t[0]+c.dist*cp*Math.sin(c.yaw),t[1]+c.dist*Math.sin(c.pitch),t[2]+c.dist*cp*Math.cos(c.yaw)],t,[0,1,0])
    mat4Perspective(this.proj,Math.PI/3,this.width/this.height,Math.max(.01,c.dist*.01),c.dist*100+1000)
  }
  resize() {
    if(this.dead)return
    const rect=this.canvas.getBoundingClientRect(),dpr=Math.min(window.devicePixelRatio||1,2)
    this.width=Math.max(1,rect.width);this.height=Math.max(1,rect.height)
    const width=Math.round(this.width*dpr),height=Math.round(this.height*dpr),gl=this.gl
    this.canvas.width=width;this.canvas.height=height
    gl.bindTexture(gl.TEXTURE_2D,this.pickTexture);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,width,height,0,gl.RGBA,gl.UNSIGNED_BYTE,null)
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST)
    gl.bindRenderbuffer(gl.RENDERBUFFER,this.pickDepth);gl.renderbufferStorage(gl.RENDERBUFFER,gl.DEPTH_COMPONENT24,width,height)
    gl.bindFramebuffer(gl.FRAMEBUFFER,this.pickFbo);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,this.pickTexture,0)
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.RENDERBUFFER,this.pickDepth)
    if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw new Error('Framebuffer WebGL2 incompleto')
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);this.requestDraw()
  }
  uniforms(p) {const gl=this.gl;gl.useProgram(p);gl.uniformMatrix4fv(gl.getUniformLocation(p,'view'),false,this.view);gl.uniformMatrix4fv(gl.getUniformLocation(p,'proj'),false,this.proj)}
  render(picking=false) {
    if(this.dead)return
    const gl=this.gl,d=this.d;this.matrices()
    gl.bindFramebuffer(gl.FRAMEBUFFER,picking?this.pickFbo:null);gl.viewport(0,0,this.canvas.width,this.canvas.height)
    gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);gl.enable(gl.DEPTH_TEST)
    if(picking){gl.disable(gl.BLEND);gl.disable(gl.DITHER)}else{gl.enable(gl.BLEND);gl.enable(gl.DITHER);gl.blendFuncSeparate(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA,gl.ONE,gl.ONE_MINUS_SRC_ALPHA)}
    if(d) {
      if(!picking&&d.edgeCount){
        gl.depthMask(false);this.uniforms(this.lineProgram);gl.bindVertexArray(this.lineVao);gl.drawArrays(gl.LINES,0,d.edgeCount*2)
        this.uniforms(this.arrowProgram);gl.uniform2f(gl.getUniformLocation(this.arrowProgram,'viewport'),this.width,this.height);gl.bindVertexArray(this.arrowVao);gl.drawArraysInstanced(gl.TRIANGLES,0,3,d.edgeCount);gl.depthMask(true)
      }
      this.uniforms(this.nodeProgram);gl.uniform2f(gl.getUniformLocation(this.nodeProgram,'viewport'),this.width,this.height)
      gl.uniform1i(gl.getUniformLocation(this.nodeProgram,'picking'),picking?1:0);gl.bindVertexArray(this.nodeVao)
      gl.drawArraysInstanced(gl.TRIANGLES,0,6,d.nodeCount);gl.bindVertexArray(null)
    }
    this.canvas.dataset.graphiumNodes=String(d?.nodeCount||0)
  }
  requestDraw() {if(!this.frame&&!this.dead)this.frame=requestAnimationFrame(()=>{this.frame=0;this.render()})}
  pick(x,y) {
    if(!this.d||this.dead)return -1
    this.render(true);const pixel=new Uint8Array(4),gl=this.gl
    gl.readPixels(Math.max(0,Math.min(this.canvas.width-1,Math.floor(x*this.canvas.width/this.width))),Math.max(0,Math.min(this.canvas.height-1,Math.floor((this.height-y)*this.canvas.height/this.height))),1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel)
    gl.bindFramebuffer(gl.FRAMEBUFFER,null)
    const id=(pixel[0]|(pixel[1]<<8)|(pixel[2]<<16))-1
    return id>=0&&id<this.d.nodeCount?id:-1
  }
  on(target,type,fn,opts) {target.addEventListener(type,fn,opts);this.listeners.push(()=>target.removeEventListener(type,fn,opts))}
  bindEvents() {
    const canvas=this.canvas
    this.on(canvas,'webglcontextlost',e=>{e.preventDefault();this.callbacks.onError?.('Se perdió el contexto WebGL2. Abre de nuevo la vista.');this.destroy()})
    this.on(canvas,'contextmenu',e=>e.preventDefault())
    this.on(canvas,'pointerdown',e=>{this.callbacks.onCameraInteraction?.();this.drag={x:e.clientX,y:e.clientY,startX:e.clientX,startY:e.clientY,button:e.button,pan:e.shiftKey||e.button===2,id:e.pointerId};canvas.setPointerCapture(e.pointerId)})
    this.on(canvas,'pointermove',e=>{
      if(this.drag) {
        const dx=e.clientX-this.drag.x,dy=e.clientY-this.drag.y,c=this.camera
        if(this.drag.pan){const s=c.dist/this.height;c.target[0]-=dx*s*Math.cos(c.yaw);c.target[2]+=dx*s*Math.sin(c.yaw);c.target[1]+=dy*s}
        else{c.yaw-=dx*.006;c.pitch=Math.max(-1.5,Math.min(1.5,c.pitch+dy*.006))}
        this.drag.x=e.clientX;this.drag.y=e.clientY;this.requestDraw();return
      }
      if(performance.now()-this.lastHover<60)return
      this.lastHover=performance.now();const r=canvas.getBoundingClientRect(),id=this.pick(e.clientX-r.left,e.clientY-r.top)
      if(id!==this.hover){this.hover=id;canvas.style.cursor=id>=0?'pointer':'grab';canvas.title=id>=0?(this.callbacks.nodeLabel?.(this.d.nodes[id])||this.d.nodes[id].label||this.d.ids[id]):'';this.callbacks.onHover?.(id>=0?this.d.ids[id]:null)}
    })
    this.on(canvas,'pointerup',e=>{
      const drag=this.drag;this.drag=null;if(!drag)return
      if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId)
      if(Math.hypot(e.clientX-drag.startX,e.clientY-drag.startY)>4)return
      const r=canvas.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top
      if(drag.button===2){const id=this.pick(x,y);this.callbacks.onNodeContext?.(id>=0?this.d.nodes[id]:null,{clientX:e.clientX,clientY:e.clientY});return}
      if(drag.pan || drag.button!==0)return
      const id=this.pick(x,y)
      if(id>=0)this.callbacks.onNode?.(this.d.nodes[id])
      else if(this.d){const edge=nearestEdge(this.d,x,y,this.view,this.proj,this.width,this.height),link=edgeAt(this.d,edge);if(link)this.callbacks.onEdge?.(link);else this.callbacks.onBackground?.()}
    })
    this.on(canvas,'pointercancel',()=>{this.drag=null})
    this.on(canvas,'pointerleave',()=>{if(!this.drag){this.hover=-1;canvas.title='';this.callbacks.onHover?.(null)}})
    this.on(canvas,'wheel',e=>{e.preventDefault();this.callbacks.onCameraInteraction?.();this.camera.dist=Math.max(4,Math.min(5000000,this.camera.dist*Math.exp(e.deltaY*.001)));this.requestDraw()},{passive:false})
  }
  fit(ids=null) {if(!this.d||this.dead)return;const indices=ids?ids.map(id=>this.d.indexById.get(id)).filter(Number.isInteger):null;if(indices && !indices.length)return;const b=boundsOf(this.d,indices);this.camera.target=b.center;this.camera.dist=b.dist;this.requestDraw()}
  focus(id) {if(!this.d||this.dead)return;const i=this.d.indexById.get(id);if(i===undefined)return;this.camera.target=[...this.d.positions.subarray(i*3,i*3+3)];this.camera.dist=125;this.requestDraw()}
  orbit(){this.camera.yaw+=.008;this.requestDraw()}
  destroy() {
    if(this.dead)return;this.dead=true;cancelAnimationFrame(this.frame);this.resizeObserver?.disconnect();this.listeners.forEach(off=>off())
    const gl=this.gl;gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.bindVertexArray(null)
    for(const [kind,item] of this.resources.reverse())gl[`delete${kind}`](item)
    this.resources=[];this.d=null;this.baseNodeColors=null;this.baseLineColors=null;this.edgeKeys=null
    if (!gl.isContextLost()) gl.getExtension('WEBGL_lose_context')?.loseContext()
  }
}
