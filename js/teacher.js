/* One authenticated advisor, explicit reads, memory-only reconstruction. */
(function () {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const client = window.CloudReports.create({ config: window.BIC_CLOUD_CONFIG, location: window.location });
  let grants = [], selected = null, busy = false, epoch = 0, gone = false, expiryTimer = null;
  try { if (location.hash) history.replaceState(null, '', location.pathname + location.search); } catch (_) { /* Fragments never grant access. */ }
  function node(tag, text) { const element = document.createElement(tag); if (text != null) element.textContent = String(text); return element; }
  function message(text, error = false) { $('#teacherStatus').textContent = text; $('#teacherStatus').classList.toggle('is-error', error); }
  function clearReport() {
    clearTimeout(expiryTimer); expiryTimer = null; selected = null;
    $('#teacherDetail').hidden = true; $('#teacherHeading').textContent = ''; $('#teacherNote').textContent = '';
    $('#teacherReport').replaceChildren(); $('#teacherHistory').replaceChildren(); $('#teacherHistoryPanel').open = false;
  }
  function clearPrivate() { grants = []; clearReport(); $('#teacherList').replaceChildren(); $('#teacherAccount').textContent = ''; $('#teacherPassword').value = ''; }
  function controls() {
    const user = client.user;
    $('#teacherConnectPanel').hidden = client.connected;
    $('#teacherLoginForm').hidden = !client.connected || !!user;
    $('#teacherWorkspace').hidden = !user;
    $('#teacherDisconnectBtn').hidden = !client.connected && !busy;
    $('#teacherConnectBtn').disabled = busy;
    $('#teacherLoginForm button[type=submit]').disabled = busy;
    $('#teacherUsername').disabled = busy; $('#teacherPassword').disabled = busy;
    $('#teacherRefreshBtn').disabled = busy; $('#teacherLogoutBtn').disabled = busy;
    $('#teacherReadRefreshBtn').disabled = busy || !selected;
    if (user) $('#teacherAccount').textContent = `当前学校账号：${user.username}（${user.role === 'advisor' ? '顾问，仅可读明确授权报告' : '当前不是顾问角色'}）`;
    for (const button of $('#teacherList').querySelectorAll('button')) button.disabled = busy;
  }
  function errorText(error) {
    if (error?.status === 401 || error?.status === 403 || error?.code === 'AUTH') return '账号会话已失效或变化，请重新登录；此前名单和报告已清除。';
    if (error?.status === 404 || error?.status === 409) return '授权已关闭或源修订已更新，报告已清除。请让所有者核对账号、期限和修订后重新授权。';
    if (error?.code === 'VERSION') return '归档题库或院校目录版本与本页不同，未重新计算或显示正文。请所有者复核更新报告后重新授权。';
    if (error?.code === 'ROLE') return '当前账号不是顾问角色，不能读取跨用户报告。请核对学校提供的账号。';
    if (error?.code === 'NETWORK' || error?.code === 'TIMEOUT') return '连接中断或超时，旧报告已清除。请稍后主动刷新并重新读取，未自动重试。';
    if (error?.code === 'DISABLED') return '本网站尚未开通顾问只读服务，请联系学校维护者。';
    if (error?.code === 'LOCAL_ONLY') return '直接打开文件时不能连接顾问服务，请使用学校提供的 HTTPS 网址。';
    if (error?.code === 'CONFIG' || error?.code === 'DISCONNECTED') return '请从学校提供的同源 HTTPS 网址主动连接账号服务。';
    return '报告资料或服务暂时无法核对，正文已清除。请联系学校维护者，未自动重试。';
  }
  function handleError(error) {
    if (error?.code === 'CANCELLED') return;
    clearReport();
    if (!client.user || error?.status === 401 || error?.status === 403) { client.disconnect(); clearPrivate(); }
    message(errorText(error), true);
  }
  async function run(label, operation) {
    if (busy || gone) return;
    const token = ++epoch, userId = client.user?.id;
    const live = () => token === epoch && !gone;
    const current = () => live() && (!userId || client.user?.id === userId);
    busy = true; message(label); controls();
    try { await operation(current, live); }
    catch (error) { if (live()) handleError(error); }
    finally { if (live()) { busy = false; controls(); } }
  }
  function requireAdvisor() { if (client.user?.role !== 'advisor') throw { code: 'ROLE' }; }
  function drawList() {
    const root = $('#teacherList'); root.replaceChildren();
    if (!grants.length) root.append(node('p', '当前顾问账号没有有效的单报告只读授权。请所有者明确授权后主动刷新。'));
    for (const grant of grants) {
      const row = document.createElement('section'); row.className = 'teacher-grant';
      const text = node('div'); text.append(node('h3', grant.report_name), node('p', `${grant.report_ref} · 修订 ${grant.report_revision} · 授权者 ${grant.owner_username}`),
        node('p', `接收顾问 ${grant.recipient_username}；有效至 ${new Date(grant.expires_at * 1000).toLocaleString('zh-CN')}；完整报告只读`));
      const read = node('button', '核对并读取只读报告'); read.type = 'button'; read.className = 'btn ghost sm'; read.dataset.teacherRead = grant.id;
      read.onclick = () => readReport(grant.id); row.append(text, read); root.append(row);
    }
    controls();
  }
  function validateAndRestore(result, id) {
    const grant = result?.grant, report = result?.report;
    if (!grant || !report || grant.id !== id || grant.status !== 'active' || grant.scope !== 'full_report_read_only'
        || grant.recipient_username !== client.user?.username || report.id !== grant.report_id || report.revision !== grant.report_revision
        || report.record?.state?.info?.name !== grant.report_name || report.record?.reportMeta?.batchId !== grant.report_ref
        || !Number.isSafeInteger(grant.expires_at) || grant.expires_at * 1000 <= Date.now()) throw { code: 'PROTOCOL' };
    const record = report.record;
    const versions = [record.bankVersion, record.catalogVersion, window.QUESTION_BANK_META?.version, window.UNIVERSITY_CATALOG?.version];
    if (versions.some(value => !value || value === 'unknown') || record.bankVersion !== window.QUESTION_BANK_META.version || record.catalogVersion !== window.UNIVERSITY_CATALOG.version) throw { code: 'VERSION' };
    let raw = null;
    const store = window.ReportStore.create({ getItem: () => raw, setItem: (_, value) => { raw = value; } });
    store.importBackup(JSON.stringify({ format: 'bic-report-library', version: 1, exportedAt: new Date().toISOString(), records: [record] }));
    return { grant, report, state: store.restore(record.id).state };
  }
  function drawHistory(record) {
    const root = $('#teacherHistory'); root.replaceChildren();
    const labels = { summary: '核心结论', academic: '学习行动', plan: '专业与职业', personality: '学习策略' };
    if (!record.advisor?.history?.length) { root.append(node('p', '没有已保存的顾问修改记录。')); return; }
    for (const entry of [...record.advisor.history].reverse()) {
      const row = node('article'); row.append(node('h3', labels[entry.section] || '建议修改'), node('small', `${entry.author} · ${new Date(entry.at).toLocaleString('zh-CN')} · ${{ edit: '编辑', restore: '恢复旧内容', reset: '恢复系统建议' }[entry.action] || '建议修改'}`));
      if (entry.origin) row.append(node('p', `${window.reportEditing.originLabel(entry.origin)} · ${entry.origin.generator} · 源修订 ${entry.origin.source_revision}`));
      if (entry.actor) {
        const actor = window.reportEditing.normalizeActor(entry.actor);
        row.append(node('p', `学校顾问账号 ${actor.username} · 修订 ${actor.source_revision} → ${actor.result_revision}（便携记录，服务端审计由报告所有者另行读取）`));
      }
      row.append(node('p', '修改前'), node('pre', entry.before), node('p', '修改后'), node('pre', entry.after)); root.append(row);
    }
  }
  function showReport(value) {
    selected = { id: value.grant.id, expires_at: value.grant.expires_at };
    $('#teacherHeading').textContent = value.grant.report_name + ' · 只读报告';
    $('#teacherNote').textContent = `授权者 ${value.grant.owner_username} · 已核对服务端修订 ${value.grant.report_revision} · 有效至 ${new Date(value.grant.expires_at * 1000).toLocaleString('zh-CN')}。本页按相同版本的当前本地规则生成视图，原报告未改动。`;
    $('#teacherReport').innerHTML = window.renderReport(value.state.report);
    drawHistory(value.report.record); $('#teacherDetail').hidden = false;
    const captured = selected, id = selected.id;
    expiryTimer = setTimeout(() => {
      if (selected !== captured) return;
      grants = grants.filter(grant => grant.id !== id); clearReport(); drawList(); message('授权已到期，报告与修改记录已清除。请所有者重新核对授权。');
    }, Math.max(0, Math.min(2147483647, value.grant.expires_at * 1000 - Date.now())));
    $('#teacherHeading').focus();
  }
  function readReport(id) {
    if (busy) return;
    clearReport();
    return run('正在核对单报告授权并读取…', async current => {
      requireAdvisor();
      const result = await client.readTeacherReport(id);
      if (!current()) return;
      const restored = validateAndRestore(result, id); showReport(restored);
      message('已读取此修订的完整报告和只读修改记录。没有保存到本机进度，也没有授予编辑权限。');
    });
  }
  $('#teacherConnectBtn').onclick = () => run('正在连接学校账号服务…', async current => {
    clearPrivate(); await client.connect(); if (current()) message(client.user ? '已恢复会话。请主动刷新授权名单。' : '已连接，请登录学校顾问账号。');
  });
  $('#teacherLoginForm').onsubmit = event => {
    event.preventDefault(); const username = $('#teacherUsername').value, password = $('#teacherPassword').value; $('#teacherPassword').value = '';
    return run('正在登录…', async current => { clearPrivate(); await client.login(username, password); if (current()) message('已登录。请主动刷新授权名单，没有自动读取学生资料。'); });
  };
  $('#teacherRefreshBtn').onclick = () => run('正在核对有效授权名单…', async current => {
    requireAdvisor();
    const value = await client.listTeacherReports();
    if (!current()) return;
    grants = value.items.filter(grant => grant.status === 'active' && grant.expires_at * 1000 > Date.now());
    if (selected && !grants.some(grant => grant.id === selected.id && grant.status === 'active' && grant.expires_at * 1000 > Date.now())) clearReport();
    drawList(); message('已刷新有效授权。点击一份报告重新核对修订并读取。');
  });
  $('#teacherReadRefreshBtn').onclick = () => { if (selected) return readReport(selected.id); };
  $('#teacherLogoutBtn').onclick = () => run('正在退出账号…', async (_, live) => {
    clearPrivate();
    try { await client.logout(); if (live()) message('已退出账号，服务端会话已撤销。'); }
    catch (_) { if (live()) message('本页已断开，但服务器注销尚未确认。请重新连接后退出。', true); }
    finally { if (live()) { client.disconnect(); clearPrivate(); $('#teacherUsername').value = ''; } }
  });
  $('#teacherDisconnectBtn').onclick = () => { epoch++; busy = false; client.disconnect(); clearPrivate(); $('#teacherUsername').value = ''; controls(); message('本页已断开，服务器会话未注销。重新连接后才能读取。'); };
  window.addEventListener('pagehide', () => { gone = true; epoch++; busy = false; client.disconnect(); clearPrivate(); });
  window.addEventListener('pageshow', () => { if (gone) { gone = false; controls(); message('本页已断开，请主动重新连接。'); } });
  controls();
})();
