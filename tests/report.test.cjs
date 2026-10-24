const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

function loadEngine() {
  const context = vm.createContext({ console });
  context.window = context;
  for (const script of ['js/bank.js', 'data/universities.js', 'js/majors.js', 'js/plan.js', 'js/personality.js', 'js/games.js', 'js/report.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', script), 'utf8'), context);
  }
  return context;
}

function state() {
  return {
    info: { name: '测试学生', grade: '8', year: '2027 年秋季' },
    academic: { answers: {} }, plan: { answers: {} }, mbti: { answers: [] }
  };
}

function majorReport(engine, options = {}) {
  const input = state();
  input.plan.answers = { preferredMajor: options.planPreference || [options.preference || 'tech'] };
  input.mbti.answers = options.mbti || [];
  input.academic.answers = options.academic || {};
  const majors = engine.generateReport(input).plan.majors;
  return majors.find(item => item.major.id === options.major) || majors[0];
}

test('numeric grading distinguishes missing or invalid values from a genuine zero', () => {
  const engine = loadEngine();
  engine.QUESTION_BANK = [{ id: 'zero', subject: 'maths', topic: 'Zero', type: 'numeric', answer: 0, tol: 0 }];
  for (const invalid of [undefined, null, '', '   ', false, true, [], {}, Infinity, NaN, 'abc']) {
    const result = engine.gradeAcademic({ answers: { zero: invalid } });
    assert.equal(result.subjects.maths.correct, 0, `invalid: ${String(invalid)}`);
    assert.equal(result.subjects.maths.answered, 0);
  }
  for (const valid of [0, '0', ' 0 ']) {
    const result = engine.gradeAcademic({ answers: { zero: valid } });
    assert.equal(result.subjects.maths.correct, 1);
    assert.equal(result.subjects.maths.answered, 1);
  }
});

test('coverage counts valid choice answers including the first option and excludes out-of-range indices', () => {
  const engine = loadEngine();
  engine.QUESTION_BANK = engine.QUESTION_BANK.filter(q => ['en1', 'en2', 'ma1', 'ph1', 'ph2', 'ch1'].includes(q.id));
  const result = engine.gradeAcademic({ answers: { en1: 0, en2: 99, ma1: '1', ph1: 2, ch1: null } });
  assert.equal(result.answered, 2);
  assert.equal(result.total, engine.QUESTION_BANK.length);
  assert.equal(result.subjects.english.answered, 1);
  assert.equal(result.subjects.physics.correct, 1);
  assert.equal(result.subjects.physics.pct, 50);
});

test('physics recommendations use actual mathematics and physics evidence', () => {
  const engine = loadEngine();
  const answers = Object.fromEntries(engine.QUESTION_BANK
    .filter(q => q.subject === 'maths' || q.subject === 'physics').map(q => [q.id, q.answer]));
  const result = majorReport(engine, { preference: 'science', major: 'phys', academic: answers });
  assert.ok(result, 'the explicitly selected physics major is ranked');
  assert.equal(result.subjScore, 100);
});

test('an untested physics subject remains neutral within the science ranking component', () => {
  const engine = loadEngine();
  const answers = Object.fromEntries(engine.QUESTION_BANK.filter(q => q.subject === 'chemistry').map(q => [q.id, q.answer]));
  // 化学全对：未测的物理按中性 50 分参与理科综合，而不是 0 分把结果拉到 50
  assert.ok(majorReport(engine, { major: 'chem', academic: answers }).subjScore > majorReport(engine, { major: 'chem' }).subjScore, '化学测过全对后化学方向的学科分上升');
  assert.equal(majorReport(engine, { major: 'math' }).subjScore, 50, '纯数学专业只看数学，未测时保持中性');
});

test('personality traits tilt matching toward majors that use them', () => {
  const engine = loadEngine();
  // 只比较能稳定进入前四的专业（报告只展示前 4 个）
  const answers = high => engine.TRAIT_QUESTIONS.map(q => ({ value: (high.includes(q.trait) ? (q.reversed ? 0 : 4) : (q.reversed ? 4 : 0)), ms: 900 }));
  const scores = (pref, mbti) => engine.generateReport({ ...state(), plan: { answers: { preferredMajor: pref } }, mbti: { answers: mbti } }).plan.majors;
  const scoreOf = (majors, id) => majors.find(item => item.major.id === id)?.score;
  const base = scores(['tech'], []);
  const analytics = scores(['tech', 'math', 'science'], answers(['analyze', 'numbers']));
  const empathy = scores(['tech', 'math', 'science'], answers(['empathy', 'rules']));
  assert.ok(scoreOf(analytics, 'math') > scoreOf(base, 'math'), '分析 / 数字特质高时数学方向的匹配分上升');
  // 明确意向为「计算机与人工智能」时，计算机方向进入榜单并与特质相关
  const cs = (mbti) => engine.generateReport({ ...state(), plan: { answers: { preferredMajor: ['tech'] } }, mbti: { answers: mbti } }).plan.majors;
  assert.ok(cs(answers(['analyze', 'numbers'])).some(item => item.major.id === 'cs'), '分析 / 数字特质强时计算机方向进入前四');
  assert.equal(cs(answers(['empathy', 'rules'])).find(item => item.major.id === 'cs').reasons.find(r => /性格特质/.test(r)), undefined, '共情特质强、分析与数字特质弱时计算机方向不因性格加分');
  assert.ok(scoreOf(analytics, 'math') > scoreOf(empathy, 'math'), '分析特质强的数学匹配度高于共情特质强的');
});


test('incomplete personality answers do not change major recommendations', () => {
  const engine = loadEngine();
  const sparse = [];
  sparse[12] = { value: 4, ms: 500 };
  const partial = engine.generateReport({ ...state(), plan: { answers: { preferredMajor: ['chem'] } }, mbti: { answers: sparse } }).plan.majors;
  const empty = engine.generateReport({ ...state(), plan: { answers: { preferredMajor: ['chem'] } }, mbti: { answers: [] } }).plan.majors;
  assert.deepEqual(partial.map(item => [item.major.id, item.score]), empty.map(item => [item.major.id, item.score]), '只答了几道特质题时专业排序不变');
});

test('an empty personality questionnaire has no invented type', () => {
  const engine = loadEngine();
  const result = engine.computePersonality([]);
  assert.equal(result.code, undefined);
  assert.equal(result.hint.code, null);
  assert.equal(result.answered, 0);
  assert.equal(result.total, 30);
  assert.equal(result.complete, false);
  assert.equal(result.top.length, 0);
  assert.equal(result.byId.analyze.answered, 0);
  assert.equal(result.byId.analyze.pct, null);
  assert.equal(result.byId.analyze.level, 'pending');
});

test('complete neutral personality answers describe balance rather than a default type', () => {
  const engine = loadEngine();
  const result = engine.computePersonality(Array(30).fill({ value: 2, ms: 1000 }));
  assert.equal(result.answered, 30);
  assert.equal(result.complete, true);
  assert.ok(result.byId.analyze.pct != null);
  assert.equal(result.hint.code, null);
});

test('personality coverage rejects invalid persisted values and retains a legitimate zero', () => {
  const engine = loadEngine();
  const result = engine.computePersonality([{ value: 0, ms: 10 }, { value: '4' }, { value: 5 }, { value: -1 }, { value: Infinity }, null, 3]);
  assert.equal(result.answered, 1, '只有结构合法的 {value} 对象计入作答');
  assert.equal(result.byId[engine.TRAIT_QUESTIONS[0].trait].answered, 1);
  assert.equal(result.complete, false);
});

test('basic-information grade overrides stale planning grade without mutating input', () => {
  const engine = loadEngine();
  const input = state();
  input.plan.answers.grade = '11';
  const result = engine.generateReport(input);
  assert.equal(result.meta.gradeId, '8');
  assert.equal(result.meta.grade, '8 年级');
  assert.equal(result.plan.subjects.grade, '8');
  assert.equal(input.plan.answers.grade, '11');
});

test('legacy records use planning grade when basic information has no grade', () => {
  const engine = loadEngine();
  const input = state();
  delete input.info.grade;
  input.plan.answers.grade = '9';
  assert.equal(engine.generateReport(input).meta.gradeId, '9');
});

test('draft reports expose evidence coverage and avoid diagnostics for untested subjects', () => {
  const engine = loadEngine();
  const result = engine.generateReport(state());
  assert.equal(result.meta.status, 'draft');
  assert.equal(result.meta.coverage.academic.answered, 0);
  assert.equal(result.meta.coverage.academic.total, engine.QUESTION_BANK.length);
  assert.equal(result.meta.coverage.plan.answered, 1, 'basic-information grade answers the duplicate planning question');
  assert.equal(result.meta.coverage.plan.total, engine.PLAN_QUESTIONS.filter(q => !q.optional).length, "选填题不计入完成度");
  assert.equal(result.meta.coverage.mbti.answered, 0);
  assert.equal(result.academic.answered, 0);
  assert.equal(result.academic.sci.answered, 0);
  assert.equal(result.academic.sci.total, engine.QUESTION_BANK.filter(q => ['physics', 'chemistry'].includes(q.subject)).length);
  assert.equal(result.academic.weakTopics.length, 0);
  assert.ok(result.academic.review.every(item => item.answered === false && item.correct === false));
  assert.equal(result.plan.fit.complete, false);
  assert.equal(result.plan.fit.pct, null);
  assert.ok(result.next.every(item => !/缺口|补强|门槛/.test(item.t)));
  assert.equal(majorReport(engine).subjScore, 50, 'untested subjects have no positive or negative ranking contribution');
});

test('report coverage and review use the same validation as academic grading', () => {
  const engine = loadEngine();
  const input = state();
  input.academic.answers = { en1: 0, ph1: 2, ma8: '   ' };
  const result = engine.generateReport(input);
  assert.equal(result.meta.coverage.academic.answered, 2);
  assert.equal(result.academic.sci.answered, 1);
  assert.equal(result.academic.review.find(item => item.q.id === 'en1').answered, true);
  assert.equal(result.academic.review.find(item => item.q.id === 'ma8').answered, false);
});

function completePlanAnswers(engine) {
  const answers = {};
  for (const question of engine.PLAN_QUESTIONS) {
    if (question.type === 'single') answers[question.key] = question.options()[0].id;
    else if (question.type === 'game') {
      if (question.game === 'dart') answers[question.key] = [engine.GAME_CONFIG.dart.rings[0].id];
      else if (question.game === 'race') answers[question.key] = { pace: engine.GAME_CONFIG.race.pace[0].id, partner: engine.GAME_CONFIG.race.partners[0].id };
      else {
        const cfg = engine.GAME_CONFIG[question.game];
        const ids = (question.game === 'campus' ? cfg.items : cfg.majors).map(x => x.id || x);
        answers[question.key] = Object.fromEntries(cfg.lanes.map(lane => [lane.id, []]));
        answers[question.key][cfg.lanes[0].id] = [ids[0]];
      }
    } else if (question.optional) answers[question.key] = [];
    else if (question.type === 'tags') answers[question.key] = question.source().slice(0, question.max || 1).map(o => o.id);
  }
  return answers;
}

test('completed valid questionnaires produce a complete report and a trait profile instead of a four-letter type', () => {
  const engine = loadEngine();
  const input = state();
  input.academic.answers = Object.fromEntries(engine.QUESTION_BANK.map(q => [q.id, q.answer]));
  input.mbti.answers = engine.TRAIT_QUESTIONS.map(q => ({ value: q.reversed ? 0 : 4, ms: 1200 }));
  input.plan.answers = completePlanAnswers(engine);
  const result = engine.generateReport(input);
  assert.equal(result.meta.status, 'complete');
  assert.equal(result.meta.coverage.plan.answered, result.meta.coverage.plan.total);
  assert.equal(result.meta.status, "complete", "完成全部必答题后报告状态为 complete");
  assert.equal(result.meta.coverage.plan.answered, engine.PLAN_QUESTIONS.filter(q => !q.optional).length);
  assert.equal(result.meta.coverage.plan.total, engine.PLAN_QUESTIONS.filter(q => !q.optional).length);
  assert.equal(result.academic.answered, engine.QUESTION_BANK.length);
  assert.equal(result.mbti.complete, true);
  assert.equal(result.mbti.top.length, 3);
  assert.ok(result.mbti.top.every(t => t.pct != null));
  assert.match(result.mbti.type.title, /型$/);
  assert.ok(!/^[EI][NS][TF][JP]$/.test(result.mbti.code || ''), '报告不再给出四字母人格类型');
  assert.ok(result.games.careerDart.label, '职业飞镖方向进入报告');
  assert.equal(result.games.teamRace.pace, engine.GAME_CONFIG.race.pace[0].label);
  assert.match(result.meta.batchId, /^AP-/);
});

test('game answers contribute trait signals and major-direction signals to the report', () => {
  const engine = loadEngine();
  const input = state();
  input.plan.answers.career = ['people', 'systems'];
  input.plan.answers.team = { pace: 'steady', partner: 'captain' };
  input.plan.answers.majorBoard = { heart: ['med', 'law'], watch: ['psych'], skip: [] };
  const result = engine.generateReport(input);
  assert.deepEqual([...result.games.careerDart.traits].sort(), ['empathy', 'organize', 'persuade', 'rules']);
  assert.equal(result.games.teamRace.partner, '带队队长');
  assert.equal(result.mbti.games.campusMatch, true, '星球排序贡献了专业方向信号');
  assert.ok(result.plan.prefer.length > 0, '星球排序写入专业意向');
});

test('a plan with game answers counts toward planning coverage', () => {
  const engine = loadEngine();
  const input = state();
  input.plan.answers = completePlanAnswers(engine);
  const result = engine.generateReport(input);
  assert.equal(result.meta.coverage.plan.answered, engine.PLAN_QUESTIONS.filter(q => !q.optional).length);
});

test('partial legacy state can generate a draft without nested answer containers', () => {
  const engine = loadEngine();
  const result = engine.generateReport({ info: { name: '旧记录', grade: '9' } });
  assert.equal(result.meta.status, 'draft');
  assert.equal(result.meta.gradeId, '9');
  assert.equal(result.academic.answered, 0);
});

test('constant personality answers give a flat profile without inventing crossed poles', () => {
  const engine = loadEngine();
  const result = engine.computePersonality(Array(30).fill({ value: 2, ms: 800 }));
  assert.equal(result.complete, true);
  assert.ok(result.traits.every(t => t.level === 'mid'));
  assert.equal(result.hint.code, null);
});

test('a correct partial academic answer cannot penalize a major through unanswered questions', () => {
  const engine = loadEngine();
  const input = state();
  input.plan.answers.preferredMajor = ['tech'];
  const before = engine.generateReport(input);
  input.academic.answers.ma1 = 1;
  const after = engine.generateReport(input);
  assert.equal(after.plan.top.major.id, before.plan.top.major.id);
  assert.deepEqual(after.plan.majors.map(item => [item.major.id, item.score]), before.plan.majors.map(item => [item.major.id, item.score]));
});
