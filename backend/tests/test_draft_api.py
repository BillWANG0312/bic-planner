import copy

import pytest
from fastapi.testclient import TestClient

from backend.bic_api.app import create_app
from backend.bic_api.settings import Settings
from backend.tests.test_api import Clock, PASSWORD, record
from backend.tests.test_share_api import content

ORIGIN = 'http://127.0.0.1:9001'


def context():
    return {'status': 'draft', 'direction_id': 'cs', 'personality_complete': False,
            'personality_code': None, 'subjects': [{key: value for key, value in subject.items() if key != 'name'} for subject in content()['subjects']]}


@pytest.fixture
def drafts(tmp_path):
    clock = Clock()
    try:
        settings = Settings(database_path=tmp_path / 'draft.sqlite3', public_origin=ORIGIN, development=True, draft_mode='local_mock')
    except TypeError:
        pytest.fail('Optional draft settings have not been implemented.')
    app = create_app(settings, clock=clock)
    app.state.auth.create_user('owner', PASSWORD)
    app.state.auth.create_user('other', PASSWORD)
    with TestClient(app, base_url=ORIGIN) as owner, TestClient(app, base_url=ORIGIN) as other:
        def login(client, username):
            session = client.post('/api/auth/login', headers={'Origin': ORIGIN}, json={'username': username, 'password': PASSWORD}).json()
            return {'Origin': ORIGIN, 'X-CSRF-Token': session['csrf_token']}
        headers, other_headers = login(owner, 'owner'), login(other, 'other')
        saved = owner.post('/api/reports', headers=headers, json={'record': record()}).json()
        yield owner, other, headers, other_headers, saved, clock


def propose(client, headers, saved):
    return client.post('/api/reports/' + saved['id'] + '/advice-drafts', headers=headers,
                       json={'revision': saved['revision'], 'context': context(), 'fallback': content()['sections']})


def test_generation_does_not_mutate_and_applying_selected_texts_records_auditable_local_mock_origin(drafts):
    owner, _, headers, _, saved, _ = drafts
    generated = propose(owner, headers, saved)
    assert generated.status_code == 201, generated.text
    draft = generated.json()
    assert draft['kind'] == 'local_mock' and draft['source_revision'] == 1
    assert owner.get('/api/reports/' + saved['id'], headers=headers).json() == saved
    applied = owner.post('/api/reports/' + saved['id'] + '/advice-drafts/' + draft['id'] + '/apply', headers=headers,
                         json={'sections': ['summary'], 'reviewer': '测试审核者'})
    assert applied.status_code == 200, applied.text
    updated = applied.json()
    assert updated['revision'] == 2 and updated['record']['state'] == saved['record']['state']
    assert updated['record']['reportMeta'] == saved['record']['reportMeta']
    editing = updated['record']['advisor']
    assert set(editing['sections']) == {'summary'} and len(editing['history']) == 1
    origin = editing['history'][0]['origin']
    assert origin['kind'] == 'local_mock' and origin['draft_id'] == draft['id'] and origin['source_revision'] == 1
    assert owner.post('/api/reports/' + saved['id'] + '/advice-drafts/' + draft['id'] + '/apply', headers=headers,
                      json={'sections': ['summary'], 'reviewer': '再次审核'}).status_code == 409


def test_owner_csrf_revision_and_draft_ttl_are_checked_before_any_application(drafts):
    owner, other, headers, other_headers, saved, clock = drafts
    assert propose(other, other_headers, saved).status_code == 404
    draft = propose(owner, headers, saved).json()
    path = '/api/reports/' + saved['id'] + '/advice-drafts/' + draft['id'] + '/apply'
    value = {'sections': ['summary'], 'reviewer': '审核'}
    assert owner.post(path, headers={'Origin': ORIGIN}, json=value).status_code == 403
    assert other.post(path, headers=other_headers, json=value).status_code == 404
    clock.value += 901
    assert owner.post(path, headers=headers, json=value).status_code == 409
    assert owner.get('/api/reports/' + saved['id'], headers=headers).json() == saved


def test_stale_source_and_unknown_pii_context_or_sections_are_not_accepted(drafts):
    owner, _, headers, _, saved, _ = drafts
    path = '/api/reports/' + saved['id'] + '/advice-drafts'
    invalid = {'revision': 1, 'context': {**context(), 'name': '不可进入供应商上下文'}, 'fallback': content()['sections']}
    assert owner.post(path, headers=headers, json=invalid).status_code == 422
    draft = propose(owner, headers, saved).json()
    apply_path = path + '/' + draft['id'] + '/apply'
    for body in [{'sections': ['summary', 'summary'], 'reviewer': '审核'}, {'sections': ['score'], 'reviewer': '审核'}, {'sections': ['summary'], 'reviewer': ''}, {'sections': ['summary'], 'reviewer': '审核', 'texts': {'summary': '篡改'}}]:
        assert owner.post(apply_path, headers=headers, json=body).status_code == 422
    changed = copy.deepcopy(saved['record'])
    changed['state']['info']['name'] = '另一个设备的新资料'
    assert owner.put('/api/reports/' + saved['id'], headers=headers, json={'revision': 1, 'record': changed}).status_code == 200
    assert owner.post(apply_path, headers=headers, json={'sections': ['summary'], 'reviewer': '审核'}).status_code == 409
    assert owner.get('/api/reports/' + saved['id'], headers=headers).json()['record'] == changed


def test_default_disabled_mode_returns_unchanged_rule_fallback(tmp_path):
    app = create_app(Settings(database_path=tmp_path / 'disabled.sqlite3', public_origin=ORIGIN, development=True))
    app.state.auth.create_user('owner', PASSWORD)
    with TestClient(app, base_url=ORIGIN) as owner:
        session = owner.post('/api/auth/login', headers={'Origin': ORIGIN}, json={'username': 'owner', 'password': PASSWORD}).json()
        headers = {'Origin': ORIGIN, 'X-CSRF-Token': session['csrf_token']}
        saved = owner.post('/api/reports', headers=headers, json={'record': record()}).json()
        generated = propose(owner, headers, saved)
        assert generated.status_code == 201
        value = generated.json()
        assert value['kind'] == 'rule' and value['reason'] == 'disabled'
        assert value['before'] == value['sections'] == content()['sections']
        assert owner.get('/api/reports/' + saved['id'], headers=headers).json() == saved
