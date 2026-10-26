"""Lazy current-profile input contract; no owner endpoint or projection is enabled.

Legacy ArchiveRecord remains unchanged. Values are validated without normalizing
nulls, omitted planning/timing fields, array order or portable advisor history.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import re
from typing import Any, Literal

from pydantic import field_validator, model_validator

from .models import (AdvisorEditing, ReportMeta, Required100, StrictModel, StudentInfo,
                     TimestampText, MAX_RECORD_CHARS, _json_utf16_length,
                     bounded_text, finite_number, numeric_answer, scale_integer)

_PATH = Path(__file__).resolve().parents[1] / 'current-assessment-schema.json'
_HASH = re.compile(r'[0-9a-f]{64}\Z')
_ERROR = 'Current assessment contract is unavailable.'
_SOURCE_NAMES = {'js/bank.js', 'js/majors.js', 'js/plan.js', 'js/personality.js', 'js/games.js', 'js/assessment-profile.js'}
_SEMANTIC_KEYS = {'profile', 'contract_version', 'bank_version', 'personality_version', 'grades', 'academic', 'planning', 'games', 'compatibility_planning', 'personality', 'meaning'}


def _unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError
        result[key] = value
    return result


def _shape(value, keys):
    if type(value) is not dict or set(value) != set(keys):
        raise ValueError


def _identifiers(values, *, maximum=100):
    if (type(values) is not list or not 1 <= len(values) <= maximum
            or any(type(value) is not str or not value or len(value) > 100 for value in values)
            or len(set(values)) != len(values)):
        raise ValueError


def _meaning_options(value, *, required_extra=(), optional_extra=()):
    if type(value) is not list or not value: raise ValueError
    for option in value:
        if type(option) is not dict or not {'id', 'label', *required_extra} <= set(option) or set(option) - {'id', 'label', *required_extra, *optional_extra}: raise ValueError
        for key, item in option.items():
            if key in ('traits', 'careers'): _identifiers(item)
            elif key == 'major':
                if item is not None and type(item) is not str: raise ValueError
            else:
                if type(item) is not str: raise ValueError
                bounded_text(2000, required=True)(item)
    result = [option['id'] for option in value]; _identifiers(result)
    return result


def _validate_meaning(semantic):
    view = semantic['meaning']; _shape(view, {'personality_scale', 'planning', 'games', 'planet_labels', 'interest_options', 'traits'})
    scales = view['personality_scale']
    if type(scales) is not list or len(scales) != len(semantic['personality']['scale']): raise ValueError
    for item, expected in zip(scales, semantic['personality']['scale']):
        _shape(item, {'value', 'label'})
        if type(item['value']) is not int or item['value'] != expected or type(item['label']) is not str: raise ValueError
        bounded_text(1000, required=True)(item['label'])
    questions = view['planning']
    if type(questions) is not list or len(questions) != len(semantic['planning']): raise ValueError
    for question, definition in zip(questions, semantic['planning']):
        _shape(question, {'key', 'id', 'title', 'sub', 'options'})
        if question['key'] != definition['key'] or type(question['id']) is not str or type(question['title']) is not str: raise ValueError
        bounded_text(100, required=True)(question['id']); bounded_text(2000, required=True)(question['title'])
        if question['sub'] is not None:
            if type(question['sub']) is not str: raise ValueError
            bounded_text(2000)(question['sub'])
        if definition['type'] == 'game':
            if question['options'] != []: raise ValueError
        elif _meaning_options(question['options'], optional_extra=('desc',)) != definition['options']: raise ValueError
    games = view['games']; _shape(games, {'campus', 'planet', 'dart', 'race'})
    for name in ('campus', 'planet'):
        shown = games[name]; shape = semantic['games'][name]
        _shape(shown, {'items' if name == 'campus' else 'majors', 'lanes', 'capacity', 'poolSize'})
        if (_meaning_options(shown['lanes'], required_extra=('desc',)) != shape['lanes']
                or type(shown['capacity']) is not int or shown['capacity'] != shape['capacity']
                or type(shown['poolSize']) is not int or not 1 <= shown['poolSize'] <= len(shape['items'])): raise ValueError
        if name == 'campus':
            if _meaning_options(shown['items'], optional_extra=('desc',)) != shape['items']: raise ValueError
        elif shown['majors'] != shape['items']: raise ValueError
    _shape(games['dart'], {'rings', 'max'})
    if type(games['dart']['max']) is not int or games['dart']['max'] != semantic['games']['dart']['max']: raise ValueError
    if _meaning_options(games['dart']['rings'], required_extra=('traits', 'careers', 'desc')) != semantic['games']['dart']['options']: raise ValueError
    _shape(games['race'], {'pace', 'partners'})
    for key, shown_key in [('pace', 'pace'), ('partner', 'partners')]:
        if _meaning_options(games['race'][shown_key], required_extra=('traits', 'desc')) != semantic['games']['race'][key]: raise ValueError
    if _meaning_options(view['planet_labels'], required_extra=('desc',)) != semantic['games']['planet']['items']: raise ValueError
    _meaning_options(view['interest_options'], required_extra=('desc', 'major'))
    trait_ids = _meaning_options(view['traits'], required_extra=('desc',))
    if len(trait_ids) != 10 or any(question['trait'] not in trait_ids for question in semantic['personality']['questions']): raise ValueError
    for game_options in (games['dart']['rings'], games['race']['pace'], games['race']['partners']):
        if any(trait not in trait_ids for option in game_options for trait in option['traits']): raise ValueError


def _load_contract(path=None):
    try:
        with Path(_PATH if path is None else path).open('rb') as stream:
            raw = stream.read(100001)
        if len(raw) > 100000:
            raise ValueError
        snapshot = json.loads(raw.decode('utf-8'), object_pairs_hook=_unique_object)
        _shape(snapshot, {'format', 'version', 'semantics', 'sources', 'contract_fingerprint'})
        if snapshot['format'] != 'bic-current-assessment-contract' or type(snapshot['version']) is not int or snapshot['version'] != 1:
            raise ValueError
        semantic = snapshot['semantics']; _shape(semantic, _SEMANTIC_KEYS)
        if semantic['profile'] != 'games-traits-v1' or semantic['contract_version'] != 'games-traits-contract-v1':
            raise ValueError
        for key in ('bank_version', 'personality_version'):
            if type(semantic[key]) is not str: raise ValueError
            bounded_text(100, required=True)(semantic[key])
        _shape(snapshot['sources'], _SOURCE_NAMES)
        if any(type(value) is not str or not _HASH.fullmatch(value) for value in snapshot['sources'].values()):
            raise ValueError
        fingerprint = snapshot['contract_fingerprint']
        canonical = json.dumps(semantic, sort_keys=True, ensure_ascii=False, separators=(',', ':'), allow_nan=False)
        if type(fingerprint) is not str or not _HASH.fullmatch(fingerprint) or hashlib.sha256(canonical.encode('utf-8')).hexdigest() != fingerprint:
            raise ValueError
        if semantic['grades'] != ['8', '9', '10', '11']: raise ValueError
        academic = semantic['academic']
        if type(academic) is not list or len(academic) != 60: raise ValueError
        _identifiers([question['id'] for question in academic])
        for question in academic:
            if question['type'] == 'choice':
                _shape(question, {'id', 'type', 'option_count'})
                if type(question['option_count']) is not int or not 1 <= question['option_count'] <= 20: raise ValueError
            elif question['type'] == 'numeric': _shape(question, {'id', 'type'})
            else: raise ValueError
        planning = semantic['planning']
        if type(planning) is not list or len(planning) != 13: raise ValueError
        _identifiers([question['key'] for question in planning])
        if sum(question['optional'] is False for question in planning) != 12: raise ValueError
        for question in planning:
            if type(question['optional']) is not bool: raise ValueError
            if question['type'] == 'game':
                _shape(question, {'key', 'type', 'optional', 'game'})
                if question['game'] not in ('campus', 'planet', 'dart', 'race'): raise ValueError
            elif question['type'] in ('tags', 'single'):
                _shape(question, {'key', 'type', 'optional', 'options'} | ({'max', 'multi_free'} if question['type'] == 'tags' else set()))
                _identifiers(question['options'])
                if question['type'] == 'tags' and (type(question['max']) is not int or not 1 <= question['max'] <= 30 or type(question['multi_free']) is not bool): raise ValueError
            else: raise ValueError
        games = semantic['games']; _shape(games, {'campus', 'planet', 'dart', 'race'})
        for name, capacity in [('campus', 4), ('planet', 3)]:
            board = games[name]; _shape(board, {'lanes', 'items', 'capacity'}); _identifiers(board['lanes']); _identifiers(board['items'])
            if type(board['capacity']) is not int or board['capacity'] != capacity: raise ValueError
        _shape(games['dart'], {'options', 'max'}); _identifiers(games['dart']['options'])
        if type(games['dart']['max']) is not int or games['dart']['max'] != 2: raise ValueError
        _shape(games['race'], {'pace', 'partner'})
        for options in games['race'].values(): _identifiers(options)
        compatibility = semantic['compatibility_planning']; _shape(compatibility, {'schoolSubjects', 'preferredMajor'})
        for key, maximum in [('schoolSubjects', 30), ('preferredMajor', 8)]:
            field = compatibility[key]; _shape(field, {'type', 'max', 'multi_free', 'options'})
            if field['type'] != 'tags' or type(field['max']) is not int or field['max'] != maximum or field['multi_free'] is not (key == 'schoolSubjects'): raise ValueError
            if key == 'schoolSubjects':
                if field['options'] != []: raise ValueError
            else: _identifiers(field['options'])
        personality = semantic['personality']; _shape(personality, {'questions', 'scale', 'timing'})
        if personality['scale'] != [0, 1, 2, 3, 4] or any(type(value) is not int for value in personality['scale']) or personality['timing'] != 'optional_null_or_finite_js_number': raise ValueError
        questions = personality['questions']
        if type(questions) is not list or len(questions) != 30: raise ValueError
        for question in questions:
            _shape(question, {'trait', 'text', 'statement', 'reversed'})
            if type(question['reversed']) is not bool: raise ValueError
            for key in ('trait', 'text', 'statement'):
                if type(question[key]) is not str: raise ValueError
                bounded_text(1000, required=True)(question[key])
        _validate_meaning(semantic)
        return snapshot
    except (OSError, UnicodeError, TypeError, ValueError, KeyError, OverflowError, RecursionError, AttributeError):
        raise ValueError(_ERROR) from None


def current_contract_metadata():
    snapshot = _load_contract(); semantic = snapshot['semantics']
    return {'profile': semantic['profile'], 'contract_version': semantic['contract_version'], 'contract_fingerprint': snapshot['contract_fingerprint'],
            'bank_version': semantic['bank_version'], 'personality_version': semantic['personality_version'],
            'planning_total': len(semantic['planning']), 'planning_required': sum(not question['optional'] for question in semantic['planning']),
            'personality_total': len(semantic['personality']['questions'])}


def _answer_shape(value, allowed):
    if type(value) is not dict or any(key not in allowed for key in value):
        raise ValueError('Invalid current assessment answer shape.')


def _tags(value, question):
    if type(value) is not list or len(value) > question['max']:
        raise ValueError('Invalid current planning answers.')
    seen = set()
    for item in value:
        if type(item) is not str: raise ValueError('Invalid current planning option.')
        bounded_text(80, required=True)(item)
        if item in seen or not question['multi_free'] and item not in question['options']:
            raise ValueError('Invalid current planning option.')
        seen.add(item)


def _game(value, name, games):
    config = games[name]
    if name in ('campus', 'planet'):
        _answer_shape(value, config['lanes']); seen = set()
        for lane, selected in value.items():
            if type(selected) is not list or len(selected) > config['capacity']: raise ValueError('Invalid current board capacity.')
            for item in selected:
                if type(item) is not str or item not in config['items'] or item in seen: raise ValueError('Invalid current board option.')
                seen.add(item)
    elif name == 'dart':
        _tags(value, {'max': config['max'], 'options': config['options'], 'multi_free': False})
    else:
        _answer_shape(value, ('pace', 'partner'))
        if any(type(selected) is not str or selected not in config[key] for key, selected in value.items()): raise ValueError('Invalid current team option.')


class CurrentArchiveRecord(StrictModel):
    assessmentProfile: Literal['games-traits-v1']
    id: Required100
    createdAt: TimestampText
    updatedAt: TimestampText
    bankVersion: Required100
    catalogVersion: Required100 | None = None
    state: dict[str, Any]
    reportMeta: ReportMeta
    advisor: AdvisorEditing = None

    @field_validator('id')
    @classmethod
    def valid_id(cls, value):
        if not re.fullmatch(r'[A-Za-z0-9_-]+', value): raise ValueError('Invalid archive identifier.')
        return value

    @field_validator('state', mode='before')
    @classmethod
    def valid_state(cls, value):
        semantic = _load_contract()['semantics']
        _shape(value, {'info', 'academic', 'plan', 'mbti'})
        StudentInfo.model_validate(value['info'])
        _shape(value['academic'], {'answers'}); answers = value['academic']['answers']
        definitions = {question['id']: question for question in semantic['academic']}
        _answer_shape(answers, definitions)
        for key, answer in answers.items():
            if answer is None: continue
            question = definitions[key]
            if question['type'] == 'choice': scale_integer(answer, list(range(question['option_count'])))
            elif not numeric_answer(answer): raise ValueError('Invalid current numeric answer.')
        _shape(value['plan'], {'answers'}); planning = value['plan']['answers']
        questions = {question['key']: question for question in semantic['planning']}
        questions.update(semantic['compatibility_planning']); _answer_shape(planning, questions)
        for key, answer in planning.items():
            question = questions[key]
            if question['type'] == 'game': _game(answer, question['game'], semantic['games'])
            elif question['type'] == 'single':
                if type(answer) is not str or answer not in question['options']: raise ValueError('Invalid current single answer.')
            else: _tags(answer, question)
        info_grade = value['info']['grade']; plan_grade = planning.get('grade')
        if info_grade and plan_grade and info_grade != plan_grade: raise ValueError('Student and planning grades disagree.')
        _shape(value['mbti'], {'answers'}); personality = value['mbti']['answers']
        if type(personality) is not list or len(personality) > len(semantic['personality']['questions']): raise ValueError('Invalid current personality answers.')
        for answer in personality:
            if answer is None: continue
            _answer_shape(answer, ('value', 'ms'))
            scale_integer(answer.get('value'), semantic['personality']['scale'])
            if 'ms' in answer and answer['ms'] is not None and not finite_number(answer['ms']): raise ValueError('Invalid current response timing.')
        return value

    @model_validator(mode='after')
    def bounded_record(self):
        data = self.model_dump(mode='json', exclude_unset=True)
        try:
            json.dumps(data, ensure_ascii=False, allow_nan=False).encode('utf-8')
            if _json_utf16_length(data) > MAX_RECORD_CHARS: raise ValueError
        except (TypeError, ValueError, UnicodeError, OverflowError, RecursionError):
            raise ValueError('Invalid or oversized current archive.') from None
        return self
