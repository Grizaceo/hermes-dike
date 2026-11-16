"""Loopback-only disposable reviewer contract fixture, not an installed host."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import tempfile
from types import SimpleNamespace
from fastapi import FastAPI
from fastapi.responses import FileResponse, HTMLResponse
import uvicorn

ROOT=Path(__file__).resolve().parents[1]
# Fixture state never uses the real profile or vault.
tmp=tempfile.TemporaryDirectory(prefix='reviewer-ui-')
base=Path(tmp.name);data=base/'data';data.mkdir();docs=base/'documents';docs.mkdir()
spec=importlib.util.spec_from_file_location('reviewer_fixture_api',ROOT/'dashboard/plugin_api.py')
api=importlib.util.module_from_spec(spec);spec.loader.exec_module(api)
ids={}
for key,text in [('A','Ficción jurídica 😀\r\nEl café e\u0301 se entregó.\r\nSin valor normativo.'),('B','Documento B ficticio.\nNo mezclar documentos.'),('C','Documento C ficticio no aprobado: no exponer su cuerpo.')]:
    name=key+'.md';(docs/name).write_bytes(text.encode());ids[key]=api._sources()._id(name)
cfg={'vault':{'enabled':True,'root':str(docs),'approved_documents':{ids[k]:{'anonymized':True,'sha256':hashlib.sha256((docs/(k+'.md')).read_bytes()).hexdigest()} for k in ids if k != 'C'}}}
(data/'graph-sources.json').write_text(json.dumps(cfg))
api._adaptador=lambda:SimpleNamespace(_carpeta_de_datos=lambda:data,_LIMITE_TEXTO=2_000_000,_limpio_panel=lambda texto:str(texto)[:400])
api._panel=lambda *a,**kw:(_ for _ in ()).throw(AssertionError('No NIF engine access in fixture'))
app=FastAPI()
# Include the nested router explicitly: newer FastAPI defers include_router,
# so filtering parent .routes by .path silently discards nested routers.
# This preserves production APIRoute guards without exposing unrelated APIs.
app.include_router(api._reviewer_router)
for route in api.router.routes:
    if getattr(route,'path','') in {'/grafo/vault/texto','/escrito'}:app.router.routes.append(route)

@app.get('/health')
def health():return {'marker':'dike-reviewer-e2e'}
@app.get('/fixture')
def fixture():return ids
@app.get('/fixture.js')
def bundle():return FileResponse(ROOT/'.workshop/reviewer-fixture.js',media_type='text/javascript')
@app.get('/tab-fixture.js')
def tab_bundle():return FileResponse(ROOT/'.workshop/reviewer-tab-fixture.js',media_type='text/javascript')
@app.get('/tab')
def tab_index():return HTMLResponse('''<!doctype html><html><body style="margin:8px;font-family:system-ui"><div id="root"></div><script type="module" src="/tab-fixture.js"></script></body></html>''')
@app.get('/grafo/red')
def tab_inventory(fuente: str = 'vault'):
    from fastapi import HTTPException
    if fuente != 'vault':raise HTTPException(400, 'Fixture only supports vault')
    return api.grafo_red('vault')
@app.get('/')
def index():return HTMLResponse('''<!doctype html><html><body style="margin:8px;font-family:system-ui"><div id="reader"></div><button id="consume">Abrir escrito (puente real)</button><div id="writer"></div><script type="module" src="/fixture.js"></script></body></html>''')
if __name__=='__main__':uvicorn.run(app,host='127.0.0.1',port=int(os.environ.get('REVIEWER_TEST_PORT','8877')),log_level='warning')
