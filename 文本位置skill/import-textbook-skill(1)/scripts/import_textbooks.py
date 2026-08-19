from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--repo', required=True, help='Path to bubu-prototype-design')
    parser.add_argument('--book', action='append', required=True)
    parser.add_argument('--max-edge', type=int, default=1800)
    parser.add_argument('--quality', type=int, default=90)
    parser.add_argument('--workers', type=int, default=6)
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()

    repo = Path(args.repo).expanduser().resolve()
    importer = repo / '白板端' / 'bubu_whiteboard' / 'scripts' / 'import_textbook_pdfs.py'
    if not importer.is_file():
        raise SystemExit(f'Bubu textbook importer not found: {importer}')
    command = [
        sys.executable,
        str(importer),
        '--max-edge', str(args.max_edge),
        '--quality', str(args.quality),
        '--workers', str(args.workers),
    ]
    if args.dry_run:
        command.append('--dry-run')
    for book in args.book:
        command.extend(['--book', book])
    raise SystemExit(subprocess.call(command, cwd=repo))


if __name__ == '__main__':
    main()
