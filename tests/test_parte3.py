import hashlib
import importlib.util
import json
import os
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent


@pytest.fixture(scope='module')
def mod():
    spec = importlib.util.spec_from_file_location('dike_parte3_test', ROOT / '__init__.py')
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


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
    monkeypatch.setitem(__import__('sys').modules, 'hermes_cli.plugins_state', None)
    assert mod._setting('sandbox', 'auto') == 'auto'


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


def test_estado_texto_instalado_y_no_instalado(mod):
    base = {
        'version': '0.9.0', 'hermes': '0.23.0', 'pack_hash': 'af1422d66d1e6eee',
        'reubicaciones': 0, 'aislamiento': {'modo': 'degradado', 'motivo': 'SIN_BWRAP'},
        'politica': 'auto', 'perfil_chat': 'perfil activo',
        'desktop_presente': True, 'desktop_ok': True,
    }
    si = mod._estado_texto({**base, 'corpus_instalado': True})
    assert 'instalado' in si and 'pack af1422d66d1e6eee' in si
    assert 'python-docx no hace falta' in si
    assert 'perfil activo' in si
    assert 'Capabilities' in si
    no = mod._estado_texto({**base, 'corpus_instalado': False})
    assert 'no instalado' in no
    # nunca rutas absolutas
    assert '/home/' not in si and '/home/' not in no


def _generacion_falsa(tmp_path, snapshot_viejo):
    datos = tmp_path / 'datos'
    gen = datos / 'generations' / 'pack123'
    sf = gen / 'users' / 'hermes' / 'starter' / 's1' / 'STATE.json'
    sf.parent.mkdir(parents=True)
    sf.write_text(json.dumps({'snapshot': snapshot_viejo}))
    (gen / 'users' / 'hermes' / 'starter' / 's1' / 'datos.txt').write_text('x')
    files = {str(p.relative_to(gen)): hashlib.sha256(p.read_bytes()).hexdigest()
             for p in (gen / 'users').rglob('*') if p.is_file()}
    (gen / 'installed.json').write_text(json.dumps(
        {'package_sha256': 'pack123', 'files': files,
         'stat': {}, 'reubicaciones': []}))
    return datos, gen


def test_reparar_reubicacion_reescribe_snapshot(mod, tmp_path):
    viejo_datos = tmp_path / 'viejo'
    _, gen_viejo = _generacion_falsa(viejo_datos, '')
    # snapshot apunta a la ruta VIEJA (plugin-data movido)
    snapshot_viejo = str(gen_viejo / 'users' / 'hermes' / 'starter' / 's1' / 'snap')
    datos, gen = _generacion_falsa(tmp_path / 'nuevo', snapshot_viejo)
    # rehacer installed.json con el snapshot viejo ya escrito
    sf = gen / 'users' / 'hermes' / 'starter' / 's1' / 'STATE.json'
    sf.write_text(json.dumps({'snapshot': snapshot_viejo}))
    record = json.loads((gen / 'installed.json').read_text())
    record['files'] = {str(p.relative_to(gen)): hashlib.sha256(p.read_bytes()).hexdigest()
                       for p in (gen / 'users').rglob('*') if p.is_file()}
    (gen / 'installed.json').write_text(json.dumps(record))

    mod._reparar_reubicacion(datos, gen, 'pack123')

    state = json.loads(sf.read_text())
    assert state['snapshot'].startswith(str(gen) + os.sep)
    nuevo = json.loads((gen / 'installed.json').read_text())
    assert len(nuevo['reubicaciones']) == 1
    # el hash del STATE.json reescrito quedó registrado
    assert nuevo['files']['users/hermes/starter/s1/STATE.json'] == \
        hashlib.sha256(sf.read_bytes()).hexdigest()


def test_reparar_reubicacion_sin_rotos_no_toca(mod, tmp_path):
    datos, gen = _generacion_falsa(tmp_path / 'd', '')
    sf = gen / 'users' / 'hermes' / 'starter' / 's1' / 'STATE.json'
    sf.write_text(json.dumps({'snapshot': str(gen / 'users' / 'x')}))
    antes = (gen / 'installed.json').read_text()
    mod._reparar_reubicacion(datos, gen, 'pack123')
    assert (gen / 'installed.json').read_text() == antes
