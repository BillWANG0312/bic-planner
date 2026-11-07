/* 公共管理员后台：创建一次性测试码、查看按码归档的学生报告。 */
(function () {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const client = window.CloudReports.create({
    config: window.BIC_CLOUD_CONFIG, location: window.location, fetch: window.fetch.bind(window)
  });
  const statusLabels = {
    unused: '未使用', in_progress: '答题中', completed: '已完成', expired: '已过期', revoked: '已撤销'
  };
  let busy = false;

  function message(text, error = false) {
    const element = $('#adminListStatus');
    element.textContent = text;
    element.classList.toggle('is-error', error);
  }
  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }
  function controls() {
    for (const element of document.querySelectorAll('button, input, select')) element.disabled = busy;
    $('#adminLoginBtn').disabled = busy;
    $('#adminCreateBtn').disabled = busy;
  }
  function showLogin(text = '') {
    $('#adminLoginPanel').hidden = false;
    $('#adminWorkspace').hidden = true;
    $('#adminIdentity').textContent = '';
    $('#adminConnectStatus').textContent = text;
  }
  function showWorkspace(user) {
    $('#adminLoginPanel').hidden = true;
    $('#adminWorkspace').hidden = false;
    $('#adminIdentity').textContent = '当前管理员：' + user.username;
  }

  function formatTime(seconds) {
    if (!Number.isSafeInteger(seconds) || seconds <= 0) return '—';
    return new Date(seconds * 1000).toLocaleString('zh-CN');
  }

  function drawCodes(value) {
    const root = $('#adminCodes');
    root.replaceChildren();
    if (!value.items.length) { root.append(node('p', 'admin-empty', '还没有测试码。')); return; }
    const table = node('table', 'admin-table');
    const head = node('tr');
    for (const label of ['测试码', '批次', '状态', '创建时间', '过期时间', '操作']) head.append(node('th', '', label));
    const header = node('thead');
    header.append(head);
    table.append(header);
    const body = node('tbody');
    value.items.forEach(item => {
      const row = node('tr');
      const code = node('td');
      code.append(node('code', '', item.code));
      row.append(code);
      row.append(node('td', '', item.label));
      row.append(node('td', '', statusLabels[item.status] || item.status));
      row.append(node('td', '', formatTime(item.created_at)));
      row.append(node('td', '', formatTime(item.expires_at)));
      const action = node('td');
      if (item.status === 'unused' || item.status === 'in_progress') {
        const button = node('button', 'btn ghost sm', '撤销');
        button.type = 'button';
        button.onclick = () => revoke(item);
        action.append(button);
      }
      row.append(action);
      body.append(row);
    });
    table.append(body);
    root.append(table);
  }

  function drawReports(value) {
    const root = $('#adminReports');
    root.replaceChildren();
    if (!value.items.length) { root.append(node('p', 'admin-empty', '还没有学生提交报告。')); return; }
    const table = node('table', 'admin-table');
    const head = node('tr');
    for (const label of ['学生', '年级', '目标入学', '报告编号', '测试码', '批次', '提交时间', '操作']) head.append(node('th', '', label));
    const header = node('thead');
    header.append(head);
    table.append(header);
    const body = node('tbody');
    value.items.forEach(item => {
      const row = node('tr');
      for (const text of [item.name, item.grade, item.year, item.report_ref, item.code, item.label,
        new Date(item.created_at).toLocaleString('zh-CN')]) row.append(node('td', '', text));
      const action = node('td');
      const button = node('button', 'btn primary sm', '查看报告');
      button.type = 'button';
      button.onclick = () => openReport(item.id);
      action.append(button);
      row.append(action);
      body.append(row);
    });
    table.append(body);
    root.append(table);
  }

  async function loadLists() {
    const [codes, reports] = await Promise.all([client.adminListTestCodes(), client.adminListReports()]);
    drawCodes(codes);
    drawReports(reports);
    message(`测试码 ${codes.total} 个，学生报告 ${reports.total} 份。`);
  }

  async function refresh() {
    if (busy) return;
    busy = true; controls();
    try { await loadLists(); }
    catch (error) { message('无法读取后台数据：' + (error.message || '请重新登录。'), true); }
    finally { busy = false; controls(); }
  }

  async function revoke(item) {
    if (busy) return;
    if (!window.confirm(`撤销测试码 ${item.code}？撤销后学生不能再用它开始或提交测评。`)) return;
    busy = true; controls();
    try {
      await client.adminRevokeTestCode(item.id);
      await loadLists();
      message(`测试码 ${item.code} 已撤销。`);
    } catch (error) {
      message('撤销失败：' + (error.message || '请稍后重试。'), true);
    } finally { busy = false; controls(); }
  }

  async function openReport(id) {
    if (busy) return;
    busy = true; controls();
    $('#adminReportPanel').hidden = true;
    try {
      const detail = await client.adminGetReport(id);
      const record = detail.record;
      const state = { ...record.state, assessmentProfile: window.AssessmentProfiles.recordProfile(record) };
      const report = window.generateReport(state);
      Object.assign(report.meta, { batchId: record.reportMeta.batchId, date: record.reportMeta.date });
      if (record.advisor) report.advisor = record.advisor;
      $('#adminReportHeading').textContent = `${record.state.info.name || '未填写姓名'} · ${record.reportMeta.batchId} · 测试码 ${detail.code}`;
      $('#adminReportRoot').innerHTML = window.renderReport(report);
      $('#adminReportPanel').hidden = false;
      window.animateReport?.($('#adminReportRoot'));
      $('#adminReportPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
      message('报告已打开。');
    } catch (error) {
      message('无法打开报告：' + (error.message || '请刷新后重试。'), true);
    } finally { busy = false; controls(); }
  }

  $('#adminCreateForm').onsubmit = async event => {
    event.preventDefault();
    if (busy) return;
    const label = $('#adminCodeLabel').value;
    const hours = Number($('#adminCodeHours').value);
    busy = true; controls();
    $('#adminCreateStatus').textContent = '正在生成测试码…';
    try {
      const created = await client.adminCreateTestCode(label, hours);
      $('#adminCodeLabel').value = '';
      const box = $('#adminNewCode');
      box.hidden = false;
      box.replaceChildren(document.createTextNode(created.code + '　'));
      const copy = node('button', 'btn ghost sm', '复制');
      copy.type = 'button';
      copy.onclick = async () => {
        try { await navigator.clipboard.writeText(created.code); $('#adminCreateStatus').textContent = '测试码已复制。'; }
        catch (_) { $('#adminCreateStatus').textContent = '请手动选择并复制上面的测试码。'; }
      };
      box.append(copy);
      $('#adminCreateStatus').textContent = `已生成，有效期至 ${new Date(created.expires_at * 1000).toLocaleString('zh-CN')}。`;
      await loadLists();
    } catch (error) {
      $('#adminCreateStatus').textContent = '生成失败：' + (error.message || '请检查登录状态后重试。');
    } finally { busy = false; controls(); }
  };

  $('#adminRefreshBtn').onclick = refresh;
  $('#adminPrintBtn').onclick = () => window.print();
  $('#adminCloseReportBtn').onclick = () => { $('#adminReportPanel').hidden = true; };
  $('#adminLogoutBtn').onclick = async () => {
    if (busy) return;
    busy = true; controls();
    try { await client.logout(); } catch (_) { /* 结果不确定时也回到登录页。 */ }
    finally {
      client.disconnect(); busy = false; controls(); showLogin('已退出账号。');
    }
  };

  $('#adminLoginForm').onsubmit = async event => {
    event.preventDefault();
    if (busy) return;
    const username = $('#adminUsername').value;
    const password = $('#adminPassword').value;
    $('#adminPassword').value = '';
    busy = true; controls();
    $('#adminConnectStatus').textContent = '正在连接并登录…';
    try {
      await client.connect();
      const session = await client.login(username, password);
      if (!session?.user || session.user.role !== 'advisor') {
        await client.logout().catch(() => {});
        client.disconnect();
        showLogin('该账号不是管理员公共账号。');
        return;
      }
      showWorkspace(session.user);
      await loadLists();
    } catch (error) {
      client.disconnect();
      showLogin(error?.status === 401 ? '账号或密码不正确。' : '无法登录：' + (error.message || '请稍后重试。'));
    } finally { busy = false; controls(); }
  };

  (async function boot() {
    try {
      const session = await client.connect();
      if (session?.user?.role === 'advisor') {
        showWorkspace(session.user);
        await loadLists();
      } else if (session?.user) {
        client.disconnect();
        showLogin('该账号不是管理员公共账号。');
      } else showLogin('请使用管理员公共账号登录。');
    } catch (error) {
      showLogin('无法连接测试码服务：' + (error.message || '请使用学校提供的网址。'));
    }
    controls();
  })();
})();
