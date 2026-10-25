/* 本机报告库：显式归档、备份与导入，不发送任何网络请求。 */
(function () {
  'use strict';

  const $ = selector => document.querySelector(selector);
  function node(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text != null) el.textContent = String(text);
    return el;
  }

  function init(options) {
    let store;
    let storageError;
    let records = [];
    let originButton;
    let pendingImport = null;
    let selection = 0;
    let rawRecovery = null;
    let statistics = null;
    let outcomes = null;
    try { store = window.ReportStore.create(window.localStorage); }
    catch (error) { storageError = error; }

    const status = $('#libraryStatus');
    const archiveStatus = $('#archiveReportStatus');
    const importFile = $('#libraryImportFile');
    const preview = $('#libraryImportPreview');
    const replace = $('#libraryImportReplace');
    const list = $('#libraryList');

    function message(text, error = false) {
      status.textContent = text;
      status.classList.toggle('is-error', error);
    }
    function archiveMessage(text, error = false) {
      archiveStatus.textContent = text;
      archiveStatus.hidden = false;
      archiveStatus.classList.toggle('is-error', error);
    }
    function errorMessage(error) {
      if (error?.code === 'CORRUPT') return '报告库数据损坏或格式不受支持，原始数据已保留。请先下载原始数据备份；当前不能修改或导入。';
      if (error?.code === 'STORAGE' || !store) return '浏览器无法读取或保存本机报告库。已有归档不会被主动清除，请检查浏览器存储设置后重试。';
      return '操作未完成：' + (typeof error?.message === 'string' ? error.message : '无法处理该数据，请检查后重试。');
    }
    function requireStore() {
      if (storageError) throw storageError;
      if (!store) throw new Error('本机报告库暂不可用');
      return store;
    }
    function cancelImport(focus = false) {
      selection++;
      pendingImport = null;
      preview.hidden = true;
      replace.checked = false;
      importFile.value = '';
      if (focus) importFile.focus();
    }
    function setToolsAvailable(available, count = 0) {
      $('#libraryExportBtn').disabled = !available || !count;
      $('#libraryCsvBtn').disabled = !available || !count;
      $('#libraryStatisticsBtn').disabled = !available;
      $('#libraryOutcomesBtn').disabled = !available;
      importFile.disabled = !available;
      importFile.parentElement.classList.toggle('is-disabled', !available);
      $('#librarySearch').disabled = !available;
    }
    function showRecovery() {
      rawRecovery = null;
      try { rawRecovery = store?.rawBackup(); } catch (error) { /* 无法读取时不伪造空备份。 */ }
      $('#libraryRawBackupBtn').hidden = typeof rawRecovery !== 'string';
    }

    function drawRecords() {
      list.replaceChildren();
      const query = $('#librarySearch').value.trim().toLocaleLowerCase();
      const matched = records.filter(record => [record.state.info.name, record.reportMeta.batchId]
        .some(value => String(value).toLocaleLowerCase().includes(query)));
      $('#libraryCount').textContent = query ? `共 ${records.length} 份归档 · 找到 ${matched.length} 份` : `共 ${records.length} 份归档`;
      if (!matched.length) {
        list.append(node('p', 'library-empty', query ? '没有匹配的归档，请尝试其他姓名或报告编号。' : '还没有归档。在报告页点击「归档报告」，即可保留该学生的作答与顾问修改。'));
        return;
      }
      matched.forEach((record, index) => {
        const item = node('article', 'library-record');
        const heading = node('div', 'library-record-heading');
        const title = node('h3', 'library-record-name', record.state.info.name || '未填写姓名');
        title.id = 'libraryRecord-' + index;
        item.setAttribute('aria-labelledby', title.id);
        heading.append(title);
        let report;
        try { report = window.generateReport({ ...record.state,
          assessmentProfile: window.AssessmentProfiles.recordProfile(record) }); }
        catch (error) { /* 归档仍保留；打开时由存储模型给出具体校验结果。 */ }
        heading.append(node('span', 'library-badge', report?.meta.status === 'complete' ? '测评已完成' : '探索草稿'));
        item.append(heading);
        item.append(node('p', 'library-record-id', record.reportMeta.batchId));
        const details = node('dl', 'library-record-details');
        function detail(label, value) { details.append(node('dt', '', label), node('dd', '', value)); }
        detail('报告日期', record.reportMeta.date);
        detail('年级', report?.meta.grade || record.state.info.grade + ' 年级');
        detail('目标入学', record.state.info.year || '未填写');
        detail('归档更新', new Date(record.updatedAt).toLocaleString('zh-CN'));
        item.append(details);
        const coverage = report?.meta.coverage;
        item.append(node('p', 'library-completion', coverage
          ? `完成度：学术 ${coverage.academic.answered}/${coverage.academic.total} · 规划 ${coverage.plan.answered}/${coverage.plan.total} · 性格 ${coverage.mbti.answered}/${coverage.mbti.total}`
          : '完成度暂不可读取；原始归档仍保留。'));
        item.append(node('p', 'library-major', '专业方向（当前规则）：' + (report?.plan.top.major.name || '待重新生成')));
        const currentVersion = window.QUESTION_BANK_META?.version;
        const currentCatalog = window.UNIVERSITY_CATALOG?.version;
        if (record.bankVersion !== currentVersion || record.catalogVersion !== currentCatalog) item.append(node('p', 'library-version', `归档题库 ${record.bankVersion}；题库或院校目录与当前版本不同，打开时以当前版本重新生成，建议保留原 PDF。`));
        const actions = node('div', 'library-record-actions');
        const open = node('button', 'btn primary sm', '打开报告');
        open.type = 'button';
        open.dataset.openId = record.id;
        open.dataset.libraryOpen = record.id;
        open.setAttribute('aria-label', '打开 ' + record.state.info.name + ' 的报告');
        open.onclick = () => openRecord(record.id);
        const remove = node('button', 'btn ghost sm', '删除');
        remove.type = 'button';
        remove.dataset.deleteId = record.id;
        remove.dataset.libraryDelete = record.id;
        remove.setAttribute('aria-label', '删除 ' + record.state.info.name + ' 的归档');
        remove.onclick = () => removeRecord(record);
        actions.append(open, remove);
        item.append(actions);
        list.append(item);
      });
    }

    function render(text) {
      statistics?.clear();
      outcomes?.clear();
      try {
        records = requireStore().list();
        setToolsAvailable(true, records.length);
        $('#libraryRawBackupBtn').hidden = true;
        rawRecovery = null;
        drawRecords();
        if (typeof text === 'string') message(text);
      } catch (error) {
        records = [];
        cancelImport();
        setToolsAvailable(false);
        list.replaceChildren();
        $('#libraryCount').textContent = '归档暂不可读取';
        message(errorMessage(error), true);
        showRecovery();
      }
    }

    function showLibrary(button) {
      originButton = button;
      cancelImport();
      options.showLibrary();
      render('');
      $('#libraryHeading').focus();
    }
    function openRecord(id) {
      try {
        const restored = requireStore().restore(id);
        const versionNote = restored.versionChanged ? '该归档的题库或目录版本已变化，将以当前版本重新生成，建议保留原 PDF。' : '';
        if (options.hasProgress()) {
          if (!window.confirm('打开归档会替换当前作答与报告。请先归档当前报告或导出 PDF 留存。' + versionNote + '确定打开吗？')) return;
        } else if (versionNote && !window.confirm(versionNote + '确定打开吗？')) return;
        options.openState(restored.state);
        archiveMessage(versionNote || '已打开归档；后续修改需再次点击「归档报告」保存到报告库。');
        $('#archiveReportBtn').focus();
      } catch (error) { message(errorMessage(error), true); }
    }
    function removeRecord(record) {
      if (!window.confirm(`确定删除「${record.state.info.name}」的这份归档吗？此操作不能撤销，建议先导出 JSON 备份。当前打开的报告不受影响。`)) return;
      try {
        requireStore().remove(record.id);
        render('已删除该归档。');
        $('#librarySearch').focus();
      } catch (error) { message(errorMessage(error), true); }
    }
    function archiveReport() {
      try {
        let result;
        try { result = requireStore().save(options.getState()); }
        catch (error) {
          if (error?.code !== 'DUPLICATE') throw error;
          if (!window.confirm('报告库中已有相同报告编号。确定用当前作答与顾问修改替换旧归档吗？建议先导出 JSON 备份。')) return;
          result = requireStore().save(options.getState(), { overwrite: true });
        }
        archiveMessage(result.updated ? '已更新本机归档。请定期从本机报告库导出 JSON 备份。' : '报告已归档到此浏览器的本机报告库。请定期导出 JSON 备份。');
      } catch (error) { archiveMessage(errorMessage(error), true); }
    }

    function download(text, extension, mime, prefix = 'bic-reports') {
      const url = URL.createObjectURL(new Blob([text], { type: mime }));
      const link = node('a');
      link.href = url;
      link.download = prefix + '-' + new Date().toISOString().slice(0, 10) + '.' + extension;
      document.body.append(link);
      try { link.click(); }
      finally {
        link.remove();
        // 给浏览器留出消费下载链接的时间，再释放 Blob 内存。
        window.setTimeout(() => URL.revokeObjectURL(url), 60000);
      }
    }
    function exportFile(csv = false) {
      try {
        const content = csv ? requireStore().exportCSV() : requireStore().exportBackup();
        download(content, csv ? 'csv' : 'json', csv ? 'text/csv;charset=utf-8' : 'application/json;charset=utf-8');
        message(csv ? '已开始下载 CSV 汇总。此文件不能用于恢复完整归档。' : '已开始下载 JSON 备份，请妥善保管学生资料。');
      } catch (error) { message(errorMessage(error), true); }
    }
    importFile.onchange = async () => {
      const file = importFile.files[0];
      pendingImport = null;
      preview.hidden = true;
      replace.checked = false;
      const token = ++selection;
      if (!file) return;
      try {
        requireStore();
        if (!/\.json$/i.test(file.name) || file.type && !['application/json', 'text/json', 'text/plain'].includes(file.type)) throw new Error('请选择 .json 格式的报告库备份文件。');
        if (!file.size || file.size > window.ReportStore.LIMITS.MAX_CHARS * 3) throw new Error('备份文件为空或超过大小限制。');
        const text = await file.text();
        if (token !== selection) return;
        const summary = requireStore().previewImport(text);
        pendingImport = text;
        $('#libraryImportSummary').textContent = `文件：${file.name}。已校验 ${summary.count} 份报告；新增 ${summary.added} 份，编号重复 ${summary.conflicts} 份（默认跳过）。`;
        replace.disabled = summary.conflicts === 0;
        preview.hidden = false;
        message('校验通过，请核对数量和重复处理方式后确认导入。');
        $('#libraryImportHeading').focus();
      } catch (error) {
        if (token !== selection) return;
        pendingImport = null;
        message(errorMessage(error), true);
      }
    };
    $('#libraryImportCommitBtn').onclick = () => {
      if (pendingImport === null) return;
      try {
        const result = requireStore().importBackup(pendingImport, { onConflict: replace.checked ? 'replace' : 'skip' });
        cancelImport();
        render(`导入完成：新增 ${result.added} 份，跳过 ${result.skipped} 份，替换 ${result.replaced} 份。`);
        $('#librarySearch').focus();
      } catch (error) { message(errorMessage(error), true); }
    };
    $('#libraryImportCancelBtn').onclick = () => { cancelImport(true); message('已取消导入，本机归档未改变。'); };
    $('#libraryBtn').onclick = event => showLibrary(event.currentTarget);
    $('#openLibraryBtn').onclick = event => showLibrary(event.currentTarget);
    $('#archiveReportBtn').onclick = archiveReport;
    $('#libraryBackBtn').onclick = () => {
      cancelImport();
      options.closeLibrary();
      (originButton || $('#libraryBtn')).focus();
    };
    $('#librarySearch').oninput = drawRecords;
    $('#libraryExportBtn').onclick = () => exportFile(false);
    $('#libraryCsvBtn').onclick = () => exportFile(true);
    $('#libraryRawBackupBtn').onclick = () => {
      if (typeof rawRecovery !== 'string') return;
      download(rawRecovery, 'txt', 'text/plain;charset=utf-8', 'bic-reports-recovery');
      message('已开始下载保留的原始数据。请保管此文件；数据尚未修复。');
    };
    function onReportRendered() {
      // 生成新报告或编辑建议后，旧的归档成功提示不能代表当前内容已归档。
      archiveStatus.textContent = '';
      archiveStatus.hidden = true;
    }
    statistics = window.ReportStatisticsUI?.init({
      getRecords: () => requireStore().list(),
      download(text) { download(text, 'json', 'application/json;charset=utf-8', 'bic-academic-aggregate'); }
    });
    outcomes = window.OutcomeReviewUI?.init({
      getRecords: () => requireStore().list(),
      download(text, kind) {
        const prefix = kind === 'template' ? 'bic-followup-results-template' : kind === 'summary' ? 'bic-followup-review' : null;
        if (!prefix) throw new Error('下载格式不受支持');
        download(text, 'json', 'application/json;charset=utf-8', prefix);
      }
    });
    return { render, onReportRendered, onScreenLeft() { statistics?.clear(); outcomes?.clear(); } };
  }

  window.ReportLibrary = { init };
})();
