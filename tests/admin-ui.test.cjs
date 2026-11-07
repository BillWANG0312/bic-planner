const { test } = require('node:test');
const assert = require('node:assert/strict');
const { withPage } = require('./helpers/browser.cjs');
const { loadReportScripts, state } = require('./helpers/report.cjs');

function archivedRecord() {
  const w = loadReportScripts();
  return {
    id: 'local-admin-one',
    createdAt: '2026-10-24T00:00:00.000Z',
    updatedAt: '2026-10-24T00:00:00.000Z',
    bankVersion: '2026.10',
    catalogVersion: '2026.10.24',
    state: state(w, true),
    reportMeta: { batchId: 'AP-ADMIN-1', date: '2026年10月24日' }
  };
}

function fakeSetup() {
  const record = archivedRecord();
  const fakeClient = `
window.CloudReports = {create() {
  const s = window.__adminTest = {
    calls: [], session: null, record: ${JSON.stringify(record)},
    codes: [{id: 'code-one', code: '23456789AB', label: '2026 秋季 8 年级', status: 'unused',
      created_at: 1790000000, expires_at: 1790604800, revoked_at: null, redeemed_at: null,
      completed_at: null, report_id: null}],
    reports: [{id: 'report-one', created_at: '2026-10-24T00:00:00.000Z', updated_at: '2026-10-24T00:00:00.000Z',
      report_ref: 'AP-ADMIN-1', name: '测试同学', grade: '8', year: '2027 年秋季',
      test_code_id: 'code-one', code: '23456789AB', label: '2026 秋季 8 年级'}]
  };
  return {
    async connect() { s.calls.push(['connect']); return s.session; },
    async login(username, password) {
      s.calls.push(['login', username, password]);
      s.session = {user: {id: 'admin-one', username, role: username === 'student.test' ? 'student' : 'advisor'},
        expires_at: 2000000000};
      return s.session;
    },
    async logout() { s.calls.push(['logout']); s.session = null; },
    disconnect() { s.calls.push(['disconnect']); s.session = null; },
    async adminListTestCodes() { s.calls.push(['codes']); return {items: s.codes.map(item => ({...item})), total: s.codes.length}; },
    async adminListReports() { s.calls.push(['reports']); return {items: s.reports.map(item => ({...item})), total: s.reports.length}; },
    async adminCreateTestCode(label, hours) {
      s.calls.push(['create', label, hours]);
      const created = {id: 'code-two', code: 'ABCDEFGHJK', label, status: 'unused',
        created_at: 1790000100, expires_at: 1790000100 + hours * 3600, revoked_at: null,
        redeemed_at: null, completed_at: null, report_id: null};
      s.codes.unshift(created);
      return {...created};
    },
    async adminRevokeTestCode(id) {
      s.calls.push(['revoke', id]);
      const item = s.codes.find(code => code.id === id);
      item.status = 'revoked';
      item.revoked_at = 1790000200;
      return {...item};
    },
    async adminGetReport(id) {
      s.calls.push(['report', id]);
      return {id, revision: 1, created_at: '2026-10-24T00:00:00.000Z',
        updated_at: '2026-10-24T00:00:00.000Z', record: JSON.parse(JSON.stringify(s.record)),
        code: '23456789AB', label: '2026 秋季 8 年级', test_code_id: 'code-one'};
    }
  };
}};`;
  return {
    path: '/admin.html',
    prepare: async context => context.route('**/js/cloud-client.js*', route => route.fulfill({
      contentType: 'application/javascript; charset=utf-8', body: fakeClient
    }))
  };
}

async function signIn(page, username = 'tlwl-bic') {
  await page.locator('#adminUsername').fill(username);
  await page.locator('#adminPassword').fill('private-test-password');
  await page.locator('#adminLoginBtn').click();
  await page.locator('#adminWorkspace').waitFor({ state: 'visible' });
}

test('the admin page boots to login and rejects a student account', () => withPage(async page => {
  await page.locator('#adminLoginPanel').waitFor({ state: 'visible' });
  await page.locator('#adminUsername').fill('student.test');
  await page.locator('#adminPassword').fill('private-test-password');
  await page.locator('#adminLoginBtn').click();
  await page.locator('#adminConnectStatus').filter({ hasText: '不是管理员公共账号' }).waitFor();
  assert.equal(await page.locator('#adminWorkspace').isHidden(), true);
  const calls = await page.evaluate(() => window.__adminTest.calls);
  assert.deepEqual(calls.map(call => call[0]), ['connect', 'connect', 'login', 'logout', 'disconnect']);
}, fakeSetup()));

test('the public advisor account sees codes and submitted reports', () => withPage(async page => {
  await page.locator('#adminLoginPanel').waitFor({ state: 'visible' });
  await signIn(page);
  assert.match(await page.locator('#adminIdentity').innerText(), /tlwl-bic/);
  await page.locator('#adminCodes table').waitFor();
  assert.equal(await page.locator('#adminCodes tbody tr').count(), 1);
  assert.equal(await page.locator('#adminCodes tbody tr td').first().innerText(), '23456789AB');
  await page.locator('#adminReports table').waitFor();
  assert.equal(await page.locator('#adminReports tbody tr').count(), 1);
  assert.match(await page.locator('#adminReports tbody tr').innerText(), /测试同学/);
  assert.match(await page.locator('#adminListStatus').innerText(), /测试码 1 个，学生报告 1 份/);
}, fakeSetup()));

test('creating a code shows it once and refreshes the list', () => withPage(async page => {
  await page.locator('#adminLoginPanel').waitFor({ state: 'visible' });
  await signIn(page);
  await page.locator('#adminCodeLabel').fill('2027 春季 9 年级');
  await page.locator('#adminCodeHours').selectOption('336');
  await page.locator('#adminCreateBtn').click();
  await page.locator('#adminNewCode').waitFor({ state: 'visible' });
  assert.match(await page.locator('#adminNewCode').innerText(), /ABCDEFGHJK/);
  assert.match(await page.locator('#adminCreateStatus').innerText(), /已生成/);
  assert.equal(await page.locator('#adminCodeLabel').inputValue(), '');
  await page.locator('#adminCodes tbody tr').nth(1).waitFor();
  assert.equal(await page.locator('#adminCodes tbody tr').count(), 2);
  const calls = await page.evaluate(() => window.__adminTest.calls);
  assert.deepEqual(calls.find(call => call[0] === 'create'), ['create', '2027 春季 9 年级', 336]);
}, fakeSetup()));

test('revoking a code confirms first and updates its status', () => withPage(async page => {
  page.on('dialog', dialog => dialog.accept());
  await page.locator('#adminLoginPanel').waitFor({ state: 'visible' });
  await signIn(page);
  await page.locator('#adminCodes tbody tr button', { hasText: '撤销' }).click();
  await page.locator('#adminCodes tbody tr td', { hasText: '已撤销' }).waitFor();
  assert.equal(await page.locator('#adminCodes tbody tr button').count(), 0);
  assert.match(await page.locator('#adminListStatus').innerText(), /已撤销/);
  const calls = await page.evaluate(() => window.__adminTest.calls);
  assert.deepEqual(calls.find(call => call[0] === 'revoke'), ['revoke', 'code-one']);
}, fakeSetup()));

test('opening a report renders it in the admin page and links it to the code', () => withPage(async page => {
  await page.locator('#adminLoginPanel').waitFor({ state: 'visible' });
  await signIn(page);
  await page.locator('#adminReports tbody tr button', { hasText: '查看报告' }).click();
  await page.locator('#adminReportPanel').waitFor({ state: 'visible' });
  assert.match(await page.locator('#adminReportHeading').innerText(), /测试同学/);
  assert.match(await page.locator('#adminReportHeading').innerText(), /AP-ADMIN-1/);
  assert.match(await page.locator('#adminReportHeading').innerText(), /23456789AB/);
  assert.ok((await page.locator('#adminReportRoot').innerText()).length > 100);
  await page.locator('#adminCloseReportBtn').click();
  assert.equal(await page.locator('#adminReportPanel').isHidden(), true);
}, fakeSetup()));

test('logging out returns to the login panel', () => withPage(async page => {
  await page.locator('#adminLoginPanel').waitFor({ state: 'visible' });
  await signIn(page);
  await page.locator('#adminLogoutBtn').click();
  await page.locator('#adminLoginPanel').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#adminWorkspace').isHidden(), true);
  assert.match(await page.locator('#adminConnectStatus').innerText(), /已退出账号/);
}, fakeSetup()));
