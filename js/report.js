/* ============================================================
 * 报告生成引擎（规则驱动，无 AI 依赖）
 * 输入：state.academic / state.plan / state.personality
 * 输出：结构化对象，由 report-view 渲染
 * ============================================================ */
(function () {
  const M = window.MAJORS;

  // 评分、答题覆盖率与逐题回顾共用校验，避免空字符串被 Number() 当作 0。
  function evaluateAnswer(q, answer) {
    const answered = q.type === 'choice'
      ? Number.isInteger(answer) && answer >= 0 && answer < q.options.length
      : (typeof answer === 'number' || typeof answer === 'string' && answer.trim() !== '')
        && Number.isFinite(Number(answer));
    const correct = answered && (q.type === 'choice' ? answer === q.answer
      : Math.abs(Number(answer) - q.answer) <= (q.tol || 0));
    return { answered, correct };
  }

  /* ---------- 学术得分 ---------- */
  function gradeAcademic(academic) {
    const answers = academic && academic.answers || {};
    const bank = window.QUESTION_BANK;
    const bySubject = { english: [0, 0, 0], maths: [0, 0, 0], physics: [0, 0, 0], chemistry: [0, 0, 0] };
    const topic = {};
    bank.forEach((q) => {
      const { answered, correct } = evaluateAnswer(q, answers[q.id]);
      bySubject[q.subject][1] += 1;
      if (correct) bySubject[q.subject][0] += 1;
      if (answered) bySubject[q.subject][2] += 1;
      if (!topic[q.subject]) topic[q.subject] = {};
      if (!topic[q.subject][q.topic]) topic[q.subject][q.topic] = [0, 0, 0];
      topic[q.subject][q.topic][1] += 1;
      if (correct) topic[q.subject][q.topic][0] += 1;
      if (answered) topic[q.subject][q.topic][2] += 1;
    });
    const subjects = {};
    Object.entries(bySubject).forEach(([k, [c, t, a]]) => {
      subjects[k] = { correct: c, total: t, answered: a, complete: a === t, pct: t ? Math.round((c / t) * 100) : 0 };
    });
    const sciTotal = subjects.physics.total + subjects.chemistry.total;
    const sciAnswered = subjects.physics.answered + subjects.chemistry.answered;
    const sciPct = sciTotal ? Math.round((subjects.physics.correct + subjects.chemistry.correct) / sciTotal * 100) : 0;
    return { subjects, sciPct, sciAnswered, sciTotal, topic,
      answered: Object.values(subjects).reduce((count, subject) => count + subject.answered, 0), total: bank.length };
  }

  function band(pct) {
    return window.ALEVEL_BANDS.find(b => pct >= b.min) || window.ALEVEL_BANDS[window.ALEVEL_BANDS.length - 1];
  }

  /* ---------- 性格特质 → 专业匹配 ---------- */
  // 每个专业最受益的性格特质；特质 pct 高于 50 时提供正向加分。
  const MAJOR_TRAITS = {
    cs: ['analyze', 'execute', 'curiosity'], math: ['analyze', 'numbers', 'rules'],
    phys: ['curiosity', 'analyze', 'resilience'], eng: ['execute', 'analyze', 'create'],
    chem: ['curiosity', 'rules', 'execute'], med: ['empathy', 'resilience', 'rules'],
    bio: ['curiosity', 'analyze', 'execute'], econ: ['numbers', 'analyze', 'persuade'],
    biz: ['organize', 'persuade', 'numbers'], law: ['persuade', 'analyze', 'rules'],
    psych: ['empathy', 'curiosity', 'analyze'], design: ['create', 'empathy', 'execute'],
    media: ['create', 'persuade', 'curiosity'], intl: ['persuade', 'curiosity', 'empathy']
  };
  // 只在相关特质都测过（每项至少 3 题）时求均值：零散回答不足以推断优势，
  // 避免“只答了一道分析题就认定分析型”的以偏概全。
  function traitScoreFor(majorId, personality) {
    const ids = MAJOR_TRAITS[majorId] || [];
    const traits = ids.map(id => personality.byId?.[id]);
    if (!traits.length || !traits.every(t => t && t.answered >= 3 && t.pct != null)) return null;
    const values = traits;
    return values.reduce((sum, t) => sum + t.pct, 0) / values.length;
  }

  // 小游戏结果合并进规划答案：分格卡片写入 schoolSubjects / weakSubjects / preferredMajor。
  // 同时兼容旧版仅有的 schoolSubjects / weakSubjects / preferredMajor 存档。
  function mergeBoards(plan) {
    const answers = { ...plan };
    // 旧版存档直接把专业 id（cs）写进 preferredMajor，新版这里是兴趣选项 id（tech）
    if (Array.isArray(answers.preferredMajor)) {
      const opts = window.INTEREST_OPTIONS;
      answers.preferredMajor = [...new Set(answers.preferredMajor.flatMap(id => {
        const opt = opts.find(o => o.id === id);
        const asOpt = opt || opts.find(o => o.major === id);
        if (!asOpt) return [];
        if (asOpt.major) return [asOpt.id];
        return opts.filter(o => o.major).map(o => o.id); // 「还没想好」不限制专业意向
      }))];
    }
    if (answers.career !== undefined && !Array.isArray(answers.career) && window.CAREER_PATHS.some(o => o.majorIds.includes(answers.career))) {
      answers.career = [answers.career]; // 旧版单选的职业方向
    }
    const board = answers.subjectBoard;
    if (window.isBoardAnswer && window.isBoardAnswer(board)) {
      const likes = [...(board.like || []), ...(board.try || [])];
      const avoid = board.avoid || [];
      answers.schoolSubjects = likes.length ? [...new Set(likes)] : (answers.schoolSubjects || []);
      answers.weakSubjects = [...new Set([...(answers.weakSubjects || []), ...avoid])];
    }
    const major = answers.majorBoard;
    if (window.isBoardAnswer && window.isBoardAnswer(major)) {
      // 星球排序里「心动 + 观望」的专业直接进入专业意向列表
      const ids = [...(major.heart || []), ...(major.watch || [])].filter(id => window.MAJORS.some(m => m.id === id));
      if (ids.length) answers.preferredMajor = [...new Set([...ids, ...(answers.preferredMajor || [])])];
    }
    return answers;
  }

  /* ---------- 专业匹配 ---------- */
  function scoreMajors(plan, academic, personality) {
    const interests = window.INTEREST_POOL.filter(o => (plan.interests || []).includes(o.id));
    const clubs = plan.clubs || [];
    const free = window.PLAN_CONFIG.freeTime.filter(o => (plan.freeTime || []).includes(o.id));
    const self = plan.selfImage || [];
    // 专业意向同时接受兴趣选项 id（tech）和专业 id（cs）
    const prefMajor = [...new Set((plan.preferredMajor || []).map(id =>
      window.INTEREST_OPTIONS.find(o => o.id === id)?.major || (window.MAJORS.some(m => m.id === id) ? id : null)).filter(Boolean))];
    const careers = window.CAREER_PATHS.filter(o => (plan.career || []).includes(o.id));
    const school = plan.schoolSubjects || [];
    const weak = plan.weakSubjects || [];

    const moodCluster = { rational: 'math', empathic: 'social', creative: 'creative', practical: 'physics', leader: 'social', explorer: 'humanities' };
    const clubCluster = { debate: 'humanities', modelun: 'humanities', mathclub: 'math', coding: 'math', journalism: 'creative', drama: 'creative', sports: 'biology', volunteer: 'social', art: 'creative', music: 'creative', env: 'biology', business: 'social' };

    const clusterScore = {};
    interests.forEach(o => o.clusters.forEach(c => { clusterScore[c] = (clusterScore[c] || 0) + 3; }));
    clubs.forEach(id => { const c = clubCluster[id]; if (c) clusterScore[c] = (clusterScore[c] || 0) + 1.5; });
    free.forEach(o => o.clusters.forEach(c => { clusterScore[c] = (clusterScore[c] || 0) + 1; }));
    self.forEach(id => { const c = moodCluster[id]; if (c) clusterScore[c] = (clusterScore[c] || 0) + 2; });

    // 尚未测过的科目不产生正负加权，草稿中的 0 分不等于能力缺失。
    const subject = key => academic.subjects[key].complete ? academic.subjects[key].pct : 50;
    const science = academic.sciTotal
      ? (subject('physics') * academic.subjects.physics.total + subject('chemistry') * academic.subjects.chemistry.total) / academic.sciTotal : 50;
    const subjectScores = {
      cs: subject('maths') * 0.6 + science * 0.4,
      math: subject('maths'),
      phys: subject('maths') * 0.5 + subject('physics') * 0.5,
      eng: subject('maths') * 0.5 + subject('physics') * 0.5,
      chem: subject('chemistry'),
      med: subject('chemistry'),
      bio: subject('chemistry'),
      econ: subject('maths') * 0.7 + subject('english') * 0.3,
      biz: subject('english') * 0.5 + subject('maths') * 0.5,
      law: subject('english'),
      psych: subject('english') * 0.5 + subject('chemistry') * 0.5,
      design: subject('english'),
      media: subject('english'),
      intl: subject('english')
    };

    const results = M.map(m => {
      let score = 0;
      const reasons = [];
      const cs = m.cluster ? (clusterScore[m.cluster] || 0) : 0;
      // 兴趣命中：具体的兴趣标签 + 集群
      const hitInterests = interests.filter(o => o.clusters.includes(m.cluster));
      score += cs;
      if (hitInterests.length) reasons.push(`你的兴趣（${hitInterests.slice(0, 2).map(o => o.label).join('、')}）与${m.name}高度吻合`);
      // 社团
      const hitClubs = clubs.filter(id => clubCluster[id] === m.cluster);
      if (hitClubs.length) reasons.push(`参加过 ${hitClubs.slice(0, 2).map(id => window.PLAN_QUESTIONS.find(q => q.id === 'club').source().find(s => s.id === id).label).join('、')} 等相关社团`);
      // 明确专业意向
      if (prefMajor.includes(m.id)) { score += 10; reasons.push('你在专业意向中明确选择了这个方向'); }
      // 职业方向
      const hitCareer = careers.filter(c => c.majorIds.includes(m.id));
      if (hitCareer.length) { score += 5; reasons.push(`与你期望的职业路径「${hitCareer[0].label}」一致`); }
      // 擅长学科（A-Level 相关：生物/化学 → bio/med/chem；经济 → econ）
      const haveSubject = (s) => school.includes(s);
      const relevantSchool = { med: ['生物', '化学'], bio: ['生物', '化学'], chem: ['化学'], phys: ['物理', '数学'], math: ['数学'], econ: ['经济学', '数学'], biz: ['商科', '经济学'], psych: ['心理学'], law: ['历史', '英语文学'], design: ['艺术', '设计'], media: ['英语文学'], intl: ['历史', '英语文学'], cs: ['数学', '计算机'], eng: ['数学', '物理'] };
      const rel = (relevantSchool[m.id] || []).filter(haveSubject);
      if (rel.length) { score += rel.length * 2; reasons.push(`自评擅长 ${rel.join('、')}，是该专业的重要基础`); }
      const weakRel = (relevantSchool[m.id] || []).filter(s => weak.includes(s));
      if (weakRel.length) { score -= weakRel.length * 1.5; }
      // 学业能力适配（占比较大）
      const subjScore = subjectScores[m.id] ?? 50;
      score += (subjScore - 50) * 0.35;
      // 性格特质与专业收益的匹配（轻量加权，避免盖过兴趣与能力）
      const traitScore = traitScoreFor(m.id, personality);
      if (traitScore != null) {
        // 特质加分随「这组特质有多契合」缩放：分析/数字强 → 计算机加分，共情/rules 强时不加分甚至略扣
        const ids = MAJOR_TRAITS[m.id] || [];
        const fitOf = id => Math.max(0, ((personality.byId?.[id]?.pct ?? 50) - 50) / 50);
        const fit = ids.reduce((sum, id) => sum + fitOf(id), 0) / ids.length;
        score += (traitScore - 50) * 0.2 * fit;
        const hit = ids.filter(id => personality.byId?.[id]?.answered >= 3 && personality.byId[id].pct >= 65);
        if (hit.length && fit >= 0.3) reasons.push(`你的性格特质（${hit.map(id => window.TRAITS.find(t => t.id === id)?.label).filter(Boolean).join('、')}）在这个方向能长期发挥优势`);
      }
      // 不同专业自身的集群偏好权重
      score += m.clusterBonus || 0;
      return { major: m, score, subjScore, reasons };
    }).sort((a, b) => b.score - a.score);

    return results;
  }

  /* ---------- A-Level 选科建议 ---------- */
  function recommendSubjects(major, plan, academic) {
    const rec = [];
    const add = (name, reason, kind) => {
      if (!rec.find(r => r.name === name)) rec.push({ name, reason, kind });
    };
    major.required.forEach(s => add(s, `${major.name}方向的核心必修/强推荐科目`, 'required'));
    major.helpful.forEach(s => add(s, `${major.name}方向的加分科目`, 'helpful'));
    // 补足至 3 门可选建议
    const fallback = { cs: ['进阶数学', '物理'], math: ['进阶数学', '物理'], phys: ['进阶数学'], eng: ['进阶数学'], chem: ['数学'], med: ['数学'], bio: ['数学'], econ: ['进阶数学', '历史'], biz: ['经济学'], law: ['历史'], psych: ['数学'], design: ['艺术'], media: ['历史'], intl: ['经济学'] };
    (fallback[major.id] || []).forEach(s => add(s, '与目标专业互补的搭配', 'helpful'));
    const school = plan.schoolSubjects || [];
    school.forEach(s => {
      if (!rec.find(r => r.name === s) && window.ALEVEL_SUBJECTS.includes(s) && s !== '中文') {
        add(s, '你的优势科目，可作为第三/第四门选科', 'strong');
      }
    });
    return rec.slice(0, 4);
  }

  /* ---------- 国家建议 ---------- */
  function recommendCountries(major, plan) {
    const pref = plan.countries || [];
    const list = window.COUNTRY_OPTIONS.filter(o => o.id !== 'unsure');
    const score = list.map(c => {
      let s = 0;
      if (major.countries.includes(c.label)) s += 5;
      if (pref.includes(c.id)) s += 4;
      if (plan.countries && plan.countries.length && !plan.countries.includes(c.id) && c.id !== 'unsure') s -= 1;
      return { ...c, s };
    }).sort((a, b) => b.s - a.s).slice(0, 3);
    return score;
  }

  /* ---------- 院校分层 ---------- */
  function tierUnis(major) {
    const byCountry = {};
    major.unis.forEach(u => { (byCountry[u.country] = byCountry[u.country] || []).push(u); });
    const out = [];
    Object.entries(byCountry).forEach(([country, arr]) => out.push({ country, unis: arr }));
    return out;
  }

  /* ---------- 能力预估 ---------- */
  function fitForMajor(major, academic) {
    const subjectKeys = { '数学': 'maths', '物理': 'physics', '化学': 'chemistry' };
    const keys = [...new Set((major.required || []).map(s => subjectKeys[s]).filter(Boolean))];
    const measured = (keys.length ? keys : ['english', 'maths']).map(key => academic.subjects[key]);
    const answered = measured.reduce((count, subject) => count + subject.answered, 0);
    const total = measured.reduce((count, subject) => count + subject.total, 0);
    const complete = total > 0 && answered === total;
    const evidence = { answered, total, complete };
    if (!complete) return { ...evidence, level: '待完成测评', cls: 'pending', pct: null,
      note: '相关基础科目的作答尚未完成；完成测评后再评估学科准备情况，当前不作能力判断。' };
    const pct = Math.round(measured.reduce((sum, subject) => sum + subject.pct, 0) / measured.length);
    if (pct >= 75) return { ...evidence, level: '适配度高', cls: 'good', pct, note: '本次测评覆盖的相关基础科目表现扎实，可继续挑战进阶内容。' };
    if (pct >= 55) return { ...evidence, level: '基本适配', cls: 'mid', pct, note: '本次测评覆盖的基础尚可，建议结合错题回顾安排衔接学习。' };
    return { ...evidence, level: '需重点准备', cls: 'weak', pct, note: '本次测评覆盖的相关基础科目存在薄弱点，建议安排针对性的衔接学习。' };
  }

  function normalizePlan(raw, info) {
    const plan = {};
    raw = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    window.PLAN_QUESTIONS.forEach(q => {
      const value = raw[q.key];
      if (q.type === 'game') {
        const normalized = normalizeGame(q, value);
        if (normalized != null) plan[q.key] = normalized;
      } else if (q.type === 'single') {
        if (q.options().some(option => option.id === value)) plan[q.key] = value;
      } else if (Array.isArray(value)) {
        const options = q.source().map(option => option.id);
        plan[q.key] = [...new Set(value.filter(item => typeof item === 'string'
          && (options.includes(item) || q.multiFree && item.trim() !== '')).map(item => item.trim()))]
          .slice(0, q.max || Infinity);
      }
    });
    // 旧版存档 / 显式意向：preferredMajor 不是 PLAN_QUESTIONS 的字段，但报告仍会使用
    if (Array.isArray(raw.preferredMajor)) {
      plan.preferredMajor = [...new Set(raw.preferredMajor.filter(id => typeof id === 'string'
        && (window.INTEREST_OPTIONS.some(o => o.id === id) || window.MAJORS.some(m => m.id === id))))];
    }
    const grade = String(info.grade || '');
    if (window.PLAN_CONFIG.grade.some(option => option.id === grade)) plan.grade = grade;
    return plan;
  }

  // 校验并保留小游戏答案：分格卡片 / 职业靶环 / 团队竞速
  function normalizeGame(q, value) {
    if (q.game === 'campus' || q.game === 'planet') {
      if (!window.isBoardAnswer || !window.isBoardAnswer(value)) return null;
      const cfg = window.GAME_CONFIG[q.game];
      const allowed = new Set((q.game === 'campus' ? cfg.items : cfg.majors).map(x => x.id || x));
      const board = {};
      cfg.lanes.forEach(lane => {
        board[lane.id] = (value[lane.id] || []).filter(id => allowed.has(id)).slice(0, cfg.capacity);
      });
      return board;
    }
    if (q.game === 'dart') {
      const allowed = window.GAME_CONFIG.dart.rings.map(r => r.id);
      if (!Array.isArray(value)) return null;
      return [...new Set(value.filter(id => allowed.includes(id)))].slice(0, window.GAME_CONFIG.dart.max);
    }
    if (q.game === 'race') {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
      const cfg = window.GAME_CONFIG.race;
      const out = {};
      if (cfg.pace.some(p => p.id === value.pace)) out.pace = value.pace;
      if (cfg.partners.some(p => p.id === value.partner)) out.partner = value.partner;
      return Object.keys(out).length === 2 ? out : null;
    }
    return null;
  }

  function isPlanAnswered(q, value) {
    if (typeof q.isAnswered === 'function') return q.isAnswered(value);
    return Array.isArray(value) ? value.length > 0 : value != null && value !== '';
  }

  // 选填题不计入完成度；answered 与 total 都只统计必答题目
  function planCoverage(plan) {
    const required = window.PLAN_QUESTIONS.filter(q => !q.optional);
    const answered = required.filter(q => isPlanAnswered(q, plan[q.key])).length;
    const complete = answered === required.length;
    return { answered, total: required.length, complete };
  }

  // 小游戏 → 性格特质信号（飞镖、竞速）与专业方向信号（星球）
  function gameSignals(rawPlan) {
    const dart = window.GAME_CONFIG.dart.rings.find(r => r.id === (rawPlan.career || [])[0]);
    const race = rawPlan.team || {};
    const traits = new Set();
    (rawPlan.career || []).forEach(id => (window.GAME_CONFIG.dart.rings.find(r => r.id === id)?.traits || []).forEach(t => traits.add(t)));
    const pace = window.GAME_CONFIG.race.pace.find(p => p.id === race.pace);
    const partner = window.GAME_CONFIG.race.partners.find(p => p.id === race.partner);
    (pace?.traits || []).forEach(t => traits.add(t));
    (partner?.traits || []).forEach(t => traits.add(t));
    const majorBoard = window.isBoardAnswer && window.isBoardAnswer(rawPlan.majorBoard) ? rawPlan.majorBoard : null;
    const heart = majorBoard ? [...(majorBoard.heart || []), ...(majorBoard.watch || [])] : [];
    return {
      careerDart: { traits: [...new Set((rawPlan.career || []).flatMap(id => window.GAME_CONFIG.dart.rings.find(r => r.id === id)?.traits || []))], label: dart?.label || '' },
      teamRace: { traits: [...traits], pace: pace?.label || '', partner: partner?.label || '' },
      campusMatch: { answers: heart },
      traits: [...traits]
    };
  }

  // 报告里的性格对象：保留旧版 mbti 字段（answered/total/complete/code/type），额外附带特质画像
  function personalityForReport(personality) {
    const top = personality.top[0];
    const hint = personality.hint;
    const mbtiHint = hint.code ? { code: hint.code } : null;
    const type = top && top.level !== 'low' ? personalityTypeOf(personality) : null;
    return {
      ...personality,
      code: mbtiHint ? mbtiHint.code : null,
      type,
      top: personality.top,
      growth: personality.growth
    };
  }
  // 用特质组合生成一句职业取向画像（不套用十六型人格标签）
  function personalityTypeOf(personality) {
    const top = personality.top[0];
    if (!top) return null;
    const second = personality.top[1];
    const watch = [...(top.watch || []), ...(second?.watch || [])].slice(0, 2);
    return {
      title: `${top.label}型`,
      tag: top.careers.slice(0, 3).join(' · '),
      desc: `${top.desc}${second ? `同时你的${second.label}也很突出，` : ''}这类特质在学习和工作中最直接的作用是：${top.strengths}。`,
      strengths: [top.strengths],
      watch,
      study: `选课时优先考虑能让「${top.label}」发挥作用的科目与项目；遇到需要你${watch[0] ? watch[0].replace(/^注意|^留意/, '') : '换方式思考'}的任务时，提前预留更多时间。`
    };
  }

  /* ---------- 主入口 ---------- */
  function generateReport(state = {}) {
    const info = state.info || {};
    const academic = gradeAcademic(state.academic);
    const rawPlan = state.plan && state.plan.answers;
    const games = gameSignals(rawPlan && typeof rawPlan === 'object' ? rawPlan : {});
    const mbti = personalityForReport(window.computePersonality(state.mbti && state.mbti.answers, games));
    const plan = mergeBoards(normalizePlan(rawPlan, info));
    const planning = planCoverage(plan);
    plan.preferredMajor = (plan.preferredMajor || []).slice(0, 6);
    const coverage = {
      academic: { answered: academic.answered, total: academic.total },
      plan: { answered: planning.answered, total: planning.total },
      mbti: { answered: mbti.answered, total: mbti.total }
    };
    const majors = scoreMajors(plan, academic, mbti);
    const top = majors[0];
    const second = majors[1];

    // 学科分析
    const subjectList = Object.entries(academic.subjects).map(([k, v]) => ({
      key: k, ...window.SUBJECT_META[k], ...v, band: band(v.pct)
    })).sort((a, b) => b.pct - a.pct);
    const sci = { key: 'science', name: '理科综合', nameEn: 'Science (Phys + Chem)', icon: '🔬',
      pct: academic.sciPct, band: band(academic.sciPct), answered: academic.sciAnswered, total: academic.sciTotal,
      complete: academic.sciAnswered === academic.sciTotal };
    const strengths = subjectList.filter(s => s.complete && s.answered && s.pct >= 70);
    // 薄弱点：按主题找正确率低的
    const weakTopics = [];
    Object.entries(academic.topic).forEach(([subj, topics]) => {
      Object.entries(topics).forEach(([t, [c, tot, answered]]) => {
        if (answered === tot && answered > 0 && c / tot < 0.6) weakTopics.push({ subject: window.SUBJECT_META[subj].name, topic: t, pct: Math.round(c / tot * 100) });
      });
    });
    // 逐题回顾（错题+解析）
    const review = window.QUESTION_BANK.map(q => {
      const a = state.academic && state.academic.answers && state.academic.answers[q.id];
      return { q, a, ...evaluateAnswer(q, a) };
    });

    const recSubjects = recommendSubjects(top.major, plan, academic);
    const countries = recommendCountries(top.major, plan);
    const unis = tierUnis(top.major);
    const fit = fitForMajor(top.major, academic);
    const fit2 = second ? fitForMajor(second.major, academic) : null;

    // 下一步建议
    const next = [];
    if (academic.answered < academic.total) next.push({ t: '先完成学术测评', d: `目前已作答 ${academic.answered}/${academic.total} 题；未答题暂计入总题数，完成后再解读科目分数与能力准备情况。` });
    if (academic.subjects.english.complete && academic.subjects.english.pct < 60) next.push({ t: '英语能力是 A-Level 的核心门槛', d: '除英语外所有科目都要求学术英语（阅读大段题干、写论证型答案）。建议每天 20 分钟英语原版阅读，并每周写一篇 200 词学术短文。' });
    if (academic.subjects.maths.complete && academic.subjects.maths.pct < 60) next.push({ t: '数学基础需系统补强', d: '数学几乎是所有 STEM 与商科专业的门槛。建议优先补齐函数、代数变形、三角与基础微积分，再进入 A-Level Pure Math。' });
    if (sci.complete && academic.sciPct < 60) next.push({ t: '理科（物理 / 化学）存在知识缺口', d: '若希望走 STEM 路线，开学前应集中复习力学、物质的量与酸碱基础，配合实验理解。' });
    if (academic.subjects.english.complete && academic.subjects.english.pct >= 70) next.push({ t: '发挥英语优势', d: '英语强项是人文、传媒、法律方向的优势，也意味着你可以更快适应全英文授课，建议尝试英文辩论或论文写作训练。' });
    if (academic.subjects.maths.complete && academic.subjects.maths.pct >= 75) next.push({ t: '数学能力可以成为"硬实力"', d: `数学表现突出，适合冲刺 ${['cs', 'math', 'phys', 'eng', 'econ'].includes(top.major.id) ? '该专业' : '数学要求较高的专业'}；建议尽早接触进阶数学（Further Maths）内容。` });

    return {
      meta: {
        name: info.name || '', gradeId: plan.grade || '',
        grade: (window.PLAN_CONFIG.grade.find(g => g.id === plan.grade) || {}).label || '',
        status: academic.answered === academic.total && planning.complete && mbti.complete ? 'complete' : 'draft',
        coverage,
        date: new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' }),
        refYear: window.REFERENCE_YEAR,
        year: info.year || '',
        batchId: 'AP-' + Date.now().toString(36).toUpperCase()
      },
      academic: { subjects: subjectList, sci, strengths, weakTopics, review, answered: academic.answered, total: academic.total },
      plan: { top, second, majors: majors.slice(0, 4), recSubjects, countries, unis, fit, fit2, subjects: plan, prefer: plan.preferredMajor },
      mbti,
      games,
      next
    };
  }

  window.generateReport = generateReport;
  window.gradeAcademic = gradeAcademic;
})();
