/* Real school-account edit authorization, fictional records in a private temporary DB. */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const net = require('node:net');
const { spawn, spawnSync } = require('node:child_process');
const { launchBrowser } = require('../helpers/browser.cjs');
const { loadReportScripts, state } = require('../helpers/report.cjs');
const root = path.resolve(__dirname, '../..');
const temporaryRoot = path.resolve('D:/Codex/work/bic-advisor-edit-browser-tests');
const python = process.env.BIC_TEST_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
const password = 'advisor-edit-test-only-password';
let directory, server, browser, origin, logs = '';
before(async () => {
  await fs.mkdir(temporaryRoot, { recursive: true }); directory = await fs.mkdtemp(path.join(temporaryRoot, 'run-'));
  const reservation = net.createServer(); await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve)); origin = `http://127.0.0.1:${port}`;
  const env = { ...process.env, BIC_DEV: '1', BIC_PORT: String(port), BIC_PUBLIC_ORIGIN: origin,
    BIC_DATABASE_PATH: path.join(directory, 'private.sqlite3'), TEMP: directory, TMP: directory, TMPDIR: directory };
  const bootstrap = `from pathlib import Path;import os;from backend.bic_api.db import Database;from backend.bic_api.security import AuthService;a=AuthService(Database(Path(os.environ['BIC_DATABASE_PATH'])));[a.create_user(name,'${password}',role=role) for name,role in [('edit.owner','student'),('edit.advisor','advisor'),('edit.other','advisor')]]`;
  const seeded = spawnSync(python, ['-c', bootstrap], { cwd: root, env, encoding: 'utf8' });
  assert.equal(seeded.status, 0, 'Install backend development requirements and set BIC_TEST_PYTHON: ' + (seeded.stderr || seeded.error || ''));
  server = spawn(python, ['-m', 'backend.bic_api.dev'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  server.stdout.on('data', value => { logs += value; }); server.stderr.on('data', value => { logs += value; });
  let ready = false;
  for (let i = 0; i < 100 && server.exitCode === null; i++) {
    try { if ((await fetch(origin + '/api/health')).ok) { ready = true; break; } } catch (_) { /* local startup */ }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.ok(ready, 'Edit test server must start: ' + logs); browser = await launchBrowser();
});
after(async () => {
  if (browser) await browser.close();
  if (server && server.exitCode === null) { const exited = new Promise(resolve => server.once('exit', resolve)); server.kill(); await exited; }
  if (directory) { assert.equal(path.dirname(path.resolve(directory)), temporaryRoot); await fs.rm(directory, { recursive: true, force: true }); }
});
async function csrf(context) { return { Origin: origin, 'X-CSRF-Token': (await (await context.request.get(origin + '/api/auth/session')).json()).csrf_token }; }
async function ownerPage(label) {
  const w = loadReportScripts(), value = state(w); value.info.name = '编辑授权测试' + label;
  value.report = w.generateReport(value); value.report.meta.batchId = 'EDIT-CASE-' + label;
  w.reportEditing.applyEdit(value.report, 'summary', '所有者确认的原核心建议', '原顾问');
  value.ui = { screen: 'report', idx: 0, resumeScreen: 'academic' };
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } }), page = await context.newPage(); page.setDefaultTimeout(7000);
  await page.addInitScript(value => { if (!localStorage.getItem('pathwise.state.v1')) localStorage.setItem('pathwise.state.v1', JSON.stringify(value)); }, value);
  await page.goto(origin); await page.locator('#openCloudBtn').click(); await page.locator('#cloudConnectBtn').click();
  await page.locator('#cloudUsername').fill('edit.owner'); await page.locator('#cloudPassword').fill(password);
  await page.locator('#cloudLoginForm button[type=submit]').click(); await page.locator('#cloudWorkspace').waitFor({ state: 'visible' });
  await page.locator('#cloudRefreshBtn:enabled').waitFor();
  const uploaded = page.waitForResponse(response => response.request().method() === 'POST' && response.url() === origin + '/api/reports');
  page.once('dialog', dialog => dialog.accept()); await page.locator('#cloudUploadBtn').click(); const saved = await (await uploaded).json();
  await page.locator(`[data-cloud-read="${saved.id}"]:enabled`).waitFor(); await page.locator(`[data-cloud-read="${saved.id}"]`).click();
  await page.locator('#editRecipient:enabled').waitFor();
  return { context, page, saved };
}
async function createGrant(owner) {
  await owner.page.locator('#editRecipient').fill('edit.advisor'); await owner.page.locator('#editPreviewBtn').click();
  await owner.page.locator('#editOwnerPreview').waitFor({ state: 'visible' });
  assert.match(await owner.page.locator('#editOwnerPreview').textContent(), /所有者确认的原核心建议/);
  const created = owner.page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/advisor-edit-access'));
  owner.page.once('dialog', dialog => dialog.accept()); await owner.page.locator('#editCreateBtn').click();
  const response = await created; assert.equal(response.status(), 201); await owner.page.locator('#editRecipient:enabled').waitFor(); return response.json();
}
async function editorPage(grant) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } }), page = await context.newPage(); page.setDefaultTimeout(7000);
  const requests = []; page.on('request', request => { if (request.url().includes('/api/')) requests.push(request.url()); });
  await page.goto(origin + '/advisor-edit.html'); assert.deepEqual(requests, []);
  await page.locator('#editConnectBtn').click(); await page.locator('#editUsername').fill('edit.advisor'); await page.locator('#editPassword').fill(password);
  await page.locator('#editLoginForm button[type=submit]').click(); await page.locator('#editWorkspace').waitFor({ state: 'visible' });
  await page.locator('#editRefreshBtn:enabled').waitFor(); assert.equal(requests.some(url => url.endsWith('/api/advisor-edit-access')), false);
  await page.locator('#editRefreshBtn').click(); await page.locator(`[data-edit-read="${grant.id}"]:enabled`).waitFor();
  await page.locator(`[data-edit-read="${grant.id}"]`).click(); await page.locator('#editDetail').waitFor({ state: 'visible' });
  assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0);
  return { context, page };
}
async function typeSummary(editor, text) {
  await editor.page.locator('[data-edit-select="summary"]').check();
  await editor.page.locator('[data-edit-section="summary"]').fill(text);
  await editor.page.locator('#editPreviewChangesBtn').click(); await editor.page.locator('#editChangesPreview').waitFor({ state: 'visible' });
}

test('owner separately confirms edit scope; advisor selected text is audited once and original answers stay unchanged', async () => {
  const owner = await ownerPage('ONE'); let editor;
  try {
    const localBefore = await owner.page.evaluate(() => localStorage.getItem('pathwise.state.v1'));
    await owner.page.locator('#editRecipient').fill('edit.advisor'); await owner.page.locator('#editPreviewBtn').click();
    await owner.page.locator('#editOwnerPreview').waitFor({ state: 'visible' });
    owner.page.once('dialog', dialog => dialog.dismiss()); await owner.page.locator('#editCreateBtn').click();
    assert.deepEqual((await (await owner.context.request.get(origin + '/api/reports/' + owner.saved.id + '/advisor-edit-access', { headers: await csrf(owner.context) })).json()).items, []);
    const grant = await createGrant(owner); editor = await editorPage(grant);
    const puts = []; editor.page.on('request', request => { if (request.method() === 'PUT') puts.push(request); });
    await typeSummary(editor, '<b>顾问已核对的新建议</b>');
    editor.page.once('dialog', dialog => dialog.dismiss()); await editor.page.locator('#editSubmitBtn').click(); assert.equal(puts.length, 0);
    if (process.env.BIC_CAPTURE === '1') {
      await editor.page.locator('#editChangesPreview').evaluate(element => element.scrollIntoView({ block: 'start' }));
      await editor.page.screenshot({ path: path.join(root, 'test-results/advisor-edit-desktop.png') });
      await editor.page.setViewportSize({ width: 375, height: 812 }); assert.ok(await editor.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await editor.page.locator('#editChangesPreview').evaluate(element => element.scrollIntoView({ block: 'start' }));
      await editor.page.screenshot({ path: path.join(root, 'test-results/advisor-edit-mobile.png') });
    }
    const written = editor.page.waitForResponse(response => response.request().method() === 'PUT');
    editor.page.once('dialog', dialog => dialog.accept()); await editor.page.locator('#editSubmitBtn').click(); const result = await (await written).json();
    assert.equal(puts.length, 1); assert.deepEqual(result.changed_sections, ['summary']); assert.equal(result.report.revision, 2);
    await editor.page.locator('#editDetail').waitFor({ state: 'hidden' });
    const current = await (await owner.context.request.get(origin + '/api/reports/' + owner.saved.id)).json();
    assert.deepEqual(current.record.state, owner.saved.record.state); assert.deepEqual(current.record.reportMeta, owner.saved.record.reportMeta);
    assert.equal(current.record.advisor.sections.summary, '<b>顾问已核对的新建议</b>');
    assert.equal(current.record.advisor.history.at(-1).actor.username, 'edit.advisor');
    assert.equal(current.record.advisor.history.at(-1).before, '所有者确认的原核心建议');
    assert.equal(await owner.page.evaluate(() => localStorage.getItem('pathwise.state.v1')), localBefore);
    await owner.page.locator('#editAuditBtn').click(); await owner.page.waitForFunction(() => document.querySelector('#editOwnerAudit').textContent.includes('edit.advisor'));
    assert.match(await owner.page.locator('#editOwnerAudit').textContent(), /顾问已核对的新建议/); assert.equal(await owner.page.locator('#editOwnerAudit b').count(), 0);
    assert.equal((await editor.context.request.put(origin + '/api/reports/' + owner.saved.id, { headers: await csrf(editor.context), data: { revision: 2, record: current.record } })).status(), 404);
    assert.equal((await editor.context.request.get(origin + '/api/advisor-edit-access/' + grant.id, { headers: await csrf(editor.context) })).status(), 404);
  } finally { if (editor) await editor.context.close(); await owner.context.close(); }
});

test('an intervening owner revision stops old advisor edits and clears the old private report', async () => {
  const owner = await ownerPage('TWO'); let editor;
  try {
    const grant = await createGrant(owner); editor = await editorPage(grant); await typeSummary(editor, '待提交旧建议');
    const changed = structuredClone(owner.saved.record); changed.state.info.name = '所有者更新资料';
    assert.equal((await owner.context.request.put(origin + '/api/reports/' + owner.saved.id, { headers: await csrf(owner.context), data: { revision: 1, record: changed } })).status(), 200);
    const denied = editor.page.waitForResponse(response => response.request().method() === 'PUT');
    editor.page.once('dialog', dialog => dialog.accept()); await editor.page.locator('#editSubmitBtn').click(); assert.equal((await denied).status(), 404);
    await editor.page.locator('#editDetail').waitFor({ state: 'hidden' });
    assert.equal(await editor.page.locator('#editReport').textContent(), ''); assert.equal(await editor.page.locator('#editFields').textContent(), '');
    const current = await (await owner.context.request.get(origin + '/api/reports/' + owner.saved.id)).json(); assert.deepEqual(current.record, changed);
    assert.deepEqual((await (await owner.context.request.get(origin + '/api/reports/' + owner.saved.id + '/advisor-edits', { headers: await csrf(owner.context) })).json()).items, []);
  } finally { if (editor) await editor.context.close(); await owner.context.close(); }
});

test('a lost committed edit response is not retried and retains only the advisor draft for copying', async () => {
  const owner = await ownerPage('THREE'); let editor;
  try {
    const grant = await createGrant(owner); editor = await editorPage(grant); await typeSummary(editor, '响应丢失仍需保留的本人建议');
    let writes = 0;
    await editor.page.route('**/api/advisor-edit-access/' + grant.id, async route => {
      if (route.request().method() !== 'PUT') return route.continue();
      writes++; const response = await route.fetch(); assert.equal(response.status(), 200); await route.abort('failed');
    });
    editor.page.once('dialog', dialog => dialog.accept()); await editor.page.locator('#editSubmitBtn').click();
    await editor.page.waitForFunction(() => /无法确认|不确定|尚未确认|中断|超时/.test(document.querySelector('#editStatus').textContent));
    assert.equal(writes, 1); assert.equal(await editor.page.locator('#editReport').textContent(), ''); assert.equal(await editor.page.locator('#editSubmitBtn').isDisabled(), true);
    assert.ok(await editor.page.locator('textarea').evaluateAll(elements => elements.some(element => element.value === '响应丢失仍需保留的本人建议' && element.readOnly)));
    const audits = await (await owner.context.request.get(origin + '/api/reports/' + owner.saved.id + '/advisor-edits', { headers: await csrf(owner.context) })).json();
    assert.equal(audits.items.length, 1); assert.equal(audits.items[0].actor_username, 'edit.advisor');
    await editor.page.locator('#editDisconnectBtn').click(); assert.equal(await editor.page.locator('textarea').count(), 0);
  } finally { if (editor) await editor.context.close(); await owner.context.close(); }
});
