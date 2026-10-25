"""A selected readonly batch exposes completion counts, never answer sheets."""

from contextlib import contextmanager
import copy
import importlib
import json
from pathlib import Path
import sqlite3
import subprocess

import pytest

from backend.bic_api.db import StorageError
from backend.bic_api.models import ASSESSMENT_SCHEMA
from backend.tests.test_teacher_access import service as existing_access, record


@pytest.fixture
def summary(existing_access):
    try:
        cls = importlib.import_module('backend.bic_api.teacher_summary').TeacherSummaryService
    except ModuleNotFoundError:
        pytest.fail('The selected readonly completion-summary service must exist.')
    db, access, users, saved, clock = existing_access
    return db, access, cls(db, clock=clock), users, saved, clock


def create(summary, key=None, value=None, recipient='teacher'):
    db, access, _, users, saved, _ = summary
    if key is not None:
        saved = db.create_report(users['owner'], value or record(key))
    grant = access.create_grant(users['owner'], saved['id'], saved['revision'], recipient, 24)
    return saved, grant


def error(operation, status, code=None):
    with pytest.raises(StorageError) as captured:
        operation()
    assert captured.value.status_code == status
    if code:
        assert captured.value.code == code
    return captured.value


def test_selected_batch_exact_minimal_contract_and_request_order(summary):
    db, _, reader, users, _, _ = summary
    first, first_grant = create(summary)
    second, second_grant = create(summary, 'second')
    answer = reader.read(users['teacher'], [second_grant['id'], first_grant['id']])
    assert set(answer) == {'format', 'version', 'items'}
    assert answer['format'] == 'bic-teacher-completion-summary' and answer['version'] == 1
    assert [item['grant'] for item in answer['items']] == [second_grant, first_grant]
    for item, saved in zip(answer['items'], [second, first]):
        assert set(item) == {'grant', 'report'}
        row = item['report']
        assert set(row) == {'id', 'revision', 'report_ref', 'name', 'grade', 'bank_version', 'catalog_version',
                            'status', 'academic', 'planning', 'personality'}
        assert row['id'] == saved['id'] and row['revision'] == 1
        assert row['report_ref'] == saved['record']['reportMeta']['batchId']
        assert row['name'] == saved['record']['state']['info']['name']
        assert row['grade'] == '8' and row['bank_version'] == '2026.10' and row['catalog_version'] is None
        assert row['status'] == 'draft'
        assert row['academic'] == [{'key': key, 'answered': int(key == 'english'), 'total': 15}
                                   for key in ['english', 'maths', 'physics', 'chemistry']]
        assert row['planning'] == {'answered': 1, 'total': 14, 'required_answered': 1, 'required_total': 13}
        assert row['personality'] == {'answered': 0, 'total': 24}
        assert db.get_report(users['owner'], saved['id']) == saved
    serialized = json.dumps(answer, ensure_ascii=False)
    for forbidden in ['answers', 'advisor', 'history', 'csrf', 'password', 'year', 'createdAt', 'updatedAt', 'date', '私密建议', '私密顾问']:
        assert forbidden not in serialized


@pytest.mark.parametrize('ids', [None, 'one', (), [], ['one'] * 2, [''] , [True], [1], [None], ['../bad'], ['中'],
                              ['a' * 129], ['grant-' + str(i) for i in range(21)]])
def test_invalid_selection_is_rejected_before_reading(summary, ids, monkeypatch):
    db, _, reader, users, _, _ = summary
    monkeypatch.setattr(db, '_connection', lambda: pytest.fail('Invalid selection must not query private records.'))
    error(lambda: reader.read(users['teacher'], ids), 422, 'VALIDATION')


def test_only_chosen_ids_are_read_and_unrelated_bad_report_is_ignored(summary):
    db, _, reader, users, _, _ = summary
    saved, selected = create(summary)
    broken, _ = create(summary, 'not-selected')
    with sqlite3.connect(db.path) as connection:
        connection.execute('UPDATE reports SET record_json=? WHERE id=?', ('private-broken-json', broken['id']))
    result = reader.read(users['teacher'], [selected['id']])
    assert [item['report']['id'] for item in result['items']] == [saved['id']]


@pytest.mark.parametrize('actor', ['owner', 'other.teacher', 'other.student', 'missing'])
def test_batch_cannot_adopt_a_different_account_or_role(summary, actor):
    _, _, reader, users, _, _ = summary
    _, chosen = create(summary)
    error(lambda: reader.read(users.get(actor, actor), [chosen['id']]), 404, 'NOT_FOUND')


@pytest.mark.parametrize('failure', ['revoked', 'expired', 'owner_disabled', 'recipient_disabled', 'role', 'source_changed', 'owner_changed', 'report_deleted', 'recipient_deleted'])
def test_any_lost_permission_rejects_the_entire_batch(summary, failure):
    db, access, reader, users, _, clock = summary
    _, first = create(summary)
    second, chosen = create(summary, 'second')
    if failure == 'revoked':
        access.revoke(users['owner'], second['id'], chosen['id'])
    elif failure == 'expired':
        clock.value = chosen['expires_at']
    elif failure == 'owner_disabled':
        db.disable_user('owner')
    elif failure == 'recipient_disabled':
        db.disable_user('teacher')
    elif failure == 'source_changed':
        db.update_report(users['owner'], second['id'], second['record'], 1)
    elif failure == 'report_deleted':
        db.delete_report(users['owner'], second['id'], 1)
    else:
        with sqlite3.connect(db.path) as connection:
            connection.execute('PRAGMA foreign_keys=ON')
            if failure == 'role':
                connection.execute('UPDATE users SET role=? WHERE id=?', ('student', users['teacher']))
            elif failure == 'recipient_deleted':
                connection.execute('DELETE FROM users WHERE id=?', (users['teacher'],))
            else:
                connection.execute('UPDATE reports SET owner_id=? WHERE id=?', (users['other.student'], second['id']))
    error(lambda: reader.read(users['teacher'], [first['id'], chosen['id']]), 404, 'NOT_FOUND')


def test_unknown_id_or_another_recipient_grant_rejects_without_partial_output(summary):
    _, _, reader, users, _, _ = summary
    _, first = create(summary)
    _, other = create(summary, 'different-recipient', recipient='other.teacher')
    for missing in ['unknown', other['id']]:
        error(lambda: reader.read(users['teacher'], [first['id'], missing]), 404, 'NOT_FOUND')


@pytest.mark.parametrize('version', ['old-bank', 'unknown', '2026.9'])
def test_old_or_unknown_bank_is_explicitly_refused_not_recomputed(summary, version):
    _, _, reader, users, _, _ = summary
    value = record('old'); value['bankVersion'] = version
    _, first = create(summary)
    _, old = create(summary, 'old', value)
    error(lambda: reader.read(users['teacher'], [first['id'], old['id']]), 409, 'VERSION')


@pytest.mark.parametrize('catalog', [None, 'old-catalog', 'unknown'])
def test_completion_does_not_require_current_catalog_or_export_its_rules(summary, catalog):
    _, _, reader, users, _, _ = summary
    value = record('catalog'); value['catalogVersion'] = catalog
    _, chosen = create(summary, 'catalog', value)
    assert reader.read(users['teacher'], [chosen['id']])['items'][0]['report']['catalog_version'] == catalog


@pytest.mark.parametrize('corruption', ['json', 'name', 'reference', 'grade', 'archive', 'extra', 'answer'])
def test_corrupt_source_or_metadata_fails_closed_without_private_echo(summary, corruption):
    db, _, reader, users, _, _ = summary
    saved, chosen = create(summary)
    with sqlite3.connect(db.path) as connection:
        if corruption == 'json':
            connection.execute('UPDATE reports SET record_json=? WHERE id=?', ('secret-private-json', saved['id']))
        elif corruption in ('extra', 'answer'):
            value = copy.deepcopy(saved['record'])
            if corruption == 'extra':
                value['secret-private-extra'] = 'private-secret'
            else:
                value['state']['academic']['answers']['ph3'] = True
            connection.execute('UPDATE reports SET record_json=? WHERE id=?', (json.dumps(value), saved['id']))
        else:
            column = {'name': 'name', 'reference': 'report_ref', 'grade': 'grade', 'archive': 'archive_id'}[corruption]
            connection.execute('UPDATE reports SET ' + column + '=? WHERE id=?', ('secret-private-value', saved['id']))
    captured = error(lambda: reader.read(users['teacher'], [chosen['id']]), 503)
    assert 'secret-private' not in str(captured) and 'private-secret' not in str(captured)


def full_record(key):
    value = record(key)
    value['state']['academic']['answers'] = {q['id']: 0 for q in ASSESSMENT_SCHEMA['academic']}
    plan = {q['key']: q['options'][0] if q['type'] == 'single' else [q['options'][0]]
            for q in ASSESSMENT_SCHEMA['plan']}
    plan['grade'] = '8'; plan.pop('weakSubjects')
    value['state']['plan']['answers'] = plan
    value['state']['mbti']['answers'] = [0] * 24
    return value


@pytest.mark.parametrize('case', ['full', 'optional_empty', 'optional_absent', 'required_empty', 'grade_fallback', 'plan_grade_fallback', 'zero_null', 'mbti_neutral', 'academic_partial'])
def test_counts_and_required_status_match_actual_browser_engine(summary, case):
    _, _, reader, users, _, _ = summary
    value = full_record(case)
    if case == 'optional_empty':
        value['state']['plan']['answers']['weakSubjects'] = []
    elif case == 'required_empty':
        value['state']['plan']['answers']['interests'] = []
    elif case == 'grade_fallback':
        value['state']['plan']['answers'].pop('grade')
    elif case == 'plan_grade_fallback':
        value['state']['info']['grade'] = ''
        value['state']['plan']['answers']['grade'] = '9'
    elif case == 'mbti_neutral':
        value['state']['mbti']['answers'] = [2] * 24
    elif case == 'zero_null':
        numeric_id = next(question['id'] for question in ASSESSMENT_SCHEMA['academic'] if question['type'] == 'numeric')
        value['state']['academic']['answers'] = {'en1': 0, 'ma3': 0, 'ma4': None, 'ph1': 0, 'ch1': None, numeric_id: '0'}
        value['state']['mbti']['answers'] = [0, None, 0]
    elif case == 'academic_partial':
        value['state']['academic']['answers'].pop('en1')
    saved, chosen = create(summary, case, value)
    row = reader.read(users['teacher'], [chosen['id']])['items'][0]['report']
    code = """const fs=require('node:fs');const {loadReportScripts}=require('./tests/helpers/report.cjs');const w=loadReportScripts();
const state=JSON.parse(fs.readFileSync(0,'utf8'));const report=w.generateReport(state);
console.log(JSON.stringify({grade:(w.PLAN_CONFIG.grade.find(g=>g.label===report.meta.grade)||{}).id||'',status:report.meta.status,coverage:report.meta.coverage,subjects:report.academic.subjects.map(s=>({key:s.key,answered:s.answered,total:s.total}))}));"""
    result = subprocess.run(['node', '-e', code], cwd=Path(__file__).resolve().parents[2], input=json.dumps(saved['record']['state']),
                            capture_output=True, encoding='utf-8', check=True)
    expected = json.loads(result.stdout)
    by_key = {subject['key']: subject for subject in expected['subjects']}
    assert row['academic'] == [by_key[key] for key in ['english', 'maths', 'physics', 'chemistry']]
    assert row['planning']['answered'] == expected['coverage']['plan']['answered']
    assert row['planning']['total'] == expected['coverage']['plan']['total']
    assert row['personality'] == expected['coverage']['mbti']
    assert row['status'] == expected['status']
    assert row['grade'] == expected['grade']
    assert row['planning']['required_answered'] == (12 if case == 'required_empty' else 13)


def test_one_join_snapshot_covers_all_selected_permissions_and_payloads(summary, monkeypatch):
    db, _, reader, users, _, _ = summary
    _, first = create(summary); _, second = create(summary, 'second')
    original = db._connection; statements = []
    @contextmanager
    def tracked():
        with original() as connection:
            connection.set_trace_callback(statements.append)
            yield connection
    monkeypatch.setattr(db, '_connection', tracked)
    monkeypatch.setattr(db, 'get_report', lambda *args: pytest.fail('Do not authorize then fetch a different report snapshot.'))
    assert len(reader.read(users['teacher'], [first['id'], second['id']])['items']) == 2
    selects = [sql for sql in statements if sql.lstrip().upper().startswith('SELECT')]
    assert len(selects) == 1
    assert all(word in selects[0] for word in ['teacher_grants', 'reports', 'users', first['id'], second['id']])


def test_expiry_clock_is_checked_after_snapshot_not_before_a_wait(summary, monkeypatch):
    db, _, reader, users, _, clock = summary
    _, chosen = create(summary)
    original = db._connection
    @contextmanager
    def delayed():
        with original() as connection:
            yield connection
        clock.value = chosen['expires_at']
    monkeypatch.setattr(db, '_connection', delayed)
    error(lambda: reader.read(users['teacher'], [chosen['id']]), 404)


def test_two_active_grants_for_same_report_and_cross_owner_reference_collision_are_rejected(summary):
    db, _, reader, users, _, _ = summary
    saved, first = create(summary)
    with sqlite3.connect(db.path) as connection:
        row = connection.execute('SELECT * FROM teacher_grants WHERE id=?', (first['id'],)).fetchone()
        connection.execute('INSERT INTO teacher_grants VALUES (?,?,?,?,?,?,?,?)', ('duplicate-grant', *row[1:]))
    error(lambda: reader.read(users['teacher'], [first['id'], 'duplicate-grant']), 422, 'VALIDATION')
    value = record('cross-owner'); value['reportMeta']['batchId'] = saved['record']['reportMeta']['batchId']
    second = db.create_report(users['other.student'], value)
    _, access, _, _, _, _ = summary
    collision = access.create_grant(users['other.student'], second['id'], 1, 'teacher', 24)
    error(lambda: reader.read(users['teacher'], [first['id'], collision['id']]), 422, 'VALIDATION')


def test_edit_or_parent_grant_identifier_does_not_become_readonly_summary_authority(summary):
    db, _, reader, users, saved, clock = summary
    from backend.bic_api.advisor_edit import AdvisorEditService
    from backend.bic_api.comments import CommentService
    from backend.tests.test_sharing import content
    edit = AdvisorEditService(db, clock=clock).create_grant(users['owner'], saved['id'], 1, 'teacher', 24,
                                                        {'summary': '核心', 'academic': '学习', 'plan': '私密建议', 'personality': '策略'})
    parent = CommentService(db, clock=clock).create_grant(users['owner'], saved['id'], 1, 'teacher', 24, content())
    for selected in [edit['id'], parent['id'], 'opaque-share-token']:
        error(lambda: reader.read(users['teacher'], [selected]), 404, 'NOT_FOUND')


def test_twenty_selected_reports_preserve_explicit_order_without_persistent_writes(summary):
    db, _, reader, users, _, _ = summary
    choices = [create(summary, 'batch-' + str(index)) for index in range(20)]
    with sqlite3.connect(db.path) as connection:
        original_reports = connection.execute('SELECT * FROM reports ORDER BY id').fetchall()
        original_grants = connection.execute('SELECT * FROM teacher_grants ORDER BY id').fetchall()
        original_audit = connection.execute('SELECT * FROM advisor_edits ORDER BY id').fetchall()
    identifiers = [grant['id'] for _, grant in reversed(choices)]
    result = reader.read(users['teacher'], identifiers)
    assert [item['grant']['id'] for item in result['items']] == identifiers
    assert [item['report']['report_ref'] for item in result['items']] == ['AP-batch-' + str(index) for index in reversed(range(20))]
    with sqlite3.connect(db.path) as connection:
        assert connection.execute('SELECT * FROM reports ORDER BY id').fetchall() == original_reports
        assert connection.execute('SELECT * FROM teacher_grants ORDER BY id').fetchall() == original_grants
        assert connection.execute('SELECT * FROM advisor_edits ORDER BY id').fetchall() == original_audit
        assert connection.execute('PRAGMA user_version').fetchone()[0] == 5


def test_batch_never_mixes_snapshot_metadata_with_a_later_answer_sheet(summary, monkeypatch):
    db, _, reader, users, _, _ = summary
    first_saved, first = create(summary)
    second_saved, second = create(summary, 'later')
    original = db._connection
    done = False
    @contextmanager
    def after_snapshot():
        nonlocal done
        with original() as connection:
            yield connection
        if not done:
            done = True
            changed = copy.deepcopy(second_saved['record'])
            changed['state']['academic']['answers'] = {q['id']: 0 for q in ASSESSMENT_SCHEMA['academic']}
            db.update_report(users['owner'], second_saved['id'], changed, 1)
    monkeypatch.setattr(db, '_connection', after_snapshot)
    result = reader.read(users['teacher'], [first['id'], second['id']])
    assert [item['report']['revision'] for item in result['items']] == [1, 1]
    assert [sum(subject['answered'] for subject in item['report']['academic']) for item in result['items']] == [1, 1]
    assert db.get_report(users['owner'], first_saved['id']) == first_saved
    assert db.get_report(users['owner'], second_saved['id'])['revision'] == 2
    error(lambda: reader.read(users['teacher'], [first['id'], second['id']]), 404)
