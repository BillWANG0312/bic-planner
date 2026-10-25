"""Frozen v4 fixtures prove edit migration adds only the new structures."""

import sqlite3

import pytest

from backend.bic_api.db import Database, StorageError
from backend.tests.test_teacher_migration import legacy, legacy_v3, snapshot


LEGACY_TEACHER_SCHEMA = [
    'CREATE TABLE teacher_grants ( id TEXT PRIMARY KEY NOT NULL, owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, report_id TEXT NOT NULL REFERENCES reports(id) ON DELETE CASCADE, report_revision INTEGER NOT NULL CHECK (report_revision > 0), recipient_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL CHECK (expires_at > created_at), revoked_at INTEGER, CHECK (recipient_id <> owner_id) )',
    'CREATE INDEX teacher_grants_owner_report_idx ON teacher_grants(owner_id, report_id, created_at DESC, id)',
    'CREATE INDEX teacher_grants_recipient_idx ON teacher_grants(recipient_id, created_at DESC, id)',
]


def legacy_v4(path):
    legacy_v3(path)
    with sqlite3.connect(path) as connection:
        for statement in LEGACY_TEACHER_SCHEMA:
            connection.execute(statement)
        connection.execute('PRAGMA user_version=4')
        connection.execute('INSERT INTO teacher_grants VALUES (?,?,?,?,?,?,?,?)',
                           ('old-teacher-grant', 'legacy-user', 'legacy-report', 7, 'legacy-teacher',
                            1_800_000_000, 1_800_604_800, None))


def previous(path, version):
    if version == 4:
        legacy_v4(path)
    else:
        legacy(path, version)


@pytest.mark.parametrize('version', [1, 2, 3, 4])
def test_edit_upgrade_preserves_exact_old_rows_declarations_hashes_and_sessions(tmp_path, version):
    path = tmp_path / 'legacy.sqlite3'
    previous(path, version)
    before = snapshot(path)
    Database(path)
    after = snapshot(path)
    assert after['version'] == 5
    assert after['application'] == before['application']
    for table, rows in before['rows'].items():
        assert after['rows'][table] == rows
    for declaration in before['schema']:
        assert declaration in after['schema']
    assert after['rows']['advisor_edit_grants'] == after['rows']['advisor_edits'] == []
    Database(path)
    assert snapshot(path) == after


@pytest.mark.parametrize('version', [1, 2, 3, 4])
@pytest.mark.parametrize('failure', ['grant', 'audit', 'index', 'version'])
def test_edit_migration_every_failed_step_rolls_back_exact_original(tmp_path, monkeypatch, version, failure):
    path = tmp_path / 'legacy.sqlite3'
    previous(path, version)
    before = snapshot(path)
    real_connect = sqlite3.connect

    def connect(*args, **kwargs):
        connection = real_connect(*args, **kwargs)

        def deny(action, name, argument, *unused):
            blocked = (failure == 'grant' and action == sqlite3.SQLITE_CREATE_TABLE and name == 'advisor_edit_grants'
                       or failure == 'audit' and action == sqlite3.SQLITE_CREATE_TABLE and name == 'advisor_edits'
                       or failure == 'index' and action == sqlite3.SQLITE_CREATE_INDEX and name == 'advisor_edits_report_idx'
                       or failure == 'version' and action == sqlite3.SQLITE_PRAGMA and name == 'user_version' and argument == '5')
            return sqlite3.SQLITE_DENY if blocked else sqlite3.SQLITE_OK

        connection.set_authorizer(deny)
        return connection

    monkeypatch.setattr(sqlite3, 'connect', connect)
    with pytest.raises(StorageError):
        Database(path)
    assert snapshot(path, real_connect) == before


@pytest.mark.parametrize('statement', [
    'CREATE TABLE unexpected(private TEXT)',
    'ALTER TABLE reports ADD COLUMN private_extra TEXT',
    'DROP INDEX teacher_grants_recipient_idx',
    'PRAGMA user_version=6',
    'PRAGMA application_id=1',
])
def test_unknown_or_modified_v4_is_refused_without_change(tmp_path, statement):
    path = tmp_path / 'unknown.sqlite3'
    legacy_v4(path)
    with sqlite3.connect(path) as connection:
        connection.execute(statement)
    before = snapshot(path)
    with pytest.raises(StorageError) as error:
        Database(path)
    assert error.value.code == 'SCHEMA'
    assert snapshot(path) == before
