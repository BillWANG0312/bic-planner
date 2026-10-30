/* Real isolated same-origin account security; only temporary fictional accounts. */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const { spawn, spawnSync } = require('node:child_process');
const { launchBrowser } = require('../helpers/browser.cjs');
const { useConfirmHooks, useConfirm } = require('../helpers/confirm.cjs');
const root = path.resolve(__dirname, '../..');
const temporaryRoot = path.resolve(process.env.BIC_TEST_TEMP || path.join(os.tmpdir(), 'bic-tests', 'bic-password-browser-tests'));
const python = process.env.BIC_TEST_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
const password = 'teacher-browser-test-only-password';
let directory, server, browser, origin, logs = '';
before(async () => {
  await fs.mkdir(temporaryRoot, { recursive: true }); directory = await fs.mkdtemp(path.join(temporaryRoot, 'run-'));
  const reservation = net.createServer(); await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve)); origin = `http://127.0.0.1:${port}`;
  const env = { ...process.env, BIC_DEV: '1', BIC_PORT: String(port), BIC_PUBLIC_ORIGIN: origin,
    BIC_DATABASE_PATH: path.join(directory, 'private.sqlite3'), TEMP: directory, TMP: directory, TMPDIR: directory };
  const bootstrap = `from pathlib import Path;import os;from backend.bic_api.db import Database;from backend.bic_api.security import AuthService;a=AuthService(Database(Path(os.environ['BIC_DATABASE_PATH'])));[a.create_user(name,'${password}',role=role) for name,role in [('password.owner','student'),('password.uncertain','advisor'),('password.switch','student'),('password.other','advisor')]]`;
  const seeded = spawnSync(python, ['-c', bootstrap], { cwd: root, env, encoding: 'utf8' });
  assert.equal(seeded.status, 0, 'Install backend development requirements and set BIC_TEST_PYTHON: ' + (seeded.stderr || seeded.error || ''));
  server = spawn(python, ['-m', 'backend.bic_api.dev'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  server.stdout.on('data', value => { logs += value; }); server.stderr.on('data', value => { logs += value; });
  let ready = false;
  for (let i = 0; i < 100 && server.exitCode === null; i++) {
    try { if ((await fetch(origin + '/api/health')).ok) { ready = true; break; } } catch (_) { /* local startup */ }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.ok(ready, 'Account security test server must start: ' + logs); browser = await launchBrowser();
});
after(async () => {
  if (browser) await browser.close();
  if (server && server.exitCode === null) { const exited = new Promise(resolve => server.once('exit', resolve)); server.kill(); await exited; }
  if (directory) { assert.equal(path.dirname(path.resolve(directory)), temporaryRoot); await fs.rm(directory, { recursive: true, force: true }); }
});

async function authenticate(context, username, credential = password) {
  const response = await context.request.post(origin + '/api/auth/login', { headers: { Origin: origin }, data: { username, password: credential } });
  assert.equal(response.status(), 200); return response.json();
}
async function setup(username) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } }); await useConfirmHooks(context);
  const page = await context.newPage(); page.setDefaultTimeout(7000);
  const requests = []; page.on('request', request => { if (request.url().includes('/api/')) requests.push(request); });
  await page.goto(origin + '/account.html'); assert.equal(requests.length, 0);
  await page.locator('#accountConnectBtn').click(); await page.locator('#accountUsername').fill(username); await page.locator('#accountPassword').fill(password);
  await page.locator('#accountLoginForm button[type=submit]').click(); await page.locator('#accountWorkspace').waitFor({ state: 'visible' });
  return { page, context, requests };
}
async function fill(page, next) {
  await page.locator('#accountCurrentPassword').fill(password); await page.locator('#accountNewPassword').fill(next); await page.locator('#accountConfirmPassword').fill(next);
}
async function emptyInputs(page) {
  assert.deepEqual(await page.locator('#accountPasswordForm input[type=password]').evaluateAll(inputs => inputs.map(input => input.value)), ['', '', '']);
}
test('confirmed change revokes every own session, preserves reports and other users, and accepts 128 Unicode characters on existing login', async () => {
  const f = await setup('password.owner'), second = await browser.newContext(), other = await browser.newContext(), next = '🔐'.repeat(128);
  try {
    const secondSession = await authenticate(second, 'password.owner'), otherSession = await authenticate(other, 'password.other');
    const record = { id: 'password-synthetic', createdAt: '2026-10-25T00:00:00.000Z', updatedAt: '2026-10-25T00:00:00.000Z', bankVersion: '2026.10', catalogVersion: '2026.10.24', state: { info: { name: '改密验证虚构学员', grade: '8', year: '2027 年秋季' }, academic: { answers: { ph3: 0 } }, plan: { answers: { grade: '8' } }, mbti: { answers: Array(24).fill(null) } }, reportMeta: { batchId: 'PASSWORD-SYNTHETIC', date: '2026年10月25日' } };
    const savedResponse = await second.request.post(origin + '/api/reports', { headers: { Origin: origin, 'X-CSRF-Token': secondSession.csrf_token }, data: { record } });
    assert.equal(savedResponse.status(), 201); const saved = await savedResponse.json();

    // 另一个标签页保持同一账号的登录；改密后它的下一次请求应被撤销的会话拒绝。
    const oldPage = await second.newPage(); await oldPage.goto(origin + '/index.html'); await oldPage.locator('#cloudBtn').click();
    await oldPage.locator('#cloudUsername').fill('password.owner'); await oldPage.locator('#cloudPassword').fill(password);
    await oldPage.locator('#cloudLoginForm button[type=submit]').click();
    await oldPage.locator('#cloudWorkspace').waitFor({ state: 'visible' });
    await oldPage.locator('#cloudRefreshBtn').click(); await oldPage.getByText('改密验证虚构学员', { exact: true }).waitFor();
    if (process.env.BIC_CAPTURE === '1') {
      await f.page.screenshot({ path: path.join(root, 'test-results/password-desktop.png'), fullPage: true });
      await f.page.setViewportSize({ width: 375, height: 812 }); assert.ok(await f.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await f.page.screenshot({ path: path.join(root, 'test-results/password-mobile.png'), fullPage: true });
    }
    await fill(f.page, next);
    const askedBefore = (await useConfirm(f.page).asked()).length;
    await useConfirm(f.page).confirmAt(false); await f.page.locator('#accountChangeBtn').click();
    await f.page.waitForFunction(count => window.__BIC_CONFIRM.asked.length === count, askedBefore + 1); await emptyInputs(f.page);
    await f.page.waitForFunction(() => /已取消修改/.test(document.querySelector('#accountStatus').textContent));
    assert.equal(f.requests.filter(request => request.url().endsWith('/auth/password')).length, 0);
    assert.equal((await second.request.get(origin + '/api/auth/session')).status(), 200);
    // 同一上下文里驱动另一个标签页会让本页暂离前台；前台后输入状态不变，密码仍由改密成功后清除。
    await f.page.bringToFront();
    assert.deepEqual(await f.page.locator('#accountPasswordForm input[type=password]').evaluateAll(inputs => inputs.map(input => input.value)), ['', '', '']);
    await fill(f.page, next);
    await useConfirm(f.page).confirmAt(true); await f.page.locator('#accountChangeBtn').click(); await f.page.locator('#accountWorkspace').waitFor({ state: 'hidden' }); await emptyInputs(f.page);
    assert.match(await f.page.locator('#accountStatus').textContent(), /已.*修改|修改.*成功|改密.*成功/);
    assert.equal((await second.request.get(origin + '/api/auth/session')).status(), 401);
    assert.deepEqual((await (await other.request.get(origin + '/api/auth/session')).json()).user, otherSession.user);
    // 改密撤销该账号的全部会话：另一个标签页下一次请求即被拒绝，报告不再显示。
    await oldPage.locator('#cloudRefreshBtn').click(); await oldPage.locator('#cloudWorkspace').waitFor({ state: 'hidden' }); assert.equal(await oldPage.getByText('改密验证虚构学员', { exact: true }).count(), 0);
    // 旧密码只试一次：同一用户名每分钟的登录/改密额度已被前面的步骤用得只剩这一次。
    await oldPage.locator('#cloudLoginForm:not([hidden])').waitFor();
    await oldPage.locator('#cloudUsername').fill('password.owner'); await oldPage.locator('#cloudPassword').fill(password);
    await oldPage.locator('#cloudLoginForm button:not([disabled])').click();
    await oldPage.waitForFunction(() => /不正确|错误|无效/.test(document.querySelector('#cloudStatus').textContent));
    assert.deepEqual(await f.page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length })), { local: 0, session: 0 });
    const changes = f.requests.filter(request => request.url().endsWith('/auth/password')); assert.equal(changes.length, 1); assert.deepEqual(changes[0].postDataJSON(), { current_password: password, new_password: next });
  } finally { await f.context.close(); await second.close(); await other.close(); }
});

test('a committed change with a lost response never retries or claims success and permits explicit new-password login', async () => {
  const f = await setup('password.uncertain'), second = await browser.newContext(), next = 'new-uncertain-synthetic-password';
  try {
    await authenticate(second, 'password.uncertain'); let changes = 0;
    await f.page.route('**/api/auth/password', async route => { changes++; const response = await route.fetch(); assert.equal(response.status(), 204); await route.abort('failed'); });
    await fill(f.page, next); await useConfirm(f.page).confirmAt(true); await f.page.locator('#accountChangeBtn').click(); await f.page.locator('#accountWorkspace').waitFor({ state: 'hidden' }); await emptyInputs(f.page);
    const message = await f.page.locator('#accountStatus').textContent(); assert.match(message, /未确认|尚未确认|无法确认|未知/); assert.doesNotMatch(message, /修改成功|已成功|已完成改密/); assert.equal(changes, 1);
    assert.equal((await second.request.get(origin + '/api/auth/session')).status(), 401); await f.page.unroute('**/api/auth/password');
    await f.page.locator('#accountConnectBtn').click(); await f.page.locator('#accountUsername').fill('password.uncertain'); await f.page.locator('#accountPassword').fill(next); await f.page.locator('#accountLoginForm button[type=submit]').click();
    await f.page.locator('#accountWorkspace').waitFor({ state: 'visible' }); assert.equal(changes, 1);
  } finally { await f.context.close(); await second.close(); }
});

test('another tab replacing the cookie during confirmation cannot change either account', async () => {
  const f = await setup('password.switch');
  try {
    const next = 'new-switched-synthetic-password'; await fill(f.page, next);
    const askedBefore = (await useConfirm(f.page).asked()).length;
    await useConfirm(f.page).confirmAt(true);
    await f.page.locator('#accountChangeBtn').click();
    // Another tab's login replaces this page's cookie while the question is open. The question was shown before
    // the login, so the page serves the calls that follow it while it waits on the answer.
    await f.page.waitForFunction(count => window.__BIC_CONFIRM.asked.length > count, askedBefore);
    const switched = await f.context.request.post(origin + '/api/auth/login', { headers: { Origin: origin }, data: { username: 'password.other', password } });
    assert.equal(switched.status(), 200);
    // Answered, the page sends its one change, under the original account's token, and the service refuses it: the
    // request is not the one that page session was accepted for. The page then drops the session it can no longer
    // vouch for, so the tab that logged in as the other account is never shown here.
    await f.page.waitForFunction(() => /本次改密未获服务确认/.test(document.querySelector('#accountStatus').textContent));
    await f.page.locator('#accountWorkspace').waitFor({ state: 'hidden' }); await emptyInputs(f.page);
    assert.equal(await f.page.locator('#accountIdentity').textContent(), '');
    for (const username of ['password.switch', 'password.other']) { const check = await browser.newContext(); try { await authenticate(check, username); } finally { await check.close(); } }
    const changes = f.requests.filter(request => request.url().endsWith('/auth/password')); assert.equal(changes.length, 1); assert.notEqual((await changes[0].response())?.status(), 204);
  } finally { await f.context.close(); }
});
