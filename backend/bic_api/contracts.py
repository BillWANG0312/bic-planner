"""Assessment shape and operation compatibility; never account authorization.

The new model is a foundation only. No current-profile operation is advertised
until its complete application and browser flow has been implemented.
"""

import copy
import re

from .db import StorageError
from .models import ArchiveRecord


LEGACY = 'legacy-2026.10'
CURRENT = 'games-traits-v1'
OPERATIONS = ('owner_archive', 'parent_summary_v1', 'family_comments_v1', 'advisor_read_v1',
              'advisor_edit_v1', 'advice_draft_v1', 'teacher_completion_v1',
              'teacher_academic_v2', 'teacher_preferences_v3')
_OLD_CAREERS = {'researcher', 'tech', 'finance', 'medicine', 'law', 'creative', 'entrepreneur', 'unsure'}
_NEW_CAREERS = {'ideas', 'people', 'systems', 'science', 'build', 'market'}
_DERIVED_MAJORS = {'cs', 'phys', 'chem', 'bio', 'biz', 'law', 'psych', 'design', 'intl'}
_METADATA_KEYS = {'profile', 'contract_version', 'contract_fingerprint', 'bank_version',
                  'personality_version', 'planning_total', 'planning_required', 'personality_total'}


def _unsupported():
    return StorageError(422, 'This assessment profile is unsupported for the requested operation.', 'PROFILE')


def profile_for_record(record):
    """Identify only the profile evidence; validate_archive checks its full shape.

    Legacy archives have no marker. An explicit new marker is required here,
    even though the local recovery reader can retain issued unmarked new data.
    Unknown, nested, converted and mixed forms cannot enter legacy projections.
    """
    if type(record) is not dict or type(record.get('state')) is not dict:
        raise _unsupported()
    state = record['state']
    if 'assessmentProfile' in state:
        raise _unsupported()
    if ('mbti' in state and type(state['mbti']) is not dict
            or 'plan' in state and type(state['plan']) is not dict):
        raise _unsupported()
    personality = state.get('mbti', {})
    planning = state.get('plan', {}).get('answers', {})
    answers = personality.get('answers', [])
    if type(planning) is not dict or 'legacy' in personality or type(answers) is not list or len(answers) > 30:
        raise _unsupported()
    numeric = structured = False
    for answer in answers:
        if answer is None:
            continue
        if type(answer) in (int, float) and answer in (0, 1, 2, 3, 4):
            numeric = True
        elif type(answer) is dict:
            structured = True
        else:
            raise _unsupported()
    careers = planning.get('career')
    majors = planning.get('preferredMajor')
    old = (any(key in planning for key in ('groupSize', 'timeStyle'))
           or type(careers) is list and any(type(value) is str and value in _OLD_CAREERS for value in careers))
    modern = (structured or len(answers) > 24 or any(key in planning for key in ('subjectBoard', 'majorBoard', 'team'))
              or type(careers) is list and any(type(value) is str and value in _NEW_CAREERS for value in careers)
              or type(majors) is list and (len(majors) > 2 or any(type(value) is str and value in _DERIVED_MAJORS for value in majors)))
    if 'assessmentProfile' in record:
        if record['assessmentProfile'] != CURRENT or numeric or old:
            raise _unsupported()
        return CURRENT
    if modern:
        raise _unsupported()
    return LEGACY


def validate_archive(record):
    """Validate one known contract, then copy the original rather than defaults."""
    profile = profile_for_record(record)
    if profile == LEGACY:
        ArchiveRecord.model_validate(record)
    else:
        try:
            from .current_models import CurrentArchiveRecord
        except (ImportError, OSError, ValueError, TypeError, KeyError, OverflowError, RecursionError):
            raise StorageError(503, 'The assessment contract is temporarily unavailable.', 'CONTRACT') from None
        CurrentArchiveRecord.model_validate(record)
    return copy.deepcopy(record)


def require_operation(record, operation):
    """Compatibility denial must follow, and cannot replace, authority checks."""
    if type(operation) is not str or operation not in OPERATIONS:
        raise _unsupported()
    profile = profile_for_record(record)
    if profile != LEGACY:
        raise _unsupported()
    return profile


def report_capabilities():
    """Authenticated discovery returns a safe copy, not raw source definitions."""
    try:
        from .current_models import current_contract_metadata
        metadata = current_contract_metadata()
        if (type(metadata) is not dict or set(metadata) != _METADATA_KEYS
                or metadata['profile'] != CURRENT or metadata['contract_version'] != 'games-traits-contract-v1'
                or type(metadata['contract_fingerprint']) is not str
                or not re.fullmatch(r'[0-9a-f]{64}', metadata['contract_fingerprint'])
                or any(type(metadata[key]) is not str or not 1 <= len(metadata[key]) <= 100
                       for key in ('bank_version', 'personality_version'))
                or any(type(metadata[key]) is not int or metadata[key] != expected
                       for key, expected in (('planning_total', 13), ('planning_required', 12), ('personality_total', 30)))):
            raise ValueError
        return {'format': 'bic-report-capabilities', 'version': 1, 'api_version': '2',
                'profiles': [{'profile': LEGACY, 'operations': list(OPERATIONS)},
                             {'profile': CURRENT, 'operations': [], 'contract': copy.deepcopy(metadata)}]}
    except (ImportError, OSError, ValueError, TypeError, KeyError, OverflowError, RecursionError):
        raise StorageError(503, 'The assessment capabilities are temporarily unavailable.', 'CONTRACT') from None
