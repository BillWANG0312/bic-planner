"""Current-bank numeric scoring is explicitly versioned, never a prediction."""

import copy
import hashlib
import importlib
import json
from pathlib import Path
import subprocess
import shutil

import pytest

from backend.bic_api.db import StorageError
from backend.bic_api.models import ASSESSMENT_SCHEMA

ROOT = Path(__file__).resolve().parents[2]
SUBJECTS = ['english', 'maths', 'physics', 'chemistry']


def implementation():
    try:
        return importlib.import_module('backend.bic_api.academic_scoring')
    except ModuleNotFoundError:
        pytest.fail('The explicit current-bank academic scoring module must exist.')


def record(answers):
    return {'bankVersion': ASSESSMENT_SCHEMA['bankVersion'], 'state': {'academic': {'answers': answers}}}


def node_scores(answer_sets):
    script = """const fs=require('fs'),vm=require('vm');const window={};const context=vm.createContext({window});
for(const f of ['js/bank.js','js/report.js'])vm.runInContext(fs.readFileSync(f,'utf8'),context);
const sets=JSON.parse(fs.readFileSync(0,'utf8'));const keys=['english','maths','physics','chemistry'];
process.stdout.write(JSON.stringify(sets.map(answers=>{const s=window.gradeAcademic({answers}).subjects;return keys.map(key=>({key,complete:s[key].complete,pct:s[key].complete?s[key].pct:null}));})));"""
    result = subprocess.run(['node', '-e', script], cwd=ROOT, input=json.dumps(answer_sets), capture_output=True, text=True, encoding='utf-8', check=True)
    return json.loads(result.stdout)


def answer(question, correct=True):
    if question['type'] == 'choice':
        value = int(question['answer'])
        return value if correct else (value + 1) % question['option_count']
    return question['answer'] if correct else str(float(question['answer']) + max(100, float(question['tol']) * 10))


def test_generated_rules_and_safe_metadata_are_current_and_private_keys_stay_private():
    module = implementation(); rules = module.load_rules()
    result = subprocess.run(['node', 'backend/tools/academic-scoring.cjs', '--check'], cwd=ROOT, capture_output=True, text=True, check=True)
    assert result.returncode == 0
    public = (ROOT / 'js/academic-scoring-meta.js').read_text(encoding='utf-8')
    metadata = module.scoring_metadata(rules)
    assert set(metadata) == {'bank_version', 'rule_version', 'rule_fingerprint', 'basis', 'incomplete_policy', 'calibration'}
    assert metadata['bank_version'] == ASSESSMENT_SCHEMA['bankVersion']
    assert metadata['rule_version'] == 'academic-pct-v1'
    assert metadata['basis'] == 'current_local_rules_recomputed'
    assert metadata['incomplete_policy'] == 'not_scored' and metadata['calibration'] == 'not_calibrated'
    assert len(metadata['rule_fingerprint']) == 64
    for forbidden in ['"questions"', '"answer"', '"tol"', 'option_count']:
        assert forbidden not in public


@pytest.mark.parametrize('correct', range(16))
def test_every_complete_subject_percentage_matches_actual_js_rounding(correct):
    module = implementation(); rules = module.load_rules()
    answers = {}
    for key in SUBJECTS:
        questions = [question for question in rules['questions'] if question['subject'] == key]
        answers.update({question['id']: answer(question, index < correct) for index, question in enumerate(questions)})
    assert module.grade(record(answers), rules) == node_scores([answers])[0]
    assert all(value['complete'] and value['pct'] is not None for value in module.grade(record(answers), rules))


def test_numeric_edges_and_partial_zero_are_identical_to_actual_js():
    module = implementation(); rules = module.load_rules()
    complete = {question['id']: answer(question) for question in rules['questions']}
    cases = [{}, {'en1': 0, 'ma5': 0, 'ma1': None}]
    for question in [question for question in rules['questions'] if question['type'] != 'choice']:
        numeric = float(question['answer']); tolerance = float(question['tol'])
        values = [0, -0.0, '0', '-0', '\ufeff\u2002' + question['answer'] + '\n', question['answer'] + 'e0',
                  '1e308', '0x10', '0b10', '0o10', numeric + tolerance, numeric - tolerance,
                  numeric + tolerance + 1e-10, numeric - tolerance - 1e-10, None]
        for value in values:
            answers = {**complete, question['id']: value}; cases.append(answers)
    expected = node_scores(cases)
    assert [module.grade(record(answers), rules) for answers in cases] == expected
    assert module.grade(record({}), rules) == [{'key': key, 'complete': False, 'pct': None} for key in SUBJECTS]


def test_runtime_snapshot_fingerprint_is_recomputed_and_source_files_are_bound():
    rules = implementation().load_rules()
    payload = {key: value for key, value in rules.items() if key != 'fingerprint'}
    canonical = json.dumps(payload, ensure_ascii=True, sort_keys=True, separators=(',', ':'))
    assert hashlib.sha256(canonical.encode('ascii')).hexdigest() == rules['fingerprint']
    assert rules['bank_sha256'] == hashlib.sha256((ROOT / 'js/bank.js').read_text(encoding='utf-8').replace('\r\n', '\n').encode('utf-8')).hexdigest()
    assert rules['report_sha256'] == hashlib.sha256((ROOT / 'js/report.js').read_text(encoding='utf-8').replace('\r\n', '\n').encode('utf-8')).hexdigest()


@pytest.mark.parametrize('alter', [
    lambda value: value.update(unknown='private'),
    lambda value: value.update(bank_version='old'),
    lambda value: value.update(rule_version='prediction'),
    lambda value: value.update(bank_sha256='bad'),
    lambda value: value.update(fingerprint='0' * 64),
    lambda value: value['questions'].pop(),
    lambda value: value['questions'][0].update(answer='NaN'),
    lambda value: value['questions'][0].update(tol='-1'),
    lambda value: value['questions'][0].update(subject='unknown'),
    lambda value: value['questions'][0].update(option_count=True),
    lambda value: value['questions'][0].update(answer='100'),
    lambda value: value['questions'][1].update(id=value['questions'][0]['id']),
])
def test_corrupt_rules_refuse_v2_with_generic_503(tmp_path, alter):
    module = implementation(); value = copy.deepcopy(module.load_rules()); alter(value)
    # Recompute to exercise structural checks as well as the checksum boundary.
    if value.get('fingerprint') != '0' * 64:
        payload = {key: item for key, item in value.items() if key != 'fingerprint'}
        value['fingerprint'] = hashlib.sha256(json.dumps(payload, ensure_ascii=True, sort_keys=True, separators=(',', ':')).encode('ascii')).hexdigest()
    path = tmp_path / 'bad.json'; path.write_text(json.dumps(value), encoding='utf-8')
    with pytest.raises(StorageError) as captured:
        module.load_rules(path)
    assert captured.value.status_code == 503
    assert 'questions' not in captured.value.message and 'private' not in captured.value.message


def test_missing_snapshot_is_generic_service_failure(tmp_path):
    with pytest.raises(StorageError) as captured:
        implementation().load_rules(tmp_path / 'missing.json')
    assert captured.value.status_code == 503


def test_deeply_nested_corrupt_snapshot_returns_generic_503(tmp_path):
    path = tmp_path / 'deep-rules.json'
    path.write_text('[' * 30_000 + '0' + ']' * 30_000, encoding='utf-8')
    with pytest.raises(StorageError) as captured:
        implementation().load_rules(path)
    assert captured.value.status_code == 503 and captured.value.code == 'SCORING'


def test_generator_is_portable_between_crlf_and_lf_and_detects_stale_public_metadata(tmp_path):
    implementation().load_rules()
    project = tmp_path / 'project'
    for relative in ['backend/tools/academic-scoring.cjs', 'backend/academic-scoring.json', 'js/academic-scoring-meta.js', 'js/bank.js', 'js/report.js']:
        destination = project / relative; destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(ROOT / relative, destination)
    for newline in ['\n', '\r\n']:
        for relative in ['js/bank.js', 'js/report.js']:
            normalized = (ROOT / relative).read_text(encoding='utf-8').replace('\r\n', '\n')
            (project / relative).write_bytes(normalized.replace('\n', newline).encode('utf-8'))
        check = subprocess.run(['node', 'backend/tools/academic-scoring.cjs', '--check'], cwd=project, capture_output=True, text=True)
        assert check.returncode == 0, check.stderr
    public = project / 'js/academic-scoring-meta.js'; public.write_text(public.read_text(encoding='utf-8').replace('academic-pct-v1', 'stale-rule'), encoding='utf-8')
    stale = subprocess.run(['node', 'backend/tools/academic-scoring.cjs', '--check'], cwd=project, capture_output=True, text=True)
    assert stale.returncode == 1
