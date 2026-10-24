/* 分享固定摘要；链接仅本页本次显示，不存入本机库或自动发送给任何人。 */
(function () {
  'use strict';
  const $ = selector => document.querySelector(selector);
  function node(tag, text) { const element = document.createElement(tag); element.textContent = String(text); return element; }
  function init(options) {
    let selected = null, preview = null, shares = [], createdId = null, busy = false;
    const labels = { summary: '核心结论', academic: '学习行动', plan: '专业与职业', personality: '学习策略' };
    function setBusy(value) {
      busy = value;
      $('#sharePreviewBtn').disabled = busy || !selected;
      $('#shareListBtn').disabled = busy || !selected;
      $('#shareTtl').disabled = busy || !selected;
      $('#shareCreateBtn').disabled = busy || !preview;
      $('#shareCopyBtn').disabled = busy || !$('#shareLink').value;
      for (const button of $('#ownerShareList').querySelectorAll('button')) button.disabled = busy;
    }
    function clear() {
      selected = preview = createdId = null;
      shares = [];
      $('#sharePreview').hidden = true;
      $('#sharePreview').replaceChildren();
      $('#shareLink').value = '';
      $('#shareLinkBox').hidden = true;
      $('#ownerShareList').replaceChildren();
      setBusy(busy);
    }
    function setReport(value) { clear(); selected = value; setBusy(busy); }
    function drawShares() {
      const list = $('#ownerShareList');
      list.replaceChildren();
      if (!shares.length) list.append(node('p', '没有已保存的分享。'));
      for (const share of shares) {
        const item = document.createElement('div');
        item.className = 'owner-share-row';
        item.append(node('p', `修订 ${share.report_revision} · 有效至 ${new Date(share.expires_at * 1000).toLocaleString('zh-CN')} · ${{ active: '有效', revoked: '已撤销', expired: '已过期' }[share.status]}`));
        if (share.status === 'active') {
          const button = node('button', '撤销此分享');
          button.className = 'btn ghost sm'; button.type = 'button'; button.dataset.shareRevoke = share.id;
          button.onclick = () => {
            if (busy || !selected || !window.confirm('撤销这份只读分享？持有原链接的人将无法再读取，已下载或截图的内容无法收回。')) return;
            const report = selected;
            options.run('正在撤销分享…', async current => {
              await options.client.revokeShare(report.id, share.id);
              if (!current()) return;
              shares = shares.filter(item => item.id !== share.id);
              if (createdId === share.id) { createdId = null; $('#shareLink').value = ''; $('#shareLinkBox').hidden = true; }
              drawShares(); options.message('已撤销分享，原链接不能再读取。原报告未改变。');
            });
          };
          item.append(button);
        }
        list.append(item);
      }
      setBusy(busy);
    }
    $('#sharePreviewBtn').onclick = () => options.run('正在生成可分享摘要…', async current => {
      if (!selected) throw new Error('请先读取服务端报告。');
      const content = window.ParentSummary.build(selected.record);
      if (!current()) return;
      preview = { id: selected.id, revision: selected.revision, content };
      const panel = $('#sharePreview'); panel.replaceChildren();
      panel.append(node('h4', selected.record.state.info.name + ' · 只读摘要预览'),
        node('p', `探索方向：${content.direction}；性格提示：${content.personality}`));
      for (const subject of content.subjects) panel.append(node('p', `${subject.name}：已答 ${subject.answered}/${subject.total}，${subject.pct === null ? '尚未完成，不显示百分数' : '本次题库 ' + subject.pct + '%'}`));
      for (const [key, label] of Object.entries(labels)) panel.append(node('h4', label), node('p', content.sections[key]));
      panel.hidden = false;
      options.message('请核对摘要和期限。原始逐题答卷、解析、账号与顾问修改审计不会分享。');
    });
    $('#shareCreateBtn').onclick = () => {
      if (busy || !preview || !selected || preview.id !== selected.id || preview.revision !== selected.revision) return;
      const report = selected, snapshot = preview;
      const hours = Number($('#shareTtl').value);
      if (!window.confirm(`为「${report.record.state.info.name}」的修订 ${report.revision} 创建 ${hours} 小时只读摘要链接？任何持链接的人均可读取这份摘要，可在此撤销。报告更新不会改变已有快照。`)) return;
      options.run('正在创建只读分享…', async current => {
        const share = await options.client.createShare(report.id, snapshot.revision, hours, snapshot.content);
        if (!current()) return;
        const link = new URL('share.html', window.location.href);
        link.hash = 'share=' + share.token;
        $('#shareLink').value = link.href;
        $('#shareLinkBox').hidden = false;
        createdId = share.id;
        const { token, ...metadata } = share;
        shares = [metadata, ...shares.filter(item => item.id !== share.id && item.status === 'active')];
        drawShares();
        options.message('只读链接已生成，仅此次显示；请自行复制并妥善保管。系统没有发送给其他人。');
      });
    };
    $('#shareListBtn').onclick = () => {
      if (!selected) return;
      const report = selected;
      options.run('正在读取已有分享…', async current => {
        const result = await options.client.listShares(report.id);
        if (!current()) return;
        shares = result.items; drawShares();
        options.message('已读取分享状态。已有链接的令牌不会再次显示，可撤销后新建。');
      });
    };
    $('#shareCopyBtn').onclick = async () => {
      const value = $('#shareLink').value;
      if (!value || busy) return;
      try { await navigator.clipboard.writeText(value); if ($('#shareLink').value === value) options.message('只读链接已复制，请仅交给预期接收人。'); }
      catch (_) { $('#shareLink').focus(); $('#shareLink').select(); options.message('请手动复制已选中的只读链接。'); }
    };
    clear();
    return { clear, setReport, setBusy };
  }
  window.ParentShareOwner = { init };
})();
