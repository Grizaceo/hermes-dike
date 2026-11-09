import importlib.util
import io
import json
import os
import re
import subprocess
import sys
import zipfile
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
SCRATCH = Path('/tmp/dike-scratch/site-packages')
MOTOR = ROOT / 'motor'


@pytest.fixture(scope='module')
def mod():
    spec = importlib.util.spec_from_file_location('dike_docx_test', ROOT / '__init__.py')
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def _python_docx():
    return pytest.importorskip('docx', reason='python-docx no está en el entorno de tests')


def _add_hyperlink(paragraph, text, url='https://example.com/x'):
    """Inserta un ``w:hyperlink`` con un ``w:r``/``w:t`` (como hace Word)."""
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn
    r_id = paragraph.part.relate_to(
        url, 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink',
        is_external=True)
    hyperlink = OxmlElement('w:hyperlink')
    hyperlink.set(qn('r:id'), r_id)
    run = OxmlElement('w:r')
    t = OxmlElement('w:t')
    t.text = text
    run.append(t)
    hyperlink.append(run)
    paragraph._p.append(hyperlink)
    return hyperlink


def _build_docx() -> bytes:
    """Un .docx rico: párrafos variados + tabla con gridSpan/vMerge + 2ª tabla."""
    from docx import Document
    from docx.enum.text import WD_BREAK
    doc = Document()
    # párrafos: texto plano, runs con formato, tab, salto de línea y de página,
    # párrafo vacío, unicode y un hipervínculo.
    doc.add_paragraph('Primera línea del escrito.')
    p = doc.add_paragraph()
    p.add_run('Negrita')
    r = p.add_run()
    r.bold = True
    r.add_text(' y normal ')
    p.add_run('al final.')
    p2 = doc.add_paragraph()
    p2.add_run('colA')
    p2.add_run().add_tab()
    p2.add_run('colB')
    p3 = doc.add_paragraph()
    p3.add_run('antes')
    p3.add_run().add_break()          # w:br textWrapping → '\n'
    p3.add_run('después')
    p4 = doc.add_paragraph()
    p4.add_run('antes pagina')
    p4.add_run().add_break(WD_BREAK.PAGE)  # w:br type=page → ''
    p4.add_run('tras pagina')
    doc.add_paragraph('   ')          # solo espacios → se descarta por strip()
    doc.add_paragraph('Unicode: á é í ó ú ñ ü « » “ ” — €')
    ph = doc.add_paragraph('Ver ')
    _add_hyperlink(ph, 'el enlace aquí', 'https://example.com/ley')
    ph.add_run(' y más.')
    # tabla 1: gridSpan horizontal + vMerge vertical
    t1 = doc.add_table(rows=3, cols=3)
    t1.cell(0, 0).text = 'H1'
    t1.cell(0, 1).text = 'H2'
    t1.cell(0, 2).text = 'H3'
    # merge horizontal: (1,0)+(1,1) → gridSpan=2
    t1.cell(1, 0).merge(t1.cell(1, 1))
    t1.cell(1, 0).text = 'fusionada'
    t1.cell(1, 2).text = 'solitaria'
    # merge vertical: (0,2)+(2,2) vía celda (1,2) → vMerge continue en (2,2)
    # python-docx merge crea restart en la superior y continue en la inferior.
    t1.cell(0, 2).merge(t1.cell(2, 2))
    t1.cell(0, 2).text = 'vertical'
    # tabla 2: celda con dos párrafos + otra simple
    t2 = doc.add_table(rows=1, cols=2)
    tc = t2.cell(0, 0)
    tc.text = 'párrafo uno'
    tc.add_paragraph('párrafo dos')
    t2.cell(0, 1).text = 'vecina'
    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


def _motor_docx_text(path: Path) -> str:
    """Corre ``_read_docx`` del motor en un SUBPROCESO (nunca importa lexo_cli aquí)."""
    env = dict(os.environ)
    env['PYTHONPATH'] = os.pathsep.join([str(MOTOR), str(SCRATCH)])
    env['PYTHONDONTWRITEBYTECODE'] = '1'
    code = (
        'import sys; from pathlib import Path;'
        'sys.path.insert(0, sys.argv[2]);'
        'from lexo_cli.documento import _read_docx;'
        'sys.stdout.write(_read_docx(Path(sys.argv[1])))'
    )
    proc = subprocess.run(
        [sys.executable, '-c', code, str(path), str(MOTOR)],
        capture_output=True, text=True, env=env, cwd=str(ROOT), timeout=120)
    assert proc.returncode == 0, proc.stderr[-2000:]
    return proc.stdout


def test_docx_paridad_con_motor(mod, tmp_path):
    _python_docx()
    data = _build_docx()
    mine = mod._texto_docx(data)
    f = tmp_path / 'escrito.docx'
    f.write_bytes(data)
    theirs = _motor_docx_text(f)
    assert mine == theirs


def _demo_docx_bytes() -> bytes:
    """El escrito de demostración como .docx (un párrafo por bloque del .md)."""
    from docx import Document
    text = (ROOT / 'tests/fixtures/escrito_demo.md').read_text()
    doc = Document()
    for block in re.split(r'\n\s*\n', text):
        block = ' '.join(block.split())
        if block:
            doc.add_paragraph(block)
    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


def test_docx_demo_da_4_6_sin_python_docx(mod, tmp_path, monkeypatch):
    """verificar_citas extrae el texto en el adaptador: el motor no necesita docx.

    El .docx del escrito demo da el mismo 4/6 que el .md, y 'docx' ya no forma
    parte de los módulos que el sandbox/PYTHONPATH reenvía al motor.
    """
    _python_docx()
    f = tmp_path / 'demo.docx'
    f.write_bytes(_demo_docx_bytes())
    data_dir = tmp_path / 'datos-docx'
    monkeypatch.setattr(mod, '_carpeta_de_datos', lambda: data_dir)
    out = json.loads(mod.verificar_citas({'ruta': str(f)}))
    assert 'error' not in out, out
    assert out['meta']['total_citas'] == 6
    assert out['meta']['citas_verificadas'] == 4
    # El motor ya no recibe python-docx: 'docx' no está en los módulos medidos.
    spec = importlib.util.spec_from_file_location('dike_aislamiento_docx', ROOT / 'aislamiento.py')
    aisl = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(aisl)
    assert 'docx' not in aisl.MODULOS_MEDIDOS


# ── Casos negativos: cada uno debe dar INPUT_ERROR / INPUT_DOCX ──────────

def _docx_minimo() -> bytes:
    """Zip mínimo con word/document.xml válido."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w') as zf:
        zf.writestr('word/document.xml',
                    '<?xml version="1.0"?><w:document '
                    'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
                    '<w:body><w:p><w:r><w:t>hola</w:t></w:r></w:p></w:body></w:document>')
    return buf.getvalue()


def _espera_input_docx(mod, data: bytes):
    with pytest.raises(mod.EntradaInvalida) as ei:
        mod._texto_docx(data)
    assert ei.value.codigo == 'INPUT_DOCX'


def test_docx_no_es_zip(mod):
    _espera_input_docx(mod, b'esto no es un zip')


def test_docx_sin_document_xml(mod):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w') as zf:
        zf.writestr('otro.xml', '<x/>')
    _espera_input_docx(mod, buf.getvalue())


def test_docx_demasiadas_entradas(mod):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w') as zf:
        for i in range(2001):
            zf.writestr(f'f{i}.txt', 'x')
        zf.writestr('word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body/></w:document>')
    _espera_input_docx(mod, buf.getvalue())


def test_docx_doctype_rechazado(mod):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w') as zf:
        zf.writestr('word/document.xml',
                    '<!DOCTYPE x [<!ENTITY e "v">]><w:document '
                    'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
                    '<w:body/></w:document>')
    _espera_input_docx(mod, buf.getvalue())


def test_docx_xml_malformado(mod):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w') as zf:
        zf.writestr('word/document.xml', '<w:document><w:body><w:p>')
    _espera_input_docx(mod, buf.getvalue())


def test_docx_ratio_bomb_rechazado(mod):
    # document.xml muy grande y muy comprimible → ratio > 100.
    xml = ('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
           '<w:body><w:p><w:r><w:t>' + 'a' * 200_000 + '</w:t></w:r></w:p></w:body></w:document>')
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as zf:
        zf.writestr('word/document.xml', xml)
    _espera_input_docx(mod, buf.getvalue())


def test_docx_minimo_extrae_texto(mod):
    assert 'hola' in mod._texto_docx(_docx_minimo())
