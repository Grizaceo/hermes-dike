// Observatory chrome inspired by Graphium; local scope, no host theme mutation.
export function graphNodeIndex(nodes,expanded,visible=[]) {
  const index=new Map(nodes.map(n=>[n.id,n]))
  for(const entry of expanded.values())for(const n of entry.nodes||[])index.set(n.id,n)
  for(const n of visible)index.set(n.id,n)
  return index
}
export const graphWorkspaceCSS=`
[data-graph-workspace]{--graph-panel:var(--ui-bg-elevated,Canvas);--graph-line:var(--ui-stroke-secondary,ButtonBorder);color:var(--ui-text-primary,CanvasText);font-size:12px;font-family:var(--font-sans,ui-sans-serif,system-ui,sans-serif);isolation:isolate;container-type:inline-size;container-name:dike-graph}
[data-graph-workspace] [data-graph-card]{border:1px solid var(--graph-line);border-radius:12px;padding:12px;display:flex;flex-direction:column;gap:12px;background:var(--ui-bg-editor,Canvas)}
[data-graph-workspace] [data-graph-heading]{display:flex;flex-wrap:wrap;align-items:center;gap:10px;justify-content:space-between}
[data-graph-workspace] [data-graph-layout]{display:grid;grid-template-columns:minmax(0,1fr) 280px;gap:12px;min-width:0;align-items:start}
[data-graph-workspace] [data-graph-categories]{display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:0 0 10px}
[data-graph-workspace] [data-graph-categories]>span{font-size:10px}
[data-graph-workspace] [data-graph-category]{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--graph-line);border-radius:999px;padding:4px 9px;font-size:11px;cursor:pointer;background:var(--graph-panel);color:inherit}
[data-graph-workspace] [data-graph-category][aria-pressed=false]{opacity:.42}
[data-graph-workspace] [data-graph-category] i{width:7px;height:7px;border-radius:50%;display:inline-block;background:var(--kind-color)}
[data-graph-workspace] [data-graph-tools]{display:flex;align-items:center;flex-wrap:wrap;gap:8px;flex-basis:100%;padding-top:7px;border-top:1px solid var(--graph-line)}
[data-graph-workspace] [data-graph-tools] button,[data-graph-workspace] [data-inspector-actions] button{padding:5px 9px;border:1px solid var(--graph-line);border-radius:6px;background:var(--graph-panel);color:inherit;font-size:11px;cursor:pointer}
[data-graph-workspace] [data-graph-inspector]{display:flex;flex-direction:column;gap:10px;min-width:0;max-height:76vh;overflow:auto;padding:10px;border:1px solid var(--graph-line);border-radius:10px;background:var(--graph-panel)}
[data-graph-workspace] [data-graph-inspector] input,[data-graph-workspace] [data-graph-inspector] select{min-width:0;padding:6px 8px;border:1px solid var(--graph-line);border-radius:6px;background:var(--ui-bg-editor,Canvas);color:inherit;font-size:11px}
[data-graph-workspace] [data-inspector-actions]{display:flex;gap:6px;flex-wrap:wrap}
[data-graph-workspace] [data-graph-inspector-title]{font-size:10px;text-transform:uppercase;letter-spacing:.12em;color:var(--ui-text-tertiary,GrayText)}
@container dike-graph (max-width:980px){[data-graph-layout]{grid-template-columns:minmax(0,1fr)!important}[data-graph-inspector]{max-height:360px!important}[data-graphium-viewport]>div:first-of-type{height:44vh!important;min-height:300px!important}}
@media(max-width:980px){[data-graph-workspace] [data-graphium-viewport]>div:first-of-type{height:44vh!important;min-height:300px!important}[data-graph-workspace] [data-graph-layout]{grid-template-columns:minmax(0,1fr)}[data-graph-workspace] [data-graph-inspector]{max-height:360px}}
`
