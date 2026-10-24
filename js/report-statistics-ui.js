/* 明确选择的本机学术汇总；预览不写归档，导出不含个人报告。 */
(function () {
  'use strict';
  const sourceLabels = { synthetic: '模拟 / 虚构样本', unverified_real: '真实样本（来源未核验）' };
  const subjectLabels = { english: '英语', maths: '数学', physics: '物理', chemistry: '化学' };
  const difficultyLabels = { foundation: '基础', intermediate: '中等', advanced: '进阶' };
  const reviewLabels = { no_answers: '无作答', all_correct: '已答全部正确', all_incorrect: '已答全部错误', descriptive_only: '仅描述复核' };
  const clone = value => JSON.parse(JSON.stringify(value));
  function node(tag, text, className) {
    const element = document.createElement(tag);
    if (text != null) element.textContent = String(text);
    if (className) element.className = className;
    return element;
  }
  function init(options) {
    const root = document.querySelector('#libraryStatistics');
    const button = document.querySelector('#libraryStatisticsBtn');
    let records = [], preview = null;
    const $ = selector => root.querySelector(selector);
    function clear() {
      records = []; preview = null;
      root.replaceChildren(); root.hidden = true;
      button.setAttribute('aria-expanded', 'false');
    }
    function message(text, error = false) {
      $('#statisticsStatus').textContent = text;
      $('#statisticsStatus').classList.toggle('is-error', error);
    }
    function selectedIds() {
      return Array.from(root.querySelectorAll('[data-statistics-record]:checked')).map(input => input.dataset.statisticsRecord);
    }
    function selectedRecords(values = records) {
      const ids = selectedIds();
      const selected = values.filter(record => ids.includes(record.id));
      if (selected.length !== ids.length || new Set(selected.map(record => record.id)).size !== selected.length) throw new Error('Changed records');
      return selected;
    }
    function readRecords() {
      const values = clone(options.getRecords());
      if (!Array.isArray(values) || values.length > 100 || values.some(record => !record || typeof record.id !== 'string'
          || typeof record.state?.info?.name !== 'string' || typeof record.reportMeta?.batchId !== 'string'
          || typeof record.bankVersion !== 'string') || new Set(values.map(record => record.id)).size !== values.length) throw new Error('Invalid records');
      return values;
    }
    function clearPreview() {
      preview = null;
      $('#statisticsPreview').hidden = true;
      $('#statisticsSubjects').replaceChildren(); $('#statisticsItems').replaceChildren();
      $('#statisticsJson').textContent = ''; $('#statisticsSummary').textContent = '';
      $('#statisticsExportBtn').disabled = true;
    }
    function controls() {
      const count = selectedIds().length;
      $('#statisticsCount').textContent = `已选 ${count} 份报告；至少 10 份，每位学生请至多选择一份。`;
      $('#statisticsPreviewBtn').disabled = count < 10 || !sourceLabels[$('#statisticsSource').value] || !$('#statisticsIndependence').checked;
    }
    function selectionChanged() { clearPreview(); controls(); message('选择已变化，请重新生成并核对预览。'); }
    function snapshot(values) { return JSON.stringify(values); }
    function currentSelection(expected) {
      if (!$('#statisticsIndependence').checked || $('#statisticsSource').value !== expected.source
          || JSON.stringify(selectedIds()) !== expected.ids || snapshot(selectedRecords(readRecords())) !== expected.snapshot) throw new Error('Changed selection');
    }
    function drawAggregate(result) {
      const subjects = $('#statisticsSubjects');
      for (const value of result.subjects) {
        const row = node('article', null, 'statistics-subject');
        row.append(node('h4', subjectLabels[value.key] || value.key));
        row.append(node('p', value.status === 'suppressed' ? '小单元隐藏：计数与均分不展示或导出。'
          : `完整 ${value.complete} 份 · 未完成 ${value.incomplete} 份 · 完整科目均分 ${value.meanPctRounded5 === null ? '暂无' : value.meanPctRounded5 + '%（按 5 个百分点舍入）'}`));
        subjects.append(row);
      }
      const items = $('#statisticsItems');
      for (const value of result.items) {
        const row = node('li');
        row.append(node('strong', `${value.id} · ${subjectLabels[value.subject] || value.subject} · ${difficultyLabels[value.difficulty] || value.difficulty}`));
        row.append(node('p', value.status === 'suppressed' ? '小单元隐藏：该题计数与比例不展示或导出。'
          : `已答 ${value.answered} · 缺答 ${value.missing} · 正确 ${value.correct} · 错误 ${value.incorrect} · 已答正确率 ${value.pctCorrect === null ? '暂无' : value.pctCorrect + '%'} · ${reviewLabels[value.review] || '仅描述复核'}`));
        items.append(row);
      }
      $('#statisticsSummary').textContent = `${result.sample.count} 份报告 · ${sourceLabels[result.sample.source]}。未校准：没有后续成绩，未修改难度或能力阈值。`;
    }
    function analyze() {
      if ($('#statisticsPreviewBtn').disabled) return;
      clearPreview();
      try {
        const source = $('#statisticsSource').value;
        const selected = selectedRecords();
        const expected = { source, ids: JSON.stringify(selectedIds()), snapshot: snapshot(selected) };
        currentSelection(expected);
        const result = window.ReportStatistics.analyze(selected, { source });
        const text = JSON.stringify(result, null, 2);
        drawAggregate(result);
        $('#statisticsJson').textContent = text;
        preview = { ...expected, text };
        $('#statisticsPreview').hidden = false; $('#statisticsExportBtn').disabled = false;
        message('去标识汇总已预览，仅限校内复核；不等于充分匿名或真实样本校准。');
        $('#statisticsPreviewHeading').focus();
      } catch (_) {
        clearPreview();
        message('无法生成统计，请重新打开选择，并核对本机归档、题库版本和样本数量。', true);
      }
    }
    function exportFile() {
      if (!preview) return;
      const expected = preview;
      try {
        currentSelection(expected);
        if (!window.confirm(`确认下载已预览的去标识汇总？来源：${sourceLabels[expected.source]}；${selectedIds().length} 份报告。仅限校内复核，不是完整备份；最低单元规则不保证匿名，多次子集导出仍可能产生识别风险。`)) return;
        // Another tab may change the archives while the confirmation is open.
        currentSelection(expected);
        options.download(expected.text);
        message('已开始下载预览中的去标识汇总。请仅用于校内复核，并妥善保管。');
      } catch (_) {
        clearPreview();
        message('归档或读取权限可能已变化，未导出。请重新打开选择，并重新核对预览。', true);
      }
    }
    function build() {
      root.classList.add('statistics-panel');
      const heading = node('div', null, 'statistics-heading');
      const title = node('h3', '本地学术汇总与校准准备'); title.id = 'statisticsHeading'; title.tabIndex = -1;
      const close = node('button', '关闭统计', 'btn ghost sm'); close.id = 'statisticsCloseBtn'; close.type = 'button';
      close.onclick = () => { clear(); button.focus(); };
      heading.append(title, close); root.append(heading);
      root.append(node('p', '去标识汇总，仅限校内复核。不会上传，不修改报告或评分。最低单元规则不保证充分匿名；均值、组合和反复导出子集仍可能识别个体。', 'statistics-notice'));
      const form = node('div', null, 'statistics-controls');
      const sourceLabel = node('label', '样本来源（由操作者声明）');
      const source = node('select'); source.id = 'statisticsSource';
      for (const [value, label] of [['', '请选择来源'], ...Object.entries(sourceLabels)]) { const option = node('option', label); option.value = value; source.append(option); }
      source.onchange = selectionChanged; sourceLabel.append(source); form.append(sourceLabel);
      const independence = node('label', null, 'statistics-check');
      const checked = node('input'); checked.id = 'statisticsIndependence'; checked.type = 'checkbox'; checked.onchange = selectionChanged;
      independence.append(checked, node('span', '我已核对每位学生至多一份报告；系统不能识别重测，也不核验真实样本来源。'));
      form.append(independence);
      const count = node('p'); count.id = 'statisticsCount'; count.setAttribute('aria-live', 'polite'); form.append(count);
      const selection = node('div', null, 'statistics-selection'); selection.id = 'statisticsSelection'; form.append(selection);
      const analyzeButton = node('button', '生成汇总预览', 'btn primary sm'); analyzeButton.id = 'statisticsPreviewBtn'; analyzeButton.type = 'button'; analyzeButton.onclick = analyze;
      form.append(analyzeButton); root.append(form);
      const status = node('p', '', 'statistics-status'); status.id = 'statisticsStatus'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); root.append(status);
      const review = node('section'); review.id = 'statisticsPreview'; review.hidden = true;
      const reviewHeading = node('h4', '核对汇总内容'); reviewHeading.id = 'statisticsPreviewHeading'; reviewHeading.tabIndex = -1; review.append(reviewHeading);
      const summary = node('p'); summary.id = 'statisticsSummary'; review.append(summary);
      const subjects = node('div', null, 'statistics-subjects'); subjects.id = 'statisticsSubjects'; review.append(subjects);
      const details = node('details'); details.append(node('summary', '逐题描述复核（不自动调整难度）'));
      const items = node('ol', null, 'statistics-items'); items.id = 'statisticsItems'; details.append(items); review.append(details);
      const jsonDetails = node('details'); jsonDetails.append(node('summary', '核对将导出的完整 JSON'));
      const json = node('pre', '', 'statistics-json'); json.id = 'statisticsJson'; jsonDetails.append(json); review.append(jsonDetails);
      root.append(review);
      const download = node('button', '确认导出汇总 JSON', 'btn primary sm'); download.id = 'statisticsExportBtn'; download.type = 'button'; download.disabled = true; download.onclick = exportFile;
      root.append(download);
    }
    function open() {
      clear(); build(); root.hidden = false; button.setAttribute('aria-expanded', 'true');
      try {
        records = readRecords();
        const selection = $('#statisticsSelection');
        for (const record of records) {
          const label = node('label', null, 'statistics-record');
          const input = node('input'); input.type = 'checkbox'; input.dataset.statisticsRecord = record.id;
          const eligible = record.bankVersion === window.QUESTION_BANK_META?.version;
          input.disabled = !eligible; input.onchange = selectionChanged;
          label.append(input, node('span', `${record.state.info.name || '未填写姓名'} · ${record.reportMeta.batchId}${eligible ? '' : ' · 旧题库，不能混算'}`));
          selection.append(label);
        }
        if (!records.length) selection.append(node('p', '没有可选的本机归档，请先归档报告。'));
        message('默认未选择报告。请核对样本来源、独立性和题库版本后生成预览。');
      } catch (_) { records = []; message('暂时无法读取本机归档，请关闭后检查本机库并重新打开。', true); }
      controls(); $('#statisticsHeading').focus();
    }
    button.type = 'button'; button.setAttribute('aria-controls', 'libraryStatistics'); button.onclick = open;
    clear();
    return { clear };
  }
  window.ReportStatisticsUI = { init };
})();
