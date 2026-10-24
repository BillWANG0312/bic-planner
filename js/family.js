/* Authenticated, single-invitation discussions; no assessment or browser storage. */
(function () {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const client = window.CloudReports.create({ config: window.BIC_CLOUD_CONFIG, location: window.location });
  let grants = [], thread = null, pending = null, busy = false, epoch = 0, gone = false;
  try { if (location.hash) history.replaceState(null, '', location.pathname + location.search); } catch (_) { /* no fragment grants permission */ }
  const labels = { active: '有效', revoked: '已撤销', expired: '已到期', unavailable: '已关闭' };
  function node(tag, text) { const element = document.createElement(tag); if (text != null) element.textContent = String(text); return element; }
  function message(text, error = false) { $('#familyStatus').textContent = text; $('#familyStatus').classList.toggle('is-error', error); }
  function hasDraft() { return $('#familyBody').value.length > 0 || !!pending; }
  function discardConfirmed() {
    return !hasDraft() || window.confirm('放弃本页尚未提交或结果未确认的文字？已被服务端保存的批注不会撤回，建议先刷新讨论核对。');
  }
  function clearDraft() { $('#familyBody').value = ''; pending = null; }
  function clearThread(keepDraft = false) {
    thread = null; $('#familyThread').hidden = true;
    $('#familyThreadHeading').textContent = ''; $('#familyThreadNote').textContent = '';
    $('#familySnapshot').replaceChildren(); $('#familyComments').replaceChildren();
    if (!keepDraft) clearDraft();
  }
  function clearPrivate() { grants = []; clearThread(); $('#familyList').replaceChildren(); $('#familyAccount').textContent = ''; $('#familyPassword').value = ''; }
  function closeUnavailableThread() {
    if (!thread || !hasDraft()) { clearThread(); return false; }
    // The writer may retain their own unsent words, but not the now-unavailable
    // report or discussion. A later thread/account cannot inherit this draft.
    thread = { ...thread, snapshot: null, comments: [], can_comment: false, draft_only: true };
    $('#familySnapshot').replaceChildren(); $('#familyComments').replaceChildren();
    $('#familyThreadHeading').textContent = '本页未提交文字';
    $('#familyThreadNote').textContent = '原邀请已不可用，摘要和讨论已清除。以下文字仅供复制留存，不能继续提交。';
    $('#familyThread').hidden = false;
    return true;
  }
  function controls() {
    const user = client.user;
    $('#familyConnectPanel').hidden = client.connected;
    $('#familyLoginForm').hidden = !client.connected || !!user;
    $('#familyWorkspace').hidden = !user;
    $('#familyDisconnectBtn').hidden = !client.connected && !busy;
    $('#familyConnectBtn').disabled = busy;
    $('#familyLoginForm button[type=submit]').disabled = busy;
    $('#familyUsername').disabled = busy; $('#familyPassword').disabled = busy;
    $('#familyRefreshBtn').disabled = busy; $('#familyLogoutBtn').disabled = busy;
    $('#familyThreadRefreshBtn').disabled = busy || !thread || !!thread.draft_only;
    $('#familyBody').disabled = busy || !thread?.can_comment && !thread?.draft_only;
    $('#familyBody').readOnly = !!thread?.draft_only;
    $('#familySubmitBtn').disabled = busy || !thread?.can_comment || thread.comments.length >= 100 || !$('#familyBody').value.trim();
    $('#familyDiscardBtn').disabled = busy || !hasDraft();
    $('#familyBodyCount').textContent = $('#familyBody').value.length + ' / 1000';
    if (user) $('#familyAccount').textContent = '当前学校账号：' + user.username;
    for (const button of $('#familyList').querySelectorAll('button')) button.disabled = busy;
  }
  function errorText(error) {
    if (error?.status === 401 || error?.status === 403 || error?.code === 'AUTH') return '账号会话已失效或变化，请重新登录。未提交文字未保存。';
    if (error?.status === 404 || error?.code === 'NOT_FOUND') return thread?.draft_only ? '邀请已关闭。未提交文字仅留在本页供复制，不能继续发送。' : '邀请已关闭或无法读取，请联系报告所有者确认。';
    if (error?.status === 409) return '此次提交与已有记录冲突，请先刷新讨论核对，不会自动重发。';
    if (error?.status === 413) return '邀请或批注数量已达上限，请联系报告所有者。';
    if (error?.status === 429) return '操作过于频繁，请稍后再试。';
    if (error?.code === 'NETWORK' || error?.code === 'TIMEOUT') return pending ? '批注提交结果尚未确认，文字已留在本页。请先刷新讨论核对，系统不会自动重发。' : '连接中断或超时，请稍后主动重试。';
    if (error?.code === 'DISABLED') return '本网站尚未开通账号批注服务，请联系学校维护者。';
    if (error?.code === 'LOCAL_ONLY') return '直接打开文件时不能连接批注服务，请使用学校提供的 HTTPS 网址。';
    if (error?.code === 'CONFIG' || error?.code === 'DISCONNECTED') return '请从学校提供的同源 HTTPS 网址主动连接账号服务。';
    if (error?.code === 'VALIDATION') return '请填写 1–1000 字符的有效非空批注。';
    if (error?.code === 'BROWSER') return '当前浏览器无法安全提交，请更新浏览器后重试。';
    return '服务返回的资料无法处理，请联系学校维护者；未自动重复提交。';
  }
  function handleError(error) {
    if (error?.code === 'CANCELLED') return;
    if (!client.user || error?.status === 401 || error?.status === 403) clearPrivate();
    else if (error?.status === 404) closeUnavailableThread();
    message(errorText(error), true);
  }
  async function run(label, operation) {
    if (busy || gone) return;
    const token = ++epoch, owner = client.user?.id;
    const live = () => token === epoch && !gone;
    const current = () => live() && (!owner || client.user?.id === owner);
    busy = true; message(label); controls();
    try { await operation(current, live); }
    catch (error) { if (live()) handleError(error); }
    finally { if (live()) { busy = false; controls(); } }
  }
  function drawList() {
    const list = $('#familyList'); list.replaceChildren();
    if (!grants.length) list.append(node('p', '当前账号没有可查看的邀请。请让报告所有者核对受邀账号。'));
    for (const grant of grants) {
      const item = document.createElement('section'); item.className = 'family-grant';
      const text = document.createElement('div');
      text.append(node('h3', grant.report_name), node('p', grant.report_ref + ' · 修订 ' + grant.report_revision),
        node('p', `受邀账号 ${grant.recipient_username}；有效至 ${new Date(grant.expires_at * 1000).toLocaleString('zh-CN')}；${labels[grant.status] || '已关闭'}`));
      const open = node('button', '查看摘要与讨论'); open.type = 'button'; open.className = 'secondary'; open.dataset.familyThread = grant.id;
      open.onclick = () => openThread(grant.id);
      item.append(text, open); list.append(item);
    }
    controls();
  }
  function drawSnapshot(snapshot) {
    const value = window.ParentSummary.validate(snapshot), result = value.content;
    const panel = $('#familySnapshot'); panel.replaceChildren();
    panel.append(node('h3', '邀请中的固定报告摘要'), node('p', `${value.report.name} · ${value.report.batchId} · 修订 ${value.report.revision}`),
      node('p', `${value.report.date}；题库 ${value.report.bankVersion}；院校 ${value.report.catalogVersion || '未记录'}`),
      node('p', `探索方向：${result.direction}；学习偏好：${result.personality}`));
    for (const subject of result.subjects) panel.append(node('p', `${subject.name}：已答 ${subject.answered}/${subject.total}；${subject.pct === null ? '待完成' : subject.pct + '%'}`));
    for (const [key, label] of [['summary', '核心结论'], ['academic', '学习行动'], ['plan', '专业与职业'], ['personality', '学习策略']]) panel.append(node('h3', label), node('p', result.sections[key]));
  }
  function drawComments() {
    const list = $('#familyComments'); list.replaceChildren();
    if (!thread.comments.length) list.append(node('p', '还没有批注，可以在邀请有效期内添加。'));
    for (const value of thread.comments) {
      const item = document.createElement('article'); item.className = 'family-comment'; item.dataset.familyComment = value.id;
      item.append(node('small', `${value.author === 'owner' ? '报告管理者' : '受邀账号'} · ${new Date(value.created_at * 1000).toLocaleString('zh-CN')}`), node('p', value.body));
      list.append(item);
    }
  }
  function drawThread() {
    $('#familyThread').hidden = false;
    $('#familyThreadHeading').textContent = thread.grant.report_name + ' 的讨论';
    $('#familyThreadNote').textContent = thread.can_comment ? `当前以${thread.participant === 'owner' ? '报告管理者' : '受邀账号'}身份参与；批注附于修订 ${thread.grant.report_revision} 的固定摘要。`
      : '此邀请已关闭或批注已达上限，仅可查看已有记录。';
    drawSnapshot(thread.snapshot); drawComments(); controls();
  }
  function openThread(id) {
    if (busy) return;
    const same = thread?.grant.id === id;
    if (!same && !discardConfirmed()) return;
    if (!same) clearDraft();
    const previousPending = pending;
    // Keep a previously read thread during its refresh. A network failure must
    // not hide its draft or turn a retry into a different-thread discard.
    if (!same) clearThread(true);
    return run('正在读取邀请与讨论…', async current => {
      const result = await client.familyThread(id);
      if (!current()) return;
      window.ParentSummary.validate(result.snapshot);
      thread = result;
      let confirmed = false;
      if (previousPending && previousPending.grantId === id && result.comments.some(value => value.client_request_id === previousPending.key && value.body === previousPending.body && value.author === result.participant)) {
        if ($('#familyBody').value === previousPending.body) clearDraft();
        else pending = null;
        confirmed = true;
      }
      drawThread();
      message(confirmed ? hasDraft() ? '已确认此前批注已保存；本页的新文字仍未提交，已保留。' : '已确认此前批注已保存，未重复发送。'
        : hasDraft() ? '讨论已刷新，本页未提交或待确认的文字仍保留。' : '已读取邀请与讨论。');
      $('#familyThreadHeading').focus();
    });
  }
  function newRequestId() {
    if (typeof crypto?.randomUUID === 'function') return crypto.randomUUID();
    if (typeof crypto?.getRandomValues !== 'function') throw { code: 'BROWSER' };
    const bytes = crypto.getRandomValues(new Uint8Array(16)); bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
    const hex = Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
  }
  $('#familyConnectBtn').onclick = () => run('正在连接学校账号服务…', async current => {
    clearPrivate(); await client.connect(); if (!current()) return;
    message(client.user ? '已恢复账号会话。请主动刷新邀请名单。' : '已连接，请登录学校账号。');
  });
  $('#familyLoginForm').onsubmit = event => {
    event.preventDefault(); const username = $('#familyUsername').value, password = $('#familyPassword').value; $('#familyPassword').value = '';
    return run('正在登录…', async current => { clearPrivate(); await client.login(username, password); if (current()) message('已登录，请主动刷新邀请名单。'); });
  };
  $('#familyRefreshBtn').onclick = () => run('正在刷新邀请名单…', async current => {
    const value = await client.listFamilyAccess();
    if (!current()) return;
    grants = value.items;
    const selected = thread && grants.find(grant => grant.id === thread.grant.id);
    let unavailable = false, kept = false;
    if (thread && (!selected || thread.participant === 'recipient' && selected.status !== 'active')) {
      unavailable = true; kept = closeUnavailableThread();
    } else if (thread && selected.status !== 'active') {
      thread.grant = selected; thread.can_comment = false;
      if (!thread.draft_only) drawThread();
    }
    drawList();
    message(unavailable ? kept ? '原邀请已不可用，摘要和讨论已清除；本页未提交文字已保留，只供复制。' : '原邀请已不可用，已清除摘要和讨论。'
      : '邀请名单已刷新。点击一份邀请读取摘要和讨论。');
  });
  $('#familyThreadRefreshBtn').onclick = () => { if (thread) return openThread(thread.grant.id); };
  $('#familyCommentForm').onsubmit = event => {
    event.preventDefault(); if (busy || !thread?.can_comment) return;
    const body = $('#familyBody').value;
    if (!body.trim() || body.length > 1000) { message(errorText({ code: 'VALIDATION' }), true); return; }
    let captured;
    try { captured = pending && pending.grantId === thread.grant.id && pending.body === body ? pending : { grantId: thread.grant.id, body, key: newRequestId() }; }
    catch (error) { handleError(error); return; }
    pending = captured;
    return run('正在提交批注…', async current => {
      const result = await client.addFamilyComment(captured.grantId, captured.body, captured.key);
      if (!current() || thread?.grant.id !== captured.grantId) return;
      if (!thread.comments.some(value => value.id === result.id)) thread.comments.push(result);
      clearDraft(); drawComments(); message('批注已保存，原报告与建议未改变。');
    });
  };
  $('#familyBody').oninput = controls;
  $('#familyDiscardBtn').onclick = () => { if (!busy && discardConfirmed()) { clearDraft(); if (thread?.draft_only) clearThread(); controls(); message('已放弃本页文字。已保存的批注不会撤回。'); } };
  $('#familyLogoutBtn').onclick = () => {
    if (busy || !discardConfirmed()) return;
    return run('正在退出账号…', async (_, live) => {
      clearPrivate();
      try { await client.logout(); if (live()) message('已退出账号，服务端会话已撤销。'); }
      catch (_) { if (live()) message('本页已断开，但服务器注销尚未确认，请重新连接后退出。', true); }
      finally { if (live()) { client.disconnect(); clearPrivate(); $('#familyUsername').value = ''; } }
    });
  };
  $('#familyDisconnectBtn').onclick = () => {
    if (!discardConfirmed()) return;
    epoch++; busy = false; client.disconnect(); clearPrivate(); $('#familyUsername').value = ''; controls();
    message('本页已断开，服务器会话未注销。未确认的操作请重新连接后核对。');
  };
  $('#familyBackBtn').onclick = event => { if (!discardConfirmed()) event.preventDefault(); };
  window.addEventListener('beforeunload', event => { if (hasDraft()) { event.preventDefault(); event.returnValue = ''; } });
  window.addEventListener('pagehide', () => { gone = true; epoch++; busy = false; client.disconnect(); clearPrivate(); });
  window.addEventListener('pageshow', () => { if (gone) { gone = false; controls(); message('本页已断开，请主动连接账号服务。'); } });
  controls();
})();
