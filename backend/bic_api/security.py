"""Argon2 credentials and server-side opaque sessions; no public registration."""

from collections import OrderedDict, deque
import hashlib
import hmac
import math
import re
import secrets
import threading
import time

from pwdlib import PasswordHash
from pwdlib.exceptions import UnknownHashError

from .db import StorageError


class AuthError(Exception):
    def __init__(self, status_code, message, retry_after=None):
        super().__init__(message)
        self.status_code = status_code
        self.message = message
        self.retry_after = retry_after


_PASSWORD_HASHER = PasswordHash.recommended()
_HASH_SLOTS = threading.BoundedSemaphore(2)
_DUMMY_LOCK = threading.Lock()
_DUMMY_HASH = None
_USERNAME = re.compile(r"[a-z0-9._@+\-]{3,64}\Z", re.ASCII)
_TOKEN = re.compile(r"[A-Za-z0-9_-]{43}\Z", re.ASCII)
_INVALID_CREDENTIALS = "Invalid username or password."


def canonical_username(value):
    if not isinstance(value, str) or not value.isascii() or not _USERNAME.fullmatch(value.lower()):
        raise AuthError(422, "Username must contain 3 to 64 ASCII letters, digits, or . _ @ + -.")
    return value.lower()


def _valid_password_shape(password):
    if not isinstance(password, str) or not 12 <= len(password) <= 128:
        return False
    try:
        password.encode("utf-8")
        return True
    except UnicodeError:
        return False


def _hash_operation(operation, *args):
    if not _HASH_SLOTS.acquire(blocking=False):
        raise AuthError(429, "Authentication is busy; try again shortly.", retry_after=1)
    try:
        return operation(*args)
    finally:
        _HASH_SLOTS.release()


def _dummy_hash():
    global _DUMMY_HASH
    with _DUMMY_LOCK:
        if _DUMMY_HASH is None:
            _DUMMY_HASH = _hash_operation(_PASSWORD_HASHER.hash, secrets.token_urlsafe(32))
    return _DUMMY_HASH


class AuthService:
    def __init__(self, db, session_ttl=28800, clock=time.time):
        if type(session_ttl) is not int or session_ttl <= 0:
            raise ValueError("Session lifetime must be a positive integer.")
        self.db = db
        self.session_ttl = session_ttl
        self.clock = clock
        self._dummy = _dummy_hash()
        self._attempts = OrderedDict()
        self._attempt_lock = threading.Lock()

    def create_user(self, username, password, role="student"):
        canonical = canonical_username(username)
        if not _valid_password_shape(password) or not password.strip():
            raise AuthError(422, "Password must contain 12 to 128 characters.")
        if role not in ("student", "advisor"):
            raise AuthError(422, "Role must be student or advisor.")
        try:
            password_hash = _hash_operation(_PASSWORD_HASHER.hash, password)
            return self.db.create_user(canonical, password_hash, role)
        except StorageError as error:
            if error.status_code == 409:
                raise AuthError(409, error.message) from None
            raise

    def _check_attempts(self, username, ip):
        now = self.clock()
        # Both dimensions count all attempts, including unknown users and busy hashes.
        # This in-process limiter intentionally does not trust forwarded IP headers.
        dimensions = (("username", username, 5), ("ip", str(ip)[:256], 20))
        with self._attempt_lock:
            buckets = []
            retry_after = 0
            for category, value, maximum in dimensions:
                key = (category, value)
                attempts = self._attempts.setdefault(key, deque())
                self._attempts.move_to_end(key)
                while attempts and attempts[0] <= now - 60:
                    attempts.popleft()
                if len(attempts) >= maximum:
                    retry_after = max(retry_after, max(1, math.ceil(attempts[0] + 60 - now)))
                buckets.append(attempts)
            # Limit memory even when callers continuously invent identities/IPs.
            while len(self._attempts) > 10_000:
                self._attempts.popitem(last=False)
            if retry_after:
                raise AuthError(429, "Too many login attempts; try again later.", retry_after=retry_after)
            for attempts in buckets:
                attempts.append(now)

    def _verify(self, password, encoded):
        def verify():
            try:
                return _PASSWORD_HASHER.verify(password, encoded)
            except (UnknownHashError, ValueError):
                _PASSWORD_HASHER.verify(password, self._dummy)
                return False
        return _hash_operation(verify)

    def login(self, username, password, ip):
        try:
            canonical = canonical_username(username)
        except AuthError:
            canonical = "<invalid>"
        self._check_attempts(canonical, ip)
        user = self.db.user_for_login(canonical)
        valid_password_shape = _valid_password_shape(password)
        candidate = password if valid_password_shape else "invalid-login-password"
        verified = self._verify(candidate, user["password_hash"] if user else self._dummy)
        if not user or not verified or not valid_password_shape or user["disabled"]:
            raise AuthError(401, _INVALID_CREDENTIALS)
        token = secrets.token_urlsafe(32)
        csrf_token = secrets.token_urlsafe(32)
        expires_at = int(self.clock()) + self.session_ttl
        if not self.db.create_session(self._token_hash(token), csrf_token, user["id"], expires_at,
                                      expected_password_hash=user["password_hash"]):
            raise AuthError(401, _INVALID_CREDENTIALS)
        public = {key: user[key] for key in ("id", "username", "role")}
        return {"token": token, "csrf_token": csrf_token, "expires_at": expires_at, "user": public}

    def change_password(self, rawtoken, csrf_token, current_password, new_password, ip):
        session = self.session(rawtoken)
        if not self.verify_csrf(session, csrf_token):
            raise AuthError(401, "Authentication required.")
        self._check_attempts(session["user"]["username"], ip)
        if not _valid_password_shape(new_password) or not new_password.strip():
            raise AuthError(422, "New password must contain 12 to 128 characters.")
        user = self.db.user_for_login(session["user"]["username"])
        if not user or user["disabled"] or user["id"] != session["user"]["id"]:
            raise AuthError(401, "Authentication required.")
        valid_current = _valid_password_shape(current_password)
        candidate = current_password if valid_current else "invalid-current-password"
        verified = self._verify(candidate, user["password_hash"])
        if not verified or not valid_current:
            raise AuthError(401, _INVALID_CREDENTIALS)
        if new_password == current_password:
            raise AuthError(422, "Choose a different new password.")
        password_hash = _hash_operation(_PASSWORD_HASHER.hash, new_password)
        if not self.db.change_password(self._token_hash(rawtoken), csrf_token, user["id"],
                                       user["password_hash"], password_hash):
            raise AuthError(401, "Authentication required.")

    @staticmethod
    def _token_hash(token):
        return hashlib.sha256(token.encode("ascii")).hexdigest()

    def session(self, rawtoken):
        if not isinstance(rawtoken, str) or not _TOKEN.fullmatch(rawtoken):
            raise AuthError(401, "Authentication required.")
        session = self.db.session(self._token_hash(rawtoken), int(self.clock()))
        if session is None:
            raise AuthError(401, "Authentication required.")
        return session

    def logout(self, rawtoken):
        if isinstance(rawtoken, str) and _TOKEN.fullmatch(rawtoken):
            self.db.delete_session(self._token_hash(rawtoken))

    @staticmethod
    def verify_csrf(session_info, header):
        expected = session_info.get("csrf_token")
        return (isinstance(expected, str) and isinstance(header, str) and expected.isascii() and header.isascii()
                and hmac.compare_digest(expected, header))
