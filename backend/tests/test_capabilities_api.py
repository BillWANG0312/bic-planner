"""Capability discovery is authenticated metadata, never an authorization grant."""

import copy
import sqlite3

import pytest
from fastapi.testclient import TestClient

from backend.tests.test_api import service, login, headers, record, ORIGIN


def test_capability_discovery_requires_session_binds_supplied_csrf_and_is_read_only(service):
    app, _ = service
    with TestClient(app, base_url=ORIGIN) as client:
        assert client.get('/api/report-capabilities').status_code == 401
        session = login(client)
        snapshot = app.state.db.list_reports(session['user']['id'])
        response = client.get('/api/report-capabilities', headers=headers(session))
        assert response.status_code == 200
        assert response.headers['cache-control'] == 'no-store'
        value = response.json()
        assert set(value) == {'format', 'version', 'api_version', 'profiles'}
        assert value['format'] == 'bic-report-capabilities' and value['version'] == 1 and value['api_version'] == '2'
        assert value['profiles'][0]['profile'] == 'legacy-2026.10'
        assert value['profiles'][1]['profile'] == 'games-traits-v1' and value['profiles'][1]['operations'] == []
        assert set(value['profiles'][1]['contract']) == {'profile', 'contract_version', 'contract_fingerprint', 'bank_version',
                                                        'personality_version', 'planning_total', 'planning_required', 'personality_total'}
        for forbidden in ['password', 'csrf', 'sqlite', 'answers', 'questions', 'alice', 'bob']:
            assert forbidden not in response.text.lower()
        assert app.state.db.list_reports(session['user']['id']) == snapshot
        assert client.get('/api/report-capabilities', headers={'X-CSRF-Token': 'wrong'}).status_code == 403
        assert client.get('/api/health').json() == {'status': 'ok', 'api_version': '2'}


def test_another_tab_replacing_cookie_cannot_reuse_the_previous_page_identity(service):
    app, _ = service
    with TestClient(app, base_url=ORIGIN) as client:
        previous = login(client)
        login(client, 'bob')
        assert client.get('/api/report-capabilities', headers=headers(previous)).status_code == 403
        # An explicit reconnect without a stale binding may see the current session.
        assert client.get('/api/report-capabilities').status_code == 200


def test_current_model_foundation_does_not_open_owner_archive_or_change_schema(service):
    app, _ = service
    with TestClient(app, base_url=ORIGIN) as client:
        session = login(client); legacy = record('old')
        created = client.post('/api/reports', headers=headers(session), json={'record': legacy})
        assert created.status_code == 201
        modern = copy.deepcopy(legacy); modern['assessmentProfile'] = 'games-traits-v1'
        modern['state']['plan']['answers'] = {'subjectBoard': {}, 'career': ['science']}
        modern['state']['mbti']['answers'] = [{'value': 0, 'ms': 0}, None]
        assert client.post('/api/reports', headers=headers(session), json={'record': modern}).status_code == 422
        assert client.put('/api/reports/' + created.json()['id'], headers=headers(session),
                          json={'revision': 1, 'record': modern}).status_code == 422
        assert client.get('/api/reports/' + created.json()['id']).json() == created.json()
        with sqlite3.connect(app.state.db.path) as connection:
            assert connection.execute('PRAGMA user_version').fetchone()[0] == 5


@pytest.mark.parametrize('reason', ['expired', 'disabled'])
def test_disabled_and_expired_sessions_cannot_read_capabilities(service, reason):
    app, clock = service
    with TestClient(app, base_url=ORIGIN) as client:
        session = login(client)
        if reason == 'expired':
            clock.value = session['expires_at']
        else:
            app.state.db.disable_user('alice')
        assert client.get('/api/report-capabilities', headers=headers(session)).status_code == 401
