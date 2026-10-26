"""The future current-profile input boundary, independent of the enabled API."""
import copy
import importlib
import json
from pathlib import Path
import subprocess

import pytest

ROOT = Path(__file__).resolve().parents[2]


def current():
    return importlib.import_module('backend.bic_api.current_models')


@pytest.fixture(scope='module')
def records():
    script = r"""
const fs=require('node:fs'),vm=require('node:vm');
const {loadReportScripts,state}=require('./tests/helpers/report.cjs');const w=loadReportScripts();
vm.runInNewContext(fs.readFileSync('js/report-store.js','utf8'),{window:w,Date});
const partial=state(w);partial.academic.answers={en1:0,ma1:null};
partial.plan.answers={subjectBoard:{like:['数学']},majorBoard:{watch:[]},team:{pace:'steady'},career:[],weakSubjects:[],schoolSubjects:['自由科目'],preferredMajor:['tech','cs']};
partial.mbti.answers=[null,{value:0},{value:2,ms:null},{value:4,ms:-0.5},{value:3,ms:1e20}];
const values=[state(w),partial,state(w,true)].map((value,i)=>{value.report=w.generateReport(value);value.report.meta.batchId='CURRENT-'+i;let raw=null;return w.ReportStore.create({getItem:()=>raw,setItem:(_,v)=>raw=v}).save(value).record;});
process.stdout.write(JSON.stringify(values));
"""
    result = subprocess.run(['node', '-e', script], cwd=ROOT, capture_output=True, text=True, encoding='utf-8', check=True)
    return json.loads(result.stdout)


@pytest.mark.parametrize('index', [0, 1, 2])
def test_real_browser_archives_validate_without_losing_values(records, index):
    record = records[index]
    assert current().CurrentArchiveRecord.model_validate(record).model_dump(mode='json', exclude_unset=True) == record


def test_partial_record_preserves_cleared_academic_key_and_optional_timing(records):
    saved = current().CurrentArchiveRecord.model_validate(records[1]).model_dump(mode='json', exclude_unset=True)
    assert saved['state']['academic']['answers'] == {'en1': 0, 'ma1': None}
    assert saved['state']['mbti']['answers'] == [None, {'value': 0}, {'value': 2, 'ms': None}, {'value': 4, 'ms': -0.5}, {'value': 3, 'ms': 1e20}]
    assert saved['state']['plan']['answers']['subjectBoard'] == {'like': ['数学']}


VALID_BOUNDARIES = [
    ('empty games', lambda r: r['state']['plan'].update(answers={'subjectBoard': {}, 'majorBoard': {}, 'team': {}})),
    ('all ten campus items', lambda r: r['state']['plan'].update(answers={'subjectBoard': {'like': ['数学', '物理', '化学', '生物'], 'try': ['计算机', '经济', '历史', '英语文学'], 'avoid': ['心理学', '设计']}})),
    ('nine planet items', lambda r: r['state']['plan'].update(answers={'majorBoard': {'heart': ['cs', 'math', 'eng'], 'watch': ['med', 'econ', 'law'], 'skip': ['psych', 'design', 'media']}})),
    ('eight compatible majors', lambda r: r['state']['plan'].update(answers={'preferredMajor': ['science', 'math', 'eng', 'tech', 'business', 'econ', 'med', 'social']})),
    ('thirty free UTF16 subjects', lambda r: r['state']['plan'].update(answers={'schoolSubjects': ['😀' * 39 + str(i) for i in range(30)]})),
    ('thirty missing trait answers', lambda r: r['state']['mbti'].update(answers=[None] * 30)),
    ('maximum finite timing', lambda r: r['state']['mbti'].update(answers=[{'value': 0, 'ms': 1.7976931348623157e308}])),
    ('numeric zero and radix string', lambda r: r['state']['academic'].update(answers={'en1': 0, 'ma8': ' 0x10 '})),
]


@pytest.mark.parametrize('label,alter', VALID_BOUNDARIES, ids=[item[0] for item in VALID_BOUNDARIES])
def test_valid_boundary_drafts_preserve_values_instead_of_inventing_defaults(records, label, alter):
    record = copy.deepcopy(records[0]); alter(record)
    assert current().CurrentArchiveRecord.model_validate(record).model_dump(mode='json', exclude_unset=True) == record


INVALID = [
    ('missing profile', lambda r: r.pop('assessmentProfile')),
    ('unknown profile', lambda r: r.update(assessmentProfile='future')),
    ('legacy marker', lambda r: r.update(assessmentProfile='legacy-2026.10')),
    ('nested marker', lambda r: r['state'].update(assessmentProfile='games-traits-v1')),
    ('extra top field', lambda r: r.update(private='unknown')),
    ('legacy groupSize', lambda r: r['state']['plan']['answers'].update(groupSize='small')),
    ('legacy career', lambda r: r['state']['plan']['answers'].update(career=['researcher'])),
    ('unknown plan', lambda r: r['state']['plan']['answers'].update(unknown=[])),
    ('null game', lambda r: r['state']['plan']['answers'].update(subjectBoard=None)),
    ('extra lane', lambda r: r['state']['plan']['answers'].update(subjectBoard={'other': []})),
    ('campus capacity', lambda r: r['state']['plan']['answers'].update(subjectBoard={'like': ['数学', '物理', '化学', '生物', '计算机']})),
    ('cross lane duplicate', lambda r: r['state']['plan']['answers'].update(subjectBoard={'like': ['数学'], 'try': ['数学']})),
    ('unknown campus item', lambda r: r['state']['plan']['answers'].update(subjectBoard={'like': ['未知学科']})),
    ('planet capacity', lambda r: r['state']['plan']['answers'].update(majorBoard={'heart': ['cs', 'math', 'eng', 'med']})),
    ('unknown planet', lambda r: r['state']['plan']['answers'].update(majorBoard={'heart': ['phys']})),
    ('dart capacity', lambda r: r['state']['plan']['answers'].update(career=['science', 'build', 'people'])),
    ('dart duplicate', lambda r: r['state']['plan']['answers'].update(career=['science', 'science'])),
    ('race pace', lambda r: r['state']['plan']['answers'].update(team={'pace': 'fast'})),
    ('race partner', lambda r: r['state']['plan']['answers'].update(team={'partner': 'solo'})),
    ('race extra', lambda r: r['state']['plan']['answers'].update(team={'pace': 'steady', 'ms': 4})),
    ('tags capacity', lambda r: r['state']['plan']['answers'].update(countries=['uk', 'us', 'ca', 'hk'])),
    ('tags null', lambda r: r['state']['plan']['answers'].update(countries=None)),
    ('free duplicate', lambda r: r['state']['plan']['answers'].update(schoolSubjects=['数学', '数学'])),
    ('free blank', lambda r: r['state']['plan']['answers'].update(weakSubjects=[' '])),
    ('unknown derived major', lambda r: r['state']['plan']['answers'].update(preferredMajor=['fake'])),
    ('grade conflict', lambda r: r['state']['plan']['answers'].update(grade='11')),
    ('unknown academic', lambda r: r['state']['academic']['answers'].update(fake=0)),
    ('choice boolean', lambda r: r['state']['academic']['answers'].update(en1=True)),
    ('choice range', lambda r: r['state']['academic']['answers'].update(en1=99)),
    ('numeric infinity', lambda r: r['state']['academic']['answers'].update(ma8=float('inf'))),
    ('numeric empty', lambda r: r['state']['academic']['answers'].update(ma8=' ')),
    ('legacy scalars', lambda r: r['state']['mbti'].update(answers=[0])),
    ('scale boolean', lambda r: r['state']['mbti'].update(answers=[{'value': True}])),
    ('scale range', lambda r: r['state']['mbti'].update(answers=[{'value': 5}])),
    ('timing boolean', lambda r: r['state']['mbti'].update(answers=[{'value': 0, 'ms': True}])),
    ('timing infinity', lambda r: r['state']['mbti'].update(answers=[{'value': 0, 'ms': float('inf')}])),
    ('scale capacity', lambda r: r['state']['mbti'].update(answers=[None] * 31)),
    ('scale extra', lambda r: r['state']['mbti'].update(answers=[{'value': 0, 'private': 'x'}])),
    ('surrogate', lambda r: r['state']['info'].update(name='\ud800')),
]


@pytest.mark.parametrize('label,alter', INVALID, ids=[item[0] for item in INVALID])
def test_current_shape_rejects_invalid_or_mixed_input_without_mutation(records, label, alter):
    record = copy.deepcopy(records[0]); alter(record); original = copy.deepcopy(record)
    with pytest.raises(ValueError):
        current().CurrentArchiveRecord.model_validate(record)
    assert record == original


def test_portable_advisor_history_and_actor_stay_unchanged(records):
    record = copy.deepcopy(records[1])
    record['advisor'] = {'sections': {'summary': '虚构建议'}, 'history': [{'id': 'history-1', 'at': record['createdAt'], 'author': '学校顾问', 'section': 'summary', 'before': '', 'after': '虚构建议', 'action': 'edit', 'reportId': record['reportMeta']['batchId'], 'actor': {'kind': 'school_advisor', 'user_id': '00000000-0000-4000-8000-000000000001', 'username': 'fictional.advisor', 'grant_id': '00000000-0000-4000-8000-000000000002', 'source_revision': 1, 'result_revision': 2}}]}
    assert current().CurrentArchiveRecord.model_validate(record).model_dump(mode='json', exclude_unset=True) == record


def test_metadata_is_only_the_eight_public_contract_fields():
    value = current().current_contract_metadata()
    assert set(value) == {'profile', 'contract_version', 'contract_fingerprint', 'bank_version', 'personality_version', 'planning_total', 'planning_required', 'personality_total'}
    assert value['profile'] == 'games-traits-v1' and value['contract_version'] == 'games-traits-contract-v1'
    assert (value['planning_total'], value['planning_required'], value['personality_total']) == (13, 12, 30)
    assert value['personality_version'] == '2026.11-trait'


@pytest.mark.parametrize('contents', [b'bad-json', b'{}', b'{"format":1,"format":2}', b' ' * 100001, b'{"private":"must-not-leak"}'], ids=['invalid-json', 'empty-object', 'duplicate-keys', 'oversized', 'private-input'])
def test_broken_new_snapshot_is_safe_and_does_not_break_legacy_import(tmp_path, monkeypatch, records, contents):
    module = current(); target = tmp_path / 'broken.json'; target.write_bytes(contents); monkeypatch.setattr(module, '_PATH', target)
    with pytest.raises(ValueError, match=r'^Current assessment contract is unavailable\.$'):
        module.current_contract_metadata()
    with pytest.raises(ValueError): module.CurrentArchiveRecord.model_validate(records[0])
    from backend.bic_api.models import ArchiveRecord
    assert ArchiveRecord is not None


def test_changed_semantics_with_unchanged_fingerprint_is_rejected(tmp_path, monkeypatch):
    module = current(); snapshot = json.loads((ROOT / 'backend/current-assessment-schema.json').read_text(encoding='utf-8'))
    snapshot['semantics']['personality']['questions'].reverse()
    target = tmp_path / 'changed.json'; target.write_text(json.dumps(snapshot), encoding='utf-8'); monkeypatch.setattr(module, '_PATH', target)
    with pytest.raises(ValueError, match=r'^Current assessment contract is unavailable\.$'): module.current_contract_metadata()
