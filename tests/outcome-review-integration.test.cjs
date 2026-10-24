const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { withPage } = require('./helpers/browser.cjs');
const { loadReportScripts, state } = require('./helpers/report.cjs');

function localDay(offset = 0) {
  const date = new Date(); date.setDate(date.getDate() + offset);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function fixture(count = 20, missing = false) {
  const w = loadReportScripts();
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../js/report-store.js'), 'utf8'), { window: w, Date });
  let raw = null;
  const store = w.ReportStore.create({ getItem: () => raw, setItem: (_, value) => { raw = value; } });
  for (let i = 0; i < count; i++) {
    const value = state(w, false); value.info.name = '本机<img src=x>' + i;
    value.academic.answers = Object.fromEntries(w.QUESTION_BANK.map(q => [q.id, i < (missing ? 10 : count / 2) ? q.answer : q.type === 'choice' ? (q.answer + 1) % q.options.length : q.answer + 10000]));
    value.report = w.generateReport(value); value.report.meta.batchId = 'PRIVATE-BASELINE-' + i;
    w.reportEditing.applyEdit(value.report, 'summary', '不得导出的顾问文字', '私密核对人'); store.save(value);
  }
  const manifest = { format: 'bic-followup-results', version: 1, subject: 'maths', scale: 'school_percent_0_100',
    examDate: localDay(), bankVersion: w.QUESTION_BANK_META.version, source: 'synthetic',
    outcomes: Array.from({ length: count }, (_, i) => ({ studyId: 'PRIVATE-STUDY-' + i,
      score: missing ? i < 10 ? 0 : i < 20 ? null : 70 : i < count / 2 ? 0 : 100 })) };
  return { raw, manifest };
}
function setup(count = 20, missing = false, extra = {}) {
  const f = fixture(count, missing);
  return { ...extra, beforeLoad: page => page.addInitScript(raw => localStorage.setItem('bic.report-library.v1', raw), f.raw) };
}
async function open(page) { if (!(await page.locator('#screen-library.active').count())) await page.locator('#libraryBtn').click(); await page.locator('#libraryOutcomesBtn').click(); }
async function importFile(page, manifest) {
  await page.locator('#outcomeFile').setInputFiles({ name: 'local-results.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(manifest)) });
  await page.locator('[data-outcome-record]').first().waitFor();
}
async function chooseAndPair(page, manifest, pairCount = manifest.outcomes.length) {
  await open(page); await importFile(page, manifest);
  const inputs = await page.locator('[data-outcome-record]').all(); const ids = [];
  for (const input of inputs) { ids.push(await input.getAttribute('data-outcome-record')); await input.check(); }
  assert.equal(await page.locator('[data-outcome-pair]').evaluateAll(elements => elements.every(element => element.value === '')), true);
  for (let i = 0; i < pairCount; i++) {
    const key = manifest.outcomes[i].studyId;
    await page.locator(`[data-outcome-pair="${key}"]`).selectOption(ids[i]);
    await page.locator(`[data-outcome-date="${key}"]`).fill(localDay(-1));
  }
  await page.locator('#outcomeIndependence').check();
  await page.locator('#outcomePreviewBtn').click(); await page.locator('#outcomePreview').waitFor({ state: 'visible' });
  return JSON.parse(await page.locator('#outcomeJson').textContent());
}

test('real local import/manual pairs export only reviewed aggregates while leaving archives and current answers unchanged', () => withPage(async page => {
  const { manifest } = fixture(); const raw = await page.evaluate(() => localStorage.getItem('bic.report-library.v1'));
  const requests = [], errors = []; page.on('request', request => { if (/\/api\//.test(request.url())) requests.push(request.url()); });
  page.on('pageerror', error => errors.push(error.message));
  const result = await chooseAndPair(page, manifest);
  assert.equal(result.format, 'bic-followup-review'); assert.equal(result.status, 'available');
  assert.deepEqual(result.counts, { selectedReports: 20, outcomeRows: 20, usablePairs: 20, missingScorePairs: 0, unpairedReports: 0, unpairedOutcomes: 0 });
  assert.deepEqual(result.means, { baselinePctRounded5: 50, followupPctRounded5: 50 });
  assert.equal(result.calibration.status, 'not_calibrated'); assert.equal(result.calibration.realSampleValidation, false);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|本机|顾问|核对人|studyId|reportId|baselineDate|examDate|answers|history/);
  assert.equal(await page.locator('#libraryOutcomes img').count(), 0);
  let downloads = 0; page.on('download', () => downloads++);
  page.once('dialog', dialog => dialog.dismiss()); await page.locator('#outcomeExportBtn').click(); assert.equal(downloads, 0);
  const downloaded = page.waitForEvent('download');
  page.once('dialog', dialog => { assert.match(dialog.message(), /校准|匿名/); dialog.accept(); });
  await page.locator('#outcomeExportBtn').click(); const file = await downloaded;
  assert.match(file.suggestedFilename(), /^bic-followup-review-.*\.json$/);
  assert.deepEqual(JSON.parse(fs.readFileSync(await file.path(), 'utf8')), result);
  assert.equal(await page.evaluate(() => localStorage.getItem('bic.report-library.v1')), raw);
  assert.equal(await page.evaluate(() => Object.keys(__pathwise.state.academic.answers).length), 0);
  assert.deepEqual(requests, []); assert.deepEqual(errors, []);
}, setup()));

test('zero, null and unpaired results retain both missingness decompositions instead of treating missing scores as zero', () => withPage(async page => {
  const { manifest } = fixture(30, true);
  const result = await chooseAndPair(page, manifest, 20);
  assert.deepEqual(result.counts, { selectedReports: 30, outcomeRows: 30, usablePairs: 10, missingScorePairs: 10, unpairedReports: 10, unpairedOutcomes: 10 });
  assert.deepEqual(result.means, { baselinePctRounded5: 100, followupPctRounded5: 0 });
  assert.equal(result.calibration.thresholdsChanged, false);
}, setup(30, true)));

test('an archive change blocks stale summary export and leaving the host clears the private import and pairs', () => withPage(async page => {
  await chooseAndPair(page, fixture().manifest);
  await page.evaluate(() => { const value = JSON.parse(localStorage.getItem('bic.report-library.v1')); value.records[0].state.info.name = '另一标签更新'; localStorage.setItem('bic.report-library.v1', JSON.stringify(value)); });
  let downloads = 0; page.on('download', () => downloads++);
  await page.locator('#outcomeExportBtn').click();
  assert.equal(downloads, 0); assert.equal(await page.locator('#outcomePreview').isVisible(), false);
  assert.match(await page.locator('#outcomeStatus').textContent(), /变化|重新|未导出/);
  await page.locator('#libraryBackBtn').click();
  assert.equal(await page.locator('#libraryOutcomes').textContent(), '');
  assert.equal(await page.locator('#libraryOutcomes').isVisible(), false);
}, setup()));

test('the format template contains no archive data and the real pairing review fits a 375px viewport', () => withPage(async page => {
  await open(page);
  const downloaded = page.waitForEvent('download'); await page.locator('#outcomeTemplateBtn').click();
  const file = await downloaded; assert.match(file.suggestedFilename(), /^bic-followup-results-template-.*\.json$/);
  const template = JSON.parse(fs.readFileSync(await file.path(), 'utf8'));
  assert.equal(template.format, 'bic-followup-results'); assert.equal(template.source, 'synthetic');
  assert.deepEqual(template.outcomes, [{ studyId: 'SAMPLE-001', score: null }]);
  assert.deepEqual(await page.evaluate(value => OutcomeReview.parse(JSON.stringify(value)), template), template);
  assert.doesNotMatch(JSON.stringify(template), /PRIVATE|本机|reportId|answers/);
  await page.locator('#outcomeCloseBtn').click();
  const result = await chooseAndPair(page, fixture(10).manifest);
  assert.equal(result.counts.usablePairs, 10);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
}, setup(10, false, { viewport: { width: 375, height: 812 } })));
