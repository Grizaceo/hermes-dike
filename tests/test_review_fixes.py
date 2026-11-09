"""Fixes de la revisión general: M1 inputs, docx, M5 rutas relativas, M6 comando, M2 stat."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess

import pytest

ROOT = Path(__file__).parents[1]


@pytest.fixture
def native(monkeypatch, tmp_path):
    spec = importlib.util.spec_from_file_location('native_review', ROOT / '__init__.py')
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    m._carpeta_de_datos = lambda: tmp_path
    monkeypatch.setattr(m, '_asegurar_corpus', lambda data: {})
    return m


@pytest.fixture(scope='module')
def real(tmp_path_factory):
    spec = importlib.util.spec_from_file_location('native_real_rev', ROOT / '__init__.py')
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    datos = tmp_path_factory.mktemp('native-data')
    m._carpeta_de_datos = lambda: datos
    m._asegurar_corpus(datos)  # instala una sola vez por módulo
    return m


def _docx_desde_demo(tmp_path):
    docx = pytest.importorskip('docx')
    document = docx.Document()
    for line in (ROOT / 'tests/fixtures/escrito_demo.md').read_text().splitlines():
        document.add_paragraph(line)
    out = tmp_path / 'escrito.docx'
    document.save(str(out))
    return out


def _error(native, args):
    return json.loads(native.verificar_citas(args))


# ── M1: códigos de entrada ──────────────────────────────────────────

@pytest.mark.parametrize('args,code', [
    ({'texto': 'x', 'ruta': 'x'}, 'INPUT_FIELDS'),
    ({'otro': 'x'}, 'INPUT_FIELDS'),
    ({}, 'INPUT_FIELDS'),
    ({'texto': '   '}, 'INPUT_EMPTY'),
    ({'ruta': ''}, 'INPUT_EMPTY'),
    ({'ruta': 'brief.pdf'}, 'INPUT_EXTENSION'),
    ({'ruta': 'no-existe.md'}, 'INPUT_NOT_FOUND'),
    ({'texto': 'x' * 400001}, 'INPUT_TOO_LARGE'),
])
def test_input_codes(native, args, code):
    result = _error(native, args)
    assert result['error_code'] == 'INPUT_ERROR' and result['motivo'] == code
    assert result['todo_verificado'] is False


def test_symlink_code(native, tmp_path):
    real = tmp_path / 'real.md'
    real.write_text('artículo 9999')
    link = tmp_path / 'link.md'
    link.symlink_to(real)
    result = _error(native, {'ruta': str(link)})
    assert result['motivo'] == 'INPUT_SYMLINK'


def test_dir_is_not_found(native, tmp_path):
    (tmp_path / 'd.md').mkdir()
    assert _error(native, {'ruta': str(tmp_path / 'd.md')})['motivo'] == 'INPUT_NOT_FOUND'


def test_bad_encoding(native, tmp_path):
    p = tmp_path / 'latin.md'
    p.write_bytes('año \xf1'.encode('latin-1'))
    assert _error(native, {'ruta': str(p)})['motivo'] == 'INPUT_ENCODING'


def test_integrity_message_survives(native):
    """El marcador estable sigue; ahora con código propio y cómo recuperarse."""
    exc = ValueError('installed corpus integrity mismatch')
    out = native._error_adaptador(exc)
    assert out['error_code'] == 'CORPUS_INTEGRITY_ERROR'
    assert out['error'].startswith('CORPUS_INTEGRITY_ERROR: installed corpus integrity mismatch')
    assert 'plugin-data/dike/generations' in out['error'] and out['todo_verificado'] is False


# ── docx ────────────────────────────────────────────────────────────

def test_docx_e2e(real, tmp_path):
    escrito = _docx_desde_demo(tmp_path)
    out = json.loads(real.verificar_citas({'ruta': str(escrito)}))
    assert out['veredicto'] == 'CON_PROBLEMAS'
    assert out['meta']['total_citas'] == 6 and out['meta']['citas_verificadas'] == 4


def test_docx_too_large(native, tmp_path):
    p = tmp_path / 'big.docx'
    p.write_bytes(b'0' * 10_000_001)
    assert _error(native, {'ruta': str(p)})['motivo'] == 'INPUT_TOO_LARGE'


def test_docx_corrupt(real, tmp_path):
    """Un .docx dañado nunca certifica: el adaptador lo rechaza con INPUT_DOCX
    antes de llegar al motor (la extracción es con la biblioteca estándar)."""
    p = tmp_path / 'roto.docx'
    p.write_bytes(b'no es un zip ni un docx')
    out = json.loads(real.verificar_citas({'ruta': str(p)}))
    assert out['error_code'] == 'INPUT_ERROR' and out['motivo'] == 'INPUT_DOCX'
    assert out['todo_verificado'] is False


def _docx_valido() -> bytes:
    """Zip mínimo con word/document.xml válido (pasa la extracción del adaptador)."""
    import io
    import zipfile
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w') as zf:
        zf.writestr('word/document.xml',
                    '<?xml version="1.0"?><w:document '
                    'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
                    '<w:body><w:p><w:r><w:t>hola</w:t></w:r></w:p></w:body></w:document>')
    return buf.getvalue()


def test_docx_generic_engine_error_not_input_docx(native, tmp_path):
    """Un .docx válido llega al motor como texto; un error genérico del motor
    sigue siendo ENGINE_EXIT_ERROR, no un error de entrada."""
    escrito = tmp_path / 'e.docx'
    escrito.write_bytes(_docx_valido())
    native._dike = lambda *a, **kw: subprocess.CompletedProcess(
        [], 2, '', "Traceback (most recent call last):\n  File 'escrito.docx', line 1\nKeyError: 'x'")
    out = json.loads(native.verificar_citas({'ruta': str(escrito)}))
    assert out['error_code'] == 'ENGINE_EXIT_ERROR' and 'motivo' not in out


def test_fifo_input_not_found_no_block(native, tmp_path):
    import threading
    os.mkfifo(tmp_path / 'x.md')
    out_box = []
    t = threading.Thread(target=lambda: out_box.append(_error(native, {'ruta': str(tmp_path / 'x.md')})))
    t.start(); t.join(timeout=10)
    assert out_box and out_box[0]['motivo'] == 'INPUT_NOT_FOUND'


# ── M5: ruta relativa ───────────────────────────────────────────────

def test_relative_ruta_uses_session_cwd(native, tmp_path):
    (tmp_path / 'rel.md').write_text('artículo 9999 del Código del Trabajo')
    called = {}
    native._dike = lambda *a, **kw: subprocess.CompletedProcess([], 2, '', 'stop')
    native._CTX = type('C', (), {'session_cwd': staticmethod(lambda: str(tmp_path))})()
    result = _error(native, {'ruta': 'rel.md'})
    assert result.get('motivo') != 'INPUT_NOT_FOUND'
    native._CTX = None


def test_relative_ruta_refused_without_session_cwd(native, tmp_path, monkeypatch):
    (tmp_path / 'rel.md').write_text('artículo 9999')
    monkeypatch.chdir(tmp_path)
    native._CTX = type('C', (), {'session_cwd': staticmethod(lambda: '')})()
    try:
        result = _error(native, {'ruta': 'rel.md'})
    finally:
        native._CTX = None
    assert result['error_code'] == 'INPUT_ERROR' and result['motivo'] == 'INPUT_RELATIVE'


def test_relative_ruta_fallback_getcwd(native, tmp_path, monkeypatch):
    (tmp_path / 'rel.md').write_text('artículo 9999')
    monkeypatch.chdir(tmp_path)
    native._CTX = None
    result = _error(native, {'ruta': 'rel.md'})
    assert result.get('motivo') != 'INPUT_NOT_FOUND'


# ── M6: comando ─────────────────────────────────────────────────────

def test_comando_texto(real):
    out = real._comando((ROOT / 'tests/fixtures/escrito_demo.md').read_text())
    lines = out.split('\n')
    assert lines[0].startswith('Diké: 4 de 6 citas verificadas (CON_PROBLEMAS) · corpus ')
    assert sum(1 for l in lines if l.startswith('✓ ')) == 4
    assert any(l.startswith('✗ artículo 60 · AMBIGUOUS') for l in lines)
    assert any(l.startswith('✗ artículo 9999') and 'UNRESOLVABLE' in l for l in lines)
    assert lines[-1].startswith('No certifica que el artículo respalde')


def test_comando_ruta(real, tmp_path):
    p = tmp_path / 'escrito.md'
    p.write_text((ROOT / 'tests/fixtures/escrito_demo.md').read_text())
    out = real._comando(str(p))
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


# ── M2: stat scheme ─────────────────────────────────────────────────

def _install(real):
    return real._asegurar_corpus(real._carpeta_de_datos())


def test_stat_written_and_reused(real):
    inst = _install(real)
    generation = Path(inst['generation'])
    record = json.loads((generation / 'installed.json').read_text())
    assert isinstance(record.get('stat'), dict) and record['stat']
    # second call in-process does not re-hash
    calls = []
    orig = real._hash_archivos_corpus
    real._hash_archivos_corpus = lambda g: (calls.append(1), orig(g))[1]
    real._asegurar_corpus(real._carpeta_de_datos())
    assert calls == []
    real._hash_archivos_corpus = orig


def test_content_tamper_detected_same_process(real):
    inst = _install(real)
    generation = Path(inst['generation'])
    real._asegurar_corpus(real._carpeta_de_datos())  # proceso verificado
    victima = next((generation / 'users').rglob('*.json'))
    original, st = victima.read_bytes(), victima.stat()
    try:
        victima.write_bytes(original + b' ')
        with pytest.raises(ValueError, match='installed corpus integrity mismatch'):
            real._asegurar_corpus(real._carpeta_de_datos())
    finally:
        victima.write_bytes(original)
        os.utime(victima, ns=(st.st_atime_ns, st.st_mtime_ns))


def test_restored_stat_detected_next_process(real):
    """Un cambio que conserva tamaño y mtime solo se detecta al verificar de
    nuevo (proceso nuevo); documenta el límite del cache de stat."""
    inst = _install(real)
    generation = Path(inst['generation'])
    victima = next((generation / 'users').rglob('*.json'))
    original = victima.read_bytes()
    st = victima.stat()
    try:
        data = bytearray(original); data[0] ^= 0xFF          # mismo tamaño
        victima.write_bytes(bytes(data))
        os.utime(victima, ns=(st.st_atime_ns, st.st_mtime_ns))  # mtime restaurado
        real._PROC_VERIFIED.clear()                           # proceso nuevo
        with pytest.raises(ValueError, match='installed corpus integrity mismatch'):
            real._asegurar_corpus(real._carpeta_de_datos())
    finally:
        victima.write_bytes(original)
        os.utime(victima, ns=(st.st_atime_ns, st.st_mtime_ns))


def test_touched_unchanged_refreshes_stat(real):
    inst = _install(real)
    generation = Path(inst['generation'])
    victima = next((generation / 'users').rglob('*.json'))
    import time
    time.sleep(0.01)
    os.utime(victima)                            # solo mtime: contenido intacto
    real._PROC_VERIFIED.clear()
    real._asegurar_corpus(real._carpeta_de_datos())  # full check ok -> stat refreshed
    record = json.loads((generation / 'installed.json').read_text())
    assert record['stat'][str(victima.relative_to(generation))][1] == victima.stat().st_mtime_ns


def test_concurrent_verify_no_deadlock(real):
    from concurrent.futures import ThreadPoolExecutor
    _install(real)
    with ThreadPoolExecutor(4) as pool:
        results = list(pool.map(lambda _: real._asegurar_corpus(real._carpeta_de_datos()), range(8)))
    assert all('generation' in r for r in results)


# ── L4 / L3 ─────────────────────────────────────────────────────────

def test_windows_redaction_not_in_url(native):
    const = {'veredicto': 'TODAS_VERIFICADAS',
             'detalles': [{'estado': 'VERIFICADA', 'cita_raw': 'ver https://x/y',
                           'gid': 'g', 'fuente_url': 'https://u', 'fecha_recuperacion': '2000-01-01T00:00:00+00:00',
                           'resolucion': 'RESOLVED', 'vigencia': 'IN_FORCE',
                           'texto_hash': 'a' * 64, 'estado_texto_historico': 'CURRENT_VERSION_APPLIES'},
                          {'estado': 'VERIFICADA', 'cita_raw': r'C:\Users\x y /home/x/y',
                           'gid': 'g2', 'fuente_url': 'https://u', 'fecha_recuperacion': '2000-01-01T00:00:00+00:00',
                           'resolucion': 'RESOLVED', 'vigencia': 'IN_FORCE',
                           'texto_hash': 'b' * 64, 'estado_texto_historico': 'CURRENT_VERSION_APPLIES'}],
             'citation_disclosure': {'no_verificadas': [], 'advertencias': []},
             'meta': {'as_of': '2000-01-01', 'fecha_constancia': '2000-01-01T00:00:00+00:00',
                      'pack_hash': native.PACK_HASH, 'total_citas': 2,
                      'citas_verificadas': 2, 'citas_fallidas': 0},
             'problemas': [], 'alcance': 'x', 'mensaje': 'm'}
    out = native._salida_publica(const)
    raws = [d['cita_raw'] for d in out['detalles']]
    assert 'ver https://x/y' in raws[0]
    assert raws[1] == '<ruta-local> y <ruta-local>'


def test_carpeta_falls_back_only_on_importerror(monkeypatch):
    import builtins
    spec = importlib.util.spec_from_file_location('native_l3', ROOT / '__init__.py')
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    real_import = builtins.__import__
    def boom(name, *a, **kw):
        if name == 'plugins.plugin_storage':
            raise RuntimeError('not an import problem')
        return real_import(name, *a, **kw)
    monkeypatch.setattr(builtins, '__import__', boom)
    with pytest.raises(RuntimeError):
        m._carpeta_de_datos()
