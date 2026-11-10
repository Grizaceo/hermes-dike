"""Abstenciones y menciones sin artículo del contrato de constancia."""
import json
import subprocess

import pytest
from soporte_adaptador import native, _sin_citas_payload, _sin_corpus_payload, call


def test_sin_citas_code0_never_verified(native, monkeypatch):
    """A text without article citations returns SIN_CITAS, code 0.

    The engine's real output has no 'problemas' or 'alcance' fields and no
    citation counts in meta. The adapter must accept it as a valid non-verde
    result, not reject it as a contract error.
    """
    payload = _sin_citas_payload()
    monkeypatch.setattr(
        native, '_dike',
        lambda *a, **kw: subprocess.CompletedProcess([], 0, json.dumps(payload), ''),
    )
    result = json.loads(native.verificar_citas({'texto': 'La Ley 19.496 y el Código Civil.'}))
    assert 'error' not in result
    assert result['veredicto'] == 'SIN_CITAS'
    assert result['todo_verificado'] is False
    assert result['certificacion_sustantiva'] is False
    # Disclosure preserved with no_verificadas at top level ()
    assert result['no_verificadas'] == ['Ley 19.496', 'Código Civil']
    assert result['citation_disclosure']['no_verificadas'] == ['Ley 19.496', 'Código Civil']


def test_sin_corpus_code1_never_verified(native, monkeypatch):
    """SIN_CORPUS (code 1) must also be accepted, not rejected."""
    payload = _sin_corpus_payload()
    monkeypatch.setattr(
        native, '_dike',
        lambda *a, **kw: subprocess.CompletedProcess([], 1, json.dumps(payload), ''),
    )
    result = json.loads(native.verificar_citas({'texto': 'art. 9999 del Código Civil'}))
    assert 'error' not in result
    assert result['veredicto'] == 'SIN_CORPUS'
    assert result['todo_verificado'] is False
    assert result['certificacion_sustantiva'] is False


@pytest.mark.parametrize('verdict,code', [('SIN_CITAS', 0), ('SIN_CORPUS', 1)])
@pytest.mark.parametrize('mutation', ['missing_details', 'date', 'timestamp', 'pack', 'message'])
def test_abstention_real_shape_validation(native, monkeypatch, verdict, code, mutation):
    p = _sin_citas_payload() if verdict == 'SIN_CITAS' else _sin_corpus_payload()
    if mutation == 'missing_details': p.pop('detalles')
    elif mutation == 'date': p['meta']['as_of'] = 'invalid'
    elif mutation == 'timestamp': p['meta']['fecha_constancia'] = 'invalid'
    elif mutation == 'pack': p['meta']['pack_hash'] = 'wrong-pack'
    elif mutation == 'message': p.pop('mensaje')
    assert 'error' in call(native, monkeypatch, p, code)
