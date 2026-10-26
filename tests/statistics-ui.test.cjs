const { test } = require('node:test');
const assert = require('node:assert/strict');
const { withPage } = require('./helpers/browser.cjs');

function options(extra = {}) {
  return { ...extra, prepare: context => context.route('**/js/app.js*', route => route.fulfill({ contentType: 'application/javascript', body: '' })) };
}
async function setup(page, origin) {
  await page.evaluate(() => {
    document.querySelectorAll('.screen').forEach(el => el.classList.remove('active'));
    document.querySelector('#libraryStatistics')?.remove();
    document.querySelector('#libraryStatisticsBtn')?.remove();
    const screen = document.createElement('section'); screen.className = 'screen active';
    screen.innerHTML = '<div class="wrap"><button id="libraryStatisticsBtn">本地统计</button><div id="libraryStatistics"></div></div>';
    document.querySelector('main').append(screen);
    window.__statisticsTest = { reads: 0, analyses: [], downloads: [], fail: false,
      records: Array.from({ length: 12 }, (_, i) => ({ id: 'record-' + i, bankVersion: QUESTION_BANK_META.version,
        state: { info: { name: i === 0 ? '<img src=x onerror=alert(1)>本地姓名' : '本地同学' + i } }, reportMeta: { batchId: 'PRIVATE-' + i } })) };
    const t = window.__statisticsTest;
    t.records[11].bankVersion = 'old-bank';
    window.ReportStatistics = { analyze(records, context) {
      t.analyses.push({ records: structuredClone(records), context: structuredClone(context) });
      return { format: 'bic-academic-aggregate', version: 1, bankVersion: QUESTION_BANK_META.version,
        sample: { unit: 'report', count: records.length, source: context.source, independence: 'operator_checked_not_verified' },
        privacy: { minCell: 10, release: 'local_aggregate_not_anonymity_guarantee' },
        subjects: [{ key: 'english', totalQuestions: 15, status: 'available', complete: records.length, incomplete: 0, meanPctRounded5: 75 },
          { key: 'maths', totalQuestions: 15, status: 'suppressed' }],
        items: [{ id: 'en1', subject: 'english', difficulty: 'foundation', status: 'suppressed' },
          { id: 'en2', subject: 'english', difficulty: 'intermediate', status: 'available', answered: records.length, missing: 0,
            correct: records.length, incorrect: 0, pctCorrect: 100, review: 'all_correct' }],
        calibration: { status: 'not_calibrated', followupOutcomes: false, thresholdsChanged: false } };
    } };
  });
  await page.addScriptTag({ url: origin + '/js/report-statistics-ui.js' });
  await page.addStyleTag({ url: origin + '/css/statistics.css' });
  await page.evaluate(() => {
    const t = window.__statisticsTest;
    t.ui = ReportStatisticsUI.init({ getRecords() { t.reads++; if (t.fail) throw new Error('PRIVATE failure detail');
      if (t.mutateAt === t.reads) t.records[0].state.info.name = '确认期间的更新'; return structuredClone(t.records); },
      download(text) { t.downloads.push(text); } });
  });
}
async function open(page) { await page.locator('#libraryStatisticsBtn').click(); }
async function selected(page) {
  await open(page);
  for (let i = 0; i < 10; i++) await page.locator(`[data-statistics-record="record-${i}"]`).check();
  await page.locator('#statisticsSource').selectOption('synthetic');
  await page.locator('#statisticsIndependence').check();
}
async function preview(page) { await selected(page); await page.locator('#statisticsPreviewBtn').click(); await page.locator('#statisticsPreview').waitFor({ state: 'visible' }); }

test('statistics requires opening, explicit report choices, sample source and independence review', () => withPage(async (page, { origin }) => {
  await setup(page, origin);
  assert.equal(await page.evaluate(() => __statisticsTest.reads), 0);
  assert.equal(await page.locator('#libraryStatistics').isVisible(), false);
  await open(page);
  assert.equal(await page.locator('[data-statistics-record]:checked').count(), 0);
  assert.equal(await page.locator('[data-statistics-record="record-11"]').isDisabled(), true);
  assert.equal(await page.locator('#statisticsPreviewBtn').isDisabled(), true);
  for (let i = 0; i < 10; i++) await page.locator(`[data-statistics-record="record-${i}"]`).check();
  assert.equal(await page.locator('#statisticsPreviewBtn').isDisabled(), true);
  await page.locator('#statisticsSource').selectOption('unverified_real');
  assert.equal(await page.locator('#statisticsPreviewBtn').isDisabled(), true);
  await page.locator('#statisticsIndependence').check();
  assert.equal(await page.locator('#statisticsPreviewBtn').isDisabled(), false);
  await page.locator('#statisticsPreviewBtn').click();
  assert.match(await page.locator('#statisticsPreview').innerText(), /未核验|未校准/);
  assert.equal(await page.evaluate(() => __statisticsTest.analyses[0].context.source), 'unverified_real');
  assert.deepEqual(await page.evaluate(() => __statisticsTest.downloads), []);
}, options()));

test('review shows only aggregate fields, suppresses small cells and exports the exact JSON after a second confirmation', () => withPage(async (page, { origin }) => {
  await setup(page, origin); await preview(page);
  const json = await page.locator('#statisticsJson').textContent();
  assert.doesNotMatch(json, /PRIVATE|本地姓名|state|answers|history/);
  assert.match(await page.locator('#statisticsSubjects').textContent(), /75/);
  assert.match(await page.locator('#statisticsItems').textContent(), /隐藏|压制/);
  assert.equal(await page.locator('#libraryStatistics img').count(), 0);
  assert.match(await page.locator('#libraryStatistics').innerText(), /<img src=x/);
  page.once('dialog', dialog => { assert.match(dialog.message(), /模拟|虚构/); assert.match(dialog.message(), /10/); assert.match(dialog.message(), /识别|匿名/); dialog.dismiss(); });
  await page.locator('#statisticsExportBtn').click();
  assert.deepEqual(await page.evaluate(() => __statisticsTest.downloads), []);
  page.once('dialog', dialog => dialog.accept()); await page.locator('#statisticsExportBtn').click();
  assert.deepEqual(await page.evaluate(() => __statisticsTest.downloads), [json]);
}, options()));

test('changing selection, source or independence immediately invalidates the preview', () => withPage(async (page, { origin }) => {
  await setup(page, origin); await preview(page);
  await page.locator('#statisticsSource').selectOption('unverified_real');
  assert.equal(await page.locator('#statisticsPreview').isVisible(), false);
  assert.equal(await page.locator('#statisticsExportBtn').isDisabled(), true);
  await page.locator('#statisticsPreviewBtn').click(); await page.locator('#statisticsIndependence').uncheck();
  assert.equal(await page.locator('#statisticsPreview').isVisible(), false);
  await page.locator('#statisticsIndependence').check(); await page.locator('#statisticsPreviewBtn').click();
  await page.locator('[data-statistics-record="record-0"]').uncheck();
  assert.equal(await page.locator('#statisticsPreview').isVisible(), false);
  assert.equal(await page.locator('#statisticsPreviewBtn').isDisabled(), true);
  assert.deepEqual(await page.evaluate(() => __statisticsTest.downloads), []);
}, options()));

test('changed, deleted, or unreadable archives invalidate review without exporting or leaking errors', () => withPage(async (page, { origin }) => {
  await setup(page, origin); await preview(page);
  await page.evaluate(() => { __statisticsTest.records[0].state.info.name = '另标签修改'; });
  await page.locator('#statisticsExportBtn').click();
  assert.equal(await page.locator('#statisticsPreview').isVisible(), false);
  assert.match(await page.locator('#statisticsStatus').textContent(), /变化|重新/);
  assert.deepEqual(await page.evaluate(() => __statisticsTest.downloads), []);
  await page.locator('#statisticsCloseBtn').click(); await preview(page);
  await page.evaluate(() => { __statisticsTest.records.splice(0, 1); });
  await page.locator('#statisticsExportBtn').click();
  assert.equal(await page.locator('#statisticsPreview').isVisible(), false);
  await page.locator('#statisticsCloseBtn').click();
  await page.evaluate(() => { __statisticsTest.fail = true; }); await open(page);
  assert.match(await page.locator('#statisticsStatus').textContent(), /无法|失败|重新/);
  assert.doesNotMatch(await page.locator('#libraryStatistics').innerText(), /PRIVATE failure/);
  assert.deepEqual(await page.evaluate(() => __statisticsTest.downloads), []);
}, options()));

test('host clear and close erase private names and reopening starts with no choices', () => withPage(async (page, { origin }) => {
  await setup(page, origin); await preview(page);
  await page.evaluate(() => __statisticsTest.ui.clear());
  assert.equal(await page.locator('#libraryStatistics').isVisible(), false);
  assert.equal(await page.locator('#libraryStatistics').textContent(), '');
  await open(page);
  assert.equal(await page.locator('[data-statistics-record]:checked').count(), 0);
  assert.equal(await page.locator('#statisticsSource').inputValue(), '');
  await page.locator('#statisticsCloseBtn').click();
  assert.equal(await page.locator('#libraryStatistics').textContent(), '');
  assert.equal(await page.locator('#libraryStatisticsBtn').evaluate(el => el === document.activeElement), true);
}, options()));

test('a change while export confirmation is open prevents the download after confirmation', () => withPage(async (page, { origin }) => {
  await setup(page, origin); await preview(page);
  await page.evaluate(() => { __statisticsTest.mutateAt = __statisticsTest.reads + 2; });
  page.once('dialog', dialog => dialog.accept()); await page.locator('#statisticsExportBtn').click();
  assert.deepEqual(await page.evaluate(() => __statisticsTest.downloads), []);
  assert.equal(await page.locator('#statisticsPreview').isVisible(), false);
  assert.match(await page.locator('#statisticsStatus').textContent(), /变化|重新/);
}, options()));

test('archive changes before building and storage denial after preview never export stale data', () => withPage(async (page, { origin }) => {
  await setup(page, origin); await selected(page);
  await page.evaluate(() => { __statisticsTest.records[0].reportMeta.batchId = 'CHANGED'; });
  await page.locator('#statisticsPreviewBtn').click();
  assert.equal(await page.locator('#statisticsPreview').isVisible(), false);
  assert.deepEqual(await page.evaluate(() => __statisticsTest.analyses), []);
  await page.locator('#statisticsCloseBtn').click(); await preview(page);
  await page.evaluate(() => { __statisticsTest.fail = true; });
  await page.locator('#statisticsExportBtn').click();
  assert.equal(await page.locator('#statisticsPreview').isVisible(), false);
  assert.deepEqual(await page.evaluate(() => __statisticsTest.downloads), []);
  assert.doesNotMatch(await page.locator('#libraryStatistics').textContent(), /PRIVATE failure/);
}, options()));

test('narrow statistics review has no horizontal overflow or new storage and network requests', () => withPage(async (page, { origin }) => {
  await setup(page, origin);
  const before = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
  const requests = []; page.on('request', request => requests.push(request.url()));
  await preview(page);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.equal(await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } })), before);
  assert.deepEqual(requests, []);
}, options({ viewport: { width: 375, height: 812 } })));
