/* ============================================================
 * 报告渲染：把 generateReport() 的结构化对象渲染为 HTML
 * ============================================================ */
(function () {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clsByPct = (pct) => pct >= 70 ? 'good' : pct >= 55 ? 'mid' : 'weak';
  const countryFlag = { '英国': '🇬🇧', '美国': '🇺🇸', '加拿大': '🇨🇦', '澳大利亚': '🇦🇺', '中国香港': '🇭🇰', '新加坡': '🇸🇬', '欧洲大陆': '🇪🇺' };

  function renderCover(r) {
    const top = r.plan.top.major;
    const m = r.mbti;
    return `<section class="cover">
      <div class="cover-top">
        <div class="cover-brand"><div class="brand-mark">径</div>学径 · Pathwise</div>
        <div class="cover-date">生成日期 ${esc(r.meta.date)}<br/>报告编号 ${esc(r.meta.batchId)}</div>
      </div>
      <h1>${esc(r.meta.name)} 的<br/><span>学术规划报告</span></h1>
      <p class="cover-sub">A-Level Academic &amp; Career Planning Report · ${esc(r.meta.grade)}</p>
      <div class="cover-grid">
        <div class="cover-cell"><small>推荐专业方向</small><b>${esc(top.name)}</b></div>
        <div class="cover-cell"><small>性格类型</small><b>${esc(m.code)} · ${esc(m.type.title)}</b></div>
        <div class="cover-cell"><small>优势学科</small><b>${r.academic.subjects.slice(0, 2).map(s => esc(s.name)).join(' / ')}</b></div>
        <div class="cover-cell"><small>首选留学地区</small><b>${esc(r.plan.countries[0] ? r.plan.countries[0].label : '待定')}</b></div>
      </div>
      <div class="cover-foot">
        <span>基于 ${window.QUESTION_BANK.length} 道学术题、${window.MBTI_QUESTIONS.length} 道性格题与 ${window.PLAN_QUESTIONS.length} 道规划题生成</span>
        <span>${esc(r.meta.year ? '目标 ' + r.meta.year + ' 入学' : r.meta.refYear + ' 年')} · 数据仅供参考</span>
      </div>
    </section>`;
  }

  function renderSummary(r) {
    const top = r.plan.top.major;
    const bestSubject = r.academic.subjects[0];
    const weakest = [...r.academic.subjects].sort((a, b) => a.pct - b.pct)[0];
    return `<section class="paper-section" id="sec-summary">
      <div class="sec-kicker">Executive Summary</div>
      <h2>核心结论一览</h2>
      <p>本报告基于你的学业测试结果、专业规划问答与性格偏好综合生成，以下三条是本次规划最重要的结论。</p>
      <div class="exec">
        <div class="exec-card">
          <div class="t">学业诊断</div>
          <div class="big">${esc(bestSubject.name)} ${bestSubject.pct} 分 · ${esc(bestSubject.band.label)}</div>
          <div class="s">最强的能力是${esc(bestSubject.name)}；相对短板为${esc(weakest.name)}（${weakest.pct} 分），建议在开学前针对性补强。</div>
        </div>
        <div class="exec-card">
          <div class="t">专业方向</div>
          <div class="big">${esc(top.icon)} ${esc(top.name)}</div>
          <div class="s">${esc(top.required.join(' + '))} 是核心选科；${top.countries.slice(0, 3).join('、')} 是最契合的留学目的地。</div>
        </div>
        <div class="exec-card">
          <div class="t">性格特质</div>
          <div class="big">${esc(r.mbti.code)} · ${esc(r.mbti.type.title)}</div>
          <div class="s">${esc(r.mbti.type.tag)}。${esc(r.mbti.type.study)}</div>
        </div>
      </div>
    </section>`;
  }

  function renderAcademic(r) {
    const a = r.academic;
    const rows = a.subjects.map(s => {
      const pct = s.pct;
      return `<div class="score-row">
        <div class="score-name"><span class="ico">${s.icon}</span><div>${esc(s.name)}<small>${esc(s.nameEn)} · ${s.correct}/${s.total}</small></div></div>
        <div class="score-track"><div class="score-fill fill-${clsByPct(pct)}" data-w="${pct}"></div></div>
        <div class="score-val">${pct}%<small>${esc(s.band.label)}</small></div>
      </div>`;
    }).join('');

    const strong = a.strengths.length
      ? a.strengths.map(s => `<li><b>${esc(s.name)} ${s.pct}%</b> — ${esc(s.band.desc)}</li>`).join('')
      : '<li>暂无达到 70% 以上的学科，说明整体基础仍需系统梳理。</li>';
    const weak = a.weakTopics.length
      ? a.weakTopics.slice(0, 6).map(t => `<li><b>${esc(t.subject)} · ${esc(t.topic)}</b> — 正确率 ${t.pct}%，需重点复习</li>`).join('')
      : '<li>各知识点的正确率都在 60% 以上，知识点层面没有明显漏洞。</li>';

    const scienceRow = `<div class="score-row">
        <div class="score-name"><span class="ico">${a.sci.icon}</span><div>${esc(a.sci.name)}<small>${esc(a.sci.nameEn)}</small></div></div>
        <div class="score-track"><div class="score-fill fill-${clsByPct(a.sci.pct)}" data-w="${a.sci.pct}"></div></div>
        <div class="score-val">${a.sci.pct}%<small>${esc(a.sci.band.label)}</small></div>
      </div>`;

    const wrong = a.review.filter(x => !x.correct);
    const reviewHtml = a.review.map(({ q, correct }) => {
      const ansText = q.type === 'choice'
        ? (q.options[q.answer])
        : String(q.answer);
      return `<details class="review-item ${correct ? 'ok' : 'no'}">
        <summary><span class="mark">${correct ? '✓' : '✕'}</span><span class="text">${esc(q.prompt.split('\n')[0])}</span><span class="topic">${esc(q.topic)}</span></summary>
        <div class="detail">正确答案：<b>${esc(ansText)}</b><br/>${esc(q.explain)}</div>
      </details>`;
    }).join('');

    return `<section class="paper-section" id="sec-academic">
      <div class="sec-kicker">Part 1 · Academic Diagnosis</div>
      <h2>学科能力分析</h2>
      <p>你共完成 ${window.QUESTION_BANK.length} 道学术题。下表以各科正确率呈现你的能力分布，并按 A-Level 入门水平给出对应等级区间。</p>
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
        ${a.subjects[0].pct >= 70
          ? `${esc(a.subjects[0].name)}是你目前最突出的学科，这为你选择相关方向的 A-Level 科目提供了信心；同时请保持对相对较弱科目的关注，避免偏科影响整体选科组合的竞争力。`
          : `你目前的各科成绩较为均衡，但整体尚未形成明显优势学科。A-Level 阶段对知识深度要求更高，建议先找到 1–2 个最感兴趣的方向重点投入。`}
      </div>

      <h3 style="margin-top:28px">下一步行动建议</h3>
      <ul class="timeline" style="margin-top:14px">
        ${r.next.map(n => `<li><b>${esc(n.t)}</b><span>${esc(n.d)}</span></li>`).join('')}
      </ul>
    </section>

    <section class="paper-section appendix" id="sec-review">
      <div class="sec-kicker">Appendix · Answer Review</div>
      <h2>逐题回顾与解析</h2>
      <p class="muted">共 ${wrong.length} 道错题（共 ${a.review.length} 题），展开可查看正确答案与知识点解析。</p>
      <div class="review-grid">${reviewHtml}</div>
    </section>`;
  }

  function renderPlan(r) {
    const p = r.plan;
    const top = p.top.major;
    const reasons = p.top.reasons.length ? p.top.reasons : ['你的回答与这一方向的核心学科要求较为一致'];

    const others = p.majors.slice(1, 4);
    const othersHtml = others.length ? `<h3 style="margin-top:28px">备选方向</h3><div class="alt-majors">${others.map(o => `
      <div class="alt-major"><div class="n">${esc(o.major.icon)} ${esc(o.major.name)}</div><div class="m">匹配度 ${Math.round(60 + Math.max(0, o.score) * 2)}%${o.major.required.length ? ' · ' + esc(o.major.required.join('+')) : ''}</div></div>`).join('')}</div>` : '';

    const subjectRows = p.recSubjects.map(s => `
      <tr><td>${esc(s.name)}</td><td><span class="tag ${s.kind === 'required' ? 'req' : s.kind === 'strong' ? 'strong' : 'help'}">${s.kind === 'required' ? '必修/强推荐' : s.kind === 'strong' ? '优势搭配' : '加分推荐'}</span></td><td>${esc(s.reason)}</td></tr>`).join('');

    const countryCards = p.countries.map((c, i) => `
      <div class="country-card ${i === 0 ? 'primary' : ''}">
        <div class="flag">${countryFlag[c.label] || '🌍'}${i === 0 ? ' · 首选' : ''}</div>
        <b>${esc(c.label)}</b>
        <p>${esc(c.note)}</p>
      </div>`).join('');

    const uniGroups = p.unis.map(g => `
      <div class="uni-group">
        <h4>${esc(g.country)}</h4>
        ${g.unis.map(u => `<div class="uni-row"><div class="uni-name">${esc(u.name)}</div><div class="uni-req">${esc(u.req)}</div><div class="uni-note">${esc(u.note || '')}</div></div>`).join('')}
      </div>`).join('');

    const moodLabel = { rational: '理性分析', empathic: '共情他人', creative: '创意想象', practical: '动手实践', leader: '组织领导', explorer: '广泛探索' };
    const selfImage = (p.subjects.selfImage || []).map(x => moodLabel[x]).filter(Boolean).join('、') || '开放探索';
    const careerLabel = (window.CAREER_PATHS.filter(c => (p.subjects.career || []).includes(c.id)).map(c => c.label)).join('、') || '尚未确定';

    const grade = p.subjects.grade;
    const timeline = grade === '8'
      ? [['9 年级（今年）', '广泛探索兴趣领域，夯实英语与数学基础，尝试参加 1–2 个社团或竞赛。'], ['10 年级', '围绕 2–3 个方向确定 A-Level 选科，参加 IGCSE / 学术竞赛积累材料。'], ['11 年级', '确定目标院校清单，准备 MAT / STEP / UCAT 等笔试，开始文书构思。']]
      : grade === '9'
      ? [['10 年级（当前）', '以本科专业为终点倒推选科，确认学校是否开设目标科目，准备学科竞赛。'], ['11 年级', '进入 AS 阶段，明确目标院校与国家，开始了解笔试要求。'], ['12 年级', 'A2 冲刺，完成笔试、文书与面试准备。']]
      : grade === '10'
      ? [['今年内', '确认 A-Level 选科组合，如果是 10 年级末，尽快确定三科核心选项。'], ['AS 阶段', '保持学科成绩，尽早开始 MAT / STEP / UCAT 等笔试或竞赛训练。'], ['A2 阶段', '完成院校申请、笔试、文书与面试，A2 成绩决定最终录取。']]
      : [['当前阶段', '核对已选科目是否满足目标专业要求；若不满足，尽早评估转科或补充方案。'], ['AS 冲刺', '确认目标国家与院校，开始准备对应的入学笔试与文书材料。'], ['A2 阶段', '完成申请与面试，保持最终考试成绩达标。']];

    return `<section class="paper-section" id="sec-plan">
      <div class="sec-kicker">Part 2 · Future Path Planning</div>
      <h2>未来升学路径规划</h2>
      <p>结合你的兴趣、学科优势、职业偏好与留学意向，系统匹配出最契合的专业方向如下。</p>

      <div class="path-hero print-keep">
        <div class="big-ico">${esc(top.icon)}</div>
        <div>
          <h3>${esc(top.name)}</h3>
          <div class="en">${esc(top.en)} · ${esc(top.category)}</div>
          <p>${esc(top.grad)}</p>
        </div>
        <div class="fit-badge ${p.fit.cls}"><b>${esc(p.fit.level)}</b><span>基础适配 ${p.fit.pct}%</span></div>
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
          ${p.fit2 ? `<p class="muted" style="margin-top:10px">备选方向「${esc(p.second.major.name)}」的评估：${esc(p.fit2.level)}（基础适配 ${p.fit2.pct}%）</p>` : ''}
        </div>
      </div>

      <h3 style="margin-top:30px">1. A-Level 选科建议</h3>
      <p class="muted">以下组合能最大程度满足 ${esc(top.name)} 方向的院校要求，同时兼顾你的学科优势。</p>
      <table class="subject-table">
        <thead><tr><th>科目</th><th>定位</th><th>推荐理由</th></tr></thead>
        <tbody>${subjectRows}</tbody>
      </table>
      <div class="panel" style="margin-top:14px">
        <h3>⚠️ 选科注意事项</h3>
        <ul>${top.hints.map(h => `<li>${esc(h)}</li>`).join('')}
          ${(p.subjects.weakSubjects || []).includes(top.required[0]) ? `<li>你自评在 <b>${esc(top.required[0])}</b> 上比较吃力，这是该专业的核心科目，建议尽快补强或考虑备选方向。</li>` : ''}
          <li>部分顶尖院校不接受中文等母语科目作为三科成绩之一，请以各校官网最新要求为准。</li>
        </ul>
      </div>

      ${othersHtml}

      <h3 style="margin-top:30px">2. 留学国家与地区选择</h3>
      <div class="country-grid">${countryCards}</div>

      <h3 style="margin-top:30px">3. 目标院校推荐</h3>
      <p class="muted">以下为 ${esc(top.name)} 方向的代表性院校及 ${esc(r.meta.refYear)} 典型 A-Level 录取要求，实际要求以官网为准。</p>
      ${uniGroups}

      <h3 style="margin-top:30px">4. 未来职业路径</h3>
      <div class="reason-list">${top.careers.map(c => `<span class="reason-chip">${esc(c)}</span>`).join('')}</div>
      <p style="margin-top:12px">${esc(top.grad)}</p>

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
      const winL = v.pole === v.a;
      return `<div class="dim">
        <div class="l ${winL ? 'win' : ''}">${d.l} ${winL ? v.pctA + '%' : ''}</div>
        <div class="bar"><div class="a" style="width:${v.pctA}%"></div><div class="b" style="width:${v.pctB}%"></div></div>
        <div class="r ${!winL ? 'win' : ''}">${!winL ? v.pctB + '%' : ''} ${d.r}</div>
      </div>`;
    }).join('');

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
        <p style="margin:8px 0 0">${esc(t.study)}</p>
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
        本报告由「学径」系统根据测试作答自动生成，用于帮助学生认识自身优势与方向，不构成升学决策的唯一依据。
        院校录取要求基于 ${esc(r.meta.refYear)} 前后的公开信息整理，每年可能调整，请以各校官网为准。
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
