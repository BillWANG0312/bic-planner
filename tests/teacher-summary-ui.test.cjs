const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { withPage } = require('./helpers/browser.cjs');

function fixture() {
  const at = Math.floor(Date.now() / 1000);
  const items = [1, 2].map(index => ({
    grant: { id: 'grant-' + index, report_id: 'report-' + index, report_revision: 1,
      report_name: index === 1 ? '<img src=x>同学' : '第二位同学', report_ref: 'AP-SUMMARY-' + index,
      owner_username: 'owner.test', recipient_username: 'teacher.test', scope: 'full_report_read_only',
      created_at: at, expires_at: at + 86400, revoked_at: null, status: 'active' },
    report: { id: 'report-' + index, revision: 1, report_ref: 'AP-SUMMARY-' + index,
      name: index === 1 ? '<img src=x>同学' : '第二位同学', grade: '8', bank_version: '2026.10', catalog_version: null, status: 'draft',
      academic: ['english', 'maths', 'physics', 'chemistry'].map(key => ({ key, answered: index, total: 15 })),
      planning: { answered: 1, total: 12, required_answered: 1, required_total: 12 }, personality: { answered: 0, total: 30 } }
  }));
  return { calls: [], flags: {}, items, reads: 0 };
}
const fakeClient = `window.CloudReports={create(){
 const t=window.__summaryTest,copy=v=>JSON.parse(JSON.stringify(v));let user=null,connected=false;
 return {get user(){return user&&copy(user)},get connected(){return connected},
 async connect(){t.calls.push(['connect']);connected=true;return null},
 async login(username){t.calls.push(['login',username]);user={id:username,username,role:t.flags.student?'student':'advisor'};return {user:copy(user)}},
 async listTeacherReports(){t.calls.push(['list']);if(t.flags.denied){user=null;throw {status:403}};return {items:t.flags.missing?[]:copy(t.items.map(x=>x.grant))}},
 async readTeacherSummaries(ids){t.calls.push(['summary',copy(ids)]);const n=++t.reads;
 if(t.flags.delay)await new Promise(resolve=>t.resolveRead=resolve);if(t.flags.network)throw {code:'NETWORK'};
 if(t.flags.denied){user=null;throw {status:403}};if(t.flags.swap)user={id:'other',username:'other.test',role:'advisor'};
 const items=copy(ids.map(id=>t.items.find(x=>x.grant.id===id)));if(t.flags.changeAt===n){items[0].grant.report_revision++;items[0].report.revision++}
 return {format:'bic-teacher-completion-summary',version:1,items}},
 async logout(){t.calls.push(['logout']);user=null;connected=false},disconnect(){t.calls.push(['disconnect']);user=null;connected=false}
 };}};`;
function options(extra = {}) {
  return { path: '/teacher-summary.html', ...extra,
    beforeLoad: async page => {
      await page.addInitScript(data => {
        window.__summaryTest = data;
        for (const key of ['localStorage', 'sessionStorage']) Object.defineProperty(window, key, { get() { throw new Error('Summary page must not use browser storage'); } });
      }, fixture());
      if (extra.beforeLoad) await extra.beforeLoad(page);
    },
    prepare: async context => {
      await context.route('**/js/cloud-client.js*', route => route.fulfill({ contentType: 'application/javascript', body: fakeClient }));
      if (extra.prepare) await extra.prepare(context);
    }
  };
}
function withSummary(fn, extra) {
  assert.ok(fs.existsSync(path.join(__dirname, '../teacher-summary.html')), 'The independent summary portal must exist');
  return withPage(fn, options(extra));
}
async function login(page) {
  await page.locator('#summaryConnectBtn').click(); await page.locator('#summaryUsername').fill('teacher.test'); await page.locator('#summaryPassword').fill('test-only-summary-password');
  await page.locator('#summaryLoginForm button[type=submit]').click(); await page.locator('#summaryWorkspace').waitFor({ state: 'visible' });
}
async function preview(page, ids = ['grant-1']) {
  await login(page); await page.locator('#summaryRefreshBtn').click();
  for (const id of ids) await page.locator(`[data-summary-grant="${id}"]`).check();
  await page.locator('#summaryPreviewBtn').click(); await page.locator('#summaryPreview').waitFor({ state: 'visible' });
}

test('summary portal is disconnected until asked, never stores data or treats a fragment as permission', () => withSummary(async page => {
  assert.deepEqual(await page.evaluate(() => __summaryTest.calls), []); assert.equal(await page.evaluate(() => location.hash), '');
  assert.equal(await page.locator('script[src*="bank"],script[src*="report-store"],script[src*="app.js"]').count(), 0);
  await login(page); assert.equal(await page.locator('#summaryPassword').inputValue(), '');
  assert.deepEqual(await page.evaluate(() => __summaryTest.calls.map(x => x[0])), ['connect', 'login']);
  assert.equal(await page.locator('#summaryList').textContent(), '');
}, { path: '/teacher-summary.html#share=not-permission' }));

test('only explicitly selected grant summaries become escaped 21-column preview rows', () => withSummary(async page => {
  await preview(page);
  assert.deepEqual(await page.evaluate(() => __summaryTest.calls.filter(x => x[0] === 'summary')), [['summary', ['grant-1']]]);
  assert.equal(await page.locator('#summaryTable thead th').count(), 21); assert.equal(await page.locator('#summaryTable tbody tr').count(), 1);
  assert.match(await page.locator('#summaryTable').textContent(), /<img src=x>同学/); assert.equal(await page.locator('#summaryTable img').count(), 0);
  assert.doesNotMatch(await page.locator('#summaryTable').textContent(), /第二位同学|owner.test|grant-1/);
}));

test('unknown catalog display agrees with the reviewed CSV missing-version label', () => withSummary(async page => {
  await page.evaluate(() => __summaryTest.items[0].report.catalog_version = 'unknown'); await preview(page);
  assert.equal(await page.locator('#summaryTable tbody td').nth(5).textContent(), '未记录');
  const csv = await page.evaluate(() => TeacherSummary.build({ format: 'bic-teacher-completion-summary', version: 1, items: [__summaryTest.items[0]] }, 'teacher.test').csv);
  assert.match(csv, /"未记录"/);
}));

test('cancelled export downloads nothing; accepted export rereads before and after confirmation and uses preview CSV', () => withSummary(async page => {
  await preview(page, ['grant-1', 'grant-2']); let downloads = 0; page.on('download', () => downloads++);
  page.once('dialog', dialog => dialog.dismiss()); await page.locator('#summaryExportBtn').click();
  assert.equal(downloads, 0); assert.equal(await page.evaluate(() => __summaryTest.reads), 2);
  const expected = await page.evaluate(() => TeacherSummary.build({ format: 'bic-teacher-completion-summary', version: 1, items: __summaryTest.items }, 'teacher.test').csv);
  const downloaded = page.waitForEvent('download'); page.once('dialog', dialog => dialog.accept()); await page.locator('#summaryExportBtn').click();
  const file = await downloaded; assert.equal(file.suggestedFilename(), 'bic-teacher-completion-v1.csv');
  assert.equal(fs.readFileSync(await file.path(), 'utf8'), expected); assert.equal(await page.evaluate(() => __summaryTest.reads), 4);
}));

test('source changes at the pre-confirmation check clear the preview and do not open a confirmation', () => withSummary(async page => {
  await preview(page); let dialogs = 0; page.on('dialog', dialog => { dialogs++; return dialog.dismiss(); });
  await page.evaluate(() => __summaryTest.flags.changeAt = 2); await page.locator('#summaryExportBtn').click();
  await page.waitForFunction(() => document.querySelector('#summaryPreview').hidden);
  assert.equal(dialogs, 0); assert.equal(await page.locator('#summaryTable').textContent(), ''); assert.equal(await page.locator('#summaryExportBtn').isDisabled(), true);
}));

test('source changes at the post-confirmation read stop the download', () => withSummary(async page => {
  await preview(page); let downloads = 0; page.on('download', () => downloads++);
  await page.evaluate(() => __summaryTest.flags.changeAt = 3);
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#summaryExportBtn').click(); await page.waitForFunction(() => document.querySelector('#summaryPreview').hidden);
  assert.equal(downloads, 0); assert.equal(await page.evaluate(() => __summaryTest.reads), 3); assert.equal(await page.locator('#summaryTable').textContent(), '');
}));

test('an authorization expiring while the confirmation is open cannot start a final read or download', () => withSummary(async page => {
  await page.evaluate(() => __summaryTest.items[0].grant.expires_at = Math.floor(Date.now() / 1000) + 3);
  await preview(page); let downloads = 0; page.on('download', () => downloads++);
  page.once('dialog', async dialog => { await new Promise(resolve => setTimeout(resolve, 3100)); await dialog.accept(); });
  await page.locator('#summaryExportBtn').click(); await page.waitForFunction(() => document.querySelector('#summaryPreview').hidden);
  assert.equal(downloads, 0); assert.equal(await page.evaluate(() => __summaryTest.reads), 2); assert.equal(await page.locator('#summaryExportBtn').isDisabled(), true);
}));

test('selection changes, explicit refresh and failed reads invalidate the old CSV instead of recomputing silently', () => withSummary(async page => {
  await preview(page); await page.locator('[data-summary-grant="grant-2"]').check(); assert.equal(await page.locator('#summaryPreview').isHidden(), true);
  assert.equal(await page.evaluate(() => __summaryTest.reads), 1); await page.locator('#summaryPreviewBtn').click(); await page.locator('#summaryPreview').waitFor({ state: 'visible' });
  await page.evaluate(() => __summaryTest.flags.network = true); await page.locator('#summaryExportBtn').click();
  await page.waitForFunction(() => document.querySelector('#summaryPreview').hidden); assert.equal(await page.locator('#summaryExportBtn').isDisabled(), true);
  await page.evaluate(() => { __summaryTest.flags.network = false; __summaryTest.flags.missing = true; }); await page.locator('#summaryRefreshBtn').click();
  assert.equal(await page.locator('[data-summary-grant]:checked').count(), 0); assert.equal(await page.locator('#summaryTable').textContent(), '');
}));

test('expiry clears the selected preview and choices without polling', () => withSummary(async page => {
  await page.evaluate(() => __summaryTest.items[0].grant.expires_at = Math.floor(Date.now() / 1000) + 3);
  await preview(page); const calls = await page.evaluate(() => __summaryTest.calls.length);
  await page.waitForFunction(() => document.querySelector('#summaryPreview').hidden, undefined, { timeout: 4500 });
  assert.equal(await page.locator('[data-summary-grant]:checked').count(), 0); assert.equal(await page.locator('#summaryTable').textContent(), '');
  assert.equal(await page.evaluate(() => __summaryTest.calls.length), calls);
}));

test('selected authorization expiry clears choices before any summary is read', () => withSummary(async page => {
  await page.evaluate(() => __summaryTest.items[0].grant.expires_at = Math.floor(Date.now() / 1000) + 3);
  await login(page); await page.locator('#summaryRefreshBtn').click(); await page.locator('[data-summary-grant="grant-1"]').check();
  const calls = await page.evaluate(() => __summaryTest.calls.length);
  await page.waitForFunction(() => document.querySelectorAll('[data-summary-grant]:checked').length === 0, undefined, { timeout: 4500 });
  assert.equal(await page.evaluate(() => __summaryTest.reads), 0); assert.equal(await page.evaluate(() => __summaryTest.calls.length), calls);
  assert.equal(await page.locator('#summaryPreviewBtn').isDisabled(), true);
}));

test('disconnect, pagehide and late summary responses cannot restore old private rows', () => withSummary(async page => {
  await login(page); await page.locator('#summaryRefreshBtn').click(); await page.locator('[data-summary-grant="grant-1"]').check();
  await page.evaluate(() => __summaryTest.flags.delay = true); await page.locator('#summaryPreviewBtn').click(); await page.waitForFunction(() => typeof __summaryTest.resolveRead === 'function');
  await page.locator('#summaryDisconnectBtn').click(); await page.evaluate(() => __summaryTest.resolveRead());
  assert.equal(await page.locator('#summaryList').textContent(), ''); assert.equal(await page.locator('#summaryTable').textContent(), '');
  await page.evaluate(() => __summaryTest.flags.delay = false); await preview(page); await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  assert.equal(await page.locator('#summaryList').textContent(), ''); assert.equal(await page.locator('#summaryTable').textContent(), '');
}));

test('wrong roles and changed cookie identities cannot retain the earlier private summary', () => withSummary(async page => {
  await page.evaluate(() => __summaryTest.flags.student = true); await login(page); await page.locator('#summaryRefreshBtn').click();
  assert.equal(await page.evaluate(() => __summaryTest.calls.some(x => x[0] === 'list')), false);
  await page.locator('#summaryDisconnectBtn').click(); await page.evaluate(() => __summaryTest.flags.student = false); await preview(page);
  await page.evaluate(() => __summaryTest.flags.swap = true); await page.locator('#summaryExportBtn').click();
  await page.waitForFunction(() => document.querySelector('#summaryWorkspace').hidden);
  assert.equal(await page.locator('#summaryList').textContent(), ''); assert.equal(await page.locator('#summaryTable').textContent(), '');
}));

test('the twenty-first choice is refused before requesting a batch, without defaulting to all reports', () => withSummary(async page => {
  await page.evaluate(() => {
    for (let index = 3; index <= 21; index++) {
      const item = structuredClone(__summaryTest.items[0]); item.grant.id = 'grant-' + index; item.grant.report_id = item.report.id = 'report-' + index;
      item.grant.report_ref = item.report.report_ref = 'AP-SUMMARY-' + index; item.grant.report_name = item.report.name = '测试学员' + index; __summaryTest.items.push(item);
    }
  });
  await login(page); await page.locator('#summaryRefreshBtn').click(); assert.equal(await page.locator('[data-summary-grant]:checked').count(), 0);
  for (let index = 1; index <= 20; index++) await page.locator(`[data-summary-grant="grant-${index}"]`).check();
  await page.locator('[data-summary-grant="grant-21"]').click(); assert.equal(await page.locator('[data-summary-grant]:checked').count(), 20);
  assert.equal(await page.evaluate(() => __summaryTest.reads), 0); assert.match(await page.locator('#summaryStatus').textContent(), /最多20/);
  await page.locator('#summaryPreviewBtn').click(); await page.locator('#summaryPreview').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#summaryTable tbody tr').count(), 20); assert.equal(await page.evaluate(() => __summaryTest.calls.at(-1)[1].length), 20);
}));

test('a wide private summary stays within a 375px page and is labelled as identified school data', () => withSummary(async page => {
  await preview(page, ['grant-1', 'grant-2']); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  const dimensions = await page.locator('#summaryPreview .summary-table-scroll').evaluate(el => ({ width: el.clientWidth, scroll: el.scrollWidth }));
  assert.ok(dimensions.scroll > dimensions.width); assert.match(await page.locator('#summaryPreview').textContent(), /姓名|带身份|校内/);
}, { viewport: { width: 375, height: 812 } }));
