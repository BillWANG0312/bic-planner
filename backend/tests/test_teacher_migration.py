"""Independent exact legacy fixtures and atomic teacher-access schema upgrades."""

import sqlite3

import pytest

from backend.bic_api.db import Database, StorageError
from backend.tests.test_comments import legacy_v2
from backend.tests.test_sharing import legacy_database


# Historical declarations are intentionally independent of production schema
# constants, so changing a new declaration cannot silently update the fixture.
LEGACY_COMMENT_SCHEMA = [
    "CREATE TABLE parent_grants ( id TEXT PRIMARY KEY NOT NULL, owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, report_id TEXT NOT NULL REFERENCES reports(id) ON DELETE CASCADE, report_revision INTEGER NOT NULL CHECK (report_revision > 0), recipient_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, snapshot_json TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL CHECK (expires_at > created_at), revoked_at INTEGER, CHECK (recipient_id <> owner_id) )",
    "CREATE TABLE parent_comments ( id TEXT PRIMARY KEY NOT NULL, grant_id TEXT NOT NULL REFERENCES parent_grants(id) ON DELETE CASCADE, author_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, body TEXT NOT NULL, request_id TEXT NOT NULL, created_at INTEGER NOT NULL, sequence INTEGER NOT NULL CHECK (sequence > 0), UNIQUE (grant_id, author_id, request_id), UNIQUE (grant_id, sequence) )",
    "CREATE INDEX parent_grants_owner_report_idx ON parent_grants(owner_id, report_id, created_at DESC, id)",
    "CREATE INDEX parent_grants_recipient_idx ON parent_grants(recipient_id, created_at DESC, id)",
    "CREATE INDEX parent_comments_thread_idx ON parent_comments(grant_id, sequence)",
]
TEACHER_OBJECTS = {'teacher_grants', 'teacher_grants_owner_report_idx', 'teacher_grants_recipient_idx'}


def legacy_v3(path):
    legacy_v2(path)
    with sqlite3.connect(path) as connection:
        for statement in LEGACY_COMMENT_SCHEMA:
            connection.execute(statement)
        connection.execute('PRAGMA user_version=3')
        connection.execute('INSERT INTO users VALUES (?,?,?,?,?,?)',
                           ('legacy-parent', 'legacy.parent', 'verbatim-parent-hash', 'student', 0, 1_800_000_001))
        connection.execute('INSERT INTO users VALUES (?,?,?,?,?,?)',
                           ('legacy-teacher', 'legacy.teacher', 'verbatim-teacher-hash', 'advisor', 0, 1_800_000_002))
        connection.execute('INSERT INTO parent_grants VALUES (?,?,?,?,?,?,?,?,?)',
                           ('old-parent-grant', 'legacy-user', 'legacy-report', 7, 'legacy-parent',
                            '{"private":"原样摘要\\nnot rebuilt"}', 1_800_000_000, 1_800_604_800, None))
        connection.execute('INSERT INTO parent_comments VALUES (?,?,?,?,?,?,?)',
                           ('old-comment', 'old-parent-grant', 'legacy-parent', '原样批注\n<b>不重写</b>',
                            '11111111-2222-4333-8444-555555555555', 1_800_000_010, 1))


def legacy(path, version):
    if version == 1:
        legacy_database(path)
    elif version == 2:
        legacy_v2(path)
    else:
        legacy_v3(path)


def snapshot(path, connect=sqlite3.connect):
    with connect(path) as connection:
        schema = connection.execute('SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name').fetchall()
        tables = [row[1] for row in schema if row[0] == 'table' and not row[1].startswith('sqlite_')]
        return {
            'version': connection.execute('PRAGMA user_version').fetchone()[0],
            'application': connection.execute('PRAGMA application_id').fetchone()[0],
            'schema': schema,
            'rows': {table: connection.execute('SELECT * FROM "' + table + '" ORDER BY rowid').fetchall() for table in tables},
        }


@pytest.mark.parametrize('version', [1, 2, 3])
def test_exact_legacy_upgrade_preserves_every_original_row_and_declaration(tmp_path, version):
    path = tmp_path / 'legacy.sqlite3'
    legacy(path, version)
    original = snapshot(path)
    Database(path)
    upgraded = snapshot(path)
    assert upgraded['version'] == 4
    assert upgraded['application'] == original['application'] == 1112097585
    for table, rows in original['rows'].items():
        assert upgraded['rows'][table] == rows
    for declaration in original['schema']:
        assert declaration in upgraded['schema']
    assert upgraded['rows']['teacher_grants'] == []
    assert TEACHER_OBJECTS.issubset({row[1] for row in upgraded['schema']})
    Database(path)
    assert snapshot(path) == upgraded, 'Starting the upgraded database again must not rebuild or alter rows'


@pytest.mark.parametrize('version', [1, 2, 3])
@pytest.mark.parametrize('failure', ['table', 'index', 'version'])
def test_teacher_upgrade_failure_rolls_back_all_ddl_rows_and_version(tmp_path, monkeypatch, version, failure):
    path = tmp_path / 'rollback.sqlite3'
    legacy(path, version)
    original = snapshot(path)
    connect = sqlite3.connect

    def fail_teacher_upgrade(*args, **kwargs):
        connection = connect(*args, **kwargs)

        def deny(action, name, argument, *unused):
            blocked = (failure == 'table' and action == sqlite3.SQLITE_CREATE_TABLE and name == 'teacher_grants'
                       or failure == 'index' and action == sqlite3.SQLITE_CREATE_INDEX and name == 'teacher_grants_recipient_idx'
                       or failure == 'version' and action == sqlite3.SQLITE_PRAGMA and name == 'user_version' and argument == '4')
            return sqlite3.SQLITE_DENY if blocked else sqlite3.SQLITE_OK

        connection.set_authorizer(deny)
        return connection

    monkeypatch.setattr(sqlite3, 'connect', fail_teacher_upgrade)
    with pytest.raises(StorageError):
        Database(path)
    assert snapshot(path, connect) == original


@pytest.mark.parametrize('alter', [
    'CREATE TABLE sqliteXcustom(secret TEXT)',
    'CREATE INDEX private_user_index ON users(username)',
    'CREATE VIEW private_user_view AS SELECT id FROM users',
    'DROP INDEX parent_comments_thread_idx',
    'ALTER TABLE users ADD COLUMN unknown_private_field TEXT',
    'PRAGMA application_id=123',
    'PRAGMA user_version=999',
    'PRAGMA user_version=4',
])
def test_unknown_or_modified_legacy_is_rejected_before_teacher_ddl(tmp_path, alter):
    path = tmp_path / 'unknown.sqlite3'
    legacy_v3(path)
    with sqlite3.connect(path) as connection:
        connection.execute(alter)
    original = snapshot(path)
    with pytest.raises(StorageError) as error:
        Database(path)
    assert error.value.code == 'SCHEMA'
    assert snapshot(path) == original


def test_new_database_uses_v4_and_teacher_constraints_and_cascades(tmp_path):
    path = tmp_path / 'new.sqlite3'
    db = Database(path)
    assert snapshot(path)['version'] == 4
    owner = db.create_user('owner', 'not-a-real-login-hash', 'student')['id']
    teacher = db.create_user('teacher', 'not-a-real-login-hash', 'advisor')['id']
    from backend.tests.test_sharing import record
    report = db.create_report(owner, record())
    with sqlite3.connect(path) as connection:
        connection.execute('PRAGMA foreign_keys=ON')
        fk = connection.execute('PRAGMA foreign_key_list(teacher_grants)').fetchall()
        assert {(row[2], row[3], row[4], row[6]) for row in fk} == {
            ('users', 'owner_id', 'id', 'CASCADE'), ('users', 'recipient_id', 'id', 'CASCADE'),
            ('reports', 'report_id', 'id', 'CASCADE')}
        for revision, recipient, created, expires in [(0, teacher, 100, 200), (1, owner, 100, 200), (1, teacher, 100, 100)]:
            with pytest.raises(sqlite3.IntegrityError):
                connection.execute('INSERT INTO teacher_grants VALUES (?,?,?,?,?,?,?,?)',
                                   ('invalid', owner, report['id'], revision, recipient, created, expires, None))
        connection.execute('INSERT INTO teacher_grants VALUES (?,?,?,?,?,?,?,?)',
                           ('valid', owner, report['id'], 1, teacher, 100, 200, None))
    db.delete_report(owner, report['id'], 1)
    with sqlite3.connect(path) as connection:
        assert connection.execute('SELECT COUNT(*) FROM teacher_grants').fetchone()[0] == 0


def test_upgraded_v4_preserves_new_teacher_rows_on_reopen(tmp_path):
    path = tmp_path / 'reopened.sqlite3'
    legacy_v3(path)
    Database(path)
    with sqlite3.connect(path) as connection:
        connection.execute('INSERT INTO teacher_grants VALUES (?,?,?,?,?,?,?,?)',
                           ('old-teacher-grant', 'legacy-user', 'legacy-report', 7, 'legacy-teacher',
                            1_800_000_000, 1_800_604_800, None))
    original = snapshot(path)
    Database(path)
    assert snapshot(path) == original
