"""Lazy fixed-choice projection, independent of optional scoring and inference."""

import hashlib
import json
from pathlib import Path
import re

from .db import StorageError
from .models import ASSESSMENT_SCHEMA, JS_WHITESPACE, utf16_length
from .contracts import require_operation


_PATH = Path(__file__).resolve().parents[1] / 'preference-schema.json'
_HASH = re.compile(r'[0-9a-f]{64}\Z')
_PAYLOAD = {'bank_version', 'schema_version', 'majors_sha256', 'plan_sha256', 'questions'}
_FIELDS = (('preferredMajor', 2, 12), ('countries', 3, 8))


def _unavailable():
    return StorageError(503, 'The optional explicit-preference dictionary is unavailable.', 'PREFERENCES')


def _unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError
        result[key] = value
    return result


def load_schema(path=None):
    """Read at most 100 KB and validate the entire current dictionary lazily."""
    try:
        with Path(path if path is not None else _PATH).open('rb') as stream:
            contents = stream.read(100_001)
        if len(contents) > 100_000:
            raise ValueError
        schema = json.loads(contents.decode('utf-8'), object_pairs_hook=_unique_object)
        if type(schema) is not dict or set(schema) != _PAYLOAD | {'fingerprint'}:
            raise ValueError
        if schema['bank_version'] != ASSESSMENT_SCHEMA['bankVersion'] or schema['schema_version'] != 'planning-preferences-v1':
            raise ValueError
        if any(type(schema[key]) is not str or not _HASH.fullmatch(schema[key]) for key in ('majors_sha256', 'plan_sha256', 'fingerprint')):
            raise ValueError
        payload = {key: value for key, value in schema.items() if key != 'fingerprint'}
        canonical = json.dumps(payload, sort_keys=True, ensure_ascii=False, separators=(',', ':'), allow_nan=False)
        if hashlib.sha256(canonical.encode('utf-8')).hexdigest() != schema['fingerprint']:
            raise ValueError
        questions = schema['questions']
        if type(questions) is not list or len(questions) != len(_FIELDS):
            raise ValueError
        for question, (key, maximum, count) in zip(questions, _FIELDS):
            expected = next(item for item in ASSESSMENT_SCHEMA['plan'] if item['key'] == key)
            if (type(question) is not dict or set(question) != {'key', 'max', 'options'} or question['key'] != key
                    or type(question['max']) is not int or question['max'] != maximum
                    or expected['type'] != 'tags' or expected['max'] != maximum or expected['multiFree'] is not False):
                raise ValueError
            options = question['options']
            if type(options) is not list or len(options) != count or len(expected['options']) != count:
                raise ValueError
            identifiers = []
            for option, identifier in zip(options, expected['options']):
                if type(option) is not dict or set(option) != {'id', 'label'} or type(option['id']) is not str or option['id'] != identifier:
                    raise ValueError
                label = option['label']
                if type(label) is not str or not 1 <= utf16_length(label) <= 100 or not label.strip(JS_WHITESPACE):
                    raise ValueError
                label.encode('utf-8')  # Reject lone surrogates even when JSON escaped.
                identifiers.append(identifier)
            if len(set(identifiers)) != count or 'unsure' not in identifiers:
                raise ValueError
        return schema
    except (OSError, UnicodeError, TypeError, ValueError, KeyError, OverflowError, RecursionError, StopIteration):
        raise _unavailable() from None


def metadata(schema):
    return {'bank_version': schema['bank_version'], 'schema_version': schema['schema_version'],
            'schema_fingerprint': schema['fingerprint'], 'basis': 'explicit_student_choices'}


def project(record, schema):
    """Keep the two original choices, in dictionary order rather than rank."""
    require_operation(record, 'teacher_preferences_v3')
    try:
        if record['bankVersion'] != schema['bank_version']:
            raise StorageError(409, 'The question-bank version is unsupported for explicit preferences.', 'VERSION')
        answers = record['state']['plan']['answers']
        if type(answers) is not dict:
            raise ValueError
        result = {}
        for question in schema['questions']:
            selected = answers.get(question['key'], [])
            if (type(selected) is not list or len(selected) > question['max']
                    or any(type(identifier) is not str for identifier in selected)
                    or len(set(selected)) != len(selected)):
                raise ValueError
            allowed = [option['id'] for option in question['options']]
            if any(identifier not in allowed for identifier in selected):
                raise ValueError
            result[question['key']] = {'answered': bool(selected), 'choices': [identifier for identifier in allowed if identifier in selected]}
        return result
    except (TypeError, ValueError, KeyError, OverflowError, RecursionError):
        raise _unavailable() from None
