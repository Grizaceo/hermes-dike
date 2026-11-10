"""Fecha de invocación y antigüedad de las fuentes del contrato de constancia."""
from soporte_adaptador import native, _green_payload, call
import copy
from datetime import date, timedelta

def test_temporal_evidence_reports_each_source_age(native, monkeypatch):
    p = _green_payload()
    second = copy.deepcopy(p['detalles'][0])
    second['gid'] = 'cl.norma.ct:art:0162'  # forma válida: el contrato rechaza gid inventados
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
