"""Account-bound report invitations and private append-only comment threads."""

from collections import OrderedDict, deque
import json
import math
import threading
import time
import uuid

from pydantic import TypeAdapter, ValidationError

from .comment_models import CommentText, RequestId
from .db import StorageError
from .security import AuthError, canonical_username
from .share_models import ParentSnapshot, ShareContent, build_parent_snapshot


_BODY = TypeAdapter(CommentText)
_NONCE = TypeAdapter(RequestId)
_UNAVAILABLE = 'The invitation is unavailable.'


class CommentService:
    def __init__(self, db, clock=time.time):
        self.db = db
        self.clock = clock
        self._attempts = OrderedDict()
        self._attempt_lock = threading.Lock()

    @staticmethod
    def _unavailable():
        return StorageError(404, _UNAVAILABLE, 'NOT_FOUND')

    def _actor(self, connection, actor_id):
        user = connection.execute('SELECT id FROM users WHERE id=? AND disabled=0', (actor_id,)).fetchone()
        if user is None:
            raise self._unavailable()

    def _owned(self, connection, owner_id, report_id):
        self._actor(connection, owner_id)
        report = connection.execute('SELECT * FROM reports WHERE owner_id=? AND id=?',
                                    (owner_id, report_id)).fetchone()
        if report is None:
            raise self._unavailable()
        return report

    @staticmethod
    def _status(row, now):
        if row['revoked_at'] is not None:
            return 'revoked'
        if row['expires_at'] <= now:
            return 'expired'
        if row['owner_disabled'] or row['recipient_disabled']:
            return 'unavailable'
        return 'active'

    @staticmethod
    def _snapshot(row):
        try:
            return ParentSnapshot.model_validate_json(row['snapshot_json']).model_dump(mode='json')
        except (ValidationError, ValueError, TypeError):
            raise StorageError(503, 'The invitation summary is temporarily unavailable.', 'STORAGE') from None

    def _metadata(self, row, now):
        snapshot = self._snapshot(row)
        result = {key: row[key] for key in ('id', 'report_id', 'report_revision', 'recipient_username',
                                          'created_at', 'expires_at', 'revoked_at')}
        return {**result, 'report_name': snapshot['report']['name'], 'report_ref': snapshot['report']['batchId'],
                'status': self._status(row, now)}

    @staticmethod
    def _query():
        # Include ownership in the join too, so a corrupted foreign owner/report
        # combination cannot grant another account's data even if SQL is edited.
        return ('SELECT parent_grants.*, owner.disabled AS owner_disabled, '
                'recipient.disabled AS recipient_disabled, recipient.username AS recipient_username '
                'FROM parent_grants JOIN users AS owner ON owner.id=parent_grants.owner_id '
                'JOIN users AS recipient ON recipient.id=parent_grants.recipient_id '
                'JOIN reports ON reports.id=parent_grants.report_id AND reports.owner_id=parent_grants.owner_id ')

    def _grant(self, connection, actor_id, grant_id, require_active=False):
        self._actor(connection, actor_id)
        row = connection.execute(self._query() + 'WHERE parent_grants.id=? AND '
                                 '(parent_grants.owner_id=? OR parent_grants.recipient_id=?)',
                                 (grant_id, actor_id, actor_id)).fetchone()
        if row is None:
            raise self._unavailable()
        owner = row['owner_id'] == actor_id
        if (require_active or not owner) and self._status(row, int(self.clock())) != 'active':
            raise self._unavailable()
        return row, 'owner' if owner else 'recipient'

    def create_grant(self, owner_id, report_id, revision, recipient_username, ttl_hours, contentdict):
        try:
            recipient_name = canonical_username(recipient_username)
            content = ShareContent.model_validate(contentdict).model_dump(mode='json')
        except (AuthError, ValidationError, TypeError, ValueError):
            raise StorageError(422, 'Invitation parameters or summary are invalid.', 'VALIDATION') from None
        if type(ttl_hours) is not int or ttl_hours not in (24, 72, 168):
            raise StorageError(422, 'Invitation lifetime must be 24, 72 or 168 hours.', 'VALIDATION')
        at = int(self.clock())
        expiry = at + ttl_hours * 3600
        identifier = str(uuid.uuid4())
        with self.db._transaction() as connection:
            report = self._owned(connection, owner_id, report_id)
            if type(revision) is not int or report['revision'] != revision:
                raise StorageError(409, 'The report changed; reload it before inviting.', 'REVISION')
            recipient = connection.execute('SELECT id FROM users WHERE username=? AND disabled=0',
                                           (recipient_name,)).fetchone()
            if recipient is None:
                raise self._unavailable()
            if recipient['id'] == owner_id:
                raise StorageError(422, 'Invite a different existing account.', 'VALIDATION')
            try:
                record = json.loads(report['record_json'])
            except (TypeError, ValueError):
                raise StorageError(503, 'The source report is temporarily unavailable.', 'STORAGE') from None
            try:
                snapshot = build_parent_snapshot(record, report['revision'], at, expiry, content)
                serialized = json.dumps(snapshot, ensure_ascii=False, separators=(',', ':'), allow_nan=False)
                serialized.encode('utf-8')
            except (ValidationError, ValueError, TypeError, KeyError, UnicodeError):
                raise StorageError(422, 'The source cannot produce a valid summary.', 'VALIDATION') from None
            count = connection.execute(
                'SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN owner_id=? AND report_id=? THEN 1 ELSE 0 END),0) AS report_count '
                'FROM parent_grants WHERE owner_id=? OR recipient_id=?',
                (owner_id, report_id, owner_id, owner_id)).fetchone()
            recipient_count = connection.execute(
                'SELECT COUNT(*) FROM parent_grants WHERE owner_id=? OR recipient_id=?',
                (recipient['id'], recipient['id'])).fetchone()[0]
            if count['total'] >= 100 or recipient_count >= 100 or count['report_count'] >= 10:
                raise StorageError(413, 'Invitation history limit is 10 per report and 100 participations per account.', 'LIMIT')
            connection.execute(
                'INSERT INTO parent_grants(id,owner_id,report_id,report_revision,recipient_id,snapshot_json,created_at,expires_at,revoked_at) '
                'VALUES(?,?,?,?,?,?,?,?,NULL)',
                (identifier, owner_id, report_id, report['revision'], recipient['id'], serialized, at, expiry))
            row = connection.execute(self._query() + 'WHERE parent_grants.id=?', (identifier,)).fetchone()
            return self._metadata(row, at)

    def list_for_report(self, owner_id, report_id):
        at = int(self.clock())
        with self.db._connection() as connection:
            self._owned(connection, owner_id, report_id)
            rows = connection.execute(self._query() + 'WHERE parent_grants.owner_id=? AND parent_grants.report_id=? '
                                      'ORDER BY parent_grants.created_at DESC,parent_grants.id',
                                      (owner_id, report_id)).fetchall()
            return {'items': [self._metadata(row, at) for row in rows]}

    def list_for_user(self, user_id):
        at = int(self.clock())
        with self.db._connection() as connection:
            self._actor(connection, user_id)
            rows = connection.execute(self._query() + 'WHERE parent_grants.owner_id=? OR parent_grants.recipient_id=? '
                                      'ORDER BY parent_grants.created_at DESC,parent_grants.id', (user_id, user_id)).fetchall()
            return {'items': [self._metadata(row, at) for row in rows
                              if row['owner_id'] == user_id or self._status(row, at) == 'active']}

    def revoke(self, owner_id, report_id, grant_id):
        with self.db._transaction() as connection:
            self._owned(connection, owner_id, report_id)
            row = connection.execute('SELECT id FROM parent_grants WHERE id=? AND owner_id=? AND report_id=?',
                                     (grant_id, owner_id, report_id)).fetchone()
            if row is None:
                raise self._unavailable()
            connection.execute('UPDATE parent_grants SET revoked_at=COALESCE(revoked_at,?) WHERE id=?',
                               (int(self.clock()), grant_id))

    @staticmethod
    def _comment(row, grant):
        author = 'owner' if row['author_id'] == grant['owner_id'] else 'recipient' if row['author_id'] == grant['recipient_id'] else None
        if author is None:
            raise StorageError(503, 'The comment thread is temporarily unavailable.', 'STORAGE')
        return {'id': row['id'], 'author': author, 'body': row['body'], 'created_at': row['created_at'],
                'client_request_id': row['request_id']}

    def thread(self, user_id, grant_id):
        with self.db._transaction() as connection:
            row, participant = self._grant(connection, user_id, grant_id)
            comments = connection.execute('SELECT * FROM parent_comments WHERE grant_id=? ORDER BY sequence',
                                          (grant_id,)).fetchall()
            return {'grant': self._metadata(row, int(self.clock())), 'snapshot': self._snapshot(row),
                    'comments': [self._comment(comment, row) for comment in comments], 'participant': participant,
                    'can_comment': self._status(row, int(self.clock())) == 'active' and len(comments) < 100}

    def _allow_write(self, actor_id):
        now = self.clock()
        with self._attempt_lock:
            attempts = self._attempts.setdefault(actor_id, deque())
            self._attempts.move_to_end(actor_id)
            while attempts and attempts[0] <= now - 60:
                attempts.popleft()
            while len(self._attempts) > 10_000:
                self._attempts.popitem(last=False)
            if len(attempts) >= 10:
                raise AuthError(429, 'Too many comment attempts; try again later.', max(1, math.ceil(attempts[0] + 60 - now)))
            attempts.append(now)

    def add_comment(self, user_id, grant_id, body, client_request_id):
        try:
            text = _BODY.validate_python(body)
            nonce = _NONCE.validate_python(client_request_id)
        except (ValidationError, ValueError, TypeError):
            raise StorageError(422, 'A nonblank comment up to 1000 UTF-16 units and a UUID request ID are required.', 'VALIDATION') from None
        with self.db._transaction() as connection:
            grant, _ = self._grant(connection, user_id, grant_id, require_active=True)
            previous = connection.execute('SELECT * FROM parent_comments WHERE grant_id=? AND author_id=? AND request_id=?',
                                          (grant_id, user_id, nonce)).fetchone()
            if previous is not None and previous['body'] == text:
                return self._comment(previous, grant)
            if previous is not None:
                raise StorageError(409, 'This request ID already belongs to a different comment.', 'IDEMPOTENCY')
            self._allow_write(user_id)
            count = connection.execute('SELECT COUNT(*) FROM parent_comments WHERE grant_id=?', (grant_id,)).fetchone()[0]
            if count >= 100:
                raise StorageError(413, 'A private thread supports at most 100 comments.', 'LIMIT')
            identifier = str(uuid.uuid4())
            connection.execute('INSERT INTO parent_comments(id,grant_id,author_id,body,request_id,created_at,sequence) '
                               'VALUES(?,?,?,?,?,?,?)', (identifier, grant_id, user_id, text, nonce, int(self.clock()), count + 1))
            row = connection.execute('SELECT * FROM parent_comments WHERE id=?', (identifier,)).fetchone()
            return self._comment(row, grant)
