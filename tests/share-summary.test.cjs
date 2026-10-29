const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { loadReportScripts, completePlan, state } = require('./helpers/report.cjs');

const root = path.resolve(__dirname, '..');
const clone = value => JSON.parse(JSON.stringify(value));
function load(window = {}) {
  const file = path.join(root, 'js/share-summary.js');
  if (fs.existsSync(file)) vm.runInNewContext(fs.readFileSync(file, 'utf8'), { window, Date }, { filename: file });
  assert.ok(window.ParentSummary, '家长摘要的严格边界应存在');
  return window.ParentSummary;
}
function fixture(complete = false, current = false) {
  const w = loadReportScripts();
  vm.runInNewContext(fs.readFileSync(path.join(root, 'js/report-store.js'), 'utf8'), { window: w, Date });
  // 按当前版本归档（结构化性格作答 + 游戏题，带版本标记）验证分享摘要；current 只为区分旧的完整作答字样保留。
  const value = state(w);
  // 完整作答：按当前问卷填满学术题、游戏题，性格题每题 3 次（均衡）以上，报告才是 complete。
  if (complete) {
    Object.assign(value.plan.answers, completePlan(w));
    value.academic.answers = Object.fromEntries(w.QUESTION_BANK.map(q => [q.id, q.answer]));
    value.mbti.answers = w.TRAIT_QUESTIONS.map(() => ({ value: 2, ms: 900 }));
  }
  value.report = w.generateReport(value);
  value.report.meta.batchId = 'AP-PARENT-01';
  w.reportEditing.applyEdit(value.report, 'summary', '与老师一起复核学习计划。', '私密编辑者');
  let raw = null;
  const record = w.ReportStore.create({ getItem: () => raw, setItem: (_, data) => { raw = data; } }).save(value).record;
  return { w, record, value };
}
function snapshot(content) {
  return { format: 'bic-parent-summary', version: 1, shared_at: 1_790_000_000, expires_at: 1_790_003_600,
    report: { name: '测试同学', grade: '8', year: '2027 年秋季', batchId: 'AP-PARENT-01', date: '2026年10月24日',
      bankVersion: '2026.10', catalogVersion: '2026.10.24', revision: 1 }, content };
}
function plainContent() {
  return { status: 'draft', direction: '计算机科学', personality: '待完成性格测评',
    subjects: ['english', 'maths', 'physics', 'chemistry'].map(key => ({ key, name: key, answered: 0, total: 15, pct: null })),
    sections: { summary: '报告摘要', academic: '学习建议', plan: '专业建议', personality: '学习策略' } };
}

test('parent summary module loads without private app, storage, network or report dependencies', () => {
  const w = {};
  for (const key of ['localStorage', 'sessionStorage', 'fetch', 'QUESTION_BANK', 'ReportStore']) {
    Object.defineProperty(w, key, { get() { throw new Error('Standalone viewer must not load private state'); } });
  }
  const summary = load(w);
  const data = snapshot(plainContent());
  assert.deepEqual(clone(summary.validate(data)), data);
});

test('real archived records yield minimal summaries with no raw answers, question review, owner or audit history', () => {
  const { w, record } = fixture();
  const before = clone(record);
  const result = load(w).build(record);
  assert.deepEqual(Object.keys(result).sort(), ['direction', 'personality', 'sections', 'status', 'subjects']);
  assert.equal(result.sections.summary, '与老师一起复核学习计划。');
  assert.equal(result.status, 'draft');
  assert.equal(result.subjects.length, 4);
  assert.ok(result.subjects.every(subject => subject.pct === null));
  for (const forbidden of ['academic.answers', 'review', 'history', '私密编辑者', 'owner_id', 'csrf_token']) {
    assert.ok(!JSON.stringify(result).includes(forbidden));
  }
  assert.deepEqual(clone(record), before);
  assert.deepEqual(clone(load(w).validate(snapshot(result))).content, clone(result));
});

test('complete subjects publish measured aggregate scores while personality neutrality remains balanced', () => {
  const { w, record } = fixture(true, true);
  const result = load(w).build(record);
  assert.equal(result.status, 'complete');
  assert.ok(result.subjects.every(subject => subject.answered === 15 && subject.total === 15 && subject.pct === 100));
  assert.match(result.personality, /均衡/);
});

test('old or unknown archive versions cannot be mislabeled as the current generated rules', () => {
  const { w, record } = fixture();
  const summary = load(w);
  for (const [field, value] of [['bankVersion', 'old'], ['bankVersion', 'unknown'], ['catalogVersion', 'old'], ['catalogVersion', null]]) {
    const before = clone(record);
    before[field] = value;
    assert.throws(() => summary.build(before), /版本|复核|更新/);
  }
});

test('public snapshot requires every exact boundary and rejects private or unrecognized fields', () => {
  const summary = load();
  const valid = snapshot(plainContent());
  const paths = [[], ['report'], ['content'], ['content', 'subjects', 0], ['content', 'sections']];
  for (const parts of paths) {
    const bad = clone(valid);
    let target = bad;
    for (const part of parts) target = target[part];
    target.history = ['private'];
    assert.throws(() => summary.validate(bad), /格式|字段|摘要/);
  }
  for (const parts of [['report', 'date'], ['content', 'sections', 'summary'], ['content', 'subjects'], ['content', 'direction']]) {
    const bad = clone(valid);
    let target = bad;
    for (const part of parts.slice(0, -1)) target = target[part];
    delete target[parts.at(-1)];
    assert.throws(() => summary.validate(bad));
  }
});

test('public numeric, subject, expiry and unicode boundaries cannot be coerced or confused', () => {
  const summary = load();
  const changes = [
    data => { data.version = true; }, data => { data.report.revision = true; },
    data => { data.shared_at = '1790000000'; }, data => { data.expires_at = data.shared_at; },
    data => { data.report.grade = 8; }, data => { data.report.name = '😀'.repeat(13); },
    data => { data.report.name = '\ud800'; }, data => { data.content.direction = ' '; },
    data => { data.content.subjects[0].answered = true; },
    data => { data.content.subjects[0].total = 14; },
    data => { data.content.subjects[0].pct = 0; },
    data => { data.content.subjects[0].answered = 15; },
    data => { data.content.subjects[0].key = data.content.subjects[1].key; },
    data => { data.content.subjects.pop(); },
    data => { data.content.status = 'complete'; },
    data => { data.content.sections.plan = '😀'.repeat(2001); },
    data => { data.content.sections.academic = '\x01'.repeat(4000); }
  ];
  for (const change of changes) {
    const bad = snapshot(plainContent()); change(bad);
    assert.throws(() => summary.validate(bad));
  }
  const boundary = snapshot(plainContent());
  boundary.report.name = '😀'.repeat(12);
  boundary.content.sections.plan = '<img src=x onerror=alert(1)> is plain text.';
  const saved = summary.validate(boundary);
  assert.equal(saved.report.name, boundary.report.name);
  assert.equal(saved.content.sections.plan, boundary.content.sections.plan);
  saved.report.name = 'other';
  assert.notEqual(saved.report.name, boundary.report.name, 'validation returns a clone');
});
