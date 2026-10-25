import copy
import json
from pathlib import Path
import subprocess

from fastapi.testclient import TestClient

from backend.bic_api.dev import create_dev_app
from backend.bic_api.settings import Settings
from backend.tests.test_teacher_api import access, create


def test_academic_true_is_explicit_while_default_and_false_preserve_exact_v1(access):
    _, clients, headers, saved, _ = access
    permission = create(clients, headers, saved).json()
    body = {'grant_ids': [permission['id']]}
    path = '/api/teacher-summaries'
    default = clients['teacher'].post(path, headers=headers['teacher'], json=body)
    false = clients['teacher'].post(path, headers=headers['teacher'], json={**body, 'academic': False})
    assert false.status_code == 200 and false.json() == default.json()
    true = clients['teacher'].post(path, headers=headers['teacher'], json={**body, 'academic': True})
    assert true.status_code == 200 and true.json()['version'] == 2
    assert set(true.json()['scoring']) == {'bank_version', 'rule_version', 'rule_fingerprint', 'basis', 'incomplete_policy', 'calibration'}
    assert true.json()['scoring']['calibration'] == 'not_calibrated'
    assert true.json()['scoring']['basis'] == 'current_local_rules_recomputed'
    row = true.json()['items'][0]['report']
    assert all(item['pct'] is None and item['complete'] is False for item in row.pop('performance'))
    assert row == default.json()['items'][0]['report']
    assert clients['owner'].get('/api/reports/' + saved['id']).json() == saved


def test_complete_zero_and_full_subjects_differ_from_unfinished_without_exposing_keys(access):
    _, clients, headers, saved, _ = access
    script = "const fs=require('fs'),vm=require('vm'),w={};vm.runInNewContext(fs.readFileSync('js/bank.js','utf8'),{window:w});process.stdout.write(JSON.stringify(Object.fromEntries(w.QUESTION_BANK.filter(q=>['english','maths'].includes(q.subject)).map(q=>[q.id,q.subject==='maths'?q.answer:q.type==='choice'?(q.answer+1)%q.options.length:q.answer+1000]))));"
    answers = json.loads(subprocess.check_output(['node', '-e', script], cwd=Path(__file__).resolve().parents[2], text=True, encoding='utf-8'))
    record = copy.deepcopy(saved['record']); record['state']['academic']['answers'] = answers
    updated = clients['owner'].put('/api/reports/' + saved['id'], headers=headers['owner'], json={'revision': 1, 'record': record}).json()
    grant = create(clients, headers, updated).json()
    result = clients['teacher'].post('/api/teacher-summaries', headers=headers['teacher'], json={'grant_ids': [grant['id']], 'academic': True})
    assert result.status_code == 200
    assert result.json()['items'][0]['report']['performance'] == [
        {'key': 'english', 'complete': True, 'pct': 0}, {'key': 'maths', 'complete': True, 'pct': 100},
        {'key': 'physics', 'complete': False, 'pct': None}, {'key': 'chemistry', 'complete': False, 'pct': None}]
    for field in ['"answers"', '"answer"', '"questions"', '"tol"', '"history"', '"record"', '"actor"']:
        assert field not in result.text
    assert clients['owner'].get('/api/reports/' + saved['id']).json() == updated


def test_flags_are_strict_and_v2_does_not_bypass_identity_or_revocation(access):
    _, clients, headers, saved, _ = access
    grant = create(clients, headers, saved).json()
    body = {'grant_ids': [grant['id']], 'academic': True}
    for flag in [0, 1, 'true', None, [], {}]:
        assert clients['teacher'].post('/api/teacher-summaries', headers=headers['teacher'], json={**body, 'academic': flag}).status_code == 422
    assert clients['teacher'].post('/api/teacher-summaries', headers={'Origin': 'http://127.0.0.1:9001'}, json=body).status_code == 403
    assert clients['other'].post('/api/teacher-summaries', headers=headers['other'], json=body).status_code == 404
    clients['owner'].delete('/api/reports/' + saved['id'] + '/teacher-access/' + grant['id'], headers=headers['owner'])
    assert clients['teacher'].post('/api/teacher-summaries', headers=headers['teacher'], json=body).status_code == 404


def test_only_safe_rule_metadata_is_public_while_private_answer_snapshot_is_unserved(tmp_path):
    origin = 'http://127.0.0.1:9001'
    with TestClient(create_dev_app(Settings(database_path=tmp_path / 'academic.sqlite3', public_origin=origin, development=True)), base_url=origin) as client:
        response = client.get('/js/academic-scoring-meta.js')
        assert response.status_code == 200
        assert 'BIC_ACADEMIC_SCORING_META' in response.text
        public = json.loads(response.text.split('window.BIC_ACADEMIC_SCORING_META = ', 1)[1].strip().removesuffix(';'))
        assert set(public) == {'bank_version', 'rule_version', 'rule_fingerprint', 'basis', 'incomplete_policy', 'calibration'}
        assert client.get('/backend/academic-scoring.json').status_code == 404
        assert client.get('/api/health').json()['api_version'] == '2'
