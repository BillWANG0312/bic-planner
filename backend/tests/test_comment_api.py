import pytest
from fastapi.testclient import TestClient

from backend.bic_api.app import create_app
from backend.bic_api.settings import Settings
from backend.tests.test_api import Clock, ORIGIN, PASSWORD, record
from backend.tests.test_share_api import content


@pytest.fixture
def collaboration(tmp_path):
    clock = Clock()
    app = create_app(Settings(database_path=tmp_path / 'comments.sqlite3', public_origin=ORIGIN), clock=clock)
    for username in ['owner', 'parent', 'outsider']:
        app.state.auth.create_user(username, PASSWORD)
    with TestClient(app, base_url=ORIGIN) as owner, TestClient(app, base_url=ORIGIN) as parent, TestClient(app, base_url=ORIGIN) as other:
        def login(client, username):
            value = client.post('/api/auth/login', json={'username': username, 'password': PASSWORD}, headers={'Origin': ORIGIN}).json()
            return {'Origin': ORIGIN, 'X-CSRF-Token': value['csrf_token']}
        h = login(owner, 'owner')
        p = login(parent, 'parent')
        o = login(other, 'outsider')
        saved = owner.post('/api/reports', json={'record': record()}, headers=h).json()
        yield owner, parent, other, h, p, o, saved, clock


def invite(owner, headers, saved):
    return owner.post('/api/reports/' + saved['id'] + '/parent-access', headers=headers,
                      json={'revision': saved['revision'], 'recipient_username': 'parent', 'ttl_hours': 24, 'content': content()})


def test_invitation_is_account_bound_and_comments_do_not_expose_or_change_original_answers(collaboration):
    owner, parent, outsider, h, p, o, saved, _ = collaboration
    response = invite(owner, h, saved)
    assert response.status_code == 201, response.text
    grant = response.json()
    assert grant['recipient_username'] == 'parent' and 'token' not in grant
    thread_path = '/api/parent-access/' + grant['id']
    assert outsider.get(thread_path, headers=o).status_code == 404
    assert parent.get('/api/reports/' + saved['id'], headers=p).status_code == 404
    assert len(parent.get('/api/parent-access', headers=p).json()['items']) == 1
    thread = parent.get(thread_path, headers=p).json()
    assert thread['participant'] == 'recipient' and thread['can_comment'] is True
    assert 'answers' not in str(thread) and 'history' not in str(thread)
    body = {'body': '<b>家长问题</b>', 'client_request_id': '11111111-1111-4111-8111-111111111111'}
    created = parent.post(thread_path + '/comments', headers=p, json=body)
    assert created.status_code == 201 and created.json()['author'] == 'recipient'
    replay = parent.post(thread_path + '/comments', headers=p, json=body)
    assert replay.json()['id'] == created.json()['id']
    assert parent.post(thread_path + '/comments', headers=p, json={**body, 'body': 'changed'}).status_code == 409
    owner_thread = owner.get(thread_path, headers=h).json()
    assert len(owner_thread['comments']) == 1 and owner_thread['participant'] == 'owner'
    assert owner.get('/api/reports/' + saved['id'], headers=h).json() == saved


def test_only_authenticated_csrf_bound_participants_can_append_and_revocation_closes_recipient_access(collaboration):
    owner, parent, outsider, h, p, o, saved, _ = collaboration
    grant = invite(owner, h, saved).json()
    path = '/api/parent-access/' + grant['id']
    body = {'body': '批注问题', 'client_request_id': '22222222-2222-4222-8222-222222222222'}
    assert parent.post(path + '/comments', headers={'Origin': ORIGIN}, json=body).status_code == 403
    assert outsider.post(path + '/comments', headers=o, json=body).status_code == 404
    public = owner.post('/api/reports/' + saved['id'] + '/shares', headers=h,
                        json={'revision': 1, 'ttl_hours': 24, 'content': content()}).json()
    with TestClient(owner.app, base_url=ORIGIN) as anonymous:
        assert anonymous.post(path + '/comments', headers={'Origin': ORIGIN, 'X-BIC-Share': public['token']}, json=body).status_code == 401
    assert owner.delete('/api/reports/' + saved['id'] + '/parent-access/' + grant['id'], headers=h).status_code == 204
    assert parent.get(path, headers=p).status_code == 404
    assert parent.post(path + '/comments', headers=p, json=body).status_code == 404
    historical = owner.get(path, headers=h).json()
    assert historical['can_comment'] is False
    assert owner.post(path + '/comments', headers=h, json=body).status_code == 404


def test_expired_authorization_and_invalid_or_forged_comments_never_mutate_a_thread(collaboration):
    owner, parent, _, h, p, _, saved, clock = collaboration
    grant = invite(owner, h, saved).json()
    path = '/api/parent-access/' + grant['id']
    valid = {'body': '问题', 'client_request_id': '33333333-3333-4333-8333-333333333333'}
    for changed in [{**valid, 'author': 'owner'}, {**valid, 'body': ''}, {**valid, 'body': 'x' * 1001}, {**valid, 'client_request_id': '../bad'}]:
        assert parent.post(path + '/comments', headers=p, json=changed).status_code == 422
    assert parent.get(path, headers=p).json()['comments'] == []
    clock.value += 86400
    # Cookie sessions last eight hours; re-login then check the independently expired invitation.
    session = parent.post('/api/auth/login', json={'username': 'parent', 'password': PASSWORD}, headers={'Origin': ORIGIN}).json()
    assert parent.get(path, headers={'X-CSRF-Token': session['csrf_token']}).status_code == 404
