import asyncio
from pathlib import Path
import tracemalloc

import pytest
from fastapi.testclient import TestClient

try:
    from backend.bic_api.app import create_app
    from backend.bic_api.settings import Settings
except ModuleNotFoundError:
    create_app = Settings = None

ORIGIN = 'https://planner.test'
PASSWORD = 'test-only-long-password-42'


class Clock:
    def __init__(self):
        self.value = 1_790_000_000

    def __call__(self):
        return self.value


@pytest.fixture
def service(tmp_path):
    assert create_app is not None and Settings is not None, '隔离的账号与报告 API 应存在'
    clock = Clock()
    app = create_app(Settings(database_path=tmp_path / 'accounts.sqlite3', public_origin=ORIGIN), clock=clock)
    app.state.auth.create_user('alice', PASSWORD, 'student')
    app.state.auth.create_user('bob', PASSWORD, 'advisor')
    return app, clock


def login(client, username='alice'):
    result = client.post('/api/auth/login', json={'username': username, 'password': PASSWORD}, headers={'Origin': ORIGIN})
    assert result.status_code == 200, result.text
    return result.json()


def headers(session):
    return {'Origin': ORIGIN, 'X-CSRF-Token': session['csrf_token']}


def record(suffix='one'):
    return {
        'id': 'local-' + suffix,
        'createdAt': '2026-10-24T00:00:00.000Z', 'updatedAt': '2026-10-24T00:00:00.000Z',
        'bankVersion': '2026.10', 'catalogVersion': '2026.10.24',
        'state': {'info': {'name': '接口测试同学', 'grade': '8', 'year': '2027 年秋季'},
                  'academic': {'answers': {'ph3': 3}}, 'plan': {'answers': {'grade': '8'}},
                  'mbti': {'answers': [None] * 24}},
        'reportMeta': {'batchId': 'AP-' + suffix, 'date': '2026年10月24日'},
    }


def test_public_health_leaks_no_paths_or_accounts(service):
    app, _ = service
    with TestClient(app, base_url=ORIGIN) as client:
        result = client.get('/api/health')
        assert result.status_code == 200
        assert result.json() == {'status': 'ok', 'api_version': '1'}
        assert result.headers['cache-control'] == 'no-store'
        assert 'alice' not in result.text and 'sqlite' not in result.text
        assert client.get('/api/reports').status_code == 401


def test_login_cookie_is_secure_http_only_scoped_and_session_is_reloadable(service):
    app, _ = service
    with TestClient(app, base_url=ORIGIN) as client:
        session = login(client)
        assert 'token' not in session and 'password' not in session
        cookie = client.cookies.get('bic_session')
        assert cookie
        current = client.get('/api/auth/session')
        assert current.json()['user']['username'] == 'alice'
        assert current.json()['csrf_token'] == session['csrf_token']
        assert current.headers['cache-control'] == 'no-store'
        again = client.post('/api/auth/login', json={'username': 'alice', 'password': PASSWORD}, headers={'Origin': ORIGIN})
        value = again.headers['set-cookie'].lower()
        assert 'secure' in value and 'httponly' in value and 'samesite=lax' in value and 'path=/api' in value
        assert client.cookies.get('bic_session') != cookie
        with TestClient(app, base_url=ORIGIN, cookies={'bic_session': cookie}) as old:
            assert old.get('/api/auth/session').status_code == 401


@pytest.mark.parametrize('origin', [None, 'null', 'https://evil.test', 'http://planner.test', ORIGIN + '.evil'])
def test_login_requires_exact_configured_origin(service, origin):
    app, _ = service
    with TestClient(app, base_url=ORIGIN) as client:
        result = client.post('/api/auth/login', json={'username': 'alice', 'password': PASSWORD}, headers={} if origin is None else {'Origin': origin})
        assert result.status_code == 403
        assert 'set-cookie' not in result.headers


def test_generic_credentials_and_validation_errors_do_not_echo_passwords(service):
    app, _ = service
    with TestClient(app, base_url=ORIGIN) as client:
        wrong = client.post('/api/auth/login', json={'username': 'alice', 'password': 'wrong-but-long-password'}, headers={'Origin': ORIGIN})
        unknown = client.post('/api/auth/login', json={'username': 'unknown', 'password': 'wrong-but-long-password'}, headers={'Origin': ORIGIN})
        assert wrong.status_code == unknown.status_code == 401
        assert wrong.json() == unknown.json()
        secret = 'private-password-' + 'x' * 200
        invalid = client.post('/api/auth/login', json={'username': 'alice', 'password': secret}, headers={'Origin': ORIGIN})
        assert invalid.status_code == 422
        assert secret not in invalid.text


def test_session_expiration_logout_and_revocation(service):
    app, clock = service
    with TestClient(app, base_url=ORIGIN) as client:
        session = login(client)
        cookie = client.cookies.get('bic_session')
        assert client.post('/api/auth/logout', json={}, headers={'Origin': ORIGIN}).status_code == 403
        assert client.post('/api/auth/logout', json={}, headers=headers(session)).status_code == 204
        assert client.get('/api/auth/session').status_code == 401
        with TestClient(app, base_url=ORIGIN, cookies={'bic_session': cookie}) as replay:
            assert replay.get('/api/auth/session').status_code == 401
        login(client)
        clock.value += 28801
        assert client.get('/api/reports').status_code == 401


def test_report_writes_require_csrf_and_no_cross_origin_read_grants(service):
    app, _ = service
    with TestClient(app, base_url=ORIGIN) as client:
        session = login(client)
        for supplied in [{'Origin': ORIGIN}, {'Origin': ORIGIN, 'X-CSRF-Token': 'wrong'}]:
            assert client.post('/api/reports', json={'record': record()}, headers=supplied).status_code == 403
        foreign = client.get('/api/reports', headers={'Origin': 'https://evil.test'})
        assert foreign.status_code == 403
        assert 'access-control-allow-origin' not in foreign.headers
        assert client.get('/api/reports').json()['total'] == 0
        assert client.post('/api/reports', json={'record': record()}, headers=headers(session)).status_code == 201


def test_report_crud_is_owner_scoped_and_revision_checked(service):
    app, _ = service
    with TestClient(app, base_url=ORIGIN) as alice, TestClient(app, base_url=ORIGIN) as bob:
        a, b = login(alice), login(bob, 'bob')
        created = alice.post('/api/reports', json={'record': record()}, headers=headers(a))
        assert created.status_code == 201, created.text
        saved = created.json()
        rid = saved['id']
        assert saved['revision'] == 1
        assert alice.get(f'/api/reports/{rid}').json()['record']['state']['info']['name'] == '接口测试同学'
        listing = alice.get('/api/reports').json()
        assert listing['total'] == 1 and 'record' not in listing['items'][0]
        assert 'answers' not in str(listing)
        assert bob.get('/api/reports').json()['total'] == 0
        assert bob.get(f'/api/reports/{rid}').status_code == 404
        assert bob.put(f'/api/reports/{rid}', json={'record': record(), 'revision': 1}, headers=headers(b)).status_code == 404
        assert bob.delete(f'/api/reports/{rid}?revision=1', headers=headers(b)).status_code == 404
        changed = record()
        changed['state']['info']['name'] = '更新后的同学'
        updated = alice.put(f'/api/reports/{rid}', json={'record': changed, 'revision': 1}, headers=headers(a))
        assert updated.status_code == 200 and updated.json()['revision'] == 2
        assert alice.put(f'/api/reports/{rid}', json={'record': record(), 'revision': 1}, headers=headers(a)).status_code == 409
        assert alice.delete(f'/api/reports/{rid}?revision=1', headers=headers(a)).status_code == 409
        assert alice.get(f'/api/reports/{rid}').json()['record']['state']['info']['name'] == '更新后的同学'
        assert alice.delete(f'/api/reports/{rid}?revision=2', headers=headers(a)).status_code == 204
        assert alice.get(f'/api/reports/{rid}').status_code == 404


def test_duplicate_invalid_and_forged_report_payloads_never_replace_saved_record(service):
    app, _ = service
    with TestClient(app, base_url=ORIGIN) as client:
        session = login(client)
        assert client.post('/api/reports', json={'record': record()}, headers=headers(session)).status_code == 201
        assert client.post('/api/reports', json={'record': record()}, headers=headers(session)).status_code == 409
        bad = record('bad')
        bad['state']['academic']['answers']['ph3'] = True
        assert client.post('/api/reports', json={'record': bad}, headers=headers(session)).status_code == 422
        forged = {'record': record('forged'), 'owner_id': 'bob'}
        assert client.post('/api/reports', json=forged, headers=headers(session)).status_code == 422
        assert client.get('/api/reports').json()['total'] == 1


def test_pagination_cannot_overflow_sqlite_integers(service):
    app, _ = service
    with TestClient(app, base_url=ORIGIN) as client:
        login(client)
        assert client.get('/api/reports?offset=9223372036854775808').status_code == 422
        assert client.get('/api/reports?offset=9223372036854775807').status_code == 200


def test_request_size_limit_checks_actual_body_even_without_content_length(service):
    app, _ = service
    with TestClient(app, base_url=ORIGIN) as client:
        result = client.post('/api/auth/login', content=iter([b'x' * 3_100_000, b'x' * 3_100_000]), headers={'Origin': ORIGIN, 'Content-Type': 'application/json'})
        assert result.status_code == 413


def test_many_tiny_request_chunks_have_bounded_buffer_overhead(tmp_path):
    from backend.bic_api.app import ApiBoundary
    settings = Settings(database_path=tmp_path / 'unused.sqlite3', public_origin=ORIGIN)
    scope = {'type': 'http', 'method': 'POST', 'headers': [(b'origin', ORIGIN.encode()), (b'content-type', b'application/json')]}
    remaining = 100_000
    observed = bytearray()

    async def receive():
        nonlocal remaining
        remaining -= 1
        return {'type': 'http.request', 'body': b'x', 'more_body': remaining > 0}

    async def consumer(scope, receive, send):
        while True:
            event = await receive()
            observed.extend(event.get('body', b''))
            if not event.get('more_body', False):
                break

    async def send(event):
        pass

    tracemalloc.start()
    try:
        asyncio.run(ApiBoundary(consumer, settings)(scope, receive, send))
        _, peak = tracemalloc.get_traced_memory()
    finally:
        tracemalloc.stop()
    assert observed == b'x' * 100_000
    assert peak < 2_000_000, f'Tiny chunks amplified 100 KB body to {peak} bytes'


def test_wrong_host_and_non_json_login_are_rejected(service):
    app, _ = service
    with TestClient(app, base_url=ORIGIN) as client:
        assert client.get('/api/health', headers={'Host': 'attacker.test'}).status_code == 400
        assert client.post('/api/auth/login', content='username=alice', headers={'Origin': ORIGIN, 'Content-Type': 'application/x-www-form-urlencoded'}).status_code == 415


def test_oversized_length_and_duplicate_origins_fail_without_server_error(service):
    app, _ = service
    with TestClient(app, base_url=ORIGIN) as client:
        huge = client.post('/api/auth/login', content=b'{}', headers={'Origin': ORIGIN, 'Content-Type': 'application/json', 'Content-Length': '9' * 5_000})
        assert huge.status_code == 413
        duplicate = client.post('/api/auth/login', json={'username': 'alice', 'password': PASSWORD}, headers=[('Origin', ORIGIN), ('Origin', ORIGIN)])
        assert duplicate.status_code == 403


def test_https_cookie_stays_secure_even_in_development(tmp_path):
    assert create_app is not None and Settings is not None
    app = create_app(Settings(database_path=tmp_path / 'dev-https.sqlite3', public_origin=ORIGIN, development=True))
    app.state.auth.create_user('alice', PASSWORD, 'student')
    with TestClient(app, base_url=ORIGIN) as client:
        login(client)
        result = client.post('/api/auth/login', json={'username': 'alice', 'password': PASSWORD}, headers={'Origin': ORIGIN})
        assert 'secure' in result.headers['set-cookie'].lower()


@pytest.mark.parametrize('origin', ['http://[::1]:9001', 'https://[::1]', 'https://planner.test:0'])
def test_unsupported_ipv6_and_zero_port_fail_at_configuration(tmp_path, origin):
    assert Settings is not None
    with pytest.raises(ValueError):
        Settings(database_path=tmp_path / 'bad-origin.sqlite3', public_origin=origin, development=True)


def test_database_reopen_retains_account_and_owner_records(tmp_path):
    assert create_app is not None and Settings is not None, '账号与报告 API 应存在'
    settings = Settings(database_path=tmp_path / 'persistent.sqlite3', public_origin=ORIGIN)
    first = create_app(settings)
    first.state.auth.create_user('alice', PASSWORD, 'student')
    with TestClient(first, base_url=ORIGIN) as client:
        session = login(client)
        assert client.post('/api/reports', json={'record': record()}, headers=headers(session)).status_code == 201
    second = create_app(settings)
    with TestClient(second, base_url=ORIGIN) as client:
        login(client)
        assert client.get('/api/reports').json()['total'] == 1


def test_configuration_fails_closed_and_database_stays_outside_static_root(tmp_path, monkeypatch):
    assert Settings is not None, '安全配置应存在'
    with pytest.raises(ValueError):
        Settings(database_path=tmp_path / 'db.sqlite3', public_origin='http://school.example')
    with pytest.raises(ValueError):
        Settings(database_path=tmp_path / 'db.sqlite3', public_origin='http://school.example', development=True)
    with pytest.raises(ValueError):
        Settings(database_path=Path(__file__).resolve().parents[2] / 'student-data.sqlite3', public_origin=ORIGIN)
    with pytest.raises(ValueError):
        Settings(database_path=tmp_path / 'db.sqlite3', public_origin=ORIGIN + '/path')
    monkeypatch.delenv('BIC_DATABASE_PATH', raising=False)
    monkeypatch.delenv('BIC_PUBLIC_ORIGIN', raising=False)
    monkeypatch.delenv('BIC_DEV', raising=False)
    with pytest.raises(ValueError):
        Settings.from_env()
    dev = Settings(database_path=tmp_path / 'dev.sqlite3', public_origin='http://127.0.0.1:9001', development=True)
    app = create_app(dev)
    app.state.auth.create_user('alice', PASSWORD, 'student')
    with TestClient(app, base_url=dev.public_origin) as client:
        result = client.post('/api/auth/login', json={'username': 'alice', 'password': PASSWORD}, headers={'Origin': dev.public_origin})
        assert result.status_code == 200
        assert 'secure' not in result.headers['set-cookie'].lower()
