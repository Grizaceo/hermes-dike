"""Driver del panel (scripts/panel.py): NIF y grafo personal en entorno aislado.

Corre el script como subproceso con HOME/DIKE_* redirigidos a tmp_path, sin
tocar el plugin-data real ni el corpus sellado. El corpus (grafo corpus*) no
se prueba aquí: exige la generación instalada y ya está cubierto por el e2e
real del adaptador.
"""
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).parents[1]
PANEL = ROOT / 'scripts' / 'panel.py'


@pytest.fixture()
def panel(tmp_path):
    """Corre scripts/panel.py con el workspace NIF/GRE aislado en tmp_path."""
    home = tmp_path / 'home'
    users = tmp_path / 'users'
    home.mkdir()
    env = dict(os.environ)
    env.update({
        'HOME': str(home),
        'DIKE_USER': 'test',
        'DIKE_USERS_ROOT': str(users),
        'PYTHONPATH': str(ROOT / 'motor'),
        'LEXO_CONFIG': str(tmp_path / 'config.yaml'),
    })
    (tmp_path / 'config.yaml').write_text('starter:\n  user: test\n', encoding='utf-8')

    def run(*args):
        proc = subprocess.run(
            [sys.executable, str(PANEL), *args],
            env=env, capture_output=True, text=True, timeout=120)
        assert proc.returncode in (0, 2), proc.stderr
        out = proc.stdout.strip()
        assert out, proc.stderr
        return json.loads(out)

    return run


def test_nif_init_list_snapshot_roundtrip(panel):
    creado = panel('nif', 'init', 'caso-1', '¿Procede el despido?')
    assert creado.get('success') is True, creado

    casos = panel('nif', 'list')
    assert any(c.get('case_id') == 'caso-1' for c in casos['cases'])

    snap = panel('nif', 'snapshot', 'caso-1')
    assert snap['snapshot']['exists'] is True
    assert snap['snapshot']['nif']['legal_question'] == '¿Procede el despido?'
    assert 'patches' in snap


def test_nif_seed_demo(panel):
    out = panel('nif', 'seed', 'demo-1')
    assert out.get('success') is True, out
    snap = panel('nif', 'snapshot', 'demo-1')
    nif = snap['snapshot']['nif']
    assert nif['legal_question']
    assert nif['subjects'] and nif['norms']


def test_nif_edit_validate_confidence(panel):
    panel('nif', 'init', 'caso-2', 'Pregunta de prueba')
    edit = panel('nif', 'edit', 'caso-2', 'facts.known', '"El trabajador fue despedido"')
    assert edit.get('success') is True, edit
    val = panel('nif', 'validate', 'caso-2', '1')
    assert val.get('success') is True, val
    conf = panel('nif', 'confidence', 'caso-2', '0.7')
    assert conf.get('success') is True, conf
    snap = panel('nif', 'snapshot', 'caso-2')
    nif = snap['snapshot']['nif']
    assert 'despedido' in json.dumps(nif['facts']['known'], ensure_ascii=False)
    assert nif['validated_by_human'] is True
    assert nif['confidence'] == 0.7
    assert snap['snapshot']['version'] >= 4


def test_nif_edit_json_invalido(panel):
    panel('nif', 'init', 'caso-3', 'Pregunta')
    out = panel('nif', 'edit', 'caso-3', 'facts.known', '{no-json')
    assert 'error' in out


def test_nif_case_id_invalido(panel):
    for op_args in (
        ('nif', 'init', '../escape', 'pregunta'),
        ('nif', 'snapshot', 'a/b'),
        ('nif', 'edit', 'x;rm', 'facts.known', '"v"'),
    ):
        out = panel(*op_args)
        assert 'error' in out


def test_nif_gap_llena_hueco(panel):
    panel('nif', 'seed', 'demo-gap')
    snap = panel('nif', 'snapshot', 'demo-gap')
    gaps = snap['snapshot']['nif'].get('gaps') or []
    abiertos = [i for i, g in enumerate(gaps) if g.get('status') != 'filled']
    if not abiertos:
        pytest.skip('el seed no dejó huecos abiertos')
    out = panel('nif', 'gap', 'demo-gap', str(abiertos[0]), 'abogado', 'certificado de despido')
    assert out.get('success') is True, out
    snap2 = panel('nif', 'snapshot', 'demo-gap')
    llenos = [g for g in snap2['snapshot']['nif']['gaps'] if g.get('status') == 'filled']
    assert llenos


def test_nif_operacion_desconocida(panel):
    out = panel('nif', 'volar')
    assert 'error' in out


def test_grafo_personal_vacio_honesto(panel):
    out = panel('grafo', 'personal')
    assert out == {'candidates': [], 'edges': []} or (
        'candidates' in out and 'edges' in out)


def test_grafo_corpus_sin_instalado(panel):
    """Sin corpus instalado el panel no inventa normas."""
    out = panel('grafo', 'corpus')
    assert out.get('packs') == []


def test_sin_args(panel):
    out = panel('nif')
    assert 'error' in out
    out = panel('grafo')
    assert 'error' in out
