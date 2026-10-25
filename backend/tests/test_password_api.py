"""Synthetic self-service password change; no production accounts or secrets."""
import sqlite3

import pytest
from fastapi.testclient import TestClient

from backend.bic_api.dev import create_dev_app
from backend.bic_api.settings import Settings
from .test_api import service, login, headers, record, ORIGIN, PASSWORD

NEW_PASSWORD = 'new-synthetic-password-42'


def body(**changes):
    return {'current_password': PASSWORD, 'new_password': NEW_PASSWORD, **changes}


def test_change_password_revokes_all_own_sessions_and_preserves_other_users_and_reports(service):
    app, _ = service
    with TestClient(app, base_url=ORIGIN) as first, TestClient(app, base_url=ORIGIN) as second, TestClient(app, base_url=ORIGIN) as other:
        one, two, bob = login(first), login(second), login(other, 'bob')
        saved = first.post('/api/reports', headers=headers(one), json={'record': record()}).json()
        old_cookie = first.cookies.get('bic_session')
        response = first.post('/api/auth/password', headers=headers(one), json=body())
        assert response.status_code == 204 and response.content == b''
        cookie = response.headers['set-cookie'].lower()
        assert 'max-age=0' in cookie and 'path=/api' in cookie and 'secure' in cookie and 'httponly' in cookie and 'samesite=lax' in cookie
        assert response.headers['cache-control'] == 'no-store'
        assert first.get('/api/auth/session').status_code == second.get('/api/auth/session').status_code == 401
        assert other.get('/api/auth/session').json()['user'] == bob['user']
        with TestClient(app, base_url=ORIGIN, cookies={'bic_session': old_cookie}) as stale:
            assert stale.post('/api/auth/password', headers=headers(one), json=body()).status_code == 401
        assert first.post('/api/auth/login', headers={'Origin': ORIGIN}, json={'username': 'alice', 'password': PASSWORD}).status_code == 401
        result = first.post('/api/auth/login', headers={'Origin': ORIGIN}, json={'username': 'alice', 'password': NEW_PASSWORD})
        assert result.status_code == 200 and result.json()['user'] == one['user']
        assert first.get('/api/reports/' + saved['id']).json() == saved
        with sqlite3.connect(app.state.db.path) as connection:
            assert connection.execute('PRAGMA user_version').fetchone()[0] == 5


@pytest.mark.parametrize('change', [
    {'new_password': 'short'}, {'current_password': 'short'}, {'new_password': 123},
    {'new_password': None}, {'new_password': ['password']}, {'new_password': 'x' * 129},
    {'username': 'bob'}, {'user_id': 'someone-else'}, {'csrf_token': 'fake'}, {'confirmed': True},
])
def test_strict_password_request_never_echoes_rejected_input_or_mutates(service, change):
    app, _ = service
    with TestClient(app, base_url=ORIGIN) as client:
        session = login(client)
        before = app.state.db.user_for_login('alice')['password_hash']
        response = client.post('/api/auth/password', headers=headers(session), json=body(**change))
        assert response.status_code == 422
        assert response.json() == {'detail': 'Invalid request parameters or body.'}
        assert app.state.db.user_for_login('alice')['password_hash'] == before
        assert client.get('/api/auth/session').status_code == 200


@pytest.mark.parametrize('kind', ['anonymous', 'origin', 'missing_csrf', 'wrong_csrf', 'cookie_switch', 'disabled', 'expired'])
def test_password_change_stays_bound_to_current_enabled_session_and_browser_boundary(service, kind):
    app, clock = service
    with TestClient(app, base_url=ORIGIN) as client:
        session = login(client); request_headers = headers(session)
        if kind == 'anonymous': client.cookies.clear()
        elif kind == 'origin': request_headers['Origin'] = 'https://attacker.test'
        elif kind == 'missing_csrf': request_headers.pop('X-CSRF-Token')
        elif kind == 'wrong_csrf': request_headers['X-CSRF-Token'] = 'x' * 43
        elif kind == 'cookie_switch': login(client, 'bob')
        elif kind == 'disabled': app.state.db.disable_user('alice')
        else: clock.value += app.state.settings.session_ttl
        before = {name: app.state.db.user_for_login(name)['password_hash'] for name in ['alice', 'bob']}
        response = client.post('/api/auth/password', headers=request_headers, json=body())
        assert response.status_code == (403 if kind in ['origin', 'missing_csrf', 'wrong_csrf', 'cookie_switch'] else 401)
        assert NEW_PASSWORD not in response.text and PASSWORD not in response.text
        assert {name: app.state.db.user_for_login(name)['password_hash'] for name in ['alice', 'bob']} == before


def test_wrong_old_password_is_not_success_does_not_delete_cookie_or_change_hash(service):
    app, _ = service
    with TestClient(app, base_url=ORIGIN) as client:
        session = login(client); before = app.state.db.user_for_login('alice')['password_hash']
        response = client.post('/api/auth/password', headers=headers(session), json=body(current_password='wrong-old-synthetic-password'))
        assert response.status_code == 401 and 'set-cookie' not in response.headers
        assert app.state.db.user_for_login('alice')['password_hash'] == before
        assert client.get('/api/auth/session').status_code == 200
        assert 'wrong-old-synthetic-password' not in response.text and NEW_PASSWORD not in response.text


def test_shared_attempt_limit_keeps_retry_after_and_never_echoes_passwords(service):
    app, _ = service
    with TestClient(app, base_url=ORIGIN) as client:
        session = login(client)
        for _ in range(4):
            assert client.post('/api/auth/password', headers=headers(session), json=body(current_password='wrong-old-synthetic-password')).status_code == 401
        response = client.post('/api/auth/password', headers=headers(session), json=body())
        assert response.status_code == 429 and int(response.headers['retry-after']) >= 1
        assert PASSWORD not in response.text and NEW_PASSWORD not in response.text


def test_account_page_is_safe_static_and_health_version_is_unchanged(tmp_path):
    origin = 'http://127.0.0.1:9001'
    with TestClient(create_dev_app(Settings(database_path=tmp_path / 'account.sqlite3', public_origin=origin, development=True)), base_url=origin) as client:
        page = client.get('/account.html')
        assert page.status_code == 200 and '账号安全' in page.text
        assert page.headers['cache-control'] == 'no-store' and page.headers['referrer-policy'] == 'no-referrer'
        assert client.get('/js/account.js').status_code == client.get('/css/account.css').status_code == 200
        assert client.get('/backend/bic_api/security.py').status_code == 404
        assert client.get('/api/health').json() == {'status': 'ok', 'api_version': '2'}
