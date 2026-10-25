"""One-revision, explicitly authorized advice writes and server-derived audits."""

from datetime import datetime, timezone
import json
import time
import uuid

from pydantic import ValidationError

from .db import StorageError
from .models import ArchiveRecord, JS_WHITESPACE, MAX_RECORD_CHARS, _json_utf16_length, bounded_text
from .security import AuthError, canonical_username
from .teacher_access import TeacherAccessService


_SECTIONS = ('summary', 'academic', 'plan', 'personality')
_MAX_REVISION = 9_007_199_254_740_991
_SCOPE = 'full_report_advice_edit'


class AdvisorEditService(TeacherAccessService):
    """Metadata/record checks mirror readonly access; writes never use owner CRUD."""

    def __init__(self, db, clock=time.time):
        super().__init__(db, clock=clock)

    @staticmethod
    def _invalid():
        return StorageError(422, 'The advisor edit request is invalid.', 'VALIDATION')

    @staticmethod
    def _storage():
        return StorageError(503, 'The authorized report is temporarily unavailable.', 'STORAGE')

    @staticmethod
    def _texts(value, *, complete=False):
        if (type(value) is not dict or not value or any(key not in _SECTIONS for key in value)
                or complete and set(value) != set(_SECTIONS)):
            raise AdvisorEditService._invalid()
        try:
            for text in value.values():
                if type(text) is not str:
                    raise ValueError
                bounded_text(4000, required=True)(text)
                text.encode('utf-8')
        except (ValueError, TypeError, UnicodeError):
            raise AdvisorEditService._invalid() from None
        return {key: value[key] for key in _SECTIONS if key in value}

    @staticmethod
    def _revision(value):
        if type(value) is not int or not 1 <= value <= _MAX_REVISION:
            raise AdvisorEditService._invalid()

    @staticmethod
    def _query(*, full=False):
        # Do not SELECT baseline_json in list/revoke operations. Baseline text
        # has the same privacy level as the full report, not its metadata.
        private = (', grants.baseline_json, reports.archive_id, reports.grade AS report_grade, '
                   'reports.year AS report_year, reports.record_json, reports.created_at AS report_created_at, '
                   'reports.updated_at AS report_updated_at ' if full else ' ')
        return (
            'SELECT grants.id,grants.owner_id,grants.report_id,grants.report_revision,grants.recipient_id, '
            'grants.created_at,grants.expires_at,grants.revoked_at, '
            'owner.username AS owner_username,owner.disabled AS owner_disabled, '
            'recipient.username AS recipient_username,recipient.disabled AS recipient_disabled, '
            'recipient.role AS recipient_role,reports.revision AS current_revision, '
            'reports.name AS report_name,reports.report_ref AS report_ref' + private +
            'FROM advisor_edit_grants AS grants JOIN users AS owner ON owner.id=grants.owner_id '
            'JOIN users AS recipient ON recipient.id=grants.recipient_id '
            'JOIN reports ON reports.id=grants.report_id AND reports.owner_id=grants.owner_id '
        )

    def _metadata(self, row, now):
        result = super()._metadata(row, now)
        result['scope'] = _SCOPE
        return result

    def _baseline(self, row, record):
        try:
            baseline = self._texts(json.loads(row['baseline_json']), complete=True)
            self._consistent_baseline(record, baseline)
            return baseline
        except (StorageError, TypeError, ValueError, KeyError):
            raise self._storage() from None

    @staticmethod
    def _consistent_baseline(record, baseline):
        # Only saved overrides are verifiable on this server. Other sections
        # are the owner's explicitly confirmed client-generated rule baseline.
        for key, text in record.get('advisor', {}).get('sections', {}).items():
            if baseline[key] != text:
                raise AdvisorEditService._invalid()

    def create_grant(self, owner_id, report_id, revision, recipient_username, ttl_hours, baseline):
        self._revision(revision)
        baseline = self._texts(baseline, complete=True)
        if type(ttl_hours) is not int or ttl_hours not in (24, 72, 168):
            raise self._invalid()
        try:
            recipient_name = canonical_username(recipient_username)
        except AuthError:
            raise self._invalid() from None
        with self.db._transaction() as connection:
            report = self._owned(connection, owner_id, report_id, full=True)
            if report['revision'] != revision:
                raise StorageError(409, 'The report changed; reload it before granting advice edits.', 'REVISION')
            recipient = connection.execute('SELECT id,role,disabled FROM users WHERE username=?', (recipient_name,)).fetchone()
            if recipient is not None and recipient['id'] == owner_id:
                raise self._invalid()
            if recipient is None or recipient['disabled'] or recipient['role'] != 'advisor':
                raise self._unavailable()
            record = self._validated_record(report, joined=False)
            self._consistent_baseline(record, baseline)
            at = int(self.clock())
            if connection.execute(
                'SELECT id FROM advisor_edit_grants WHERE owner_id=? AND report_id=? AND report_revision=? '
                'AND recipient_id=? AND revoked_at IS NULL AND expires_at>?',
                (owner_id, report_id, revision, recipient['id'], at),
            ).fetchone() is not None:
                raise StorageError(409, 'This advisor already has active edit permission for this revision.', 'DUPLICATE')
            report_count = connection.execute('SELECT COUNT(*) FROM advisor_edit_grants WHERE owner_id=? AND report_id=?',
                                               (owner_id, report_id)).fetchone()[0]
            participant_count = lambda person: connection.execute(
                'SELECT COUNT(*) FROM advisor_edit_grants WHERE owner_id=? OR recipient_id=?', (person, person)).fetchone()[0]
            if report_count >= 10 or participant_count(owner_id) >= 100 or participant_count(recipient['id']) >= 100:
                raise StorageError(413, 'Edit authorization history is limited to 10 per report and 100 participations per account.', 'LIMIT')
            identifier = str(uuid.uuid4())
            connection.execute(
                'INSERT INTO advisor_edit_grants(id,owner_id,report_id,report_revision,recipient_id,baseline_json,created_at,expires_at,revoked_at) '
                'VALUES(?,?,?,?,?,?,?,?,NULL)',
                (identifier, owner_id, report_id, revision, recipient['id'], json.dumps(baseline, ensure_ascii=False), at, at + ttl_hours * 3600),
            )
            row = connection.execute(self._query() + 'WHERE grants.id=?', (identifier,)).fetchone()
            return self._metadata(row, at)

    def list_for_report(self, owner_id, report_id):
        with self.db._connection() as connection:
            self._owned(connection, owner_id, report_id)
            rows = connection.execute(self._query() + 'WHERE grants.owner_id=? AND grants.report_id=? '
                                      'ORDER BY grants.created_at DESC,grants.id', (owner_id, report_id)).fetchall()
            at = int(self.clock())
            return {'items': [self._metadata(row, at) for row in rows]}

    def revoke(self, owner_id, report_id, grant_id):
        with self.db._transaction() as connection:
            self._owned(connection, owner_id, report_id)
            if connection.execute('SELECT id FROM advisor_edit_grants WHERE id=? AND owner_id=? AND report_id=?',
                                  (grant_id, owner_id, report_id)).fetchone() is None:
                raise self._unavailable()
            connection.execute('UPDATE advisor_edit_grants SET revoked_at=COALESCE(revoked_at,?) WHERE id=?',
                               (int(self.clock()), grant_id))

    def list_for_user(self, recipient_id):
        with self.db._connection() as connection:
            self._actor(connection, recipient_id, advisor=True)
            rows = connection.execute(self._query() + 'WHERE grants.recipient_id=? ORDER BY grants.created_at DESC,grants.id',
                                      (recipient_id,)).fetchall()
            at = int(self.clock())
            return {'items': [self._metadata(row, at) for row in rows if self._status(row, at) == 'active']}

    def _active(self, connection, recipient_id, grant_id):
        row = connection.execute(self._query(full=True) + 'WHERE grants.id=? AND grants.recipient_id=?',
                                 (grant_id, recipient_id)).fetchone()
        at = int(self.clock())
        if row is None or self._status(row, at) != 'active':
            raise self._unavailable()
        return row, at

    @staticmethod
    def _full(row, record):
        return {'id': row['report_id'], 'revision': row['current_revision'], 'created_at': row['report_created_at'],
                'updated_at': row['report_updated_at'], 'record': record}

    def read(self, recipient_id, grant_id):
        with self.db._connection() as connection:
            row, at = self._active(connection, recipient_id, grant_id)
        record = self._validated_record(row, joined=True)
        return {'grant': self._metadata(row, at), 'report': self._full(row, record), 'baseline': self._baseline(row, record)}

    def apply(self, recipient_id, grant_id, revision, changes):
        self._revision(revision)
        changes = self._texts(changes)
        with self.db._transaction() as connection:
            # This locked snapshot is also where the authenticated actor name
            # is read; neither author, before text nor full records are inputs.
            row, at = self._active(connection, recipient_id, grant_id)
            if revision != row['current_revision']:
                raise StorageError(409, 'The requested source revision differs from this authorization.', 'REVISION')
            record = self._validated_record(row, joined=True)
            baseline = self._baseline(row, record)
            modifications = [{'section': key, 'before': baseline[key], 'after': text.strip(JS_WHITESPACE)}
                             for key, text in changes.items() if text.strip(JS_WHITESPACE) != baseline[key].strip(JS_WHITESPACE)]
            if not modifications:
                return {'report': self._full(row, record), 'changed_sections': [], 'audit_id': None}
            if revision >= _MAX_REVISION:
                raise StorageError(413, 'The report revision limit has been reached.', 'LIMIT')
            advisor = record.setdefault('advisor', {'sections': {}, 'history': []})
            if len(advisor['history']) + len(modifications) > 200:
                raise StorageError(413, 'The report edit history limit is 200 entries.', 'LIMIT')
            timestamp = datetime.fromtimestamp(self.clock(), timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
            actor = {'kind': 'school_advisor', 'user_id': recipient_id, 'username': row['recipient_username'],
                     'grant_id': grant_id, 'source_revision': revision, 'result_revision': revision + 1}
            for item in modifications:
                advisor['sections'][item['section']] = item['after']
                advisor['history'].append({'id': str(uuid.uuid4()), 'at': timestamp, 'author': '学校顾问',
                                           **item, 'action': 'edit', 'reportId': record['reportMeta']['batchId'], 'actor': actor.copy()})
            advisor['lastAuthor'] = '学校顾问'
            record['updatedAt'] = timestamp
            # Model validation also enforces this bound. Identify predictable
            # expansion (notably JSON-escaped control text) as a definite quota
            # refusal before the generic corrupt-storage error path.
            if _json_utf16_length(record) > MAX_RECORD_CHARS:
                raise StorageError(413, 'The serialized report size limit has been reached.', 'LIMIT')
            try:
                ArchiveRecord.model_validate(record)
            except (ValidationError, TypeError, ValueError):
                raise self._storage() from None
            serialized, units, _ = self.db._encode_record(record)
            current_units = connection.execute('SELECT utf16_units FROM reports WHERE id=?', (row['report_id'],)).fetchone()[0]
            self.db._quota(connection, row['owner_id'], units - current_units, 0)
            result = connection.execute(
                'UPDATE reports SET revision=revision+1,updated_at=?,record_json=?,utf16_units=? '
                'WHERE id=? AND owner_id=? AND revision=?',
                (timestamp, serialized, units, row['report_id'], row['owner_id'], revision),
            )
            if result.rowcount != 1:
                raise StorageError(409, 'The report changed before applying advice.', 'REVISION')
            audit_id = str(uuid.uuid4())
            connection.execute(
                'INSERT INTO advisor_edits(id,owner_id,report_id,grant_id,actor_id,actor_username,source_revision,result_revision,created_at,changes_json) '
                'VALUES(?,?,?,?,?,?,?,?,?,?)',
                (audit_id, row['owner_id'], row['report_id'], grant_id, recipient_id, row['recipient_username'], revision, revision + 1,
                 at, json.dumps(modifications, ensure_ascii=False, separators=(',', ':'))),
            )
            saved = connection.execute('SELECT * FROM reports WHERE id=?', (row['report_id'],)).fetchone()
            return {'report': self.db._full_report(saved), 'changed_sections': [item['section'] for item in modifications], 'audit_id': audit_id}

    def list_audit(self, owner_id, report_id):
        with self.db._connection() as connection:
            # A LEFT JOIN keeps an authorized empty history distinguishable
            # from an unavailable report. The enabled-owner condition and the
            # private before/after text are read from the same SQLite snapshot.
            rows = connection.execute(
                'SELECT reports.id AS owned_report_id,advisor_edits.id,advisor_edits.grant_id,advisor_edits.report_id, '
                'advisor_edits.actor_id,advisor_edits.actor_username,advisor_edits.source_revision, '
                'advisor_edits.result_revision,advisor_edits.created_at,advisor_edits.changes_json '
                'FROM reports JOIN users AS owner ON owner.id=reports.owner_id AND owner.disabled=0 '
                'LEFT JOIN advisor_edits ON advisor_edits.report_id=reports.id AND advisor_edits.owner_id=owner.id '
                'WHERE owner.id=? AND reports.id=? ORDER BY advisor_edits.created_at DESC,advisor_edits.id',
                (owner_id, report_id),
            ).fetchall()
        if not rows:
            raise self._unavailable()
        items = []
        try:
            for row in rows:
                if row['id'] is None:
                    continue
                changes = json.loads(row['changes_json'])
                if (not isinstance(changes, list) or not 1 <= len(changes) <= 4
                        or len({item['section'] for item in changes}) != len(changes)):
                    raise ValueError
                for item in changes:
                    if type(item) is not dict or set(item) != {'section', 'before', 'after'} or item['section'] not in _SECTIONS:
                        raise ValueError
                    if type(item['before']) is not str or type(item['after']) is not str:
                        raise ValueError
                    bounded_text(4000)(item['before'])
                    bounded_text(4000, required=True)(item['after'])
                items.append({**{key: row[key] for key in row.keys() if key not in ('changes_json', 'owned_report_id')}, 'changes': changes})
        except (TypeError, ValueError, KeyError):
            raise self._storage() from None
        return {'items': items}
