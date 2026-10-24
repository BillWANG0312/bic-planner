/* Actual browser -> same-origin development server -> SQLite; no external service. */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const net = require('node:net');
const { spawn, spawnSync } = require('node:child_process');
const { launchBrowser } = require('../helpers/browser.cjs');
const { loadReportScripts, state } = require('../helpers/report.cjs');

const root = path.resolve(__dirname, '../..');
const temporaryRoot = path.resolve(process.env.BIC_TEST_TEMP || 'D:/Codex/work/bic-cloud-browser-tests');
const python = process.env.BIC_TEST_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
const password = 'cloud-browser-test-only-password';
let directory, processHandle, browser, origin;
let logs = '';

async function stop() {
  if (browser) { await browser.close(); browser = null; }
  if (processHandle && processHandle.exitCode === null) {
    const exited = new Promise(resolve => processHandle.once('exit', resolve));
    processHandle.kill();
    await exited;
  }
  if (directory) {
    // Never recursively remove an unchecked computed path on Windows.
    assert.equal(path.dirname(path.resolve(directory)), temporaryRoot);
    await fs.rm(directory, { recursive: true, force: true });
    directory = null;
  }
}

before(async () => {
  await fs.mkdir(temporaryRoot, { recursive: true });
  directory = await fs.mkdtemp(path.join(temporaryRoot, 'run-'));
  const reservation = net.createServer();
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  origin = `http://127.0.0.1:${port}`;
  const env = { ...process.env, BIC_DEV: '1', BIC_PORT: String(port),
    BIC_PUBLIC_ORIGIN: origin, BIC_DATABASE_PATH: path.join(directory, 'private.sqlite3'),
    TEMP: directory, TMP: directory, TMPDIR: directory };
  const bootstrap = `from pathlib import Path; import os; from backend.bic_api.db import Database; from backend.bic_api.security import AuthService; auth=AuthService(Database(Path(os.environ['BIC_DATABASE_PATH']))); [auth.create_user('browser.'+str(i),'${password}') for i in range(10)]`;
  const seeded = spawnSync(python, ['-c', bootstrap], { cwd: root, env, encoding: 'utf8' });
  assert.equal(seeded.status, 0, 'Install backend/requirements-dev.txt and set BIC_TEST_PYTHON: ' + (seeded.stderr || seeded.error || ''));
  processHandle = spawn(python, ['-m', 'backend.bic_api.dev'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  processHandle.stdout.on('data', value => { logs += value; });
  processHandle.stderr.on('data', value => { logs += value; });
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (processHandle.exitCode !== null) break;
    try { const response = await fetch(origin + '/api/health'); if (response.ok) { ready = true; break; } } catch (_) { /* startup */ }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.ok(ready, 'Local development server must start: ' + logs);
  browser = await launchBrowser();
});
after(stop);

async function pageFor(index) {
  const w = loadReportScripts();
  const initial = state(w);
  initial.info.name = '连接测试同学' + index;
  initial.ui = { screen: 'report', idx: 0, resumeScreen: 'academic' };
  initial.report = w.generateReport(initial);
  initial.report.meta.batchId = 'AP-CLOUD-' + index;
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(6000);
  await page.addInitScript(initial => {
    if (!localStorage.getItem('pathwise.state.v1')) localStorage.setItem('pathwise.state.v1', JSON.stringify(initial));
  }, initial);
  await page.goto(origin);
  return { context, page };
}

async function signIn(page, index) {
  if (!(await page.locator('#screen-cloud.active').count())) await page.locator('#openCloudBtn').click();
  await page.locator('#cloudConnectBtn').click();
  await page.locator('#cloudLoginForm').waitFor({ state: 'visible' });
  await page.locator('#cloudUsername').fill('browser.' + index);
  await page.locator('#cloudPassword').fill(password);
  await page.locator('#cloudLoginForm button[type=submit]').click();
  await page.locator('#cloudWorkspace').waitFor({ state: 'visible' });
  await page.locator('#cloudRefreshBtn:enabled').waitFor();
}

async function upload(page) {
  await page.locator('#cloudUploadSource').selectOption('current');
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#cloudUploadBtn').click();
  await page.locator('[data-cloud-read]').first().waitFor();
  await page.locator('#cloudRefreshBtn:enabled').waitFor();
}

async function csrf(context) {
  const result = await context.request.get(origin + '/api/auth/session');
  return { Origin: origin, 'X-CSRF-Token': (await result.json()).csrf_token };
}

test('explicit connection/upload uses the latest student, never auto-uploads, and stores no credentials', async () => {
  const { context, page } = await pageFor(0);
  try {
    const requests = [];
    page.on('request', request => { if (request.url().startsWith(origin + '/api/')) requests.push(request); });
    await page.locator('.step[data-step=info]').click();
    await page.locator('#inName').fill('资料已更新的同学');
    await page.locator('[data-goto=home]').first().click();
    await page.locator('#cloudBtn').click();
    assert.equal(requests.length, 0, 'Opening the panel alone must not contact an account service');
    await signIn(page, 0);
    assert.equal((await (await context.request.get(origin + '/api/reports')).json()).total, 0);
    page.once('dialog', dialog => dialog.dismiss());
    await page.locator('#cloudUploadBtn').click();
    assert.equal((await (await context.request.get(origin + '/api/reports')).json()).total, 0);
    await upload(page);
    const list = await (await context.request.get(origin + '/api/reports')).json();
    assert.equal(list.total, 1);
    assert.equal(list.items[0].name, '资料已更新的同学');
    assert.equal(requests.filter(r => r.method() === 'POST' && /\/reports$/.test(r.url())).length, 1);
    assert.equal(await page.evaluate(() => window.ReportStore.create(localStorage).list().length), 0);
    const session = await (await context.request.get(origin + '/api/auth/session')).json();
    const storage = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
    assert.ok(!storage.includes(password) && !storage.includes(session.csrf_token) && !storage.includes('bic_session'));
    assert.equal(await page.locator('#cloudPassword').inputValue(), '');
    if (process.env.BIC_CAPTURE === '1') {
      await fs.mkdir(path.join(root, 'test-results'), { recursive: true });
      await page.screenshot({ path: path.join(root, 'test-results/cloud-desktop.png'), fullPage: true });
    }
    await page.setViewportSize({ width: 375, height: 812 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Account reports fit a 375px screen');
    if (process.env.BIC_CAPTURE === '1') await page.screenshot({ path: path.join(root, 'test-results/cloud-mobile.png'), fullPage: true });
    await page.setViewportSize({ width: 1280, height: 900 });
    requests.length = 0;
    await page.reload();
    await page.locator('#screen-cloud.active').waitFor();
    assert.equal(requests.length, 0, 'Reload does not reconnect automatically');
    assert.equal(await page.locator('[data-cloud-read]').count(), 0);
    await page.locator('#cloudConnectBtn').click();
    await page.locator('[data-cloud-read]').waitFor();
  } finally { await context.close(); }
});

test('a stale cloud update preserves a change from another device without retrying', async () => {
  const { context, page } = await pageFor(1);
  try {
    await signIn(page, 1);
    await upload(page);
    const id = await page.locator('[data-cloud-read]').getAttribute('data-cloud-read');
    await page.locator('[data-cloud-read]').click();
    await page.locator('#cloudDetail').waitFor({ state: 'visible' });
    const saved = await (await context.request.get(origin + '/api/reports/' + id)).json();
    saved.record.state.info.name = '另一设备保留的修改';
    assert.equal((await context.request.put(origin + '/api/reports/' + id, { headers: await csrf(context), data: { record: saved.record, revision: 1 } })).status(), 200);
    page.once('dialog', dialog => dialog.accept());
    await page.locator('#cloudUpdateBtn').click();
    await page.waitForFunction(() => /变化|冲突|重新读取|刷新/.test(document.querySelector('#cloudStatus').textContent));
    const after = await (await context.request.get(origin + '/api/reports/' + id)).json();
    assert.equal(after.revision, 2);
    assert.equal(after.record.state.info.name, '另一设备保留的修改');
  } finally { await context.close(); }
});

test('cancel and local quota errors while opening a server report preserve the active student', async () => {
  const { context, page } = await pageFor(2);
  try {
    await signIn(page, 2);
    const record = await page.evaluate(() => {
      const value = JSON.parse(JSON.stringify(window.__pathwise.state));
      value.info.name = '服务端另一个同学';
      value.report = window.generateReport(value);
      value.report.meta.batchId = 'AP-CLOUD-OTHER';
      let raw = null;
      return window.ReportStore.create({ getItem: () => raw, setItem: (_, data) => { raw = data; } }).save(value).record;
    });
    assert.equal((await context.request.post(origin + '/api/reports', { headers: await csrf(context), data: { record } })).status(), 201);
    await page.locator('#cloudRefreshBtn').click();
    await page.locator('[data-cloud-read]').click();
    await page.locator('#cloudDetail').waitFor({ state: 'visible' });
    page.once('dialog', dialog => dialog.dismiss());
    await page.locator('#cloudOpenBtn').click();
    await page.locator('#cloudOpenBtn:enabled').waitFor();
    assert.equal(await page.evaluate(() => window.__pathwise.state.info.name), '连接测试同学2');
    const persisted = await page.evaluate(() => localStorage.getItem('pathwise.state.v1'));
    await page.evaluate(() => {
      const set = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key === 'pathwise.state.v1') throw new DOMException('full', 'QuotaExceededError');
        return set.call(this, key, value);
      };
    });
    page.once('dialog', dialog => dialog.accept());
    await page.locator('#cloudOpenBtn').click();
    await page.waitForFunction(() => /未替换|无法保存/.test(document.querySelector('#cloudStatus').textContent));
    assert.equal(await page.evaluate(() => window.__pathwise.state.info.name), '连接测试同学2');
    assert.equal(await page.evaluate(() => localStorage.getItem('pathwise.state.v1')), persisted);
    assert.match(await page.locator('#cloudStatus').textContent(), /未替换|无法保存/);
  } finally { await context.close(); }
});

test('logout clears report names and switching accounts cannot read the previous account', async () => {
  const { context, page } = await pageFor(3);
  try {
    await signIn(page, 3);
    await upload(page);
    const id = await page.locator('[data-cloud-read]').getAttribute('data-cloud-read');
    await page.locator('#cloudLogoutBtn').click();
    await page.locator('#cloudConnectBtn').waitFor({ state: 'visible' });
    assert.equal(await page.locator('[data-cloud-read]').count(), 0);
    assert.equal((await context.request.get(origin + '/api/auth/session')).status(), 401);
    await signIn(page, 4);
    assert.equal(await page.locator('[data-cloud-read]').count(), 0);
    assert.equal((await context.request.get(origin + '/api/reports/' + id)).status(), 404);
  } finally { await context.close(); }
});

test('an interrupted upload is not called successful or automatically retried', async () => {
  const { context, page } = await pageFor(5);
  try {
    await signIn(page, 5);
    let writes = 0;
    await page.route('**/api/reports', route => {
      if (route.request().method() === 'POST') { writes++; return route.abort('failed'); }
      return route.continue();
    });
    page.once('dialog', dialog => dialog.accept());
    await page.locator('#cloudUploadBtn').click();
    await page.waitForFunction(() => /连接|网络|未确认|失败/.test(document.querySelector('#cloudStatus').textContent));
    assert.equal(writes, 1);
    assert.equal((await (await context.request.get(origin + '/api/reports')).json()).total, 0);
    assert.equal(await page.evaluate(() => window.__pathwise.state.info.name), '连接测试同学5');
  } finally { await context.close(); }
});

async function changeAccountInAnotherTab(context, index) {
  const second = await context.newPage();
  second.setDefaultTimeout(6000);
  await second.goto(origin);
  await second.locator('#cloudConnectBtn').click();
  await second.locator('#cloudLogoutBtn').waitFor({ state: 'visible' });
  await second.locator('#cloudLogoutBtn:enabled').click();
  await second.locator('#cloudConnectBtn').waitFor({ state: 'visible' });
  await signIn(second, index);
  return second;
}

test('a cached preview cannot replace local progress after another tab changes the account cookie', async () => {
  const { context, page } = await pageFor(6);
  try {
    await signIn(page, 6);
    await upload(page);
    await page.locator('[data-cloud-read]').click();
    await page.locator('#cloudDetail').waitFor({ state: 'visible' });
    await changeAccountInAnotherTab(context, 7);
    await page.locator('#cloudOpenBtn').click();
    await page.locator('#cloudLoginForm').waitFor({ state: 'visible' });
    assert.equal(await page.locator('[data-cloud-read]').count(), 0);
    assert.equal(await page.locator('#cloudDetail').isVisible(), false);
    assert.equal(await page.evaluate(() => window.__pathwise.state.info.name), '连接测试同学6');
    assert.equal(await page.locator('#screen-cloud.active').count(), 1);
  } finally { await context.close(); }
});

test('refreshing an old tab never displays the new cookie account under its previous identity', async () => {
  const { context, page } = await pageFor(8);
  try {
    await signIn(page, 8);
    await upload(page);
    const id = await page.locator('[data-cloud-read]').getAttribute('data-cloud-read');
    const saved = await (await context.request.get(origin + '/api/reports/' + id)).json();
    await changeAccountInAnotherTab(context, 9);
    saved.record.id = 'local-private-b';
    saved.record.reportMeta.batchId = 'AP-PRIVATE-B';
    saved.record.state.info.name = '另一个账号的私有学生';
    assert.equal((await context.request.post(origin + '/api/reports', { headers: await csrf(context), data: { record: saved.record } })).status(), 201);
    await page.locator('#cloudRefreshBtn').click();
    await page.locator('#cloudLoginForm').waitFor({ state: 'visible' });
    assert.equal(await page.locator('[data-cloud-read]').count(), 0);
    assert.equal(await page.locator('#cloudAccount').textContent(), '');
    assert.ok(!(await page.locator('#cloudList').textContent()).includes('另一个账号的私有学生'));
  } finally { await context.close(); }
});

test('owner previews a fixed snapshot, anonymous parent reads without cookies, and revocation clears access', async () => {
  const { context, page } = await pageFor(0);
  const parentContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  try {
    await signIn(page, 0);
    await page.locator('[data-cloud-read]').click();
    await page.locator('#sharePreviewBtn').click();
    await page.locator('#sharePreview').waitFor({ state: 'visible' });
    page.once('dialog', dialog => dialog.dismiss());
    await page.locator('#shareCreateBtn').click();
    assert.equal(await page.locator('#shareLink').inputValue(), '');
    page.once('dialog', dialog => dialog.accept());
    await page.locator('#shareCreateBtn').click();
    await page.waitForFunction(() => document.querySelector('#shareLink').value.includes('#share='));
    const link = await page.locator('#shareLink').inputValue();
    const token = new URL(link).hash.slice('#share='.length);
    const id = await page.locator('[data-cloud-read]').getAttribute('data-cloud-read');
    const saved = await (await context.request.get(origin + '/api/reports/' + id)).json();
    const oldName = saved.record.state.info.name;
    assert.equal((await (await context.request.get(origin + '/api/reports/' + id + '/shares')).json()).items.length, 1);
    const storage = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
    assert.ok(!storage.includes(token));
    await parentContext.addCookies(await context.cookies()); // even an existing login Cookie must be omitted by the viewer
    await parentContext.addInitScript(() => {
      for (const key of ['localStorage', 'sessionStorage']) Object.defineProperty(window, key, { get() { throw new Error('Public viewer must not access ' + key); } });
    });
    const parent = await parentContext.newPage();
    const reads = [], errors = [];
    parent.on('request', request => { if (request.url().includes('/api/')) reads.push(request); });
    parent.on('pageerror', error => errors.push(error.message));
    await parent.goto(link);
    assert.equal(reads.length, 0);
    assert.ok(!parent.url().includes(token));
    await parent.locator('#shareLoadBtn').click();
    await parent.locator('#shareContent').waitFor({ state: 'visible' });
    assert.match(await parent.locator('#shareContent').textContent(), new RegExp(oldName));
    assert.equal(reads.length, 1);
    assert.equal(reads[0].url(), origin + '/api/public/share');
    assert.equal((await reads[0].allHeaders()).cookie, undefined);
    assert.equal((await reads[0].allHeaders())['x-bic-share'], token);
    assert.equal(await parent.locator('input,textarea,form,[contenteditable]').count(), 0);
    assert.deepEqual(errors, []);
    if (process.env.BIC_CAPTURE === '1') {
      await parent.screenshot({ path: path.join(root, 'test-results/parent-share-desktop.png'), fullPage: true });
      await parent.setViewportSize({ width: 375, height: 812 });
      assert.ok(await parent.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await parent.screenshot({ path: path.join(root, 'test-results/parent-share-mobile.png'), fullPage: true });
    }
    saved.record.state.info.name = '更新后不应改变旧分享';
    assert.equal((await context.request.put(origin + '/api/reports/' + id, { headers: await csrf(context), data: { record: saved.record, revision: saved.revision } })).status(), 200);
    await parent.locator('#shareLoadBtn').click();
    await parent.locator('#shareContent').waitFor({ state: 'visible' });
    assert.match(await parent.locator('#shareContent').textContent(), new RegExp(oldName));
    assert.ok(!(await parent.locator('#shareContent').textContent()).includes('更新后不应改变旧分享'));
    await page.locator('#cloudBackBtn').click();
    assert.equal(await page.locator('#shareLink').inputValue(), '', 'Leaving clears the one-time visible bearer link');
    await page.locator('#openCloudBtn').click();
    await page.locator('#cloudRefreshBtn').click();
    await page.locator('[data-cloud-read]').click();
    await page.locator('#shareListBtn').click();
    await page.locator('[data-share-revoke]').waitFor();
    page.once('dialog', dialog => dialog.accept());
    await page.locator('[data-share-revoke]').click();
    await page.waitForFunction(() => /已撤销/.test(document.querySelector('#cloudStatus').textContent));
    await parent.locator('#shareLoadBtn').click();
    await parent.waitForFunction(() => /失效|无法读取/.test(document.querySelector('#shareStatus').textContent));
    assert.equal(await parent.locator('#shareContent').isVisible(), false);
    assert.ok(!(await parent.locator('body').textContent()).includes(oldName));
  } finally { await parentContext.close(); await context.close(); }
});

test('a changed source revision cannot create a share from an old preview', async () => {
  const { context, page } = await pageFor(1);
  try {
    await signIn(page, 1);
    await page.locator('[data-cloud-read]').click();
    await page.locator('#sharePreviewBtn').click();
    await page.locator('#sharePreview').waitFor({ state: 'visible' });
    const id = await page.locator('[data-cloud-read]').getAttribute('data-cloud-read');
    const saved = await (await context.request.get(origin + '/api/reports/' + id)).json();
    saved.record.state.info.name = '新修订测试同学';
    assert.equal((await context.request.put(origin + '/api/reports/' + id, { headers: await csrf(context), data: { record: saved.record, revision: saved.revision } })).status(), 200);
    page.once('dialog', dialog => dialog.accept());
    await page.locator('#shareCreateBtn').click();
    await page.waitForFunction(() => /变化|冲突|重新读取/.test(document.querySelector('#cloudStatus').textContent));
    assert.equal(await page.locator('#shareLink').inputValue(), '');
    assert.equal((await (await context.request.get(origin + '/api/reports/' + id + '/shares')).json()).items.length, 0);
  } finally { await context.close(); }
});

async function connectFamily(page, index, existingCookie = false) {
  await page.locator('#familyConnectBtn').click();
  if (!existingCookie) {
    await page.locator('#familyLoginForm').waitFor({ state: 'visible' });
    await page.locator('#familyUsername').fill('browser.' + index);
    await page.locator('#familyPassword').fill(password);
    await page.locator('#familyLoginForm button[type=submit]').click();
  }
  await page.locator('#familyWorkspace').waitFor({ state: 'visible' });
  await page.locator('#familyRefreshBtn:enabled').click();
  await page.locator('[data-family-thread]').first().waitFor();
}

test('account-bound family comments preserve edited uncertain drafts, support owner replies, and close on revocation', async () => {
  const { context, page } = await pageFor(0);
  const parentContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  try {
    await signIn(page, 0);
    await page.locator('[data-cloud-read]').click();
    const reportId = await page.locator('[data-cloud-read]').getAttribute('data-cloud-read');
    const original = await (await context.request.get(origin + '/api/reports/' + reportId)).json();
    await page.locator('#accessRecipient').fill('browser.7');
    await page.locator('#accessPreviewBtn').click();
    await page.locator('#accessPreview').waitFor({ state: 'visible' });
    page.once('dialog', dialog => dialog.accept());
    await page.locator('#accessCreateBtn').click();
    await page.locator('[data-access-revoke]').waitFor();
    const grantId = await page.locator('[data-access-revoke]').getAttribute('data-access-revoke');
    const family = await parentContext.newPage();
    const requests = [], pageErrors = [];
    family.on('request', request => { if (request.url().startsWith(origin + '/api/')) requests.push(request); });
    family.on('pageerror', error => pageErrors.push(error.message));
    await family.addInitScript(() => {
      for (const key of ['localStorage', 'sessionStorage']) Object.defineProperty(window, key, { get() { throw new Error('Family portal cannot access ' + key); } });
    });
    await family.goto(origin + '/family.html');
    assert.equal(requests.length, 0);
    await connectFamily(family, 7);
    await family.locator(`[data-family-thread="${grantId}"]`).click();
    await family.locator('#familyThread').waitFor({ state: 'visible' });
    assert.equal((await parentContext.request.get(origin + '/api/reports/' + reportId)).status(), 404);
    const threadPath = origin + '/api/parent-access/' + grantId;
    const before = await (await parentContext.request.get(threadPath)).json();
    assert.ok(!JSON.stringify(before).includes('answers') && !JSON.stringify(before).includes('history'));
    const posted = [];
    family.on('request', request => { if (request.method() === 'POST' && request.url() === threadPath + '/comments') posted.push(request.postDataJSON()); });
    await family.route('**/api/parent-access/' + grantId + '/comments', async route => {
      const written = await route.fetch();
      assert.equal(written.status(), 201);
      await route.abort('failed'); // the database saved A, but the browser does not receive its receipt
    });
    await family.locator('#familyBody').fill('<b>家长问题 A</b>');
    await family.locator('#familySubmitBtn').click();
    await family.waitForFunction(() => /尚未确认/.test(document.querySelector('#familyStatus').textContent));
    assert.equal(await family.locator('#familyBody').inputValue(), '<b>家长问题 A</b>');
    assert.equal(posted.length, 1);
    await family.unroute('**/api/parent-access/' + grantId + '/comments');
    await family.locator('#familyBody').fill('尚未提交的新问题 B');
    await family.locator('#familyThreadRefreshBtn').click();
    await family.waitForFunction(() => document.querySelectorAll('[data-family-comment]').length === 1);
    assert.equal(await family.locator('#familyBody').inputValue(), '尚未提交的新问题 B', 'Acknowledging A must not discard a newer draft B');
    assert.equal(await family.locator('#familyComments b').count(), 0, 'Comment markup is rendered as text');
    await family.locator('#familySubmitBtn').click();
    await family.waitForFunction(() => document.querySelectorAll('[data-family-comment]').length === 2);
    assert.equal(posted.length, 2);
    assert.notEqual(posted[0].client_request_id, posted[1].client_request_id);
    const ownerFamily = await context.newPage();
    await ownerFamily.goto(origin + '/family.html');
    await connectFamily(ownerFamily, 0, true);
    await ownerFamily.locator(`[data-family-thread="${grantId}"]`).click();
    await ownerFamily.locator('#familyThread').waitFor({ state: 'visible' });
    await ownerFamily.locator('#familyBody').fill('报告管理者回复：先完成测评再讨论。');
    await ownerFamily.locator('#familySubmitBtn').click();
    await ownerFamily.waitForFunction(() => document.querySelectorAll('[data-family-comment]').length === 3);
    await family.locator('#familyThreadRefreshBtn').click();
    await family.waitForFunction(() => document.querySelectorAll('[data-family-comment]').length === 3);
    if (process.env.BIC_CAPTURE === '1') {
      await family.screenshot({ path: path.join(root, 'test-results/family-desktop.png'), fullPage: true });
      await family.setViewportSize({ width: 375, height: 812 });
      assert.ok(await family.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await family.screenshot({ path: path.join(root, 'test-results/family-mobile.png'), fullPage: true });
    }
    page.once('dialog', dialog => dialog.accept());
    await page.locator('[data-access-revoke]').click();
    await page.waitForFunction(() => /已撤销/.test(document.querySelector('#cloudStatus').textContent));
    await family.locator('#familyThreadRefreshBtn').click();
    await family.locator('#familyThread').waitFor({ state: 'hidden' });
    assert.equal((await parentContext.request.get(threadPath)).status(), 404);
    await ownerFamily.locator('#familyThreadRefreshBtn').click();
    await ownerFamily.waitForFunction(() => document.querySelector('#familyBody').disabled === true);
    assert.equal(await ownerFamily.locator('[data-family-comment]').count(), 3, 'The owner retains closed history');
    assert.deepEqual(await (await context.request.get(origin + '/api/reports/' + reportId)).json(), original);
    assert.deepEqual(pageErrors, []);
  } finally { await parentContext.close(); await context.close(); }
});
