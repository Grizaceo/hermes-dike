"""Offline positive/negative probe; runnable without Hermes, models or profiles."""
from pathlib import Path
import json
import os
import socket
from dashboard.reviewer_core import Store, document, ReviewerError

# Ningún perfil de Hermes es visible dentro del sandbox.
assert not any(Path('/home').glob('*/.hermes'))
assert not any(k.endswith('API_KEY') for k in os.environ)
if os.environ.get('PROBE_EGRESS'):
    # Sensitivity control: network namespace denies connect, strace must see it.
    try:
        with socket.socket() as s:
            s.settimeout(.1);s.connect(('192.0.2.1',443))
    except OSError: pass
    print('egress sensitivity control')
else:
    text='Ficción 😀 café e\u0301\r\nSin norma real.'
    doc=document('vault','v:fixture',text);store=Store(Path('/evidence/state'))
    body={'start_offset':0,'end_offset':len(text),'text':text,'author':'human:offline','labels':['hecho_relevante'],'version':0}
    a=store.save('case-offline',doc,body)
    assert Store(Path('/evidence/state')).export('case-offline',doc,a['annotation_id'])['evidence']['snippet_exact']==text
    assert store.proposal('case-offline',doc,a['annotation_id'])['applied'] is False
    try: store.save('negative',doc,{**body,'text':'inventado'})
    except ReviewerError as e: assert e.code=='SNIPPET_MISMATCH'
    else: raise AssertionError('negative not rejected')
    print(json.dumps({'positive':'create/reopen/export/proposal','negative':'snippet mismatch rejected','private_profile_mounted':False,'model_required':False}))
