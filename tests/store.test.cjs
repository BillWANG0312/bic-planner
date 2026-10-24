const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { loadReportScripts, state } = require('./helpers/report.cjs');

const KEY = 'bic.report-library.v1';
const plain = value => JSON.parse(JSON.stringify(value));
function setup(initial = null) {
  const w = loadReportScripts();
  const filename = path.join(__dirname, '../js/report-store.js');
  if (fs.existsSync(filename)) vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { window: w, Date, console });
  assert.ok(w.ReportStore, '本地报告库模型应存在');
  let raw = initial;
  let writes = 0;
  let fail = false;
  const storage = {
    getItem(key) { assert.equal(key, KEY); return raw; },
    setItem(key, value) { assert.equal(key, KEY); if (fail) throw new Error('quota'); raw = value; writes++; }
  };
  const store = w.ReportStore.create(storage);
  const current = (name = '测试同学', id = 'AP-TEST') => {
    const value = state(w, true);
    value.plan.answers.preferredMajor = ['tech'];
    value.info.name = name;
    value.report = w.generateReport(value);
    value.report.meta.batchId = id;
    value.ui = { screen: 'report', idx: 3 };
    return value;
  };
  return { w, store, current, get raw() { return raw; }, get writes() { return writes; }, failWrites() { fail = true; } };
}
const backup = records => JSON.stringify({ format: 'bic-report-library', version: 1, exportedAt: new Date().toISOString(), records });

test('archive keeps only responses, report identity and validated advisor history', () => {
  const f = setup();
  const value = f.current();
  f.w.reportEditing.applyEdit(value.report, 'plan', '先体验课程，再讨论专业。', '王老师');
  const saved = f.store.save(value);
  assert.equal(saved.updated, false);
  assert.equal(f.writes, 1);
  assert.equal(saved.record.reportMeta.batchId, 'AP-TEST');
  assert.equal(saved.record.bankVersion, f.w.QUESTION_BANK_META.version);
  assert.equal(saved.record.catalogVersion, f.w.UNIVERSITY_CATALOG.version);
  assert.deepEqual(Object.keys(saved.record.state).sort(), ['academic', 'info', 'mbti', 'plan']);
  assert.equal(saved.record.advisor.history[0].reportId, 'AP-TEST');
  assert.equal(saved.record.advisor.sections.plan, '先体验课程，再讨论专业。');
  assert.ok(!f.raw.includes('reviewStatus'));
  assert.ok(!f.raw.includes('admissionsRequirements'));
  saved.record.state.info.name = '外部篡改';
  assert.equal(f.store.list()[0].state.info.name, '测试同学');
  const listed = f.store.list();
  listed[0].advisor.history.length = 0;
  assert.equal(f.store.list()[0].advisor.history.length, 1);
});

test('duplicate report identities require explicit overwrite and preserve archive identity', () => {
  const f = setup();
  const first = f.store.save(f.current()).record;
  const changed = f.current('更新姓名');
  assert.throws(() => f.store.save(changed), error => error.code === 'DUPLICATE');
  assert.equal(f.writes, 1);
  const updated = f.store.save(changed, { overwrite: true });
  assert.equal(updated.updated, true);
  assert.equal(updated.record.id, first.id);
  assert.equal(updated.record.createdAt, first.createdAt);
  assert.equal(f.store.list().length, 1);
  assert.equal(f.store.list()[0].state.info.name, '更新姓名');
});

test('restore regenerates with current rules and preserves report identity and advisor history', () => {
  const f = setup();
  const value = f.current();
  f.w.reportEditing.applyEdit(value.report, 'academic', '每周复盘两次。', '李老师');
  const record = f.store.save(value).record;
  const originalGenerate = f.w.generateReport;
  f.w.generateReport = input => { const r = originalGenerate(input); r.meta.currentRules = 'latest'; return r; };
  const restored = f.store.restore(record.id);
  assert.equal(restored.state.report.meta.currentRules, 'latest');
  assert.equal(restored.state.report.meta.batchId, record.reportMeta.batchId);
  assert.equal(restored.state.report.meta.date, record.reportMeta.date);
  assert.equal(restored.state.ui.screen, 'report');
  assert.equal(restored.state.report.advisor.sections.academic, '每周复盘两次。');
  assert.equal(restored.state.report.advisor.history.length, 1);
  assert.ok(!Object.hasOwn(restored.state.report.advisor, 'carriedFrom'));
  assert.equal(restored.versionChanged, false);
  assert.equal(f.writes, 1);
});

test('archives from another bank version are marked and use the current report engine', () => {
  const f = setup();
  const record = f.store.save(f.current()).record;
  record.bankVersion = '2025.1';
  f.store.importBackup(backup([record]), { onConflict: 'replace' });
  assert.equal(f.store.restore(record.id).versionChanged, true);
  assert.equal(f.store.restore(record.id).record.bankVersion, '2025.1');
  record.bankVersion = f.w.QUESTION_BANK_META.version;
  delete record.catalogVersion;
  f.store.importBackup(backup([record]), { onConflict: 'replace' });
  assert.equal(f.store.restore(record.id).versionChanged, true);
});

test('unknown source versions require review even when the current version is also unknown', () => {
  const f = setup();
  delete f.w.QUESTION_BANK_META.version;
  delete f.w.UNIVERSITY_CATALOG.version;
  const record = f.store.save(f.current()).record;
  assert.equal(record.bankVersion, 'unknown');
  assert.equal(record.catalogVersion, 'unknown');
  assert.equal(f.store.restore(record.id).versionChanged, true);
});

test('archive validates actual answer domains and retains zero and free subject text', () => {
  const f = setup();
  const value = f.current();
  const numeric = f.w.QUESTION_BANK.find(q => q.type === 'numeric');
  value.academic.answers[numeric.id] = '0';
  value.plan.answers.schoolSubjects = ['数学', '设计技术'];
  value.mbti.answers[0] = 0;
  const record = f.store.save(value).record;
  assert.equal(record.state.academic.answers[numeric.id], '0');
  assert.deepEqual(plain(record.state.plan.answers.schoolSubjects), ['数学', '设计技术']);
  assert.equal(record.state.mbti.answers[0], 0);
});

test('invalid current responses, missing names and malformed advisor data cannot be archived', () => {
  const f = setup();
  const numeric = f.w.QUESTION_BANK.find(q => q.type === 'numeric');
  const invalid = [
    value => { value.info.name = ' '; },
    value => { value.info.name = '字'.repeat(25); },
    value => { value.info.grade = '99'; },
    value => { value.info.year = {}; },
    value => { value.academic.answers.unknown = 1; },
    value => { value.academic.answers.en1 = 99; },
    value => { value.academic.answers[numeric.id] = false; },
    value => { value.plan.answers.interests = ['unknown']; },
    value => { value.plan.answers.interests = ['math', 'math']; },
    value => { value.mbti.answers[0] = 9; },
    value => { value.report.advisor = { sections: { score: '伪造' }, history: [] }; }
  ];
  for (const mutate of invalid) {
    const value = f.current();
    mutate(value);
    assert.throws(() => f.store.save(value));
  }
  assert.equal(f.writes, 0);
});

test('malformed existing stores block all mutations and expose unchanged raw recovery data', () => {
  for (const raw of ['{broken', '{}', '[]', JSON.stringify({ format: 'bic-report-library', version: 9, records: [] })]) {
    const f = setup(raw);
    assert.equal(f.store.rawBackup(), raw);
    assert.throws(() => f.store.list());
    assert.throws(() => f.store.save(f.current()));
    assert.throws(() => f.store.remove('absent'));
    assert.throws(() => f.store.importBackup(backup([])));
    assert.throws(() => f.store.exportBackup());
    assert.equal(f.writes, 0);
    assert.equal(f.raw, raw);
  }
});

test('storage read failure is surfaced and no attempted write can overwrite an unreadable library', () => {
  const f = setup();
  let writes = 0;
  const store = f.w.ReportStore.create({ getItem() { throw new Error('denied'); }, setItem() { writes++; } });
  assert.throws(() => store.save(f.current()));
  assert.throws(() => store.rawBackup());
  assert.equal(writes, 0);
});

test('failed storage writes preserve old persisted records and later reads', () => {
  const f = setup();
  const first = f.store.save(f.current()).record;
  const before = f.raw;
  f.failWrites();
  assert.throws(() => f.store.save(f.current('第二位', 'AP-OTHER')));
  assert.throws(() => f.store.remove(first.id));
  const imported = plain(first);
  imported.id = 'imported'; imported.reportMeta.batchId = 'AP-IMPORTED';
  assert.throws(() => f.store.importBackup(backup([imported])));
  assert.equal(f.raw, before);
  assert.equal(f.store.list().length, 1);
});

test('combined library capacity is enforced before a single write', () => {
  const f = setup();
  const record = f.store.save(f.current()).record;
  const records = Array.from({ length: f.w.ReportStore.LIMITS.MAX_RECORDS }, (_, i) => {
    const copy = plain(record); copy.id = `full-${i}`; copy.reportMeta.batchId = `AP-FULL-${i}`; return copy;
  });
  const target = setup(backup(records));
  const before = target.raw;
  assert.throws(() => target.store.save(target.current()));
  assert.throws(() => target.store.previewImport(backup([record])));
  assert.throws(() => target.store.importBackup(backup([record])));
  assert.equal(target.raw, before);
  assert.equal(target.writes, 0);
});

test('JSON backup roundtrips responses and history and does not mutate storage when exported', () => {
  const source = setup();
  const value = source.current();
  source.w.reportEditing.applyEdit(value.report, 'summary', '<script>literal</script>', '顾问');
  const record = source.store.save(value).record;
  const text = source.store.exportBackup();
  const result = JSON.parse(text);
  assert.equal(result.format, 'bic-report-library');
  assert.equal(result.version, 1);
  assert.ok(Number.isFinite(Date.parse(result.exportedAt)));
  const target = setup();
  assert.deepEqual(plain(target.store.previewImport(text)), { count: 1, added: 1, conflicts: 0 });
  assert.equal(target.writes, 0);
  assert.deepEqual(plain(target.store.importBackup(text)), { added: 1, skipped: 0, replaced: 0, total: 1 });
  assert.equal(target.writes, 1);
  assert.deepEqual(plain(target.store.list()[0]), plain(record));
  assert.equal(source.writes, 1);
});

test('imports skip conflicts by default and replace only with explicit conflict choice', () => {
  const f = setup();
  const record = f.store.save(f.current()).record;
  const changed = plain(record);
  changed.state.info.name = '备份姓名';
  const text = backup([changed]);
  assert.deepEqual(plain(f.store.previewImport(text)), { count: 1, added: 0, conflicts: 1 });
  assert.deepEqual(plain(f.store.importBackup(text)), { added: 0, skipped: 1, replaced: 0, total: 1 });
  assert.equal(f.store.list()[0].state.info.name, '测试同学');
  assert.deepEqual(plain(f.store.importBackup(text, { onConflict: 'replace' })), { added: 0, skipped: 0, replaced: 1, total: 1 });
  assert.equal(f.store.list()[0].state.info.name, '备份姓名');
  assert.throws(() => f.store.importBackup(text, { onConflict: 'unknown' }));
});

test('duplicate identities within an incoming backup reject the entire batch', () => {
  const f = setup();
  const record = f.store.save(f.current()).record;
  const changedId = { ...plain(record), id: 'another-id' };
  const before = f.raw;
  for (const records of [[record, record], [record, changedId]]) {
    assert.throws(() => f.store.importBackup(backup(records)));
  }
  assert.equal(f.raw, before);
  assert.equal(f.writes, 1);
});

test('import conflicts on report identity as well as archive id and never creates duplicate reports', () => {
  const f = setup();
  const record = f.store.save(f.current()).record;
  const sameReport = { ...plain(record), id: 'other-device-id' };
  sameReport.state.info.name = '另一设备姓名';
  const text = backup([sameReport]);
  assert.deepEqual(plain(f.store.previewImport(text)), { count: 1, added: 0, conflicts: 1 });
  f.store.importBackup(text, { onConflict: 'replace' });
  assert.equal(f.store.list().length, 1);
  assert.equal(f.store.list()[0].state.info.name, '另一设备姓名');
});

test('a backup with any malformed record or unsupported field rejects all records without a write', () => {
  const f = setup();
  const good = f.store.save(f.current()).record;
  const mutations = [
    record => { record.state.info.name = 7; },
    record => { record.state.info.name = ''; },
    record => { delete record.state.mbti; },
    record => { record.state.academic.answers.en1 = -1; },
    record => { record.state.academic.answers.nonexistent = 0; },
    record => { record.state.plan.answers.countries = ['outside-bank']; },
    record => { record.state.plan.answers.interests = 'math'; },
    record => { record.state.mbti.answers.push(1); },
    record => { record.state.mbti.answers[0] = '0'; },
    record => { record.state.extra = 'silently dropped'; },
    record => { record.reportMeta.status = 'forged complete'; },
    record => { record.createdAt = 'invalid'; },
    record => { record.advisor = { sections: { summary: '建议' }, history: [{ id: 'invalid' }] }; },
    record => { record.advisor = { sections: { unknown: '建议' }, history: [] }; }
  ];
  const target = setup();
  for (const mutate of mutations) {
    const bad = plain(good);
    bad.id = 'bad-id'; bad.reportMeta.batchId = 'AP-BAD';
    mutate(bad);
    assert.throws(() => target.store.importBackup(backup([good, bad])));
    assert.equal(target.writes, 0);
  }
});

test('imports reject unsupported envelope schemas and dangerous property names', () => {
  const f = setup();
  const values = ['not json', 'null', '[]', '{}',
    JSON.stringify({ format: 'other', version: 1, exportedAt: new Date().toISOString(), records: [] }),
    JSON.stringify({ format: 'bic-report-library', version: 2, exportedAt: new Date().toISOString(), records: [] }),
    '{"format":"bic-report-library","version":1,"exportedAt":"2026-10-24T00:00:00.000Z","records":[],"__proto__":{}}'];
  for (const text of values) assert.throws(() => f.store.importBackup(text));
  assert.equal(f.writes, 0);
});

test('record, import text, history and total serialized limits reject without data loss', () => {
  const f = setup();
  const good = f.store.save(f.current()).record;
  const target = setup();
  const many = Array.from({ length: f.w.ReportStore.LIMITS.MAX_RECORDS + 1 }, (_, i) => {
    const record = plain(good); record.id = `id-${i}`; record.reportMeta.batchId = `AP-${i}`; return record;
  });
  assert.throws(() => target.store.importBackup(backup(many)));
  assert.throws(() => target.store.importBackup(' '.repeat(f.w.ReportStore.LIMITS.MAX_CHARS + 1)));
  const value = f.current('另一位', 'AP-LIMIT');
  f.w.reportEditing.applyEdit(value.report, 'summary', '建议', '老师');
  const history = value.report.advisor.history[0];
  value.report.advisor.history = Array.from({ length: f.w.ReportStore.LIMITS.MAX_HISTORY + 1 }, (_, i) => ({ ...history, id: `history-${i}` }));
  assert.throws(() => target.store.save(value));
  const full = [];
  for (let i = 0; i < 5; i++) {
    const record = plain(good); record.id = `large-${i}`; record.reportMeta.batchId = `AP-LARGE-${i}`;
    record.advisor = { sections: { summary: '字'.repeat(4000) }, history: Array.from({ length: 100 }, (_, n) => ({ id: `h-${n}`, at: new Date().toISOString(), author: '老师', section: 'summary', before: '字'.repeat(4000), after: '字'.repeat(4000), action: 'edit', reportId: record.reportMeta.batchId })), lastAuthor: '老师' };
    full.push(record);
  }
  assert.throws(() => target.store.importBackup(backup(full)));
  assert.equal(target.writes, 0);
});

test('remove deletes only the selected archive and never mutates current response objects', () => {
  const f = setup();
  const value = f.current();
  const before = JSON.stringify(value);
  const first = f.store.save(value).record;
  f.store.save(f.current('第二位', 'AP-SECOND'));
  assert.equal(f.store.remove(first.id), true);
  assert.equal(f.store.remove(first.id), false);
  assert.equal(f.store.list().length, 1);
  assert.equal(JSON.stringify(value), before);
});

function parseCSV(text) {
  text = text.replace(/^\uFEFF/, '');
  const rows = []; let row = []; let cell = ''; let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') { cell += '"'; i++; }
      else quoted = !quoted;
    } else if (!quoted && char === ',') { row.push(cell); cell = ''; }
    else if (!quoted && char === '\r' && text[i + 1] === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i++; }
    else cell += char;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

test('CSV quotes commas, quotes and multiline names and neutralizes spreadsheet formulas', () => {
  const f = setup();
  const names = ['姓名,"引号"\n第二行', '=HYPERLINK("x")', '+1+1', '-1+1', '@SUM(1)', ' \t=1+1', '\n+2'];
  names.forEach((name, i) => f.store.save(f.current(name, `AP-CSV-${i}`)));
  const rows = parseCSV(f.store.exportCSV());
  assert.equal(rows.length, names.length + 1);
  assert.equal(rows[0].length, 17);
  for (let i = 0; i < names.length; i++) {
    assert.equal(rows[i + 1].length, 17);
    assert.equal(rows[i + 1][2], i === 0 ? names[i] : `'${names[i]}`);
    assert.equal(rows[i + 1][9], '100');
  }
  assert.equal(f.writes, names.length);
});

test('CSV leaves incomplete subject scores empty and does not assert a complete personality', () => {
  const f = setup();
  const value = state(f.w);
  value.report = f.w.generateReport(value);
  value.report.meta.batchId = 'AP-DRAFT';
  f.store.save(value);
  const row = parseCSV(f.store.exportCSV())[1];
  assert.equal(row[6], '草稿');
  assert.equal(row[7], '0');
  assert.equal(row[9], '');
  assert.equal(row[10], '');
  assert.equal(row[11], '');
  assert.equal(row[12], '');
  assert.equal(row[14], '待完成');
  const corrupt = setup('{bad');
  assert.throws(() => corrupt.store.exportCSV());
});
