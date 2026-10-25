/* An explicit, revision-bound grant to one existing advisor account. */
(function () {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const statusLabels = { active: '有效', revoked: '已撤销', expired: '已到期', unavailable: '账号或角色不可用', source_changed: '源报告修订已更新，需重新授权' };
  function node(tag, text) { const element = document.createElement(tag); if (text != null) element.textContent = String(text); return element; }
  function init(options) {
    let selected = null, preview = null, busy = false, grants = [], epoch = 0;
    const recipient = () => $('#teacherRecipient').value.toLowerCase();
    const ttl = () => Number($('#teacherTtl').value);
    function resetPreview() { preview = null; $('#teacherOwnerPreview').replaceChildren(); $('#teacherOwnerPreview').hidden = true; }
    function samePreview() { return preview && selected && preview.id === selected.id && preview.revision === selected.revision && preview.recipient === recipient() && preview.ttl === ttl(); }
    function setBusy(value) {
      busy = value;
      for (const id of ['teacherRecipient', 'teacherTtl', 'teacherPreviewBtn', 'teacherListBtn']) $('#' + id).disabled = busy || !selected;
      $('#teacherCreateBtn').disabled = busy || !samePreview();
      for (const button of $('#teacherOwnerList').querySelectorAll('button')) button.disabled = busy || !selected;
    }
    function clear() {
      epoch++; selected = null; grants = []; resetPreview();
      $('#teacherRecipient').value = ''; $('#teacherOwnerList').replaceChildren(); setBusy(busy);
    }
    function setReport(value) { clear(); selected = value; setBusy(busy); }
    function changed() { resetPreview(); setBusy(busy); }
    function drawList() {
      const root = $('#teacherOwnerList'); root.replaceChildren();
      if (!grants.length) root.append(node('p', '没有已保存的顾问只读授权。'));
      for (const grant of grants) {
        const row = document.createElement('div'); row.className = 'owner-share-row';
        row.append(node('p', `${grant.recipient_username} · 只读修订 ${grant.report_revision} · 有效至 ${new Date(grant.expires_at * 1000).toLocaleString('zh-CN')} · ${statusLabels[grant.status] || '已关闭'}`));
        if (grant.status !== 'revoked') {
          const revoke = node('button', '撤销顾问只读授权'); revoke.type = 'button'; revoke.className = 'btn ghost sm'; revoke.dataset.teacherRevoke = grant.id;
          revoke.onclick = () => {
            if (busy || !selected || !window.confirm(`撤销账号 ${grant.recipient_username} 对此报告修订的只读授权？新的读取将被拒绝，已读取或复制的资料不能收回。家长分享与批注权限另行管理。`)) return;
            const report = selected, own = epoch;
            options.run('正在撤销顾问只读授权…', async current => {
              await options.client.revokeTeacherAccess(report.id, grant.id);
              if (!current() || own !== epoch || selected !== report) return;
              grants = grants.map(value => value.id === grant.id ? { ...value, status: 'revoked', revoked_at: Math.floor(Date.now() / 1000) } : value);
              drawList(); options.message('顾问只读授权已撤销；已读取的副本不能收回，家长权限未改变。');
            });
          };
          row.append(revoke);
        }
        root.append(row);
      }
      setBusy(busy);
    }
    $('#teacherRecipient').oninput = changed; $('#teacherTtl').onchange = changed;
    $('#teacherPreviewBtn').onclick = () => {
      if (busy || !selected) return;
      const report = selected, own = epoch, target = recipient(), hours = ttl();
      options.run('正在预览顾问只读授权范围…', async current => {
        resetPreview();
        if (!/^[a-z0-9._@+-]{3,64}$/.test(target) || ![24, 72, 168].includes(hours)) throw new Error('请填写已存在的顾问账号和支持的期限。');
        if (!current() || own !== epoch || selected !== report) return;
        preview = { id: report.id, revision: report.revision, recipient: target, ttl: hours };
        const panel = $('#teacherOwnerPreview');
        panel.append(node('h4', report.record.state.info.name + ' · 完整报告只读范围'),
          node('p', `授权者账号 ${options.client.user?.username || '当前账号'}；接收顾问 ${target}；修订 ${report.revision}；期限 ${hours} 小时。`),
          node('p', `报告 ${report.record.reportMeta.batchId}；题库 ${report.record.bankVersion || '未知'}；院校目录 ${report.record.catalogVersion || '未知'}。`),
          node('p', '包含姓名、逐题作答、版本、顾问建议与修改历史及授权者账号。只读此修订，不能编辑、删除或转授原报告；接收顾问可逐份选择必要完成度摘要并保存校内CSV，包含姓名与报告编号，不是匿名文件。报告更新后需重新确认授权。已读取或复制的资料不能收回。系统不创建账号或发送消息。'));
        panel.hidden = false; setBusy(busy); options.message('请核对完整答卷与修改历史的授权范围、顾问账号、修订和期限，再确认。');
      });
    };
    $('#teacherCreateBtn').onclick = () => {
      if (busy || !samePreview()) return;
      const report = selected, captured = preview, own = epoch;
      if (!window.confirm(`授权账号 ${captured.recipient} 在 ${captured.ttl} 小时内只读「${report.record.state.info.name}」修订 ${captured.revision} 的完整报告，包括逐题答卷和顾问修改历史，并可保存含姓名/编号的校内完成度清单？报告更新需重授，已读副本不能收回。不会发送消息或授予编辑权限。`)) return;
      resetPreview(); setBusy(busy);
      options.run('正在创建顾问单报告只读授权…', async current => {
        const grant = await options.client.createTeacherAccess(report.id, captured.revision, captured.recipient, captured.ttl);
        if (!current() || own !== epoch || selected !== report) return;
        grants = [grant, ...grants.filter(value => value.id !== grant.id)]; drawList();
        options.message('顾问只读授权已创建，没有发送消息；请自行告知接收人使用顾问只读入口。');
      });
    };
    $('#teacherListBtn').onclick = () => {
      if (busy || !selected) return;
      const report = selected, own = epoch;
      options.run('正在读取顾问只读授权名单…', async current => {
        const value = await options.client.listTeacherAccess(report.id);
        if (!current() || own !== epoch || selected !== report) return;
        grants = value.items; drawList(); options.message('已读取顾问授权历史。报告修订变化或授权关闭后，对方不能继续读取。');
      });
    };
    clear(); return { clear, setReport, setBusy };
  }
  window.TeacherOwner = { init };
})();
