const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { loadReportScripts, legacyState: state } = require('./helpers/report.cjs');

const plain = value => JSON.parse(JSON.stringify(value));
const source = { source: 'synthetic' };
function setup(count = 20, complete = true) {
  const w = loadReportScripts();
  for (const name of ['report-store.js', 'report-statistics.js']) {
    const filename = path.join(__dirname, '../js', name);
    if (fs.existsSync(filename)) vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { window: w, Date });
  }
  let raw = null;
  const store = w.ReportStore.create({ getItem: () => raw, setItem: (_, value) => { raw = value; } });
  const value = state(w, complete);
  if (complete) value.plan.answers.preferredMajor = ['tech'];
  value.info.name = '私密学生标识';
  value.report = w.generateReport(value);
  value.report.meta.batchId = 'PRIVATE-BATCH';
  w.reportEditing.applyEdit(value.report, 'summary', '不得导出的私密顾问文字', '私密审核人');
  const seed = plain(store.save(value).record);
  const records = Array.from({ length: count }, (_, index) => ({ ...plain(seed), id: 'private-local-' + index,
    reportMeta: { ...plain(seed.reportMeta), batchId: 'PRIVATE-BATCH-' + index } }));
  return { w, records, get raw() { return raw; }, analyze(recordsValue = records, options = source) {
    assert.ok(w.ReportStatistics, 'The local aggregation module must exist');
    return plain(w.ReportStatistics.analyze(recordsValue, options));
  } };
}
function wrong(q) { return q.type === 'choice' ? (q.answer + 1) % q.options.length : q.answer + (q.tol || 0) + 1000; }
function fields(value) { return Object.keys(value).sort(); }

test('aggregate is a fixed de-identified schema with honest source and no calibration claim', () => {
  const f = setup();
  const before = JSON.stringify(f.records), stored = f.raw;
  const result = f.analyze();
  assert.deepEqual(fields(result), ['bankVersion', 'calibration', 'format', 'items', 'privacy', 'sample', 'subjects', 'version']);
  assert.equal(result.format, 'bic-academic-aggregate');
  assert.equal(result.version, 1);
  assert.equal(result.bankVersion, f.w.QUESTION_BANK_META.version);
  assert.deepEqual(result.sample, { unit: 'report', count: 20, source: 'synthetic', independence: 'operator_checked_not_verified' });
  assert.deepEqual(result.privacy, { minCell: 10, release: 'local_aggregate_not_anonymity_guarantee' });
  assert.deepEqual(result.calibration, { status: 'not_calibrated', followupOutcomes: false, thresholdsChanged: false });
  assert.doesNotMatch(JSON.stringify(result), /私密|PRIVATE-BATCH|private-local|2027|answers|advisor|history|author|createdAt|updatedAt|reportMeta|catalogVersion/);
  assert.equal(JSON.stringify(f.records), before);
  assert.equal(f.raw, stored, 'aggregation must not write the source report library');
});

test('complete subjects use current scoring and item rows retain only known question metadata', () => {
  const f = setup();
  const result = f.analyze();
  assert.deepEqual(result.subjects.map(value => value.key), ['english', 'maths', 'physics', 'chemistry']);
  for (const row of result.subjects) assert.deepEqual(row, { key: row.key, totalQuestions: 15, status: 'available', complete: 20, incomplete: 0, meanPctRounded5: 100 });
  assert.equal(result.items.length, 60);
  assert.deepEqual(result.items.map(row => row.id), plain(f.w.QUESTION_BANK.map(question => question.id)));
  for (const [index, row] of result.items.entries()) {
    const q = f.w.QUESTION_BANK[index];
    assert.deepEqual(row, { id: q.id, subject: q.subject, difficulty: q.difficulty, status: 'available', answered: 20, missing: 0,
      correct: 20, incorrect: 0, pctCorrect: 100, review: 'all_correct' });
  }
});

test('an explicit unverified real-sample declaration remains unverified in output', () => {
  const f = setup(10);
  assert.equal(f.analyze(f.records, { source: 'unverified_real' }).sample.source, 'unverified_real');
  assert.equal(f.analyze(f.records, { source: 'unverified_real' }).calibration.status, 'not_calibrated');
});

test('non-array input and unsupported options refuse to infer a cohort or source', () => {
  const f = setup(10);
  assert.ok(f.w.ReportStatistics, 'The local aggregation module must exist');
  for (const records of [null, {}, 'reports', 10]) assert.throws(() => f.analyze(records), /10|100|份|报告/);
  assert.throws(() => f.analyze(f.records, { source: 'synthetic', student: 'private name' }), /来源|样本/);
});

for (const count of [0, 1, 9, 101]) {
  test('cohort count ' + count + ' is rejected without exposing a small aggregate', () => {
    const f = setup(count);
    assert.throws(() => f.analyze(), /10|100|份|报告/);
  });
}

for (const options of [undefined, null, {}, { source: '' }, { source: 'real_verified' }, { source: true }]) {
  test('missing or unsupported source ' + JSON.stringify(options) + ' is refused', () => {
    const f = setup(10);
    assert.ok(f.w.ReportStatistics, 'The local aggregation module must exist');
    assert.throws(() => f.w.ReportStatistics.analyze(f.records, options), /来源|source|样本/);
  });
}

test('old or missing question-bank versions reject the entire batch before rescoring', () => {
  const f = setup(10);
  for (const version of ['older-version', 'unknown', '', null]) {
    const records = plain(f.records); records[2].bankVersion = version;
    assert.throws(() => f.analyze(records), /题库|版本/);
  }
});

test('academic-only aggregation permits differing admission catalogs without silently changing answers', () => {
  const f = setup(10);
  f.records[0].catalogVersion = 'old-catalog'; f.records[1].catalogVersion = null;
  assert.equal(f.analyze().subjects[0].meanPctRounded5, 100);
});

test('duplicate local IDs and report IDs cannot inflate the sample count', () => {
  const f = setup(10);
  for (const duplicate of ['id', 'report']) {
    const records = plain(f.records);
    if (duplicate === 'id') records[1].id = records[0].id;
    else records[1].reportMeta.batchId = records[0].reportMeta.batchId;
    assert.throws(() => f.analyze(records), /重复/);
  }
});

test('malformed records and extra answer/cache fields are rejected by the real archive contract', () => {
  const f = setup(10);
  assert.ok(f.w.ReportStatistics, 'The local aggregation module must exist');
  for (const alter of [r => { r.state.academic.answers.en1 = true; }, r => { r.state.academic.answers.unknown = 1; },
    r => { r.state.info.grade = '99'; }, r => { r.advisor.history[0].unknown = 'secret'; }, r => { r.cachedScore = 100; }]) {
    const records = plain(f.records); alter(records[0]);
    assert.throws(() => f.analyze(records));
  }
});

test('the whole selected serialized archive limit is checked before aggregating a large audit', () => {
  const f = setup(10);
  for (const record of f.records.slice(0, 2)) {
    record.advisor.history = Array.from({ length: 200 }, (_, index) => ({ ...plain(record.advisor.history[0]),
      id: 'audit-' + index, before: 'a'.repeat(4000), after: 'b'.repeat(4000) }));
  }
  assert.throws(() => f.analyze(), /上限|大小|2000000|字符/);
});

test('incomplete subjects do not turn unanswered work into zero-percent ability means', () => {
  const f = setup(10, false);
  for (const record of f.records) record.state.academic.answers.en1 = f.w.QUESTION_BANK[0].answer;
  const result = f.analyze();
  assert.deepEqual(result.subjects[0], { key: 'english', totalQuestions: 15, status: 'available', complete: 0, incomplete: 10, meanPctRounded5: null });
  assert.equal(result.items[0].pctCorrect, 100);
  assert.deepEqual(result.items[1], { id: 'en2', subject: 'english', difficulty: f.w.QUESTION_BANK[1].difficulty,
    status: 'available', answered: 0, missing: 10, correct: 0, incorrect: 0, pctCorrect: null, review: 'no_answers' });
});

test('a small incomplete complement suppresses the whole subject row including its mean', () => {
  const f = setup(20);
  delete f.records[0].state.academic.answers.en1;
  const result = f.analyze();
  assert.deepEqual(result.subjects[0], { key: 'english', totalQuestions: 15, status: 'suppressed' });
  assert.equal(result.subjects[1].complete, 20);
  assert.deepEqual(result.items[0], { id: 'en1', subject: 'english', difficulty: f.w.QUESTION_BANK[0].difficulty, status: 'suppressed' });
});

test('rare correct or incorrect cells suppress all item counts, denominator and percentage', () => {
  const f = setup(20);
  const q = f.w.QUESTION_BANK[0];
  f.records[0].state.academic.answers[q.id] = wrong(q);
  assert.deepEqual(f.analyze().items[0], { id: q.id, subject: q.subject, difficulty: q.difficulty, status: 'suppressed' });
  f.records.forEach((r, i) => { r.state.academic.answers[q.id] = i === 0 ? q.answer : wrong(q); });
  assert.deepEqual(fields(f.analyze().items[0]), ['difficulty', 'id', 'status', 'subject']);
});

test('complete, incomplete, correct, incorrect and missing cells at the threshold are released coherently', () => {
  const f = setup(30);
  const q = f.w.QUESTION_BANK[0];
  f.records.forEach((record, index) => {
    if (index < 10) record.state.academic.answers[q.id] = wrong(q);
    if (index >= 20) record.state.academic.answers[q.id] = null;
  });
  const result = f.analyze();
  assert.deepEqual(result.items[0], { id: q.id, subject: q.subject, difficulty: q.difficulty, status: 'available',
    answered: 20, missing: 10, correct: 10, incorrect: 10, pctCorrect: 50, review: 'descriptive_only' });
  assert.equal(result.subjects[0].complete, 20);
  assert.equal(result.subjects[0].incomplete, 10);
});

test('all-incorrect rows are reported separately from no-answer rows', () => {
  const f = setup(10);
  const q = f.w.QUESTION_BANK[0];
  f.records.forEach(record => { record.state.academic.answers[q.id] = wrong(q); });
  const row = f.analyze().items[0];
  assert.equal(row.review, 'all_incorrect'); assert.equal(row.pctCorrect, 0); assert.equal(row.missing, 0);
});

test('complete-only subject averages use raw correct counts and coarse five-point rounding', () => {
  const f = setup(20);
  const questions = f.w.QUESTION_BANK.filter(q => q.subject === 'maths');
  f.records.forEach((record, index) => questions.forEach((q, qIndex) => {
    record.state.academic.answers[q.id] = qIndex < (index < 10 ? 12 : 13) ? q.answer : wrong(q);
  }));
  assert.equal(f.analyze().subjects[1].meanPctRounded5, 85);
});

test('numeric conversion and tolerance are taken from the same report review as student reports', () => {
  const f = setup(30);
  const q = f.w.QUESTION_BANK.find(question => question.type === 'numeric' && question.tol > 0);
  f.records.forEach((record, index) => {
    record.state.academic.answers[q.id] = index < 10 ? ' ' + String(q.answer + q.tol / 2) + ' ' : index < 20 ? q.answer + q.tol * 2 : null;
  });
  const expected = f.records.map(record => f.w.generateReport(record.state).academic.review.find(item => item.q.id === q.id));
  const row = f.analyze().items.find(item => item.id === q.id);
  assert.equal(row.correct, expected.filter(item => item.correct).length);
  assert.equal(row.answered, expected.filter(item => item.answered).length);
  assert.equal(row.correct, 10); assert.equal(row.incorrect, 10); assert.equal(row.missing, 10);
});

test('cohorts with the same names remain distinct reports rather than falsely claiming person deduplication', () => {
  const f = setup(10);
  assert.equal(new Set(f.records.map(record => record.state.info.name)).size, 1);
  assert.equal(f.analyze().sample.count, 10);
  assert.equal(f.analyze().sample.independence, 'operator_checked_not_verified');
});

test('aggregation accepts the maximum 100 valid selected reports without mutating their metadata', () => {
  const f = setup(100);
  const before = JSON.stringify(f.records);
  assert.equal(f.analyze().sample.count, 100);
  assert.equal(JSON.stringify(f.records), before);
});
