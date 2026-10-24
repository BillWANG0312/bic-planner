const { test } = require('node:test');
const assert = require('node:assert/strict');
const { withPage } = require('./helpers/browser.cjs');

async function draft(page) {
  await page.locator('#startBtn').click();
  await page.locator('#inName').fill('测试同学');
  await page.locator('#updateReportBtn').click();
  await page.locator('#screen-report.active').waitFor();
}

test('printing includes all answer explanations and restores folded sections afterwards', () => withPage(async page => {
  await draft(page);
  const before = await page.locator('#reportRoot .review-item[open]').count();
  assert.equal(before, 0);
  await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
  const opened = await page.locator('#reportRoot .review-item[open]').count();
  assert.equal(opened, 60, '打印应包含所有题目的解析');
  // Some browser/OS combinations send beforeprint twice.
  await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  assert.equal(await page.locator('#reportRoot .review-item[open]').count(), 0);
}));

test('advisor editor and report fit a narrow phone screen and editor stays out of print', () => withPage(async page => {
  await draft(page);
  await page.locator('#editReportBtn').click();
  await page.locator('#advisorAuthor').fill('王老师');
  await page.locator('#advisorText').fill('先体验课程，再确定方向。');
  await page.locator('#advisorForm button[type=submit]').click();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.emulateMedia({ media: 'print' });
  assert.equal(await page.locator('#reportEditor').isVisible(), false);
  assert.equal(await page.locator('#reportRoot').isVisible(), true);
}, { viewport: { width: 375, height: 812 } }));

test('complete student journey reaches a saved report through all 98 questions', () => withPage(async page => {
  await page.locator('#startBtn').click();
  await page.locator('#inName').fill('完整流程同学');
  await page.locator('#inGrade button[data-v="8"]').click();
  await page.locator('#inYear button').first().click();
  await page.locator('#infoForm button[type=submit]').click();
  for (let i = 0; i < 60; i++) {
    if (await page.locator('#numAns').count()) await page.locator('#numAns').fill('1');
    else await page.locator('#testBody .option').first().click();
    await page.locator('#testNext').click();
  }
  assert.equal(await page.locator('#testTitle').textContent(), '专业规划测试');
  // 年级已在基本信息作答，规划模块从下一道未答题开始。
  for (let i = 0; i < 14 && await page.locator('#testTitle').textContent() === '专业规划测试'; i++) {
    const option = page.locator('#testBody .option, #testBody .tag-card').first();
    await option.click();
    await page.locator('#testNext').click();
  }
  assert.equal(await page.locator('#testTitle').textContent(), '简版性格测试');
  for (let i = 0; i < 24; i++) {
    await page.locator('#testBody .likert button').first().click();
    await page.locator('#testNext').click();
  }
  await page.locator('#screen-report.active').waitFor();
  const meta = await page.evaluate(() => window.__pathwise.state.report.meta);
  assert.equal(meta.status, 'complete');
  assert.equal(meta.coverage.academic.answered, 60);
  assert.equal(meta.coverage.plan.answered, 14);
  assert.equal(meta.coverage.mbti.answered, 24);
  assert.equal(await page.locator('#reportRoot .review-item').count(), 60);
  await page.reload();
  await page.locator('#screen-report.active').waitFor();
  assert.equal(await page.evaluate(() => window.__pathwise.state.report.meta.batchId), meta.batchId);
}));
