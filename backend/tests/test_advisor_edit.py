"""Real edit authorization, atomic text-only writes and authenticated auditing."""

from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
import copy
import importlib
import json
import sqlite3

import pytest

from backend.bic_api.db import Database, StorageError
from backend.tests.test_teacher_access import assert_error, record
from backend.tests.test_sharing import Clock


SECTIONS = ('summary', 'academic', 'plan', 'personality')


@pytest.fixture
def service(tmp_path):
    try:
        cls = importlib.import_module('backend.bic_api.advisor_edit').AdvisorEditService
    except ModuleNotFoundError:
        pytest.fail('The separately authorized advisor edit service must exist.')
    clock = Clock()
    db = Database(tmp_path / 'private.sqlite3', clock=clock)
    users = {name: db.create_user(name, 'test-only-hash', role)['id'] for name, role in [
        ('owner', 'student'), ('teacher', 'advisor'), ('other.teacher', 'advisor'), ('student', 'student')]}
    saved = db.create_report(users['owner'], record())
    baseline = {section: '所有者确认' + section for section in SECTIONS}
    baseline['plan'] = saved['record']['advisor']['sections']['plan']
    return db, cls(db, clock=clock), users, saved, clock, baseline


def grant(service, recipient='teacher', revision=1, ttl=24, baseline=None):
    _, edit, users, saved, _, original = service
    return edit.create_grant(users['owner'], saved['id'], revision, recipient, ttl, original if baseline is None else baseline)


def test_full_revision_grant_is_separate_and_plain_text_batch_changes_only_advice(service):
    db, edit, users, saved, clock, baseline = service
    created = grant(service)
    assert set(created) == {'id', 'report_id', 'report_revision', 'report_name', 'report_ref', 'owner_username',
                            'recipient_username', 'scope', 'created_at', 'expires_at', 'revoked_at', 'status'}
    assert created['scope'] == 'full_report_advice_edit' and created['status'] == 'active'
    assert edit.read(users['teacher'], created['id']) == {'grant': created, 'report': saved, 'baseline': baseline}
    assert edit.list_for_user(users['teacher']) == {'items': [created]}
    assert edit.list_for_report(users['owner'], saved['id']) == {'items': [created]}
    result = edit.apply(users['teacher'], created['id'], 1, {'summary': '  <b>顾问文字</b>  ', 'plan': '新的专业建议'})
    assert result['changed_sections'] == ['summary', 'plan'] and result['audit_id']
    changed = result['report']
    assert changed['revision'] == 2
    for key in ['id', 'createdAt', 'bankVersion', 'catalogVersion', 'state', 'reportMeta']:
        assert changed['record'].get(key) == saved['record'].get(key)
    assert changed['record']['advisor']['sections'] == {'plan': '新的专业建议', 'summary': '<b>顾问文字</b>'}
    assert changed['record']['advisor']['history'][:-2] == saved['record']['advisor']['history']
    for entry in changed['record']['advisor']['history'][-2:]:
        assert entry['author'] == '学校顾问' and entry['action'] == 'edit'
        assert entry['before'] == baseline[entry['section']]
        assert entry['actor'] == {'kind': 'school_advisor', 'user_id': users['teacher'], 'username': 'teacher',
                                  'grant_id': created['id'], 'source_revision': 1, 'result_revision': 2}
        assert 'origin' not in entry
    assert db.get_report(users['owner'], saved['id']) == changed
    audit = edit.list_audit(users['owner'], saved['id'])['items']
    assert len(audit) == 1 and audit[0]['id'] == result['audit_id']
    assert audit[0]['actor_id'] == users['teacher'] and audit[0]['actor_username'] == 'teacher'
    assert audit[0]['source_revision'] == 1 and audit[0]['result_revision'] == 2
    assert audit[0]['changes'] == [{'section': key, 'before': baseline[key], 'after': changed['record']['advisor']['sections'][key]}
                                   for key in ['summary', 'plan']]
    assert edit.list_for_report(users['owner'], saved['id'])['items'][0]['status'] == 'source_changed'
    assert edit.list_for_user(users['teacher'])['items'] == []
    assert_error(lambda: edit.apply(users['teacher'], created['id'], 1, {'summary': '再次写入'}), 404)
    assert len(edit.list_audit(users['owner'], saved['id'])['items']) == 1


@pytest.mark.parametrize('ttl', [24, 72, 168])
def test_expiry_boundary_closes_read_and_write(service, ttl):
    _, edit, users, saved, clock, _ = service
    created = grant(service, ttl=ttl)
    clock.value = created['expires_at'] - 1
    assert edit.read(users['teacher'], created['id'])['grant']['status'] == 'active'
    clock.value += 1
    assert_error(lambda: edit.read(users['teacher'], created['id']), 404)
    assert_error(lambda: edit.apply(users['teacher'], created['id'], 1, {'plan': '已到期'}), 404)
    assert edit.list_for_report(users['owner'], saved['id'])['items'][0]['status'] == 'expired'


@pytest.mark.parametrize('actor', ['owner', 'other.teacher', 'student', 'missing'])
def test_other_accounts_and_student_role_cannot_read_write_or_list_edit_grant(service, actor):
    _, edit, users, saved, _, _ = service
    created = grant(service)
    actor_id = users.get(actor, actor)
    assert_error(lambda: edit.read(actor_id, created['id']), 404)
    assert_error(lambda: edit.apply(actor_id, created['id'], 1, {'plan': '越权'}), 404)
    if actor != 'other.teacher':
        assert_error(lambda: edit.list_for_user(actor_id), 404)
    if actor != 'owner':
        assert_error(lambda: edit.list_for_report(actor_id, saved['id']), 404)
        assert_error(lambda: edit.revoke(actor_id, saved['id'], created['id']), 404)
        assert_error(lambda: edit.list_audit(actor_id, saved['id']), 404)


@pytest.mark.parametrize('recipient,status', [('missing', 404), ('student', 404), ('owner', 422), ('ab', 422), ('中文账号', 422)])
def test_recipient_must_be_another_existing_enabled_advisor(service, recipient, status):
    assert_error(lambda: grant(service, recipient), status)


@pytest.mark.parametrize('revision', [0, True, 1.0, '1', None, 9007199254740992])
def test_invalid_revision_is_never_coerced(service, revision):
    _, edit, users, _, _, _ = service
    assert_error(lambda: grant(service, revision=revision), 422)
    created = grant(service)
    assert_error(lambda: edit.apply(users['teacher'], created['id'], revision, {'plan': '新文字'}), 422)


@pytest.mark.parametrize('ttl', [0, 23, True, 24.0, '24', None])
def test_unsupported_lifetime_is_rejected(service, ttl):
    assert_error(lambda: grant(service, ttl=ttl), 422)


@pytest.mark.parametrize('alter', [lambda b: b.pop('summary'), lambda b: b.update(extra='secret'),
                                  lambda b: b.update(plan='冒用修改前文本'), lambda b: b.update(summary=' '),
                                  lambda b: b.update(summary=True), lambda b: b.update(summary='🙂' * 2001)])
def test_owner_baseline_is_exact_complete_bounded_and_matches_existing_overrides(service, alter):
    baseline = copy.deepcopy(service[-1])
    alter(baseline)
    assert_error(lambda: grant(service, baseline=baseline), 422)


@pytest.mark.parametrize('changes', [{}, {'score': '100'}, {'plan': ''}, {'plan': True}, {'plan': '🙂' * 2001},
                                     {'summary': 'new', 'author': '伪造'}, {'summary': None}, ['summary']])
def test_changes_are_only_nonempty_fixed_sections_not_identity_or_record(service, changes):
    db, edit, users, saved, _, _ = service
    created = grant(service)
    assert_error(lambda: edit.apply(users['teacher'], created['id'], 1, changes), 422)
    assert db.get_report(users['owner'], saved['id']) == saved
    assert edit.list_audit(users['owner'], saved['id']) == {'items': []}


def test_noop_keeps_revision_original_spacing_history_and_active_grant(service):
    db, edit, users, saved, _, baseline = service
    created = grant(service)
    result = edit.apply(users['teacher'], created['id'], 1, {'plan': '\ufeff ' + baseline['plan'] + '\u00a0'})
    assert result == {'report': saved, 'changed_sections': [], 'audit_id': None}
    assert edit.read(users['teacher'], created['id'])['report'] == saved
    assert edit.list_audit(users['owner'], saved['id']) == {'items': []}
    assert db.get_report(users['owner'], saved['id']) == saved


@pytest.mark.parametrize('kind', ['owner_disabled', 'recipient_disabled', 'role', 'revoked', 'changed', 'deleted'])
def test_permissions_are_rechecked_for_every_write_and_owner_can_revoke_history(service, kind):
    db, edit, users, saved, _, _ = service
    created = grant(service)
    if kind == 'owner_disabled':
        db.disable_user('owner')
    elif kind == 'recipient_disabled':
        db.disable_user('teacher')
    elif kind == 'role':
        with db._transaction() as connection:
            connection.execute("UPDATE users SET role='student' WHERE id=?", (users['teacher'],))
    elif kind == 'revoked':
        edit.revoke(users['owner'], saved['id'], created['id'])
        edit.revoke(users['owner'], saved['id'], created['id'])
    elif kind == 'changed':
        db.update_report(users['owner'], saved['id'], saved['record'], 1)
    else:
        db.delete_report(users['owner'], saved['id'], 1)
    assert_error(lambda: edit.read(users['teacher'], created['id']), 404)
    assert_error(lambda: edit.apply(users['teacher'], created['id'], 1, {'plan': '无权限'}), 404)
    if kind not in ('owner_disabled', 'deleted'):
        edit.revoke(users['owner'], saved['id'], created['id'])
        assert edit.list_for_report(users['owner'], saved['id'])['items'][0]['status'] == 'revoked'


def test_wrong_requested_revision_conflicts_without_changing_a_valid_grant(service):
    db, edit, users, saved, _, _ = service
    created = grant(service)
    assert_error(lambda: edit.apply(users['teacher'], created['id'], 2, {'plan': '新文字'}), 409, 'REVISION')
    assert db.get_report(users['owner'], saved['id']) == saved
    assert edit.read(users['teacher'], created['id'])['grant']['status'] == 'active'


def test_duplicate_and_history_quotas_are_atomic_and_independent_of_readonly(service):
    db, edit, users, saved, _, baseline = service
    from backend.bic_api.teacher_access import TeacherAccessService
    readonly = TeacherAccessService(db)
    old = readonly.create_grant(users['owner'], saved['id'], 1, 'teacher', 24)
    assert_error(lambda: edit.read(users['teacher'], old['id']), 404)
    first = grant(service)
    assert_error(lambda: grant(service), 409, 'DUPLICATE')
    edit.revoke(users['owner'], saved['id'], first['id'])
    for _ in range(9):
        item = grant(service)
        edit.revoke(users['owner'], saved['id'], item['id'])
    assert_error(lambda: grant(service), 413, 'LIMIT')
    assert len(edit.list_for_report(users['owner'], saved['id'])['items']) == 10


def test_concurrent_submissions_have_one_atomic_winner_and_one_audit(service):
    db, edit, users, saved, _, _ = service
    created = grant(service)
    def submit(text):
        try:
            return edit.apply(users['teacher'], created['id'], 1, {'summary': text})
        except StorageError as error:
            return error.status_code
    with ThreadPoolExecutor(max_workers=2) as pool:
        result = list(pool.map(submit, ['第一份', '第二份']))
    assert sum(isinstance(value, dict) for value in result) == 1
    assert 404 in result
    assert db.get_report(users['owner'], saved['id'])['revision'] == 2
    assert len(edit.list_audit(users['owner'], saved['id'])['items']) == 1


def test_audit_insert_failure_rolls_back_report_and_authorization(service, monkeypatch):
    db, edit, users, saved, _, _ = service
    created = grant(service)
    original = db._transaction
    @contextmanager
    def fail():
        with original() as connection:
            connection.set_authorizer(lambda action, name, *args: sqlite3.SQLITE_DENY
                                      if action == sqlite3.SQLITE_INSERT and name == 'advisor_edits' else sqlite3.SQLITE_OK)
            yield connection
    monkeypatch.setattr(db, '_transaction', fail)
    assert_error(lambda: edit.apply(users['teacher'], created['id'], 1, {'plan': '应回滚'}), 503)
    assert db.get_report(users['owner'], saved['id']) == saved
    assert edit.read(users['teacher'], created['id'])['grant']['status'] == 'active'
    assert edit.list_audit(users['owner'], saved['id'])['items'] == []


def test_audit_preserves_actual_long_username_after_recipient_deletion_then_report_delete_cascades(service):
    db, edit, users, saved, _, _ = service
    name = 'advisor.' + 'a' * 56
    person = db.create_user(name, 'hash', 'advisor')
    created = grant(service, name)
    result = edit.apply(person['id'], created['id'], 1, {'summary': '真实账号不是自填姓名'})
    assert result['report']['record']['advisor']['history'][-1]['actor']['username'] == name
    with db._transaction() as connection:
        connection.execute('DELETE FROM users WHERE id=?', (person['id'],))
    assert edit.list_audit(users['owner'], saved['id'])['items'][0]['actor_username'] == name
    db.delete_report(users['owner'], saved['id'], 2)
    with db._connection() as connection:
        assert connection.execute('SELECT COUNT(*) FROM advisor_edit_grants').fetchone()[0] == 0
        assert connection.execute('SELECT COUNT(*) FROM advisor_edits').fetchone()[0] == 0


def test_history_capacity_fails_without_partial_audit(service):
    db, edit, users, saved, _, baseline = service
    value = copy.deepcopy(saved['record'])
    entry = value['advisor']['history'][0]
    value['advisor']['history'] = [{**entry, 'id': 'history-' + str(i)} for i in range(200)]
    db.update_report(users['owner'], saved['id'], value, 1)
    created = grant(service, revision=2)
    assert_error(lambda: edit.apply(users['teacher'], created['id'], 2, {'summary': '超容量'}), 413)
    assert edit.list_audit(users['owner'], saved['id']) == {'items': []}
    assert db.get_report(users['owner'], saved['id'])['revision'] == 2


def test_serialized_record_size_limit_is_413_without_uncertain_storage_error_or_partial_write(service):
    from backend.bic_api.models import ArchiveRecord, MAX_RECORD_CHARS, _json_utf16_length
    db, edit, users, saved, _, _ = service
    value = copy.deepcopy(saved['record'])
    entry = {**value['advisor']['history'][0], 'before': '\0' * 1000, 'after': 'x' * 3900}
    value['advisor']['history'] = [{**entry, 'id': 'history-' + str(i)} for i in range(198)]
    ArchiveRecord.model_validate(value)
    assert 1_980_000 < _json_utf16_length(value) < MAX_RECORD_CHARS
    original = db.update_report(users['owner'], saved['id'], value, 1)
    created = grant(service, revision=2)
    # Controls expand sixfold in JSON, and the new section also appears in
    # history. There is still room for history entry199; size is the boundary.
    assert_error(lambda: edit.apply(users['teacher'], created['id'], 2, {'summary': '\0' * 4000}), 413, 'LIMIT')
    assert db.get_report(users['owner'], saved['id']) == original
    assert edit.list_audit(users['owner'], saved['id']) == {'items': []}
    assert edit.read(users['teacher'], created['id'])['grant']['status'] == 'active'


def test_safe_revision_limit_and_account_units_fail_without_partial_audit(service, monkeypatch):
    db, edit, users, saved, _, _ = service
    with db._transaction() as connection:
        connection.execute('UPDATE reports SET revision=? WHERE id=?', (9007199254740991, saved['id']))
    created = grant(service, revision=9007199254740991)
    assert_error(lambda: edit.apply(users['teacher'], created['id'], 9007199254740991, {'plan': '超修订'}), 413)
    assert edit.list_audit(users['owner'], saved['id'])['items'] == []
    with db._transaction() as connection:
        connection.execute('UPDATE reports SET revision=1 WHERE id=?', (saved['id'],))
        used = connection.execute('SELECT SUM(utf16_units) FROM reports').fetchone()[0]
    created = grant(service)
    module = importlib.import_module('backend.bic_api.db')
    monkeypatch.setattr(module, '_MAX_UTF16_UNITS', used + 1)
    assert_error(lambda: edit.apply(users['teacher'], created['id'], 1, {'plan': '超容量'}), 413)
    assert db.get_report(users['owner'], saved['id']) == saved
    assert edit.list_audit(users['owner'], saved['id'])['items'] == []


def test_owner_and_recipient_participation_limits_include_history_across_reports(service):
    db, edit, users, saved, _, baseline = service
    first = grant(service)
    edit.revoke(users['owner'], saved['id'], first['id'])
    for index in range(99):
        value = db.create_report(users['owner'], record('quota-' + str(index)))
        item = edit.create_grant(users['owner'], value['id'], 1, 'teacher', 24, baseline)
        edit.revoke(users['owner'], value['id'], item['id'])
    assert_error(lambda: grant(service, recipient='other.teacher'), 413, 'LIMIT')
    other_owner = db.create_user('other.owner', 'hash', 'student')['id']
    other_report = db.create_report(other_owner, record('other-owner'))
    assert_error(lambda: edit.create_grant(other_owner, other_report['id'], 1, 'teacher', 24, baseline), 413, 'LIMIT')
    assert edit.list_for_user(users['teacher'])['items'] == []


@pytest.mark.parametrize('change', ['disable', 'role', 'revoke', 'expire', 'revision'])
def test_queued_writer_rechecks_authority_after_acquiring_transaction(service, monkeypatch, change):
    db, edit, users, saved, clock, _ = service
    created = grant(service)
    original = db._transaction
    @contextmanager
    def intervene():
        with original() as connection:
            if change == 'disable':
                connection.execute('UPDATE users SET disabled=1 WHERE id=?', (users['owner'],))
            elif change == 'role':
                connection.execute("UPDATE users SET role='student' WHERE id=?", (users['teacher'],))
            elif change == 'revoke':
                connection.execute('UPDATE advisor_edit_grants SET revoked_at=? WHERE id=?', (clock.value, created['id']))
            elif change == 'revision':
                connection.execute('UPDATE reports SET revision=2 WHERE id=?', (saved['id'],))
            else:
                clock.value = created['expires_at']
        with original() as connection:
            yield connection
    monkeypatch.setattr(db, '_transaction', intervene)
    assert_error(lambda: edit.apply(users['teacher'], created['id'], 1, {'plan': '不应写入'}), 404)
    assert edit.list_audit(users['owner'], saved['id'])['items'] == [] if change != 'disable' else True
    assert db.get_report(users['owner'], saved['id'])['record'] == saved['record']


def test_grant_without_prior_advisor_can_write_all_four_sections_without_changing_state(service):
    db, edit, users, saved, _, baseline = service
    value = copy.deepcopy(saved['record'])
    value.pop('advisor')
    saved = db.update_report(users['owner'], saved['id'], value, 1)
    created = edit.create_grant(users['owner'], saved['id'], 2, 'teacher', 24, baseline)
    changes = {key: '新的' + key for key in SECTIONS}
    result = edit.apply(users['teacher'], created['id'], 2, changes)
    assert result['changed_sections'] == list(SECTIONS)
    assert result['report']['record']['state'] == value['state']
    assert result['report']['record']['advisor']['sections'] == changes
    assert len(result['report']['record']['advisor']['history']) == 4


def test_corrupt_saved_record_is_hidden_and_never_partially_applied(service):
    db, edit, users, saved, _, _ = service
    created = grant(service)
    with db._transaction() as connection:
        connection.execute('UPDATE reports SET record_json=? WHERE id=?', ('{"private":"不能回显"}', saved['id']))
    for operation in [lambda: edit.read(users['teacher'], created['id']),
                      lambda: edit.apply(users['teacher'], created['id'], 1, {'summary': '改变'})]:
        error = assert_error(operation, 503)
        assert '不能回显' not in str(error)
    assert edit.list_audit(users['owner'], saved['id'])['items'] == []


def test_metadata_and_revoke_do_not_select_private_payload_or_baseline(service, monkeypatch):
    db, edit, users, saved, _, _ = service
    created = grant(service)
    original = db._connection
    @contextmanager
    def bounded():
        with original() as connection:
            def deny(action, table, column, *unused):
                return sqlite3.SQLITE_DENY if action == sqlite3.SQLITE_READ and (
                    table == 'reports' and column == 'record_json'
                    or table == 'advisor_edit_grants' and column == 'baseline_json') else sqlite3.SQLITE_OK
            connection.set_authorizer(deny)
            yield connection
    monkeypatch.setattr(db, '_connection', bounded)
    assert len(edit.list_for_report(users['owner'], saved['id'])['items']) == 1
    assert len(edit.list_for_user(users['teacher'])['items']) == 1
    edit.revoke(users['owner'], saved['id'], created['id'])


def test_corrupt_record_and_baseline_fail_closed_without_private_echo(service):
    db, edit, users, saved, _, _ = service
    created = grant(service)
    with db._transaction() as connection:
        connection.execute('UPDATE advisor_edit_grants SET baseline_json=? WHERE id=?', ('{"secret":"私密损坏"}', created['id']))
    for operation in [lambda: edit.read(users['teacher'], created['id']),
                      lambda: edit.apply(users['teacher'], created['id'], 1, {'plan': '变更'})]:
        error = assert_error(operation, 503)
        assert '私密' not in str(error)
    assert db.get_report(users['owner'], saved['id']) == saved


def test_audit_payload_and_enabled_owner_use_one_snapshot_when_account_is_disabled_between_reads(service, monkeypatch):
    db, edit, users, saved, _, _ = service
    created = grant(service)
    edit.apply(users['teacher'], created['id'], 1, {'summary': '服务端私密修改'})
    original = db._connection
    changed = False
    @contextmanager
    def crossing():
        with original() as connection:
            def intervene(action, table, column, *unused):
                nonlocal changed
                if not changed and action == sqlite3.SQLITE_READ and table == 'reports' and column == 'id':
                    changed = True
                    with sqlite3.connect(db.path) as writer:
                        writer.execute('UPDATE users SET disabled=1 WHERE id=?', (users['owner'],))
                return sqlite3.SQLITE_OK
            connection.set_authorizer(intervene)
            yield connection
    monkeypatch.setattr(db, '_connection', crossing)
    assert_error(lambda: edit.list_audit(users['owner'], saved['id']), 404)
    assert changed
