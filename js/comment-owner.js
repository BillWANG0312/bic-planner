/* 邀请绑定已存在的学校账号；独立授权不改变匿名只读链接。 */
(function () {
  'use strict';
  const $ = selector => document.querySelector(selector);
  function node(tag, text) { const item = document.createElement(tag); item.textContent = String(text); return item; }
  function init(options) {
    let selected = null, preview = null, busy = false, grants = [];
    function setBusy(value) {
      busy = value;
      for (const id of ['accessPreviewBtn', 'accessListBtn', 'accessRecipient', 'accessTtl']) $('#' + id).disabled = busy || !selected;
      $('#accessCreateBtn').disabled = busy || !preview;
      for (const button of $('#ownerAccessList').querySelectorAll('button')) button.disabled = busy;
    }
    function clear() {
      selected = preview = null; grants = [];
      $('#accessRecipient').value = '';
      $('#accessPreview').replaceChildren(); $('#accessPreview').hidden = true;
      $('#ownerAccessList').replaceChildren();
      setBusy(busy);
    }
    function setReport(value) { clear(); selected = value; setBusy(busy); }
    function draw() {
      const list = $('#ownerAccessList'); list.replaceChildren();
      if (!grants.length) list.append(node('p', '没有已保存的批注邀请。'));
      for (const grant of grants) {
        const row = document.createElement('div'); row.className = 'owner-share-row';
        row.append(node('p', `${grant.recipient_username} · 修订 ${grant.report_revision} · 有效至 ${new Date(grant.expires_at * 1000).toLocaleString('zh-CN')} · ${{ active: '有效', revoked: '已撤销', expired: '已过期', unavailable: '已关闭' }[grant.status]}`));
        if (grant.status === 'active') {
          const revoke = node('button', '撤销批注邀请'); revoke.type = 'button'; revoke.className = 'btn ghost sm'; revoke.dataset.accessRevoke = grant.id;
          revoke.onclick = () => {
            if (busy || !selected || !window.confirm(`撤销账号 ${grant.recipient_username} 的这份邀请？对方将不能读取或追加，所有者仍可查看历史批注。匿名只读分享的期限和撤销另行管理。`)) return;
            const report = selected;
            options.run('正在撤销批注邀请…', async current => {
              await options.client.revokeParentAccess(report.id, grant.id);
              if (!current()) return;
              grants = grants.map(item => item.id === grant.id ? { ...item, status: 'revoked' } : item);
              draw(); options.message('批注邀请已撤销，历史保留；匿名分享未改变。');
            });
          };
          row.append(revoke);
        }
        list.append(row);
      }
      setBusy(busy);
    }
    $('#accessPreviewBtn').onclick = () => options.run('正在预览批注邀请的摘要…', async current => {
      if (!selected) throw new Error('请先读取服务端报告。');
      const content = window.ParentSummary.build(selected.record);
      if (!current()) return;
      preview = { id: selected.id, revision: selected.revision, content };
      const panel = $('#accessPreview'); panel.replaceChildren();
      panel.append(node('h4', selected.record.state.info.name + ' · 受邀账号可读摘要'),
        node('p', `源修订 ${selected.revision}；方向 ${content.direction}；学习偏好 ${content.personality}`));
      for (const subject of content.subjects) panel.append(node('p', `${subject.name}：${subject.answered}/${subject.total}，${subject.pct === null ? '待完成' : subject.pct + '%'}`));
      for (const [key, label] of [['summary', '核心结论'], ['academic', '学习行动'], ['plan', '专业与职业'], ['personality', '学习策略']]) panel.append(node('h4', label), node('p', content.sections[key]));
      panel.hidden = false;
      options.message('请核对邀请摘要、接收账号和期限；不会授予原始答卷或报告修改权限。');
    });
    $('#accessCreateBtn').onclick = () => {
      if (busy || !selected || !preview || preview.id !== selected.id || preview.revision !== selected.revision) return;
      const username = $('#accessRecipient').value;
      if (!/^[A-Za-z0-9._@+-]{3,64}$/.test(username)) { options.message('请填写学校已创建的完整账号名。', true); return; }
      const report = selected, snapshot = preview, hours = Number($('#accessTtl').value);
      if (!window.confirm(`邀请账号 ${username} 在 ${hours} 小时内查看「${report.record.state.info.name}」修订 ${report.revision} 的摘要并追加批注？这是该账号的单独线程，不能修改报告。系统不会创建账号或发送消息。`)) return;
      options.run('正在创建账号批注邀请…', async current => {
        const grant = await options.client.createParentAccess(report.id, snapshot.revision, username, hours, snapshot.content);
        if (!current()) return;
        grants = [grant, ...grants.filter(item => item.id !== grant.id)]; draw();
        options.message('批注邀请已建立。请自行告知接收人使用学校账号进入「家长批注」页面，系统没有发送消息。');
      });
    };
    $('#accessListBtn').onclick = () => {
      if (!selected) return;
      const report = selected;
      options.run('正在读取批注邀请…', async current => {
        const value = await options.client.listParentAccess(report.id);
        if (!current()) return;
        grants = value.items; draw(); options.message('已读取批注邀请。所有者可在家长批注页面查看对应线程。');
      });
    };
    clear();
    return { clear, setReport, setBusy };
  }
  window.CommentOwner = { init };
})();
