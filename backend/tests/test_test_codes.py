"""一次性测试码：管理员建码、学生匿名加入、提交后按码归档。"""

import re

import pytest
from fastapi.testclient import TestClient

from backend.tests.test_api import ORIGIN, PASSWORD, headers, login, record, service

CODE_PATTERN = re.compile(r'[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{10}\Z')
ORIGIN_HEADERS = {'Origin': ORIGIN}


def operator(client):
    return login(client, 'bob')


def make_code(client, session, label='2026 秋季 8 年级', hours=168):
    response = client.post('/api/admin/test-codes', headers=headers(session),
                           json={'label': label, 'expires_in_hours': hours})
    assert response.status_code == 201, response.text
    return response.json()


def join(client, code):
    return client.post('/api/public/join', headers=ORIGIN_HEADERS, json={'code': code})


def submit(client, value):
    return client.post('/api/public/report', headers=ORIGIN_HEADERS, json={'record': value})


def test_admin_creates_code_student_submits_and_report_is_archived_by_code(service):
    app, clock = service
    with TestClient(app, base_url=ORIGIN) as admin, TestClient(app, base_url=ORIGIN) as student:
        session = operator(admin)
        created = make_code(admin, session)
        assert set(created) == {'id', 'code', 'label', 'created_at', 'expires_at', 'revoked_at', 'report_id'}
        assert CODE_PATTERN.fullmatch(created['code'])
        assert created['label'] == '2026 秋季 8 年级' and created['revoked_at'] is None
        assert created['created_at'] == int(clock()) and created['expires_at'] == int(clock()) + 168 * 3600

        listing = admin.get('/api/admin/test-codes')
        assert listing.status_code == 200
        assert listing.json()['total'] == 1 and listing.json()['items'][0]['status'] == 'unused'

        # 学生可以用小写、空格和连字符输入，服务端统一规范化。
        joined = join(student, ' ' + created['code'][:5].lower() + '-' + created['code'][5:].lower() + ' ')
        assert joined.status_code == 200, joined.text
        assert joined.json() == {'label': created['label'], 'expires_at': int(clock()) + 12 * 3600,
                                 'resumed': False}
        cookie = joined.headers['set-cookie'].lower()
        assert 'bic_test_code=' in cookie and 'httponly' in cookie and 'path=/api' in cookie
        assert 'samesite=lax' in cookie and 'secure' in cookie and 'max-age=' in cookie
        assert 'token' not in joined.text and created['code'] not in joined.text

        current = student.get('/api/public/session')
        assert current.status_code == 200
        assert current.json() == {'id': created['id'], 'label': created['label'],
                                  'expires_at': int(clock()) + 12 * 3600}

        saved = record('student')
        submitted = submit(student, saved)
        assert submitted.status_code == 201, submitted.text
        body = submitted.json()
        assert body['created'] is True and body['label'] == created['label']
        assert body['id'] and isinstance(body['created_at'], str) and body['created_at']
        assert 'max-age=0' in submitted.headers['set-cookie'].lower()
        assert student.cookies.get('bic_test_code') is None
        assert student.get('/api/public/session').status_code == 401
        assert student.get('/api/public/report/' + body['id']).status_code == 404
        assert student.get('/api/admin/reports/' + body['id']).status_code == 401

        reports = admin.get('/api/admin/reports').json()
        assert reports['total'] == 1
        item = reports['items'][0]
        assert item['id'] == body['id'] and item['code'] == created['code']
        assert item['label'] == created['label'] and item['name'] == saved['state']['info']['name']
        assert item['report_ref'] == saved['reportMeta']['batchId']
        detail = admin.get('/api/admin/reports/' + body['id']).json()
        assert detail['code'] == created['code'] and detail['label'] == created['label']
        assert detail['record']['state']['info']['name'] == saved['state']['info']['name']

        codes = admin.get('/api/admin/test-codes').json()['items']
        assert codes[0]['status'] == 'completed' and codes[0]['report_id'] == body['id']
        assert codes[0]['completed_at'] == int(clock())
        with TestClient(app, base_url=ORIGIN) as late:
            denied = join(late, created['code'])
            assert denied.status_code == 410 and 'completed' in denied.text.lower()
        assert admin.get('/api/admin/reports/not-a-report').status_code == 404


def test_code_is_one_person_resumable_and_cannot_be_shared(service):
    app, _ = service
    with TestClient(app, base_url=ORIGIN) as admin, TestClient(app, base_url=ORIGIN) as first, \
            TestClient(app, base_url=ORIGIN) as second:
        created = make_code(admin, operator(admin))
        assert join(first, created['code']).status_code == 200
        denied = join(second, created['code'])
        assert denied.status_code == 409 and 'already in use' in denied.text.lower()
        resumed = join(first, created['code'])
        assert resumed.status_code == 200 and resumed.json()['resumed'] is True
        assert resumed.json()['expires_at'] == int(app.state.test_codes.clock()) + 12 * 3600
        assert second.cookies.get('bic_test_code') is None


def test_expired_code_stops_joining_and_submitting(service):
    app, clock = service
    with TestClient(app, base_url=ORIGIN) as admin, TestClient(app, base_url=ORIGIN) as student:
        created = make_code(admin, operator(admin), hours=1)
        assert join(student, created['code']).status_code == 200
        clock.value += 3600
        assert student.get('/api/public/session').status_code == 401
        expired = submit(student, record('late'))
        assert expired.status_code == 410 and 'expired' in expired.text.lower()
        with TestClient(app, base_url=ORIGIN) as late:
            assert join(late, created['code']).status_code == 410
        codes = admin.get('/api/admin/test-codes').json()['items']
        assert codes[0]['status'] == 'expired' and codes[0]['report_id'] is None
        assert admin.get('/api/admin/reports').json()['total'] == 0


def test_revoked_code_stops_joining_and_submitting_and_revoke_is_idempotent(service):
    app, clock = service
    with TestClient(app, base_url=ORIGIN) as admin, TestClient(app, base_url=ORIGIN) as student:
        session = operator(admin)
        created = make_code(admin, session)
        assert join(student, created['code']).status_code == 200
        revoked = admin.post('/api/admin/test-codes/%s/revoke' % created['id'], headers=headers(session), json={})
        assert revoked.status_code == 200 and revoked.json()['revoked_at'] == int(clock())
        again = admin.post('/api/admin/test-codes/%s/revoke' % created['id'], headers=headers(session), json={})
        assert again.status_code == 200 and again.json()['revoked_at'] == int(clock())
        assert student.get('/api/public/session').status_code == 401
        denied = submit(student, record('revoked'))
        assert denied.status_code == 410 and 'revoked' in denied.text.lower()
        with TestClient(app, base_url=ORIGIN) as late:
            denied = join(late, created['code'])
            assert denied.status_code == 410 and 'revoked' in denied.text.lower()
        assert admin.get('/api/admin/test-codes').json()['items'][0]['status'] == 'revoked'
        missing = admin.post('/api/admin/test-codes/not-a-code/revoke', headers=headers(session), json={})
        assert missing.status_code == 404


def test_only_advisor_can_use_admin_boundary(service):
    app, _ = service
    with TestClient(app, base_url=ORIGIN) as student, TestClient(app, base_url=ORIGIN) as anonymous:
        session = login(student)
        body = {'label': '批次', 'expires_in_hours': 168}
        assert student.post('/api/admin/test-codes', headers=headers(session), json=body).status_code == 403
        assert student.get('/api/admin/test-codes').status_code == 403
        assert student.post('/api/admin/test-codes/x/revoke', headers=headers(session), json={}).status_code == 403
        assert student.get('/api/admin/reports').status_code == 403
        assert student.get('/api/admin/reports/x').status_code == 403
        assert anonymous.post('/api/admin/test-codes', headers=ORIGIN_HEADERS, json=body).status_code == 401
        assert anonymous.get('/api/admin/test-codes').status_code == 401
        assert anonymous.get('/api/admin/reports').status_code == 401


@pytest.mark.parametrize('kind', ['missing_origin', 'wrong_origin', 'missing_csrf', 'wrong_csrf'])
def test_admin_writes_require_exact_origin_and_csrf(service, kind):
    app, _ = service
    with TestClient(app, base_url=ORIGIN) as admin:
        session = operator(admin)
        create_headers = headers(session)
        if kind == 'missing_origin': create_headers.pop('Origin')
        elif kind == 'wrong_origin': create_headers['Origin'] = 'https://attacker.test'
        elif kind == 'missing_csrf': create_headers.pop('X-CSRF-Token')
        else: create_headers['X-CSRF-Token'] = 'x' * 43
        response = admin.post('/api/admin/test-codes', headers=create_headers,
                              json={'label': '批次', 'expires_in_hours': 168})
        assert response.status_code == 403
        assert admin.get('/api/admin/test-codes').json()['total'] == 0


@pytest.mark.parametrize('kind', ['missing_origin', 'wrong_origin'])
def test_public_writes_require_exact_origin(service, kind):
    app, _ = service
    with TestClient(app, base_url=ORIGIN) as anonymous:
        join_headers = dict(ORIGIN_HEADERS)
        if kind == 'missing_origin': join_headers.pop('Origin')
        else: join_headers['Origin'] = 'https://attacker.test'
        assert anonymous.post('/api/public/join', headers=join_headers,
                              json={'code': '23456789AB'}).status_code == 403
        assert anonymous.post('/api/public/report', headers=join_headers,
                              json={'record': record()}).status_code == 403


def test_public_write_requires_json_content_type(service):
    app, _ = service
    with TestClient(app, base_url=ORIGIN) as client:
        response = client.post('/api/public/join', headers=ORIGIN_HEADERS, content=b'code=23456789AB')
        assert response.status_code == 415


def test_submitting_the_same_record_twice_is_idempotent_but_another_record_is_rejected(service):
    app, _ = service
    with TestClient(app, base_url=ORIGIN) as admin:
        session = operator(admin)
        created = make_code(admin, session)
        token = app.state.test_codes.join(created['code'], '192.0.2.1')['token']
        first_record = record('first')
        with TestClient(app, base_url=ORIGIN, cookies={'bic_test_code': token}) as first:
            first_response = submit(first, first_record)
            assert first_response.status_code == 201 and first_response.json()['created'] is True
            report_id = first_response.json()['id']
        with TestClient(app, base_url=ORIGIN, cookies={'bic_test_code': token}) as again:
            repeated = submit(again, first_record)
            assert repeated.status_code == 201
            assert repeated.json()['created'] is False and repeated.json()['id'] == report_id
            different = submit(again, record('second'))
            assert different.status_code == 409 and 'already' in different.text.lower()
        assert admin.get('/api/admin/reports').json()['total'] == 1
        assert admin.get('/api/admin/reports/' + report_id).json()['record']['id'] == first_record['id']


@pytest.mark.parametrize('body', [
    {}, {'label': ''}, {'label': '   '}, {'label': 'x' * 81}, {'label': 'bad\nlabel'},
    {'label': 3}, {'label': '批次', 'expires_in_hours': 0}, {'label': '批次', 'expires_in_hours': 721},
    {'label': '批次', 'expires_in_hours': '168'}, {'label': '批次', 'expires_in_hours': True},
    {'label': '批次', 'expires_in_hours': 168, 'extra': 1},
])
def test_invalid_admin_create_requests_are_rejected_without_side_effects(service, body):
    app, _ = service
    with TestClient(app, base_url=ORIGIN) as admin:
        session = operator(admin)
        response = admin.post('/api/admin/test-codes', headers=headers(session), json=body)
        assert response.status_code == 422
        assert admin.get('/api/admin/test-codes').json()['total'] == 0


@pytest.mark.parametrize('body', [
    {}, {'code': ''}, {'code': 'short'}, {'code': 'A' * 41}, {'code': '2345678901'},
    {'code': '2345 6789 AB', 'extra': 1}, {'code': None},
])
def test_invalid_join_requests_are_rejected(service, body):
    app, _ = service
    with TestClient(app, base_url=ORIGIN) as client:
        response = client.post('/api/public/join', headers=ORIGIN_HEADERS, json=body)
        assert response.status_code == 422
        assert client.cookies.get('bic_test_code') is None


def test_unknown_well_formed_code_is_not_found(service):
    app, _ = service
    with TestClient(app, base_url=ORIGIN) as client:
        response = join(client, '23456789AB')
        assert response.status_code == 404
        assert 'not found' in response.text.lower()


@pytest.mark.parametrize('record_value', [None, [], 'record', 3])
def test_non_object_report_is_rejected_before_writing(service, record_value):
    app, _ = service
    with TestClient(app, base_url=ORIGIN) as admin:
        created = make_code(admin, operator(admin))
        token = app.state.test_codes.join(created['code'], '192.0.2.2')['token']
        with TestClient(app, base_url=ORIGIN, cookies={'bic_test_code': token}) as student:
            response = submit(student, record_value)
            assert response.status_code == 422
            assert student.get('/api/public/session').status_code == 200
        assert admin.get('/api/admin/reports').json()['total'] == 0


@pytest.mark.parametrize('query', ['limit=0', 'limit=101', 'offset=-1'])
def test_admin_pagination_is_bounded(service, query):
    app, _ = service
    with TestClient(app, base_url=ORIGIN) as admin:
        operator(admin)
        assert admin.get('/api/admin/test-codes?' + query).status_code == 422
        assert admin.get('/api/admin/reports?' + query).status_code == 422


def test_repeated_code_guessing_is_rate_limited(service):
    app, _ = service
    with TestClient(app, base_url=ORIGIN) as client:
        for _ in range(10):
            assert join(client, '23456789AB').status_code == 404
        limited = join(client, '23456789AB')
        assert limited.status_code == 429
