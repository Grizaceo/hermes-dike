"""Prove native Graphium execution without network or mounted Hermes/private profiles."""
import json
import os
from pathlib import Path
import re
import struct
import subprocess
import tempfile

ROOT=Path(__file__).resolve().parents[1]

def main():
    scratch=os.environ.get('TMPDIR')
    if not scratch: raise SystemExit('TMPDIR required')
    binary=ROOT/'graphium/bin/dike-graphium'
    graph={'nodes':[{'id':'a','tipo':'node','label':'a'},{'id':'b','tipo':'node','label':'b'}],
           'links':[{'source':'a','target':'b','tipo':'cita','estado':'candidata'}]}
    with tempfile.TemporaryDirectory(prefix='graphium-offline-',dir=scratch) as temp:
        evidence=Path(temp)
        base=['bwrap','--unshare-all','--die-with-parent','--new-session','--ro-bind','/usr','/usr',
              '--symlink','usr/lib','/lib','--symlink','usr/lib','/lib64','--symlink','usr/bin','/bin',
              '--symlink','usr/bin','/sbin','--proc','/proc','--dev','/dev','--tmpfs','/tmp',
              '--ro-bind',str(binary),'/engine','--bind',str(evidence),'/evidence',
              '--clearenv','--setenv','RAYON_NUM_THREADS','2','--',
              '/usr/bin/strace','-f','-e','trace=network','-o','/evidence/network.log','/engine']
        positive=subprocess.run(base,input=json.dumps(graph).encode(),capture_output=True,timeout=30)
        assert positive.returncode==0, positive.stderr.decode(errors='replace')
        assert struct.unpack_from('<2I',positive.stdout,8)==(2,1)
        trace=(evidence/'network.log').read_text()
        attempted=re.findall(r'\b(?:socket|socketpair|connect|bind|listen|accept4?|sendto|sendmsg|recvfrom|recvmsg|getsockname|getpeername|setsockopt|getsockopt)\(',trace)
        assert not attempted, 'Network syscalls attempted'
        graph['links'][0]['target']='missing'
        negative=subprocess.run(base,input=json.dumps(graph).encode(),capture_output=True,timeout=30)
        assert negative.returncode==1 and b'Unknown target' in negative.stderr
        print(json.dumps({'ok':True,'positive_counts':[2,1],'negative_rejected':True,'network_syscalls':len(attempted),
                          'hermes_profile_mounted':False,'model_required':False,'isolation':'bubblewrap unshare-all + strace network'}))

if __name__=='__main__':main()
