const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const LEGACY = 'legacy-2026.10', CURRENT = 'games-traits-v1', KEY = 'bic.report-library.v1';
const plain = value => JSON.parse(JSON.stringify(value));
const envelope = (records, version = 1) => JSON.stringify({ format: 'bic-report-library', version, exportedAt: '2026-10-25T00:00:00.000Z', records });
function setup(initial = null) {
  const window = {}, context = vm.createContext({ window, Date, Math, console, setTimeout, requestAnimationFrame: callback => callback() });
  for (const file of ['js/bank.js', 'js/mbti.js', 'data/universities.js', 'js/majors.js', 'js/plan.js', 'js/personality.js', 'js/games.js',
    'js/assessment-profile.js', 'js/legacy-assessment.js', 'js/report.js', 'js/report-editing.js', 'js/report-view.js', 'js/report-store.js']) {
    const filename = path.join(__dirname, '..', file);
    if (fs.existsSync(filename)) vm.runInContext(fs.readFileSync(filename, 'utf8'), context, { filename: file });
  }
  let raw = initial, writes = 0, denied = false;
  const store = window.ReportStore.create({ getItem(key) { assert.equal(key, KEY); return raw; },
    setItem(key, value) { assert.equal(key, KEY); if (denied) throw new Error('quota'); raw = value; writes++; } });
  return { window, store, get raw() { return raw; }, get writes() { return writes; }, denyWrites() { denied = true; } };
}
function oldRecord(index = 1) {
  return { id: 'legacy-' + index, createdAt: '2026-10-20T00:00:00.000Z', updatedAt: '2026-10-20T01:00:00.000Z', bankVersion: '2026.10',
    state: { info: { name: '旧档同学' + index, grade: '', year: '2027 年秋季' }, academic: { answers: { en1: 0, ma1: null } },
      plan: { answers: { grade: '9', schoolSubjects: ['设计技术', '数学'], weakSubjects: [], groupSize: 'small', timeStyle: 'deep', preferredMajor: ['tech'], countries: ['uk'] } },
      mbti: { answers: [0, null, 2] } }, reportMeta: { batchId: 'OLD-' + index, date: '2026年10月20日' } };
}
function currentRecord(index = 1, marked = true) {
  return { id: 'current-' + index, createdAt: '2026-10-25T00:00:00.000Z', updatedAt: '2026-10-25T01:00:00.000Z', bankVersion: '2026.10', catalogVersion: null,
    ...(marked ? { assessmentProfile: CURRENT } : {}),
    state: { info: { name: '新档同学' + index, grade: '8', year: '2027 年秋季' }, academic: { answers: { en1: 0, ma1: null } },
      plan: { answers: { grade: '8', subjectBoard: { like: ['数学'], try: [], avoid: [] }, majorBoard: { heart: ['cs'], watch: [], skip: [] },
        career: ['science'], team: { pace: 'steady', partner: 'captain' }, preferredMajor: ['tech'], countries: ['uk'] } },
      mbti: { answers: [{ value: 0, ms: 900 }, null, { value: 2 }] } }, reportMeta: { batchId: 'NEW-' + index, date: '2026年10月25日' } };
}
function actorAdvisor() {
  return { sections: { academic: '逐字保留的学校建议。' }, history: [{ id: 'history-1', at: '2026-10-25T00:00:00.000Z', author: '学校顾问',
    section: 'academic', before: '', after: '逐字保留的学校建议。', action: 'edit', reportId: 'OLD-1',
    actor: { kind: 'school_advisor', user_id: '00000000-0000-4000-8000-000000000001', username: 'advisor.local',
      grant_id: '00000000-0000-4000-8000-000000000002', source_revision: 4, result_revision: 5 } }], lastAuthor: '学校顾问' };
}

test('legacy v1 reads and exports every original field value without filling grade arrays nulls or optional metadata', () => {
  const record = oldRecord(); record.advisor = actorAdvisor();
  const original = envelope([record]), f = setup(original);
  assert.deepEqual(plain(f.store.list()), [record]);
  const exported = JSON.parse(f.store.exportBackup());
  assert.equal(exported.version, 1); assert.deepEqual(exported.records, [record]);
  assert.equal(f.raw, original); assert.equal(f.writes, 0);
  assert.equal(Object.hasOwn(exported.records[0], 'catalogVersion'), false);
  assert.equal(exported.records[0].state.info.grade, '');
  const listed = f.store.list(); listed[0].advisor.history[0].actor.username = 'changed';
  assert.deepEqual(plain(f.store.list()), [record]);
});

test('legacy empty partial and complete neutral records roundtrip through whole-import without changing answers or audit', () => {
  const empty = oldRecord(1); empty.state.plan.answers = {}; empty.state.mbti.answers = []; empty.state.academic.answers = {};
  const partial = oldRecord(2); partial.advisor = actorAdvisor();
  const complete = oldRecord(3), f = setup();
  complete.state.info.grade = '8'; complete.state.academic.answers = Object.fromEntries(f.window.QUESTION_BANK.map(q => [q.id, q.answer]));
  complete.state.plan.answers = { grade: '8', interests: ['math'], schoolSubjects: ['数学'], weakSubjects: [], clubs: ['coding'], groupSize: 'small',
    timeStyle: 'deep', selfImage: ['rational'], preferredMajor: ['tech'], freeTime: ['make'], career: ['tech'], countries: ['uk'], subjectPerf: '0', preferredLength: 'short' };
  complete.state.mbti.answers = Array(24).fill(2);
  const records = [empty, partial, complete];
  assert.deepEqual(plain(f.store.previewImport(envelope(records))), { count: 3, added: 3, conflicts: 0 }); assert.equal(f.writes, 0);
  f.store.importBackup(envelope(records));
  assert.deepEqual(JSON.parse(f.store.exportBackup()).records, records);
  const restored = f.store.restore(complete.id);
  // 只有这一份完整旧版记录时整库仍是旧版容器的回显，版本维持旧版；
  // 页面续答旧版归档走的是统一后的当前版本（见下一项测试）。
  assert.equal(restored.state.assessmentProfile, LEGACY); assert.deepEqual(plain(restored.state.mbti.answers), Array(24).fill(2));
  assert.equal(restored.state.report.meta.assessmentProfile, LEGACY); assert.equal(restored.state.report.meta.status, 'complete');
  assert.equal(restored.state.report.mbti.code, null); assert.equal(restored.state.report.mbti.total, 24);
});

test('legacy restore preserves short null answers and source identity while adding only runtime profile/report/UI', () => {
  const record = oldRecord(); record.advisor = actorAdvisor(); const f = setup(envelope([record])); record.state.assessmentProfile = LEGACY;
  const restored = f.store.restore(record.id);
  for (const key of ['info', 'academic', 'plan', 'mbti', 'assessmentProfile']) assert.deepEqual(plain(restored.state[key]), record.state[key]); assert.equal(restored.state.mbti.answers.length, 3);
  assert.equal(restored.state.report.meta.batchId, record.reportMeta.batchId); assert.equal(restored.state.report.meta.date, record.reportMeta.date);
  assert.deepEqual(plain(restored.record), { ...record, state: Object.fromEntries(Object.entries(record.state).filter(([key]) => key !== 'assessmentProfile')) });
  assert.deepEqual(plain(restored.state.report.advisor), record.advisor);
  assert.equal(f.writes, 0);
});

test('new saves explicitly mark CURRENT and version2 while keeping archive state limited to the original four keys', () => {
  const f = setup(), record = currentRecord(), state = plain(record.state);
  state.assessmentProfile = CURRENT; state.report = f.window.generateReport(state); state.report.meta.batchId = record.reportMeta.batchId;
  const saved = f.store.save(state).record;
  assert.equal(saved.assessmentProfile, CURRENT); assert.equal(JSON.parse(f.raw).version, 2);
  assert.deepEqual(Object.keys(saved.state).sort(), ['academic', 'info', 'mbti', 'plan']);
  for (const key of ['info', 'academic', 'plan', 'mbti']) assert.deepEqual(plain(saved.state[key]), record.state[key]);
  assert.equal(f.store.restore(saved.id).state.assessmentProfile, CURRENT);
  assert.throws(() => f.store.exportCSV(), error => error.code === 'PROFILE' && /JSON/.test(error.message));
});

test('already released unmarked current v1 records are read/exported unchanged and acquire a marker only on a later explicit save', () => {
  const record = currentRecord(1, false), initial = envelope([record]), f = setup(initial);
  assert.deepEqual(plain(f.store.list()), [record]);
  assert.deepEqual(JSON.parse(f.store.exportBackup()).records, [record]); assert.equal(JSON.parse(f.store.exportBackup()).version, 1);
  assert.equal(f.raw, initial); assert.equal(f.writes, 0);
  const restored = f.store.restore(record.id); assert.equal(restored.state.assessmentProfile, CURRENT);
  f.store.save(restored.state, { overwrite: true });
  const saved = f.store.list()[0]; assert.equal(saved.id, record.id); assert.equal(saved.assessmentProfile, CURRENT);
  assert.equal(JSON.parse(f.raw).version, 2);
});

test('version2 mixes exact legacy records with explicitly current records and v1 cannot disguise a marked current record', () => {
  const records = [oldRecord(), currentRecord()], f = setup();
  f.store.importBackup(envelope(records, 2));
  assert.deepEqual(plain(f.store.list()), records); assert.deepEqual(JSON.parse(f.store.exportBackup()).records, records);
  assert.equal(JSON.parse(f.raw).version, 2);
  const before = f.raw;
  assert.throws(() => f.store.importBackup(envelope([currentRecord(2)], 1)));
  assert.equal(f.raw, before); assert.equal(f.writes, 1);
  assert.throws(() => f.store.exportCSV(), error => error.code === 'PROFILE');
  const legacyOnly = setup(envelope([oldRecord()], 2)); assert.equal(JSON.parse(legacyOnly.store.exportBackup()).version, 1);
});

test('legacy CSV delegates the sealed 17-column format and neutral classification instead of the new trait column', () => {
  const record = oldRecord(), f = setup(envelope([record]));
  const expected = f.window.LegacyAssessment.createStore({ getItem: () => envelope([record]), setItem() { throw new Error('CSV must not write'); } }).exportCSV();
  assert.equal(f.store.exportCSV(), expected); assert.ok(expected.includes('"性格倾向"')); assert.equal(expected.includes('"性格特质"'), false);
  assert.equal(f.writes, 0);
});

test('unknown mixed converted or inconsistent profiles quarantine raw data and block every write', () => {
  const changes = [
    r => { r.assessmentProfile = 'unknown'; }, r => { r.state.assessmentProfile = LEGACY; }, r => { r.state.assessmentProfile = 'unknown'; },
    r => { r.state.mbti.answers[1] = 1; }, r => { r.state.mbti.legacy = true; }
  ];
  // 记录标为旧版、旧版规划题却存成当前版的数组作答，分不清版本。
  // timeStyle 不是版本证据：它是当前版团队竞速的合法选项，旧版规划里的 timeStyle 随服务读取留在当前作答里也照常接受。
  // 组队人数、时间风格只属于旧版：不带标记、存成数组（任何一版都不是这个值）是混写；
  // 带旧版标记却留着旧版组队人数是旧版引擎写出的真实存档，不能混为一谈，只有存成数组才算混写。
  // 去掉标记的记录里，旧版组队人数的单选值由服务回显的当前形状作答照常接受，数组等其它值由上面各条形状识别接手。
  const mixed = [r => { r.assessmentProfile = LEGACY; r.state.plan.answers.groupSize = []; },
    r => { r.assessmentProfile = LEGACY; r.state.plan.answers.groupSize = 'small'; }];
  for (const change of changes.concat(mixed.map(change => r => { change(r); delete r.assessmentProfile; return r; }))) {
    const record = currentRecord(); change(record); const raw = envelope([record], 2), f = setup(raw); 
    assert.throws(() => f.store.list());
    assert.throws(() => f.store.remove(record.id));
    assert.throws(() => f.store.importBackup(envelope([oldRecord(2)])));
    assert.equal(f.store.rawBackup(), raw); assert.equal(f.raw, raw); assert.equal(f.writes, 0);
  }
});

test('current validation rejects unknown game/trait fields duplicate cards and invalid timings rather than silently filtering', () => {
  const changes = [
    r => { r.state.plan.answers.team.extra = 'discard me'; }, r => { r.state.plan.answers.subjectBoard.extra = []; },
    r => { r.state.plan.answers.subjectBoard.like = ['数学', '数学']; }, r => { r.state.plan.answers.subjectBoard.try = ['数学']; },
    r => { r.state.plan.answers.majorBoard.heart = ['unknown']; }, r => { r.state.plan.answers.career = ['science', 'science']; },
    r => { r.state.mbti.answers[0].extra = 'discard me'; }, r => { r.state.mbti.answers[0].ms = '900'; },
    r => { r.state.mbti.answers[0].value = true; }, r => { r.state.info.name = '\uD800'; }
  ];
  for (const change of changes) {
    const record = currentRecord(); change(record); const f = setup();
    assert.throws(() => f.store.importBackup(envelope([record], 2))); assert.equal(f.writes, 0);
  }
});

test('public state validation supports protected partial progress without normalization or fake defaults', () => {
  const f = setup(), legacy = plain(oldRecord().state), current = plain(currentRecord().state);
  for (const [state, profile] of [[legacy, LEGACY], [current, CURRENT]]) {
    state.info.name = ''; state.assessmentProfile = profile;
    const expected = plain(state); delete expected.assessmentProfile;
    assert.deepEqual(plain(f.window.ReportStore.validateState(state, profile, { allowBlankName: true })), expected);
    assert.throws(() => f.window.ReportStore.validateState(state, profile));
    assert.throws(() => f.window.ReportStore.validateState(state, profile === LEGACY ? CURRENT : LEGACY, { allowBlankName: true }));
    const invalid = plain(state); delete invalid.info.name;
    assert.throws(() => f.window.ReportStore.validateState(invalid, profile, { allowBlankName: true }));
  }
  assert.equal(f.writes, 0);
});

test('state validation checks original JSON values before cloning can erase nonfinite missing or non-JSON input', () => {
  const f = setup(), changes = [
    state => { state.academic.answers.ma1 = Infinity; }, state => { state.mbti.answers[0].ms = NaN; },
    state => { state.mbti.answers[0].ms = undefined; }, state => { state.mbti.answers[0].extra = undefined; },
    state => { delete state.mbti.answers[1]; }, state => { state.plan.answers = new Date(); },
    state => { state.info[Symbol('secret')] = 'not JSON'; }, state => { state.plan.answers.subjectBoard.self = state.plan.answers.subjectBoard; }
  ];
  for (const change of changes) {
    const state = plain(currentRecord().state); state.assessmentProfile = CURRENT; change(state);
    assert.throws(() => f.window.ReportStore.validateState(state, CURRENT));
  }
  assert.equal(f.writes, 0);
});

test('whole imports validate every profile before writing and conflict replacement stays explicit', () => {
  const first = oldRecord(), second = currentRecord(), f = setup(envelope([first]));
  const bad = currentRecord(2); bad.state.mbti.answers[0].value = 9;
  assert.throws(() => f.store.importBackup(envelope([second, bad], 2))); assert.equal(f.writes, 0);
  const changed = oldRecord(); changed.state.info.name = '备份中的旧姓名';
  f.store.importBackup(envelope([changed])); assert.equal(f.writes, 0); assert.equal(f.store.list()[0].state.info.name, first.state.info.name);
  f.store.importBackup(envelope([changed]), { onConflict: 'replace' }); assert.deepEqual(plain(f.store.list()), [changed]);
  assert.equal(f.writes, 1);
});

test('capacity history oversized input and failed storage writes preserve the exact prior library', () => {
  const records = Array.from({ length: 100 }, (_, index) => oldRecord(index)), full = setup(envelope(records));
  const original = full.raw;
  assert.throws(() => full.store.importBackup(envelope([currentRecord()], 2)));
  assert.throws(() => full.store.importBackup(' '.repeat(full.window.ReportStore.LIMITS.MAX_CHARS + 1)));
  assert.equal(full.raw, original); assert.equal(full.writes, 0);
  const overHistory = oldRecord(); overHistory.advisor = actorAdvisor(); overHistory.advisor.history = Array.from({ length: 201 }, (_, i) => ({ ...overHistory.advisor.history[0], id: 'history-' + i }));
  const f = setup(envelope([oldRecord()])); assert.throws(() => f.store.importBackup(envelope([overHistory]), { onConflict: 'replace' }));
  f.denyWrites(); const before = f.raw;
  assert.throws(() => f.store.importBackup(envelope([currentRecord()], 2))); assert.throws(() => f.store.remove('legacy-1'));
  assert.equal(f.raw, before); assert.equal(f.writes, 0);
});
