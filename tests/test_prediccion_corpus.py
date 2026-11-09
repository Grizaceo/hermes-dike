"""Test de GET /prediccion/corpus con un corpus SINTÉTICO mínimo.

Nunca toca el corpus real ni la generación sellada del usuario: la
generación es un tmp_path con artículos de juguete.
"""
import importlib.util
import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
DASH = ROOT / 'dashboard'


@pytest.fixture(scope='module')
def api():
    pytest.importorskip('fastapi')
    spec = importlib.util.spec_from_file_location(
        'dike_plugin_api_pred', DASH / 'plugin_api.py')
    m = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = m
    try:
        spec.loader.exec_module(m)
    except Exception:
        sys.modules.pop(spec.name, None)
        raise
    return m


TEXTO_LARGO = ('El tribunal deberá pronunciarse sobre las pretensiones ' +
    'deducidas y las excepciones opuestas por las partes en el presente ' +
    'juicio laboral.') * 6


@pytest.fixture
def corpus(api, monkeypatch, tmp_path):
    """Generación sintética: dos artículos con textos de juguete."""
    gen = tmp_path / 'generations' / 'gen-sintetica'
    arts = gen / 'users' / 'h' / 'starter' / 'base' / 'current' / 'articulos'
    arts.mkdir(parents=True)
    (arts / 'articulo_0001_art_0001.json').write_text(json.dumps({
        '@id': 'https://dike.invalid/eli/cl/ley/0/art_0001',
        'text': 'Artículo 1.- ' + TEXTO_LARGO,
        'textSha256': 'a' * 64,
        'provenance': {'sourceUrl': 'https://oficial.invalid/ley0'},
    }))
    (arts / 'articulo_0001_art_0002.json').write_text(json.dumps({
        '@id': 'https://dike.invalid/eli/cl/ley/0/art_0002',
        'text': 'Artículo 2.- Cosa distinta sin relación alguna.',
        'textSha256': 'b' * 64,
        'provenance': {},
    }))
    mod = type('M', (), {
        '_carpeta_de_datos': staticmethod(lambda: tmp_path),
        '_asegurar_corpus': staticmethod(
            lambda _d: {'generation': str(gen)}),
    })()
    monkeypatch.setattr(api, '_adaptador', lambda: mod)
    api._indice_cache.clear()
    api._corpus_memo.clear()
    return gen


def test_continuacion_literal(api, corpus):
    r = api.prediccion_corpus(cola='pronunciarse sobre las pretensiones')
    assert r['continuacion']
    assert len(r['continuacion']) <= 200
    assert r['gid'].endswith('art_0001')
    assert r['sha256'] == 'a' * 64
    assert r['fuente_url'] == 'https://oficial.invalid/ley0'
    # la continuación es literal del artículo (cortada en límite de palabra)
    assert ' ' not in (r['continuacion'][:1])
    original = 'Artículo 1.- ' + TEXTO_LARGO
    assert r['continuacion'] in original


def test_ancla_mas_larga(api, corpus):
    # la cola completa no aparece; el sufijo final sí
    r = api.prediccion_corpus(
        cola='palabras previas inexistentes deducidas y las excepciones')
    assert r['continuacion']
    assert r['ancla'] == 'deducidas y las excepciones'


def test_cola_vacia_y_larga(api, corpus):
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as e:
        api.prediccion_corpus(cola='   ')
    assert e.value.status_code == 400
    with pytest.raises(HTTPException) as e:
        api.prediccion_corpus(cola='x ' * 200)
    assert e.value.status_code == 400


def test_sin_coincidencia(api, corpus):
    assert api.prediccion_corpus(cola='zzzz nada que ver aqui') == {
        'continuacion': ''}


def test_no_escribe_en_generacion(api, corpus):
    antes = {str(p) for p in corpus.rglob('*')}
    api.prediccion_corpus(cola='pretensiones deducidas')
    despues = {str(p) for p in corpus.rglob('*')}
    assert antes == despues


def test_evento_sin_contenido(api, corpus, tmp_path):
    api.prediccion_evento({'capa': 'L0', 'aceptada': True, 'largo': 12,
                           'procedencia': {'tipo': 'formalismo'}})
    ruta = tmp_path / 'prediccion' / 'eventos.jsonl'
    assert ruta.exists()
    linea = json.loads(ruta.read_text().strip())
    assert set(linea) == {'ts', 'capa', 'aceptada', 'largo', 'tipo'}
    assert linea['capa'] == 'L0' and linea['tipo'] == 'formalismo'


def test_mapa_exacto_con_unicode(api, corpus, tmp_path):
    """La continuación es EXACTAMENTE original[fin_original:] — tildes, ñ,
    'º', guiones largos y espacios múltiples no la desplazan."""
    gen = corpus
    arts = gen / 'users' / 'h' / 'starter' / 'base' / 'current' / 'articulos'
    original = ('Artículo 3º.— En atención á ésto,   el señor Ñuñoa '
                'deberá —si así lo estima— señalar la fecha.')
    (arts / 'articulo_0002_art_0003.json').write_text(json.dumps({
        '@id': 'https://dike.invalid/eli/cl/ley/0/art_0003',
        'text': original,
        'textSha256': 'c' * 64,
        'provenance': {},
    }))
    api._indice_cache.clear()
    r = api.prediccion_corpus(cola='en atencion a esto')
    # fin_original exacto: tras 'ésto' — la ',' literal queda incluida
    esperado = original[original.index('ésto') + len('ésto'):].lstrip()
    assert r['continuacion'] == esperado
    assert r['continuacion'].startswith(',   el señor Ñuñoa')


def test_ancla_dentro_de_palabra_no_acierta(api, corpus):
    """'retensiones' existe solo DENTRO de 'pretensiones': sin límite de
    palabra no hay acierto."""
    assert api.prediccion_corpus(cola='retensiones') == {
        'continuacion': ''}
