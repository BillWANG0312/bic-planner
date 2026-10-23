/* ============================================================
 * 报告生成引擎（规则驱动，无 AI 依赖）
 * 输入：state.academic / state.plan / state.mbti
 * 输出：结构化对象，由 report-view 渲染
 * ============================================================ */
(function () {
  const M = window.MAJORS;

  function median(arr) {
    if (!arr.length) return null;
    const s = [...arr].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  /* ---------- 学术得分 ---------- */
  function gradeAcademic(academic) {
    const bank = window.QUESTION_BANK;
    const bySubject = { english: [0, 0], maths: [0, 0], physics: [0, 0], chemistry: [0, 0] };
    const topic = {};
    bank.forEach((q) => {
      const a = academic.answers[q.id];
      const correct = q.type === 'choice' ? a === q.answer
        : (a != null && Number.isFinite(Number(a)) && Math.abs(Number(a) - q.answer) <= (q.tol || 0));
      bySubject[q.subject][1] += 1;
      if (correct) bySubject[q.subject][0] += 1;
      if (!topic[q.subject]) topic[q.subject] = {};
      if (!topic[q.subject][q.topic]) topic[q.subject][q.topic] = [0, 0];
      topic[q.subject][q.topic][1] += 1;
      if (correct) topic[q.subject][q.topic][0] += 1;
    });
    const subjects = {};
    Object.entries(bySubject).forEach(([k, [c, t]]) => {
      subjects[k] = { correct: c, total: t, pct: t ? Math.round((c / t) * 100) : 0 };
    });
    const sciPct = subjects.physics.total && subjects.chemistry.total
      ? Math.round(((subjects.physics.correct + subjects.chemistry.correct) / (subjects.physics.total + subjects.chemistry.total)) * 100)
      : 0;
    return { subjects, sciPct, topic };
  }

  function band(pct) {
    return window.ALEVEL_BANDS.find(b => pct >= b.min) || window.ALEVEL_BANDS[window.ALEVEL_BANDS.length - 1];
  }

  /* ---------- 专业匹配 ---------- */
  function scoreMajors(plan, academic, mbti) {
    const interests = window.INTEREST_POOL.filter(o => (plan.interests || []).includes(o.id));
    const clubs = plan.clubs || [];
    const free = window.PLAN_CONFIG.freeTime.filter(o => (plan.freeTime || []).includes(o.id));
    const self = plan.selfImage || [];
    const prefMajor = (plan.preferredMajor || []).map(id => window.INTEREST_OPTIONS.find(o => o.id === id)?.major).filter(Boolean);
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

    const subjectScores = {
      cs: academic.subjects.maths.pct * 0.6 + academic.sciPct * 0.4,
      math: academic.subjects.maths.pct,
      physics: academic.subjects.maths.pct * 0.5 + academic.subjects.physics.pct * 0.5,
      eng: academic.subjects.maths.pct * 0.5 + academic.subjects.physics.pct * 0.5,
      chem: academic.subjects.chemistry.pct,
      med: academic.subjects.chemistry.pct,
      bio: academic.subjects.chemistry.pct,
      econ: academic.subjects.maths.pct * 0.7 + academic.subjects.english.pct * 0.3,
      biz: academic.subjects.english.pct * 0.5 + academic.subjects.maths.pct * 0.5,
      law: academic.subjects.english.pct,
      psych: academic.subjects.english.pct * 0.5 + academic.subjects.chemistry.pct * 0.5,
      design: academic.subjects.english.pct,
      media: academic.subjects.english.pct,
      intl: academic.subjects.english.pct
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
      // MBTI 倾向（轻量）
      const tVal = mbti.TF.pole === 'T' ? mbti.TF.pctA : 100 - mbti.TF.pctA;
      const nVal = mbti.SN.pole === 'N' ? mbti.SN.pctA : 100 - mbti.SN.pctA;
      if (['cs', 'math', 'phys', 'eng', 'econ', 'intl', 'psych'].includes(m.id)) score += (tVal - 50) * 0.06;
      if (['chem', 'bio', 'med', 'law', 'media', 'design', 'intl'].includes(m.id)) score += (nVal - 50) * 0.04;
      // 不同专业自身的集群偏好权重
      score += m.clusterBonus || 0;
      return { major: m, score, reasons, subjScore };
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
    const need = [];
    (major.required || []).forEach(s => { if (s === '数学') need.push(academic.subjects.maths.pct); if (s === '物理') need.push(academic.subjects.physics.pct); if (s === '化学') need.push(academic.subjects.chemistry.pct); });
    if (!need.length) need.push(academic.subjects.english.pct, academic.subjects.maths.pct);
    const pct = Math.round(need.reduce((a, b) => a + b, 0) / need.length);
    if (pct >= 75) return { level: '适配度高', cls: 'good', pct, note: '该专业所需基础科目表现扎实，入学后有望较快适应。' };
    if (pct >= 55) return { level: '基本适配', cls: 'mid', pct, note: '基础尚可，但需在开学前补齐关键知识点，尤其是题目类型转换。' };
    return { level: '需重点准备', cls: 'weak', pct, note: '该专业所需基础科目存在明显缺口，建议暑期安排针对性的衔接学习。' };
  }

  /* ---------- 主入口 ---------- */
  function generateReport(state) {
    const academic = gradeAcademic(state.academic);
    const mbti = window.computeMBTI(state.mbti.answers);
    const plan = state.plan.answers;
    const majors = scoreMajors(plan, academic, mbti);
    const top = majors[0];
    const second = majors[1];

    // 学科分析
    const info = state.info;
    const subjectList = Object.entries(academic.subjects).map(([k, v]) => ({
      key: k, ...window.SUBJECT_META[k], ...v, band: band(v.pct)
    })).sort((a, b) => b.pct - a.pct);
    const sci = { key: 'science', name: '理科综合', nameEn: 'Science (Phys + Chem)', icon: '🔬', pct: academic.sciPct, band: band(academic.sciPct) };
    const strengths = subjectList.filter(s => s.pct >= 70);
    // 薄弱点：按主题找正确率低的
    const weakTopics = [];
    Object.entries(academic.topic).forEach(([subj, topics]) => {
      Object.entries(topics).forEach(([t, [c, tot]]) => {
        if (c / tot < 0.6) weakTopics.push({ subject: window.SUBJECT_META[subj].name, topic: t, pct: Math.round(c / tot * 100) });
      });
    });
    // 逐题回顾（错题+解析）
    const review = window.QUESTION_BANK.map(q => {
      const a = state.academic.answers[q.id];
      const correct = q.type === 'choice' ? a === q.answer
        : (a != null && Number.isFinite(Number(a)) && Math.abs(Number(a) - q.answer) <= (q.tol || 0));
      return { q, a, correct };
    });

    const recSubjects = recommendSubjects(top.major, plan, academic);
    const countries = recommendCountries(top.major, plan);
    const unis = tierUnis(top.major);
    const fit = fitForMajor(top.major, academic);
    const fit2 = second ? fitForMajor(second.major, academic) : null;

    // 下一步建议
    const next = [];
    if (academic.subjects.english.pct < 60) next.push({ t: '英语能力是 A-Level 的核心门槛', d: '除英语外所有科目都要求学术英语（阅读大段题干、写论证型答案）。建议每天 20 分钟英语原版阅读，并每周写一篇 200 词学术短文。' });
    if (academic.subjects.maths.pct < 60) next.push({ t: '数学基础需系统补强', d: '数学几乎是所有 STEM 与商科专业的门槛。建议优先补齐函数、代数变形、三角与基础微积分，再进入 A-Level Pure Math。' });
    if (academic.sciPct < 60) next.push({ t: '理科（物理 / 化学）存在知识缺口', d: '若希望走 STEM 路线，开学前应集中复习力学、物质的量与酸碱基础，配合实验理解。' });
    if (academic.subjects.english.pct >= 70) next.push({ t: '发挥英语优势', d: '英语强项是人文、传媒、法律方向的优势，也意味着你可以更快适应全英文授课，建议尝试英文辩论或论文写作训练。' });
    if (academic.subjects.maths.pct >= 75) next.push({ t: '数学能力可以成为"硬实力"', d: `数学表现突出，适合冲刺 ${['cs', 'math', 'phys', 'eng', 'econ'].includes(top.major.id) ? '该专业' : '数学要求较高的专业'}；建议尽早接触进阶数学（Further Maths）内容。` });

    return {
      meta: {
        name: info.name, grade: (window.PLAN_CONFIG.grade.find(g => g.id === plan.grade) || {}).label || '',
        date: new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' }),
        refYear: window.REFERENCE_YEAR,
        year: info.year || '',
        batchId: 'AP-' + Date.now().toString(36).toUpperCase()
      },
      academic: { subjects: subjectList, sci, strengths, weakTopics, review },
      plan: { top, second, majors: majors.slice(0, 4), recSubjects, countries, unis, fit, fit2, subjects: plan, prefer: plan.preferredMajor },
      mbti,
      next
    };
  }

  window.generateReport = generateReport;
  window.gradeAcademic = gradeAcademic;
})();
