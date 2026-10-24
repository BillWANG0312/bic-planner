const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadReportScripts() {
  const window = {};
  const context = vm.createContext({ window, console, Date, setTimeout, requestAnimationFrame: fn => fn() });
  for (const file of ['js/bank.js', 'js/mbti.js', 'data/universities.js', 'js/majors.js', 'js/plan.js', 'js/report.js', 'js/report-editing.js', 'js/report-view.js']) {
    const full = path.join(__dirname, '../..', file);
    if (fs.existsSync(full)) vm.runInContext(fs.readFileSync(full, 'utf8'), context, { filename: file });
  }
  return window;
}

function state(w, complete = false) {
  return {
    info: { name: '测试同学', grade: '8', year: '2027 年秋季' },
    academic: { answers: complete ? Object.fromEntries(w.QUESTION_BANK.map(q => [q.id, q.answer])) : {} },
    plan: { answers: complete ? { grade: '8', interests: ['math'], schoolSubjects: ['数学'], clubs: ['coding'], selfImage: ['rational'], preferredMajor: ['cs'], freeTime: ['make'], career: [], countries: ['uk'] } : {} },
    mbti: { answers: complete ? w.MBTI_QUESTIONS.map(q => ['E', 'N', 'T', 'J'].includes(q.pole) ? 4 : 0) : [] }
  };
}
module.exports = { loadReportScripts, state };
