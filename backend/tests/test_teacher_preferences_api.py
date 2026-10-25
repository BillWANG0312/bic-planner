import copy
import json

from fastapi.testclient import TestClient

from backend.bic_api.dev import create_dev_app
from backend.bic_api.settings import Settings
from backend.tests.test_teacher_api import access, create


def test_preferences_are_explicit_v3_and_all_previous_modes_remain_exact(access):
    _, clients, headers, saved, _ = access
    grant = create(clients, headers, saved).json(); body = {'grant_ids': [grant['id']]}
    def read(**flags):
        result = clients['teacher'].post('/api/teacher-summaries', headers=headers['teacher'], json={**body, **flags})
        assert result.status_code == 200
        return result.json()
    v1 = read(); assert read(academic=False, preferences=False) == v1
    v2 = read(academic=True); assert read(academic=True, preferences=False) == v2
    v3 = read(preferences=True)
    assert v3['version'] == 3 and v3['options'] == {'academic': False, 'preferences': True}
    assert 'scoring' not in v3 and 'performance' not in v3['items'][0]['report']
    assert set(v3['preference_schema']) == {'bank_version', 'schema_version', 'schema_fingerprint', 'basis'}
    assert v3['preference_schema']['basis'] == 'explicit_student_choices'
    report = v3['items'][0]['report']; preferences = report.pop('preferences')
    assert report == v1['items'][0]['report']
    assert preferences == {'preferredMajor': {'answered': False, 'choices': []}, 'countries': {'answered': False, 'choices': []}}
    both = read(academic=True, preferences=True)
    assert both['options'] == {'academic': True, 'preferences': True}
    assert both['scoring'] == v2['scoring']
    row = both['items'][0]['report']; row.pop('preferences'); assert row == v2['items'][0]['report']
    assert clients['owner'].get('/api/reports/' + saved['id']).json() == saved


def test_partial_plan_preserves_unsure_and_fixed_multiselect_without_free_text(access):
    _, clients, headers, saved, _ = access
    record = copy.deepcopy(saved['record'])
    record['state']['plan']['answers'] = {'grade': '8', 'preferredMajor': ['unsure', 'tech'], 'countries': ['unsure', 'hk', 'uk'], 'schoolSubjects': ['不应出现在摘要里的自填']}
    updated_response = clients['owner'].put('/api/reports/' + saved['id'], headers=headers['owner'], json={'revision': 1, 'record': record})
    assert updated_response.status_code == 200
    updated = updated_response.json(); grant = create(clients, headers, updated).json()
    result = clients['teacher'].post('/api/teacher-summaries', headers=headers['teacher'], json={'grant_ids': [grant['id']], 'preferences': True})
    assert result.status_code == 200
    row = result.json()['items'][0]['report']
    assert row['status'] == 'draft'
    assert row['preferences'] == {'preferredMajor': {'answered': True, 'choices': ['tech', 'unsure']}, 'countries': {'answered': True, 'choices': ['uk', 'hk', 'unsure']}}
    for private in ['不应出现在摘要里的自填', '"answers"', '"schoolSubjects"', '"personality_type"', '"history"', '"recommendations"']:
        assert private not in result.text
    assert clients['owner'].get('/api/reports/' + saved['id']).json() == updated


def test_preferences_flags_are_strict_and_do_not_extend_permissions(access):
    _, clients, headers, saved, _ = access
    grant = create(clients, headers, saved).json(); body = {'grant_ids': [grant['id']], 'preferences': True}
    for flag in [0, 1, 'true', None, [], {}]:
        assert clients['teacher'].post('/api/teacher-summaries', headers=headers['teacher'], json={**body, 'preferences': flag}).status_code == 422
    assert clients['teacher'].post('/api/teacher-summaries', headers={'Origin': 'http://127.0.0.1:9001'}, json=body).status_code == 403
    assert clients['other'].post('/api/teacher-summaries', headers=headers['other'], json=body).status_code == 404
    clients['owner'].delete('/api/reports/' + saved['id'] + '/teacher-access/' + grant['id'], headers=headers['owner'])
    assert clients['teacher'].post('/api/teacher-summaries', headers=headers['teacher'], json=body).status_code == 404


def test_only_fixed_two_question_dictionary_is_public(tmp_path):
    origin = 'http://127.0.0.1:9001'
    with TestClient(create_dev_app(Settings(database_path=tmp_path / 'preferences.sqlite3', public_origin=origin, development=True)), base_url=origin) as client:
        response = client.get('/js/preference-schema.js'); assert response.status_code == 200
        public = json.loads(response.text.split('window.BIC_PREFERENCE_SCHEMA = ', 1)[1].strip().removesuffix(';'))
        assert set(public) == {'metadata', 'questions'}
        assert [question['key'] for question in public['questions']] == ['preferredMajor', 'countries']
        assert [question['max'] for question in public['questions']] == [2, 3]
        assert [len(question['options']) for question in public['questions']] == [12, 8]
        assert all(set(option) == {'id', 'label'} for question in public['questions'] for option in question['options'])
        assert client.get('/backend/preference-schema.json').status_code == 404
        assert client.get('/api/health').json()['api_version'] == '2'
