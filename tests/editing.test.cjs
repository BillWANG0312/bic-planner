const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadReportScripts, state } = require('./helpers/report.cjs');

test('advisor edits change narrative only and record author, before and after', () => {
  const w = loadReportScripts();
  assert.ok(w.reportEditing, '报告文字编辑功能应存在');
  const r = w.generateReport(state(w, true));
  const before = w.reportEditing.getText(r, 'plan');
  const scores = JSON.stringify(r.academic);
  w.reportEditing.applyEdit(r, 'plan', '先完成课程体验，再确认专业。', '王老师');
  assert.equal(w.reportEditing.getText(r, 'plan'), '先完成课程体验，再确认专业。');
  assert.equal(JSON.stringify(r.academic), scores);
  assert.equal(r.advisor.history.length, 1);
  assert.equal(r.advisor.history[0].before, before);
  assert.equal(r.advisor.history[0].after, '先完成课程体验，再确认专业。');
  assert.equal(r.advisor.history[0].author, '王老师');
  assert.ok(Number.isFinite(Date.parse(r.advisor.history[0].at)));
});

test('restore records a new edit and keeps both earlier records', () => {
  const w = loadReportScripts();
  assert.ok(w.reportEditing, '报告文字编辑功能应存在');
  const r = w.generateReport(state(w, true));
  const original = w.reportEditing.getText(r, 'plan');
  w.reportEditing.applyEdit(r, 'plan', '第一次建议', '李老师');
  const id = r.advisor.history[0].id;
  w.reportEditing.applyEdit(r, 'plan', '第二次建议', '陈老师');
  w.reportEditing.restoreEdit(r, id, '王老师');
  assert.equal(w.reportEditing.getText(r, 'plan'), original);
  assert.equal(r.advisor.history.length, 3);
  assert.equal(r.advisor.history[0].after, '第一次建议');
  assert.equal(r.advisor.history[2].action, 'restore');
  assert.equal(r.advisor.history[2].author, '王老师');
});

test('rebuilding a report keeps advisor edits and original source references', () => {
  const w = loadReportScripts();
  assert.ok(w.reportEditing, '报告文字编辑功能应存在');
  const old = w.generateReport(state(w, true));
  old.meta.batchId = 'AP-OLD';
  w.reportEditing.applyEdit(old, 'academic', '每周安排两次错题复盘。', '王老师');
  const next = w.generateReport(state(w, false));
  next.meta.batchId = 'AP-NEW';
  w.reportEditing.carryEdits(old, next);
  assert.equal(w.reportEditing.getText(next, 'academic'), '每周安排两次错题复盘。');
  assert.equal(next.advisor.history[0].reportId, 'AP-OLD');
  assert.equal(next.advisor.carriedFrom, 'AP-OLD');
  assert.notEqual(next.advisor, old.advisor);
});

test('blank, oversized or unrecognized changes do not alter the report', () => {
  const w = loadReportScripts();
  assert.ok(w.reportEditing, '报告文字编辑功能应存在');
  const r = w.generateReport(state(w, true));
  const before = JSON.stringify(r);
  for (const [section, value, author] of [['plan', '', '王老师'], ['plan', '建议', ''], ['score', '100', '王老师'], ['plan', '字'.repeat(4001), '王老师']]) {
    assert.throws(() => w.reportEditing.applyEdit(r, section, value, author));
    assert.equal(JSON.stringify(r), before);
  }
});

test('damaged stored advisor structures are ignored without blocking a regenerated report', () => {
  const w = loadReportScripts();
  for (const advisor of ['broken', { sections: { summary: 7, plan: '有效建议' }, history: 'broken' }]) {
    const old = w.generateReport(state(w, true));
    old.advisor = advisor;
    const next = w.generateReport(state(w));
    assert.doesNotThrow(() => w.reportEditing.carryEdits(old, next));
    assert.equal(typeof w.reportEditing.getText(next, 'summary'), 'string');
    assert.ok(!next.advisor || Array.isArray(next.advisor.history));
    if (typeof advisor === 'object') assert.equal(w.reportEditing.getText(next, 'plan'), '有效建议');
  }
});

test('completed assessments without targeted actions get a truthful general revision suggestion', () => {
  const w = loadReportScripts();
  const r = w.generateReport(state(w, true));
  r.next = [];
  const text = w.reportEditing.getText(r, 'academic');
  assert.ok(!text.includes('请先完成'));
  assert.ok(text.includes('复盘'));
});
