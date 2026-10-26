"""Selected readonly report counts; no answer sheets leave this service."""

import re
import time

from .db import StorageError
from .models import ASSESSMENT_SCHEMA
from .contracts import require_operation
from .teacher_access import TeacherAccessService
from . import academic_scoring, preference_summary


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
        require_operation(record, 'teacher_completion_v1')
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

    def read(self, recipient_id, grant_ids, academic=False, preferences=False):
        if (type(academic) is not bool or type(preferences) is not bool or type(grant_ids) is not list or not 1 <= len(grant_ids) <= 20
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
        scoring_records = []
        for identifier in grant_ids:
            row = by_id[identifier]
            record = self._validated_record(row, joined=True, operation='teacher_completion_v1')
            items.append({'grant': self._metadata(row, at), 'report': self._completion(row, record)})
            if academic or preferences:
                scoring_records.append(record)
        result = {'format': 'bic-teacher-completion-summary', 'version': 1, 'items': items}
        if academic:
            for record in scoring_records:
                require_operation(record, 'teacher_academic_v2')
            rules = academic_scoring.load_rules()
            for record, item in zip(scoring_records, items):
                item['report']['performance'] = academic_scoring.grade(record, rules)
            result.update(version=2, scoring=academic_scoring.scoring_metadata(rules))
        if preferences:
            for record in scoring_records:
                require_operation(record, 'teacher_preferences_v3')
            schema = preference_summary.load_schema()
            for record, item in zip(scoring_records, items):
                item['report']['preferences'] = preference_summary.project(record, schema)
            result.update(version=3, options={'academic': academic, 'preferences': True},
                          preference_schema=preference_summary.metadata(schema))
        return result
