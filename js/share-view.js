/* Isolated read-only viewer: no assessment state, account Cookie, or browser storage. */
(function () {
  'use strict';
  const button = document.querySelector('#shareLoadBtn');
  const status = document.querySelector('#shareStatus');
  const content = document.querySelector('#shareContent');
  const match = /^#share=([A-Za-z0-9_-]{43})$/.exec(window.location.hash);
  const token = match && !window.location.search ? match[1] : null;
  const configuration = window.BIC_CLOUD_CONFIG || {};
  const config = { enabled: configuration.enabled === true, apiBase: configuration.apiBase };
  let controller = null;
  let expiryTimer = null;
  let epoch = 0;

  // Fragments are not sent in HTTP requests. Remove it from the visible history too.
  try { window.history.replaceState(null, '', window.location.pathname); } catch (_) { /* no token is copied elsewhere */ }

  class ViewerError extends Error {
    constructor(code) { super(code); this.code = code; }
  }
  function message(text, error = false) {
    status.textContent = text;
    status.classList.toggle('is-error', error);
  }
  function clear() {
    clearTimeout(expiryTimer);
    expiryTimer = null;
    content.hidden = true;
    content.replaceChildren();
  }
  function endpoint() {
    if (location.protocol === 'file:') throw new ViewerError('LOCAL');
    if (!token) throw new ViewerError('INVALID');
    if (!config.enabled) throw new ViewerError('DISABLED');
    const here = new URL(location.href);
    if (here.protocol !== 'https:' && !(here.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(here.hostname))) throw new ViewerError('CONFIG');
    if (typeof config.apiBase !== 'string' || !config.apiBase.trim()) throw new ViewerError('CONFIG');
    let base;
    try { base = new URL(config.apiBase, here); } catch (_) { throw new ViewerError('CONFIG'); }
    if (base.origin !== here.origin || base.username || base.password || base.search || base.hash) throw new ViewerError('CONFIG');
    if (!base.pathname.endsWith('/')) base.pathname += '/';
    if (typeof fetch !== 'function' || typeof AbortController !== 'function' || typeof TextDecoder !== 'function') throw new ViewerError('UNSUPPORTED');
    return base.href + 'public/share';
  }
  function errorText(error) {
    if (error?.code === 'LOCAL') return '直接打开文件时无法读取学校分享服务。请从学校提供的 HTTPS 分享链接访问；本机测评资料不会改变。';
    if (error?.code === 'INVALID') return '链接已失效或无法读取，请向报告所有者取得有效链接。';
    if (error?.code === 'DISABLED') return '本网站尚未开通分享服务，请联系报告所有者确认。';
    if (error?.code === 'CONFIG') return '分享服务地址配置不受支持，请联系学校维护者。';
    if (error?.code === 'UNSUPPORTED') return '当前浏览器不支持安全读取，请更新浏览器后重新打开原链接。';
    if (error?.code === 'PROTOCOL') return '分享报告的格式或大小不受支持，请联系报告所有者重新生成。';
    if (error?.code === 'TIMEOUT') return '读取超时，请检查网络后再次点击读取。';
    if (error?.code === 'BUSY') return '读取过于频繁，请稍后再次读取。';
    return '网络连接或分享服务暂时不可用，请稍后再次点击读取。';
  }
  function node(tag, text, className) {
    const item = document.createElement(tag);
    if (text != null) item.textContent = String(text);
    if (className) item.className = className;
    return item;
  }
  function time(value) {
    const date = new Date(value * 1000);
    if (!Number.isFinite(date.getTime())) throw new ViewerError('PROTOCOL');
    return date.toLocaleString('zh-CN');
  }
  function render(snapshot) {
    const report = snapshot.report;
    const result = snapshot.content;
    const shared = time(snapshot.shared_at);
    const expires = time(snapshot.expires_at);
    const cover = node('header', null, 'share-cover');
    const title = node('h2', report.name + ' 的报告摘要');
    title.id = 'shareHeading'; title.tabIndex = -1;
    const expiry = node('p', '有效期至 ' + expires);
    expiry.id = 'shareExpiry';
    const meta = node('dl'); meta.id = 'shareMeta';
    for (const [label, value] of [['报告编号', report.batchId], ['报告日期', report.date], ['年级 / 目标入学', (report.grade ? report.grade + ' 年级' : '未填写年级') + ' / ' + (report.year || '未填写')], ['快照创建', shared], ['版本 / 修订', `题库 ${report.bankVersion}；院校 ${report.catalogVersion || '未记录'}；修订 ${report.revision}`]]) meta.append(node('dt', label), node('dd', value));
    cover.append(title, node('span', result.status === 'complete' ? '测评已完成' : '探索草稿', 'share-state'), expiry, meta);
    const direction = node('section', null, 'share-direction');
    direction.append(node('h3', '探索方向与学习偏好'), node('p', '专业方向：' + result.direction), node('p', '学习偏好：' + result.personality));
    const subjectHeading = node('h3', '本次学术测评');
    const subjects = node('ul'); subjects.id = 'shareSubjects';
    for (const subject of result.subjects) {
      const item = node('li', null, 'share-subject');
      item.append(node('h3', subject.name), node('strong', subject.pct === null ? '待完成' : subject.pct + '%'), node('small', `已答 ${subject.answered}/${subject.total}`));
      subjects.append(item);
    }
    const sections = node('div'); sections.id = 'shareSections';
    for (const [key, label] of [['summary', '核心结论'], ['academic', '学习行动建议'], ['plan', '专业与职业建议'], ['personality', '学习策略建议']]) {
      const section = node('section', null, 'share-section');
      section.append(node('h3', label), node('p', result.sections[key]));
      sections.append(section);
    }
    content.append(cover, direction, subjectHeading, subjects, sections);
    content.hidden = false;
    title.focus();
  }

  async function readJson(response, signal) {
    if ((response.headers.get('Content-Type') || '').split(';', 1)[0].trim().toLowerCase() !== 'application/json') throw new ViewerError('PROTOCOL');
    const declared = response.headers.get('Content-Length');
    if (declared && /^\d+$/.test(declared)) {
      const digits = declared.replace(/^0+/, '') || '0';
      if (digits.length > 6 || Number(digits) > 100_000) throw new ViewerError('PROTOCOL');
    }
    if (!response.body || typeof response.body.getReader !== 'function') throw new ViewerError('UNSUPPORTED');
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let text = '', bytes = 0, complete = false;
    try {
      while (true) {
        const part = await reader.read();
        if (signal.aborted) throw new ViewerError('CANCELLED');
        if (part.done) {
          try { text += decoder.decode(); } catch (_) { throw new ViewerError('PROTOCOL'); }
          complete = true; break;
        }
        bytes += part.value.byteLength;
        if (bytes > 100_000) throw new ViewerError('PROTOCOL');
        try { text += decoder.decode(part.value, { stream: true }); } catch (_) { throw new ViewerError('PROTOCOL'); }
        if (text.length > 30_000) throw new ViewerError('PROTOCOL');
      }
      if (text.length > 30_000) throw new ViewerError('PROTOCOL');
      try { return JSON.parse(text); } catch (_) { throw new ViewerError('PROTOCOL'); }
    } finally {
      if (!complete) { try { const pending = reader.cancel(); pending?.catch(() => {}); } catch (_) {} }
      reader.releaseLock();
    }
  }

  async function load() {
    if (controller) return;
    const own = ++epoch;
    clear();
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    message('正在读取只读摘要…');
    const request = new AbortController();
    controller = request;
    let timedOut = false;
    let onAbort;
    const aborted = new Promise((_, reject) => {
      onAbort = () => reject(new ViewerError(timedOut ? 'TIMEOUT' : 'CANCELLED'));
      request.signal.addEventListener('abort', onAbort, { once: true });
    });
    const timeout = setTimeout(() => { timedOut = true; request.abort(); }, 15_000);
    try {
      const response = await Promise.race([fetch(endpoint(), { method: 'GET', headers: { Accept: 'application/json', 'X-BIC-Share': token }, credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer', signal: request.signal }), aborted]);
      if (own !== epoch || request.signal.aborted) return;
      if (response.status === 404) throw new ViewerError('INVALID');
      if (response.status === 429) throw new ViewerError('BUSY');
      if (!response.ok) throw new ViewerError('NETWORK');
      const raw = await Promise.race([readJson(response, request.signal), aborted]);
      if (own !== epoch || request.signal.aborted) return;
      let snapshot;
      try { snapshot = window.ParentSummary.validate(raw); } catch (_) { throw new ViewerError('PROTOCOL'); }
      if (snapshot.expires_at <= Date.now() / 1000) throw new ViewerError('INVALID');
      render(snapshot);
      message('已读取只读摘要。重新读取会再次核对链接是否有效。');
      button.textContent = '重新读取分享报告';
      expiryTimer = setTimeout(() => { if (epoch === own) { clear(); message(errorText(new ViewerError('INVALID')), true); } }, Math.min(2_147_483_647, Math.max(0, snapshot.expires_at * 1000 - Date.now())));
    } catch (error) {
      if (own !== epoch) return;
      request.abort();
      clear();
      message(errorText(timedOut ? new ViewerError('TIMEOUT') : error), true);
    } finally {
      clearTimeout(timeout);
      request.signal.removeEventListener('abort', onAbort);
      if (own === epoch) { controller = null; button.disabled = false; button.removeAttribute('aria-busy'); }
    }
  }
  button.onclick = load;
  window.addEventListener('pagehide', () => {
    epoch++;
    controller?.abort(); controller = null;
    clear();
    button.removeAttribute('aria-busy');
    try { endpoint(); button.disabled = false; } catch (_) { button.disabled = true; }
    message('已清空页面摘要。返回后请重新读取，刷新页面请重新打开原链接。');
  });
  try { endpoint(); button.disabled = false; message('点击读取，查看报告所有者分享的摘要。'); }
  catch (error) { button.disabled = true; message(errorText(error), true); }
})();
