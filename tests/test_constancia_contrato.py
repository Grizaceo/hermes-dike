"""Contrato de citas verificadas y evidencia coherente."""
import json
import subprocess

import pytest
from soporte_adaptador import native, _green_payload, call


def test_green_path_verified(native, monkeypatch):
    """Positive control: a valid green envelope passes and sets todo_verificado=True."""
    monkeypatch.setattr(
        native, '_dike',
        lambda *a, **kw: subprocess.CompletedProcess([], 0, json.dumps(_green_payload()), ''),
    )
    result = json.loads(native.verificar_citas({'texto': 'art. 161 del Código del Trabajo'}))
    assert 'error' not in result
    assert result['veredicto'] == 'TODAS_VERIFICADAS'
    assert result['todo_verificado'] is True
    assert result['no_verificadas'] == []


def test_green_problemas_nonempty_rejected(native, monkeypatch):
    """TODAS_VERIFICADAS with non-empty problemas must be rejected."""
    payload = _green_payload()
    payload['problemas'] = ['unexpected issue']
    monkeypatch.setattr(
        native, '_dike',
        lambda *a, **kw: subprocess.CompletedProcess([], 0, json.dumps(payload), ''),
    )
    result = json.loads(native.verificar_citas({'texto': 'art. 161 del Código del Trabajo'}))
    assert 'error' in result
    assert result['todo_verificado'] is False


def test_green_as_of_must_be_today(native, monkeypatch):
    """as_of must match today's date for green results."""
    payload = _green_payload()
    payload['meta']['as_of'] = "2020-01-01"
    monkeypatch.setattr(
        native, '_dike',
        lambda *a, **kw: subprocess.CompletedProcess([], 0, json.dumps(payload), ''),
    )
    result = json.loads(native.verificar_citas({'texto': 'art. 161'}))
    assert 'error' in result
    assert result['todo_verificado'] is False


def test_green_pin_pack_hash_preserved(native, monkeypatch):
    """pack_hash must match the expected pinned value."""
    payload = _green_payload()
    monkeypatch.setattr(
        native, '_dike',
        lambda *a, **kw: subprocess.CompletedProcess([], 0, json.dumps(payload), ''),
    )
    result = json.loads(native.verificar_citas({'texto': 'art. 161'}))
    assert 'error' not in result
    assert result['meta']['pack_hash'] == 'af1422d66d1e6eee'


def test_unknown_verdict_rejected(native, monkeypatch):
    """An unknown verdict must not produce a green result."""
    payload = _green_payload()
    payload['veredicto'] = "UNKNOWN_VERDICT"
    monkeypatch.setattr(
        native, '_dike',
        lambda *a, **kw: subprocess.CompletedProcess([], 0, json.dumps(payload), ''),
    )
    result = json.loads(native.verificar_citas({'texto': 'art. 161'}))
    assert 'error' in result


@pytest.mark.parametrize('mencion', ['Código', 'Ley 99.999'])
def test_scoped_message_and_detected_citations_flag(native, monkeypatch, mencion):
    p = _green_payload()
    p['citation_disclosure']['no_verificadas'] = [mencion]
    r = call(native, monkeypatch, p)
    assert r['todas_citas_detectadas_verificadas'] is True
    assert r['todo_verificado'] is False
    assert r['no_verificadas'] == [mencion]
    assert r['mensaje'] != p['mensaje']
    assert r['mensaje'] == native._t('summary.verified')
    assert r['mensaje_motor'] == p['mensaje']


@pytest.mark.parametrize('value', [None, '', {}, [42]])
def test_disclosure_not_optional_or_wrong_type(native, monkeypatch, value):
    p = _green_payload()
    if value is None: p['citation_disclosure'].pop('no_verificadas')
    else: p['citation_disclosure']['no_verificadas'] = value
    assert 'error' in call(native, monkeypatch, p)


@pytest.mark.parametrize('key,bad', [
    ('resolucion', ''), ('resolucion', 'UNRESOLVED'),
    ('vigencia', 'OUT_OF_FORCE'),
    ('estado_texto_historico', 'EVIDENCE_UNAVAILABLE'),
    ('estado_texto_historico', 'HISTORICAL_TEXT_UNAVAILABLE'),
    ('fecha_recuperacion', 'not-a-date'),
])
def test_verified_requires_exact_evidence_invariants(native, monkeypatch, key, bad):
    p = _green_payload()
    p['detalles'][0][key] = bad
    r = call(native, monkeypatch, p)
    assert 'error' in r and r['todo_verificado'] is False
