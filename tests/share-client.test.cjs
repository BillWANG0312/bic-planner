const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function setup() {
  const window = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../js/cloud-client.js'), 'utf8'), { window, URL, AbortController, TextDecoder, setTimeout, clearTimeout });
  const calls = [];
  const responses = [new Response(JSON.stringify({ status: 'ok', api_version: '2' }), { headers: { 'Content-Type': 'application/json' } }),
    new Response(JSON.stringify({ user: { id: 'owner-1', username: 'owner', role: 'advisor' }, csrf_token: 's'.repeat(43), expires_at: 1900000000 }), { headers: { 'Content-Type': 'application/json' } })];
  const client = window.CloudReports.create({ config: { enabled: true, apiBase: '/api/' }, location: new URL('https://school.test/'), fetch: async (url, options) => { calls.push({ url, options }); return responses.shift(); } });
  const reply = (body, status = 200) => responses.push(new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
  return { client, calls, reply };
}
const meta = { id: 'share-1', report_id: 'report-1', report_revision: 1, created_at: 1790000000, expires_at: 1790086400, revoked_at: null, status: 'active' };

test('owner share creation/list/revoke bind the session, revision and selected report', async () => {
  const f = setup();
  await f.client.connect();
  f.reply({ ...meta, token: 't'.repeat(43) }, 201);
  const share = await f.client.createShare('report-1', 1, 24, { status: 'draft' });
  assert.equal(share.token, 't'.repeat(43));
  const created = f.calls.at(-1);
  assert.equal(created.url, 'https://school.test/api/reports/report-1/shares');
  assert.equal(created.options.headers['X-CSRF-Token'], 's'.repeat(43));
  assert.equal(JSON.parse(created.options.body).revision, 1);
  f.reply({ items: [meta] });
  assert.equal((await f.client.listShares('report-1')).items.length, 1);
  assert.equal(f.calls.at(-1).options.headers['X-CSRF-Token'], 's'.repeat(43));
  f.reply(null, 204);
  await f.client.revokeShare('report-1', 'share-1');
  assert.equal(f.calls.at(-1).options.method, 'DELETE');
  assert.ok(!f.calls.some(call => call.url.includes('t'.repeat(43))));
});

test('share metadata cannot introduce a plaintext token or another report into a listing', async () => {
  const f = setup();
  await f.client.connect();
  for (const item of [{ ...meta, token: 't'.repeat(43) }, { ...meta, report_id: 'other' }]) {
    f.reply({ items: [item] });
    await assert.rejects(f.client.listShares('report-1'), error => error.code === 'PROTOCOL');
  }
});

test('invalid TTL or identifiers are rejected before sending a share request', async () => {
  const f = setup();
  await f.client.connect();
  const count = f.calls.length;
  await assert.rejects(f.client.createShare('report-1', 1, 1, {}));
  await assert.rejects(f.client.revokeShare('report-1', '../escape'));
  assert.equal(f.calls.length, count);
});
