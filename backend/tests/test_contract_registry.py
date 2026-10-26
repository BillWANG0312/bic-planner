"""Profile compatibility is a separate boundary from authority and validation."""

import copy
import importlib
import json
import sqlite3
import sys
from types import SimpleNamespace

import pytest

from backend.bic_api.db import Database, StorageError
from backend.tests.test_models import record as legacy_record
from backend.tests.test_sharing import Clock, content


LEGACY = 'legacy-2026.10'
CURRENT = 'games-traits-v1'
OPERATIONS = ('owner_archive', 'parent_summary_v1', 'family_comments_v1', 'advisor_read_v1',
              'advisor_edit_v1', 'advice_draft_v1', 'teacher_completion_v1',
              'teacher_academic_v2', 'teacher_preferences_v3')


def implementation():
    try:
        return importlib.import_module('backend.bic_api.contracts')
    except ModuleNotFoundError:
        pytest.fail('Central profile and operation contracts must be implemented.')


def current_record():
    value = legacy_record()
    value['assessmentProfile'] = CURRENT
    value['state']['plan']['answers'] = {'grade': '8', 'subjectBoard': {}, 'career': ['science']}
    value['state']['mbti']['answers'] = [{'value': 0, 'ms': 0}, None]
    return value


def rejected(action):
    with pytest.raises(StorageError) as captured:
        action()
    assert captured.value.status_code == 422 and captured.value.code == 'PROFILE'
    assert 'secret' not in captured.value.message and 'private' not in captured.value.message
    return captured.value


@pytest.mark.parametrize('operation', OPERATIONS)
def test_legacy_operations_remain_supported_and_new_profile_operations_stay_closed(operation):
    module = implementation()
    old, new = legacy_record(), current_record()
    originals = copy.deepcopy((old, new))
    assert module.require_operation(old, operation) == LEGACY
    rejected(lambda: module.require_operation(new, operation))
    assert (old, new) == originals


@pytest.mark.parametrize('alter', [
    lambda r: r.update(assessmentProfile='private-future'),
    lambda r: r.update(assessmentProfile=LEGACY),
    lambda r: r['state'].update(assessmentProfile=LEGACY),
    lambda r: r['state'].update(assessmentProfile=CURRENT),
    lambda r: r['state']['mbti'].update(legacy=False),
    lambda r: r['state']['mbti'].update(answers=[{'value': 0}]),
    lambda r: r['state']['mbti'].update(answers=[None] * 30),
    lambda r: r['state']['plan']['answers'].update(subjectBoard={}),
    lambda r: r['state']['plan']['answers'].update(majorBoard={}),
    lambda r: r['state']['plan']['answers'].update(team={}),
    lambda r: r['state']['plan']['answers'].update(career=['science']),
    lambda r: r['state']['plan']['answers'].update(preferredMajor=['cs']),
    lambda r: r['state']['plan']['answers'].update(preferredMajor=['science', 'math', 'eng']),
])
def test_unmarked_new_unknown_nested_or_converted_records_cannot_be_treated_as_legacy(alter):
    module = implementation(); record = legacy_record(); alter(record)
    original = copy.deepcopy(record)
    rejected(lambda: module.profile_for_record(record))
    rejected(lambda: module.require_operation(record, 'parent_summary_v1'))
    assert record == original


@pytest.mark.parametrize('alter', [
    lambda r: r['state']['mbti'].update(answers=[0, {'value': 1}]),
    lambda r: r['state']['mbti'].update(answers=[0]),
    lambda r: r['state']['plan']['answers'].update(groupSize='small'),
    lambda r: r['state']['plan']['answers'].update(timeStyle='deep'),
    lambda r: r['state']['plan']['answers'].update(career=['tech']),
])
def test_explicit_new_profile_does_not_allow_old_question_semantics(alter):
    module = implementation(); record = current_record(); alter(record)
    rejected(lambda: module.profile_for_record(record))


def test_profile_identification_does_not_replace_strict_validation_or_rewrite_values():
    module = implementation(); record = legacy_record()
    record['state']['academic']['answers'] = {'ph3': 'private-stored-answer'}
    assert module.profile_for_record(record) == LEGACY
    with pytest.raises(ValueError):
        module.validate_archive(record)
    original = legacy_record(); original['state']['mbti']['answers'] = [0, None, 2]
    validated = module.validate_archive(original)
    assert validated == original and validated is not original
    validated['state']['info']['name'] = 'Changed copy'
    assert original['state']['info']['name'] != 'Changed copy'


def test_strict_current_validation_is_lazy_and_preserves_the_original_archive(monkeypatch):
    module = implementation(); seen = []

    class CurrentArchiveRecord:
        @staticmethod
        def model_validate(value):
            seen.append(copy.deepcopy(value))

    monkeypatch.setitem(sys.modules, 'backend.bic_api.current_models', SimpleNamespace(CurrentArchiveRecord=CurrentArchiveRecord))
    record = current_record(); expected = copy.deepcopy(record)
    result = module.validate_archive(record)
    assert seen == [expected] and result == expected and result is not record


@pytest.mark.parametrize('operation', ['', 'private-new-operation', None, [], {}])
def test_unknown_operations_fail_closed(operation):
    rejected(lambda: implementation().require_operation(legacy_record(), operation))


def test_extreme_numeric_personality_values_are_a_safe_profile_refusal():
    value = legacy_record(); value['state']['mbti']['answers'] = [10 ** 1000]
    rejected(lambda: implementation().profile_for_record(value))


def test_capabilities_are_copied_safe_and_do_not_announce_unwired_current_operations(monkeypatch):
    module = implementation()
    metadata = {'profile': CURRENT, 'contract_version': 'games-traits-contract-v1',
                'contract_fingerprint': 'f' * 64, 'bank_version': '2026.10',
                'personality_version': 'traits-local-1', 'planning_total': 13,
                'planning_required': 12, 'personality_total': 30}
    monkeypatch.setitem(sys.modules, 'backend.bic_api.current_models',
                        SimpleNamespace(current_contract_metadata=lambda: copy.deepcopy(metadata)))
    result = module.report_capabilities()
    assert result == {'format': 'bic-report-capabilities', 'version': 1, 'api_version': '2',
                      'profiles': [{'profile': LEGACY, 'operations': list(OPERATIONS)},
                                   {'profile': CURRENT, 'operations': [], 'contract': metadata}]}
    result['profiles'][0]['operations'].clear()
    assert module.report_capabilities()['profiles'][0]['operations'] == list(OPERATIONS)


def test_bad_current_metadata_fails_discovery_but_not_legacy_policy_or_validation(monkeypatch):
    module = implementation()

    def broken():
        raise ValueError('private-source-file-or-key')

    monkeypatch.setitem(sys.modules, 'backend.bic_api.current_models', SimpleNamespace(current_contract_metadata=broken))
    assert module.require_operation(legacy_record(), 'owner_archive') == LEGACY
    assert module.validate_archive(legacy_record()) == legacy_record()
    with pytest.raises(StorageError) as captured:
        module.report_capabilities()
    assert captured.value.status_code == 503 and 'private' not in captured.value.message


@pytest.mark.parametrize('projection', ['parent', 'completion', 'preferences'])
def test_pure_legacy_projections_reject_new_profile_before_reading_private_fields(projection):
    record = current_record()
    if projection == 'parent':
        from backend.bic_api.share_models import build_parent_snapshot
        action = lambda: build_parent_snapshot(record, 1, 100, 200, content())
    elif projection == 'completion':
        from backend.bic_api.teacher_summary import TeacherSummaryService
        action = lambda: TeacherSummaryService._completion({}, record)
    else:
        from backend.bic_api.preference_summary import project
        action = lambda: project(record, {})
    rejected(action)


@pytest.fixture
def stored(tmp_path):
    from backend.bic_api.sharing import ShareService
    from backend.bic_api.comments import CommentService
    from backend.bic_api.teacher_access import TeacherAccessService
    from backend.bic_api.advisor_edit import AdvisorEditService
    from backend.bic_api.drafts import AdviceDraftService
    from backend.bic_api.teacher_summary import TeacherSummaryService
    db = Database(tmp_path / 'registry.sqlite3')
    users = {name: db.create_user(name, 'test-only-unused-hash', role)['id']
             for name, role in [('owner', 'student'), ('teacher', 'advisor'), ('parent', 'student'), ('other', 'student')]}
    legacy = db.create_report(users['owner'], legacy_record())
    teacher = TeacherAccessService(db); editor = AdvisorEditService(db)
    read_grant = teacher.create_grant(users['owner'], legacy['id'], 1, 'teacher', 24)
    baseline = {key: 'Only synthetic advice' for key in ['summary', 'academic', 'plan', 'personality']}
    edit_grant = editor.create_grant(users['owner'], legacy['id'], 1, 'teacher', 24, baseline)
    value = current_record()
    with db._transaction() as connection:
        connection.execute('UPDATE reports SET record_json=? WHERE id=?', (json.dumps(value), legacy['id']))
    services = {'share': ShareService(db), 'comments': CommentService(db), 'teacher': teacher,
                'editor': editor, 'drafts': AdviceDraftService(db), 'summary': TeacherSummaryService(db)}
    return db, users, legacy, services, read_grant, edit_grant


@pytest.mark.parametrize('operation', ['share', 'invite', 'teacher-grant', 'edit-grant', 'teacher-read',
                                       'edit-read', 'edit-write', 'draft', 'summary'])
def test_authenticated_operations_reject_current_without_writes_and_keep_management_available(stored, operation):
    from backend.tests.test_drafts import context, fallback
    db, users, saved, services, grant, edit_grant = stored
    with db._connection() as connection:
        before = {table: connection.execute('SELECT * FROM ' + table).fetchall()
                  for table in ['reports', 'shares', 'parent_grants', 'parent_comments', 'teacher_grants', 'advisor_edit_grants', 'advisor_edits']}
    actions = {
        'share': lambda: services['share'].create(users['owner'], saved['id'], 1, 24, content()),
        'invite': lambda: services['comments'].create_grant(users['owner'], saved['id'], 1, 'parent', 24, content()),
        'teacher-grant': lambda: services['teacher'].create_grant(users['owner'], saved['id'], 1, 'teacher', 24),
        'edit-grant': lambda: services['editor'].create_grant(users['owner'], saved['id'], 1, 'teacher', 24, fallback()),
        'teacher-read': lambda: services['teacher'].read(users['teacher'], grant['id']),
        'edit-read': lambda: services['editor'].read(users['teacher'], edit_grant['id']),
        'edit-write': lambda: services['editor'].apply(users['teacher'], edit_grant['id'], 1, {'summary': 'New synthetic advice'}),
        'draft': lambda: services['drafts'].create(users['owner'], saved['id'], 1, context(), fallback()),
        'summary': lambda: services['summary'].read(users['teacher'], [grant['id']], academic=True, preferences=True),
    }
    rejected(actions[operation])
    with db._connection() as connection:
        after = {table: connection.execute('SELECT * FROM ' + table).fetchall() for table in before}
    assert after == before
    assert services['drafts']._pending == {} and services['drafts']._reservations == {}
    assert len(services['teacher'].list_for_report(users['owner'], saved['id'])['items']) == 1
    services['teacher'].revoke(users['owner'], saved['id'], grant['id'])
    services['editor'].revoke(users['owner'], saved['id'], edit_grant['id'])


def test_authority_and_source_revision_are_checked_before_profile_disclosure(stored):
    db, users, saved, services, grant, edit_grant = stored
    for action in [lambda: services['share'].create(users['other'], saved['id'], 1, 24, content()),
                   lambda: services['teacher'].read(users['other'], grant['id'])]:
        with pytest.raises(StorageError) as captured:
            action()
        assert captured.value.status_code == 404
    with pytest.raises(StorageError) as captured:
        services['share'].create(users['owner'], saved['id'], 2, 24, content())
    assert captured.value.status_code == 409


def test_preexisting_legacy_snapshots_and_threads_keep_their_lifecycle_after_a_source_change(tmp_path):
    import uuid
    from backend.bic_api.sharing import ShareService
    from backend.bic_api.comments import CommentService
    db = Database(tmp_path / 'history.sqlite3')
    owner = db.create_user('owner', 'test-only-unused-hash', 'student')['id']
    recipient = db.create_user('parent', 'test-only-unused-hash', 'student')['id']
    saved = db.create_report(owner, legacy_record())
    shares, comments = ShareService(db), CommentService(db)
    share = shares.create(owner, saved['id'], 1, 24, content())
    grant = comments.create_grant(owner, saved['id'], 1, 'parent', 24, content())
    before_share = shares.read(share['token'], 'local-test')
    before_thread = comments.thread(recipient, grant['id'])
    with db._transaction() as connection:
        connection.execute('UPDATE reports SET record_json=? WHERE id=?', (json.dumps(current_record()), saved['id']))
    assert shares.read(share['token'], 'local-test') == before_share
    assert comments.thread(recipient, grant['id']) == before_thread
    message = comments.add_comment(recipient, grant['id'], 'Continue an existing authorized discussion', str(uuid.uuid4()))
    assert comments.thread(owner, grant['id'])['comments'] == [message]
    assert comments.list_for_report(owner, saved['id'])['items'][0]['id'] == grant['id']
    comments.revoke(owner, saved['id'], grant['id'])
    shares.revoke(owner, saved['id'], share['id'])
    for action in [lambda: shares.read(share['token'], 'local-test'),
                   lambda: comments.add_comment(recipient, grant['id'], 'Cannot write after revoke', str(uuid.uuid4()))]:
        with pytest.raises(StorageError) as captured:
            action()
        assert captured.value.status_code == 404
