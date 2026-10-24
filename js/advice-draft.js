/* 文案草稿只在当前已读服务端报告中预览；所有应用均需顾问逐段确认。 */
(function () {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const labels = { summary: '核心结论', academic: '学习行动', plan: '专业与职业', personality: '学习策略' };
  const sources = { rule: '规则回退', local_mock: '本地模拟', provider: '待审核模型草稿' };
  function node(tag, text) { const element = document.createElement(tag); element.textContent = String(text); return element; }
  function input(record) {
    // ParentSummary also rejects changed bank/catalog versions before any request.
    const fallback = window.ParentSummary.build(record).sections;
    let raw = null;
    const store = window.ReportStore.create({ getItem: () => raw, setItem: (_, value) => { raw = value; } });
    store.importBackup(JSON.stringify({ format: 'bic-report-library', version: 1, exportedAt: new Date().toISOString(), records: [record] }));
    const report = store.restore(record.id).state.report;
    return { context: { status: report.meta.status, direction_id: report.plan.top.major.id,
      personality_complete: report.mbti.complete, personality_code: report.mbti.complete && report.mbti.code ? report.mbti.code : null,
      subjects: report.academic.subjects.map(subject => ({ key: subject.key, answered: subject.answered, total: subject.total,
        pct: subject.complete ? subject.pct : null })) }, fallback };
  }
  function init(options) {
    let selected = null, proposal = null, busy = false, epoch = 0, expiryTimer = null;
    function expired() { return proposal && Date.now() >= proposal.expires_at * 1000; }
    function stale() { return proposal && (!selected || proposal.report_id !== selected.id || proposal.source_revision !== selected.revision); }
    function choices() { return Array.from($('#adviceChoices').querySelectorAll('[data-advice-section]:checked')).map(element => element.dataset.adviceSection); }
    function setBusy(value) {
      busy = value;
      $('#adviceGenerateBtn').disabled = busy || !selected;
      $('#adviceDiscardBtn').disabled = busy || !proposal;
      $('#adviceReviewer').disabled = busy || !proposal || expired();
      for (const checkbox of $('#adviceChoices').querySelectorAll('[data-advice-section]')) checkbox.disabled = busy || expired() || checkbox.dataset.changed !== 'true';
      $('#adviceApplyBtn').disabled = busy || !proposal || expired() || stale() || !choices().length || !$('#adviceReviewer').value.trim() || $('#adviceReviewer').value.length > 40;
    }
    function resetProposal() {
      proposal = null;
      clearTimeout(expiryTimer); expiryTimer = null;
      $('#advicePreview').hidden = true;
      $('#draftSource').textContent = ''; $('#draftExpiry').textContent = '';
      $('#adviceChoices').replaceChildren(); $('#adviceReviewer').value = '';
      setBusy(busy);
    }
    function clear() { epoch++; selected = null; resetProposal(); }
    function setReport(value) { clear(); selected = value; setBusy(busy); }
    function draw(value) {
      proposal = value;
      $('#draftSource').textContent = sources[value.kind];
      $('#draftExpiry').textContent = `来源修订 ${value.source_revision} · 有效至 ${new Date(value.expires_at * 1000).toLocaleString('zh-CN')} · 草稿尚未应用`;
      const list = $('#adviceChoices'); list.replaceChildren();
      for (const [key, label] of Object.entries(labels)) {
        const changed = value.before[key].trim() !== value.sections[key].trim();
        const section = document.createElement('section'); section.className = 'advice-choice';
        const heading = document.createElement('label'); heading.className = 'advice-select';
        const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.dataset.adviceSection = key;
        checkbox.dataset.changed = String(changed); checkbox.checked = changed;
        checkbox.onchange = () => setBusy(busy);
        heading.append(checkbox, node('span', label + (changed ? ' · 应用此变更' : ' · 内容未变')));
        section.append(heading);
        const compare = document.createElement('div'); compare.className = 'advice-compare';
        for (const [attribute, title, text] of [['old', '当前建议', value.before[key]], ['new', '待核对草稿', value.sections[key]]]) {
          const column = document.createElement('div'); const paragraph = node('p', text); paragraph.dataset['advice' + (attribute === 'old' ? 'Old' : 'New')] = key;
          column.append(node('h4', title), paragraph); compare.append(column);
        }
        section.append(compare); list.append(section);
      }
      $('#advicePreview').hidden = false;
      setBusy(busy);
      const own = epoch;
      expiryTimer = setTimeout(() => {
        if (own !== epoch || proposal !== value) return;
        setBusy(busy); options.message('建议草稿已失效，原建议保留。请重新生成后核对。');
      }, Math.max(0, Math.min(900000, value.expires_at * 1000 - Date.now())));
    }
    $('#adviceReviewer').oninput = () => setBusy(busy);
    $('#adviceDiscardBtn').onclick = () => {
      if (busy || !proposal) return;
      resetProposal(); options.message('草稿已关闭，当前建议完整保留。');
      $('#adviceGenerateBtn').focus();
    };
    $('#adviceGenerateBtn').onclick = () => {
      if (busy || !selected || !window.confirm('生成这份报告的建议草稿？仅将匿名数值及枚举上下文、当前建议基线发送到本校服务；当前阶段使用规则回退或本地模拟，不向外部模型发送学生资料。不会自动应用。')) return;
      const report = selected, own = epoch;
      resetProposal();
      options.run('正在生成待核对草稿…', async current => {
        const value = input(report.record);
        const draft = await options.client.createAdviceDraft(report.id, report.revision, value.context, value.fallback);
        if (!current() || own !== epoch || selected !== report) return;
        if (draft.report_id !== report.id || draft.source_revision !== report.revision || !sources[draft.kind]) throw new Error('草稿来源与已读报告不符，请重新读取报告。');
        draw(draft);
        options.message(expired() ? '建议草稿已过期，原建议保留。请重新生成。'
          : Object.keys(labels).some(key => draft.before[key].trim() !== draft.sections[key].trim()) ? `${sources[draft.kind]}已生成。请逐段核对；原建议尚未改变。`
            : `${sources[draft.kind]}保留了当前建议，没有可应用的变更。`);
      });
    };
    $('#adviceApplyBtn').onclick = () => {
      if (busy || !selected || !proposal) return;
      if (expired()) { setBusy(busy); options.message('建议草稿已失效，请重新生成。'); return; }
      if (stale()) { resetProposal(); options.message('源修订已变化，请重新读取服务端报告，再生成草稿。'); return; }
      const sections = choices(), reviewer = $('#adviceReviewer').value.trim();
      if (!sections.length || !reviewer || reviewer.length > 40) return;
      const report = selected, draft = proposal, own = epoch;
      if (!window.confirm(`应用「${sources[draft.kind]}」到服务端报告的源修订 ${draft.source_revision}？仅修改勾选段落，并记录核对人「${reviewer}」及草稿来源；本机报告不自动替换。`)) return;
      options.run('正在应用已核对建议…', async current => {
        let result;
        try { result = await options.client.applyAdviceDraft(report.id, draft.id, sections, reviewer); }
        catch (error) {
          if (!current() || own !== epoch || selected !== report) return;
          resetProposal();
          if (['NETWORK', 'TIMEOUT', 'PROTOCOL'].includes(error.code) || error.status >= 500) throw new Error('应用结果尚未确认，未自动重试。请重新读取服务端报告，并核对修改历史后再操作。');
          if (error.status === 409 || error.status === 410) throw new Error('源修订已变化或草稿已失效。请重新读取服务端报告，再生成并核对草稿。');
          throw error;
        }
        if (!current() || own !== epoch || selected !== report) return;
        resetProposal();
        if (result?.id !== report.id || result?.revision !== draft.source_revision + 1) {
          throw new Error('应用结果的修订号无法核对，未自动重试。请重新读取服务端报告，并核对修改历史后再操作。');
        }
        // onSaved replaces the selected report and clears this preview; do not redraw the older proposal afterward.
        try { await options.onSaved(result); }
        catch (_) { throw new Error('应用结果无法在此页完成核对，未自动重试。请重新读取服务端报告，并核对修改历史后再操作。'); }
        options.message('所选建议已保存到服务端，并保留来源与核对记录。本机报告未自动替换。');
      });
    };
    clear();
    return { clear, setReport, setBusy };
  }
  window.AdviceDraft = { init, input };
})();
