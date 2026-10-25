import copy
import json

import pytest

from backend.bic_api.db import StorageError
from backend.tests.test_teacher_summary import summary, create, error, existing_access
from backend.tests.test_teacher_access import record


def test_false_preserves_exact_v1_and_true_adds_only_explicit_performance(summary):
    db, _, reader, users, _, _ = summary; saved, grant = create(summary)
    original = reader.read(users['teacher'], [grant['id']])
    assert reader.read(users['teacher'], [grant['id']], academic=False) == original
    value = reader.read(users['teacher'], [grant['id']], academic=True)
    assert value['version'] == 2 and value['format'] == original['format']
    assert set(value) == {'format', 'version', 'items', 'scoring'}
    expected = copy.deepcopy(value); expected.pop('scoring'); expected['version'] = 1
    for item in expected['items']: item['report'].pop('performance')
    assert expected == original
    assert value['items'][0]['report']['performance'] == [{'key': key, 'complete': False, 'pct': None}
                                                        for key in ['english', 'maths', 'physics', 'chemistry']]
    assert db.get_report(users['owner'], saved['id']) == saved
    wire = json.dumps(value, ensure_ascii=False)
    for private in ['"answers"', '"questions"', '"answer"', '"tol"', '"history"', '"advisor"']:
        assert private not in wire


@pytest.mark.parametrize('flag', [None, 0, 1, 'true', [], {}])
def test_academic_flag_must_be_bool_before_private_reads(summary, flag, monkeypatch):
    db, _, reader, users, _, _ = summary
    monkeypatch.setattr(db, '_connection', lambda: pytest.fail('Invalid flags must fail before private reads'))
    error(lambda: reader.read(users['teacher'], ['one'], academic=flag), 422, 'VALIDATION')


def test_snapshot_failure_does_not_affect_v1_or_downgrade_v2(summary, monkeypatch):
    from backend.bic_api import academic_scoring
    _, _, reader, users, _, _ = summary; _, grant = create(summary)
    def fail(): raise StorageError(503, 'Scoring unavailable.', 'SCORING')
    monkeypatch.setattr(academic_scoring, 'load_rules', fail)
    assert reader.read(users['teacher'], [grant['id']])['version'] == 1
    error(lambda: reader.read(users['teacher'], [grant['id']], academic=True), 503)


def test_actual_deep_corrupt_optional_snapshot_keeps_v1_available(summary, monkeypatch, tmp_path):
    from backend.bic_api import academic_scoring
    _, _, reader, users, _, _ = summary; _, grant = create(summary)
    path = tmp_path / 'deep-rules.json'
    path.write_text('[' * 30_000 + '0' + ']' * 30_000, encoding='utf-8')
    monkeypatch.setattr(academic_scoring, '_PATH', path)
    assert reader.read(users['teacher'], [grant['id']])['version'] == 1
    error(lambda: reader.read(users['teacher'], [grant['id']], academic=True), 503, 'SCORING')


def test_permissions_are_checked_before_loading_scoring_and_batch_has_one_rules_snapshot(summary, monkeypatch):
    from backend.bic_api import academic_scoring
    _, access, reader, users, _, _ = summary; saved, grant = create(summary)
    _, second = create(summary, 'second')
    actual = academic_scoring.load_rules; calls = []
    def load(): calls.append(1); return actual()
    monkeypatch.setattr(academic_scoring, 'load_rules', load)
    reader.read(users['teacher'], [grant['id'], second['id']], academic=True)
    assert len(calls) == 1
    access.revoke(users['owner'], saved['id'], grant['id'])
    error(lambda: reader.read(users['teacher'], [grant['id'], second['id']], academic=True), 404)
    assert len(calls) == 1


def test_complete_zero_and_hundred_are_distinct_from_missing_subjects_even_in_draft_report(summary):
    from backend.bic_api import academic_scoring
    db, access, reader, users, _, _ = summary
    rules = academic_scoring.load_rules(); value = record('partial-scores'); answers = {}
    for question in rules['questions']:
        if question['subject'] == 'chemistry' or question['id'] == 'ph15':
            continue
        correct = question['subject'] != 'maths'
        if question['type'] == 'choice':
            answers[question['id']] = int(question['answer']) if correct else (int(question['answer']) + 1) % question['option_count']
        else:
            answers[question['id']] = question['answer'] if correct else str(float(question['answer']) + 100)
    value['state']['academic']['answers'] = answers
    saved = db.create_report(users['owner'], value)
    grant = access.create_grant(users['owner'], saved['id'], saved['revision'], 'teacher', 24)
    result = reader.read(users['teacher'], [grant['id']], academic=True)
    report = result['items'][0]['report']
    assert report['status'] == 'draft'
    assert report['performance'] == [
        {'key': 'english', 'complete': True, 'pct': 100}, {'key': 'maths', 'complete': True, 'pct': 0},
        {'key': 'physics', 'complete': False, 'pct': None}, {'key': 'chemistry', 'complete': False, 'pct': None}]
    assert db.get_report(users['owner'], saved['id']) == saved
