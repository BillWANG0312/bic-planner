const { test } = require('node:test');
const assert = require('node:assert/strict');
const { withPage } = require('./helpers/browser.cjs');

function options(extra = {}) {
  return { ...extra, prepare: context => context.route('**/js/app.js*', route => route.fulfill({ contentType: 'application/javascript', body: '' })) };
}
async function setup(page, origin) {
  await page.evaluate(() => {
    document.querySelectorAll('.screen').forEach(el => el.classList.remove('active'));
    document.querySelector('#libraryStatistics')?.remove(); document.querySelector('#libraryStatisticsBtn')?.remove();
    const screen = document.createElement('section'); screen.className = 'screen active';
    screen.innerHTML = '<div class="wrap"><button id="libraryStatisticsBtn">本地统计</button><div id="libraryStatistics"></div></div>';
    document.querySelector('main').append(screen);
    const t = window.__planningUi = { reads: 0, analyses: [], downloads: [], wrongVersion: false,
      records: Array.from({ length: 21 }, (_, i) => ({ id: 'record-' + i, bankVersion: QUESTION_BANK_META.version,
        catalogVersion: i === 20 ? 'old-catalog' : UNIVERSITY_CATALOG.version,
        state: { info: { name: i === 0 ? '<img src=x onerror=alert(1)>私密姓名' : '本地同学' + i } }, reportMeta: { batchId: 'PRIVATE-' + i } })) };
    const table = (basis, selectionMode, extra) => ({ status: 'available', basis, selectionMode, denominator: 'included_reports', ...extra });
    window.ReportStatistics = { analyze(records, context) {
      t.analyses.push({ ids: records.map(r => r.id), context: structuredClone(context) });
      const result = { format: 'bic-academic-aggregate', version: 1, bankVersion: QUESTION_BANK_META.version,
        sample: { count: records.length, source: context.source }, subjects: [], items: [],
        calibration: { status: 'not_calibrated', followupOutcomes: false, thresholdsChanged: false } };
      if (context.planning && !t.wrongVersion) {
        result.version = 2;
        result.planning = { ruleBasis: 'current_local_rules_recomputed', catalogVersion: UNIVERSITY_CATALOG.version,
          recommendedMajors: table('complete_reports_current_rules', 'single', { included: 10, excluded: records.length - 10,
            selectionCount: 10, entries: [{ key: 'cs', count: 10, pctOfIncluded: 100 }] }),
          statedMajorPreferences: table('explicit_major_choices', 'multiple', { included: records.length, excluded: 0,
            selectionCount: records.length + 10, entries: [{ key: 'tech', count: records.length, pctOfIncluded: 100 }, { key: 'unsure', count: 10, pctOfIncluded: 50 }] }),
          regionPreferences: { status: 'suppressed', basis: 'explicit_region_choices', selectionMode: 'multiple', denominator: 'included_reports',
            included: 1, excluded: 19, selectionCount: 1, entries: [{ key: 'uk', count: 1, pctOfIncluded: 100 }] } };
      }
      return result;
    } };
  });
  await page.addScriptTag({ url: origin + '/js/report-statistics-ui.js' });
  await page.addStyleTag({ url: origin + '/css/statistics.css' });
  await page.evaluate(() => {
    const t = __planningUi;
    t.ui = ReportStatisticsUI.init({ getRecords() { t.reads++; return structuredClone(t.records); }, download(text) { t.downloads.push(text); } });
  });
}
async function selected(page) {
  await page.locator('#libraryStatisticsBtn').click();
  for (let i = 0; i < 20; i++) await page.locator(`[data-statistics-record="record-${i}"]`).check();
  await page.locator('#statisticsSource').selectOption('synthetic');
  await page.locator('#statisticsIndependence').check();
}
async function preview(page, planning = true) {
  await selected(page);
  if (planning) await page.locator('#statisticsPlanning').check();
  await page.locator('#statisticsPreviewBtn').click();
  await page.locator('#statisticsPreview').waitFor({ state: 'visible' });
}

test('planning tables are explicit opt-in and mode changes erase the old v1 or v2 preview', () => withPage(async (page, { origin }) => {
  await setup(page, origin); await selected(page);
  assert.equal(await page.locator('#statisticsPlanning').isChecked(), false);
  await page.locator('#statisticsPreviewBtn').click();
  assert.deepEqual(await page.evaluate(() => __planningUi.analyses[0].context), { source: 'synthetic' });
  assert.equal(JSON.parse(await page.locator('#statisticsJson').textContent()).version, 1);
  assert.match(await page.locator('#statisticsSummary').textContent(), /纯学术.*v1/i);
  await page.locator('#statisticsPlanning').check();
  assert.equal(await page.locator('#statisticsPreview').isVisible(), false);
  assert.equal(await page.locator('#statisticsExportBtn').isDisabled(), true);
  await page.locator('#statisticsPreviewBtn').click();
  assert.deepEqual(await page.evaluate(() => __planningUi.analyses[1].context), { source: 'synthetic', planning: true });
  assert.equal(JSON.parse(await page.locator('#statisticsJson').textContent()).version, 2);
  await page.locator('#statisticsPlanning').uncheck();
  assert.equal(await page.locator('#statisticsPreview').isVisible(), false);
  assert.equal(await page.locator('#statisticsPlanningResults').textContent(), '');
  assert.deepEqual(await page.evaluate(() => __planningUi.downloads), []);
}, options()));

test('old catalog archives block only the selected planning mode and are never silently unchecked', () => withPage(async (page, { origin }) => {
  await setup(page, origin); await selected(page);
  await page.locator('[data-statistics-record="record-20"]').check();
  assert.equal(await page.locator('#statisticsPreviewBtn').isDisabled(), false);
  await page.locator('#statisticsPlanning').check();
  assert.equal(await page.locator('#statisticsPreviewBtn').isDisabled(), true);
  assert.equal(await page.locator('[data-statistics-record="record-20"]').isChecked(), true);
  assert.match(await page.locator('#statisticsStatus').textContent(), /目录|旧版/);
  await page.locator('#statisticsPlanning').uncheck();
  assert.equal(await page.locator('#statisticsPreviewBtn').isDisabled(), false);
  assert.equal(await page.locator('[data-statistics-record="record-20"]').isChecked(), true);
  await page.locator('#statisticsPlanning').check();
  await page.locator('[data-statistics-record="record-20"]').uncheck();
  assert.equal(await page.locator('#statisticsPreviewBtn').isDisabled(), false);
  await page.locator('#statisticsPreviewBtn').click();
  assert.equal(JSON.parse(await page.locator('#statisticsJson').textContent()).version, 2);
}, options()));

test('three independent tables explain recommendation, explicit multi-select denominators and whole-table suppression', () => withPage(async (page, { origin }) => {
  await setup(page, origin); await preview(page);
  const rule = page.locator('[data-planning-table="recommendedMajors"]');
  assert.match(await rule.textContent(), /完整报告|测评完整/);
  assert.match(await rule.textContent(), /当前.*规则/);
  assert.match(await rule.textContent(), /计算机科学/);
  assert.match(await rule.textContent(), /排除.*10|未完成.*10/);
  const explicit = page.locator('[data-planning-table="statedMajorPreferences"]');
  assert.match(await explicit.textContent(), /明确|自选/);
  assert.match(await explicit.textContent(), /计算机与人工智能/);
  assert.match(await explicit.textContent(), /还不确定/);
  assert.match(await explicit.textContent(), /分母.*20/);
  assert.match(await explicit.textContent(), /多选/);
  assert.match(await explicit.textContent(), /100%/);
  assert.match(await explicit.textContent(), /选择次数.*30|选择合计.*30/);
  const suppressed = await page.locator('[data-planning-table="regionPreferences"]').textContent();
  assert.match(suppressed, /整表|全部/);
  assert.doesNotMatch(suppressed, /英国|100|19|1\s*份/);
  assert.equal(await page.locator('#libraryStatistics img').count(), 0);
}, options()));

test('export confirmation names v2 scope and keeps the exact reviewed JSON; cancellation does not download', () => withPage(async (page, { origin }) => {
  await setup(page, origin); await preview(page);
  const json = await page.locator('#statisticsJson').textContent();
  page.once('dialog', dialog => { assert.match(dialog.message(), /v2/i); assert.match(dialog.message(), /专业.*地区/); dialog.dismiss(); });
  await page.locator('#statisticsExportBtn').click();
  assert.deepEqual(await page.evaluate(() => __planningUi.downloads), []);
  page.once('dialog', dialog => dialog.accept()); await page.locator('#statisticsExportBtn').click();
  assert.deepEqual(await page.evaluate(() => __planningUi.downloads), [json]);
  await page.locator('#statisticsCloseBtn').click(); await page.locator('#libraryStatisticsBtn').click();
  assert.equal(await page.locator('#statisticsPlanning').isChecked(), false);
}, options()));

test('silent range changes before or during confirmation cannot export a stale scope', () => withPage(async (page, { origin }) => {
  await setup(page, origin); await preview(page);
  await page.evaluate(() => { document.querySelector('#statisticsPlanning').checked = false; });
  await page.locator('#statisticsExportBtn').click();
  assert.deepEqual(await page.evaluate(() => __planningUi.downloads), []);
  assert.equal(await page.locator('#statisticsPreview').isVisible(), false);
  await page.locator('#statisticsCloseBtn').click(); await preview(page);
  await page.evaluate(() => { window.confirm = () => { document.querySelector('#statisticsPlanning').checked = false; return true; }; });
  await page.locator('#statisticsExportBtn').click();
  assert.deepEqual(await page.evaluate(() => __planningUi.downloads), []);
  assert.equal(await page.locator('#statisticsPreview').isVisible(), false);
}, options()));

test('a legacy engine response cannot silently satisfy the requested v2 review', () => withPage(async (page, { origin }) => {
  await setup(page, origin); await selected(page); await page.locator('#statisticsPlanning').check();
  await page.evaluate(() => { __planningUi.wrongVersion = true; });
  await page.locator('#statisticsPreviewBtn').click();
  assert.equal(await page.locator('#statisticsPreview').isVisible(), false);
  assert.equal(await page.locator('#statisticsExportBtn').isDisabled(), true);
  assert.deepEqual(await page.evaluate(() => __planningUi.downloads), []);
}, options()));

test('planning review stays within 375px without storage or network side effects', () => withPage(async (page, { origin }) => {
  await setup(page, origin);
  const before = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
  const requests = []; page.on('request', request => requests.push(request.url()));
  await preview(page);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.equal(await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } })), before);
  assert.deepEqual(requests, []);
}, options({ viewport: { width: 375, height: 812 } })));
