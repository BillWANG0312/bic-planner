"""One-time test codes and anonymous participant sessions.

学生不建立账号：管理员创建一次性测试码，学生凭码加入并在本机完成测评，
报告按码归档。参与者 Cookie 只用于本次作答和一次提交，提交后不再提供
事后查看接口。
"""

from collections import OrderedDict, deque
import hashlib
import math
import re
import secrets
import threading
import time

from .db import StorageError


_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"
_CODE_LENGTH = 10
_CODE = re.compile(r"[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{10}\Z", re.ASCII)
_TOKEN = re.compile(r"[A-Za-z0-9_-]{43}\Z", re.ASCII)
_CLEAN = re.compile(r"[\s-]+")
_SESSION_TTL = 12 * 60 * 60


def normalize_code(value):
    if not isinstance(value, str):
        raise StorageError(422, "Enter a valid test code.", "VALIDATION")
    cleaned = _CLEAN.sub("", value).upper()
    if not _CODE.fullmatch(cleaned):
        raise StorageError(422, "Enter a valid test code.", "VALIDATION")
    return cleaned


def _token_hash(token):
    return hashlib.sha256(token.encode("ascii")).hexdigest()


class TestCodeService:
    def __init__(self, db, clock=time.time):
        self.db = db
        self.clock = clock
        self._attempts = OrderedDict()
        self._lock = threading.Lock()

    def _check_attempts(self, code, ip):
        """Limit both code guessing and per-source flooding."""
        now = self.clock()
        dimensions = (("code", code, 10), ("ip", str(ip)[:256], 30))
        with self._lock:
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
            while len(self._attempts) > 10_000:
                self._attempts.popitem(last=False)
            if retry_after:
                raise StorageError(429, "Too many test code attempts; try again later.", "RATE_LIMIT")
            for attempts in buckets:
                attempts.append(now)

    def create(self, actor_id, label, expires_in_hours):
        if not isinstance(label, str):
            raise StorageError(422, "The label is invalid.", "VALIDATION")
        cleaned = label.strip()
        if not cleaned or len(cleaned) > 80 or any(ord(character) < 32 for character in cleaned):
            raise StorageError(422, "The label must contain 1 to 80 printable characters.", "VALIDATION")
        if type(expires_in_hours) is not int or not 1 <= expires_in_hours <= 720:
            raise StorageError(422, "The expiry must be between 1 and 720 hours.", "VALIDATION")
        expires_at = int(self.clock()) + expires_in_hours * 3600
        for _ in range(10):
            code = "".join(secrets.choice(_ALPHABET) for _ in range(_CODE_LENGTH))
            try:
                row = self.db.create_test_code(actor_id, code, cleaned, expires_at)
            except StorageError as error:
                if error.code == "DUPLICATE":
                    continue
                raise
            return self._public(row)
        raise StorageError(503, "A test code could not be generated; try again.", "UNAVAILABLE")

    def list(self, limit=50, offset=0):
        return self.db.list_test_codes(limit, offset)

    def revoke(self, identifier):
        return self._public(self.db.revoke_test_code(identifier))

    def join(self, code, ip, current_token=None):
        canonical = normalize_code(code)
        self._check_attempts(canonical, ip)
        token = current_token if isinstance(current_token, str) and _TOKEN.fullmatch(current_token) else None
        if token is None:
            token = secrets.token_urlsafe(32)
        row, created = self.db.redeem_test_code(canonical, _token_hash(token), int(self.clock()))
        expires_at = min(row["expires_at"], int(self.clock()) + _SESSION_TTL)
        return {"token": token, "label": row["label"], "expires_at": expires_at, "resumed": not created}

    def session(self, token):
        if not isinstance(token, str) or not _TOKEN.fullmatch(token):
            return None
        row = self.db.active_test_session(_token_hash(token), int(self.clock()))
        if row is None:
            return None
        # 参与者会话最长 12 小时，即使测试码本身还有更长的有效期。
        row["expires_at"] = min(row["expires_at"], int(self.clock()) + _SESSION_TTL)
        return row

    def submit(self, token, record):
        if not isinstance(token, str) or not _TOKEN.fullmatch(token):
            raise StorageError(401, "Join with a valid test code before submitting.", "AUTH")
        row = self.db.test_code_for_token(_token_hash(token))
        if row is None:
            raise StorageError(401, "Join with a valid test code before submitting.", "AUTH")
        if row["revoked_at"] is not None:
            raise StorageError(410, "This test code has been revoked.", "REVOKED")
        if row["expires_at"] <= int(self.clock()) and row["completed_at"] is None:
            raise StorageError(410, "This test code has expired.", "EXPIRED")
        report, created = self.db.create_student_report(row["id"], record)
        return {"id": report["id"], "created_at": report["created_at"], "created": created,
                "label": row["label"]}

    @staticmethod
    def _public(row):
        return {"id": row["id"], "code": row["code"], "label": row["label"],
                "created_at": row["created_at"], "expires_at": row["expires_at"],
                "revoked_at": row["revoked_at"], "report_id": row.get("report_id")}
