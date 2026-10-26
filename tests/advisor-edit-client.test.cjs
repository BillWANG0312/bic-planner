const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { loadReportScripts, legacyState: state } = require('./helpers/report.cjs');
const plain = value => JSON.parse(JSON.stringify(value));
const baseline = { summary: '原核心建议', academic: '原学科建议', plan: '原规划建议', personality: '原策略建议' };
const actorId = '11111111-2222-4333-8444-555555555555', grantId = '22222222-3333-4444-8555-666666666666';
function grant(extra = {}) {
  const now = Math.floor(Date.now() / 1000);
  return { id: grantId, report_id: 'report-one', report_revision: 4, report_name: '编辑学员', report_ref: 'AP-EDIT',
    owner_username: 'owner.local', recipient_username: 'advisor.local', scope: 'full_report_advice_edit',
    created_at: now, expires_at: now + 86400, revoked_at: null, status: 'active', ...extra };
}
function setup(advisor = false) {
  const w = loadReportScripts();
  for (const filename of ['report-store.js', 'cloud-client.js']) vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../js', filename), 'utf8'),
    { window: w, Date, URL, AbortController, TextDecoder, setTimeout, clearTimeout });
  let raw = null;
  const value = state(w); value.info.name = '编辑学员'; value.report = w.generateReport(value); value.report.meta.batchId = 'AP-EDIT';
  const record = w.ReportStore.create({ getItem: () => raw, setItem: (_, text) => { raw = text; } }).save(value).record;
  Object.defineProperty(w, 'localStorage', { get() { throw new Error('No real storage access'); } });
  const calls = [], replies = [];
  const reply = (data, status = 200) => replies.push(new Response(status === 204 ? null : JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } }));
  reply({ status: 'ok', api_version: '2' });
  reply({ user: { id: advisor ? actorId : 'owner', username: advisor ? 'advisor.local' : 'owner.local', role: advisor ? 'advisor' : 'student' }, csrf_token: 's'.repeat(43), expires_at: 1_900_000_000 });
  const client = w.CloudReports.create({ config: { enabled: true, apiBase: '/api/' }, location: new URL('https://school.test/'),
    fetch: async (url, options) => { calls.push({ url, options }); const next = replies.shift(); if (next instanceof Error) throw next; assert.ok(next, 'No unrequested retry'); return next; } });
  return { client, calls, replies, reply, full: () => ({ id: 'report-one', revision: 4, created_at: '2026-10-25T00:00:00Z', updated_at: '2026-10-25T00:00:00Z', record: plain(record) }) };
}
function applied(f) {
  const full = f.full(); full.revision = 5;
  full.record.advisor = { sections: { summary: '新建议' }, lastAuthor: '学校顾问', history: [{
    id: 'entry-one', at: '2026-10-25T00:10:00Z', author: '学校顾问', section: 'summary', before: baseline.summary, after: '新建议', action: 'edit', reportId: 'AP-EDIT',
    actor: { kind: 'school_advisor', user_id: actorId, username: 'advisor.local', grant_id: grantId, source_revision: 4, result_revision: 5 }
  }] };
  return { report: full, changed_sections: ['summary'], audit_id: 'audit-one' };
}

test('owner edit grants require a new explicit scope and exact four-section baseline', async () => {
  const f = setup(); await f.client.connect(); f.reply(grant(), 201);
  await f.client.createAdvisorEditAccess('report-one', 4, 'ADVISOR.LOCAL', 24, baseline);
  assert.deepEqual(JSON.parse(f.calls.at(-1).options.body), { revision: 4, recipient_username: 'advisor.local', ttl_hours: 24, scope: 'full_report_advice_edit', baseline });
  assert.match(f.calls.at(-1).url, /reports\/report-one\/advisor-edit-access$/);
  assert.equal(f.calls.at(-1).options.headers['X-CSRF-Token'], 's'.repeat(43));
  f.reply({ items: [grant({ status: 'source_changed' })] }); assert.equal((await f.client.listAdvisorEditAccess('report-one')).items.length, 1);
  f.reply(null, 204); await f.client.revokeAdvisorEditAccess('report-one', grantId); assert.equal(f.calls.at(-1).options.method, 'DELETE');
});

test('recipient reads baseline and full archive only in explicit edit scope without storage', async () => {
  const f = setup(true); await f.client.connect(); f.reply({ items: [grant()] });
  assert.equal((await f.client.listAdvisorEditable()).items.length, 1);
  const expected = { grant: grant(), report: f.full(), baseline }; f.reply(expected);
  assert.deepEqual(plain(await f.client.readAdvisorEditable(grantId)), expected);
  assert.match(f.calls.at(-1).url, /advisor-edit-access\//);
  assert.equal(f.calls.at(-1).options.headers['X-CSRF-Token'], 's'.repeat(43));
});

test('selected changes use strict text-only PUT and validate server actor and resulting revision', async () => {
  const f = setup(true); await f.client.connect(); f.reply(applied(f));
  const response = await f.client.applyAdvisorEdit(grantId, 4, { summary: '新建议' });
  assert.equal(response.report.revision, 5);
  assert.equal(f.calls.at(-1).options.method, 'PUT');
  assert.deepEqual(JSON.parse(f.calls.at(-1).options.body), { revision: 4, changes: { summary: '新建议' } });
  for (const alter of [v => { v.report.revision = 6; }, v => { v.report.record.advisor.history[0].actor.username = 'other.local'; },
    v => { v.report.record.advisor.history[0].actor.grant_id = actorId; }, v => { v.changed_sections = ['academic']; },
    v => { v.report.record.advisor.sections.summary = '服务端不符'; }, v => { v.private_data = 'extra'; }]) {
    const value = applied(f); alter(value); f.reply(value);
    await assert.rejects(f.client.applyAdvisorEdit(grantId, 4, { summary: '新建议' }), e => e.code === 'PROTOCOL');
  }
});

test('malformed scopes baselines owner or recipient binding and corrupted archives fail closed', async () => {
  const f = setup(true); await f.client.connect();
  for (const value of [
    { grant: grant({ scope: 'full_report_read_only' }), report: f.full(), baseline },
    { grant: grant({ recipient_username: 'other.local' }), report: f.full(), baseline },
    { grant: grant(), report: f.full(), baseline: { summary: 'missing' } },
    { grant: grant(), report: { ...f.full(), revision: 5 }, baseline },
    { grant: grant(), report: f.full(), baseline: { ...baseline, score: 100 } }
  ]) { f.reply(value); await assert.rejects(f.client.readAdvisorEditable(grantId), e => e.code === 'PROTOCOL'); }
  f.reply({ items: [grant(), grant()] }); await assert.rejects(f.client.listAdvisorEditable(), e => e.code === 'PROTOCOL');
});

test('invalid edit and student requests fail before networking; uncertain writes are never retried', async () => {
  const owner = setup(); await owner.client.connect(); const before = owner.calls.length;
  await assert.rejects(owner.client.listAdvisorEditable()); await assert.rejects(owner.client.applyAdvisorEdit(grantId, 4, { summary: 'x' }));
  await assert.rejects(owner.client.createAdvisorEditAccess('report-one', 4, 'advisor.local', 24, { summary: 'missing' }));
  assert.equal(owner.calls.length, before);
  const f = setup(true); await f.client.connect(); const count = f.calls.length;
  for (const changes of [{}, { summary: '' }, { score: 100 }, { summary: 'x'.repeat(4001) }, { summary: null }, { summary: true }]) {
    await assert.rejects(f.client.applyAdvisorEdit(grantId, 4, changes));
  }
  assert.equal(f.calls.length, count);
  f.replies.push(new TypeError('lost after write'));
  await assert.rejects(f.client.applyAdvisorEdit(grantId, 4, { summary: '新建议' }), e => e.code === 'NETWORK');
  assert.equal(f.calls.length, count + 1);
});

test('owner audit list has strict report binding actual actor and no arbitrary payload', async () => {
  const f = setup(); await f.client.connect();
  const row = { id: 'audit-one', grant_id: grantId, report_id: 'report-one', actor_id: actorId, actor_username: 'advisor.local',
    source_revision: 4, result_revision: 5, created_at: Math.floor(Date.now() / 1000), changes: [{ section: 'summary', before: '原建议', after: '新建议' }] };
  f.reply({ items: [row] }); assert.deepEqual(plain(await f.client.listAdvisorAudit('report-one')), { items: [row] });
  assert.match(f.calls.at(-1).url, /reports\/report-one\/advisor-edits$/);
  for (const value of [{ ...row, report_id: 'other-report' }, { ...row, actor_username: 'FORGED' }, { ...row, changes: [{ section: 'score', before: '', after: '100' }] }, { ...row, result_revision: 8 }, { ...row, secret: true }]) {
    f.reply({ items: [value] }); await assert.rejects(f.client.listAdvisorAudit('report-one'), e => e.code === 'PROTOCOL');
  }
});
