const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const plain = value => JSON.parse(JSON.stringify(value));
const meta = () => ({ bank_version: '2026.10', rule_version: 'academic-pct-v1', rule_fingerprint: '9'.repeat(64),
  basis: 'current_local_rules_recomputed', incomplete_policy: 'not_scored', calibration: 'not_calibrated' });
function setup(available = true) {
  const window = {};
  if (available) window.BIC_ACADEMIC_SCORING_META = meta();
  Object.defineProperty(window, 'localStorage', { get() { throw new Error('No real storage'); } });
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../js/teacher-summary.js'), 'utf8'), { window, Date });
  return { tool: window.TeacherSummary, window };
}
function item(index = 1) {
  const now = Math.floor(Date.now() / 1000);
  return { grant: { id: 'grant-' + index, report_id: 'report-' + index, report_revision: 4, report_name: '学科同学' + index,
    report_ref: 'REF-' + index, owner_username: 'owner.local', recipient_username: 'teacher.local', scope: 'full_report_read_only',
    created_at: now, expires_at: now + 86400, revoked_at: null, status: 'active' },
  report: { id: 'report-' + index, revision: 4, report_ref: 'REF-' + index, name: '学科同学' + index, grade: '8',
    bank_version: '2026.10', catalog_version: null, status: 'draft',
    academic: ['english', 'maths', 'physics', 'chemistry'].map((key, index) => ({ key, answered: index === 3 ? 14 : 15, total: 15 })),
    planning: { answered: 1, total: 14, required_answered: 1, required_total: 13 }, personality: { answered: 0, total: 24 } } };
}
function v1() { return { format: 'bic-teacher-completion-summary', version: 1, items: [item()] }; }
function v2() {
  const value = v1(); value.version = 2; value.scoring = meta();
  value.items[0].report.performance = [
    { key: 'english', complete: true, pct: 0 }, { key: 'maths', complete: true, pct: 47 },
    { key: 'physics', complete: true, pct: 13 }, { key: 'chemistry', complete: false, pct: null }
  ]; return value;
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

test('default completion v1 keeps exact original bytes and shape without a scoring deployment', () => {
  const { tool } = setup(false), payload = v1(), built = tool.build(payload, 'teacher.local');
  const header = ['姓名', '报告编号', '年级', '服务端修订', '题库版本', '目录版本', '完成状态', '英语已答', '英语总题', '数学已答', '数学总题', '物理已答', '物理总题', '化学已答', '化学总题', '规划已答', '规划总题', '规划必答已答', '规划必答总题', '性格已答', '性格总题'];
  const expected = '\uFEFF' + header.map(value => '"' + value + '"').join(',') + '\r\n'
    + '"学科同学1","REF-1","8","4","2026.10","未记录","必答未完成","15","15","15","15","15","15","14","15","1","14","1","13","0","24"\r\n';
  assert.deepEqual(Object.keys(built), ['rows', 'csv']); assert.equal(built.csv, expected);
  assert.deepEqual(plain(tool.validate(payload, 'teacher.local')), payload);
  assert.throws(() => tool.validate(v2(), 'teacher.local'));
});

test('explicit academic v2 validates complete zero versus incomplete null and preserves deep-copy boundaries', () => {
  const { tool, window } = setup(), payload = v2(), valid = tool.validate(payload, 'teacher.local');
  assert.deepEqual(plain(valid), payload);
  const built = tool.build(payload, 'teacher.local');
  assert.deepEqual(Object.keys(built), ['rows', 'csv', 'scoring']); assert.equal(built.rows[0].performance[0].pct, 0);
  assert.equal(built.rows[0].performance[3].pct, null); assert.equal(built.scoring.rule_fingerprint, meta().rule_fingerprint);
  payload.items[0].report.performance[0].pct = 100; payload.scoring.rule_fingerprint = 'a'.repeat(64);
  assert.equal(valid.items[0].report.performance[0].pct, 0); assert.equal(built.rows[0].performance[0].pct, 0);
  built.scoring.rule_version = 'changed'; assert.equal(window.BIC_ACADEMIC_SCORING_META.rule_version, 'academic-pct-v1');
  for (const key of ['id', 'grant', 'answers', 'history', 'actor']) assert.equal(Object.hasOwn(built.rows[0], key), false);
});

test('v2 CSV and shared view helpers have 29 identical values with rule provenance and null explanation', () => {
  const { tool } = setup(), built = tool.build(v2(), 'teacher.local'), parsed = parseCSV(built.csv);
  assert.equal(built.csv[0], '\uFEFF'); assert.ok(built.csv.endsWith('\r\n'));
  assert.ok(parsed.every(row => row.length === 29)); assert.deepEqual(parsed[0], plain(tool.columns(2)));
  assert.deepEqual(parsed[0].slice(21), ['英语题库表现（仅完整，%）', '数学题库表现（仅完整，%）', '物理题库表现（仅完整，%）', '化学题库表现（仅完整，%）', '评分规则版本', '评分规则指纹', '规则依据', '校准状态']);
  assert.deepEqual(parsed[1].slice(21), ['0', '47', '13', '未完整', 'academic-pct-v1', '9'.repeat(64), '当前同版规则重算', '未校准']);
  assert.deepEqual(parsed[1], plain(tool.values(built.rows[0], built.scoring)).map(String));
  assert.equal(tool.columns().length, 21); assert.equal(tool.values(tool.build(v1(), 'teacher.local').rows[0]).length, 21);
  const columns = tool.columns(2); columns[0] = 'changed'; assert.equal(tool.columns(2)[0], '姓名');
  for (const bad of [true, '2', 0, 3]) assert.throws(() => tool.columns(bad));
});

test('performance must follow four subject counts and only the possible complete fifteen-question percentages', () => {
  const { tool } = setup();
  for (let correct = 0; correct <= 15; correct++) {
    const value = v2(); value.items[0].report.performance[0].pct = Math.round(correct / 15 * 100);
    assert.equal(tool.validate(value, 'teacher.local').items[0].report.performance[0].pct, Math.round(correct / 15 * 100));
  }
  const changes = [
    p => { p.performance.pop(); }, p => { p.performance.reverse(); }, p => { p.performance[0].complete = false; },
    p => { p.performance[3].complete = true; }, p => { p.performance[0].complete = 1; },
    p => { p.performance[0].pct = null; }, p => { p.performance[3].pct = 0; }, p => { p.performance[0].pct = true; },
    p => { p.performance[0].pct = '0'; }, p => { p.performance[0].pct = 1; }, p => { p.performance[0].pct = 6.5; },
    p => { p.performance[0].pct = -1; }, p => { p.performance[0].pct = 101; }, p => { p.performance[0].correct = 0; },
    p => { p.performance[0].answer = 'private'; }
  ];
  for (const change of changes) { const value = v2(); change(value.items[0].report); assert.throws(() => tool.build(value, 'teacher.local')); }
});

test('unknown scoring rules or mismatched deployment fingerprints fail closed instead of a v1 downgrade', () => {
  const { tool, window } = setup();
  const changes = [
    s => { s.bank_version = '2025.10'; }, s => { s.rule_version = 'new-rules'; }, s => { s.rule_fingerprint = 'a'.repeat(64); },
    s => { s.rule_fingerprint = '9'.repeat(63); }, s => { s.rule_fingerprint = 'G'.repeat(64); },
    s => { s.basis = 'historical_snapshot'; }, s => { s.incomplete_policy = 'zero'; }, s => { s.calibration = 'validated'; },
    s => { s.answers = {}; }
  ];
  for (const change of changes) { const value = v2(); change(value.scoring); assert.throws(() => tool.validate(value, 'teacher.local')); }
  const payload = v2(); window.BIC_ACADEMIC_SCORING_META.rule_fingerprint = 'a'.repeat(64); assert.throws(() => tool.build(payload, 'teacher.local'));
  window.BIC_ACADEMIC_SCORING_META = { ...meta(), answers: {} }; assert.throws(() => tool.validate(v2(), 'teacher.local'));
  delete window.BIC_ACADEMIC_SCORING_META; assert.throws(() => tool.validate(v2(), 'teacher.local')); assert.equal(tool.validate(v1(), 'teacher.local').version, 1);
});

test('versions retain exact fields and original authorization identity and count validation', () => {
  const { tool } = setup();
  for (const change of [
    p => { p.version = true; }, p => { p.version = 3; }, p => { delete p.scoring; }, p => { p.answers = {}; },
    p => { p.items[0].report.history = []; }, p => { p.items[0].grant.scope = 'full_report_advice_edit'; },
    p => { p.items[0].grant.recipient_username = 'other.local'; }, p => { p.items[0].report.academic[0].answered = 16; },
    p => { p.items[0].report.status = 'complete'; }
  ]) { const value = v2(); change(value); assert.throws(() => tool.validate(value, 'teacher.local')); }
  const scoredV1 = v2(); scoredV1.version = 1; assert.throws(() => tool.validate(scoredV1, 'teacher.local'));
  const noScoresV2 = v1(); noScoresV2.version = 2; noScoresV2.scoring = meta(); assert.throws(() => tool.validate(noScoresV2, 'teacher.local'));
});

test('v2 retains CSV text controls and quotes and unknown catalog matches shared view output', () => {
  const { tool } = setup();
  for (const name of ['=SUM(A1)', '  +1', '\tplain', '中文"姓名,\n第二行']) {
    const payload = v2(); payload.items[0].report.name = payload.items[0].grant.report_name = name;
    payload.items[0].report.catalog_version = 'unknown';
    const built = tool.build(payload, 'teacher.local'), parsed = parseCSV(built.csv);
    assert.equal(parsed[1][0], /^[\s]*[=+]/.test(name) || /^\t/.test(name) ? "'" + name : name);
    assert.equal(parsed[1][5], '未记录'); assert.equal(tool.values(built.rows[0], built.scoring)[5], '未记录');
    assert.equal(parsed[1].length, 29);
  }
});
