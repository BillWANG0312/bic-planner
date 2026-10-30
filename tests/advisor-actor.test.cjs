const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { loadReportScripts, state, legacyState } = require('./helpers/report.cjs');
const { withPage } = require('./helpers/browser.cjs');
const ACTOR = { kind: 'school_advisor', user_id: '11111111-2222-4333-8444-555555555555',
  username: 'advisor.' + 'a'.repeat(56), grant_id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', source_revision: 7, result_revision: 8 };
const School = { ...ACTOR, username: 'advisor.a', grant_id: ACTOR.grant_id };
const copy = value => JSON.parse(JSON.stringify(value));
// 报告库回显会带上生成的报告；旧版引擎只吃作答。
const fromRecord = ({ report, ...answers }) => answers;

function fixture(makeState = state) {
  const w = loadReportScripts();
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../js/report-store.js'), 'utf8'), { window: w });
  // 旧版作答由旧版引擎出报告；当前版本由当前引擎出报告。
  const value = makeState(w);
  // 统一用新版：作答按内容识别版本，只有明确的旧版形状才交给旧版引擎。
  const profile = w.AssessmentProfiles.stateProfile(value);
  value.report = (profile === w.AssessmentProfiles.LEGACY ? w.LegacyAssessment : w).generateReport({ ...value, assessmentProfile: profile }); value.report.meta.batchId = 'AP-SCHOOL-ACTOR';
  w.reportEditing.applyEdit(value.report, 'plan', '<img src=x onerror=alert(1)>学校建议', '学校顾问');
  // 旧版归档只记录 3–64 位的学校账号名，账号记录沿用同一形状。
  value.report.advisor.history[0].actor = copy(profile === w.AssessmentProfiles.LEGACY ? School : ACTOR);

  let raw = null;
  const store = w.ReportStore.create({ getItem: () => raw, setItem: (_, value) => { raw = value; } });
  return { w, value, store };
}


test('school actor survives archive export/import/restore and rule regeneration without changing answers', () => {
  const { w, value, store } = fixture();
  const before = JSON.stringify(value.academic);
  const saved = store.save(value).record;
  assert.deepEqual(copy(saved.advisor.history[0].actor), ACTOR);
  let raw = null; const other = w.ReportStore.create({ getItem: () => raw, setItem: (_, value) => { raw = value; } });
  other.importBackup(store.exportBackup());

  // 恢复时的界面状态按当前（默认）首页进入；版本识别只看作答。
  const restored = other.restore(saved.id);
  assert.deepEqual(copy(restored.state.report.advisor.history[0].actor), ACTOR);
  assert.equal(JSON.stringify(restored.state.academic), before);
  restored.state.report.advisor.history[0].actor.username = 'changed.account';
  assert.equal(other.list()[0].advisor.history[0].actor.username, ACTOR.username);
});

test('malformed school actors reject the whole backup and preserve existing archives', () => {
  const { value, store } = fixture();
  store.save(value);
  const original = store.exportBackup();
  for (const actor of [null, {}, { ...ACTOR, kind: 'advisor' }, { ...ACTOR, username: 'Advisor.Name' },
    { ...ACTOR, username: 'x' }, { ...ACTOR, username: 'x'.repeat(65) }, { ...ACTOR, username: '学校老师' },
    { ...ACTOR, username: 'advisor.name\n' }, { ...ACTOR, user_id: 'owner' },
    { ...ACTOR, grant_id: ACTOR.grant_id.toUpperCase() }, { ...ACTOR, user_id: ACTOR.user_id + '\n' },
    { ...ACTOR, source_revision: true }, { ...ACTOR, source_revision: 0 },
    { ...ACTOR, result_revision: 7 }, { ...ACTOR, result_revision: 9 }, { ...ACTOR, result_revision: true },
    { ...ACTOR, source_revision: Number.MAX_SAFE_INTEGER, result_revision: Number.MAX_SAFE_INTEGER + 1 },
    { ...ACTOR, extra: 'must not be silently dropped' }]) {
    const bad = JSON.parse(original); bad.records[0].advisor.history[0].actor = actor;
    assert.throws(() => store.importBackup(JSON.stringify(bad), { onConflict: 'replace' }));
    assert.deepEqual(copy(store.list()[0].advisor.history[0].actor), ACTOR);
  }
});

test('school account edits cannot be labeled a local restore, reset or generated draft', () => {
  const { value, store } = fixture();
  for (const action of ['restore', 'reset']) {
    const bad = copy(value); bad.report.advisor.history[0].action = action;
    assert.throws(() => store.save(bad));
  }
  const bad = copy(value);
  bad.report.advisor.history[0].origin = { kind: 'local_mock', draft_id: ACTOR.user_id, generator: 'demo', source_revision: 7 };
  assert.throws(() => store.save(bad));
  assert.equal(store.list().length, 0);
});

test('manual edits and restoring school text do not inherit its authenticated actor', () => {
  const { w, value, store } = fixture();
  const old = value.report.advisor.history[0].id;
  w.reportEditing.applyEdit(value.report, 'plan', '本机手工建议', '本机老师');
  assert.equal(value.report.advisor.history.at(-1).actor, undefined);
  w.reportEditing.restoreEdit(value.report, old, '本机老师');
  assert.equal(value.report.advisor.history.at(-1).actor, undefined);
  assert.deepEqual(copy(value.report.advisor.history[0].actor), ACTOR);
  assert.doesNotThrow(() => store.save(value));
});

test('unsafe actor metadata cannot survive regeneration or gain an account label', () => {
  const { w, value } = fixture();
  for (const actor of [null, { ...ACTOR, username: '<img src=x>' }, { ...ACTOR, result_revision: 9 }]) {
    value.report.advisor.history[0].actor = actor;
    const next = w.generateReport({ ...value, assessmentProfile: w.AssessmentProfiles.CURRENT }); w.reportEditing.carryEdits(value.report, next);
    assert.equal(next.advisor.history.length, 0);
  }
});

test('school account history shows the full account/revisions and keeps portable evidence distinct', () => {
  const { value } = fixture();
  return withPage(async page => {
    // 打开网址停在首页，已保存的报告从续答入口进入
    await page.locator('#resumeBtn').click();
    await page.locator('#screen-report.active').waitFor();
    await page.locator('#editReportBtn').click();
    const text = await page.locator('#reportEditor').textContent();
    assert.ok(text.includes(ACTOR.username));
    assert.match(text, /修订 7 → 8/);
    assert.match(text, /便携记录/);
    assert.equal(await page.locator('#reportEditor img[src=x]').count(), 0);
    assert.ok(!text.includes('本地模拟草稿'));
  }, { beforeLoad: page => page.addInitScript(value => localStorage.setItem('pathwise.state.v1', JSON.stringify(value)), value) });
});

test('legacy history remains compatible and parent summaries omit authenticated account metadata', () => {
  const { w, value, store } = fixture(legacyState);
  const saved = store.save(value).record;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../js/share-summary.js'), 'utf8'), { window: w });
  // 家长摘要按归档作答重算报告；汇总时去掉旧版归档不认的版本标记。
  const { assessmentProfile, ...record } = saved;
  const summary = JSON.stringify(w.ParentSummary.build(record));
  assert.ok(!summary.includes(School.username)); assert.ok(!summary.includes(School.user_id));
  delete value.report.advisor.history[0].actor;
  assert.doesNotThrow(() => store.save(value, { overwrite: true }));
  assert.equal(store.list()[0].advisor.history[0].actor, undefined);
});
