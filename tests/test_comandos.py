"""Comandos de verificación y presentación de resultados."""
from soporte_adaptador import native
import pytest
import json
import subprocess
from pathlib import Path
ROOT = Path(__file__).parents[1]

@pytest.mark.parametrize('idioma', ['en', 'es'])
def test_comando_texto(adaptador_real, monkeypatch, idioma):
    if idioma == 'es':
        monkeypatch.setattr(adaptador_real, '_setting', lambda clave, default=None: idioma if clave == 'idioma' else default)
    out = adaptador_real._comando((ROOT / 'tests/fixtures/escrito_demo.md').read_text())
    lines = out.split('\n')
    assert lines[0] == adaptador_real._t('command.count', verified=4, total=6, verdict='CON_PROBLEMAS', pack=adaptador_real.PACK_HASH)
    assert ('4 of 6 citations verified' if idioma == 'en' else '4 de 6 citas verificadas') in lines[0]
    estado = adaptador_real._comando_estado('')
    assert ('Corpus: installed' if idioma == 'en' else 'Corpus: instalado') in estado
    assert adaptador_real._t('status.integrity') in estado
    assert ('Engine server: up for' if idioma == 'en' else 'Servidor del motor: activo hace') in estado
    assert sum(1 for l in lines if l.startswith('✓ ')) == 4
    assert any(l.startswith('✗ artículo 60 · AMBIGUOUS') for l in lines)
    assert any(l.startswith('✗ artículo 9999') and 'UNRESOLVABLE' in l for l in lines)
    # El código del motor siempre se ve; la glosa lo explica en el idioma elegido.
    assert any(l.endswith('UNRESOLVABLE (' + ('not found in the local corpus' if idioma == 'en'
                                             else 'no está en el corpus local') + ')') for l in lines)
    assert lines[-1].startswith('This does not certify' if idioma == 'en' else 'No certifica')


def test_comando_ruta(adaptador_real, tmp_path):
    p = tmp_path / 'escrito.md'
    p.write_text((ROOT / 'tests/fixtures/escrito_demo.md').read_text())
    out = adaptador_real._comando(str(p))
    assert out.startswith('Diké: 4 of 6 citations verified')


def test_comando_pdf_token(native):
    out = native._comando('/tmp/brief.pdf')
    assert out.startswith(native._t('command.error', message=native._t('input.extension')))


def test_comando_error(native):
    out = native._comando('archivo-que-no-existe.md')
    assert out.startswith(native._t('command.error', message=native._t('input.not_found')))


def test_comando_sin_citas(native):
    from datetime import date, datetime, timezone
    hoy = date.today().isoformat()
    native._dike = lambda *a, **kw: subprocess.CompletedProcess(
        [], 0, json.dumps({'veredicto': 'SIN_CITAS', 'detalles': [],
                           'citation_disclosure': {'no_verificadas': [], 'advertencias': []},
                           'meta': {'as_of': hoy,
                                    'fecha_constancia': datetime.now(timezone.utc).isoformat(),
                                    'pack_hash': 'af1422d66d1e6eee'},
                           'mensaje': 'sin citas'}), '')
    out = native._comando('texto sin nada')
    lineas = out.split('\n')
    assert lineas[0] == 'Diké: ' + native._t('summary.no_citations')
    assert lineas[1].startswith('Isolation: ')
