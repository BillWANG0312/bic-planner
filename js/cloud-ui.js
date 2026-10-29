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
    function stateProfileFor() {
      try { return options.getState?.()?.report?.meta?.assessmentProfile; } catch (_) { return null; }
    }
    function readOnlyCurrent() {
      if (typeof options.readOnlyRecord !== 'function') return null;
      try { return options.readOnlyRecord(stateProfileFor()) || null; } catch (_) { return null; }
    }
    // 只校验、不替代：报告库的 restore 会重新生成报告，用户点「打开」之前当前作答不能改变。
    function validRecord(record) {
      // 服务读取不回显版本函数时按当前版本容器保存，空作答记录由此也能通过格式核对。
      const api = window.AssessmentProfiles
        ? { ...window.AssessmentProfiles, recordProfile: value => window.AssessmentProfiles.recordProfile(value) }
        : { CURRENT: null, recordProfile: () => null };
      const profile = api.recordProfile(record);
      let raw = null;
      const store = window.ReportStore.create({ getItem: () => raw, setItem: (_, value) => { raw = value; } });
      const backup = { format: 'bic-report-library', version: profile === api.CURRENT ? 2 : 1, exportedAt: new Date().toISOString(), records: [clone(record)] };
      store.importBackup(JSON.stringify(backup));
      if (!store.list().some(item => item.id === record.id)) fail('这份报告不符合账号服务支持的报告格式，未上传或打开。');
      return record;
    }
    function validFull(value, expectedId) {
      if (!value || typeof value.id !== 'string' || !value.id || value.id.length > 100
          || expectedId && value.id !== expectedId || !Number.isSafeInteger(value.revision) || value.revision < 1) {
        fail('服务端报告格式不受支持，未打开或替换当前作答。');
      }
      const record = validRecord(value.record);
      return { ...clone(value), record, restored: versionState(record) };
    }
    // 只读地判断归档的题库或院校目录是否与当前不同；不生成报告、不改动当前作答。
    function versionState(record) {
      const bank = window.QUESTION_BANK_META?.version || 'unknown';
      const catalog = window.UNIVERSITY_CATALOG?.version || 'unknown';
      const versionChanged = !record.bankVersion || !record.catalogVersion
        || record.bankVersion === 'unknown' || record.catalogVersion === 'unknown'
        || record.bankVersion !== bank || record.catalogVersion !== catalog;
      return { versionChanged, record };
    }
    function sourceRecord() {
      const source = $('#cloudUploadSource').value;
      if (source === 'current') {
        let record = null;
        try { record = options.getCurrentRecord(); } catch (_) { /* 由只读归档或下方提示说明。 */ }
        record ||= readOnlyCurrent();
        if (!record) fail('请先生成当前报告，或选择一份本机归档。');
        return validRecord(record);
      }
      if (source.startsWith('local:')) {
        const record = localStore().list().find(item => item.id === source.slice(6));
        if (!record) fail('所选本机归档已不存在，请重新选择。');
        return record;
      }
      fail('请先生成当前报告，或选择一份本机归档。');
    }
    function sourceAvailability() {
      let record;
      try { record = sourceRecord(); } catch (_) { /* 不可用原因由下方提示说明。 */ }
      // 上传由操作入口的 busy 守卫；按钮保持可用，避免会话确认进行中时误以为没有可上传资料。
      $('#cloudUploadBtn').disabled = !client.user || !record;
      $('#cloudUpdateBtn').disabled = !client.user || !selected || !record
        || selected.record.reportMeta.batchId !== record.reportMeta.batchId;
      $('#cloudSourceNote').textContent = record
        ? `${record.state.info.name} · ${record.reportMeta.batchId}。仅此份资料会在确认后上传。`
        : '没有可用的报告，请先生成报告或检查本机归档。';
      $('#cloudUpdateNote').textContent = selected
        ? record && record.reportMeta.batchId === selected.record.reportMeta.batchId
          ? `更新使用已读取的修订 ${selected.revision}；若服务端已变化，会停止并要求重新读取。`
          : '当前报告与所选服务端报告编号不同，不能直接更新；请先把当前报告作为新报告上传。'
        : '';
    }
    function sources() {
      const select = $('#cloudUploadSource');
      const previous = select.value;
      select.replaceChildren();
      let current;
      try { current = options.getCurrentRecord(); } catch (_) { /* 尚无当前报告。 */ }
      // 只读打开的归档不写入本机进度：本机没有续答进度时，用这份归档作为可上传的当前报告。
      current ||= readOnlyCurrent();
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
      if (previous && available.some(option => option.value === previous)) select.value = previous;
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
      // 登录框在输入账号密码后直接提交，提交时才连接账号服务；单独「连接」按钮始终隐藏。
      $('#cloudConnection').hidden = true;
      $('#cloudLoginForm').hidden = !!user;
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
      // 认证失效后名单与详情都不可信：清空后需要重新登录并刷新，不能停留在旧数据上。
      if (!client.user) { records = []; drawList(); }
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
      catch (error) { if (token === epoch) handleError(error); }
      finally {
        // 成功打开报告的流程会先释放 busy 再交给应用切换作答，无需也不能在导航后改回状态。
        if (token === epoch && busy) {
          busy = false;
          // 任何操作结束都恢复接口状态：静默的会话确认也不能让界面停在操作中的禁用状态。
          controls();
        }
      }
    }
    function metadata(value) {
      return { id: value.id, revision: value.revision, archive_id: value.record.id, report_ref: value.record.reportMeta.batchId,
        name: value.record.state.info.name, grade: value.record.state.info.grade, year: value.record.state.info.year,
        created_at: value.created_at, updated_at: value.updated_at };
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
        remove.onclick = () => removeReport(record);
        read.disabled = busy; remove.disabled = busy;
        actions.append(read, remove);
        article.append(actions);
        list.append(article);
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
      if (busy || !active()) return;
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
    function removeReport(record) {
      if (busy || !active()) return;
      if (!window.confirm(`删除服务端的「${record.name}」报告 ${record.report_ref}（修订 ${record.revision}）吗？相关分享、批注邀请和顾问只读/编辑授权将失效，关联批注及服务端编辑记录也会删除；本机归档和当前作答会保留。`)) return;
      return run('正在删除服务端报告…', async current => {
        await client.remove(record.id, record.revision);
        if (!current()) return;
        records = records.filter(item => item.id !== record.id);
        if (selected?.id === record.id) clearDetail();
        drawList();
        message('已删除此服务端报告，本机资料未改变。');
      });
    }
    // keepStatus：应用打开账号记录后离开面板。此时作答正按打开的记录切换，不能重建上传来源或恢复面板状态。
    function onScreenLeft({ keepStatus = false } = {}) {
      epoch++;
      busy = false;
      $('#cloudPassword').value = '';
      clearPrivate();
      // 离开面板即回收本页内存中的登录信息（服务端会话保留）；再次进入需重新登录，工作区不残留上一份名单。
      client.disconnect();
      if (keepStatus) return;
      controls();
      // 离开面板后当前作答可能已被替换（例如打开归档或重新测试），下次进入按最新的本机资料重建上传来源。
      if (client.user) sources();
    }
    function showCloud(button) {
      originButton = button;
      options.showCloud();
      $('#cloudPassword').value = '';
      controls();
      // 已登录时立即按最近的作答重建上传来源；会话确认不会改变这份本机资料。
      if (client.user) sources();
      // 打开面板不访问账号服务；先用本页内存里的会话更新状态，没有则等用户登录时再连接。
      // 只读会话：不自动登录、不读取名单、不上传任何本机资料。
      if (client.user) message('会话仍在本页内存中。点击「刷新名单」读取账号中的报告。');
      else message(localOnly ? '直接打开的本机模式不连接账号服务。请继续使用本机报告库；学校开通服务后通过学校网址访问。'
        : '尚未连接。登录本校账号时才会访问账号服务。');
      $('#cloudHeading').focus();
    }

    $('#cloudBtn').onclick = event => showCloud(event.currentTarget);
    $('#openCloudBtn').onclick = event => showCloud(event.currentTarget);
    $('#cloudBackBtn').onclick = () => {
      onScreenLeft();
      options.closeCloud();
      (originButton || $('#cloudBtn')).focus();
    };
    $('#cloudLoginForm').onsubmit = event => {
      event.preventDefault();
      const username = $('#cloudUsername').value;
      const password = $('#cloudPassword').value;
      $('#cloudPassword').value = '';
      if (busy) return;
      clearPrivate();
      return run('正在登录…', async current => {
        // 登录前先连接账号服务；连接失败时保留登录框，由状态提示改用本机报告库。
        if (!client.connected) {
          await client.connect();
          if (!current()) return;
        }
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
        // 读取到的记录不可用会让详情关闭，此处提示失败原因而不是让用户以为详情已丢失。
        if (selected !== detail) { message('读取到的报告不符合账号服务支持的报告格式，未替换当前作答。', true); return; }
        if (latest.revision !== detail.revision) fail('服务端报告已变化，请重新读取详情并核对后打开；当前作答未替换。');
        const versionNote = detail.restored.versionChanged ? '题库或目录版本已变化，将按当前版本重新生成，请复核并保留原 PDF。' : '';
        // 屏幕上已是同一份报告（例如只读打开的同一归档）时，打开不会再替换作答。
        const shown = typeof options.getReport === 'function' ? options.getReport() : null;
        const same = shown?.meta?.batchId === detail.record.reportMeta.batchId && !options.hasProgress();
        const overwrite = same ? '' : options.hasProgress() ? '这会替换当前作答与报告，请先归档当前资料或导出 PDF。' : '';
        if (!window.confirm(`打开「${detail.record.state.info.name}」报告 ${detail.record.reportMeta.batchId} 到本机？${overwrite}${versionNote}`)) {
          message('已取消打开，当前作答未改变。');
          return;
        }
        if (!current()) return;
        // 账号报告不要求先存进本机报告库：本机归档里有同一份就直接取回，否则直接打开本次读取并校验过的记录。
        // 报告由应用按当前题库和目录重新生成，与「本机报告库」打开归档的行为一致。
        const local = localStore().list().find(item => item.id === detail.record.id);
        // 打开服务端记录：取其资料状态，界面状态由应用补上；本机库有同一份归档时按归档重新生成报告，
        // 没有时按本次读取的记录生成，顾问修改留在记录外层，由报告携带。
        const opened = local ? localStore().restore(local.id).state : { ...clone(detail.record.state),
          reportMeta: clone(detail.record.reportMeta),
          ...(detail.record.advisor ? { advisor: clone(detail.record.advisor) } : {}) };
        // 应用切换作答时会离开账号面板；先交给应用，再释放占用，避免把这次正常打开当作覆盖已打开的状态。
        try { options.openState(opened); }
        catch (error) { handleError(error); return; }
        // 已交给应用切换作答：不恢复面板状态、不重建上传来源，避免覆盖打开后应用写入的作答。
        busy = false;
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
