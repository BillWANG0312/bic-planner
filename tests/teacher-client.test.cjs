const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { loadReportScripts, legacyState: state } = require('./helpers/report.cjs');
const plain = value => JSON.parse(JSON.stringify(value));
function grant(extra = {}) {
  const now = Math.floor(Date.now() / 1000);
  return { id: 'grant-one', report_id: 'report-one', report_revision: 4, report_name: '只读学员', report_ref: 'AP-TEACHER',
    owner_username: 'owner.local', recipient_username: 'teacher.local', scope: 'full_report_read_only',
    created_at: now, expires_at: now + 86400, revoked_at: null, status: 'active', ...extra };
}
function setup(teacher = false) {
  const w = loadReportScripts();
  for (const filename of ['report-store.js', 'cloud-client.js']) vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../js', filename), 'utf8'),
    { window: w, Date, URL, AbortController, TextDecoder, setTimeout, clearTimeout });
  let raw = null;
  const value = state(w); value.info.name = '只读学员'; value.report = w.generateReport(value); value.report.meta.batchId = 'AP-TEACHER';
  w.reportEditing.applyEdit(value.report, 'summary', '<b>私密只读建议</b>', '原审核者');
  const record = w.ReportStore.create({ getItem: () => raw, setItem: (_, text) => { raw = text; } }).save(value).record;
  Object.defineProperty(w, 'localStorage', { get() { throw new Error('No real storage access'); } });
  const calls = [], replies = [];
  const reply = (data, status = 200) => replies.push(new Response(status === 204 ? null : JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } }));
  reply({ status: 'ok', api_version: '2' });
  reply({ user: { id: teacher ? 'teacher' : 'owner', username: teacher ? 'teacher.local' : 'owner.local', role: teacher ? 'advisor' : 'student' }, csrf_token: 's'.repeat(43), expires_at: 1_900_000_000 });
  const client = w.CloudReports.create({ config: { enabled: true, apiBase: '/api/' }, location: new URL('https://school.test/'),
    fetch: async (url, options) => { calls.push({ url, options }); const next = replies.shift(); if (next instanceof Error) throw next; assert.ok(next, 'No unrequested retry'); return next; } });
  return { client, calls, replies, reply, full: () => ({ id: 'report-one', revision: 4, created_at: '2026-10-25T00:00:00Z', updated_at: '2026-10-25T00:00:00Z', record: plain(record) }) };
}

test('owner teacher grants use explicit full readonly scope, revision and private CSRF', async () => {
  const f = setup(); await f.client.connect(); f.reply(grant(), 201);
  await f.client.createTeacherAccess('report-one', 4, 'TEACHER.LOCAL', 24);
  const call = f.calls.at(-1);
  assert.equal(call.url, 'https://school.test/api/reports/report-one/teacher-access');
  assert.equal(call.options.headers['X-CSRF-Token'], 's'.repeat(43));
  assert.equal(call.options.credentials, 'same-origin');
  assert.deepEqual(JSON.parse(call.options.body), { revision: 4, recipient_username: 'teacher.local', ttl_hours: 24, scope: 'full_report_read_only' });
  f.reply({ items: [grant({ status: 'source_changed' })] });
  assert.equal((await f.client.listTeacherAccess('report-one')).items[0].status, 'source_changed');
  f.reply(null, 204); await f.client.revokeTeacherAccess('report-one', 'grant-one');
  assert.match(f.calls.at(-1).url, /reports\/report-one\/teacher-access\/grant-one$/);
  assert.equal(f.calls.at(-1).options.method, 'DELETE');
});

test('teacher reads only strict active recipient-bound complete archive responses without browser storage', async () => {
  const f = setup(true); await f.client.connect(); f.reply({ items: [grant()] });
  assert.equal((await f.client.listTeacherReports()).items.length, 1);
  assert.equal(f.calls.at(-1).options.headers['X-CSRF-Token'], 's'.repeat(43));
  const full = f.full(); f.reply({ grant: grant(), report: full });
  assert.deepEqual(plain((await f.client.readTeacherReport('grant-one')).report), full);
  assert.equal(f.calls.at(-1).url, 'https://school.test/api/teacher-access/grant-one');
});

test('malformed scope metadata, wrong owner, duplicate lists and unsupported statuses are rejected', async () => {
  const f = setup(); await f.client.connect();
  for (const changed of [{ scope: 'edit' }, { status: 'certified' }, { owner_username: 'other.local' }, { expires_at: 0 }, { report_revision: true }, { private_answer: 'secret' }]) {
    f.reply(grant(changed));
    await assert.rejects(f.client.createTeacherAccess('report-one', 4, 'teacher.local', 24), error => error.code === 'PROTOCOL');
  }
  f.reply({ items: [grant(), grant()] }); await assert.rejects(f.client.listTeacherAccess('report-one'), error => error.code === 'PROTOCOL');
});

test('recipient lists and detail cannot adopt another account, revision, report or malformed source record', async () => {
  const f = setup(true); await f.client.connect();
  for (const altered of [grant({ recipient_username: 'other.local' }), grant({ status: 'expired' })]) {
    f.reply({ items: [altered] }); await assert.rejects(f.client.listTeacherReports(), error => error.code === 'PROTOCOL');
  }
  const cases = [
    { grant: grant({ id: 'other' }), report: f.full() },
    { grant: grant({ report_revision: 5 }), report: f.full() },
    { grant: grant({ report_name: '另一个学生' }), report: f.full() },
    { grant: grant({ report_ref: 'OTHER' }), report: f.full() },
    { grant: grant({ status: 'revoked', revoked_at: Math.floor(Date.now() / 1000) }), report: f.full() },
    { grant: grant(), report: { ...f.full(), owner_id: 'private-owner' } },
    { grant: grant(), report: { ...f.full(), created_at: 'invalid' } }
  ];
  const broken = f.full(); broken.record.state.academic.answers.ph3 = true; cases.push({ grant: grant(), report: broken });
  for (const value of cases) { f.reply(value); await assert.rejects(f.client.readTeacherReport('grant-one'), error => error.code === 'PROTOCOL'); }
});

test('invalid requests and student recipient entry points are rejected before requests', async () => {
  const f = setup(); await f.client.connect(); const before = f.calls.length;
  for (const [id, revision, user, ttl] of [['../bad', 4, 'teacher.local', 24], ['report-one', true, 'teacher.local', 24], ['report-one', 4, 'bad name', 24], ['report-one', 4, 'teacher.local', 48]]) {
    await assert.rejects(f.client.createTeacherAccess(id, revision, user, ttl));
  }
  await assert.rejects(f.client.listTeacherReports()); await assert.rejects(f.client.readTeacherReport('grant-one'));
  assert.equal(f.calls.length, before);
});

test('an uncertain grant creation is not retried and cannot silently create more authorizations', async () => {
  const f = setup(); await f.client.connect(); const before = f.calls.length;
  f.replies.push(new TypeError('network lost'));
  await assert.rejects(f.client.createTeacherAccess('report-one', 4, 'teacher.local', 24), error => error.code === 'NETWORK');
  assert.equal(f.calls.length, before + 1);
});
