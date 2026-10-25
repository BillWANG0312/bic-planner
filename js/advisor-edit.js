/* Authenticated advice-only submission. Private report and drafts remain in memory. */
(function () {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const labels = { summary: '核心结论说明', academic: '学习行动建议', plan: '专业与职业建议', personality: '学习策略建议' };
  const keys = Object.keys(labels);
  const client = window.CloudReports.create({ config: window.BIC_CLOUD_CONFIG, location: window.location });
  let grants = [], selected = null, preview = null, quarantined = false, busy = false, epoch = 0, gone = false, expiryTimer = null;
  try { if (location.hash) history.replaceState(null, '', location.pathname + location.search); } catch (_) { /* Fragments cannot grant write access. */ }
  function node(tag, text) { const element = document.createElement(tag); if (text != null) element.textContent = String(text); return element; }
  function message(text, error = false) { $('#editStatus').textContent = text; $('#editStatus').classList.toggle('is-error', error); }
  function resetPreview() { preview = null; $('#editChangesPreview').replaceChildren(); $('#editChangesPreview').hidden = true; }
  function clearReport() {
    clearTimeout(expiryTimer); expiryTimer = null; selected = null; quarantined = false; resetPreview();
    $('#editDetail').hidden = true; $('#editHeading').textContent = ''; $('#editNote').textContent = '';
    $('#editReport').replaceChildren(); $('#editFields').replaceChildren();
  }
  function clearPrivate() { grants = []; clearReport(); $('#editList').replaceChildren(); $('#editAccount').textContent = ''; $('#editPassword').value = ''; }
  function collectChanges() {
    if (!selected || selected.grant.expires_at * 1000 <= Date.now()) throw new Error('授权已到期，请刷新并重新核对。');
    const changes = {};
    for (const key of keys) {
      if (!$(`[data-edit-select="${key}"]`).checked) continue;
      const value = $(`[data-edit-section="${key}"]`).value;
      if (!value.trim() || value.length > 4000) throw new Error('所选建议须为1–4000字，不能空白。');
      if (value.trim() !== selected.baseline[key].trim()) changes[key] = value.trim();
    }
    if (!Object.keys(changes).length) throw new Error('请勾选至少一段有实际变化的建议。仅首尾空白变化不提交。');
    return changes;
  }
  function samePreview() {
    if (!preview || !selected || preview.selected !== selected) return false;
    try { return preview.snapshot === JSON.stringify(collectChanges()); } catch (_) { return false; }
  }
  function controls() {
    const user = client.user;
    $('#editConnectPanel').hidden = client.connected;
    $('#editLoginForm').hidden = !client.connected || !!user;
    $('#editWorkspace').hidden = !user;
    $('#editDisconnectBtn').hidden = !client.connected && !busy;
    $('#editConnectBtn').disabled = busy;
    $('#editLoginForm button[type=submit]').disabled = busy;
    $('#editUsername').disabled = busy; $('#editPassword').disabled = busy;
    $('#editRefreshBtn').disabled = busy; $('#editLogoutBtn').disabled = busy;
    $('#editPreviewChangesBtn').disabled = busy || !selected;
    $('#editSubmitBtn').disabled = busy || !samePreview();
    if (user) $('#editAccount').textContent = `当前学校账号：${user.username}（${user.role === 'advisor' ? '顾问，仅编辑另行授权的建议' : '当前不是顾问角色'}）`;
    for (const button of $('#editList').querySelectorAll('button')) button.disabled = busy;
    for (const input of $('#editFields').querySelectorAll('input')) input.disabled = busy || !selected;
    for (const text of $('#editFields').querySelectorAll('textarea')) text.disabled = busy && !quarantined;
  }
  function ownDrafts() {
    if (quarantined) return Object.fromEntries([...$('#editFields').querySelectorAll('[data-edit-section]')].map(element => [element.dataset.editSection, element.value]));
    if (!selected) return {};
    return Object.fromEntries(keys.filter(key => $(`[data-edit-section="${key}"]`).value !== selected.baseline[key])
      .map(key => [key, $(`[data-edit-section="${key}"]`).value]));
  }
  function quarantineDrafts() {
    const drafts = ownDrafts();
    const permission = selected ? { id: selected.grant.id, revision: selected.report.revision, expires_at: selected.grant.expires_at } : quarantined;
    clearReport();
    if (!Object.keys(drafts).length) return;
    quarantined = permission; $('#editDetail').hidden = false; $('#editHeading').textContent = '未确认的本人草稿 · 仅供复制';
    $('#editNote').textContent = '原报告和基线已清除。以下只保留您改写的文字，不能直接重试提交。请先复制留存，主动核对授权和保存状态；如已写入须由所有者重新授权。';
    for (const [key, value] of Object.entries(drafts)) {
      const row = node('label', labels[key]); row.className = 'edit-field';
      const text = node('textarea'); text.dataset.editSection = key; text.value = value; text.readOnly = true; row.append(text); $('#editFields').append(row);
    }
    const captured = quarantined;
    expiryTimer = setTimeout(() => {
      if (quarantined !== captured) return;
      epoch++; busy = false; grants = grants.filter(grant => grant.id !== captured.id); clearReport(); drawList();
      message('授权已到期，未确认的本人草稿已清除；请所有者核对保存结果并重新授权。'); controls();
    }, Math.max(0, Math.min(2147483647, captured.expires_at * 1000 - Date.now())));
  }
  function errorText(error) {
    if (error?.status === 401 || error?.status === 403 || error?.code === 'AUTH') return '账号会话已失效或变化，请重新登录；名单、报告和草稿已清除。';
    if (error?.status === 404 || error?.status === 409) return '授权已关闭或源修订已变化，报告与草稿已清除。请所有者复核并重新授权，不会自动重试覆盖。';
    if (error?.code === 'VERSION') return '归档题库或院校目录版本不符，未生成规则视图或编辑基线。请所有者复核更新后重新授权。';
    if (error?.code === 'ROLE') return '当前账号不是顾问角色，不能读取或编辑跨用户报告。';
    if (error?.code === 'DISABLED') return '本网站尚未开通顾问建议编辑服务，请联系学校维护者。';
    if (error?.code === 'LOCAL_ONLY') return '直接打开文件时不能连接顾问编辑服务，请使用学校提供的 HTTPS 网址。';
    if (error?.code === 'CONFIG' || error?.code === 'DISCONNECTED') return '请从学校提供的同源 HTTPS 网址主动连接账号服务。';
    return '服务或报告资料暂时无法核对，未自动重试。请核对学校服务和授权状态。';
  }
  function handleError(error, write) {
    if (error?.code === 'CANCELLED') return;
    if (!client.user || error?.status === 401 || error?.status === 403) { client.disconnect(); clearPrivate(); message(errorText(error), true); return; }
    if (error?.code === 'NETWORK' || error?.code === 'TIMEOUT' || write && (!error?.status || error.status >= 500)) {
      quarantineDrafts(); message('无法确认本次连接或提交结果。原报告已清除，仅保留本人改写草稿供复制；不能直接重试，请先主动核对授权及保存状态。', true); return;
    }
    if (write && (error?.status === 422 || error?.status === 413)) { resetPreview(); message('建议格式或报告容量未通过，未自动重试。请先复制草稿并核对文字长度、记录容量；需要时请所有者处理。', true); return; }
    clearReport(); message(errorText(error), true);
  }
  async function run(label, operation, write = false) {
    if (busy || gone) return;
    const token = ++epoch, userId = client.user?.id;
    const live = () => token === epoch && !gone;
    const current = () => live() && (!userId || client.user?.id === userId);
    busy = true; message(label); controls();
    try { await operation(current, live); }
    catch (error) { if (live()) handleError(error, write); }
    finally {
      if (live()) {
        if (userId && client.user?.id && client.user.id !== userId) { client.disconnect(); clearPrivate(); message('页面账号已变化，旧报告和草稿已清除，请重新连接。', true); }
        busy = false; controls();
      }
    }
  }
  function requireAdvisor() { if (client.user?.role !== 'advisor') throw { code: 'ROLE' }; }
  function drawList() {
    const root = $('#editList'); root.replaceChildren();
    if (!grants.length) root.append(node('p', '当前账号没有有效的建议编辑授权。请所有者另行确认授权后主动刷新。'));
    for (const grant of grants) {
      const row = node('section'); row.className = 'edit-grant'; const text = node('div');
      text.append(node('h3', grant.report_name), node('p', `${grant.report_ref} · 源修订 ${grant.report_revision} · 授权者 ${grant.owner_username}`), node('p', `有效至 ${new Date(grant.expires_at * 1000).toLocaleString('zh-CN')}；一次提交所选建议文字`));
      const read = node('button', '核对并读取编辑基线'); read.type = 'button'; read.className = 'btn ghost sm'; read.dataset.editRead = grant.id; read.onclick = () => readReport(grant.id);
      row.append(text, read); root.append(row);
    }
    controls();
  }
  function validateAndRestore(value, id) {
    const grant = value?.grant, report = value?.report, baseline = value?.baseline;
    if (!grant || !report || grant.id !== id || grant.status !== 'active' || grant.scope !== 'full_report_advice_edit'
        || grant.recipient_username !== client.user?.username || report.id !== grant.report_id || report.revision !== grant.report_revision
        || report.record?.state?.info?.name !== grant.report_name || report.record?.reportMeta?.batchId !== grant.report_ref
        || !Number.isSafeInteger(grant.expires_at) || grant.expires_at * 1000 <= Date.now()
        || !baseline || Array.isArray(baseline) || Object.keys(baseline).length !== 4 || Object.keys(baseline).some(key => !keys.includes(key))
        || keys.some(key => typeof baseline[key] !== 'string' || !baseline[key].trim() || baseline[key].length > 4000)) throw { code: 'PROTOCOL' };
    const record = report.record;
    if (!record.bankVersion || record.bankVersion === 'unknown' || record.bankVersion !== window.QUESTION_BANK_META?.version
        || !record.catalogVersion || record.catalogVersion === 'unknown' || record.catalogVersion !== window.UNIVERSITY_CATALOG?.version) throw { code: 'VERSION' };
    for (const [key, text] of Object.entries(record.advisor?.sections || {})) if (baseline[key] !== text) throw { code: 'PROTOCOL' };
    let raw = null; const store = window.ReportStore.create({ getItem: () => raw, setItem: (_, value) => { raw = value; } });
    store.importBackup(JSON.stringify({ format: 'bic-report-library', version: 1, exportedAt: new Date().toISOString(), records: [record] }));
    return { grant, report, baseline: { ...baseline }, state: store.restore(record.id).state };
  }
  function inputChanged() { resetPreview(); controls(); }
  function showReport(value) {
    selected = value; quarantined = false;
    $('#editHeading').textContent = value.grant.report_name + ' · 建议文字编辑';
    $('#editNote').textContent = `学校账号 ${client.user.username} · 授权者 ${value.grant.owner_username} · 源修订 ${value.report.revision} · 有效至 ${new Date(value.grant.expires_at * 1000).toLocaleString('zh-CN')}。四段基线由所有者确认，视图按同版本当前规则生成；原答卷和成绩不能修改。`;
    $('#editReport').innerHTML = window.renderReport(value.state.report);
    for (const key of keys) {
      const row = node('div'); row.className = 'edit-field'; const label = node('label'); label.className = 'edit-select';
      const checkbox = node('input'); checkbox.type = 'checkbox'; checkbox.dataset.editSelect = key; checkbox.onchange = inputChanged;
      label.append(checkbox, node('span', labels[key]));
      const text = node('textarea'); text.dataset.editSection = key; text.setAttribute('aria-label', labels[key]); text.maxLength = 4000; text.value = value.baseline[key]; text.oninput = inputChanged;
      row.append(label, text); $('#editFields').append(row);
    }
    $('#editDetail').hidden = false; const captured = selected;
    expiryTimer = setTimeout(() => {
      if (selected !== captured) return;
      epoch++; busy = false; const id = selected.grant.id; grants = grants.filter(grant => grant.id !== id); clearReport(); drawList(); message('授权已到期，原报告和草稿已清除；请所有者重新核对并授权。'); controls();
    }, Math.max(0, Math.min(2147483647, value.grant.expires_at * 1000 - Date.now())));
    $('#editHeading').focus();
  }
  function readReport(id) {
    if (busy) return;
    if (Object.keys(ownDrafts()).length && !window.confirm('重新读取会清除本页未提交或未确认的本人草稿，请先复制留存。继续核对并读取？')) return;
    clearReport();
    return run('正在核对单报告编辑授权与基线…', async current => {
      requireAdvisor(); const result = await client.readAdvisorEditable(id); if (!current()) return;
      showReport(validateAndRestore(result, id)); message('已读取所有者确认的编辑基线。请选择有实际变化的段落，预览后一次提交；没有保存到本机。');
    });
  }
  $('#editPreviewChangesBtn').onclick = () => {
    if (busy || !selected) return;
    resetPreview();
    try {
      const changes = collectChanges(); preview = { selected, snapshot: JSON.stringify(changes), changes };
      const root = $('#editChangesPreview'); root.append(node('h3', `学校账号 ${client.user.username} · 源修订 ${selected.report.revision} · 修改预览`));
      for (const [key, text] of Object.entries(changes)) { const row = node('article'); row.append(node('h4', labels[key]), node('p', '修改前（所有者确认的基线）'), node('pre', selected.baseline[key]), node('p', '修改后'), node('pre', text)); root.append(row); }
      root.hidden = false; message('请核对所选段落前后文和登录账号，再确认提交。其他段落、答卷和成绩不会随此请求修改。');
    } catch (error) { message(error.message || '请核对所选文字。', true); }
    controls();
  };
  $('#editSubmitBtn').onclick = () => {
    if (busy || !samePreview()) { resetPreview(); controls(); return; }
    const captured = selected, changes = { ...preview.changes };
    if (!window.confirm(`以学校账号 ${client.user.username} 提交「${captured.grant.report_name}」修订 ${captured.report.revision} 的 ${Object.keys(changes).length} 段建议修改？将记录登录账号与前后文，实际写入后此授权失效，答卷和成绩不变。`)) return;
    resetPreview();
    run('正在提交已核对的建议文字…', async current => {
      requireAdvisor(); const result = await client.applyAdvisorEdit(captured.grant.id, captured.report.revision, changes);
      if (!current() || selected !== captured) return;
      if (!result.changed_sections.length) { message('服务端确认建议没有实际变化，未新增修订或修改记录。当前授权保持有效。'); return; }
      const id = captured.grant.id; grants = grants.filter(grant => grant.id !== id); clearReport(); drawList();
      message(`建议修改已提交，服务端修订为 ${result.report.revision}。当前授权已失效，需所有者复核后重新授权；没有保存到本机进度。`);
    }, true);
  };
  $('#editConnectBtn').onclick = () => run('正在连接学校账号服务…', async current => { clearPrivate(); await client.connect(); if (current()) message(client.user ? '已恢复会话，请主动刷新编辑授权名单。' : '已连接，请登录学校顾问账号。'); });
  $('#editLoginForm').onsubmit = event => { event.preventDefault(); const username = $('#editUsername').value, password = $('#editPassword').value; $('#editPassword').value = '';
    return run('正在登录…', async current => { clearPrivate(); await client.login(username, password); if (current()) message('已登录。请主动刷新编辑授权名单，没有自动读取学生资料。'); }); };
  $('#editRefreshBtn').onclick = () => run('正在核对有效编辑授权名单…', async current => {
    requireAdvisor(); const result = await client.listAdvisorEditable(); if (!current()) return;
    grants = result.items.filter(grant => grant.status === 'active' && grant.expires_at * 1000 > Date.now());
    if (selected && !grants.some(grant => grant.id === selected.grant.id && grant.report_revision === selected.report.revision)) clearReport();
    if (quarantined && !grants.some(grant => grant.id === quarantined.id && grant.report_revision === quarantined.revision)) clearReport();
    drawList(); message(quarantined ? '已刷新名单。未确认草稿仍只能复制；重新读取前请先复制留存，不会自动重试。' : '已刷新有效编辑授权。请主动选择一份核对基线；当前资料未自动替换。');
  });
  $('#editLogoutBtn').onclick = () => run('正在退出并清除草稿…', async (_, live) => { clearPrivate(); try { await client.logout(); if (live()) message('已退出，服务端会话已撤销。'); } catch (_) { if (live()) message('本页已断开，但服务器注销未确认。请重新连接后退出。', true); } finally { if (live()) { client.disconnect(); clearPrivate(); $('#editUsername').value = ''; } } });
  $('#editDisconnectBtn').onclick = () => { epoch++; busy = false; client.disconnect(); clearPrivate(); $('#editUsername').value = ''; controls(); message('本页已断开，报告和草稿已清除。服务器会话未注销，重新连接后才能核对。'); };
  window.addEventListener('pagehide', () => { gone = true; epoch++; busy = false; client.disconnect(); clearPrivate(); });
  window.addEventListener('pageshow', () => { if (gone) { gone = false; controls(); message('本页已断开，请主动重新连接。'); } });
  controls();
})();
