const { test } = require('node:test');
const assert = require('node:assert/strict');
const { withPage } = require('./helpers/browser.cjs');
const { loadReportScripts, state } = require('./helpers/report.cjs');

const TESTCODE_CONFIG = { enabled: true, apiBase: './api/', mode: 'testcode' };

const fakeClient = `
window.CloudReports = {create() {
  const s = window.__testCode || (window.__testCode =
    {calls: [], session: null, joinError: null, submitError: null, created: true});
  return {
    async testCodeSession() { s.calls.push(['session']); return s.session; },
    async joinTestCode(code) {
      s.calls.push(['join', code]);
      if (s.joinError) throw s.joinError;
      s.session = {id: 'code-one', label: '2026 秋季', expires_at: 2000000000};
      return {label: '2026 秋季', expires_at: 2000000000, resumed: false};
    },
    async submitStudentReport(record) {
      s.calls.push(['submit', JSON.parse(JSON.stringify(record))]);
      if (s.submitError) throw s.submitError;
      return {id: 'report-one', created_at: '2026-10-24T00:00:00.000Z', created: s.created, label: '2026 秋季'};
    }
  };
}};`;

function pageOptions(extra = {}) {
  return {
    ...extra,
    cloudConfig: TESTCODE_CONFIG,
    prepare: async context => {
      await context.route('**/js/cloud-client.js*', route => route.fulfill({
        contentType: 'application/javascript; charset=utf-8', body: fakeClient
      }));
      if (extra.prepare) await extra.prepare(context);
    }
  };
}

function completeState() {
  const w = loadReportScripts();
  return { ...state(w, true), ui: { screen: 'home', idx: 0 }, report: null };
}

function seedComplete(options = {}) {
  const value = completeState();
  return pageOptions({ ...options, beforeLoad: page => page.addInitScript(raw => {
    localStorage.setItem('pathwise.state.v1', raw);
  }, JSON.stringify(value)) });
}

test('start asks for a test code and the notice says work is submitted to the school', () => withPage(async page => {
  await page.locator('#startBtn').click();
  assert.equal(await page.locator('#codeGate').isVisible(), true);
  assert.match(await page.locator('.code-gate-notice').innerText(), /作答与生成的报告会提交给学校\/机构保存/);
  assert.equal(await page.locator('#codeGateInput').evaluate(el => el === document.activeElement), true);
  assert.equal(await page.locator('#cloudBtn').isHidden(), true);
  assert.equal(await page.locator('#openCloudBtn').isHidden(), true);
  assert.deepEqual(await page.evaluate(() => window.__testCode.calls), [['session']]);
}, pageOptions()));

test('a valid code starts the assessment and keeps the joined marker only in memory', () => withPage(async page => {
  await page.locator('#startBtn').click();
  await page.locator('#codeGateInput').fill('abcd-234567');
  await page.locator('#codeGateSubmit').click();
  await page.locator('#screen-info').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#screen-info').evaluate(el => el.classList.contains('active')), true);
  assert.equal(await page.locator('#codeGate').isVisible(), false);
  assert.deepEqual(await page.evaluate(() => window.__testCode.calls),
    [['session'], ['join', 'abcd-234567']]);
  assert.equal(await page.evaluate(() => sessionStorage.getItem('bic.test.joined')), null);
}, pageOptions()));

test('an already active code session skips the gate', () => withPage(async page => {
  await page.evaluate(() => { window.__testCode.session = { id: 'code-one', label: '批次', expires_at: 2000000000 }; });
  await page.locator('#startBtn').click();
  await page.locator('#screen-info').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#codeGate').isVisible(), false);
  assert.deepEqual(await page.evaluate(() => window.__testCode.calls), [['session']]);
  assert.equal(await page.evaluate(() => sessionStorage.getItem('bic.test.joined')), null);
}, pageOptions()));

test('cancelling the gate does not start or join', () => withPage(async page => {
  await page.locator('#startBtn').click();
  await page.locator('#codeGateCancel').click();
  assert.equal(await page.locator('#codeGate').isVisible(), false);
  assert.equal(await page.locator('#screen-home').evaluate(el => el.classList.contains('active')), true);
  assert.deepEqual(await page.evaluate(() => window.__testCode.calls), [['session']]);
}, pageOptions()));

test('a used code keeps the gate open with an actionable message', () => withPage(async page => {
  await page.evaluate(() => {
    window.__testCode.joinError = Object.assign(new Error('already in use'), { status: 409, code: 'IN_USE' });
  });
  await page.locator('#startBtn').click();
  await page.locator('#codeGateInput').fill('23456789AB');
  await page.locator('#codeGateSubmit').click();
  await page.locator('#codeGateStatus').filter({ hasText: '已经被使用' }).waitFor();
  assert.equal(await page.locator('#codeGate').isVisible(), true);
  assert.equal(await page.locator('#screen-home').evaluate(el => el.classList.contains('active')), true);
  assert.equal(await page.evaluate(() => sessionStorage.getItem('bic.test.joined')), null);
  assert.equal(await page.locator('#codeGateSubmit').isEnabled(), true);
}, pageOptions()));

test('an expired or revoked code is reported distinctly', () => withPage(async page => {
  await page.evaluate(() => {
    window.__testCode.joinError = Object.assign(new Error('expired'), { status: 410, code: 'EXPIRED' });
  });
  await page.locator('#startBtn').click();
  await page.locator('#codeGateInput').fill('23456789AB');
  await page.locator('#codeGateSubmit').click();
  await page.locator('#codeGateStatus').filter({ hasText: '已过期或已被撤销' }).waitFor();
}, pageOptions()));

test('a generated report is submitted automatically and the page stays viewable', () => withPage(async page => {
  await page.evaluate(() => window.__pathwise.generate());
  await page.locator('#reportSubmitStatus').filter({ hasText: '报告已提交到服务器保存' }).waitFor();
  assert.equal(await page.locator('#reportSubmitRetry').isHidden(), true);
  assert.equal(await page.locator('#screen-report').evaluate(el => el.classList.contains('active')), true);
  const calls = await page.evaluate(() => window.__testCode.calls);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'submit');
  assert.equal(calls[0][1].state.info.name, '测试同学');
  assert.equal(calls[0][1].reportMeta.batchId, await page.evaluate(() => window.__pathwise.state.report.meta.batchId));
}, seedComplete()));

test('a completed report disappears on reload and the used code cannot show it again', () => withPage(async page => {
  await page.evaluate(() => window.__pathwise.generate());
  await page.locator('#reportSubmitStatus').filter({ hasText: '报告已提交到服务器保存' }).waitFor();
  assert.match(await page.locator('#reportOneTimeNotice').innerText(), /关闭或刷新本页后.*无法再次查看/);
  await page.reload();
  assert.equal(await page.evaluate(() => window.__pathwise.state.report), null);
  await page.locator('#startBtn').click();
  assert.equal(await page.locator('#codeGate').isVisible(), true);
  assert.equal(await page.locator('#screen-report.active').count(), 0);
}, seedComplete()));

test('a failed submission offers an explicit retry without blocking the report', () => withPage(async page => {
  await page.evaluate(() => {
    window.__testCode.submitError = Object.assign(new Error('network'), { code: 'NETWORK' });
  });
  await page.evaluate(() => window.__pathwise.generate());
  await page.locator('#reportSubmitStatus').filter({ hasText: '报告提交未成功' }).waitFor();
  assert.equal(await page.locator('#reportSubmitRetry').isVisible(), true);
  assert.equal(await page.locator('#screen-report').evaluate(el => el.classList.contains('active')), true);
  assert.deepEqual(await page.evaluate(() => window.__testCode.calls.map(call => call[0])), ['submit']);

  await page.evaluate(() => { window.__testCode.submitError = null; });
  await page.locator('#reportSubmitRetry').click();
  await page.locator('#reportSubmitStatus').filter({ hasText: '报告已提交到服务器保存' }).waitFor();
  assert.equal(await page.locator('#reportSubmitRetry').isHidden(), true);
  assert.deepEqual(await page.evaluate(() => window.__testCode.calls.map(call => call[0])), ['submit', 'submit']);
}, seedComplete()));

test('an already saved report can be viewed without another code', () => {
  const w = loadReportScripts();
  const value = { ...state(w, true), ui: { screen: 'home', idx: 0 } };
  value.report = w.generateReport(value);
  return withPage(async page => {
    await page.locator('#startBtn').click();
    await page.locator('#screen-report').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#codeGate').isVisible(), false);
    assert.equal(await page.locator('#screen-report').evaluate(el => el.classList.contains('active')), true);
    assert.deepEqual(await page.evaluate(() => window.__testCode.calls), []);
  }, pageOptions({ beforeLoad: page => page.addInitScript(raw => {
    localStorage.setItem('pathwise.state.v1', raw);
  }, JSON.stringify(value)) }));
});

test('without the test-code service mode the gate stays out of the way', () => withPage(async page => {
  await page.locator('#startBtn').click();
  assert.equal(await page.locator('#codeGate').isVisible(), false);
  await page.locator('#screen-info').waitFor({ state: 'visible' });
}, {
  cloudConfig: { enabled: true, apiBase: './api/' },
  prepare: async context => {
    await context.route('**/js/cloud-client.js*', route => route.fulfill({
      contentType: 'application/javascript; charset=utf-8', body: ''
    }));
  }
}));
