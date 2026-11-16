"""Build the packaged Graphium engine explicitly; never runs during an HTTP request."""
from pathlib import Path
import argparse
import os
import shutil
import subprocess


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--offline', action='store_true', help='Use only cached Cargo dependencies')
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    manifest = root / 'graphium' / 'Cargo.toml'
    command = ['cargo', 'build', '--release', '--locked', '--manifest-path', str(manifest)]
    if args.offline:
        command.append('--offline')
    subprocess.run(command, check=True)
    name = 'dike-graphium.exe' if os.name == 'nt' else 'dike-graphium'
    source = root / 'graphium' / 'target' / 'release' / name
    destination = root / 'graphium' / 'bin' / name
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, destination)
    print(f'Native engine ready: {destination}')


if __name__ == '__main__':
    main()
