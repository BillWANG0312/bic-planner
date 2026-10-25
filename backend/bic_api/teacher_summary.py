"""Selected readonly report counts; no answer sheets leave this service."""

import re
import time

from .db import StorageError
from .models import ASSESSMENT_SCHEMA
from .teacher_access import TeacherAccessService


_SUBJECTS = (('english', 'en'), ('maths', 'ma'), ('physics', 'ph'), ('chemistry', 'ch'))
_OPTIONAL_PLAN = 'weakSubjects'
_ID = re.compile(r'[A-Za-z0-9_-]{1,128}\Z')


class TeacherSummaryService(TeacherAccessService):
    def __init__(self, db, clock=time.time):
        super().__init__(db, clock=clock)

    @staticmethod
    def _invalid():
        return StorageError(422, 'Select 1 to 20 distinct authorized reports with unambiguous references.', 'VALIDATION')

    @staticmethod
    def _completion(row, record):
        if record['bankVersion'] != ASSESSMENT_SCHEMA['bankVersion']:
            raise StorageError(409, 'The selected question bank is unsupported; review the report version before exporting.', 'VERSION')
        state = record['state']
        answers = state['academic']['answers']
        academic = [{'key': key, 'answered': sum(question['id'] in answers and answers[question['id']] is not None
                                                for question in ASSESSMENT_SCHEMA['academic'] if question['id'].startswith(prefix)),
                     'total': 15} for key, prefix in _SUBJECTS]
        plan = state['plan']['answers'].copy()
        # Match generateReport's normalization: known basic-info grade wins.
        if state['info']['grade'] in ASSESSMENT_SCHEMA['grades']:
            plan['grade'] = state['info']['grade']
        grade = plan.get('grade', '')
        if grade not in ASSESSMENT_SCHEMA['grades']:
            grade = ''

        def answered(question):
            key = question['key']
            if key not in plan:
                return False
            value = plan[key]
            return (bool(value) or key == _OPTIONAL_PLAN) if isinstance(value, list) else value is not None and value != ''

        required = [question for question in ASSESSMENT_SCHEMA['plan'] if question['key'] != _OPTIONAL_PLAN]
        planning = {'answered': sum(answered(question) for question in ASSESSMENT_SCHEMA['plan']),
                    'total': len(ASSESSMENT_SCHEMA['plan']), 'required_answered': sum(answered(question) for question in required),
                    'required_total': len(required)}
        personality = {'answered': sum(answer is not None for answer in state['mbti']['answers']),
                       'total': ASSESSMENT_SCHEMA['mbtiCount']}
        complete = (all(subject['answered'] == subject['total'] for subject in academic)
                    and planning['required_answered'] == planning['required_total']
                    and personality['answered'] == personality['total'])
        return {'id': row['report_id'], 'revision': row['current_revision'], 'report_ref': row['report_ref'],
                'name': row['report_name'], 'grade': grade, 'bank_version': record['bankVersion'],
                'catalog_version': record.get('catalogVersion'), 'status': 'complete' if complete else 'draft',
                'academic': academic, 'planning': planning, 'personality': personality}

    def read(self, recipient_id, grant_ids):
        if (type(grant_ids) is not list or not 1 <= len(grant_ids) <= 20
                or any(type(identifier) is not str or not _ID.fullmatch(identifier) for identifier in grant_ids)
                or len(set(grant_ids)) != len(grant_ids)):
            raise self._invalid()
        placeholders = ','.join('?' for _ in grant_ids)
        # Every selected report, both participants, and the bound grant are read
        # from one SQLite snapshot. No follow-up full-report fetch can mix it
        # with a new revision or newly changed authorization.
        with self.db._connection() as connection:
            rows = connection.execute(self._query(full=True)
                                      + 'WHERE teacher_grants.recipient_id=? AND teacher_grants.id IN (' + placeholders + ')',
                                      (recipient_id, *grant_ids)).fetchall()
        at = int(self.clock())
        if len(rows) != len(grant_ids) or any(self._status(row, at) != 'active' for row in rows):
            raise self._unavailable()
        if (len({row['report_id'] for row in rows}) != len(rows)
                or len({row['report_ref'] for row in rows}) != len(rows)):
            raise self._invalid()
        by_id = {row['id']: row for row in rows}
        items = []
        for identifier in grant_ids:
            row = by_id[identifier]
            record = self._validated_record(row, joined=True)
            items.append({'grant': self._metadata(row, at), 'report': self._completion(row, record)})
        return {'format': 'bic-teacher-completion-summary', 'version': 1, 'items': items}
