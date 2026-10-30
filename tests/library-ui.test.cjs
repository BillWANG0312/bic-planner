const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { withPage } = require('./helpers/browser.cjs');
const { loadReportScripts, state, legacyState } = require('./helpers/report.cjs');

function reportState(name = '归档学生', legacy = false) {
  const w = loadReportScripts();
  const value = (legacy ? legacyState : state)(w);
  value.info.name = name;
  // 空姓名会让页面按无进度处理并停在信息页，归档测试始终使用有姓名的学生
  if (!name) value.info.name = '归档学生';
  value.ui = { screen: 'report', idx: 0, resumeScreen: 'academic' };
  value.report = w.generateReport({ ...value, assessmentProfile: w.AssessmentProfiles.CURRENT });
  value.report.meta.batchId = 'AP-LIBRARY-01';
  return value;
}

function blankState() {
  const w = loadReportScripts();
  const value = legacyState(w);
  value.ui = { screen: 'home', idx: 0 };
  return value;
}

function saved(value = reportState(), extra = {}) {
  return { ...extra, beforeLoad: page => page.addInitScript(value => {
    localStorage.setItem('pathwise.state.v1', JSON.stringify(value));
  }, value) };
}

// 打开页面总是停在首页，已保存的内容必须通过续答入口进入：
// 已有报告时直接显示报告；停在最后一题时作答后生成报告。
async function openSavedReport(page) {
  await page.locator('#resumeBtn').click();
  await page.waitForFunction(() => ['screen-report', 'screen-test'].some(id => document.getElementById(id).classList.contains('active')));
  if (await page.locator('#screen-report.active').count()) return;
  await page.locator('#screen-test.active .likert button').first().click();
  await page.locator('#screen-report.active').waitFor({ timeout: 15000 });
}

async function backupFor(page, name, batchId = 'AP-IMPORT-02') {
  return page.evaluate(({ name, batchId }) => {
    let raw = null;
    const storage = { getItem: () => raw, setItem: (key, value) => { raw = value; } };
    const store = window.ReportStore.create(storage);
    const value = JSON.parse(JSON.stringify(window.__pathwise.state));
    value.info.name = name;
    value.report = window.generateReport({ ...value, assessmentProfile: window.AssessmentProfiles.CURRENT });
    value.report.meta.batchId = batchId;
    store.save(value);
    return store.exportBackup();
  }, { name, batchId });
}

async function chooseBackup(page, text, name = '报告备份.json') {
  await page.locator('#libraryImportFile').setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(text) });
}

test('report library archives a draft and searches escaped student names and report identifiers', () => withPage(async page => {
  await openSavedReport(page);
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
  await openSavedReport(page);
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
  await openSavedReport(page);
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
  await openSavedReport(page);
  await page.locator('#archiveReportBtn').click();
  await page.locator('#openLibraryBtn').click();
  await chooseBackup(page, '{broken');
  assert.equal(await page.locator('#libraryImportCommitBtn').isVisible(), false);
  assert.match(await page.locator('#libraryStatus').innerText(), /无法|失败|格式|JSON/);
  await chooseBackup(page, '{}', 'wrong.csv');
  assert.equal(await page.locator('#libraryImportCommitBtn').isVisible(), false);
  assert.equal(await page.locator('[data-library-open]').count(), 1);
}, saved()));

test('JSON export downloads the stored records with a portable filename; CSV export explains current-version records are unsupported', () => withPage(async page => {
  // 旧版报告不再续答；只走首页报告库：导入当前版本归档并打开，再导出
  await page.locator('#libraryBtn').click();
  await chooseBackup(page, await backupFor(page, '归档学生'));
  await page.locator('#libraryImportCommitBtn').click();
  // 已保存的进度仍算作当前作答，打开归档需要确认替换
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: '打开 归档学生 的报告' }).last().click();
  await page.locator('#screen-report.active').waitFor();
  await page.locator('#openLibraryBtn').click();
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#libraryExportBtn').click();
  const download = await downloadPromise;
  assert.ok(download.suggestedFilename().endsWith('.json'));
  assert.doesNotMatch(download.suggestedFilename(), /[<>:"/\\|?*]/);
  assert.match(await fs.readFile(await download.path(), 'utf8'), /归档学生/);
  // 当前测评版本的归档没有旧格式 CSV 汇总，导出会给出可读提示且不下载
  await page.locator('#libraryCsvBtn').click();
  await page.waitForFunction(() => /CSV/.test(document.getElementById('libraryStatus').textContent));
  assert.match(await page.locator('#libraryStatus').innerText(), /CSV/);
}, saved(blankState())));

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
  await openSavedReport(page);
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
  await openSavedReport(page);
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
  await openSavedReport(page);
  await page.locator('#archiveReportBtn').click();
  assert.equal(await page.locator('#archiveReportStatus').isVisible(), true);
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#restartBtn').click();
  // 首页的「开始探索」会续答已保存的报告，必须显式进入基本信息重新填写
  await page.locator('.step[data-step=info]').click();
  await page.locator('#inName').fill('尚未归档的新学生');
  await page.locator('#updateReportBtn').click();
  await page.locator('#screen-report.active').waitFor();
  assert.equal(await page.locator('#archiveReportStatus').isVisible(), false);
  await page.locator('#openLibraryBtn').click();
  assert.equal(await page.locator('[data-library-open]').count(), 1);
  assert.doesNotMatch(await page.locator('#libraryList').innerText(), /尚未归档的新学生/);
}, saved()));

test('returning after a library reload gives keyboard focus to the home library entry', () => withPage(async page => {
  // 刷新后总是回到首页，首页的报告库入口仍可直接进入本机报告库
  await page.reload();
  await page.locator('#screen-home.active').waitFor();
  await page.locator('#libraryBtn').click();
  await page.locator('#libraryBackBtn').click();
  assert.equal(await page.locator('#libraryBtn').evaluate(el => el === document.activeElement), true);
}));
