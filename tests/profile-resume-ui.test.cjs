const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { withPage } = require('./helpers/browser.cjs');
const KEY = 'pathwise.state.v1';
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

test('unmarked legacy progress is protected byte-for-byte at boot and both unload paths', () => {
  const raw = JSON.stringify(legacy(), null, 2);
  return withPage(async page => {
    assert.equal(await page.locator('#profileNotice').isVisible(), true); assert.match(await page.locator('#profileNoticeText').textContent(), /旧版/);
    assert.equal(await rawValue(page), raw); await page.evaluate(() => { window.dispatchEvent(new Event('pagehide')); window.dispatchEvent(new Event('beforeunload')); });
    assert.equal(await rawValue(page), raw); assert.equal(await page.evaluate(() => __pathwise.state.assessmentProfile), 'legacy-2026.10');
    assert.deepEqual(await page.evaluate(() => __pathwise.state.mbti.answers), legacy().mbti.answers);
  }, seeded(raw));
});

test('legacy scalar zero remains selected in the original24-question controls and planning remains14', () => withPage(async page => {
  assert.equal(await page.locator('#testMeta').textContent(), '1 / 24'); assert.match(await page.locator('#testTitle').textContent(), /旧版|MBTI/);
  assert.equal(await page.locator('.likert button[aria-checked=true]').getAttribute('data-v'), '0'); assert.equal(await page.locator('.trait-scene').count(), 0);
  await page.evaluate(() => __pathwise.startTest('plan')); assert.equal(await page.locator('#testMeta').textContent(), '1 / 14');
  assert.equal(await page.locator('.game-mount').count(), 0); assert.deepEqual(await page.evaluate(() => __pathwise.state.plan.answers.schoolSubjects), ['音乐', '自填课程']);
}, seeded(JSON.stringify(legacy()))));

test('raw JSON download preserves the exact original bytes and cancelled continue never enables writes', () => {
  const raw = JSON.stringify(legacy(), null, 3);
  return withPage(async page => {
    const downloaded = page.waitForEvent('download'); await page.locator('#profileRawDownloadBtn').click(); const file = await downloaded;
    assert.equal(fs.readFileSync(await file.path(), 'utf8'), raw);
    page.once('dialog', dialog => dialog.dismiss()); await page.locator('#profileContinueBtn').click();
    await page.locator('.likert button[data-v="4"]').click(); await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    assert.equal(await rawValue(page), raw);
  }, seeded(raw));
});

test('explicit confirmation permits saving the original scalar profile without wrapping or changing unanswered null', () => withPage(async page => {
  page.once('dialog', dialog => dialog.accept()); await page.locator('#profileContinueBtn').click();
  await page.locator('.likert button[data-v="4"]').click(); await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  const stored = JSON.parse(await rawValue(page)); assert.equal(stored.assessmentProfile, 'legacy-2026.10'); assert.equal(stored.mbti.answers.length, 24);
  assert.equal(stored.mbti.answers[0], 4); assert.equal(stored.mbti.answers[1], null); assert.equal(stored.academic.answers.en1, 0); assert.equal(stored.academic.answers.ma1, null);
}, seeded(JSON.stringify(legacy()))));

for (const [label, value] of [
  ['unknown marker', { ...legacy(), assessmentProfile: 'unknown-profile' }],
  ['mixed answers', { ...legacy(), mbti: { answers: [0, { value: 4, ms: 20 }] } }],
  ['already converted legacy', { ...legacy(), mbti: { answers: [{ value: 0, ms: null }, ...Array(29).fill(null)], legacy: true } }],
  ['broken JSON', '{broken-source'],
  ['broken answer collection', { ...legacy(), academic: { answers: [] } }]
]) test(`${label} permits raw recovery and explicit new testing but never silently overwrites`, () => {
  const raw = typeof value === 'string' ? value : JSON.stringify(value);
  return withPage(async page => {
    assert.equal(await page.locator('#profileNotice').isVisible(), true); assert.equal(await page.locator('#profileContinueBtn').isHidden(), true);
    await page.evaluate(() => { window.dispatchEvent(new Event('pagehide')); window.dispatchEvent(new Event('beforeunload')); }); assert.equal(await rawValue(page), raw);
    page.once('dialog', dialog => dialog.dismiss()); await page.locator('#profileRestartBtn').click(); assert.equal(await rawValue(page), raw);
    page.once('dialog', dialog => dialog.accept()); await page.locator('#profileRestartBtn').click();
    assert.equal(await page.evaluate(() => __pathwise.state.assessmentProfile), 'games-traits-v1'); assert.equal(JSON.parse(await rawValue(page)).mbti.answers.length, 30);
  }, seeded(raw));
});

test('new blank state uses the current profile and retains all four games and30 trait controls', () => withPage(async page => {
  assert.equal(await page.evaluate(() => __pathwise.state.assessmentProfile), 'games-traits-v1');
  await page.evaluate(() => __pathwise.startTest('mbti')); assert.equal(await page.locator('#testMeta').textContent(), '1 / 30'); assert.equal(await page.locator('.trait-scene').count(), 1);
  await page.evaluate(() => { __pathwise.state.ui.idx = 2; __pathwise.startTest('plan'); }); assert.equal(await page.locator('.game-mount').count(), 1);
  assert.equal(await page.evaluate(() => PLAN_QUESTIONS.filter(question => question.type === 'game').length), 4);
}));

test('unmarked current answers are protected first and never reinterpreted as scalar legacy', () => {
  const value = { ...legacy(), plan: { answers: { grade: '9', subjectBoard: { like: ['数学'], try: [], avoid: [] } } }, mbti: { answers: [{ value: 0, ms: 50 }, ...Array(29).fill(null)] } };
  const raw = JSON.stringify(value);
  return withPage(async page => { assert.equal(await page.locator('#profileNotice').isVisible(), true); assert.equal(await rawValue(page), raw);
    assert.equal(await page.locator('#testMeta').textContent(), '1 / 30'); assert.equal(await page.evaluate(() => __pathwise.state.assessmentProfile), 'games-traits-v1');
    await page.evaluate(() => window.dispatchEvent(new Event('beforeunload'))); assert.equal(await rawValue(page), raw);
  }, seeded(raw));
});

test('starting a new profile requires preservation confirmation and the recovery notice fits375px', () => {
  const raw = JSON.stringify(legacy());
  return withPage(async page => {
    await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    page.once('dialog', dialog => dialog.dismiss()); await page.locator('#profileRestartBtn').click(); assert.equal(await page.evaluate(() => __pathwise.state.assessmentProfile), 'legacy-2026.10'); assert.equal(await rawValue(page), raw);
    page.once('dialog', dialog => dialog.accept()); await page.locator('#profileRestartBtn').click(); assert.equal(await page.evaluate(() => __pathwise.state.assessmentProfile), 'games-traits-v1');
  }, seeded(raw, { viewport: { width: 375, height: 812 } }));
});

function oldRecord() {
  const value = legacy();
  return { id: 'old-profile-record', createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z', bankVersion: '2026.10', catalogVersion: 'unknown',
    state: { info: value.info, academic: value.academic, plan: value.plan, mbti: value.mbti }, reportMeta: { batchId: 'OPEN-OLD-RECORD', date: '2026-10-01' } };
}
test('opening an old library record resumes the original questionnaire and leaves its archive bytes unchanged', () => {
  const raw = JSON.stringify({ format: 'bic-report-library', version: 1, exportedAt: '2026-10-02T00:00:00Z', records: [oldRecord()] });
  return withPage(async page => {
    await page.locator('#libraryBtn').click(); page.once('dialog', dialog => dialog.accept()); await page.locator('[data-library-open]').click(); await page.locator('#screen-report.active').waitFor();
    assert.equal(await page.evaluate(() => __pathwise.state.assessmentProfile), 'legacy-2026.10');
    assert.equal(await page.evaluate(() => localStorage.getItem('bic.report-library.v1')), raw);
    await page.evaluate(() => __pathwise.startTest('mbti')); assert.equal(await page.locator('#testMeta').textContent(), '1 / 24');
    await page.evaluate(() => { __pathwise.state.ui.idx = 0; __pathwise.startTest('plan'); }); assert.equal(await page.locator('#testMeta').textContent(), '1 / 14');
  }, { beforeLoad: page => page.addInitScript(raw => localStorage.setItem('bic.report-library.v1', raw), raw) });
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

test('a complete blank legacy shape is recoverable and does not become a current30-item blank', () => {
  const value = { ...legacy(), info: { name: '', grade: '', year: '' }, academic: { answers: {} }, plan: { answers: {} }, mbti: { answers: Array(24).fill(null) }, ui: { screen: 'home', idx: 0 }, report: null };
  const raw = JSON.stringify(value);
  return withPage(async page => { assert.equal(await page.locator('#profileContinueBtn').isVisible(), true);
    assert.equal(await page.evaluate(() => __pathwise.state.assessmentProfile), 'legacy-2026.10'); assert.equal(await page.evaluate(() => __pathwise.state.mbti.answers.length), 24); assert.equal(await rawValue(page), raw);
  }, seeded(raw));
});

test('legacy report redraw keeps batch date neutral24 answers and advisor history actor while raw storage stays protected', () => {
  const value = legacy(); value.ui = { screen: 'report', idx: 0, resumeScreen: 'mbti' }; value.mbti.answers = Array(24).fill(2);
  return withPage(async page => {
    await page.locator('#screen-report.active').waitFor();
    const report = await page.evaluate(() => __pathwise.state.report);
    assert.equal(report.meta.assessmentProfile, 'legacy-2026.10'); assert.equal(report.meta.batchId, 'PRESERVED-OLD-REPORT'); assert.equal(report.meta.date, '2026-10-01');
    assert.equal(report.mbti.total, 24); assert.equal(report.mbti.answered, 24); assert.equal(report.mbti.hasSignal, false);
    assert.equal(report.advisor.sections.summary, '旧版顾问建议'); assert.equal(report.advisor.history.length, 1); assert.equal(report.advisor.history[0].actor.username, 'teacher.local');
    assert.match(await page.locator('#reportRoot').textContent(), /旧版24题/); assert.equal(await rawValue(page), await page.evaluate(() => __profileOriginalRaw));
  }, seeded(JSON.stringify(value), { prepare: async context => {
    const prefix = `{const key='pathwise.state.v1',s=JSON.parse(localStorage.getItem(key));s.report=window.generateReport(s);s.report.meta.batchId='PRESERVED-OLD-REPORT';s.report.meta.date='2026-10-01';
      window.reportEditing.applyEdit(s.report,'summary','旧版顾问建议','张老师');s.report.advisor.history[0].actor={kind:'school_advisor',user_id:'11111111-1111-1111-1111-111111111111',username:'teacher.local',grant_id:'22222222-2222-2222-2222-222222222222',source_revision:1,result_revision:2};
      window.__profileOriginalRaw=JSON.stringify(s,null,2);localStorage.setItem(key,window.__profileOriginalRaw);}\n`;
    await context.route('**/js/app.js', route => route.fulfill({ contentType: 'application/javascript', body: prefix + fs.readFileSync(path.join(__dirname, '../js/app.js'), 'utf8') }));
  } }));
});

for (const profile of ['legacy-2026.10', 'games-traits-v1']) test(`explicit skip and answer densifies only reached missing slots for ${profile}`, () => {
  const value = { ...legacy(), assessmentProfile: profile, plan: { answers: {} }, mbti: { answers: [] } };
  if (profile === 'games-traits-v1') { delete value.assessmentProfile; value.plan.answers.subjectBoard = { like: ['数学'], try: [], avoid: [] }; }
  const raw = JSON.stringify(value);
  return withPage(async page => {
    assert.equal(await rawValue(page), raw); assert.deepEqual(await page.evaluate(() => __pathwise.state.mbti.answers), []);
    page.once('dialog', dialog => dialog.accept()); await page.locator('#profileContinueBtn').click();
    await page.locator('#testSkip').click(); await page.locator('.likert button[data-v="4"]').click();
    const result = await page.evaluate(() => { const current = __pathwise.state; return { answers: current.mbti.answers, indices: Object.keys(current.mbti.answers),
      recognized: AssessmentProfiles.stateProfile(current), generated: generateReport(current).meta.assessmentProfile }; });
    assert.deepEqual(result.indices, ['0', '1']); assert.equal(result.answers[0], null);
    if (profile === 'legacy-2026.10') assert.equal(result.answers[1], 4); else assert.equal(result.answers[1].value, 4);
    assert.equal(result.recognized, profile); assert.equal(result.generated, profile);
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide'))); assert.equal(JSON.parse(await rawValue(page)).mbti.answers[0], null);
  }, seeded(raw));
});

test('cancelled legacy save permission still preserves raw bytes after skipping and answering a short scale', () => {
  const value = { ...legacy(), mbti: { answers: [] } }, raw = JSON.stringify(value);
  return withPage(async page => {
    page.once('dialog', dialog => dialog.dismiss()); await page.locator('#profileContinueBtn').click(); await page.locator('#testSkip').click(); await page.locator('.likert button[data-v="0"]').click();
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide'))); assert.equal(await rawValue(page), raw);
    assert.deepEqual(await page.evaluate(() => __pathwise.state.mbti.answers), [null, 0]);
  }, seeded(raw));
});

test('state read failure locks writes while memory-only answers work and unavailable raw export is never promised', () => {
  const raw = JSON.stringify(legacy(), null, 2);
  return withPage(async page => {
    const observed = () => page.evaluate(key => __nativeProgressRead(key), KEY);
    assert.equal(await observed(), raw); assert.match(await page.locator('#profileNoticeText').textContent(), /无法读取.*未覆盖.*本次.*作答/);
    assert.equal(await page.locator('#profileRawDownloadBtn').isHidden(), true); assert.equal(await page.locator('#profileContinueBtn').isHidden(), true);
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

test('a missing planning grade displays basic-info fallback without adding it to protected raw answers', () => {
  const value = legacy('plan'); value.plan.answers = {}; const raw = JSON.stringify(value);
  return withPage(async page => {
    assert.equal(await page.locator('#testBody .option.selected').getAttribute('data-v'), '9');
    assert.equal(await page.evaluate(() => Object.hasOwn(__pathwise.state.plan.answers, 'grade')), false); assert.equal(await rawValue(page), raw);
    await page.locator('#testBody .option[data-v="10"]').click();
    assert.deepEqual(await page.evaluate(() => [__pathwise.state.info.grade, __pathwise.state.plan.answers.grade]), ['10', '10']);
    await page.evaluate(() => window.dispatchEvent(new Event('beforeunload'))); assert.equal(await rawValue(page), raw);
  }, seeded(raw));
});
