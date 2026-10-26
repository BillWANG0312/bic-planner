"""De-identified draft context and optional editor provenance contract."""

import copy
import importlib
import json
from pathlib import Path
import shutil
import subprocess

import pytest
from pydantic import ValidationError

from backend.bic_api.models import ArchiveRecord
from backend.tests.test_models import record


ROOT = Path(__file__).resolve().parents[2]
ID = '11111111-2222-4333-8444-555555555555'


def draft_module():
    try:
        return importlib.import_module('backend.bic_api.draft_models')
    except ModuleNotFoundError:
        pytest.fail('Strict draft contracts must exist')


def context():
    return {'status': 'draft', 'direction_id': 'cs', 'personality_complete': False, 'personality_code': None,
            'subjects': [{'key': key, 'answered': 0, 'total': 15, 'pct': None}
                         for key in ['english', 'maths', 'physics', 'chemistry']]}


def origin():
    return {'kind': 'local_mock', 'draft_id': ID, 'generator': 'local-demo-v1', 'source_revision': 7}


def response():
    sections = {key: '请先完成测评，再讨论下一步。' for key in ['summary', 'academic', 'plan', 'personality']}
    return {'id': ID, 'report_id': 'report-one', 'source_revision': 7, 'created_at': 1790000000,
            'expires_at': 1790000900, 'kind': 'local_mock', 'generator': 'local-demo-v1',
            'reason': 'generated', 'before': sections, 'sections': sections}


def with_origin():
    value = record()
    value['advisor'] = {'sections': {'plan': '经核对的草稿建议'}, 'history': [{
        'id': 'entry-one', 'at': '2026-10-24T00:00:00Z', 'author': '核对老师', 'section': 'plan',
        'before': '旧建议', 'after': '经核对的草稿建议', 'action': 'edit', 'reportId': 'AP-TEST',
        'origin': origin()}]}
    return value


def test_context_has_only_fixed_nonidentifying_profile_fields():
    module = draft_module()
    assert module.DraftContext.model_validate(context()).model_dump(mode='json') == context()
    completed = context()
    completed.update(status='complete', personality_complete=True, personality_code='INTJ')
    for subject in completed['subjects']:
        subject.update(answered=15, pct=80)
    assert module.DraftContext.model_validate(completed).direction_id == 'cs'


@pytest.mark.parametrize('field,value', [('name', 'Private Student'), ('answers', {}), ('report_id', 'report-one'),
                                        ('summary', 'private free text'), ('grade', '8'), ('username', 'owner')])
def test_context_refuses_identity_and_free_text(field, value):
    with pytest.raises(ValidationError):
        draft_module().DraftContext.model_validate({**context(), field: value})


@pytest.mark.parametrize('change', [
    {'direction_id': 'private_student'}, {'personality_complete': 1}, {'personality_code': 'INTJ'},
    {'status': 'complete'}, {'personality_complete': True, 'personality_code': 'XXXX'},
])
def test_context_rejects_coercion_unknown_profiles_and_contradictions(change):
    with pytest.raises(ValidationError):
        draft_module().DraftContext.model_validate({**context(), **change})


@pytest.mark.parametrize('changed', [
    {'answered': True}, {'answered': 1.0}, {'answered': 16}, {'pct': 50}, {'name': 'Private Student'},
    {'total': 14}, {'key': 'other'}, {'answered': 15, 'pct': None}, {'answered': 15, 'pct': True},
])
def test_subject_profile_is_bounded_and_cannot_carry_text(changed):
    value = context()
    value['subjects'][0].update(changed)
    with pytest.raises(ValidationError):
        draft_module().DraftContext.model_validate(value)


def test_context_requires_exactly_four_unique_subjects():
    for values in [context()['subjects'][:-1], [context()['subjects'][0]] * 4]:
        with pytest.raises(ValidationError):
            draft_module().DraftContext.model_validate({**context(), 'subjects': values})


def test_complete_context_requires_personality_completion_but_accepts_balanced_null_code():
    completed = context()
    completed['status'] = 'complete'
    for subject in completed['subjects']:
        subject.update(answered=15, pct=80)
    with pytest.raises(ValidationError):
        draft_module().DraftContext.model_validate(completed)
    completed['personality_complete'] = True
    assert draft_module().DraftContext.model_validate(completed).personality_code is None


def test_response_preserves_four_plain_text_sections_and_exact_metadata():
    module = draft_module()
    value = response()
    value['sections'] = {**value['sections'], 'plan': '<b>plain text</b>'}
    assert module.DraftResponse.model_validate(value).model_dump(mode='json') == value
    with pytest.raises(ValidationError):
        module.DraftSections.model_validate({**value['sections'], 'name': 'private'})


@pytest.mark.parametrize('field,value', [
    ('id', 'not-a-uuid'), ('report_id', '../report'), ('source_revision', True),
    ('source_revision', 9007199254740992), ('created_at', 0), ('expires_at', 1790000000),
    ('kind', 'unknown'), ('generator', '<img src=x>'), ('generator', 'x' * 81), ('reason', 'secret stack'),
])
def test_response_metadata_is_strict_and_bounded(field, value):
    with pytest.raises(ValidationError):
        draft_module().DraftResponse.model_validate({**response(), field: value})


@pytest.mark.parametrize('text', ['', '  ', '😀' * 2001, '\ud800'], ids=['empty', 'blank', 'utf16-limit', 'invalid-unicode'])
def test_response_sections_reject_blank_oversized_or_invalid_unicode(text):
    value = response()
    value['sections'] = {**value['sections'], 'summary': text}
    with pytest.raises(ValidationError):
        draft_module().DraftResponse.model_validate(value)


def test_archive_accepts_optional_provenance_without_inventing_it_for_legacy_records():
    legacy = ArchiveRecord.model_validate(record()).model_dump(mode='json', exclude_unset=True)
    assert 'advisor' not in legacy
    saved = ArchiveRecord.model_validate(with_origin()).model_dump(mode='json', exclude_unset=True)
    assert saved['advisor']['history'][0]['origin'] == origin()


@pytest.mark.parametrize('changed', [None, {**origin(), 'kind': 'ai'}, {**origin(), 'draft_id': 'bad'},
                                    {**origin(), 'source_revision': True}, {**origin(), 'generator': '姓名'},
                                    {**origin(), 'generator': 'local-demo-v1\n'}, {**origin(), 'draft_id': ID + '\n'},
                                    {**origin(), 'source_revision': 0}, {**origin(), 'source_revision': 1.5},
                                    {**origin(), 'source_revision': 9007199254740992},
                                    {**origin(), 'name': 'private'}])
def test_archive_refuses_unknown_or_null_provenance(changed):
    value = with_origin()
    value['advisor']['history'][0]['origin'] = changed
    with pytest.raises(ValidationError):
        ArchiveRecord.model_validate(value)


@pytest.mark.skipif(not shutil.which('node'), reason='Node required for browser archive contract')
def test_real_browser_archive_with_provenance_matches_python():
    script = r"""
const vm=require('node:vm'),fs=require('node:fs');
const {loadReportScripts,legacyState}=require('./tests/helpers/report.cjs');const w=loadReportScripts();
vm.runInNewContext(fs.readFileSync('js/report-store.js','utf8'),{window:w});
const s=legacyState(w);s.report=w.generateReport(s);s.report.meta.batchId='AP-PROVENANCE';
w.reportEditing.applyEdit(s.report,'plan','经核对的草稿建议','核对老师');
s.report.advisor.history[0].origin={kind:'local_mock',draft_id:'11111111-2222-4333-8444-555555555555',generator:'local-demo-v1',source_revision:7};
let raw=null;const store=w.ReportStore.create({getItem:()=>raw,setItem:(_,v)=>raw=v});
process.stdout.write(JSON.stringify(store.save(s).record));
"""
    result = subprocess.run([shutil.which('node'), '-e', script], cwd=ROOT, text=True, encoding='utf-8', capture_output=True, check=True)
    value = json.loads(result.stdout)
    assert ArchiveRecord.model_validate(value).model_dump(mode='json', exclude_unset=True) == value
