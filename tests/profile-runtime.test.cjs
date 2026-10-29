const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), cp = require('node:child_process'), crypto = require('node:crypto');
const root = path.resolve(__dirname, '..'), plain = value => JSON.parse(JSON.stringify(value));
const FixedDate = class extends Date { constructor(...args) { super(...(args.length ? args : ['2026-10-25T00:00:00Z'])); } static now() { return 1792886400000; } };
function setup() {
  const window = {}, context = vm.createContext({ window, console, Date: FixedDate, setTimeout, requestAnimationFrame: fn => fn() });
  for (const file of ['js/bank.js', 'js/mbti.js', 'data/universities.js', 'js/majors.js', 'js/plan.js', 'js/personality.js', 'js/games.js', 'js/assessment-profile.js', 'js/legacy-assessment.js', 'js/report.js', 'js/report-editing.js', 'js/report-view.js']) {
    assert.ok(fs.existsSync(path.join(root, file)), `Required isolated runtime ${file}`);
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  }
  return window;
}
function state() { return { info: { name: '虚构同学', grade: '', year: '' }, academic: { answers: { ma5: null, en1: 0 } }, plan: { answers: {} }, mbti: { answers: [0, null, 2] } }; }
function record(value = state()) { return { id: 'fictional-archive', createdAt: '2026-10-24T00:00:00Z', updatedAt: '2026-10-24T00:00:00Z', bankVersion: '2026.10', state: value, reportMeta: { batchId: 'FAKE-1', date: '2026/10/24' } }; }

test('runtime modules exist and expose the agreed isolated APIs', () => {
  const w = setup();
  assert.equal(w.AssessmentProfiles.LEGACY, 'legacy-2026.10'); assert.equal(w.AssessmentProfiles.CURRENT, 'games-traits-v1');
  for (const key of ['stateProfile', 'recordProfile', 'reportProfile', 'requireRecord']) assert.equal(typeof w.AssessmentProfiles[key], 'function');
  for (const key of ['generateReport', 'renderReport', 'createStore', 'validateRecord', 'validateState']) assert.equal(typeof w.LegacyAssessment[key], 'function');
  assert.equal(w.LegacyAssessment.planQuestions.length, 14); assert.equal(w.LegacyAssessment.mbtiQuestions.length, 24);
  assert.equal(w.PLAN_QUESTIONS.length, 13); assert.equal(w.TRAIT_QUESTIONS.length, 30);
  assert.notEqual(w.LegacyAssessment.planQuestions, w.PLAN_QUESTIONS); assert.notEqual(w.LegacyAssessment.planConfig, w.PLAN_CONFIG);
});

test('unmarked old numeric/null and empty states stay legacy while modern evidence and markers are explicit', () => {
  const w = setup(), p = w.AssessmentProfiles;
  for (const value of [{}, state(), { ...state(), mbti: { answers: [] } }, { ...state(), mbti: { answers: [null] } }]) assert.equal(p.stateProfile(value), p.LEGACY);
  for (const value of [{ ...state(), assessmentProfile: p.CURRENT, mbti: { answers: [] } },
    { ...state(), mbti: { answers: [{ value: 0, ms: 0 }] } }, { ...state(), mbti: { answers: Array(30).fill(null) } },
    { ...state(), plan: { answers: { subjectBoard: {} } }, mbti: { answers: [] } }]) assert.equal(p.stateProfile(value), p.CURRENT);
  assert.equal(p.recordProfile(record()), p.LEGACY);
  const modern = record({ ...state(), mbti: { answers: [{ value: 4, ms: null }] } });
  assert.equal(p.recordProfile(modern), p.CURRENT); assert.equal(p.requireRecord(modern), modern);
  assert.throws(() => p.requireRecord({ ...record(), assessmentProfile: 'unknown' }), error => error.code === 'PROFILE');
});

for (const [label, alter] of [
  // 数字与对象、数字与空位的混排都由旧版字段校验拒绝（见下一组），作答形状识别只认完整的结构化作答。
  ['unknown marker', s => { s.assessmentProfile = 'unknown'; }],
  ['legacy converted', s => { s.mbti = { answers: [{ value: 0 }], legacy: true }; }],
  ['malformed personality', s => { s.mbti.answers = 'private'; }]
]) test(`profile refuses ${label} without rewriting source`, () => {
  const p = setup().AssessmentProfiles, value = state(); alter(value); const before = plain(value);
  assert.throws(() => p.stateProfile(value), error => error.code === 'PROFILE' && !error.message.includes('private'));
  assert.deepEqual(value, before);
});

// 带版本标记的新旧混写仍按作答识别版本，由旧版字段校验拒绝：旧版标记配当前版规划题、
// 当前版标记配 24 个数字（当前版题量是 30）、旧版标记配当前版对象作答、数字与对象混排。
for (const [label, alter] of [
  ['legacy marker/game', s => { s.assessmentProfile = 'legacy-2026.10'; s.plan.answers.majorBoard = {}; }],
  ['current marker/numeric', s => { s.assessmentProfile = 'games-traits-v1'; }],
  ['legacy marker/new personality', s => { s.assessmentProfile = 'legacy-2026.10'; s.mbti.answers = [{ value: 0 }]; }],
  ['numeric 30', s => { s.mbti.answers = Array(30).fill(2); }],
  ['mixed object/numeric', s => { s.mbti.answers = [{ value: 4 }, 0]; }], ['mixed numeric/object', s => { s.mbti.answers = [0, { value: 4 }]; }]
]) test(`legacy validation refuses ${label} without rewriting source`, () => {
  const w = setup(), value = state(); alter(value); const before = plain(value);
  assert.throws(() => w.LegacyAssessment.validateState(value, { allowBlankName: true }), error => error.code === 'VALIDATION');
  assert.deepEqual(value, before);
});

test('legacy record validation retains omission/null/zero/order/grade and actor/origin exactly', () => {
  const w = setup(), value = record(); value.state.plan.answers = { grade: '9', countries: ['hk', 'uk'], weakSubjects: ['自选科目'] };
  value.advisor = { sections: { plan: '原建议' }, history: [{ id: 'history-1', at: '2026-10-24T00:00:00Z', author: '虚构顾问', section: 'plan', before: '', after: '原建议', action: 'edit', reportId: 'FAKE-1',
    actor: { kind: 'school_advisor', user_id: '00000000-0000-4000-8000-000000000001', username: 'teacher.test', grant_id: '00000000-0000-4000-8000-000000000002', source_revision: 1, result_revision: 2 } }] };
  const before = plain(value), validated = w.LegacyAssessment.validateRecord(value);
  assert.deepEqual(plain(validated), before); assert.deepEqual(value, before); assert.equal(Object.hasOwn(validated, 'catalogVersion'), false);
  validated.state.mbti.answers[0] = 4; assert.equal(value.state.mbti.answers[0], 0);
  value.advisor.history[0].origin = { kind: 'rule', draft_id: '00000000-0000-4000-8000-000000000003', generator: 'rules', source_revision: 1 };
  assert.throws(() => w.LegacyAssessment.validateRecord(value));
});

test('legacy continuation validates blank name only when requested and does not fill fields', () => {
  const w = setup(), value = state(); value.info.name = ''; value.assessmentProfile = w.AssessmentProfiles.LEGACY;
  assert.throws(() => w.LegacyAssessment.validateState(value));
  const validated = w.LegacyAssessment.validateState(value, { allowBlankName: true });
  const expected = plain(value); delete expected.assessmentProfile;
  assert.deepEqual(plain(validated), expected); assert.equal(validated.mbti.answers.length, 3); assert.equal(validated.academic.answers.ma5, null);
  for (const bad of [undefined, 1]) { value.info.name = bad; assert.throws(() => w.LegacyAssessment.validateState(value, { allowBlankName: true })); }
});

test('legacy validation accepts ordinary shared references but rejects cycles without leaking values', () => {
  const w = setup(), value = record(), list = ['uk']; value.state.plan.answers.countries = list; value.state.plan.answers.interests = ['math'];
  const actor = { kind: 'school_advisor', user_id: '00000000-0000-4000-8000-000000000001', username: 'teacher.test', grant_id: '00000000-0000-4000-8000-000000000002', source_revision: 1, result_revision: 2 };
  const shared = { section: 'plan', at: '2026-10-24T00:00:00Z', author: '顾问', before: '', after: '建议', action: 'edit', reportId: 'FAKE-1', actor };
  value.advisor = { sections: {}, history: [{ ...shared, id: 'one' }, { ...shared, id: 'two' }] };
  assert.deepEqual(plain(w.LegacyAssessment.validateRecord(value)), plain(value));
  value.state.plan.answers.countries = value;
  assert.throws(() => w.LegacyAssessment.validateRecord(value), error => error.code === 'VALIDATION');
});

test('frozen store restore reports carry the legacy marker without touching raw archived source', () => {
  const w = setup(), value = record(), raw = JSON.stringify({ format: 'bic-report-library', version: 1, exportedAt: '2026-10-25T00:00:00Z', records: [value] });
  const store = w.LegacyAssessment.createStore({ getItem: () => raw, setItem: () => assert.fail('Read-only restore cannot write') });
  const restored = store.restore(value.id); assert.equal(restored.state.report.meta.assessmentProfile, w.AssessmentProfiles.LEGACY);
  assert.equal(store.rawBackup(), raw);
});

for (const [label, alter] of [
  ['unknown key', r => { r.secret = 'private'; }], ['unknown plan', r => { r.state.plan.answers.unrecognized = []; }],
  ['bad scale', r => { r.state.mbti.answers = [true]; }], ['bad free subject', r => { r.state.plan.answers.weakSubjects = ['']; }],
  ['nonfinite', r => { r.state.academic.answers.ma5 = Infinity; }], ['lone surrogate', r => { r.state.info.name = '\ud800'; }],
  ['undefined', r => { r.state.plan.answers.countries = undefined; }]
]) test(`strict legacy validation rejects ${label} instead of normalizing it away`, () => assert.throws(() => { const r = record(); alter(r); setup().LegacyAssessment.validateRecord(r); }));

test('legacy report engine and renderer match fixed Git source for blank partial complete neutral and free subjects', () => {
  const w = setup(), legacy = w.LegacyAssessment, context = vm.createContext({ window: {}, Date: FixedDate, console, setTimeout, requestAnimationFrame: fn => fn() });
  for (const file of ['js/bank.js', 'js/mbti.js', 'data/universities.js', 'js/majors.js', 'js/plan.js', 'js/report.js', 'js/report-editing.js', 'js/report-view.js']) vm.runInContext(cp.execFileSync('git', ['show', 'a10d557:' + file], { cwd: root, encoding: 'utf8' }), context);
  const old = context.window, full = state(); full.info.grade = '8'; full.academic.answers = Object.fromEntries(old.QUESTION_BANK.map(q => [q.id, q.answer]));
  full.plan.answers = Object.fromEntries(old.PLAN_QUESTIONS.filter(q => !q.optional).map(q => [q.key, q.type === 'single' ? q.options()[0].id : [q.source()[0].id]]));
  full.mbti.answers = Array(24).fill(2);
  for (const value of [state(), { ...state(), academic: { answers: {} }, mbti: { answers: [] } }, full,
    { ...full, plan: { answers: { ...full.plan.answers, schoolSubjects: ['自选学科'], weakSubjects: [] } } }]) {
    // 业务结果与冻结旧源逐字一致；旧版报告按旧版习惯不带 games（小游戏属于当前版本），meta 只多出测评版本。
    const expected = old.generateReport(value), actual = w.generateReport({ ...value, assessmentProfile: w.AssessmentProfiles.LEGACY });
    assert.equal(actual.meta.assessmentProfile, w.AssessmentProfiles.LEGACY); assert.equal('games' in actual, false);
    delete actual.meta.assessmentProfile; assert.deepEqual(plain(actual), plain(expected)); assert.equal(actual.mbti.total, 24);
    const html = w.renderReport(actual); assert.ok(html.includes('旧版24题')); assert.ok(html.endsWith(old.renderReport(expected)));
  }
});

test('modern game/trait reports remain modern and mixed report metadata is rejected', () => {
  const w = setup(), value = state(); value.assessmentProfile = w.AssessmentProfiles.CURRENT; value.mbti.answers = w.TRAIT_QUESTIONS.map(() => ({ value: 4, ms: 900 }));
  const report = w.generateReport({ ...value, assessmentProfile: w.AssessmentProfiles.CURRENT }); assert.equal(report.meta.assessmentProfile, w.AssessmentProfiles.CURRENT); assert.equal(report.mbti.total, 30);
  assert.equal(w.AssessmentProfiles.reportProfile(report), w.AssessmentProfiles.CURRENT); assert.ok(w.renderReport(report).includes('性格特质'));
  report.meta.assessmentProfile = w.AssessmentProfiles.LEGACY; assert.throws(() => w.renderReport(report), error => error.code === 'PROFILE');
});

test('frozen source manifest and generated bundle check offline without browser eval', () => {
  const w = setup(), manifest = JSON.parse(fs.readFileSync(path.join(root, 'js/legacy/manifest.json'), 'utf8'));
  assert.equal(manifest.source_revision, cp.execFileSync('git', ['rev-parse', 'a10d557'], { cwd: root, encoding: 'utf8' }).trim());
  for (const item of manifest.files) {
    const frozen = fs.readFileSync(path.join(root, item.file), 'utf8').replace(/\r\n/g, '\n');
    const original = cp.execFileSync('git', ['show', manifest.source_revision + ':' + item.source], { cwd: root, encoding: 'utf8' }).replace(/\r\n/g, '\n');
    assert.equal(frozen, original); assert.equal(crypto.createHash('sha256').update(frozen).digest('hex'), item.sha256);
  }
  const result = cp.spawnSync(process.execPath, ['backend/tools/legacy-assessment.cjs', '--check'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr); assert.equal(typeof w.LegacyAssessment.generateReport, 'function');
  const bundle = fs.readFileSync(path.join(root, 'js/legacy-assessment.js'), 'utf8'); assert.doesNotMatch(bundle, /\beval\s*\(|new Function\s*\(/);
});

test('offline bundle check works after extraction with CRLF and rejects modified frozen source or stale output', () => {
  const scratch = path.join(require('node:os').tmpdir(), 'bic-tests'), tempRoot = path.join(scratch, 'profile-offline-');
  fs.mkdirSync(path.dirname(tempRoot), { recursive: true });
  const extracted = fs.mkdtempSync(tempRoot);
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'js/legacy/manifest.json'), 'utf8'));
    const files = ['backend/tools/legacy-assessment.cjs', 'js/legacy-assessment.js', 'js/legacy/manifest.json', ...manifest.files.map(file => file.file)];
    for (const file of files) { const out = path.join(extracted, file); fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n').replace(/\n/g, '\r\n')); }
    const check = () => cp.spawnSync(process.execPath, ['backend/tools/legacy-assessment.cjs', '--check'], { cwd: extracted, encoding: 'utf8' });
    assert.equal(check().status, 0);
    const source = path.join(extracted, manifest.files[0].file); fs.appendFileSync(source, '\n// changed'); assert.notEqual(check().status, 0);
    fs.writeFileSync(source, fs.readFileSync(path.join(root, manifest.files[0].file), 'utf8'));
    fs.appendFileSync(path.join(extracted, 'js/legacy-assessment.js'), '\n// stale'); assert.equal(check().status, 1);
  } finally { assert.ok(path.resolve(extracted).toLowerCase().startsWith(path.resolve(scratch).toLowerCase() + path.sep)); fs.rmSync(extracted, { recursive: true, force: true }); }
});
