const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { withPage } = require('./helpers/browser.cjs');

function options() { return { prepare: context => context.route('**/js/app.js*', route => route.fulfill({ contentType: 'application/javascript', body: '' })) }; }
async function setup(page, origin) {
  assert.ok(fs.existsSync(path.join(__dirname, '../js/teacher-owner.js')), 'The explicit teacher owner module must exist');
  await page.evaluate(() => {
    for (const id of ['teacherRecipient', 'teacherTtl', 'teacherPreviewBtn', 'teacherCreateBtn', 'teacherListBtn', 'teacherOwnerPreview', 'teacherOwnerList']) document.getElementById(id)?.remove();
    document.querySelectorAll('.screen').forEach(element => element.classList.remove('active'));
    const root = document.createElement('section'); root.className = 'screen active';
    root.innerHTML = '<div class="wrap"><input id="teacherRecipient"><select id="teacherTtl"><option value="24">24</option><option value="72">72</option></select><button id="teacherPreviewBtn">预览</button><button id="teacherCreateBtn">创建</button><button id="teacherListBtn">名单</button><div id="teacherOwnerPreview" hidden></div><div id="teacherOwnerList"></div><p id="ownerTeacherStatus"></p></div>';
    document.querySelector('main').append(root);
    const now = Math.floor(Date.now() / 1000);
    window.__teacherOwner = { calls: [], flags: {}, full: { id: 'report-one', revision: 7, record: { state: { info: { name: '<img src=x>同学' } },
      bankVersion: QUESTION_BANK_META.version, catalogVersion: UNIVERSITY_CATALOG.version, reportMeta: { batchId: 'AP-OWNER', date: '2026年10月25日' }, advisor: { sections: {}, history: [] } } },
      grant: { id: 'grant-one', report_id: 'report-one', report_revision: 7, report_name: '<img src=x>同学', report_ref: 'AP-OWNER', owner_username: 'owner.test', recipient_username: 'teacher.test', scope: 'full_report_read_only', created_at: now, expires_at: now + 86400, revoked_at: null, status: 'active' } };
  });
  await page.addScriptTag({ url: origin + '/js/teacher-owner.js' });
  await page.evaluate(() => {
    const t = window.__teacherOwner, copy = value => JSON.parse(JSON.stringify(value));
    const client = { user: { id: 'owner-one', username: 'owner.test', role: 'student' },
      async createTeacherAccess(...args) { t.calls.push(['create', ...args]); return copy(t.grant); },
      async listTeacherAccess(...args) { t.calls.push(['list', ...args]); if (t.flags.delay) await new Promise(resolve => t.resolve = resolve); return { items: [copy(t.grant)] }; },
      async revokeTeacherAccess(...args) { t.calls.push(['revoke', ...args]); } };
    const message = text => document.getElementById('ownerTeacherStatus').textContent = text;
    let busy = false;
    const run = async (label, operation) => { if (busy) return; busy = true; t.ui.setBusy(true); message(label); try { await operation(() => true); } catch (error) { message(error.message); } finally { busy = false; t.ui.setBusy(false); } };
    t.ui = TeacherOwner.init({ client, run, message });
  });
}
async function select(page) { await page.evaluate(() => __teacherOwner.ui.setReport(__teacherOwner.full)); await page.locator('#teacherRecipient').fill('teacher.test'); }
async function preview(page) { await select(page); await page.locator('#teacherPreviewBtn').click(); await page.locator('#teacherOwnerPreview').waitFor({ state: 'visible' }); }

test('teacher grant requires explicit scope preview and a revision-bound confirmation without sending a message', () => withPage(async (page, { origin }) => {
  await setup(page, origin); assert.deepEqual(await page.evaluate(() => __teacherOwner.calls), []);
  assert.equal(await page.locator('#teacherCreateBtn').isDisabled(), true);
  await preview(page); assert.match(await page.locator('#teacherOwnerPreview').textContent(), /逐题|答卷/);
  assert.match(await page.locator('#teacherOwnerPreview').textContent(), /历史/);
  assert.match(await page.locator('#teacherOwnerPreview').textContent(), /owner\.test/);
  assert.equal(await page.locator('#teacherOwnerPreview img').count(), 0);
  page.once('dialog', dialog => { assert.match(dialog.message(), /teacher\.test/); assert.match(dialog.message(), /7/); assert.match(dialog.message(), /历史|答卷/); dialog.dismiss(); });
  await page.locator('#teacherCreateBtn').click(); assert.deepEqual(await page.evaluate(() => __teacherOwner.calls), []);
  page.once('dialog', dialog => dialog.accept()); await page.locator('#teacherCreateBtn').click();
  await page.waitForFunction(() => __teacherOwner.calls.length === 1);
  assert.deepEqual(await page.evaluate(() => __teacherOwner.calls[0]), ['create', 'report-one', 7, 'teacher.test', 24]);
  assert.match(await page.locator('#ownerTeacherStatus').textContent(), /未发送|没有发送|不会发送/);
}, options()));

test('changing recipient, expiry or report clears the captured scope instead of granting a different account', () => withPage(async (page, { origin }) => {
  await setup(page, origin); await preview(page);
  await page.locator('#teacherRecipient').fill('other.teacher');
  assert.equal(await page.locator('#teacherCreateBtn').isDisabled(), true); assert.equal(await page.locator('#teacherOwnerPreview').isVisible(), false);
  await page.locator('#teacherPreviewBtn').click(); await page.locator('#teacherTtl').selectOption('72');
  assert.equal(await page.locator('#teacherCreateBtn').isDisabled(), true);
  await page.locator('#teacherPreviewBtn').click(); await page.evaluate(() => __teacherOwner.ui.setReport({ ...__teacherOwner.full, revision: 8 }));
  assert.equal(await page.locator('#teacherOwnerPreview').isVisible(), false); assert.equal(await page.locator('#teacherRecipient').inputValue(), '');
  assert.deepEqual(await page.evaluate(() => __teacherOwner.calls), []);
}, options()));

test('owner lists grant lifecycle separately and can revoke a source-changed grant without rewriting the report', () => withPage(async (page, { origin }) => {
  await setup(page, origin); await select(page); await page.evaluate(() => __teacherOwner.grant.status = 'source_changed');
  await page.locator('#teacherListBtn').click(); await page.locator('[data-teacher-revoke="grant-one"]').waitFor();
  assert.match(await page.locator('#teacherOwnerList').textContent(), /更新|修订|源/);
  page.once('dialog', dialog => dialog.accept()); await page.locator('[data-teacher-revoke="grant-one"]').click();
  await page.waitForFunction(() => __teacherOwner.calls.some(value => value[0] === 'revoke'));
  assert.deepEqual(await page.evaluate(() => __teacherOwner.calls.at(-1)), ['revoke', 'report-one', 'grant-one']);
  assert.match(await page.locator('#teacherOwnerList').textContent(), /撤销/);
}, options()));

test('late owner metadata cannot revive a cleared report and the owner controls fit a narrow screen', () => withPage(async (page, { origin }) => {
  await setup(page, origin); await select(page); await page.evaluate(() => __teacherOwner.flags.delay = true);
  await page.locator('#teacherListBtn').click(); await page.waitForFunction(() => typeof __teacherOwner.resolve === 'function');
  await page.evaluate(() => { __teacherOwner.ui.clear(); __teacherOwner.resolve(); });
  assert.equal(await page.locator('#teacherOwnerList').textContent(), '');
  assert.equal(await page.locator('#teacherOwnerPreview').textContent(), '');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
}, { ...options(), viewport: { width: 375, height: 812 } }));
