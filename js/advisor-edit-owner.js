/* Separate consent for one advisor submission; readonly grants never gain write access. */
(function () {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const labels = { summary: '核心结论说明', academic: '学习行动建议', plan: '专业与职业建议', personality: '学习策略建议' };
  const statusLabels = { active: '有效', revoked: '已撤销', expired: '已到期', unavailable: '账号或角色不可用', source_changed: '源报告已更新，需重新授权' };
  function node(tag, text) { const element = document.createElement(tag); if (text != null) element.textContent = String(text); return element; }
  function baselineFor(report) {
    const record = report.record;
    if (!record || !record.bankVersion || record.bankVersion === 'unknown' || record.bankVersion !== window.QUESTION_BANK_META?.version
        || !record.catalogVersion || record.catalogVersion === 'unknown' || record.catalogVersion !== window.UNIVERSITY_CATALOG?.version) throw new Error('题库或院校目录版本不符，请先复核更新报告，再授权编辑。');
    let raw = null;
    const store = window.ReportStore.create({ getItem: () => raw, setItem: (_, value) => { raw = value; } });
    // 带当前标记的记录按版本2接受，旧版记录回显时不带标记，仍是版本1。
    store.importBackup(JSON.stringify({ format: 'bic-report-library', version: record.assessmentProfile ? 2 : 1, exportedAt: new Date().toISOString(), records: [record] }));
    const restored = store.restore(record.id).state.report;
    const baseline = Object.fromEntries(Object.keys(labels).map(key => [key, window.reportEditing.getText(restored, key)]));
    if (Object.values(baseline).some(value => typeof value !== 'string' || !value.trim() || value.length > 4000)) throw new Error('四段建议基线须为1–4000字，请先复核报告。');
    return baseline;
  }
  function init(options) {
    let selected = null, preview = null, busy = false, grants = [], epoch = 0;
    const recipient = () => $('#editRecipient').value.toLowerCase();
    const ttl = () => Number($('#editTtl').value);
    function resetPreview() { preview = null; $('#editOwnerPreview').replaceChildren(); $('#editOwnerPreview').hidden = true; }
    function samePreview() { return preview && selected && preview.id === selected.id && preview.revision === selected.revision
      && preview.recipient === recipient() && preview.ttl === ttl() && preview.snapshot === JSON.stringify(selected.record); }
    function setBusy(value) {
      busy = value;
      for (const id of ['editRecipient', 'editTtl', 'editPreviewBtn', 'editListBtn', 'editAuditBtn']) $('#' + id).disabled = busy || !selected;
      $('#editCreateBtn').disabled = busy || !samePreview();
      for (const button of $('#editOwnerList').querySelectorAll('button')) button.disabled = busy || !selected;
    }
    function clear() { epoch++; selected = null; grants = []; resetPreview(); $('#editRecipient').value = ''; $('#editOwnerList').replaceChildren(); $('#editOwnerAudit').replaceChildren(); setBusy(busy); }
    function setReport(value) { clear(); selected = value; setBusy(busy); }
    function changed() { resetPreview(); setBusy(busy); }
    function drawList() {
      const root = $('#editOwnerList'); root.replaceChildren();
      if (!grants.length) root.append(node('p', '没有已保存的顾问建议编辑授权。'));
      for (const grant of grants) {
        const row = node('div'); row.className = 'owner-share-row';
        row.append(node('p', `${grant.recipient_username} · 建议编辑修订 ${grant.report_revision} · 有效至 ${new Date(grant.expires_at * 1000).toLocaleString('zh-CN')} · ${statusLabels[grant.status] || '已关闭'}`));
        if (grant.status !== 'revoked') {
          const button = node('button', '撤销建议编辑授权'); button.type = 'button'; button.className = 'btn ghost sm'; button.dataset.editRevoke = grant.id;
          button.onclick = () => {
            if (busy || !selected || !window.confirm(`撤销账号 ${grant.recipient_username} 对此报告的建议编辑授权？之后的读写将被拒绝，已经提交的建议和记录保留。只读与家长权限分别管理。`)) return;
            const report = selected, own = epoch;
            options.run('正在撤销建议编辑授权…', async current => {
              await options.client.revokeAdvisorEditAccess(report.id, grant.id);
              if (!current() || own !== epoch || selected !== report) return;
              grants = grants.map(value => value.id === grant.id ? { ...value, status: 'revoked', revoked_at: Math.floor(Date.now() / 1000) } : value);
              drawList(); options.message('建议编辑授权已撤销；已提交文字与服务端记录保留，其他权限未改变。');
            });
          };
          row.append(button);
        }
        root.append(row);
      }
      setBusy(busy);
    }
    $('#editRecipient').oninput = changed; $('#editTtl').onchange = changed;
    $('#editPreviewBtn').onclick = () => {
      if (busy || !selected) return;
      const report = selected, own = epoch, target = recipient(), hours = ttl();
      options.run('正在预览完整资料与建议编辑基线…', async current => {
        resetPreview();
        if (!/^[a-z0-9._@+-]{3,64}$/.test(target) || ![24, 72, 168].includes(hours)) throw new Error('请填写既有顾问账号和支持的期限。');
        const baseline = baselineFor(report);
        if (!current() || own !== epoch || selected !== report) return;
        preview = { id: report.id, revision: report.revision, recipient: target, ttl: hours, baseline, snapshot: JSON.stringify(report.record) };
        const panel = $('#editOwnerPreview');
        panel.append(node('h4', report.record.state.info.name + ' · 单次建议编辑授权'),
          node('p', `授权者 ${options.client.user?.username || '当前账号'}；接收顾问 ${target}；源修订 ${report.revision}；期限 ${hours} 小时。`),
          node('p', `报告 ${report.record.reportMeta.batchId}；题库 ${report.record.bankVersion}；院校目录 ${report.record.catalogVersion}。`),
          node('p', '接收账号可读取姓名、逐题答卷、版本、建议及修改历史，并对下列四段建议一次提交所选修改；不能改作答、成绩、身份或转授。实际写入后授权失效，须重新复核授权。基线由您确认，未称服务端认证规则。系统不创建账号或发送消息，已经读取的副本不能收回。'));
        for (const [key, text] of Object.entries(baseline)) { panel.append(node('h5', labels[key]), node('pre', text)); }
        panel.hidden = false; setBusy(busy); options.message('请核对接收账号、完整资料范围、四段基线和单次修订限制，再确认。');
      });
    };
    $('#editCreateBtn').onclick = () => {
      if (busy || !samePreview()) { if (preview) { resetPreview(); setBusy(busy); } return; }
      const report = selected, captured = preview, own = epoch;
      if (!window.confirm(`授权账号 ${captured.recipient} 在 ${captured.ttl} 小时内读取「${report.record.state.info.name}」的完整答卷与修改历史，并基于修订 ${captured.revision} 和已核对的四段基线，一次提交建议文字修改？提交后需重新授权，不改成绩或答卷，不会发送消息。`)) return;
      resetPreview(); setBusy(busy);
      options.run('正在创建独立的建议编辑授权…', async current => {
        const grant = await options.client.createAdvisorEditAccess(report.id, captured.revision, captured.recipient, captured.ttl, captured.baseline);
        if (window.BIC_TEST_HOOKS === 1) window.__editCreated = grant;
        if (!current() || own !== epoch || selected !== report) return;
        grants = [grant, ...grants.filter(value => value.id !== grant.id)]; drawList(); options.message('建议编辑授权已创建，没有发送消息；旧只读和家长权限未扩权。请自行告知顾问使用建议编辑入口。');
      });
    };
    $('#editListBtn').onclick = () => {
      if (busy || !selected) return;
      const report = selected, own = epoch;
      options.run('正在读取建议编辑授权历史…', async current => {
        const value = await options.client.listAdvisorEditAccess(report.id);
        if (!current() || own !== epoch || selected !== report) return;
        grants = value.items; drawList(); options.message('已读取建议编辑授权历史；只读授权另行管理。');
      });
    };
    $('#editAuditBtn').onclick = () => {
      if (busy || !selected) return;
      const report = selected, own = epoch;
      options.run('正在读取服务端顾问修改记录…', async current => {
        const value = await options.client.listAdvisorAudit(report.id);
        if (!current() || own !== epoch || selected !== report) return;
        const root = $('#editOwnerAudit'); root.replaceChildren();
        if (!value.items.length) root.append(node('p', '此报告没有服务端顾问修改记录。'));
        for (const audit of value.items) {
          const row = node('article'); row.append(node('h4', `学校账号 ${audit.actor_username} · 修订 ${audit.source_revision} → ${audit.result_revision}`), node('p', new Date(audit.created_at * 1000).toLocaleString('zh-CN')));
          for (const change of audit.changes) row.append(node('h5', labels[change.section] || '建议修改'), node('p', '修改前'), node('pre', change.before), node('p', '修改后'), node('pre', change.after));
          root.append(row);
        }
        options.message('已读取服务端记录。账号取自当次登录；便携备份中的actor字段不能单独作为防篡改凭证。');
      });
    };
    clear(); return { clear, setReport, setBusy };
  }
  window.AdvisorEditOwner = { init };
})();
