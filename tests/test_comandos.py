"""Comandos de verificación y presentación de resultados."""
from soporte_adaptador import native
import json
import subprocess
from pathlib import Path
ROOT = Path(__file__).parents[1]

def test_comando_texto(adaptador_real):
    out = adaptador_real._comando((ROOT / 'tests/fixtures/escrito_demo.md').read_text())
    lines = out.split('\n')
    assert lines[0].startswith('Diké: 4 de 6 citas verificadas (CON_PROBLEMAS) · corpus ')
    assert sum(1 for l in lines if l.startswith('✓ ')) == 4
    assert any(l.startswith('✗ artículo 60 · AMBIGUOUS') for l in lines)
    assert any(l.startswith('✗ artículo 9999') and 'UNRESOLVABLE' in l for l in lines)
    assert lines[-1].startswith('No certifica que el artículo respalde')


def test_comando_ruta(adaptador_real, tmp_path):
    p = tmp_path / 'escrito.md'
    p.write_text((ROOT / 'tests/fixtures/escrito_demo.md').read_text())
    out = adaptador_real._comando(str(p))
    assert out.startswith('Diké: 4 de 6 citas verificadas')


def test_comando_pdf_token(native):
    out = native._comando('/tmp/brief.pdf')
    assert out.startswith('Diké no pudo revisar el escrito: Solo se aceptan archivos .md, .txt o .docx.')


def test_comando_error(native):
    out = native._comando('archivo-que-no-existe.md')
    assert out.startswith('Diké no pudo revisar el escrito: No existe un archivo regular')


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
    assert lineas[0] == ('Diké: No se detectaron citas con artículo verificables; '
                         'esto no acredita las menciones normativas del escrito.')
    assert lineas[1].startswith('Aislamiento: ')
