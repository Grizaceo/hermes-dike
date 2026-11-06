"""Parent acceptance tests. Synthetic contract faults are explicitly injected."""
import copy
import json
import subprocess
from datetime import date, timedelta

import pytest
from test_p2_1_green import native, _green_payload
from test_p1_fixes import _sin_citas_payload, _sin_corpus_payload


def call(native, monkeypatch, payload, code=0):
    monkeypatch.setattr(native, '_dike', lambda *a, **kw: subprocess.CompletedProcess([], code, json.dumps(payload), ''))
    return json.loads(native.verificar_citas({'texto': 'artículo 161'}))


def test_scoped_message_and_detected_citations_flag(native, monkeypatch):
    p = _green_payload()
    p['citation_disclosure']['no_verificadas'] = ['Ley 99.999']
    r = call(native, monkeypatch, p)
    assert r['todas_citas_detectadas_verificadas'] is True
    assert r['todo_verificado'] is False
    assert r['mensaje'] != p['mensaje']
    assert 'detectadas' in r['mensaje']
    assert r['mensaje_motor'] == p['mensaje']


@pytest.mark.parametrize('key,bad', [('resolucion', ''), ('estado_texto_historico', 'EVIDENCE_UNAVAILABLE'), ('fecha_recuperacion', 'not-a-date')])
def test_verified_requires_exact_evidence_invariants(native, monkeypatch, key, bad):
    p = _green_payload()
    p['detalles'][0][key] = bad
    r = call(native, monkeypatch, p)
    assert 'error' in r and r['todo_verificado'] is False


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


@pytest.mark.parametrize('value', [None, '', {}, [42]])
def test_disclosure_not_optional_or_wrong_type(native, monkeypatch, value):
    p = _green_payload()
    if value is None: p['citation_disclosure'].pop('no_verificadas')
    else: p['citation_disclosure']['no_verificadas'] = value
    assert 'error' in call(native, monkeypatch, p)


def test_temporal_evidence_reports_each_source_age(native, monkeypatch):
    p = _green_payload()
    second = copy.deepcopy(p['detalles'][0])
    second['gid'] = 'synthetic:second'
    second['fecha_recuperacion'] = '2026-08-14T00:00:00Z'
    p['detalles'].append(second)
    p['meta'].update(total_citas=2, citas_verificadas=2)
    r = call(native, monkeypatch, p)
    assert r['certificacion_vigencia_actual'] is False
    refs = r['evidencia_temporal']
    assert len(refs) == 2
    assert refs[0]['antiguedad_dias'] == (date.today() - date(2026, 8, 13)).days
    assert refs[1]['fecha_recuperacion'] == second['fecha_recuperacion']


def test_invocation_date_valid_across_midnight(native, monkeypatch):
    p = _green_payload()
    yesterday = (date.today() - timedelta(days=1)).isoformat()
    p['meta']['as_of'] = yesterday
    assert native._validar_constancia(p, 0, as_of=yesterday) == p


def test_arbitrary_exception_text_not_forwarded(native, monkeypatch):
    def bad(*a): raise OSError('/opt/private/customer.txt unlabelled-SENTINEL')
    monkeypatch.setattr(native, '_asegurar_corpus', bad)
    r = json.loads(native.verificar_citas({'texto': 'artículo 161'}))
    assert 'error' in r
    assert '/opt/' not in json.dumps(r) and 'unlabelled-SENTINEL' not in json.dumps(r)


def test_stderr_is_classified_not_replayed(native, monkeypatch):
    monkeypatch.setattr(native, '_dike', lambda *a, **kw: subprocess.CompletedProcess([], 2, '', 'unlabelled-SENTINEL /opt/private/customer.txt'))
    r = json.loads(native.verificar_citas({'texto': 'artículo 161'}))
    assert 'ENGINE_EXIT_ERROR' in r['error']
    assert 'unlabelled-SENTINEL' not in json.dumps(r) and '/opt/' not in json.dumps(r)


def test_nonzero_exit_valid_json_is_engine_error(native, monkeypatch):
    r = call(native, monkeypatch, _green_payload(), code=2)
    assert 'ENGINE_EXIT_ERROR' in r['error']


def test_install_dependency_error_is_safe_and_specific(native, monkeypatch):
    def bad(*a):
        raise subprocess.CalledProcessError(1, ['synthetic-command'], stderr='ModuleNotFoundError: no dependency /opt/private unlabelled-SENTINEL')
    monkeypatch.setattr(native, '_asegurar_corpus', bad)
    r = json.loads(native.verificar_citas({'texto': 'artículo 161'}))
    assert 'dependencia' in r['error']
    assert 'unlabelled-SENTINEL' not in r['error']
