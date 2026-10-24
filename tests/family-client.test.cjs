const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const USER = { id: 'account-1', username: 'parent.test', role: 'student' };
const grant = { id: 'grant-1', report_id: 'report-1', report_revision: 2,
  report_name: '测试同学', report_ref: 'AP-FAMILY', recipient_username: 'parent.test',
  created_at: 1790000000, expires_at: 1790086400, revoked_at: null, status: 'active' };
const nonce = 'b0bb98bf-4d1b-408c-9d84-a6de34891417';
const comment = { id: 'comment-1', author: 'recipient', body: '希望进一步讨论。', created_at: 1790000001, client_request_id: nonce };
function snapshot() {
  return { format: 'bic-parent-summary', version: 1, shared_at: grant.created_at, expires_at: grant.expires_at,
    report: { name: grant.report_name, grade: '8', year: '2027', batchId: grant.report_ref, date: '2026年10月24日', bankVersion: '2026.10', catalogVersion: '2026.10.24', revision: 2 },
    content: { status: 'draft', direction: '探索方向', personality: '待完成',
      subjects: ['english', 'maths', 'physics', 'chemistry'].map(key => ({ key, name: key, answered: 0, total: 15, pct: null })),
      sections: Object.fromEntries(['summary', 'academic', 'plan', 'personality'].map(key => [key, '请与老师讨论。'])) } };
}
function setup() {
  const window = {};
  const sandbox = { window, URL, AbortController, TextDecoder, setTimeout, clearTimeout };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../js/share-summary.js'), 'utf8'), sandbox);
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../js/cloud-client.js'), 'utf8'), sandbox);
  const calls = [], replies = [];
  const reply = (value, status = 200) => replies.push(new Response(status === 204 ? null : JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } }));
  reply({ status: 'ok', api_version: '2' });
  reply({ user: USER, csrf_token: 's'.repeat(43), expires_at: 1900000000 });
  const client = window.CloudReports.create({ config: { enabled: true, apiBase: '/api/' }, location: new URL('https://school.test/'), fetch: async (url, options) => { calls.push({ url, options }); assert.ok(replies.length); return replies.shift(); } });
  return { client, reply, calls };
}

test('grant creation/list/revoke uses the existing authenticated transport and canonical recipient', async () => {
  const f = setup(); await f.client.connect();
  f.reply(grant, 201);
  assert.equal((await f.client.createParentAccess('report-1', 2, 'parent.test', 24, snapshot().content)).id, 'grant-1');
  assert.deepEqual(JSON.parse(f.calls.at(-1).options.body), { revision: 2, recipient_username: 'parent.test', ttl_hours: 24, content: snapshot().content });
  f.reply({ items: [grant] });
  assert.equal((await f.client.listParentAccess('report-1')).items.length, 1);
  f.reply(null, 204); await f.client.revokeParentAccess('report-1', 'grant-1');
  for (const call of f.calls.slice(2)) assert.equal(call.options.headers['X-CSRF-Token'], 's'.repeat(43));
  assert.equal(f.calls.at(-1).options.method, 'DELETE');
  assert.equal(f.calls.at(-1).url, 'https://school.test/api/reports/report-1/parent-access/grant-1');
});

test('family reads bind page identity and validate the private snapshot/thread contract', async () => {
  const f = setup(); await f.client.connect();
  f.reply({ items: [grant] });
  assert.equal((await f.client.listFamilyAccess()).items[0].report_name, '测试同学');
  f.reply({ grant, snapshot: snapshot(), comments: [comment], participant: 'recipient', can_comment: true });
  const thread = await f.client.familyThread('grant-1');
  assert.equal(thread.snapshot.report.name, '测试同学');
  assert.equal(thread.comments[0].body, comment.body);
  assert.equal(f.calls.at(-1).options.headers['X-CSRF-Token'], 's'.repeat(43));
  assert.equal(f.calls.at(-1).options.credentials, 'same-origin');
});

test('comment posting passes a stable idempotency key without exposing it in the URL', async () => {
  const f = setup(); await f.client.connect(); f.reply(comment, 201);
  assert.equal((await f.client.addFamilyComment('grant-1', comment.body, nonce)).id, comment.id);
  assert.deepEqual(JSON.parse(f.calls.at(-1).options.body), { body: comment.body, client_request_id: nonce });
  assert.equal(f.calls.at(-1).url, 'https://school.test/api/parent-access/grant-1/comments');
  assert.equal(f.calls.at(-1).options.headers['X-CSRF-Token'], 's'.repeat(43));
});

test('invalid grant/comment inputs fail before a request and malformed private responses are rejected', async () => {
  const f = setup(); await f.client.connect(); const count = f.calls.length;
  for (const [body, id] of [[' ', nonce], ['😀'.repeat(501), nonce], ['text', 'not-a-uuid'], ['text', true], ['bad\ud800', nonce]]) {
    await assert.rejects(f.client.addFamilyComment('grant-1', body, id), error => error.code === 'VALIDATION');
  }
  await assert.rejects(f.client.createParentAccess('report-1', 2, 'ab', 24, {}));
  await assert.rejects(f.client.revokeParentAccess('report-1', '../escape'));
  assert.equal(f.calls.length, count);
  for (const value of [{ ...grant, token: 'secret' }, { ...grant, report_id: 'other' }]) {
    f.reply({ items: [value] }); await assert.rejects(f.client.listParentAccess('report-1'), error => error.code === 'PROTOCOL');
  }
  f.reply({ grant, snapshot: { ...snapshot(), answers: {} }, comments: [], participant: 'recipient', can_comment: true });
  await assert.rejects(f.client.familyThread('grant-1'), error => error.code === 'PROTOCOL');
});

test('revoked permission and account changes do not return old private data or automatically replay writes', async () => {
  const f = setup(); await f.client.connect();
  f.reply({ detail: 'do-not-display' }, 403);
  await assert.rejects(f.client.familyThread('grant-1'), error => error.status === 403 && !error.message.includes('do-not-display'));
  assert.equal(f.client.user, null);
  const count = f.calls.length;
  await assert.rejects(f.client.addFamilyComment('grant-1', comment.body, nonce), error => error.status === 401);
  assert.equal(f.calls.length, count);
});

test('a server reply cannot falsely confirm a different draft or idempotency key', async () => {
  const f = setup(); await f.client.connect();
  for (const response of [{ ...comment, body: 'another draft' }, { ...comment, client_request_id: 'a0bb98bf-4d1b-408c-9d84-a6de34891417' }]) {
    f.reply(response, 201);
    await assert.rejects(f.client.addFamilyComment('grant-1', comment.body, nonce), error => error.code === 'PROTOCOL');
  }
});
