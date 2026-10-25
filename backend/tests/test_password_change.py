"""Real Argon2/SQLite password replacement and whole-account session revocation."""

from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
import sqlite3
import threading

import pytest
from pwdlib import PasswordHash

from backend.bic_api.db import StorageError
from backend.bic_api.security import AuthError
from backend.tests.test_security import services, PASSWORD
from backend.tests.test_models import record

NEW_PASSWORD = 'New fictional password!'


@pytest.fixture
def account(services):
    db, auth, clock = services
    owner = auth.create_user('student', PASSWORD)
    other = auth.create_user('other', PASSWORD, 'advisor')
    first = auth.login('student', PASSWORD, '192.0.2.1')
    second = auth.login('student', PASSWORD, '192.0.2.2')
    outsider = auth.login('other', PASSWORD, '192.0.2.3')
    return db, auth, clock, owner, other, first, second, outsider


def change(auth, session, current=PASSWORD, new=NEW_PASSWORD, ip='192.0.2.1'):
    return auth.change_password(session['token'], session['csrf_token'], current, new, ip)


def failure(operation, status):
    with pytest.raises((AuthError, StorageError)) as captured:
        operation()
    assert captured.value.status_code == status
    for private in [PASSWORD, NEW_PASSWORD, '$argon2']:
        assert private not in str(captured.value)
    return captured.value


def state(db):
    with sqlite3.connect(db.path) as connection:
        return {table: connection.execute('SELECT * FROM ' + table + ' ORDER BY 1').fetchall()
                for table in ['users', 'sessions', 'reports', 'shares', 'parent_grants', 'parent_comments',
                              'teacher_grants', 'advisor_edit_grants', 'advisor_edits']}


def test_success_replaces_real_argon_hash_revokes_all_own_sessions_and_preserves_every_other_row(account, capsys):
    db, auth, _, owner, other, first, second, outsider = account
    saved = db.create_report(owner['id'], record())
    # Store distinct opaque authorization rows through the existing services.
    from backend.bic_api.teacher_access import TeacherAccessService
    from backend.bic_api.sharing import ShareService
    from backend.bic_api.comments import CommentService
    from backend.bic_api.advisor_edit import AdvisorEditService
    from backend.tests.test_sharing import content
    TeacherAccessService(db, clock=auth.clock).create_grant(owner['id'], saved['id'], 1, 'other', 24)
    ShareService(db, clock=auth.clock).create(owner['id'], saved['id'], 1, 24, content())
    comments = CommentService(db, clock=auth.clock)
    invitation = comments.create_grant(owner['id'], saved['id'], 1, 'other', 24, content())
    comments.add_comment(other['id'], invitation['id'], '虚构批注需要逐字保留', '00000000-0000-4000-8000-000000000001')
    editor = AdvisorEditService(db, clock=auth.clock)
    baseline = {key: '虚构基线' + key for key in ['summary', 'academic', 'plan', 'personality']}
    permission = editor.create_grant(owner['id'], saved['id'], 1, 'other', 24, baseline)
    editor.apply(other['id'], permission['id'], 1, {'summary': '虚构修订与真实操作者审计应保留'})
    before = state(db)
    assert all(before[table] for table in ['reports', 'shares', 'parent_grants', 'parent_comments', 'teacher_grants', 'advisor_edit_grants', 'advisor_edits'])
    assert change(auth, first) is None
    after = state(db)
    old_user = next(row for row in before['users'] if row[0] == owner['id'])
    new_user = next(row for row in after['users'] if row[0] == owner['id'])
    assert new_user[:2] == old_user[:2] and new_user[3:] == old_user[3:]
    assert new_user[2] != old_user[2] and new_user[2].startswith('$argon2id$')
    assert PasswordHash.recommended().verify(NEW_PASSWORD, new_user[2])
    assert not PasswordHash.recommended().verify(PASSWORD, new_user[2])
    assert after['sessions'] == [row for row in before['sessions'] if row[2] == other['id']]
    for table in before.keys() - {'users', 'sessions'}: assert after[table] == before[table]
    assert next(row for row in after['users'] if row[0] == other['id']) == next(row for row in before['users'] if row[0] == other['id'])
    failure(lambda: auth.session(first['token']), 401); failure(lambda: auth.session(second['token']), 401)
    assert auth.session(outsider['token'])['user'] == other
    assert auth.login('student', NEW_PASSWORD, '192.0.2.4')['user'] == owner
    failure(lambda: auth.login('student', PASSWORD, '192.0.2.4'), 401)
    output = capsys.readouterr(); assert PASSWORD not in output.out + output.err and NEW_PASSWORD not in output.out + output.err
    with sqlite3.connect(db.path) as connection:
        assert connection.execute('PRAGMA user_version').fetchone()[0] == 5


@pytest.mark.parametrize('new', ['short', 'x' * 129, '😀' * 129, ' ' * 12, '\u2002' * 12, '\ud800' + 'a' * 12, None, 123, PASSWORD],
                         ids=['short', 'long', 'unicode-long', 'spaces', 'unicode-spaces', 'surrogate', 'null', 'integer', 'unchanged'])
def test_invalid_new_password_never_changes_hash_or_any_session(account, new):
    db, auth, _, _, _, first, _, _ = account; before = state(db)
    failure(lambda: change(auth, first, new=new), 422)
    assert state(db) == before


@pytest.mark.parametrize('password', ['x' * 12, 'x' * 128, '😀' * 12, '😀' * 128, ' leading and trailing '])
def test_password_length_is_unicode_codepoints_and_password_text_is_not_trimmed(services, password):
    db, auth, _ = services; auth.create_user('unicode', PASSWORD); session = auth.login('unicode', PASSWORD, '192.0.2.1')
    assert change(auth, session, new=password) is None
    assert auth.login('unicode', password, '192.0.2.2')['user']['username'] == 'unicode'
    failure(lambda: auth.login('unicode', PASSWORD, '192.0.2.2'), 401)


@pytest.mark.parametrize('current', ['Wrong fictional password!', 'short', '\ud800' + 'a' * 12, None, 123],
                         ids=['wrong', 'short', 'surrogate', 'null', 'integer'])
def test_wrong_or_invalid_current_password_returns_generic_401_and_preserves_state(account, current):
    db, auth, _, _, _, first, _, _ = account; before = state(db)
    failure(lambda: change(auth, first, current=current), 401)
    assert state(db) == before


@pytest.mark.parametrize('invalid', ['token', 'csrf', 'unicode_csrf', 'logout', 'expired', 'disabled', 'deleted'])
def test_invalid_session_or_csrf_cannot_start_hashing(account, invalid, monkeypatch):
    db, auth, clock, owner, _, first, _, _ = account
    token, csrf = first['token'], first['csrf_token']
    if invalid == 'token': token = 'invalid'
    elif invalid == 'csrf': csrf = 'x' * 43
    elif invalid == 'unicode_csrf': csrf = '非ASCII'
    elif invalid == 'logout': auth.logout(token)
    elif invalid == 'expired': clock.now = first['expires_at']
    elif invalid == 'disabled': db.disable_user('student')
    else:
        with sqlite3.connect(db.path) as connection:
            connection.execute('PRAGMA foreign_keys=ON'); connection.execute('DELETE FROM users WHERE id=?', (owner['id'],))
    before = state(db)
    monkeypatch.setattr(auth, '_verify', lambda *args: pytest.fail('Invalid current authority must precede Argon2.'))
    failure(lambda: auth.change_password(token, csrf, PASSWORD, NEW_PASSWORD, '192.0.2.1'), 401)
    assert state(db) == before


@pytest.mark.parametrize('changed', ['logout', 'expire', 'disable', 'hash', 'csrf', 'token_owner'])
def test_transaction_rechecks_authority_and_verified_hash_after_expensive_verification(account, changed, monkeypatch):
    db, auth, clock, owner, other, first, _, outsider = account; real = auth._verify
    def verify(*args):
        result = real(*args)
        if changed == 'logout': auth.logout(first['token'])
        elif changed == 'expire': clock.now = first['expires_at']
        elif changed == 'disable': db.disable_user('student')
        else:
            with sqlite3.connect(db.path) as connection:
                if changed == 'hash': connection.execute('UPDATE users SET password_hash=? WHERE id=?', ('independently-replaced-hash', owner['id']))
                elif changed == 'csrf': connection.execute('UPDATE sessions SET csrf_token=? WHERE token_hash=?', ('new-csrf', auth._token_hash(first['token'])))
                else: connection.execute('UPDATE sessions SET user_id=? WHERE token_hash=?', (other['id'], auth._token_hash(first['token'])))
        return result
    monkeypatch.setattr(auth, '_verify', verify)
    failure(lambda: change(auth, first), 401)
    if changed == 'expire':
        with sqlite3.connect(db.path) as connection:
            assert connection.execute('SELECT user_id FROM sessions WHERE token_hash=?', (auth._token_hash(outsider['token']),)).fetchone()[0] == other['id']
    else:
        assert auth.session(outsider['token'])['user'] == other
    stored = db.user_for_login('student')['password_hash']
    if changed == 'hash': assert stored == 'independently-replaced-hash'
    else: assert PasswordHash.recommended().verify(PASSWORD, stored)


def test_expiry_is_checked_after_acquiring_transaction_lock(account, monkeypatch):
    db, auth, clock, _, _, first, _, _ = account; original = db._transaction
    @contextmanager
    def delayed():
        with original() as connection:
            clock.now = first['expires_at']; yield connection
    monkeypatch.setattr(db, '_transaction', delayed)
    failure(lambda: change(auth, first), 401)
    assert PasswordHash.recommended().verify(PASSWORD, db.user_for_login('student')['password_hash'])


@pytest.mark.parametrize('point', ['update', 'delete'])
def test_sqlite_trigger_failure_rolls_back_hash_and_all_sessions_together(account, point):
    db, auth, _, _, _, first, _, _ = account; before = state(db)
    trigger = ('BEFORE UPDATE OF password_hash ON users' if point == 'update' else 'BEFORE DELETE ON sessions')
    with sqlite3.connect(db.path) as connection:
        connection.execute('CREATE TRIGGER fail_password ' + trigger + " BEGIN SELECT RAISE(ABORT,'private storage failure'); END")
    captured = failure(lambda: change(auth, first), 503)
    assert 'private storage failure' not in captured.message
    assert state(db) == before


def test_ignored_session_deletion_cannot_leave_new_password_with_old_live_sessions(account):
    db, auth, _, _, _, first, _, _ = account; before = state(db)
    with sqlite3.connect(db.path) as connection:
        connection.execute('CREATE TRIGGER ignore_session BEFORE DELETE ON sessions BEGIN SELECT RAISE(IGNORE); END')
    failure(lambda: change(auth, first), 503)
    assert state(db) == before


def test_ignored_password_update_rolls_back_trigger_side_effects(account):
    db, auth, _, _, _, first, _, _ = account; before = state(db)
    with sqlite3.connect(db.path) as connection:
        connection.execute("CREATE TRIGGER ignore_password BEFORE UPDATE OF password_hash ON users BEGIN UPDATE users SET role='advisor' WHERE id=OLD.id; SELECT RAISE(IGNORE); END")
    failure(lambda: change(auth, first), 503)
    assert state(db) == before


def test_concurrent_changes_from_two_existing_sessions_have_exactly_one_winner(account, monkeypatch):
    db, auth, _, _, _, first, second, outsider = account; real = auth._verify; barrier = threading.Barrier(2)
    def verify(*args):
        result = real(*args); barrier.wait(timeout=10); return result
    monkeypatch.setattr(auth, '_verify', verify)
    def attempt(session, new):
        try: change(auth, session, new=new); return 'ok'
        except AuthError as captured: return captured.status_code
    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(attempt, first, NEW_PASSWORD), pool.submit(attempt, second, 'Another fictional password!')]
        outcomes = [future.result() for future in futures]
    assert sorted(outcomes, key=str) == [401, 'ok']
    assert auth.session(outsider['token'])['user']['username'] == 'other'
    with sqlite3.connect(db.path) as connection:
        assert connection.execute('SELECT COUNT(*) FROM sessions WHERE user_id=?', (first['user']['id'],)).fetchone()[0] == 0


@pytest.mark.parametrize('commit_first', ['password', 'login'])
def test_old_hash_login_race_cannot_leave_a_valid_session_after_password_change(account, commit_first, monkeypatch):
    db, auth, _, _, _, first, _, _ = account; real_create = db.create_session; entered = threading.Event(); release = threading.Event()
    def gated_create(*args, **kwargs):
        entered.set(); assert release.wait(timeout=10); return real_create(*args, **kwargs)
    monkeypatch.setattr(db, 'create_session', gated_create)
    with ThreadPoolExecutor(max_workers=1) as pool:
        pending = pool.submit(auth.login, 'student', PASSWORD, '192.0.2.9')
        assert entered.wait(timeout=10)
        if commit_first == 'password':
            try: change(auth, first)
            finally: release.set()
            failure(lambda: pending.result(), 401)
        else:
            release.set(); logged = pending.result(); change(auth, first)
            failure(lambda: auth.session(logged['token']), 401)
    assert PasswordHash.recommended().verify(NEW_PASSWORD, db.user_for_login('student')['password_hash'])


def test_create_session_expected_hash_is_optional_but_atomic_when_provided(account):
    db, auth, clock, owner, _, _, _, _ = account; hashed = db.user_for_login('student')['password_hash']
    assert db.create_session('compatible', 'csrf', owner['id'], clock.now + 60)
    assert db.create_session('matching', 'csrf', owner['id'], clock.now + 60, expected_password_hash=hashed)
    assert not db.create_session('stale', 'csrf', owner['id'], clock.now + 60, expected_password_hash='stale-private-hash')
    with sqlite3.connect(db.path) as connection:
        assert connection.execute('SELECT COUNT(*) FROM sessions WHERE token_hash=?', ('stale',)).fetchone()[0] == 0


def test_change_attempts_share_the_same_username_budget_with_login(account):
    _, auth, clock, _, _, first, _, _ = account
    # Two valid logins already consumed two of the same account's five attempts.
    failure(lambda: auth.login('student', 'Wrong fictional password!', '192.0.2.8'), 401)
    failure(lambda: change(auth, first, current='Wrong fictional password!'), 401)
    failure(lambda: change(auth, first, current='Wrong fictional password!'), 401)
    assert failure(lambda: auth.login('student', PASSWORD, '192.0.2.8'), 429).retry_after > 0
    assert failure(lambda: change(auth, first), 429).retry_after > 0
    clock.now += 61
    # Renew this synthetic session's test expiry without extending production behavior.
    with sqlite3.connect(auth.db.path) as connection: connection.execute('UPDATE sessions SET expires_at=?', (clock.now + 60,))
    assert change(auth, first) is None


def test_change_attempts_share_ip_budget_and_never_hash_after_throttling(account, monkeypatch):
    _, auth, _, _, _, first, _, _ = account
    for index in range(19): auth._check_attempts('different-' + str(index), '192.0.2.1')
    monkeypatch.setattr(auth, '_verify', lambda *args: pytest.fail('Throttled change cannot start Argon2.'))
    failure(lambda: change(auth, first), 429)


@pytest.mark.parametrize('stage', ['verify', 'hash'])
def test_change_uses_shared_argon_resource_slots_without_changing_credentials(account, stage, monkeypatch):
    import backend.bic_api.security as security
    db, auth, _, _, _, first, _, _ = account; before = state(db); acquired = []
    def occupy():
        for _ in range(2): assert security._HASH_SLOTS.acquire(blocking=False); acquired.append(1)
    real = auth._verify
    if stage == 'verify': occupy()
    else:
        def verify(*args):
            result = real(*args); occupy(); return result
        monkeypatch.setattr(auth, '_verify', verify)
    try: assert failure(lambda: change(auth, first), 429).retry_after == 1
    finally:
        for _ in acquired: security._HASH_SLOTS.release()
    assert state(db) == before
