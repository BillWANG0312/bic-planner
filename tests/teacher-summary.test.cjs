const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const plain = value => JSON.parse(JSON.stringify(value));
function moduleUnderTest() {
  const window = {};
  Object.defineProperty(window, 'localStorage', { get() { throw new Error('No storage access'); } });
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../js/teacher-summary.js'), 'utf8'), { window, Date });
  return window.TeacherSummary;
}
function item(index = 1) {
  const now = Math.floor(Date.now() / 1000);
  return { grant: { id: 'grant-' + index, report_id: 'report-' + index, report_revision: 3, report_name: '测试同学' + index,
    report_ref: 'REF-' + index, owner_username: 'owner.local', recipient_username: 'teacher.local', scope: 'full_report_read_only',
    created_at: now, expires_at: now + 86400, revoked_at: null, status: 'active' },
  report: { id: 'report-' + index, revision: 3, report_ref: 'REF-' + index, name: '测试同学' + index, grade: '8',
    bank_version: '2026.10', catalog_version: null, status: 'draft', academic: [
      { key: 'english', answered: 0, total: 15 }, { key: 'maths', answered: 1, total: 15 },
      { key: 'physics', answered: 2, total: 15 }, { key: 'chemistry', answered: 3, total: 15 }
    ], planning: { answered: 1, total: 14, required_answered: 1, required_total: 13 }, personality: { answered: 0, total: 24 } } };
}
const batch = (...items) => ({ format: 'bic-teacher-completion-summary', version: 1, items: items.length ? items : [item()] });
function complete(value, optional = false) {
  value.report.academic.forEach(subject => { subject.answered = 15; });
  value.report.planning = { answered: optional ? 14 : 13, total: 14, required_answered: 13, required_total: 13 };
  value.report.personality.answered = 24; value.report.status = 'complete'; return value;
}
function parseCSV(csv) {
  const rows = []; let row = [], cell = '', quoted = false;
  for (let i = 1; i < csv.length; i++) {
    const char = csv[i];
    if (char === '"') { if (quoted && csv[i + 1] === '"') { cell += '"'; i++; } else quoted = !quoted; }
    else if (!quoted && char === ',') { row.push(cell); cell = ''; }
    else if (!quoted && char === '\r' && csv[i + 1] === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i++; }
    else cell += char;
  }
  assert.equal(quoted, false); assert.equal(cell, ''); assert.deepEqual(row, []); return rows;
}

test('one to twenty selected summaries validate without bank, report, browser storage or other globals', () => {
  const tool = moduleUnderTest(), value = batch(item(), item(2));
  const result = tool.validate(value, 'teacher.local'); assert.deepEqual(plain(result), value);
  value.items[0].report.name = 'changed'; assert.equal(result.items[0].report.name, '测试同学1');
  const built = tool.build(batch(item()), 'teacher.local');
  assert.deepEqual(Object.keys(built), ['rows', 'csv']);
  assert.deepEqual(Object.keys(built.rows[0]), ['name', 'report_ref', 'grade', 'revision', 'bank_version', 'catalog_version', 'status', 'academic', 'planning', 'personality']);
  assert.equal(built.rows[0].academic[0].answered, 0);
  assert.equal(tool.validate(batch(...Array.from({ length: 20 }, (_, index) => item(index + 1))), 'teacher.local').items.length, 20);
});

test('CSV has 21 quoted columns, UTF8 BOM and CRLF, with only necessary private completion fields', () => {
  const tool = moduleUnderTest(), payload = batch(item(), complete(item(2)));
  const { csv, rows } = tool.build(payload, 'teacher.local'), parsed = parseCSV(csv);
  assert.equal(csv[0], '\uFEFF'); assert.ok(csv.endsWith('\r\n'));
  assert.equal(parsed.length, 3); assert.ok(parsed.every(row => row.length === 21));
  assert.deepEqual(parsed[0], ['姓名', '报告编号', '年级', '服务端修订', '题库版本', '目录版本', '完成状态', '英语已答', '英语总题', '数学已答', '数学总题', '物理已答', '物理总题', '化学已答', '化学总题', '规划已答', '规划总题', '规划必答已答', '规划必答总题', '性格已答', '性格总题']);
  assert.deepEqual(parsed[1], ['测试同学1', 'REF-1', '8', '3', '2026.10', '未记录', '必答未完成', '0', '15', '1', '15', '2', '15', '3', '15', '1', '14', '1', '13', '0', '24']);
  assert.equal(parsed[2][6], '必答已完成');
  for (const excluded of ['grant-', 'report-1', 'owner.local', 'teacher.local', 'actor', 'history', 'answers']) assert.ok(!csv.includes(excluded));
  assert.ok(!Object.hasOwn(rows[0], 'id')); assert.ok(!Object.hasOwn(rows[0], 'grant'));
  payload.items[0].report.academic[0].answered = 10; assert.equal(rows[0].academic[0].answered, 0);
});

test('optional planning nonresponse permits complete status but required nonresponse does not', () => {
  const tool = moduleUnderTest();
  assert.equal(tool.validate(batch(complete(item())), 'teacher.local').items[0].report.status, 'complete');
  assert.equal(tool.validate(batch(complete(item(), true)), 'teacher.local').items[0].report.planning.answered, 14);
  const missedRequired = complete(item()); missedRequired.report.planning.required_answered = 12;
  assert.throws(() => tool.validate(batch(missedRequired), 'teacher.local'));
  missedRequired.report.status = 'draft'; assert.equal(tool.validate(batch(missedRequired), 'teacher.local').items[0].report.status, 'draft');
  const zeroOptional = item(); zeroOptional.report.planning = { answered: 1, total: 14, required_answered: 0, required_total: 13 };
  assert.equal(tool.validate(batch(zeroOptional), 'teacher.local').items[0].report.planning.answered, 1);
});

test('formula-like text and leading controls are neutralized while quoted newlines and Unicode stay intact', () => {
  const tool = moduleUnderTest();
  for (const danger of ['=2+3', '+SUM(A1)', '-2+3', '@SUM(A1)', '  =1', '\tordinary', '\rline', '\nline', '\u0000=1', '\u007fplain']) {
    const value = item(); value.report.name = value.grant.report_name = danger;
    value.report.report_ref = value.grant.report_ref = danger;
    value.report.catalog_version = danger;
    const parsed = parseCSV(tool.build(batch(value), 'teacher.local').csv)[1];
    assert.equal(parsed[0], "'" + danger); assert.equal(parsed[1], "'" + danger); assert.equal(parsed[5], "'" + danger);
  }
  const value = item(); value.report.name = value.grant.report_name = '中文"姓名,\n第二行';
  assert.equal(parseCSV(tool.build(batch(value), 'teacher.local').csv)[1][0], value.report.name);
  assert.equal(parseCSV(tool.build(batch(value), 'teacher.local').csv)[1][1], 'REF-1');
});

test('unknown protocol fields, wrong identity or scope, revoked/expired and metadata mismatches are rejected', () => {
  const tool = moduleUnderTest();
  const changes = [
    value => { value.secret = 'answer'; }, value => { value.version = true; }, value => { value.format = 'other'; },
    value => { value.items[0].secret = 'answer'; }, value => { value.items[0].grant.scope = 'full_report_advice_edit'; },
    value => { value.items[0].grant.recipient_username = 'other.local'; }, value => { value.items[0].grant.owner_username = 'teacher.local'; },
    value => { value.items[0].grant.status = 'source_changed'; }, value => { value.items[0].grant.revoked_at = 10; },
    value => { value.items[0].grant.expires_at = Math.floor(Date.now() / 1000) - 1; },
    value => { value.items[0].grant.created_at = 0; }, value => { value.items[0].grant.report_revision = true; },
    value => { value.items[0].report.id = 'other'; }, value => { value.items[0].report.revision++; },
    value => { value.items[0].report.name = 'other'; }, value => { value.items[0].report.report_ref = 'other'; },
    value => { value.items[0].report.answers = {}; }, value => { value.items[0].grant.extra = 'secret'; }
  ];
  for (const mutate of changes) { const value = batch(item()); mutate(value); assert.throws(() => tool.validate(value, 'teacher.local')); }
  for (const username of [null, '', 'TEACHER.LOCAL', 'bad name', 'x'.repeat(65)]) assert.throws(() => tool.validate(batch(item()), username));
});

test('question counts, required denominators, subject order and completion contradictions cannot be exported', () => {
  const tool = moduleUnderTest();
  const changes = [
    value => { value.academic[0].answered = null; }, value => { value.academic[0].answered = true; },
    value => { value.academic[0].answered = '1'; }, value => { value.academic[0].answered = -1; },
    value => { value.academic[0].answered = 16; }, value => { value.academic[0].answered = 1.5; },
    value => { value.academic[0].total = 14; }, value => { value.academic.reverse(); },
    value => { value.academic.pop(); }, value => { value.academic[0].score = 100; },
    value => { value.planning.required_total = 14; }, value => { value.planning.required_answered = 14; },
    value => { value.planning.answered = 0; }, value => { value.planning.answered = 3; },
    value => { value.planning.total = 13; }, value => { value.personality.answered = 25; },
    value => { value.personality.total = 23; }, value => { value.status = 'complete'; }, value => { value.status = 'certified'; }
  ];
  for (const mutate of changes) { const value = item(); mutate(value.report); assert.throws(() => tool.build(batch(value), 'teacher.local')); }
  const value = complete(item()); value.report.status = 'draft'; assert.throws(() => tool.validate(batch(value), 'teacher.local'));
});

test('old or unknown banks are refused while nullable or older catalogs remain valid completion metadata', () => {
  const tool = moduleUnderTest();
  for (const bank of ['unknown', '2025.10', '', null]) { const value = item(); value.report.bank_version = bank; assert.throws(() => tool.validate(batch(value), 'teacher.local')); }
  for (const catalog of [null, '2020-old', 'unknown']) { const value = item(); value.report.catalog_version = catalog; assert.equal(tool.validate(batch(value), 'teacher.local').items[0].report.catalog_version, catalog); }
  for (const catalog of ['', 1, {}, 'x'.repeat(101)]) { const value = item(); value.report.catalog_version = catalog; assert.throws(() => tool.validate(batch(value), 'teacher.local')); }
  for (const grade of ['', '8', '9', '10', '11']) { const value = item(); value.report.grade = grade; assert.equal(tool.validate(batch(value), 'teacher.local').items[0].report.grade, grade); }
  for (const grade of ['12', 8, null]) { const value = item(); value.report.grade = grade; assert.throws(() => tool.validate(batch(value), 'teacher.local')); }
});

test('duplicate grants, report IDs and report references or overlarge and empty selections are refused', () => {
  const tool = moduleUnderTest();
  for (const mutate of [value => { value.grant.id = 'grant-1'; }, value => { value.grant.report_id = value.report.id = 'report-1'; },
    value => { value.grant.report_ref = value.report.report_ref = 'REF-1'; }]) {
    const second = item(2); mutate(second); assert.throws(() => tool.validate(batch(item(), second), 'teacher.local'));
  }
  for (const items of [[], Array.from({ length: 21 }, (_, index) => item(index + 1)), null, {}]) assert.throws(() => tool.validate({ ...batch(item()), items }, 'teacher.local'));
  const invalid = item(); invalid.report.name = invalid.grant.report_name = 'x'.repeat(25); assert.throws(() => tool.validate(batch(invalid), 'teacher.local'));
  const malformed = item(); malformed.report.name = malformed.grant.report_name = '\ud800'; assert.throws(() => tool.validate(batch(malformed), 'teacher.local'));
});
