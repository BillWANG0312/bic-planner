const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const DRAFT_ID = '11111111-1111-4111-8111-111111111111';
const sections = () => ({ summary: '当前结论', academic: '当前学习建议', plan: '当前规划建议', personality: '当前学习策略' });
const context = () => ({ status: 'draft', direction_id: 'math', personality_complete: false, personality_code: null,
  subjects: ['english', 'maths', 'physics', 'chemistry'].map(key => ({ key, answered: 0, total: 15, pct: null })) });
function draft(extra = {}) { return { id: DRAFT_ID, report_id: 'report-one', source_revision: 4,
  created_at: 1_790_000_000, expires_at: 1_790_000_900, kind: 'local_mock', generator: 'local-demo-v1', reason: 'generated',
  before: sections(), sections: { ...sections(), summary: '待核对的新结论' }, ...extra }; }
function setup() {
  const window = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../js/cloud-client.js'), 'utf8'), { window, URL, AbortController, TextDecoder, setTimeout, clearTimeout });
  const calls = [], replies = [];
  const reply = (value, status = 200) => replies.push(new Response(status === 204 ? null : JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } }));
  reply({ status: 'ok', api_version: '2' });
  reply({ user: { id: 'owner', username: 'advisor.local', role: 'advisor' }, csrf_token: 's'.repeat(43), expires_at: 1_900_000_000 });
  const client = window.CloudReports.create({ config: { enabled: true, apiBase: '/api/' }, location: new URL('https://school.test/'),
    fetch: async (url, options) => { calls.push({ url, options }); const next = replies.shift(); if (next instanceof Error) throw next; assert.ok(next, 'No unexpected retry'); return next; } });
  return { client, calls, reply, replies };
}

test('draft generation and explicit application bind report revision and private session without retry', async () => {
  const f = setup(); await f.client.connect(); f.reply(draft(), 201);
  const result = await f.client.createAdviceDraft('report-one', 4, context(), sections());
  assert.equal(result.kind, 'local_mock');
  let call = f.calls.at(-1);
  assert.equal(call.url, 'https://school.test/api/reports/report-one/advice-drafts');
  assert.equal(call.options.headers['X-CSRF-Token'], 's'.repeat(43));
  assert.deepEqual(JSON.parse(call.options.body), { revision: 4, context: context(), fallback: sections() });
  f.reply({ id: 'report-one', revision: 5, record: { id: 'local-one' } });
  await f.client.applyAdviceDraft('report-one', DRAFT_ID, ['summary'], '核对老师');
  call = f.calls.at(-1);
  assert.equal(call.url, `https://school.test/api/reports/report-one/advice-drafts/${DRAFT_ID}/apply`);
  assert.deepEqual(JSON.parse(call.options.body), { sections: ['summary'], reviewer: '核对老师' });
  assert.equal(call.options.credentials, 'same-origin');
});

test('draft context rejects identifiers, free text, answer sheets and invalid scales before sending', async () => {
  const f = setup(); await f.client.connect(); const before = f.calls.length;
  for (const bad of [{ ...context(), name: '不得外发学生' }, { ...context(), fallback: sections() },
    { ...context(), answers: { ph3: 0 } }, { ...context(), direction_id: 'private-name' },
    { ...context(), personality_code: 'ESTJ' }, { ...context(), subjects: context().subjects.map(v => ({ ...v, name: '自由文字' })) },
    { ...context(), subjects: context().subjects.map(v => ({ ...v, answered: true })) }]) {
    await assert.rejects(f.client.createAdviceDraft('report-one', 4, bad, sections()), error => error.code === 'VALIDATION');
  }
  assert.equal(f.calls.length, before);
});

test('wrong report/revision, unknown fields and invalid proposal text cannot become a draft', async () => {
  const f = setup(); await f.client.connect();
  for (const bad of [draft({ report_id: 'other' }), draft({ source_revision: 5 }), draft({ owner_id: 'secret' }),
    draft({ kind: 'AI-certified' }), draft({ sections: { ...sections(), extra: 'bad' } }), draft({ sections: { ...sections(), summary: ' ' } })]) {
    f.reply(bad);
    await assert.rejects(f.client.createAdviceDraft('report-one', 4, context(), sections()), error => error.code === 'PROTOCOL');
  }
});

test('invalid application choices and uncertain network results never trigger automatic application retries', async () => {
  const f = setup(); await f.client.connect(); const before = f.calls.length;
  for (const chosen of [[], ['summary', 'summary'], ['grade'], ['summary', 'academic', 'plan', 'personality', 'summary']]) {
    await assert.rejects(f.client.applyAdviceDraft('report-one', DRAFT_ID, chosen, '核对老师'), error => error.code === 'VALIDATION');
  }
  await assert.rejects(f.client.applyAdviceDraft('report-one', DRAFT_ID, ['summary'], ' '));
  assert.equal(f.calls.length, before);
  f.replies.push(new TypeError('network lost'));
  await assert.rejects(f.client.applyAdviceDraft('report-one', DRAFT_ID, ['summary'], '核对老师'), error => error.code === 'NETWORK');
  assert.equal(f.calls.length, before + 1);
});
