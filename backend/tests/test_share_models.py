import importlib
import json
from pathlib import Path
import shutil
import subprocess

import pytest
from pydantic import ValidationError


ROOT = Path(__file__).resolve().parents[2]


def content():
    return {
        'status': 'draft', 'direction': '计算机科学', 'personality': '待完成性格测评',
        'subjects': [dict(key=key, name=key, answered=0, total=15, pct=None)
                     for key in ['english', 'maths', 'physics', 'chemistry']],
        'sections': dict(summary='报告摘要', academic='学习建议', plan='专业建议', personality='学习策略'),
    }


def snapshot():
    return {
        'format': 'bic-parent-summary', 'version': 1,
        'shared_at': 1_790_000_000, 'expires_at': 1_790_003_600,
        'report': dict(name='测试同学', grade='8', year='2027 年秋季', batchId='AP-PARENT-01',
                       date='2026年10月24日', bankVersion='2026.10', catalogVersion='2026.10.24', revision=1),
        'content': content(),
    }


@pytest.fixture
def models():
    try:
        return importlib.import_module('backend.bic_api.share_models')
    except ModuleNotFoundError:
        pytest.fail('Public parent-summary schema has not been implemented')


def test_public_models_accept_exact_summary_without_inventing_fields(models):
    assert models.ShareContent.model_validate(content()).model_dump(mode='json') == content()
    assert models.ParentSnapshot.model_validate(snapshot()).model_dump(mode='json') == snapshot()


@pytest.mark.parametrize('path', [(), ('report',), ('content',), ('content', 'subjects', 0), ('content', 'sections')])
def test_private_and_unknown_fields_are_rejected_at_every_boundary(models, path):
    value = snapshot()
    target = value
    for part in path:
        target = target[part]
    target['history'] = ['private']
    with pytest.raises(ValidationError):
        models.ParentSnapshot.model_validate(value)


@pytest.mark.parametrize('path,replacement', [
    (('version',), True), (('shared_at',), '1790000000'), (('expires_at',), 1_790_000_000),
    (('report', 'revision'), True), (('report', 'revision'), 2 ** 53),
    (('report', 'grade'), 8), (('report', 'name'), '😀' * 13), (('report', 'name'), '\ud800'),
    (('content', 'direction'), ' '), (('content', 'subjects', 0, 'answered'), True),
    (('content', 'subjects', 0, 'total'), 15.0), (('content', 'subjects', 0, 'total'), 14),
    (('content', 'subjects', 0, 'pct'), 0), (('content', 'subjects', 0, 'answered'), 15),
    (('content', 'subjects', 0, 'key'), 'maths'), (('content', 'subjects'), []),
    (('content', 'status'), 'complete'),
    (('content', 'sections', 'plan'), '😀' * 2001), (('content', 'sections', 'academic'), '\x01' * 4000),
], ids=['version_bool', 'time_string', 'invalid_expiry', 'revision_bool', 'revision_unsafe',
        'grade_number', 'astral_name', 'lone_surrogate', 'blank_direction', 'answered_bool',
        'total_float', 'total_wrong', 'pct_unfinished', 'pct_missing', 'duplicate_subject',
        'subjects_empty', 'status_contradiction', 'advice_too_long', 'escaped_json_too_large'])
def test_public_values_are_strict_bounded_and_semantically_consistent(models, path, replacement):
    value = snapshot()
    target = value
    for part in path[:-1]:
        target = target[part]
    target[path[-1]] = replacement
    with pytest.raises(ValidationError):
        models.ParentSnapshot.model_validate(value)


def test_public_model_keeps_plain_text_and_exact_utf16_boundary(models):
    value = snapshot()
    value['report']['name'] = '😀' * 12
    value['content']['sections']['plan'] = '<img src=x onerror=alert(1)> is plain text.'
    assert models.ParentSnapshot.model_validate(value).model_dump(mode='json') == value
    value['content']['subjects'][0].update(answered=15, pct=100)
    assert models.ParentSnapshot.model_validate(value).content.subjects[0].pct == 100


@pytest.mark.skipif(not shutil.which('node'), reason='Node.js required for independent frontend contract comparison')
def test_real_browser_archives_produce_the_same_python_public_contract(models):
    script = r"""
const fs=require('node:fs'),vm=require('node:vm');
const {loadReportScripts,legacyState}=require('./tests/helpers/report.cjs');
const w=loadReportScripts();
for(const file of ['js/report-store.js','js/share-summary.js'])vm.runInNewContext(fs.readFileSync(file,'utf8'),{window:w,Date});
const output=[];
for(const complete of [false,true]){
  const value=legacyState(w,complete);
  if(complete)for(const q of w.LegacyAssessment.planQuestions)value.plan.answers[q.key]=q.type==='single'?q.options()[0].id:q.optional?[]:[q.source()[0].id];
  value.report=w.generateReport(value);value.report.meta.batchId='AP-CROSS-'+complete;
  w.reportEditing.applyEdit(value.report,'summary','家长可见的建议。','不应分享的编辑者');
  let raw=null;const record=w.ReportStore.create({getItem:()=>raw,setItem:(_,v)=>raw=v}).save(value).record;
  const content=w.ParentSummary.build(record);
  const snapshot={format:'bic-parent-summary',version:1,shared_at:1790000000,expires_at:1790003600,
    report:{name:record.state.info.name,grade:record.state.info.grade,year:record.state.info.year,batchId:record.reportMeta.batchId,date:record.reportMeta.date,bankVersion:record.bankVersion,catalogVersion:record.catalogVersion,revision:1},content};
  output.push(w.ParentSummary.validate(snapshot));
}
process.stdout.write(JSON.stringify(output));
"""
    result = subprocess.run([shutil.which('node'), '-e', script], cwd=ROOT, check=True,
                            capture_output=True, encoding='utf-8')
    for value in json.loads(result.stdout):
        assert models.ParentSnapshot.model_validate(value).model_dump(mode='json') == value
        serialized = json.dumps(value, ensure_ascii=False)
        for private in ['不应分享的编辑者', 'history', 'review', 'answers', 'owner_id', 'csrf_token']:
            assert private not in serialized
