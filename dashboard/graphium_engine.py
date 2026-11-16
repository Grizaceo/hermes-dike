"""Narrow native-only Graphium adapter: no vault discovery, no network, no Hermes imports."""
from __future__ import annotations

import base64
import json
import math
import os
from pathlib import Path
import struct
import subprocess
import threading

ROOT = Path(__file__).resolve().parents[1]
MAX_NODES = 200_000
MAX_EDGES = 1_000_000
MAX_BYTES = 64 * 1024 * 1024
_NATIVE_SLOTS = threading.BoundedSemaphore(1)


class EngineUnavailable(RuntimeError):
    """Native engine is missing or returned an invalid result."""


def binary_path() -> Path:
    # Operator-supplied executable only; never look inside another profile.
    override = os.environ.get('DIKE_GRAPHIUM_BINARY')
    return Path(override).expanduser() if override else ROOT / 'graphium' / 'bin' / ('dike-graphium.exe' if os.name == 'nt' else 'dike-graphium')


def validate_graph(body: object) -> dict:
    if not isinstance(body, dict):
        raise ValueError('El grafo debe ser un objeto.')
    nodes, links = body.get('nodes'), body.get('links')
    if not isinstance(nodes, list) or not isinstance(links, list):
        raise ValueError('nodes y links deben ser listas.')
    if len(nodes) > MAX_NODES or len(links) > MAX_EDGES:
        raise ValueError('El grafo supera el límite configurado.')
    ids = set()
    normalized_nodes = []
    kinds = set()
    for n in nodes:
        if not isinstance(n, dict) or not isinstance(n.get('id'), str) or not n['id'] or len(n['id']) > 2048:
            raise ValueError('Cada nodo requiere un id literal no vacío.')
        if n['id'] in ids:
            raise ValueError('Los identificadores de nodos deben ser únicos.')
        ids.add(n['id'])
        kind = n.get('tipo', 'node')
        label = n.get('label', n['id'])
        if not isinstance(kind, str) or not isinstance(label, str) or len(kind) > 100 or len(label) > 4096:
            raise ValueError('tipo o label inválidos.')
        kinds.add(kind)
        normalized = {'id': n['id'], 'tipo': kind, 'label': label}
        if 'position' in n:
            position = n['position']
            if (not isinstance(position, list) or len(position) != 3
                    or any(isinstance(v, bool) or not isinstance(v, (float, int))
                           or abs(v) > 10_000_000 or not math.isfinite(v) for v in position)):
                raise ValueError('Posición previa inválida.')
            normalized['position'] = position
        normalized_nodes.append(normalized)
    normalized_links = []
    edge_kinds = set()
    for link in links:
        if not isinstance(link, dict):
            raise ValueError('Arista inválida.')
        source, target = link.get('source'), link.get('target')
        if not isinstance(source, str) or not isinstance(target, str) or source not in ids or target not in ids:
            raise ValueError('Cada arista debe apuntar a nodos existentes.')
        kind, status = link.get('tipo', 'link'), link.get('estado', 'candidata')
        if not isinstance(kind, str) or not isinstance(status, str) or len(kind) > 100 or len(status) > 100:
            raise ValueError('tipo o estado de arista inválidos.')
        # Preserve distinct statuses in packed edge kind; never strengthen authority.
        edge_kinds.add(json.dumps([kind, status], ensure_ascii=False, separators=(',', ':')))
        normalized_links.append({'source': source, 'target': target, 'tipo': kind, 'estado': status})
    if len(kinds) > 254 or len(edge_kinds) > 63:
        raise ValueError('Demasiados tipos para el contrato GBIN v1.')
    result = {'nodes': normalized_nodes, 'links': normalized_links}
    if len(json.dumps(result, ensure_ascii=False).encode('utf-8')) > MAX_BYTES:
        raise ValueError('El grafo supera el límite de bytes.')
    return result


def layout(body: object) -> dict:
    graph = validate_graph(body)
    binary = binary_path()
    if not binary.is_file() or not os.access(binary, os.X_OK):
        raise EngineUnavailable('Motor Rust no instalado. Compila graphium/Cargo.toml; no hay fallback implícito.')
    if not _NATIVE_SLOTS.acquire(blocking=False):
        raise EngineUnavailable('El motor está ocupado; reintenta cuando termine la operación actual.')
    try:
        proc = subprocess.run([str(binary)], input=json.dumps(graph, ensure_ascii=False).encode('utf-8'),
                              stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=90,
                              env={**{k: os.environ[k] for k in ('PATH', 'LANG', 'LC_ALL', 'SYSTEMROOT', 'WINDIR') if k in os.environ}, 'RAYON_NUM_THREADS':'2'}, check=False)
    except (OSError, subprocess.SubprocessError) as exc:
        raise EngineUnavailable('No se pudo ejecutar el motor Rust.') from exc
    finally:
        _NATIVE_SLOTS.release()
    if proc.returncode != 0:
        raise EngineUnavailable('El motor Rust rechazó el grafo.')
    raw = proc.stdout
    if len(raw) < 32:
        raise EngineUnavailable('Snapshot Rust incompleto.')
    magic, version, count, edge_count = struct.unpack_from('<4I', raw)
    if magic != 0x4E494247 or version != 1 or count != len(graph['nodes']) or edge_count > len(graph['links']):
        raise EngineUnavailable('Snapshot Rust incompatible.')
    footer_len = struct.unpack_from('<I', raw, 28)[0]
    expected = 32 + count * 28 + edge_count * 8 + ((edge_count + 3) & ~3) + footer_len
    if len(raw) != expected:
        raise EngineUnavailable('Tamaño GBIN inválido.')
    return {'engine': 'graphium-rust', 'gbin_b64': base64.b64encode(raw).decode('ascii'),
            'node_ids': [n['id'] for n in graph['nodes']]}
