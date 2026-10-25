import copy

from fastapi.testclient import TestClient

from backend.bic_api.dev import create_dev_app
from backend.bic_api.settings import Settings
from backend.tests.test_teacher_api import access

BASELINE = {'summary': '所有者已确认的核心基线', 'academic': '学习基线', 'plan': '规划基线', 'personality': '策略基线'}


def grant(clients, headers, saved, **extra):
    return clients['owner'].post('/api/reports/' + saved['id'] + '/advisor-edit-access', headers=headers['owner'],
                                 json={'revision': 1, 'recipient_username': 'teacher', 'ttl_hours': 24,
                                       'scope': 'full_report_advice_edit', 'baseline': BASELINE, **extra})


def test_edit_grant_requires_new_scope_owner_csrf_and_existing_advisor(access):
    _, clients, headers, saved, _ = access
    path = '/api/reports/' + saved['id'] + '/advisor-edit-access'
    body = {'revision': 1, 'recipient_username': 'teacher', 'ttl_hours': 24,
            'scope': 'full_report_advice_edit', 'baseline': BASELINE}
    assert clients['owner'].post(path, headers={'Origin': 'https://elsewhere.test'}, json=body).status_code == 403
    assert clients['owner'].post(path, headers={'Origin': 'http://127.0.0.1:9001'}, json=body).status_code == 403
    for extra in [{'scope': 'full_report_read_only'}, {'author': 'forged'}, {'baseline': {'summary': 'missing'}},
                  {'revision': True}, {'baseline': {**BASELINE, 'score': 'forged'}}]:
        assert grant(clients, headers, saved, **extra).status_code == 422
    assert grant(clients, headers, saved, recipient_username='parent').status_code == 404
    assert clients['other'].post(path, headers=headers['other'], json=body).status_code == 404
    created = grant(clients, headers, saved)
    assert created.status_code == 201
    assert created.json()['scope'] == 'full_report_advice_edit'


def test_only_edit_recipient_can_submit_selected_text_and_server_actor_is_recorded(access):
    _, clients, headers, saved, _ = access
    created = grant(clients, headers, saved).json()
    path = '/api/advisor-edit-access/' + created['id']
    assert clients['other'].get(path, headers=headers['other']).status_code == 404
    read = clients['teacher'].get(path, headers=headers['teacher'])
    assert read.status_code == 200 and read.json()['baseline'] == BASELINE
    for extra in [{'author': 'forged'}, {'actor': 'forged'}, {'record': saved['record']}, {'before': 'forged'}]:
        assert clients['teacher'].put(path, headers=headers['teacher'], json={'revision': 1, 'changes': {'summary': '新建议'}, **extra}).status_code == 422
    assert clients['teacher'].put(path, headers=headers['teacher'], json={'revision': 1, 'changes': {'score': 100}}).status_code == 422
    assert clients['teacher'].put(path, headers={'Origin': 'http://127.0.0.1:9001'}, json={'revision': 1, 'changes': {'summary': '新建议'}}).status_code == 403
    result = clients['teacher'].put(path, headers=headers['teacher'], json={'revision': 1, 'changes': {'summary': '<b>新建议</b>'}})
    assert result.status_code == 200
    value = result.json()
    assert value['changed_sections'] == ['summary'] and value['audit_id']
    assert value['report']['revision'] == 2
    current = clients['owner'].get('/api/reports/' + saved['id'], headers=headers['owner']).json()
    assert current == value['report']
    for field in ['state', 'reportMeta', 'id', 'createdAt', 'bankVersion', 'catalogVersion']:
        if field in saved['record']:
            assert current['record'][field] == saved['record'][field]
    entry = current['record']['advisor']['history'][-1]
    assert entry['before'] == BASELINE['summary'] and entry['after'] == '<b>新建议</b>'
    assert entry['author'] == '学校顾问' and entry['actor']['username'] == 'teacher'
    assert entry['actor']['source_revision'] == 1 and entry['actor']['result_revision'] == 2
    audit = clients['owner'].get('/api/reports/' + saved['id'] + '/advisor-edits', headers=headers['owner'])
    assert audit.status_code == 200
    assert audit.json()['items'][0]['actor_username'] == 'teacher'
    assert audit.json()['items'][0]['changes'] == [{'section': 'summary', 'before': BASELINE['summary'], 'after': '<b>新建议</b>'}]
    assert clients['teacher'].get('/api/reports/' + saved['id'] + '/advisor-edits', headers=headers['teacher']).status_code == 404
    assert clients['teacher'].get(path, headers=headers['teacher']).status_code == 404
    assert clients['teacher'].put(path, headers=headers['teacher'], json={'revision': 1, 'changes': {'summary': '重放'}}).status_code == 404
    assert clients['teacher'].get('/api/advisor-edit-access', headers=headers['teacher']).json() == {'items': []}


def test_readonly_and_parent_permissions_do_not_become_edit_permissions(access):
    _, clients, headers, saved, _ = access
    readonly = clients['owner'].post('/api/reports/' + saved['id'] + '/teacher-access', headers=headers['owner'],
                                   json={'revision': 1, 'recipient_username': 'teacher', 'ttl_hours': 24, 'scope': 'full_report_read_only'}).json()
    assert clients['teacher'].put('/api/advisor-edit-access/' + readonly['id'], headers=headers['teacher'],
                                  json={'revision': 1, 'changes': {'summary': '不允许'}}).status_code == 404
    created = grant(clients, headers, saved).json()
    for who in ['owner', 'other', 'parent']:
        assert clients[who].put('/api/advisor-edit-access/' + created['id'], headers=headers[who],
                                json={'revision': 1, 'changes': {'summary': '不允许'}}).status_code == 404
    original = clients['owner'].get('/api/reports/' + saved['id'], headers=headers['owner']).json()
    assert original == saved
    path = '/api/reports/' + saved['id'] + '/advisor-edit-access/' + created['id']
    assert clients['other'].delete(path, headers=headers['other']).status_code == 404
    assert clients['owner'].delete(path, headers=headers['owner']).status_code == 204
    assert clients['owner'].delete(path, headers=headers['owner']).status_code == 204
    assert clients['teacher'].get('/api/advisor-edit-access/' + created['id'], headers=headers['teacher']).status_code == 404


def test_source_change_and_session_binding_do_not_silently_rebase_edits(access):
    _, clients, headers, saved, _ = access
    created = grant(clients, headers, saved).json()
    path = '/api/advisor-edit-access/' + created['id']
    assert clients['teacher'].get(path, headers=headers['other']).status_code == 403
    current = copy.deepcopy(saved['record']); current['state']['info']['name'] = '所有者新资料'
    assert clients['owner'].put('/api/reports/' + saved['id'], headers=headers['owner'], json={'revision': 1, 'record': current}).status_code == 200
    assert clients['teacher'].put(path, headers=headers['teacher'], json={'revision': 1, 'changes': {'summary': '旧建议'}}).status_code == 404
    listed = clients['owner'].get('/api/reports/' + saved['id'] + '/advisor-edit-access', headers=headers['owner']).json()
    assert listed['items'][0]['status'] == 'source_changed'
    assert clients['owner'].get('/api/reports/' + saved['id'] + '/advisor-edits', headers=headers['owner']).json()['items'] == []


def test_independent_edit_page_is_public_asset_with_private_api(tmp_path):
    origin = 'http://127.0.0.1:9001'
    app = create_dev_app(Settings(database_path=tmp_path / 'static.sqlite3', public_origin=origin, development=True))
    with TestClient(app, base_url=origin) as client:
        page = client.get('/advisor-edit.html')
        assert page.status_code == 200
        assert page.headers['Cache-Control'] == 'no-store'
        assert page.headers['Referrer-Policy'] == 'no-referrer'
        assert 'localStorage' not in page.text
        assert client.get('/api/advisor-edit-access').status_code == 401
        assert client.put('/api/advisor-edit-access/unknown', headers={'Origin': origin}, json={'revision': 1, 'changes': {'summary': '不能匿名'}}).status_code == 401
