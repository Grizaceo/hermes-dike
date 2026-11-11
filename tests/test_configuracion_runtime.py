"""Configuración del runtime, dependencias del intérprete y estado del plugin."""
import importlib.util
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent


@pytest.fixture(scope='module')
def mod():
    spec = importlib.util.spec_from_file_location('dike_parte3_test', ROOT / '__init__.py')
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def test_modulos_compartidos_son_por_copia(mod, modulo_de_la_copia):
    """El adaptador y la réplica de conftest dan el mismo objeto, con nombre por copia."""
    import sys
    aisla = mod._aislamiento()
    assert aisla is modulo_de_la_copia('dike_aislamiento', ROOT / 'aislamiento.py')
    assert aisla.__name__.startswith('dike_aislamiento_')
    assert 'dike_aislamiento' not in sys.modules or sys.modules['dike_aislamiento'] is not aisla


def test_otra_copia_cargada_antes_no_contamina(monkeypatch):
    """Regresión: en el multiplexor de Hermes, un perfil con otra versión del
    plugin dejaba su ``aislamiento`` en ``sys.modules['dike_aislamiento']`` y la
    copia nueva fallaba al importar (sin ``establecer_politica``)."""
    import sys
    import types
    viejo = types.ModuleType('dike_aislamiento')
    viejo.MODULOS_MEDIDOS = ()
    monkeypatch.setitem(sys.modules, 'dike_aislamiento', viejo)
    monkeypatch.setitem(sys.modules, 'dike_textos', types.ModuleType('dike_textos'))
    spec = importlib.util.spec_from_file_location('dike_copia_nueva_test', ROOT / '__init__.py')
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    assert m._aislamiento() is not viejo
    assert hasattr(m._aislamiento(), 'establecer_politica')
    assert m._t('status.unknown')


def test_misma_ruta_otra_version_y_otra_ruta_cargan_modulos_distintos(mod, tmp_path):
    import os
    a, b = tmp_path / 'a' / 'm.py', tmp_path / 'b' / 'm.py'
    for f in (a, b):
        f.parent.mkdir()
        f.write_text('VALOR = 1\n')
    ma, mb = mod._modulo_de_esta_copia('dike_prueba', a), mod._modulo_de_esta_copia('dike_prueba', b)
    assert ma is not mb and ma is mod._modulo_de_esta_copia('dike_prueba', a)
    # Actualización en el lugar: mismo archivo, otro contenido → módulo nuevo.
    a.write_text('VALOR = 22\n')
    os.utime(a, ns=(a.stat().st_atime_ns, a.stat().st_mtime_ns + 1_000_000))
    assert mod._modulo_de_esta_copia('dike_prueba', a).VALOR == 22


def test_carga_fallida_no_deja_modulo_a_medias(mod, tmp_path):
    import sys
    f = tmp_path / 'roto.py'
    f.write_text('A = 1\nraise RuntimeError("a medias")\n')
    with pytest.raises(RuntimeError):
        mod._modulo_de_esta_copia('dike_roto', f)
    assert not [n for n in sys.modules if n.startswith('dike_roto_')]


def test_paquetes_del_anfitrion_usa_find_spec(mod, tmp_path, monkeypatch):
    # Un módulo cuyo find_spec apunta a un dir SIN 'site-packages' en el nombre.
    pkg = tmp_path / 'paquetes-raros'
    pkg.mkdir()
    (pkg / 'yaml.py').write_text('')
    real = importlib.util.find_spec

    class _Spec:
        origin = str(pkg / 'yaml.py')
        submodule_search_locations = None

    def fake_find(name):
        if name == 'yaml':
            return _Spec()
        return real(name)

    monkeypatch.setattr(importlib.util, 'find_spec', fake_find)
    carpetas = mod._paquetes_del_anfitrion()
    assert str(pkg) in carpetas
    # dedup + orden: no repite la misma carpeta
    assert len(carpetas) == len(set(carpetas))


def test_paquetes_del_anfitrion_sin_spec_no_falla(mod, monkeypatch):
    monkeypatch.setattr(importlib.util, 'find_spec', lambda n: None)
    assert mod._paquetes_del_anfitrion() == []


def test_paquetes_del_anfitrion_ignora_modulos_propios(mod):
    # lexo_cli/dike_id/shared/canal_arbol son del plugin: no deben consultarse.
    carpetas = mod._paquetes_del_anfitrion()
    assert isinstance(carpetas, list)


class _Ctx:
    def __init__(self, valor=None, error=None):
        self.valor, self.error = valor, error

    def get_config(self, key, default=None):
        if self.error is not None:
            raise self.error
        return self.valor if self.valor is not None else default


def test_setting_con_ctx_propaga_error(mod, monkeypatch):
    monkeypatch.setattr(mod, '_CTX', _Ctx(error=RuntimeError('config rota')))
    with pytest.raises(RuntimeError):
        mod._setting('sandbox', 'auto')


def test_setting_con_ctx_devuelve_valor(mod, monkeypatch):
    monkeypatch.setattr(mod, '_CTX', _Ctx(valor='requerido'))
    assert mod._setting('sandbox', 'auto') == 'requerido'


def test_setting_sin_ctx_importerror_devuelve_default(mod, monkeypatch):
    monkeypatch.setattr(mod, '_CTX', None)
    monkeypatch.setitem(__import__('sys').modules, 'hermes_cli.config', None)
    assert mod._setting('sandbox', 'auto') == 'auto'


@pytest.mark.parametrize('config, esperado', [
    ({'plugins': {'entries': {'dike': {'settings': {'sandbox': 'requerido'}}}}}, 'requerido'),
    ({'plugins': {'entries': {'dike': {'settings': {}}}}}, 'auto'),
    ({'plugins': {'entries': {'otro': {'settings': {'sandbox': 'requerido'}}}}}, 'auto'),
    ({'plugins': {'entries': ['no', 'mapa']}}, 'auto'),
    ({'plugins': None}, 'auto'),
    (None, 'auto'),
])
def test_setting_sin_ctx_lee_la_config_publica(mod, monkeypatch, config, esperado):
    """Sin ctx (dashboard) se lee plugins.entries.dike.settings con
    hermes_cli.config, sin helpers privados de Hermes (regla 9 del catálogo)."""
    import sys
    import types
    monkeypatch.setattr(mod, '_CTX', None)
    monkeypatch.setitem(sys.modules, 'hermes_cli', types.ModuleType('hermes_cli'))
    falso = types.ModuleType('hermes_cli.config')
    falso.load_config_readonly = lambda: config
    monkeypatch.setitem(sys.modules, 'hermes_cli.config', falso)
    assert mod._setting('sandbox', 'auto') == esperado


def test_politica_sandbox_solo_vacio_es_auto(mod, monkeypatch):
    for valor, esperado in [
        (None, 'auto'), ('', 'auto'), ('auto', 'auto'),
        ('requerido', 'requerido'), (True, 'True'), (1, '1'), (['x'], "['x']"),
    ]:
        monkeypatch.setattr(mod, '_CTX', _Ctx(valor=valor))
        assert mod._politica_sandbox() == esperado, valor


def test_politica_sandbox_propaga_error_de_lectura(mod, monkeypatch):
    monkeypatch.setattr(mod, '_CTX', _Ctx(error=RuntimeError('ilegible')))
    with pytest.raises(RuntimeError):
        mod._politica_sandbox()


def test_perfil_chat_vacio_si_no_hay_setting(mod, monkeypatch):
    monkeypatch.setattr(mod, '_CTX', _Ctx(valor=''))
    assert mod._perfil_chat() == ''


def test_perfil_chat_devuelve_setting(mod, monkeypatch):
    monkeypatch.setattr(mod, '_CTX', _Ctx(valor='  mi-perfil  '))
    assert mod._perfil_chat() == 'mi-perfil'


def test_perfil_chat_ante_error_devuelve_vacio(mod, monkeypatch):
    monkeypatch.setattr(mod, '_CTX', _Ctx(error=RuntimeError('x')))
    assert mod._perfil_chat() == ''


@pytest.mark.parametrize('idioma', ['en', 'es'])
def test_estado_texto_instalado_y_no_instalado(mod, monkeypatch, idioma):
    monkeypatch.setattr(mod, '_idioma', lambda: idioma)
    base = {
        'version': '0.9.0', 'hermes': '0.23.0', 'pack_hash': 'af1422d66d1e6eee',
        'reubicaciones': 0, 'aislamiento': {'modo': 'degradado', 'motivo': 'SIN_BWRAP'},
        'politica': 'auto', 'perfil_chat': 'perfil activo',
        'desktop_presente': True, 'desktop_ok': True,
    }
    si = mod._estado_texto({**base, 'corpus_instalado': True})
    assert mod._t('status.corpus', state=mod._t('status.installed'), pack='af1422d66d1e6eee') in si
    assert mod._t('status.docx') in si
    assert 'perfil activo' in si
    assert 'Capabilities' in si
    no = mod._estado_texto({**base, 'corpus_instalado': False})
    assert mod._t('status.not_installed') in no
    # nunca rutas absolutas
    assert '/home/' not in si and '/home/' not in no


@pytest.mark.parametrize('idioma', ['en', 'es'])
def test_estado_explica_las_tres_capas_de_integridad(mod, monkeypatch, idioma):
    monkeypatch.setattr(mod, '_idioma', lambda: idioma)
    datos = {'version': '0.9.0', 'hermes': '0.23.0', 'pack_hash': 'p',
             'corpus_instalado': True, 'reubicaciones': 0,
             'aislamiento': {'modo': 'bwrap'}, 'politica': 'auto',
             'perfil_chat': 'perfil activo', 'desktop_presente': False, 'desktop_ok': False}
    texto = mod._estado_texto(datos)
    assert mod._t('status.integrity') in texto
    esperado = ('sizes and modification times checked on every call', 'once per process', 'when each server starts') if idioma == 'en' else ('tamaños y fechas comparados en cada llamada', 'una vez por proceso', 'al iniciar cada servidor')
    assert all(frase in texto for frase in esperado)


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
