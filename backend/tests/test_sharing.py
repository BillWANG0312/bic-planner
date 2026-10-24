"""Private migration and opaque, expiring read-only parent snapshots."""

from concurrent.futures import ThreadPoolExecutor
import hashlib
import importlib
import json
import sqlite3

import pytest

from backend.bic_api.db import Database, StorageError
from backend.bic_api.security import AuthError, AuthService


PASSWORD = 'sharing-test-only-password'

# Frozen pre-sharing declarations, independent of the implementation's current
# schema constants. Whitespace is immaterial; constraints and names are not.
LEGACY_SCHEMA = [
    "CREATE TABLE users ( id TEXT PRIMARY KEY NOT NULL, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK (role IN ('student', 'advisor')), disabled INTEGER NOT NULL DEFAULT 0 CHECK (disabled IN (0, 1)), created_at INTEGER NOT NULL )",
    "CREATE TABLE sessions ( token_hash TEXT PRIMARY KEY NOT NULL, csrf_token TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL )",
    "CREATE TABLE reports ( id TEXT PRIMARY KEY NOT NULL, owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, revision INTEGER NOT NULL CHECK (revision > 0), created_at TEXT NOT NULL, updated_at TEXT NOT NULL, archive_id TEXT NOT NULL, report_ref TEXT NOT NULL, name TEXT NOT NULL, grade TEXT NOT NULL, year TEXT NOT NULL, record_json TEXT NOT NULL, utf16_units INTEGER NOT NULL CHECK (utf16_units > 0), UNIQUE (owner_id, archive_id), UNIQUE (owner_id, report_ref) )",
    "CREATE INDEX sessions_user_idx ON sessions(user_id)",
    "CREATE INDEX reports_owner_time_idx ON reports(owner_id, created_at DESC, id)",
]


class Clock:
    value = 1_800_000_000

    def __call__(self):
        return self.value


def record(key='one'):
    return {
        'id': 'archive-' + key, 'createdAt': '2026-10-24T00:00:00.000Z',
        'updatedAt': '2026-10-24T00:00:00.000Z', 'bankVersion': '2026.10',
        'catalogVersion': '2026.10.24',
        'state': {'info': {'name': '只读测试同学', 'grade': '8', 'year': '2027 年秋季'},
                  'academic': {'answers': {'ph3': 'private-raw-answer'}},
                  'plan': {'answers': {'grade': '8'}}, 'mbti': {'answers': []}},
        'reportMeta': {'batchId': 'AP-' + key, 'date': '2026年10月24日'},
        'advisor': {'sections': {}, 'history': [{'author': 'private-audit-author'}]},
    }


def content():
    return {
        'status': 'draft', 'direction': '计算机科学', 'personality': '待完成性格测评',
        'subjects': [{'key': key, 'name': name, 'answered': 0, 'total': 15, 'pct': None}
                     for key, name in [('english', '英语'), ('maths', '数学'),
                                       ('physics', '物理'), ('chemistry', '化学')]],
        'sections': {'summary': '先完成测评，再与老师讨论。', 'academic': '补齐基础测评。',
                     'plan': '参加专业体验课程。', 'personality': '结合学习习惯继续探索。'},
    }


@pytest.fixture
def service(tmp_path):
    try:
        ShareService = importlib.import_module('backend.bic_api.sharing').ShareService
    except ModuleNotFoundError:
        pytest.fail('Read-only expiring share service must be implemented.')
    clock = Clock()
    db = Database(tmp_path / 'private.sqlite3', clock=clock)
    auth = AuthService(db, clock=clock)
    owner = auth.create_user('share.owner', PASSWORD)['id']
    other = auth.create_user('share.other', PASSWORD)['id']
    saved = db.create_report(owner, record())
    return db, auth, ShareService(db, clock=clock), owner, other, saved, clock


def test_create_returns_a_secret_once_and_public_snapshot_contains_only_allowed_summary(service):
    db, _, shares, owner, _, saved, clock = service
    result = shares.create(owner, saved['id'], 1, 24, content())
    assert result['status'] == 'active'
    assert len(result['token']) == 43
    assert result['report_revision'] == 1
    assert result['expires_at'] == clock.value + 24 * 3600
    snapshot = shares.read(result['token'], '127.0.0.1')
    assert snapshot == {
        'format': 'bic-parent-summary', 'version': 1, 'shared_at': clock.value,
        'expires_at': clock.value + 24 * 3600,
        'report': {'name': '只读测试同学', 'grade': '8', 'year': '2027 年秋季',
                   'batchId': 'AP-one', 'date': '2026年10月24日', 'bankVersion': '2026.10',
                   'catalogVersion': '2026.10.24', 'revision': 1}, 'content': content(),
    }
    serialized = json.dumps(snapshot)
    for secret in [owner, saved['id'], 'private-raw-answer', 'private-audit-author', result['token']]:
        assert secret not in serialized
    with sqlite3.connect(db.path) as connection:
        stored = connection.execute('SELECT token_hash, snapshot_json FROM shares').fetchone()
    assert stored[0] == hashlib.sha256(result['token'].encode('ascii')).hexdigest()
    assert result['token'].encode() not in db.path.read_bytes()
    listed = shares.list(owner, saved['id'])['items']
    assert len(listed) == 1 and listed[0]['id'] == result['id']
    assert 'token' not in listed[0] and 'snapshot' not in str(listed)


def test_owner_scope_and_revision_are_checked_before_writing(service):
    db, _, shares, owner, other, saved, _ = service
    for actor, identifier, revision, status in [
        (other, saved['id'], 1, 404), (owner, 'unknown', 1, 404),
        (owner, saved['id'], 2, 409), (owner, saved['id'], True, 409),
    ]:
        with pytest.raises(StorageError) as error:
            shares.create(actor, identifier, revision, 24, content())
        assert error.value.status_code == status
    assert shares.list(owner, saved['id']) == {'items': []}
    with pytest.raises(StorageError) as error:
        shares.list(other, saved['id'])
    assert error.value.status_code == 404
    assert db.get_report(owner, saved['id']) == saved


@pytest.mark.parametrize('ttl', [0, -1, 1, 23, 25, 72.0, True, '24', 169])
def test_invalid_ttl_is_rejected_without_share_or_report_mutation(service, ttl):
    db, _, shares, owner, _, saved, _ = service
    with pytest.raises(StorageError) as error:
        shares.create(owner, saved['id'], 1, ttl, content())
    assert error.value.status_code == 422
    assert shares.list(owner, saved['id'])['items'] == []
    assert db.get_report(owner, saved['id']) == saved


def test_strict_content_rejects_raw_answers_and_identity_fields(service):
    _, _, shares, owner, _, saved, _ = service
    for extra in ['state', 'answers', 'history', 'owner_id', 'token', 'html']:
        invalid = content()
        invalid[extra] = 'must not be shared'
        with pytest.raises(StorageError) as error:
            shares.create(owner, saved['id'], 1, 24, invalid)
        assert error.value.status_code == 422
    assert shares.list(owner, saved['id'])['items'] == []


def test_expiry_revocation_unknown_and_malformed_tokens_are_indistinguishable(service):
    _, _, shares, owner, other, saved, clock = service
    result = shares.create(owner, saved['id'], 1, 24, content())
    with pytest.raises(StorageError) as foreign:
        shares.revoke(other, saved['id'], result['id'])
    assert foreign.value.status_code == 404
    clock.value = result['expires_at'] - 1
    assert shares.read(result['token'], 'local')['report']['revision'] == 1
    clock.value += 1
    with pytest.raises(StorageError) as expired:
        shares.read(result['token'], 'local')
    assert expired.value.status_code == 404
    assert shares.list(owner, saved['id'])['items'][0]['status'] == 'expired'
    active = shares.create(owner, saved['id'], 1, 72, content())
    shares.revoke(owner, saved['id'], active['id'])
    shares.revoke(owner, saved['id'], active['id'])
    assert shares.list(owner, saved['id'])['items'][0]['status'] == 'revoked'
    for token in [active['token'], 'x' * 43, '', None, True, 'a/b', '中' * 43]:
        with pytest.raises(StorageError) as unavailable:
            shares.read(token, 'local')
        assert unavailable.value.status_code == 404
        assert str(unavailable.value) == str(expired.value)


def test_update_does_not_change_snapshot_and_delete_revokes_it(service):
    db, _, shares, owner, _, saved, _ = service
    result = shares.create(owner, saved['id'], 1, 168, content())
    before = shares.read(result['token'], 'local')
    changed = record()
    changed['state']['info']['name'] = '后来的名字'
    assert db.update_report(owner, saved['id'], changed, 1)['revision'] == 2
    assert shares.read(result['token'], 'local') == before
    db.delete_report(owner, saved['id'], 2)
    with pytest.raises(StorageError) as error:
        shares.read(result['token'], 'local')
    assert error.value.status_code == 404
    with sqlite3.connect(db.path) as connection:
        assert connection.execute('SELECT COUNT(*) FROM shares').fetchone()[0] == 0


def test_disabling_owner_immediately_denies_existing_public_share(service):
    db, _, shares, owner, _, saved, _ = service
    result = shares.create(owner, saved['id'], 1, 24, content())
    assert db.disable_user('share.owner')
    with pytest.raises(StorageError) as error:
        shares.read(result['token'], 'local')
    assert error.value.status_code == 404


def test_per_report_quota_is_atomic_and_revocation_frees_capacity(service):
    _, _, shares, owner, _, saved, _ = service
    previous = [shares.create(owner, saved['id'], 1, 24, content()) for _ in range(4)]

    def add(_):
        try:
            return shares.create(owner, saved['id'], 1, 24, content())
        except StorageError as error:
            return error

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(add, range(2)))
    assert sum(isinstance(item, dict) for item in results) == 1
    failures = [item for item in results if isinstance(item, StorageError)]
    assert len(failures) == 1 and failures[0].status_code == 413
    assert len(shares.list(owner, saved['id'])['items']) == 5
    shares.revoke(owner, saved['id'], previous[0]['id'])
    replacement = shares.create(owner, saved['id'], 1, 24, content())
    listed = shares.list(owner, saved['id'])['items']
    assert len(listed) == 5 and any(item['id'] == replacement['id'] for item in listed)
    with pytest.raises(StorageError):
        shares.read(previous[0]['token'], 'local')


def test_account_quota_and_expired_cleanup_are_bounded(service):
    db, _, shares, owner, _, saved, clock = service
    records = [saved] + [db.create_report(owner, record(str(i))) for i in range(1, 21)]
    for item in records[:20]:
        for _ in range(5):
            shares.create(owner, item['id'], 1, 24, content())
    with pytest.raises(StorageError) as error:
        shares.create(owner, records[20]['id'], 1, 24, content())
    assert error.value.status_code == 413
    clock.value += 24 * 3600
    shares.create(owner, records[20]['id'], 1, 24, content())
    with sqlite3.connect(db.path) as connection:
        assert connection.execute('SELECT COUNT(*) FROM shares WHERE owner_id=?', (owner,)).fetchone()[0] == 1


def test_public_reads_have_bounded_per_ip_throttle_including_unknown_tokens(service):
    _, _, shares, owner, _, saved, clock = service
    result = shares.create(owner, saved['id'], 1, 24, content())
    for _ in range(60):
        with pytest.raises(StorageError):
            shares.read('x' * 43, 'busy-ip')
    with pytest.raises(AuthError) as error:
        shares.read(result['token'], 'busy-ip')
    assert error.value.status_code == 429 and error.value.retry_after > 0
    assert shares.read(result['token'], 'another-ip')['report']['revision'] == 1
    clock.value += 60
    assert shares.read(result['token'], 'busy-ip')['report']['revision'] == 1


def test_unknown_ip_churn_cannot_grow_throttle_memory_without_a_bound(service):
    _, _, shares, _, _, _, _ = service
    for index in range(10_020):
        with pytest.raises(StorageError):
            shares.read('', 'new-ip-' + str(index))
    assert len(shares._reads) <= 10_000


def test_public_read_has_no_database_write_side_effect(service):
    db, _, shares, owner, _, saved, _ = service
    result = shares.create(owner, saved['id'], 1, 24, content())
    before = db.path.read_bytes()
    shares.read(result['token'], 'local')
    assert db.path.read_bytes() == before


def test_corrupt_snapshot_or_storage_failure_never_leaks_private_rows(service):
    db, _, shares, owner, _, saved, _ = service
    result = shares.create(owner, saved['id'], 1, 24, content())
    with sqlite3.connect(db.path) as connection:
        connection.execute('UPDATE shares SET snapshot_json=?', ('{"private":"sensitive"}',))
    with pytest.raises(StorageError) as malformed:
        shares.read(result['token'], 'local')
    assert malformed.value.status_code == 503 and 'sensitive' not in str(malformed.value)
    with sqlite3.connect(db.path) as connection:
        connection.execute('ALTER TABLE shares RENAME TO unavailable')
    with pytest.raises(StorageError) as unavailable:
        shares.read(result['token'], 'local')
    assert unavailable.value.status_code == 503 and str(db.path) not in str(unavailable.value)


def test_corrupt_source_json_fails_as_storage_error_without_creating_a_share(service):
    db, _, shares, owner, _, saved, _ = service
    with sqlite3.connect(db.path) as connection:
        connection.execute('UPDATE reports SET record_json=? WHERE id=?', ('private-broken-json', saved['id']))
    with pytest.raises(StorageError) as error:
        shares.create(owner, saved['id'], 1, 24, content())
    assert error.value.status_code == 503
    assert 'private-broken-json' not in str(error.value)
    assert shares.list(owner, saved['id'])['items'] == []


def legacy_database(path):
    """Exact v1 schema, before the share table existed; no dependency on Git history."""
    with sqlite3.connect(path) as connection:
        for declaration in LEGACY_SCHEMA:
            connection.execute(declaration)
        connection.execute('PRAGMA application_id=1112097585')
        connection.execute('PRAGMA user_version=1')
        connection.execute('INSERT INTO users VALUES (?,?,?,?,?,?)',
                           ('legacy-user', 'legacy.owner', 'verbatim-private-hash', 'advisor', 0, 1_800_000_000))
        connection.execute('INSERT INTO sessions VALUES (?,?,?,?,?)',
                           ('a' * 64, 'b' * 43, 'legacy-user', 1_900_000_000, 1_800_000_000))
        source = record('legacy')
        source_json = json.dumps(source, ensure_ascii=False, separators=(',', ':'))
        connection.execute('INSERT INTO reports VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
                           ('legacy-report', 'legacy-user', 7, 'created-verbatim', 'updated-verbatim',
                            source['id'], source['reportMeta']['batchId'], source['state']['info']['name'],
                            '8', source['state']['info']['year'], source_json, len(source_json)))
    return source_json


def test_known_v1_migration_preserves_original_users_sessions_and_report_bytes(tmp_path):
    path = tmp_path / 'legacy.sqlite3'
    source_json = legacy_database(path)
    Database(path)
    with sqlite3.connect(path) as connection:
        assert connection.execute('PRAGMA user_version').fetchone()[0] == 4
        assert connection.execute('SELECT password_hash FROM users').fetchone()[0] == 'verbatim-private-hash'
        assert connection.execute('SELECT token_hash,csrf_token FROM sessions').fetchone() == ('a' * 64, 'b' * 43)
        assert connection.execute('SELECT revision,record_json,created_at,updated_at FROM reports').fetchone() == (7, source_json, 'created-verbatim', 'updated-verbatim')
        assert connection.execute('SELECT COUNT(*) FROM shares').fetchone()[0] == 0
    Database(path)


def test_failed_v1_migration_rolls_back_new_table_and_version_without_touching_data(tmp_path, monkeypatch):
    path = tmp_path / 'failed-migration.sqlite3'
    source_json = legacy_database(path)
    original = sqlite3.connect

    def cannot_create_index(*args, **kwargs):
        connection = original(*args, **kwargs)
        # Let CREATE TABLE and its internal UNIQUE indices succeed, then deny
        # the explicit share index so rollback must undo already-created DDL.
        connection.set_authorizer(lambda action, name, *rest: sqlite3.SQLITE_DENY
                                  if action == sqlite3.SQLITE_CREATE_INDEX and name.startswith('shares_')
                                  else sqlite3.SQLITE_OK)
        return connection

    monkeypatch.setattr(sqlite3, 'connect', cannot_create_index)
    with pytest.raises(StorageError):
        Database(path)
    with original(path) as connection:
        assert connection.execute('PRAGMA user_version').fetchone()[0] == 1
        assert connection.execute("SELECT COUNT(*) FROM sqlite_master WHERE name='shares'").fetchone()[0] == 0
        assert connection.execute('SELECT record_json FROM reports').fetchone()[0] == source_json


def test_altered_v1_or_future_schema_is_never_migrated(tmp_path):
    for kind in ['altered', 'future']:
        path = tmp_path / (kind + '.sqlite3')
        source_json = legacy_database(path)
        with sqlite3.connect(path) as connection:
            if kind == 'altered':
                connection.execute('CREATE TABLE unrelated (value TEXT)')
            else:
                connection.execute('PRAGMA user_version=999')
        with pytest.raises(StorageError) as error:
            Database(path)
        assert error.value.code == 'SCHEMA'
        with sqlite3.connect(path) as connection:
            assert connection.execute('SELECT record_json FROM reports').fetchone()[0] == source_json
            assert connection.execute("SELECT COUNT(*) FROM sqlite_master WHERE name='shares'").fetchone()[0] == 0


def test_user_table_resembling_internal_prefix_cannot_bypass_exact_v1_schema_check(tmp_path):
    path = tmp_path / 'lookalike-prefix.sqlite3'
    source_json = legacy_database(path)
    with sqlite3.connect(path) as connection:
        # Only the literal sqlite_ prefix is reserved. The underscore in LIKE
        # would also match the X here and incorrectly hide this unknown table.
        connection.execute('CREATE TABLE sqliteXcustom (value TEXT)')
        connection.execute("INSERT INTO sqliteXcustom VALUES ('preserve custom data')")
    with pytest.raises(StorageError) as error:
        Database(path)
    assert error.value.code == 'SCHEMA'
    with sqlite3.connect(path) as connection:
        assert connection.execute('PRAGMA user_version').fetchone()[0] == 1
        assert connection.execute('SELECT record_json FROM reports').fetchone()[0] == source_json
        assert connection.execute('SELECT value FROM sqliteXcustom').fetchone()[0] == 'preserve custom data'
        assert connection.execute("SELECT COUNT(*) FROM sqlite_master WHERE name='shares'").fetchone()[0] == 0
