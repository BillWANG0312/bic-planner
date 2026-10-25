const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const USER = { id: 'password-account', username: 'synthetic.owner', role: 'student' };
const SESSION = { user: USER, csrf_token: 'c'.repeat(43), expires_at: 1_900_000_000 };
const OLD = 'synthetic-current-password', NEW = 'synthetic-next-password';
const plain = value => JSON.parse(JSON.stringify(value));
const response = (value, status = 200) => new Response(status === 204 ? null : JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const tick = () => new Promise(resolve => setImmediate(resolve));
function setup(replies = [], timeoutMs = 1000) {
  const window = {}, calls = [];
  Object.defineProperties(window, {
    localStorage: { get() { throw new Error('No password storage'); } },
    sessionStorage: { get() { throw new Error('No password storage'); } }
  });
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../js/cloud-client.js'), 'utf8'), {
    window, URL, AbortController, TextDecoder, setTimeout, clearTimeout,
    console: { log() { throw new Error('No credential logging'); } }
  });
  const client = window.CloudReports.create({ config: { enabled: true, apiBase: '/api/' }, location: 'https://school.test/account.html', timeoutMs,
    fetch(url, init) {
      calls.push({ url, init }); const next = replies.shift();
      if (typeof next === 'function') return next(url, init);
      if (next instanceof Error) return Promise.reject(next);
      assert.ok(next, 'No unexpected automatic request'); return Promise.resolve(next);
    } });
  return { client, calls, replies };
}
async function signedIn(extra = [], timeoutMs) {
  const f = setup([response({ status: 'ok', api_version: '2' }), response(SESSION), ...extra], timeoutMs);
  await f.client.connect(); return f;
}

test('password change is explicit and authenticated with no requests before connection or login', async () => {
  const f = setup([response({ status: 'ok', api_version: '2' }), response({}, 401)]);
  assert.equal(typeof f.client.changePassword, 'function');
  await assert.rejects(f.client.changePassword(OLD, NEW), error => error.code === 'DISCONNECTED');
  assert.equal(f.calls.length, 0);
  await f.client.connect();
  await assert.rejects(f.client.changePassword(OLD, NEW), error => error.code === 'AUTH');
  assert.equal(f.calls.length, 2);
});

test('one successful password POST binds private CSRF, accepts only 204, disconnects and never logs in automatically', async () => {
  const f = await signedIn([response(null, 204)]), before = f.client.identityGeneration;
  const descriptor = Object.getOwnPropertyDescriptor(f.client, 'identityGeneration');
  assert.equal(typeof descriptor.get, 'function'); assert.equal(descriptor.set, undefined);
  assert.equal(JSON.stringify(f.client).includes(SESSION.csrf_token), false);
  assert.equal(await f.client.changePassword(OLD, NEW), null);
  assert.equal(f.calls.length, 3);
  const call = f.calls[2];
  assert.equal(call.url, 'https://school.test/api/auth/password'); assert.equal(call.init.method, 'POST');
  assert.deepEqual(JSON.parse(call.init.body), { current_password: OLD, new_password: NEW });
  assert.equal(call.init.headers['X-CSRF-Token'], SESSION.csrf_token);
  assert.equal(call.init.headers['Content-Type'], 'application/json');
  assert.equal(call.init.credentials, 'same-origin'); assert.equal(call.init.redirect, 'error'); assert.equal(call.init.cache, 'no-store');
  assert.equal(f.client.connected, false); assert.equal(f.client.user, null);
  assert.ok(Number.isSafeInteger(before) && f.client.identityGeneration > before);
  await assert.rejects(f.client.changePassword(OLD, NEW)); assert.equal(f.calls.length, 3);
});

test('password preflight validates Unicode codepoints and UTF8 without dropping identity or canceling old reads', async t => {
  let finish;
  const f = await signedIn([() => new Promise(resolve => { finish = resolve; })]);
  const previous = f.client.list(), generation = f.client.identityGeneration;
  previous.catch(() => {}); t.after(() => f.client.disconnect());
  const invalid = [undefined, null, 12, '', 'x'.repeat(11), 'x'.repeat(129), '😀'.repeat(129), 'x'.repeat(11) + '\uD800', 'x'.repeat(11) + '\uDC00'];
  for (const current of invalid) await assert.rejects(f.client.changePassword(current, NEW), error => error.code === 'VALIDATION');
  for (const next of [...invalid, ' '.repeat(12), '\t'.repeat(12), '\u3000'.repeat(12), '\u0085'.repeat(12), '\u001c'.repeat(12), OLD]) {
    await assert.rejects(f.client.changePassword(OLD, next), error => error.code === 'VALIDATION');
  }
  assert.deepEqual(plain(f.client.user), USER); assert.equal(f.client.connected, true);
  assert.equal(f.client.identityGeneration, generation); assert.equal(f.calls.length, 3);
  assert.equal(f.calls[2].init.signal.aborted, false);
  finish(response({ items: [], total: 0 })); await previous;
});

test('valid password limits count astral pairs once and preserve exact strings rather than trimming', async () => {
  for (const [current, next] of [['x'.repeat(12), 'y'.repeat(12)], ['😀'.repeat(128), '🚀'.repeat(128)], ['旧'.repeat(128), '新'.repeat(128)], [OLD, '  unchanged-spaces  '], [OLD, '\uFEFF'.repeat(12)]]) {
    const f = await signedIn([response(null, 204)]);
    await f.client.changePassword(current, next);
    assert.deepEqual(JSON.parse(f.calls[2].init.body), { current_password: current, new_password: next });
    assert.equal(f.client.user, null);
  }
});

test('known password errors are safe distinct errors and still forget this page without any replay', async () => {
  for (const [status, code] of [[401, 'AUTH'], [403, 'CSRF'], [422, 'VALIDATION'], [429, 'RATE_LIMIT'], [503, 'HTTP']]) {
    const f = await signedIn([response({ detail: OLD + NEW + SESSION.csrf_token }, status)]);
    await assert.rejects(f.client.changePassword(OLD, NEW), error => error.status === status && error.code === code
      && !error.message.includes(OLD) && !error.message.includes(NEW) && !error.message.includes(SESSION.csrf_token));
    assert.equal(f.calls.length, 3); assert.equal(f.client.connected, false); assert.equal(f.client.user, null);
  }
});

test('non-204 successful status or malformed error response is unknown, never a password success or automatic retry', async () => {
  for (const next of [response(null), response({}), response({ ok: true }, 201), response({ ok: true }, 202),
    new Response('malformed', { status: 422, headers: { 'Content-Type': 'application/json' } })]) {
    const f = await signedIn([next]);
    await assert.rejects(f.client.changePassword(OLD, NEW), error => error.code === 'PROTOCOL');
    assert.equal(f.calls.length, 3); assert.equal(f.client.connected, false); assert.equal(f.client.user, null);
  }
});

test('network loss and timeout are unknown results with one request and no retained page session', async () => {
  for (const [next, expected] of [[new TypeError('private ' + OLD), 'NETWORK'], [() => new Promise(() => {}), 'TIMEOUT']]) {
    const f = await signedIn([next], 15);
    await assert.rejects(f.client.changePassword(OLD, NEW), error => error.code === expected && /未确认/.test(error.message) && !error.message.includes(OLD));
    assert.equal(f.calls.length, 3); assert.equal(f.client.connected, false); assert.equal(f.client.user, null);
    if (expected === 'TIMEOUT') assert.equal(f.calls[2].init.signal.aborted, true);
  }
});

test('sending a password change cancels previous reads and their late 401 cannot affect later identity', async () => {
  let finish;
  const f = await signedIn([() => new Promise(resolve => { finish = resolve; }), response(null, 204)]);
  const oldRead = f.client.list(); oldRead.catch(() => {});
  const change = f.client.changePassword(OLD, NEW);
  await assert.rejects(oldRead, error => error.code === 'CANCELLED');
  await change;
  assert.equal(f.calls[2].init.signal.aborted, true);
  f.replies.push(response({ status: 'ok', api_version: '2' }), response({ ...SESSION, csrf_token: 'n'.repeat(43) }));
  await f.client.connect(); const generation = f.client.identityGeneration;
  finish(response({ detail: 'Late old-session failure' }, 401)); await tick();
  assert.deepEqual(plain(f.client.user), USER); assert.equal(f.client.connected, true); assert.equal(f.client.identityGeneration, generation);
});

test('cancelled or late password result cannot clear a later same-account same-expiry login', async () => {
  for (const late of [response(null, 204), response({}, 401), new TypeError('late private error')]) {
    let finish, reject;
    const f = await signedIn([() => new Promise((resolve, rejectPromise) => { finish = resolve; reject = rejectPromise; }), response({ ...SESSION, csrf_token: 'n'.repeat(43) })]);
    const changing = f.client.changePassword(OLD, NEW); changing.catch(() => {});
    const before = f.client.identityGeneration;
    await f.client.login(USER.username, NEW);
    await assert.rejects(changing, error => error.code === 'CANCELLED');
    assert.ok(f.client.identityGeneration > before); const generation = f.client.identityGeneration;
    if (late instanceof Error) reject(late); else finish(late);
    await tick();
    assert.deepEqual(plain(f.client.user), USER); assert.equal(f.client.connected, true); assert.equal(f.client.identityGeneration, generation);
    assert.equal(f.calls.length, 4); assert.equal(f.calls[3].url, 'https://school.test/api/auth/login');
  }
});

test('explicit disconnect cancels an in-flight change and ignores its late success', async () => {
  let finish;
  const f = await signedIn([() => new Promise(resolve => { finish = resolve; })]);
  const changing = f.client.changePassword(OLD, NEW); changing.catch(() => {});
  f.client.disconnect();
  await assert.rejects(changing, error => error.code === 'CANCELLED');
  const generation = f.client.identityGeneration; finish(response(null, 204)); await tick();
  assert.equal(f.client.identityGeneration, generation); assert.equal(f.client.user, null); assert.equal(f.client.connected, false);
});

test('all login entrances accept 128 valid Unicode codepoints and reject excess or isolated surrogates', async () => {
  for (const password of ['😀'.repeat(128), 'x'.repeat(128), 'x'.repeat(11) + '😀']) {
    const f = setup([response({ status: 'ok', api_version: '2' }), response({}, 401), response(SESSION)]);
    await f.client.connect(); await f.client.login(USER.username, password);
    assert.equal(JSON.parse(f.calls[2].init.body).password, password);
  }
  for (const password of ['😀'.repeat(129), 'x'.repeat(129), 'x'.repeat(11), 'x'.repeat(11) + '\uD800', 'x'.repeat(11) + '\uDC00']) {
    const f = setup([response({ status: 'ok', api_version: '2' }), response({}, 401)]);
    await f.client.connect(); await assert.rejects(f.client.login(USER.username, password), error => error.code === 'VALIDATION');
    assert.equal(f.calls.length, 2);
  }
});

test('every existing login password input holds 128 non-BMP codepoints without expanding other inputs', () => {
  for (const filename of ['index.html', 'family.html', 'teacher.html', 'advisor-edit.html', 'teacher-summary.html']) {
    const html = fs.readFileSync(path.join(__dirname, '..', filename), 'utf8');
    const inputs = html.match(/<input\b[^>]*type="password"[^>]*>/g);
    assert.equal(inputs.length, 1, filename); assert.match(inputs[0], /maxlength="256"/, filename);
    assert.match(html, /id="(?:cloud|family|teacher|edit|summary)Username"[^>]*maxlength="64"/);
  }
});
