"""Integridad del corpus con una generación privada para pruebas de alteración."""
import importlib.util
import json
import os
from pathlib import Path
import pytest
ROOT = Path(__file__).parents[1]

@pytest.fixture(scope='module')
def real(corpus_privado):
    spec = importlib.util.spec_from_file_location('native_real_rev', ROOT / '__init__.py')
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    datos = corpus_privado
    m._carpeta_de_datos = lambda: datos
    m._asegurar_corpus(datos)  # instala una sola vez por módulo
    return m


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
