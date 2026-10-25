const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const plain = value => JSON.parse(JSON.stringify(value));
const scoring = () => ({ bank_version: '2026.10', rule_version: 'academic-pct-v1', rule_fingerprint: '9'.repeat(64),
  basis: 'current_local_rules_recomputed', incomplete_policy: 'not_scored', calibration: 'not_calibrated' });
const metadata = () => ({ bank_version: '2026.10', schema_version: 'planning-preferences-v1',
  schema_fingerprint: 'a'.repeat(64), basis: 'explicit_student_choices' });
function schema() {
  return { metadata: metadata(), questions: [
    { key: 'preferredMajor', max: 2, options: [
      ['science', '自然科学'], ['math', '数学'], ['eng', '工程'], ['tech', '计算机与人工智能'],
      ['business', '商科与管理'], ['econ', '经济与金融'], ['med', '医学与健康'], ['social', '社会科学'],
      ['humanities', '人文与法律'], ['art', '艺术与设计'], ['media', '传媒'], ['unsure', '还不确定']
    ].map(([id, label]) => ({ id, label })) },
    { key: 'countries', max: 3, options: [
      ['uk', '英国'], ['us', '美国'], ['ca', '加拿大'], ['au', '澳大利亚'], ['hk', '中国香港'],
      ['sg', '新加坡'], ['eu', '欧洲大陆'], ['unsure', '还没想好']
    ].map(([id, label]) => ({ id, label })) }
  ] };
}
function setup({ preference = true, academic = true } = {}) {
  const window = {};
  if (preference) window.BIC_PREFERENCE_SCHEMA = schema();
  if (academic) window.BIC_ACADEMIC_SCORING_META = scoring();
  Object.defineProperty(window, 'localStorage', { get() { throw new Error('No storage'); } });
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../js/teacher-summary.js'), 'utf8'), { window, Date });
  return { tool: window.TeacherSummary, window };
}
function payload(academic = false, preferences = true) {
  const now = Math.floor(Date.now() / 1000);
  const value = { format: 'bic-teacher-completion-summary', version: preferences ? 3 : academic ? 2 : 1,
    items: [{ grant: { id: 'grant-1', report_id: 'report-1', report_revision: 4, report_name: '偏好同学', report_ref: 'REF-1',
      owner_username: 'owner.local', recipient_username: 'teacher.local', scope: 'full_report_read_only',
      created_at: now, expires_at: now + 86400, revoked_at: null, status: 'active' },
    report: { id: 'report-1', revision: 4, report_ref: 'REF-1', name: '偏好同学', grade: '8',
      bank_version: '2026.10', catalog_version: null, status: 'draft',
      academic: ['english', 'maths', 'physics', 'chemistry'].map((key, index) => ({ key, answered: index === 3 ? 14 : 15, total: 15 })),
      planning: { answered: 2, total: 14, required_answered: 2, required_total: 13 }, personality: { answered: 0, total: 24 } } }] };
  if (academic) {
    value.scoring = scoring();
    value.items[0].report.performance = [
      { key: 'english', complete: true, pct: 0 }, { key: 'maths', complete: true, pct: 47 },
      { key: 'physics', complete: true, pct: 13 }, { key: 'chemistry', complete: false, pct: null }
    ];
  }
  if (preferences) {
    value.options = { academic, preferences: true }; value.preference_schema = metadata();
    value.items[0].report.preferences = { preferredMajor: { answered: true, choices: ['science', 'unsure'] },
      countries: { answered: true, choices: ['uk', 'hk', 'unsure'] } };
  }
  return value;
}
const headers = ['姓名', '报告编号', '年级', '服务端修订', '题库版本', '目录版本', '完成状态',
  '英语已答', '英语总题', '数学已答', '数学总题', '物理已答', '物理总题', '化学已答', '化学总题',
  '规划已答', '规划总题', '规划必答已答', '规划必答总题', '性格已答', '性格总题'];
const academicHeaders = ['英语题库表现（仅完整，%）', '数学题库表现（仅完整，%）', '物理题库表现（仅完整，%）', '化学题库表现（仅完整，%）',
  '评分规则版本', '评分规则指纹', '规则依据', '校准状态'];
const preferenceHeaders = ['专业意向作答', '专业意向（学生自选，非推荐）', '地区偏好作答', '地区偏好（学生自选，多选）', '偏好选项版本', '偏好选项指纹'];
const baseValues = ['偏好同学', 'REF-1', '8', 4, '2026.10', '未记录', '必答未完成', 15, 15, 15, 15, 15, 15, 14, 15, 2, 14, 2, 13, 0, 24];
const academicValues = [0, 47, 13, '未完整', 'academic-pct-v1', '9'.repeat(64), '当前同版规则重算', '未校准'];
const preferenceValues = ['已回答', '自然科学；还不确定', '已回答', '英国；中国香港；还没想好', 'planning-preferences-v1', 'a'.repeat(64)];
function csv(table) { return '\uFEFF' + table.map(row => row.map(value => '"' + String(value).replace(/"/g, '""') + '"').join(',')).join('\r\n') + '\r\n'; }

test('four explicit modes keep v1/v2 golden CSV bytes and v3 adds only the requested fields', () => {
  const { tool } = setup();
  for (const academic of [false, true]) for (const preferences of [false, true]) {
    const input = payload(academic, preferences), result = tool.build(input, 'teacher.local');
    const expectedHeaders = [...headers, ...(academic ? academicHeaders : []), ...(preferences ? preferenceHeaders : [])];
    const expectedValues = [...baseValues, ...(academic ? academicValues : []), ...(preferences ? preferenceValues : [])];
    assert.equal(result.csv, csv([expectedHeaders, expectedValues]));
    assert.deepEqual(Object.keys(result).sort(), ['rows', 'csv', ...(academic ? ['scoring'] : []), ...(preferences ? ['options', 'preference_schema'] : [])].sort());
    assert.deepEqual(plain(tool.columns(input.version, input.options)), expectedHeaders);
    assert.deepEqual(plain(tool.values(result.rows[0], result.scoring, result.preference_schema)), expectedValues);
    assert.equal(expectedHeaders.length, preferences ? academic ? 35 : 27 : academic ? 29 : 21);
  }
});

test('pure preferences needs no academic rules while independent unavailable deployments fail closed', () => {
  const { tool } = setup({ academic: false });
  assert.equal(tool.build(payload(), 'teacher.local').rows[0].preferences.preferredMajor.answered, true);
  assert.throws(() => tool.build(payload(true), 'teacher.local'));
  const unavailable = setup({ preference: false }).tool;
  for (const academic of [false, true]) {
    assert.equal(unavailable.validate(payload(academic, false), 'teacher.local').version, academic ? 2 : 1);
    assert.throws(() => unavailable.build(payload(academic), 'teacher.local'));
  }
});

test('generated safe public dictionary directly supports the v3 protocol without loading planning engines', () => {
  const { tool, window } = setup({ preference: false, academic: false });
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../js/preference-schema.js'), 'utf8'), { window });
  const input = payload(); input.preference_schema = plain(window.BIC_PREFERENCE_SCHEMA.metadata);
  const result = tool.build(input, 'teacher.local');
  assert.deepEqual(plain(result.preference_schema), plain(window.BIC_PREFERENCE_SCHEMA.metadata));
  assert.equal(tool.values(result.rows[0], undefined, result.preference_schema)[22], '自然科学；还不确定');
  assert.equal(tool.values(result.rows[0], undefined, result.preference_schema)[24], '英国；中国香港；还没想好');
  for (const key of ['QUESTION_BANK', 'PLAN_QUESTIONS', 'MAJORS', 'generateReport', 'ReportStore']) assert.equal(typeof window[key], 'undefined');
});

test('partial planning keeps explicit choices and unanswered has a distinct fixed presentation', () => {
  const { tool } = setup(), input = payload();
  input.items[0].report.preferences.countries = { answered: false, choices: [] };
  input.items[0].report.planning = { answered: 1, total: 14, required_answered: 1, required_total: 13 };
  const result = tool.build(input, 'teacher.local');
  assert.equal(result.rows[0].status, 'draft');
  assert.deepEqual(plain(tool.values(result.rows[0], undefined, result.preference_schema).slice(21, 25)), ['已回答', '自然科学；还不确定', '未回答', '未回答']);
  input.items[0].report.preferences.preferredMajor = { answered: false, choices: [] };
  input.items[0].report.planning.answered = input.items[0].report.planning.required_answered = 0;
  assert.deepEqual(plain(tool.values(tool.build(input, 'teacher.local').rows[0], undefined, metadata()).slice(21, 25)), ['未回答', '未回答', '未回答', '未回答']);
});

test('the two required preference answers agree with all possible planning count boundaries', () => {
  const { tool } = setup();
  for (const academic of [false, true]) for (const majorAnswered of [false, true]) for (const countryAnswered of [false, true]) {
    const selected = Number(majorAnswered) + Number(countryAnswered);
    for (let required = 0; required <= 13; required++) for (const optional of [0, 1]) {
      const input = payload(academic), report = input.items[0].report;
      report.preferences.preferredMajor = { answered: majorAnswered, choices: majorAnswered ? ['science'] : [] };
      report.preferences.countries = { answered: countryAnswered, choices: countryAnswered ? ['uk'] : [] };
      report.planning.required_answered = required; report.planning.answered = required + optional;
      const message = `academic=${academic}, major=${majorAnswered}, countries=${countryAnswered}, required=${required}, optional=${optional}`;
      if (required >= selected && required <= 11 + selected) assert.doesNotThrow(() => tool.validate(input, 'teacher.local'), message);
      else assert.throws(() => tool.validate(input, 'teacher.local'), message);
    }
  }
});

test('preference choices reject unknown duplicate excess unordered and inconsistent answers without accepting private fields', () => {
  const { tool } = setup();
  const changes = [
    p => { p.preferredMajor.choices = ['unknown']; }, p => { p.preferredMajor.choices = ['science', 'science']; },
    p => { p.preferredMajor.choices = ['science', 'math', 'eng']; }, p => { p.countries.choices = ['uk', 'us', 'ca', 'au']; },
    p => { p.preferredMajor.choices.reverse(); }, p => { p.countries.choices.reverse(); },
    p => { p.preferredMajor.answered = false; }, p => { p.preferredMajor.choices = []; },
    p => { p.countries.answered = 1; }, p => { p.countries.choices = 'uk'; }, p => { p.countries.choices = [null]; },
    p => { p.countries.answer = 'private'; }, p => { p.freeText = 'private'; }, p => { delete p.preferredMajor; },
    p => { p.preferredMajor = null; }, p => { p.recommendations = ['math']; }, p => { p.personality = 'INTJ'; }
  ];
  for (const change of changes) { const input = payload(); change(input.items[0].report.preferences); assert.throws(() => tool.build(input, 'teacher.local')); }
});

test('v3 exact mode metadata and report contracts preserve strict authorization counts and scoring validation', () => {
  const { tool } = setup();
  const changes = [
    p => { delete p.options; }, p => { p.options.preferences = false; }, p => { p.options.academic = 'false'; },
    p => { p.options.extra = true; }, p => { p.options = []; }, p => { delete p.preference_schema; },
    p => { p.preference_schema.schema_fingerprint = 'b'.repeat(64); }, p => { p.preference_schema.basis = 'recommendations'; },
    p => { p.preference_schema.extra = true; }, p => { p.items[0].report.answers = {}; },
    p => { p.items[0].report.audit = []; }, p => { p.items[0].grant.scope = 'full_report_advice_edit'; },
    p => { p.items[0].grant.recipient_username = 'other.local'; }, p => { p.items[0].grant.expires_at = 1; },
    p => { p.items[0].report.planning.required_answered = 14; }, p => { p.items[0].report.status = 'complete'; },
    p => { p.items[0].report.performance = []; }, p => { p.scoring = scoring(); }
  ];
  for (const change of changes) { const input = payload(); change(input); assert.throws(() => tool.validate(input, 'teacher.local')); }
  for (const change of [p => { delete p.scoring; }, p => { delete p.items[0].report.performance; },
    p => { p.items[0].report.performance[0].pct = 1; }, p => { p.items[0].report.performance[3].pct = 0; }]) {
    const input = payload(true); change(input); assert.throws(() => tool.build(input, 'teacher.local'));
  }
  for (const academic of [false, true]) {
    const old = payload(academic, false); old.items[0].report.preferences = payload().items[0].report.preferences;
    assert.throws(() => tool.validate(old, 'teacher.local'));
  }
});

test('safe public dictionary is strictly bounded and cannot self-authorize unknown changed option sets', () => {
  const changes = [
    s => { s.answers = {}; }, s => { s.metadata.bank_version = '2025.10'; }, s => { s.metadata.schema_version = 'new'; },
    s => { s.metadata.schema_fingerprint = 'A'.repeat(64); }, s => { s.metadata.schema_fingerprint = 'a'.repeat(63); },
    s => { s.metadata.basis = 'rule_recommendations'; }, s => { s.metadata.extra = true; },
    s => { s.questions.reverse(); }, s => { s.questions.pop(); }, s => { s.questions[0].max = 3; },
    s => { s.questions[1].max = 2; }, s => { s.questions[0].desc = 'free text'; },
    s => { s.questions[0].options.pop(); }, s => { s.questions[1].options.push({ id: 'other', label: '其他' }); },
    s => { s.questions[0].options.reverse(); }, s => { s.questions[0].options[0].id = 'unknown'; },
    s => { s.questions[0].options[0].id = 'math'; }, s => { s.questions[0].options[0].label = ''; },
    s => { s.questions[0].options[0].label = 'x'.repeat(101); }, s => { s.questions[0].options[0].label = '\uD800'; },
    s => { s.questions[0].options[0].label = '数学'; }, s => { s.questions[0].options[0].desc = 'private'; },
    s => { s.questions[0].options[0].label = null; }
  ];
  for (const change of changes) {
    const { tool, window } = setup(); change(window.BIC_PREFERENCE_SCHEMA);
    const input = payload(); input.preference_schema = plain(window.BIC_PREFERENCE_SCHEMA.metadata);
    assert.throws(() => tool.build(input, 'teacher.local'));
    assert.equal(tool.build(payload(false, false), 'teacher.local').rows.length, 1);
  }
});

test('pure helper calls require matching preference metadata and exact v3 options', () => {
  const { tool, window } = setup(), result = tool.build(payload(), 'teacher.local');
  for (const options of [undefined, null, {}, { academic: false }, { academic: false, preferences: false },
    { academic: 0, preferences: true }, { academic: true, preferences: true, extra: true }]) assert.throws(() => tool.columns(3, options));
  assert.throws(() => tool.values(result.rows[0]));
  assert.throws(() => tool.values(result.rows[0], undefined, { ...metadata(), schema_fingerprint: 'b'.repeat(64) }));
  assert.throws(() => tool.values(tool.build(payload(false, false), 'teacher.local').rows[0], undefined, metadata()));
  window.BIC_PREFERENCE_SCHEMA.metadata.schema_fingerprint = 'b'.repeat(64);
  assert.throws(() => tool.values(result.rows[0], undefined, result.preference_schema));
});

test('v3 whitelist copies never include private identities answers recommendations or audit and remain isolated', () => {
  const { tool, window } = setup(), input = payload(true), validated = tool.validate(input, 'teacher.local'), result = tool.build(input, 'teacher.local');
  assert.deepEqual(Object.keys(result.rows[0]).sort(), ['name', 'report_ref', 'grade', 'revision', 'bank_version', 'catalog_version', 'status', 'academic', 'planning', 'personality', 'performance', 'preferences'].sort());
  for (const secret of ['grant-1', 'report-1', 'owner.local', 'teacher.local', 'answers', 'recommendations', 'actor', 'audit']) assert.equal(result.csv.includes(secret), false);
  input.items[0].report.preferences.preferredMajor.choices[0] = 'math'; input.options.academic = false;
  assert.equal(result.rows[0].preferences.preferredMajor.choices[0], 'science');
  assert.equal(validated.items[0].report.preferences.preferredMajor.choices[0], 'science');
  assert.equal(result.options.academic, true);
  result.preference_schema.schema_version = 'changed'; assert.equal(window.BIC_PREFERENCE_SCHEMA.metadata.schema_version, 'planning-preferences-v1');
  result.rows[0].preferences.preferredMajor.choices[0] = 'eng'; assert.equal(input.items[0].report.preferences.preferredMajor.choices[0], 'math');
  const columns = tool.columns(3, { academic: false, preferences: true }); columns[21] = 'changed';
  assert.equal(tool.columns(3, { academic: false, preferences: true })[21], preferenceHeaders[0]);
});

test('CSV quoting and formula-control neutralization also apply to fixed preference labels', () => {
  const { tool, window } = setup(), input = payload();
  input.items[0].report.name = input.items[0].grant.report_name = ' \t=SUM(A1)';
  window.BIC_PREFERENCE_SCHEMA.questions[0].options[0].label = '自然"科学,\n课';
  window.BIC_PREFERENCE_SCHEMA.questions[1].options[0].label = '\t@地区';
  const result = tool.build(input, 'teacher.local');
  assert.ok(result.csv.startsWith('\uFEFF')); assert.ok(result.csv.endsWith('\r\n'));
  assert.ok(result.csv.includes('"\' \t=SUM(A1)"'));
  assert.ok(result.csv.includes('"自然""科学,\n课；还不确定"'));
  assert.ok(result.csv.includes('"\'\t@地区；中国香港；还没想好"'));
  assert.equal(tool.values(result.rows[0], undefined, result.preference_schema)[22], '自然"科学,\n课；还不确定');
});
