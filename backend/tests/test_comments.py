"""Authenticated per-report invitations and append-only private comment threads."""

from concurrent.futures import ThreadPoolExecutor
import copy
import importlib
import json
import sqlite3
import uuid

import pytest

from backend.bic_api.db import Database, StorageError
from backend.bic_api.security import AuthError
from backend.tests.test_sharing import Clock, content, legacy_database, record


LEGACY_SHARE_SCHEMA = [
    "CREATE TABLE shares ( id TEXT PRIMARY KEY NOT NULL, owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, report_id TEXT NOT NULL REFERENCES reports(id) ON DELETE CASCADE, report_revision INTEGER NOT NULL CHECK (report_revision > 0), token_hash TEXT NOT NULL UNIQUE, snapshot_json TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL CHECK (expires_at > created_at), revoked_at INTEGER )",
    "CREATE INDEX shares_owner_report_idx ON shares(owner_id, report_id, created_at DESC, id)",
    "CREATE INDEX shares_report_idx ON shares(report_id)",
]


def legacy_v2(path):
    original = legacy_database(path)
    snapshot = json.dumps({'frozen': 'verbatim legacy snapshot'}, separators=(',', ':'))
    with sqlite3.connect(path) as connection:
        for sql in LEGACY_SHARE_SCHEMA:
            connection.execute(sql)
        connection.execute('PRAGMA user_version=2')
        connection.execute('INSERT INTO shares VALUES (?,?,?,?,?,?,?,?,?)',
                           ('old-share', 'legacy-user', 'legacy-report', 7, 'c' * 64, snapshot,
                            1_800_000_000, 1_800_086_400, None))
    return original, snapshot


@pytest.fixture
def service(tmp_path):
    try:
        CommentService = importlib.import_module('backend.bic_api.comments').CommentService
    except ModuleNotFoundError:
        pytest.fail('Authenticated invitation/comment service must exist.')
    clock = Clock()
    db = Database(tmp_path / 'private.sqlite3', clock=clock)
    users = {name: db.create_user(name, 'test-only-non-login-hash', role)['id']
             for name, role in [('owner', 'advisor'), ('parent.one', 'student'), ('outsider', 'student')]}
    saved = db.create_report(users['owner'], record())
    return db, CommentService(db, clock=clock), users, saved, clock


def grant(service, recipient='parent.one', report_id=None):
    _, comments, users, saved, _ = service
    return comments.create_grant(users['owner'], report_id or saved['id'], 1, recipient, 24, content())


def test_invitation_binds_existing_account_and_immutable_allowlisted_snapshot(service):
    db, comments, users, saved, _ = service
    created = grant(service, 'PARENT.ONE')
    assert created['recipient_username'] == 'parent.one'
    assert created['report_name'] == '只读测试同学'
    assert created['report_ref'] == 'AP-one'
    assert set(created) == {'id', 'report_id', 'report_revision', 'report_name', 'report_ref',
                           'recipient_username', 'created_at', 'expires_at', 'revoked_at', 'status'}
    thread = comments.thread(users['parent.one'], created['id'])
    assert thread['participant'] == 'recipient' and thread['can_comment'] is True
    assert thread['snapshot']['report']['revision'] == 1
    serialized = json.dumps(thread)
    for private in ['private-raw-answer', 'private-audit-author', users['owner'], users['parent.one'], 'password_hash']:
        assert private not in serialized
    changed = record()
    changed['state']['info']['name'] = '后来更新的学生'
    db.update_report(users['owner'], saved['id'], changed, 1)
    assert comments.thread(users['parent.one'], created['id'])['snapshot'] == thread['snapshot']
    assert comments.list_for_user(users['parent.one'])['items'] == [created]
    assert comments.list_for_user(users['outsider']) == {'items': []}


@pytest.mark.parametrize('recipient,status', [('missing', 404), ('owner', 422), ('ab', 422), ('中用户', 422)])
def test_invalid_or_self_recipient_creates_no_grant(service, recipient, status):
    _, comments, users, saved, _ = service
    with pytest.raises(StorageError) as error:
        grant(service, recipient)
    assert error.value.status_code == status
    assert comments.list_for_report(users['owner'], saved['id']) == {'items': []}


def test_creation_checks_owner_revision_disabled_recipient_and_ttl(service):
    db, comments, users, saved, _ = service
    for actor, revision, ttl, status in [(users['outsider'], 1, 24, 404),
                                        (users['owner'], 2, 24, 409), (users['owner'], True, 24, 409),
                                        (users['owner'], 1, 1, 422), (users['owner'], 1, True, 422)]:
        with pytest.raises(StorageError) as error:
            comments.create_grant(actor, saved['id'], revision, 'parent.one', ttl, content())
        assert error.value.status_code == status
    db.disable_user('parent.one')
    with pytest.raises(StorageError) as error:
        grant(service)
    assert error.value.status_code == 404


def test_owner_and_recipient_append_to_private_thread_without_mutating_report(service):
    db, comments, users, saved, _ = service
    created = grant(service)
    first = comments.add_comment(users['parent.one'], created['id'], '<img src=x> 是纯文本批注', str(uuid.uuid4()))
    second = comments.add_comment(users['owner'], created['id'], '已收到，我们会继续沟通。', str(uuid.uuid4()))
    assert first['author'] == 'recipient' and second['author'] == 'owner'
    assert set(first) == {'id', 'author', 'body', 'created_at', 'client_request_id'}
    assert comments.thread(users['owner'], created['id'])['comments'] == [first, second]
    assert db.get_report(users['owner'], saved['id']) == saved
    assert db.get_report(users['parent.one'], saved['id']) is None
    with pytest.raises(StorageError) as stranger:
        comments.thread(users['outsider'], created['id'])
    assert stranger.value.status_code == 404
    with pytest.raises(StorageError):
        comments.add_comment(users['outsider'], created['id'], 'not allowed', str(uuid.uuid4()))
    with pytest.raises(StorageError):
        comments.revoke(users['parent.one'], saved['id'], created['id'])


def test_idempotent_same_body_replay_returns_original_but_conflicting_body_fails(service):
    _, comments, users, _, _ = service
    created = grant(service)
    nonce = str(uuid.uuid4())
    original = comments.add_comment(users['parent.one'], created['id'], '请问下一步怎么安排？', nonce)
    for _ in range(15):
        assert comments.add_comment(users['parent.one'], created['id'], '请问下一步怎么安排？', nonce.upper()) == original
    with pytest.raises(StorageError) as conflict:
        comments.add_comment(users['parent.one'], created['id'], '不同内容', nonce)
    assert conflict.value.status_code == 409
    assert len(comments.thread(users['owner'], created['id'])['comments']) == 1


def test_idempotency_conflicts_are_stable_even_when_new_writes_are_rate_limited(service):
    _, comments, users, _, _ = service
    created = grant(service)
    original_nonce = str(uuid.uuid4())
    original = comments.add_comment(users['parent.one'], created['id'], '原批注', original_nonce)
    for _ in range(9):
        comments.add_comment(users['parent.one'], created['id'], '其它批注', str(uuid.uuid4()))
    with pytest.raises(StorageError) as conflict:
        comments.add_comment(users['parent.one'], created['id'], '不能改写原文', original_nonce)
    assert conflict.value.status_code == 409
    assert comments.add_comment(users['parent.one'], created['id'], '原批注', original_nonce) == original
    with pytest.raises(AuthError) as limited:
        comments.add_comment(users['parent.one'], created['id'], '新的写入', str(uuid.uuid4()))
    assert limited.value.status_code == 429


@pytest.mark.parametrize('body,nonce', [('', None), (' ', str(uuid.uuid4())), ('x' * 1001, str(uuid.uuid4())),
                                     ('😀' * 501, str(uuid.uuid4())), ('private-\ud800', str(uuid.uuid4())),
                                     ('valid comment', 'not-a-uuid'), ('valid comment', True)])
def test_comment_validation_rejects_invalid_input_without_writing(service, body, nonce):
    _, comments, users, _, _ = service
    created = grant(service)
    with pytest.raises(StorageError) as error:
        comments.add_comment(users['parent.one'], created['id'], body, nonce)
    assert error.value.status_code == 422
    assert comments.thread(users['owner'], created['id'])['comments'] == []


def test_revoke_or_expiry_blocks_recipient_but_owner_keeps_readable_history(service):
    _, comments, users, _, clock = service
    created = grant(service)
    nonce = str(uuid.uuid4())
    comments.add_comment(users['parent.one'], created['id'], '保留历史', nonce)
    comments.revoke(users['owner'], created['report_id'], created['id'])
    comments.revoke(users['owner'], created['report_id'], created['id'])
    for operation in [lambda: comments.thread(users['parent.one'], created['id']),
                      lambda: comments.add_comment(users['parent.one'], created['id'], '保留历史', nonce),
                      lambda: comments.add_comment(users['owner'], created['id'], '不能继续', str(uuid.uuid4()))]:
        with pytest.raises(StorageError) as error:
            operation()
        assert error.value.status_code == 404
    assert comments.list_for_user(users['parent.one'])['items'] == []
    old = comments.thread(users['owner'], created['id'])
    assert old['can_comment'] is False and old['comments'][0]['body'] == '保留历史'
    expiring = grant(service)
    clock.value = expiring['expires_at']
    with pytest.raises(StorageError):
        comments.thread(users['parent.one'], expiring['id'])
    assert comments.thread(users['owner'], expiring['id'])['grant']['status'] == 'expired'


@pytest.mark.parametrize('disabled', ['owner', 'parent.one'])
def test_disabling_either_participant_stops_recipient_and_all_writes(service, disabled):
    db, comments, users, _, _ = service
    created = grant(service)
    db.disable_user(disabled)
    with pytest.raises(StorageError):
        comments.thread(users['parent.one'], created['id'])
    for actor in ['owner', 'parent.one']:
        with pytest.raises(StorageError):
            comments.add_comment(users[actor], created['id'], '不允许', str(uuid.uuid4()))
    if disabled == 'parent.one':
        assert comments.thread(users['owner'], created['id'])['grant']['status'] == 'unavailable'


def test_report_deletion_cascades_grants_and_comments(service):
    db, comments, users, saved, _ = service
    created = grant(service)
    comments.add_comment(users['parent.one'], created['id'], '测试', str(uuid.uuid4()))
    db.delete_report(users['owner'], saved['id'], 1)
    with pytest.raises(StorageError):
        comments.thread(users['owner'], created['id'])
    with sqlite3.connect(db.path) as connection:
        assert connection.execute('SELECT COUNT(*) FROM parent_grants').fetchone()[0] == 0
        assert connection.execute('SELECT COUNT(*) FROM parent_comments').fetchone()[0] == 0


def test_grant_quota_includes_revoked_history_and_is_atomic(service):
    _, comments, users, saved, _ = service
    for _ in range(9):
        created = grant(service)
        comments.revoke(users['owner'], saved['id'], created['id'])
    def attempt(_):
        try: return grant(service)['id']
        except StorageError as error: return error.status_code
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(attempt, range(4)))
    assert sum(isinstance(item, str) for item in results) == 1
    assert results.count(413) == 3
    assert len(comments.list_for_report(users['owner'], saved['id'])['items']) == 10


def test_comment_quota_and_nonce_uniqueness_are_atomic(service):
    _, comments, users, _, clock = service
    created = grant(service)
    for _ in range(99):
        comments.add_comment(users['owner'], created['id'], '历史批注', str(uuid.uuid4()))
        clock.value += 61
    def attempt(_):
        try: return comments.add_comment(users['owner'], created['id'], '最后一条', str(uuid.uuid4()))['id']
        except StorageError as error: return error.status_code
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(attempt, range(4)))
    assert sum(isinstance(item, str) for item in results) == 1
    assert results.count(413) == 3
    full = comments.thread(users['owner'], created['id'])
    assert len(full['comments']) == 100
    assert full['can_comment'] is False


def test_comment_new_attempt_rate_limit_has_retry_after_and_resets(service):
    _, comments, users, _, clock = service
    created = grant(service)
    for _ in range(10):
        comments.add_comment(users['parent.one'], created['id'], '批注', str(uuid.uuid4()))
    with pytest.raises(AuthError) as error:
        comments.add_comment(users['parent.one'], created['id'], '稍后', str(uuid.uuid4()))
    assert error.value.status_code == 429 and error.value.retry_after > 0
    clock.value += 60
    comments.add_comment(users['parent.one'], created['id'], '现在可以', str(uuid.uuid4()))


def test_simultaneous_identical_requests_append_only_once(service):
    _, comments, users, _, _ = service
    created = grant(service)
    nonce = str(uuid.uuid4())
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(lambda _: comments.add_comment(users['parent.one'], created['id'], '只追加一次', nonce), range(4)))
    assert len({item['id'] for item in results}) == 1
    assert len(comments.thread(users['owner'], created['id'])['comments']) == 1
    assert len(comments._attempts[users['parent.one']]) == 1


def test_invitations_and_public_read_only_shares_have_separate_lifetimes_and_permissions(service):
    from backend.bic_api.sharing import ShareService
    db, comments, users, saved, clock = service
    readonly = ShareService(db, clock)
    shared = readonly.create(users['owner'], saved['id'], 1, 24, content())
    invited = grant(service)
    readonly.revoke(users['owner'], saved['id'], shared['id'])
    assert comments.thread(users['parent.one'], invited['id'])['can_comment'] is True
    for actor in [shared['token'], shared['id']]:
        with pytest.raises(StorageError) as error:
            comments.add_comment(actor, invited['id'], '只读令牌不能写', str(uuid.uuid4()))
        assert error.value.status_code == 404
    new_public = readonly.create(users['owner'], saved['id'], 1, 24, content())
    comments.revoke(users['owner'], saved['id'], invited['id'])
    assert readonly.read(new_public['token'], 'local')['report']['name'] == '只读测试同学'


def test_thread_and_recipient_lists_do_not_reveal_other_recipients_comments(service):
    _, comments, users, _, _ = service
    first = grant(service)
    second = grant(service, 'outsider')
    comments.add_comment(users['parent.one'], first['id'], '第一个家长的私人批注', str(uuid.uuid4()))
    visible = comments.thread(users['outsider'], second['id'])
    assert visible['comments'] == []
    assert [item['id'] for item in comments.list_for_user(users['outsider'])['items']] == [second['id']]
    with pytest.raises(StorageError):
        comments.thread(users['outsider'], first['id'])


def test_corrupt_sources_and_snapshots_fail_without_leaking_private_rows(service):
    db, comments, users, saved, _ = service
    invited = grant(service)
    with sqlite3.connect(db.path) as connection:
        connection.execute('UPDATE parent_grants SET snapshot_json=? WHERE id=?', ('private-broken-summary', invited['id']))
    with pytest.raises(StorageError) as error:
        comments.thread(users['owner'], invited['id'])
    assert error.value.status_code == 503 and 'private-broken-summary' not in str(error.value)
    with sqlite3.connect(db.path) as connection:
        connection.execute('UPDATE reports SET record_json=? WHERE id=?', ('private-broken-answer-sheet', saved['id']))
    with pytest.raises(StorageError) as error:
        grant(service)
    assert error.value.status_code == 503 and 'private-broken-answer-sheet' not in str(error.value)


def test_owner_invitation_account_quota_preserves_all_old_threads(service):
    db, comments, users, _, _ = service
    for number in range(10):
        saved = db.create_report(users['owner'], record('quota-' + str(number)))
        for _ in range(10):
            comments.create_grant(users['owner'], saved['id'], 1, 'parent.one', 24, content())
    with pytest.raises(StorageError) as error:
        grant(service)
    assert error.value.status_code == 413
    assert len(comments.list_for_user(users['owner'])['items']) == 100
    with sqlite3.connect(db.path) as connection:
        assert connection.execute('SELECT COUNT(*) FROM parent_grants').fetchone()[0] == 100


def test_participation_quota_counts_received_and_created_grants_for_both_parties(service):
    db, comments, users, _, _ = service
    for number in range(5):
        first = db.create_report(users['owner'], record('incoming-' + str(number)))
        second = db.create_report(users['parent.one'], record('outgoing-' + str(number)))
        for _ in range(10):
            comments.create_grant(users['owner'], first['id'], 1, 'parent.one', 24, content())
            comments.create_grant(users['parent.one'], second['id'], 1, 'outsider', 24, content())
    assert len(comments.list_for_user(users['parent.one'])['items']) == 100
    with pytest.raises(StorageError) as incoming:
        grant(service)
    assert incoming.value.status_code == 413
    fresh = db.create_report(users['parent.one'], record('cannot-add'))
    with pytest.raises(StorageError) as outgoing:
        comments.create_grant(users['parent.one'], fresh['id'], 1, 'outsider', 24, content())
    assert outgoing.value.status_code == 413
    assert len(comments.list_for_user(users['parent.one'])['items']) == 100


@pytest.mark.parametrize('version', [1, 2])
def test_known_legacy_migrations_preserve_original_rows_and_shares(tmp_path, version):
    path = tmp_path / 'legacy.sqlite3'
    original, snapshot = legacy_v2(path) if version == 2 else (legacy_database(path), None)
    Database(path)
    with sqlite3.connect(path) as connection:
        assert connection.execute('PRAGMA user_version').fetchone()[0] == 5
        assert connection.execute('SELECT password_hash FROM users').fetchone()[0] == 'verbatim-private-hash'
        assert connection.execute('SELECT token_hash,csrf_token FROM sessions').fetchone() == ('a' * 64, 'b' * 43)
        assert connection.execute('SELECT revision,record_json FROM reports').fetchone() == (7, original)
        if version == 2:
            assert connection.execute('SELECT token_hash,snapshot_json FROM shares').fetchone() == ('c' * 64, snapshot)
        assert connection.execute('SELECT COUNT(*) FROM parent_grants').fetchone()[0] == 0
    Database(path)


@pytest.mark.parametrize('version', [1, 2])
def test_failed_migration_rolls_back_all_new_tables_and_keeps_legacy_version(tmp_path, monkeypatch, version):
    path = tmp_path / 'legacy-failure.sqlite3'
    original, snapshot = legacy_v2(path) if version == 2 else (legacy_database(path), None)
    connect = sqlite3.connect
    def deny_new_index(*args, **kwargs):
        connection = connect(*args, **kwargs)
        connection.set_authorizer(lambda action, name, *rest: sqlite3.SQLITE_DENY
                                  if action == sqlite3.SQLITE_CREATE_INDEX and name.startswith('parent_grants_')
                                  else sqlite3.SQLITE_OK)
        return connection
    monkeypatch.setattr(sqlite3, 'connect', deny_new_index)
    with pytest.raises(StorageError):
        Database(path)
    with connect(path) as connection:
        assert connection.execute('PRAGMA user_version').fetchone()[0] == version
        assert connection.execute('SELECT record_json FROM reports').fetchone()[0] == original
        assert connection.execute("SELECT COUNT(*) FROM sqlite_master WHERE name IN ('parent_grants','parent_comments')").fetchone()[0] == 0
        if snapshot:
            assert connection.execute('SELECT snapshot_json FROM shares').fetchone()[0] == snapshot


def test_unknown_v2_schema_is_rejected_without_new_tables_or_version_changes(tmp_path):
    path = tmp_path / 'unknown.sqlite3'
    legacy_v2(path)
    with sqlite3.connect(path) as connection:
        connection.execute('CREATE TABLE sqliteXcustom(value TEXT)')
    with pytest.raises(StorageError):
        Database(path)
    with sqlite3.connect(path) as connection:
        assert connection.execute('PRAGMA user_version').fetchone()[0] == 2
        assert connection.execute("SELECT COUNT(*) FROM sqlite_master WHERE name='parent_grants'").fetchone()[0] == 0
