const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { withPage } = require('./helpers/browser.cjs');

const scoring = { bank_version: '2026.10', rule_version: 'academic-pct-v1', rule_fingerprint: 'a'.repeat(64),
  basis: 'current_local_rules_recomputed', incomplete_policy: 'not_scored', calibration: 'not_calibrated' };
const preferenceSchema = {
  metadata: { bank_version: '2026.10', schema_version: 'planning-preferences-v1', schema_fingerprint: 'b'.repeat(64), basis: 'explicit_student_choices' },
  questions: [
    { key: 'preferredMajor', max: 2, options: [['science', '自然科学'], ['math', '数学'], ['eng', '工程'], ['tech', '计算机与人工智能'], ['business', '商科与管理'], ['econ', '经济与金融'], ['med', '医学与健康'], ['social', '社会科学'], ['humanities', '人文与法律'], ['art', '艺术与设计'], ['media', '传媒'], ['unsure', '还不确定']].map(([id, label]) => ({ id, label })) },
    { key: 'countries', max: 3, options: [['uk', '英国'], ['us', '美国'], ['ca', '加拿大'], ['au', '澳大利亚'], ['hk', '中国香港'], ['sg', '新加坡'], ['eu', '欧洲大陆'], ['unsure', '还没想好']].map(([id, label]) => ({ id, label })) }
  ]
};
function fixture() {
  const at = Math.floor(Date.now() / 1000);
  return { calls: [], flags: {}, reads: 0, scoring, preferenceSchema, items: [{
    grant: { id: 'grant-one', report_id: 'report-one', report_revision: 2, report_name: '<b>偏好学员</b>', report_ref: 'PREFERENCE-ONE',
      owner_username: 'owner.test', recipient_username: 'teacher.test', scope: 'full_report_read_only', created_at: at, expires_at: at + 86400, revoked_at: null, status: 'active' },
    report: { id: 'report-one', revision: 2, report_ref: 'PREFERENCE-ONE', name: '<b>偏好学员</b>', grade: '8', bank_version: '2026.10', catalog_version: null, status: 'draft',
      academic: ['english', 'maths', 'physics', 'chemistry'].map((key, i) => ({ key, answered: i === 1 ? 14 : 15, total: 15 })),
      planning: { answered: 2, total: 12, required_answered: 2, required_total: 12 }, personality: { answered: 0, total: 30 } }
  }] };
}
const fakeClient = `window.CloudReports={create(){
const t=window.__preferencesUITest,copy=v=>JSON.parse(JSON.stringify(v));let user=null,connected=false;
return {get user(){return user&&copy(user)},get connected(){return connected},
async connect(){t.calls.push(['connect']);connected=true},async login(username){t.calls.push(['login',username]);user={id:'teacher-id',username,role:'advisor'}},
async listTeacherReports(){t.calls.push(['list']);return {items:copy(t.items.map(x=>x.grant))}},
async readTeacherSummaries(ids,options={}){const academic=options.academic===true,preferences=options.preferences===true;t.calls.push(['summary',copy(ids),copy(options)]);const n=++t.reads;
if(t.flags.delay)await new Promise(resolve=>t.resolveRead=resolve);
if(t.flags.denied){user=null;throw {status:403}};
const version=t.flags.forceVersion||(preferences?3:academic?2:1),items=copy(ids.map(id=>t.items.find(x=>x.grant.id===id)));
const payload={format:'bic-teacher-completion-summary',version,items};
if(academic){payload.scoring=copy(t.scoring);for(const item of items)item.report.performance=[{key:'english',complete:true,pct:0},{key:'maths',complete:false,pct:null},{key:'physics',complete:true,pct:47},{key:'chemistry',complete:true,pct:100}]}
if(preferences){payload.options={academic,preferences:true};payload.preference_schema=copy(t.preferenceSchema.metadata);
if(t.flags.badFingerprint)payload.preference_schema.schema_fingerprint='c'.repeat(64);
if(t.flags.badOptions)payload.options.academic=!academic;
for(const item of items)item.report.preferences=t.flags.missing?{preferredMajor:{answered:false,choices:[]},countries:{answered:false,choices:[]}}:{preferredMajor:{answered:true,choices:['tech','unsure']},countries:{answered:true,choices:['hk','unsure']}}}
if(t.flags.modeAt===n)document.querySelector(t.flags.modeSelector||'#summaryPreferences').checked=false;
return payload},async logout(){user=null;connected=false},disconnect(){user=null;connected=false;t.calls.push(['disconnect'])}}}};`;
function withSummary(fn, extra = {}) {
  return withPage(fn, { path: '/teacher-summary.html', ...extra,
    beforeLoad: async page => {
      await page.addInitScript(data => { window.__preferencesUITest = data; for (const key of ['localStorage', 'sessionStorage']) Object.defineProperty(window, key, { get() { throw new Error('No browser storage'); } }); }, fixture());
      if (extra.beforeLoad) await extra.beforeLoad(page);
    },
    prepare: async context => {
      await context.route('**/js/cloud-client.js*', route => route.fulfill({ contentType: 'application/javascript', body: fakeClient }));
      await context.route('**/js/academic-scoring-meta.js*', route => route.fulfill({ contentType: 'application/javascript', body: 'window.BIC_ACADEMIC_SCORING_META=' + JSON.stringify(scoring) + ';' }));
      await context.route('**/js/preference-schema.js*', route => route.fulfill({ contentType: 'application/javascript', body: 'window.BIC_PREFERENCE_SCHEMA=' + JSON.stringify(preferenceSchema) + ';' }));
    }
  });
}
async function choose(page) {
  await page.locator('#summaryConnectBtn').click(); await page.locator('#summaryUsername').fill('teacher.test'); await page.locator('#summaryPassword').fill('preferences-ui-test-password');
  await page.locator('#summaryLoginForm button[type=submit]').click(); await page.locator('#summaryWorkspace').waitFor({ state: 'visible' });
  await page.locator('#summaryRefreshBtn').click(); await page.locator('[data-summary-grant="grant-one"]').check();
}
async function preview(page, academic = false, preferences = true) {
  await choose(page); if (academic) await page.locator('#summaryAcademic').check(); if (preferences) await page.locator('#summaryPreferences').check();
  await page.locator('#summaryPreviewBtn').click(); await page.locator('#summaryPreview').waitFor({ state: 'visible' });
}

test('preferences are opt-in, independent, and load only the safe dictionary before the pure module', () => withSummary(async page => {
  assert.equal(await page.locator('#summaryPreferences').isChecked(), false); assert.equal(await page.locator('#summaryAcademic').isChecked(), false);
  assert.deepEqual(await page.evaluate(() => __preferencesUITest.calls), []);
  const scripts = await page.locator('script[src]').evaluateAll(nodes => nodes.map(node => node.getAttribute('src')));
  const pos = name => scripts.findIndex(src => src.split('?')[0] === name);
  assert.ok(pos('js/preference-schema.js') >= 0 && pos('js/preference-schema.js') < pos('js/teacher-summary.js'));
  assert.equal(scripts.some(src => /(?:bank|majors|plan|report|store)\.js$/.test(src)), false);
}));

for (const [academic, preferences, version, count, filename] of [
  [false, false, 1, 21, 'bic-teacher-completion-v1.csv'], [true, false, 2, 29, 'bic-teacher-academic-v2.csv'],
  [false, true, 3, 27, 'bic-teacher-preferences-v3.csv'], [true, true, 3, 35, 'bic-teacher-academic-preferences-v3.csv']
]) test(`mode academic=${academic}, preferences=${preferences} preserves its exact request, ${count} columns and CSV filename`, () => withSummary(async page => {
  await preview(page, academic, preferences); assert.equal(await page.locator('#summaryTable thead th').count(), count);
  const expectedOptions = { ...(academic ? { academic: true } : {}), ...(preferences ? { preferences: true } : {}) };
  const expected = await page.evaluate(({ academic, preferences, version }) => {
    const t = __preferencesUITest, items = structuredClone(t.items), payload = { format: 'bic-teacher-completion-summary', version, items };
    if (academic) { payload.scoring = t.scoring; items[0].report.performance = [{ key: 'english', complete: true, pct: 0 }, { key: 'maths', complete: false, pct: null }, { key: 'physics', complete: true, pct: 47 }, { key: 'chemistry', complete: true, pct: 100 }]; }
    if (preferences) { payload.options = { academic, preferences: true }; payload.preference_schema = t.preferenceSchema.metadata; items[0].report.preferences = { preferredMajor: { answered: true, choices: ['tech', 'unsure'] }, countries: { answered: true, choices: ['hk', 'unsure'] } }; }
    return TeacherSummary.build(payload, 'teacher.test').csv;
  }, { academic, preferences, version });
  const downloading = page.waitForEvent('download'); page.once('dialog', dialog => dialog.accept()); await page.locator('#summaryExportBtn').click(); const file = await downloading;
  assert.equal(file.suggestedFilename(), filename); assert.equal(fs.readFileSync(await file.path(), 'utf8'), expected);
  assert.deepEqual(await page.evaluate(() => __preferencesUITest.calls.filter(call => call[0] === 'summary')), Array.from({ length: 3 }, () => ['summary', ['grant-one'], expectedOptions]));
  assert.equal(await page.locator('#summaryScoring').isHidden(), !academic); assert.equal(await page.locator('#summaryPreferencesMeta').isHidden(), !preferences);
}));

test('partial planning displays explicit unsure alongside choices, while missing answers stay missing', () => withSummary(async page => {
  await preview(page); let cells = await page.locator('#summaryTable tbody td').allTextContents();
  assert.deepEqual(cells.slice(21, 25), ['已回答', '计算机与人工智能；还不确定', '已回答', '中国香港；还没想好']);
  assert.match(await page.locator('#summaryPreviewHeading').textContent(), /学生自选|明确偏好/);
  assert.match(await page.locator('#summaryPreferencesMeta').textContent(), /非推荐|不是.*推荐/); assert.equal(await page.locator('#summaryTable b').count(), 0);
  await page.evaluate(() => __preferencesUITest.flags.missing = true); await page.locator('#summaryPreviewBtn').click(); await page.locator('#summaryPreview').waitFor({ state: 'visible' });
  cells = await page.locator('#summaryTable tbody td').allTextContents(); assert.deepEqual(cells.slice(21, 25), ['未回答', '未回答', '未回答', '未回答']);
}));

test('either option change clears the previous rows and metadata before a new preview', () => withSummary(async page => {
  await preview(page); await page.locator('#summaryAcademic').check(); assert.equal(await page.locator('#summaryPreview').isHidden(), true);
  assert.equal(await page.locator('#summaryTable').textContent(), ''); assert.equal(await page.locator('#summaryPreferencesMeta').textContent(), '');
  await page.locator('#summaryPreviewBtn').click(); await page.locator('#summaryPreview').waitFor({ state: 'visible' }); assert.equal(await page.locator('#summaryTable thead th').count(), 35);
  await page.locator('#summaryPreferences').uncheck(); assert.equal(await page.locator('#summaryExportBtn').isDisabled(), true);
  await page.locator('#summaryPreviewBtn').click(); await page.locator('#summaryPreview').waitFor({ state: 'visible' }); assert.equal(await page.locator('#summaryTable thead th').count(), 29);
  assert.equal(await page.locator('#summaryPreferencesMeta').textContent(), '');
}));

test('a late read cannot revive preference rows after a mode is changed away and back', () => withSummary(async page => {
  await choose(page); await page.locator('#summaryPreferences').check(); await page.evaluate(() => __preferencesUITest.flags.delay = true);
  await page.locator('#summaryPreviewBtn').click(); await page.waitForFunction(() => typeof __preferencesUITest.resolveRead === 'function');
  await page.evaluate(() => { const input = document.querySelector('#summaryPreferences'); for (const checked of [false, true]) { input.checked = checked; input.dispatchEvent(new Event('change')); } __preferencesUITest.resolveRead(); });
  await page.locator('#summaryPreviewBtn:enabled').waitFor(); assert.equal(await page.locator('#summaryPreview').isHidden(), true); assert.equal(await page.locator('#summaryPreferencesMeta').textContent(), '');
}));

test('a changed dictionary fingerprint or response options rejects the earlier CSV without a download', () => withSummary(async page => {
  await preview(page); let downloads = 0; page.on('download', () => downloads++); await page.evaluate(() => __preferencesUITest.flags.badFingerprint = true);
  await page.locator('#summaryExportBtn').click(); await page.locator('#summaryExportBtn:disabled').waitFor(); assert.equal(downloads, 0); assert.equal(await page.locator('#summaryPreferencesMeta').textContent(), '');
  await page.evaluate(() => { __preferencesUITest.flags.badFingerprint = false; __preferencesUITest.flags.badOptions = true; });
  await page.locator('#summaryPreviewBtn').click(); await page.locator('#summaryPreviewBtn:enabled').waitFor(); assert.equal(await page.locator('#summaryPreview').isHidden(), true);
}));

for (const accepted of [true, false]) test(`programmatic preference change in confirmation clears stale data even when accepted=${accepted}`, () => withSummary(async page => {
  await preview(page); let downloads = 0; page.on('download', () => downloads++);
  await page.evaluate(accepted => { window.confirm = () => { document.querySelector('#summaryPreferences').checked = false; return accepted; }; }, accepted);
  await page.locator('#summaryExportBtn').click(); await page.locator('#summaryPreview').waitFor({ state: 'hidden' });
  assert.equal(downloads, 0); assert.equal(await page.evaluate(() => __preferencesUITest.reads), 2); assert.equal(await page.locator('#summaryPreferencesMeta').textContent(), '');
}));

for (const selector of ['#summaryPreferences', '#summaryAcademic']) test(`the final pending response cannot download after programmatically changing ${selector}`, () => withSummary(async page => {
  await preview(page, true); let downloads = 0; page.on('download', () => downloads++);
  await page.evaluate(selector => { __preferencesUITest.flags.modeAt = 3; __preferencesUITest.flags.modeSelector = selector; }, selector);
  page.once('dialog', dialog => dialog.accept()); await page.locator('#summaryExportBtn').click(); await page.locator('#summaryPreview').waitFor({ state: 'hidden' });
  assert.equal(downloads, 0); assert.equal(await page.evaluate(() => __preferencesUITest.reads), 3);
}));

test('cancelling an unchanged preference export keeps a current preview without creating a file', () => withSummary(async page => {
  await preview(page); let downloads = 0; page.on('download', () => downloads++); page.once('dialog', dialog => dialog.dismiss());
  await page.locator('#summaryExportBtn').click(); await page.locator('#summaryExportBtn:enabled').waitFor();
  assert.equal(downloads, 0); assert.equal(await page.evaluate(() => __preferencesUITest.reads), 2); assert.equal(await page.locator('#summaryPreview').isVisible(), true);
}));

test('375px combined preview wraps provenance, scrolls internally and clears private choices on disconnect', () => withSummary(async page => {
  await preview(page, true); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  const size = await page.locator('.summary-table-scroll').evaluate(element => ({ width: element.clientWidth, scroll: element.scrollWidth })); assert.ok(size.scroll > size.width);
  assert.match(await page.locator('#summaryPreferencesMeta').textContent(), new RegExp(preferenceSchema.metadata.schema_fingerprint));
  await page.locator('#summaryDisconnectBtn').click(); assert.equal(await page.locator('#summaryPreferencesMeta').textContent(), '');
  assert.equal(await page.locator('#summaryTable').textContent(), ''); assert.equal(await page.locator('#summaryPreferences').isChecked(), false); assert.equal(await page.locator('#summaryAcademic').isChecked(), false);
}, { viewport: { width: 375, height: 812 } }));
