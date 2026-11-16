"""Fictitious documents only; the core must work without Hermes or a model."""
import hashlib
import importlib
import json
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor

import pytest

TEXT = 'Ficción jurídica 😀\nEl café e\u0301 se entregó.\nSin valor normativo.'


def core():
    return importlib.import_module('dashboard.reviewer_core')


def selection(text=TEXT):
    start = text.index('El café')
    end = text.index('\nSin')
    return dict(start_offset=start, end_offset=end, text=text[start:end])


def test_verified_passage_roundtrip_and_proposal(tmp_path):
    c = core()
    s = c.Store(tmp_path)
    doc = c.document('vault', 'v:fixture', TEXT)
    a = s.save('caso-a', doc, {**selection(), 'author': 'human:fixture', 'labels': ['hecho_relevante'], 'version': 0})
    assert a['version'] == 1
    assert a['state'] == 'reviewed'
    assert c.Store(tmp_path).list('caso-a', doc) == [a]
    result = s.export('caso-a', doc, a['annotation_id'])
    assert result['evidence']['text_hash'] == hashlib.sha256(TEXT.encode()).hexdigest()
    assert result['evidence']['snippet_exact'] == selection()['text']
    assert result['evidence']['confidence'] is None
    assert 'no acredita vigencia' in result['cita']
    p = s.proposal('caso-a', doc, a['annotation_id'])
    assert p['status'] == 'PENDING_EXTERNAL_HITL_5'
    assert p['applied'] is False
    assert p['patch']['field_path'] == 'hypotheses'
    assert p['patch']['value']['evidence_for'][0]['hash'] == doc['sha256']
    script = 'import json; from dashboard.reviewer_core import Store; print(json.dumps(Store(__import__("pathlib").Path(__import__("sys").argv[1])).list("caso-a",json.loads(__import__("sys").argv[2]))))'
    out = subprocess.check_output([sys.executable, '-c', script, str(tmp_path), json.dumps(doc)], text=True)
    assert json.loads(out) == [a]


@pytest.mark.parametrize('change', [dict(start_offset=-1), dict(end_offset=99999), dict(start_offset=True), dict(text='inventado'), dict(end_offset=0), dict(start_offset=1.2),dict(labels=['no-permitida']),dict(author=''),dict(extra='path')])
def test_invalid_selection_fails_closed(tmp_path, change):
    c = core(); s = c.Store(tmp_path); doc = c.document('vault', 'v:fixture', TEXT)
    body = {**selection(), 'author':'human:fixture','labels':['hecho_relevante'],'version':0}
    assert s.save('positive', doc, body)['version'] == 1
    with pytest.raises(c.ReviewerError):
        s.save('negative',doc,{**body,**change})


def test_source_change_never_reanchors(tmp_path):
    c=core(); s=c.Store(tmp_path); doc=c.document('vault','v:fixture',TEXT)
    a=s.save('caso-a',doc,{**selection(),'author':'human:fixture','labels':['hecho_relevante'],'version':0})
    changed=c.document('vault','v:fixture','Prefijo\n'+TEXT)
    old=s.list('caso-a',changed)[0]
    assert old['state']=='obsolete'
    assert old['start_offset']==a['start_offset']
    with pytest.raises(c.ReviewerError,match='STALE_SOURCE'):
        s.export('caso-a',changed,a['annotation_id'])
    assert s.list('caso-b',doc)==[]
    with pytest.raises(c.ReviewerError):
        s.export('caso-b',doc,a['annotation_id'])
    with pytest.raises(c.ReviewerError):
        c.Store(tmp_path/'other-profile').export('caso-a',doc,a['annotation_id'])


def test_cross_process_optimistic_conflict_and_atomicity(tmp_path):
    c=core(); doc=c.document('vault','v:fixture',TEXT); s=c.Store(tmp_path)
    body={**selection(),'author':'human:fixture','labels':['hecho_relevante'],'version':0}
    a=s.save('caso-a',doc,body)
    update={**body,'annotation_id':a['annotation_id'],'version':1}
    def run(_):
        try: return c.Store(tmp_path).save('caso-a',doc,update)['version']
        except c.ReviewerError as e: return e.code
    with ThreadPoolExecutor(2) as pool: results=list(pool.map(run,range(2)))
    assert sorted(results,key=str)==[2,'CONFLICT']
    assert c.Store(tmp_path).list('caso-a',doc)[0]['version']==2


@pytest.mark.parametrize('cid',['../escape','/abs','a\nb','x'*65])
def test_case_traversal_and_limits(tmp_path,cid):
    c=core(); doc=c.document('vault','v:fixture',TEXT)
    with pytest.raises(c.ReviewerError): c.Store(tmp_path).list(cid,doc)
    with pytest.raises(c.ReviewerError): c.document('vault','v:fixture','x'*(2*1024*1024+1))


def test_unicode_conversion_exact_roundtrip():
    c=core()
    for i in range(len(TEXT)+1):
        assert c.from_utf16(TEXT,c.to_utf16(TEXT,i))==i
    with pytest.raises(c.ReviewerError): c.from_utf16('😀',1)
    assert c.to_utf16('😀',1)==2


def test_sqlite_corruption_is_typed_without_path_or_excerpt(tmp_path):
    c=core(); s=c.Store(tmp_path);doc=c.document('vault','v:fixture',TEXT)
    s.path.parent.mkdir(parents=True);s.path.write_bytes(b'not a sqlite database: fictional secret')
    with pytest.raises(c.ReviewerError,match='STORE_UNAVAILABLE'):
        s.list('case-a',doc)


def test_store_unwritable_parent_and_corrupt_row_are_typed(tmp_path):
    c=core();doc=c.document('vault','v:fixture',TEXT)
    blocked=tmp_path/'not-directory';blocked.write_text('fictional')
    with pytest.raises(c.ReviewerError,match='STORE_UNAVAILABLE'): c.Store(blocked).list('case-a',doc)
    s=c.Store(tmp_path/'good')
    s.save('case-a',doc,{**selection(),'author':'human:test','labels':['hecho_relevante'],'version':0})
    import sqlite3
    db=sqlite3.connect(s.path)
    try:
        with db: db.execute("UPDATE annotations SET data='{}'")
    finally: db.close()
    with pytest.raises(c.ReviewerError,match='STORE_CORRUPT'): s.list('case-a',doc)


def test_private_store_permissions(tmp_path):
    c=core();s=c.Store(tmp_path);doc=c.document('vault','v:fixture',TEXT)
    s.save('case-a',doc,{**selection(),'author':'human:test','labels':['hecho_relevante'],'version':0})
    assert s.path.stat().st_mode & 0o777 == 0o600
    assert s.path.parent.stat().st_mode & 0o777 == 0o700


def test_killed_transaction_rolls_back_and_process_writers_conflict(tmp_path):
    c=core();s=c.Store(tmp_path);doc=c.document('vault','v:fixture',TEXT)
    body={**selection(),'author':'human:fixture','labels':['hecho_relevante'],'version':0}
    ann=s.save('case-a',doc,body)
    crash='import sqlite3,sys,os; c=sqlite3.connect(sys.argv[1]); c.execute("BEGIN IMMEDIATE"); c.execute("UPDATE annotations SET version=99"); os._exit(9)'
    p=subprocess.run([sys.executable,'-c',crash,str(s.path)])
    assert p.returncode==9
    assert c.Store(tmp_path).list('case-a',doc)[0]['version']==1
    script='''import json,sys
from pathlib import Path
from dashboard.reviewer_core import Store,ReviewerError
try: print(Store(Path(sys.argv[1])).save('case-a',json.loads(sys.argv[2]),json.loads(sys.argv[3]))['version'])
except ReviewerError as e: print(e.code)
'''
    args=[sys.executable,'-c',script,str(tmp_path),json.dumps(doc),json.dumps({**body,'version':1,'annotation_id':ann['annotation_id']})]
    ps=[subprocess.Popen(args,stdout=subprocess.PIPE,text=True) for _ in range(2)]
    out=[p.communicate(timeout=10)[0].strip() for p in ps]
    assert sorted(out)==['2','CONFLICT']
