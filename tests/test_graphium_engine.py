"""Native Graphium contract. Fixtures are fictitious, no private vault required."""
import base64
import importlib.util
import os
from pathlib import Path
import struct
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('dike_graphium_engine', ROOT / 'dashboard/graphium_engine.py')

class GraphiumContract(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        assert (ROOT / 'dashboard/graphium_engine.py').is_file(), 'Native Graphium adapter is not implemented'
        assert SPEC is not None and SPEC.loader is not None
        cls.engine = importlib.util.module_from_spec(SPEC)
        SPEC.loader.exec_module(cls.engine)

    def graph(self) -> dict:
        return {'nodes': [{'id': 'norma:1', 'tipo':'instrumento', 'label':'Ley de prueba'},
                          {'id': 'norma:1/art:2', 'tipo':'articulo', 'label':'Artículo 2'}],
                'links':[{'source':'norma:1','target':'norma:1/art:2','tipo':'contiene','estado':'verificada_estructura'}]}

    def test_validate_preserves_literal_ids(self):
        graph = self.graph()
        graph['nodes'][0]['id'] = ' norma:1 '
        graph['links'][0]['source'] = ' norma:1 '
        result = self.engine.validate_graph(graph)
        self.assertEqual(result['nodes'][0]['id'], ' norma:1 ')

    def test_route_is_registered(self):
        spec = importlib.util.spec_from_file_location('dike_api_graphium_test', ROOT/'dashboard/plugin_api.py')
        assert spec is not None and spec.loader is not None
        api = importlib.util.module_from_spec(spec); spec.loader.exec_module(api)
        from fastapi import FastAPI
        app=FastAPI();app.include_router(api.router)
        self.assertIn('/grafo/graphium/layout', app.openapi()['paths'])

    def test_http_runtime_cache_does_not_cross_plugin_roots(self):
        import tempfile
        spec = importlib.util.spec_from_file_location('dike_graphium_cache_test', ROOT/'dashboard/plugin_api.py')
        assert spec is not None and spec.loader is not None
        api = importlib.util.module_from_spec(spec); spec.loader.exec_module(api)
        # Two fictional installed versions in one gateway process must keep their own engine.
        with tempfile.TemporaryDirectory(dir=os.environ.get('TMPDIR')) as temp:
            roots = [Path(temp)/'one', Path(temp)/'two']
            for i, root in enumerate(roots):
                (root/'dashboard').mkdir(parents=True)
                (root/'dashboard/graphium_engine.py').write_text('class EngineUnavailable(RuntimeError): pass\ndef layout(body): return {"fixture": '+str(i)+'}\n')
            results=[]
            for root in roots:
                setattr(api, "_RAIZ", root)
                results.append(api.grafo_graphium_layout({'nodes':[],'links':[]}))
        self.assertEqual(results,[{'fixture':0},{'fixture':1}])

    def test_concurrent_first_requests_share_one_native_slot(self):
        import tempfile
        from concurrent.futures import ThreadPoolExecutor
        spec = importlib.util.spec_from_file_location('dike_graphium_startup_test', ROOT/'dashboard/plugin_api.py')
        assert spec is not None and spec.loader is not None
        api = importlib.util.module_from_spec(spec); spec.loader.exec_module(api)
        with tempfile.TemporaryDirectory(dir=os.environ.get('TMPDIR')) as temp:
            root=Path(temp);(root/'dashboard').mkdir()
            (root/'dashboard/graphium_engine.py').write_text('import time\ntime.sleep(.1)\nTOKEN=object()\nclass EngineUnavailable(RuntimeError): pass\ndef layout(body): return id(TOKEN)\n')
            setattr(api,'_RAIZ',root)
            with ThreadPoolExecutor(max_workers=2) as pool:
                a=pool.submit(api.grafo_graphium_layout,{'nodes':[],'links':[]})
                b=pool.submit(api.grafo_graphium_layout,{'nodes':[],'links':[]})
                self.assertEqual(a.result(),b.result())

    def test_http_body_limit_precedes_parsing_and_native_execution(self):
        from fastapi import FastAPI
        from fastapi.testclient import TestClient
        spec = importlib.util.spec_from_file_location('dike_graphium_size_test', ROOT/'dashboard/plugin_api.py')
        assert spec is not None and spec.loader is not None
        api = importlib.util.module_from_spec(spec); spec.loader.exec_module(api)
        app=FastAPI();app.include_router(api.router)
        with patch.object(api,'_GRAPH_MAX_BODY_BYTES',128,create=True), patch.dict(os.environ,{'DIKE_GRAPHIUM_BINARY':str(ROOT/'absent-native')}), TestClient(app) as client:
            positive=client.post('/grafo/graphium/layout',json={'nodes':[],'links':[]})
            self.assertEqual(positive.status_code,503)  # admitted, then explicit native absence
            declared=client.post('/grafo/graphium/layout',content=b'{broken',headers={'content-length':'129','content-type':'application/json'})
            self.assertEqual(declared.status_code,413)  # before even attempting JSON parse
            chunked=client.post('/grafo/graphium/layout',content=iter([b' '*80,b' '*80]),headers={'content-type':'application/json'})
            self.assertEqual(chunked.status_code,413)

    def test_http_contract_rejects_bad_graph(self):
        from fastapi import FastAPI
        from fastapi.testclient import TestClient
        spec = importlib.util.spec_from_file_location('dike_graphium_api_http', ROOT/'dashboard/plugin_api.py')
        assert spec is not None and spec.loader is not None
        api = importlib.util.module_from_spec(spec); spec.loader.exec_module(api)
        app = FastAPI(); app.include_router(api.router)
        with TestClient(app) as client:
            result = client.post('/grafo/graphium/layout', json={'nodes':[], 'links':[{'source':'x','target':'y'}]})
        self.assertEqual(result.status_code, 400)

    def test_empty_graph_is_valid(self):
        self.assertEqual(self.engine.validate_graph({'nodes':[], 'links':[]}), {'nodes':[], 'links':[]})

    def test_input_caps_and_kind_limits(self):
        with patch.object(self.engine, 'MAX_NODES', 1):
            with self.assertRaises(ValueError): self.engine.validate_graph(self.graph())
        with patch.object(self.engine, 'MAX_BYTES', 1):
            with self.assertRaises(ValueError): self.engine.validate_graph(self.graph())
        graph = {'nodes':[{'id':str(i),'tipo':str(i)} for i in range(255)], 'links':[]}
        with self.assertRaises(ValueError): self.engine.validate_graph(graph)

    @unittest.skipUnless(os.environ.get('DIKE_TEST_NATIVE') == '1', 'native-only smoke')
    def test_native_status_layers_never_promote(self):
        graph = self.graph()
        graph['links'] += [{'source':'norma:1', 'target':'norma:1/art:2','tipo':'cita','estado':s}
                           for s in ('candidata','aprobada')]
        result = self.engine.layout(graph)
        raw = base64.b64decode(result['gbin_b64'])
        _, _, n, e = struct.unpack_from('<4I', raw)
        self.assertEqual(e, 3)
        offset = 32 + n * 28 + e * 8
        layers = [x >> 6 for x in raw[offset:offset+e]]
        self.assertEqual(sorted(layers), [1,1,2])
        for i in range(n):
            packed = struct.unpack_from('<I',raw,32+n*12+i*16)[0]
            self.assertEqual((packed >> 8) & 3, 1)

    @unittest.skipUnless(os.environ.get('DIKE_TEST_NATIVE') == '1', 'native position continuity')
    def test_native_expansion_preserves_positions(self):
        graph=self.graph()
        graph['nodes'][0]['position']=[50.,60.,70.]
        graph['nodes'][1]['position']=[80.,90.,100.]
        graph['nodes'].append({'id':'unit:1','tipo':'unidad'})
        graph['links'].append({'source':'norma:1/art:2','target':'unit:1','tipo':'contiene'})
        result=self.engine.layout(graph)
        raw=base64.b64decode(result['gbin_b64'])
        positions=struct.unpack_from('<9f',raw,32)
        self.assertEqual(positions[:6],(50.,60.,70.,80.,90.,100.))
        distance=sum((a-b)**2 for a,b in zip(positions[6:],(80,90,100)))**.5
        self.assertGreaterEqual(distance,20)
        self.assertLess(distance,500)

    @unittest.skipUnless(os.environ.get('DIKE_TEST_NATIVE') == '1', 'native kind bounds')
    def test_native_rejects_edge_kind_overflow_before_interning(self):
        import subprocess,json
        graph=self.graph()
        graph=self.engine.validate_graph(graph)
        graph['links']=[{'source':'norma:1','target':'norma:1/art:2','tipo':'cita','estado':str(i)} for i in range(64)]
        proc=subprocess.run([str(self.engine.binary_path())],input=json.dumps(graph).encode(),capture_output=True,timeout=10)
        self.assertNotEqual(proc.returncode,0)

    def test_http_busy_guard_runs_before_json_parse_and_releases(self):
        from fastapi import FastAPI
        from fastapi.testclient import TestClient
        spec=importlib.util.spec_from_file_location('dike_graphium_busy_test',ROOT/'dashboard/plugin_api.py')
        assert spec is not None and spec.loader is not None
        api=importlib.util.module_from_spec(spec);spec.loader.exec_module(api)
        app=FastAPI();app.include_router(api.router)
        with TestClient(app) as client:
            self.assertTrue(api._GRAPH_HTTP_SLOTS.acquire(blocking=False))
            try:
                busy=client.post('/grafo/graphium/layout',content=b'not json',headers={'content-type':'application/json'})
                self.assertEqual(busy.status_code,503)
                self.assertEqual(busy.headers['retry-after'],'1')
            finally: api._GRAPH_HTTP_SLOTS.release()
            admitted=client.post('/grafo/graphium/layout',content=b'not json',headers={'content-type':'application/json'})
            self.assertEqual(admitted.status_code,422)

    def test_edge_cap_and_invalid_preset_are_explicit(self):
        with patch.object(self.engine,'MAX_EDGES',0):
            with self.assertRaises(ValueError):self.engine.validate_graph(self.graph())
        for position in ([float('nan'),0,0],[10**400,0,0],[True,0,0],[1,2]):
            graph=self.graph();graph['nodes'][0]['position']=position
            with self.assertRaises(ValueError):self.engine.validate_graph(graph)

    def test_slow_body_times_out_and_releases_http_admission(self):
        import asyncio,httpx
        from fastapi import FastAPI
        spec=importlib.util.spec_from_file_location('dike_graphium_slow_test',ROOT/'dashboard/plugin_api.py')
        assert spec is not None and spec.loader is not None
        api=importlib.util.module_from_spec(spec);spec.loader.exec_module(api)
        app=FastAPI();app.include_router(api.router)
        async def chunks():
            yield b'{'
            await asyncio.sleep(.1)
            yield b'"nodes":[],"links":[]}'
        async def probe():
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://fixture') as client:
                timed=await client.post('/grafo/graphium/layout',content=chunks(),headers={'content-type':'application/json'})
                self.assertEqual(timed.status_code,408)
                admitted=await client.post('/grafo/graphium/layout',content=b'bad',headers={'content-type':'application/json'})
                self.assertEqual(admitted.status_code,422)
        with patch.object(api,'_GRAPH_BODY_TIMEOUT',.02,create=True):asyncio.run(probe())

    def test_json_complexity_is_bounded_before_object_allocation(self):
        from fastapi import FastAPI
        from fastapi.testclient import TestClient
        spec=importlib.util.spec_from_file_location('dike_graphium_complexity_test',ROOT/'dashboard/plugin_api.py')
        assert spec is not None and spec.loader is not None
        api=importlib.util.module_from_spec(spec);spec.loader.exec_module(api)
        app=FastAPI();app.include_router(api.router)
        with patch.object(api,'_GRAPH_MAX_STRUCTURES',5,create=True),TestClient(app) as client:
            too_many=client.post('/grafo/graphium/layout',json={'nodes':[{} for _ in range(6)],'links':[]})
            self.assertEqual(too_many.status_code,413)
            admitted=client.post('/grafo/graphium/layout',json={'nodes':[{}],'links':[]})
            self.assertEqual(admitted.status_code,400)

    def test_complexity_scan_runs_outside_the_http_event_loop(self):
        import asyncio, httpx, threading
        from fastapi import FastAPI
        spec=importlib.util.spec_from_file_location('dike_graphium_thread_test',ROOT/'dashboard/plugin_api.py')
        assert spec is not None and spec.loader is not None
        api=importlib.util.module_from_spec(spec);spec.loader.exec_module(api)
        app=FastAPI();app.include_router(api.router)
        original=api._graph_json_complexity_ok
        scanner_threads=[]
        def observed(raw):
            scanner_threads.append(threading.get_ident())
            return original(raw)
        async def probe():
            loop_thread=threading.get_ident()
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://fixture') as client:
                # Positive preflight continues to normal graph validation (400).
                admitted=await client.post('/grafo/graphium/layout',json={'nodes':[{}],'links':[]})
                self.assertEqual(admitted.status_code,400)
                # Negative preflight still rejects before object parsing (413).
                with patch.object(api,'_GRAPH_MAX_STRUCTURES',2):
                    denied=await client.post('/grafo/graphium/layout',json={'nodes':[{}],'links':[]})
                self.assertEqual(denied.status_code,413)
                self.assertEqual(len(scanner_threads),2)
                self.assertTrue(all(t != loop_thread for t in scanner_threads),
                                'lexical scanner blocked the HTTP event-loop thread')
        with patch.object(api,'_graph_json_complexity_ok',side_effect=observed):
            asyncio.run(probe())

    def test_cancelled_scan_keeps_admission_until_worker_finishes(self):
        import asyncio, httpx, threading
        from fastapi import FastAPI
        spec=importlib.util.spec_from_file_location('dike_graphium_cancel_test',ROOT/'dashboard/plugin_api.py')
        assert spec is not None and spec.loader is not None
        api=importlib.util.module_from_spec(spec);spec.loader.exec_module(api)
        app=FastAPI();app.include_router(api.router)
        @app.get('/probe')
        async def responsive(): return {'ok':True}
        entered=threading.Event();release=threading.Event();finished=threading.Event()
        original=api._graph_json_complexity_ok
        def held_scan(raw):
            if entered.is_set(): return original(raw)
            entered.set()
            try:
                if not release.wait(3): raise TimeoutError('test did not release scanner')
                return original(raw)
            finally: finished.set()
        async def probe():
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://fixture') as client:
                task=asyncio.create_task(client.post('/grafo/graphium/layout',json={'nodes':[{}],'links':[]}))
                try:
                    self.assertTrue(await asyncio.to_thread(entered.wait,1))
                    heartbeat=await asyncio.wait_for(client.get('/probe'),1)
                    self.assertEqual(heartbeat.status_code,200)
                    task.cancel()
                    with self.assertRaises(asyncio.CancelledError): await task
                    busy=await client.post('/grafo/graphium/layout',content=b'bad')
                    self.assertEqual(busy.status_code,503,'cancelled worker released admission too soon')
                    release.set()
                    self.assertTrue(await asyncio.to_thread(finished.wait,1))
                    for _ in range(100):
                        if api._GRAPH_HTTP_SLOTS.acquire(blocking=False):
                            api._GRAPH_HTTP_SLOTS.release()
                            break
                        await asyncio.sleep(.01)
                    else: self.fail('worker completed without releasing admission')
                    admitted=await client.post('/grafo/graphium/layout',content=b'bad',headers={'content-type':'application/json'})
                    self.assertEqual(admitted.status_code,422)
                finally:
                    release.set()
                    if not task.done():
                        task.cancel()
                        try: await task
                        except asyncio.CancelledError: pass
        with patch.object(api,'_graph_json_complexity_ok',side_effect=held_scan):
            asyncio.run(probe())

    def test_duplicate_ids_rejected(self):
        graph = self.graph(); graph['nodes'].append(graph['nodes'][0])
        with self.assertRaises(ValueError): self.engine.validate_graph(graph)

    def test_unknown_endpoint_rejected(self):
        graph = self.graph(); graph['links'][0]['target'] = 'unknown'
        with self.assertRaises(ValueError): self.engine.validate_graph(graph)

    def test_no_default_private_binary_or_vault(self):
        with patch.dict(os.environ, {}, clear=True):
            binary = self.engine.binary_path()
        self.assertTrue(binary.is_relative_to(ROOT))
        self.assertEqual(binary.parent, ROOT / 'graphium' / 'bin')

    def test_missing_engine_explicit_no_fallback(self):
        with patch.object(self.engine, 'binary_path', return_value=ROOT/'absent-native-engine'):
            with self.assertRaises(self.engine.EngineUnavailable): self.engine.layout(self.graph())

    @unittest.skipUnless(os.environ.get('DIKE_TEST_NATIVE') == '1', 'build native engine and set DIKE_TEST_NATIVE=1')
    def test_real_native_binary_roundtrip(self):
        result = self.engine.layout(self.graph())
        raw = base64.b64decode(result['gbin_b64'], validate=True)
        self.assertEqual(result['engine'], 'graphium-rust')
        self.assertEqual(result['node_ids'], ['norma:1','norma:1/art:2'])
        magic, version, nodes, edges = struct.unpack_from('<4I', raw)
        self.assertEqual((magic,version,nodes,edges),(0x4e494247,1,2,1))
        self.assertTrue(all(abs(x)<1e12 for x in struct.unpack_from('<6f',raw,32)))

if __name__ == '__main__': unittest.main()
