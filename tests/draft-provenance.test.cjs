const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { loadReportScripts, state, legacyState } = require('./helpers/report.cjs');
const { withPage } = require('./helpers/browser.cjs');
const ORIGIN = { kind: 'local_mock', draft_id: '11111111-2222-4333-8444-555555555555', generator: 'local-demo-v1', source_revision: 7 };
const copy = value => JSON.parse(JSON.stringify(value));

function fixture(makeState = state) {
  const w = loadReportScripts();
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../js/report-store.js'), 'utf8'), { window: w });
  const value = makeState(w);
  value.report = w.generateReport(value);
  value.report.meta.batchId = 'AP-PROVENANCE';
  w.reportEditing.applyEdit(value.report, 'plan', '经核对的草稿建议', '核对老师');
  value.report.advisor.history[0].origin = copy(ORIGIN);
  value.ui = { screen: 'report', idx: 0, resumeScreen: 'academic' };
  let raw = null;
  const store = w.ReportStore.create({ getItem: () => raw, setItem: (_, v) => { raw = v; } });
  return { w, value, store };
}

test('optional draft provenance roundtrips through strict archive import, restore and carry', () => {
  const { w, value, store } = fixture();
  const saved = store.save(value).record;
  assert.deepEqual(copy(saved.advisor.history[0].origin), ORIGIN);
  const backup = store.exportBackup();
  let raw = null;
  const other = w.ReportStore.create({ getItem: () => raw, setItem: (_, v) => { raw = v; } });
  other.importBackup(backup);
  const restored = other.restore(saved.id);
  assert.deepEqual(copy(restored.state.report.advisor.history[0].origin), ORIGIN);
  restored.state.report.advisor.history[0].origin.generator = 'changed';
  assert.equal(other.list()[0].advisor.history[0].origin.generator, 'local-demo-v1');
});

test('bad provenance refuses the entire backup instead of silently dropping its audit metadata', () => {
  const { value, store } = fixture();
  for (const origin of [null, { ...ORIGIN, kind: 'ai' }, { ...ORIGIN, source_revision: true },
    { ...ORIGIN, source_revision: 0 }, { ...ORIGIN, source_revision: 1.5 }, { ...ORIGIN, source_revision: 9007199254740992 },
    { ...ORIGIN, generator: '<img src=x>' }, { ...ORIGIN, generator: 'local-demo-v1\n' },
    { ...ORIGIN, draft_id: ORIGIN.draft_id + '\n' }, { ...ORIGIN, draft_id: '../bad' }, { ...ORIGIN, extra: 'private' }]) {
    const bad = copy(value); bad.report.advisor.history[0].origin = origin;
    assert.throws(() => store.save(bad));
    assert.equal(store.list().length, 0);
  }
});

test('unsafe provenance cannot create a source label or survive carryEdits', () => {
  const { w, value } = fixture();
  for (const origin of [null, { ...ORIGIN, generator: 'local-demo-v1\n' }, { ...ORIGIN, draft_id: ORIGIN.draft_id + '\n' }]) {
    value.report.advisor.history[0].origin = origin;
    assert.equal(w.reportEditing.originLabel(origin), '');
    const next = w.generateReport(value);
    w.reportEditing.carryEdits(value.report, next);
    assert.equal(next.advisor.history.length, 0);
    assert.ok(!w.renderReport(next).includes('顾问核对·本地模拟草稿'));
  }
});

test('a discarded corrupt latest history entry cannot attribute newer text to an older draft', () => {
  const { w, value } = fixture();
  value.report.advisor.history.push({ ...copy(value.report.advisor.history[0]), id: 'later', after: '后来的不同建议', origin: null });
  value.report.advisor.sections.plan = '后来的不同建议';
  const next = w.generateReport(value);
  w.reportEditing.carryEdits(value.report, next);
  assert.equal(next.advisor.history.length, 1);
  assert.equal(w.reportEditing.getText(next, 'plan'), '后来的不同建议');
  assert.ok(!w.renderReport(next).includes('顾问核对·本地模拟草稿'));
});

test('invalid imported provenance rejects the whole backup and preserves existing records', () => {
  const { value, store } = fixture();
  store.save(value);
  const before = store.exportBackup();
  const incoming = JSON.parse(before);
  incoming.records[0].advisor.history[0].origin.generator = '<script>bad</script>';
  assert.throws(() => store.importBackup(JSON.stringify(incoming), { onConflict: 'replace' }));
  assert.equal(store.list()[0].advisor.history[0].origin.generator, ORIGIN.generator);
});

test('current source badges follow the latest edit and never attribute a manual restore to a generator', () => {
  const { w, value } = fixture();
  for (const [kind, label] of [['local_mock', '顾问核对·本地模拟草稿'], ['rule', '顾问核对·规则草稿'], ['provider', '顾问核对·模型草稿']]) {
    value.report.advisor.history[0].origin.kind = kind;
    assert.match(w.renderReport(value.report), new RegExp(label));
  }
  const id = value.report.advisor.history[0].id;
  w.reportEditing.restoreEdit(value.report, id, '另一老师');
  assert.equal(value.report.advisor.history.at(-1).origin, undefined);
  assert.ok(!w.renderReport(value.report).includes('顾问核对·模型草稿'));
  assert.match(w.renderReport(value.report), /顾问已编辑/);
});

test('legacy edits stay compatible and public summaries exclude draft IDs and origin audit', () => {
  const { w, value, store } = fixture(legacyState);
  const saved = store.save(value).record;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../js/share-summary.js'), 'utf8'), { window: w });
  const summary = w.ParentSummary.build(saved);
  assert.equal(summary.sections.plan, '经核对的草稿建议');
  assert.ok(!JSON.stringify(summary).includes(ORIGIN.draft_id));
  assert.ok(!JSON.stringify(summary).includes('local-demo-v1'));
  delete value.report.advisor.history[0].origin;
  assert.doesNotThrow(() => store.save(value, { overwrite: true }));
  assert.equal(store.list()[0].advisor.history[0].origin, undefined);
});

test('manual edits and resets record the human action without inheriting a draft source', () => {
  const { w, value } = fixture();
  for (const action of ['edit', 'reset']) {
    assert.equal(w.reportEditing.applyEdit(value.report, 'plan', `人工建议 ${action}`, '人工老师', action), true);
    assert.equal(value.report.advisor.history.at(-1).origin, undefined);
    assert.ok(!w.renderReport(value.report).includes('顾问核对·本地模拟草稿'));
  }
  assert.deepEqual(copy(value.report.advisor.history[0].origin), ORIGIN);
});

test('editor history and printable advice disclose reviewed local simulation source', () => {
  const { value } = fixture();
  return withPage(async page => {
    await page.locator('#editReportBtn').click();
    assert.match(await page.locator('#reportEditor').textContent(), /顾问核对·本地模拟草稿/);
    assert.match(await page.locator('#reportEditor').textContent(), /local-demo-v1/);
    assert.match(await page.locator('#reportEditor').textContent(), /源修订 7/);
    await page.emulateMedia({ media: 'print' });
    assert.match(await page.locator('#reportRoot').textContent(), /顾问核对·本地模拟草稿/);
    assert.equal(await page.locator('#reportRoot img[src=x]').count(), 0);
  }, { beforeLoad: page => page.addInitScript(value => localStorage.setItem('pathwise.state.v1', JSON.stringify(value)), value) });
});
