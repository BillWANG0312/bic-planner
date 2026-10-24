const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadReportScripts, state } = require('./helpers/report.cjs');

test('carried advisor edits have a review reminder in the printable report body', () => {
  const w = loadReportScripts();
  const old = w.generateReport(state(w, true));
  w.reportEditing.applyEdit(old, 'plan', '先体验课程。', '王老师');
  const next = w.generateReport(state(w));
  w.reportEditing.carryEdits(old, next);
  assert.ok(w.renderReport(next).includes('顾问建议沿用自上次报告，请结合本次作答重新复核'));
});

test('undated admission policies are verified without inventing a course intake year', () => {
  const w = loadReportScripts();
  const r = w.generateReport(state(w));
  r.plan.unis = [{ country: '美国', unis: [{ name: 'MIT', courseName: '本科统一申请（非物理系单独录取）',
    req: '需 SAT 或 ACT', note: '不设固定分数门槛。', scope: 'policy', entryYear: null,
    reviewStatus: 'verified', reviewedAt: '2026-10-24', sourceUrl: 'https://mitadmissions.org/apply/firstyear/tests-scores/' }] }];
  const html = w.renderReport(r);
  assert.ok(html.includes('本科统一申请（非物理系单独录取）'));
  assert.ok(html.includes('招生政策 · 未指定入学年'));
  assert.ok(html.includes('需 SAT 或 ACT'));
  assert.ok(!html.includes('<div class="uni-req">录取要求待复核</div>'));
});

test('specific undergraduate course titles accompany course-level offers', () => {
  const w = loadReportScripts();
  const r = w.generateReport(state(w));
  r.plan.unis = [{ country: '英国', unis: [{ name: '剑桥大学', courseName: 'Natural Sciences BA/MSci',
    req: 'A*A*A', note: '先修数学与两门理科。', scope: 'course', entryYear: 2027,
    reviewStatus: 'verified', reviewedAt: '2026-10-24', sourceUrl: 'https://www.undergraduate.study.cam.ac.uk/courses/natural-sciences-ba-hons-msci' }] }];
  assert.ok(w.renderReport(r).includes('Natural Sciences BA/MSci'));
});

test('an undated named course is not assigned a fabricated intake or mislabeled a general policy', () => {
  const w = loadReportScripts();
  const r = w.generateReport(state(w));
  r.plan.unis = [{ country: '英国', unis: [{ name: '伦敦大学金史密斯学院', courseName: 'BA (Hons) Media & Communications',
    req: 'CCC', note: '当前公布的课程要求，未指定入学年份。', scope: 'course', entryYear: null,
    reviewStatus: 'verified', reviewedAt: '2026-10-24', sourceUrl: 'https://www.gold.ac.uk/ug/ba-media-communications/' }] }];
  const html = w.renderReport(r);
  assert.ok(html.includes('课程要求 · 未指定入学年'));
  assert.ok(html.includes('<div class="uni-req">CCC</div>'));
  assert.ok(!html.includes('招生政策 · 未指定入学年'));
});

test('an application-cycle policy does not become a permanent rule or a fabricated intake year', () => {
  const w = loadReportScripts();
  const r = w.generateReport(state(w));
  r.plan.unis = [{ country: '美国', unis: [{ name: '纽约大学', courseName: 'Economics BA',
    req: '标化可选', note: '仅对应公布的申请周期。', scope: 'policy', entryYear: null, applicationCycle: '2026–27',
    reviewStatus: 'verified', reviewedAt: '2026-10-24', sourceUrl: 'https://www.nyu.edu/admissions/undergraduate-admissions/' }] }];
  const html = w.renderReport(r);
  assert.ok(html.includes('2026–27 申请周期'));
  assert.ok(!html.includes('常设政策'));
});

test('an unanswered quick report shows pending evidence instead of ESTJ and academic deficits', () => {
  const w = loadReportScripts();
  const html = w.renderReport(w.generateReport(state(w)));
  assert.match(html, /草稿/);
  assert.match(html, /待完成性格测评/);
  assert.doesNotMatch(html, /ESTJ|暂无达到 70%|整体基础仍需系统梳理|你目前的各科成绩较为均衡/);
});

test('grade 8 report starts in the current grade and uses basic information', () => {
  const w = loadReportScripts();
  const s = state(w, true);
  s.plan.answers.grade = '9';
  const html = w.renderReport(w.generateReport(s));
  assert.match(html, /8 年级（当前）/);
  assert.doesNotMatch(html, /9 年级（今年）|10 年级（当前）/);
});

test('ranking is presented as a rule index without unbounded percentage claims', () => {
  const w = loadReportScripts();
  const r = w.generateReport(state(w, true));
  r.plan.majors[1].score = 80;
  const html = w.renderReport(r);
  assert.doesNotMatch(html, /匹配度 220%/);
  assert.match(html, /推荐指数/);
});

test('advisor content is rendered as plain text, including HTML-shaped input', () => {
  const w = loadReportScripts();
  assert.ok(w.reportEditing, '报告文字编辑功能应存在');
  const r = w.generateReport(state(w, true));
  w.reportEditing.applyEdit(r, 'plan', '<img src=x onerror=alert(1)>\n先了解专业', '王老师');
  const html = w.renderReport(r);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(html, /<img src=x/);
});

test('partial academic reports count actual answers and distinguish unasked questions from mistakes', () => {
  const w = loadReportScripts();
  const s = state(w);
  s.academic.answers = { en1: 0, ph1: 2 };
  const html = w.renderReport(w.generateReport(s));
  assert.match(html, /已作答 2\/60/);
  assert.match(html, /1 道错题/);
  assert.match(html, /58 道未答/);
  assert.match(html, /你的答案：/);
  assert.match(html, /待完成学术测评/);
  assert.doesNotMatch(html, /你共完成 60|基础适配 null|undefined%/);
});

test('complete neutral personality results describe balanced preferences without ESTJ', () => {
  const w = loadReportScripts();
  const s = state(w, true);
  s.mbti.answers = w.TRAIT_QUESTIONS.map(() => ({ value: 2, ms: 800 }));
  const html = w.renderReport(w.generateReport(s));
  assert.match(html, /倾向均衡/);
  assert.doesNotMatch(html, /ESTJ|待完成性格测评/);
});

test('admissions show record-specific source and review state and reject unsafe source links', () => {
  const w = loadReportScripts();
  const r = w.generateReport(state(w, true));
  r.plan.unis = [{ country: '英国', unis: [
    { name: '已核验大学', req: 'AAA', reviewStatus: 'verified', entryYear: 2027, reviewedAt: '2026-10-24', sourceUrl: 'https://example.ac.uk/course?a=1&b=2' },
    { name: '旧记录大学', req: 'SAT 1550', note: 'old BMAT', reviewStatus: 'pending', sourceUrl: 'javascript:alert(1)' }
  ] }];
  const html = w.renderReport(r);
  assert.match(html, /2027/);
  assert.match(html, /2026-10-24/);
  assert.match(html, /官网要求/);
  assert.match(html, /https:\/\/example\.ac\.uk\/course\?a=1&amp;b=2/);
  assert.match(html, /历史参考 · 待复核/);
  assert.doesNotMatch(html, /href="javascript:/);
  assert.doesNotMatch(html, /SAT 1550|old BMAT/);
});

test('all advisor sections appear as escaped multiline text with an edit marker', () => {
  const w = loadReportScripts();
  const r = w.generateReport(state(w, true));
  for (const section of ['summary', 'academic', 'plan', 'personality']) {
    w.reportEditing.applyEdit(r, section, `${section} 第一行\n第二行 <b>建议</b>`, '王老师');
  }
  const html = w.renderReport(r);
  for (const section of ['summary', 'academic', 'plan', 'personality']) assert.ok(html.includes(`${section} 第一行\n第二行 &lt;b&gt;建议&lt;/b&gt;`));
  assert.match(html, /advice-text/);
  assert.match(html, /顾问已编辑/);
  assert.doesNotMatch(html, /<b>建议<\/b>/);
});
