"""«Llevar al escrito»: la cita canónica de cada resultado de búsqueda.

``panel._cita_de`` genera la forma «artículo N [sufijo [letra]] del/de la
<cuerpo>» que la gramática del verificador (``norm_reference``) reconoce y
comprueba —con el resolver real o un stub— que resuelve AL MISMO gid. Si no
hay forma válida devuelve ``(None, motivo)``: fail-closed, nunca una cita que
verifique otro artículo.

El mini-corpus es el mismo de ``test_busqueda`` (Código del Trabajo
sintético): ``buscar`` debe devolver ``cita`` y ``vigencia`` en cada
resultado.
"""
import importlib.util
import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).parents[1]
PANEL = ROOT / 'scripts' / 'panel.py'
SCRIPTS = ROOT / 'scripts'
MOTOR = ROOT / 'motor'

for _p in (str(SCRIPTS), str(MOTOR)):
    if _p not in sys.path:
        sys.path.insert(0, _p)

from lexo_cli.starter.resolver import NormativeResolutionError  # noqa: E402
from soporte_busqueda import _articulo_json, _esbuild_ascii, NORM_ID  # noqa: E402


class _ResolverFalso:
    """Mínimo que ``resolve_norm_reference`` necesita: ``_aliases`` y
    ``resolve(gid)`` que tiene o lanza ``NormativeResolutionError``."""

    def __init__(self, gids, aliases=None):
        self._by_gid = {g: object() for g in gids}
        self._aliases = aliases or {}

    def resolve(self, gid):
        if gid in self._by_gid:
            return self._by_gid[gid]
        raise NormativeResolutionError('UNRESOLVABLE_GID', gid, 'sin mapping')


@pytest.fixture(scope='module')
def panel_mod():
    spec = importlib.util.spec_from_file_location('dike_panel_cita', PANEL)
    m = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = m
    spec.loader.exec_module(m)
    return m


# alias del catálogo para los cuerpos de prueba (_alias_for_code)
_ALIASES = {
    '172986': 'cc',        # Código Civil
    '207436': 'ct',        # Código del Trabajo
    '22740': 'cpc',        # Código de Procedimiento Civil
    '1058072': 'ley_20720',
    '999001': 'cpr',       # Constituzión (valor alias)
    '999002': 'cpp',       # Código Procesal Penal (valor alias)
}


def _resolver(gids):
    return _ResolverFalso(gids, _ALIASES)


# ---------------------------------------------------------------------------
# _cita_de: formas por tipo de norma
# ---------------------------------------------------------------------------

def test_cita_de_codigo(panel_mod):
    r = _resolver(['cl.norma.cc:art:0150'])
    cita, motivo = panel_mod._cita_de('cl.norma.cc:art:0150', r)
    assert motivo is None
    assert cita == 'artículo 150 del Código Civil'


def test_cita_de_ley(panel_mod):
    r = _resolver(['cl.norma.ley_20720:art:0010'])
    cita, motivo = panel_mod._cita_de('cl.norma.ley_20720:art:0010', r)
    assert motivo is None
    assert cita == 'artículo 10 de la Ley 20.720'


def test_cita_de_constitucion(panel_mod):
    r = _resolver(['cl.norma.cpr:art:0001'])
    cita, motivo = panel_mod._cita_de('cl.norma.cpr:art:0001', r)
    assert motivo is None
    assert cita == 'artículo 1 de la Constitución Política'


def test_cita_de_sufijos(panel_mod):
    r = _resolver([
        'cl.norma.ct:art:0199_bis',
        'cl.norma.ct:art:0228_ter',
        'cl.norma.cpp:art:0152_quater_g',
    ])
    cita, motivo = panel_mod._cita_de('cl.norma.ct:art:0199_bis', r)
    assert (cita, motivo) == ('artículo 199 bis del Código del Trabajo', None)
    cita, motivo = panel_mod._cita_de('cl.norma.ct:art:0228_ter', r)
    assert (cita, motivo) == ('artículo 228 ter del Código del Trabajo', None)
    # sufijo + letra individualizadora («152 quáter G»)
    cita, motivo = panel_mod._cita_de('cl.norma.cpp:art:0152_quater_g', r)
    assert (cita, motivo) == (
        'artículo 152 quater g del Código Procesal Penal', None)


def test_cita_de_transitorio(panel_mod):
    r = _resolver(['cl.norma.ley_20720:art:t_0001'])
    cita, motivo = panel_mod._cita_de('cl.norma.ley_20720:art:t_0001', r)
    assert motivo is None
    assert cita == 'artículo transitorio 1 de la Ley 20.720'


def test_cita_de_nulls(panel_mod):
    r = _resolver(['cl.norma.ley_19496:art:0001'])
    # letra desnuda: la gramática la confundiría con el numeral base
    cita, motivo = panel_mod._cita_de('cl.norma.ley_19496:art:0054_a', r)
    assert cita is None and 'letrado' in motivo
    # artículo inexistente en el corpus: la forma se genera pero no resuelve
    cita, motivo = panel_mod._cita_de('cl.norma.cc:art:9999', r)
    assert cita is None and 'no resolvió' in motivo
    # gid sin forma runtime
    cita, motivo = panel_mod._cita_de('no-es-un-gid', r)
    assert cita is None and motivo
    # alias sin cuerpo de cita canónico
    cita, motivo = panel_mod._cita_de('cl.norma.raro_x:art:0001', r)
    assert cita is None and motivo


def test_cita_de_sin_resolver_devuelve_forma(panel_mod):
    """resolver=None: forma sin verificar (solo inspección; buscar siempre
    pasa resolver)."""
    cita, motivo = panel_mod._cita_de('cl.norma.cc:art:0236')
    assert (cita, motivo) == ('artículo 236 del Código Civil', None)


# ---------------------------------------------------------------------------
# buscar() devuelve cita y vigencia en el mini-corpus
# ---------------------------------------------------------------------------

ARTICULOS = [
    ('art_0001', '1',
     'El trabajador despedido tiene derecho a indemnización por años de servicio.\n'
     'La indemnización se calcula conforme a la remuneración y la antigüedad.\n'
     'El empleador debe pagar dentro del plazo legal.'),
]


def _mini_corpus(users_root: Path) -> Path:
    current = users_root / 'test' / 'starter' / 'mini' / 'current'
    (current / 'normas').mkdir(parents=True)
    (current / 'articulos').mkdir(parents=True)
    (current / 'normas' / 'norma_207436.json').write_text(json.dumps({
        '@type': 'LegalResource',
        '@id': NORM_ID,
        'leychileCode': '207436',
        'eli': {'type': 'codigo', 'number': 'codigo-del-trabajo'},
        'title': 'FIJA EL TEXTO DEL CODIGO DEL TRABAJO',
        'sourceDocumentUrl': 'https://x.test/ct',
    }), encoding='utf-8')
    for eid, label, texto in ARTICULOS:
        (current / 'articulos' / f'articulo_207436_{eid}.json').write_text(
            json.dumps(_articulo_json(eid, label, texto), ensure_ascii=False),
            encoding='utf-8')
    return current


@pytest.fixture()
def cache_a_tmp(tmp_path, monkeypatch):
    monkeypatch.setenv('HOME', str(tmp_path / 'home'))
    monkeypatch.setenv('DIKE_BINDING_CACHE_DIR',
                       str(tmp_path / 'home' / '.dike' / 'binding_cache'))
    return tmp_path


def test_buscar_devuelve_cita_y_vigencia(panel_mod, cache_a_tmp):
    current = _mini_corpus(cache_a_tmp / 'users')
    out = panel_mod.buscar('despido indemnización', limite=10,
                           corpus_dirs=[current])
    assert out['resultados'], out
    r = out['resultados'][0]
    assert r['gid'] == 'cl.norma.ct:art:0001'
    # La cita es la forma canónica y el resolver del mini-corpus la valida.
    assert r['cita'] == 'artículo 1 del Código del Trabajo'
    assert r['cita_motivo'] is None
    # Vigencia: la ventana sintética (from 2020-01-01) está en vigor.
    assert r['vigencia'] == {'estado': 'IN_FORCE', 'motivo': None}


def test_bundle_contiene_textos_llevar():
    """El bundle compilado lleva el botón y los textos de ayuda."""
    texto = (ROOT / 'desktop' / 'plugin.js').read_text(encoding='utf-8')
    for literal in (
        'Llevar al escrito',
        'entra como cita sin verificar; el verificador la revisa',
        'el verificador la marcará FALLO: el artículo no está vigente',
        'llegó desde la búsqueda (pista)',
        'Cita traída desde la búsqueda: es una pista; se está verificando.',
    ):
        assert literal in texto or _esbuild_ascii(literal) in texto, literal
