"""Read the bundled sealed corpus in an isolated data root and run native Graphium."""
from pathlib import Path
import base64
import importlib.util
import json
import os
import struct
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]

def load(name,path):
    spec=importlib.util.spec_from_file_location(name,path)
    assert spec is not None and spec.loader is not None
    mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod);return mod

if __name__=='__main__':
    scratch=os.environ.get('TMPDIR')
    if not scratch: raise SystemExit('TMPDIR required for isolated corpus smoke')
    with tempfile.TemporaryDirectory(prefix='dike-graphium-corpus-',dir=scratch) as temp:
        isolated=Path(temp)
        adapter=load('dike_graphium_smoke_adapter',ROOT/'__init__.py')
        setattr(adapter, "_carpeta_de_datos", lambda: isolated)
        api=load('dike_graphium_smoke_api',ROOT/'dashboard/plugin_api.py')
        setattr(api, "_adaptador", lambda: adapter)
        native=load('dike_graphium_smoke_native',ROOT/'dashboard/graphium_engine.py')
        graph=api.grafo_red('corpus')
        start=time.monotonic();result=native.layout(graph);elapsed=time.monotonic()-start
        raw=base64.b64decode(result['gbin_b64'])
        count,edges=struct.unpack_from('<2I',raw,8)
        assert count==len(graph['nodes'])==len(result['node_ids'])
        assert result['node_ids']==[n['id'] for n in graph['nodes']]
        print(json.dumps({'source':'bundled sealed corpus','engine':result['engine'],'nodes':count,'input_edges':len(graph['links']),'binary_edges':edges,'gbin_bytes':len(raw),'layout_encode_seconds':round(elapsed,3),'literal_id_order_preserved':True,'truncated':graph['truncado']}))
