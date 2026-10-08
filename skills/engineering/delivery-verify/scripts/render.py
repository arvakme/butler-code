"""Fill the prebuilt offline report template (assets/app/index.html) with one round's data.

The template is built from ../ui (React + @lobehub/ui, after LobeHub Acceptance's viewer)
and committed, so publishing a report needs only Python.
"""
from html import escape
import json
from pathlib import Path
import struct

from model import verdict

TEMPLATE = Path(__file__).resolve().parent.parent / 'assets' / 'app' / 'index.html'
TEXT_LIMIT = 64 * 1024


def embed_text(item, root):
    raw = (root / item['path' if 'path' in item else 'log']).read_bytes()
    item['content'] = raw[:TEXT_LIMIT].decode('utf-8', 'replace')
    item['truncated'] = len(raw) > TEXT_LIMIT


def image_size(path):
    """(width, height) from PNG/GIF/JPEG headers so the page can reserve space; None if unknown."""
    head = path.read_bytes()[:64 * 1024]
    if head.startswith(b'\x89PNG'):
        return struct.unpack('>II', head[16:24])
    if head[:6] in (b'GIF87a', b'GIF89a'):
        return struct.unpack('<HH', head[6:10])
    if head[:2] == b'\xff\xd8':
        i = 2
        while i + 9 < len(head):
            if head[i] != 0xFF:
                i += 1
                continue
            marker, length = head[i + 1], struct.unpack('>H', head[i + 2:i + 4])[0]
            if 0xC0 <= marker <= 0xCF and marker not in (0xC4, 0xC8, 0xCC):
                h, w = struct.unpack('>HH', head[i + 5:i + 9])
                return w, h
            i += 2 + length
    return None


def model(data, root):
    """The page's single input: result.json, its verdict and embedded text evidence."""
    view = json.loads(json.dumps(data))
    status, label = verdict(data)
    view['verdict'] = {'status': status, 'label': label}
    for case in view['cases']:
        for item in case['evidence']:
            if item['kind'] == 'text':
                embed_text(item, root)
            elif item['kind'] == 'image' and (size := image_size(root / item['path'])):
                item['width'], item['height'] = size
    for check in view['checks']:
        embed_text(check, root)
    return view


def render(data, root):
    payload = json.dumps(model(data, root), ensure_ascii=False).replace('<', '\\u003c')
    html = TEMPLATE.read_text(encoding='utf-8')
    for marker in ('__REPORT_TITLE__', '__REPORT_DATA__'):
        if html.count(marker) != 1:
            raise ValueError(f'report template is missing {marker}; rebuild ui/')
    title = escape(f'{data["title"]} · 交付验证')
    return html.replace('__REPORT_TITLE__', title, 1).replace('__REPORT_DATA__', payload, 1)
