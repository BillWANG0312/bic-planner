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

test('complete student journey reaches a saved report through all 103 questions', () => withPage(async page => {
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
  // 年级已在基本信息作答，规划模块从下一道未答题开始；含排序、飞镖、赛跑等小游戏。
  for (let i = 0; i < 13 && await page.locator('#testTitle').textContent() === '专业规划测试'; i++) {
    const body = page.locator('#testBody');
    if (await body.locator('.g-sorter').count()) {
      // 点选卡片再点格子是最直观的触屏交互；每格有容量上限，自动选还有空位的格子。
      const sorter = body.locator('.g-sorter');
      const cap = Number(await sorter.getAttribute('data-cap'));
      // 排序卡片的格数可能少于卡片数：拿第一张放进还有空位的格子，格子都满了就换第二张。
      const state = () => body.locator('.g-lane').evaluateAll(ls => ls.map(l => l.querySelectorAll('.g-card').length));
      const total = await body.locator('.g-card').count();
      for (let placed = 0; placed <= total && await body.locator('.g-pool .g-card').count(); placed++) {
        const card = body.locator('.g-pool .g-card').first();
        const lane = (await state()).findIndex(n => n < cap);
        if (lane < 0) { await card.click(); continue; } // 先收回，换到下一张卡片
        await card.click();
        await body.locator('.g-lane').nth(lane).locator('.g-lane-head').click();
      }
    } else if (await body.locator('.dart-ring').count()) {
      await body.locator('.dart-ring').nth(2).click({ force: true });
      await body.locator('.dart-ring').nth(1).click({ force: true });
    } else if (await body.locator('.race-item').count()) {
      await body.locator('.race-block').nth(0).locator('.race-item').first().click({ force: true });
      await body.locator('.race-block').nth(1).locator('.race-item').first().click({ force: true });
    } else {
      await body.locator('.option, .tag-card').first().click();
    }
    await page.locator('#testNext').click();
  }
  assert.equal(await page.locator('#testTitle').textContent(), '性格特质测评');
  for (let i = 0; i < 30; i++) {
    await page.locator('#testBody .likert button').first().click();
    await page.locator('#testNext').click();
  }
  await page.locator('#screen-report.active').waitFor({ timeout: 15000 });
  const meta = await page.evaluate(() => window.__pathwise.state.report.meta);
  assert.equal(meta.status, 'complete');
  assert.equal(meta.coverage.academic.answered, 60);
  assert.equal(meta.coverage.plan.answered, 12);
  assert.equal(meta.coverage.mbti.answered, 30);
  assert.equal(await page.locator('#reportRoot .review-item').count(), 60);
  await page.reload();
  await page.locator('#screen-report.active').waitFor();
  assert.equal(await page.evaluate(() => window.__pathwise.state.report.meta.batchId), meta.batchId);
}));
