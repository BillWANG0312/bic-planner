/* 可选同源报告服务：显式连接，口令和 CSRF 仅在请求及内存中使用。 */
(function () {
  'use strict';

  const MAX_RESPONSE_CHARS = 2_100_000;
  const MAX_RESPONSE_BYTES = 6_300_000;
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const copy = value => JSON.parse(JSON.stringify(value));
  const identifier = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
  const revisionNumber = value => Number.isSafeInteger(value) && value > 0;

  class CloudError extends Error {
    constructor(code, message, status = 0) {
      super(message);
      this.name = 'CloudError';
      this.code = code;
      this.status = status;
    }
  }
  const protocolError = () => new CloudError('PROTOCOL', '服务返回的资料格式或大小不受支持，请联系学校维护者；本机资料未改变。');
  const cancelled = () => new CloudError('CANCELLED', '本次连接已取消。');

  function httpError(status, data) {
    if (status === 401) return new CloudError('AUTH', '账号或密码不正确，或登录已过期。请重新登录。', status);
    if (status === 403) return new CloudError('CSRF', '会话校验未通过，请重新连接并登录后再操作。', status);
    if (status === 404) return new CloudError('NOT_FOUND', '服务或报告不存在，或当前账号无权读取。请刷新名单核对。', status);
    if (status === 409) {
      const code = ['REVISION', 'DUPLICATE'].includes(data?.code) ? data.code : 'CONFLICT';
      return new CloudError(code, code === 'DUPLICATE'
        ? '此报告编号已存在。请刷新名单并读取已有报告，未自动替换。'
        : '服务端资料已变化或编号发生冲突。请刷新名单并重新读取，未自动覆盖。', status);
    }
    if (status === 413) return new CloudError('LIMIT', '报告资料或账号归档已超出服务上限，请保留本机备份并检查服务端空间。', status);
    if (status === 422) return new CloudError('VALIDATION', '账号参数或报告格式不符合服务要求，本次未保存。请核对后重试。', status);
    if (status === 429) return new CloudError('RATE_LIMIT', '尝试次数过多或服务繁忙，请稍后再试。', status);
    return new CloudError('HTTP', '报告服务暂时不可用，请保留本机资料并稍后重新连接。', status);
  }

  function create(options = {}) {
    const config = object(options.config) ? { enabled: options.config.enabled === true, apiBase: options.config.apiBase ?? './api/' }
      : { enabled: false, apiBase: './api/' };
    const location = options.location || window.location;
    const fetcher = options.fetch || (typeof window.fetch === 'function' ? window.fetch.bind(window) : null);
    const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0 && options.timeoutMs <= 120_000
      ? options.timeoutMs : 15_000;
    const pending = new Set();
    let generation = 0;
    let connected = false;
    let user = null;
    let csrf = null;
    let expiresAt = null;

    function forgetIdentity() { user = null; csrf = null; expiresAt = null; }
    function cancelPending() {
      generation++;
      for (const request of pending) { request.reason = 'CANCELLED'; request.controller.abort(); }
      pending.clear();
    }
    function disconnect() { cancelPending(); connected = false; forgetIdentity(); }

    function apiBase() {
      let here;
      try { here = new URL(typeof location === 'string' ? location : location.href); }
      catch (_) { throw new CloudError('CONFIG', '当前网址无法连接报告服务，请使用学校提供的 HTTPS 网址。'); }
      if (here.protocol === 'file:') throw new CloudError('LOCAL_ONLY', '直接打开文件时使用本机模式；账号报告需要从学校提供的 HTTPS 网站连接。');
      if (!config.enabled) throw new CloudError('DISABLED', '本网站尚未开通账号报告服务，请继续使用本机报告库。');
      if (here.protocol !== 'https:' && !(here.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(here.hostname))) {
        throw new CloudError('CONFIG', '账号报告需要 HTTPS；本地开发仅允许回环地址。');
      }
      let base;
      try { if (typeof config.apiBase !== 'string' || !config.apiBase.trim()) throw new Error(); base = new URL(config.apiBase, here); }
      catch (_) { throw new CloudError('CONFIG', '报告服务地址配置无效，请联系学校维护者。'); }
      if (base.origin !== here.origin || base.username || base.password || base.search || base.hash) {
        throw new CloudError('CONFIG', '报告服务必须使用此网站的同源地址，不能包含凭据、查询参数或片段。');
      }
      if (!base.pathname.endsWith('/')) base.pathname += '/';
      if (typeof fetcher !== 'function' || typeof AbortController !== 'function' || typeof TextDecoder !== 'function') {
        throw new CloudError('CONFIG', '当前浏览器不支持报告服务连接，请更新浏览器后重试。');
      }
      return base;
    }

    function requireConnection(authenticated = false) {
      apiBase();
      if (!connected) throw new CloudError('DISCONNECTED', '请先主动连接学校报告服务。');
      if (authenticated && (!user || !csrf)) throw new CloudError('AUTH', '请先登录后再查看或保存服务端报告。', 401);
    }

    function publicSession() { return user ? { user: copy(user), expires_at: expiresAt } : null; }
    function adoptSession(value) {
      if (!object(value) || !object(value.user) || !identifier(value.user.id)
          || typeof value.user.username !== 'string' || !/^[A-Za-z0-9._@+-]{3,64}$/.test(value.user.username)
          || !['student', 'advisor'].includes(value.user.role) || !Number.isSafeInteger(value.expires_at) || value.expires_at <= 0
          || typeof value.csrf_token !== 'string' || !/^[A-Za-z0-9_-]{20,256}$/.test(value.csrf_token)) throw protocolError();
      user = { id: value.user.id, username: value.user.username, role: value.user.role };
      csrf = value.csrf_token;
      expiresAt = value.expires_at;
      return publicSession();
    }

    async function jsonBody(response, controller) {
      const contentType = (response.headers.get('Content-Type') || '').split(';', 1)[0].trim().toLowerCase();
      if (contentType !== 'application/json') throw protocolError();
      const length = response.headers.get('Content-Length');
      if (length && /^\d+$/.test(length)) {
        const digits = length.replace(/^0+/, '') || '0';
        if (digits.length > 7 || Number(digits) > MAX_RESPONSE_BYTES) throw protocolError();
      }
      let text = '';
      if (response.body && typeof response.body.getReader === 'function') {
        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8', { fatal: true });
        let bytes = 0;
        let complete = false;
        try {
          while (true) {
            const chunk = await reader.read();
            if (controller.signal.aborted) throw cancelled();
            if (chunk.done) {
              try { text += decoder.decode(); } catch (_) { throw protocolError(); }
              complete = true;
              break;
            }
            bytes += chunk.value.byteLength;
            if (bytes > MAX_RESPONSE_BYTES) throw protocolError();
            try { text += decoder.decode(chunk.value, { stream: true }); } catch (_) { throw protocolError(); }
            if (text.length > MAX_RESPONSE_CHARS) throw protocolError();
          }
        } finally {
          if (!complete) { try { const cancelledRead = reader.cancel(); cancelledRead?.catch(() => {}); } catch (_) {} }
          reader.releaseLock();
        }
      } else text = await response.text();
      if (text.length > MAX_RESPONSE_CHARS) throw protocolError();
      try { return JSON.parse(text); }
      catch (_) { throw protocolError(); }
    }

    async function request(endpoint, { method = 'GET', body, authenticated = false } = {}) {
      const base = apiBase();
      const atGeneration = generation;
      if (authenticated) requireConnection(true);
      const headers = { Accept: 'application/json' };
      let serialized;
      if (body !== undefined) {
        headers['Content-Type'] = 'application/json';
        try { serialized = JSON.stringify(body); }
        catch (_) { throw new CloudError('VALIDATION', '报告格式无法发送，请先检查本机资料。', 422); }
      }
      // Also bind reads to this page's identity when another tab changes the Cookie.
      if (authenticated) headers['X-CSRF-Token'] = csrf;
      const current = { controller: new AbortController(), reason: 'CANCELLED' };
      pending.add(current);
      let onAbort;
      const aborted = new Promise((_, reject) => {
        onAbort = () => reject(current.reason === 'TIMEOUT'
          ? new CloudError('TIMEOUT', '连接超时，操作结果尚未确认。请重新连接并读取服务端记录后再操作。') : cancelled());
        current.controller.signal.addEventListener('abort', onAbort, { once: true });
      });
      const timeout = setTimeout(() => { current.reason = 'TIMEOUT'; current.controller.abort(); }, timeoutMs);
      try {
        const operation = (async () => {
          const response = await fetcher(base.href + endpoint, {
            method, headers, ...(serialized !== undefined ? { body: serialized } : {}),
            credentials: 'same-origin', redirect: 'error', cache: 'no-store', signal: current.controller.signal
          });
          if (generation !== atGeneration || current.controller.signal.aborted) throw cancelled();
          const status = response.status;
          if (!Number.isInteger(status) || status < 100 || status > 599) throw protocolError();
          if (status === 204) return null;
          let data;
          if (status < 200 || status >= 300) {
            if ((response.headers.get('Content-Type') || '').split(';', 1)[0].trim().toLowerCase() === 'application/json') {
              data = await jsonBody(response, current.controller);
            } else {
              try { const cancelledRead = response.body?.cancel(); cancelledRead?.catch(() => {}); } catch (_) {}
            }
            if (generation !== atGeneration || current.controller.signal.aborted) throw cancelled();
            if (status === 401 || status === 403) forgetIdentity();
            throw httpError(status, data);
          }
          return jsonBody(response, current.controller);
        })();
        const result = await Promise.race([operation, aborted]);
        if (generation !== atGeneration) throw cancelled();
        return result;
      } catch (error) {
        if (generation !== atGeneration) throw cancelled();
        if (error instanceof CloudError) throw error;
        if (current.controller.signal.aborted) {
          if (current.reason === 'TIMEOUT') throw new CloudError('TIMEOUT', '连接超时，操作结果尚未确认。请重新连接并读取服务端记录后再操作。');
          throw cancelled();
        }
        throw new CloudError('NETWORK', '连接中断，操作结果尚未确认。请重新连接并读取服务端记录后再操作。');
      } finally {
        clearTimeout(timeout);
        current.controller.signal.removeEventListener('abort', onAbort);
        pending.delete(current);
      }
    }

    async function connect() {
      disconnect();
      apiBase();
      const atGeneration = generation;
      try {
        const health = await request('health');
        if (!object(health) || health.status !== 'ok' || health.api_version !== '2') throw protocolError();
        try {
          const value = await request('auth/session');
          if (generation !== atGeneration) throw cancelled();
          const result = adoptSession(value);
          connected = true;
          return result;
        } catch (error) {
          if (generation !== atGeneration) throw cancelled();
          if (error.status === 401) { connected = true; return null; }
          throw error;
        }
      } catch (error) {
        if (generation === atGeneration) { connected = false; forgetIdentity(); }
        throw error;
      }
    }

    async function login(username, password) {
      requireConnection();
      cancelPending();
      forgetIdentity();
      const atGeneration = generation;
      if (typeof username !== 'string' || username.length < 3 || username.length > 64
          || typeof password !== 'string' || password.length < 12 || password.length > 128) {
        throw new CloudError('VALIDATION', '请填写有效的账号和 12–128 字符密码。', 422);
      }
      const value = await request('auth/login', { method: 'POST', body: { username, password } });
      if (generation !== atGeneration) throw cancelled();
      return adoptSession(value);
    }

    function report(value) {
      if (!object(value) || !identifier(value.id) || !revisionNumber(value.revision) || !object(value.record)) throw protocolError();
      return value;
    }
    function reportId(id) {
      if (!identifier(id)) throw new CloudError('VALIDATION', '报告编号无效，请刷新名单后重新选择。', 422);
      return encodeURIComponent(id);
    }
    function revision(value) {
      if (!revisionNumber(value)) throw new CloudError('VALIDATION', '报告修订号无效，请重新读取报告。', 422);
      return value;
    }

    async function list() {
      requireConnection(true);
      const value = await request('reports?limit=100&offset=0', { authenticated: true });
      if (!object(value) || !Array.isArray(value.items) || value.items.length > 100 || !Number.isInteger(value.total)
          || value.total < 0 || value.total > 100 || !value.items.every(item => object(item) && identifier(item.id) && revisionNumber(item.revision))) throw protocolError();
      return value;
    }
    async function get(id) {
      requireConnection(true);
      return report(await request('reports/' + reportId(id), { authenticated: true }));
    }
    async function createReport(record) {
      requireConnection(true);
      if (!object(record)) throw new CloudError('VALIDATION', '请选择有效的本机归档。', 422);
      return report(await request('reports', { method: 'POST', body: { record }, authenticated: true }));
    }
    async function update(id, expectedRevision, record) {
      requireConnection(true);
      const endpoint = 'reports/' + reportId(id);
      revision(expectedRevision);
      if (!object(record)) throw new CloudError('VALIDATION', '请选择有效的本机归档。', 422);
      return report(await request(endpoint, { method: 'PUT', body: { record, revision: expectedRevision }, authenticated: true }));
    }
    async function remove(id, expectedRevision) {
      requireConnection(true);
      const endpoint = 'reports/' + reportId(id) + '?revision=' + revision(expectedRevision);
      return request(endpoint, { method: 'DELETE', authenticated: true });
    }
    async function logout() {
      const atGeneration = generation;
      try {
        requireConnection(true);
        return await request('auth/logout', { method: 'POST', body: {}, authenticated: true });
      } finally {
        // An aborted older request must not clear a connection established meanwhile.
        if (generation === atGeneration) disconnect();
      }
    }

    function shareMeta(value, reportId, includeToken = false) {
      const keys = ['id', 'report_id', 'report_revision', 'created_at', 'expires_at', 'revoked_at', 'status', ...(includeToken ? ['token'] : [])];
      if (!object(value) || Object.keys(value).some(key => !keys.includes(key))
          || !identifier(value.id) || value.report_id !== reportId || !revisionNumber(value.report_revision)
          || !Number.isSafeInteger(value.created_at) || value.created_at <= 0
          || !Number.isSafeInteger(value.expires_at) || value.expires_at <= value.created_at
          || value.revoked_at !== null && (!Number.isSafeInteger(value.revoked_at) || value.revoked_at <= 0)
          || !['active', 'revoked', 'expired'].includes(value.status)
          || includeToken && (typeof value.token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value.token))) throw protocolError();
      return value;
    }
    async function createShare(id, expectedRevision, ttlHours, content) {
      requireConnection(true);
      const endpoint = 'reports/' + reportId(id) + '/shares';
      revision(expectedRevision);
      if (![24, 72, 168].includes(ttlHours) || !object(content)) throw new CloudError('VALIDATION', '请选择支持的分享期限并预览摘要。', 422);
      return shareMeta(await request(endpoint, { method: 'POST', body: { revision: expectedRevision, ttl_hours: ttlHours, content }, authenticated: true }), id, true);
    }
    async function listShares(id) {
      requireConnection(true);
      const value = await request('reports/' + reportId(id) + '/shares', { authenticated: true });
      if (!object(value) || !Array.isArray(value.items) || value.items.length > 100) throw protocolError();
      value.items.forEach(item => shareMeta(item, id));
      return value;
    }
    async function revokeShare(id, shareId) {
      requireConnection(true);
      return request('reports/' + reportId(id) + '/shares/' + reportId(shareId), { method: 'DELETE', authenticated: true });
    }

    function exactKeys(value, keys) {
      return object(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
    }
    function boundedText(value, maximum, required = false) {
      if (typeof value !== 'string' || value.length > maximum || required && !value.trim()) return false;
      return Array.from(value).every(character => !(character.length === 1 && character.charCodeAt(0) >= 0xD800 && character.charCodeAt(0) <= 0xDFFF));
    }
    const requestId = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
    const username = value => typeof value === 'string' && /^[a-z0-9._@+-]{3,64}$/.test(value);
    function accessMeta(value, expectedReport) {
      if (!exactKeys(value, ['id', 'report_id', 'report_revision', 'report_name', 'report_ref', 'recipient_username', 'created_at', 'expires_at', 'revoked_at', 'status'])
          || !identifier(value.id) || !identifier(value.report_id) || expectedReport && value.report_id !== expectedReport
          || !revisionNumber(value.report_revision) || !boundedText(value.report_name, 24, true) || !boundedText(value.report_ref, 100, true)
          || !username(value.recipient_username) || !Number.isSafeInteger(value.created_at) || value.created_at <= 0
          || !Number.isSafeInteger(value.expires_at) || value.expires_at <= value.created_at
          || value.revoked_at !== null && (!Number.isSafeInteger(value.revoked_at) || value.revoked_at <= 0)
          || !['active', 'revoked', 'expired', 'unavailable'].includes(value.status)) throw protocolError();
      return value;
    }
    function accessList(value, expectedReport) {
      if (!exactKeys(value, ['items']) || !Array.isArray(value.items) || value.items.length > 100) throw protocolError();
      const seen = new Set();
      value.items.forEach(item => { accessMeta(item, expectedReport); if (seen.has(item.id)) throw protocolError(); seen.add(item.id); });
      return value;
    }
    function familyComment(value) {
      if (!exactKeys(value, ['id', 'author', 'body', 'created_at', 'client_request_id'])
          || !identifier(value.id) || !['owner', 'recipient'].includes(value.author) || !boundedText(value.body, 1000, true)
          || !Number.isSafeInteger(value.created_at) || value.created_at <= 0 || !requestId(value.client_request_id)) throw protocolError();
      return value;
    }
    async function createParentAccess(id, expectedRevision, recipient, ttlHours, content) {
      requireConnection(true);
      const endpoint = 'reports/' + reportId(id) + '/parent-access';
      revision(expectedRevision);
      if (typeof recipient !== 'string' || !username(recipient.toLowerCase()) || ![24, 72, 168].includes(ttlHours) || !object(content)) {
        throw new CloudError('VALIDATION', '请填写有效的受邀学校账号、期限，并预览摘要。', 422);
      }
      return accessMeta(await request(endpoint, { method: 'POST', body: { revision: expectedRevision,
        recipient_username: recipient.toLowerCase(), ttl_hours: ttlHours, content }, authenticated: true }), id);
    }
    async function listParentAccess(id) {
      requireConnection(true);
      return accessList(await request('reports/' + reportId(id) + '/parent-access', { authenticated: true }), id);
    }
    async function revokeParentAccess(id, grantId) {
      requireConnection(true);
      return request('reports/' + reportId(id) + '/parent-access/' + reportId(grantId), { method: 'DELETE', authenticated: true });
    }
    async function listFamilyAccess() {
      requireConnection(true);
      return accessList(await request('parent-access', { authenticated: true }));
    }
    async function familyThread(grantId) {
      requireConnection(true);
      const result = await request('parent-access/' + reportId(grantId), { authenticated: true });
      if (!exactKeys(result, ['grant', 'snapshot', 'comments', 'participant', 'can_comment']) || result.grant?.id !== grantId
          || !Array.isArray(result.comments) || result.comments.length > 100 || typeof result.can_comment !== 'boolean'
          || !['owner', 'recipient'].includes(result.participant)) throw protocolError();
      accessMeta(result.grant);
      if (result.can_comment && result.grant.status !== 'active') throw protocolError();
      try { result.snapshot = window.ParentSummary.validate(result.snapshot); } catch (_) { throw protocolError(); }
      if (result.snapshot.report.revision !== result.grant.report_revision || result.snapshot.report.name !== result.grant.report_name
          || result.snapshot.report.batchId !== result.grant.report_ref || result.snapshot.shared_at !== result.grant.created_at
          || result.snapshot.expires_at !== result.grant.expires_at) throw protocolError();
      const seen = new Set();
      result.comments.forEach(value => { familyComment(value); if (seen.has(value.id)) throw protocolError(); seen.add(value.id); });
      return result;
    }
    async function addFamilyComment(grantId, body, clientRequestId) {
      requireConnection(true);
      const endpoint = 'parent-access/' + reportId(grantId) + '/comments';
      if (!boundedText(body, 1000, true) || !requestId(clientRequestId)) throw new CloudError('VALIDATION', '批注需为 1–1000 字符的有效文字，请重新填写。', 422);
      const result = familyComment(await request(endpoint, { method: 'POST', body: { body, client_request_id: clientRequestId }, authenticated: true }));
      if (result.body !== body || result.client_request_id !== clientRequestId) throw protocolError();
      return result;
    }

    const adviceKeys = ['summary', 'academic', 'plan', 'personality'];
    function adviceSections(value) {
      return exactKeys(value, adviceKeys) && adviceKeys.every(key => boundedText(value[key], 4000, true));
    }
    function adviceContext(value) {
      const subjects = ['english', 'maths', 'physics', 'chemistry'];
      const directions = ['cs', 'math', 'phys', 'eng', 'chem', 'med', 'bio', 'econ', 'biz', 'law', 'psych', 'design', 'media', 'intl'];
      return exactKeys(value, ['status', 'direction_id', 'personality_complete', 'personality_code', 'subjects'])
        && ['draft', 'complete'].includes(value.status) && directions.includes(value.direction_id)
        && typeof value.personality_complete === 'boolean'
        && (value.personality_code === null || value.personality_complete && typeof value.personality_code === 'string' && /^[EI][SN][TF][JP]$/.test(value.personality_code))
        && Array.isArray(value.subjects) && value.subjects.length === 4
        && value.subjects.every((subject, index) => exactKeys(subject, ['key', 'answered', 'total', 'pct'])
          && subject.key === subjects[index] && Number.isInteger(subject.answered) && subject.answered >= 0 && subject.answered <= 15
          && subject.total === 15 && (subject.answered === subject.total
            ? Number.isInteger(subject.pct) && subject.pct >= 0 && subject.pct <= 100 : subject.pct === null))
        && (value.status !== 'complete' || value.personality_complete && value.subjects.every(subject => subject.answered === subject.total));
    }
    function adviceDraft(value, id, expectedRevision, fallback) {
      if (!exactKeys(value, ['id', 'report_id', 'source_revision', 'created_at', 'expires_at', 'kind', 'generator', 'reason', 'before', 'sections'])
          || !requestId(value.id) || value.report_id !== id || value.source_revision !== expectedRevision
          || !Number.isSafeInteger(value.created_at) || value.created_at <= 0
          || !Number.isSafeInteger(value.expires_at) || value.expires_at <= value.created_at || value.expires_at - value.created_at > 900
          || !['rule', 'local_mock', 'provider'].includes(value.kind) || typeof value.generator !== 'string' || !/^[A-Za-z0-9._-]{1,80}$/.test(value.generator)
          || !['generated', 'disabled', 'unavailable', 'timeout', 'invalid', 'busy', 'failed'].includes(value.reason)
          || !adviceSections(value.before) || !adviceSections(value.sections)
          || adviceKeys.some(key => value.before[key] !== fallback[key])) throw protocolError();
      return value;
    }
    async function createAdviceDraft(id, expectedRevision, context, fallback) {
      requireConnection(true);
      const endpoint = 'reports/' + reportId(id) + '/advice-drafts';
      revision(expectedRevision);
      if (!adviceContext(context) || !adviceSections(fallback)) throw new CloudError('VALIDATION', '建议草稿上下文无效，请重新读取并核对报告。', 422);
      return adviceDraft(await request(endpoint, { method: 'POST', body: { revision: expectedRevision, context, fallback }, authenticated: true }), id, expectedRevision, fallback);
    }
    async function applyAdviceDraft(id, draftId, sections, reviewer) {
      requireConnection(true);
      const endpoint = 'reports/' + reportId(id) + '/advice-drafts/';
      if (!requestId(draftId) || !Array.isArray(sections) || sections.length < 1 || sections.length > 4
          || new Set(sections).size !== sections.length || !sections.every(key => adviceKeys.includes(key)) || !boundedText(reviewer, 40, true)) {
        throw new CloudError('VALIDATION', '请选择变更的建议，并填写 1–40 字符的核对人姓名。', 422);
      }
      const result = report(await request(endpoint + draftId + '/apply', { method: 'POST', body: { sections, reviewer }, authenticated: true }));
      if (result.id !== id) throw protocolError();
      return result;
    }

    return { connect, login, list, get, create: createReport, update, remove, logout, disconnect,
      createShare, listShares, revokeShare,
      createParentAccess, listParentAccess, revokeParentAccess, listFamilyAccess, familyThread, addFamilyComment,
      createAdviceDraft, applyAdviceDraft,
      get user() { return user ? copy(user) : null; }, get connected() { return connected; } };
  }

  window.CloudReports = { create, CloudError };
})();
