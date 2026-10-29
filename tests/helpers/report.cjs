const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadReportScripts() {
  const window = {};
  const context = vm.createContext({ window, console, Date, setTimeout, requestAnimationFrame: fn => fn() });
  // 本机报告库不在这里加载：需要它的测试自行装入后，才真正用到旧版校验。
  for (const file of ['js/bank.js', 'js/mbti.js', 'data/universities.js', 'js/majors.js', 'js/plan.js', 'js/personality.js', 'js/games.js', 'js/assessment-profile.js', 'js/legacy-assessment.js', 'js/report.js', 'js/report-editing.js', 'js/report-view.js']) {
    const full = path.join(__dirname, '../..', file);
    if (fs.existsSync(full)) vm.runInContext(fs.readFileSync(full, 'utf8'), context, { filename: file });
  }
  return window;
}

function completePlan(w, L = {}) {
  const answers = {};
  for (const q of w.PLAN_QUESTIONS) {
    // L：按 key 覆盖某题的作答（版本识别测试用来构造无标记的旧版进度）。
    if (Object.hasOwn(L, q.key)) { answers[q.key] = L[q.key]; continue; }
    if (q.type === 'single') answers[q.key] = q.options()[0].id;
    else if (q.type === 'game') {
      const cfg = w.GAME_CONFIG[q.game];
      if (q.game === 'dart') answers[q.key] = [cfg.rings[0].id];
      else if (q.game === 'race') answers[q.key] = { pace: cfg.pace[0].id, partner: cfg.partners[0].id };
      else {
        const ids = (q.game === 'campus' ? cfg.items : cfg.majors).map(x => x.id || x);
        answers[q.key] = Object.fromEntries(cfg.lanes.map(lane => [lane.id, []]));
        answers[q.key][cfg.lanes[0].id] = [ids[0]];
      }
    } else if (q.optional) answers[q.key] = [];
    else if (q.type === 'tags') answers[q.key] = q.source().slice(0, q.max || 1).map(o => o.id);
  }
  return answers;
}

function state(w, complete = false, current = true) {
  const value = {
    assessmentProfile: w.AssessmentProfiles.CURRENT,
    info: { name: '测试同学', grade: '8', year: '2027 年秋季' },
    academic: { answers: complete ? Object.fromEntries(w.QUESTION_BANK.map(q => [q.id, q.answer])) : {} },
    plan: { answers: complete ? { ...completePlan(w), preferredMajor: ['tech'] } : {} },
    // 当前版作答存结构化选项，按 30 题留位；未作答时整排 null，空作答靠规划题的当前版标记识别。
    mbti: { answers: complete ? w.TRAIT_QUESTIONS.map(q => ({ value: q.reversed ? 0 : 4, ms: 900 })) : Array(w.TRAIT_QUESTIONS.length).fill(null) }
  };
  // current = false 时按旧版客户端写入的进度处理：不作答性格题，也不带版本标记，用于版本识别测试。
  if (!current) { delete value.assessmentProfile; value.mbti = { answers: [] }; }
  return value;
}
function legacyState(w, complete = false) {
  const a = w.LegacyAssessment;
  return { info: { name: '旧版测试同学', grade: '8', year: '2027 年秋季' },
    academic: { answers: complete ? Object.fromEntries(w.QUESTION_BANK.map(q => [q.id, q.answer])) : {} },
    plan: { answers: complete ? Object.fromEntries(a.planQuestions.map(q => [q.key, q.type === 'single' ? q.options()[0].id
      : q.optional ? [] : q.source().slice(0, q.max || 1).map(option => option.id)])) : {} },
    // 旧版库按 24 项作答存满；未作答时用 1 项已作答保持「旧版作答中」的形状。
    mbti: { answers: complete ? a.mbtiQuestions.map(q => q.pole === q.dim[0] ? 4 : 0) : [4] } };
}
module.exports = { loadReportScripts, state, legacyState, completePlan };
