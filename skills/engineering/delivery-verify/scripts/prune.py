#!/usr/bin/env python3
"""Delete local verification artifacts that have not changed for a week.

A task directory (all its rounds) is removed once its newest file is older than --days. Reports live in a hidden `.delivery` folder of their
project (`<project>/.delivery/<task>/round-NN/`), found through the delivery board's registry; a hidden `.artifacts` folder counts too. Only
directories under one of those two are ever touched. The board marks a delivery whose folder is gone as cleaned. Dry run unless --apply.
"""
import argparse
import json
from pathlib import Path
import shutil
import time

REGISTRY = Path.home() / '.config/butler-code/config/local/delivery-share.json'
HIDDEN = ('.delivery', '.artifacts')


def newest(path):
    stamps = [p.stat().st_mtime for p in path.rglob('*') if p.is_file() and not p.is_symlink()]
    return max(stamps, default=None)


def size(path):
    return sum(p.stat().st_size for p in path.rglob('*') if p.is_file() and not p.is_symlink())


def task_dirs(registry):
    """Every task directory we may delete: the registered ones inside a hidden project folder."""
    try:
        roots = [Path(e['root']) for e in json.loads(registry.read_text()).get('deliveries', {}).values() if e.get('root')]
    except (OSError, ValueError):
        return []
    found = set()
    for folder in roots:
        task = folder.parent if folder.name.startswith('round-') else folder
        if task.is_dir() and not task.is_symlink() and any(part in HIDDEN for part in task.parts):
            found.add(task)
    return sorted(found)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--days', type=int, default=7)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--registry', type=Path, default=REGISTRY)
    args = parser.parse_args()
    cutoff = time.time() - args.days * 86400
    doomed, freed = [], 0
    for task in task_dirs(args.registry):
        stamp = newest(task)
        if stamp is None or stamp < cutoff:
            age = 'empty' if stamp is None else f'{int((time.time() - stamp) // 86400)}d'
            doomed.append((task, age, size(task)))
    for task, age, bytes_ in doomed:
        print(f'{"delete" if args.apply else "would delete"}  {age:>5}  {bytes_ / 1e6:8.1f} MB  {task}')
        freed += bytes_
        if args.apply:
            shutil.rmtree(task)
    verb = 'freed' if args.apply else 'would free'
    print(f'{len(doomed)} task(s), {verb} {freed / 1e6:.1f} MB (older than {args.days} days)')


if __name__ == '__main__':
    main()
