const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const USER = { id: 'account-1', username: 'advisor.local', role: 'advisor' };
const SESSION = { user: USER, csrf_token: 'c'.repeat(43), expires_at: 1_900_000_000 };
const REPORT = { id: 'server-1', revision: 1, record: { id: 'local-1' } };
const plain = value => JSON.parse(JSON.stringify(value));
const response = (value, status = 200, headers = {}) => new Response(status === 204 ? null : JSON.stringify(value), {
  status, headers: { 'Content-Type': 'application/json', ...headers }
});
const absent = () => response({ detail: 'Authentication required.' }, 401);

function setup(options = {}) {
  const filename = path.join(__dirname, '../js/cloud-client.js');
  const window = {};
  Object.defineProperties(window, {
    localStorage: { get() { throw new Error('Credentials must never touch localStorage'); } },
    sessionStorage: { get() { throw new Error('Credentials must never touch sessionStorage'); } }
  });
  if (fs.existsSync(filename)) vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    window, URL, AbortController, TextDecoder, setTimeout, clearTimeout,
    console: { log() { throw new Error('Client must not log credentials or responses'); } }
  }, { filename });
  assert.ok(window.CloudReports, '显式服务端报告客户端应存在');
  const calls = [];
  const replies = options.replies || [response({ status: 'ok', api_version: '2' }), absent()];
  const fetch = options.fetch || ((url, init) => {
    calls.push({ url: String(url), init });
    const next = replies.shift();
    if (next instanceof Error) return Promise.reject(next);
    if (typeof next === 'function') return next(url, init);
    assert.ok(next, 'No unexpected automatic network calls');
    return Promise.resolve(next);
  });
  const client = window.CloudReports.create({
    location: new URL(options.url || 'https://school.test/planner/'),
    ...(options.config !== null ? { config: options.config || { enabled: true, apiBase: './api/' } } : {}),
    fetch, timeoutMs: options.timeoutMs || 1_000
  });
  return { client, calls, replies, module: window.CloudReports };
}

async function signedIn(extra = []) {
  const f = setup({ replies: [response({ status: 'ok', api_version: '2' }), absent(), response(SESSION), ...extra] });
  assert.equal(await f.client.connect(), null);
  await f.client.login('advisor.local', 'synthetic-test-password');
  return f;
}

test('create and default disabled configuration never probe or upload automatically', async () => {
  const f = setup({ config: null });
  assert.equal(f.calls.length, 0);
  assert.equal(f.client.user, null);
  assert.equal(f.client.connected, false);
  await assert.rejects(f.client.connect(), error => error.code === 'DISABLED');
  assert.equal(f.calls.length, 0);
});

test('file, insecure remote, cross-origin and credential-bearing API prefixes never receive credentials', async () => {
  for (const [url, config, code] of [
    ['file:///D:/planner/index.html', { enabled: true, apiBase: './api/' }, 'LOCAL_ONLY'],
    ['http://school.test/', { enabled: true, apiBase: '/api/' }, 'CONFIG'],
    ['https://school.test/', { enabled: true, apiBase: 'https://evil.test/api/' }, 'CONFIG'],
    ['https://school.test/', { enabled: true, apiBase: 'https://user:secret@school.test/api/' }, 'CONFIG'],
    ['https://school.test/', { enabled: true, apiBase: '/api/?key=secret' }, 'CONFIG'],
    ['https://school.test/', { enabled: true, apiBase: '/api/#fragment' }, 'CONFIG'],
    ['https://school.test/', { enabled: true, apiBase: 'javascript:alert(1)' }, 'CONFIG']
  ]) {
    const f = setup({ url, config });
    await assert.rejects(f.client.connect(), error => error.code === code, `${url}: ${config.apiBase}`);
    assert.equal(f.calls.length, 0);
  }
  for (const host of ['127.0.0.1:9001', 'localhost:9001']) {
    const f = setup({ url: `http://${host}/` });
    assert.equal(await f.client.connect(), null);
    assert.equal(f.calls.length, 2);
  }
});

test('explicit connect verifies API then restores only public session metadata', async () => {
  const f = setup({ replies: [response({ status: 'ok', api_version: '2' }), response(SESSION)] });
  assert.equal(f.calls.length, 0);
  const connected = await f.client.connect();
  assert.deepEqual(plain(connected), { user: USER, expires_at: SESSION.expires_at });
  assert.deepEqual(plain(f.client.user), USER);
  assert.equal(f.client.connected, true);
  connected.user.username = 'mutated';
  const user = f.client.user;
  user.id = 'mutated';
  assert.equal(f.client.user.id, USER.id);
  assert.equal(f.client.user.username, USER.username);
  assert.deepEqual(f.calls.map(call => call.url), ['https://school.test/planner/api/health', 'https://school.test/planner/api/auth/session']);
  for (const call of f.calls) {
    assert.equal(call.init.credentials, 'same-origin');
    assert.equal(call.init.redirect, 'error');
    assert.equal(call.init.cache, 'no-store');
    assert.equal(call.init.method, 'GET');
    assert.equal(call.init.body, undefined);
    assert.equal(call.init.headers.Origin, undefined);
  }
});

test('legacy API without read identity binding is rejected before session restoration or login', async () => {
  const legacyVersion = '1';
  const f = setup({ replies: [response({ status: 'ok', api_version: legacyVersion }), absent()] });
  await assert.rejects(f.client.connect(), error => error.code === 'PROTOCOL');
  assert.equal(f.client.connected, false);
  assert.equal(f.client.user, null);
  await assert.rejects(f.client.login('advisor.local', 'synthetic-test-password'));
  assert.equal(f.calls.length, 1, 'Do not restore a cookie session or send credentials to an incompatible API');
});

test('login stays explicit and CSRF is private while authenticated writes have the exact wire contract', async () => {
  const f = await signedIn([response({ items: [], total: 0, limit: 100, offset: 0 }), response(REPORT, 201), response(REPORT), response({ ...REPORT, revision: 2 }), response(null, 204)]);
  const publicSession = await Promise.resolve({ user: f.client.user });
  assert.ok(!JSON.stringify(publicSession).includes(SESSION.csrf_token));
  const login = f.calls[2];
  assert.deepEqual(JSON.parse(login.init.body), { username: 'advisor.local', password: 'synthetic-test-password' });
  assert.equal(login.init.headers['Content-Type'], 'application/json');
  assert.equal(login.init.headers['X-CSRF-Token'], undefined);
  await f.client.list();
  await f.client.create(REPORT.record);
  await f.client.get('server-1');
  await f.client.update('server-1', 1, REPORT.record);
  await f.client.remove('server-1', 2);
  assert.equal(f.calls[3].url, 'https://school.test/planner/api/reports?limit=100&offset=0');
  assert.deepEqual(JSON.parse(f.calls[4].init.body), { record: REPORT.record });
  assert.deepEqual(JSON.parse(f.calls[6].init.body), { record: REPORT.record, revision: 1 });
  assert.equal(f.calls[7].url, 'https://school.test/planner/api/reports/server-1?revision=2');
  for (const index of [4, 6, 7]) assert.equal(f.calls[index].init.headers['X-CSRF-Token'], SESSION.csrf_token);
  assert.equal(f.calls[7].init.body, undefined);
});

test('report methods cannot be called before explicit connection or login', async () => {
  const f = setup();
  await assert.rejects(f.client.login('advisor.local', 'synthetic-test-password'));
  await assert.rejects(f.client.list());
  assert.equal(f.calls.length, 0);
  await f.client.connect();
  await assert.rejects(f.client.create(REPORT.record), error => error.code === 'AUTH');
  await assert.rejects(f.client.get('server-1'), error => error.code === 'AUTH');
  assert.equal(f.calls.length, 2);
});

test('session expiry and CSRF rejection clear identity without echoing rejected secrets', async () => {
  for (const status of [401, 403]) {
    const f = await signedIn([response({ detail: 'synthetic-test-password and ' + SESSION.csrf_token }, status)]);
    await assert.rejects(f.client.list(), error => error.status === status
      && !error.message.includes('synthetic-test-password') && !error.message.includes(SESSION.csrf_token));
    assert.equal(f.client.user, null);
    await assert.rejects(f.client.create(REPORT.record), error => error.code === 'AUTH');
    assert.equal(f.calls.length, 4);
  }
});

test('authenticated reads bind the in-memory account to its CSRF token and clear identity on cross-tab mismatch', async () => {
  for (const method of ['list', 'get']) {
    const f = await signedIn([response({ detail: 'A different tab changed the cookie account.' }, 403)]);
    const action = method === 'list' ? f.client.list() : f.client.get('server-1');
    await assert.rejects(action, error => error.status === 403 && error.code === 'CSRF');
    assert.equal(f.calls[3].init.method, 'GET');
    assert.equal(f.calls[3].init.headers['X-CSRF-Token'], SESSION.csrf_token);
    assert.equal(f.client.user, null);
    await assert.rejects(f.client.list(), error => error.code === 'AUTH');
    assert.equal(f.calls.length, 4, 'A mismatched identity must never be silently retried with the new cookie');
  }
});

test('conflicts, quota, validation and rate limits are safe errors with no automatic replay', async () => {
  for (const [status, serverCode, expectedCode] of [[409, 'REVISION', 'REVISION'], [409, 'DUPLICATE', 'DUPLICATE'], [409, '<secret>', 'CONFLICT'], [413, 'LIMIT', 'LIMIT'], [422, 'VALIDATION', 'VALIDATION'], [429, '', 'RATE_LIMIT']]) {
    const f = await signedIn([response({ detail: '<secret>', code: serverCode }, status)]);
    await assert.rejects(f.client.create(REPORT.record), error => error.status === status && error.code === expectedCode && !error.message.includes('<secret>'));
    assert.equal(f.calls.length, 4);
    assert.deepEqual(plain(f.client.user), USER);
  }
});

test('network write failure is uncertain and is never silently retried', async () => {
  const f = await signedIn([new TypeError('failed request with private contents')]);
  await assert.rejects(f.client.create(REPORT.record), error => error.code === 'NETWORK' && error.message.includes('未确认') && !error.message.includes('private'));
  assert.equal(f.calls.length, 4);
});

test('request timeout settles even if the fetch implementation ignores abort', async () => {
  const f = setup({ timeoutMs: 15, replies: [() => new Promise(() => {})] });
  await assert.rejects(f.client.connect(), error => error.code === 'TIMEOUT');
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].init.signal.aborted, true);
  assert.equal(f.client.user, null);
  assert.equal(f.client.connected, false);
});

test('disconnect aborts in-flight login and late response cannot restore the old identity', async () => {
  let finish;
  const f = setup({ replies: [response({ status: 'ok', api_version: '2' }), absent(), () => new Promise(resolve => { finish = resolve; })] });
  await f.client.connect();
  const pending = f.client.login('advisor.local', 'synthetic-test-password');
  await new Promise(resolve => setImmediate(resolve));
  f.client.disconnect();
  await assert.rejects(pending, error => error.code === 'CANCELLED');
  assert.equal(f.calls[2].init.signal.aborted, true);
  finish(response(SESSION));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.client.user, null);
  assert.equal(f.client.connected, false);
});

test('logout clears private state even if the server could not confirm revocation', async () => {
  for (const next of [response(null, 204), new TypeError('network offline')]) {
    const f = await signedIn([next]);
    if (next instanceof Error) await assert.rejects(f.client.logout(), error => error.code === 'NETWORK');
    else await f.client.logout();
    assert.equal(f.client.user, null);
    assert.equal(f.client.connected, false);
    assert.equal(f.calls[3].init.method, 'POST');
    assert.equal(f.calls[3].init.headers['X-CSRF-Token'], SESSION.csrf_token);
    await assert.rejects(f.client.list());
    assert.equal(f.calls.length, 4);
  }
});

test('invalid session and report response structures never become active user data', async () => {
  for (const invalid of [{ ...SESSION, csrf_token: '' }, { ...SESSION, user: { ...USER, role: 'admin' } }, { ...SESSION, expires_at: 'tomorrow' }]) {
    const f = setup({ replies: [response({ status: 'ok', api_version: '2' }), response(invalid)] });
    await assert.rejects(f.client.connect(), error => error.code === 'PROTOCOL');
    assert.equal(f.client.user, null);
    assert.equal(f.client.connected, false);
  }
  for (const invalid of [null, { id: 'server-1', revision: 0, record: {} }, { id: 'server-1', revision: 1, record: [] }]) {
    const f = await signedIn([response(invalid)]);
    await assert.rejects(f.client.get('server-1'), error => error.code === 'PROTOCOL');
  }
  const html = setup({ replies: [new Response('<html>Wrong server</html>', { headers: { 'Content-Type': 'text/html' } })] });
  await assert.rejects(html.client.connect(), error => error.code === 'PROTOCOL');
  assert.equal(html.calls.length, 1);
});

test('traversal IDs and invalid revisions are rejected before any authenticated write', async () => {
  const f = await signedIn();
  for (const id of ['../auth/logout', 'server/../../other', '..', 'user?revision=2']) {
    await assert.rejects(f.client.get(id));
    await assert.rejects(f.client.remove(id, 1));
  }
  for (const revision of [0, -1, true, 1.5, '1', Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(f.client.update('server-1', revision, REPORT.record));
  }
  assert.equal(f.calls.length, 3);
});

test('response cap checks actual streamed content rather than trusting length headers', async () => {
  const huge = new ReadableStream({ start(controller) {
    controller.enqueue(new TextEncoder().encode(' '.repeat(1_100_000)));
    controller.enqueue(new TextEncoder().encode(' '.repeat(1_100_000)));
    controller.close();
  } });
  const f = setup({ replies: [new Response(huge, { headers: { 'Content-Type': 'application/json', 'Content-Length': '2' } })] });
  await assert.rejects(f.client.connect(), error => error.code === 'PROTOCOL');
  assert.equal(f.calls.length, 1);
  assert.equal(f.client.connected, false);
});

test('malformed UTF-8 is a protocol error without echoing the response or leaving a connection active', async () => {
  const f = setup({ replies: [new Response(new Uint8Array([0xff]), { headers: { 'Content-Type': 'application/json' } })] });
  await assert.rejects(f.client.connect(), error => error.code === 'PROTOCOL');
  assert.equal(f.client.connected, false);
  assert.equal(f.client.user, null);
});

test('disconnect cannot race the final login adoption between promise continuations', async () => {
  for (let delay = 0; delay < 35; delay++) {
    const f = setup({ replies: [response({ status: 'ok', api_version: '2' }), absent(), response(SESSION)] });
    await f.client.connect();
    const pending = f.client.login('advisor.local', 'synthetic-test-password').catch(error => error);
    let counter = delay;
    const disconnectLater = () => { if (counter-- > 0) queueMicrotask(disconnectLater); else f.client.disconnect(); };
    queueMicrotask(disconnectLater);
    await pending;
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.client.user, null, `Final login adoption after disconnect at continuation ${delay}`);
    assert.equal(f.client.connected, false);
  }
});

test('an older cancelled logout cannot disconnect a newly restored account', async () => {
  let finishLogout;
  const nextSession = { ...SESSION, user: { id: 'account-2', username: 'student.new', role: 'student' }, csrf_token: 'n'.repeat(43) };
  const f = await signedIn([
    () => new Promise(resolve => { finishLogout = resolve; }),
    response({ status: 'ok', api_version: '2' }), response(nextSession),
    response({ items: [], total: 0, limit: 100, offset: 0 })
  ]);
  const oldLogout = f.client.logout().catch(error => error);
  await new Promise(resolve => setImmediate(resolve));
  f.client.disconnect();
  try {
    const restored = await f.client.connect();
    assert.deepEqual(plain(restored.user), nextSession.user);
    assert.deepEqual(plain(f.client.user), nextSession.user);
    assert.equal(f.client.connected, true);
    await f.client.list();
  } finally {
    finishLogout(response(null, 204));
    await oldLogout;
  }
  assert.deepEqual(plain(f.client.user), nextSession.user);
  assert.equal(f.client.connected, true);
});
