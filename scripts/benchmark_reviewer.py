"""Reproducible fictional fixtures; no OCR/network/LLM, not an extraction benchmark.
Decision budget declared BEFORE execution: p95 warm validate/export <50 ms and
save <100 ms for <=1 MiB. If met, no Rust spike: IPC cannot remove filesystem
or authorization costs, and Python/Pydantic already ship in the host.
"""
from pathlib import Path
import json
import platform
import resource
import statistics
import subprocess
import sys
import tempfile
import time

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from dashboard.reviewer_core import Store, document


def measure(fn,n=50):
    times=[]
    for _ in range(n):
        start=time.perf_counter_ns();fn();times.append((time.perf_counter_ns()-start)/1e6)
    ordered=sorted(times)
    return {'n':n,'median_ms':statistics.median(times),'p95_ms':ordered[int(.95*(n-1))]}


def main():
    out={'python':sys.version,'platform':platform.platform(),'budget':{'warm_export_p95_ms':50,'save_p95_ms':100},'fixtures':[]}
    out['cold_import']=measure(lambda:subprocess.run([sys.executable,'-c','import dashboard.reviewer_core'],cwd=ROOT,check=True,stdout=subprocess.DEVNULL),10)
    with tempfile.TemporaryDirectory(prefix='reviewer-bench-') as tmp:
        store=Store(Path(tmp))
        for size in [4096,131072,1048576]:
            unit='Ficción: café 😀 e\u0301.\n'
            text=(unit*(size//len(unit.encode())+1)).encode()[:size].decode('utf-8',errors='ignore')
            doc=document('vault','v:fixture',text)
            body={'text':text[:30],'start_offset':0,'end_offset':30,'labels':['hecho_relevante'],'author':'human:benchmark','version':0}
            ann=store.save('case-'+str(size),doc,body)
            out['fixtures'].append({'utf8_bytes':len(text.encode()),'code_points':len(text),
                                    'hash_document':measure(lambda:document('vault','v:fixture',text)),
                                    'warm_export':measure(lambda:store.export('case-'+str(size),doc,ann['annotation_id'])),
                                    'save':measure(lambda:store.save('case-'+str(size),doc,body))})
    out['maxrss_kib']=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    out['source_bytes']=sum(p.stat().st_size for p in (ROOT/'dashboard').rglob('reviewer*.py'))+sum(p.stat().st_size for p in (ROOT/'dashboard/reviewer_vendor').glob('*.py'))
    out['extra_runtime_dependencies']=[]
    print(json.dumps(out,indent=2))

if __name__=='__main__': main()
