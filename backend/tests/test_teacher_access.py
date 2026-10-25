"""Explicit advisor grants do not widen owner or family permissions."""

from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
import copy
import importlib
import json
import sqlite3

import pytest

from backend.bic_api.db import Database, StorageError
from backend.tests.test_models import record as baseline_record, history_entry
from backend.tests.test_sharing import Clock, content


def record(key='one'):
    value = baseline_record()
    value['id'] = 'archive-' + key
    value['reportMeta']['batchId'] = 'AP-' + key
    value['state']['academic']['answers'] = {'en1': 1}
    entry = history_entry()
    entry['reportId'] = value['reportMeta']['batchId']
    entry['author'] = '私密顾问'
    value['advisor'] = {'sections': {'plan': '私密建议'}, 'history': [entry]}
    return value


@pytest.fixture
def service(tmp_path):
    try:
        cls = importlib.import_module('backend.bic_api.teacher_access').TeacherAccessService
    except ModuleNotFoundError:
        pytest.fail('The separate advisor read-only access service must exist.')
    clock = Clock()
    db = Database(tmp_path / 'private.sqlite3', clock=clock)
    users = {name: db.create_user(name, 'test-only-non-login-hash', role)['id'] for name, role in [
        ('owner', 'student'), ('teacher', 'advisor'), ('other.teacher', 'advisor'), ('other.student', 'student')]}
    saved = db.create_report(users['owner'], record())
    return db, cls(db, clock=clock), users, saved, clock


def grant(service, recipient='teacher', revision=1, report_id=None, ttl=24):
    _, access, users, saved, _ = service
    return access.create_grant(users['owner'], report_id or saved['id'], revision, recipient, ttl)


def assert_error(operation, status, code=None):
    with pytest.raises(StorageError) as error:
        operation()
    assert error.value.status_code == status
    if code is not None:
        assert error.value.code == code
    return error.value


def test_grant_exact_metadata_and_revision_bound_complete_record_are_read_only(service):
    db, access, users, saved, _ = service
    created = grant(service, 'TEACHER')
    assert set(created) == {'id', 'report_id', 'report_revision', 'report_name', 'report_ref', 'owner_username',
                            'recipient_username', 'scope', 'created_at', 'expires_at', 'revoked_at', 'status'}
    assert created['owner_username'] == 'owner' and created['recipient_username'] == 'teacher'
    assert created['scope'] == 'full_report_read_only' and created['status'] == 'active'
    assert created['report_name'] == saved['record']['state']['info']['name']
    assert created['report_ref'] == saved['record']['reportMeta']['batchId']
    assert access.read(users['teacher'], created['id']) == {'grant': created, 'report': saved}
    assert access.list_for_report(users['owner'], saved['id']) == {'items': [created]}
    assert access.list_for_user(users['teacher']) == {'items': [created]}
    assert access.list_for_user(users['other.teacher']) == {'items': []}
    assert db.get_report(users['owner'], saved['id']) == saved
    assert db.get_report(users['teacher'], saved['id']) is None
    assert db.list_reports(users['teacher'])['items'] == []
    assert_error(lambda: db.update_report(users['teacher'], saved['id'], saved['record'], 1), 404)
    assert_error(lambda: db.delete_report(users['teacher'], saved['id'], 1), 404)
    assert db.get_report(users['owner'], saved['id']) == saved


@pytest.mark.parametrize('ttl', [24, 72, 168])
def test_supported_expiry_is_fixed_from_server_clock(service, ttl):
    _, access, users, _, clock = service
    created = grant(service, ttl=ttl)
    assert created['expires_at'] == clock.value + ttl * 3600
    clock.value = created['expires_at'] - 1
    assert access.read(users['teacher'], created['id'])['grant']['status'] == 'active'
    clock.value += 1
    assert_error(lambda: access.read(users['teacher'], created['id']), 404)
    assert access.list_for_user(users['teacher'])['items'] == []
    assert access.list_for_report(users['owner'], created['report_id'])['items'][0]['status'] == 'expired'


@pytest.mark.parametrize('recipient,status', [('missing', 404), ('other.student', 404), ('owner', 422), ('ab', 422), ('中用户', 422)])
def test_only_another_existing_enabled_advisor_can_be_recipient(service, recipient, status):
    assert_error(lambda: grant(service, recipient), status)


@pytest.mark.parametrize('ttl', [True, False, 0, 1, 23, 25, '24', 24.0, None])
def test_lifetime_refuses_coercion_and_unsupported_values(service, ttl):
    assert_error(lambda: grant(service, ttl=ttl), 422, 'VALIDATION')


@pytest.mark.parametrize('revision', [True, False, 0, -1, '1', 1.0, None, 9007199254740992])
def test_revision_must_be_a_positive_safe_integer(service, revision):
    assert_error(lambda: grant(service, revision=revision), 422, 'VALIDATION')


def test_owner_and_recipient_paths_do_not_leak_other_accounts_or_full_records(service):
    db, access, users, saved, _ = service
    created = grant(service)
    for actor in ['owner', 'other.teacher', 'other.student', 'missing']:
        actor_id = users.get(actor, actor)
        assert_error(lambda: access.read(actor_id, created['id']), 404)
    for actor in ['teacher', 'other.teacher', 'other.student']:
        assert_error(lambda: access.list_for_report(users[actor], saved['id']), 404)
        assert_error(lambda: access.revoke(users[actor], saved['id'], created['id']), 404)
        assert_error(lambda: access.create_grant(users[actor], saved['id'], 1, 'other.teacher', 24), 404)
    for actor in ['owner', 'other.student', 'missing']:
        assert_error(lambda: access.list_for_user(users.get(actor, actor)), 404)
    for operation in [lambda: access.read(users['teacher'], 'missing'),
                      lambda: access.list_for_report(users['owner'], 'missing'),
                      lambda: access.revoke(users['owner'], saved['id'], 'missing')]:
        assert_error(operation, 404)
    serialized = json.dumps(access.list_for_user(users['teacher']))
    for forbidden in ['password_hash', 'record_json', 'answers', '私密顾问', '私密建议', 'csrf_token']:
        assert forbidden not in serialized
    assert db.get_report(users['owner'], saved['id']) == saved


def test_owner_update_closes_previous_revision_until_explicit_regrant(service):
    db, access, users, saved, _ = service
    created = grant(service)
    changed = copy.deepcopy(saved['record'])
    changed['state']['info']['name'] = '后来新增的私密内容'
    latest = db.update_report(users['owner'], saved['id'], changed, 1)
    assert_error(lambda: access.read(users['teacher'], created['id']), 404)
    assert access.list_for_user(users['teacher']) == {'items': []}
    assert access.list_for_report(users['owner'], saved['id'])['items'][0]['status'] == 'source_changed'
    assert_error(lambda: grant(service), 409, 'REVISION')
    replacement = grant(service, revision=2)
    assert access.read(users['teacher'], replacement['id'])['report'] == latest
    access.revoke(users['owner'], saved['id'], created['id'])
    statuses = {item['id']: item['status'] for item in access.list_for_report(users['owner'], saved['id'])['items']}
    assert statuses == {created['id']: 'revoked', replacement['id']: 'active'}


@pytest.mark.parametrize('disabled', ['owner', 'teacher'])
def test_disabled_participant_closes_new_reads_and_writes(service, disabled):
    db, access, users, saved, _ = service
    created = grant(service)
    db.disable_user(disabled)
    assert_error(lambda: access.read(users['teacher'], created['id']), 404)
    if disabled == 'teacher':
        assert_error(lambda: access.list_for_user(users['teacher']), 404)
        assert access.list_for_report(users['owner'], saved['id'])['items'][0]['status'] == 'unavailable'
        assert_error(lambda: grant(service), 404)
    else:
        assert access.list_for_user(users['teacher']) == {'items': []}
        assert_error(lambda: access.list_for_report(users['owner'], saved['id']), 404)
        assert_error(lambda: access.revoke(users['owner'], saved['id'], created['id']), 404)


def test_recipient_role_is_rechecked_on_every_read_and_list(service):
    db, access, users, saved, _ = service
    created = grant(service)
    with sqlite3.connect(db.path) as connection:
        connection.execute("UPDATE users SET role='student' WHERE id=?", (users['teacher'],))
    assert_error(lambda: access.read(users['teacher'], created['id']), 404)
    assert_error(lambda: access.list_for_user(users['teacher']), 404)
    assert access.list_for_report(users['owner'], saved['id'])['items'][0]['status'] == 'unavailable'
    assert_error(lambda: grant(service), 404)


def test_revoke_is_owner_scoped_idempotent_and_status_precedence_is_stable(service):
    db, access, users, saved, clock = service
    created = grant(service)
    access.revoke(users['owner'], saved['id'], created['id'])
    first = access.list_for_report(users['owner'], saved['id'])['items'][0]
    clock.value += 10
    access.revoke(users['owner'], saved['id'], created['id'])
    assert access.list_for_report(users['owner'], saved['id'])['items'][0] == first
    db.disable_user('teacher'); clock.value += 168 * 3600
    db.update_report(users['owner'], saved['id'], saved['record'], 1)
    assert access.list_for_report(users['owner'], saved['id'])['items'][0]['status'] == 'revoked'
    assert_error(lambda: access.read(users['teacher'], created['id']), 404)
    alternate = db.create_report(users['owner'], record('other'))
    assert_error(lambda: access.revoke(users['owner'], alternate['id'], created['id']), 404)


def test_report_delete_cascades_teacher_grants_without_touching_other_reports(service):
    db, access, users, saved, _ = service
    created = grant(service)
    other = db.create_report(users['owner'], record('other'))
    db.delete_report(users['owner'], saved['id'], 1)
    assert_error(lambda: access.read(users['teacher'], created['id']), 404)
    assert access.list_for_user(users['teacher']) == {'items': []}
    assert db.get_report(users['owner'], other['id']) == other
    with sqlite3.connect(db.path) as connection:
        assert connection.execute('SELECT COUNT(*) FROM teacher_grants').fetchone()[0] == 0


def test_active_duplicate_is_atomic_but_closed_history_can_be_regranted(service):
    db, access, users, saved, clock = service
    def attempt(_):
        try:
            return grant(service)
        except StorageError as error:
            return error.status_code, error.code
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(attempt, range(4)))
    assert sum(isinstance(item, dict) for item in results) == 1
    assert results.count((409, 'DUPLICATE')) == 3
    first = next(item for item in results if isinstance(item, dict))
    access.revoke(users['owner'], saved['id'], first['id'])
    second = grant(service)
    clock.value = second['expires_at']
    third = grant(service)
    assert len({first['id'], second['id'], third['id']}) == 3


def test_grant_lifetime_and_duplicate_check_use_clock_after_transaction_acquisition(service, monkeypatch):
    db, access, users, _, clock = service
    first = grant(service)
    clock.value = first['expires_at'] - 1
    original = db._transaction
    @contextmanager
    def after_wait():
        with original() as connection:
            clock.value += 2
            yield connection
    monkeypatch.setattr(db, '_transaction', after_wait)
    fresh = grant(service)
    assert fresh['created_at'] == clock.value
    assert fresh['expires_at'] == clock.value + 24 * 3600
    assert fresh['status'] == 'active'
    assert access.read(users['teacher'], fresh['id'])['grant'] == fresh


def test_report_history_limit_is_atomic_and_keeps_closed_grants(service):
    db, access, users, saved, _ = service
    for _ in range(9):
        created = grant(service); access.revoke(users['owner'], saved['id'], created['id'])
    for index in range(4):
        db.create_user('quota.' + str(index), 'test-only-non-login-hash', 'advisor')
    def attempt(index):
        try:
            return grant(service, 'quota.' + str(index))['id']
        except StorageError as error:
            return error.status_code
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(attempt, range(4)))
    assert sum(isinstance(item, str) for item in results) == 1
    assert results.count(413) == 3
    assert len(access.list_for_report(users['owner'], saved['id'])['items']) == 10


def test_account_participation_quota_counts_both_created_and_received_history(service):
    db, access, users, _, _ = service
    for number in range(5):
        incoming = db.create_report(users['owner'], record('incoming-' + str(number)))
        outgoing = db.create_report(users['teacher'], record('outgoing-' + str(number)))
        for _ in range(10):
            first = access.create_grant(users['owner'], incoming['id'], 1, 'teacher', 24)
            access.revoke(users['owner'], incoming['id'], first['id'])
            second = access.create_grant(users['teacher'], outgoing['id'], 1, 'other.teacher', 24)
            access.revoke(users['teacher'], outgoing['id'], second['id'])
    assert_error(lambda: grant(service), 413, 'LIMIT')
    fresh = db.create_report(users['teacher'], record('cannot-add'))
    assert_error(lambda: access.create_grant(users['teacher'], fresh['id'], 1, 'other.teacher', 24), 413, 'LIMIT')
    assert access.list_for_user(users['teacher']) == {'items': []}
    with sqlite3.connect(db.path) as connection:
        assert connection.execute('SELECT COUNT(*) FROM teacher_grants').fetchone()[0] == 100


def test_single_join_read_does_not_recheck_grant_then_fetch_a_newer_report(service, monkeypatch):
    db, access, users, saved, _ = service
    created = grant(service)
    original = db._connection
    statements = []
    @contextmanager
    def tracked():
        with original() as connection:
            connection.set_trace_callback(statements.append)
            yield connection
    monkeypatch.setattr(db, '_connection', tracked)
    monkeypatch.setattr(db, 'get_report', lambda *args: pytest.fail('Do not fetch a report after authorizing a different snapshot'))
    assert access.read(users['teacher'], created['id'])['report'] == saved
    selects = [sql for sql in statements if sql.lstrip().upper().startswith('SELECT')]
    assert len(selects) == 1
    for required in ['teacher_grants', 'users', 'reports']:
        assert required in selects[0]


def test_lists_and_revocation_do_not_read_original_answer_payloads(service, monkeypatch):
    db, access, users, saved, _ = service
    created = grant(service)
    original = db._connection
    @contextmanager
    def deny_original_payload():
        with original() as connection:
            connection.set_authorizer(lambda action, table, column, *rest: sqlite3.SQLITE_DENY
                                      if action == sqlite3.SQLITE_READ and table == 'reports' and column == 'record_json'
                                      else sqlite3.SQLITE_OK)
            yield connection
    monkeypatch.setattr(db, '_connection', deny_original_payload)
    assert access.list_for_report(users['owner'], saved['id']) == {'items': [created]}
    assert access.list_for_user(users['teacher']) == {'items': [created]}
    access.revoke(users['owner'], saved['id'], created['id'])
    assert access.list_for_user(users['teacher']) == {'items': []}


@pytest.mark.parametrize('change', ['json', 'extra', 'name', 'reference'])
def test_corrupted_source_or_metadata_fails_without_echoing_private_material(service, change):
    db, access, users, saved, _ = service
    created = grant(service)
    with sqlite3.connect(db.path) as connection:
        if change == 'json':
            connection.execute('UPDATE reports SET record_json=? WHERE id=?', ('private-broken-raw-record', saved['id']))
        elif change == 'extra':
            altered = copy.deepcopy(saved['record']); altered['private-extra'] = 'secret-private-material'
            connection.execute('UPDATE reports SET record_json=? WHERE id=?', (json.dumps(altered), saved['id']))
        else:
            column = 'name' if change == 'name' else 'report_ref'
            connection.execute(f'UPDATE reports SET {column}=? WHERE id=?', ('secret-private-material', saved['id']))
    error = assert_error(lambda: access.read(users['teacher'], created['id']), 503)
    assert 'secret-private' not in str(error) and 'private-broken' not in str(error)
    assert_error(lambda: grant(service, 'other.teacher'), 503)


def test_corrupted_grant_owner_cannot_read_another_owners_report(service):
    db, access, users, saved, _ = service
    created = grant(service)
    foreign = db.create_report(users['other.student'], record('foreign'))
    with sqlite3.connect(db.path) as connection:
        connection.execute('UPDATE teacher_grants SET report_id=? WHERE id=?', (foreign['id'], created['id']))
    assert_error(lambda: access.read(users['teacher'], created['id']), 404)
    assert access.list_for_user(users['teacher'])['items'] == []


def test_family_invitations_and_public_tokens_never_authorize_teacher_original_records(service):
    from backend.bic_api.comments import CommentService
    from backend.bic_api.sharing import ShareService
    db, access, users, saved, clock = service
    family = CommentService(db, clock)
    public = ShareService(db, clock)
    invited = family.create_grant(users['owner'], saved['id'], 1, 'other.student', 24, content())
    shared = public.create(users['owner'], saved['id'], 1, 24, content())
    created = grant(service)
    for actor in [users['other.student'], invited['id'], shared['id'], shared['token']]:
        assert_error(lambda: access.read(actor, created['id']), 404)
    access.revoke(users['owner'], saved['id'], created['id'])
    assert family.thread(users['other.student'], invited['id'])['can_comment']
    assert public.read(shared['token'], 'local')['report']['name'] == saved['record']['state']['info']['name']
