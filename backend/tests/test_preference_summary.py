"""Optional explicit choices are versioned, never inferred recommendations."""

from contextlib import contextmanager
import copy
import hashlib
import importlib
import json
from pathlib import Path
import shutil
import sqlite3
import subprocess

import pytest

from backend.bic_api.db import StorageError
from backend.bic_api.models import ASSESSMENT_SCHEMA
from backend.tests.test_teacher_summary import summary, create, error, existing_access
from backend.tests.test_teacher_access import record

ROOT = Path(__file__).resolve().parents[2]
FIELDS = ['preferredMajor', 'countries']
IDS = [
    ['science', 'math', 'eng', 'tech', 'business', 'econ', 'med', 'social', 'humanities', 'art', 'media', 'unsure'],
    ['uk', 'us', 'ca', 'au', 'hk', 'sg', 'eu', 'unsure'],
]


def implementation():
    try:
        return importlib.import_module('backend.bic_api.preference_summary')
    except ModuleNotFoundError:
        pytest.fail('The optional explicit-preference projection module must exist.')


def fingerprint(value):
    payload = {key: item for key, item in value.items() if key != 'fingerprint'}
    canonical = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False)
    return hashlib.sha256(canonical.encode('utf-8')).hexdigest()


def browser_questions():
    script = """const fs=require('node:fs'),vm=require('node:vm');const window={};const c=vm.createContext({window});
for(const file of ['data/universities.js','js/majors.js','js/plan.js'])vm.runInContext(fs.readFileSync(file,'utf8'),c);
const keys=['preferredMajor','countries'];process.stdout.write(JSON.stringify(keys.map(key=>{
const q=window.PLAN_QUESTIONS.find(q=>q.key===key);return{key:q.key,max:q.max,options:q.source().map(({id,label})=>({id,label}))};})));"""
    result = subprocess.run(['node', '-e', script], cwd=ROOT, capture_output=True, text=True, encoding='utf-8', check=True)
    return json.loads(result.stdout)


def test_generated_dictionary_matches_actual_browser_sources_and_has_only_safe_fixed_labels():
    module = implementation(); schema = module.load_schema()
    check = subprocess.run(['node', 'backend/tools/preference-schema.cjs', '--check'], cwd=ROOT, capture_output=True, text=True)
    assert check.returncode == 0, check.stderr
    assert set(schema) == {'bank_version', 'schema_version', 'majors_sha256', 'plan_sha256', 'questions', 'fingerprint'}
    assert schema['questions'] == browser_questions()
    assert [[option['id'] for option in question['options']] for question in schema['questions']] == IDS
    assert [question['max'] for question in schema['questions']] == [2, 3]
    assert schema['fingerprint'] == fingerprint(schema)
    for name in ['majors', 'plan']:
        source = (ROOT / ('js/' + name + '.js')).read_text(encoding='utf-8').replace('\r\n', '\n')
        assert schema[name + '_sha256'] == hashlib.sha256(source.encode('utf-8')).hexdigest()
    metadata = module.metadata(schema)
    assert metadata == {'bank_version': ASSESSMENT_SCHEMA['bankVersion'], 'schema_version': 'planning-preferences-v1',
                        'schema_fingerprint': schema['fingerprint'], 'basis': 'explicit_student_choices'}
    script = "const fs=require('fs'),vm=require('vm');const window={};vm.runInNewContext(fs.readFileSync('js/preference-schema.js','utf8'),{window});console.log(JSON.stringify(window.BIC_PREFERENCE_SCHEMA));"
    result = subprocess.run(['node', '-e', script], cwd=ROOT, capture_output=True, text=True, encoding='utf-8', check=True)
    public = json.loads(result.stdout)
    assert public == {'metadata': metadata, 'questions': schema['questions']}
    assert not any(text in result.stdout for text in ['desc', 'note', 'answer', 'personality', 'majors_sha256', 'plan_sha256'])


@pytest.mark.parametrize('alter', [
    lambda s: s.update(extra='private'), lambda s: s.update(bank_version='old'),
    lambda s: s.update(schema_version='inferred'), lambda s: s.update(majors_sha256='bad'),
    lambda s: s.update(plan_sha256='F' * 64), lambda s: s.update(fingerprint='0' * 64),
    lambda s: s['questions'].pop(), lambda s: s['questions'].reverse(),
    lambda s: s['questions'][0].update(key='interests'), lambda s: s['questions'][0].update(max=True),
    lambda s: s['questions'][0].update(max=3), lambda s: s['questions'][0].update(extra='private'),
    lambda s: s['questions'][0]['options'].pop(), lambda s: s['questions'][0]['options'].reverse(),
    lambda s: s['questions'][0]['options'][0].update(id='unknown'),
    lambda s: s['questions'][0]['options'][1].update(id='science'),
    lambda s: s['questions'][0]['options'][0].update(label='\u2002\ufeff'),
    lambda s: s['questions'][0]['options'][0].update(label='😀' * 51),
    lambda s: s['questions'][0]['options'][0].update(label=1),
    lambda s: s['questions'][0]['options'][0].update(desc='private'),
])
def test_corrupt_dictionary_fails_closed_even_with_recomputed_fingerprint(tmp_path, alter):
    module = implementation(); value = copy.deepcopy(module.load_schema()); alter(value)
    if value['fingerprint'] != '0' * 64:
        value['fingerprint'] = fingerprint(value)
    path = tmp_path / 'bad.json'; path.write_text(json.dumps(value), encoding='utf-8')
    captured = error(lambda: module.load_schema(path), 503, 'PREFERENCES')
    assert 'private' not in captured.message and 'questions' not in captured.message


@pytest.mark.parametrize('contents', [None, '{private', '[]', '[' * 30_000 + '0' + ']' * 30_000, ' ' * 100_001, '{"bank_version":"\ud800"}'],
                         ids=['missing', 'json', 'array', 'deep', 'oversized', 'surrogate'])
def test_missing_invalid_or_deep_dictionary_is_generic_503(tmp_path, contents):
    module = implementation(); path = tmp_path / 'bad.json'
    if contents is not None:
        path.write_text(contents, encoding='utf-8', errors='surrogatepass')
    error(lambda: module.load_schema(path), 503, 'PREFERENCES')


def test_generator_normalizes_source_and_output_newlines_and_detects_stale_public_dictionary(tmp_path):
    implementation().load_schema(); project = tmp_path / 'project'
    files = ['backend/tools/preference-schema.cjs', 'backend/preference-schema.json', 'backend/assessment-schema.json',
             'js/preference-schema.js', 'js/majors.js', 'js/plan.js']
    for relative in files:
        destination = project / relative; destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(ROOT / relative, destination)
    for newline in ['\n', '\r\n']:
        for relative in files[1:]:
            normalized = (ROOT / relative).read_text(encoding='utf-8').replace('\r\n', '\n')
            (project / relative).write_bytes(normalized.replace('\n', newline).encode('utf-8'))
        result = subprocess.run(['node', 'backend/tools/preference-schema.cjs', '--check'], cwd=project, capture_output=True, text=True)
        assert result.returncode == 0, result.stderr
    public = project / 'js/preference-schema.js'
    public.write_text(public.read_text(encoding='utf-8').replace('planning-preferences-v1', 'stale'), encoding='utf-8')
    result = subprocess.run(['node', 'backend/tools/preference-schema.cjs', '--check'], cwd=project, capture_output=True, text=True)
    assert result.returncode == 1


def test_duplicate_json_keys_and_escaped_lone_surrogate_labels_are_refused(tmp_path):
    module = implementation(); path = tmp_path / 'bad.json'; value = module.load_schema()
    raw = json.dumps(value)
    path.write_text(raw.replace('"bank_version":', '"bank_version":"old","bank_version":', 1), encoding='utf-8')
    error(lambda: module.load_schema(path), 503, 'PREFERENCES')
    value['questions'][0]['options'][0]['label'] = '\ud800'
    path.write_text(json.dumps(value), encoding='utf-8')
    error(lambda: module.load_schema(path), 503, 'PREFERENCES')


@pytest.mark.parametrize('answers,expected', [
    ({}, {'preferredMajor': {'answered': False, 'choices': []}, 'countries': {'answered': False, 'choices': []}}),
    ({'preferredMajor': [], 'countries': []}, {'preferredMajor': {'answered': False, 'choices': []}, 'countries': {'answered': False, 'choices': []}}),
    ({'preferredMajor': ['unsure', 'tech'], 'countries': ['unsure', 'hk', 'uk']},
     {'preferredMajor': {'answered': True, 'choices': ['tech', 'unsure']}, 'countries': {'answered': True, 'choices': ['uk', 'hk', 'unsure']}}),
    ({'preferredMajor': ['science'], 'countries': ['eu']},
     {'preferredMajor': {'answered': True, 'choices': ['science']}, 'countries': {'answered': True, 'choices': ['eu']}}),
])
def test_projection_uses_only_explicit_fields_in_canonical_dictionary_order_without_mutation(answers, expected):
    module = implementation(); value = record('explicit')
    value['state']['plan']['answers'] = {**answers, 'grade': '8', 'subjectPerf': '私密自述'}
    original = copy.deepcopy(value)
    assert module.project(value, module.load_schema()) == expected
    assert value == original


@pytest.mark.parametrize('bad', [['unknown'], ['uk', 'uk'], ['uk', 'us', 'ca', 'au'], 'uk', None, [True]])
def test_direct_projection_refuses_invalid_or_excess_choices(bad):
    module = implementation(); value = record(); value['state']['plan']['answers']['countries'] = bad
    error(lambda: module.project(value, module.load_schema()), 503, 'PREFERENCES')


@pytest.mark.parametrize('academic,preferences,version', [(False, False, 1), (True, False, 2), (False, True, 3), (True, True, 3)])
def test_all_four_modes_preserve_v1_v2_and_only_add_explicit_requested_fields(summary, academic, preferences, version):
    db, _, reader, users, _, _ = summary
    value = record('modes'); value['state']['plan']['answers'].update(preferredMajor=['unsure', 'tech'], countries=['hk', 'uk'])
    saved, grant = create(summary, 'modes', value)
    original = reader.read(users['teacher'], [grant['id']], academic=academic)
    before = json.dumps(original, ensure_ascii=False)
    result = reader.read(users['teacher'], [grant['id']], academic=academic, preferences=preferences)
    assert result['version'] == version
    if preferences:
        assert set(result) == {'format', 'version', 'items', 'options', 'preference_schema'} | ({'scoring'} if academic else set())
        assert result['options'] == {'academic': academic, 'preferences': True}
        assert result['preference_schema'] == implementation().metadata(implementation().load_schema())
        expected = copy.deepcopy(result); expected.pop('options'); expected.pop('preference_schema'); expected['version'] = 2 if academic else 1
        for item in expected['items']:
            assert item['report'].pop('preferences') == {'preferredMajor': {'answered': True, 'choices': ['tech', 'unsure']},
                                                       'countries': {'answered': True, 'choices': ['uk', 'hk']}}
        assert json.dumps(expected, ensure_ascii=False) == before
    else:
        assert json.dumps(result, ensure_ascii=False) == before
    assert db.get_report(users['owner'], saved['id']) == saved


@pytest.mark.parametrize('flag', [None, 0, 1, 'true', [], {}])
def test_preferences_flag_is_strict_bool_before_private_reads(summary, flag, monkeypatch):
    db, _, reader, users, _, _ = summary
    monkeypatch.setattr(db, '_connection', lambda: pytest.fail('Reject invalid flags before private reads.'))
    error(lambda: reader.read(users['teacher'], ['one'], preferences=flag), 422, 'VALIDATION')


def test_optional_dependencies_are_independent_and_failure_never_silently_downgrades(summary, monkeypatch, tmp_path):
    module = implementation(); from backend.bic_api import academic_scoring
    _, _, reader, users, _, _ = summary; _, grant = create(summary)
    bad = tmp_path / 'bad.json'; bad.write_text('[' * 30_000 + '0' + ']' * 30_000, encoding='utf-8')
    monkeypatch.setattr(module, '_PATH', bad)
    assert reader.read(users['teacher'], [grant['id']])['version'] == 1
    assert reader.read(users['teacher'], [grant['id']], academic=True)['version'] == 2
    for academic in [False, True]:
        error(lambda: reader.read(users['teacher'], [grant['id']], academic=academic, preferences=True), 503, 'PREFERENCES')
    monkeypatch.undo(); monkeypatch.setattr(academic_scoring, '_PATH', bad)
    assert reader.read(users['teacher'], [grant['id']], preferences=True)['version'] == 3
    error(lambda: reader.read(users['teacher'], [grant['id']], academic=True, preferences=True), 503, 'SCORING')


@pytest.mark.parametrize('failure', ['unknown', 'other_recipient', 'revoked', 'expired', 'owner_disabled', 'recipient_disabled', 'role', 'source_changed', 'owner_changed', 'report_deleted', 'recipient_deleted'])
def test_v3_checks_all_selected_authority_before_loading_dictionary(summary, failure, monkeypatch):
    module = implementation(); db, access, reader, users, _, clock = summary
    _, first = create(summary); saved, selected = create(summary, 'second')
    identifier = selected['id']
    if failure == 'unknown': identifier = 'unknown'
    elif failure == 'other_recipient': _, other = create(summary, 'other', recipient='other.teacher'); identifier = other['id']
    elif failure == 'revoked': access.revoke(users['owner'], saved['id'], identifier)
    elif failure == 'expired': clock.value = selected['expires_at']
    elif failure == 'owner_disabled': db.disable_user('owner')
    elif failure == 'recipient_disabled': db.disable_user('teacher')
    elif failure == 'source_changed': db.update_report(users['owner'], saved['id'], saved['record'], 1)
    elif failure == 'report_deleted': db.delete_report(users['owner'], saved['id'], 1)
    else:
        with sqlite3.connect(db.path) as connection:
            connection.execute('PRAGMA foreign_keys=ON')
            if failure == 'role': connection.execute('UPDATE users SET role=? WHERE id=?', ('student', users['teacher']))
            elif failure == 'recipient_deleted': connection.execute('DELETE FROM users WHERE id=?', (users['teacher'],))
            else: connection.execute('UPDATE reports SET owner_id=? WHERE id=?', (users['other.student'], saved['id']))
    monkeypatch.setattr(module, 'load_schema', lambda: pytest.fail('Authority must precede optional dictionary load.'))
    error(lambda: reader.read(users['teacher'], [first['id'], identifier], preferences=True), 404, 'NOT_FOUND')


def test_v3_uses_one_join_snapshot_and_one_dictionary_load_with_no_scoring_or_persistent_writes(summary, monkeypatch):
    module = implementation(); from backend.bic_api import academic_scoring
    db, _, reader, users, _, _ = summary; _, first = create(summary); _, second = create(summary, 'second')
    original = db._connection; statements = []; calls = []; actual = module.load_schema
    @contextmanager
    def traced():
        with original() as connection:
            connection.set_trace_callback(statements.append); yield connection
    def load(): calls.append(1); return actual()
    monkeypatch.setattr(db, '_connection', traced)
    monkeypatch.setattr(module, 'load_schema', load)
    monkeypatch.setattr(academic_scoring, 'load_rules', lambda: pytest.fail('Preference-only must not load scoring.'))
    monkeypatch.setattr(db, 'get_report', lambda *args: pytest.fail('No followup full-report reads.'))
    result = reader.read(users['teacher'], [second['id'], first['id']], preferences=True)
    assert [item['grant']['id'] for item in result['items']] == [second['id'], first['id']]
    assert len(calls) == 1
    selects = [sql for sql in statements if sql.lstrip().upper().startswith('SELECT')]
    assert len(selects) == 1 and all(part in selects[0] for part in ['teacher_grants', 'reports', 'users'])
    assert not any(sql.lstrip().upper().startswith(('INSERT', 'UPDATE', 'DELETE', 'CREATE', 'ALTER')) for sql in statements)


@pytest.mark.parametrize('academic', [False, True])
def test_edit_family_and_opaque_share_identifiers_do_not_grant_v3_authority(summary, academic, monkeypatch):
    module = implementation(); db, _, reader, users, saved, clock = summary
    from backend.bic_api.advisor_edit import AdvisorEditService
    from backend.bic_api.comments import CommentService
    from backend.tests.test_sharing import content
    edit = AdvisorEditService(db, clock=clock).create_grant(users['owner'], saved['id'], 1, 'teacher', 24,
                                                        {'summary': '核心', 'academic': '学习', 'plan': '私密建议', 'personality': '策略'})
    parent = CommentService(db, clock=clock).create_grant(users['owner'], saved['id'], 1, 'teacher', 24, content())
    monkeypatch.setattr(module, 'load_schema', lambda: pytest.fail('Wrong permission kind must fail before projection.'))
    for identifier in [edit['id'], parent['id'], 'opaque-share-token']:
        error(lambda: reader.read(users['teacher'], [identifier], academic=academic, preferences=True), 404, 'NOT_FOUND')


def test_v3_expiry_is_checked_after_the_join_snapshot(summary, monkeypatch):
    module = implementation(); db, _, reader, users, _, clock = summary; _, grant = create(summary)
    original = db._connection
    @contextmanager
    def delayed():
        with original() as connection:
            yield connection
        clock.value = grant['expires_at']
    monkeypatch.setattr(db, '_connection', delayed)
    monkeypatch.setattr(module, 'load_schema', lambda: pytest.fail('Expired permission must fail before optional load.'))
    error(lambda: reader.read(users['teacher'], [grant['id']], preferences=True), 404, 'NOT_FOUND')


@pytest.mark.parametrize('catalog', [None, 'old-catalog', 'unknown'])
def test_partial_planning_can_include_preferences_without_current_catalog(summary, catalog):
    _, _, reader, users, _, _ = summary; value = record('catalog'); value['catalogVersion'] = catalog
    value['state']['plan']['answers'] = {'countries': ['unsure', 'hk']}
    _, grant = create(summary, 'catalog', value)
    result = reader.read(users['teacher'], [grant['id']], preferences=True)['items'][0]['report']
    assert result['status'] == 'draft' and result['catalog_version'] == catalog
    assert result['preferences']['countries'] == {'answered': True, 'choices': ['hk', 'unsure']}


def test_preferences_do_not_reinterpret_an_old_bank(summary):
    _, _, reader, users, _, _ = summary; value = record('old'); value['bankVersion'] = 'old-bank'
    _, grant = create(summary, 'old', value)
    error(lambda: reader.read(users['teacher'], [grant['id']], preferences=True), 409, 'VERSION')
