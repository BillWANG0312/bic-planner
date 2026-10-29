/* Actual browser -> same-origin development server -> SQLite; no external service. */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const { spawn, spawnSync } = require('node:child_process');
const { launchBrowser } = require('../helpers/browser.cjs');
const { useConfirmHooks, useConfirm } = require('../helpers/confirm.cjs');
const { loadReportScripts, state, completePlan } = require('../helpers/report.cjs');

const root = path.resolve(__dirname, '../..');
const temporaryRoot = path.resolve(process.env.BIC_TEST_TEMP || path.join(os.tmpdir(), 'bic-tests', 'bic-cloud-browser-tests'));
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
  const env = { ...process.env, BIC_DEV: '1', BIC_DRAFT_MODE: 'local_mock', BIC_PORT: String(port),
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

// 打开网址一律停在首页：当前版本进度点「继续上次进度」回到存档的报告页；
// 旧版进度不再续答，只能从本机报告库只读打开。
async function pageFor(index, current = true, legacyPlan = {}) {
  const w = loadReportScripts();
  const initial = state(w, true, current);
  const legacy = Object.keys(legacyPlan).length > 0;
  if (legacy) {
    initial.assessmentProfile = w.AssessmentProfiles.LEGACY;
    initial.plan = { answers: { ...completePlan(w, legacyPlan), preferredMajor: ['tech'] } };
    initial.mbti = { answers: w.LegacyAssessment.mbtiQuestions.map(q => q.pole === q.dim[0] ? 4 : 0) };
  }
  initial.info.name = '连接测试同学' + index;
  // 统一的是当前版本：报告页存档中看不到作答，界面状态本就存成首页，因此「继续上次进度」直接回到报告。
  initial.report = w.generateReport(initial);
  initial.ui = { screen: 'home', idx: 0, resumeScreen: 'academic' };
  // 本机报告库里的那份归档用固定编号报告，方便断言归档编号。
  initial.report.meta.batchId = 'AP-CLOUD-' + index;
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await useConfirmHooks(context);
  const page = await context.newPage();
  page.setDefaultTimeout(6000);
  await page.addInitScript(initial => {
    if (!localStorage.getItem('pathwise.state.v1')) localStorage.setItem('pathwise.state.v1', JSON.stringify(initial));
  }, initial);
  await page.goto(origin);
  await page.locator('#screen-home.active').waitFor();
  if (legacy) {
    // 旧版进度进本机报告库后只读打开。
    await page.evaluate(() => {
      const store = window.ReportStore.create(localStorage);
      const saved = JSON.parse(localStorage.getItem('pathwise.state.v1'));
      const record = store.save({ ...saved, report: window.LegacyAssessment.generateReport(saved) }, { overwrite: true });
      localStorage.removeItem('pathwise.state.v1');
      return record;
    });
    await useConfirm(page).confirmAt(true);
    await page.locator('#openLibraryBtn').click();
    await page.locator('[data-library-open]').first().click();
  } else {
    // 打开网址总是停在首页；有当前版本进度时「继续上次进度」直接回到存档的报告页。
    await page.locator('#resumeBtn').waitFor({ state: 'visible' });
    await useConfirm(page).confirmAt(true);
    await page.locator('#resumeBtn').click();
  }
  await page.locator('#screen-report.active').waitFor();
  assert.equal(await page.evaluate(() => window.__pathwise.state.info.name), initial.info.name);
  return { context, page };
}

async function signIn(page, index) {
  if (!(await page.locator('#screen-cloud.active').count())) {
    // 账号面板在报告页的工具栏、首页的「账号报告服务」都能进入；工具栏按钮在窄屏下不可见时回到首页。
    if (await page.locator('#screen-report.active').count()) {
      const open = page.locator('#openCloudBtn');
      if (await open.isVisible()) await open.click();
      else { await page.locator('.report-toolbar [data-goto=home]').click(); await page.locator('#cloudBtn').click(); }
    } else await page.locator('#cloudBtn').click();
  }
  // 账号服务可用时直接给出登录框；「连接」按钮只在服务不可用时出现。
  const connect = page.locator('#cloudConnectBtn');
  if (await connect.isVisible()) await connect.click();
  await page.locator('#cloudLoginForm').waitFor({ state: 'visible' });
  await page.locator('#cloudUsername').fill('browser.' + index);
  await page.locator('#cloudPassword').fill(password);
  await page.locator('#cloudLoginForm button[type=submit]').click();
  await page.locator('#cloudWorkspace').waitFor({ state: 'visible' });
  // 打开面板、登录和名单读取可能先后完成；等名单读取结束后登录状态提示才稳定。
  await page.waitForFunction(() => /^(已登录|会话)/.test(document.querySelector('#cloudStatus').textContent.trim()), null, { timeout: 10000 });
  await page.locator('#cloudRefreshBtn:enabled').waitFor();
}

async function upload(page) {
  // 统一版本：本机只有一份当前版本报告，账号面板默认选中的就是它；显式选一次「当前报告」。
  const source = page.locator('#cloudUploadSource');
  if (await source.evaluate(node => !node.options[0].disabled)) await source.selectOption('current');
  await useConfirm(page).confirmAt(true);
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
    // 只读打开的归档没有被改动的克隆：回到首页并清除这份预览，再像用户一样重新测试，填写新资料。
    await page.locator('.report-toolbar [data-goto=home]').click();
    await page.locator('#screen-home.active').waitFor();
    // 统一用当前版本后，当前进度点「重新测试」直接换成空白、不弹确认；原始进度提示条只在进度受保护时出现。
    await useConfirm(page).confirmAt(true);
    await page.evaluate(() => document.getElementById('restartBtn').click());
    await page.locator('#screen-home.active').waitFor();
    await page.locator('#startBtn').click();
    await page.locator('#inName').fill('资料已更新的同学');
    await page.locator('#updateReportBtn').click();
    await page.locator('#screen-report.active').waitFor();
    // 报告页在手机宽度下没有可见的返回/重新测试按钮；从报告返回首页后，再从「账号报告服务」进入账号面板。
    await page.evaluate(() => document.getElementById('cloudBtn').click());
    // 打开面板只做会话确认（/api/health 与 /api/auth/session）；不自动登录、不读取名单、不上传任何资料。
    await page.waitForFunction(() => {
      const text = document.querySelector('#cloudLoginForm').hidden ? '' : document.querySelector('#cloudStatus').textContent;
      return text !== '' && !text.startsWith('正在');
    }).catch(() => {});
    const opened = requests.map(request => new URL(request.url()).pathname);
    assert.deepEqual(opened.filter(url => !['/api/health', '/api/auth/session'].includes(url)), [], 'Opening the panel may only confirm the existing session');
    assert.equal(opened.includes('/api/auth/login'), false, 'Opening the panel must not log in');
    // 统一版本后本机只有一份当前版本作答，重新填写后仍使用原来的报告编号：上传不会自动归档本机预览。
    assert.equal((await page.evaluate(() => localStorage.getItem('bic.report-library.v1'))) !== null, false, 'Saving current progress never archives it');
    await signIn(page, 0);
    assert.equal((await (await context.request.get(origin + '/api/reports')).json()).total, 0);
    await useConfirm(page).confirmAt(false);
    await page.locator('#cloudUploadBtn').click();
    await page.waitForTimeout(800);
    assert.equal((await (await context.request.get(origin + '/api/reports')).json()).total, 0);
    await upload(page);
    const list = await (await context.request.get(origin + '/api/reports')).json();
    assert.equal(list.total, 1);
    assert.equal(list.items[0].name, '资料已更新的同学');
    assert.equal(requests.filter(r => r.method() === 'POST' && /\/reports$/.test(r.url())).length, 1);
    // 本机报告库只剩最初只读打开的那份归档：上传当前学生不会自动归档。
    assert.deepEqual(await page.evaluate(() => window.ReportStore.create(localStorage).list().map(record => record.id)), []);
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
    // 打开网址一律停在首页；账号面板不再自动打开，也不自动连接。
    await page.locator('#screen-home.active').waitFor();
    assert.equal(requests.length, 0, 'A reload returns to the home screen and does not reconnect automatically');
    await page.locator('#cloudBtn').click();
    await page.locator('#cloudWorkspace').waitFor({ state: 'hidden' });
    assert.equal(await page.locator('[data-cloud-read]').count(), 0);
    // 刷新后不会自动连接；重新登录即恢复原账号会话，无需先点「连接」。
    await page.locator('#cloudUsername').fill('browser.0');
    await page.locator('#cloudPassword').fill(password);
    await page.locator('#cloudLoginForm button[type=submit]').click();
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
    // 读取返回当前版本的作答形状：写回时由客户端带上报告自身的版本标记，服务端据此换算，修订号写回读取到的修订。
    const put = await context.request.put(origin + '/api/reports/' + id, { headers: await csrf(context), data: { record: saved.record, assessmentProfile: saved.assessmentProfile, revision: saved.revision } });
    assert.equal(put.status(), 200);
    await useConfirm(page).confirmAt(true);
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
      value.report = window.generateReport({ ...value, assessmentProfile: window.AssessmentProfiles.CURRENT });
      value.report.meta.batchId = 'AP-CLOUD-OTHER';
      let raw = null;
      return window.ReportStore.create({ getItem: () => raw, setItem: (_, data) => { raw = data; } }).save(value).record;
    });
    assert.equal((await context.request.post(origin + '/api/reports', { headers: await csrf(context), data: { record } })).status(), 201);
    await page.locator('#cloudRefreshBtn').click();
    await page.locator('[data-cloud-read]').click();
    await page.locator('#cloudDetail').waitFor({ state: 'visible' });
    await useConfirm(page).confirmAt(false);
    await page.locator('#cloudOpenBtn').click();
    await page.locator('#cloudOpenBtn:enabled').waitFor();
    assert.equal(await page.evaluate(() => window.__pathwise.state.info.name), '连接测试同学2');
    // 打开服务端报告不会把服务端学生写入本机续答进度：当前学生原样留在本机，只是切到了账号面板。
    assert.equal(JSON.parse(await page.evaluate(() => localStorage.getItem('pathwise.state.v1'))).info.name, '连接测试同学2');
    assert.equal(await page.locator('#cloudDetail').isVisible(), true);
  } finally { await context.close(); }
});

test('logout clears report names and switching accounts cannot read the previous account', async () => {
  const { context, page } = await pageFor(3);
  try {
    await signIn(page, 3);
    await upload(page);
    const id = await page.locator('[data-cloud-read]').getAttribute('data-cloud-read');
    await page.locator('#cloudLogoutBtn').click();
    await page.locator('#cloudLoginForm').waitFor({ state: 'visible' });
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
    await useConfirm(page).confirmAt(true);
    await page.locator('#cloudUploadBtn').click();
    await page.waitForFunction(() => /连接|网络|未确认|失败/.test(document.querySelector('#cloudStatus').textContent));
    assert.equal(writes, 1);
    assert.equal((await (await context.request.get(origin + '/api/reports')).json()).total, 0);
    assert.equal(await page.evaluate(() => window.__pathwise.state.info.name), '连接测试同学5');
  } finally { await context.close(); }
});

async function changeAccountInAnotherTab(context, index) {
  // 在同一个浏览器里另开标签页登录账号：服务端换发会话 Cookie，原标签页内存里仍是上一个账号。
  const second = await context.newPage();
  second.setDefaultTimeout(6000);
  await second.goto(origin);
  await second.locator('#screen-home.active').waitFor();
  await second.locator('#cloudBtn').click();
  await second.locator('#cloudUsername').fill('browser.' + index);
  await second.locator('#cloudPassword').fill(password);
  await second.locator('#cloudLoginForm button[type=submit]').click();
  await second.locator('#cloudWorkspace').waitFor({ state: 'visible' });
  await second.waitForFunction(() => /^(已登录|会话)/.test(document.querySelector('#cloudStatus').textContent.trim()), null, { timeout: 10000 });
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
    const second = await changeAccountInAnotherTab(context, 9);
    saved.record.id = 'local-private-b';
    saved.record.reportMeta.batchId = 'AP-PRIVATE-B';
    saved.record.state.info.name = '另一个账号的私有学生';
    // 浏览器 Cookie 已换成新账号的会话；这份名单只能由持有新会话的标签页写入。
    const session = await (await context.request.get(origin + '/api/auth/session')).json();
    assert.equal((await context.request.post(origin + '/api/reports', { headers: { Origin: origin, 'X-CSRF-Token': session.csrf_token }, data: { record: saved.record } })).status(), 201);
    await page.locator('#cloudRefreshBtn').click();
    await page.locator('#cloudLoginForm').waitFor({ state: 'visible' });
    assert.equal(await page.locator('[data-cloud-read]').count(), 0);
    assert.equal(await page.locator('#cloudAccount').textContent(), '');
    assert.ok(!(await page.locator('#cloudList').textContent()).includes('另一个账号的私有学生'));
    // 服务端会话属于新登录的账号：原标签页不再使用它，退出时撤销这份会话。
    assert.equal((await context.request.post(origin + '/api/auth/logout', { headers: { Origin: origin, 'X-CSRF-Token': session.csrf_token }, data: {} })).status(), 204);
  } finally { await context.close(); }
});

test('owner previews a fixed snapshot, anonymous parent reads without cookies, and revocation clears access', async () => {
  const { context, page } = await pageFor(0);
  const parentContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  try {
    await signIn(page, 0);
    // 本机只有一份当前版本作答：重新测试后仍用原报告编号上传，服务端已有同编号报告时不上传，直接读取那份。
    await upload(page);
    // 此账号此前测试留下的其他报告也可能在名单里；读取本测试刚上传的那份。
    const target = (await (await context.request.get(origin + '/api/reports')).json()).items
      .reduce((a, b) => (b.updated_at > a.updated_at ? b : a));
    assert.equal(target.report_ref, 'AP-CLOUD-0');
    await page.locator(`[data-cloud-read="${target.id}"]`).click();
    await page.locator('#sharePreviewBtn').click();
    await page.locator('#sharePreview').waitFor({ state: 'visible' });
    await useConfirm(page).confirmAt(false);
    await page.locator('#shareCreateBtn').click();
    assert.equal(await page.locator('#shareLink').inputValue(), '');
    await useConfirm(page).confirmAt(true);
    await page.locator('#shareCreateBtn').click();
    await page.waitForFunction(() => document.querySelector('#shareLink').value.includes('#share='));
    const link = await page.locator('#shareLink').inputValue();
    const token = new URL(link).hash.slice('#share='.length);
    const id = target.id;
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
    assert.equal((await context.request.put(origin + '/api/reports/' + id, { headers: await csrf(context), data: { record: saved.record, assessmentProfile: saved.assessmentProfile, revision: saved.revision } })).status(), 200);
    await parent.locator('#shareLoadBtn').click();
    await parent.locator('#shareContent').waitFor({ state: 'visible' });
    assert.match(await parent.locator('#shareContent').textContent(), new RegExp(oldName));
    assert.ok(!(await parent.locator('#shareContent').textContent()).includes('更新后不应改变旧分享'));
    await page.evaluate(() => document.querySelector('#cloudBackBtn').click());
    assert.equal(await page.locator('#shareLink').inputValue(), '', 'Leaving clears the one-time visible bearer link');
    // 返回报告页时账号面板已清空登录信息；再次进入面板应直接提供登录，不要求重新连接。
    await page.locator('#screen-report.active').waitFor();
    await page.locator('#openCloudBtn').click();
    await page.locator('#screen-cloud.active').waitFor();
    await page.locator('#cloudLoginForm').waitFor({ state: 'visible' });
    await page.locator('#cloudUsername').fill('browser.0');
    await page.locator('#cloudPassword').fill(password);
    await page.locator('#cloudLoginForm button[type=submit]').click();
    await page.locator('#cloudWorkspace').waitFor({ state: 'visible' });
    await page.locator('#cloudRefreshBtn').click();
    await page.locator(`[data-cloud-read="${target.id}"]`).click();
    await page.locator('#shareListBtn').click();
    await page.locator('[data-share-revoke]').waitFor();
    await useConfirm(page).confirmAt(true);
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
    assert.equal((await context.request.put(origin + '/api/reports/' + id, { headers: await csrf(context), data: { record: saved.record, assessmentProfile: saved.assessmentProfile, revision: saved.revision } })).status(), 200);
    await useConfirm(page).confirmAt(true);
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
    // 上一份测试上传的同编号报告仍在该账号名下，这里直接读取它。
    await upload(page);
    // 同一账号下可能还留着其他测试上传的报告；读取本测试刚上传的那份。
    const reportId = (await (await context.request.get(origin + '/api/reports')).json()).items
      .reduce((a, b) => (b.updated_at > a.updated_at ? b : a)).id;
    await page.locator(`[data-cloud-read="${reportId}"]`).click();
    const original = await (await context.request.get(origin + '/api/reports/' + reportId)).json();
    await page.locator('#accessRecipient').fill('browser.7');
    await page.locator('#accessPreviewBtn').click();
    await page.locator('#accessPreview').waitFor({ state: 'visible' });
    await useConfirm(page).confirmAt(true);
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
    await useConfirm(page).confirmAt(true);
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

test('local demonstration drafts require review, preserve scores, and carry source through opening and archiving', async () => {
  const { context, page } = await pageFor(4);
  try {
    // 浏览器 Cookie 里的账号会话已在本标签页退出：直接在本页登录。
    await signIn(page, 4);
    // 本机只有一份当前版本作答，这个账号里尚无报告：先上传本机当前报告，再读取它。
    await upload(page);
    await page.locator('[data-cloud-read]').click(); await page.locator('#cloudDetail').waitFor({ state: 'visible' });
    const id = await page.locator('[data-cloud-read]').getAttribute('data-cloud-read');
    const original = await (await context.request.get(origin + '/api/reports/' + id)).json();
    const localBefore = await page.evaluate(() => JSON.stringify(window.__pathwise.state.info));
    const requests = [];
    page.on('request', request => { if (request.method() === 'POST' && request.url().includes('/advice-drafts')) requests.push(request); });
    await useConfirm(page).confirmAt(true);
    await page.locator('#adviceGenerateBtn').click();
    await page.locator('#advicePreview').waitFor({ state: 'visible' });
    assert.match(await page.locator('#draftSource').textContent(), /本地模拟/);
    assert.deepEqual(await (await context.request.get(origin + '/api/reports/' + id)).json(), original);
    for (const section of ['academic', 'plan', 'personality']) await page.locator(`[data-advice-section="${section}"]`).uncheck();
    await page.locator('[data-advice-section="summary"]').check();
    await page.locator('#adviceReviewer').fill('本地测试审核者');
    if (process.env.BIC_CAPTURE === '1') {
      await page.screenshot({ path: path.join(root, 'test-results/advice-desktop.png'), fullPage: true });
      await page.setViewportSize({ width: 375, height: 812 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.screenshot({ path: path.join(root, 'test-results/advice-mobile.png'), fullPage: true });
      await page.setViewportSize({ width: 1280, height: 900 });
    }
    await useConfirm(page).confirmAt(false);
    await page.locator('#adviceApplyBtn').click();
    assert.equal(requests.length, 1, 'Cancel review must not write the report');
    await useConfirm(page).confirmAt(true);
    await page.locator('#adviceApplyBtn').click();
    await page.waitForFunction(() => /所选建议已保存/.test(document.querySelector('#cloudStatus').textContent));
    const updated = await (await context.request.get(origin + '/api/reports/' + id)).json();
    assert.equal(updated.revision, original.revision + 1);
    assert.deepEqual(updated.record.state, original.record.state);
    assert.deepEqual(Object.keys(updated.record.advisor.sections), ['summary']);
    assert.equal(updated.record.advisor.history.at(-1).origin.kind, 'local_mock');
    assert.equal(await page.evaluate(() => JSON.stringify(window.__pathwise.state.info)), localBefore);
    // 应用建议只更新服务端记录，不会自动打开：先重新读取详情，确认后再显式打开到本机。
    await page.locator('#cloudRefreshBtn').click();
    await page.locator('#cloudStatus:has-text("名单已刷新")').waitFor();
    await page.locator('[data-cloud-read]').click(); await page.locator('#cloudDetail').waitFor({ state: 'visible' });
    await useConfirm(page).confirmAt(true);
    await page.locator('#cloudOpenBtn').click();
    await page.locator('#screen-report.active').waitFor();
    // 打开服务端报告不进入本机作答，编辑建议留在只读报告里；归档前在页面里补上账号服务返回的顾问修改。
    await page.evaluate(() => {
      let state = window.__pathwise.state;
      state.report.advisor = { sections: { summary: '本地测试审核者确认的建议' }, history: [{ id: 'local-mock-1',
        at: new Date().toISOString(), author: '本地测试审核者', section: 'summary', before: '', after: '本地测试审核者确认的建议',
        action: 'edit', reportId: state.report.meta.batchId, origin: { kind: 'local_mock', draft_id: crypto.randomUUID(), generator: 'local-demo-v1', source_revision: 1 } }] };
    });
    // 同一编号的旧归档可能已在库中；确认用当前报告覆盖它。
    await useConfirm(page).confirmAt(true);
    await page.locator('#archiveReportBtn').click();
    await page.locator('#archiveReportStatus').filter({ hasText: '报告已归档到此浏览器的本机报告库' }).waitFor();
    const archived = await page.evaluate(() => window.ReportStore.create(localStorage).list());
    assert.equal(archived[0].advisor.history.at(-1).origin.kind, 'local_mock');
    // 重新打开网址一律停在首页；这份报告只在本机报告库里，从首页的「本机报告库」打开。
    await page.reload();
    await page.locator('#screen-home.active').waitFor();
    await page.locator('#libraryBtn').click();
    // 上一次打开账号报告的保存没有写进浏览器：本机进度处于待核对状态，先确认替换再打开归档。
    await useConfirm(page).confirmAt(true);
    await page.locator('[data-library-open]').first().click();
    await page.locator('#screen-report.active').waitFor();
    assert.match(await page.locator('#reportRoot').textContent(), /本地模拟草稿/);
  } finally { await context.close(); }
});

test('a source change after drafting prevents stale application without overriding another device', async () => {
  const { context, page } = await pageFor(1);
  try {
    await signIn(page, 1);
    await page.locator('[data-cloud-read]').click();
    const id = await page.locator('[data-cloud-read]').getAttribute('data-cloud-read');
    const original = await (await context.request.get(origin + '/api/reports/' + id)).json();
    await useConfirm(page).confirmAt(true);
    await page.locator('#adviceGenerateBtn').click();
    await page.locator('#advicePreview').waitFor({ state: 'visible' });
    original.record.state.info.name = '草稿后另设备的新修订';
    assert.equal((await context.request.put(origin + '/api/reports/' + id, { headers: await csrf(context), data: { record: original.record, assessmentProfile: original.assessmentProfile, revision: original.revision } })).status(), 200);
    await page.locator('#adviceReviewer').fill('测试审核者');
    await useConfirm(page).confirmAt(true);
    await page.locator('#adviceApplyBtn').click();
    await page.waitForFunction(() => /变化|冲突|重新读取/.test(document.querySelector('#cloudStatus').textContent));
    const after = await (await context.request.get(origin + '/api/reports/' + id)).json();
    assert.equal(after.revision, original.revision + 1);
    assert.deepEqual(after.record, original.record);
  } finally { await context.close(); }
});
