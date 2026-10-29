"""Keep the accepted API and summary contract tied to the sealed legacy profile."""
import json
from pathlib import Path
import subprocess

import pytest

from backend.bic_api.models import ArchiveRecord, stored_record

ROOT = Path(__file__).resolve().parents[2]


def browser_records():
    script = """
const fs=require('node:fs'),vm=require('node:vm');
const {loadReportScripts,state,legacyState}=require('./tests/helpers/report.cjs');
const w=loadReportScripts();vm.runInNewContext(fs.readFileSync('js/report-store.js','utf8'),{window:w,Date});
const records=[legacyState(w,true),state(w,true)].map((value,i)=>{value.report=w.generateReport(value);value.report.meta.batchId='PROFILE-'+i;let raw=null;return w.ReportStore.create({getItem:()=>raw,setItem:(_,v)=>raw=v}).save(value).record});
process.stdout.write(JSON.stringify(records));
"""
    return json.loads(subprocess.run(['node', '-e', script], cwd=ROOT, capture_output=True, text=True, encoding='utf-8', check=True).stdout)


def test_legacy_records_stay_accepted_and_new_records_are_converted_at_the_boundary():
    old, new = browser_records()
    assert 'assessmentProfile' not in old and len(old['state']['mbti']['answers']) == 24
    assert ArchiveRecord.model_validate(old).model_dump(mode='json', exclude_unset=True) == old
    # 旧版接口只认旧版兼容存档：当前版本的作答在账号接口写入边界换算后才保存（见 test_report_profile_api）。
    assert new['assessmentProfile'] == 'games-traits-v1' and len(new['state']['mbti']['answers']) == 30
    assert 'subjectBoard' in new['state']['plan']['answers']
    stored = stored_record(new)
    assert 'assessmentProfile' not in stored and len(stored['state']['mbti']['answers']) == 24
    # 规划题原样保存；只有当前版本的团队竞速换回旧版的节奏与搭档人数。
    assert 'subjectBoard' in stored['state']['plan']['answers'] and 'team' not in stored['state']['plan']['answers']
    assert stored['state']['plan']['answers']['groupSize'].startswith('partner:')
    assert ArchiveRecord.model_validate(stored).model_dump(mode='json', exclude_unset=True) == stored


@pytest.mark.parametrize('name', ['assessment-schema', 'preference-schema'])
def test_legacy_contract_generators_follow_frozen_sources_without_redefining_old_fields(name):
    result = subprocess.run(['node', f'backend/tools/{name}.cjs', '--check'], cwd=ROOT, capture_output=True, text=True, encoding='utf-8')
    assert result.returncode == 0, result.stdout + result.stderr
    schema = json.loads((ROOT / 'backend/assessment-schema.json').read_text(encoding='utf-8'))
    assert len(schema['plan']) == 14 and schema['mbtiCount'] == 24
    preference = next(question for question in schema['plan'] if question['key'] == 'preferredMajor')
    assert preference['max'] == 2 and len(preference['options']) == 12
