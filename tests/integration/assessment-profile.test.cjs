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
const temporaryRoot = path.resolve(process.env.BIC_TEST_TEMP || path.join(os.tmpdir(), 'bic-tests', 'bic-assessment-profile-browser-tests'));
const python = process.env.BIC_TEST_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
const password = 'teacher-browser-test-only-password';
let directory, server, browser, origin, logs = '';
before(async () => {
  await fs.mkdir(temporaryRoot, { recursive: true }); directory = await fs.mkdtemp(path.join(temporaryRoot, 'run-'));
  const reservation = net.createServer(); await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve)); origin = `http://127.0.0.1:${port}`;
  const env = { ...process.env, BIC_DEV: '1', BIC_PORT: String(port), BIC_PUBLIC_ORIGIN: origin,
    BIC_DATABASE_PATH: path.join(directory, 'private.sqlite3'), TEMP: directory, TMP: directory, TMPDIR: directory };
  const bootstrap = `from pathlib import Path;import os;from backend.bic_api.db import Database;from backend.bic_api.security import AuthService;a=AuthService(Database(Path(os.environ['BIC_DATABASE_PATH'])));[a.create_user(name,'${password}',role=role) for name,role in [('profile.current','student'),('profile.legacy','student')]]`;
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

async function open(initial) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true }), page = await context.newPage(); page.setDefaultTimeout(7000);
  await useConfirmHooks(context);
  if (initial !== undefined) await page.addInitScript(raw => { if (localStorage.getItem('pathwise.state.v1') === null) localStorage.setItem('pathwise.state.v1', raw); }, initial);
  const requests = []; page.on('request', request => { if (request.url().includes('/api/')) requests.push(request); });
  await page.goto(origin + '/index.html'); return { context, page, requests };
}
async function signIn(f, username) {
  await f.page.locator('#openCloudBtn').click(); await f.page.locator('#cloudConnectBtn').click();
  await f.page.locator('#cloudUsername').fill(username); await f.page.locator('#cloudPassword').fill(password); await f.page.locator('#cloudLoginForm button[type=submit]').click();
  await f.page.locator('#cloudWorkspace').waitFor({ state: 'visible' }); await f.page.locator('#cloudRefreshBtn:enabled').waitFor();
}
test('modern profiles save as local v2 JSON and cannot be uploaded through the legacy API', async () => {
  const f = await open();
  try {
    await f.page.locator('#startBtn').click(); await f.page.locator('#inName').fill('新版本地验证学员'); await f.page.locator('#updateReportBtn').click(); await f.page.locator('#screen-report.active').waitFor();
    assert.equal(await f.page.evaluate(() => __pathwise.state.report.meta.assessmentProfile), 'games-traits-v1');
    await f.page.locator('#archiveReportBtn').click();
    const backup = await f.page.evaluate(() => JSON.parse(ReportStore.create(localStorage).exportBackup()));
    assert.equal(backup.version, 2); assert.equal(backup.records[0].assessmentProfile, 'games-traits-v1');
    const original = await f.page.evaluate(() => localStorage.getItem('bic.report-library.v1'));
    await signIn(f, 'profile.current'); assert.equal(await f.page.locator('#cloudUploadBtn').isDisabled(), true);
    assert.match(await f.page.locator('#cloudSourceNote').textContent(), /新版|游戏|特质/);
    await f.page.evaluate(() => document.querySelector('#cloudUploadBtn').onclick());
    assert.equal(f.requests.filter(request => request.method() === 'POST' && request.url().endsWith('/reports')).length, 0);
    assert.equal((await (await f.context.request.get(origin + '/api/reports')).json()).total, 0);
    assert.equal(await f.page.evaluate(() => localStorage.getItem('bic.report-library.v1')), original);
  } finally { await f.context.close(); }
});
test('old original progress stays untouched until confirmation and retains its old meaning through real cloud storage', async () => {
  const { loadReportScripts, legacyState } = require('../helpers/report.cjs'), w = loadReportScripts(), initial = legacyState(w, true);
  initial.report = w.generateReport(initial); initial.report.meta.batchId = 'LEGACY-PROFILE-EXACT'; initial.report.meta.date = '原日期';
  w.reportEditing.applyEdit(initial.report, 'summary', '保留旧问卷的顾问建议', '虚构顾问'); initial.ui = { screen: 'report', idx: 0, resumeScreen: 'academic' };
  const raw = JSON.stringify(initial, null, 2) + '\n', expected = JSON.parse(raw), f = await open(raw);
  try {
    await f.page.locator('#profileNotice').waitFor({ state: 'visible' }); await f.page.locator('#reportRoot .paper').waitFor();
    assert.equal(await f.page.evaluate(() => localStorage.getItem('pathwise.state.v1')), raw);
    assert.deepEqual(await f.page.evaluate(() => ({ profile: __pathwise.state.report.meta.assessmentProfile, personality: __pathwise.state.report.mbti.total, planning: __pathwise.state.report.meta.coverage.plan.total, oldGroup: __pathwise.state.plan.answers.groupSize })),
      { profile: 'legacy-2026.10', personality: 24, planning: 14, oldGroup: initial.plan.answers.groupSize });
    await f.page.evaluate(() => dispatchEvent(new Event('pagehide'))); assert.equal(await f.page.evaluate(() => localStorage.getItem('pathwise.state.v1')), raw);
    await f.page.reload(); await f.page.locator('#profileNotice').waitFor({ state: 'visible' }); assert.equal(await f.page.evaluate(() => localStorage.getItem('pathwise.state.v1')), raw);
    if (process.env.BIC_CAPTURE === '1') {
      await f.page.evaluate(async () => { await document.fonts.ready; window.scrollTo({ top: 0, behavior: 'instant' }); });
      await f.page.screenshot({ path: path.join(root, 'test-results/profile-desktop.png'), animations: 'disabled' });
      await f.page.setViewportSize({ width: 375, height: 812 }); assert.ok(await f.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await f.page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
      await f.page.screenshot({ path: path.join(root, 'test-results/profile-mobile.png'), animations: 'disabled' });
    }
    await useConfirm(f.page).confirmAt(true); await f.page.locator('#profileContinueBtn').click();
    await signIn(f, 'profile.legacy'); await useConfirm(f.page).confirmAt(true); await f.page.locator('#cloudUploadBtn').click(); await f.page.locator('[data-cloud-read]').waitFor();
    const list = await (await f.context.request.get(origin + '/api/reports')).json(); assert.equal(list.total, 1);
    const saved = await (await f.context.request.get(origin + '/api/reports/' + list.items[0].id)).json();
    assert.equal('assessmentProfile' in saved.record, false); assert.deepEqual(saved.record.state.mbti.answers, expected.mbti.answers); assert.deepEqual(saved.record.state.plan.answers, expected.plan.answers);
    assert.equal(saved.record.reportMeta.batchId, initial.report.meta.batchId); assert.equal(saved.record.reportMeta.date, '原日期'); assert.deepEqual(saved.record.advisor.history, expected.report.advisor.history);
  } finally { await f.context.close(); }
});
test('converted or unknown progress only exports its original bytes until an explicit new assessment', async () => {
  const raw = JSON.stringify({ info: { name: '隔离验证', grade: '8', year: '' }, academic: { answers: {} }, plan: { answers: {} }, mbti: { legacy: true, answers: [{ value: 4, ms: null }] } }, null, 2) + '\n';
  const f = await open(raw);
  try {
    await f.page.locator('#profileNotice').waitFor({ state: 'visible' }); assert.equal(await f.page.locator('#profileContinueBtn').isHidden(), true);
    const pending = f.page.waitForEvent('download'); await f.page.locator('#profileRawDownloadBtn').click(); const file = await pending;
    assert.equal(await fs.readFile(await file.path(), 'utf8'), raw);
    // The confirmation is what starts the new version: declining it must ask once and change nothing.
    const askedBefore = (await useConfirm(f.page).asked()).length;
    await useConfirm(f.page).confirmAt(false); await f.page.locator('#profileRestartBtn').click();
    await f.page.waitForFunction(count => window.__BIC_CONFIRM.asked.length === count, askedBefore + 1); assert.equal(await f.page.evaluate(() => localStorage.getItem('pathwise.state.v1')), raw);
    await useConfirm(f.page).confirmAt(true); await f.page.locator('#profileRestartBtn').click();
    assert.equal(await f.page.evaluate(() => __pathwise.state.assessmentProfile), 'games-traits-v1'); assert.equal(await f.page.evaluate(() => __pathwise.state.mbti.answers.length), 30);
    assert.equal(f.requests.length, 0);
  } finally { await f.context.close(); }
});
