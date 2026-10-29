/* Real isolated same-origin teacher access; only temporary fictional accounts. */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn, spawnSync } = require('node:child_process');
const { launchBrowser } = require('../helpers/browser.cjs');
const { loadReportScripts, legacyState } = require('../helpers/report.cjs');
const { actionResponse, readNewest } = require('../helpers/response.cjs');
const { useConfirmHooks, useConfirm } = require('../helpers/confirm.cjs');
const root = path.resolve(__dirname, '../..');
const temporaryRoot = path.resolve(process.env.BIC_TEST_TEMP || path.join(os.tmpdir(), 'bic-tests', 'bic-teacher-browser-tests'));
const python = process.env.BIC_TEST_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
const password = 'teacher-browser-test-only-password';
let directory, server, browser, origin, logs = '';
before(async () => {
  await fs.mkdir(temporaryRoot, { recursive: true }); directory = await fs.mkdtemp(path.join(temporaryRoot, 'run-'));
  const reservation = net.createServer(); await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve)); origin = `http://127.0.0.1:${port}`;
  const env = { ...process.env, BIC_DEV: '1', BIC_PORT: String(port), BIC_PUBLIC_ORIGIN: origin,
    BIC_DATABASE_PATH: path.join(directory, 'private.sqlite3'), TEMP: directory, TMP: directory, TMPDIR: directory };
  const bootstrap = `from pathlib import Path;import os;from backend.bic_api.db import Database;from backend.bic_api.security import AuthService;a=AuthService(Database(Path(os.environ['BIC_DATABASE_PATH'])));[a.create_user(name,'${password}',role=role) for name,role in [('teacher.owner','student'),('teacher.recipient','advisor'),('teacher.other','advisor')]]`;
  const seeded = spawnSync(python, ['-c', bootstrap], { cwd: root, env, encoding: 'utf8' });
  assert.equal(seeded.status, 0, 'Install backend development requirements and set BIC_TEST_PYTHON: ' + (seeded.stderr || seeded.error || ''));
  server = spawn(python, ['-m', 'backend.bic_api.dev'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  server.stdout.on('data', value => { logs += value; }); server.stderr.on('data', value => { logs += value; });
  let ready = false;
  for (let i = 0; i < 100 && server.exitCode === null; i++) {
    try { if ((await fetch(origin + '/api/health')).ok) { ready = true; break; } } catch (_) { /* local startup */ }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.ok(ready, 'Teacher test server must start: ' + logs); browser = await launchBrowser();
});
after(async () => {
  if (browser) await browser.close();
  if (server && server.exitCode === null) { const exited = new Promise(resolve => server.once('exit', resolve)); server.kill(); await exited; }
  if (directory) { assert.equal(path.dirname(path.resolve(directory)), temporaryRoot); await fs.rm(directory, { recursive: true, force: true }); }
});
async function csrf(context) { return { Origin: origin, 'X-CSRF-Token': (await (await context.request.get(origin + '/api/auth/session')).json()).csrf_token }; }
async function ownerPage(label) {
  const w = loadReportScripts(), value = legacyState(w, true); value.info.name = '授权测试同学' + label;
  // 账号接口只接收冻结的旧版归档；写入本机进度后由应用打开报告，存档与页面展示是同一份旧版记录。
  value.report = w.generateReport({ ...value, assessmentProfile: w.AssessmentProfiles.CURRENT }); value.report.meta.batchId = 'TEACHER-CASE-' + label;
  w.reportEditing.applyEdit(value.report, 'summary', '<img src=x onerror=alert(1)>只读建议', '原顾问');
  value.ui = { screen: 'report', idx: 0, resumeScreen: 'academic' };
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } }); await useConfirmHooks(context);
  const page = await context.newPage(); page.setDefaultTimeout(7000); const confirm = useConfirm(page);
  // 每次打开页面都写入同一份旧版进度：旧版进度不再续答，只能「重新测试」，随后打开只读的旧版报告。
  const savedValue = JSON.parse(JSON.stringify(value));
  await page.addInitScript(value => { try { localStorage.clear(); localStorage.setItem('pathwise.state.v1', JSON.stringify(value)); } catch (_) {} }, savedValue);
  await page.goto(origin);
  await confirm.confirmAt(true);
  await page.evaluate(() => document.getElementById('profileRestartBtn').click());
  await page.locator('#profileNotice').waitFor({ state: 'hidden' });
  await page.evaluate(value => window.__pathwise.openState(value), savedValue);
  await page.locator('#screen-report.active').waitFor();
  await page.locator('#openCloudBtn').click();
  // 账号服务可用时登录框直接提交即可（提交时自动连接），「连接」按钮只在服务不可用时出现。
  await page.locator('#cloudUsername').fill('teacher.owner'); await page.locator('#cloudPassword').fill(password);
  await page.locator('#cloudLoginForm button[type=submit]').click(); await page.locator('#cloudWorkspace').waitFor({ state: 'visible' });
  await page.locator('#cloudRefreshBtn:enabled').waitFor();
  await confirm.confirmAt(true);
  const uploaded = await actionResponse(page, response => response.request().method() === 'POST' && response.url() === origin + '/api/reports',
    () => page.locator('#cloudUploadBtn').click(),
    () => readNewest(context, origin + '/api/reports', origin + '/api/reports/'));
  assert.equal(uploaded.status, 201); const saved = uploaded.value;
  await page.locator(`[data-cloud-read="${saved.id}"]:enabled`).waitFor(); await page.locator(`[data-cloud-read="${saved.id}"]`).click();
  await page.locator('#teacherRecipient:enabled').waitFor();
  return { context, page, saved };
}
async function previewGrant(page) { await page.locator('#teacherRecipient').fill('teacher.recipient'); await page.locator('#teacherPreviewBtn').click(); await page.locator('#teacherOwnerPreview').waitFor({ state: 'visible' }); }
async function createGrant(owner, revision) {
  await useConfirm(owner.page).confirmAt(true);
  // The creation response is the grant itself. Headless Chromium does not always hand its body back to
  // Node, so the page keeps the grant it read from that response for the test to collect.
  const created = owner.page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/teacher-access'));
  await owner.page.locator('#teacherCreateBtn').click();
  assert.equal((await created).status(), 201);
  await owner.page.locator('#teacherRecipient:enabled').waitFor();
  await owner.page.waitForFunction(() => window.__teacherCreated !== null);
  const grant = await owner.page.evaluate(() => window.__teacherCreated);
  assert.equal(grant.report_revision, revision); return grant;
}
async function teacherPage() {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } }), page = await context.newPage(); page.setDefaultTimeout(7000);
  const requests = []; page.on('request', request => { if (request.url().includes('/api/')) requests.push(request.url()); });
  await page.goto(origin + '/teacher.html'); assert.deepEqual(requests, []);
  await page.locator('#teacherConnectBtn').click(); await page.locator('#teacherUsername').fill('teacher.recipient'); await page.locator('#teacherPassword').fill(password);
  await page.locator('#teacherLoginForm button[type=submit]').click(); await page.locator('#teacherWorkspace').waitFor({ state: 'visible' });
  await page.locator('#teacherRefreshBtn:enabled').waitFor(); assert.equal(requests.some(url => url.endsWith('/api/teacher-access')), false);
  return { context, page };
}
async function readGrant(page, id) { await page.locator('#teacherRefreshBtn').click(); await page.locator(`[data-teacher-read="${id}"]:enabled`).waitFor(); await page.locator(`[data-teacher-read="${id}"]`).click(); await page.locator('#teacherDetail').waitFor({ state: 'visible' }); }

test('owner consent grants one revision, teacher reads privately without edits, and revocation clears the viewer', async () => {
  const owner = await ownerPage('ONE'), teacher = await teacherPage();
  try {
    const posts = []; owner.page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/teacher-access')) posts.push(request); });
    await previewGrant(owner.page); assert.match(await owner.page.locator('#teacherOwnerPreview').textContent(), /逐题|答卷/);
    // The confirmation is what sends the request: declining it must request no grant.
    const askedBefore = (await useConfirm(owner.page).asked()).length;
    await useConfirm(owner.page).confirmAt(false); await owner.page.locator('#teacherCreateBtn').click(); assert.equal(posts.length, 0);
    assert.equal((await useConfirm(owner.page).asked()).length, askedBefore + 1);
    const grant = await createGrant(owner, 1); assert.equal(posts.length, 1); assert.equal(grant.report_revision, 1);
    await readGrant(teacher.page, grant.id);
    assert.match(await teacher.page.locator('#teacherReport').textContent(), /授权测试同学ONE/);
    assert.match(await teacher.page.locator('#teacherHistory').textContent(), /原顾问|只读建议/);
    assert.equal(await teacher.page.locator('#teacherReport img[src=x]').count(), 0);
    assert.equal(await teacher.page.locator('#advisorEditor, #cloudUploadBtn, #archiveReportBtn').count(), 0);
    assert.equal(await teacher.page.evaluate(() => localStorage.length + sessionStorage.length), 0);
    const denied = await teacher.context.request.put(origin + '/api/reports/' + owner.saved.id, { headers: await csrf(teacher.context), data: { revision: 1, record: owner.saved.record } });
    assert.equal(denied.status(), 404);
    assert.deepEqual(await (await owner.context.request.get(origin + '/api/reports/' + owner.saved.id)).json(), owner.saved);
    if (process.env.BIC_CAPTURE === '1') {
      await teacher.page.locator('#teacherHistoryPanel').evaluate(element => { element.open = true; });
      await teacher.page.locator('#teacherHeading').evaluate(element => element.scrollIntoView({ block: 'start' }));
      await teacher.page.screenshot({ path: path.join(root, 'test-results/teacher-desktop.png') });
      await teacher.page.setViewportSize({ width: 375, height: 812 }); assert.ok(await teacher.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await teacher.page.locator('#teacherHeading').evaluate(element => element.scrollIntoView({ block: 'start' }));
      await teacher.page.screenshot({ path: path.join(root, 'test-results/teacher-mobile.png') });
    }
    await useConfirm(owner.page).confirmAt(true); await owner.page.locator(`[data-teacher-revoke="${grant.id}"]`).click();
    await owner.page.waitForFunction(() => /已撤销/.test(document.querySelector('#cloudStatus').textContent));
    await teacher.page.locator('#teacherRefreshBtn').click(); await teacher.page.locator('#teacherDetail').waitFor({ state: 'hidden' });
    assert.equal(await teacher.page.locator('#teacherReport').textContent(), ''); assert.equal(await teacher.page.locator('#teacherHistory').textContent(), '');
    assert.equal((await teacher.context.request.get(origin + '/api/teacher-access/' + grant.id, { headers: await csrf(teacher.context) })).status(), 404);
  } finally { await teacher.context.close(); await owner.context.close(); }
});

test('an owner source update closes the old readonly revision until a new grant is explicitly created', async () => {
  const owner = await ownerPage('TWO'), teacher = await teacherPage();
  try {
    await previewGrant(owner.page); const grant = await createGrant(owner, 1); await readGrant(teacher.page, grant.id);
    const changed = structuredClone(owner.saved.record); changed.state.info.name = '新修订需重新授权';
    assert.equal((await owner.context.request.put(origin + '/api/reports/' + owner.saved.id, { headers: await csrf(owner.context), data: { revision: 1, record: changed } })).status(), 200);
    await teacher.page.locator('#teacherReadRefreshBtn').click(); await teacher.page.locator('#teacherDetail').waitFor({ state: 'hidden' });
    assert.equal(await teacher.page.locator('#teacherReport').textContent(), '');
    await owner.page.locator('#teacherListBtn').click(); await owner.page.waitForFunction(() => /修订已更新|重新授权/.test(document.querySelector('#teacherOwnerList').textContent));
    await owner.page.locator(`[data-cloud-read="${owner.saved.id}"]`).click(); await owner.page.locator('#teacherRecipient:enabled').waitFor();
    await previewGrant(owner.page); const renewed = await createGrant(owner, 2);
    await readGrant(teacher.page, renewed.id); assert.match(await teacher.page.locator('#teacherReport').textContent(), /新修订需重新授权/);
  } finally { await teacher.context.close(); await owner.context.close(); }
});

test('another tab changing the shared cookie cannot expose a different advisor under the earlier identity', async () => {
  const owner = await ownerPage('THREE'), teacher = await teacherPage();
  try {
    await previewGrant(owner.page); const grant = await createGrant(owner, 1); await readGrant(teacher.page, grant.id);
    const next = await teacher.context.request.post(origin + '/api/auth/login', { headers: { Origin: origin }, data: { username: 'teacher.other', password } }); assert.equal(next.status(), 200);
    await teacher.page.locator('#teacherReadRefreshBtn').click();
    await teacher.page.waitForFunction(() => /会话|变化|登录/.test(document.querySelector('#teacherStatus').textContent));
    assert.equal(await teacher.page.locator('#teacherReport').textContent(), ''); assert.equal(await teacher.page.locator('#teacherHistory').textContent(), '');
    assert.equal(await teacher.page.locator('#teacherList').textContent(), '');
    assert.equal((await teacher.context.request.get(origin + '/api/teacher-access/' + grant.id, { headers: await csrf(teacher.context) })).status(), 404);
    assert.deepEqual(await (await owner.context.request.get(origin + '/api/reports/' + owner.saved.id)).json(), owner.saved);
  } finally { await teacher.context.close(); await owner.context.close(); }
});
