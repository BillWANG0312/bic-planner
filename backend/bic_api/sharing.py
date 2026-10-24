"""Owner-authorized summary snapshots; anonymous tokens grant reads only."""

from collections import OrderedDict, deque
import hashlib
import json
import math
import re
import secrets
import threading
import time
import uuid

from pydantic import ValidationError

from .db import StorageError
from .security import AuthError
from .share_models import ParentSnapshot, ShareContent


_TOKEN = re.compile(r'[A-Za-z0-9_-]{43}\Z', re.ASCII)
_UNAVAILABLE = 'Shared report is unavailable.'


class ShareService:
    def __init__(self, db, clock=time.time):
        self.db = db
        self.clock = clock
        self._reads = OrderedDict()
        self._read_lock = threading.Lock()

    @staticmethod
    def _unavailable():
        return StorageError(404, _UNAVAILABLE, 'NOT_FOUND')

    @staticmethod
    def _owned_report(connection, owner_id, report_id):
        row = connection.execute(
            'SELECT reports.* FROM reports JOIN users ON users.id=reports.owner_id '
            'WHERE reports.owner_id=? AND reports.id=? AND users.disabled=0',
            (owner_id, report_id),
        ).fetchone()
        if row is None:
            raise StorageError(404, 'Report not found.', 'NOT_FOUND')
        return row

    @staticmethod
    def _metadata(row, now):
        result = {key: row[key] for key in ('id', 'report_id', 'report_revision', 'created_at', 'expires_at', 'revoked_at')}
        result['status'] = 'revoked' if row['revoked_at'] is not None else 'expired' if row['expires_at'] <= now else 'active'
        return result

    def create(self, owner_id, report_id, revision, ttl_hours, contentdict):
        if type(ttl_hours) is not int or ttl_hours not in (24, 72, 168):
            raise StorageError(422, 'Share lifetime must be 24, 72 or 168 hours.', 'VALIDATION')
        try:
            content = ShareContent.model_validate(contentdict).model_dump(mode='json')
        except (ValidationError, ValueError, TypeError):
            raise StorageError(422, 'The public summary is invalid.', 'VALIDATION') from None
        at = int(self.clock())
        expiry = at + ttl_hours * 3600
        identifier = str(uuid.uuid4())
        token = secrets.token_urlsafe(32)
        token_hash = hashlib.sha256(token.encode('ascii')).hexdigest()
        with self.db._transaction() as connection:
            current = self._owned_report(connection, owner_id, report_id)
            if type(revision) is not int or current['revision'] != revision:
                raise StorageError(409, 'The report changed; reload it before sharing.', 'REVISION')
            try:
                record = json.loads(current['record_json'])
            except (ValueError, TypeError):
                raise StorageError(503, 'The stored report is temporarily unavailable.', 'STORAGE') from None
            try:
                snapshot = ParentSnapshot.model_validate({
                    'format': 'bic-parent-summary', 'version': 1, 'shared_at': at, 'expires_at': expiry,
                    'report': {'name': record['state']['info']['name'], 'grade': record['state']['info']['grade'],
                               'year': record['state']['info']['year'], 'batchId': record['reportMeta']['batchId'],
                               'date': record['reportMeta']['date'], 'bankVersion': record['bankVersion'],
                               'catalogVersion': record.get('catalogVersion'), 'revision': current['revision']},
                    'content': content,
                }).model_dump(mode='json')
                serialized = json.dumps(snapshot, ensure_ascii=False, separators=(',', ':'), allow_nan=False)
                serialized.encode('utf-8')
            except (ValidationError, ValueError, TypeError, KeyError, UnicodeError):
                raise StorageError(422, 'The report cannot produce a valid public summary.', 'VALIDATION') from None
            # Expired/revoked tokens already deny reads. Pruning them here keeps
            # retained rows bounded without modifying an active snapshot.
            connection.execute('DELETE FROM shares WHERE owner_id=? AND (expires_at<=? OR revoked_at IS NOT NULL)', (owner_id, at))
            usage = connection.execute(
                'SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN report_id=? THEN 1 ELSE 0 END),0) AS report_count '
                'FROM shares WHERE owner_id=?', (report_id, owner_id),
            ).fetchone()
            if usage['total'] >= 100 or usage['report_count'] >= 5:
                raise StorageError(413, 'Active share limit is 5 per report and 100 per account.', 'LIMIT')
            connection.execute(
                'INSERT INTO shares (id,owner_id,report_id,report_revision,token_hash,snapshot_json,created_at,expires_at,revoked_at) '
                'VALUES (?,?,?,?,?,?,?,?,NULL)',
                (identifier, owner_id, report_id, revision, token_hash, serialized, at, expiry),
            )
            row = connection.execute('SELECT * FROM shares WHERE id=?', (identifier,)).fetchone()
            result = self._metadata(row, at)
        return {**result, 'token': token}

    def list(self, owner_id, report_id):
        at = int(self.clock())
        with self.db._connection() as connection:
            self._owned_report(connection, owner_id, report_id)
            rows = connection.execute('SELECT * FROM shares WHERE owner_id=? AND report_id=? ORDER BY created_at DESC,id',
                                      (owner_id, report_id)).fetchall()
        return {'items': [self._metadata(row, at) for row in rows]}

    def revoke(self, owner_id, report_id, share_id):
        with self.db._transaction() as connection:
            self._owned_report(connection, owner_id, report_id)
            row = connection.execute('SELECT id FROM shares WHERE id=? AND owner_id=? AND report_id=?',
                                     (share_id, owner_id, report_id)).fetchone()
            if row is None:
                raise self._unavailable()
            connection.execute('UPDATE shares SET revoked_at=COALESCE(revoked_at,?) WHERE id=? AND owner_id=? AND report_id=?',
                               (int(self.clock()), share_id, owner_id, report_id))

    def _allow_read(self, ip):
        now = self.clock()
        key = str(ip)[:256]
        with self._read_lock:
            attempts = self._reads.setdefault(key, deque())
            self._reads.move_to_end(key)
            while attempts and attempts[0] <= now - 60:
                attempts.popleft()
            while len(self._reads) > 10_000:
                self._reads.popitem(last=False)
            if len(attempts) >= 60:
                retry = max(1, math.ceil(attempts[0] + 60 - now))
                raise AuthError(429, 'Too many share reads; try again later.', retry_after=retry)
            attempts.append(now)

    def read(self, token, ip):
        self._allow_read(ip)
        if not isinstance(token, str) or not _TOKEN.fullmatch(token):
            raise self._unavailable()
        at = int(self.clock())
        token_hash = hashlib.sha256(token.encode('ascii')).hexdigest()
        with self.db._connection() as connection:
            row = connection.execute(
                'SELECT shares.snapshot_json FROM shares JOIN users ON users.id=shares.owner_id '
                'JOIN reports ON reports.id=shares.report_id AND reports.owner_id=shares.owner_id '
                'WHERE shares.token_hash=? AND shares.revoked_at IS NULL AND shares.expires_at>? AND users.disabled=0',
                (token_hash, at),
            ).fetchone()
        if row is None:
            raise self._unavailable()
        try:
            return ParentSnapshot.model_validate_json(row['snapshot_json']).model_dump(mode='json')
        except (ValidationError, ValueError, TypeError):
            raise StorageError(503, 'The shared summary is temporarily unavailable.', 'STORAGE') from None
