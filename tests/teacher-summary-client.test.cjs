const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const plain = value => JSON.parse(JSON.stringify(value));
function batch(ids = ['grant-one']) {
  const now = Math.floor(Date.now() / 1000);
  return { format: 'bic-teacher-completion-summary', version: 1, items: ids.map((id, index) => ({
    grant: { id, report_id: 'report-' + index, report_revision: 2, report_name: '学员' + index, report_ref: 'REF-' + index,
      owner_username: 'owner.local', recipient_username: 'teacher.local', scope: 'full_report_read_only', created_at: now - 10, expires_at: now + 86400, revoked_at: null, status: 'active' },
    report: { id: 'report-' + index, revision: 2, name: '学员' + index, report_ref: 'REF-' + index, grade: '8', bank_version: '2026.10', catalog_version: null, status: 'draft',
      academic: ['english', 'maths', 'physics', 'chemistry'].map(key => ({ key, answered: 0, total: 15 })),
      planning: { answered: 1, total: 14, required_answered: 1, required_total: 13 }, personality: { answered: 0, total: 24 } }
  })) };
}
function setup(advisor = true) {
  const w = {}, calls = [], replies = [];
  for (const filename of ['cloud-client.js', 'teacher-summary.js']) {
    const file = path.join(__dirname, '../js', filename);
    if (fs.existsSync(file)) vm.runInNewContext(fs.readFileSync(file, 'utf8'), { window: w, Date, URL, AbortController, TextDecoder, setTimeout, clearTimeout });
  }
  const reply = (value, status = 200) => replies.push(new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } }));
  reply({ status: 'ok', api_version: '2' }); reply({ user: { id: 'user-one', username: 'teacher.local', role: advisor ? 'advisor' : 'student' }, csrf_token: 's'.repeat(43), expires_at: 1_900_000_000 });
  const client = w.CloudReports.create({ config: { enabled: true, apiBase: '/api/' }, location: new URL('https://school.test/teacher-summary.html'),
    fetch: async (url, options) => { calls.push({ url, options }); const next = replies.shift(); if (next instanceof Error) throw next; assert.ok(next, 'No unrequested retry'); return next; } });
  return { client, calls, reply, replies };
}

test('only explicitly selected grants enter a readonly batch POST with page identity binding', async () => {
  const f = setup(); await f.client.connect(); const expected = batch(['grant-two', 'grant-one']); f.reply(expected);
  assert.deepEqual(plain(await f.client.readTeacherSummaries(['grant-two', 'grant-one'])), expected);
  const call = f.calls.at(-1); assert.equal(call.url, 'https://school.test/api/teacher-summaries'); assert.equal(call.options.method, 'POST');
  assert.equal(call.options.headers['X-CSRF-Token'], 's'.repeat(43)); assert.equal(call.options.credentials, 'same-origin');
  assert.deepEqual(JSON.parse(call.options.body), { grant_ids: ['grant-two', 'grant-one'] });
});

test('summary response cannot replace selected grants, identity, scope or valid count shapes', async () => {
  const f = setup(); await f.client.connect();
  for (const alter of [v => { v.items[0].grant.id = 'unselected'; }, v => { v.items[0].grant.recipient_username = 'other.local'; },
    v => { v.items[0].grant.scope = 'full_report_advice_edit'; }, v => { v.items[0].report.academic[0].answered = true; },
    v => { v.items[0].report.answers = { secret: 1 }; }, v => { v.items[0].grant.status = 'expired'; }]) {
    const value = batch(); alter(value); f.reply(value);
    await assert.rejects(f.client.readTeacherSummaries(['grant-one']), error => error.code === 'PROTOCOL');
  }
  f.reply(batch(['grant-one', 'grant-two'])); await assert.rejects(f.client.readTeacherSummaries(['grant-two', 'grant-one']), error => error.code === 'PROTOCOL');
});

test('invalid selection and student role fail before networking', async () => {
  const f = setup(); await f.client.connect(); const before = f.calls.length;
  for (const ids of [[], ['grant-one', 'grant-one'], ['../bad'], [true], Array.from({ length: 21 }, (_, i) => 'grant-' + i), 'grant-one']) await assert.rejects(f.client.readTeacherSummaries(ids));
  assert.equal(f.calls.length, before);
  const student = setup(false); await student.client.connect(); const count = student.calls.length;
  await assert.rejects(student.client.readTeacherSummaries(['grant-one'])); assert.equal(student.calls.length, count);
});

test('a failed freshness check does not retry or silently fall back to a full report read', async () => {
  const f = setup(); await f.client.connect(); const before = f.calls.length; f.replies.push(new TypeError('network lost'));
  await assert.rejects(f.client.readTeacherSummaries(['grant-one']), error => error.code === 'NETWORK');
  assert.equal(f.calls.length, before + 1); assert.equal(f.calls.at(-1).url, 'https://school.test/api/teacher-summaries');
});
