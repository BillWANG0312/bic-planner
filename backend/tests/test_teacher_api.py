import copy

import pytest
from fastapi.testclient import TestClient

from backend.bic_api.app import create_app
from backend.bic_api.settings import Settings
from backend.tests.test_api import Clock, PASSWORD, record
from backend.tests.test_share_api import content
from backend.tests.test_draft_api import context

ORIGIN = 'http://127.0.0.1:9001'


@pytest.fixture
def access(tmp_path):
    clock = Clock()
    app = create_app(Settings(database_path=tmp_path / 'teacher.sqlite3', public_origin=ORIGIN, development=True), clock=clock)
    for name, role in [('owner', 'student'), ('teacher', 'advisor'), ('other', 'advisor'), ('parent', 'student')]:
        app.state.auth.create_user(name, PASSWORD, role=role)
    clients, headers = {}, {}
    try:
        for name in ['owner', 'teacher', 'other', 'parent']:
            client = TestClient(app, base_url=ORIGIN)
            session = client.post('/api/auth/login', headers={'Origin': ORIGIN}, json={'username': name, 'password': PASSWORD}).json()
            clients[name], headers[name] = client, {'Origin': ORIGIN, 'X-CSRF-Token': session['csrf_token']}
        saved = clients['owner'].post('/api/reports', headers=headers['owner'], json={'record': record()}).json()
        yield app, clients, headers, saved, clock
    finally:
        for client in clients.values():
            client.close()


def create(clients, headers, saved, **changes):
    return clients['owner'].post('/api/reports/' + saved['id'] + '/teacher-access', headers=headers['owner'],
                                  json={'revision': saved['revision'], 'recipient_username': 'teacher', 'ttl_hours': 24,
                                        'scope': 'full_report_read_only', **changes})


def test_explicit_full_scope_owner_csrf_and_existing_advisor_are_required(access):
    _, clients, headers, saved, _ = access
    path = '/api/reports/' + saved['id'] + '/teacher-access'
    value = {'revision': 1, 'recipient_username': 'teacher', 'ttl_hours': 24, 'scope': 'full_report_read_only'}
    assert clients['owner'].post(path, headers={'Origin': ORIGIN}, json=value).status_code == 403
    assert clients['owner'].post(path, headers={'X-CSRF-Token': headers['owner']['X-CSRF-Token']}, json=value).status_code == 403
    assert clients['other'].post(path, headers=headers['other'], json=value).status_code == 404
    for change in [{'scope': 'edit'}, {'revision': True}, {'ttl_hours': 1}, {'owner_id': 'other'}]:
        assert create(clients, headers, saved, **change).status_code == 422
    missing = {key: val for key, val in value.items() if key != 'scope'}
    assert clients['owner'].post(path, headers=headers['owner'], json=missing).status_code == 422
    assert create(clients, headers, saved, recipient_username='parent').status_code == 404
    assert create(clients, headers, saved, recipient_username='unknown.account').status_code == 404
    response = create(clients, headers, saved, recipient_username='TEACHER')
    assert response.status_code == 201, response.text
    grant = response.json()
    assert grant['scope'] == 'full_report_read_only' and grant['status'] == 'active'
    assert grant['owner_username'] == 'owner' and grant['recipient_username'] == 'teacher'
    assert create(clients, headers, saved).status_code == 409
    assert clients['teacher'].get('/api/teacher-access', headers={'X-CSRF-Token': 'wrong-session'}).status_code == 403


def test_only_the_recipient_can_read_and_original_owner_writes_remain_inaccessible(access):
    _, clients, headers, saved, _ = access
    response = create(clients, headers, saved)
    assert response.status_code == 201, response.text
    grant = response.json(); path = '/api/teacher-access/' + grant['id']
    assert [item['id'] for item in clients['teacher'].get('/api/teacher-access', headers=headers['teacher']).json()['items']] == [grant['id']]
    result = clients['teacher'].get(path, headers=headers['teacher'])
    assert result.status_code == 200 and result.json()['report'] == saved
    for actor in ['owner', 'other', 'parent']:
        assert clients[actor].get(path, headers=headers[actor]).status_code == 404
    assert clients['parent'].get('/api/teacher-access', headers=headers['parent']).status_code == 404
    teacher, token = clients['teacher'], headers['teacher']
    report_path = '/api/reports/' + saved['id']
    assert teacher.get(report_path, headers=token).status_code == 404
    assert teacher.put(report_path, headers=token, json={'revision': 1, 'record': saved['record']}).status_code == 404
    assert teacher.delete(report_path + '?revision=1', headers=token).status_code == 404
    for suffix, body in [('/shares', {'revision': 1, 'ttl_hours': 24, 'content': content()}),
                         ('/parent-access', {'revision': 1, 'ttl_hours': 24, 'recipient_username': 'parent', 'content': content()}),
                         ('/advice-drafts', {'revision': 1, 'context': context(), 'fallback': content()['sections']}),
                         ('/teacher-access', {'revision': 1, 'ttl_hours': 24, 'recipient_username': 'other', 'scope': 'full_report_read_only'})]:
        assert teacher.post(report_path + suffix, headers=token, json=body).status_code == 404
    assert clients['owner'].get(report_path, headers=headers['owner']).json() == saved
    assert result.headers['cache-control'] == 'no-store'


def test_revision_change_closes_the_old_grant_and_requires_new_owner_confirmation(access):
    _, clients, headers, saved, _ = access
    response = create(clients, headers, saved)
    assert response.status_code == 201, response.text
    grant = response.json(); report_path = '/api/reports/' + saved['id']
    changed = copy.deepcopy(saved['record']); changed['state']['info']['name'] = '新修订私密名字'
    updated = clients['owner'].put(report_path, headers=headers['owner'], json={'revision': 1, 'record': changed}).json()
    assert create(clients, headers, saved).status_code == 409
    assert clients['teacher'].get('/api/teacher-access', headers=headers['teacher']).json() == {'items': []}
    assert clients['teacher'].get('/api/teacher-access/' + grant['id'], headers=headers['teacher']).status_code == 404
    history = clients['owner'].get(report_path + '/teacher-access', headers=headers['owner']).json()['items']
    assert history[0]['status'] == 'source_changed'
    renewed = create(clients, headers, updated)
    assert renewed.status_code == 201
    assert clients['teacher'].get('/api/teacher-access/' + renewed.json()['id'], headers=headers['teacher']).json()['report']['record'] == changed


def test_expiry_revoke_disable_and_delete_close_new_reads_without_expanding_parent_permissions(access):
    app, clients, headers, saved, clock = access
    response = create(clients, headers, saved)
    assert response.status_code == 201, response.text
    grant = response.json(); path = '/api/reports/' + saved['id'] + '/teacher-access/' + grant['id']
    assert clients['other'].delete(path, headers=headers['other']).status_code == 404
    assert clients['owner'].delete(path, headers=headers['owner']).status_code == 204
    assert clients['owner'].delete(path, headers=headers['owner']).status_code == 204
    assert clients['teacher'].get('/api/teacher-access/' + grant['id'], headers=headers['teacher']).status_code == 404
    expiring = create(clients, headers, saved).json(); clock.value = expiring['expires_at']
    for actor in ['owner', 'teacher']:
        session = clients[actor].post('/api/auth/login', headers={'Origin': ORIGIN}, json={'username': actor, 'password': PASSWORD}).json()
        headers[actor] = {'Origin': ORIGIN, 'X-CSRF-Token': session['csrf_token']}
    assert clients['teacher'].get('/api/teacher-access/' + expiring['id'], headers=headers['teacher']).status_code == 404
    fresh = create(clients, headers, saved).json()
    app.state.db.disable_user('owner')
    assert clients['teacher'].get('/api/teacher-access/' + fresh['id'], headers=headers['teacher']).status_code == 404
    assert clients['teacher'].get('/api/teacher-access', headers=headers['teacher']).json() == {'items': []}


def test_teacher_page_is_explicitly_served_without_private_source_or_new_public_write_routes(tmp_path):
    from backend.bic_api.dev import create_dev_app
    app = create_dev_app(Settings(database_path=tmp_path / 'dev.sqlite3', public_origin=ORIGIN, development=True))
    with TestClient(app, base_url=ORIGIN) as client:
        page = client.get('/teacher.html')
        assert page.status_code == 200 and 'teacherConnectBtn' in page.text
        assert page.headers['referrer-policy'] == 'no-referrer'
        assert client.get('/backend/bic_api/teacher_access.py').status_code == 404
        assert client.get('/api/teacher-access').status_code == 401
        assert client.post('/api/teacher-access/anything', headers={'Origin': ORIGIN}, json={}).status_code == 405
