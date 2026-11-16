"""Fictitious fixtures only: no private document bodies in these tests."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]

class SourcesContract(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.home = Path(self.tmp.name)
        self.data = self.home / 'data'
        self.data.mkdir()
        self.vault = self.home / 'vault'
        self.vault.mkdir()

    def module(self):
        path = ROOT / 'dashboard/graph_sources.py'
        self.assertTrue(path.is_file(), 'profile-owned source connector must exist')
        spec = importlib.util.spec_from_file_location('dike_source_contract', path)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        return mod

    def configure(self):
        (self.data/'graph-sources.json').write_text(json.dumps({'vault':{'root':str(self.vault),'enabled':True}}))

    def test_disabled_by_default_without_discovery(self):
        mod = self.module()
        self.assertFalse(mod.available(self.data))
        with self.assertRaises(ValueError): mod.snapshot(self.data)

    def test_complete_tree_is_metadata_only_documentary_and_ignores_symlinks(self):
        mod = self.module()
        (self.vault/'Laboral').mkdir()
        (self.vault/'Laboral/a.md').write_text('SENSITIVE FIXTURE BODY MUST NEVER BE READ')
        (self.vault/'b.md').write_text('another private fixture')
        (self.vault/'escape.md').symlink_to(self.vault/'b.md')
        self.configure()
        graph = mod.snapshot(self.data)
        self.assertEqual(graph['conteos']['documentos'], 2)
        self.assertFalse(graph['truncado'])
        self.assertNotIn('SENSITIVE', json.dumps(graph))
        self.assertTrue(all(n['authority'] == 'documental' for n in graph['nodes']))
        ids = {n['id'] for n in graph['nodes']}
        self.assertTrue(all(l['source'] in ids and l['target'] in ids for l in graph['links']))
        self.assertTrue(all(l['estado']=='estructural' for l in graph['links']))
        doc = next(n for n in graph['nodes'] if n['tipo']=='documento')
        self.assertEqual(mod.node(self.data, doc['id'])['id'], doc['id'])
        with self.assertRaises(PermissionError): mod.read_source(self.data, doc['id'])

    def test_notes_edit_only_sidecar_and_reject_stale_write(self):
        mod = self.module()
        path = self.vault/'public.md'
        path.write_text('ORIGINAL')
        self.configure()
        graph = mod.snapshot(self.data)
        doc = next(n for n in graph['nodes'] if n['tipo']=='documento')
        before = mod.read_note(self.data, 'vault', doc['id'])
        saved = mod.write_note(self.data, 'vault', doc['id'], 'MY NOTE', before['version'])
        self.assertEqual(mod.read_note(self.data, 'vault', doc['id'])['content'], 'MY NOTE')
        self.assertNotEqual(before['version'], saved['version'])
        self.assertEqual(path.read_text(), 'ORIGINAL')
        with self.assertRaises(FileExistsError):
            mod.write_note(self.data, 'vault', doc['id'], 'STALE', before['version'])
        with self.assertRaises(ValueError): mod.read_note(self.data, '../../escape', doc['id'])
        with self.assertRaises(ValueError): mod.read_note(self.data, 'vault', '../../escape')

    def test_http_routes_expose_vault_and_notes_but_not_unapproved_text(self):
        from fastapi import FastAPI
        from fastapi.testclient import TestClient
        from types import SimpleNamespace
        path = ROOT/'dashboard/plugin_api.py'
        spec = importlib.util.spec_from_file_location('source_api_contract',path)
        assert spec and spec.loader
        api = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(api)
        mod = self.module()
        api._sources = lambda: mod
        api._adaptador = lambda: SimpleNamespace(_carpeta_de_datos=lambda: self.data, _limpio_panel=lambda texto: str(texto)[:400])
        (self.vault/'a.md').write_text('NEVER EXPOSE')
        self.configure()
        app = FastAPI()
        app.include_router(api.router)
        with TestClient(app) as client:
            graph = client.get('/grafo/red?fuente=vault')
            self.assertEqual(graph.status_code,200)
            ident = next(n['id'] for n in graph.json()['nodes'] if n['tipo']=='documento')
            layout = client.post('/grafo/vault/layout',json={'ids':[n['id'] for n in graph.json()['nodes']], 'positions':{}})
            self.assertEqual(layout.status_code,200)
            self.assertEqual(layout.json()['engine'],'graphium-rust')
            self.assertEqual(client.post('/grafo/vault/layout',json={'ids':['missing'],'positions':{}}).status_code,400)
            self.assertEqual(client.get('/grafo/vault/texto',params={'id':ident}).status_code,403)
            old = client.get('/grafo/nota',params={'fuente':'vault','id':ident}).json()
            result = client.post('/grafo/nota',json={'fuente':'vault','id':ident,'content':'MY NOTE','version':old['version']})
            self.assertEqual(result.status_code,200)
            self.assertEqual(client.get('/grafo/nota',params={'fuente':'vault','id':ident}).json()['content'],'MY NOTE')
            self.assertEqual(client.post('/grafo/nota',json={'fuente':'vault','id':ident,'content':'stale','version':old['version']}).status_code,409)

    def test_approved_source_read_is_hash_bound_and_never_grants_write(self):
        import hashlib
        mod = self.module()
        path = self.vault/'approved.md'
        path.write_text('ANONYMIZED FICTITIOUS TEXT')
        self.configure()
        ident = next(n['id'] for n in mod.snapshot(self.data)['nodes'] if n['tipo']=='documento')
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        (self.data/'graph-sources.json').write_text(json.dumps({'vault':{'root':str(self.vault),'enabled':True,'approved_documents':{ident:{'anonymized':True,'sha256':digest}}}}))
        allowed = mod.read_source(self.data,ident)
        self.assertTrue(allowed['read_only'])
        self.assertEqual(allowed['content'],'ANONYMIZED FICTITIOUS TEXT')
        path.write_text('CHANGED AFTER APPROVAL')
        with self.assertRaises(PermissionError): mod.read_source(self.data,ident)

    def test_unreadable_subtree_fails_instead_of_claiming_complete_inventory(self):
        mod = self.module()
        self.configure()
        blocked = self.vault/'restricted'
        blocked.mkdir()
        (blocked/'unread.md').write_text('FICTITIOUS')
        blocked.chmod(0)
        self.addCleanup(lambda: blocked.chmod(0o700))
        with self.assertRaises(ValueError): mod.snapshot(self.data)

    def test_invalid_source_shape_is_rejected_without_server_error(self):
        from fastapi import FastAPI
        from fastapi.testclient import TestClient
        path=ROOT/'dashboard/plugin_api.py'
        spec=importlib.util.spec_from_file_location('source_invalid_contract',path)
        assert spec and spec.loader
        api=importlib.util.module_from_spec(spec)
        spec.loader.exec_module(api)
        app=FastAPI()
        app.include_router(api.router)
        with TestClient(app,raise_server_exceptions=False) as client:
            response=client.post('/grafo/nota',json={'fuente':[],'id':'x','content':'FICTITIOUS','version':'x'})
            self.assertEqual(response.status_code,400)

    def test_one_profile_does_not_inherit_another_profiles_source(self):
        mod = self.module()
        self.configure()
        other = self.home/'other'
        other.mkdir()
        self.assertFalse(mod.available(other))
        with self.assertRaises(ValueError): mod.snapshot(other)

if __name__ == '__main__': unittest.main()
