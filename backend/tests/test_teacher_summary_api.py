import copy

from fastapi.testclient import TestClient

from backend.bic_api.dev import create_dev_app
from backend.bic_api.settings import Settings
from backend.tests.test_teacher_api import access, create


def test_summary_batch_is_explicit_readonly_csrf_bound_and_strict(access):
    _, clients, headers, saved, _ = access
    identifier = create(clients, headers, saved).json()['id']
    path = '/api/teacher-summaries'
    body = {'grant_ids': [identifier]}
    assert clients['teacher'].post(path, headers={'Origin': 'https://other.test'}, json=body).status_code == 403
    assert clients['teacher'].post(path, headers={'Origin': 'http://127.0.0.1:9001'}, json=body).status_code == 403
    assert clients['teacher'].post(path, headers=headers['other'], json=body).status_code == 403
    for malformed in [{'grant_ids': []}, {'grant_ids': [identifier] * 2}, {'grant_ids': [identifier], 'record': saved['record']},
                      {'grant_ids': ['../private']}, {'grant_ids': [True]}, {'grant_ids': [str(i) for i in range(21)]}]:
        assert clients['teacher'].post(path, headers=headers['teacher'], json=malformed).status_code == 422
    response = clients['teacher'].post(path, headers=headers['teacher'], json=body)
    assert response.status_code == 200
    assert response.headers['Cache-Control'] == 'no-store'
    assert response.headers['Referrer-Policy'] == 'no-referrer'
    assert response.json()['format'] == 'bic-teacher-completion-summary'
    assert clients['owner'].get('/api/reports/' + saved['id'], headers=headers['owner']).json() == saved


def test_selected_batch_returns_only_counts_and_one_closed_permission_rejects_every_row(access):
    _, clients, headers, saved, _ = access
    first = create(clients, headers, saved).json()
    value = copy.deepcopy(saved['record']); value['id'] = 'other-archive'; value['reportMeta']['batchId'] = 'OTHER-REPORT'; value['state']['info']['name'] = '第二位同学'
    second = clients['owner'].post('/api/reports', headers=headers['owner'], json={'record': value}).json()
    other = create(clients, headers, second).json()
    body = {'grant_ids': [other['id'], first['id']]}
    response = clients['teacher'].post('/api/teacher-summaries', headers=headers['teacher'], json=body)
    assert response.status_code == 200
    batch = response.json()
    assert [item['grant']['id'] for item in batch['items']] == body['grant_ids']
    for item in batch['items']:
        assert set(item) == {'grant', 'report'}
        assert set(item['report']) == {'id', 'revision', 'report_ref', 'name', 'grade', 'bank_version', 'catalog_version', 'status', 'academic', 'planning', 'personality'}
        assert len(item['report']['academic']) == 4
        assert item['report']['planning']['required_total'] == 13
        assert item['report']['personality']['total'] == 24
    for private in ['"answers"', '"advisor"', '"history"', '"actor"', '"record"', '"token"', 'password_hash']:
        assert private not in response.text
    assert clients['owner'].delete('/api/reports/' + second['id'] + '/teacher-access/' + other['id'], headers=headers['owner']).status_code == 204
    denied = clients['teacher'].post('/api/teacher-summaries', headers=headers['teacher'], json=body)
    assert denied.status_code == 404 and 'items' not in denied.json()
    assert clients['other'].post('/api/teacher-summaries', headers=headers['other'], json={'grant_ids': [first['id']]}).status_code == 404


def test_edit_grants_do_not_implicitly_grant_summary_export_and_changed_sources_stop(access):
    app, clients, headers, saved, _ = access
    readonly = create(clients, headers, saved).json()
    baseline = dict.fromkeys(['summary', 'academic', 'plan', 'personality'], '所有者核对的基线')
    edit = clients['owner'].post('/api/reports/' + saved['id'] + '/advisor-edit-access', headers=headers['owner'],
                                json={'revision': 1, 'recipient_username': 'teacher', 'ttl_hours': 24, 'scope': 'full_report_advice_edit', 'baseline': baseline}).json()
    assert clients['teacher'].post('/api/teacher-summaries', headers=headers['teacher'], json={'grant_ids': [edit['id']]}).status_code == 404
    new = copy.deepcopy(saved['record']); new['state']['info']['name'] = '另一修订'
    assert clients['owner'].put('/api/reports/' + saved['id'], headers=headers['owner'], json={'revision': 1, 'record': new}).status_code == 200
    assert clients['teacher'].post('/api/teacher-summaries', headers=headers['teacher'], json={'grant_ids': [readonly['id']]}).status_code == 404
    app.state.db.disable_user('teacher')
    assert clients['teacher'].post('/api/teacher-summaries', headers=headers['teacher'], json={'grant_ids': [readonly['id']]}).status_code == 401
    assert clients['owner'].get('/api/health').json()['api_version'] == '2'


def test_independent_summary_page_does_not_load_answer_or_local_archive_modules(tmp_path):
    origin = 'http://127.0.0.1:9001'
    app = create_dev_app(Settings(database_path=tmp_path / 'summary.sqlite3', public_origin=origin, development=True))
    with TestClient(app, base_url=origin) as client:
        page = client.get('/teacher-summary.html')
        assert page.status_code == 200
        assert page.headers['Cache-Control'] == 'no-store'
        for script in ['js/app.js', 'js/report.js', 'js/report-store.js', 'js/bank.js']:
            assert script not in page.text
        assert client.post('/api/teacher-summaries', headers={'Origin': origin}, json={'grant_ids': ['unknown']}).status_code == 401
