"""Explicit, revision-bound advisor access; owner CRUD remains owner-only."""

import json
import time
import uuid

from pydantic import ValidationError

from .db import StorageError
from .models import ArchiveRecord
from .contracts import require_operation
from .security import AuthError, canonical_username


_MAX_REVISION = 9_007_199_254_740_991
_SCOPE = 'full_report_read_only'


class TeacherAccessService:
    def __init__(self, db, clock=time.time):
        self.db = db
        self.clock = clock

    @staticmethod
    def _unavailable():
        return StorageError(404, 'The advisor authorization is unavailable.', 'NOT_FOUND')

    def _actor(self, connection, actor_id, *, advisor=False):
        user = connection.execute('SELECT id,role FROM users WHERE id=? AND disabled=0', (actor_id,)).fetchone()
        if user is None or advisor and user['role'] != 'advisor':
            raise self._unavailable()
        return user

    def _owned(self, connection, owner_id, report_id, *, full=False):
        self._actor(connection, owner_id)
        columns = '*' if full else 'id'
        row = connection.execute('SELECT ' + columns + ' FROM reports WHERE id=? AND owner_id=?', (report_id, owner_id)).fetchone()
        if row is None:
            raise self._unavailable()
        return row

    @staticmethod
    def _query(*, full=False):
        # Ownership is part of the join, not a later check. Source, participants
        # and permission state come from one SQLite snapshot for every read.
        payload = (
            ', reports.archive_id AS archive_id, reports.grade AS report_grade, reports.year AS report_year, '
            'reports.record_json AS record_json, reports.created_at AS report_created_at, reports.updated_at AS report_updated_at '
            if full else ' '
        )
        return (
            'SELECT teacher_grants.*, owner.username AS owner_username, owner.disabled AS owner_disabled, '
            'recipient.username AS recipient_username, recipient.disabled AS recipient_disabled, '
            'recipient.role AS recipient_role, reports.revision AS current_revision, '
            'reports.name AS report_name, reports.report_ref AS report_ref' + payload +
            'FROM teacher_grants JOIN users AS owner ON owner.id=teacher_grants.owner_id '
            'JOIN users AS recipient ON recipient.id=teacher_grants.recipient_id '
            'JOIN reports ON reports.id=teacher_grants.report_id AND reports.owner_id=teacher_grants.owner_id '
        )

    @staticmethod
    def _status(row, now):
        if row['revoked_at'] is not None:
            return 'revoked'
        if row['expires_at'] <= now:
            return 'expired'
        if row['owner_disabled'] or row['recipient_disabled'] or row['recipient_role'] != 'advisor':
            return 'unavailable'
        if row['current_revision'] != row['report_revision']:
            return 'source_changed'
        return 'active'

    def _metadata(self, row, now):
        result = {key: row[key] for key in ('id', 'report_id', 'report_revision', 'report_name', 'report_ref',
                                          'owner_username', 'recipient_username', 'created_at', 'expires_at', 'revoked_at')}
        return {**result, 'scope': _SCOPE, 'status': self._status(row, now)}

    @staticmethod
    def _validated_record(row, *, joined, operation='advisor_read_v1'):
        try:
            record = json.loads(row['record_json'])
            if type(record) is not dict or type(record.get('state')) is not dict:
                raise ValueError('Stored record is malformed')
            require_operation(record, operation)
            ArchiveRecord.model_validate(record)
            # Do not reserialize model defaults into a legacy archive. Validate
            # the exact stored object, then return that object unchanged.
            json.dumps(record, ensure_ascii=False, allow_nan=False).encode('utf-8')
            name_key = 'report_name' if joined else 'name'
            grade_key = 'report_grade' if joined else 'grade'
            year_key = 'report_year' if joined else 'year'
            if (record['state']['info']['name'] != row[name_key]
                    or record['reportMeta']['batchId'] != row['report_ref']
                    or record['id'] != row['archive_id']
                    or record['state']['info']['grade'] != row[grade_key]
                    or record['state']['info']['year'] != row[year_key]):
                raise ValueError('Stored metadata mismatch')
            return record
        except (ValidationError, TypeError, ValueError, KeyError, UnicodeError):
            raise StorageError(503, 'The authorized report is temporarily unavailable.', 'STORAGE') from None

    def create_grant(self, owner_id, report_id, revision, recipient_username, ttl_hours):
        if type(revision) is not int or not 1 <= revision <= _MAX_REVISION:
            raise StorageError(422, 'A positive safe report revision is required.', 'VALIDATION')
        if type(ttl_hours) is not int or ttl_hours not in (24, 72, 168):
            raise StorageError(422, 'Authorization lifetime must be 24, 72 or 168 hours.', 'VALIDATION')
        try:
            recipient_name = canonical_username(recipient_username)
        except AuthError:
            raise StorageError(422, 'The recipient account name is invalid.', 'VALIDATION') from None
        with self.db._transaction() as connection:
            report = self._owned(connection, owner_id, report_id, full=True)
            if report['revision'] != revision:
                raise StorageError(409, 'The report changed; reload it before authorizing an advisor.', 'REVISION')
            recipient = connection.execute('SELECT id,role,disabled FROM users WHERE username=?', (recipient_name,)).fetchone()
            if recipient is not None and recipient['id'] == owner_id:
                raise StorageError(422, 'Authorize a different existing advisor account.', 'VALIDATION')
            if recipient is None or recipient['disabled'] or recipient['role'] != 'advisor':
                raise self._unavailable()
            self._validated_record(report, joined=False)
            # A blocked writer may acquire the transaction after another grant
            # expires; use the time of the actual authorization, not queuing.
            at = int(self.clock())
            duplicate = connection.execute(
                'SELECT id FROM teacher_grants WHERE owner_id=? AND report_id=? AND report_revision=? '
                'AND recipient_id=? AND revoked_at IS NULL AND expires_at>?',
                (owner_id, report_id, revision, recipient['id'], at),
            ).fetchone()
            if duplicate is not None:
                raise StorageError(409, 'This advisor already has an active authorization for this revision.', 'DUPLICATE')
            report_count = connection.execute(
                'SELECT COUNT(*) FROM teacher_grants WHERE owner_id=? AND report_id=?', (owner_id, report_id)
            ).fetchone()[0]
            owner_count = connection.execute(
                'SELECT COUNT(*) FROM teacher_grants WHERE owner_id=? OR recipient_id=?', (owner_id, owner_id)
            ).fetchone()[0]
            recipient_count = connection.execute(
                'SELECT COUNT(*) FROM teacher_grants WHERE owner_id=? OR recipient_id=?', (recipient['id'], recipient['id'])
            ).fetchone()[0]
            if report_count >= 10 or owner_count >= 100 or recipient_count >= 100:
                raise StorageError(413, 'Advisor authorization history is limited to 10 per report and 100 participations per account.', 'LIMIT')
            identifier = str(uuid.uuid4())
            connection.execute(
                'INSERT INTO teacher_grants(id,owner_id,report_id,report_revision,recipient_id,created_at,expires_at,revoked_at) '
                'VALUES(?,?,?,?,?,?,?,NULL)',
                (identifier, owner_id, report_id, revision, recipient['id'], at, at + ttl_hours * 3600),
            )
            row = connection.execute(self._query() + 'WHERE teacher_grants.id=?', (identifier,)).fetchone()
            return self._metadata(row, at)

    def list_for_report(self, owner_id, report_id):
        with self.db._connection() as connection:
            self._owned(connection, owner_id, report_id)
            rows = connection.execute(self._query() + 'WHERE teacher_grants.owner_id=? AND teacher_grants.report_id=? '
                                      'ORDER BY teacher_grants.created_at DESC,teacher_grants.id', (owner_id, report_id)).fetchall()
            at = int(self.clock())
            return {'items': [self._metadata(row, at) for row in rows]}

    def revoke(self, owner_id, report_id, grant_id):
        with self.db._transaction() as connection:
            self._owned(connection, owner_id, report_id)
            row = connection.execute('SELECT id FROM teacher_grants WHERE id=? AND owner_id=? AND report_id=?',
                                     (grant_id, owner_id, report_id)).fetchone()
            if row is None:
                raise self._unavailable()
            connection.execute('UPDATE teacher_grants SET revoked_at=COALESCE(revoked_at,?) WHERE id=?',
                               (int(self.clock()), grant_id))

    def list_for_user(self, recipient_id):
        with self.db._connection() as connection:
            self._actor(connection, recipient_id, advisor=True)
            rows = connection.execute(self._query() + 'WHERE teacher_grants.recipient_id=? '
                                      'ORDER BY teacher_grants.created_at DESC,teacher_grants.id', (recipient_id,)).fetchall()
            at = int(self.clock())
            return {'items': [self._metadata(row, at) for row in rows if self._status(row, at) == 'active']}

    def read(self, recipient_id, grant_id):
        with self.db._connection() as connection:
            row = connection.execute(self._query(full=True) + 'WHERE teacher_grants.id=? AND teacher_grants.recipient_id=?',
                                     (grant_id, recipient_id)).fetchone()
        at = int(self.clock())
        if row is None or self._status(row, at) != 'active':
            raise self._unavailable()
        record = self._validated_record(row, joined=True)
        return {'grant': self._metadata(row, at), 'report': {
            'id': row['report_id'], 'revision': row['current_revision'], 'created_at': row['report_created_at'],
            'updated_at': row['report_updated_at'], 'record': record}}
