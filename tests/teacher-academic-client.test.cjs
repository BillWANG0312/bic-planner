const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const plain = value => JSON.parse(JSON.stringify(value));
function fixture(scoring, version = 1) {
  const now = Math.floor(Date.now() / 1000);
  const grant = { id: 'grant-one', report_id: 'report-one', report_revision: 1, report_name: '版本核对学员', report_ref: 'REF-ONE', owner_username: 'owner.local', recipient_username: 'teacher.local', scope: 'full_report_read_only', created_at: now - 10, expires_at: now + 86400, revoked_at: null, status: 'active' };
  const report = { id: 'report-one', revision: 1, name: grant.report_name, report_ref: grant.report_ref, grade: '8', bank_version: '2026.10', catalog_version: null, status: 'draft',
    academic: ['english', 'maths', 'physics', 'chemistry'].map((key, i) => ({ key, answered: version === 2 && i < 2 ? 15 : 0, total: 15 })), planning: { answered: 1, total: 12, required_answered: 1, required_total: 12 }, personality: { answered: 0, total: 30 } };
  if (version === 2) report.performance = ['english', 'maths', 'physics', 'chemistry'].map((key, i) => ({ key, complete: i < 2, pct: i === 0 ? 0 : i === 1 ? 100 : null }));
  return { format: 'bic-teacher-completion-summary', version, items: [{ grant, report }], ...(version === 2 ? { scoring: plain(scoring) } : {}) };
}
function setup() {
  const w = { BIC_ACADEMIC_SCORING_META: { bank_version: '2026.10', rule_version: 'academic-pct-v1', rule_fingerprint: 'a'.repeat(64), basis: 'current_local_rules_recomputed', incomplete_policy: 'not_scored', calibration: 'not_calibrated' } };
  for (const filename of ['academic-scoring-meta.js', 'cloud-client.js', 'teacher-summary.js']) {
    const file = path.join(__dirname, '../js', filename); if (fs.existsSync(file)) vm.runInNewContext(fs.readFileSync(file, 'utf8'), { window: w, Date, URL, AbortController, TextDecoder, setTimeout, clearTimeout });
  }
  const replies = [], calls = [], reply = value => replies.push(new Response(JSON.stringify(value), { status: 200, headers: { 'Content-Type': 'application/json' } }));
  reply({ status: 'ok', api_version: '2' }); reply({ user: { id: 'teacher', username: 'teacher.local', role: 'advisor' }, csrf_token: 's'.repeat(43), expires_at: 1_900_000_000 });
  const client = w.CloudReports.create({ config: { enabled: true, apiBase: '/api/' }, location: new URL('https://school.test/'), fetch: async (url, options) => { calls.push({ url, options }); const next = replies.shift(); if (next instanceof Error) throw next; assert.ok(next, 'No retry or fallback'); return next; } });
  return { w, client, reply, replies, calls, payload: version => fixture(w.BIC_ACADEMIC_SCORING_META, version) };
}

test('academic mode is opt-in, while absent and false preserve v1 wire requests', async () => {
  const f = setup(); await f.client.connect();
  for (const options of [undefined, { academic: false }]) { f.reply(f.payload(1)); const result = await f.client.readTeacherSummaries(['grant-one'], options); assert.equal(result.version, 1); assert.deepEqual(JSON.parse(f.calls.at(-1).options.body), { grant_ids: ['grant-one'] }); }
  const expected = f.payload(2); f.reply(expected); assert.deepEqual(plain(await f.client.readTeacherSummaries(['grant-one'], { academic: true })), expected);
  assert.deepEqual(JSON.parse(f.calls.at(-1).options.body), { grant_ids: ['grant-one'], academic: true });
  assert.equal(f.calls.at(-1).options.headers['X-CSRF-Token'], 's'.repeat(43));
});

test('invalid academic flags are rejected before any request', async () => {
  const f = setup(); await f.client.connect(); const count = f.calls.length;
  for (const options of [null, [], true, { academic: 1 }, { academic: 'true' }, { academic: null }, { academic: true, extra: true }]) await assert.rejects(f.client.readTeacherSummaries(['grant-one'], options));
  assert.equal(f.calls.length, count);
});

test('silent version downgrade upgrade and mismatched rule fingerprints fail closed', async () => {
  const f = setup(); await f.client.connect();
  f.reply(f.payload(1)); await assert.rejects(f.client.readTeacherSummaries(['grant-one'], { academic: true }), e => e.code === 'PROTOCOL');
  f.reply(f.payload(2)); await assert.rejects(f.client.readTeacherSummaries(['grant-one']), e => e.code === 'PROTOCOL');
  for (const alter of [v => { v.scoring.rule_fingerprint = 'b'.repeat(64); }, v => { v.items[0].report.performance[2].pct = 0; }, v => { v.scoring.answer = 'secret'; }]) {
    const payload = f.payload(2); alter(payload); f.reply(payload); await assert.rejects(f.client.readTeacherSummaries(['grant-one'], { academic: true }), e => e.code === 'PROTOCOL');
  }
});

test('failed v2 reads never retry or request original answer sheets', async () => {
  const f = setup(); await f.client.connect(); const count = f.calls.length; f.replies.push(new TypeError('network lost'));
  await assert.rejects(f.client.readTeacherSummaries(['grant-one'], { academic: true }), e => e.code === 'NETWORK');
  assert.equal(f.calls.length, count + 1); assert.equal(f.calls.at(-1).url, 'https://school.test/api/teacher-summaries');
});
