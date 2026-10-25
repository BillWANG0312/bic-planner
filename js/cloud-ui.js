/* 只有用户连接并确认后才使用账号服务；本机库不会自动上传。 */
(function () {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const clone = value => JSON.parse(JSON.stringify(value));
  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text != null) element.textContent = String(text);
    return element;
  }

  function init(options) {
    const client = options.client;
    const screen = $('#screen-cloud');
    let records = [];
    let selected = null;
    let originButton = null;
    let busy = false;
    let epoch = 0;
    let shareOwner = null;
    let commentOwner = null;
    let adviceDraft = null;
    let teacherOwner = null;
    let advisorEditOwner = null;
    const localOnly = window.location.protocol === 'file:';

    function active() { return options.isActive ? options.isActive() : screen.classList.contains('active'); }
    function message(text, error = false) {
      $('#cloudStatus').textContent = text;
      $('#cloudStatus').classList.toggle('is-error', error);
    }
    function fail(text) { throw new Error(text); }
    function localStore() { return window.ReportStore.create(window.localStorage); }
    function validRecord(record) {
      window.AssessmentProfiles?.requireLegacyRecord(record);
      let raw = null;
      const store = window.ReportStore.create({ getItem: () => raw, setItem: (_, value) => { raw = value; } });
      const backup = { format: 'bic-report-library', version: 1, exportedAt: new Date().toISOString(), records: [record] };
      store.importBackup(JSON.stringify(backup));
      return store.restore(record.id);
    }
    function validFull(value, expectedId) {
      if (!value || typeof value.id !== 'string' || !value.id || value.id.length > 100
          || expectedId && value.id !== expectedId || !Number.isSafeInteger(value.revision) || value.revision < 1) {
        fail('服务端报告格式不受支持，未打开或替换当前作答。');
      }
      const restored = validRecord(value.record);
      return { ...clone(value), record: restored.record, restored };
    }
    function sourceRecord() {
      const source = $('#cloudUploadSource').value;
      if (source === 'current') return validRecord(options.getCurrentRecord()).record;
      if (source.startsWith('local:')) {
        const record = localStore().list().find(record => record.id === source.slice(6));
        if (!record) fail('所选本机归档已不存在，请重新选择。');
        return record;
      }
      fail('请先生成当前报告，或选择一份本机归档。');
    }
    function sourceAvailability() {
      let record, profileProblem;
      try { record = sourceRecord(); }
      catch (error) { if (error?.code === 'PROFILE') profileProblem = '新版游戏或特质报告暂不支持云端保存。请保留本机JSON备份；旧版报告仍可使用。'; }
      $('#cloudUploadBtn').disabled = busy || !client.user || !record;
      $('#cloudUpdateBtn').disabled = busy || !client.user || !selected || !record
        || selected.record.reportMeta.batchId !== record.reportMeta.batchId;
      $('#cloudSourceNote').textContent = record
        ? `${record.state.info.name} · ${record.reportMeta.batchId}。仅此份资料会在确认后上传。`
        : profileProblem || '没有可用的报告，请先生成报告或检查本机归档。';
      $('#cloudUpdateNote').textContent = selected
        ? record && record.reportMeta.batchId === selected.record.reportMeta.batchId
          ? `更新使用已读取的修订 ${selected.revision}；若服务端已变化，会停止并要求重新读取。`
          : '所选本机资料与服务端报告编号不同，不能直接更新。请选择同编号资料，或上传为新报告。'
        : '';
    }
    function sources() {
      const select = $('#cloudUploadSource');
      const previous = select.value;
      select.replaceChildren();
      let current;
      try { current = options.getCurrentRecord(); } catch (_) { /* 尚无当前报告。 */ }
      const currentOption = node('option', '', current
        ? `当前报告：${current.state.info.name} · ${current.reportMeta.batchId}` : '当前报告（请先生成）');
      currentOption.value = 'current';
      currentOption.disabled = !current;
      select.append(currentOption);
      try {
        for (const record of localStore().list()) {
          const option = node('option', '', `本机归档：${record.state.info.name} · ${record.reportMeta.batchId}`);
          option.value = 'local:' + record.id;
          select.append(option);
        }
      } catch (_) { /* 损坏库由本机报告库提供原始备份恢复；不读取伪造的空数据。 */ }
      const available = Array.from(select.options).filter(option => !option.disabled);
      select.value = available.some(option => option.value === previous) ? previous : available[0]?.value || '';
      sourceAvailability();
    }
    function clearDetail() {
      shareOwner?.clear();
      commentOwner?.clear();
      adviceDraft?.clear();
      teacherOwner?.clear();
      advisorEditOwner?.clear();
      selected = null;
      $('#cloudDetail').hidden = true;
      $('#cloudDetailSummary').replaceChildren();
      $('#cloudVersionNote').textContent = '';
      $('#cloudUpdateNote').textContent = '';
    }
    function clearPrivate() {
      records = [];
      clearDetail();
      $('#cloudList').replaceChildren();
      $('#cloudCount').textContent = '';
      $('#cloudAccount').textContent = '';
      $('#cloudUploadSource').replaceChildren();
      $('#cloudSourceNote').textContent = '';
    }
    function controls() {
      const user = client.user;
      $('#cloudConnection').hidden = !!client.connected;
      $('#cloudLoginForm').hidden = !client.connected || !!user;
      $('#cloudWorkspace').hidden = !user;
      $('#cloudConnectBtn').disabled = busy || localOnly;
      $('#cloudLoginForm button[type=submit]').disabled = busy;
      $('#cloudUsername').disabled = busy;
      $('#cloudPassword').disabled = busy;
      $('#cloudRefreshBtn').disabled = busy;
      $('#cloudLogoutBtn').disabled = busy;
      $('#cloudUploadSource').disabled = busy;
      $('#cloudOpenBtn').disabled = busy || !selected;
      for (const button of screen.querySelectorAll('[data-cloud-read], [data-cloud-delete]')) button.disabled = busy;
      if (user) {
        $('#cloudAccount').textContent = `当前账号：${user.username}（${user.role === 'advisor' ? '顾问' : '学生'}，此处管理自己账号中的报告）`;
        sourceAvailability();
      } else {
        clearPrivate();
        $('#cloudUploadBtn').disabled = true;
        $('#cloudUpdateBtn').disabled = true;
      }
      shareOwner?.setBusy(busy);
      commentOwner?.setBusy(busy);
      adviceDraft?.setBusy(busy);
      teacherOwner?.setBusy(busy);
      advisorEditOwner?.setBusy(busy);
    }
    function handleError(error) {
      if (!client.user || error?.status === 401 || error?.status === 403) clearPrivate();
      if (error?.code === 'CANCELLED') return;
      message(typeof error?.message === 'string' ? error.message : '操作未完成，请检查连接后重试。', true);
    }
    async function run(label, operation) {
      if (busy) return;
      const token = ++epoch;
      const owner = client.user?.id;
      const live = () => token === epoch && active();
      const current = () => live() && (!owner || client.user?.id === owner);
      busy = true;
      message(label);
      controls();
      try { await operation(current, live); }
      catch (error) { if (token === epoch && active()) handleError(error); }
      finally {
        if (token === epoch) { busy = false; controls(); }
      }
    }
    function metadata(value) {
      return { id: value.id, revision: value.revision, created_at: value.created_at, updated_at: value.updated_at,
        name: value.record.state.info.name, grade: value.record.state.info.grade, year: value.record.state.info.year,
        archive_id: value.record.id, report_ref: value.record.reportMeta.batchId };
    }
    function drawList() {
      const list = $('#cloudList');
      list.replaceChildren();
      $('#cloudCount').textContent = `共 ${records.length} 份`;
      if (!records.length) list.append(node('p', 'cloud-empty', '此账号还没有报告。可在上方选择一份本机报告，确认后上传。'));
      for (const record of records) {
        const article = node('article', 'cloud-record');
        article.append(node('h4', '', record.name), node('p', '', record.report_ref),
          node('p', '', `年级 ${record.grade || '未填写'} · 目标入学 ${record.year || '未填写'} · 修订 ${record.revision}`));
        const actions = node('div', 'cloud-actions');
        const read = node('button', 'btn ghost sm', '读取详情');
        read.type = 'button'; read.dataset.cloudRead = record.id;
        read.setAttribute('aria-label', '读取 ' + record.name + ' 的服务端报告详情');
        read.onclick = () => readDetail(record.id);
        const remove = node('button', 'btn ghost sm', '删除服务端报告');
        remove.type = 'button'; remove.dataset.cloudDelete = record.id;
        remove.setAttribute('aria-label', '删除 ' + record.name + ' 的服务端报告');
        remove.onclick = () => deleteReport(record);
        actions.append(read, remove); article.append(actions); list.append(article);
      }
      controls();
    }
    function drawDetail() {
      const item = selected;
      if (!item) return clearDetail();
      shareOwner?.setReport(item);
      commentOwner?.setReport(item);
      adviceDraft?.setReport(item);
      teacherOwner?.setReport(item);
      advisorEditOwner?.setReport(item);
      $('#cloudDetailSummary').replaceChildren(
        node('p', '', `${item.record.state.info.name} · ${item.record.reportMeta.batchId}`),
        node('p', '', `报告日期 ${item.record.reportMeta.date} · 已读取修订 ${item.revision}`),
        node('p', '', '读取详情不会替换当前作答。打开后会按当前题库和院校资料重新生成，原 PDF 需另外保存。'));
      $('#cloudVersionNote').textContent = item.restored.versionChanged
        ? '这份归档的题库或院校目录版本与当前不同，打开将重新生成，请复核并保留原 PDF。' : '';
      $('#cloudDetail').hidden = false;
      sourceAvailability();
    }
    async function refreshList(current) {
      const result = await client.list();
      if (!current()) return;
      if (!Array.isArray(result?.items)) fail('服务端名单格式不受支持，请检查服务版本。');
      records = clone(result.items);
      clearDetail();
      drawList();
    }
    function readDetail(id) {
      return run('正在读取报告详情…', async current => {
        clearDetail();
        const value = validFull(await client.get(id), id);
        if (!current()) return;
        selected = value;
        drawDetail();
        message('已读取服务端报告。可核对后打开，或用同编号本机资料更新。');
        $('#cloudDetailHeading').focus();
      });
    }
    function deleteReport(record) {
      if (busy || !window.confirm(`删除服务端的「${record.name}」报告 ${record.report_ref}（修订 ${record.revision}）吗？相关分享、批注邀请和顾问只读/编辑授权将失效，关联批注及服务端编辑记录也会删除；本机归档和当前作答会保留。`)) return;
      return run('正在删除服务端报告…', async current => {
        await client.remove(record.id, record.revision);
        if (!current()) return;
        records = records.filter(item => item.id !== record.id);
        if (selected?.id === record.id) clearDetail();
        drawList();
        message('已删除此服务端报告，本机资料未改变。');
      });
    }
    function onScreenLeft() {
      const interrupted = busy;
      epoch++;
      busy = false;
      $('#cloudPassword').value = '';
      clearPrivate();
      if (interrupted) client.disconnect();
      controls();
    }
    function showCloud(button) {
      originButton = button;
      options.showCloud();
      $('#cloudPassword').value = '';
      controls();
      if (client.user) sources();
      message(localOnly ? '直接打开的本机模式不连接账号服务。请继续使用本机报告库；学校开通服务后通过学校网址访问。'
        : client.user ? '会话仍在本页内存中。点击「刷新名单」读取账号中的报告。'
          : client.connected ? '已连接本校服务，请登录。' : '尚未连接。只有点击连接后才会访问本校服务。');
      $('#cloudHeading').focus();
    }

    $('#cloudBtn').onclick = () => showCloud($('#cloudBtn'));
    $('#openCloudBtn').onclick = () => showCloud($('#openCloudBtn'));
    $('#cloudBackBtn').onclick = () => {
      onScreenLeft();
      options.closeCloud();
      originButton?.focus();
    };
    $('#cloudConnectBtn').onclick = () => run('正在连接本校报告服务…', async current => {
      await client.connect();
      if (!current()) return;
      controls();
      if (client.user) { sources(); await refreshList(current); if (current()) message('已恢复账号会话，未自动上传本机资料。'); }
      else { message('已连接，请登录本校账号。'); $('#cloudUsername').focus(); }
    });
    $('#cloudLoginForm').onsubmit = event => {
      event.preventDefault();
      const username = $('#cloudUsername').value;
      const password = $('#cloudPassword').value;
      $('#cloudPassword').value = '';
      if (busy) return;
      clearPrivate();
      return run('正在登录…', async current => {
        await client.login(username, password);
        if (!current()) return;
        sources();
        controls();
        await refreshList(current);
        if (current()) message('已登录。请逐份选择需要上传的报告；本机资料未自动上传。');
      });
    };
    $('#cloudRefreshBtn').onclick = () => run('正在刷新账号报告名单…', async current => {
      sources();
      await refreshList(current);
      if (current()) message('名单已刷新。需要更新报告时，请重新读取详情。');
    });
    $('#cloudUploadSource').onchange = sourceAvailability;
    $('#cloudUploadBtn').onclick = () => {
      if (busy) return;
      let record;
      try { record = clone(sourceRecord()); } catch (error) { handleError(error); return; }
      if (!window.confirm(`将「${record.state.info.name}」报告 ${record.reportMeta.batchId} 上传到账号 ${client.user?.username} 吗？资料包含姓名、作答及顾问修改。仅上传这一份，不会自动替换已有同编号报告。`)) return;
      return run('正在上传所选报告…', async current => {
        const result = validFull(await client.create(record));
        if (!current()) return;
        records = [...records.filter(item => item.id !== result.id), metadata(result)];
        drawList();
        message('所选报告已上传。本机归档和当前作答未改变。');
      });
    };
    $('#cloudOpenBtn').onclick = () => {
      if (busy || !selected || !active()) return;
      const detail = selected;
      return run('正在确认账号会话与报告修订…', async current => {
        const latest = validFull(await client.get(detail.id), detail.id);
        if (!current()) return;
        if (latest.revision !== detail.revision) fail('服务端报告已变化，请重新读取详情并核对后打开；当前作答未替换。');
        const versionNote = detail.restored.versionChanged ? '题库或目录版本已变化，将按当前版本重新生成，请复核并保留原 PDF。' : '';
        const overwrite = options.hasProgress() ? '这会替换当前作答与报告，请先归档当前资料或导出 PDF。' : '';
        if (!window.confirm(`打开「${detail.record.state.info.name}」报告 ${detail.record.reportMeta.batchId} 到本机？${overwrite}${versionNote}`)) {
          message('已取消打开，当前作答未改变。');
          return;
        }
        if (!current()) return;
        // 验证请求已结束；成功打开后的正常导航不应被当作网络中断。
        busy = false;
        options.openState(clone(detail.restored.state));
      });
    };
    $('#cloudUpdateBtn').onclick = () => {
      if (busy || !selected) return;
      let record;
      try { record = clone(sourceRecord()); } catch (error) { handleError(error); return; }
      const detail = selected;
      if (record.reportMeta.batchId !== detail.record.reportMeta.batchId) { message('报告编号不同，不能更新这份服务端报告。', true); sourceAvailability(); return; }
      if (!window.confirm(`用此设备的「${record.state.info.name}」报告 ${record.reportMeta.batchId} 更新服务端已读取的修订 ${detail.revision} 吗？姓名、作答和顾问修改会以所选本机资料为准。若服务端已变化将停止，不自动覆盖。`)) return;
      return run('正在更新服务端报告…', async current => {
        const result = validFull(await client.update(detail.id, detail.revision, record), detail.id);
        if (!current()) return;
        selected = result;
        records = records.map(item => item.id === result.id ? metadata(result) : item);
        drawList(); drawDetail();
        message(`服务端报告已更新至修订 ${result.revision}。本机资料未改变。`);
      });
    };
    $('#cloudLogoutBtn').onclick = () => run('正在退出账号…', async (current, live) => {
      clearPrivate();
      $('#cloudWorkspace').hidden = true;
      try {
        await client.logout();
        if (live()) message('已退出账号，服务端会话已撤销。本机资料保留。');
      } catch (_) {
        if (live()) message('本页面已断开，服务器注销未确认。请重新连接后退出账号，或联系学校维护者；共用设备请关闭浏览器。', true);
      } finally {
        if (live()) { client.disconnect(); clearPrivate(); }
      }
    });
    shareOwner = window.ParentShareOwner?.init({ client, run, message });
    commentOwner = window.CommentOwner?.init({ client, run, message });
    teacherOwner = window.TeacherOwner?.init({ client, run, message });
    advisorEditOwner = window.AdvisorEditOwner?.init({ client, run, message });
    adviceDraft = window.AdviceDraft?.init({ client, run, message,
      onSaved(result) {
        if (!selected) throw new Error('当前报告已切换，请重新读取服务端记录。');
        selected = validFull(result, selected.id);
        records = records.map(item => item.id === selected.id ? metadata(selected) : item);
        drawList(); drawDetail();
      }
    });
    controls();
    return {
      onScreenLeft,
      onReportRendered() { if (active() && client.user) sources(); }
    };
  }
  window.CloudReportUI = { init };
})();
