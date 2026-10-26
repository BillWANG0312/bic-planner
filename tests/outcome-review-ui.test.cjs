const { test } = require('node:test');
const assert = require('node:assert/strict');
const { withPage } = require('./helpers/browser.cjs');

const pageOptions = extra => ({ ...extra, prepare: context => context.route('**/js/app.js*', route => route.fulfill({ contentType: 'application/javascript', body: '' })) });
const manifest = (source = 'synthetic') => ({ format: 'bic-followup-results', version: 1, subject: 'maths', scale: 'school_percent_0_100',
  examDate: '2020-02-01', bankVersion: '2026.10', source, outcomes: Array.from({ length: 20 }, (_, i) => ({ studyId: 'STUDY-' + i, score: i < 10 ? i === 0 ? 0 : 70 : null })) });
async function setup(page, origin) {
  await page.evaluate(() => {
    document.querySelectorAll('.screen').forEach(el => el.classList.remove('active'));
    document.querySelector('#libraryOutcomes')?.remove(); document.querySelector('#libraryOutcomesBtn')?.remove();
    const screen = document.createElement('section'); screen.className = 'screen active';
    screen.innerHTML = '<div class="wrap"><button id="libraryOutcomesBtn">后续成绩</button><div id="libraryOutcomes"></div></div>';
    document.querySelector('main').append(screen);
    const t = window.__outcomeTest = { reads: 0, parses: [], analyses: [], downloads: [], flags: {},
      records: Array.from({ length: 22 }, (_, i) => ({ id: 'record-' + i, bankVersion: QUESTION_BANK_META.version,
        state: { info: { name: i === 0 ? '<img src=x onerror=alert(1)>私密姓名' : '本机私密' + i }, academic: { eligible: i !== 21 } }, reportMeta: { batchId: 'PRIVATE-' + i } })) };
    t.records[20].bankVersion = 'old-bank';
    window.gradeAcademic = value => ({ subjects: { maths: { complete: value.eligible }, english: { complete: value.eligible } } });
    window.OutcomeReview = { parse(text) { t.parses.push(text); if (t.flags.parseFail) throw new Error('PRIVATE parse failure'); return JSON.parse(text); },
      analyze(records, value, bindings) {
        t.analyses.push({ records: structuredClone(records), value: structuredClone(value), bindings: structuredClone(bindings) });
        if (bindings.some(binding => !binding.baselineDate)) throw new Error('date required');
        const result = { format: 'bic-followup-review', version: 1, bankVersion: QUESTION_BANK_META.version, subject: value.subject,
          scale: value.scale, source: value.source, privacy: { minCell: 10, release: 'local_aggregate_not_anonymity_guarantee' },
          method: { pairing: 'operator_selected', dates: 'operator_declared_order_checked', comparison: 'separate_coarse_means_not_equated' },
          status: t.flags.suppressed ? 'suppressed' : 'available', calibration: { status: 'not_calibrated', thresholdsChanged: false, realSampleValidation: false } };
        if (!t.flags.suppressed) { result.counts = { selectedReports: 20, outcomeRows: 20, usablePairs: 10, missingScorePairs: 10, unpairedReports: 0, unpairedOutcomes: 0 };
          result.means = { baselinePctRounded5: 75, followupPctRounded5: 65 }; }
        return result;
      } };
  });
  await page.addScriptTag({ url: origin + '/js/outcome-review-ui.js' });
  await page.addStyleTag({ url: origin + '/css/outcomes.css' });
  await page.evaluate(() => {
    const t = __outcomeTest;
    t.ui = OutcomeReviewUI.init({ getRecords() { t.reads++; if (t.flags.readFail) throw new Error('PRIVATE storage detail');
      if (t.flags.mutateAt === t.reads) t.records[0].state.info.name = '确认时改动'; return structuredClone(t.records); },
      download(text, kind) { t.downloads.push({ text, kind }); } });
  });
}
async function upload(page, value = manifest(), name = 'results.json') {
  await page.locator('#outcomeFile').setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(value)) });
  await page.locator('[data-outcome-study]').first().waitFor();
}
async function ready(page) {
  await page.locator('#libraryOutcomesBtn').click(); await upload(page);
  for (let i = 0; i < 10; i++) await page.locator(`[data-outcome-record="record-${i}"]`).check();
  await page.locator('#outcomeIndependence').check();
}
async function preview(page) { await ready(page); await page.locator('#outcomePreviewBtn').click(); await page.locator('#outcomePreview').waitFor({ state: 'visible' }); }

test('outcome review is inactive until explicit import and never pairs records by names or IDs', () => withPage(async (page, { origin }) => {
  await setup(page, origin); assert.equal(await page.evaluate(() => __outcomeTest.reads), 0);
  assert.equal(await page.locator('#libraryOutcomes').isVisible(), false);
  await page.locator('#libraryOutcomesBtn').click(); assert.equal(await page.evaluate(() => __outcomeTest.reads), 0);
  await upload(page);
  assert.equal(await page.locator('[data-outcome-record]:checked').count(), 0);
  assert.equal(await page.locator('[data-outcome-record="record-20"]').isDisabled(), true);
  assert.equal(await page.locator('[data-outcome-record="record-21"]').isDisabled(), true);
  assert.deepEqual(await page.locator('[data-outcome-pair]').evaluateAll(elements => elements.map(el => el.value)), Array(20).fill(''));
  assert.match(await page.locator('[data-outcome-study="STUDY-0"]').textContent(), /0/);
  assert.match(await page.locator('[data-outcome-study="STUDY-10"]').textContent(), /缺失/);
  assert.equal(await page.locator('#libraryOutcomes img').count(), 0);
  assert.match(await page.locator('#libraryOutcomes').textContent(), /<img src=x/);
  assert.equal(await page.locator('#outcomePreviewBtn').isDisabled(), true);
  assert.deepEqual(await page.evaluate(() => __outcomeTest.analyses), []);
}, pageOptions()));

test('manual pairing needs an explicit actual date and preserves other pairs when one report is deselected', () => withPage(async (page, { origin }) => {
  await setup(page, origin); await ready(page);
  await page.locator('[data-outcome-pair="STUDY-0"]').selectOption('record-0');
  await page.locator('#outcomePreviewBtn').click();
  assert.equal(await page.locator('#outcomePreview').isVisible(), false);
  await page.locator('[data-outcome-date="STUDY-0"]').fill('2020-01-01');
  await page.locator('[data-outcome-pair="STUDY-1"]').selectOption('record-1');
  await page.locator('[data-outcome-date="STUDY-1"]').fill('2020-01-02');
  await page.locator('[data-outcome-record="record-0"]').uncheck();
  assert.equal(await page.locator('[data-outcome-pair="STUDY-0"]').inputValue(), '');
  assert.equal(await page.locator('[data-outcome-date="STUDY-0"]').inputValue(), '');
  assert.equal(await page.locator('[data-outcome-pair="STUDY-1"]').inputValue(), 'record-1');
  assert.equal(await page.locator('[data-outcome-date="STUDY-1"]').inputValue(), '2020-01-02');
  await page.locator('[data-outcome-record="record-10"]').check(); await page.locator('#outcomePreviewBtn').click();
  await page.locator('#outcomePreview').waitFor({ state: 'visible' });
  assert.deepEqual(await page.evaluate(() => __outcomeTest.analyses.at(-1).bindings), [{ studyId: 'STUDY-1', reportId: 'record-1', baselineDate: '2020-01-02' }]);
}, pageOptions()));

test('only reviewed aggregate is downloaded after confirmation and edits invalidate it without storing private data', () => withPage(async (page, { origin }) => {
  await setup(page, origin); await preview(page);
  const json = await page.locator('#outcomeJson').textContent();
  assert.doesNotMatch(json, /PRIVATE|STUDY|私密|answers|baselineDate|examDate/);
  assert.match(await page.locator('#outcomePreview').textContent(), /75/); assert.match(await page.locator('#outcomePreview').textContent(), /65/);
  page.once('dialog', dialog => { assert.match(dialog.message(), /模拟|虚构/); assert.match(dialog.message(), /未校准|校准/); assert.match(dialog.message(), /匿名|识别/); dialog.dismiss(); });
  await page.locator('#outcomeExportBtn').click(); assert.deepEqual(await page.evaluate(() => __outcomeTest.downloads), []);
  page.once('dialog', dialog => dialog.accept()); await page.locator('#outcomeExportBtn').click();
  assert.deepEqual(await page.evaluate(() => __outcomeTest.downloads), [{ text: json, kind: 'summary' }]);
  await page.locator('#outcomeIndependence').uncheck(); assert.equal(await page.locator('#outcomePreview').isVisible(), false);
  assert.equal(await page.locator('#outcomeExportBtn').isDisabled(), true);
  assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0);
}, pageOptions()));

test('archive changes, read failures and changes during confirmation prevent stale exports', () => withPage(async (page, { origin }) => {
  await setup(page, origin); await preview(page);
  await page.evaluate(() => __outcomeTest.records[0].state.info.name = '新修订');
  await page.locator('#outcomeExportBtn').click(); assert.equal(await page.locator('#outcomePreview').isVisible(), false);
  await page.locator('#libraryOutcomesBtn').click(); await upload(page);
  for (let i = 0; i < 10; i++) await page.locator(`[data-outcome-record="record-${i}"]`).check();
  await page.locator('#outcomeIndependence').check(); await page.locator('#outcomePreviewBtn').click();
  await page.locator('#outcomePreview').waitFor({ state: 'visible' });
  await page.evaluate(() => __outcomeTest.flags.mutateAt = __outcomeTest.reads + 2);
  page.once('dialog', dialog => dialog.accept()); await page.locator('#outcomeExportBtn').click();
  assert.deepEqual(await page.evaluate(() => __outcomeTest.downloads), []);
  assert.equal(await page.locator('#outcomePreview').isVisible(), false);
  await page.evaluate(() => __outcomeTest.flags.readFail = true);
  await page.locator('#outcomePreviewBtn').click(); assert.equal(await page.locator('#outcomePreview').isVisible(), false);
  assert.doesNotMatch(await page.locator('#outcomeStatus').textContent(), /PRIVATE/);
}, pageOptions()));

test('suppressed review shows no counts or means and template contains only one synthetic format row', () => withPage(async (page, { origin }) => {
  await setup(page, origin); await page.locator('#libraryOutcomesBtn').click(); await page.locator('#outcomeTemplateBtn').click();
  const template = await page.evaluate(() => JSON.parse(__outcomeTest.downloads[0].text));
  assert.equal(template.subject, 'maths'); assert.equal(template.source, 'synthetic');
  assert.deepEqual(template.outcomes, [{ studyId: 'SAMPLE-001', score: null }]);
  assert.equal(await page.evaluate(() => __outcomeTest.reads), 0);
  await page.evaluate(() => __outcomeTest.flags.suppressed = true);
  await upload(page); for (let i = 0; i < 10; i++) await page.locator(`[data-outcome-record="record-${i}"]`).check();
  await page.locator('#outcomeIndependence').check(); await page.locator('#outcomePreviewBtn').click();
  await page.locator('#outcomePreview').waitFor({ state: 'visible' });
  assert.match(await page.locator('#outcomePreview').textContent(), /隐藏|压制/);
  assert.doesNotMatch(await page.locator('#outcomePreview').textContent(), /75%|65%|selectedReports|usablePairs/);
}, pageOptions()));

test('a replaced or closed asynchronous file read cannot restore private rows', () => withPage(async (page, { origin }) => {
  await setup(page, origin); await page.locator('#libraryOutcomesBtn').click();
  await page.evaluate(() => { const original = File.prototype.text; File.prototype.text = function () {
    return this.name === 'late.json' ? new Promise(resolve => __outcomeTest.resolve = resolve) : original.call(this); }; });
  await page.locator('#outcomeFile').setInputFiles({ name: 'late.json', mimeType: 'application/json', buffer: Buffer.from('{}') });
  await page.waitForFunction(() => typeof __outcomeTest.resolve === 'function');
  await upload(page, manifest('unverified_real'), 'new.json');
  await page.evaluate(value => __outcomeTest.resolve(JSON.stringify(value)), manifest());
  assert.match(await page.locator('#outcomeSourceSummary').textContent(), /待核验|未独立核验/);
  await page.locator('#outcomeFile').setInputFiles({ name: 'late.json', mimeType: 'application/json', buffer: Buffer.from('{}') });
  await page.evaluate(() => __outcomeTest.ui.clear());
  await page.evaluate(value => __outcomeTest.resolve(JSON.stringify(value)), manifest());
  assert.equal(await page.locator('#libraryOutcomes').textContent(), ''); assert.equal(await page.locator('#libraryOutcomes').isVisible(), false);
}, pageOptions()));

test('new files and invalid file types clear the earlier private selection and never analyze automatically', () => withPage(async (page, { origin }) => {
  await setup(page, origin); await preview(page);
  await page.locator('#outcomeFile').setInputFiles({ name: 'bad.csv', mimeType: 'text/csv', buffer: Buffer.from('study,score') });
  assert.equal(await page.locator('#outcomePreview').isVisible(), false);
  assert.equal(await page.locator('[data-outcome-record]').count(), 0);
  await upload(page, manifest('unverified_real'));
  assert.equal(await page.locator('[data-outcome-record]:checked').count(), 0);
  assert.equal(await page.locator('[data-outcome-pair]').first().inputValue(), '');
  assert.equal(await page.evaluate(() => __outcomeTest.analyses.length), 1);
}, pageOptions()));

test('private mapping and aggregate review fit a 375px viewport and close erases every row', () => withPage(async (page, { origin }) => {
  await setup(page, origin); await preview(page);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.locator('#outcomeCloseBtn').click();
  assert.equal(await page.locator('#libraryOutcomes').textContent(), '');
  assert.equal(await page.locator('#libraryOutcomes').isVisible(), false);
}, pageOptions({ viewport: { width: 375, height: 812 } })));
