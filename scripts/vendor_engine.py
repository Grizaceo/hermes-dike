"""Vendor the Diké engine and corpus into this plugin, or check the vendored copy.

The plugin runs the citation verifier from https://github.com/Grizaceo/dike
unchanged, as a subprocess. This script copies the engine packages and the
corpus snapshot from a clean checkout of that repository and writes
VENDORED.json: the source commit and the SHA-256 of every copied file.

    python scripts/vendor_engine.py --source ../dike    # copy and record
    python scripts/vendor_engine.py --check             # verify against VENDORED.json
    python scripts/vendor_engine.py --check --source ../dike   # also compare with the source

Build-time only: the plugin never runs this file.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
import sys
from pathlib import Path

PLUGIN = Path(__file__).resolve().parents[1]
MANIFEST = PLUGIN / 'VENDORED.json'
SOURCE_REPO = 'https://github.com/Grizaceo/dike'
# vendored path prefix -> path inside the source repository
SOURCES = {
    'motor/lexo_cli': 'lexo_cli',
    'motor/shared': 'shared',
    'motor/dike_id': 'packages/dike-id/python/src/dike_id',
    'corpus': 'corpus',
}
SKIP_PARTS = {'tests', '__pycache__', '.pytest_cache'}


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _git(source: Path, *args: str) -> str:
    return subprocess.run(['git', '-C', str(source), *args], check=True,
                          capture_output=True, text=True).stdout.strip()


def expected_files(source: Path) -> dict[str, Path]:
    """Vendored relative path -> source file, for every file the plugin carries."""
    files = {}
    for target, origin in SOURCES.items():
        base = source / origin
        if not base.is_dir():
            raise SystemExit(f'missing source directory: {base}')
        for path in sorted(base.rglob('*')):
            rel = path.relative_to(base)
            if path.is_file() and not SKIP_PARTS.intersection(rel.parts) and path.suffix != '.pyc':
                files[f'{target}/{rel.as_posix()}'] = path
    return files


def vendored_files() -> set[str]:
    return {p.relative_to(PLUGIN).as_posix()
            for folder in ('motor', 'corpus') if (PLUGIN / folder).exists()
            for p in (PLUGIN / folder).rglob('*')
            if p.is_file() and '__pycache__' not in p.parts and p.suffix != '.pyc'}


def vendor(source: Path) -> int:
    dirty = _git(source, 'status', '--porcelain', '--untracked-files=no', '--', *SOURCES.values())
    if dirty:
        print('refusing to vendor: tracked engine files differ from the commit\n' + dirty, file=sys.stderr)
        return 1
    commit = _git(source, 'rev-parse', 'HEAD')
    expected = expected_files(source)
    for stale in vendored_files() - set(expected):
        (PLUGIN / stale).unlink()
    for rel, origin in expected.items():
        target = PLUGIN / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(origin, target)
    record = {
        'source': SOURCE_REPO,
        'commit': commit,
        'paths': SOURCES,
        'files': {rel: _sha256(PLUGIN / rel) for rel in sorted(expected)},
    }
    MANIFEST.write_text(json.dumps(record, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    print(f'VENDORED: {len(expected)} files from {SOURCE_REPO} @ {commit}')
    return 0


def check(source: Path | None) -> int:
    record = json.loads(MANIFEST.read_text(encoding='utf-8'))
    listed = record['files']
    problems = []
    actual = vendored_files()
    problems += [f'not in VENDORED.json: {p}' for p in sorted(actual - set(listed))]
    problems += [f'missing: {p}' for p in sorted(set(listed) - actual)]
    problems += [f'hash differs: {p}' for p in sorted(set(listed) & actual) if _sha256(PLUGIN / p) != listed[p]]
    if source is not None:
        commit = _git(source, 'rev-parse', 'HEAD')
        if commit != record['commit']:
            problems.append(f'source is at {commit}, VENDORED.json records {record["commit"]}')
        expected = expected_files(source)
        if set(expected) != set(listed):
            problems.append('source file list differs from VENDORED.json')
        problems += [f'differs from source: {p}' for p, origin in expected.items()
                     if p in listed and _sha256(origin) != listed[p]]
    if problems:
        print('DRIFT\n' + '\n'.join(problems))
        return 1
    print(f'IDENTICAL: {len(listed)} files, {record["source"]} @ {record["commit"]}')
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--source', type=Path, help='clean checkout of the Diké repository')
    parser.add_argument('--check', action='store_true', help='verify the vendored copy instead of writing it')
    args = parser.parse_args(argv)
    source = args.source.resolve() if args.source else None
    if args.check:
        return check(source)
    if source is None:
        parser.error('--source is required to vendor')
    return vendor(source)


if __name__ == '__main__':
    raise SystemExit(main())
