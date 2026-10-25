"""Current-bank equal-weight percentages, only for fully answered subjects.

The private generated snapshot is lazy: missing or corrupt optional scoring
rules refuse v2 without disrupting the completion-only v1 service.
"""

import hashlib
import json
import math
from pathlib import Path
import re

from .db import StorageError
from .models import ASSESSMENT_SCHEMA, DECIMAL_NUMBER, JS_WHITESPACE, RADIX_NUMBERS, finite_number, _js_number_text


_PATH = Path(__file__).resolve().parents[1] / 'academic-scoring.json'
_SUBJECTS = ('english', 'maths', 'physics', 'chemistry')
_PREFIXES = {'en': 'english', 'ma': 'maths', 'ph': 'physics', 'ch': 'chemistry'}
_HASH = re.compile(r'[0-9a-f]{64}\Z')
_PAYLOAD = {'bank_version', 'rule_version', 'bank_sha256', 'report_sha256', 'questions'}


def _unavailable():
    return StorageError(503, 'The optional academic scoring rules are unavailable.', 'SCORING')


def _rule_number(value):
    if type(value) is not str or not DECIMAL_NUMBER.fullmatch(value) or len(value) > 100:
        raise ValueError
    number = float(value)
    if not math.isfinite(number) or _js_number_text(number) != value:
        raise ValueError
    return number


def load_rules(path=None):
    try:
        contents = Path(path if path is not None else _PATH).read_text(encoding='utf-8')
        if len(contents) > 100_000:
            raise ValueError
        rules = json.loads(contents)
        if type(rules) is not dict or set(rules) != _PAYLOAD | {'fingerprint'}:
            raise ValueError
        if rules['bank_version'] != ASSESSMENT_SCHEMA['bankVersion'] or rules['rule_version'] != 'academic-pct-v1':
            raise ValueError
        if any(type(rules[key]) is not str or not _HASH.fullmatch(rules[key]) for key in ('bank_sha256', 'report_sha256', 'fingerprint')):
            raise ValueError
        payload = {key: value for key, value in rules.items() if key != 'fingerprint'}
        canonical = json.dumps(payload, sort_keys=True, ensure_ascii=True, separators=(',', ':'), allow_nan=False)
        if hashlib.sha256(canonical.encode('ascii')).hexdigest() != rules['fingerprint']:
            raise ValueError
        questions = rules['questions']
        if type(questions) is not list or len(questions) != 60:
            raise ValueError
        counts = dict.fromkeys(_SUBJECTS, 0)
        for question, expected in zip(questions, ASSESSMENT_SCHEMA['academic']):
            if type(question) is not dict or set(question) != {'id', 'subject', 'type', 'answer', 'tol', 'option_count'}:
                raise ValueError
            if question['id'] != expected['id'] or question['type'] != expected['type'] or question['subject'] != _PREFIXES.get(expected['id'][:2]):
                raise ValueError
            answer, tolerance = _rule_number(question['answer']), _rule_number(question['tol'])
            if tolerance < 0:
                raise ValueError
            if question['type'] == 'choice':
                if type(question['option_count']) is not int or question['option_count'] != expected['optionCount'] or not answer.is_integer() or not 0 <= answer < question['option_count'] or tolerance != 0:
                    raise ValueError
            elif question['type'] != 'numeric' or question['option_count'] is not None:
                raise ValueError
            counts[question['subject']] += 1
        if any(count != 15 for count in counts.values()):
            raise ValueError
        return rules
    except (OSError, UnicodeError, TypeError, ValueError, KeyError, OverflowError, RecursionError):
        raise _unavailable() from None


def scoring_metadata(rules):
    return {'bank_version': rules['bank_version'], 'rule_version': rules['rule_version'],
            'rule_fingerprint': rules['fingerprint'], 'basis': 'current_local_rules_recomputed',
            'incomplete_policy': 'not_scored', 'calibration': 'not_calibrated'}


def _number(value):
    if finite_number(value):
        return float(value)
    if type(value) is not str or not value.strip(JS_WHITESPACE):
        return None
    trimmed = value.strip(JS_WHITESPACE)
    try:
        if DECIMAL_NUMBER.fullmatch(trimmed):
            number = float(trimmed)
        else:
            number = next((float(int(trimmed[2:], base)) for pattern, base in RADIX_NUMBERS if pattern.fullmatch(trimmed)), None)
        return number if number is not None and math.isfinite(number) else None
    except (ValueError, OverflowError):
        return None


def grade(record, rules):
    if record.get('bankVersion') != rules['bank_version']:
        raise StorageError(409, 'The question-bank version is unsupported for academic scoring.', 'VERSION')
    answers = record['state']['academic']['answers']
    counts = {key: [0, 0] for key in _SUBJECTS}
    for question in rules['questions']:
        value = answers.get(question['id'])
        number = _number(value)
        if question['type'] == 'choice':
            answered = finite_number(value) and float(value).is_integer() and 0 <= value < question['option_count']
        else:
            answered = number is not None
        counts[question['subject']][0] += int(answered)
        if answered and abs(number - float(question['answer'])) <= float(question['tol']):
            counts[question['subject']][1] += 1
    return [{'key': key, 'complete': counts[key][0] == 15,
             'pct': math.floor(counts[key][1] / 15 * 100 + 0.5) if counts[key][0] == 15 else None} for key in _SUBJECTS]
