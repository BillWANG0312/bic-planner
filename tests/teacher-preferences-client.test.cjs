const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const plain = value => JSON.parse(JSON.stringify(value));
function setup() {
  const w = {};
  for (const file of ['academic-scoring-meta.js', 'preference-schema.js', 'cloud-client.js', 'teacher-summary.js']) vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../js', file), 'utf8'), { window: w, Date, URL, AbortController, TextDecoder, setTimeout, clearTimeout });
  const replies = [], calls = [], reply = value => replies.push(new Response(JSON.stringify(value), { status: 200, headers: { 'Content-Type': 'application/json' } }));
  reply({ status: 'ok', api_version: '2' }); reply({ user: { id: 'teacher', username: 'teacher.local', role: 'advisor' }, csrf_token: 's'.repeat(43), expires_at: 1_900_000_000 });
  const client = w.CloudReports.create({ config: { enabled: true, apiBase: '/api/' }, location: new URL('https://school.test/'), fetch: async (url, options) => { calls.push({ url, options }); const next = replies.shift(); if (next instanceof Error) throw next; assert.ok(next, 'No retry or fallback'); return next; } });
  const payload = (academic = false, preferences = false) => {
    const now = Math.floor(Date.now() / 1000), version = preferences ? 3 : academic ? 2 : 1;
    const grant = { id: 'grant-one', report_id: 'report-one', report_revision: 1, report_name: '边界学员', report_ref: 'REF-ONE', owner_username: 'owner.local', recipient_username: 'teacher.local', scope: 'full_report_read_only', created_at: now - 10, expires_at: now + 86400, revoked_at: null, status: 'active' };
    const report = { id: 'report-one', revision: 1, name: grant.report_name, report_ref: grant.report_ref, grade: '8', bank_version: '2026.10', catalog_version: null, status: 'draft', academic: ['english', 'maths', 'physics', 'chemistry'].map(key => ({ key, answered: 0, total: 15 })), planning: { answered: 2, total: 14, required_answered: 2, required_total: 13 }, personality: { answered: 0, total: 24 } };
    if (academic) report.performance = ['english', 'maths', 'physics', 'chemistry'].map(key => ({ key, complete: false, pct: null }));
    if (preferences) report.preferences = { preferredMajor: { answered: true, choices: ['tech', 'unsure'] }, countries: { answered: true, choices: ['uk', 'hk', 'unsure'] } };
    return { format: 'bic-teacher-completion-summary', version, items: [{ grant, report }], ...(academic ? { scoring: plain(w.BIC_ACADEMIC_SCORING_META) } : {}), ...(preferences ? { options: { academic, preferences: true }, preference_schema: plain(w.BIC_PREFERENCE_SCHEMA.metadata) } : {}) };
  };
  return { client, reply, replies, calls, payload };
}
test('all four summary modes omit false flags and bind version and options', async () => {
  const f = setup(); await f.client.connect();
  for (const options of [undefined, { academic: false, preferences: false }, { academic: true }, { preferences: true }, { academic: true, preferences: true }]) {
    const academic = options?.academic === true, preferences = options?.preferences === true, expected = f.payload(academic, preferences); f.reply(expected);
    assert.deepEqual(plain(await f.client.readTeacherSummaries(['grant-one'], options)), expected);
    assert.deepEqual(JSON.parse(f.calls.at(-1).options.body), { grant_ids: ['grant-one'], ...(academic ? { academic: true } : {}), ...(preferences ? { preferences: true } : {}) });
  }
});
test('invalid preference options fail before a request', async () => {
  const f = setup(); await f.client.connect(); const count = f.calls.length;
  for (const options of [null, [], true, { preferences: 1 }, { preferences: 'true' }, { preferences: null }, { preferences: true, extra: true }]) await assert.rejects(f.client.readTeacherSummaries(['grant-one'], options));
  assert.equal(f.calls.length, count);
});
test('v3 cannot silently substitute modes metadata choices or raw answers', async () => {
  const f = setup(); await f.client.connect();
  for (const [response, requested] of [[f.payload(), { preferences: true }], [f.payload(false, true), {}], [f.payload(true, true), { preferences: true }], [f.payload(false, true), { academic: true, preferences: true }]]) {
    f.reply(response); await assert.rejects(f.client.readTeacherSummaries(['grant-one'], requested), error => error.code === 'PROTOCOL');
  }
  for (const alter of [v => { v.preference_schema.schema_fingerprint = '0'.repeat(64); }, v => { v.items[0].report.preferences.preferredMajor.choices = ['cs']; }, v => { v.items[0].report.answers = {}; }, v => { v.options.extra = true; }]) {
    const value = f.payload(false, true); alter(value); f.reply(value); await assert.rejects(f.client.readTeacherSummaries(['grant-one'], { preferences: true }), error => error.code === 'PROTOCOL');
  }
});
test('failed preference request never retries or requests answer sheets', async () => {
  const f = setup(); await f.client.connect(); const count = f.calls.length; f.replies.push(new TypeError('network lost'));
  await assert.rejects(f.client.readTeacherSummaries(['grant-one'], { preferences: true }), error => error.code === 'NETWORK');
  assert.equal(f.calls.length, count + 1); assert.equal(f.calls.at(-1).url, 'https://school.test/api/teacher-summaries');
});
