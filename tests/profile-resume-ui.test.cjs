const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const KEY = 'pathwise.state.v1';
const { withPage } = require('./helpers/browser.cjs');
function legacy(mode = 'mbti', idx = 0) {
  return { info: { name: '旧版学生', grade: '9', year: '2028 年秋季' }, academic: { answers: { en1: 0, ma1: null } },
    plan: { answers: { grade: '9', schoolSubjects: ['音乐', '自填课程'], preferredMajor: ['tech'], countries: ['hk'] } },
    mbti: { answers: [0, null, ...Array(22).fill(null)] }, ui: { screen: 'test', resumeScreen: mode, idx }, report: null };
}
function seeded(raw, extra = {}) {
  return { ...extra, beforeLoad: async page => {
    await page.addInitScript(({ key, raw }) => { localStorage.setItem(key, raw); }, { key: KEY, raw });
    if (extra.beforeLoad) await extra.beforeLoad(page);
  } };
}
const rawValue = page => page.evaluate(key => localStorage.getItem(key), KEY);
const legacyRaw = (value = legacy()) => JSON.stringify(value, null, 2);

// 打开页面一律停在首页；已保存的当前版本只通过首页的续答入口进入。
async function resumeFromHome(page) {
  await page.locator('#screen-home.active').waitFor();
  await page.locator('#resumeBtn').click();
}

// 旧版进度不提供续答；重开新版走提示条里的「重新测试」，需显式确认。
async function restartFromHome(page, accept = true) {
  let dialogMessage = null;
  page.once('dialog', dialog => { dialogMessage = dialog.message(); accept ? dialog.accept() : dialog.dismiss(); });
  await page.locator('#profileRestartBtn').click();
  return dialogMessage;
}

test('legacy progress is never resumed but stays byte-for-byte and can be exported as raw JSON', () => {
  const raw = legacyRaw();
  return withPage(async page => {
    // 旧版进度无法续答：页面停在首页并给出可读提示，原始JSON可直接下载
    await page.locator('#screen-home.active').waitFor();
    assert.equal(await page.locator('#profileNotice').isVisible(), true);
    assert.match(await page.locator('#profileNoticeText').textContent(), /无法识别/);
    assert.equal(await page.locator('#resumeBtn').isHidden(), true);
    assert.equal(await page.locator('#screen-test.active').count(), 0);
    await page.evaluate(() => { window.dispatchEvent(new Event('pagehide')); window.dispatchEvent(new Event('beforeunload')); });
    assert.equal(await rawValue(page), raw);
    assert.equal(await page.evaluate(() => __pathwise.state.assessmentProfile), 'games-traits-v1');
    const downloaded = page.waitForEvent('download');
    await page.locator('#profileRawDownloadBtn').click();
    assert.equal(fs.readFileSync(await (await downloaded).path(), 'utf8'), raw);
    const stored = JSON.parse(raw);
    assert.equal(stored.mbti.answers.length, 24);
    assert.equal(stored.assessmentProfile, undefined);
  }, seeded(raw));
});

test('restarting over a stored legacy progress requires an explicit confirmation and never overwrites it silently', () => {
  const raw = legacyRaw(legacy('plan'));
  return withPage(async page => {
    await page.locator('#screen-home.active').waitFor();
    assert.equal(await page.locator('#resumeBtn').isHidden(), true);
    assert.match(await restartFromHome(page, false), /原始JSON/);
    assert.equal(await rawValue(page), raw);
    assert.equal(await page.evaluate(() => __pathwise.state.assessmentProfile), 'games-traits-v1');
    await restartFromHome(page, true);
    await page.locator('#screen-home.active').waitFor();
    await page.evaluate(() => new Promise(r => setTimeout(r, 200)));
    // 受保护的旧版进度已被显式替换为当前版本：提示条收起，续答入口按当前进度出现。
    await page.locator('#profileNotice').waitFor({ state: 'hidden' });
    assert.equal(await page.locator('#profileNotice').isVisible(), false);
    // 空白新版进度还不是可续答的进度；开始填写后作答照常保存，提示条不再出现。
    await page.locator('#startBtn').click();
    await page.locator('#inName').fill('新版学生');
    await page.locator('#inYear button').first().click();
    await page.locator('#inGrade button').first().click();
    await page.locator('#infoForm button[type=submit]').click();
    await page.locator('#testBody .option').first().click();
    assert.equal(await page.evaluate(() => __pathwise.state.academic.answers.en1), 0);
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    assert.equal(await page.locator('#profileNotice').isVisible(), false);
    assert.equal(await page.evaluate(() => __pathwise.state.info.name), '新版学生');
    assert.equal(JSON.parse(await rawValue(page)).info.name, '新版学生');
  }, seeded(raw));
});

test('state read failure locks writes while memory-only answers work and unavailable raw export is never promised', () => {
  const raw = legacyRaw();
  return withPage(async page => {
    const observed = () => page.evaluate(key => __nativeProgressRead(key), KEY);
    assert.equal(await observed(), raw); assert.match(await page.locator('#profileNoticeText').textContent(), /无法读取.*未覆盖.*本次.*作答/);
    assert.equal(await page.locator('#profileRawDownloadBtn').isHidden(), true); assert.equal(await page.locator('#profileRestartBtn').isVisible(), true);
    await page.locator('#startBtn').click(); await page.locator('#inName').fill('内存答题学生');
    await page.locator('#inGrade button').first().click(); await page.locator('#inYear button').first().click(); await page.locator('#infoForm button[type=submit]').click();
    await page.locator('#testBody .option').first().click(); assert.equal(await page.evaluate(() => __pathwise.state.academic.answers.en1), 0);
    await page.evaluate(() => { window.dispatchEvent(new Event('pagehide')); window.dispatchEvent(new Event('beforeunload')); });
    assert.equal(await observed(), raw);
    page.once('dialog', dialog => dialog.accept()); await page.locator('#profileRestartBtn').click(); assert.equal(await observed(), raw);
    assert.equal(await page.evaluate(() => __pathwise.state.info.name), '内存答题学生');
  }, { beforeLoad: page => page.addInitScript(({ key, raw }) => {
    const nativeGet = Storage.prototype.getItem, nativeSet = Storage.prototype.setItem;
    nativeSet.call(localStorage, key, raw); window.__nativeProgressRead = key => nativeGet.call(localStorage, key);
    Storage.prototype.getItem = function (requested) { if (this === localStorage && requested === key) throw new DOMException('state read blocked', 'SecurityError'); return nativeGet.call(this, requested); };
  }, { key: KEY, raw }) });
});

test('a missing planning grade displays basic-info fallback without adding it to saved current answers', () => {
  const value = { ...legacy(), assessmentProfile: 'games-traits-v1', academic: { answers: {} }, plan: { answers: {} }, mbti: { answers: [{ value: 2, ms: 100 }, ...Array(29).fill(null)] } };
  const raw = JSON.stringify(value);
  return withPage(async page => {
    await resumeFromHome(page);
    await page.locator('#screen-test.active').waitFor();
    // 续答先落在第一道未作答题（特质第 2 题），再显式进入规划模块检查年级回填
    await page.evaluate(() => { __pathwise.state.ui.idx = 0; __pathwise.startTest('plan'); });
    assert.equal(await page.locator('#testBody .option.selected').getAttribute('data-v'), '9');
    assert.equal(await page.evaluate(() => Object.hasOwn(__pathwise.state.plan.answers, 'grade')), false);
    await page.locator('#testBody .option[data-v="10"]').click();
    assert.deepEqual(await page.evaluate(() => [__pathwise.state.info.grade, __pathwise.state.plan.answers.grade]), ['10', '10']);
  }, seeded(raw));
});

for (const [label, value] of [
  ['unknown marker', { ...legacy(), assessmentProfile: 'unknown-profile' }],
  ['mixed answers', { ...legacy(), mbti: { answers: [0, { value: 4, ms: 20 }] } }],
  ['already converted legacy', { ...legacy(), mbti: { answers: [{ value: 0, ms: null }, ...Array(29).fill(null)], legacy: true } }],
  ['broken JSON', '{broken-source'],
  ['broken answer collection', { ...legacy(), academic: { answers: [] } }]
]) test(`${label} permits raw recovery and explicit new testing but never silently overwrites`, () => {
  const raw = typeof value === 'string' ? value : JSON.stringify(value);
  return withPage(async page => {
    await page.locator('#screen-home.active').waitFor();
    assert.equal(await page.locator('#profileNotice').isVisible(), true);
    assert.equal(await page.locator('#resumeBtn').isHidden(), true);
    await page.evaluate(() => { window.dispatchEvent(new Event('pagehide')); window.dispatchEvent(new Event('beforeunload')); });
    assert.equal(await rawValue(page), raw);
    await restartFromHome(page, false); assert.equal(await rawValue(page), raw);
    await restartFromHome(page, true);
    await page.waitForFunction(() => __pathwise.state.assessmentProfile === 'games-traits-v1');
    assert.equal(JSON.parse(await rawValue(page)).mbti.answers.length, 30);
    assert.equal(await page.locator('#resumeBtn').isHidden(), true);
  }, seeded(raw));
});

test('unmarked current answers are resumed from the home entry with30 trait items intact', () => {
  const value = { ...legacy(), plan: { answers: { grade: '9', subjectBoard: { like: ['数学'], try: [], avoid: [] } } }, mbti: { answers: [{ value: 0, ms: 50 }, ...Array(29).fill(null)] } };
  value.ui = { screen: 'home', idx: 0, resumeScreen: 'mbti' };
  const raw = JSON.stringify(value);
  return withPage(async page => {
    // 未标记的当前版作答不是受保护进度：不显示提示条，首页直接续答。
    assert.equal(await page.locator('#profileNotice').isVisible(), false);
    assert.equal(await page.locator('#resumeBtn').isVisible(), true);
    await resumeFromHome(page);
    await page.locator('#screen-test.active').waitFor();
    assert.equal(await page.locator('#testMeta').textContent(), '1 / 30');
    await page.evaluate(() => __pathwise.startTest('plan'));
    assert.deepEqual(await page.evaluate(() => __pathwise.state.plan.answers.subjectBoard.like), ['数学']);
    assert.equal((await page.evaluate(() => localStorage.getItem('pathwise.state.v1'))).includes('subjectBoard'), true);
    assert.notEqual(await rawValue(page), raw);
  }, seeded(raw));
});

/* ---------------- 公用电脑：清空本机进度 ---------------- */
const LIB_KEY = 'bic.report-library.v1';
// 页面载入时会恢复 ui.screen；让存档停在首页以便直接点击首页按钮。
const atHome = value => { value.ui = { screen: 'home', idx: 0, resumeScreen: 'mbti' }; return value; };
// 旧版归档记录：记录顶层标记旧版。
function oldRecord() {
  const value = legacy();
  return { id: 'old-profile-record', createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z', bankVersion: '2026.10', catalogVersion: 'unknown',
    state: { info: value.info, academic: value.academic, plan: value.plan, mbti: value.mbti }, reportMeta: { batchId: 'OPEN-OLD-RECORD', date: '2026-10-01' } };
}
const libraryRaw = () => JSON.stringify({ format: 'bic-report-library', version: 1, exportedAt: '2026-10-02T00:00:00Z', records: [oldRecord()] });

test('clearing local progress removes only the resume state and keeps archived reports byte-for-byte', () => {
  const raw = JSON.stringify(atHome(legacy()));
  return withPage(async page => {
    const before = await page.evaluate(key => localStorage.getItem(key), LIB_KEY);
    page.once('dialog', dialog => { if (!/清空后/.test(dialog.message())) throw new Error('unexpected dialog: ' + dialog.message()); dialog.accept(); });
    await page.locator('#clearProgressBtn').evaluate(el => el.click());
    assert.equal(await rawValue(page), null); assert.equal(await page.evaluate(key => localStorage.getItem(key), LIB_KEY), before);
    assert.equal(await page.evaluate(() => __pathwise.state.assessmentProfile), 'games-traits-v1');
    assert.equal(await page.evaluate(() => __pathwise.state.info.name), '');
    assert.match(await page.locator('#toast').textContent(), /删除|清空/);
    assert.match(await page.locator('#toast').textContent(), /报告库|归档/);
    assert.equal(await page.locator('#resumeBtn').isHidden(), true);
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    assert.equal(await rawValue(page), null);
  }, seeded(raw, { beforeLoad: page => page.addInitScript(({ key, raw }) => localStorage.setItem(key, raw), { key: LIB_KEY, raw: libraryRaw() }) }));
});

test('cancelling the clear confirmation keeps the original progress bytes and answers', () => {
  const raw = JSON.stringify(atHome(legacy()));
  return withPage(async page => {
    page.once('dialog', dialog => { if (!/清空后/.test(dialog.message())) throw new Error('no confirm dialog'); dialog.dismiss(); });
    await page.locator('#clearProgressBtn').evaluate(el => el.click());
    // 旧版原始进度受保护：不覆盖字节，也不会被载入当前作答
    assert.equal(await rawValue(page), raw); assert.equal(await page.evaluate(() => __pathwise.state.info.name), '');
    assert.equal(await page.locator('#profileRawDownloadBtn').isVisible(), true);
  }, seeded(raw));
});

test('clearing with no stored progress shows an explanatory toast without a confirmation', () => withPage(async page => {
  await page.evaluate(() => { let seen = 0; window.confirm = () => { seen++; return true; }; window.__confirmSeen = () => seen; });
  await page.locator('#clearProgressBtn').click();
  assert.equal(await page.evaluate(() => __confirmSeen()), 0); assert.match(await page.locator('#toast').textContent(), /没有未完成的进度/);
}));

test('the library-page clear button clears the resume state and returns to the home screen without crashing', () => {
  const raw = JSON.stringify(atHome(legacy()));
  return withPage(async page => {
    await page.locator('#libraryBtn').click(); await page.locator('#screen-library.active').waitFor();
    page.once('dialog', dialog => dialog.accept());
    await page.locator('#libraryClearProgressBtn').click();
    await page.locator('#screen-home.active').waitFor();
    assert.equal(await rawValue(page), null); assert.equal(await page.evaluate(() => __pathwise.state.info.name), '');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  }, seeded(raw, { viewport: { width: 375, height: 812 } }));
});

test('clearing unmarked protected progress leaves the raw source intact until confirmed', () => {
  const raw = JSON.stringify(atHome(legacy()), null, 2);
  return withPage(async page => {
    page.once('dialog', dialog => { if (!/清空后/.test(dialog.message())) throw new Error('no confirm dialog'); dialog.dismiss(); });
    await page.locator('#clearProgressBtn').evaluate(el => el.click());
    assert.equal(await rawValue(page), raw); assert.equal(await page.locator('#screen-home.active').count(), 1);
  }, seeded(raw));
});

test('a legacy report screen in storage is never opened automatically; the page lands on home', () => {
  const value = legacy(); value.ui = { screen: 'report', idx: 0, resumeScreen: 'mbti' }; value.mbti.answers = Array(24).fill(2);
  const raw = JSON.stringify(value);
  return withPage(async page => {
    await page.locator('#screen-home.active').waitFor();
    assert.equal(await page.locator('#screen-report.active').count(), 0);
    assert.equal(await page.evaluate(() => __pathwise.state.report), null);
    assert.equal(await rawValue(page), raw);
  }, seeded(raw));
});

test('the recovery notice fits a375px viewport without horizontal overflow', () => {
  const raw = JSON.stringify(legacy());
  return withPage(async page => {
    await page.locator('#profileNotice').waitFor({ state: 'visible' });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.equal(await page.locator('#resumeBtn').isHidden(), true);
  }, seeded(raw, { viewport: { width: 375, height: 812 } }));
});

for (const target of ['/teacher.html', '/advisor-edit.html']) test(`${target} loads isolated legacy restoration without changing current game and trait globals`, () => withPage(async page => {
  const result = await page.evaluate(record => {
    let raw = JSON.stringify({ format: 'bic-report-library', version: 1, exportedAt: '2026-10-02T00:00:00Z', records: [record] });
    const restored = ReportStore.create({ getItem: () => raw, setItem: (_, value) => { raw = value; } }).restore(record.id);
    return { profile: restored.state.assessmentProfile, answers: restored.state.mbti.answers, meta: restored.state.report.meta,
      html: renderReport(restored.state.report), currentPlan: PLAN_QUESTIONS.length, currentTraits: TRAIT_QUESTIONS.length };
  }, oldRecord());
  assert.equal(result.profile, 'legacy-2026.10'); assert.deepEqual(result.answers, oldRecord().state.mbti.answers);
  assert.equal(result.meta.batchId, 'OPEN-OLD-RECORD'); assert.match(result.html, /旧版24题/); assert.equal(result.currentPlan, 13); assert.equal(result.currentTraits, 30);
}, { path: target }));
