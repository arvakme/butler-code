#!/usr/bin/env python3
"""Validate result.json and publish one immutable offline verification report."""
import argparse
import json
from pathlib import Path
import sys

from model import validate, verdict
from render import model, render


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('result', type=Path)
    parser.add_argument('--check', action='store_true', help='validate without writing report.html')
    parser.add_argument('--model', type=Path, help='also write the page model JSON here (ui dev server sample)')
    args = parser.parse_args()
    try:
        data = json.loads(args.result.read_text(encoding='utf-8'))
        validate(data, args.result.parent)
        if args.model:
            args.model.parent.mkdir(parents=True, exist_ok=True)
            args.model.write_text(json.dumps(model(data, args.result.parent), ensure_ascii=False, indent=2), encoding='utf-8')
        if not args.check:
            html = render(data, args.result.parent)
            output = args.result.parent / 'report.html'
            with output.open('x', encoding='utf-8') as stream:
                stream.write(html)
            print(output.resolve())
        print(f'报告数据有效 · {verdict(data)[1]} · 待用户验收')
    except (OSError, ValueError) as error:
        print(f'report: {error}', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
