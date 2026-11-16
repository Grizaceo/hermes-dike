"""Opt-in, profile-owned documentary inventory and editable sidecar notes.

Inventory never reads document bodies. Source text requires an operator-provided
per-document anonymization approval bound to its current SHA-256. No LKG writes.
"""
from __future__ import annotations
import base64
import hashlib
import json
import os
from pathlib import Path
import tempfile
import threading
import time

_LOCK = threading.RLock()
_CACHE = {}
_EXCLUDE = {'_backups', '_bcn_cache', 'source', 'canonical'}


def _config(data):
    path = Path(data) / 'graph-sources.json'
    try:
        cfg = json.loads(path.read_text(encoding='utf-8')).get('vault', {})
    except (OSError, ValueError, AttributeError):
        raise ValueError('Vault no conectada en este perfil.') from None
    if not isinstance(cfg, dict) or cfg.get('enabled') is not True or not isinstance(cfg.get('root'), str):
        raise ValueError('Vault desactivada en este perfil.')
    root = Path(cfg['root']).expanduser()
    if not root.is_absolute() or not root.is_dir():
        raise ValueError('Raíz de vault no disponible.')
    return cfg, root.resolve()


def available(data):
    try:
        _config(data)
        return True
    except ValueError:
        return False


def _id(relative):
    return 'v:' + base64.urlsafe_b64encode(hashlib.blake2s(relative.encode('utf-8'), digest_size=12).digest()).decode().rstrip('=')


def snapshot(data, refresh=False):
    cfg, root = _config(data)
    key = (str(Path(data).resolve()), str(root))
    with _LOCK:
        cached = _CACHE.get(key)
        if not refresh and cached and time.monotonic() - cached[0] < 300:
            return cached[1]
        nodes, links, paths = [], [], {}
        def add(relative, kind):
            ident = _id(relative)
            if ident in paths and paths[ident] != relative:
                raise ValueError('Colisión de identidad de documentos.')
            if ident in paths:
                return ident
            paths[ident] = relative
            nodes.append({'id':ident, 'label':Path(relative).stem if relative != '.' else 'Vault jurídica',
                          'tipo':kind, 'authority':'documental', 'relative_path':relative,
                          'layout_label':'', 'text_access':'requiere_aprobacion'})
            if len(nodes) > 200000:
                raise ValueError('La fuente excede 200.000 nodos; no se trunca silenciosamente.')
            return ident
        add('.', 'carpeta')
        documents = excluded = 0
        def walk_error(error):
            raise ValueError('No se pudo completar el inventario de la fuente.') from error
        for current, dirs, files in os.walk(root, followlinks=False, onerror=walk_error):
            current = Path(current)
            dirs[:] = sorted(d for d in dirs if not d.startswith('.') and d not in _EXCLUDE and not (current/d).is_symlink())
            relative = current.relative_to(root).as_posix()
            parent = add(relative, 'carpeta')
            if relative != '.':
                ancestor = Path(relative).parent.as_posix()
                links.append({'source':add(ancestor,'carpeta'), 'target':parent, 'tipo':'contiene', 'estado':'estructural'})
            for name in sorted(files):
                file = current/name
                if file.suffix != '.md': continue
                if name.startswith('.') or name in {'README.md','index.md'} or file.is_symlink():
                    excluded += 1
                    continue
                ident = add(file.relative_to(root).as_posix(), 'documento')
                documents += 1
                links.append({'source':parent,'target':ident,'tipo':'contiene','estado':'estructural'})
        result = {'fuente':'vault','local_only':True,'nodes':nodes,'links':links,
                  'conteos':{'nodes':len(nodes),'links':len(links),'documentos':documents,'excluidos_en_directorios_activos':excluded},
                  'truncado':False, 'coverage':'inventario_documental_sin_lectura_de_cuerpos',
                  'aviso':'Inventario documental y relaciones de carpeta; no son citas jurídicas ni conocimiento aprobado.'}
        _CACHE[key] = (time.monotonic(),result)
        return result


def node(data, ident):
    for item in snapshot(data)['nodes']:
        if item['id'] == ident: return item
    raise ValueError('Nodo no pertenece a la fuente conectada.')


def read_source(data, ident):
    item = node(data, ident)
    cfg, root = _config(data)
    approval = (cfg.get('approved_documents') or {}).get(ident, {})
    if item['tipo'] != 'documento' or not isinstance(approval, dict) or approval.get('anonymized') is not True or not approval.get('sha256'):
        raise PermissionError('Texto no expuesto: falta aprobación de anonimización vinculada al documento.')
    relative = Path(item['relative_path'])
    target = root/relative
    if any((root/Path(*relative.parts[:i])).is_symlink() for i in range(1,len(relative.parts)+1)) or not target.resolve().is_relative_to(root):
        raise PermissionError('Ruta fuera de la fuente autorizada.')
    if target.stat().st_size > 2*1024*1024:
        raise ValueError('Documento excede el límite de lectura.')
    raw = target.read_bytes()
    if hashlib.sha256(raw).hexdigest() != approval['sha256']:
        raise PermissionError('Documento cambió desde su aprobación.')
    return {'content':raw.decode('utf-8'), 'sha256':approval['sha256'], 'read_only':True}


def _note_path(data, source, ident):
    if not isinstance(source,str) or source not in {'corpus','ambiental','vault'} or not isinstance(ident,str) or not ident or len(ident)>2048 or any(ord(c)<32 for c in ident) or '../' in ident:
        raise ValueError('Fuente o identificador inválido.')
    if source == 'vault': node(data, ident)
    return Path(data)/'graph-notes'/source/(hashlib.sha256(ident.encode()).hexdigest()+'.md')


def _version(content): return hashlib.sha256(content.encode('utf-8')).hexdigest()


def read_note(data, source, ident):
    path = _note_path(data, source, ident)
    with _LOCK:
        content = path.read_text(encoding='utf-8') if path.is_file() else ''
    return {'content':content, 'version':_version(content), 'mode':'annotation', 'source_unchanged':True}


def write_note(data, source, ident, content, expected_version):
    if not isinstance(content,str) or len(content.encode('utf-8'))>2*1024*1024:
        raise ValueError('Anotación inválida o mayor a 2 MiB.')
    path = _note_path(data,source,ident)
    with _LOCK:
        previous = read_note(data,source,ident)
        if previous['version'] != expected_version:
            raise FileExistsError('La nota cambió; vuelve a abrirla antes de guardar.')
        path.parent.mkdir(parents=True,exist_ok=True)
        fd, temp = tempfile.mkstemp(prefix='.note-',dir=path.parent)
        try:
            with os.fdopen(fd,'w',encoding='utf-8') as handle:
                handle.write(content); handle.flush(); os.fsync(handle.fileno())
            os.replace(temp,path)
        finally:
            if os.path.exists(temp): os.unlink(temp)
    return {'content':content,'version':_version(content),'mode':'annotation','source_unchanged':True}
