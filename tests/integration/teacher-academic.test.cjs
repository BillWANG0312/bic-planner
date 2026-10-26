/* Real isolated same-origin teacher access; only temporary fictional accounts. */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const net = require('node:net');
const { spawn, spawnSync } = require('node:child_process');
const { launchBrowser } = require('../helpers/browser.cjs');
const { loadReportScripts, legacyState: state } = require('../helpers/report.cjs');
const root = path.resolve(__dirname, '../..');
const temporaryRoot = path.resolve('D:/Codex/work/bic-teacher-academic-browser-tests');
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
async function setup(label, academic = false) {
  const owner = await browser.newContext();
  assert.equal((await owner.request.post(origin + '/api/auth/login', { headers: { Origin: origin }, data: { username: 'summary.owner', password } })).status(), 200);
  const headers = await csrf(owner), w = loadReportScripts();
  const vm = require('node:vm'), source = await fs.readFile(path.join(root, 'js/report-store.js'), 'utf8'); vm.runInNewContext(source, { window: w, Date });
  const reports = [], grants = [];
  for (let i = 0; i < 2; i++) {
    const value = state(w); value.info.name = i ? '第二位摘要学员' : '=SUM(1,1)';
    value.academic.answers = { en1: 0, ma5: 0, ma1: null }; value.plan.answers.weakSubjects = []; value.mbti.answers = [0, null, 2];
    if (academic) value.academic.answers = Object.fromEntries(w.QUESTION_BANK.filter(question => ['english', 'maths'].includes(question.subject))
      .map(question => [question.id, question.subject === 'maths' ? question.answer : question.type === 'choice' ? (question.answer + 1) % question.options.length : question.answer + 1000]));
    value.report = w.generateReport(value); value.report.meta.batchId = `SUMMARY-${label}-${i}`;
    w.reportEditing.applyEdit(value.report, 'summary', '不应返回摘要的私密顾问建议', '原顾问');
    let raw = null; const record = w.ReportStore.create({ getItem: () => raw, setItem: (_, text) => { raw = text; } }).save(value).record;
    const response = await owner.request.post(origin + '/api/reports', { headers, data: { record } }); assert.equal(response.status(), 201); const report = await response.json(); reports.push(report);
    const permission = await owner.request.post(origin + '/api/reports/' + report.id + '/teacher-access', { headers,
      data: { revision: 1, recipient_username: 'summary.advisor', ttl_hours: 24, scope: 'full_report_read_only' } });
    assert.equal(permission.status(), 201); grants.push(await permission.json());
  }
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true }), page = await context.newPage(); page.setDefaultTimeout(7000);
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
  const reply = f.page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/api/teacher-summaries'));
  await f.page.locator('#summaryPreviewBtn').click(); const response = await reply; assert.equal(response.status(), 200);
  const batch = await response.json(); await f.page.locator('#summaryPreview').waitFor({ state: 'visible' }); return batch;
}
async function close(f) { await f.context.close(); await f.owner.close(); }

test('explicit academic v2 keeps v1 stable and downloads only complete zero/full subjects with matching rules', async () => {
  const f = await setup('ACADEMIC', true);
  try {
    assert.equal(await f.page.locator('#summaryAcademic').isChecked(), false); await select(f, 0);
    const original = await preview(f); assert.equal(original.version, 1); assert.equal(await f.page.locator('#summaryTable th').count(), 21);
    await f.page.locator('#summaryAcademic').check(); assert.equal(await f.page.locator('#summaryPreview').isHidden(), true);
    const result = await preview(f); assert.equal(result.version, 2); assert.equal(await f.page.locator('#summaryTable th').count(), 29);
    assert.deepEqual(result.items[0].report.performance, [{ key: 'english', complete: true, pct: 0 }, { key: 'maths', complete: true, pct: 100 }, { key: 'physics', complete: false, pct: null }, { key: 'chemistry', complete: false, pct: null }]);
    const baseline = structuredClone(result.items[0].report); delete baseline.performance; assert.deepEqual(baseline, original.items[0].report);
    assert.deepEqual(result.scoring, await f.page.evaluate(() => window.BIC_ACADEMIC_SCORING_META));
    assert.match(await f.page.locator('#summaryScoring').textContent(), new RegExp(result.scoring.rule_fingerprint));
    assert.equal(JSON.stringify(result).includes('不应返回摘要的私密顾问建议'), false);
    const expected = await f.page.evaluate(value => window.TeacherSummary.build(value, 'summary.advisor').csv, result);
    if (process.env.BIC_CAPTURE === '1') {
      await f.page.locator('#summaryPreview').evaluate(element => element.scrollIntoView({ block: 'start' }));
      await f.page.locator('#summaryTable').evaluate(table => { table.parentElement.scrollLeft = table.rows[0].cells[21].offsetLeft; });
      await f.page.screenshot({ path: path.join(root, 'test-results/academic-summary-desktop.png') });
      await f.page.setViewportSize({ width: 375, height: 812 }); assert.ok(await f.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await f.page.locator('#summaryPreview').evaluate(element => element.scrollIntoView({ block: 'start' }));
      await f.page.locator('#summaryTable').evaluate(table => { table.parentElement.scrollLeft = table.rows[0].cells[21].offsetLeft; });
      await f.page.screenshot({ path: path.join(root, 'test-results/academic-summary-mobile.png') });
    }
    const file = f.page.waitForEvent('download'); f.page.once('dialog', dialog => dialog.accept()); await f.page.locator('#summaryExportBtn').click(); const download = await file;
    assert.equal(download.suggestedFilename(), 'bic-teacher-academic-v2.csv'); assert.equal(await fs.readFile(await download.path(), 'utf8'), expected);
    const batches = f.requests.filter(request => request.url().endsWith('/api/teacher-summaries'));
    assert.equal(batches[0].postDataJSON().academic, undefined); assert.ok(batches.slice(1).every(request => request.postDataJSON().academic === true));
    await f.page.locator('#summaryAcademic').uncheck(); assert.equal(await f.page.locator('#summaryPreview').isHidden(), true);
    assert.deepEqual(await preview(f), original);
    for (const saved of f.reports) assert.deepEqual(await (await f.owner.request.get(origin + '/api/reports/' + saved.id)).json(), saved);
  } finally { await close(f); }
});

test('an inconsistent server rule fingerprint stops academic export without a v1 fallback', async () => {
  const f = await setup('FINGERPRINT', true);
  try {
    await select(f, 0); await f.page.locator('#summaryAcademic').check(); await preview(f); let downloads = 0; f.page.on('download', () => { downloads++; });
    await f.page.route('**/api/teacher-summaries', async route => {
      const response = await route.fetch(); const value = await response.json(); value.scoring.rule_fingerprint = '0'.repeat(64); await route.fulfill({ response, json: value });
    });
    await f.page.locator('#summaryExportBtn').click(); await f.page.locator('#summaryPreview').waitFor({ state: 'hidden' });
    assert.equal(downloads, 0); assert.equal(await f.page.locator('#summaryExportBtn').isDisabled(), true);
    assert.equal(await f.page.locator('#summaryTable').textContent(), ''); assert.equal(await f.page.locator('#summaryScoring').textContent(), '');
  } finally { await close(f); }
});

test('a programmatic mode change during the final academic check stops an old reviewed download', async () => {
  const f = await setup('MODE', true);
  try {
    await select(f, 0); await f.page.locator('#summaryAcademic').check(); await preview(f); let downloads = 0, checks = 0; f.page.on('download', () => { downloads++; });
    await f.page.route('**/api/teacher-summaries', async route => {
      checks++;
      if (checks === 2) await f.page.evaluate(() => { document.querySelector('#summaryAcademic').checked = false; });
      await route.continue();
    });
    f.page.once('dialog', dialog => dialog.accept()); await f.page.locator('#summaryExportBtn').click();
    await f.page.locator('#summaryPreview').waitFor({ state: 'hidden' }); assert.equal(checks, 2); assert.equal(downloads, 0);
    assert.equal(await f.page.locator('#summaryTable').textContent(), ''); assert.equal(await f.page.locator('#summaryExportBtn').isDisabled(), true);
  } finally { await close(f); }
});
