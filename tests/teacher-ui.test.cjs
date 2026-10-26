const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { withPage } = require('./helpers/browser.cjs');
const { loadReportScripts, legacyState: state } = require('./helpers/report.cjs');

function fixture() {
  const w = loadReportScripts();
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../js/report-store.js'), 'utf8'), { window: w, Date });
  let raw = null; const store = w.ReportStore.create({ getItem: () => raw, setItem: (_, value) => { raw = value; } });
  const value = state(w, false); value.info.name = '<img src=x>同学'; value.report = w.generateReport(value); value.report.meta.batchId = 'AP-TEACHER';
  w.reportEditing.applyEdit(value.report, 'summary', '<script>保密顾问原文</script>', '核对老师');
  const record = store.save(value).record, now = Math.floor(Date.now() / 1000);
  return { calls: [], flags: {}, grant: { id: 'grant-one', report_id: 'report-one', report_revision: 4,
    report_name: record.state.info.name, report_ref: record.reportMeta.batchId, owner_username: 'owner.test', recipient_username: 'teacher.test',
    scope: 'full_report_read_only', created_at: now, expires_at: now + 86400, revoked_at: null, status: 'active' },
    report: { id: 'report-one', revision: 4, created_at: record.createdAt, updated_at: record.updatedAt, record } };
}
const fakeClient = `window.CloudReports={create(){
 let user=null,connected=false; const t=window.__teacherTest,clone=v=>JSON.parse(JSON.stringify(v));
 return {get user(){return user&&clone(user)},get connected(){return connected},
 async connect(){t.calls.push(['connect']);if(t.flags.disabled)throw Object.assign(new Error('PRIVATE ERROR'),{code:'DISABLED'});connected=true;return null},
 async login(username,password){t.calls.push(['login',username]);user={id:username,username,role:t.flags.student?'student':'advisor'};return {user:clone(user)}},
 async listTeacherReports(){t.calls.push(['list']);if(t.flags.denied){user=null;throw Object.assign(new Error('PRIVATE ERROR'),{status:403})}return {items:clone(t.flags.missing?[]:[t.grant])}},
 async readTeacherReport(id){t.calls.push(['read',id]);if(t.flags.delayRead)await new Promise(resolve=>t.resolveRead=resolve);
 if(t.flags.failRead)throw Object.assign(new Error('PRIVATE ERROR'),{code:'NETWORK'});if(t.flags.closed)throw Object.assign(new Error('PRIVATE ERROR'),{status:404});
 const result={grant:clone(t.grant),report:clone(t.report)};if(t.flags.oldBank)result.report.record.bankVersion='old-bank';if(t.flags.oldCatalog)result.report.record.catalogVersion='old-catalog';return result},
 async logout(){t.calls.push(['logout']);user=null;connected=false},disconnect(){t.calls.push(['disconnect']);user=null;connected=false}
 };}};`;
function options(extra = {}) { return { path: '/teacher.html', ...extra,
  beforeLoad: async page => { await page.addInitScript(data => {
    window.__teacherTest = data;
    for (const key of ['localStorage', 'sessionStorage']) Object.defineProperty(window, key, { get() { throw new Error('Teacher page must not use browser storage'); } });
  }, fixture()); if (extra.beforeLoad) await extra.beforeLoad(page); },
  prepare: async context => { await context.route('**/js/cloud-client.js*', route => route.fulfill({ contentType: 'application/javascript', body: fakeClient })); if (extra.prepare) await extra.prepare(context); }
}; }
function withTeacher(fn, extra) { assert.ok(fs.existsSync(path.join(__dirname, '../teacher.html')), 'The isolated teacher portal must exist'); return withPage(fn, options(extra)); }
async function login(page) {
  await page.locator('#teacherConnectBtn').click(); await page.locator('#teacherUsername').fill('teacher.test'); await page.locator('#teacherPassword').fill('test-only-teacher-password');
  await page.locator('#teacherLoginForm button[type=submit]').click(); await page.locator('#teacherWorkspace').waitFor({ state: 'visible' });
}
async function read(page) { await login(page); await page.locator('#teacherRefreshBtn').click(); await page.locator('[data-teacher-read="grant-one"]').click(); await page.locator('#teacherReport .paper').waitFor(); }

test('teacher portal never probes before explicit connection, clears passwords and does not treat share fragments as permission', () => withTeacher(async page => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  assert.deepEqual(await page.evaluate(() => __teacherTest.calls), []);
  assert.equal(await page.evaluate(() => location.hash), '');
  await login(page); assert.equal(await page.locator('#teacherPassword').inputValue(), '');
  assert.deepEqual(await page.evaluate(() => __teacherTest.calls.map(value => value[0])), ['connect', 'login']);
  assert.equal(await page.locator('#teacherList').textContent(), '');
  assert.deepEqual(errors, []);
}, { path: '/teacher.html#share=' + 'x'.repeat(43) }));

test('authorized report and audit render read-only through memory without assessment storage or edit/export controls', () => withTeacher(async page => {
  const errors = []; page.on('pageerror', error => errors.push(error.message)); await read(page);
  assert.match(await page.locator('#teacherReport').textContent(), /<img src=x>同学/);
  assert.match(await page.locator('#teacherHistory').textContent(), /<script>保密顾问原文<\/script>/);
  assert.equal(await page.locator('#teacherReport img[src=x],#teacherHistory script').count(), 0);
  assert.equal(await page.locator('#advisorEditor,#archiveReportBtn,#cloudUploadBtn,#printBtn,[data-restore]').count(), 0);
  assert.equal(await page.evaluate(() => typeof window.__pathwise), 'undefined');
  assert.equal(await page.locator('script[src*="app.js"],script[src*="report-library"],script[src*="outcome"],script[src*="statistics"]').count(), 0);
  assert.deepEqual(errors, []);
}));

test('old bank or catalog never silently regrades a stored report and audit', () => withTeacher(async page => {
  await login(page); await page.locator('#teacherRefreshBtn').click();
  for (const flag of ['oldBank', 'oldCatalog']) {
    await page.evaluate(flag => { __teacherTest.flags.oldBank = false; __teacherTest.flags.oldCatalog = false; __teacherTest.flags[flag] = true; }, flag);
    await page.locator('[data-teacher-read="grant-one"]').click();
    await page.waitForFunction(() => /版本|复核|更新/.test(document.querySelector('#teacherStatus').textContent));
    assert.equal(await page.locator('#teacherReport').textContent(), ''); assert.equal(await page.locator('#teacherHistory').textContent(), '');
  }
}));

test('failed detail refresh or a grant missing from the fresh list clears previously read private data', () => withTeacher(async page => {
  await read(page); await page.evaluate(() => __teacherTest.flags.failRead = true); await page.locator('#teacherReadRefreshBtn').click();
  await page.waitForFunction(() => document.querySelector('#teacherReport').textContent === '');
  assert.equal(await page.locator('#teacherHistory').textContent(), ''); assert.doesNotMatch(await page.locator('#teacherStatus').textContent(), /PRIVATE/);
  await page.evaluate(() => __teacherTest.flags.failRead = false); await page.locator('[data-teacher-read="grant-one"]').click(); await page.locator('#teacherReport .paper').waitFor();
  await page.evaluate(() => __teacherTest.flags.missing = true); await page.locator('#teacherRefreshBtn').click();
  assert.equal(await page.locator('#teacherReport').textContent(), ''); assert.equal(await page.locator('#teacherHistory').textContent(), '');
}));

test('disconnect, pagehide and late detail responses cannot revive the previous account report', () => withTeacher(async page => {
  await login(page); await page.locator('#teacherRefreshBtn').click(); await page.evaluate(() => __teacherTest.flags.delayRead = true);
  await page.locator('[data-teacher-read="grant-one"]').click(); await page.waitForFunction(() => typeof __teacherTest.resolveRead === 'function');
  await page.locator('#teacherDisconnectBtn').click(); await page.evaluate(() => __teacherTest.resolveRead());
  assert.equal(await page.locator('#teacherReport').textContent(), ''); assert.equal(await page.locator('#teacherList').textContent(), '');
  await page.evaluate(() => { __teacherTest.flags.delayRead = false; }); await read(page);
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  assert.equal(await page.locator('#teacherReport').textContent(), ''); assert.equal(await page.locator('#teacherHistory').textContent(), '');
  await page.evaluate(() => window.dispatchEvent(new Event('pageshow')));
  assert.equal(await page.locator('#teacherWorkspace').isVisible(), false);
}));

test('local grant expiry clears private body and history without polling the server', () => withTeacher(async page => {
  await page.evaluate(() => __teacherTest.grant.expires_at = Math.floor(Date.now() / 1000) + 3);
  await read(page); await page.locator('#teacherRefreshBtn').click(); const calls = await page.evaluate(() => __teacherTest.calls.length);
  await page.waitForFunction(() => document.querySelector('#teacherReport').textContent === '', undefined, { timeout: 4000 });
  assert.equal(await page.locator('#teacherHistory').textContent(), ''); assert.equal(await page.evaluate(() => __teacherTest.calls.length), calls);
}));

test('student roles and changed sessions do not render a teacher report', () => withTeacher(async page => {
  await page.evaluate(() => __teacherTest.flags.student = true); await login(page);
  await page.locator('#teacherRefreshBtn').click(); assert.equal(await page.locator('#teacherReport').textContent(), '');
  await page.locator('#teacherDisconnectBtn').click(); await page.evaluate(() => { __teacherTest.flags.student = false; __teacherTest.flags.denied = true; });
  await login(page); await page.locator('#teacherRefreshBtn').click();
  assert.equal(await page.locator('#teacherList').textContent(), ''); assert.equal(await page.locator('#teacherWorkspace').isVisible(), false);
}));

test('the isolated read-only report fits a 375px viewport', () => withTeacher(async page => {
  await read(page); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
}, { viewport: { width: 375, height: 812 } }));
