"""Synthetic packages only: exercise installation state, not legal verification."""
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import tarfile
import time
from concurrent.futures import ThreadPoolExecutor


def setup_runtime(tmp_path, monkeypatch):
    spec = importlib.util.spec_from_file_location('installation_test', Path(__file__).parents[1] / '__init__.py')
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    corpus = tmp_path / 'corpus'
    corpus.mkdir()
    monkeypatch.setattr(m, '_CORPUS', corpus)
    return m, corpus, tmp_path / 'data'


def package(corpus, version):
    target = corpus / 'test.tar.gz'
    with tarfile.open(target, 'w:gz') as tar:
        data = version.encode()
        info = tarfile.TarInfo('chile-base/input.txt')
        info.size = len(data)
        tar.addfile(info, io.BytesIO(data))
    digest = hashlib.sha256(target.read_bytes()).hexdigest()
    (corpus / 'SHA256SUMS').write_text(f'{digest}  test.tar.gz\n')
    return digest


def installer(counter):
    def run(args, stage):
        counter.append(str(stage))
        time.sleep(.03)
        base = stage / 'users/hermes/starter/chile-base'
        snapshot = base / 'snapshots/test'
        snapshot.mkdir(parents=True)
        (snapshot / 'norm.json').write_text('{}')
        (base / 'STATE.json').write_text(json.dumps({'snapshot': str(snapshot)}))
        return subprocess.CompletedProcess([], 0, '{}', '')
    return run


def test_concurrent_install_publishes_once(tmp_path, monkeypatch):
    m, corpus, data = setup_runtime(tmp_path, monkeypatch)
    digest = package(corpus, 'v1')
    calls = []
    monkeypatch.setattr(m, '_dike', installer(calls))
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: m._asegurar_corpus(data), range(2)))
    assert len(calls) == 1
    assert results[0] == results[1]
    assert Path(results[0]['generation']).name == digest
    state = json.loads(next((data / 'generations').glob('*/users/**/STATE.json')).read_text())
    assert 'staging-' not in state['snapshot']
    assert Path(state['snapshot']).is_dir()


def test_update_creates_new_generation(tmp_path, monkeypatch):
    m, corpus, data = setup_runtime(tmp_path, monkeypatch)
    calls = []
    monkeypatch.setattr(m, '_dike', installer(calls))
    first = package(corpus, 'v1')
    m._asegurar_corpus(data)
    second = package(corpus, 'v2')
    result = m._asegurar_corpus(data)
    assert first != second
    assert Path(result['generation']).name == second
    assert len(calls) == 2
    assert (data / 'generations' / first).is_dir()


def test_failed_install_is_not_published_and_can_retry(tmp_path, monkeypatch):
    import pytest
    m, corpus, data = setup_runtime(tmp_path, monkeypatch)
    digest = package(corpus, 'v1')
    monkeypatch.setattr(m, '_dike', lambda *a: subprocess.CompletedProcess([], 2, '{}', 'failure'))
    with pytest.raises(subprocess.CalledProcessError):
        m._asegurar_corpus(data)
    assert not (data / 'generations' / digest).exists()
    assert not list((data / 'generations').glob('staging-*'))
    monkeypatch.setattr(m, '_dike', installer([]))
    assert Path(m._asegurar_corpus(data)['generation']).is_dir()


def test_package_tamper_rejected_even_when_installed(tmp_path, monkeypatch):
    import pytest
    m, corpus, data = setup_runtime(tmp_path, monkeypatch)
    package(corpus, 'v1')
    calls = []
    monkeypatch.setattr(m, '_dike', installer(calls))
    m._asegurar_corpus(data)
    with (corpus / 'test.tar.gz').open('ab') as file:
        file.write(b'corruption')
    with pytest.raises(ValueError, match='checksum mismatch'):
        m._asegurar_corpus(data)
    assert len(calls) == 1
