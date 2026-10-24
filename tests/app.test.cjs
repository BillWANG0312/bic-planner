const { test } = require('node:test');
const assert = require('node:assert/strict');
const { withPage } = require('./helpers/browser.cjs');

function state(screen = 'academic', idx = 0) {
  return { info: { name: '测试学生', grade: '9', year: '2028 年秋季' }, academic: { answers: {} }, plan: { answers: {} }, mbti: { answers: Array(30).fill(null) }, ui: { screen: 'test', resumeScreen: screen, idx }, report: null };
}
function saved(value, entered = true) {
  return { beforeLoad: page => page.addInitScript(({ value, entered }) => {
    if (!localStorage.getItem('pathwise.state.v1')) localStorage.setItem('pathwise.state.v1', JSON.stringify(value));
    if (entered) sessionStorage.setItem('pathwise.entered', '1');
  }, { value, entered }) };
}

test('unfinished answers survive a fresh browser session', () => withPage(async page => {
  assert.equal(await page.locator('#screen-test').evaluate(el => el.classList.contains('active')), true);
  assert.match(await page.locator('#testMeta').innerText(), /^3 \/ \d+$/);
  assert.equal(await page.locator('#inName').inputValue(), '测试学生');
}, saved(state('academic', 2), false)));

test('selected academic answers remain visible after returning to a question', () => withPage(async page => {
  await page.locator('#testBody .option').nth(1).click();
  await page.locator('#testNext').click();
  await page.locator('#testBack').click();
  assert.equal(await page.locator('#testBody .option.selected').count(), 1);
  assert.equal(await page.locator('#testBody .option.selected').getAttribute('data-v'), '1');
}, saved(state())));

test('test module highlights its step and uses the test layout', () => withPage(async page => {
  assert.equal(await page.locator('.step.active').getAttribute('data-step'), 'plan');
  assert.equal(await page.locator('body').evaluate(el => el.classList.contains('in-test')), true);
}, saved(state('plan'))));

test('storage denial still allows starting and answering a test', () => withPage(async page => {
  const errors = [];
  page.on('pageerror', err => errors.push(err.message));
  await page.locator('#startBtn').click();
  await page.locator('#inName').fill('无存储学生');
  await page.locator('#inGrade button').first().click();
  await page.locator('#inYear button').first().click();
  await page.locator('#infoForm button[type=submit]').click();
  await page.locator('#testBody .option').first().click();
  await page.locator('#testNext').click();
  assert.match(await page.locator('#testMeta').innerText(), /^2 \/ \d+$/);
  assert.deepEqual(errors, []);
}, { beforeLoad: page => page.addInitScript(() => {
  Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('blocked', 'SecurityError'); } });
}) }));

test('malformed saved answer collections recover to a usable application', () => withPage(async page => {
  await page.locator('.step[data-step=info]').click();
  await page.locator('#inName').fill('恢复学生');
  assert.equal(await page.locator('#inGrade button').count(), 4);
  const current = await page.evaluate(() => window.__pathwise.state);
  assert.equal(Array.isArray(current.mbti.answers), true);
  assert.equal(typeof current.plan.answers, 'object');
}, saved({ ...state(), ui: { screen: 'home', idx: 0 }, plan: null, mbti: { answers: 'broken' } })));

test('MBTI automatic advance is cancelled when leaving the test', () => withPage(async page => {
  await page.locator('.likert button').first().click();
  await page.locator('.step[data-step=info]').click();
  await page.waitForTimeout(500);
  assert.equal(await page.evaluate(() => window.__pathwise.state.ui.idx), 0);
  assert.equal(await page.locator('#screen-info').evaluate(el => el.classList.contains('active')), true);
}, saved(state('mbti'))));

test('the final MBTI answer cannot generate duplicate reports', () => withPage(async page => {
  await page.evaluate(() => {
    const original = window.generateReport;
    window.reportCalls = 0;
    window.generateReport = (...args) => { window.reportCalls++; return original(...args); };
  });
  await page.locator('.likert button').first().click();
  // 隐藏的 inactive 屏幕里也有 .likert 按钮，必须限定在当前激活的测试屏内操作
  await page.waitForFunction(() => !document.getElementById('screen-test').classList.contains('active'), null, { timeout: 10000 });
  await page.keyboard.press('Enter');
  // 生成动画按步骤计时，完成全部必答题的数据量更大，这里放宽等待
  await page.waitForFunction(() => document.querySelector('#screen-report').classList.contains('active'), null, { timeout: 15000 });
  await page.waitForTimeout(700);
  assert.equal(await page.evaluate(() => window.reportCalls), 1);
}, saved(state('mbti', 29))));

test('multi-select questions accept letter keyboard shortcuts', () => withPage(async page => {
  await page.keyboard.press('a');
  assert.equal(await page.locator('.tag-card.selected').count(), 1);
}, saved(state('plan', 1))));

test('quick report action returns after clearing and retyping a name', () => withPage(async page => {
  await page.locator('#startBtn').click();
  await page.locator('#inName').fill('甲');
  await page.locator('#inName').fill('');
  await page.locator('#inName').fill('乙');
  assert.equal(await page.locator('#updateReportBtn').evaluate(el => el.hidden), false);
  assert.equal(await page.locator('#updateReportBtn').isVisible(), true);
}));

test('grade is consistent between the information and planning forms', () => withPage(async page => {
  assert.equal(await page.locator('#testBody .option.selected').getAttribute('data-v'), '9');
  await page.locator('#testBody .option[data-v="10"]').click();
  await page.locator('.step[data-step=info]').click();
  assert.equal(await page.locator('#inGrade button[aria-checked=true]').getAttribute('data-v'), '10');
}, saved(state('plan'))));

test('resume returns to the same module and question after visiting home', () => withPage(async page => {
  await page.locator('.step[data-step=info]').click();
  await page.locator('#infoForm [data-goto=home]').click();
  await page.locator('#resumeBtn').click();
  assert.equal(await page.locator('#screen-test').evaluate(el => el.classList.contains('active')), true);
  assert.equal(await page.locator('#testTitle').innerText(), '专业规划测试');
  assert.equal(await page.locator('#testMeta').innerText(), '5 / 13');
}, saved(state('plan', 4))));

test('refresh during report generation resumes generation', () => withPage(async page => {
  await page.waitForFunction(() => document.querySelector('#screen-report').classList.contains('active'));
  assert.equal(await page.locator('#reportRoot .paper').count(), 1);
}, saved({ ...state('mbti', 29), ui: { screen: 'generating', resumeScreen: 'mbti', idx: 29 } })));

test('regenerating a report carries advisor edits and persists them across reloads', () => withPage(async page => {
  await page.waitForFunction(() => document.querySelector('#screen-report').classList.contains('active'));
  const oldId = await page.locator('#reportId').innerText();
  await page.locator('#editReportBtn').click();
  await page.locator('#advisorAuthor').fill('张老师');
  await page.locator('#advisorText').fill('建议每周复盘两次学习笔记。');
  await page.locator('#advisorForm button[type=submit]').click();
  await page.locator('.step[data-step=info]').click();
  await page.locator('#updateReportBtn').click();
  await page.waitForFunction(() => document.querySelector('#screen-report').classList.contains('active'));
  const advisor = await page.evaluate(() => window.__pathwise.state.report.advisor);
  assert.equal(advisor.sections.summary, '建议每周复盘两次学习笔记。');
  assert.equal(advisor.history.length, 1);
  assert.equal(advisor.carriedFrom, oldId);
  await page.reload();
  assert.match(await page.locator('#reportRoot').innerText(), /建议每周复盘两次学习笔记。/);
}, saved({ ...state(), ui: { screen: 'generating', resumeScreen: 'mbti', idx: 0 } })));

test('legacy report scoring is refreshed while its identifier and date are preserved', () => withPage(async page => {
  await page.waitForFunction(() => document.querySelector('#screen-report').classList.contains('active'));
  const identity = await page.evaluate(() => {
    const current = window.__pathwise.state;
    const identity = { batchId: current.report.meta.batchId, date: current.report.meta.date };
    delete current.report.meta.coverage;
    current.report.academic.subjects[0].pct = 97;
    return identity;
  });
  await page.reload();
  const report = await page.evaluate(() => window.__pathwise.state.report);
  assert.ok(report.meta.coverage);
  assert.equal(report.meta.batchId, identity.batchId);
  assert.equal(report.meta.date, identity.date);
  assert.notEqual(report.academic.subjects[0].pct, 97);
}, saved({ ...state(), ui: { screen: 'generating', resumeScreen: 'mbti', idx: 0 } })));

test('academic questions show their difficulty and data version', () => withPage(async page => {
  assert.match(await page.locator('#testSub').innerText(), /2026\.10/);
  assert.match(await page.locator('.q-tag').innerText(), /基础|中等|进阶/);
}, saved(state())));

test('going back across a module boundary opens the preceding final question', () => withPage(async page => {
  await page.locator('#testBack').click();
  const [current, total] = (await page.locator('#testMeta').innerText()).split('/').map(Number);
  assert.equal(current, total);
  assert.match(await page.locator('#testTitle').innerText(), /学术/);
}, saved(state('plan'))));

test('full browser storage shows a nonblocking warning while answers remain usable', () => withPage(async page => {
  assert.equal(await page.locator('#storageNotice').isVisible(), true);
  assert.match(await page.locator('#storageNotice').innerText(), /无法保存进度/);
  await page.locator('#startBtn').click();
  await page.locator('#inName').fill('存储已满');
  await page.locator('#inGrade button').first().click();
  await page.locator('#inYear button').first().click();
  await page.locator('#infoForm button[type=submit]').click();
  await page.locator('#testBody .option').first().click();
  await page.locator('#testNext').click();
  assert.match(await page.locator('#testMeta').innerText(), /^2 \/ \d+$/);
}, { beforeLoad: page => page.addInitScript(() => {
  Storage.prototype.setItem = () => { throw new DOMException('full', 'QuotaExceededError'); };
}) }));

test('damaged cached report is rebuilt from answers while valid advisor edits survive', () => withPage(async page => {
  await page.waitForFunction(() => document.querySelector('#screen-report').classList.contains('active'));
  await page.locator('#editReportBtn').click();
  await page.locator('#advisorAuthor').fill('王老师');
  await page.locator('#advisorText').fill('保持每周复盘。');
  await page.locator('#advisorForm button[type=submit]').click();
  const batchId = await page.evaluate(() => {
    const report = window.__pathwise.state.report;
    report.academic.subjects = null;
    report.meta.coverage = { academic: { answered: 999, total: 1 } };
    return report.meta.batchId;
  });
  await page.reload();
  await page.locator('#screen-report.active').waitFor();
  const report = await page.evaluate(() => window.__pathwise.state.report);
  assert.equal(report.meta.batchId, batchId);
  assert.equal(report.meta.coverage.academic.total, 60);
  assert.equal(report.advisor.sections.summary, '保持每周复盘。');
}, saved({ ...state(), ui: { screen: 'generating', resumeScreen: 'mbti', idx: 0 } })));
