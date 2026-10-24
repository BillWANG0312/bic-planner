const { test } = require('node:test');
const assert = require('node:assert/strict');
const { withPage } = require('./helpers/browser.cjs');

async function draft(page, name) {
  await page.locator('#startBtn').click();
  await page.locator('#inName').fill(name);
  await page.locator('#updateReportBtn').click();
  await page.locator('#screen-report.active').waitFor();
}
async function archiveAliceAndCreateBob(page) {
  await draft(page, '归档同学甲');
  await page.locator('#archiveReportBtn').click();
  await page.waitForFunction(() => window.ReportStore.create(localStorage).list().length === 1);
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#restartBtn').click();
  await draft(page, '当前同学乙');
  await page.locator('#openLibraryBtn').click();
  return page.evaluate(() => window.ReportStore.create(localStorage).list()[0].id);
}

test('canceling an archive switch preserves the active student and accepting opens the archived report', () => withPage(async page => {
  const id = await archiveAliceAndCreateBob(page);
  page.once('dialog', dialog => dialog.dismiss());
  await page.locator(`[data-open-id="${id}"]`).click();
  assert.equal(await page.evaluate(() => window.__pathwise.state.info.name), '当前同学乙');
  assert.equal(await page.locator('#screen-library.active').count(), 1);
  page.once('dialog', dialog => dialog.accept());
  await page.locator(`[data-open-id="${id}"]`).click();
  await page.locator('#screen-report.active').waitFor();
  assert.equal(await page.evaluate(() => window.__pathwise.state.info.name), '归档同学甲');
  await page.reload();
  await page.locator('#screen-report.active').waitFor();
  assert.match(await page.locator('#reportRoot .cover h1').textContent(), /归档同学甲/);
  assert.equal(await page.evaluate(() => window.ReportStore.create(localStorage).list().length), 1);
}));

test('a quota failure while opening an archive cannot replace active answers or their persisted copy', () => withPage(async page => {
  const id = await archiveAliceAndCreateBob(page);
  const before = await page.evaluate(() => localStorage.getItem('pathwise.state.v1'));
  await page.evaluate(() => {
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'pathwise.state.v1') throw new DOMException('full', 'QuotaExceededError');
      return set.call(this, key, value);
    };
  });
  page.once('dialog', dialog => dialog.accept());
  await page.locator(`[data-open-id="${id}"]`).click();
  assert.equal(await page.evaluate(() => window.__pathwise.state.info.name), '当前同学乙');
  assert.equal(await page.evaluate(() => localStorage.getItem('pathwise.state.v1')), before);
  assert.match(await page.locator('#libraryStatus').textContent(), /未替换|无法保存/);
}));

test('refreshing the library preserves archives and returns to a usable library screen', () => withPage(async page => {
  await draft(page, '库中同学');
  await page.locator('#archiveReportBtn').click();
  await page.locator('#openLibraryBtn').click();
  await page.reload();
  await page.locator('#screen-library.active').waitFor();
  assert.equal(await page.locator('[data-open-id]').count(), 1);
  await page.locator('#libraryBackBtn').click();
  assert.equal(await page.locator('#screen-home.active').count(), 1);
}));

test('import-compatible free-text subjects survive opening and refreshing an archived student', () => withPage(async page => {
  const id = await page.evaluate(() => {
    const state = JSON.parse(JSON.stringify(window.__pathwise.state));
    state.info = { name: '跨科同学', grade: '8', year: '2027 年秋季' };
    state.plan.answers.schoolSubjects = ['天文学'];
    state.plan.answers.weakSubjects = ['地理探究'];
    state.report = window.generateReport(state);
    state.report.meta.batchId = 'AP-FREE-SUBJECT';
    return window.ReportStore.create(localStorage).save(state).record.id;
  });
  await page.locator('#libraryBtn').click();
  await page.locator(`[data-open-id="${id}"]`).click();
  await page.locator('#screen-report.active').waitFor();
  assert.deepEqual(await page.evaluate(() => window.__pathwise.state.plan.answers.schoolSubjects), ['天文学']);
  await page.reload();
  await page.locator('#screen-report.active').waitFor();
  assert.deepEqual(await page.evaluate(() => window.__pathwise.state.plan.answers.schoolSubjects), ['天文学']);
  assert.deepEqual(await page.evaluate(() => window.__pathwise.state.plan.answers.weakSubjects), ['地理探究']);
}));

test('returning to a report refreshes changed student information before archiving the visible report', () => withPage(async page => {
  await draft(page, '报告甲');
  await page.locator('.step[data-step=info]').click();
  await page.locator('#inName').fill('资料乙');
  await page.locator('.step[data-step=report]').click();
  assert.match(await page.locator('#reportRoot .cover h1').textContent(), /资料乙/);
  await page.locator('#archiveReportBtn').click();
  const archivedName = await page.evaluate(() => window.ReportStore.create(localStorage).list()[0].state.info.name);
  assert.equal(archivedName, '资料乙');
}));

test('grade and target year alone are protected as unsaved progress when switching reports', () => withPage(async page => {
  const id = await page.evaluate(() => {
    const value = JSON.parse(JSON.stringify(window.__pathwise.state));
    value.info = { name: '已归档同学', grade: '8', year: '2027 年秋季' };
    value.report = window.generateReport(value);
    return window.ReportStore.create(localStorage).save(value).record.id;
  });
  await page.locator('#startBtn').click();
  await page.locator('#inGrade button[data-v="11"]').click();
  await page.locator('#inYear button').last().click();
  await page.locator('#infoForm [data-goto=home]').click();
  await page.locator('#libraryBtn').click();
  page.once('dialog', dialog => dialog.dismiss());
  await page.locator(`[data-open-id="${id}"]`).click();
  assert.equal(await page.locator('#screen-library.active').count(), 1);
  assert.equal(await page.evaluate(() => window.__pathwise.state.info.grade), '11');
  assert.equal(await page.evaluate(() => window.__pathwise.state.info.year), '2030 年秋季');
}));

test('opening and refreshing an archive preserves the original source of carried advisor advice', () => withPage(async page => {
  const id = await page.evaluate(() => {
    const value = JSON.parse(JSON.stringify(window.__pathwise.state));
    value.info = { name: '来源核对同学', grade: '8', year: '2027 年秋季' };
    value.report = window.generateReport(value);
    value.report.meta.batchId = 'AP-CURRENT';
    window.reportEditing.applyEdit(value.report, 'summary', '保留原来的顾问建议。', '王老师');
    value.report.advisor.carriedFrom = 'AP-ORIGINAL';
    return window.ReportStore.create(localStorage).save(value).record.id;
  });
  await page.locator('#libraryBtn').click();
  await page.locator(`[data-open-id="${id}"]`).click();
  await page.locator('#screen-report.active').waitFor();
  await page.reload();
  await page.locator('#screen-report.active').waitFor();
  assert.equal(await page.evaluate(() => window.__pathwise.state.report.advisor.carriedFrom), 'AP-ORIGINAL');
  assert.equal(await page.evaluate(() => window.__pathwise.state.report.advisor.history.length), 1);
}));
