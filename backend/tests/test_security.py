"""Real SQLite/Argon2 regressions; all database files live outside the web root."""

from concurrent.futures import ThreadPoolExecutor
import copy
from pathlib import Path
import sqlite3
import subprocess
import sys
import threading

import pytest


PASSWORD = "Long private password!"


class Clock:
    def __init__(self):
        self.now = 1_800_000_000

    def __call__(self):
        return self.now


@pytest.fixture
def services(tmp_path):
    from backend.bic_api.db import Database
    from backend.bic_api.security import AuthService

    clock = Clock()
    db = Database(tmp_path / "private.sqlite3", clock=clock)
    auth = AuthService(db, session_ttl=60, clock=clock)
    return db, auth, clock


def record(key="archive-1", batch="BIC-1"):
    return {
        "id": key,
        "createdAt": "2001-01-01T00:00:00.000Z",
        "updatedAt": "2001-01-01T00:00:00.000Z",
        "bankVersion": "2026.1",
        "catalogVersion": None,
        "state": {
            "info": {"name": "测试学生", "grade": "g10", "year": "2027"},
            "academic": {"answers": {}},
            "plan": {"answers": {}},
            "mbti": {"answers": []},
        },
        "reportMeta": {"batchId": batch, "date": "2026-10-24"},
    }


def test_report_pagination_rejects_integers_outside_sqlite_range(services):
    from backend.bic_api.db import StorageError
    db, auth, _ = services
    owner = auth.create_user('pagination.student', PASSWORD)['id']
    with pytest.raises(StorageError) as error:
        db.list_reports(owner, offset=2 ** 63)
    assert error.value.status_code == 422


def test_accounts_hash_passwords_and_persist_after_reopening(services):
    from backend.bic_api.db import Database
    from backend.bic_api.security import AuthService

    db, auth, clock = services
    user = auth.create_user("Student.A", PASSWORD)
    assert user["username"] == "student.a"
    assert user["role"] == "student"
    assert set(user) == {"id", "username", "role"}
    with sqlite3.connect(db.path) as connection:
        stored = connection.execute("SELECT password_hash FROM users").fetchone()[0]
    assert stored.startswith("$argon2id$")
    assert PASSWORD not in stored
    reopened = AuthService(Database(db.path, clock=clock), clock=clock)
    assert reopened.login("STUDENT.A", PASSWORD, "127.0.0.1")["user"] == user


@pytest.mark.parametrize("username,password,role", [
    ("ab", PASSWORD, "student"),
    ("中文用户", PASSWORD, "student"),
    ("with space", PASSWORD, "student"),
    ("student", "short", "student"),
    ("student", "x" * 129, "student"),
    ("student", PASSWORD, "admin"),
])
def test_offline_user_creation_rejects_invalid_credentials(services, username, password, role):
    from backend.bic_api.security import AuthError

    _, auth, _ = services
    with pytest.raises(AuthError) as error:
        auth.create_user(username, password, role)
    assert error.value.status_code == 422


def test_duplicate_canonical_username_is_not_overwritten(services):
    from backend.bic_api.security import AuthError

    _, auth, _ = services
    first = auth.create_user("student", PASSWORD)
    with pytest.raises(AuthError) as error:
        auth.create_user("STUDENT", "Different password!", "advisor")
    assert error.value.status_code == 409
    assert auth.login("student", PASSWORD, "127.0.0.1")["user"] == first


def test_unknown_and_wrong_password_share_generic_error_and_real_verification(services, monkeypatch):
    from pwdlib import PasswordHash
    from backend.bic_api.security import AuthError

    _, auth, _ = services
    auth.create_user("student", PASSWORD)
    verified_hashes = []
    real_verify = PasswordHash.verify

    def observed_verify(self, password, encoded, *args, **kwargs):
        verified_hashes.append(encoded)
        return real_verify(self, password, encoded, *args, **kwargs)

    monkeypatch.setattr(PasswordHash, "verify", observed_verify)
    messages = []
    for username in ("student", "unknown"):
        with pytest.raises(AuthError) as error:
            auth.login(username, "Wrong password!", "127.0.0.1")
        assert error.value.status_code == 401
        messages.append(str(error.value))
    assert messages[0] == messages[1]
    assert len(verified_hashes) == 2
    assert all(value.startswith("$argon2id$") for value in verified_hashes)
    assert verified_hashes[0] != verified_hashes[1]


def test_unknown_username_attempts_are_throttled_and_window_expires(services):
    from backend.bic_api.security import AuthError

    _, auth, clock = services
    for _ in range(5):
        with pytest.raises(AuthError) as error:
            auth.login("unknown", PASSWORD, "127.0.0.1")
        assert error.value.status_code == 401
    with pytest.raises(AuthError) as error:
        auth.login("unknown", PASSWORD, "127.0.0.2")
    assert error.value.status_code == 429
    assert 1 <= error.value.retry_after <= 60
    clock.now += 61
    with pytest.raises(AuthError) as error:
        auth.login("unknown", PASSWORD, "127.0.0.1")
    assert error.value.status_code == 401


def test_ip_attempt_budget_applies_across_different_unknown_usernames(services):
    from backend.bic_api.security import AuthError

    _, auth, _ = services
    for number in range(20):
        with pytest.raises(AuthError) as error:
            auth.login(f"unknown-{number}", PASSWORD, "192.0.2.1")
        assert error.value.status_code == 401
    with pytest.raises(AuthError) as error:
        auth.login("different-unknown", PASSWORD, "192.0.2.1")
    assert error.value.status_code == 429


@pytest.mark.parametrize("blocked_dimension", ["ip", "username"])
def test_throttled_identity_spraying_cannot_grow_limiter_memory_without_bound(services, blocked_dimension):
    from backend.bic_api.security import AuthError

    _, auth, _ = services
    # Exercise the limiter directly; hashing is not part of the memory boundary.
    for number in range(20 if blocked_dimension == "ip" else 5):
        auth._check_attempts(f"initial-{number}" if blocked_dimension == "ip" else "target-user", "192.0.2.1")
    for number in range(10_100):
        with pytest.raises(AuthError) as error:
            auth._check_attempts(f"denied-{number}" if blocked_dimension == "ip" else "target-user",
                                 "192.0.2.1" if blocked_dimension == "ip" else f"source-{number}")
        assert error.value.status_code == 429
    assert len(auth._attempts) <= 10_000
    with pytest.raises(AuthError) as error:
        auth._check_attempts("still-denied" if blocked_dimension == "ip" else "target-user", "192.0.2.1")
    assert error.value.status_code == 429


def test_no_more_than_two_password_verifications_run_concurrently(services, monkeypatch):
    from pwdlib import PasswordHash
    from backend.bic_api.security import AuthError

    _, auth, _ = services
    auth.create_user("student", PASSWORD)
    real_verify = PasswordHash.verify
    both_entered = threading.Event()
    release = threading.Event()
    count_lock = threading.Lock()
    active = 0

    def gated_verify(self, password, encoded, *args, **kwargs):
        nonlocal active
        with count_lock:
            active += 1
            if active == 2:
                both_entered.set()
        try:
            assert release.wait(timeout=10)
            return real_verify(self, password, encoded, *args, **kwargs)
        finally:
            with count_lock:
                active -= 1

    monkeypatch.setattr(PasswordHash, "verify", gated_verify)
    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = [executor.submit(auth.login, "student", PASSWORD, f"192.0.2.{i}") for i in range(2)]
        try:
            assert both_entered.wait(timeout=10)
            with pytest.raises(AuthError) as error:
                auth.login("student", PASSWORD, "192.0.2.3")
            assert error.value.status_code == 429
        finally:
            release.set()
        assert all(future.result()["user"]["username"] == "student" for future in futures)


def test_sessions_are_opaque_hashed_and_have_distinct_csrf_tokens(services):
    db, auth, _ = services
    user = auth.create_user("student", PASSWORD)
    first = auth.login("student", PASSWORD, "127.0.0.1")
    second = auth.login("student", PASSWORD, "127.0.0.1")
    assert first["user"] == user
    assert first["token"] != second["token"]
    assert len(first["token"]) >= 43
    assert first["token"] != first["csrf_token"]
    with sqlite3.connect(db.path) as connection:
        stored = repr(connection.execute("SELECT * FROM sessions").fetchall())
    assert first["token"] not in stored
    assert second["token"] not in stored
    session = auth.session(first["token"])
    assert session["user"] == user
    assert "token" not in session
    assert auth.verify_csrf(session, first["csrf_token"])
    assert not auth.verify_csrf(session, second["csrf_token"])
    assert not auth.verify_csrf(session, None)
    assert not auth.verify_csrf(session, "非ASCII")


def test_logout_expiry_and_disabled_users_revoke_sessions(services):
    from backend.bic_api.security import AuthError

    db, auth, clock = services
    user = auth.create_user("student", PASSWORD)
    logged_out = auth.login("student", PASSWORD, "127.0.0.1")
    auth.logout(logged_out["token"])
    auth.logout(logged_out["token"])
    with pytest.raises(AuthError):
        auth.session(logged_out["token"])
    expired = auth.login("student", PASSWORD, "127.0.0.1")
    clock.now = expired["expires_at"]
    with pytest.raises(AuthError):
        auth.session(expired["token"])
    current = auth.login("student", PASSWORD, "127.0.0.1")
    assert db.disable_user("student") is True
    with pytest.raises(AuthError):
        auth.session(current["token"])
    with pytest.raises(AuthError) as error:
        auth.login("student", PASSWORD, "127.0.0.1")
    assert error.value.status_code == 401
    with sqlite3.connect(db.path) as connection:
        assert connection.execute("SELECT COUNT(*) FROM sessions WHERE user_id = ?", (user["id"],)).fetchone()[0] == 0


def test_report_metadata_and_record_survive_reopening(services):
    from backend.bic_api.db import Database

    db, auth, clock = services
    user = auth.create_user("student", PASSWORD)
    original = record()
    saved = db.create_report(user["id"], original)
    assert saved["id"] != original["id"]
    assert saved["revision"] == 1
    assert saved["record"] == original
    assert saved["created_at"] != original["createdAt"]
    reopened = Database(db.path, clock=clock)
    assert reopened.get_report(user["id"], saved["id"]) == saved
    listing = reopened.list_reports(user["id"])
    assert listing["total"] == 1
    assert listing["limit"] == 20
    assert listing["offset"] == 0
    assert listing["items"] == [{
        "id": saved["id"], "revision": 1, "created_at": saved["created_at"],
        "updated_at": saved["updated_at"], "archive_id": "archive-1", "report_ref": "BIC-1",
        "name": "测试学生", "grade": "g10", "year": "2027",
    }]


def test_student_and_advisor_reports_are_owner_only(services):
    from backend.bic_api.db import StorageError

    db, auth, _ = services
    student = auth.create_user("student", PASSWORD)
    advisor = auth.create_user("advisor", PASSWORD, "advisor")
    saved = db.create_report(student["id"], record())
    assert db.list_reports(advisor["id"])["total"] == 0
    assert db.get_report(advisor["id"], saved["id"]) is None
    for operation in (
        lambda: db.update_report(advisor["id"], saved["id"], record(), 1),
        lambda: db.delete_report(advisor["id"], saved["id"], 1),
    ):
        with pytest.raises(StorageError) as error:
            operation()
        assert error.value.status_code == 404
    assert db.get_report(student["id"], saved["id"]) == saved
    assert db.create_report(advisor["id"], record())["revision"] == 1


def test_duplicate_archive_or_report_reference_is_transactionally_rejected(services):
    from backend.bic_api.db import StorageError

    db, auth, _ = services
    owner = auth.create_user("student", PASSWORD)["id"]
    first = db.create_report(owner, record())
    second = db.create_report(owner, record("archive-2", "BIC-2"))
    for duplicate in (record("archive-1", "BIC-new"), record("archive-new", "BIC-1")):
        with pytest.raises(StorageError) as error:
            db.create_report(owner, duplicate)
        assert error.value.status_code == 409
    with pytest.raises(StorageError) as error:
        db.update_report(owner, second["id"], record("archive-new", "BIC-1"), 1)
    assert error.value.status_code == 409
    assert db.get_report(owner, first["id"]) == first
    assert db.get_report(owner, second["id"]) == second


def test_revision_compare_and_swap_prevents_lost_updates_and_stale_deletes(services):
    from backend.bic_api.db import StorageError

    db, auth, clock = services
    owner = auth.create_user("student", PASSWORD)["id"]
    saved = db.create_report(owner, record())
    changed = record()
    changed["state"]["info"]["name"] = "更正姓名"
    clock.now += 1
    updated = db.update_report(owner, saved["id"], changed, 1)
    assert updated["revision"] == 2
    assert updated["created_at"] == saved["created_at"]
    assert updated["updated_at"] != saved["updated_at"]
    for operation in (
        lambda: db.update_report(owner, saved["id"], record(), 1),
        lambda: db.delete_report(owner, saved["id"], 1),
    ):
        with pytest.raises(StorageError) as error:
            operation()
        assert error.value.status_code == 409
    assert db.get_report(owner, saved["id"])["record"] == changed
    db.delete_report(owner, saved["id"], 2)
    assert db.get_report(owner, saved["id"]) is None


def test_two_parallel_updates_cannot_both_win_the_same_revision(services):
    from backend.bic_api.db import StorageError

    db, auth, _ = services
    owner = auth.create_user("student", PASSWORD)["id"]
    saved = db.create_report(owner, record())

    def update(name):
        changed = record()
        changed["state"]["info"]["name"] = name
        try:
            return db.update_report(owner, saved["id"], changed, 1)["revision"]
        except StorageError as error:
            return error.status_code

    with ThreadPoolExecutor(max_workers=2) as executor:
        outcomes = list(executor.map(update, ["第一版", "第二版"]))
    assert sorted(outcomes) == [2, 409]
    assert db.get_report(owner, saved["id"])["revision"] == 2


def test_report_count_limit_is_per_owner_and_failed_create_preserves_all_rows(services):
    from backend.bic_api.db import StorageError

    db, auth, _ = services
    owner = auth.create_user("student", PASSWORD)["id"]
    other = auth.create_user("other", PASSWORD)["id"]
    for number in range(100):
        db.create_report(owner, record(f"archive-{number}", f"BIC-{number}"))
    with pytest.raises(StorageError) as error:
        db.create_report(owner, record("overflow", "overflow"))
    assert error.value.status_code == 413
    assert db.list_reports(owner, limit=100)["total"] == 100
    assert len(db.list_reports(owner, limit=10, offset=95)["items"]) == 5
    assert db.create_report(other, record())["revision"] == 1


def test_utf16_quota_counts_astral_characters_and_preserves_previous_update(services):
    from backend.bic_api.db import StorageError

    db, auth, _ = services
    owner = auth.create_user("student", PASSWORD)["id"]
    first = record()
    first["state"]["info"]["year"] = "😀" * 499_900
    saved = db.create_report(owner, first)
    second = record("archive-2", "BIC-2")
    second["state"]["info"]["year"] = "😀" * 499_900
    with pytest.raises(StorageError) as error:
        db.create_report(owner, second)
    assert error.value.status_code == 413
    too_big = copy.deepcopy(first)
    too_big["state"]["info"]["year"] = "😀" * 1_000_000
    with pytest.raises(StorageError) as error:
        db.update_report(owner, saved["id"], too_big, 1)
    assert error.value.status_code == 413
    assert db.get_report(owner, saved["id"]) == saved
    assert db.list_reports(owner)["total"] == 1


def test_unknown_schema_is_never_initialized_or_overwritten(tmp_path):
    from backend.bic_api.db import Database, StorageError

    path = tmp_path / "unknown.sqlite3"
    with sqlite3.connect(path) as connection:
        connection.execute("CREATE TABLE important (value TEXT)")
        connection.execute("INSERT INTO important VALUES ('preserve me')")
    with pytest.raises(StorageError):
        Database(path)
    with sqlite3.connect(path) as connection:
        assert connection.execute("SELECT value FROM important").fetchall() == [("preserve me",)]
        connection.execute("PRAGMA user_version=999")
    with pytest.raises(StorageError):
        Database(path)


def test_modified_schema_constraints_require_explicit_migration(services):
    from backend.bic_api.db import Database, StorageError

    db, _, _ = services
    with sqlite3.connect(db.path) as connection:
        declaration = connection.execute("SELECT sql FROM sqlite_master WHERE name = 'users'").fetchone()[0]
        connection.execute("DROP TABLE users")
        connection.execute(declaration.replace("'student'", "'STUDENT'"))
    with pytest.raises(StorageError) as error:
        Database(db.path)
    assert error.value.code == "SCHEMA"


def test_invalid_unicode_password_is_rejected_without_exposing_credentials(services):
    from backend.bic_api.security import AuthError

    _, auth, _ = services
    invalid = "private-password-\ud800"
    with pytest.raises(AuthError) as error:
        auth.create_user("student", invalid)
    assert error.value.status_code == 422
    auth.create_user("student", PASSWORD)
    for username in ("student", "unknown"):
        with pytest.raises(AuthError) as error:
            auth.login(username, invalid, "127.0.0.1")
        assert error.value.status_code == 401
        assert invalid not in str(error.value)


def test_database_refuses_relative_or_webroot_paths_before_creating_files():
    from backend.bic_api.db import Database, StorageError

    root = Path(__file__).resolve().parents[2]
    for path in (Path("relative.sqlite3"), root / "must-not-create.sqlite3"):
        with pytest.raises(StorageError):
            Database(path)
    assert not (root / "must-not-create.sqlite3").exists()


def test_admin_creation_prompts_twice_and_disable_revokes_existing_session(services, monkeypatch, capsys):
    from backend.bic_api import admin

    db, auth, _ = services
    passwords = iter([PASSWORD, PASSWORD])
    monkeypatch.setattr(admin.getpass, "getpass", lambda prompt: next(passwords))
    assert admin.main(["--database", str(db.path), "create-user", "advisor", "--role", "advisor"]) == 0
    login = auth.login("advisor", PASSWORD, "127.0.0.1")
    assert login["user"]["role"] == "advisor"
    assert admin.main(["--database", str(db.path), "disable-user", "ADVISOR"]) == 0
    from backend.bic_api.security import AuthError
    with pytest.raises(AuthError):
        auth.session(login["token"])
    output = capsys.readouterr()
    assert PASSWORD not in output.out + output.err
    assert login["token"] not in output.out + output.err


def test_admin_mismatched_password_confirmation_creates_no_account(services, monkeypatch):
    from backend.bic_api import admin
    from backend.bic_api.security import AuthError

    db, auth, _ = services
    passwords = iter([PASSWORD, "Different password!"])
    monkeypatch.setattr(admin.getpass, "getpass", lambda prompt: next(passwords))
    assert admin.main(["--database", str(db.path), "create-user", "student"]) != 0
    with pytest.raises(AuthError):
        auth.login("student", PASSWORD, "127.0.0.1")


def test_admin_rejects_command_line_passwords(tmp_path):
    completed = subprocess.run(
        [sys.executable, "-m", "backend.bic_api.admin", "--database", str(tmp_path / "private.sqlite3"),
         "create-user", "student", "--password", "secret-value"],
        capture_output=True, text=True, timeout=10,
    )
    assert completed.returncode != 0
    assert "secret-value" not in completed.stdout + completed.stderr


def test_admin_aborts_when_terminal_cannot_hide_the_password(services, monkeypatch, capsys):
    from backend.bic_api import admin
    from backend.bic_api.security import AuthError

    db, auth, _ = services

    def cannot_hide_password(prompt):
        raise admin.getpass.GetPassWarning("terminal cannot hide input")

    monkeypatch.setattr(admin.getpass, "getpass", cannot_hide_password)
    assert admin.main(["--database", str(db.path), "create-user", "student"]) == 1
    assert "hidden password input" in capsys.readouterr().err
    with pytest.raises(AuthError):
        auth.login("student", PASSWORD, "127.0.0.1")
