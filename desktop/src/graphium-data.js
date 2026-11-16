// GBIN v1 and camera math adapted from Graphium 0.2.0 (MIT, Copyright 2026 Grizaceo).
// See ../../graphium/LICENSE. No sources, paths, discovery or vault data live here.

// Only the focused graph surface handles these keys; never steal editor input.
export function graphShortcut(event) {
  if(event.defaultPrevented || event.repeat || event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return null
  const target=event.target
  if(target?.isContentEditable || target?.closest?.('input, textarea, select, [role="textbox"], [contenteditable]:not([contenteditable="false"])')) return null
  const key=event.key?.toLowerCase()
  return key==='f'?'search':key==='r'?'reset':key==='e'?'edit':null
}

// A view projection, never deletion from the source or a legal-state mutation.
export function visibleProjection(projection, hidden) {
  if(!hidden.size) return projection
  const nodes=projection.nodes.filter(node=>!hidden.has(node.id))
  const visible=new Set(nodes.map(node=>node.id))
  const id=value=>value && typeof value==='object'?value.id:value
  return {...projection,nodes,links:projection.links.filter(link=>visible.has(id(link.source)) && visible.has(id(link.target)))}
}
export function graphViewProjection(projection, {hidden=new Set(),hiddenKinds=new Set(),onlyKind=null,isolate=null}={}) {
  if(!hidden.size && !hiddenKinds.size && !onlyKind && !isolate)return projection
  let nodes=projection.nodes.filter(n=>!hidden.has(n.id) && !hiddenKinds.has(n.tipo) && (!onlyKind || n.tipo===onlyKind))
  const id=value=>value && typeof value==='object'?value.id:value
  let ids=new Set(nodes.map(n=>n.id))
  let links=projection.links.filter(l=>ids.has(id(l.source)) && ids.has(id(l.target)))
  if(isolate){
    const hops=Math.max(1,Math.min(2,isolate.hops)),keep=new Set(ids.has(isolate.id)?[isolate.id]:[])
    let frontier=new Set(keep)
    for(let hop=0;hop<hops;hop++){
      const next=new Set()
      for(const link of links){const a=id(link.source),b=id(link.target);if(frontier.has(a)&&!keep.has(b))next.add(b);if(frontier.has(b)&&!keep.has(a))next.add(a)}
      for(const n of next)keep.add(n)
      frontier=next
    }
    nodes=nodes.filter(n=>keep.has(n.id));ids=keep
    links=links.filter(l=>ids.has(id(l.source)) && ids.has(id(l.target)))
  }
  return {...projection,nodes,links}
}

export function wireProjection(projection, pool = new Map()) {
  return {
    nodes: projection.nodes.map(n => {
      const node = {id:n.id, tipo:n.tipo === undefined ? 'node' : n.tipo, label:n.label === undefined ? n.id : n.label}
      if(pool.has(n.id)) node.position = pool.get(n.id)
      return node
    }),
    links: projection.links.map(l => ({source:l.source, target:l.target, tipo:l.tipo === undefined ? 'link' : l.tipo, estado:l.estado === undefined ? 'candidata' : l.estado})),
  }
}

export function decodeGbin(raw) {
  if (!(raw instanceof ArrayBuffer) || raw.byteLength < 32) throw new Error('GBIN incompleto')
  const dv = new DataView(raw)
  if (dv.getUint32(0,true)!==0x4e494247 || dv.getUint32(4,true)!==1) throw new Error('Versión GBIN incompatible')
  const nodeCount=dv.getUint32(8,true), edgeCount=dv.getUint32(12,true), footerLen=dv.getUint32(28,true)
  const end=32+nodeCount*28+edgeCount*8+Math.ceil(edgeCount/4)*4
  if(nodeCount>200000 || edgeCount>1000000 || end+footerLen!==raw.byteLength) throw new Error('Tamaño GBIN inválido')
  const positions=new Float32Array(raw,32,nodeCount*3)
  if(!positions.every(Number.isFinite)) throw new Error('Posiciones no finitas')
  const packed=new DataView(raw,32+nodeCount*12,nodeCount*16)
  const radii=new Float32Array(nodeCount), colors=new Float32Array(nodeCount*4)
  for(let i=0;i<nodeCount;i++) {
    const r=packed.getFloat32(i*16+8,true), rgba=packed.getUint32(i*16+12,true)
    if(!Number.isFinite(r) || r<0) throw new Error('Radio inválido')
    radii[i]=Math.min(10,Math.max(3,r))
    colors.set([(rgba>>>24)/255,((rgba>>>16)&255)/255,((rgba>>>8)&255)/255,(rgba&255)/255],i*4)
  }
  const edgePairs=new Uint32Array(raw,32+nodeCount*28,edgeCount*2)
  if(!edgePairs.every(x=>x<nodeCount)) throw new Error('Índice de arista inválido')
  const edgeMeta=new Uint8Array(raw,32+nodeCount*28+edgeCount*8,edgeCount)
  const footer=JSON.parse(new TextDecoder().decode(new Uint8Array(raw,end,footerLen))||'{}')
  return {nodeCount,edgeCount,positions,radii,colors,edgePairs,edgeMeta,footer}
}

export function mapSnapshot(result, projection) {
  if(result.engine!=='graphium-rust') throw new Error('El grafo requiere el motor Rust')
  const bytes=Uint8Array.from(atob(result.gbin_b64),c=>c.charCodeAt(0))
  const decoded=decodeGbin(bytes.buffer), ids=result.node_ids
  const byId=new Map(projection.nodes.map(n=>[n.id,n]))
  if(!Array.isArray(ids) || ids.length!==decoded.nodeCount || new Set(ids).size!==ids.length || ids.some(id=>!byId.has(id)) || byId.size!==ids.length) throw new Error('Mapa de identificadores incompatible')
  const edgeLookup=new Map()
  for(const l of projection.links) {
    const key=JSON.stringify([l.source,l.target,l.tipo === undefined ? 'link' : l.tipo,l.estado === undefined ? 'candidata' : l.estado])
    if(!edgeLookup.has(key)) edgeLookup.set(key,l)
  }
  const d = {...decoded,ids,nodes:ids.map(id=>byId.get(id)),indexById:new Map(ids.map((id,i)=>[id,i])),edgeLookup}
  const renderEdges = Array.from({length:d.edgeCount},(_,e)=>edgeAt(d,e))
  d.renderEdges = renderEdges
  return d
}

export function edgeAt(d,e) {
  if(e<0 || e>=d.edgeCount) return null
  if(d.renderEdges) return d.renderEdges[e]
  const kind=d.footer.edge_kinds?.[d.edgeMeta[e]&63]
  if(typeof kind!=='string') return null
  let pair
  try {pair=JSON.parse(kind)} catch {return null}
  return d.edgeLookup.get(JSON.stringify([d.ids[d.edgePairs[e*2]],d.ids[d.edgePairs[e*2+1]],...pair])) || null
}

export function boundsOf(d, indices=null) {
  const min=[Infinity,Infinity,Infinity], max=[-Infinity,-Infinity,-Infinity]
  const list=indices||Array.from({length:d.nodeCount},(_,i)=>i)
  let count=0
  for(const i of list) {
    if(i<0 || i>=d.nodeCount) continue
    count++
    for(let j=0;j<3;j++) {const v=d.positions[i*3+j]; min[j]=Math.min(min[j],v);max[j]=Math.max(max[j],v)}
  }
  if(!count) return {center:[0,0,0],dist:150}
  return {center:min.map((v,i)=>(v+max[i])/2),dist:Math.max(80,Math.hypot(...min.map((v,i)=>max[i]-v))*1.3)}
}

export function mat4Perspective(out,fovy,aspect,near,far) {
  const f=1/Math.tan(fovy/2);out.fill(0);out[0]=f/aspect;out[5]=f;out[10]=(far+near)/(near-far);out[11]=-1;out[14]=2*far*near/(near-far);return out
}
export function mat4LookAt(out,eye,center,up) {
  let zx=eye[0]-center[0],zy=eye[1]-center[1],zz=eye[2]-center[2]
  let len=Math.hypot(zx,zy,zz)||1;zx/=len;zy/=len;zz/=len
  let xx=up[1]*zz-up[2]*zy,xy=up[2]*zx-up[0]*zz,xz=up[0]*zy-up[1]*zx
  len=Math.hypot(xx,xy,xz)||1;xx/=len;xy/=len;xz/=len
  const yx=zy*xz-zz*xy,yy=zz*xx-zx*xz,yz=zx*xy-zy*xx
  out.set([xx,yx,zx,0,xy,yy,zy,0,xz,yz,zz,0,-(xx*eye[0]+xy*eye[1]+xz*eye[2]),-(yx*eye[0]+yy*eye[1]+yz*eye[2]),-(zx*eye[0]+zy*eye[1]+zz*eye[2]),1]);return out
}
export function projectToCss(x,y,z,v,p,w,h) {
  const vx=v[0]*x+v[4]*y+v[8]*z+v[12],vy=v[1]*x+v[5]*y+v[9]*z+v[13],vz=v[2]*x+v[6]*y+v[10]*z+v[14]
  if(vz>=-1) return null
  const nx=p[0]*vx/-vz,ny=p[5]*vy/-vz
  return {x:(nx*.5+.5)*w,y:(-ny*.5+.5)*h,depth:-vz}
}
export function nearestEdge(d,x,y,v,p,w,h) {
  const points=Array.from({length:d.nodeCount},(_,i)=>projectToCss(...d.positions.subarray(i*3,i*3+3),v,p,w,h))
  let best=-1,bestDist=6
  for(let e=0;e<d.edgeCount;e++) {
    const a=points[d.edgePairs[e*2]],b=points[d.edgePairs[e*2+1]]
    if(!a||!b) continue
    const dx=b.x-a.x,dy=b.y-a.y,len=dx*dx+dy*dy
    const t=len?Math.max(0,Math.min(1,((x-a.x)*dx+(y-a.y)*dy)/len)):0
    const dist=Math.hypot(x-a.x-t*dx,y-a.y-t*dy)
    if(dist<bestDist) {best=e;bestDist=dist}
  }
  return best
}
