const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
function load() {
  const window = {};
  const context = vm.createContext({ window });
  for (const file of ['js/bank.js', 'data/universities.js', 'js/majors.js', 'js/report.js']) {
    if (fs.existsSync(path.join(root, file))) vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  }
  return window;
}

test('lifting a 2 kg ball by 5 m accepts 100 J, not 50 J', () => {
  const w = load();
  const q = w.QUESTION_BANK.find(q => q.id === 'ph3');
  assert.equal(q.options[q.answer], '100 J');
  assert.equal(w.gradeAcademic({ answers: { ph3: 3 } }).subjects.physics.correct, 1);
  assert.equal(w.gradeAcademic({ answers: { ph3: 2 } }).subjects.physics.correct, 0);
});

test('the expanded assessment keeps legacy question positions and covers all difficulty levels in every subject', () => {
  const w = load();
  const legacy = ['en1','en2','en3','en4','en5','en6','en7','en8','en9','en10','ma1','ma2','ma3','ma4','ma5','ma6','ma7','ma8','ma9','ma10','ph1','ph2','ph3','ph4','ph5','ch1','ch2','ch3','ch4','ch5'];
  assert.deepEqual(Array.from(w.QUESTION_BANK.slice(0, 30), q => q.id), legacy);
  assert.equal(w.QUESTION_BANK.length, 60);
  assert.equal(new Set(w.QUESTION_BANK.map(q => q.id)).size, 60);
  for (const subject of ['english', 'maths', 'physics', 'chemistry']) {
    const questions = w.QUESTION_BANK.filter(q => q.subject === subject);
    assert.equal(questions.length, 15, subject);
    assert.deepEqual(Array.from(new Set(questions.map(q => q.difficulty))).sort(), ['advanced','foundation','intermediate']);
  }
  assert.match(w.QUESTION_BANK_META.version, /^\d{4}\.\d{2}$/);
  assert.equal(w.QUESTION_BANK_META.reviewStatus, 'draft');
});

test('every question can be rendered and graded with a complete answer key and explanation', () => {
  const w = load();
  for (const q of w.QUESTION_BANK) {
    assert.ok(q.prompt && q.topic && q.explain, q.id);
    if (q.subject !== 'english') assert.ok(q.zh, q.id + ' Chinese translation');
    if (q.type === 'choice') {
      assert.equal(q.options.length, 4, q.id);
      assert.ok(Number.isInteger(q.answer) && q.answer >= 0 && q.answer < q.options.length, q.id);
    } else {
      assert.equal(q.type, 'numeric', q.id);
      assert.ok(Number.isFinite(q.answer) && q.tol >= 0, q.id);
    }
  }
});

test('new calculation questions accept independently worked answers and reject common mistakes', () => {
  const w = load();
  const answer = (id, value) => {
    const question = w.QUESTION_BANK.find(q => q.id === id);
    assert.ok(question, id + ' must exist in the expanded assessment');
    return w.gradeAcademic({answers: {[id]: value}}).subjects[question.subject].correct;
  };
  for (const [id, correct, wrong] of [['ma11',12,2],['ma12',6,9],['ph6',6,24],['ph8',3,12],['ch6',0.25,4],['ch8',0.5,2]]) {
    assert.equal(answer(id, correct), 1, id + ' correct answer');
    assert.equal(answer(id, wrong), 0, id + ' common mistake');
  }
  assert.equal(w.QUESTION_BANK.find(q => q.id === 'en11').options[w.QUESTION_BANK.find(q => q.id === 'en11').answer], 'However');
  assert.equal(w.QUESTION_BANK.find(q => q.id === 'ph15').options[w.QUESTION_BANK.find(q => q.id === 'ph15').answer], '0 kg m/s');
  assert.equal(w.QUESTION_BANK.find(q => q.id === 'ch15').options[w.QUESTION_BANK.find(q => q.id === 'ch15').answer], 'Oxidation');
});

test('independent university catalogue supplies each major with review status instead of silently claiming current requirements', () => {
  const w = load();
  assert.ok(w.UNIVERSITY_CATALOG && w.UNIVERSITY_CATALOG.entries.length > 50);
  for (const major of w.MAJORS) {
    assert.ok(major.unis.length, major.id);
    const entries = w.UNIVERSITY_CATALOG.entries.filter(u => u.majorId === major.id);
    assert.deepEqual(JSON.parse(JSON.stringify(major.unis)), JSON.parse(JSON.stringify(entries)));
    for (const u of entries) {
      assert.ok(u.name && u.country && u.req, major.id);
      if (u.reviewStatus === 'verified') {
        assert.match(u.sourceUrl, /^https:\/\//);
        assert.match(u.reviewedAt, /^\d{4}-\d{2}-\d{2}$/);
        assert.equal(u.entryYear, 2027);
      } else {
        assert.equal(u.reviewStatus, 'historical');
        assert.equal(u.reviewedAt, null);
      }
    }
  }
  for (const id of ['cs','math']) {
    const oxford = w.UNIVERSITY_CATALOG.entries.find(u => u.majorId === id && u.name === '牛津大学');
    assert.match(oxford.note, /TMUA/);
    assert.equal(oxford.reviewStatus, 'verified');
  }
});

test('recommended A-Level subject IDs match selectable subject IDs', () => {
  const w = load();
  for (const major of w.MAJORS) {
    for (const subject of [...major.required, ...major.helpful, ...Object.keys(major.alSupport)]) {
      assert.ok(w.ALEVEL_SUBJECTS.includes(subject), major.id + ': ' + subject);
    }
  }
});

test('undergraduate suggestions exclude postgraduate-only institutions and corrected Oxford requirements use current tests', () => {
  const w = load();
  assert.equal(w.UNIVERSITY_CATALOG.entries.some(u => /伦敦商学院|皇家艺术学院/.test(u.name)), false);
  const oxford = id => w.UNIVERSITY_CATALOG.entries.find(u => u.majorId === id && u.name.startsWith('牛津大学'));
  assert.equal(oxford('chem').req, 'A*A*A');
  assert.equal(oxford('phys').req, 'A*AA');
  assert.match(oxford('phys').note, /ESAT/);
  assert.match(oxford('econ').note, /TARA/);
  assert.match(oxford('intl').note, /TARA/);
  const mit = w.UNIVERSITY_CATALOG.entries.find(u => u.name === 'MIT');
  assert.equal(/1550|AP 物理 C/.test(mit.req), false);
  assert.match(mit.note, /不设.*最低分/);
});
