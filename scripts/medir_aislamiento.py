#!/usr/bin/env python3
"""Mide la latencia del motor Diké dentro y fuera del sandbox bubblewrap.

Corre dos escenarios — ``constancia`` (``verificar_citas`` sobre el escrito
de demostración, proceso fresco: primera llamada fría, segunda caliente en el
mismo proceso) y ``buscar`` (``grafo buscar`` del panel) — cada uno en modo
``bwrap`` (PATH normal) y ``degradado`` (PATH sin ``bwrap``), N corridas por
celda, y resume medianas. Cada corrida es un proceso fresco.

Uso, desde la raíz del repo::

    python3 scripts/medir_aislamiento.py [--corridas N] [--plugin-home DIR]

Requiere que el corpus ya esté instalado una vez (una verificación previa en
ese ``plugin-home``); si no, el escenario ``buscar`` lo instala. El intérprete
es el que ejecuta este script (``$HERMES_PYTHON`` en un checkout de Hermes).
"""
import argparse
import hashlib
import importlib.util
import json
import os
import shutil
import statistics
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEMO = ROOT / 'tests' / 'fixtures' / 'escrito_demo.md'


def _cargar(datos: Path):
    spec = importlib.util.spec_from_file_location('dike_med', ROOT / '__init__.py')
    m = importlib.util.module_from_spec(spec)
    sys.modules['dike_med'] = m
    spec.loader.exec_module(m)
    m._carpeta_de_datos = lambda: datos
    return m


def _generation_instalada(m, datos: Path) -> Path:
    sums = (m._CORPUS / 'SHA256SUMS').read_text().split()
    gen = datos / 'generations' / sums[0]
    if not gen.is_dir():
        raise SystemExit('corpus no instalado: corre una verificación antes')
    return gen


def _bin_sin_bwrap() -> Path:
    """Un PATH temporal con todo lo de PATH menos ``bwrap`` (modo degradado)."""
    destino = Path(tempfile.mkdtemp(prefix='dike-sin-bwrap-'))
    vistos = set()
    for d in os.environ.get('PATH', '').split(os.pathsep):
        p = Path(d)
        if not p.is_dir():
            continue
        try:
            entradas = list(p.iterdir())
        except OSError:
            continue
        for e in entradas:
            if e.name == 'bwrap' or e.name in vistos or not os.access(e, os.X_OK):
                continue
            vistos.add(e.name)
            try:
                (destino / e.name).symlink_to(e)
            except OSError:
                pass
    return destino


def _una_corrida(plugin_home: Path, escenario: str, modo: str,
                 bin_sin: Path | None) -> dict:
    datos = plugin_home / 'plugin-data' / 'dike'
    env = dict(os.environ)
    env['PYTHONDONTWRITEBYTECODE'] = '1'
    if modo == 'degradado' and bin_sin is not None:
        env['PATH'] = str(bin_sin)
    codigo = (
        'import importlib.util,sys,json,time;'
        'from pathlib import Path;'
        f'ROOT=Path({str(ROOT)!r});'
        f'DATOS=Path({str(datos)!r});'
        'DEMO=Path(' + repr(str(DEMO)) + ').read_text(encoding="utf-8");'
        'spec=importlib.util.spec_from_file_location("dike_med",ROOT/"__init__.py");'
        'm=importlib.util.module_from_spec(spec);sys.modules["dike_med"]=m;'
        'spec.loader.exec_module(m);m._carpeta_de_datos=lambda:DATOS;'
        'gen=None;'
        'sums=(m._CORPUS/"SHA256SUMS").read_text().split();'
        'g=DATOS/"generations"/sums[0];'
        'gen=g if g.is_dir() else None;'
        'modo=m._aislamiento().estado().get("modo");'
        'if sys.argv[1]=="constancia":'
        ' t0=time.perf_counter();o1=json.loads(m.verificar_citas({"texto":DEMO}));'
        ' fria=time.perf_counter()-t0;'
        ' t0=time.perf_counter();o2=json.loads(m.verificar_citas({"texto":DEMO}));'
        ' caliente=time.perf_counter()-t0;'
        ' print(json.dumps({"escenario":"constancia","modo":modo,"fria":round(fria,3),'
        '"caliente":round(caliente,3),"verificadas":o2.get("meta",{}).get("citas_verificadas"),'
        '"error":o2.get("error")}));'
        'else:'
        ' m._asegurar_corpus(DATOS);'
        ' entrada=json.dumps({"q":"despido indemnización","limite":10},ensure_ascii=False);'
        ' t0=time.perf_counter();'
        ' proc=m._panel_json(["grafo","buscar"],runtime=gen,timeout=120,entrada=entrada);'
        ' elapsed=time.perf_counter()-t0;'
        ' data=json.loads(proc.stdout) if proc.stdout.strip() else {};'
        ' print(json.dumps({"escenario":"buscar","modo":modo,"segundos":round(elapsed,3),'
        '"rc":proc.returncode,"resultados":data.get("total"),"error":data.get("error")}));'
    )
    with tempfile.NamedTemporaryFile('w', suffix='.py', delete=False) as f:
        f.write(codigo)
        payload = f.name
    try:
        proc = subprocess.run(
            [sys.executable, payload, escenario], env=env,
            capture_output=True, text=True, timeout=600)
    finally:
        os.unlink(payload)
    if proc.returncode != 0:
        return {'error': (proc.stderr or proc.stdout).strip()[-300:]}
    return json.loads(proc.stdout.strip().splitlines()[-1])


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument('--corridas', type=int, default=5)
    ap.add_argument('--plugin-home', default=str(ROOT / '.workshop' / 'tmp' / 'medir-home'))
    args = ap.parse_args()
    plugin_home = Path(args.plugin_home)
    plugin_home.mkdir(parents=True, exist_ok=True)

    bin_sin = _bin_sin_bwrap()
    resultados = {}
    try:
        for escenario in ('constancia', 'buscar'):
            for modo in ('bwrap', 'degradado'):
                if escenario == 'buscar':
                    _una_corrida(plugin_home, escenario, modo, bin_sin)  # calienta
                corridas = [
                    _una_corrida(plugin_home, escenario, modo, bin_sin)
                    for _ in range(args.corridas)
                ]
                metricas = {}
                for clave in corridas[0]:
                    if clave in ('escenario', 'modo', 'error', 'verificadas',
                                 'resultados', 'rc'):
                        continue
                    vals = [c[clave] for c in corridas
                            if isinstance(c.get(clave), (int, float))]
                    if vals:
                        metricas[clave] = {
                            'valores': vals,
                            'mediana': round(statistics.median(vals), 3),
                        }
                resultados[f'{escenario}_{modo}'] = {
                    'modo_reportado': corridas[0].get('modo'),
                    'metricas': metricas,
                    'muestra': corridas,
                }
    finally:
        shutil.rmtree(bin_sin, ignore_errors=True)
    print(json.dumps(resultados, indent=2, ensure_ascii=False))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
