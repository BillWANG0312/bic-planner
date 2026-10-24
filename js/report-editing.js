/* 顾问文字建议与本地修改记录。数值与测试结果仍由规则引擎生成。 */
(function () {
  'use strict';
  const sections = { summary: '核心结论说明', academic: '学习行动建议', plan: '专业与职业建议', personality: '学习策略建议' };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const defaults = {
    summary: r => r.meta.status === 'draft'
      ? '这是一份探索草稿。请先补齐测评，再与升学指导老师讨论方向。'
      : '本报告基于你的学业测试结果、专业规划问答与性格偏好综合生成，帮助你与升学指导老师讨论下一步。',
    academic: r => (r.next || []).map(n => `${n.t}：${n.d}`).join('\n') || (r.academic.answered === r.academic.total
      ? '每周复盘一次错题与课堂笔记，记录仍有疑问的知识点，再与老师调整学习计划。'
      : '请先完成学术测评，再制定针对性的学习计划。'),
    plan: r => r.plan.top.major.grad,
    personality: r => r.mbti.complete ? (r.mbti.type?.study || `你的优势特质是 ${(r.mbti.top || []).map(t => t.label).join("、")}，可以围绕这些特质选择学习方式与课外项目。`) : '请先完成性格测评，结合实际学习体验选择适合自己的学习方式。'
  };
  function getText(report, section) {
    if (!Object.hasOwn(sections, section)) throw new Error('未知的建议部分');
    return report.advisor?.sections?.[section] ?? defaults[section](report);
  }
  let sequence = 0;
  function applyEdit(report, section, value, author, action = 'edit') {
    if (!Object.hasOwn(sections, section)) throw new Error('请选择可编辑的建议部分');
    if (typeof author !== 'string' || !author.trim() || author.trim().length > 40) throw new Error('请填写编辑者姓名（最多 40 字）');
    if (typeof value !== 'string' || !value.trim() || value.length > 4000) throw new Error('建议文字需为 1–4000 字');
    const before = getText(report, section);
    const after = value.trim();
    if (before === after) return false;
    const advisor = report.advisor || { sections: {}, history: [] };
    advisor.sections = advisor.sections || {};
    advisor.history = advisor.history || [];
    advisor.history.push({ id: `${Date.now().toString(36)}-${++sequence}`, at: new Date().toISOString(), author: author.trim(), section, before, after, action, reportId: report.meta.batchId });
    advisor.sections[section] = after;
    advisor.lastAuthor = author.trim();
    report.advisor = advisor;
    return true;
  }
  function restoreEdit(report, id, author) {
    const entry = report.advisor?.history?.find(x => x.id === id);
    if (!entry) throw new Error('找不到该修改记录');
    return applyEdit(report, entry.section, entry.before, author, 'restore');
  }
  function carryEdits(previous, next) {
    const source = previous?.advisor;
    if (!source || typeof source !== 'object' || Array.isArray(source)) return;
    const texts = Object.fromEntries(Object.keys(sections).filter(key => typeof source.sections?.[key] === 'string'
      && source.sections[key].trim() && source.sections[key].length <= 4000).map(key => [key, source.sections[key]]));
    const history = Array.isArray(source.history) ? source.history.filter(entry => entry && typeof entry === 'object'
      && Object.hasOwn(sections, entry.section) && typeof entry.id === 'string'
      && typeof entry.author === 'string' && entry.author.length <= 40
      && typeof entry.before === 'string' && entry.before.length <= 4000
      && typeof entry.after === 'string' && entry.after.length <= 4000
      && Number.isFinite(Date.parse(entry.at))) : [];
    if (!Object.keys(texts).length && !history.length) return;
    next.advisor = { sections: texts, history: JSON.parse(JSON.stringify(history)),
      lastAuthor: typeof source.lastAuthor === 'string' ? source.lastAuthor.slice(0, 40) : '',
      carriedFrom: previous.meta.batchId };
  }
  function mount(report, onChange) {
    const panel = document.getElementById('reportEditor');
    const toggle = document.getElementById('editReportBtn');
    if (!panel || !toggle) return;
    const previousSection = panel.querySelector('#advisorSection')?.value || 'summary';
    const history = report.advisor?.history || [];
    panel.innerHTML = `<div class="editor-heading"><h2>编辑报告建议</h2><button type="button" class="btn ghost sm" id="closeEditor">收起</button></div>
      <p>可调整四处建议文字。每次保存都会保留编辑者、时间和前后内容。修改只保存在当前浏览器，请导出 PDF 留存。</p>
      ${report.advisor?.carriedFrom ? '<p class="editor-notice">以下顾问建议沿用了上次报告的修改，请结合本次测评结果复核。</p>' : ''}
      <form id="advisorForm"><div class="editor-fields">
        <label>编辑者姓名<input id="advisorAuthor" maxlength="40" required value="${esc(report.advisor?.lastAuthor || '')}" autocomplete="name" /></label>
        <label>建议部分<select id="advisorSection">${Object.entries(sections).map(([id, label]) => `<option value="${id}" ${id === previousSection ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
      </div><label class="editor-text-label" for="advisorText">建议文字（最多 4000 字）</label><textarea id="advisorText" rows="7" maxlength="4000" required></textarea>
      <div class="editor-actions"><button type="button" class="btn ghost sm" id="defaultAdvice">恢复系统建议</button><button class="btn primary sm" type="submit">保存修改</button></div>
      <p id="advisorStatus" role="status" aria-live="polite"></p></form>
      <details class="editor-history"><summary>修改记录（${history.length}）</summary>${history.length ? [...history].reverse().map(entry => `<article><div><b>${esc(sections[entry.section] || entry.section)}</b> · ${esc(entry.author)} · <time>${esc(new Date(entry.at).toLocaleString('zh-CN'))}</time></div><details><summary>查看修改前后内容</summary><p>修改前</p><pre>${esc(entry.before)}</pre><p>修改后</p><pre>${esc(entry.after)}</pre></details><button type="button" class="btn ghost sm" data-restore="${esc(entry.id)}">恢复此条修改前的内容</button></article>`).join('') : '<p>尚无修改记录。</p>'}</details>`;
    const select = panel.querySelector('#advisorSection');
    const text = panel.querySelector('#advisorText');
    const author = panel.querySelector('#advisorAuthor');
    const status = panel.querySelector('#advisorStatus');
    text.value = getText(report, select.value);
    select.onchange = () => { text.value = getText(report, select.value); status.textContent = ''; };
    const show = visible => { panel.hidden = !visible; toggle.setAttribute('aria-expanded', String(visible)); if (visible) author.focus(); };
    toggle.onclick = () => show(panel.hidden);
    panel.querySelector('#closeEditor').onclick = () => show(false);
    const commit = fn => {
      try {
        if (!fn()) { status.textContent = '内容没有变化。'; return; }
        const persisted = onChange();
        panel.querySelector('#advisorStatus').textContent = persisted === false ? '本次报告已更新，本地保存暂不可用，请导出 PDF 留存。' : '修改已保存到本次报告。';
      } catch (err) { status.textContent = err.message; }
    };
    panel.querySelector('#advisorForm').onsubmit = event => {
      event.preventDefault();
      commit(() => applyEdit(report, select.value, text.value, author.value));
    };
    panel.querySelector('#defaultAdvice').onclick = () => {
      commit(() => applyEdit(report, select.value, defaults[select.value](report), author.value, 'reset'));
    };
    panel.querySelectorAll('[data-restore]').forEach(button => {
      button.onclick = () => commit(() => restoreEdit(report, button.dataset.restore, author.value));
    });
  }
  window.reportEditing = { sections, getText, applyEdit, restoreEdit, carryEdits, mount };
})();
