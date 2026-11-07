"""Private SQLite persistence with owner-scoped reports and atomic revisions."""

from contextlib import contextmanager
from datetime import datetime, timezone
import json
from pathlib import Path
import secrets
import sqlite3
import time
import uuid

from .models import legacy_record, map_to_current


class StorageError(Exception):
    def __init__(self, status_code: int, message: str, code: str = "STORAGE"):
        super().__init__(message)
        self.status_code = status_code
        self.message = message
        self.code = code


_SCHEMA_VERSION = 6
_APPLICATION_ID = 0x42494331
_WEB_ROOT = Path(__file__).resolve().parents[2]
_MAX_REPORTS = 100
_MAX_UTF16_UNITS = 2_000_000
_SCHEMA_V1 = {
    "users": """CREATE TABLE users (
        id TEXT PRIMARY KEY NOT NULL,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('student', 'advisor')),
        disabled INTEGER NOT NULL DEFAULT 0 CHECK (disabled IN (0, 1)),
        created_at INTEGER NOT NULL
    )""",
    "sessions": """CREATE TABLE sessions (
        token_hash TEXT PRIMARY KEY NOT NULL,
        csrf_token TEXT NOT NULL,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL
    )""",
    "reports": """CREATE TABLE reports (
        id TEXT PRIMARY KEY NOT NULL,
        owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        revision INTEGER NOT NULL CHECK (revision > 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        archive_id TEXT NOT NULL,
        report_ref TEXT NOT NULL,
        name TEXT NOT NULL,
        grade TEXT NOT NULL,
        year TEXT NOT NULL,
        record_json TEXT NOT NULL,
        utf16_units INTEGER NOT NULL CHECK (utf16_units > 0),
        UNIQUE (owner_id, archive_id),
        UNIQUE (owner_id, report_ref)
    )""",
    "sessions_user_idx": "CREATE INDEX sessions_user_idx ON sessions(user_id)",
    "reports_owner_time_idx": "CREATE INDEX reports_owner_time_idx ON reports(owner_id, created_at DESC, id)",
}

_SHARE_SCHEMA = {
    "shares": """CREATE TABLE shares (
        id TEXT PRIMARY KEY NOT NULL,
        owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        report_id TEXT NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
        report_revision INTEGER NOT NULL CHECK (report_revision > 0),
        token_hash TEXT NOT NULL UNIQUE,
        snapshot_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL CHECK (expires_at > created_at),
        revoked_at INTEGER
    )""",
    "shares_owner_report_idx": "CREATE INDEX shares_owner_report_idx ON shares(owner_id, report_id, created_at DESC, id)",
    "shares_report_idx": "CREATE INDEX shares_report_idx ON shares(report_id)",
}
_SCHEMA_V2 = {**_SCHEMA_V1, **_SHARE_SCHEMA}
_COMMENT_SCHEMA = {
    "parent_grants": """CREATE TABLE parent_grants (
        id TEXT PRIMARY KEY NOT NULL,
        owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        report_id TEXT NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
        report_revision INTEGER NOT NULL CHECK (report_revision > 0),
        recipient_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        snapshot_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL CHECK (expires_at > created_at),
        revoked_at INTEGER,
        CHECK (recipient_id <> owner_id)
    )""",
    "parent_comments": """CREATE TABLE parent_comments (
        id TEXT PRIMARY KEY NOT NULL,
        grant_id TEXT NOT NULL REFERENCES parent_grants(id) ON DELETE CASCADE,
        author_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        body TEXT NOT NULL,
        request_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        sequence INTEGER NOT NULL CHECK (sequence > 0),
        UNIQUE (grant_id, author_id, request_id),
        UNIQUE (grant_id, sequence)
    )""",
    "parent_grants_owner_report_idx": "CREATE INDEX parent_grants_owner_report_idx ON parent_grants(owner_id, report_id, created_at DESC, id)",
    "parent_grants_recipient_idx": "CREATE INDEX parent_grants_recipient_idx ON parent_grants(recipient_id, created_at DESC, id)",
    "parent_comments_thread_idx": "CREATE INDEX parent_comments_thread_idx ON parent_comments(grant_id, sequence)",
}
_SCHEMA_V3 = {**_SCHEMA_V2, **_COMMENT_SCHEMA}
_TEACHER_SCHEMA = {
    "teacher_grants": """CREATE TABLE teacher_grants (
        id TEXT PRIMARY KEY NOT NULL,
        owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        report_id TEXT NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
        report_revision INTEGER NOT NULL CHECK (report_revision > 0),
        recipient_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL CHECK (expires_at > created_at),
        revoked_at INTEGER,
        CHECK (recipient_id <> owner_id)
    )""",
    "teacher_grants_owner_report_idx": "CREATE INDEX teacher_grants_owner_report_idx ON teacher_grants(owner_id, report_id, created_at DESC, id)",
    "teacher_grants_recipient_idx": "CREATE INDEX teacher_grants_recipient_idx ON teacher_grants(recipient_id, created_at DESC, id)",
}
_SCHEMA_V4 = {**_SCHEMA_V3, **_TEACHER_SCHEMA}
_ADVISOR_EDIT_SCHEMA = {
    "advisor_edit_grants": """CREATE TABLE advisor_edit_grants (
        id TEXT PRIMARY KEY NOT NULL,
        owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        report_id TEXT NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
        report_revision INTEGER NOT NULL CHECK (report_revision > 0),
        recipient_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        baseline_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL CHECK (expires_at > created_at),
        revoked_at INTEGER,
        CHECK (recipient_id <> owner_id)
    )""",
    "advisor_edits": """CREATE TABLE advisor_edits (
        id TEXT PRIMARY KEY NOT NULL,
        owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        report_id TEXT NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
        grant_id TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        actor_username TEXT NOT NULL,
        source_revision INTEGER NOT NULL CHECK (source_revision > 0),
        result_revision INTEGER NOT NULL CHECK (result_revision = source_revision + 1),
        created_at INTEGER NOT NULL,
        changes_json TEXT NOT NULL
    )""",
    "advisor_edit_grants_owner_report_idx": "CREATE INDEX advisor_edit_grants_owner_report_idx ON advisor_edit_grants(owner_id, report_id, created_at DESC, id)",
    "advisor_edit_grants_recipient_idx": "CREATE INDEX advisor_edit_grants_recipient_idx ON advisor_edit_grants(recipient_id, created_at DESC, id)",
    "advisor_edits_report_idx": "CREATE INDEX advisor_edits_report_idx ON advisor_edits(owner_id, report_id, created_at DESC, id)",
}
_SCHEMA_V5 = {**_SCHEMA_V4, **_ADVISOR_EDIT_SCHEMA}
# 一次性测试码与按码归档的学生报告。旧表不变：新流程不把学生报告混进
# owner-scoped reports，避免沿用每账号 100 份配额和旧唯一约束。
_TESTCODE_SCHEMA = {
    "test_codes": """CREATE TABLE test_codes (
        id TEXT PRIMARY KEY NOT NULL,
        code TEXT NOT NULL UNIQUE,
        label TEXT NOT NULL,
        created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL CHECK (expires_at > created_at),
        revoked_at INTEGER,
        token_hash TEXT UNIQUE,
        redeemed_at INTEGER,
        completed_at INTEGER,
        CHECK ((token_hash IS NULL) = (redeemed_at IS NULL)),
        CHECK (completed_at IS NULL OR token_hash IS NOT NULL)
    )""",
    "test_codes_created_idx": "CREATE INDEX test_codes_created_idx ON test_codes(created_at DESC, id)",
    "student_reports": """CREATE TABLE student_reports (
        id TEXT PRIMARY KEY NOT NULL,
        test_code_id TEXT NOT NULL UNIQUE REFERENCES test_codes(id) ON DELETE RESTRICT,
        revision INTEGER NOT NULL CHECK (revision = 1),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        archive_id TEXT NOT NULL,
        report_ref TEXT NOT NULL,
        name TEXT NOT NULL,
        grade TEXT NOT NULL,
        year TEXT NOT NULL,
        record_json TEXT NOT NULL,
        utf16_units INTEGER NOT NULL CHECK (utf16_units > 0)
    )""",
    "student_reports_created_idx": "CREATE INDEX student_reports_created_idx ON student_reports(created_at DESC, id)",
}
_SCHEMA = {**_SCHEMA_V5, **_TESTCODE_SCHEMA}


def _normalized_sql(sql):
    return " ".join(sql.split())


class Database:
    def __init__(self, path: Path, clock=time.time):
        candidate = Path(path)
        if not candidate.is_absolute():
            raise StorageError(500, "The database requires an absolute private path.", "CONFIGURATION")
        self.path = candidate.resolve()
        if self.path.is_relative_to(_WEB_ROOT):
            raise StorageError(500, "The database must be outside the static website and source tree.", "CONFIGURATION")
        self.clock = clock
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
        except OSError:
            raise StorageError(503, "The private database directory is unavailable.") from None
        self._initialize()

    @contextmanager
    def _connection(self):
        connection = None
        try:
            connection = sqlite3.connect(self.path, timeout=10, isolation_level=None)
            connection.row_factory = sqlite3.Row
            connection.execute("PRAGMA foreign_keys = ON")
            yield connection
        except sqlite3.Error:
            raise StorageError(503, "The private database is unavailable.") from None
        finally:
            if connection is not None:
                connection.close()

    @contextmanager
    def _transaction(self):
        with self._connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                yield connection
                connection.commit()
            except BaseException:
                connection.rollback()
                raise

    def _initialize(self):
        with self._transaction() as connection:
            version = connection.execute("PRAGMA user_version").fetchone()[0]
            application = connection.execute("PRAGMA application_id").fetchone()[0]
            objects = connection.execute(
                "SELECT name, sql FROM sqlite_master WHERE name NOT GLOB 'sqlite_*'"
            ).fetchall()
            if version == 0 and application == 0 and not objects:
                for declaration in _SCHEMA.values():
                    connection.execute(declaration)
                connection.execute("PRAGMA user_version = 6")
                connection.execute("PRAGMA application_id = 1112097585")
                return
            actual = {row["name"]: row["sql"] for row in objects}
            expected = {1: _SCHEMA_V1, 2: _SCHEMA_V2, 3: _SCHEMA_V3, 4: _SCHEMA_V4,
                        5: _SCHEMA_V5, _SCHEMA_VERSION: _SCHEMA}.get(version)
            if (
                expected is None
                or application != _APPLICATION_ID
                or set(actual) != set(expected)
                or any(actual[name] is None or _normalized_sql(actual[name]) != _normalized_sql(sql)
                       for name, sql in expected.items() if name in actual)
            ):
                raise StorageError(500, "Unsupported database schema; preserve the original database and use an explicit migration.", "SCHEMA")
            if version == 1:
                # The original declarations and rows remain untouched. DDL and
                # version advance share this transaction: failure preserves v1.
                for declaration in _SHARE_SCHEMA.values():
                    connection.execute(declaration)
            if version in (1, 2):
                # Append-only invitation/comment tables share the same migration
                # transaction. Existing v1/v2 rows and declarations are not rebuilt.
                for declaration in _COMMENT_SCHEMA.values():
                    connection.execute(declaration)
            if version in (1, 2, 3):
                # Authorizations add no copies of private answer sheets. All
                # legacy rows and DDL survive unchanged, or this whole chain
                # rolls back to the exact prior version on any failure.
                for declaration in _TEACHER_SCHEMA.values():
                    connection.execute(declaration)
            if version in (1, 2, 3, 4):
                # Text editing is a separate opt-in permission. No existing
                # read-only or parent grant is rewritten or promoted.
                for declaration in _ADVISOR_EDIT_SCHEMA.values():
                    connection.execute(declaration)
                connection.execute("PRAGMA user_version = 5")
            if version in (1, 2, 3, 4, 5):
                # 测试码流程只新增表；旧账号、报告、分享和授权原样保留。
                for declaration in _TESTCODE_SCHEMA.values():
                    connection.execute(declaration)
                connection.execute("PRAGMA user_version = 6")

    @staticmethod
    def _public_user(row):
        return {"id": row["id"], "username": row["username"], "role": row["role"]}

    def create_user(self, username, password_hash, role):
        identifier = str(uuid.uuid4())
        with self._transaction() as connection:
            try:
                connection.execute(
                    "INSERT INTO users (id, username, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)",
                    (identifier, username, password_hash, role, int(self.clock())),
                )
            except sqlite3.IntegrityError:
                raise StorageError(409, "The username is already in use.", "DUPLICATE") from None
        return {"id": identifier, "username": username, "role": role}

    def user_for_login(self, username):
        with self._connection() as connection:
            row = connection.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
            return dict(row) if row is not None else None

    def create_session(self, token_hash, csrf_token, user_id, expires_at, expected_password_hash=None):
        with self._transaction() as connection:
            user = connection.execute("SELECT id,password_hash FROM users WHERE id = ? AND disabled = 0", (user_id,)).fetchone()
            if user is None or expected_password_hash is not None and user["password_hash"] != expected_password_hash:
                return False
            connection.execute("DELETE FROM sessions WHERE expires_at <= ?", (int(self.clock()),))
            connection.execute(
                "INSERT INTO sessions (token_hash, csrf_token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?)",
                (token_hash, csrf_token, user_id, expires_at, int(self.clock())),
            )
        return True

    def change_password(self, token_hash, csrf_token, user_id, expected_password_hash, new_password_hash):
        # Hashing occurs before taking this write lock. Authority, expiry, and
        # the hash that was actually verified must all still agree afterward.
        with self._transaction() as connection:
            current = connection.execute(
                "SELECT users.id FROM sessions JOIN users ON users.id = sessions.user_id "
                "WHERE sessions.token_hash = ? AND sessions.csrf_token = ? AND sessions.expires_at > ? "
                "AND users.id = ? AND users.disabled = 0 AND users.password_hash = ?",
                (token_hash, csrf_token, int(self.clock()), user_id, expected_password_hash),
            ).fetchone()
            if current is None:
                return False
            updated = connection.execute(
                "UPDATE users SET password_hash = ? WHERE id = ? AND disabled = 0 AND password_hash = ?",
                (new_password_hash, user_id, expected_password_hash),
            ).rowcount
            if updated != 1:
                raise StorageError(503, "The credential update is unavailable.")
            connection.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))
            if connection.execute("SELECT 1 FROM sessions WHERE user_id = ? LIMIT 1", (user_id,)).fetchone() is not None:
                # A failed/ignored deletion cannot commit a partially changed
                # credential while leaving an earlier session valid.
                raise StorageError(503, "The credential update is unavailable.")
        return True

    def session(self, token_hash, now):
        with self._connection() as connection:
            row = connection.execute(
                "SELECT sessions.csrf_token, sessions.expires_at, users.id, users.username, users.role "
                "FROM sessions JOIN users ON users.id = sessions.user_id "
                "WHERE sessions.token_hash = ? AND sessions.expires_at > ? AND users.disabled = 0",
                (token_hash, now),
            ).fetchone()
        if row is None:
            return None
        return {"csrf_token": row["csrf_token"], "expires_at": row["expires_at"], "user": self._public_user(row)}

    def delete_session(self, token_hash):
        with self._transaction() as connection:
            connection.execute("DELETE FROM sessions WHERE token_hash = ?", (token_hash,))

    def disable_user(self, username):
        with self._transaction() as connection:
            row = connection.execute("SELECT id FROM users WHERE username = ?", (username,)).fetchone()
            if row is None:
                return False
            connection.execute("UPDATE users SET disabled = 1 WHERE id = ?", (row["id"],))
            connection.execute("DELETE FROM sessions WHERE user_id = ?", (row["id"],))
        return True

    def _timestamp(self):
        return datetime.fromtimestamp(self.clock(), timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")

    @staticmethod
    def _encode_record(record):
        try:
            serialized = json.dumps(record, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
            units = len(serialized.encode("utf-16-le")) // 2
            metadata = (record["id"], record["reportMeta"]["batchId"], record["state"]["info"]["name"],
                        record["state"]["info"]["grade"], record["state"]["info"]["year"])
            if any(not isinstance(value, str) for value in metadata):
                raise ValueError
            return serialized, units, metadata
        except (TypeError, ValueError, KeyError, UnicodeError):
            raise StorageError(422, "The report record is invalid.", "VALIDATION") from None

    @staticmethod
    def _full_report(row):
        # 存档统一是旧版兼容形状；读取时换回当前形状，当前版本写出的存档补上当前标记。
        return {"id": row["id"], "revision": row["revision"], "created_at": row["created_at"],
                "updated_at": row["updated_at"], "record": map_to_current(json.loads(row["record_json"]))}

    @staticmethod
    def _metadata(row):
        return {key: row[key] for key in ("id", "revision", "created_at", "updated_at", "archive_id",
                                        "report_ref", "name", "grade", "year")}

    @staticmethod
    def _quota(connection, owner_id, added_units, added_count):
        usage = connection.execute(
            "SELECT COUNT(*) AS count, COALESCE(SUM(utf16_units), 0) AS units FROM reports WHERE owner_id = ?",
            (owner_id,),
        ).fetchone()
        if usage["count"] + added_count > _MAX_REPORTS or usage["units"] + added_units > _MAX_UTF16_UNITS:
            raise StorageError(413, "The account report limit is 100 reports and 2,000,000 serialized UTF-16 units.", "LIMIT")

    def create_report(self, owner_id, record):
        # 存档统一存旧版兼容形状：当前版本形状的记录（例如页面提交的当前版本存档）写前换算，
        # 旧版形状的原样保存。
        record = legacy_record(record) or record
        serialized, units, metadata = self._encode_record(record)
        identifier = str(uuid.uuid4())
        at = self._timestamp()
        with self._transaction() as connection:
            self._quota(connection, owner_id, units, 1)
            try:
                connection.execute(
                    "INSERT INTO reports (id, owner_id, revision, created_at, updated_at, archive_id, report_ref, "
                    "name, grade, year, record_json, utf16_units) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (identifier, owner_id, at, at, *metadata, serialized, units),
                )
            except sqlite3.IntegrityError:
                raise StorageError(409, "The archive or report reference already exists for this account.", "DUPLICATE") from None
            row = connection.execute("SELECT * FROM reports WHERE owner_id = ? AND id = ?", (owner_id, identifier)).fetchone()
        return self._full_report(row)

    def list_reports(self, owner_id, limit=20, offset=0):
        if type(limit) is not int or not 1 <= limit <= 100 or type(offset) is not int or not 0 <= offset <= 2 ** 63 - 1:
            raise StorageError(422, "Invalid report pagination.", "VALIDATION")
        with self._transaction() as connection:
            total = connection.execute("SELECT COUNT(*) FROM reports WHERE owner_id = ?", (owner_id,)).fetchone()[0]
            rows = connection.execute(
                "SELECT id, revision, created_at, updated_at, archive_id, report_ref, name, grade, year "
                "FROM reports WHERE owner_id = ? ORDER BY created_at DESC, id LIMIT ? OFFSET ?",
                (owner_id, limit, offset),
            ).fetchall()
        return {"items": [self._metadata(row) for row in rows], "total": total, "limit": limit, "offset": offset}

    def get_report(self, owner_id, identifier):
        with self._connection() as connection:
            row = connection.execute("SELECT * FROM reports WHERE owner_id = ? AND id = ?", (owner_id, identifier)).fetchone()
        return self._full_report(row) if row is not None else None

    @staticmethod
    def _require_revision(connection, owner_id, identifier, expected_revision):
        row = connection.execute("SELECT * FROM reports WHERE owner_id = ? AND id = ?", (owner_id, identifier)).fetchone()
        if row is None:
            raise StorageError(404, "Report not found.", "NOT_FOUND")
        if type(expected_revision) is not int or row["revision"] != expected_revision:
            raise StorageError(409, "The report changed; reload it before applying another change.", "REVISION")
        return row

    def update_report(self, owner_id, identifier, record, expected_revision):
        # 与 create_report 相同：写回前统一成旧版兼容形状。
        record = legacy_record(record) or record
        serialized, units, metadata = self._encode_record(record)
        with self._transaction() as connection:
            if connection.execute('SELECT id FROM users WHERE id = ? AND disabled = 0', (owner_id,)).fetchone() is None:
                raise StorageError(404, "Report not found.", "NOT_FOUND")
            current = self._require_revision(connection, owner_id, identifier, expected_revision)
            self._quota(connection, owner_id, units - current["utf16_units"], 0)
            try:
                connection.execute(
                    "UPDATE reports SET revision = revision + 1, updated_at = ?, archive_id = ?, report_ref = ?, "
                    "name = ?, grade = ?, year = ?, record_json = ?, utf16_units = ? "
                    "WHERE owner_id = ? AND id = ? AND revision = ?",
                    (self._timestamp(), *metadata, serialized, units, owner_id, identifier, expected_revision),
                )
            except sqlite3.IntegrityError:
                raise StorageError(409, "The archive or report reference already exists for this account.", "DUPLICATE") from None
            row = connection.execute("SELECT * FROM reports WHERE owner_id = ? AND id = ?", (owner_id, identifier)).fetchone()
        return self._full_report(row)

    def delete_report(self, owner_id, identifier, expected_revision):
        with self._transaction() as connection:
            self._require_revision(connection, owner_id, identifier, expected_revision)
            connection.execute("DELETE FROM reports WHERE owner_id = ? AND id = ? AND revision = ?", (owner_id, identifier, expected_revision))
        return True

    # ---- 一次性测试码与按码归档的学生报告 ----

    @staticmethod
    def _test_code_status(row, now):
        if row["revoked_at"] is not None:
            return "revoked"
        if row["completed_at"] is not None:
            return "completed"
        if row["expires_at"] <= now:
            return "expired"
        if row["redeemed_at"] is not None:
            return "in_progress"
        return "unused"

    def create_test_code(self, created_by, code, label, expires_at):
        identifier = str(uuid.uuid4())
        created_at = int(self.clock())
        with self._transaction() as connection:
            try:
                connection.execute(
                    "INSERT INTO test_codes (id, code, label, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
                    (identifier, code, label, created_by, created_at, expires_at),
                )
            except sqlite3.IntegrityError:
                raise StorageError(409, "The test code is already in use.", "DUPLICATE") from None
            row = connection.execute("SELECT * FROM test_codes WHERE id = ?", (identifier,)).fetchone()
        return dict(row)

    def redeem_test_code(self, code, token_hash, now):
        """Redeem a code once, or resume it with the same participant token."""
        with self._transaction() as connection:
            row = connection.execute("SELECT * FROM test_codes WHERE code = ?", (code,)).fetchone()
            if row is None:
                raise StorageError(404, "Test code not found.", "NOT_FOUND")
            if row["revoked_at"] is not None:
                raise StorageError(410, "This test code has been revoked.", "REVOKED")
            if row["expires_at"] <= now:
                raise StorageError(410, "This test code has expired.", "EXPIRED")
            if row["completed_at"] is not None:
                raise StorageError(410, "This test code has already been completed.", "COMPLETED")
            if row["token_hash"] is not None:
                if not secrets.compare_digest(row["token_hash"], token_hash):
                    raise StorageError(409, "This test code is already in use.", "IN_USE")
                return dict(row), False
            updated = connection.execute(
                "UPDATE test_codes SET token_hash = ?, redeemed_at = ? WHERE id = ? AND token_hash IS NULL",
                (token_hash, now, row["id"]),
            ).rowcount
            if updated != 1:
                raise StorageError(409, "This test code is already in use.", "IN_USE")
            row = connection.execute("SELECT * FROM test_codes WHERE id = ?", (row["id"],)).fetchone()
        return dict(row), True

    def test_code_for_token(self, token_hash):
        with self._connection() as connection:
            row = connection.execute("SELECT * FROM test_codes WHERE token_hash = ?", (token_hash,)).fetchone()
        return dict(row) if row is not None else None

    def active_test_session(self, token_hash, now):
        with self._connection() as connection:
            row = connection.execute(
                "SELECT id, label, expires_at FROM test_codes WHERE token_hash = ? AND revoked_at IS NULL "
                "AND completed_at IS NULL AND expires_at > ?",
                (token_hash, now),
            ).fetchone()
        return dict(row) if row is not None else None

    def revoke_test_code(self, identifier):
        with self._transaction() as connection:
            row = connection.execute("SELECT * FROM test_codes WHERE id = ?", (identifier,)).fetchone()
            if row is None:
                raise StorageError(404, "Test code not found.", "NOT_FOUND")
            if row["revoked_at"] is None:
                connection.execute("UPDATE test_codes SET revoked_at = ? WHERE id = ?", (int(self.clock()), identifier))
                row = connection.execute("SELECT * FROM test_codes WHERE id = ?", (identifier,)).fetchone()
        return dict(row)

    def list_test_codes(self, limit=50, offset=0):
        if type(limit) is not int or not 1 <= limit <= 100 or type(offset) is not int or offset < 0:
            raise StorageError(422, "Invalid test code pagination.", "VALIDATION")
        now = int(self.clock())
        with self._connection() as connection:
            total = connection.execute("SELECT COUNT(*) FROM test_codes").fetchone()[0]
            rows = connection.execute(
                "SELECT tc.id, tc.code, tc.label, tc.created_at, tc.expires_at, tc.revoked_at, tc.redeemed_at, "
                "tc.completed_at, sr.id AS report_id FROM test_codes tc "
                "LEFT JOIN student_reports sr ON sr.test_code_id = tc.id "
                "ORDER BY tc.created_at DESC, tc.id LIMIT ? OFFSET ?",
                (limit, offset),
            ).fetchall()
        return {"items": [{
            "id": row["id"], "code": row["code"], "label": row["label"], "status": self._test_code_status(row, now),
            "created_at": row["created_at"], "expires_at": row["expires_at"], "revoked_at": row["revoked_at"],
            "redeemed_at": row["redeemed_at"], "completed_at": row["completed_at"], "report_id": row["report_id"],
        } for row in rows], "total": total, "limit": limit, "offset": offset}

    @staticmethod
    def _full_student_report(row):
        return {"id": row["id"], "revision": row["revision"], "created_at": row["created_at"],
                "updated_at": row["updated_at"], "record": map_to_current(json.loads(row["record_json"]))}

    def create_student_report(self, test_code_id, record):
        # 与账号报告一致：写入前统一换算成旧版兼容形状。
        record = legacy_record(record) or record
        serialized, units, metadata = self._encode_record(record)
        at = self._timestamp()
        with self._transaction() as connection:
            code = connection.execute("SELECT * FROM test_codes WHERE id = ?", (test_code_id,)).fetchone()
            if code is None:
                raise StorageError(404, "Test code not found.", "NOT_FOUND")
            if code["revoked_at"] is not None:
                raise StorageError(410, "This test code has been revoked.", "REVOKED")
            existing = connection.execute("SELECT * FROM student_reports WHERE test_code_id = ?", (test_code_id,)).fetchone()
            if existing is not None:
                if existing["archive_id"] == metadata[0]:
                    return self._full_student_report(existing), False
                raise StorageError(409, "A report has already been submitted for this code.", "DUPLICATE")
            if code["completed_at"] is not None or code["expires_at"] <= int(self.clock()):
                raise StorageError(410, "This test code is no longer available.", "EXPIRED")
            identifier = str(uuid.uuid4())
            connection.execute(
                "INSERT INTO student_reports (id, test_code_id, revision, created_at, updated_at, archive_id, "
                "report_ref, name, grade, year, record_json, utf16_units) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (identifier, test_code_id, at, at, *metadata, serialized, units),
            )
            connection.execute("UPDATE test_codes SET completed_at = ? WHERE id = ?", (int(self.clock()), test_code_id))
            row = connection.execute("SELECT * FROM student_reports WHERE id = ?", (identifier,)).fetchone()
        return self._full_student_report(row), True

    def list_student_reports(self, limit=20, offset=0):
        if type(limit) is not int or not 1 <= limit <= 100 or type(offset) is not int or offset < 0:
            raise StorageError(422, "Invalid report pagination.", "VALIDATION")
        with self._connection() as connection:
            total = connection.execute("SELECT COUNT(*) FROM student_reports").fetchone()[0]
            rows = connection.execute(
                "SELECT sr.id, sr.created_at, sr.updated_at, sr.report_ref, sr.name, sr.grade, sr.year, "
                "sr.test_code_id, tc.code, tc.label FROM student_reports sr "
                "JOIN test_codes tc ON tc.id = sr.test_code_id ORDER BY sr.created_at DESC, sr.id LIMIT ? OFFSET ?",
                (limit, offset),
            ).fetchall()
        return {"items": [{
            "id": row["id"], "created_at": row["created_at"], "updated_at": row["updated_at"],
            "report_ref": row["report_ref"], "name": row["name"], "grade": row["grade"], "year": row["year"],
            "test_code_id": row["test_code_id"], "code": row["code"], "label": row["label"],
        } for row in rows], "total": total, "limit": limit, "offset": offset}

    def get_student_report(self, identifier):
        with self._connection() as connection:
            row = connection.execute(
                "SELECT sr.*, tc.code, tc.label FROM student_reports sr "
                "JOIN test_codes tc ON tc.id = sr.test_code_id WHERE sr.id = ?",
                (identifier,),
            ).fetchone()
        if row is None:
            return None
        return {**self._full_student_report(row), "code": row["code"], "label": row["label"],
                "test_code_id": row["test_code_id"]}
