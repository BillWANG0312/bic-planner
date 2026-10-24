const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { loadReportScripts, state } = require('./helpers/report.cjs');

const plain = value => JSON.parse(JSON.stringify(value));
const fields = value => Object.keys(value).sort();
class FixedDate extends Date {
  constructor(...args) { super(...(args.length ? args : ['2026-10-25T12:00:00Z'])); }
}
function setup(reportCount = 20, outcomeCount = 20, EngineDate = FixedDate) {
  const w = loadReportScripts();
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../js/report-store.js'), 'utf8'), { window: w, Date });
  const engineFile = path.join(__dirname, '../js/outcome-review.js');
  if (fs.existsSync(engineFile)) vm.runInNewContext(fs.readFileSync(engineFile, 'utf8'), { window: w, Date: EngineDate });
  let raw = null;
  const store = w.ReportStore.create({ getItem: () => raw, setItem: (_, text) => { raw = text; } });
  const value = state(w, false);
  value.info.name = '不得导出的私密同学';
  value.academic.answers = Object.fromEntries(w.QUESTION_BANK.filter(q => q.subject === 'maths').map(q => [q.id, q.answer]));
  value.report = w.generateReport(value); value.report.meta.batchId = 'PRIVATE-BATCH';
  w.reportEditing.applyEdit(value.report, 'summary', '不得导出的顾问自由文字', '私密审核者');
  const seed = plain(store.save(value).record);
  const records = Array.from({ length: reportCount }, (_, i) => ({ ...plain(seed), id: 'private-local-' + i,
    reportMeta: { ...plain(seed.reportMeta), batchId: 'PRIVATE-BATCH-' + i, date: '不可信任的中文展示日期' } }));
  const manifest = { format: 'bic-followup-results', version: 1, subject: 'maths', scale: 'school_percent_0_100',
    examDate: '2026-10-20', bankVersion: w.QUESTION_BANK_META.version, source: 'synthetic',
    outcomes: Array.from({ length: outcomeCount }, (_, i) => ({ studyId: 'PRIVATE_STUDY_' + i, score: i < 10 ? 0 : 100 })) };
  const bindings = Array.from({ length: Math.min(reportCount, outcomeCount) }, (_, i) => ({ studyId: manifest.outcomes[i].studyId,
    reportId: records[i].id, baselineDate: '2026-10-19' }));
  assert.ok(w.OutcomeReview, 'The pure follow-up review engine must exist before testing validation');
  function engine() { assert.ok(w.OutcomeReview, 'The pure follow-up review engine must exist'); return w.OutcomeReview; }
  return { w, records, manifest, bindings, get raw() { return raw; },
    parse(text = JSON.stringify(manifest)) { return plain(engine().parse(text)); },
    analyze(inputRecords = records, inputManifest = manifest, inputBindings = bindings) {
      return plain(engine().analyze(inputRecords, inputManifest, inputBindings));
    } };
}

test('strict imported manifest preserves zero and null without adding identities or coercing values', () => {
  const f = setup(); f.manifest.outcomes[0].score = null;
  assert.deepEqual(f.parse(), f.manifest);
  const parsed = f.parse(); parsed.outcomes[1].score = 30;
  assert.equal(f.manifest.outcomes[1].score, 0);
});

for (const text of [null, {}, '', 'not JSON', '\ufeff{}', ' '.repeat(100001)]) {
  test('manifest refuses unsupported or oversized text ' + (typeof text === 'string' ? text.length : typeof text), () => {
    const f = setup(); assert.throws(() => f.parse(text));
  });
}

test('manifest allows exactly the documented top-level keys and fixed scale subject source bank', () => {
  const f = setup();
  const changes = [{ format: 'other' }, { version: '1' }, { version: true }, { subject: 'biology' },
    { scale: 'a_level_grade' }, { source: 'real_verified' }, { bankVersion: 'unknown' }, { bankVersion: 'older' }, { name: 'private' }];
  for (const change of changes) assert.throws(() => f.parse(JSON.stringify({ ...f.manifest, ...change })));
  for (const key of Object.keys(f.manifest)) { const altered = plain(f.manifest); delete altered[key]; assert.throws(() => f.parse(JSON.stringify(altered))); }
});

test('study identifiers are unique case-sensitive bounded ASCII codes and cannot carry extra fields', () => {
  const f = setup();
  for (const studyId of ['', '-start', '白同学', 'id space', 'x'.repeat(41), '<img>']) {
    const altered = plain(f.manifest); altered.outcomes[0].studyId = studyId; assert.throws(() => f.parse(JSON.stringify(altered)));
  }
  const altered = plain(f.manifest); altered.outcomes[1].studyId = altered.outcomes[0].studyId;
  assert.throws(() => f.parse(JSON.stringify(altered)));
  altered.outcomes[1].studyId = altered.outcomes[0].studyId.toLowerCase();
  assert.equal(f.parse(JSON.stringify(altered)).outcomes.length, 20);
  altered.outcomes[0].name = 'private'; assert.throws(() => f.parse(JSON.stringify(altered)));
});

for (const score of [-0.01, 100.01, true, false, '0', '75', {}, [], undefined]) {
  test('imported score refuses ' + String(score), () => {
    const f = setup(); f.manifest.outcomes[0].score = score; assert.throws(() => f.parse());
  });
}

test('analyze revalidates direct manifests, including non-finite scores and unknown fields', () => {
  const f = setup();
  for (const score of [NaN, Infinity, -Infinity]) { const altered = plain(f.manifest); altered.outcomes[0].score = score; assert.throws(() => f.analyze(f.records, altered)); }
  for (const altered of [null, [], { ...f.manifest, arbitrary: 'private' }]) assert.throws(() => f.analyze(f.records, altered));
});

for (const count of [0, 101]) {
  test('manifest outcome count ' + count + ' is refused', () => { const f = setup(20, count); assert.throws(() => f.parse()); });
}

test('manifest accepts 1 and 100 rows and supported four subjects without mistaking one row for a releasable cohort', () => {
  const f = setup(10, 1); assert.equal(f.parse().outcomes.length, 1);
  assert.equal(f.analyze().status, 'suppressed');
  const large = setup(100, 100); assert.equal(large.parse().outcomes.length, 100);
  for (const subject of ['english', 'maths', 'physics', 'chemistry']) assert.equal(f.parse(JSON.stringify({ ...f.manifest, subject })).subject, subject);
});

test('calendar dates are exact, real and not future, including leap-day rules', () => {
  const f = setup();
  for (const examDate of ['2026-02-29', '2026-04-31', '2026-00-10', '2026-13-01', '2026-01-00', '2026-1-01',
    '2026-10-20T00:00:00Z', '2026-10-26', '2027-01-01', null, 20261020]) assert.throws(() => f.parse(JSON.stringify({ ...f.manifest, examDate })));
  for (const examDate of ['2024-02-29', '2026-10-25']) assert.equal(f.parse(JSON.stringify({ ...f.manifest, examDate })).examDate, examDate);
});

test('future boundary uses browser local calendar rather than UTC date', () => {
  class LocalNextDay extends Date {
    constructor(...args) { super(...(args.length ? args : ['2026-10-24T23:30:00Z'])); }
    getFullYear() { return 2026; } getMonth() { return 9; } getDate() { return 25; }
  }
  const f = setup(10, 10, LocalNextDay);
  assert.equal(f.parse(JSON.stringify({ ...f.manifest, examDate: '2026-10-25' })).examDate, '2026-10-25');
  assert.throws(() => f.parse(JSON.stringify({ ...f.manifest, examDate: '2026-10-26' })));
});

test('a fixed aggregate schema excludes study/report identifiers dates raw values and private prose', () => {
  const f = setup(); const before = JSON.stringify([f.records, f.manifest, f.bindings]), stored = f.raw;
  const result = f.analyze();
  assert.deepEqual(fields(result), ['bankVersion', 'calibration', 'counts', 'format', 'means', 'method', 'privacy', 'scale', 'source', 'status', 'subject', 'version']);
  assert.equal(result.format, 'bic-followup-review'); assert.equal(result.version, 1); assert.equal(result.status, 'available');
  assert.deepEqual(result.privacy, { minCell: 10, release: 'local_aggregate_not_anonymity_guarantee' });
  assert.deepEqual(result.method, { pairing: 'operator_selected', dates: 'operator_declared_order_checked', comparison: 'separate_coarse_means_not_equated' });
  assert.deepEqual(result.calibration, { status: 'not_calibrated', thresholdsChanged: false, realSampleValidation: false });
  assert.deepEqual(result.counts, { selectedReports: 20, outcomeRows: 20, usablePairs: 20, missingScorePairs: 0, unpairedReports: 0, unpairedOutcomes: 0 });
  assert.deepEqual(result.means, { baselinePctRounded5: 100, followupPctRounded5: 50 });
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|private-local|私密|顾问|studyId|reportId|baselineDate|examDate|2026-10-|answers|advisor|history|correlation|difference|error|prediction/);
  assert.equal(JSON.stringify([f.records, f.manifest, f.bindings]), before); assert.equal(f.raw, stored);
});

test('source remains an unverified operator declaration and old catalogs do not exclude complete target subjects', () => {
  const f = setup(); f.manifest.source = 'unverified_real'; f.records[0].catalogVersion = 'older-catalog';
  assert.equal(f.w.generateReport(f.records[0].state).meta.status, 'draft');
  const result = f.analyze(); assert.equal(result.source, 'unverified_real'); assert.equal(result.counts.usablePairs, 20);
  assert.equal(result.calibration.realSampleValidation, false);
});

for (const count of [0, 1, 9, 101]) {
  test('selected report count ' + count + ' is refused', () => { const f = setup(count, 20); assert.throws(() => f.analyze()); });
}

test('selected records use the strict archive duplicate field and whole-capacity contract', () => {
  const f = setup();
  for (const mutate of [r => { r.id = f.records[0].id; }, r => { r.reportMeta.batchId = f.records[0].reportMeta.batchId; },
    r => { r.state.academic.answers.ma1 = true; }, r => { r.state.info.grade = '99'; }, r => { r.cachedGrade = 100; },
    r => { r.bankVersion = 'older'; }, r => { delete r.state.academic.answers.ma1; }]) {
    const records = plain(f.records); mutate(records[1]); assert.throws(() => f.analyze(records));
  }
  const large = plain(f.records);
  for (const record of large.slice(0, 2)) record.advisor.history = Array.from({ length: 200 }, (_, i) => ({ ...plain(record.advisor.history[0]), id: 'entry-' + i, before: 'a'.repeat(4000), after: 'b'.repeat(4000) }));
  assert.throws(() => f.analyze(large));
});

test('bindings refuse malformed arrays, extra keys, unknown IDs and duplicate study/report mappings', () => {
  const f = setup();
  for (const input of [null, {}, 'bindings', new Array(101).fill({})]) assert.throws(() => f.analyze(f.records, f.manifest, input));
  for (const mutate of [b => { b.studyId = 'UNKNOWN'; }, b => { b.reportId = 'UNKNOWN'; }, b => { b.name = 'private'; },
    b => { delete b.baselineDate; }, b => { b.studyId = f.bindings[0].studyId; }, b => { b.reportId = f.bindings[0].reportId; }]) {
    const bindings = plain(f.bindings); mutate(bindings[1]); assert.throws(() => f.analyze(f.records, f.manifest, bindings));
  }
});

test('each binding requires an explicit real baseline date strictly before the supplied exam date', () => {
  const f = setup();
  for (const baselineDate of ['', '2026-02-30', '2026-10-20', '2026-10-21', '2026年10月19日', null, true]) {
    const bindings = plain(f.bindings); bindings[0].baselineDate = baselineDate;
    assert.throws(() => f.analyze(f.records, f.manifest, bindings));
  }
  f.records.forEach(record => { record.reportMeta.date = '未来2099年，不作时间证据'; record.createdAt = '2099-01-01T00:00:00Z'; });
  assert.equal(f.analyze().counts.usablePairs, 20, 'Archive timestamps must not override explicitly declared assessment dates');
});

test('zero is a usable score while null is a missing-score pair with no fabricated mean', () => {
  const f = setup(); f.manifest.outcomes.forEach(outcome => { outcome.score = null; });
  const missing = f.analyze(); assert.equal(missing.counts.usablePairs, 0); assert.equal(missing.counts.missingScorePairs, 20);
  assert.deepEqual(missing.means, { baselinePctRounded5: null, followupPctRounded5: null });
  f.manifest.outcomes.forEach(outcome => { outcome.score = 0; });
  assert.equal(f.analyze().means.followupPctRounded5, 0); assert.equal(f.analyze().counts.usablePairs, 20);
});

test('report and outcome decompositions retain paired-null and both unmatched populations separately', () => {
  const f = setup(40, 50); f.bindings.length = 30;
  f.manifest.outcomes.forEach((outcome, i) => { if (i >= 20 && i < 30) outcome.score = null; });
  const result = f.analyze();
  assert.deepEqual(result.counts, { selectedReports: 40, outcomeRows: 50, usablePairs: 20, missingScorePairs: 10, unpairedReports: 10, unpairedOutcomes: 20 });
  assert.equal(result.counts.selectedReports, result.counts.usablePairs + result.counts.missingScorePairs + result.counts.unpairedReports);
  assert.equal(result.counts.outcomeRows, result.counts.usablePairs + result.counts.missingScorePairs + result.counts.unpairedOutcomes);
});

test('no bindings are not inferred from shared names or from report-like study identifiers', () => {
  const f = setup(); f.manifest.outcomes.forEach((row, i) => { row.studyId = f.records[i].id; });
  const result = f.analyze(f.records, f.manifest, []);
  assert.deepEqual(result.counts, { selectedReports: 20, outcomeRows: 20, usablePairs: 0, missingScorePairs: 0, unpairedReports: 20, unpairedOutcomes: 20 });
  assert.deepEqual(result.means, { baselinePctRounded5: null, followupPctRounded5: null });
});

test('any small positive pair or unmatched complement suppresses all counts and means together', () => {
  const cases = [
    f => { f.bindings.length = 19; },
    f => { f.bindings.length = 1; },
    f => { f.manifest.outcomes[0].score = null; },
    f => { f.records.push({ ...plain(f.records[0]), id: 'extra-record', reportMeta: { ...f.records[0].reportMeta, batchId: 'EXTRA' } }); },
    f => { f.manifest.outcomes.push({ studyId: 'EXTRA', score: 40 }); }
  ];
  for (const change of cases) {
    const f = setup(); change(f); const result = f.analyze();
    assert.equal(result.status, 'suppressed'); assert.equal(Object.hasOwn(result, 'counts'), false); assert.equal(Object.hasOwn(result, 'means'), false);
    assert.doesNotMatch(JSON.stringify(result), /selectedReports|outcomeRows|usablePairs|missingScorePairs|unpaired|Rounded5/);
  }
});

test('means use only usable pairs and the existing precise grading before five-point rounding', () => {
  const f = setup(30, 20);
  const questions = f.w.QUESTION_BANK.filter(q => q.subject === 'maths');
  f.records.slice(0, 20).forEach((record, i) => questions.forEach((q, index) => {
    record.state.academic.answers[q.id] = index < (i < 10 ? 12 : 13) ? q.answer : q.type === 'choice' ? (q.answer + 1) % q.options.length : q.answer + 10000;
  }));
  f.manifest.outcomes.forEach((outcome, i) => { outcome.score = i < 10 ? 71 : 76; });
  const result = f.analyze(); assert.deepEqual(result.means, { baselinePctRounded5: 85, followupPctRounded5: 75 });
  assert.equal(result.counts.unpairedReports, 10);
});

test('one hundred valid reports results and bindings remain bounded and unchanged', () => {
  const f = setup(100, 100); const before = JSON.stringify([f.records, f.manifest, f.bindings]);
  assert.equal(f.analyze().counts.usablePairs, 100); assert.equal(JSON.stringify([f.records, f.manifest, f.bindings]), before);
});
