const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { withPage } = require('./helpers/browser.cjs');
const { loadReportScripts, state } = require('./helpers/report.cjs');

function cohort() {
  const w = loadReportScripts();
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../js/report-store.js'), 'utf8'), { window: w, Date });
  let raw = null;
  const store = w.ReportStore.create({ getItem: () => raw, setItem: (_, value) => { raw = value; } });
  for (let index = 0; index < 20; index++) {
    const value = state(w, true);
    value.plan.answers.preferredMajor = ['tech'];
    value.info.name = '<b>私密测试' + index + '</b>';
    if (index >= 10) value.academic.answers = Object.fromEntries(w.QUESTION_BANK.map(q => [q.id, q.type === 'choice' ? (q.answer + 1) % q.options.length : q.answer + 10000]));
    value.report = w.generateReport(value);
    value.report.meta.batchId = 'PRIVATE-STAT-' + index;
    store.save(value);
  }
  return raw;
}
function setup(extra = {}) {
  return { ...extra, beforeLoad: page => page.addInitScript(raw => localStorage.setItem('bic.report-library.v1', raw), cohort()) };
}
async function open(page) {
  await page.locator('#libraryBtn').click();
  await page.locator('#libraryStatisticsBtn').click();
}
async function preview(page) {
  await open(page);
  for (const checkbox of await page.locator('[data-statistics-record]').all()) await checkbox.check();
  await page.locator('#statisticsSource').selectOption('synthetic');
  await page.locator('#statisticsIndependence').check();
  await page.locator('#statisticsPreviewBtn').click();
  await page.locator('#statisticsPreview').waitFor({ state: 'visible' });
}

test('selected local archives produce a reviewed aggregate without changing responses or contacting a service', () => withPage(async page => {
  const raw = await page.evaluate(() => localStorage.getItem('bic.report-library.v1'));
  const requests = [], errors = [];
  page.on('request', request => { if (/\/api\//.test(request.url())) requests.push(request.url()); });
  page.on('pageerror', error => errors.push(error.message));
  await preview(page);
  assert.equal(await page.locator('#libraryStatistics b').count(), 0, 'Archive names are plain text');
  const result = JSON.parse(await page.locator('#statisticsJson').textContent());
  assert.equal(result.format, 'bic-academic-aggregate');
  assert.equal(result.sample.count, 20);
  assert.equal(result.sample.source, 'synthetic');
  assert.equal(result.subjects[0].meanPctRounded5, 50);
  assert.equal(result.items[0].correct, 10);
  assert.equal(result.items[0].incorrect, 10);
  assert.equal(result.calibration.status, 'not_calibrated');
  assert.doesNotMatch(JSON.stringify(result), /私密测试|PRIVATE-STAT|answers|author|history|createdAt/);
  page.once('dialog', dialog => dialog.dismiss());
  let downloads = 0;
  page.on('download', () => downloads++);
  await page.locator('#statisticsExportBtn').click();
  assert.equal(downloads, 0);
  const download = page.waitForEvent('download');
  page.once('dialog', dialog => { assert.match(dialog.message(), /20/); assert.match(dialog.message(), /风险|匿名/); dialog.accept(); });
  await page.locator('#statisticsExportBtn').click();
  const saved = await download;
  assert.match(saved.suggestedFilename(), /^bic-academic-aggregate-.*\.json$/);
  assert.deepEqual(JSON.parse(fs.readFileSync(await saved.path(), 'utf8')), result);
  assert.equal(await page.evaluate(() => localStorage.getItem('bic.report-library.v1')), raw);
  assert.equal(await page.evaluate(() => Object.keys(window.__pathwise.state.academic.answers).length), 0);
  assert.deepEqual(requests, []);
  assert.deepEqual(errors, []);
}, setup()));

test('leaving the library or deleting an archive clears the cohort and cannot export an old snapshot', () => withPage(async page => {
  await preview(page);
  await page.locator('#libraryBackBtn').click();
  assert.equal(await page.locator('#libraryStatistics').isVisible(), false);
  assert.equal(await page.locator('#libraryStatistics').textContent(), '');
  await open(page);
  assert.equal(await page.locator('[data-statistics-record]:checked').count(), 0);
  assert.equal(await page.locator('#statisticsSource').inputValue(), '');
  assert.equal(await page.locator('#statisticsExportBtn').isDisabled(), true);
  page.once('dialog', dialog => dialog.accept());
  await page.locator('[data-library-delete]').first().click();
  assert.equal(await page.locator('#libraryStatistics').isVisible(), false);
  assert.equal(await page.locator('#libraryStatistics').textContent(), '');
}, setup()));

test('the real local aggregate preview fits a 375px screen', () => withPage(async page => {
  await preview(page);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  if (process.env.BIC_CAPTURE === '1') {
    await page.screenshot({ path: path.join(__dirname, '../test-results/statistics-mobile.png'), fullPage: true });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.screenshot({ path: path.join(__dirname, '../test-results/statistics-desktop.png'), fullPage: true });
  }
}, setup({ viewport: { width: 375, height: 812 } })));
