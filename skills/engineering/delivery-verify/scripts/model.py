"""Validate one local verification round and derive its verdict."""
from datetime import datetime
from pathlib import Path
import re

STATUSES = {
    'passed': '已通过', 'failed': '未通过', 'uncertain': '不确定',
    'blocked': '已阻塞', 'pending': '未执行', 'skipped': '已跳过',
}
EXTENSIONS = {
    'image': {'.png', '.jpg', '.jpeg', '.webp', '.gif'},
    'video': {'.mp4', '.webm'},
    'text': {'.txt', '.log', '.json', '.md', '.csv'},
}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def text(data, field):
    value = data.get(field)
    require(isinstance(value, str) and value.strip(), f'{field}: expected non-empty text')
    return value


def array(data, field):
    value = data.get(field)
    require(isinstance(value, list), f'{field}: expected array')
    return value


def local_file(root, value, kind):
    require(isinstance(value, str) and value.strip(), 'file path must be non-empty text')
    path = Path(value)
    require(not path.is_absolute(), f'file path must be relative: {value}')
    resolved = (root / path).resolve()
    require(resolved.is_relative_to(root.resolve()), f'file escapes round directory: {value}')
    require(path.suffix.lower() in EXTENSIONS[kind], f'unsupported {kind} file: {value}')
    require(resolved.is_file() and resolved.stat().st_size > 0, f'missing or empty file: {value}')
    return resolved


def validate_evidence(item, root):
    require(isinstance(item, dict), 'evidence entry must be an object')
    kind = text(item, 'kind')
    require(kind in EXTENSIONS, f'unknown evidence kind: {kind}')
    local_file(root, item.get('path'), kind)
    text(item, 'caption')
    text(item, 'source')
    require(item.get('phase') in ('process', 'final'), 'phase must be process or final')
    require(type(item.get('inspected')) is bool, 'inspected must be boolean')
    for field in ('group', 'label'):  # evidence sharing a group is shown side by side (light and dark of one state, before and after)
        if field in item:
            text(item, field)
    require(('label' in item) <= ('group' in item), 'label needs a group')


def validate_case(case, root):
    require(isinstance(case, dict), 'case must be an object')
    for field in ('id', 'title', 'method', 'expected', 'observation', 'status'):
        text(case, field)
    require(re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9_-]*', case['id']), 'invalid case id')
    require(case['status'] in STATUSES, f'unknown status: {case["status"]}')
    require(type(case.get('required')) is bool, 'required must be boolean')
    kinds = array(case, 'evidence_required')
    require(all(isinstance(k, str) and k in EXTENSIONS for k in kinds), 'invalid evidence_required')
    evidence = array(case, 'evidence')
    for item in evidence:
        validate_evidence(item, root)
    if case['status'] != 'passed':
        return
    require(evidence and all(item['inspected'] for item in evidence),
            f'{case["id"]}: passed requires inspected evidence')
    require(set(kinds) <= {item['kind'] for item in evidence},
            f'{case["id"]}: missing required evidence types')


def validate_checks(data, root):
    for check in array(data, 'checks'):
        require(isinstance(check, dict), 'check must be an object')
        text(check, 'name')
        text(check, 'command')
        require('exit_code' in check and (check['exit_code'] is None or type(check['exit_code']) is int),
                'exit_code must be raw integer or null')
        local_file(root, check.get('log'), 'text')


def validate_flows(data):
    """Optional user journeys: each flow lists checks in the order a user goes through them; `label` on a step is what the user does to get there from the step before."""
    if 'flows' not in data:
        return
    flows = array(data, 'flows')
    ids = {c['id'] for c in data['cases']}
    seen = set()
    for flow in flows:
        require(isinstance(flow, dict), 'flow must be an object')
        text(flow, 'title')
        require(re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9_-]*', str(flow.get('id', ''))), 'invalid flow id')
        require(flow['id'] not in seen, 'duplicate flow id')
        seen.add(flow['id'])
        steps = array(flow, 'steps')
        require(steps, f'flow {flow["id"]}: at least one step required')
        for step in steps:
            require(isinstance(step, dict) and step.get('case') in ids, f'flow {flow["id"]}: step must name a case of this round')
            if 'label' in step:
                text(step, 'label')


def validate_message(data):
    if 'message' in data:
        require(isinstance(data['message'], str) and data['message'].strip() and len(data['message']) <= 8000, 'message: expected non-empty text of at most 8000 characters')


def validate_history(data, root):
    if 'feedback' in data:
        text(data, 'feedback')
    if 'previous_report' not in data:
        return
    value = text(data, 'previous_report')
    path = Path(value)
    require(not path.is_absolute(), 'previous_report must be relative')
    target = (root / path).resolve()
    require(target.is_relative_to(root.resolve().parent) and not target.is_relative_to(root.resolve()),
            'previous_report must be in a sibling round within this task')
    require(target.name == 'report.html' and target.is_file(), 'previous_report must exist as report.html')
    require(data['round'] > 1, 'first round cannot have previous_report')


def validate(data, root):
    require(isinstance(data, dict), 'result must be an object')
    require(type(data.get('schema_version')) is int and data['schema_version'] == 1, 'schema_version must be 1')
    for field in ('title', 'summary', 'project', 'task', 'created_at', 'revision', 'environment', 'entry', 'review'):
        text(data, field)
    require(type(data.get('round')) is int and data['round'] > 0, 'round must be a positive integer')
    created = datetime.fromisoformat(data['created_at'].replace('Z', '+00:00'))
    require(created.tzinfo is not None, 'created_at must include timezone')
    for field in ('process', 'limitations'):
        values = array(data, field)
        require(all(isinstance(v, str) and v.strip() for v in values), f'{field}: expected non-empty strings')
    require(data['process'], 'process must describe actual progress')
    cases = array(data, 'cases')
    require(cases, 'at least one case required')
    for case in cases:
        validate_case(case, root)
    require(len({c['id'] for c in cases}) == len(cases), 'duplicate case id')
    require(any(c['required'] for c in cases), 'at least one required case')
    validate_checks(data, root)
    validate_flows(data)
    validate_message(data)
    cleanup = data.get('cleanup')
    require(isinstance(cleanup, dict) and type(cleanup.get('complete')) is bool, 'cleanup.complete must be boolean')
    text(cleanup, 'notes')
    validate_history(data, root)


def verdict(data):
    if any(c['status'] == 'failed' for c in data['cases']) or any(
            c['exit_code'] not in (None, 0) for c in data['checks']):
        return 'failed', '未通过'
    if (any(c['required'] and c['status'] != 'passed' for c in data['cases'])
            or any(c['exit_code'] is None for c in data['checks'])
            or not data['cleanup']['complete']):
        return 'uncertain', '验证未完成'
    return 'passed', '范围内验证通过'
