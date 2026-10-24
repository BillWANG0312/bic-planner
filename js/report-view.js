/* ============================================================
 * 报告渲染：把 generateReport() 的结构化对象渲染为 HTML
 * ============================================================ */
(function () {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clsByPct = (pct) => pct >= 70 ? 'good' : pct >= 55 ? 'mid' : 'weak';
  const countryFlag = { '英国': '🇬🇧', '美国': '🇺🇸', '加拿大': '🇨🇦', '澳大利亚': '🇦🇺', '中国香港': '🇭🇰', '新加坡': '🇸🇬', '欧洲大陆': '🇪🇺' };
  const bounded = value => Math.round(Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0)));
  const edited = (r, section) => Object.hasOwn(r.advisor?.sections || {}, section);
  const editedMark = (r, section) => edited(r, section) ? '<span class="advisor-label">顾问已编辑</span>' : '';
  const advice = (r, section, fallback) => window.reportEditing ? window.reportEditing.getText(r, section) : fallback;
  const adviceHtml = (r, section, fallback) => `<p class="advice-text">${esc(advice(r, section, fallback))}</p>${editedMark(r, section)}`;
  const hasPersonality = r => r.mbti.complete && r.mbti.code && r.mbti.type;
  const mAnswered = r => r.mbti.answered || 0;
  const personalityLabel = r => hasPersonality(r) ? `${r.mbti.code} · ${r.mbti.type.title}`
    : r.mbti.complete ? '倾向均衡' : '待完成性格测评';
  const isCompleteSubject = s => s.complete === true || s.answered != null && s.total > 0 && s.answered === s.total;
  const secureUrl = value => typeof value === 'string' && /^https:\/\/[a-z0-9.-]+(?::\d+)?(?:[/?#][^\s]*)?$/i.test(value) ? value : null;
  function academicCoverage(r) {
    return r.meta.coverage?.academic || { answered: r.academic.answered || 0, total: r.academic.total || r.academic.review.length };
  }
  function coverageText(r) {
    const coverage = r.meta.coverage || { academic: academicCoverage(r),
      plan: { answered: 0, total: window.PLAN_QUESTIONS.length },
      mbti: { answered: r.mbti.answered || 0, total: r.mbti.total || window.MBTI_QUESTIONS.length } };
    return `学术 ${coverage.academic.answered}/${coverage.academic.total} · 规划 ${coverage.plan.answered}/${coverage.plan.total} · 性格 ${coverage.mbti.answered}/${coverage.mbti.total}`;
  }

  function renderCover(r) {
    const top = r.plan.top.major;
    const m = r.mbti;
    const completeSubjects = r.academic.subjects.filter(isCompleteSubject);
    const strengths = r.academic.strengths || [];
    const version = window.QUESTION_BANK_META?.version || window.QUESTION_BANK_VERSION || '';
    return `<section class="cover">
      <div class="cover-top">
        <div class="cover-brand"><img src="img/bic-logo-white.png" alt="BIC" class="cover-logo" /><span>BIC 学业规划系统 · BIC Academic Planner</span></div>
        <div class="cover-date">生成日期 ${esc(r.meta.date)}<br/>报告编号 ${esc(r.meta.batchId)}</div>
      </div>
      <h1>${esc(r.meta.name)} 的<br/><span>学术规划报告</span></h1>
      <p class="cover-sub">A-Level Academic &amp; Career Planning Report · ${esc(r.meta.grade)}${r.meta.status === 'complete' ? '' : ' · 探索草稿'}</p>
      <div class="cover-grid">
        <div class="cover-cell"><small>${r.meta.status === 'complete' ? '推荐专业方向' : '待讨论的探索方向'}</small><b>${esc(top.name)}</b></div>
        <div class="cover-cell"><small>性格类型</small><b>${esc(personalityLabel(r))}</b></div>
        <div class="cover-cell"><small>优势学科</small><b>${strengths.length ? strengths.slice(0, 2).map(s => esc(s.name)).join(' / ') : completeSubjects.length ? '待结合兴趣讨论' : '待完成学术测评'}</b></div>
        <div class="cover-cell"><small>首选留学地区</small><b>${esc(r.plan.countries[0] ? r.plan.countries[0].label : '待定')}</b></div>
      </div>
      <div class="cover-foot">
        <span>已作答：${esc(coverageText(r))}${version ? ' · 题库版本 ' + esc(version) : ''}</span>
        <span>${esc(r.meta.year ? '目标 ' + r.meta.year + ' 入学' : '目标入学时间待补充')} · 数据仅供参考</span>
      </div>
    </section>`;
  }

  function renderSummary(r) {
    const top = r.plan.top.major;
    const completed = r.academic.subjects.filter(isCompleteSubject);
    const bestSubject = completed[0];
    const weakest = [...completed].sort((a, b) => a.pct - b.pct)[0];
    const coverage = academicCoverage(r);
    return `<section class="paper-section" id="sec-summary">
      <div class="sec-kicker">Executive Summary</div>
      <h2>核心结论一览</h2>
      ${r.advisor?.carriedFrom ? '<p class="report-coverage">顾问建议沿用自上次报告，请结合本次作答重新复核。</p>' : ''}
      ${adviceHtml(r, 'summary', r.meta.status === 'complete' ? '根据已完成的测评，与升学指导老师讨论以下方向。' : '这是一份探索草稿。请补齐测评后再解读能力与性格结论。')}
      <div class="exec">
        <div class="exec-card">
          <div class="t">学业诊断</div>
          <div class="big">${bestSubject ? `${esc(bestSubject.name)} ${bounded(bestSubject.pct)} 分 · ${esc(bestSubject.band.label)}` : '待完成学术测评'}</div>
          <div class="s">${coverage.answered < coverage.total ? `已作答 ${coverage.answered}/${coverage.total} 题，完成科目后再解读能力分布。` : `已完成科目中，${esc(bestSubject.name)}得分最高；${bestSubject.pct === weakest.pct ? '各科得分相同，可结合兴趣选择探索方向。' : `${esc(weakest.name)}得分相对较低，可结合错题安排复习。`}`}</div>
        </div>
        <div class="exec-card">
          <div class="t">专业方向</div>
          <div class="big">${esc(top.icon)} ${esc(top.name)}</div>
          <div class="s">${esc(top.required.join(' + '))} 是此方向的选科参考；地区与院校要求需结合具体课程复核。${r.meta.status === 'complete' ? '' : '当前排序仅供探索讨论。'}</div>
        </div>
        <div class="exec-card">
          <div class="t">性格特质</div>
          <div class="big">${esc(personalityLabel(r))}</div>
          <div class="s">${hasPersonality(r) ? esc(r.mbti.type.tag) : r.mbti.complete ? '本次回答未呈现清晰的性格类型偏向，可结合实际学习体验继续观察。' : `已作答 ${mAnswered(r)}/${r.mbti.total || window.MBTI_QUESTIONS.length} 题，完成后再讨论性格偏好。`}</div>
        </div>
      </div>
    </section>`;
  }

  function renderAcademic(r) {
    const a = r.academic;
    const coverage = academicCoverage(r);
    const complete = coverage.answered === coverage.total;
    const scoreRow = s => {
      const pct = bounded(s.pct);
      const finished = isCompleteSubject(s);
      return `<div class="score-row">
        <div class="score-name"><span class="ico">${esc(s.icon)}</span><div>${esc(s.name)}<small>${esc(s.nameEn)} · 已作答 ${s.answered || 0}/${s.total || 0}</small></div></div>
        <div class="score-track"><div class="score-fill fill-${finished ? clsByPct(pct) : 'pending'}" data-w="${pct}"></div></div>
        <div class="score-val">${finished ? pct + '%' : '待完成'}<small>${finished ? esc(s.band.label) : `已答对 ${s.correct || 0} 题`}</small></div>
      </div>`;
    };
    const rows = a.subjects.map(s => {
      return scoreRow(s);
    }).join('');

    const strong = a.strengths.length
      ? a.strengths.map(s => `<li><b>${esc(s.name)} ${s.pct}%</b> — ${esc(s.band.desc)}</li>`).join('')
      : complete ? '<li>本次已完成的科目中暂无达到 70% 的科目，可结合错题制定复习计划。</li>' : '<li>待完成学术测评，再识别优势学科。</li>';
    const weak = a.weakTopics.length
      ? a.weakTopics.slice(0, 6).map(t => `<li><b>${esc(t.subject)} · ${esc(t.topic)}</b> — 正确率 ${t.pct}%，需重点复习</li>`).join('')
      : complete ? '<li>本次测评覆盖的知识点正确率均达到 60%；可继续挑战进阶题。</li>' : '<li>尚不能根据未答题判断薄弱点，请继续完成测评。</li>';

    const scienceRow = scoreRow({ ...a.sci,
      correct: a.subjects.filter(s => ['physics', 'chemistry'].includes(s.key)).reduce((count, s) => count + s.correct, 0) });

    const wrong = a.review.filter(x => x.answered && !x.correct);
    const unanswered = a.review.filter(x => !x.answered).length;
    const reviewHtml = a.review.map(({ q, a: answer, correct, answered }) => {
      const ansText = q.type === 'choice'
        ? (q.options[q.answer])
        : String(q.answer);
      const userAnswer = answered ? q.type === 'choice' ? q.options[answer] : String(answer) : '未答';
      return `<details class="review-item ${!answered ? 'pending' : correct ? 'ok' : 'no'}">
        <summary><span class="mark">${!answered ? '—' : correct ? '✓' : '✕'}</span><span class="text">${esc(q.prompt.split('\n')[0])}</span><span class="topic">${esc(q.topic)}${answered ? '' : ' · 未答'}</span></summary>
        <div class="detail">你的答案：<b>${esc(userAnswer)}</b><br/>正确答案：<b>${esc(ansText)}</b><br/>${esc(q.explain)}</div>
      </details>`;
    }).join('');

    return `<section class="paper-section" id="sec-academic">
      <div class="sec-kicker">Part 1 · Academic Diagnosis</div>
      <h2>学科能力分析</h2>
      <p>已作答 ${coverage.answered}/${coverage.total} 道学术题。${complete ? '下表展示本次测评覆盖的基础表现。' : '未完成的科目暂不作能力判断；完整得分以全部题目为分母。'}</p>
      <div class="score-list">${rows}${scienceRow}</div>
      <p class="muted">说明：等级为「入学起点参考」，不代表 A-Level 最终成绩，能力会随学习投入显著变化。</p>

      <div class="two-col">
        <div class="panel cool">
          <h3>💪 优势学科</h3>
          <ul>${strong}</ul>
        </div>
        <div class="panel warm">
          <h3>🎯 需要补强的知识点</h3>
          <ul>${weak}</ul>
        </div>
      </div>

      <div class="quote">
        ${!complete ? '请先完成学术测评。当前只反映已作答内容，未答题不能证明学科能力不足。' : a.subjects[0].pct >= 70
          ? `${esc(a.subjects[0].name)}是你目前最突出的学科，这为你选择相关方向的 A-Level 科目提供了信心；同时请保持对相对较弱科目的关注，避免偏科影响整体选科组合的竞争力。`
          : `你目前的各科成绩较为均衡，但整体尚未形成明显优势学科。A-Level 阶段对知识深度要求更高，建议先找到 1–2 个最感兴趣的方向重点投入。`}
      </div>

      <h3 style="margin-top:28px">下一步行动建议</h3>
      ${edited(r, 'academic') || !r.next.length ? adviceHtml(r, 'academic', '') : `<ul class="timeline" style="margin-top:14px">
        ${r.next.map(n => `<li><b>${esc(n.t)}</b><span>${esc(n.d)}</span></li>`).join('')}
      </ul>`}
    </section>

    <section class="paper-section appendix" id="sec-review">
      <div class="sec-kicker">Appendix · Answer Review</div>
      <h2>逐题回顾与解析</h2>
      <p class="muted">共 ${wrong.length} 道错题，${unanswered} 道未答（题库共 ${a.review.length} 题）。展开可对照你的答案、正确答案与解析。</p>
      <div class="review-grid">${reviewHtml}</div>
    </section>`;
  }

  function renderPlan(r) {
    const p = r.plan;
    const top = p.top.major;
    const reasons = p.top.reasons.length ? p.top.reasons : ['当前信息不足；这是供后续讨论的探索方向，请继续完善测评'];
    const recommendationIndex = item => bounded(60 + (Number.isFinite(item.score) ? item.score : 0) * 2);

    const others = p.majors.slice(1, 4);
    const othersHtml = others.length ? `<h3 style="margin-top:28px">备选方向</h3><div class="alt-majors">${others.map(o => `
      <div class="alt-major"><div class="n">${esc(o.major.icon)} ${esc(o.major.name)}</div><div class="m">推荐指数 ${recommendationIndex(o)}/100${o.major.required.length ? ' · ' + esc(o.major.required.join('+')) : ''}</div></div>`).join('')}</div>` : '';

    const subjectRows = p.recSubjects.map(s => `
      <tr><td>${esc(s.name)}</td><td><span class="tag ${s.kind === 'required' ? 'req' : s.kind === 'strong' ? 'strong' : 'help'}">${s.kind === 'required' ? '必修/强推荐' : s.kind === 'strong' ? '优势搭配' : '加分推荐'}</span></td><td>${esc(s.reason)}</td></tr>`).join('');

    const countryCards = p.countries.map((c, i) => `
      <div class="country-card ${i === 0 ? 'primary' : ''}">
        <div class="flag">${countryFlag[c.label] || '🌍'}${i === 0 ? (p.subjects.countries?.some(id => id !== 'unsure') ? ' · 讨论首选' : ' · 探索参考') : ''}</div>
        <b>${esc(c.label)}</b>
        <p>${esc(c.note)}</p>
      </div>`).join('');

    const uniGroups = p.unis.map(g => `
      <div class="uni-group">
        <h4>${esc(g.country)}</h4>
        ${g.unis.map(u => {
          const source = secureUrl(u.sourceUrl);
          const verified = u.reviewStatus === 'verified' && u.entryYear && u.reviewedAt && source;
          return `<div class="uni-row"><div class="uni-name">${esc(u.name)}<small>${verified ? '官网已核验' : '历史参考 · 待复核'}</small></div><div class="uni-req">${verified ? esc(u.req || '请查官网') : '录取要求待复核'}</div><div class="uni-note">${verified ? esc(u.note || '') : '请查看该校本科招生官网。'}
            ${verified ? `<div>${esc(u.entryYear)} 入学 · 核验日期 ${esc(u.reviewedAt)}</div>` : '<div>历史要求仅作探索参考，请复核对应入学年份。</div>'}
            ${source ? `<a href="${esc(source)}" target="_blank" rel="noopener noreferrer">官网要求</a>` : ''}</div></div>`;
        }).join('')}
      </div>`).join('');

    const moodLabel = { rational: '理性分析', empathic: '共情他人', creative: '创意想象', practical: '动手实践', leader: '组织领导', explorer: '广泛探索' };
    const selfImage = (p.subjects.selfImage || []).map(x => moodLabel[x]).filter(Boolean).join('、') || '开放探索';
    const careerLabel = (window.CAREER_PATHS.filter(c => (p.subjects.career || []).includes(c.id)).map(c => c.label)).join('、') || '尚未确定';

    const grade = r.meta.gradeId || p.subjects.grade;
    const timeline = grade === '8'
      ? [['8 年级（当前）', '广泛探索兴趣领域，夯实英语与数学基础，尝试参加 1–2 个社团或竞赛。'], ['9 年级', '围绕 2–3 个方向继续探索，了解学校的科目设置，积累社团与阅读体验。'], ['10 年级', '确认 A-Level 选科，逐步形成目标地区与课程清单。']]
      : grade === '9'
      ? [['9 年级（当前）', '探索本科专业与学习兴趣，确认学校是否开设相关科目，安排阅读和社团体验。'], ['10 年级', '围绕目标方向确定 A-Level 科目，了解地区与院校的课程要求。'], ['11 年级', '按学校教学进度进入 AS 学习，复核目标课程与申请材料要求。']]
      : grade === '10'
      ? [['10 年级（当前）', '确认 A-Level 选科组合，如果是 10 年级末，尽快确定三科核心选项。'], ['AS 阶段', '保持学科成绩，按目标课程官网要求安排入学测试或竞赛训练。'], ['A2 阶段', '完成院校申请、笔试、文书与面试，保持最终考试成绩达标。']]
      : [['当前阶段', '核对已选科目是否满足目标专业要求；若不满足，尽早评估转科或补充方案。'], ['AS 冲刺', '确认目标国家与院校，开始准备对应的入学笔试与文书材料。'], ['A2 阶段', '完成申请与面试，保持最终考试成绩达标。']];

    return `<section class="paper-section" id="sec-plan">
      <div class="sec-kicker">Part 2 · Future Path Planning</div>
      <h2>未来升学路径规划</h2>
      <p>${r.meta.status === 'complete' ? '根据本次测评与规划偏好，以下方向可作为升学讨论的起点。' : '当前为探索草稿，以下方向会随着测评与偏好的补充而调整。'}</p>
      <p class="muted">推荐指数是规则排序的参考值（0–100），用于比较探索方向，不是录取概率或经过校准的能力预测。</p>

      <div class="path-hero print-keep">
        <div class="big-ico">${esc(top.icon)}</div>
        <div>
          <h3>${esc(top.name)}</h3>
          <div class="en">${esc(top.en)} · ${esc(top.category)}</div>
          ${adviceHtml(r, 'plan', top.grad)}
          <p class="muted">推荐指数 ${recommendationIndex(p.top)}/100</p>
        </div>
        <div class="fit-badge ${esc(p.fit.cls)}"><b>${esc(p.fit.level)}</b><span>${Number.isFinite(p.fit.pct) ? `已测基础参考 ${bounded(p.fit.pct)}%` : '待完成相关科目'}</span></div>
      </div>
      <div class="reason-list">${reasons.map(x => `<span class="reason-chip">${esc(x)}</span>`).join('')}</div>

      <div class="two-col" style="margin-top:18px">
        <div class="panel">
          <h3>🧭 你的自我定位</h3>
          <ul>
            <li>自我形象：<b>${esc(selfImage)}</b></li>
            <li>职业愿景：<b>${esc(careerLabel)}</b></li>
            <li>期望学制：<b>${esc((window.PLAN_CONFIG.preferredLength.find(o => o.id === p.subjects.preferredLength) || {}).label || '灵活')}</b></li>
          </ul>
        </div>
        <div class="panel">
          <h3>📌 专业能力评估</h3>
          <p style="margin-top:4px">${esc(p.fit.note)}</p>
          ${p.fit2 ? `<p class="muted" style="margin-top:10px">备选方向「${esc(p.second.major.name)}」的评估：${esc(p.fit2.level)}${Number.isFinite(p.fit2.pct) ? `（已测基础参考 ${bounded(p.fit2.pct)}%）` : '（待完成相关科目）'}</p>` : ''}
        </div>
      </div>

      <h3 style="margin-top:30px">1. A-Level 选科建议</h3>
      <p class="muted">以下为 ${esc(top.name)} 方向的初步选科参考。请与老师核对学校开课情况及具体目标课程的要求。</p>
      <table class="subject-table">
        <thead><tr><th>科目</th><th>定位</th><th>推荐理由</th></tr></thead>
        <tbody>${subjectRows}</tbody>
      </table>
      <div class="panel" style="margin-top:14px">
        <h3>⚠️ 选科注意事项</h3>
        <ul>${top.hints.map(h => `<li>${esc(h)}</li>`).join('')}
          ${top.required.filter(subject => (p.subjects.weakSubjects || []).includes(subject)).map(subject => `<li>你自评在 <b>${esc(subject)}</b> 上比较吃力，可先与老师讨论衔接学习或备选科目。</li>`).join('')}
          <li>部分顶尖院校不接受中文等母语科目作为三科成绩之一，请以各校官网最新要求为准。</li>
        </ul>
      </div>

      ${othersHtml}

      <h3 style="margin-top:30px">2. 留学国家与地区选择</h3>
      <div class="country-grid">${countryCards}</div>

      <h3 style="margin-top:30px">3. 目标院校推荐</h3>
      <p class="muted">以下为 ${esc(top.name)} 方向的课程参考清单。每条记录单独标注核验状态与入学年份；历史记录须先复核，不能直接视作当前录取要求。</p>
      ${uniGroups || '<p class="muted">该方向暂无院校记录，请与升学指导老师共同查询对应课程。</p>'}

      <h3 style="margin-top:30px">4. 未来职业路径</h3>
      <div class="reason-list">${top.careers.map(c => `<span class="reason-chip">${esc(c)}</span>`).join('')}</div>
      ${adviceHtml(r, 'plan', top.grad)}

      <h3 style="margin-top:30px">5. 时间线与行动建议</h3>
      <ul class="timeline">${timeline.map(([t, d]) => `<li><b>${esc(t)}</b><span>${esc(d)}</span></li>`).join('')}</ul>
    </section>`;
  }

  function renderMBTI(r) {
    const m = r.mbti;
    const t = m.type;
    const dims = [
      { code: 'EI', l: '外向 E', r: '内向 I', val: m.EI },
      { code: 'SN', l: '实感 S', r: '直觉 N', val: m.SN },
      { code: 'TF', l: '思考 T', r: '情感 F', val: m.TF },
      { code: 'JP', l: '判断 J', r: '知觉 P', val: m.JP }
    ];
    const dimHtml = dims.map(d => {
      const v = d.val;
      const winL = v.pctA > 50;
      const winR = v.pctB > 50;
      const finished = v.complete;
      return `<div class="dim">
        <div class="l ${finished && winL ? 'win' : ''}">${d.l} ${finished && winL ? bounded(v.pctA) + '%' : ''}</div>
        <div class="bar"><div class="a" style="width:${finished ? bounded(v.pctA) : 50}%"></div><div class="b" style="width:${finished ? bounded(v.pctB) : 50}%"></div></div>
        <div class="r ${finished && winR ? 'win' : ''}">${finished && winR ? bounded(v.pctB) + '%' : ''} ${d.r}</div>
        <p class="muted">${finished ? v.pctA === 50 ? '倾向均衡' : '已完成此维度' : '待完成'} · 已作答 ${v.answered || 0}/${v.total || 6}</p>
      </div>`;
    }).join('');

    if (!hasPersonality(r)) {
      return `<section class="paper-section" id="sec-mbti">
        <div class="sec-kicker">Part 3 · Personality</div><h2>性格特点解析</h2>
        <h3>${esc(personalityLabel(r))}</h3>
        <p>已作答 ${mAnswered(r)}/${m.total || window.MBTI_QUESTIONS.length} 道性格题。${m.complete ? '本次回答未呈现清晰的类型偏向，可结合实际学习体验继续观察，不强行指定人格类型。' : '请完成量表后再讨论性格偏好；少量回答不能确定人格类型。'}</p>
        <div class="mbti-scale">${dimHtml}</div>
        ${edited(r, 'personality') ? adviceHtml(r, 'personality', '') : '<p>可尝试独立学习、小组讨论和实践项目，记录在哪些环境下更专注、更舒适，再与老师交流。</p>'}
      </section>`;
    }

    const codeHtml = m.code.split('').map((c, i) => `<span style="${i % 2 === 0 ? 'color:var(--paper-brand)' : ''}">${c}</span>`).join('');

    return `<section class="paper-section" id="sec-mbti">
      <div class="sec-kicker">Part 3 · Personality</div>
      <h2>性格特点解析</h2>
      <div class="mbti-hero">
        <div>
          <div class="mbti-code">${codeHtml}</div>
          <div class="mbti-title">${esc(t.title)} · ${esc(t.tag)}</div>
        </div>
      </div>
      <p>${esc(t.desc)}</p>

      <div class="mbti-scale">${dimHtml}</div>

      <div class="persona">
        <div class="panel cool">
          <h3>✨ 性格优势</h3>
          <ul>${t.strengths.map(s => `<li>${esc(s)}</li>`).join('')}</ul>
        </div>
        <div class="panel warm">
          <h3>🌱 成长建议</h3>
          <ul>${t.watch.map(s => `<li>${esc(s)}</li>`).join('')}</ul>
        </div>
      </div>

      <div class="panel" style="margin-top:18px">
        <h3>📖 与你匹配的学习策略</h3>
        ${adviceHtml(r, 'personality', t.study)}
      </div>

      <div class="quote">
        性格类型没有优劣之分。它帮助你理解自己"在什么环境下最能发挥"，而不是给自己设限。A-Level 阶段同样需要注意：${m.JP.pole === 'P' ? '你会倾向于灵活安排时间，建议建立一个最低限度的固定学习节奏（如每天固定一小时），否则容易拖到考前突击。' : m.JP.pole === 'J' ? '你习惯按计划执行，这非常有利于 A-Level 学习，但也要允许自己在遇到新方向时调整计划。' : ''}
      </div>
    </section>`;
  }

  function renderFooter(r) {
    return `<section class="paper-section">
      <h3>说明与免责</h3>
      <p class="disclaimer">
        本报告由「BIC 学业规划系统」根据测试作答自动生成，用于帮助学生认识自身优势与方向，不构成升学决策的唯一依据。
        院校记录逐条标注入学年份、核验日期和官网来源；标注「历史参考 · 待复核」的内容不作为当前录取要求。请以目标课程官网为准。
        MBTI 为简版人格测评，仅供性格参考，非专业心理诊断。
        建议结合学校升学指导老师的意见，共同制定最终规划。
      </p>
      <p class="disclaimer" style="margin-top:10px">报告编号 ${esc(r.meta.batchId)} · 生成于 ${esc(r.meta.date)} · ${esc(r.meta.refYear)}</p>
    </section>`;
  }

  window.renderReport = function (r) {
    return `<div class="paper">
      ${renderCover(r)}
      ${renderSummary(r)}
      ${renderAcademic(r)}
      ${renderPlan(r)}
      ${renderMBTI(r)}
      ${renderFooter(r)}
    </div>`;
  };

  /* 进入报告后触发条形动画 */
  window.animateReport = function (root) {
    requestAnimationFrame(() => {
      root.querySelectorAll('.score-fill').forEach(el => {
        const w = el.dataset.w;
        setTimeout(() => { el.style.width = w + '%'; }, 80);
      });
    });
  };
})();
