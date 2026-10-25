/* Explicit self-service password change. Secrets stay in input/request memory only. */
(function () {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const client = window.CloudReports.create({ config: window.BIC_CLOUD_CONFIG, location: window.location });
  const fields = ['#accountCurrentPassword', '#accountNewPassword', '#accountConfirmPassword'];
  const whitespace = /^[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]*$/;
  const uncertainText = '改密结果尚未确认。请先用新密码主动登录核对；若未成功，再主动尝试旧密码。若连接恢复了会话，请先退出当前会话，再用新密码登录核对。没有自动重试或登录。';
  let session = null, busy = false, epoch = 0, inputRevision = 0, gone = false, expiryTimer = null, changeUnconfirmed = false;
  try { if (location.hash) history.replaceState(null, '', location.pathname + location.search); } catch (_) { /* Fragments never authenticate. */ }
  function message(text, error = false) { $('#accountStatus').textContent = text; $('#accountStatus').classList.toggle('is-error', error); }
  function password(value) {
    if (typeof value !== 'string') return false;
    const characters = [...value];
    return characters.length >= 12 && characters.length <= 128 && !characters.some(character => character.length === 1 && /[\ud800-\udfff]/.test(character));
  }
  const readPasswords = () => fields.map(selector => $(selector).value);
  function clearPasswords() { for (const selector of fields) $(selector).value = ''; $('#accountPassword').value = ''; inputRevision++; }
  function clearPrivate() { clearTimeout(expiryTimer); expiryTimer = null; session = null; clearPasswords(); $('#accountIdentity').textContent = ''; $('#accountUsername').value = ''; }
  function controls() {
    const user = client.user;
    $('#accountConnectPanel').hidden = client.connected;
    $('#accountDisconnectBtn').hidden = !client.connected && !busy;
    $('#accountLoginForm').hidden = !client.connected || !!user;
    $('#accountWorkspace').hidden = !session || !user;
    $('#accountConnectBtn').disabled = busy;
    for (const input of document.querySelectorAll('input')) input.disabled = busy;
    $('#accountLoginForm button[type=submit]').disabled = busy;
    $('#accountChangeBtn').disabled = busy || !session;
    $('#accountCancelBtn').disabled = busy;
    $('#accountLogoutBtn').disabled = busy;
  }
  function disconnect(text, error = false) { epoch++; busy = false; client.disconnect(); clearPrivate(); controls(); if (text) message(text + (changeUnconfirmed ? uncertainText : ''), error || changeUnconfirmed); }
  function armExpiry() {
    clearTimeout(expiryTimer); expiryTimer = null;
    if (!session) return;
    const captured = session;
    expiryTimer = setTimeout(() => {
      if (session !== captured || gone) return;
      if (captured.expires_at * 1000 > Date.now()) { armExpiry(); return; }
      disconnect('本页会话已到期，密码输入已清除。请主动重新连接并登录。', true);
    }, Math.max(0, Math.min(2147483647, captured.expires_at * 1000 - Date.now())));
  }
  function adopt(value) {
    const user = client.user;
    if (!value || !user || value.user?.id !== user.id || value.user?.username !== user.username
        || value.user?.role !== user.role || !Number.isSafeInteger(value.expires_at) || value.expires_at * 1000 <= Date.now()) throw { code: 'AUTH' };
    session = { user: { ...user }, expires_at: value.expires_at, generation: client.identityGeneration };
    $('#accountIdentity').textContent = `当前本人账号：${user.username}`;
    armExpiry();
  }
  function identityMatches(captured) {
    const user = client.user;
    return !gone && captured.session === session && client.connected && user?.id === captured.user.id
      && user?.username === captured.user.username && user?.role === captured.user.role
      && captured.session.generation === captured.generation && client.identityGeneration === captured.generation && captured.session.expires_at * 1000 > Date.now();
  }
  function connectionError(error) {
    if (error?.code === 'DISABLED') return '本网站尚未开通账号服务，请联系学校维护者。';
    if (error?.code === 'LOCAL_ONLY') return '直接打开文件时无法连接账号服务，请使用学校提供的HTTPS网址。';
    if (error?.code === 'AUTH' || error?.status === 401 || error?.status === 403) return '账号、密码或会话未通过核对，密码输入已清除。请主动重新连接并登录。';
    if (error?.code === 'RATE_LIMIT' || error?.status === 429) return '尝试次数过多或服务繁忙，密码输入已清除。请稍后主动重新连接。';
    return '连接结果无法确认，密码输入已清除。请稍后主动重新连接，没有自动重试。';
  }
  async function connectOrLogin(label, operation) {
    if (busy || gone) return;
    const token = ++epoch; busy = true; clearPrivate(); message(label); controls();
    try {
      const result = await operation(); if (token !== epoch || gone) return;
      if (result) { adopt(result); message(changeUnconfirmed ? `已恢复本人会话，尚未验证新密码。${uncertainText}` : '已核对本人会话。输入当前密码和新密码后，再明确确认修改。', changeUnconfirmed); }
      else message('已连接，请登录本人的学校账号。' + (changeUnconfirmed ? uncertainText : ''), changeUnconfirmed);
    } catch (error) {
      if (token === epoch && !gone) { client.disconnect(); clearPrivate(); message(connectionError(error), true); }
    } finally { if (token === epoch && !gone) { busy = false; controls(); } }
  }
  $('#accountConnectBtn').onclick = () => connectOrLogin('正在连接学校账号服务…', () => client.connect());
  $('#accountLoginForm').onsubmit = event => {
    event.preventDefault(); if (busy || gone) return;
    const username = $('#accountUsername').value, secret = $('#accountPassword').value; $('#accountPassword').value = '';
    if (!/^[A-Za-z0-9._@+-]{3,64}$/.test(username) || !password(secret)) { message('请核对账号及12–128个Unicode字符的密码，密码输入已清除。', true); return; }
    return connectOrLogin('正在登录本人账号…', () => client.login(username, secret));
  };
  for (const selector of fields) {
    $(selector).addEventListener('input', () => inputRevision++);
    $(selector).addEventListener('change', () => inputRevision++);
  }
  $('#accountCancelBtn').onclick = () => { if (!busy) { clearPasswords(); message('已取消并清空密码输入，没有发起改密请求。'); } };
  $('#accountPasswordForm').onsubmit = async event => {
    event.preventDefault(); if (busy || gone || !session || !client.user) return;
    const secrets = readPasswords(), captured = { session, user: { ...client.user }, generation: client.identityGeneration, revision: inputRevision };
    if (!secrets.every(password) || whitespace.test(secrets[1]) || secrets[0] === secrets[1] || secrets[1] !== secrets[2]) {
      clearPasswords(); message('请核对12–128个Unicode字符的有效密码：新密码不能全为空白或与当前相同，两次新密码必须一致。输入已清除。', true); return;
    }
    const token = ++epoch; busy = true; controls();
    const unchanged = () => token === epoch && identityMatches(captured) && inputRevision === captured.revision && readPasswords().every((value, index) => value === secrets[index]);
    try {
      if (!unchanged()) throw { code: 'STALE' };
      const accepted = window.confirm(`确认修改本人账号 ${captured.user.username} 的密码并撤销该账号在所有设备的全部会话？成功后需要主动重新登录；报告及授权保持原有规则，已经复制的资料无法收回。`);
      if (!unchanged()) throw { code: 'STALE' };
      if (!accepted) { clearPasswords(); message('已取消修改，三项密码输入已清除，没有发起请求。'); return; }
      clearPasswords(); message('正在提交一次改密请求，密码输入已清除…');
      // Survives disconnect/expiry/pagehide; cancellation cannot prove the server did not commit.
      changeUnconfirmed = true;
      const result = await client.changePassword(secrets[0], secrets[1]);
      if (token !== epoch || gone) return;
      if (result !== null) throw { code: 'PROTOCOL' };
      changeUnconfirmed = false;
      client.disconnect(); clearPrivate(); message('密码已修改，该账号的全部会话已撤销，所有设备需要主动重新登录。');
    } catch (error) {
      if (token !== epoch || gone) return;
      if (error?.code === 'STALE') {
        const expired = captured.session.expires_at * 1000 <= Date.now();
        if (!identityMatches(captured)) { client.disconnect(); clearPrivate(); } else clearPasswords();
        message(expired ? '本页会话已到期，密码输入已清除，没有提交。请主动重新连接并登录。' : '账号会话或密码输入已变化，旧提交已取消，输入已清除。请重新核对。', true);
      } else {
        client.disconnect(); clearPrivate();
        const definite = ['AUTH', 'CSRF', 'VALIDATION', 'RATE_LIMIT'].includes(error?.code);
        message(definite ? `${connectionError(error)}本次改密未获服务确认。请先用新密码主动登录核对；若未成功，再主动尝试旧密码，没有自动尝试。`
          : `本页已断开并清除密码。${uncertainText}`, true);
      }
    } finally { if (token === epoch && !gone) { busy = false; controls(); } }
  };
  $('#accountDisconnectBtn').onclick = () => disconnect(changeUnconfirmed ? '本页已断开，密码和账号显示已清除。' : '本页已断开，密码和账号显示已清除；服务器会话未主动注销。');
  $('#accountLogoutBtn').onclick = async () => {
    if (busy || gone) return;
    const token = ++epoch; busy = true; clearPrivate(); controls(); message('正在退出当前会话…');
    try { await client.logout(); if (token === epoch && !gone) message('已退出当前会话，密码输入已清除。'); }
    catch (_) { if (token === epoch && !gone) message('本页已断开，服务器退出结果未确认，请主动重新连接后核对。', true); }
    finally { if (token === epoch && !gone) { client.disconnect(); clearPrivate(); busy = false; controls(); } }
  };
  window.addEventListener('pagehide', () => { gone = true; disconnect(); });
  window.addEventListener('pageshow', () => { if (gone) { gone = false; controls(); message('本页已断开，请主动重新连接并登录。' + (changeUnconfirmed ? uncertainText : ''), changeUnconfirmed); } });
  controls();
})();
