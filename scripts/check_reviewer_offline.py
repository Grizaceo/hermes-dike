"""No external network, no private HOME, explicit egress detection control."""
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import sysconfig
import tempfile

ROOT=Path(__file__).resolve().parents[1]

def main():
    scratch=os.environ['TMPDIR']
    python_root=Path(sys.base_prefix)
    site=Path(sysconfig.get_paths()['purelib'])
    with tempfile.TemporaryDirectory(prefix='reviewer-offline-',dir=scratch) as tmp:
        evidence=Path(tmp)
        cmd=['bwrap','--unshare-all','--die-with-parent','--new-session','--ro-bind','/usr','/usr',
             '--symlink','usr/lib','/lib','--symlink','usr/lib','/lib64','--symlink','usr/bin','/bin',
             '--proc','/proc','--dev','/dev','--tmpfs','/tmp',
             '--ro-bind',str(python_root),'/python','--ro-bind',str(ROOT/'dashboard'),'/app/dashboard',
             '--ro-bind',str(ROOT/'scripts/reviewer_offline_probe.py'),'/app/probe.py',
             '--bind',str(evidence),'/evidence']
        # Mount ONLY runtime library code, not the host profile or all site data.
        for name in ('pydantic','pydantic_core','annotated_types','typing_inspection'):
            spec=importlib.util.find_spec(name);assert spec and spec.origin
            path=Path(spec.origin).parent
            cmd+=['--ro-bind',str(path),'/deps/'+name]
        cmd+=['--ro-bind',str(site/'typing_extensions.py'),'/deps/typing_extensions.py',
              '--clearenv','--setenv','HOME','/empty','--setenv','PYTHONPATH','/app:/deps','--setenv','PYTHONDONTWRITEBYTECODE','1']
        def run(negative):
            name='sensitivity' if negative else 'positive'
            args=cmd+(['--setenv','PROBE_EGRESS','1'] if negative else [])+['--','/usr/bin/strace','-f','-e','trace=network','-o','/evidence/'+name+'.network.log','/python/bin/'+Path(sys.executable).resolve().name,'/app/probe.py']
            p=subprocess.run(args,capture_output=True,text=True,timeout=30)
            assert p.returncode==0,p.stderr
            trace=(evidence/(name+'.network.log')).read_text()
            attempted=re.findall(r'\b(?:socket|socketpair|connect|sendto|sendmsg|bind|listen|accept4?)\(',trace)
            return p.stdout,len(attempted)
        positive,count=run(False);assert count==0,'positive attempted network'
        negative,sensitivity=run(True);assert sensitivity>0,'detector missed deliberate network attempt'
        print(json.dumps({'ok':True,'positive':json.loads(positive),'network_syscalls':count,'sensitivity_detected_syscalls':sensitivity,'isolation':'bubblewrap --unshare-all; empty env; allowlisted Python code; strace network','scope':'deterministic core only, not full UI/installed host'}))

if __name__=='__main__':main()
