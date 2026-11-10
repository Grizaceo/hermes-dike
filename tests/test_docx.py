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
from soporte_adaptador import native

ROOT = Path(__file__).resolve().parent.parent
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
    docx = _python_docx()
    sitio_docx = Path(docx.__file__).resolve().parent.parent
    env['PYTHONPATH'] = os.pathsep.join([str(MOTOR), str(sitio_docx)])
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


def test_docx_demo_da_4_6_sin_python_docx(adaptador_real, tmp_path):
    """verificar_citas extrae el texto en el adaptador: el motor no necesita docx.

    El .docx del escrito demo da el mismo 4/6 que el .md, y 'docx' ya no forma
    parte de los módulos que el sandbox/PYTHONPATH reenvía al motor.
    """
    _python_docx()
    f = tmp_path / 'demo.docx'
    f.write_bytes(_demo_docx_bytes())
    out = json.loads(adaptador_real.verificar_citas({'ruta': str(f)}))
    assert 'error' not in out, out
    assert out['veredicto'] == 'CON_PROBLEMAS'
    assert out['meta']['total_citas'] == 6
    assert out['meta']['citas_verificadas'] == 4
    # El motor ya no recibe python-docx: 'docx' no está en los módulos medidos.
    spec = importlib.util.spec_from_file_location('dike_aislamiento_docx', ROOT / 'aislamiento.py')
    aisl = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(aisl)
    assert 'docx' not in aisl.MODULOS_MEDIDOS


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


def _zip_xml(xml):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w') as zf:
        zf.writestr('word/document.xml', xml)
    return buf.getvalue()


@pytest.mark.parametrize('encoding', ['utf-8', 'utf-16', 'utf-16-be', 'utf-32'])
def test_docx_rechaza_dtd_en_cualquier_codificacion(mod, encoding):
    xml = ('<?xml version="1.0" encoding="' + encoding + '"?>'
           '<!DOCTYPE x [<!ENTITY e "artículo 161">]>'
           '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
           '<w:body><w:p><w:r><w:t>&e;</w:t></w:r></w:p></w:body></w:document>')
    _espera_input_docx(mod, _zip_xml(xml.encode(encoding)))


@pytest.mark.parametrize('tabla', [
    '<w:tr><w:tc><w:tcPr><w:gridSpan w:val="1000000000"/></w:tcPr><w:p/></w:tc></w:tr>',
    '<w:tr><w:tc><w:p/></w:tc></w:tr>' * 20_001,
    '<w:tr><w:tc><w:tcPr><w:gridSpan w:val="128"/></w:tcPr><w:p><w:r><w:t>'
    + 'x' * 4000 + '</w:t></w:r></w:p></w:tc></w:tr>',
], ids=['span', 'filas', 'texto'])
def test_docx_acota_tablas_antes_de_expandir(mod, tabla):
    xml = ('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
           '<w:body><w:tbl>' + tabla + '</w:tbl></w:body></w:document>')
    _espera_input_docx(mod, _zip_xml(xml))


def test_docx_acota_texto_extraido_y_profundidad(mod):
    base = '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'
    _espera_input_docx(mod, _zip_xml(base + '<w:p><w:r><w:t>' + 'x' * 400001
                                  + '</w:t></w:r></w:p></w:body></w:document>'))
    _espera_input_docx(mod, _zip_xml(base + '<w:p>' * 129 + '</w:p>' * 129
                                  + '</w:body></w:document>'))


def test_docx_too_large(native, tmp_path):
    p = tmp_path / 'big.docx'
    p.write_bytes(b'0' * 10_000_001)
    assert _error(native, {'ruta': str(p)})['motivo'] == 'INPUT_TOO_LARGE'


def test_docx_corrupt(adaptador_real, tmp_path):
    """Un .docx dañado nunca certifica: el adaptador lo rechaza con INPUT_DOCX
    antes de llegar al motor (la extracción es con la biblioteca estándar)."""
    p = tmp_path / 'roto.docx'
    p.write_bytes(b'no es un zip ni un docx')
    out = json.loads(adaptador_real.verificar_citas({'ruta': str(p)}))
    assert out['error_code'] == 'INPUT_ERROR' and out['motivo'] == 'INPUT_DOCX'
    assert out['todo_verificado'] is False


def test_docx_generic_engine_error_not_input_docx(native, tmp_path):
    """Un .docx válido llega al motor como texto; un error genérico del motor
    sigue siendo ENGINE_EXIT_ERROR, no un error de entrada."""
    escrito = tmp_path / 'e.docx'
    escrito.write_bytes(_docx_minimo())
    native._dike = lambda *a, **kw: subprocess.CompletedProcess(
        [], 2, '', "Traceback (most recent call last):\n  File 'escrito.docx', line 1\nKeyError: 'x'")
    out = json.loads(native.verificar_citas({'ruta': str(escrito)}))
    assert out['error_code'] == 'ENGINE_EXIT_ERROR' and 'motivo' not in out


def _error(native, args):
    return json.loads(native.verificar_citas(args))


def test_paridad_usa_la_instalacion_docx_del_padre(tmp_path, monkeypatch):
    from types import SimpleNamespace
    sitio = tmp_path / 'dependencias de pruebas'
    monkeypatch.setattr(sys.modules[__name__], '_python_docx',
                        lambda: SimpleNamespace(__file__=str(sitio / 'docx/__init__.py')))
    def ejecutar(*args, **kwargs):
        rutas = kwargs['env']['PYTHONPATH'].split(os.pathsep)
        assert str(sitio) in rutas
        assert all('dike-scratch' not in ruta for ruta in rutas)
        return SimpleNamespace(returncode=0, stdout='texto leído', stderr='')
    monkeypatch.setattr(subprocess, 'run', ejecutar)
    assert _motor_docx_text(tmp_path / 'fixture.docx') == 'texto leído'
