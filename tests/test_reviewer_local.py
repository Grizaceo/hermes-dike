"""Documentos que la persona agrega desde su equipo al revisor de pasajes."""
import base64
import hashlib
import importlib.util
import io
import json
import os
import stat
import zipfile
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
TEXTO = 'Contrato ficticio 😀\r\nEl café e\u0301 llegó.\nFin.'


def b64(raw):
    return base64.b64encode(raw).decode()


def docx(parrafos):
    cuerpo = ''.join(f'<w:p><w:r><w:t>{p}</w:t></w:r></w:p>' for p in parrafos)
    xml = ('<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/'
           f'wordprocessingml/2006/main"><w:body>{cuerpo}</w:body></w:document>')
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w') as z:
        z.writestr('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>')
        z.writestr('word/document.xml', xml)
    return buf.getvalue()


@pytest.fixture
def setup(tmp_path):
    spec = importlib.util.spec_from_file_location('reviewer_local_test', ROOT / 'dashboard/plugin_api.py')
    api = importlib.util.module_from_spec(spec); spec.loader.exec_module(api)
    data = tmp_path / 'data'; data.mkdir()
    api._adaptador = lambda: SimpleNamespace(_carpeta_de_datos=lambda: data,
                                             _limpio_panel=lambda texto: str(texto)[:400])
    api._panel = lambda *a, **k: (_ for _ in ()).throw(AssertionError('NIF/engine must not be invoked'))
    api._sources = lambda: (_ for _ in ()).throw(AssertionError('la vault no se consulta para un documento local'))
    app = FastAPI(); app.include_router(api.router)
    return TestClient(app), api, data


def agregar(client, nombre, raw):
    return client.post('/reviewer/local', json={'name': nombre, 'data_b64': b64(raw)})


def test_agregar_listar_abrir_anotar_exportar(setup):
    client, api, data = setup
    r = agregar(client, '/home/alguien/Contrato Pérez.md', TEXTO.encode())
    assert r.status_code == 200, r.text
    meta = r.json()
    sha = hashlib.sha256(TEXTO.encode()).hexdigest()
    assert meta == {'id': 'l:' + sha[:32], 'label': 'Contrato Pérez.md', 'sha256': sha,
                    'bytes': len(TEXTO.encode()), 'added_at': meta['added_at']}
    listado = client.get('/reviewer/local').json()
    assert [d['id'] for d in listado['documents']] == [meta['id']] and listado['unreadable'] == 0
    assert listado['types'] == ['.md', '.txt', '.docx']
    # Texto exacto: CRLF y combinaciones se conservan, sin normalizar.
    d = client.get('/reviewer/document', params={'id': meta['id'], 'case_id': 'caso-a', 'source': 'local'}).json()
    assert d['text'] == TEXTO and d['sha256'] == sha and d['source'] == 'local'
    body = {'id': meta['id'], 'source': 'local', 'case_id': 'caso-a', 'source_sha256': sha,
            'annotation': {'start_offset': 0, 'end_offset': 8, 'text': TEXTO[:8], 'labels': ['hecho_relevante'],
                           'author': 'human:test', 'version': 0}}
    a = client.post('/reviewer/annotation', json=body)
    assert a.status_code == 200, a.text
    assert a.json()['locator'] == f"local:{meta['id']}#cp=0:8"
    exp = client.post('/reviewer/export', json={'id': meta['id'], 'source': 'local', 'case_id': 'caso-a',
                                                'source_sha256': sha, 'annotation_id': a.json()['annotation_id']})
    assert exp.status_code == 200, exp.text
    assert exp.json()['evidence_ref'] == {'source_id': meta['id'], 'locator': a.json()['locator'], 'hash': sha}
    prop = client.post('/reviewer/proposal', json={'id': meta['id'], 'source': 'local', 'case_id': 'caso-a',
                                                   'source_sha256': sha, 'annotation_id': a.json()['annotation_id']})
    assert prop.json()['applied'] is False


def test_el_archivo_guardado_no_lleva_la_ruta_y_queda_privado(setup):
    client, api, data = setup
    meta = agregar(client, 'C:\\Users\\alguien\\Escritorio\\nota.txt', TEXTO.encode()).json()
    carpeta = data / 'reviewer' / 'documentos'
    archivo = carpeta / (meta['id'][2:] + '.json')
    guardado = json.loads(archivo.read_text(encoding='utf-8'))
    assert guardado['name'] == 'nota.txt' and guardado['text'] == TEXTO
    assert 'alguien' not in archivo.read_text(encoding='utf-8')
    assert stat.S_IMODE(os.stat(carpeta).st_mode) == 0o700
    assert stat.S_IMODE(os.stat(archivo).st_mode) == 0o600


def test_mismo_contenido_es_el_mismo_documento(setup):
    client, api, data = setup
    a = agregar(client, 'a.md', TEXTO.encode()).json()
    b = agregar(client, 'b.md', TEXTO.encode()).json()
    assert a['id'] == b['id'] and b['label'] == 'a.md'
    assert len(client.get('/reviewer/local').json()['documents']) == 1


def test_bom_se_quita_y_docx_se_lee(setup):
    client, api, data = setup
    con_bom = agregar(client, 'bom.txt', b'\xef\xbb\xbfHola').json()
    assert client.get('/reviewer/document', params={'id': con_bom['id'], 'case_id': 'c', 'source': 'local'}).json()['text'] == 'Hola'
    r = agregar(client, 'escrito.docx', docx(['Primer párrafo.', 'Segundo párrafo.']))
    assert r.status_code == 200, r.text
    texto = client.get('/reviewer/document', params={'id': r.json()['id'], 'case_id': 'c', 'source': 'local'}).json()['text']
    assert 'Primer párrafo.' in texto and 'Segundo párrafo.' in texto


@pytest.mark.parametrize('nombre,raw,estado,codigo', [
    ('sentencia.pdf', b'%PDF-1.7', 415, 'UNSUPPORTED_TYPE'),
    ('sin-extension', b'hola', 415, 'UNSUPPORTED_TYPE'),
    ('latin1.txt', 'café'.encode('latin-1'), 400, 'INVALID_TEXT'),
    ('vacio.md', b'  \n', 400, 'INVALID_TEXT'),
    ('roto.docx', b'no es un zip', 400, 'INVALID_DOCX'),
    ('grande.md', b'a' * (2 * 1024 * 1024 + 1), 413, 'TOO_LARGE'),
    ('ctl\x00.md', b'hola', 400, 'INVALID_INPUT'),
])
def test_rechazos(setup, nombre, raw, estado, codigo):
    client, api, data = setup
    r = agregar(client, nombre, raw)
    assert (r.status_code, r.json()['detail']) == (estado, {'code': codigo}), r.text
    assert client.get('/reviewer/local').json()['documents'] == []


def test_entrada_mal_formada_y_campos_extra(setup):
    client, api, data = setup
    assert client.post('/reviewer/local', json={'name': 'a.md', 'data_b64': 'no es base64 !'}).json()['detail'] == {'code': 'INVALID_INPUT'}
    assert client.post('/reviewer/local', json={'name': 'a.md', 'data_b64': b64(b'x'), 'ruta': '/etc/passwd'}).status_code == 400
    assert client.post('/reviewer/local', json={'name': 'a.md'}).status_code == 400


def test_id_ajeno_o_manipulado_no_abre(setup):
    client, api, data = setup
    meta = agregar(client, 'a.md', TEXTO.encode()).json()
    abrir = lambda ident: client.get('/reviewer/document', params={'id': ident, 'case_id': 'c', 'source': 'local'})
    assert abrir('l:' + '0' * 32).status_code == 404
    assert abrir('l:../../etc/passwd').status_code == 400
    assert abrir('v:algo').status_code == 400
    # Un archivo alterado en disco ya no coincide con su hash: falla cerrado.
    archivo = data / 'reviewer' / 'documentos' / (meta['id'][2:] + '.json')
    item = json.loads(archivo.read_text(encoding='utf-8')); item['text'] += ' alterado'
    archivo.write_text(json.dumps(item, ensure_ascii=False), encoding='utf-8')
    r = abrir(meta['id'])
    assert (r.status_code, r.json()['detail']) == (500, {'code': 'STORE_CORRUPT'})
    assert client.get('/reviewer/local').json() | {'types': 0, 'max_file_bytes': 0, 'max_text_bytes': 0} == {
        'documents': [], 'unreadable': 1, 'types': 0, 'max_file_bytes': 0, 'max_text_bytes': 0}


def test_quitar_borra_el_documento_y_sus_pasajes(setup):
    client, api, data = setup
    meta = agregar(client, 'a.md', TEXTO.encode()).json()
    otro = agregar(client, 'b.md', b'Otro documento.').json()
    for doc, caso in ((meta, 'caso-a'), (meta, 'caso-b'), (otro, 'caso-a')):
        texto = client.get('/reviewer/document', params={'id': doc['id'], 'case_id': caso, 'source': 'local'}).json()['text']
        r = client.post('/reviewer/annotation', json={'id': doc['id'], 'source': 'local', 'case_id': caso, 'source_sha256': doc['sha256'],
            'annotation': {'start_offset': 0, 'end_offset': 4, 'text': texto[:4], 'labels': ['hecho_relevante'], 'author': 'h', 'version': 0}})
        assert r.status_code == 200, r.text
    r = client.post('/reviewer/local/delete', json={'id': meta['id']})
    assert r.json() == {'removed': True, 'annotations_removed': 2}
    assert client.get('/reviewer/document', params={'id': meta['id'], 'case_id': 'caso-a', 'source': 'local'}).status_code == 404
    assert [d['id'] for d in client.get('/reviewer/local').json()['documents']] == [otro['id']]
    quedan = client.get('/reviewer/document', params={'id': otro['id'], 'case_id': 'caso-a', 'source': 'local'}).json()['annotations']
    assert len(quedan) == 1
    assert client.post('/reviewer/local/delete', json={'id': meta['id']}).status_code == 404
    assert client.post('/reviewer/local/delete', json={'id': 'v:x'}).status_code == 400


def test_cuerpo_mayor_al_tope_se_corta_antes_de_leerlo(setup):
    client, api, data = setup
    assert api._ReviewerUploadRoute.max_body == 12 * 1024 * 1024
    r = client.post('/reviewer/local', content=b'{"name":"a.md","data_b64":"' + b'A' * (12 * 1024 * 1024) + b'"}',
                    headers={'content-type': 'application/json'})
    assert (r.status_code, r.json()['detail']) == (413, {'code': 'TOO_LARGE'})
    # Las demás rutas del revisor conservan su tope de 128 KiB.
    r = client.post('/reviewer/annotation', content=b'{"x":"' + b'A' * 140000 + b'"}', headers={'content-type': 'application/json'})
    assert r.status_code == 413
