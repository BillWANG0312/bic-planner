/* 本地后续成绩：明确导入、人工配对、声明日期，预览后仅导出聚合。 */
(function () {
  'use strict';
  const subjects = { english: '英语', maths: '数学', physics: '物理', chemistry: '化学' };
  const sources = { synthetic: '模拟 / 虚构样本', unverified_real: '真实来源待核验' };
  const clone = value => JSON.parse(JSON.stringify(value));
  const serialize = value => JSON.stringify(value);
  function node(tag, text, className) {
    const element = document.createElement(tag);
    if (text != null) element.textContent = String(text);
    if (className) element.className = className;
    return element;
  }
  function localToday() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }
  function init(options) {
    const root = document.querySelector('#libraryOutcomes');
    const openButton = document.querySelector('#libraryOutcomesBtn');
    const $ = selector => root.querySelector(selector);
    let generation = 0, records = [], manifest = null, preview = null;

    function clear() {
      generation++; records = []; manifest = null; preview = null;
      root.replaceChildren(); root.hidden = true;
      openButton.setAttribute('aria-expanded', 'false');
    }
    function message(text, error = false) {
      $('#outcomeStatus').textContent = text;
      $('#outcomeStatus').classList.toggle('is-error', error);
    }
    function clearPreview() {
      preview = null;
      $('#outcomePreview').hidden = true;
      $('#outcomeSummary').replaceChildren(); $('#outcomeJson').textContent = '';
      $('#outcomeExportBtn').disabled = true;
    }
    function selectedIds() {
      return Array.from(root.querySelectorAll('[data-outcome-record]:checked')).map(input => input.dataset.outcomeRecord);
    }
    function selectedRecords(values = records) {
      const ids = selectedIds(), selected = values.filter(record => ids.includes(record.id));
      if (selected.length !== ids.length || new Set(selected.map(record => record.id)).size !== ids.length) throw new Error('Changed records');
      return selected;
    }
    function bindings() {
      return Array.from(root.querySelectorAll('[data-outcome-study]')).flatMap(row => {
        const reportId = row.querySelector('[data-outcome-pair]').value;
        return reportId ? [{ studyId: row.dataset.outcomeStudy, reportId,
          baselineDate: row.querySelector('[data-outcome-date]').value }] : [];
      });
    }
    function readRecords() {
      const values = clone(options.getRecords());
      if (!Array.isArray(values) || values.length > 100 || values.some(record => !record || typeof record.id !== 'string'
          || typeof record.state?.info?.name !== 'string' || typeof record.reportMeta?.batchId !== 'string'
          || typeof record.bankVersion !== 'string') || new Set(values.map(record => record.id)).size !== values.length) throw new Error('Invalid records');
      return values;
    }
    function eligible(record) {
      try { return manifest && record.bankVersion === manifest.bankVersion
        && record.bankVersion === window.QUESTION_BANK_META?.version
        && window.gradeAcademic(record.state.academic).subjects[manifest.subject].complete; }
      catch (_) { return false; }
    }
    function controls() {
      const count = selectedIds().length;
      $('#outcomeCount').textContent = `已明确选择 ${count} 份报告；至少10份，每位学生至多一份。`;
      $('#outcomePreviewBtn').disabled = !manifest || count < 10 || !$('#outcomeIndependence').checked;
    }
    function changed() { clearPreview(); controls(); message('资料或核对状态已变化，请重新生成并核对预览。'); }
    function resetData() {
      records = []; manifest = null;
      clearPreview(); $('#outcomeSourceSummary').textContent = '';
      $('#outcomeRecords').replaceChildren(); $('#outcomeBindings').replaceChildren();
      $('#outcomeIndependence').checked = false; controls();
    }
    function currentSelection(expected) {
      if (!manifest || !$('#outcomeIndependence').checked || serialize(manifest) !== expected.manifest
          || serialize(selectedIds()) !== expected.ids || serialize(bindings()) !== expected.bindings
          || serialize(selectedRecords(readRecords())) !== expected.records) throw new Error('Changed input');
    }
    function refreshPairOptions() {
      const previous = bindings();
      const selected = selectedRecords();
      for (const row of root.querySelectorAll('[data-outcome-study]')) {
        const select = row.querySelector('[data-outcome-pair]'), date = row.querySelector('[data-outcome-date]');
        const earlier = previous.find(value => value.studyId === row.dataset.outcomeStudy);
        select.replaceChildren();
        const empty = node('option', '不配对 / 待核对'); empty.value = ''; select.append(empty);
        for (const record of selected) {
          const option = node('option', `${record.state.info.name || '未填写姓名'} · ${record.reportMeta.batchId}`);
          option.value = record.id; select.append(option);
        }
        const kept = earlier && selected.some(record => record.id === earlier.reportId);
        select.value = kept ? earlier.reportId : ''; date.value = kept ? earlier.baselineDate : ''; date.disabled = !kept;
      }
    }
    function drawPrivate() {
      const selection = $('#outcomeRecords'); selection.replaceChildren();
      for (const record of records) {
        const label = node('label', null, 'outcome-record');
        const checkbox = node('input'); checkbox.type = 'checkbox'; checkbox.dataset.outcomeRecord = record.id;
        checkbox.disabled = !eligible(record);
        checkbox.onchange = () => { refreshPairOptions(); changed(); };
        label.append(checkbox, node('span', `${record.state.info.name || '未填写姓名'} · ${record.reportMeta.batchId}${checkbox.disabled ? ' · 题库不符或目标科未完整，不能选择' : ''}`));
        selection.append(label);
      }
      if (!records.length) selection.append(node('p', '没有本机归档，请先归档报告。'));
      const list = $('#outcomeBindings'); list.replaceChildren();
      for (const outcome of manifest.outcomes) {
        const row = node('section', null, 'outcome-binding'); row.dataset.outcomeStudy = outcome.studyId;
        row.append(node('h5', `${outcome.studyId} · 后续成绩：${outcome.score === null ? '缺失（null）' : outcome.score + ' / 100'}`));
        const selectLabel = node('label', '手动选择本批报告');
        const select = node('select'); select.dataset.outcomePair = outcome.studyId;
        selectLabel.append(select);
        const dateLabel = node('label', '实际基线测评日期（操作者声明）');
        const date = node('input'); date.type = 'date'; date.dataset.outcomeDate = outcome.studyId; date.disabled = true;
        dateLabel.append(date); row.append(selectLabel, dateLabel);
        select.onchange = () => { date.value = ''; date.disabled = !select.value; changed(); };
        date.oninput = changed; date.onchange = changed; list.append(row);
      }
      refreshPairOptions();
      $('#outcomeSourceSummary').textContent = `${subjects[manifest.subject] || '目标科目'} · 校内百分制0–100 · 后续考试日期 ${manifest.examDate} · ${sources[manifest.source] || '来源待核验'} · ${manifest.outcomes.length} 行。来源和日期未独立核验；默认不选择报告或配对。`;
      controls();
    }
    function drawAggregate(result) {
      const summary = $('#outcomeSummary');
      summary.append(node('p', `${subjects[result.subject]} · ${sources[result.source]}。未校准，来源和日期由操作者声明，未进行真实样本有效性验证。`));
      if (result.status === 'suppressed') {
        summary.append(node('p', '含小样本单元，整份计数、分母与均值已隐藏，不展示或导出。'));
      } else {
        const c = result.counts;
        summary.append(node('p', `报告侧：选中报告 ${c.selectedReports} = 有成绩配对 ${c.usablePairs} + 缺失成绩配对 ${c.missingScorePairs} + 未配对报告 ${c.unpairedReports}。`));
        summary.append(node('p', `结果侧：结果行 ${c.outcomeRows} = 有成绩配对 ${c.usablePairs} + 缺失成绩配对 ${c.missingScorePairs} + 未配对结果 ${c.unpairedOutcomes}。`));
        const means = node('div', null, 'outcome-means');
        for (const [label, value] of [['基线题库均值', result.means.baselinePctRounded5], ['校内后续成绩均值', result.means.followupPctRounded5]]) {
          const card = node('article'); card.append(node('h5', label), node('p', value === null ? '暂无可用成绩配对' : value + '%（按5个百分点舍入）')); means.append(card);
        }
        summary.append(means);
      }
      summary.append(node('p', '两次考试不视为同一量尺；不计算差值、学习进步、预测误差或校准改善，不改能力阈值。最低单元规则不保证匿名，多次子集或均值仍有识别风险，仅限校内复核。'));
    }
    function analyze() {
      if ($('#outcomePreviewBtn').disabled) return;
      clearPreview();
      try {
        const selected = selectedRecords(), paired = bindings();
        const expected = { records: serialize(selected), manifest: serialize(manifest), bindings: serialize(paired), ids: serialize(selectedIds()) };
        currentSelection(expected);
        const result = window.OutcomeReview.analyze(selected, clone(manifest), paired);
        if (result?.format !== 'bic-followup-review' || result.version !== 1 || result.subject !== manifest.subject
            || result.source !== manifest.source || !['available', 'suppressed'].includes(result.status)) throw new Error('Invalid review result');
        const text = JSON.stringify(result, null, 2);
        drawAggregate(result); $('#outcomeJson').textContent = text;
        preview = { ...expected, text, subject: manifest.subject, source: manifest.source };
        $('#outcomePreview').hidden = false; $('#outcomeExportBtn').disabled = false;
        message('已生成待核对聚合。原报告未改动，未做真实校准；配对编号、逐条分数和日期不会进入导出。');
        $('#outcomePreviewHeading').focus();
      } catch (_) { clearPreview(); message('无法生成复核。请检查报告、配对是否重复、实际基线日期与考试顺序及资料格式，重新核对后再生成。', true); }
    }
    function exportSummary() {
      if (!preview) return;
      const expected = preview;
      try {
        currentSelection(expected);
        if (!window.confirm(`确认下载已预览的后续成绩聚合？科目：${subjects[expected.subject]}；来源：${sources[expected.source]}。仅聚合，不含编号或逐对成绩，不能恢复原始资料。日期由操作者声明，尚未校准；最低单元不保证匿名，子集与均值仍有识别风险，仅供校内复核。`)) return;
        currentSelection(expected);
        options.download(expected.text, 'summary'); message('已开始下载预览中的聚合。请限校内复核并妥善保管。');
      } catch (_) { clearPreview(); message('资料、配对或读取权限已变化，未导出。请重新打开并核对后再生成。', true); }
    }
    async function importFile(event) {
      const token = ++generation, file = event.target.files[0];
      resetData();
      if (!file) { message('尚未选择结果文件。'); return; }
      try {
        if (!/\.json$/i.test(file.name) || file.type && !['application/json', 'text/json', 'text/plain'].includes(file.type)
            || !file.size || file.size > 300000) throw new Error('Invalid result file');
        message('正在本机读取并校验结果文件…');
        const text = await file.text();
        if (token !== generation || root.hidden) return;
        if (text.length > 100000) throw new Error('Result file too large');
        const parsed = window.OutcomeReview.parse(text);
        const available = readRecords();
        manifest = clone(parsed); records = available; drawPrivate();
        message('文件已在本机校验。请明确选择报告、手动配对并填写实际基线日期；不会自动匹配姓名或上传。');
      } catch (_) {
        if (token !== generation || root.hidden) return;
        resetData(); message('结果文件或本机报告无法校验。请使用规定JSON格式、核对大小/题库/日期/分数，或检查本机存储后重选。', true);
      }
    }
    function build() {
      root.classList.add('outcome-panel');
      const heading = node('div', null, 'outcome-heading');
      const title = node('h3', '后续成绩人工配对与描述复核'); title.id = 'outcomeHeading'; title.tabIndex = -1;
      const close = node('button', '关闭复核', 'btn ghost sm'); close.type = 'button'; close.id = 'outcomeCloseBtn'; close.onclick = () => { clear(); openButton.focus(); };
      heading.append(title, close); root.append(heading);
      root.append(node('p', '仅在本机导入和人工配对，不上传、不修改报告或阈值。研究编号仍可能识别学生；来源、对应关系及真实日期由操作者核对。两次考试不视为同一量尺，结果不是预测或真实样本校准。', 'outcome-notice'));
      const form = node('div', null, 'outcome-controls');
      const fileLabel = node('label', '导入单科校内百分制结果JSON');
      const file = node('input'); file.id = 'outcomeFile'; file.type = 'file'; file.accept = '.json,application/json'; file.onchange = importFile; fileLabel.append(file); form.append(fileLabel);
      const template = node('button', '下载格式样例（1行虚构空成绩）', 'btn ghost sm'); template.type = 'button'; template.id = 'outcomeTemplateBtn';
      template.onclick = () => {
        const value = { format: 'bic-followup-results', version: 1, subject: 'maths', scale: 'school_percent_0_100',
          examDate: localToday(), bankVersion: window.QUESTION_BANK_META?.version, source: 'synthetic', outcomes: [{ studyId: 'SAMPLE-001', score: null }] };
        options.download(JSON.stringify(value, null, 2), 'template'); message('已下载仅含格式样例的虚构模板，不含本机报告；请填写经核对的资料，不能把样例当真实样本。');
      };
      form.append(template);
      const source = node('p'); source.id = 'outcomeSourceSummary'; form.append(source);
      const count = node('p'); count.id = 'outcomeCount'; count.setAttribute('aria-live', 'polite'); form.append(count);
      const recordsList = node('div', null, 'outcome-records'); recordsList.id = 'outcomeRecords'; form.append(recordsList);
      const pairTitle = node('h4', '人工配对（不按姓名自动匹配）'); form.append(pairTitle);
      const pairList = node('div', null, 'outcome-bindings'); pairList.id = 'outcomeBindings'; form.append(pairList);
      const review = node('label', null, 'outcome-check');
      const reviewed = node('input'); reviewed.type = 'checkbox'; reviewed.id = 'outcomeIndependence'; reviewed.onchange = changed;
      review.append(reviewed, node('span', '我已核对每位学生至多一份报告、研究编号与测评对应，以及真实基线日期；这些声明不等于已独立核验成绩或授权。')); form.append(review);
      const generate = node('button', '生成配对复核预览', 'btn primary sm'); generate.type = 'button'; generate.id = 'outcomePreviewBtn'; generate.onclick = analyze; form.append(generate); root.append(form);
      const status = node('p', '', 'outcome-status'); status.id = 'outcomeStatus'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); root.append(status);
      const previewPanel = node('section'); previewPanel.id = 'outcomePreview'; previewPanel.hidden = true;
      const previewTitle = node('h4', '核对仅含聚合的导出内容'); previewTitle.id = 'outcomePreviewHeading'; previewTitle.tabIndex = -1; previewPanel.append(previewTitle);
      const summary = node('div'); summary.id = 'outcomeSummary'; previewPanel.append(summary);
      const jsonDetails = node('details'); jsonDetails.append(node('summary', '核对将导出的完整JSON'));
      const json = node('pre', '', 'outcome-json'); json.id = 'outcomeJson'; jsonDetails.append(json); previewPanel.append(jsonDetails); root.append(previewPanel);
      const download = node('button', '确认导出聚合JSON', 'btn primary sm'); download.type = 'button'; download.id = 'outcomeExportBtn'; download.disabled = true; download.onclick = exportSummary; root.append(download);
    }
    function open() {
      clear(); build(); root.hidden = false; openButton.setAttribute('aria-expanded', 'true'); controls();
      message('尚未读取结果或本机报告。先明确选择结果JSON，再选择报告并人工配对。'); $('#outcomeHeading').focus();
    }
    openButton.type = 'button'; openButton.setAttribute('aria-controls', 'libraryOutcomes'); openButton.onclick = open;
    clear(); return { clear };
  }
  window.OutcomeReviewUI = { init };
})();
