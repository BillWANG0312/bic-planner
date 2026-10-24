const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

function loadEngine() {
  const context = vm.createContext({ console });
  context.window = context;
  for (const script of ['bank', 'majors', 'plan', 'mbti', 'report']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', `${script}.js`), 'utf8'), context);
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
  input.plan.answers = { preferredMajor: [options.preference || 'tech'] };
  input.mbti.answers = options.mbti || [];
  input.academic.answers = options.academic || {};
  return engine.generateReport(input).plan.majors.find(item => item.major.id === (options.major || 'cs'));
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
  assert.equal(majorReport(engine, { academic: answers }).subjScore, 60);
});

test('T and F preferences contribute in opposite directions to technology matching', () => {
  const engine = loadEngine();
  const answers = pole => engine.MBTI_QUESTIONS.map(q => q.dim === 'TF' ? (q.pole === pole ? 4 : 0) : 2);
  const thinking = majorReport(engine, { mbti: answers('T') });
  const feeling = majorReport(engine, { mbti: answers('F') });
  assert.equal(thinking.score - feeling.score, 6);
});

test('N and S preferences contribute in opposite directions to medicine matching', () => {
  const engine = loadEngine();
  const answers = pole => engine.MBTI_QUESTIONS.map(q => q.dim === 'SN' ? (q.pole === pole ? 4 : 0) : 2);
  const intuitive = majorReport(engine, { preference: 'med', major: 'med', mbti: answers('N') });
  const sensing = majorReport(engine, { preference: 'med', major: 'med', mbti: answers('S') });
  assert.equal(intuitive.score - sensing.score, 4);
});

test('incomplete personality dimensions do not change major recommendations', () => {
  const engine = loadEngine();
  const answers = [];
  answers[12] = 4;
  assert.equal(majorReport(engine, { mbti: answers }).score, majorReport(engine).score);
});

test('an empty personality questionnaire has no invented type', () => {
  const engine = loadEngine();
  const result = engine.computeMBTI([]);
  assert.equal(result.code, null);
  assert.equal(result.type, null);
  assert.equal(result.answered, 0);
  assert.equal(result.total, 24);
  assert.equal(result.complete, false);
  assert.equal(result.hasSignal, false);
  assert.equal(result.TF.answered, 0);
  assert.equal(result.TF.total, 6);
  assert.equal(result.TF.pctA, 50);
});

test('complete neutral personality answers describe balance rather than a default type', () => {
  const engine = loadEngine();
  const result = engine.computeMBTI(Array(24).fill(2));
  assert.equal(result.answered, 24);
  assert.equal(result.complete, true);
  assert.equal(result.hasSignal, false);
  assert.equal(result.code, null);
  assert.equal(result.type, null);
});

test('personality coverage rejects invalid persisted values and retains a legitimate zero', () => {
  const engine = loadEngine();
  const result = engine.computeMBTI([0, '4', 5, -1, Infinity, null]);
  assert.equal(result.answered, 1);
  assert.equal(result.EI.answered, 1);
  assert.equal(result.EI.complete, false);
  assert.equal(result.hasSignal, false, '有效的 0 计入作答，但两侧得分仍相等，不推断方向');
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
  assert.equal(result.meta.coverage.plan.total, engine.PLAN_QUESTIONS.length);
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

test('completed valid questionnaires produce a complete report and valid personality type', () => {
  const engine = loadEngine();
  const input = state();
  input.academic.answers = Object.fromEntries(engine.QUESTION_BANK.map(q => [q.id, q.answer]));
  input.mbti.answers = engine.MBTI_QUESTIONS.map(q => ['E', 'N', 'T', 'J'].includes(q.pole) ? 4 : 0);
  for (const question of engine.PLAN_QUESTIONS) {
    input.plan.answers[question.key] = question.type === 'single'
      ? question.options()[0].id : question.optional ? [] : [question.source()[0].id];
  }
  const result = engine.generateReport(input);
  assert.equal(result.meta.status, 'complete');
  assert.equal(result.meta.coverage.plan.answered, engine.PLAN_QUESTIONS.length);
  assert.equal(result.academic.answered, engine.QUESTION_BANK.length);
  assert.equal(result.mbti.code, 'ENTJ');
  assert.equal(result.mbti.complete, true);
  assert.match(result.meta.batchId, /^AP-/);
});

test('partial legacy state can generate a draft without nested answer containers', () => {
  const engine = loadEngine();
  const result = engine.generateReport({ info: { name: '旧记录', grade: '9' } });
  assert.equal(result.meta.status, 'draft');
  assert.equal(result.meta.gradeId, '9');
  assert.equal(result.academic.answered, 0);
});

test('equal MBTI pole scores never invent a four-letter type for any constant answer', () => {
  const engine = loadEngine();
  for (const value of [0, 1, 2, 3, 4]) {
    const result = engine.computeMBTI(Array(24).fill(value));
    assert.equal(result.complete, true);
    assert.equal(result.code, null, `所有维度打平，作答值 ${value} 不应产生人格类型`);
    assert.equal(result.hasSignal, false);
  }
});

test('one tied dimension prevents a definite four-letter personality profile', () => {
  const engine = loadEngine();
  const answers = engine.MBTI_QUESTIONS.map(q => q.dim === 'EI' ? 3 : ['N', 'T', 'J'].includes(q.pole) ? 4 : 0);
  const result = engine.computeMBTI(answers);
  assert.equal(result.code, null);
  assert.equal(result.type, null);
  assert.equal(result.EI.hasSignal, false);
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
