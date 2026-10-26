const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { loadReportScripts, legacyState: state } = require('./helpers/report.cjs');

const plain = value => JSON.parse(JSON.stringify(value));
const fields = value => Object.keys(value).sort();
function setup(count = 20) {
  const w = loadReportScripts();
  for (const name of ['report-store.js', 'report-statistics.js']) {
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../js', name), 'utf8'), { window: w, Date });
  }
  let raw = null;
  const store = w.ReportStore.create({ getItem: () => raw, setItem: (_, value) => { raw = value; } });
  const value = state(w, true);
  value.info.name = '不得导出的私密同学';
  for (const q of w.LegacyAssessment.planQuestions) {
    value.plan.answers[q.key] = q.type === 'single' ? q.options()[0].id : q.optional ? [] : [q.source()[0].id];
  }
  value.plan.answers.preferredMajor = ['tech']; value.plan.answers.countries = ['uk'];
  value.report = w.generateReport(value);
  assert.equal(value.report.meta.status, 'complete', 'Fixture must complete all real assessment requirements');
  value.report.meta.batchId = 'PRIVATE-ORIGINAL';
  w.reportEditing.applyEdit(value.report, 'summary', '不得导出的顾问自由文字', '私密审核者');
  const seed = plain(store.save(value).record);
  const records = Array.from({ length: count }, (_, i) => ({ ...plain(seed), id: 'private-local-' + i,
    reportMeta: { ...plain(seed.reportMeta), batchId: 'PRIVATE-BATCH-' + i } }));
  return { w, records, get raw() { return raw; }, analyze(options = { source: 'synthetic', planning: true }, input = records) {
    return plain(w.ReportStatistics.analyze(input, options));
  } };
}
function entry(table, key) { return table.entries.find(value => value.key === key); }
const metadata = (basis, selectionMode, status = 'suppressed') => ({ status, basis, selectionMode, denominator: 'included_reports' });
function assertSuppressed(table, basis, mode) {
  assert.deepEqual(table, metadata(basis, mode));
  assert.doesNotMatch(JSON.stringify(table), /included":|excluded|selectionCount|entries|count|pctOfIncluded/);
}

test('planning is explicit and false preserves the exact v1 academic aggregate', () => {
  const f = setup();
  const original = f.analyze({ source: 'synthetic' });
  assert.deepEqual(f.analyze({ source: 'synthetic', planning: false }), original);
  assert.equal(original.version, 1); assert.equal(Object.hasOwn(original, 'planning'), false);
  const expanded = f.analyze();
  assert.equal(expanded.version, 2);
  const { planning, ...academic } = expanded;
  assert.deepEqual({ ...academic, version: 1 }, original);
  assert.deepEqual(fields(planning), ['catalogVersion', 'recommendedMajors', 'regionPreferences', 'ruleBasis', 'statedMajorPreferences']);
  assert.equal(planning.ruleBasis, 'current_local_rules_recomputed');
  assert.equal(planning.catalogVersion, f.w.UNIVERSITY_CATALOG.version);
});

for (const value of [null, undefined, 0, 1, 'true', {}, []]) {
  test('planning mode refuses non-boolean ' + String(value), () => {
    const f = setup(10);
    assert.throws(() => f.analyze({ source: 'synthetic', planning: value }));
  });
}

test('only planning mode requires the current known admission catalog', () => {
  const f = setup(10);
  for (const version of ['old-catalog', null, 'unknown']) {
    f.records[0].catalogVersion = version;
    assert.equal(f.analyze({ source: 'synthetic' }).version, 1);
    assert.throws(() => f.analyze(), /目录|版本/);
  }
  f.records[0].catalogVersion = f.w.UNIVERSITY_CATALOG.version;
  f.w.UNIVERSITY_CATALOG = { ...f.w.UNIVERSITY_CATALOG, version: 'unknown' };
  assert.throws(() => f.analyze(), /目录|版本/);
});

test('three tables retain their distinct enum spaces and fixed data bases', () => {
  const f = setup();
  const result = f.analyze().planning;
  const recommended = result.recommendedMajors, preferred = result.statedMajorPreferences, region = result.regionPreferences;
  assert.equal(recommended.basis, 'complete_reports_current_rules'); assert.equal(recommended.selectionMode, 'single');
  assert.equal(preferred.basis, 'explicit_major_choices'); assert.equal(preferred.selectionMode, 'multiple');
  assert.equal(region.basis, 'explicit_region_choices'); assert.equal(region.selectionMode, 'multiple');
  for (const table of [recommended, preferred, region]) {
    assert.equal(table.status, 'available'); assert.equal(table.included, 20); assert.equal(table.excluded, 0);
    assert.equal(table.denominator, 'included_reports'); assert.equal(table.selectionCount, 20);
    assert.deepEqual(fields(table), ['basis', 'denominator', 'entries', 'excluded', 'included', 'selectionCount', 'selectionMode', 'status']);
    table.entries.forEach(row => assert.deepEqual(fields(row), ['count', 'key', 'pctOfIncluded']));
  }
  assert.deepEqual(recommended.entries.map(row => row.key), plain(f.w.MAJORS.map(major => major.id)));
  assert.deepEqual(preferred.entries.map(row => row.key), plain(f.w.INTEREST_OPTIONS.map(option => option.id)));
  assert.deepEqual(region.entries.map(row => row.key), plain(f.w.COUNTRY_OPTIONS.map(option => option.id)));
  assert.deepEqual(entry(preferred, 'tech'), { key: 'tech', count: 20, pctOfIncluded: 100 });
  assert.equal(entry(preferred, 'cs'), undefined);
});

test('rule recommendation uses only fully completed reports and keeps academic, planning and personality drafts excluded', () => {
  const f = setup(40);
  for (let i = 10; i < 20; i++) delete f.records[i].state.academic.answers.en1;
  for (let i = 20; i < 30; i++) f.records[i].state.mbti.answers = [];
  for (let i = 30; i < 40; i++) delete f.records[i].state.plan.answers.groupSize;
  const result = f.analyze().planning;
  assert.equal(result.recommendedMajors.included, 10); assert.equal(result.recommendedMajors.excluded, 30);
  const expected = f.w.generateReport(f.records[0].state).plan.top.major.id;
  assert.deepEqual(entry(result.recommendedMajors, expected), { key: expected, count: 10, pctOfIncluded: 100 });
  assert.equal(result.statedMajorPreferences.included, 40);
  assert.equal(result.regionPreferences.included, 40);
});

test('empty planning produces no artificial preferred majors or regions despite a default top recommendation', () => {
  const f = setup(10);
  f.records.forEach(record => { record.state.plan.answers = {}; });
  const tables = f.analyze().planning;
  for (const table of [tables.recommendedMajors, tables.statedMajorPreferences, tables.regionPreferences]) {
    assert.equal(table.status, 'available'); assert.equal(table.included, 0); assert.equal(table.excluded, 10);
    assert.equal(table.selectionCount, 0);
    table.entries.forEach(value => assert.deepEqual(value, { key: value.key, count: 0, pctOfIncluded: null }));
  }
});

test('explicit choices survive an incomplete whole report and do not use generated country recommendations', () => {
  const f = setup(20);
  f.records.forEach(record => {
    record.state.academic.answers = {};
    record.state.plan.answers = { preferredMajor: ['science'], countries: ['eu'] };
    record.state.mbti.answers = [];
  });
  const result = f.analyze().planning;
  assert.equal(result.recommendedMajors.included, 0);
  assert.deepEqual(entry(result.statedMajorPreferences, 'science'), { key: 'science', count: 20, pctOfIncluded: 100 });
  assert.deepEqual(entry(result.regionPreferences, 'eu'), { key: 'eu', count: 20, pctOfIncluded: 100 });
  assert.deepEqual(entry(result.regionPreferences, 'uk'), { key: 'uk', count: 0, pctOfIncluded: 0 });
});

test('multiple explicit options include unsure and use answered reports rather than all reports or selection counts', () => {
  const f = setup(30);
  f.records.forEach((record, i) => {
    record.state.plan.answers.preferredMajor = i < 20 ? ['tech', 'unsure'] : [];
    record.state.plan.answers.countries = i < 20 ? ['uk', 'us', 'unsure'] : [];
  });
  const result = f.analyze().planning;
  const major = result.statedMajorPreferences, region = result.regionPreferences;
  assert.equal(major.included, 20); assert.equal(major.excluded, 10); assert.equal(major.selectionCount, 40);
  assert.equal(region.included, 20); assert.equal(region.excluded, 10); assert.equal(region.selectionCount, 60);
  assert.equal(entry(major, 'unsure').count, 20);
  assert.equal(entry(region, 'unsure').count, 20);
  assert.equal(entry(region, 'uk').pctOfIncluded, 100);
  assert.equal(region.entries.reduce((sum, row) => sum + row.pctOfIncluded, 0), 300);
});

test('a rare explicit choice suppresses the entire table without listing any category or denominator', () => {
  const f = setup(20);
  f.records[0].state.plan.answers.preferredMajor = ['med'];
  f.records[0].state.plan.answers.countries = ['sg'];
  const result = f.analyze().planning;
  assertSuppressed(result.statedMajorPreferences, 'explicit_major_choices', 'multiple');
  assertSuppressed(result.regionPreferences, 'explicit_region_choices', 'multiple');
});

test('a rare unselected complement suppresses a multi-select table even when every positive selected count is large', () => {
  const f = setup(20);
  f.records.forEach((record, i) => {
    record.state.plan.answers.preferredMajor = i ? ['tech', 'unsure'] : ['unsure'];
    record.state.plan.answers.countries = i ? ['uk', 'us'] : ['us'];
  });
  const result = f.analyze().planning;
  assertSuppressed(result.statedMajorPreferences, 'explicit_major_choices', 'multiple');
  assertSuppressed(result.regionPreferences, 'explicit_region_choices', 'multiple');
});

test('rare missing or included reports suppress the whole preference table instead of exposing their complement', () => {
  const f = setup(20);
  f.records[0].state.plan.answers.countries = [];
  assertSuppressed(f.analyze().planning.regionPreferences, 'explicit_region_choices', 'multiple');
  f.records.forEach((record, i) => { record.state.plan.answers.countries = i ? [] : ['uk']; });
  assertSuppressed(f.analyze().planning.regionPreferences, 'explicit_region_choices', 'multiple');
});

test('rare incomplete report complements suppress the whole rule recommendation table', () => {
  const f = setup(20);
  f.records[0].state.mbti.answers = [];
  assertSuppressed(f.analyze().planning.recommendedMajors, 'complete_reports_current_rules', 'single');
  f.records.forEach((record, i) => { if (i) record.state.academic.answers = {}; });
  // Zero complete reports is a releasable empty distribution, not a small nonzero result.
  assert.equal(f.analyze().planning.recommendedMajors.included, 0);
});

test('two ten-report choice groups and their complements are released at the boundary', () => {
  const f = setup(20);
  f.records.forEach((record, i) => {
    record.state.plan.answers.preferredMajor = i < 10 ? ['tech'] : ['med'];
    record.state.plan.answers.countries = i < 10 ? ['uk'] : ['us'];
  });
  const result = f.analyze().planning;
  for (const table of [result.statedMajorPreferences, result.regionPreferences]) {
    assert.equal(table.status, 'available'); assert.equal(table.included, 20); assert.equal(table.excluded, 0);
    assert.equal(table.entries.filter(row => row.count === 10 && row.pctOfIncluded === 50).length, 2);
  }
});

test('invalid enum options and duplicate choices cannot inflate selections through a malformed archive', () => {
  const f = setup(10);
  for (const alter of [r => { r.state.plan.answers.preferredMajor = ['cs']; },
    r => { r.state.plan.answers.countries = ['secret free text']; },
    r => { r.state.plan.answers.countries = ['uk', 'uk']; }]) {
    const records = plain(f.records); alter(records[0]);
    assert.throws(() => f.analyze(undefined, records));
  }
});

test('expanded output has only public fixed metadata and aggregates, preserves calibration status and source records', () => {
  const f = setup(20);
  f.records.forEach(record => { record.state.plan.answers.schoolSubjects.push('私密自由学科'); });
  const before = JSON.stringify(f.records), stored = f.raw;
  const output = f.analyze();
  assert.deepEqual(fields(output), ['bankVersion', 'calibration', 'format', 'items', 'planning', 'privacy', 'sample', 'subjects', 'version']);
  assert.doesNotMatch(JSON.stringify(output), /不得导出|私密|PRIVATE-|private-local|answers|history|author|reportMeta|createdAt|updatedAt|year/);
  assert.deepEqual(output.calibration, { status: 'not_calibrated', followupOutcomes: false, thresholdsChanged: false });
  assert.equal(JSON.stringify(f.records), before); assert.equal(f.raw, stored);
});
