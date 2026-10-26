/* Explicit, selected report summaries. All data and CSV stay in this page's memory. */
(function () {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const client = window.CloudReports.create({ config: window.BIC_CLOUD_CONFIG, location: window.location });
  let grants = [], preview = null, busy = false, epoch = 0, viewRevision = 0, gone = false, expiryTimer = null;
  try { if (location.hash) history.replaceState(null, '', location.pathname + location.search); } catch (_) { /* Fragments never confer access. */ }
  function node(tag, text) { const element = document.createElement(tag); if (text != null) element.textContent = String(text); return element; }
  function message(text, error = false) { $('#summaryStatus').textContent = text; $('#summaryStatus').classList.toggle('is-error', error); }
  const chosen = () => [...$('#summaryList').querySelectorAll('[data-summary-grant]:checked')].map(element => element.dataset.summaryGrant);
  const sameIds = (left, right) => left.length === right.length && left.every((id, index) => id === right[index]);
  function canonical(value) { if (Array.isArray(value)) return value.map(canonical); if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])); return value; }
  const stamp = value => JSON.stringify(canonical(value));
  const academicMode = () => $('#summaryAcademic').checked;
  const preferencesMode = () => $('#summaryPreferences').checked;
  const requestOptions = (academic, preferences) => academic || preferences ? { ...(academic ? { academic: true } : {}), ...(preferences ? { preferences: true } : {}) } : undefined;
  const modeName = (academic, preferences) => preferences ? `${academic ? '学科表现与' : ''}学生自选偏好v3` : academic ? '学科表现v2' : '完成度v1';
  function clearPreview() { preview = null; $('#summaryPreview').hidden = true; $('#summaryTable').replaceChildren(); $('#summaryScoring').textContent = ''; $('#summaryScoring').hidden = true; $('#summaryPreferencesMeta').textContent = ''; $('#summaryPreferencesMeta').hidden = true; }
  function clearPrivate() { clearTimeout(expiryTimer); expiryTimer = null; grants = []; viewRevision++; clearPreview(); $('#summaryAcademic').checked = false; $('#summaryPreferences').checked = false; $('#summaryList').replaceChildren(); $('#summaryAccount').textContent = ''; $('#summaryPassword').value = ''; }
  function controls() {
    const user = client.user, count = chosen().length;
    $('#summaryConnectPanel').hidden = client.connected; $('#summaryLoginForm').hidden = !client.connected || !!user; $('#summaryWorkspace').hidden = !user;
    $('#summaryDisconnectBtn').hidden = !client.connected && !busy; $('#summaryConnectBtn').disabled = busy;
    $('#summaryLoginForm button[type=submit]').disabled = busy; $('#summaryUsername').disabled = busy; $('#summaryPassword').disabled = busy;
    $('#summaryRefreshBtn').disabled = busy; $('#summaryLogoutBtn').disabled = busy;
    $('#summaryAcademic').disabled = busy || !user;
    $('#summaryPreferences').disabled = busy || !user;
    $('#summaryPreviewBtn').disabled = busy || !user || count < 1 || count > 20;
    $('#summaryExportBtn').disabled = busy || !currentPreview(preview);
    for (const input of $('#summaryList').querySelectorAll('input')) input.disabled = busy;
    if (user) $('#summaryAccount').textContent = `当前学校账号：${user.username}（${user.role === 'advisor' ? '顾问，仅所选有效只读授权' : '当前不是顾问角色'}）`;
    armSelectionExpiry();
  }
  function armSelectionExpiry() {
    clearTimeout(expiryTimer); expiryTimer = null;
    const ids = chosen(); if (!ids.length) return;
    const selected = grants.filter(grant => ids.includes(grant.id)); if (selected.length !== ids.length) return;
    let until = Math.min(...selected.map(grant => grant.expires_at));
    if (preview && sameIds(preview.ids, ids)) until = Math.min(until, preview.until);
    const timer = setTimeout(() => {
      if (expiryTimer !== timer) return;
      expiryTimer = null; clearPreview(); grants = grants.filter(grant => grant.expires_at * 1000 > Date.now()); drawList();
      message('所选授权已到期，预览和选择已清除。请主动刷新后重新核对。', true);
    }, Math.max(0, Math.min(2147483647, until * 1000 - Date.now())));
    expiryTimer = timer;
  }
  function currentPreview(value) { const user = client.user; return !!value && preview === value && user?.id === value.userId && user?.username === value.username && sameIds(chosen(), value.ids) && academicMode() === value.academic && preferencesMode() === value.preferences && viewRevision === value.viewRevision && value.until * 1000 > Date.now(); }
  function errorText(error) {
    if (error?.status === 401 || error?.status === 403 || error?.code === 'AUTH') return '账号会话已失效或变化，旧名单和清单已清除，请重新登录。';
    if (error?.status === 404 || error?.status === 409 || error?.code === 'STALE') return '授权、修订或摘要资料已变化，旧选择和预览已清除。请主动刷新并重新核对，没有下载或自动重算。';
    if (error?.code === 'ROLE') return '当前账号不是顾问角色，不能读取跨用户清单。';
    if (error?.code === 'LOCAL_ONLY') return '直接打开文件时不能连接顾问清单服务，请使用学校提供的 HTTPS 网址。';
    if (error?.code === 'DISABLED') return '本网站尚未开通顾问清单服务，请联系学校维护者。';
    if (error?.code === 'NETWORK' || error?.code === 'TIMEOUT') return '连接中断或超时，旧预览和CSV已清除。请稍后主动核对，未自动重试。';
    return '摘要资料或服务暂时无法核对，旧预览和CSV已清除，没有下载或自动重试。';
  }
  function handleError(error) {
    if (error?.code === 'CANCELLED') return;
    clearPreview();
    if (!client.user || error?.status === 401 || error?.status === 403) { client.disconnect(); clearPrivate(); }
    else if (error?.status === 404 || error?.status === 409 || error?.code === 'STALE') { grants = []; $('#summaryList').replaceChildren(); }
    message(errorText(error), true);
  }
  async function run(label, operation) {
    if (busy || gone) return;
    const token = ++epoch, identity = client.user;
    const live = () => token === epoch && !gone;
    const current = () => live() && (!identity || client.user?.id === identity.id && client.user?.username === identity.username);
    busy = true; message(label); controls();
    try { await operation(current, live); }
    catch (error) { if (live()) handleError(error); }
    finally {
      if (live()) {
        if (identity && client.user && (client.user.id !== identity.id || client.user.username !== identity.username)) { client.disconnect(); clearPrivate(); message('页面账号已变化，旧名单和清单已清除，请重新连接。', true); }
        busy = false; controls();
      }
    }
  }
  function requireAdvisor() { if (client.user?.role !== 'advisor') throw { code: 'ROLE' }; }
  function selectionChanged(event) {
    viewRevision++; clearPreview();
    if (chosen().length > 20) { event.target.checked = false; message('每批最多20份，请明确保留需要的报告，未读取摘要。', true); }
    else message(`已选择${chosen().length}份报告，尚未读取或导出摘要。`);
    controls();
  }
  function drawList() {
    const root = $('#summaryList'); root.replaceChildren();
    if (!grants.length) root.append(node('p', '没有有效的单报告只读授权。请所有者明确授权后主动刷新。'));
    for (const grant of grants) {
      const row = node('label'); row.className = 'summary-grant'; const select = node('input'); select.type = 'checkbox'; select.dataset.summaryGrant = grant.id; select.onchange = selectionChanged;
      const text = node('div'); text.append(node('strong', grant.report_name), node('p', `${grant.report_ref} · 修订 ${grant.report_revision} · 授权者 ${grant.owner_username}`), node('p', `有效至 ${new Date(grant.expires_at * 1000).toLocaleString('zh-CN')}`));
      row.append(select, text); root.append(row);
    }
    controls();
  }
  function validateSnapshot(result, ids, username, academic, preferences) {
    const payload = window.TeacherSummary.validate(result, username);
    if (payload.version !== (preferences ? 3 : academic ? 2 : 1) || preferences && (payload.options.academic !== academic || payload.options.preferences !== true) || !sameIds(payload.items.map(item => item.grant.id), ids) || payload.items.some(item => item.grant.expires_at * 1000 <= Date.now())) throw { code: 'PROTOCOL' };
    return payload;
  }
  function showPreview(value) {
    preview = value; const table = $('#summaryTable'); table.replaceChildren();
    table.classList.toggle('summary-academic', value.academic);
    table.classList.toggle('summary-preferences', value.preferences);
    const head = node('thead'), title = node('tr'); for (const label of window.TeacherSummary.columns(value.payload.version, value.options)) title.append(node('th', label)); head.append(title);
    const body = node('tbody'); for (const row of value.rows) { const line = node('tr'); for (const text of window.TeacherSummary.values(row, value.scoring, value.preference_schema)) line.append(node('td', text)); body.append(line); }
    $('#summaryPreviewHeading').textContent = value.preferences ? `带身份的校内${value.academic ? '学科表现与' : ''}学生自选偏好清单预览（v3）` : value.academic ? '带身份的校内学科表现清单预览（v2）' : '带身份的校内完成度清单预览';
    if (value.scoring) {
      $('#summaryScoring').textContent = `题库 ${value.scoring.bank_version} · 评分规则 ${value.scoring.rule_version} · 指纹 ${value.scoring.rule_fingerprint}。当前同版规则重算，未校准，不是正式成绩或A-Level预测；未完整科目不显示百分比，完整0%有效。`;
      $('#summaryScoring').hidden = false;
    }
    if (value.preference_schema) {
      $('#summaryPreferencesMeta').textContent = `题库 ${value.preference_schema.bank_version} · 偏好选项 ${value.preference_schema.schema_version} · 指纹 ${value.preference_schema.schema_fingerprint}。仅学生自选的固定选项，非推荐；缺答为未回答，不确定选项可与具体选项并存，顺序不代表优先级。指纹不证明历史规则、人工审校或防篡改。`;
      $('#summaryPreferencesMeta').hidden = false;
    }
    table.append(head, body); $('#summaryPreview').hidden = false; $('#summaryPreviewHeading').focus();
    // The export test compares the downloaded CSV with the exact batch that was reviewed.
    if (window.BIC_TEST_HOOKS === 1) window.__summaryPreview = value.payload;
    armSelectionExpiry();
  }
  $('#summaryConnectBtn').onclick = () => run('正在连接学校账号服务…', async current => { clearPrivate(); await client.connect(); if (current()) message(client.user ? '已恢复会话，请主动刷新授权名单。' : '已连接，请登录学校顾问账号。'); });
  $('#summaryLoginForm').onsubmit = event => { event.preventDefault(); const username = $('#summaryUsername').value, password = $('#summaryPassword').value; $('#summaryPassword').value = ''; return run('正在登录…', async current => { clearPrivate(); await client.login(username, password); if (current()) message('已登录，没有自动读取学生名单。请主动刷新授权名单。'); }); };
  $('#summaryRefreshBtn').onclick = () => run('正在核对只读授权名单…', async current => {
    requireAdvisor(); clearPreview(); grants = []; $('#summaryList').replaceChildren();
    const result = await client.listTeacherReports(); if (!current()) return;
    if (!result || !Array.isArray(result.items) || result.items.length > 100 || result.items.some(grant => grant.scope !== 'full_report_read_only' || grant.status !== 'active' || grant.recipient_username !== client.user.username)) throw { code: 'PROTOCOL' };
    grants = result.items.filter(grant => grant.expires_at * 1000 > Date.now()); drawList(); message('已读取有效只读授权元数据。请逐份选择1–20份报告，再主动核对摘要。');
  });
  $('#summaryPreviewBtn').onclick = () => {
    if (busy) return; const ids = chosen(), academic = academicMode(), preferences = preferencesMode(), revision = viewRevision;
    return run('正在核对所选报告的必要完成度…', async current => {
      requireAdvisor(); clearPreview(); if (!ids.length || ids.length > 20) throw { code: 'PROTOCOL' };
      const user = client.user, result = await client.readTeacherSummaries(ids, requestOptions(academic, preferences)); if (!current() || !sameIds(chosen(), ids) || academicMode() !== academic || preferencesMode() !== preferences || viewRevision !== revision) return;
      const payload = validateSnapshot(result, ids, user.username, academic, preferences), built = window.TeacherSummary.build(payload, user.username);
      showPreview({ payload, snapshot: stamp(payload), ids: [...ids], username: user.username, userId: user.id, academic, preferences, viewRevision: revision, csv: built.csv, rows: built.rows, scoring: built.scoring, options: built.options, preference_schema: built.preference_schema, until: Math.min(...payload.items.map(item => item.grant.expires_at)) });
      message(`已预览${ids.length}份带身份的校内${modeName(academic, preferences)}。未导出；下载前后还会核对模式、规则、偏好选项、授权、修订和身份。`);
    });
  };
  $('#summaryExportBtn').onclick = () => {
    const captured = preview; if (busy || !currentPreview(captured)) return;
    return run('正在重新核对预览来源…', async current => {
      requireAdvisor();
      const fresh = validateSnapshot(await client.readTeacherSummaries(captured.ids, requestOptions(captured.academic, captured.preferences)), captured.ids, captured.username, captured.academic, captured.preferences);
      if (!current() || !currentPreview(captured) || stamp(fresh) !== captured.snapshot) throw { code: 'STALE' };
      const accepted = window.confirm(`导出这${captured.ids.length}份包含学生姓名、报告编号、完成度${captured.academic ? '、完整科目的同版题库表现（非正式成绩）' : ''}${captured.preferences ? '、学生自选专业意向与地区偏好（非规则推荐）' : ''}的校内CSV（${modeName(captured.academic, captured.preferences)}）？请仅在获准的校内用途保管，不能称匿名资料；已经下载或复制的副本无法收回。确认后还会核对一次模式、规则、偏好选项、授权与修订。`);
      if (!current() || !currentPreview(captured)) throw { code: 'STALE' };
      if (!accepted) { message('已取消下载，未生成文件。'); return; }
      const final = validateSnapshot(await client.readTeacherSummaries(captured.ids, requestOptions(captured.academic, captured.preferences)), captured.ids, captured.username, captured.academic, captured.preferences);
      if (!current() || !currentPreview(captured) || stamp(final) !== captured.snapshot) throw { code: 'STALE' };
      const url = URL.createObjectURL(new Blob([captured.csv], { type: 'text/csv;charset=utf-8' })), link = node('a'); link.href = url; link.download = captured.preferences ? captured.academic ? 'bic-teacher-academic-preferences-v3.csv' : 'bic-teacher-preferences-v3.csv' : captured.academic ? 'bic-teacher-academic-v2.csv' : 'bic-teacher-completion-v1.csv'; document.body.append(link); link.click(); link.remove(); URL.revokeObjectURL(url);
      message(`已导出${captured.ids.length}份校内${modeName(captured.academic, captured.preferences)}清单，请妥善保管带身份资料。`);
    });
  };
  function modeChanged() { viewRevision++; clearPreview(); controls(); message(`已选择${modeName(academicMode(), preferencesMode())}，旧预览已清除；请重新核对。学生自选非推荐，学科表现不是正式成绩或真实校准。`); }
  $('#summaryAcademic').onchange = modeChanged;
  $('#summaryPreferences').onchange = modeChanged;
  $('#summaryLogoutBtn').onclick = () => run('正在退出账号…', async (_, live) => {
    clearPrivate(); try { await client.logout(); if (live()) message('已退出，服务端会话已撤销。'); }
    catch (_) { if (live()) message('本页已断开，但服务器注销未确认。请重新连接后退出。', true); }
    finally { if (live()) { client.disconnect(); clearPrivate(); $('#summaryUsername').value = ''; } }
  });
  $('#summaryDisconnectBtn').onclick = () => { epoch++; busy = false; client.disconnect(); clearPrivate(); $('#summaryUsername').value = ''; controls(); message('本页已断开，名单和CSV已清除，服务器会话未注销。'); };
  window.addEventListener('pagehide', () => { gone = true; epoch++; busy = false; client.disconnect(); clearPrivate(); $('#summaryUsername').value = ''; });
  window.addEventListener('pageshow', () => { if (gone) { gone = false; controls(); message('本页已断开，请主动重新连接。'); } });
  controls();
})();
