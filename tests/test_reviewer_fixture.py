"""The disposable UI server must expose the actual nested reviewer router."""
import importlib.util
from pathlib import Path
from fastapi.testclient import TestClient


def test_ui_fixture_routes_include_reviewer_and_exclude_nif():
    root = Path(__file__).resolve().parents[1]
    spec = importlib.util.spec_from_file_location('reviewer_fixture_contract', root/'scripts/reviewer_e2e_server.py')
    assert spec is not None and spec.loader is not None
    fixture = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(fixture)
    try:
        with TestClient(fixture.app) as client:
            assert client.get('/health').json()['marker'] == 'dike-reviewer-e2e'
            assert client.get('/reviewer/document').status_code == 422
            response = client.get('/reviewer/document', params={'id':fixture.ids['A'], 'case_id':'fixture-contract'})
            assert response.status_code == 200
            assert response.json()['text'].startswith('Ficción jurídica')
            assert client.post('/nif/edit', json={}).status_code == 404
            assert client.get('/grafo/fuentes').status_code == 404
    finally:
        fixture.tmp.cleanup()
