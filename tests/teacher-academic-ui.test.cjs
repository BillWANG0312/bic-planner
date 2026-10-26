const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { withPage } = require('./helpers/browser.cjs');

const metadata = { bank_version: '2026.10', rule_version: 'academic-pct-v1', rule_fingerprint: 'a'.repeat(64),
  basis: 'current_local_rules_recomputed', incomplete_policy: 'not_scored', calibration: 'not_calibrated' };
function fixture() {
  const at = Math.floor(Date.now() / 1000);
  return { calls: [], flags: {}, reads: 0, metadata, items: [{
    grant: { id: 'grant-one', report_id: 'report-one', report_revision: 2, report_name: '<b>测试学员</b>', report_ref: 'ACADEMIC-ONE',
      owner_username: 'owner.test', recipient_username: 'teacher.test', scope: 'full_report_read_only', created_at: at, expires_at: at + 86400, revoked_at: null, status: 'active' },
    report: { id: 'report-one', revision: 2, report_ref: 'ACADEMIC-ONE', name: '<b>测试学员</b>', grade: '8', bank_version: '2026.10', catalog_version: null, status: 'draft',
      academic: ['english', 'maths', 'physics', 'chemistry'].map((key, i) => ({ key, answered: i === 1 ? 14 : 15, total: 15 })),
      planning: { answered: 13, total: 14, required_answered: 13, required_total: 13 }, personality: { answered: 24, total: 24 } }
  }] };
}
const fakeClient = `window.CloudReports={create(){
const t=window.__academicUITest,copy=v=>JSON.parse(JSON.stringify(v));let user=null,connected=false;
return {get user(){return user&&copy(user)},get connected(){return connected},
async connect(){t.calls.push(['connect']);connected=true},async login(username){t.calls.push(['login',username]);user={id:'teacher-id',username,role:'advisor'}},
async listTeacherReports(){t.calls.push(['list']);return {items:copy(t.items.map(x=>x.grant))}},
async readTeacherSummaries(ids,options={}){const mode=options.academic===true;t.calls.push(['summary',copy(ids),copy(options)]);const n=++t.reads;
if(t.flags.delay)await new Promise(resolve=>t.resolveRead=resolve);
if(t.flags.denied){user=null;throw {status:403}};
const version=t.flags.forceVersion|| (mode?2:1),items=copy(ids.map(id=>t.items.find(x=>x.grant.id===id)));
const payload={format:'bic-teacher-completion-summary',version,items};
if(version===2){payload.scoring=copy(t.metadata);if(t.flags.badFingerprint)payload.scoring.rule_fingerprint='b'.repeat(64);
for(const item of items)item.report.performance=[{key:'english',complete:true,pct:0},{key:'maths',complete:false,pct:null},{key:'physics',complete:true,pct:47},{key:'chemistry',complete:true,pct:100}]}
if(t.flags.modeAt===n)document.querySelector('#summaryAcademic').checked=false;
return payload},async logout(){user=null;connected=false},disconnect(){user=null;connected=false;t.calls.push(['disconnect'])}}}};`;
function withSummary(fn, extra = {}) {
  return withPage(fn, { path: '/teacher-summary.html', ...extra,
    beforeLoad: async page => {
      await page.addInitScript(data => { window.__academicUITest = data; for (const key of ['localStorage', 'sessionStorage']) Object.defineProperty(window, key, { get() { throw new Error('No browser storage'); } }); }, fixture());
      if (extra.beforeLoad) await extra.beforeLoad(page);
    },
    prepare: async context => {
      await context.route('**/js/cloud-client.js*', route => route.fulfill({ contentType: 'application/javascript', body: fakeClient }));
      await context.route('**/js/academic-scoring-meta.js*', route => route.fulfill({ contentType: 'application/javascript', body: 'window.BIC_ACADEMIC_SCORING_META=' + JSON.stringify(metadata) + ';' }));
    }
  });
}
async function choose(page) {
  await page.locator('#summaryConnectBtn').click(); await page.locator('#summaryUsername').fill('teacher.test'); await page.locator('#summaryPassword').fill('academic-ui-test-password');
  await page.locator('#summaryLoginForm button[type=submit]').click(); await page.locator('#summaryWorkspace').waitFor({ state: 'visible' });
  await page.locator('#summaryRefreshBtn').click(); await page.locator('[data-summary-grant="grant-one"]').check();
}
async function preview(page, academic = true) {
  await choose(page); if (academic) await page.locator('#summaryAcademic').check();
  await page.locator('#summaryPreviewBtn').click(); await page.locator('#summaryPreview').waitFor({ state: 'visible' });
}

test('academic mode is opt-in and safe metadata adds no answer or archive modules', () => withSummary(async page => {
  assert.equal(await page.locator('#summaryAcademic').isChecked(), false); assert.deepEqual(await page.evaluate(() => __academicUITest.calls), []);
  assert.equal(await page.locator('script[src^="js/academic-scoring-meta.js?"]').count(), 1);
  assert.equal(await page.locator('script[src*="bank.js"],script[src*="report.js"],script[src*="report-store.js"]').count(), 0);
  await preview(page, false); assert.equal(await page.locator('#summaryTable thead th').count(), 21);
  assert.deepEqual(await page.evaluate(() => __academicUITest.calls.filter(x => x[0] === 'summary')), [['summary', ['grant-one'], {}]]);
}));

test('explicit v2 preview has29 columns and distinguishes complete zero from unscored partial subjects', () => withSummary(async page => {
  await preview(page); assert.deepEqual(await page.evaluate(() => __academicUITest.calls.at(-1)), ['summary', ['grant-one'], { academic: true }]);
  assert.equal(await page.locator('#summaryTable thead th').count(), 29);
  const values = await page.locator('#summaryTable tbody td').allTextContents();
  assert.deepEqual(values.slice(21, 25), ['0', '未完整', '47', '100']);
  assert.match(await page.locator('#summaryPreview').textContent(), /非正式|不是正式/);
  assert.match(await page.locator('#summaryScoring').textContent(), /academic-pct-v1/);
  assert.match(await page.locator('#summaryScoring').textContent(), new RegExp(metadata.rule_fingerprint));
  assert.equal(await page.locator('#summaryTable b').count(), 0);
}));

test('v2 export cancellation and fresh confirmed download preserve the reviewed CSV and separate filename', () => withSummary(async page => {
  await preview(page); let downloads = 0; page.on('download', () => downloads++);
  page.once('dialog', dialog => dialog.dismiss()); await page.locator('#summaryExportBtn').click(); assert.equal(downloads, 0);
  const expected = await page.evaluate(() => {
    const items = structuredClone(__academicUITest.items); items[0].report.performance = [{ key: 'english', complete: true, pct: 0 }, { key: 'maths', complete: false, pct: null }, { key: 'physics', complete: true, pct: 47 }, { key: 'chemistry', complete: true, pct: 100 }];
    return TeacherSummary.build({ format: 'bic-teacher-completion-summary', version: 2, scoring: __academicUITest.metadata, items }, 'teacher.test').csv;
  });
  const downloading = page.waitForEvent('download'); page.once('dialog', dialog => dialog.accept()); await page.locator('#summaryExportBtn').click(); const file = await downloading;
  assert.equal(file.suggestedFilename(), 'bic-teacher-academic-v2.csv'); assert.equal(fs.readFileSync(await file.path(), 'utf8'), expected);
  assert.equal(await page.evaluate(() => __academicUITest.reads), 4);
  assert.ok((await page.evaluate(() => __academicUITest.calls.filter(x => x[0] === 'summary'))).every(call => call[2].academic));
}));

test('changing mode destroys the earlier CSV and returning to v1 restores21 columns', () => withSummary(async page => {
  await preview(page); await page.locator('#summaryAcademic').uncheck();
  assert.equal(await page.locator('#summaryPreview').isHidden(), true); assert.equal(await page.locator('#summaryTable').textContent(), '');
  assert.equal(await page.locator('#summaryExportBtn').isDisabled(), true); assert.equal(await page.evaluate(() => __academicUITest.reads), 1);
  await page.locator('#summaryPreviewBtn').click(); await page.locator('#summaryPreview').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#summaryTable thead th').count(), 21); assert.equal(await page.locator('#summaryScoring').textContent(), '');
  assert.deepEqual(await page.evaluate(() => __academicUITest.calls.at(-1)), ['summary', ['grant-one'], {}]);
}));

test('a late v2 read cannot revive a preview after a programmatic mode change', () => withSummary(async page => {
  await choose(page); await page.locator('#summaryAcademic').check(); await page.evaluate(() => __academicUITest.flags.delay = true);
  await page.locator('#summaryPreviewBtn').click(); await page.waitForFunction(() => typeof __academicUITest.resolveRead === 'function');
  await page.evaluate(() => { const input = document.querySelector('#summaryAcademic'); input.checked = false; input.dispatchEvent(new Event('change')); __academicUITest.resolveRead(); });
  await page.locator('#summaryPreviewBtn:enabled').waitFor(); assert.equal(await page.locator('#summaryPreview').isHidden(), true);
  assert.equal(await page.locator('#summaryTable').textContent(), ''); assert.equal(await page.locator('#summaryScoring').textContent(), '');
}));

test('a server mode downgrade or unsolicited v2 is rejected without silently changing the checkbox', () => withSummary(async page => {
  await choose(page); await page.locator('#summaryAcademic').check(); await page.evaluate(() => __academicUITest.flags.forceVersion = 1);
  await page.locator('#summaryPreviewBtn').click(); await page.locator('#summaryPreviewBtn:enabled').waitFor();
  assert.equal(await page.locator('#summaryPreview').isHidden(), true); assert.equal(await page.locator('#summaryAcademic').isChecked(), true);
  await page.locator('#summaryAcademic').uncheck(); await page.evaluate(() => __academicUITest.flags.forceVersion = 2); await page.locator('#summaryPreviewBtn').click(); await page.locator('#summaryPreviewBtn:enabled').waitFor();
  assert.equal(await page.locator('#summaryPreview').isHidden(), true); assert.equal(await page.locator('#summaryAcademic').isChecked(), false);
}));

test('a changed scoring fingerprint at the freshness read clears the previous CSV and metadata', () => withSummary(async page => {
  await preview(page); let downloads = 0; page.on('download', () => downloads++); await page.evaluate(() => __academicUITest.flags.badFingerprint = true);
  await page.locator('#summaryExportBtn').click(); await page.locator('#summaryExportBtn:disabled').waitFor();
  assert.equal(downloads, 0); assert.equal(await page.locator('#summaryPreview').isHidden(), true); assert.equal(await page.locator('#summaryScoring').textContent(), '');
}));

test('mode changed inside confirmation is caught even without a change event or another request', () => withSummary(async page => {
  await preview(page); let downloads = 0; page.on('download', () => downloads++);
  await page.evaluate(() => { window.confirm = () => { document.querySelector('#summaryAcademic').checked = false; return true; }; });
  await page.locator('#summaryExportBtn').click(); await page.locator('#summaryPreview').waitFor({ state: 'hidden' });
  assert.equal(downloads, 0); assert.equal(await page.evaluate(() => __academicUITest.reads), 2); assert.equal(await page.locator('#summaryPreview').isHidden(), true);
}));

test('mode changed by a final pending response cannot produce the old v2 download', () => withSummary(async page => {
  await preview(page); let downloads = 0; page.on('download', () => downloads++); await page.evaluate(() => __academicUITest.flags.modeAt = 3);
  page.once('dialog', dialog => dialog.accept()); await page.locator('#summaryExportBtn').click(); await page.locator('#summaryPreview').waitFor({ state: 'hidden' });
  assert.equal(downloads, 0); assert.equal(await page.evaluate(() => __academicUITest.reads), 3); assert.equal(await page.locator('#summaryPreview').isHidden(), true);
}));

test('disconnect clears pending v2 rows and provenance, and the mobile fingerprint stays in the page', () => withSummary(async page => {
  await preview(page); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  const width = await page.locator('.summary-table-scroll').evaluate(element => ({ width: element.clientWidth, scroll: element.scrollWidth })); assert.ok(width.scroll > width.width);
  await page.locator('#summaryDisconnectBtn').click(); assert.equal(await page.locator('#summaryScoring').textContent(), ''); assert.equal(await page.locator('#summaryTable').textContent(), '');
}, { viewport: { width: 375, height: 812 } }));

test('mode changed in a cancelled confirmation also clears the earlier private preview', () => withSummary(async page => {
  await preview(page); let downloads = 0; page.on('download', () => downloads++);
  await page.evaluate(() => { window.confirm = () => { document.querySelector('#summaryAcademic').checked = false; return false; }; });
  await page.locator('#summaryExportBtn').click(); await page.locator('#summaryPreview').waitFor({ state: 'hidden' });
  assert.equal(downloads, 0); assert.equal(await page.evaluate(() => __academicUITest.reads), 2); assert.equal(await page.locator('#summaryScoring').textContent(), '');
}));

test('changing mode away and back during an unfinished read still invalidates that earlier request', () => withSummary(async page => {
  await choose(page); await page.locator('#summaryAcademic').check(); await page.evaluate(() => __academicUITest.flags.delay = true);
  await page.locator('#summaryPreviewBtn').click(); await page.waitForFunction(() => typeof __academicUITest.resolveRead === 'function');
  await page.evaluate(() => { const input = document.querySelector('#summaryAcademic'); for (const checked of [false, true]) { input.checked = checked; input.dispatchEvent(new Event('change')); } __academicUITest.resolveRead(); });
  await page.locator('#summaryPreviewBtn:enabled').waitFor(); assert.equal(await page.locator('#summaryPreview').isHidden(), true); assert.equal(await page.locator('#summaryScoring').textContent(), '');
}));
