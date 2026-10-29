/* Real isolated same-origin teacher access; only temporary fictional accounts. */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn, spawnSync } = require('node:child_process');
const { launchBrowser } = require('../helpers/browser.cjs');
const { useConfirmHooks, useConfirm } = require('../helpers/confirm.cjs');
const { loadReportScripts, legacyState } = require('../helpers/report.cjs');
const root = path.resolve(__dirname, '../..');
const temporaryRoot = path.resolve(process.env.BIC_TEST_TEMP || path.join(os.tmpdir(), 'bic-tests', 'bic-teacher-summary-browser-tests'));
const python = process.env.BIC_TEST_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
const password = 'teacher-browser-test-only-password';
let directory, server, browser, origin, logs = '';
before(async () => {
  await fs.mkdir(temporaryRoot, { recursive: true }); directory = await fs.mkdtemp(path.join(temporaryRoot, 'run-'));
  const reservation = net.createServer(); await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve)); origin = `http://127.0.0.1:${port}`;
  const env = { ...process.env, BIC_DEV: '1', BIC_PORT: String(port), BIC_PUBLIC_ORIGIN: origin,
    BIC_DATABASE_PATH: path.join(directory, 'private.sqlite3'), TEMP: directory, TMP: directory, TMPDIR: directory };
  const bootstrap = `from pathlib import Path;import os;from backend.bic_api.db import Database;from backend.bic_api.security import AuthService;a=AuthService(Database(Path(os.environ['BIC_DATABASE_PATH'])));[a.create_user(name,'${password}',role=role) for name,role in [('summary.owner','student'),('summary.advisor','advisor'),('summary.other','advisor')]]`;
  const seeded = spawnSync(python, ['-c', bootstrap], { cwd: root, env, encoding: 'utf8' });
  assert.equal(seeded.status, 0, 'Install backend development requirements and set BIC_TEST_PYTHON: ' + (seeded.stderr || seeded.error || ''));
  server = spawn(python, ['-m', 'backend.bic_api.dev'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  server.stdout.on('data', value => { logs += value; }); server.stderr.on('data', value => { logs += value; });
  let ready = false;
  for (let i = 0; i < 100 && server.exitCode === null; i++) {
    try { if ((await fetch(origin + '/api/health')).ok) { ready = true; break; } } catch (_) { /* local startup */ }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.ok(ready, 'Summary test server must start: ' + logs); browser = await launchBrowser();
});
after(async () => {
  if (browser) await browser.close();
  if (server && server.exitCode === null) { const exited = new Promise(resolve => server.once('exit', resolve)); server.kill(); await exited; }
  if (directory) { assert.equal(path.dirname(path.resolve(directory)), temporaryRoot); await fs.rm(directory, { recursive: true, force: true }); }
});
async function csrf(context) { return { Origin: origin, 'X-CSRF-Token': (await (await context.request.get(origin + '/api/auth/session')).json()).csrf_token }; }
async function setup(label) {
  const owner = await browser.newContext();
  assert.equal((await owner.request.post(origin + '/api/auth/login', { headers: { Origin: origin }, data: { username: 'summary.owner', password } })).status(), 200);
  const headers = await csrf(owner), w = loadReportScripts();
  const vm = require('node:vm'), source = await fs.readFile(path.join(root, 'js/report-store.js'), 'utf8'); vm.runInNewContext(source, { window: w, Date });
  const reports = [], grants = [];
  for (let i = 0; i < 2; i++) {
    const value = legacyState(w); value.info.name = i ? '第二位摘要学员' : '=SUM(1,1)';
    value.academic.answers = { en1: 0, ma5: 0, ma1: null }; value.plan.answers.weakSubjects = []; value.mbti.answers = [0, null, 2];
    value.report = w.generateReport({ ...value, assessmentProfile: w.AssessmentProfiles.CURRENT }); value.report.meta.batchId = `SUMMARY-${label}-${i}`;
    w.reportEditing.applyEdit(value.report, 'summary', '不应返回摘要的私密顾问建议', '原顾问');
    let raw = null; const record = w.ReportStore.create({ getItem: () => raw, setItem: (_, text) => { raw = text; } }).save(value).record;
    const response = await owner.request.post(origin + '/api/reports', { headers, data: { record } }); assert.equal(response.status(), 201); const report = await response.json(); reports.push(report);
    const permission = await owner.request.post(origin + '/api/reports/' + report.id + '/teacher-access', { headers,
      data: { revision: 1, recipient_username: 'summary.advisor', ttl_hours: 24, scope: 'full_report_read_only' } });
    assert.equal(permission.status(), 201); grants.push(await permission.json());
  }
  // Lets the page publish the exact reviewed batch for the CSV comparison, and answer confirmations without
  // a native dialog; both are off outside the tests. The hooks must exist before the page does, or its
  // own navigations bypass them.
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  await useConfirmHooks(context);
  const page = await context.newPage(); page.setDefaultTimeout(7000);
  const requests = []; page.on('request', request => { if (request.url().includes('/api/')) requests.push(request); });
  await page.goto(origin + '/teacher-summary.html'); assert.equal(requests.length, 0);
  await page.locator('#summaryConnectBtn').click(); await page.locator('#summaryUsername').fill('summary.advisor'); await page.locator('#summaryPassword').fill(password);
  await page.locator('#summaryLoginForm button[type=submit]').click(); await page.locator('#summaryWorkspace').waitFor({ state: 'visible' });
  await page.locator('#summaryRefreshBtn:enabled').waitFor(); assert.equal(requests.some(request => request.url().endsWith('/api/teacher-access')), false);
  await page.locator('#summaryRefreshBtn').click(); await page.locator(`[data-summary-grant="${grants[0].id}"]:enabled`).waitFor();
  assert.equal(await page.locator('[data-summary-grant]:checked').count(), 0);
  return { owner, headers, reports, grants, context, page, requests };
}
async function select(f, index) { await f.page.locator(`[data-summary-grant="${f.grants[index].id}"]`).check(); }
async function preview(f) {
  // The batch body cannot be read from the page reliably (see helpers/response.cjs), so the page keeps
  // its reviewed preview on window for the test and the assertions run against that same object.
  const pending = f.page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/api/teacher-summaries'));
  await f.page.locator('#summaryPreviewBtn').click(); assert.equal((await pending).status(), 200);
  await f.page.locator('#summaryPreview').waitFor({ state: 'visible' });
  return f.page.evaluate(() => window.__summaryPreview);
}
async function close(f) { await f.context.close(); await f.owner.close(); }

test('selected readonly summaries produce an exact private CSV after fresh checks without reading raw archives', async () => {
  const f = await setup('ONE');
  try {
    await select(f, 0); const one = await preview(f); assert.equal(one.items.length, 1); assert.equal(one.items[0].grant.id, f.grants[0].id);
    assert.deepEqual(one.items[0].report.academic.map(subject => subject.answered), [1, 1, 0, 0]);
    // 规划统一按当前版本 12 道必答题统计：旧版存档只答了年级，专业意向换算成空的心动/观望分格后不算作答。
    assert.deepEqual(one.items[0].report.planning, { answered: 1, total: 12, required_answered: 1, required_total: 12 });
    assert.deepEqual(one.items[0].report.personality, { answered: 2, total: 30 });
    assert.equal(JSON.stringify(one).includes('不应返回摘要的私密顾问建议'), false);
    await select(f, 1); assert.equal(await f.page.locator('#summaryPreview').isHidden(), true); const both = await preview(f);
    const expected = await f.page.evaluate(value => window.TeacherSummary.build(value, 'summary.advisor').csv, both);
    assert.match(expected, /"'=SUM\(1,1\)"/); assert.equal(expected.includes('"answers"'), false);
    const downloads = []; f.page.on('download', event => downloads.push(event));
    await useConfirm(f.page).confirmAt(false); await f.page.locator('#summaryExportBtn').click(); await f.page.locator('#summaryExportBtn:enabled').waitFor(); assert.equal(downloads.length, 0);
    if (process.env.BIC_CAPTURE === '1') {
      await f.page.locator('#summaryPreview').evaluate(element => element.scrollIntoView({ block: 'start' }));
      await f.page.screenshot({ path: path.join(root, 'test-results/summary-desktop.png') });
      await f.page.setViewportSize({ width: 375, height: 812 }); assert.ok(await f.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await f.page.locator('#summaryPreview').evaluate(element => element.scrollIntoView({ block: 'start' }));
      await f.page.screenshot({ path: path.join(root, 'test-results/summary-mobile.png') });
    }
    await useConfirm(f.page).confirmAt(true); const file = f.page.waitForEvent('download'); await f.page.locator('#summaryExportBtn').click(); const download = await file;
    assert.equal(download.suggestedFilename(), 'bic-teacher-completion-v1.csv'); assert.equal(await fs.readFile(await download.path(), 'utf8'), expected);
    assert.equal(downloads.length, 1); assert.equal(await f.page.evaluate(() => localStorage.length + sessionStorage.length), 0);
    assert.equal(f.requests.some(request => /\/api\/teacher-access\/[^/]+$/.test(request.url())), false);
    assert.equal(f.requests.filter(request => request.url().endsWith('/api/teacher-summaries')).length, 5);
    for (const saved of f.reports) assert.deepEqual(await (await f.owner.request.get(origin + '/api/reports/' + saved.id)).json(), saved);
    await f.page.locator('#summaryDisconnectBtn').click(); assert.equal(await f.page.locator('#summaryList').textContent(), ''); assert.equal(await f.page.locator('#summaryTable').textContent(), '');
  } finally { await close(f); }
});

test('revocation during confirmation rejects the entire reviewed batch and never downloads a surviving row', async () => {
  const f = await setup('TWO');
  try {
    await select(f, 0); await select(f, 1); await preview(f); let downloads = 0; f.page.on('download', () => { downloads++; });
    // The export checks every review once more after the answer, so a batch holding a revoked grant is
    // refused whole -- the report that is still valid is not exported on its own.
    assert.equal((await f.owner.request.delete(origin + '/api/reports/' + f.reports[0].id + '/teacher-access/' + f.grants[0].id, { headers: f.headers })).status(), 204);
    await useConfirm(f.page).confirmAt(true); await f.page.locator('#summaryExportBtn').click();
    await f.page.waitForFunction(() => document.querySelector('#summaryStatus').classList.contains('is-error'));
    assert.equal(downloads, 0); assert.equal(await f.page.locator('#summaryTable').textContent(), '');
    assert.deepEqual((await (await f.owner.request.get(origin + '/api/reports/' + f.reports[1].id)).json()), f.reports[1]);
  } finally { await close(f); }
});

test('another tab replacing the advisor cookie clears old identity and CSV instead of exporting it', async () => {
  const f = await setup('THREE');
  try {
    await select(f, 0); await preview(f); let downloads = 0; f.page.on('download', () => { downloads++; });
    assert.equal((await f.context.request.post(origin + '/api/auth/login', { headers: { Origin: origin }, data: { username: 'summary.other', password } })).status(), 200);
    await f.page.locator('#summaryExportBtn').click(); await f.page.locator('#summaryPreview').waitFor({ state: 'hidden' });
    assert.equal(downloads, 0); assert.equal(await f.page.locator('#summaryList').textContent(), ''); assert.equal(await f.page.locator('#summaryTable').textContent(), '');
    assert.equal(await f.page.locator('#summaryWorkspace').isHidden(), true);
  } finally { await close(f); }
});
