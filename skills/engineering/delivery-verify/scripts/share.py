#!/usr/bin/env python3
"""One fixed port for everything an agent delivers.

Reports and attachments, a dashboard of every delivery (active, archived, cleaned), and the way
back for the feedback buttons: the feedback is saved first, then announced to the agent's own
herdr pane. Claude Code, Pi and Codex all register here, so none invents its own port or route.
"""
import argparse
import hashlib
import html
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import mimetypes
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import threading
import time
from urllib.parse import unquote, urlsplit
import uuid

PORT = 8769
PREVIEW_PORTS = range(47100, 47200)  # fixed, uncommon HTTPS ports for the products agents build; one stays with a project's name
TAILSCALE = os.environ.get('TAILSCALE') or 'tailscale'
ARCHIVE_AFTER_DAYS = 7  # an active delivery nobody touched for this long is archived by the server itself
DEFAULT_REGISTRY = Path.home()/'.config/butler-code/config/local/delivery-share.json'


def herdr_bin():
    """The herdr to call: HERDR_BIN, else the one on PATH, else mise's install. The board runs under launchd, whose PATH has no mise, so a bare `herdr`
    was never found there and every feedback stayed 'not confirmed'."""
    return os.environ.get('HERDR_BIN') or shutil.which('herdr') or str(Path.home()/'.local/share/mise/installs/herdr/latest/herdr')

CASE_WORDS = {'passed': '通过', 'failed': '失败', 'blocked': '受阻', 'pending': '待验', 'uncertain': '不确定'}
SLUG = re.compile('[a-z0-9][a-z0-9-]{0,79}')
REACTIONS = ('👍', '❤️', '🎉', '👀', '🤔', '❓')  # what the page offers on a message
TAGS = ('布局', '颜色', '文案', '功能不对', '没做到', '证据不够')  # why a check was sent back; the page offers exactly these


def valid_note(note, evidence):
    """One comment pinned to a picture region or a video moment; it must point at evidence of that check."""
    if not isinstance(note, dict) or not isinstance(note.get('text'), str) or not note['text'].strip() or len(note['text']) > 2000: return False
    if (note.get('kind'), note.get('path')) not in evidence: return False
    number = lambda v: isinstance(v, (int, float)) and not isinstance(v, bool)
    if note['kind'] == 'video': return number(note.get('t')) and 0 <= note['t'] < 86400
    rect = note.get('rect')
    return isinstance(rect, list) and len(rect) == 4 and all(number(v) and 0 <= v <= 1 for v in rect)


def where(note):
    """The spot a comment points at, in words the agent can act on (the exact numbers stay in the receipt)."""
    name = note['path'].rsplit('/', 1)[-1]
    if note['kind'] == 'video':
        t = note['t']
        return f"视频 {name} {int(t // 60)}:{t % 60:04.1f}"
    x, y, w, h = note['rect']
    if w == 0 and h == 0: return f"图 {name} 点 ({x:.0%}, {y:.0%})"
    return f"图 {name} 区域 左{x:.0%} 上{y:.0%} 宽{w:.0%} 高{h:.0%}"


def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name+'.'+uuid.uuid4().hex+'.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2)+'\n')
    os.replace(temporary, path)


def guess_agent():
    if os.environ.get('PI_CODING_AGENT'): return 'pi'
    if os.environ.get('CLAUDECODE'): return 'claude'
    if os.environ.get('CODEX_HOME') or os.environ.get('CODEX_THREAD_ID'): return 'codex'
    return 'agent'


def latest_report(root):
    """The newest round's result.json under a delivery: the root itself, or its round-NN folders."""
    rounds = sorted(root.glob('round-*/result.json'))
    path = rounds[-1] if rounds else root/'result.json'
    try: return path, json.loads(path.read_text())
    except (OSError, ValueError): return path, None


def last_activity(root, entry):
    """When a delivery last moved: its newest result, its newest saved feedback, or its (re)registration."""
    stamps = []
    for path in [*root.glob('result.json'), *root.glob('round-*/result.json'), *root.glob('**/feedback-receipts/*.json')]:
        try: stamps.append(path.stat().st_mtime)
        except OSError: pass
    try: stamps.append(time.mktime(time.strptime(entry['changed'], '%Y-%m-%dT%H:%M:%S%z')))
    except (KeyError, ValueError): pass
    return max(stamps, default=0)


def files_beyond_record(root):
    """What `clean` removes: everything except the result data and the saved feedback."""
    keep = ('result.json', 'feedback-receipts')
    return [p for p in root.rglob('*') if p.is_file() and not p.is_symlink()
            and not any(part in keep for part in p.relative_to(root).parts)]


class Hub:
    def __init__(self, registry):
        self.registry = registry
        self.lock = threading.Lock()

    def data(self):
        return json.loads(self.registry.read_text()) if self.registry.exists() else {'deliveries': {}}

    def entry(self, slug):
        return self.data()['deliveries'].get(slug)

    def origin(self):
        return self.data().get('origin')

    def allows_origin(self, origin):
        return bool(origin) and origin == self.origin()

    def set_state(self, slug, state, **more):
        with self.lock:
            data = self.data()
            data['deliveries'][slug].update(state=state, changed=time.strftime('%Y-%m-%dT%H:%M:%S%z'), **more)
            save(self.registry, data)

    def previews(self):
        return self.data().get('previews', {})

    def preview_port(self, name):
        """The port a name keeps: the one it already has, else the first free one counting from a hash of the name."""
        known = self.previews()
        if name in known: return known[name]['port']
        taken = {v['port'] for v in known.values()}
        start = int(hashlib.sha256(name.encode()).hexdigest(), 16) % len(PREVIEW_PORTS)
        for step in range(len(PREVIEW_PORTS)):
            port = PREVIEW_PORTS[(start+step) % len(PREVIEW_PORTS)]
            if port not in taken: return port
        raise RuntimeError('all %d preview ports are in use; remove one with preview-rm' % len(PREVIEW_PORTS))

    def preview_url(self, port):
        host = urlsplit(self.origin() or '').hostname
        return f'https://{host}:{port}/' if host else None

    def sweep(self, days=ARCHIVE_AFTER_DAYS):
        """Archives active deliveries nobody has touched for `days`, and marks deliveries whose folder is gone as cleaned; returns their slugs."""
        cutoff = time.time()-days*86400
        moved = []
        for slug, entry in self.data()['deliveries'].items():
            root = Path(entry['root'])
            if entry.get('state', 'active') != 'cleaned' and not root.is_dir():
                # the folder is gone (the monthly prune, or by hand): the delivery is cleaned whether or not anyone said so
                self.set_state(slug, 'cleaned', vanished=True)
                moved.append(slug)
                continue
            if entry.get('state', 'active') == 'active' and last_activity(root, entry) < cutoff:
                self.set_state(slug, 'archived', auto=True)
                moved.append(slug)
        return moved

    def index(self):
        """What an agent needs to know about every delivery, as data."""
        origin = self.origin() or ''
        out = []
        for r in self.rows():
            where = r['report'].parent.relative_to(r['root']).as_posix() if r['root'] in r['report'].parents else ''
            out.append({'slug': r['slug'], 'title': r['title'], 'project': r['project'], 'round': r['round'], 'state': r['state'], 'agent': r['agent'],
                        'can_take_feedback': bool(r['pane']), 'cases': r['counts'], 'changed': r['changed'],
                        'url': None if r['state'] == 'cleaned' else f"{origin}/delivery/{r['slug']}/{where+'/' if where else ''}report.html"})
        previews = [{'name': n, 'url': self.preview_url(v['port']), 'local_port': v['local']} for n, v in sorted(self.previews().items())]
        return {'board': f'{origin}/delivery/', 'deliveries': out, 'previews': previews}

    # ---- the way back: save the feedback, then tell the agent's pane in one line pointing at the file
    def submit(self, slug, body, relative_root=()):
        entry = self.entry(slug)
        if not entry or not entry.get('pane') or not entry.get('herdr_socket'): return 404, {'error': '本报告没有绑定反馈 pane。'}
        if entry.get('state', 'active') == 'cleaned': return 410, {'error': '本报告已清理。'}
        base = Path(entry['root']).resolve()
        root = base.joinpath(*relative_root).resolve()
        if any(x in ('', '..', '.') or x.startswith('.') or x == 'feedback-receipts' for x in relative_root) or not root.is_relative_to(base):
            return 404, {'error': '报告不存在。'}
        report = json.loads((root/'result.json').read_text())
        ident = body.get('id', '')
        try: uuid.UUID(ident)
        except (ValueError, TypeError, AttributeError): return 400, {'error': '提交编号无效。'}
        if body.get('task') != report['task'] or body.get('round') != report['round']:
            return 409, {'error': '反馈轮次不匹配，请刷新报告。'}
        decision, rejected, comment = body.get('decision'), body.get('rejected'), body.get('comment')
        if decision not in ('accept', 'reject') or not isinstance(comment, str) or not isinstance(rejected, list):
            return 400, {'error': '反馈格式无效。'}
        allowed = {case['id']: {(e['kind'], e['path']) for e in case.get('evidence', [])} for case in report['cases']}
        accepted = body.get('accepted', [])
        if not isinstance(accepted, list) or not all(isinstance(x, str) and x in allowed for x in accepted) or len(set(accepted)) != len(accepted):
            return 400, {'error': '接受项不属于本轮报告或重复。'}
        ignored = body.get('ignored', [])
        if not isinstance(ignored, list) or not all(isinstance(x, str) and x in allowed for x in ignored) or len(set(ignored)) != len(ignored) or set(ignored) & set(accepted):
            return 400, {'error': '忽略项不属于本轮报告、重复，或同时被接受。'}
        seen = set()
        for case in rejected:
            if not isinstance(case, dict) or case.get('id') not in allowed or not isinstance(case.get('reason'), str) or case['id'] in seen or case['id'] in accepted or case['id'] in ignored:
                return 400, {'error': '打回项不属于本轮报告、重复，或同时被接受。'}
            seen.add(case['id'])
            notes, tags = case.get('notes', []), case.get('tags', [])
            if not isinstance(notes, list) or len(notes) > 50 or not all(valid_note(note, allowed[case['id']]) for note in notes):
                return 400, {'error': '图上或视频里的意见格式无效。'}
            if not isinstance(tags, list) or not all(t in TAGS for t in tags) or len(set(tags)) != len(tags) or not isinstance(case.get('lesson', False), bool):
                return 400, {'error': '原因标签或教训开关无效。'}
        if decision == 'accept' and rejected: return 400, {'error': '全部接受不能包含打回项。'}
        if decision == 'reject' and not rejected and not comment.strip(): return 400, {'error': '请先选择打回项或填写意见。'}
        if decision == 'accept' and 'accepted' in body and not accepted and not ignored: return 400, {'error': '没有选中任何接受或忽略项。'}
        # the UUID is only a file key; browser input never picks a command, directory or pane
        ident = str(uuid.UUID(ident))
        receipt = root/'feedback-receipts'/f'{ident}.json'
        payload_hash = hashlib.sha256(json.dumps(body, ensure_ascii=False, sort_keys=True).encode()).hexdigest()
        everything = decision == 'accept' and ('accepted' not in body or (set(accepted) == set(allowed) and not ignored))
        head = '全部接受' if everything else ('；'.join(x for x in (
            f"已接受：{'、'.join(accepted)}" if accepted else '',
            f"已忽略：{'、'.join(ignored)}（不用处理）" if ignored else '',
            ('需要修改：'+('、'.join(case['id'] for case in rejected) or '见意见')) if decision == 'reject' else '')
            if x))
        with self.lock:
            if receipt.exists():
                existing = json.loads(receipt.read_text())
                if existing['payload_hash'] != payload_hash: return 409, {'error': '提交编号已使用，请作为新反馈提交。'}
                return 200, {k: existing[k] for k in ('id', 'status', 'message') if k in existing}
            text = f"交付反馈 · {report['task']} · 第 {report['round']} 轮\n{head}\n"
            for case in rejected:
                tags = f"[{'、'.join(case['tags'])}] " if case.get('tags') else ''
                if case['reason'].strip() or tags: text += f"- {case['id']}：{tags}{case['reason'].strip()}\n"
                text += ''.join(f"- {case['id']} {where(note)}：{note['text'].strip()}\n" for note in case.get('notes', []))
                if case.get('lesson'): text += f"  （用户要求把 {case['id']} 的原因存成教训：整理成可检查的规则，追加到项目的 common-mistakes.md）\n"
            text += '\n'+comment.strip()+'\n'
            record = {'id': ident, 'at': time.strftime('%Y-%m-%dT%H:%M:%S%z'), 'payload_hash': payload_hash, 'feedback': body, 'text': text, 'status': 'sending', 'message': '反馈已保存，正在投递。'}
            save(receipt, record)
        line = f"[delivery-hub slug={slug}] 交付反馈 {report['task']} 第{report['round']}轮 {head}；完整内容见 {receipt}"
        try:
            # herdr finds the server through HERDR_SOCKET_PATH (recorded when the delivery was registered); `agent prompt` types the line into the agent in that pane
            result = subprocess.run([herdr_bin(), 'agent', 'prompt', entry['pane'], line], capture_output=True, text=True, timeout=30,
                                    env={**os.environ, 'HERDR_SOCKET_PATH': entry['herdr_socket']})
            reply = {}
            for out in reversed(result.stdout.splitlines()):
                try: candidate = json.loads(out)
                except ValueError: continue
                if isinstance(candidate, dict) and ('result' in candidate or 'error' in candidate):
                    reply = candidate
                    break
            code = (reply.get('error') or {}).get('code')
            if code == 'agent_blocked':
                record.update(status='delivery_unknown', message='反馈已保存，但那个 Agent 正停在一个等你确认的界面，没有送进去。处理完后让它读回执文件，不要重复提交。')
            elif result.returncode != 0 or 'result' not in reply or code:
                raise ValueError('the pane did not confirm')
            else: record.update(status='delivered', message='已送到 Agent 的 pane，反馈已保存在本轮报告。')
        except (OSError, ValueError, subprocess.TimeoutExpired) as exc:
            record.update(status='delivery_unknown', message='反馈已保存，但尚未确认 Agent 收到。请保留页面；不要重复发送。', detail=f'{type(exc).__name__}: {exc}')
        with self.lock: save(receipt, record)
        if entry.get('state', 'active') == 'archived': self.set_state(slug, 'active')  # feedback means someone is on it again
        return 200, {k: record[k] for k in ('id', 'status', 'message') if k in record}

    # ---- reactions: a one-person emoji on a round's message or on one of the reader's own submissions; no message goes to the agent
    def reactions(self, folder):
        try: return json.loads((folder/'reactions.json').read_text())
        except (OSError, ValueError): return {}

    def react(self, slug, body, relative_root=()):
        entry = self.entry(slug)
        if not entry: return 404, {'error': '报告不存在。'}
        if entry.get('state', 'active') == 'cleaned': return 410, {'error': '本报告已清理。'}
        base = Path(entry['root']).resolve()
        here = base.joinpath(*relative_root).resolve()
        if not here.is_relative_to(base) or not (here/'result.json').is_file(): return 404, {'error': '报告不存在。'}
        folders = sorted(p for p in here.parent.glob('round-*') if (p/'result.json').is_file()) if here != base else [here]
        round_no, target, emoji, on = body.get('round'), body.get('target'), body.get('emoji'), body.get('on')
        folder = next((f for f in folders if json.loads((f/'result.json').read_text()).get('round') == round_no), None)
        if folder is None or emoji not in REACTIONS or not isinstance(on, bool) or not isinstance(target, str): return 400, {'error': '表情或目标无效。'}
        if target != 'round' and not (target.startswith('sub:') and (folder/'feedback-receipts'/f'{target[4:]}.json').is_file() and re.fullmatch('[0-9a-f-]{36}', target[4:])): return 400, {'error': '表情的目标不存在。'}
        with self.lock:
            data = self.reactions(folder)
            mine = [e for e in data.get(target, []) if e != emoji] + ([emoji] if on else [])
            if mine: data[target] = mine
            else: data.pop(target, None)
            save(folder/'reactions.json', data)
        return 200, {'reactions': data}

    # ---- what happened so far: every round of this task and what was decided about it
    def history(self, entry, rel):
        """Rounds (their results in brief) and the saved submissions, so a report can show per-check history and the discussion.

        `rel` is the path of one round inside the delivery; sibling round-NN folders are the other rounds. Evidence links
        are relative to that round's report page. The saved receipts are the only record of decisions; nothing is kept twice."""
        base = Path(entry['root']).resolve()
        here = base.joinpath(*rel).resolve()
        if not here.is_relative_to(base) or not (here/'result.json').is_file(): return None
        folders = sorted(p for p in here.parent.glob('round-*') if (p/'result.json').is_file()) if here != base else [here]
        rounds = []
        for folder in folders:
            try: report = json.loads((folder/'result.json').read_text())
            except (OSError, ValueError): continue
            prefix = '' if folder == here else f'../{folder.name}/'
            submissions = []
            for path in sorted((folder/'feedback-receipts').glob('*.json')):
                try: record = json.loads(path.read_text())
                except (OSError, ValueError): continue
                body = record.get('feedback', {})
                submissions.append({'id': record.get('id'), 'at': record.get('at') or time.strftime('%Y-%m-%dT%H:%M:%S%z', time.localtime(path.stat().st_mtime)),
                                    'status': record.get('status'), 'decision': body.get('decision'), 'accepted': body.get('accepted', []), 'ignored': body.get('ignored', []),
                                    'rejected': body.get('rejected', []), 'comment': body.get('comment', '')})
            submissions.sort(key=lambda x: x['at'])
            rounds.append({'round': report.get('round'), 'created_at': report.get('created_at'), 'title': report.get('title'), 'summary': report.get('summary'),
                           'flows': report.get('flows', []), 'message': report.get('message'), 'reactions': self.reactions(folder),
                           'cases': [{'id': c['id'], 'title': c.get('title'), 'status': c.get('status'), 'note': (c.get('observation') or '')[:240], 'files': len(c.get('evidence', [])),
                                      'evidence': [{'kind': e['kind'], 'caption': e.get('caption'), 'path': prefix+e['path'], 'group': e.get('group'), 'label': e.get('label')}
                                                   for e in c.get('evidence', []) if e.get('kind') in ('image', 'video')]} for c in report.get('cases', [])],
                           'submissions': submissions})
        rounds.sort(key=lambda r: r['round'] or 0)
        return {'rounds': rounds}

    # ---- the dashboard
    def rows(self):
        out = []
        for slug, entry in sorted(self.data()['deliveries'].items()):
            root = Path(entry['root'])
            report_path, report = latest_report(root) if root.is_dir() else (root/'result.json', None)
            counts = {}
            for case in (report or {}).get('cases', []):
                status = case.get('status', 'pending')
                counts[status] = counts.get(status, 0)+1
            out.append(dict(slug=slug, state=entry.get('state', 'active'), agent=entry.get('agent', 'agent'), pane=entry.get('pane') if entry.get('herdr_socket') else None,
                            title=(report or {}).get('title') or slug, project=(report or {}).get('project'), round=(report or {}).get('round'), counts=counts,
                            changed=entry.get('changed'), root=root, report=report_path))
        return out

    def dashboard(self):
        origin = self.origin() or ''
        rows = self.rows()
        sections = ''
        for state, caption in (('active', 'Active · 进行中'), ('archived', 'Archived · 已归档'), ('cleaned', 'Cleaned · 已清理')):
            mine = [r for r in rows if r['state'] == state]
            items = ''
            for r in mine:
                slug = html.escape(r['slug'])
                where = r['report'].parent.relative_to(r['root']).as_posix() if r['root'] in r['report'].parents else ''
                link = f"{origin}/delivery/{r['slug']}/{where+'/' if where else ''}report.html"
                badges = ' '.join(f'<b class="{html.escape(k)}">{html.escape(CASE_WORDS.get(k, k))} {v}</b>' for k, v in sorted(r['counts'].items()))
                title = html.escape(r['title'])
                head = f'<a href="{html.escape(link)}">{title}</a>' if state != 'cleaned' else f'<span>{title}</span>'
                action = {'active': ('archived', '归档'), 'archived': ('active', '恢复')}.get(state)
                button = f'<button data-slug="{slug}" data-to="{action[0]}">{action[1]}</button>' if action else ''
                meta = ' · '.join(x for x in (slug, f"第 {r['round']} 轮" if r['round'] else '', html.escape(r['agent']),
                                              '可反馈' if r['pane'] else '未绑定反馈', html.escape((r['changed'] or '')[:16].replace('T', ' '))) if x)
                items += f'<li><div>{head}<small>{meta}</small>{badges}</div>{button}</li>'
            sections += f'<section><h2>{caption} <em>{len(mine)}</em></h2><ul>{items or "<li class=empty>没有</li>"}</ul></section>'
        previews = self.previews()
        items = ''.join(f'<li><div><a href="{html.escape(self.preview_url(v["port"]) or "")}">{html.escape(n)}</a><small>localhost:{v["local"]} → :{v["port"]}</small></div></li>' for n, v in sorted(previews.items()))
        sections += f'<section><h2>Previews · 预览 <em>{len(previews)}</em></h2><ul>{items or "<li class=empty>没有</li>"}</ul></section>'
        return PAGE.replace('@@SECTIONS@@', sections).replace('@@ORIGIN@@', json.dumps(origin))


PAGE = """<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>交付看板</title><style>
:root{--bg:#fafafc;--fg:#1d2430;--mute:#6b7585;--card:#fff;--line:#e3e7ee;--ok:#1f9d55;--bad:#d64545;--warn:#c98a00;--blue:#2368c4}
@media (prefers-color-scheme:dark){:root{--bg:#14161c;--fg:#e6e9ef;--mute:#8d96a6;--card:#1c1f27;--line:#2b303b;--blue:#6aa6ff}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 -apple-system,system-ui,"PingFang SC",sans-serif}
main{max-width:760px;margin:0 auto;padding:20px 16px 48px}h1{font-size:20px;margin:4px 0 16px}h2{font-size:13px;color:var(--mute);margin:24px 0 8px;letter-spacing:.04em}h2 em{font-style:normal;margin-left:4px}
ul{list-style:none;margin:0;padding:0;display:grid;gap:8px}li{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 14px;display:flex;gap:12px;align-items:center;justify-content:space-between}
li div{min-width:0;display:grid;gap:4px}li a{color:var(--blue);font-weight:600;text-decoration:none;overflow-wrap:anywhere}li span{font-weight:600}small{color:var(--mute);overflow-wrap:anywhere}
.empty{color:var(--mute);justify-content:center}b{font-size:12px;font-weight:600;margin-right:6px}b.passed{color:var(--ok)}b.failed{color:var(--bad)}b.blocked,b.pending{color:var(--warn)}
button{font:inherit;font-size:13px;border:1px solid var(--line);background:transparent;color:var(--fg);border-radius:8px;padding:6px 10px;white-space:nowrap}
</style></head><body><main><h1>交付看板</h1>@@SECTIONS@@</main><script>
document.addEventListener('click',async e=>{const b=e.target.closest('button[data-slug]');if(!b)return;b.disabled=true;
const r=await fetch(@@ORIGIN@@+'/delivery/state',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({slug:b.dataset.slug,state:b.dataset.to})});
if(r.ok)location.reload();else{b.disabled=false;b.textContent='失败，重试'}});
</script></body></html>"""


def byte_range(header, size):
    """(start, end) for a single `bytes=a-b` range, None when absent, 'invalid' when unsatisfiable."""
    match = re.fullmatch(r'bytes=(\d*)-(\d*)', (header or '').strip())
    if not match or not any(match.groups()): return None
    first, last = match.groups()
    if not first: start, end = max(size - int(last), 0), size - 1  # suffix range: the last N bytes
    else: start, end = int(first), min(int(last), size - 1) if last else size - 1
    return (start, end) if start <= end and start < size else 'invalid'


def handler_for(hub):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args): pass

        def send(self, status, body, kind='application/json; charset=utf-8', extra=()):
            data = body if isinstance(body, bytes) else (body if isinstance(body, str) else json.dumps(body, ensure_ascii=False)).encode()
            self.send_response(status); self.send_header('Content-Type', kind)
            self.send_header('Content-Length', str(len(data))); self.send_header('Cache-Control', 'no-store')
            for key, value in extra: self.send_header(key, value)
            self.end_headers(); self.wfile.write(data)

        def parts(self):
            path = unquote(urlsplit(self.path).path)
            # Tailscale versions can retain or strip the registered proxy prefix.
            if path == '/delivery' or path.startswith('/delivery/'): path = path[len('/delivery'):]
            values = path.strip('/').split('/') if path.strip('/') else []
            return (values[0], values[1:]) if values else ('', [])

        def do_GET(self):
            slug, parts = self.parts()
            if not slug:
                if urlsplit(self.path).path == '/delivery': return self.send(301, b'', 'text/plain', [('Location', '/delivery/')])
                return self.send(200, hub.dashboard(), 'text/html; charset=utf-8')
            if slug == 'index.json' and not parts: return self.send(200, hub.index())
            entry = hub.entry(slug)
            if entry and entry.get('state') == 'cleaned': return self.send(410, {'error': '本报告已清理。'})
            if not entry or not parts or any(x in ('', '..', '.') or x.startswith('.') for x in parts) or 'feedback-receipts' in parts:
                return self.send(404, {'error': '文件不存在。'})
            if parts[-1] == 'history.json':
                found = hub.history(entry, parts[:-1])
                return self.send(200, found) if found else self.send(404, {'error': '文件不存在。'})
            root = Path(entry['root']).resolve(); target = root.joinpath(*parts).resolve()
            if not target.is_relative_to(root) or not target.is_file(): return self.send(404, {'error': '文件不存在。'})
            data = target.read_bytes()
            kind = mimetypes.guess_type(target.name)[0] or 'application/octet-stream'
            extra = [('X-Content-Type-Options', 'nosniff'), ('Accept-Ranges', 'bytes')]
            span = byte_range(self.headers.get('Range'), len(data))
            if span == 'invalid': return self.send(416, b'', 'text/plain', [('Content-Range', f'bytes */{len(data)}')])
            if span:  # Safari and iOS refuse to play a video unless the server answers Range with 206
                start, end = span
                return self.send(206, data[start:end + 1], kind, extra + [('Content-Range', f'bytes {start}-{end}/{len(data)}')])
            self.send(200, data, kind, extra)

        def do_POST(self):
            slug, parts = self.parts()
            if not hub.allows_origin(self.headers.get('Origin')): return self.send(403, {'error': '请从登记的 Tailscale 入口提交。'})
            if self.headers.get('Content-Type', '').split(';')[0] != 'application/json': return self.send(415, {'error': '只接收 JSON。'})
            try:
                size = int(self.headers.get('Content-Length', '0'))
                if size <= 0 or size > 65536: return self.send(413, {'error': '内容过长。'})
                body = json.loads(self.rfile.read(size))
                if not isinstance(body, dict): raise ValueError('object required')
                if slug == 'state' and not parts:
                    target, state = body.get('slug'), body.get('state')
                    entry = hub.entry(target) if isinstance(target, str) else None
                    # the page may only archive and restore; deleting files stays a command line decision
                    if not entry or state not in ('active', 'archived') or entry.get('state') == 'cleaned': return self.send(400, {'error': '状态不能这样改。'})
                    hub.set_state(target, state)
                    return self.send(200, {'ok': True})
                if parts and parts[-1] == 'reaction':
                    status, value = hub.react(slug, body, parts[:-1])
                    return self.send(status, value)
                if not parts or parts[-1] != 'feedback': return self.send(404, {'error': '入口不存在。'})
                status, value = hub.submit(slug, body, parts[:-1])
                self.send(status, value)
            except (ValueError, OSError, KeyError): self.send(400, {'error': '请求未处理，请检查内容。'})
    return Handler


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--registry', type=Path, default=DEFAULT_REGISTRY)
    sub = parser.add_subparsers(dest='action', required=True)
    register = sub.add_parser('register', help='put a delivery on the board (again, to rebind or reactivate it)')
    register.add_argument('slug'); register.add_argument('root', type=Path)
    register.add_argument('--origin', required=True, help="the device's Tailscale HTTPS origin")
    register.add_argument('--pane', default=os.environ.get('HERDR_PANE_ID'), help='the herdr pane feedback goes to (default: this pane)')
    register.add_argument('--herdr-socket', default=os.environ.get('HERDR_SOCKET_PATH'), help='the herdr server that pane lives on (default: this one)')
    register.add_argument('--agent', default=guess_agent(), help='claude, pi, codex... (default: guessed from the environment)')
    for name, text in (('archive', 'keep serving it, but out of the active list'), ('activate', 'bring an archived delivery back')):
        sub.add_parser(name, help=text).add_argument('slug')
    clean = sub.add_parser('clean', help="delete a delivery's files, keeping result.json and the saved feedback")
    clean.add_argument('slug'); clean.add_argument('--yes', action='store_true', help='really delete (without it, only says what would go)')
    preview = sub.add_parser('preview', help=f'give a running local web app a fixed Tailscale address ({PREVIEW_PORTS[0]}-{PREVIEW_PORTS[-1]}); the same name keeps its port')
    preview.add_argument('name'); preview.add_argument('local_port', type=int)
    sub.add_parser('preview-rm', help='stop serving a preview and free its port').add_argument('name')
    listing = sub.add_parser('list', help='every delivery and its state (--json: what an agent reads at the start of work)')
    listing.add_argument('--json', action='store_true')
    sweep = sub.add_parser('sweep', help=f'archive active deliveries untouched for {ARCHIVE_AFTER_DAYS} days')
    sweep.add_argument('--days', type=int, default=ARCHIVE_AFTER_DAYS)
    sub.add_parser('serve').add_argument('--port', type=int, default=PORT)
    args = parser.parse_args()
    hub = Hub(args.registry)
    data = hub.data()

    if args.action == 'serve':
        def sweeper():
            while True:
                try: hub.sweep()
                except Exception as error: print('sweep failed:', error, file=sys.stderr)
                time.sleep(3600)
        threading.Thread(target=sweeper, daemon=True).start()
        ThreadingHTTPServer(('127.0.0.1', args.port), handler_for(hub)).serve_forever()
    elif args.action == 'preview':
        if not SLUG.fullmatch(args.name): parser.error('name must be lowercase letters, digits and hyphens')
        if not 1024 <= args.local_port <= 65535 or args.local_port == PORT: parser.error('local_port must be the port of the web app (1024-65535, not the board)')
        if not data.get('origin'): parser.error('no Tailscale origin yet: register a delivery first')
        port = hub.preview_port(args.name)
        done = subprocess.run([TAILSCALE, 'serve', '--bg', '--yes', f'--https={port}', f'http://127.0.0.1:{args.local_port}'], capture_output=True, text=True)
        if done.returncode != 0: sys.exit('tailscale serve failed: '+(done.stderr or done.stdout).strip()[:300])
        with hub.lock:
            data = hub.data(); data.setdefault('previews', {})[args.name] = {'port': port, 'local': args.local_port, 'changed': time.strftime('%Y-%m-%dT%H:%M:%S%z')}
            save(args.registry, data)
        print(hub.preview_url(port))
    elif args.action == 'preview-rm':
        known = data.get('previews', {})
        if args.name not in known: parser.error('no such preview: '+args.name)
        done = subprocess.run([TAILSCALE, 'serve', '--yes', f"--https={known[args.name]['port']}", 'off'], capture_output=True, text=True)
        if done.returncode != 0: sys.exit('tailscale serve off failed: '+(done.stderr or done.stdout).strip()[:300])
        with hub.lock:
            data = hub.data(); data['previews'].pop(args.name, None); save(args.registry, data)
        print('removed', args.name)
    elif args.action == 'sweep':
        moved = hub.sweep(args.days)
        print(f"archived {len(moved)}: {', '.join(moved) or '-'}")
    elif args.action == 'list' and args.json:
        print(json.dumps(hub.index(), ensure_ascii=False, indent=2))
    elif args.action == 'list':
        for name, v in sorted(hub.previews().items()): print(f"preview   {name:40} :{v['port']} <- localhost:{v['local']}")
        for row in hub.rows(): print(f"{row['state']:9} {row['slug']:40} {row['agent']:7} {'pane' if row['pane'] else '-':5} {row['title']}")
    elif args.action == 'register':
        origin = urlsplit(args.origin)
        if origin.scheme != 'https' or not origin.hostname or not origin.hostname.endswith('.ts.net') or origin.path not in ('', '/'):
            parser.error('origin must be a Tailscale HTTPS device origin')
        if not SLUG.fullmatch(args.slug): parser.error('slug must be lowercase letters, digits and hyphens')
        root = args.root.resolve()
        if not root.is_dir(): parser.error('registered directory does not exist')
        if args.pane and not args.herdr_socket: parser.error('--pane needs --herdr-socket (or run inside the herdr pane, where both are set)')
        existing = data['deliveries'].get(args.slug)
        if existing and existing['root'] != str(root): parser.error('slug already owns another directory')
        selected = args.origin.rstrip('/')
        if data.get('origin') and data['origin'] != selected: parser.error('the board has one origin; keep it: '+data['origin'])
        data['origin'] = selected
        data['deliveries'][args.slug] = {'root': str(root), 'state': 'active', 'agent': args.agent, 'pane': args.pane, 'herdr_socket': args.herdr_socket if args.pane else None, 'changed': time.strftime('%Y-%m-%dT%H:%M:%S%z')}
        save(args.registry, data)
        print(selected+'/delivery/'+args.slug+'/report.html')
        print('board: '+selected+'/delivery/', file=sys.stderr)
    else:
        entry = data['deliveries'].get(args.slug)
        if not entry: parser.error('no such delivery: '+args.slug)
        if args.action in ('archive', 'activate'):
            if entry.get('state') == 'cleaned': parser.error('already cleaned: its files are gone')
            hub.set_state(args.slug, 'archived' if args.action == 'archive' else 'active')
        else:
            root = Path(entry['root']).resolve()
            doomed = files_beyond_record(root) if root.is_dir() else []
            freed = sum(p.stat().st_size for p in doomed)
            print(f"{'delete' if args.yes else 'would delete'} {len(doomed)} file(s), {freed/1e6:.1f} MB under {root}")
            if args.yes:
                for p in doomed: p.unlink()
                for d in sorted((p for p in root.rglob('*') if p.is_dir()), reverse=True):
                    if not any(d.iterdir()): d.rmdir()
                hub.set_state(args.slug, 'cleaned', freed_bytes=freed)


if __name__ == '__main__': main()
