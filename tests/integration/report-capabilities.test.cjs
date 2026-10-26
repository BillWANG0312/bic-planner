/* Real isolated same-origin account security; only temporary fictional accounts. */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const net = require('node:net');
const { spawn, spawnSync } = require('node:child_process');
const { launchBrowser } = require('../helpers/browser.cjs');
const root = path.resolve(__dirname, '../..');
const temporaryRoot = path.resolve('D:/Codex/work/bic-capabilities-browser-tests');
const python = process.env.BIC_TEST_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
const password = 'teacher-browser-test-only-password';
let directory, server, browser, origin, logs = '';
before(async () => {
  await fs.mkdir(temporaryRoot, { recursive: true }); directory = await fs.mkdtemp(path.join(temporaryRoot, 'run-'));
  const reservation = net.createServer(); await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve)); origin = `http://127.0.0.1:${port}`;
  const env = { ...process.env, BIC_DEV: '1', BIC_PORT: String(port), BIC_PUBLIC_ORIGIN: origin,
    BIC_DATABASE_PATH: path.join(directory, 'private.sqlite3'), TEMP: directory, TMP: directory, TMPDIR: directory };
  const bootstrap = `from pathlib import Path;import os;from backend.bic_api.db import Database;from backend.bic_api.security import AuthService;a=AuthService(Database(Path(os.environ['BIC_DATABASE_PATH'])));[a.create_user(name,'${password}',role=role) for name,role in [('capability.one','student'),('capability.two','advisor')]]`;
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


async function fresh() {
  const context = await browser.newContext(), page = await context.newPage(), requests = [];
  page.on('request', request => { if (request.url().includes('/api/')) requests.push(request.url()); });
  await page.goto(origin + '/index.html'); await page.waitForFunction(() => window.__pathwise);
  return { context, page, requests };
}
async function login(page, username) {
  return page.evaluate(async ({ username, password }) => {
    const response = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
    if (!response.ok) throw new Error('Synthetic capability login failed');
    return response.json();
  }, { username, password });
}
async function discover(page, csrf) {
  return page.evaluate(async csrf => {
    const response = await fetch('/api/report-capabilities', { headers: csrf ? { 'X-CSRF-Token': csrf } : {} });
    return { status: response.status, headers: Object.fromEntries(response.headers), body: await response.json() };
  }, csrf);
}

test('capability discovery is explicit and authenticated without widening new profile operations', async () => {
  const f = await fresh();
  try {
    assert.deepEqual(f.requests, []);
    const anonymous = await discover(f.page); assert.equal(anonymous.status, 401);
    const session = await login(f.page, 'capability.one');
    assert.equal(f.requests.filter(url => url.endsWith('/report-capabilities')).length, 1, 'Only explicit anonymous probe ran; login did not discover automatically');
    const result = await discover(f.page, session.csrf_token); assert.equal(result.status, 200);
    assert.equal(result.headers['cache-control'], 'no-store');
    assert.deepEqual(Object.keys(result.body).sort(), ['api_version', 'format', 'profiles', 'version']);
    assert.equal(result.body.format, 'bic-report-capabilities'); assert.equal(result.body.version, 1); assert.equal(result.body.api_version, '2');
    const legacy = result.body.profiles.find(item => item.profile === 'legacy-2026.10');
    const current = result.body.profiles.find(item => item.profile === 'games-traits-v1');
    assert.equal(result.body.profiles.length, 2); assert.ok(legacy.operations.includes('owner_archive'));
    assert.ok(legacy.operations.includes('teacher_preferences_v3')); assert.deepEqual(current.operations, []);
    assert.equal(current.contract.planning_total, 13); assert.equal(current.contract.planning_required, 12); assert.equal(current.contract.personality_total, 30);
    assert.match(current.contract.contract_fingerprint, /^[a-f0-9]{64}$/);
    const text = JSON.stringify(result.body); for (const key of ['csrf_token', 'record_json', 'username', 'password', 'answers', 'answerKey']) assert.equal(text.includes('"'+key+'"'), false);
    assert.deepEqual(await (await f.context.request.get(origin + '/api/health')).json(), { status: 'ok', api_version: '2' });
  } finally { await f.context.close(); }
});

test('recognizing a current contract does not enable owner archive writes or create stored data', async () => {
  const f = await fresh();
  try {
    const session = await login(f.page, 'capability.two'), advertised = await discover(f.page, session.csrf_token);
    assert.equal(advertised.status, 200); assert.deepEqual(advertised.body.profiles[1].operations, []);
    const { loadReportScripts, state } = require('../helpers/report.cjs'), vm = require('node:vm'), read = require('node:fs').readFileSync;
    const w = loadReportScripts(), value = state(w, false); value.report = w.generateReport(value);
    vm.runInNewContext(read(path.join(root, 'js/report-store.js'), 'utf8'), { window: w, Date });
    let raw = null; const record = w.ReportStore.create({ getItem: () => raw, setItem: (_, text) => { raw = text; } }).save(value).record;
    const response = await f.context.request.post(origin + '/api/reports', { headers: { Origin: origin, 'X-CSRF-Token': session.csrf_token }, data: { record } });
    assert.equal(response.status(), 422);
    assert.equal((await (await f.context.request.get(origin + '/api/reports')).json()).total, 0);
  } finally { await f.context.close(); }
});

test('an old page CSRF cannot discover under a replacement cookie and logout removes authenticated discovery', async () => {
  const f = await fresh();
  try {
    const first = await login(f.page, 'capability.one'); assert.equal((await discover(f.page, first.csrf_token)).status, 200);
    const second = await login(f.page, 'capability.two');
    const stale = await discover(f.page, first.csrf_token); assert.equal(stale.status, 403); assert.equal(JSON.stringify(stale.body).includes('contract_fingerprint'), false);
    assert.equal((await discover(f.page, second.csrf_token)).status, 200);
    const response = await f.context.request.post(origin + '/api/auth/logout', { headers: { Origin: origin, 'Content-Type': 'application/json', 'X-CSRF-Token': second.csrf_token } }); assert.equal(response.status(), 204);
    assert.equal((await discover(f.page, second.csrf_token)).status, 401);
  } finally { await f.context.close(); }
});
