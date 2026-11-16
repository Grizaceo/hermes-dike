"""Reviewer HTTP contracts with positive authorization controls."""
import hashlib
import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

ROOT=Path(__file__).resolve().parents[1]


@pytest.fixture
def setup(tmp_path):
    spec=importlib.util.spec_from_file_location('reviewer_api_test',ROOT/'dashboard/plugin_api.py')
    api=importlib.util.module_from_spec(spec);spec.loader.exec_module(api)
    docs=tmp_path/'docs'; docs.mkdir(); data=tmp_path/'data';data.mkdir()
    text='Documento ficticio 😀\nEl café e\u0301 llegó.\nFin.'
    p=docs/'ficcion.md';p.write_bytes(text.encode())
    ident=api._sources()._id('ficcion.md')
    cfg={'vault':{'enabled':True,'root':str(docs),'approved_documents':{ident:{'anonymized':True,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}}}}
    config=data/'graph-sources.json';config.write_text(json.dumps(cfg))
    api._adaptador=lambda:SimpleNamespace(_carpeta_de_datos=lambda:data,_limpio_panel=lambda texto:str(texto)[:400])
    api._panel=lambda *args,**kwargs: (_ for _ in ()).throw(AssertionError('NIF/engine must not be invoked'))
    app=FastAPI();app.include_router(api.router);client=TestClient(app)
    return client,api,p,config,ident,text


def test_api_document_save_reopen_export_proposal(setup):
    client,api,p,cfg,ident,text=setup
    r=client.get('/reviewer/document',params={'id':ident,'case_id':'case-a'})
    assert r.status_code==200, r.text
    d=r.json(); assert d['text']==text
    body={'id':ident,'case_id':'case-a','source_sha256':d['sha256'],'annotation':{'start_offset':0,'end_offset':len(text),'text':text,'labels':['hecho_relevante'],'author':'human:test','version':0}}
    saved=client.post('/reviewer/annotation',json=body)
    assert saved.status_code==200,saved.text
    aid=saved.json()['annotation_id']
    assert client.get('/reviewer/document',params={'id':ident,'case_id':'case-a'}).json()['annotations'][0]['annotation_id']==aid
    for route in ('export','proposal'):
        r=client.post('/reviewer/'+route,json={k:v for k,v in {**body,'annotation_id':aid}.items() if k!='annotation'})
        assert r.status_code==200,r.text
        if route=='proposal': assert r.json()['applied'] is False
        else: assert r.json()['evidence']['snippet_exact']==text
    assert client.post('/reviewer/export',json={'id':ident,'case_id':'case-b','source_sha256':d['sha256'],'annotation_id':aid}).status_code==404
    assert client.post('/reviewer/annotation',json={**body,'source_sha256':'0'*64}).status_code==409


@pytest.mark.parametrize('denial',['changed','deleted','denied','metadata','traversal','foreign'])
def test_denials_have_positive_control(setup,denial):
    client,api,p,config,ident,text=setup
    args={'id':ident,'case_id':'case-a'}
    positive=client.get('/reviewer/document',params=args)
    assert positive.status_code==200
    sha=positive.json()['sha256']
    saved=client.post('/reviewer/annotation',json={'id':ident,'case_id':'case-a','source_sha256':sha,'annotation':{'start_offset':0,'end_offset':len(text),'text':text,'labels':['hecho_relevante'],'author':'human:test','version':0}})
    assert saved.status_code==200
    aid=saved.json()['annotation_id']
    assert client.post('/reviewer/export',json={'id':ident,'case_id':'case-a','source_sha256':sha,'annotation_id':aid}).status_code==200
    if denial=='changed': p.write_text('Changed fictional content')
    if denial=='deleted': p.unlink()
    if denial=='denied':
        cfg=json.loads(config.read_text());cfg['vault']['approved_documents']={};config.write_text(json.dumps(cfg))
    if denial=='metadata': args['source']='ambiental'
    if denial=='traversal': args['id']='../../secret'
    if denial=='foreign': args['id']='v:another-profile'
    r=client.get('/reviewer/document',params=args)
    assert r.status_code in (400,403,404),r.text
    assert text not in r.text and 'Changed fictional content' not in r.text
    for route in ('export','proposal'):
        rejected=client.post('/reviewer/'+route,json={**args,'source_sha256':sha,'annotation_id':aid})
        assert rejected.status_code in (400,403,404)
        assert text not in rejected.text


def test_request_bound_before_json_parser(setup):
    client,*_=setup
    r=client.post('/reviewer/annotation',content=b' '*131073,headers={'content-type':'application/json'})
    assert r.status_code==413
