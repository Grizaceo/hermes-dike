"""Isolated Graphium UI contract server; never use as a production gateway."""
import importlib.util
from pathlib import Path
from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
import uvicorn

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('dike_graphium_e2e_api', ROOT/'dashboard/plugin_api.py')
assert spec is not None and spec.loader is not None
api = importlib.util.module_from_spec(spec)
spec.loader.exec_module(api)
app = FastAPI()
# Mount only the layout route; no operational case/data surfaces are exposed.
for route in api.router.routes:
    if route.path == '/grafo/graphium/layout':
        app.router.routes.append(route)
app.mount('/src', StaticFiles(directory=ROOT/'desktop/src'), name='source')

@app.get('/health')
def health(): return {'marker':'dike-graphium-e2e'}

@app.get('/')
def page(): return FileResponse(ROOT/'desktop/test/graphium-e2e.html')

@app.get('/react')
def react_page(): return FileResponse(ROOT/'desktop/test/graphium-react.html')

@app.get('/react-fixture.js')
def react_fixture(): return FileResponse(ROOT/'.workshop/graphium-react-fixture.js', media_type='text/javascript')

if __name__ == '__main__':
    uvicorn.run(app, host='127.0.0.1', port=8876, log_level='warning')
