import copy

import pytest
from fastapi.testclient import TestClient

from backend.bic_api.app import create_app
from backend.bic_api.settings import Settings
from backend.tests.test_api import Clock, ORIGIN, PASSWORD, record


def content():
    return {'status': 'draft', 'direction': '计算机科学', 'personality': '待完成性格测评',
            'subjects': [{'key': key, 'name': name, 'answered': 0, 'total': 15, 'pct': None}
                         for key, name in [('english', '英语'), ('maths', '数学'), ('physics', '物理'), ('chemistry', '化学')]],
            'sections': {key: '建议先完成测评，再与老师讨论。' for key in ['summary', 'academic', 'plan', 'personality']}}


@pytest.fixture
def shared(tmp_path):
    clock = Clock()
    app = create_app(Settings(database_path=tmp_path / 'api.sqlite3', public_origin=ORIGIN), clock=clock)
    app.state.auth.create_user('owner', PASSWORD, 'advisor')
    app.state.auth.create_user('other', PASSWORD)
    with TestClient(app, base_url=ORIGIN) as owner, TestClient(app, base_url=ORIGIN) as guest:
        session = owner.post('/api/auth/login', json={'username': 'owner', 'password': PASSWORD}, headers={'Origin': ORIGIN}).json()
        headers = {'Origin': ORIGIN, 'X-CSRF-Token': session['csrf_token']}
        saved = owner.post('/api/reports', json={'record': record()}, headers=headers).json()
        yield owner, guest, headers, saved, clock


def create(owner, headers, saved):
    return owner.post('/api/reports/' + saved['id'] + '/shares',
                      json={'revision': saved['revision'], 'ttl_hours': 24, 'content': content()}, headers=headers)


def test_owner_creates_minimal_anonymous_read_only_snapshot_without_exposing_token_in_lists(shared):
    owner, guest, headers, saved, _ = shared
    created = create(owner, headers, saved)
    assert created.status_code == 201, created.text
    share = created.json()
    token = share['token']
    response = guest.get('/api/public/share', headers={'X-BIC-Share': token})
    assert response.status_code == 200
    snapshot = response.json()
    assert snapshot['report']['name'] == saved['record']['state']['info']['name']
    assert snapshot['report']['revision'] == 1
    for forbidden in ['answers', 'history', 'owner_id', 'username', 'password', token]:
        assert forbidden not in response.text
    assert response.headers['cache-control'] == 'no-store'
    assert response.headers['referrer-policy'] == 'no-referrer'
    assert 'noindex' in response.headers['x-robots-tag']
    assert 'set-cookie' not in response.headers
    listing = owner.get('/api/reports/' + saved['id'] + '/shares', headers=headers)
    assert listing.status_code == 200 and len(listing.json()['items']) == 1
    assert token not in listing.text and 'token' not in listing.text
    assert guest.get('/api/reports/' + saved['id']).status_code == 401
    assert guest.post('/api/public/share', json={}, headers={'Origin': ORIGIN, 'X-BIC-Share': token}).status_code == 405


def test_share_expiry_revocation_and_missing_tokens_are_indistinguishable(shared):
    owner, guest, headers, saved, clock = shared
    first = create(owner, headers, saved).json()
    path = '/api/reports/' + saved['id'] + '/shares/' + first['id']
    assert owner.delete(path, headers={'Origin': ORIGIN}).status_code == 403
    assert owner.delete(path, headers=headers).status_code == 204
    revoked = guest.get('/api/public/share', headers={'X-BIC-Share': first['token']})
    second = create(owner, headers, saved).json()
    clock.value += 86400
    expired = guest.get('/api/public/share', headers={'X-BIC-Share': second['token']})
    missing = guest.get('/api/public/share')
    bad = guest.get('/api/public/share', headers={'X-BIC-Share': 'x' * 43})
    assert revoked.status_code == expired.status_code == missing.status_code == bad.status_code == 404
    assert revoked.json() == expired.json() == missing.json() == bad.json()


def test_owner_and_revision_checks_prevent_sharing_another_accounts_or_changed_report(shared):
    owner, guest, headers, saved, _ = shared
    assert guest.post('/api/reports/' + saved['id'] + '/shares', json={}, headers={'Origin': ORIGIN}).status_code == 401
    other = guest.post('/api/auth/login', json={'username': 'other', 'password': PASSWORD}, headers={'Origin': ORIGIN}).json()
    other_headers = {'Origin': ORIGIN, 'X-CSRF-Token': other['csrf_token']}
    assert create(guest, other_headers, saved).status_code == 404
    changed = copy.deepcopy(saved['record'])
    changed['state']['info']['name'] = '服务端更新后的同学'
    assert owner.put('/api/reports/' + saved['id'], json={'revision': 1, 'record': changed}, headers=headers).status_code == 200
    assert create(owner, headers, saved).status_code == 409


def test_invalid_share_payloads_do_not_create_capabilities(shared):
    owner, _, headers, saved, _ = shared
    path = '/api/reports/' + saved['id'] + '/shares'
    for change in [{'ttl_hours': 1}, {'revision': True}, {'content': {**content(), 'answers': {}}}, {'owner_id': 'other'}]:
        value = {'revision': 1, 'ttl_hours': 24, 'content': content(), **change}
        assert owner.post(path, json=value, headers=headers).status_code == 422
    assert owner.get(path, headers=headers).json()['items'] == []
