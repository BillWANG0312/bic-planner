const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { withPage } = require('./helpers/browser.cjs');
const { loadReportScripts, state } = require('./helpers/report.cjs');

function reportState(name = '归档学生') {
  const w = loadReportScripts();
  const value = state(w);
  value.info.name = name;
  value.ui = { screen: 'report', idx: 0, resumeScreen: 'academic' };
  value.report = w.generateReport(value);
  value.report.meta.batchId = 'AP-LIBRARY-01';
  return value;
}

function saved(value = reportState(), extra = {}) {
  return { ...extra, beforeLoad: page => page.addInitScript(value => {
    localStorage.setItem('pathwise.state.v1', JSON.stringify(value));
  }, value) };
}

async function backupFor(page, name, batchId = 'AP-IMPORT-02') {
  return page.evaluate(({ name, batchId }) => {
    let raw = null;
    const storage = { getItem: () => raw, setItem: (key, value) => { raw = value; } };
    const store = window.ReportStore.create(storage);
    const value = JSON.parse(JSON.stringify(window.__pathwise.state));
    value.info.name = name;
    value.report = window.generateReport(value);
    value.report.meta.batchId = batchId;
    store.save(value);
    return store.exportBackup();
  }, { name, batchId });
}

async function chooseBackup(page, text, name = '报告备份.json') {
  await page.locator('#libraryImportFile').setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(text) });
}

test('report library archives a draft and searches escaped student names and report identifiers', () => withPage(async page => {
  assert.equal(await page.locator('#archiveReportBtn').count(), 1, '报告页提供主动归档入口');
  await page.locator('#archiveReportBtn').click();
  await page.locator('#openLibraryBtn').click();
  await page.locator('#screen-library.active').waitFor();
  assert.match(await page.locator('#libraryCount').innerText(), /1/);
  assert.match(await page.locator('#libraryList').innerText(), /<img src=x onerror=1>/);
  assert.equal(await page.locator('#libraryList img').count(), 0);
  assert.match(await page.locator('#libraryList').innerText(), /探索草稿/);
  assert.match(await page.locator('#libraryList').innerText(), /学术 0\/60/);
  assert.match(await page.locator('#libraryList').innerText(), /规划 1\/12/);
  assert.match(await page.locator('#libraryList').innerText(), /性格 0\/30/);
  assert.match(await page.locator('#libraryList').innerText(), /专业方向/);
  await page.locator('#librarySearch').fill('AP-LIBRARY-01');
  assert.equal(await page.locator('[data-library-open]').count(), 1);
  await page.locator('#librarySearch').fill('不存在');
  assert.equal(await page.locator('[data-library-open]').count(), 0);
  await page.locator('#librarySearch').fill('IMG');
  assert.equal(await page.locator('[data-library-open]').count(), 1);
  await page.locator('#libraryBackBtn').click();
  assert.equal(await page.locator('#screen-report.active').isVisible(), true);
  assert.equal(await page.locator('#openLibraryBtn').evaluate(el => el === document.activeElement), true);
}, saved(reportState('<img src=x onerror=1>'))));

test('duplicate archive and deletion both preserve records when their confirmation is cancelled', () => withPage(async page => {
  await page.locator('#archiveReportBtn').click();
  page.once('dialog', dialog => dialog.dismiss());
  await page.locator('#archiveReportBtn').click();
  await page.locator('#openLibraryBtn').click();
  assert.equal(await page.locator('[data-library-open]').count(), 1);
  page.once('dialog', dialog => dialog.dismiss());
  await page.locator('[data-library-delete]').click();
  assert.equal(await page.locator('[data-library-open]').count(), 1);
  page.once('dialog', dialog => dialog.accept());
  await page.locator('[data-library-delete]').click();
  assert.equal(await page.locator('[data-library-open]').count(), 0);
  assert.match(await page.locator('#libraryStatus').innerText(), /删除/);
}, saved()));

test('JSON import previews records before committing and skips duplicates unless replace is selected', () => withPage(async page => {
  await page.locator('#archiveReportBtn').click();
  await page.locator('#openLibraryBtn').click();
  const text = await backupFor(page, '导入学生');
  await chooseBackup(page, text);
  await page.locator('#libraryImportPreview').waitFor({ state: 'visible' });
  assert.match(await page.locator('#libraryImportPreview').innerText(), /1/);
  assert.equal(await page.locator('[data-library-open]').count(), 1, '文件选择后不得直接写入');
  assert.equal(await page.locator('#libraryImportReplace').isChecked(), false);
  await page.locator('#libraryImportCommitBtn').click();
  assert.equal(await page.locator('[data-library-open]').count(), 2);
  const changed = await backupFor(page, '替换后的学生', 'AP-IMPORT-02');
  await chooseBackup(page, changed);
  assert.equal(await page.locator('#libraryImportReplace').isChecked(), false);
  await page.locator('#libraryImportCommitBtn').click();
  assert.match(await page.locator('#libraryList').innerText(), /导入学生/);
  assert.doesNotMatch(await page.locator('#libraryList').innerText(), /替换后的学生/);
  await chooseBackup(page, changed);
  await page.locator('#libraryImportReplace').check();
  await page.locator('#libraryImportCommitBtn').click();
  assert.match(await page.locator('#libraryList').innerText(), /替换后的学生/);
  assert.equal(await page.locator('[data-library-open]').count(), 2);
}, saved()));

test('invalid JSON and unsupported file selections never offer import commit or alter the archive', () => withPage(async page => {
  await page.locator('#archiveReportBtn').click();
  await page.locator('#openLibraryBtn').click();
  await chooseBackup(page, '{broken');
  assert.equal(await page.locator('#libraryImportCommitBtn').isVisible(), false);
  assert.match(await page.locator('#libraryStatus').innerText(), /无法|失败|格式|JSON/);
  await chooseBackup(page, '{}', 'wrong.csv');
  assert.equal(await page.locator('#libraryImportCommitBtn').isVisible(), false);
  assert.equal(await page.locator('[data-library-open]').count(), 1);
}, saved()));

test('JSON and CSV downloads contain the stored records with portable safe filenames', () => withPage(async page => {
  await page.locator('#archiveReportBtn').click();
  await page.locator('#openLibraryBtn').click();
  for (const [selector, suffix, expected] of [
    ['#libraryExportBtn', '.json', /归档学生/],
    ['#libraryCsvBtn', '.csv', /归档学生/]
  ]) {
    const downloadPromise = page.waitForEvent('download');
    await page.locator(selector).click();
    const download = await downloadPromise;
    assert.ok(download.suggestedFilename().endsWith(suffix));
    assert.doesNotMatch(download.suggestedFilename(), /[<>:"/\\|?*]/);
    assert.match(await fs.readFile(await download.path(), 'utf8'), expected);
  }
}, saved()));

test('corrupt archives offer a raw backup while keeping the original storage unchanged', () => withPage(async page => {
  await page.locator('#libraryBtn').click();
  assert.match(await page.locator('#libraryStatus').innerText(), /损坏|无法|格式/);
  assert.equal(await page.locator('#libraryRawBackupBtn').isVisible(), true);
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#libraryRawBackupBtn').click();
  const download = await downloadPromise;
  assert.equal(await fs.readFile(await download.path(), 'utf8'), '{damaged original');
  assert.equal(await page.evaluate(() => localStorage.getItem('bic.report-library.v1')), '{damaged original');
  assert.equal(await page.locator('#libraryImportFile').isDisabled(), true);
}, { beforeLoad: page => page.addInitScript(() => {
  localStorage.setItem('bic.report-library.v1', '{damaged original');
}) }));

test('local library remains legible at 375px and does not overflow with long imported text', () => withPage(async page => {
  await page.locator('#archiveReportBtn').click();
  await page.locator('#openLibraryBtn').click();
  assert.match(await page.locator('#screen-library').innerText(), /此浏览器|本机/);
  assert.match(await page.locator('#screen-library').innerText(), /上传|云端/);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  assert.equal(await page.locator('#libraryHeading').evaluate(el => el === document.activeElement), true);
  await page.locator('#libraryBackBtn').click();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
}, saved(reportState('WWWWWWWWWWWWWWWWWWWWWWWW'), { viewport: { width: 375, height: 812 } })));

test('old bank or catalog versions show a warning and opening requires acknowledging regeneration', () => withPage(async page => {
  await page.locator('#openLibraryBtn').click();
  const data = JSON.parse(await backupFor(page, '旧版本学生'));
  data.records[0].catalogVersion = 'old-catalog';
  await chooseBackup(page, JSON.stringify(data));
  await page.locator('#libraryImportCommitBtn').click();
  assert.match(await page.locator('.library-version').innerText(), /当前版本重新生成/);
  let prompt = '';
  page.once('dialog', async dialog => { prompt = dialog.message(); await dialog.dismiss(); });
  await page.locator('[data-library-open]').click();
  assert.match(prompt, /当前版本重新生成/);
  assert.match(prompt, /保留原 PDF/);
  assert.equal(await page.evaluate(() => window.__pathwise.state.info.name), '归档学生');
}, saved()));

test('denied storage leaves the library with a readable status and working return navigation', () => withPage(async page => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.locator('#libraryBtn').click();
  assert.match(await page.locator('#libraryStatus').innerText(), /浏览器无法/);
  assert.equal(await page.locator('#libraryImportFile').isDisabled(), true);
  assert.equal(await page.locator('#libraryRawBackupBtn').isVisible(), false);
  await page.locator('#libraryBackBtn').click();
  await page.locator('#startBtn').click();
  assert.equal(await page.locator('#screen-info.active').isVisible(), true);
  assert.deepEqual(errors, []);
}, { beforeLoad: page => page.addInitScript(() => {
  Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('blocked', 'SecurityError'); } });
}) }));

test('an archive success message cannot claim a newly generated student report was archived', () => withPage(async page => {
  await page.locator('#archiveReportBtn').click();
  assert.equal(await page.locator('#archiveReportStatus').isVisible(), true);
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#restartBtn').click();
  await page.locator('#startBtn').click();
  await page.locator('#inName').fill('尚未归档的新学生');
  await page.locator('#updateReportBtn').click();
  await page.locator('#screen-report.active').waitFor();
  assert.equal(await page.locator('#archiveReportStatus').isVisible(), false);
  await page.locator('#openLibraryBtn').click();
  assert.equal(await page.locator('[data-library-open]').count(), 1);
  assert.doesNotMatch(await page.locator('#libraryList').innerText(), /尚未归档的新学生/);
}, saved()));

test('returning after a library reload gives keyboard focus to the home library entry', () => withPage(async page => {
  await page.locator('#libraryBtn').click();
  await page.reload();
  await page.locator('#screen-library.active').waitFor();
  await page.locator('#libraryBackBtn').click();
  assert.equal(await page.locator('#libraryBtn').evaluate(el => el === document.activeElement), true);
}));
