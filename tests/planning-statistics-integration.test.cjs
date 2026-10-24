const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { withPage } = require('./helpers/browser.cjs');
const { loadReportScripts, state } = require('./helpers/report.cjs');

function cohort(options = {}) {
  const w = loadReportScripts();
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../js/report-store.js'), 'utf8'), { window: w, Date });
  let raw = null;
  const store = w.ReportStore.create({ getItem: () => raw, setItem: (_, value) => { raw = value; } });
  for (let i = 0; i < 20; i++) {
    const value = state(w, true);
    value.info.name = '<b>仅本机' + i + '</b>';
    value.plan.answers = { grade: '8', interests: ['math'], schoolSubjects: ['数学', '私密自由学科'], weakSubjects: [],
      clubs: ['coding'], groupSize: 'small', timeStyle: 'deep', selfImage: ['rational'],
      preferredMajor: i < 10 ? ['tech', 'unsure'] : ['humanities'], freeTime: ['make'], career: ['unsure'],
      countries: i < 10 ? ['us', 'unsure'] : ['ca'], subjectPerf: '1', preferredLength: 'flex' };
    if (options.missingLast && i >= 10) { value.mbti.answers = []; value.plan.answers.countries = []; }
    value.report = w.generateReport(value);
    value.report.meta.batchId = 'PRIVATE-PLANNING-' + i;
    w.reportEditing.applyEdit(value.report, 'summary', '私密顾问文字', '私密审核人');
    store.save(value);
  }
  const backup = JSON.parse(raw);
  if (options.oldCatalog) backup.records[0].catalogVersion = 'old-catalog';
  return JSON.stringify(backup);
}
function setup(options = {}) {
  return { viewport: options.viewport, beforeLoad: page => page.addInitScript(raw => localStorage.setItem('bic.report-library.v1', raw), cohort(options)) };
}
async function select(page) {
  await page.locator('#libraryBtn').click(); await page.locator('#libraryStatisticsBtn').click();
  for (const input of await page.locator('[data-statistics-record]').all()) await input.check();
  await page.locator('#statisticsSource').selectOption('synthetic'); await page.locator('#statisticsIndependence').check();
}
async function generate(page) {
  await page.locator('#statisticsPreviewBtn').click(); await page.locator('#statisticsPreview').waitFor({ state: 'visible' });
  return JSON.parse(await page.locator('#statisticsJson').textContent());
}

test('planning is explicit v2 while the same cohort academic v1 remains unchanged and exports exactly the reviewed aggregate', () => withPage(async page => {
  const raw = await page.evaluate(() => localStorage.getItem('bic.report-library.v1'));
  const requests = [], errors = [];
  page.on('request', request => { if (/\/api\//.test(request.url())) requests.push(request.url()); });
  page.on('pageerror', error => errors.push(error.message));
  await select(page);
  assert.equal(await page.locator('#statisticsPlanning').isChecked(), false);
  const academic = await generate(page);
  assert.equal(academic.version, 1); assert.equal(Object.hasOwn(academic, 'planning'), false);
  await page.locator('#statisticsPlanning').check();
  assert.equal(await page.locator('#statisticsPreview').isVisible(), false);
  const extended = await generate(page);
  const { planning, ...remaining } = extended;
  assert.deepEqual({ ...remaining, version: 1 }, academic);
  assert.equal(extended.version, 2);
  assert.equal(planning.ruleBasis, 'current_local_rules_recomputed');
  assert.equal(planning.recommendedMajors.included, 20);
  assert.equal(planning.statedMajorPreferences.selectionCount, 30);
  assert.equal(planning.statedMajorPreferences.entries.find(row => row.key === 'tech').pctOfIncluded, 50);
  assert.equal(planning.regionPreferences.entries.find(row => row.key === 'uk').count, 0, 'Explicit choices must not use recommended countries');
  assert.equal(planning.regionPreferences.entries.find(row => row.key === 'us').count, 10);
  assert.equal(planning.regionPreferences.entries.reduce((sum, row) => sum + row.pctOfIncluded, 0), 150);
  assert.doesNotMatch(JSON.stringify(extended), /仅本机|PRIVATE-PLANNING|私密|answers|advisor|history/);
  assert.equal(await page.locator('#statisticsPlanningResults b').count(), 0);
  page.once('dialog', dialog => dialog.dismiss());
  let downloads = 0; page.on('download', () => downloads++);
  await page.locator('#statisticsExportBtn').click(); assert.equal(downloads, 0);
  const downloaded = page.waitForEvent('download');
  page.once('dialog', dialog => { assert.match(dialog.message(), /v2|V2|版本.?2/); dialog.accept(); });
  await page.locator('#statisticsExportBtn').click();
  const file = await downloaded;
  assert.deepEqual(JSON.parse(fs.readFileSync(await file.path(), 'utf8')), extended);
  assert.equal(await page.evaluate(() => localStorage.getItem('bic.report-library.v1')), raw);
  assert.deepEqual(requests, []); assert.deepEqual(errors, []);
}, setup()));

test('turning planning off destroys the previous expanded preview and restores academic-only v1', () => withPage(async page => {
  await select(page); await page.locator('#statisticsPlanning').check(); await generate(page);
  await page.locator('#statisticsPlanning').uncheck();
  assert.equal(await page.locator('#statisticsPreview').isVisible(), false);
  assert.equal(await page.locator('#statisticsExportBtn').isDisabled(), true);
  assert.equal(await page.locator('#statisticsPlanningResults').textContent(), '');
  const next = await generate(page); assert.equal(next.version, 1); assert.equal(Object.hasOwn(next, 'planning'), false);
}, setup()));

test('old catalogs remain usable for academic v1 but are never silently removed to produce planning v2', () => withPage(async page => {
  await select(page); assert.equal((await generate(page)).version, 1);
  await page.locator('#statisticsPlanning').check();
  assert.equal(await page.locator('[data-statistics-record]:checked').count(), 20);
  assert.equal(await page.locator('#statisticsPreviewBtn').isDisabled(), true);
  assert.match(await page.locator('#statisticsStatus').textContent(), /目录|版本/);
  await page.locator('[data-statistics-record]').first().uncheck();
  const aggregate = await generate(page);
  assert.equal(aggregate.sample.count, 19);
  for (const value of Object.values(aggregate.planning).filter(value => value && typeof value === 'object')) {
    assert.equal(value.status, 'suppressed');
    assert.deepEqual(Object.keys(value).sort(), ['basis', 'denominator', 'selectionMode', 'status']);
  }
}, setup({ oldCatalog: true })));

test('incomplete reports are excluded from recommendation while their explicit major choices and missing regions remain distinct', () => withPage(async page => {
  await select(page); await page.locator('#statisticsPlanning').check();
  const aggregate = await generate(page);
  assert.equal(aggregate.planning.recommendedMajors.included, 10);
  assert.equal(aggregate.planning.recommendedMajors.excluded, 10);
  assert.equal(aggregate.planning.statedMajorPreferences.included, 20);
  assert.equal(aggregate.planning.regionPreferences.included, 10);
  assert.equal(aggregate.planning.regionPreferences.excluded, 10);
  assert.equal(aggregate.planning.regionPreferences.selectionCount, 20);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
}, setup({ missingLast: true, viewport: { width: 375, height: 812 } })));
