const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { withPage } = require('./helpers/browser.cjs');
const { loadReportScripts, legacyState: state } = require('./helpers/report.cjs');

function fixture() {
  const w = loadReportScripts(); vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../js/report-store.js'), 'utf8'), { window: w, Date });
  let raw = null; const store = w.ReportStore.create({ getItem: () => raw, setItem: (_, value) => { raw = value; } });
  const value = state(w, false); value.info.name = '<img src=x>同学'; value.report = w.generateReport(value); value.report.meta.batchId = 'AP-EDIT';
  w.reportEditing.applyEdit(value.report, 'summary', '<script>原建议</script>', '原顾问');
  const record = store.save(value).record, now = Math.floor(Date.now() / 1000);
  return { calls: [], flags: {}, full: { id: 'report-one', revision: 4, record }, baseline: Object.fromEntries(Object.keys(w.reportEditing.sections).map(key => [key, w.reportEditing.getText(value.report, key)])),
    grant: { id: 'grant-one', report_id: 'report-one', report_revision: 4, report_name: record.state.info.name, report_ref: record.reportMeta.batchId,
      owner_username: 'owner.test', recipient_username: 'teacher.test', scope: 'full_report_advice_edit', created_at: now, expires_at: now + 86400, revoked_at: null, status: 'active' } };
}
async function setup(page, origin) {
  assert.ok(fs.existsSync(path.join(__dirname, '../js/advisor-edit-owner.js')), 'Explicit advisor edit owner module must exist');
  await page.evaluate(data => {
    window.__editOwner = data;
    for (const id of ['editRecipient','editTtl','editPreviewBtn','editCreateBtn','editListBtn','editAuditBtn','editOwnerPreview','editOwnerList','editOwnerAudit']) document.getElementById(id)?.remove();
    document.querySelectorAll('.screen').forEach(element => element.classList.remove('active'));
    const root = document.createElement('section'); root.className = 'screen active'; root.innerHTML = '<div class="wrap"><input id="editRecipient"><select id="editTtl"><option value="24">24</option><option value="72">72</option></select><button id="editPreviewBtn">预览</button><button id="editCreateBtn">创建</button><button id="editListBtn">名单</button><button id="editAuditBtn">记录</button><div id="editOwnerPreview" hidden></div><div id="editOwnerList"></div><div id="editOwnerAudit"></div><p id="ownerEditStatus"></p></div>';
    document.querySelector('main').append(root);
  }, fixture());
  await page.addScriptTag({ url: origin + '/js/advisor-edit-owner.js' });
  await page.evaluate(() => {
    const t = __editOwner, clone = value => JSON.parse(JSON.stringify(value));
    const client = { user: { id: 'owner-one', username: 'owner.test', role: 'student' },
      async createAdvisorEditAccess(...args) { t.calls.push(['create', ...args]); return clone(t.grant); },
      async listAdvisorEditAccess(...args) { t.calls.push(['list', ...args]); if (t.flags.delay) await new Promise(resolve => t.resolve = resolve); return { items: [clone(t.grant)] }; },
      async revokeAdvisorEditAccess(...args) { t.calls.push(['revoke', ...args]); },
      async listAdvisorAudit(...args) { t.calls.push(['audit', ...args]); return { items: [{ id:'audit-one', actor_username:'teacher.test',source_revision:4,result_revision:5,created_at:Date.now()/1000,changes:[{section:'summary',before:t.flags.longAudit?'x'.repeat(4000):'<img src=x>旧',after:t.flags.longAudit?'y'.repeat(4000):'<script>新</script>'}]}] }; } };
    const message = text => document.getElementById('ownerEditStatus').textContent = text;
    let busy = false;
    const run = async (label, operation) => { if (busy) return; busy = true; t.ui.setBusy(true); message(label); try { await operation(() => true); } catch (error) { message(error.message); } finally { busy = false; t.ui.setBusy(false); } };
    t.ui = AdvisorEditOwner.init({ client, run, message });
  });
}
const options = { prepare: context => context.route('**/js/app.js*', route => route.fulfill({ contentType: 'application/javascript', body: '' })) };
async function select(page) { await page.evaluate(() => __editOwner.ui.setReport(__editOwner.full)); await page.locator('#editRecipient').fill('teacher.test'); }
async function preview(page) { await select(page); await page.locator('#editPreviewBtn').click(); await page.locator('#editOwnerPreview').waitFor({state:'visible'}); }

test('edit owner confirms full scope and all four exact baselines before creating a single revision grant', () => withPage(async (page, { origin }) => {
  await setup(page, origin); assert.deepEqual(await page.evaluate(() => __editOwner.calls), []); await preview(page);
  assert.match(await page.locator('#editOwnerPreview').textContent(), /逐题|答卷/); assert.match(await page.locator('#editOwnerPreview').textContent(), /<script>原建议<\/script>/);
  assert.equal(await page.locator('#editOwnerPreview img,#editOwnerPreview script').count(), 0);
  page.once('dialog', d => d.dismiss()); await page.locator('#editCreateBtn').click(); assert.deepEqual(await page.evaluate(() => __editOwner.calls), []);
  page.once('dialog', d => d.accept()); await page.locator('#editCreateBtn').click();
  assert.deepEqual(await page.evaluate(() => __editOwner.calls[0]), ['create','report-one',4,'teacher.test',24,await page.evaluate(() => __editOwner.baseline)]);
  assert.match(await page.locator('#ownerEditStatus').textContent(), /未发送|没有发送|不会发送/);
}, options));

test('changing target, lifetime, revision or current bank invalidates edit consent without creating an authorization', () => withPage(async (page, { origin }) => {
  await setup(page, origin); await preview(page); await page.locator('#editRecipient').fill('other.teacher'); assert.equal(await page.locator('#editCreateBtn').isDisabled(), true);
  await page.locator('#editPreviewBtn').click(); await page.locator('#editTtl').selectOption('72'); assert.equal(await page.locator('#editOwnerPreview').isHidden(), true);
  await page.evaluate(() => __editOwner.ui.setReport({ ...__editOwner.full, revision: 5 })); assert.equal(await page.locator('#editRecipient').inputValue(), '');
  await page.evaluate(() => __editOwner.full.record.bankVersion = 'old'); await select(page); await page.locator('#editPreviewBtn').click();
  assert.equal(await page.locator('#editCreateBtn').isDisabled(), true); assert.match(await page.locator('#ownerEditStatus').textContent(), /版本|复核/);
  assert.deepEqual(await page.evaluate(() => __editOwner.calls), []);
}, options));

test('owner can revoke stale edit grants and explicitly inspect escaped server account audit', () => withPage(async (page, { origin }) => {
  await setup(page, origin); await select(page); await page.evaluate(() => __editOwner.grant.status = 'source_changed'); await page.locator('#editListBtn').click();
  await page.locator('[data-edit-revoke="grant-one"]').waitFor(); page.once('dialog', d => d.accept()); await page.locator('[data-edit-revoke="grant-one"]').click();
  assert.deepEqual(await page.evaluate(() => __editOwner.calls.at(-1)), ['revoke','report-one','grant-one']);
  await page.locator('#editAuditBtn').click(); assert.match(await page.locator('#editOwnerAudit').textContent(), /teacher.test/); assert.match(await page.locator('#editOwnerAudit').textContent(), /<script>新<\/script>/);
  assert.equal(await page.locator('#editOwnerAudit script,#editOwnerAudit img').count(), 0);
}, options));

test('late edit grant responses cannot restore a cleared owner report and controls fit mobile', () => withPage(async (page, { origin }) => {
  await setup(page, origin); await select(page); await page.evaluate(() => __editOwner.flags.delay = true); await page.locator('#editListBtn').click();
  await page.waitForFunction(() => typeof __editOwner.resolve === 'function'); await page.evaluate(() => { __editOwner.ui.clear(); __editOwner.resolve(); });
  assert.equal(await page.locator('#editOwnerList').textContent(), ''); assert.equal(await page.locator('#editOwnerAudit').textContent(), ''); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
}, { ...options, viewport: {width:375,height:812} }));

test('owner baseline and server audit wrap 4000 unbroken characters within a 375px viewport', () => withPage(async (page, { origin }) => {
  await setup(page, origin);
  await page.evaluate(() => { __editOwner.full.record.advisor.sections.summary = 'x'.repeat(4000); __editOwner.flags.longAudit = true; });
  await preview(page); await page.locator('#editAuditBtn').click();
  assert.equal(await page.locator('#editOwnerPreview pre').first().textContent(), 'x'.repeat(4000));
  assert.equal(await page.locator('#editOwnerAudit pre').last().textContent(), 'y'.repeat(4000));
  assert.equal(await page.locator('#editOwnerPreview').evaluate(element => element.scrollWidth <= element.clientWidth), true);
  assert.equal(await page.locator('#editOwnerAudit').evaluate(element => element.scrollWidth <= element.clientWidth), true);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
}, { ...options, viewport: {width:375,height:812} }));
