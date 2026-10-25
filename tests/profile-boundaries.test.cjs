const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const copy = value => JSON.parse(JSON.stringify(value));
const legacy = () => ({ id: 'local-1', state: { info: { name: '虚构学员' }, academic: { answers: {} }, plan: { answers: { groupSize: 'small' } }, mbti: { answers: [0, null, 2] } } });
function setup(withProfiles = false) {
  const w = {}, replies = [], calls = [];
  if (withProfiles) vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../js/assessment-profile.js'), 'utf8'), { window: w });
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../js/cloud-client.js'), 'utf8'), { window: w, URL, AbortController, TextDecoder, setTimeout, clearTimeout });
  const reply = (data, status = 200) => replies.push(new Response(status === 204 ? null : JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } }));
  reply({ status: 'ok', api_version: '2' }); reply({ user: { id: 'user-one', username: 'student.local', role: 'student' }, csrf_token: 'x'.repeat(43), expires_at: 1_900_000_000 });
  const client = w.CloudReports.create({ config: { enabled: true, apiBase: '/api/' }, location: new URL('https://school.test/'), fetch: async (url, options) => { calls.push({ url, options }); const value = replies.shift(); if (!value) throw new Error('Unexpected request'); return value; } });
  return { w, client, calls, reply };
}
const incompatible = [
  value => { value.assessmentProfile = 'games-traits-v1'; },
  value => { value.assessmentProfile = 'future-profile'; },
  value => { value.state.assessmentProfile = 'games-traits-v1'; },
  value => { value.state.mbti.answers = Array(30).fill(null); },
  value => { value.state.mbti.answers = [{ value: 4, ms: 900 }]; },
  value => { value.state.mbti.legacy = true; },
  value => { value.state.plan.answers.subjectBoard = { like: ['数学'], try: [], avoid: [] }; },
  value => { value.state.plan.answers.majorBoard = { heart: ['math'], watch: [], avoid: [] }; },
  value => { value.state.plan.answers.team = { pace: 'deep', partner: 'solo' }; }
];
for (const [index, alter] of incompatible.entries()) test('new, unknown, converted or game profile cannot be sent to legacy cloud API #' + index, async () => {
  const f = setup(); await f.client.connect(); const original = legacy(); alter(original); const saved = copy(original), before = f.calls.length;
  for (const send of [() => f.client.create(original), () => f.client.update('server-1', 1, original)]) await assert.rejects(send(), error => error.code === 'PROFILE');
  assert.equal(f.calls.length, before); assert.deepEqual(original, saved); assert.equal(f.client.user.username, 'student.local');
});
test('legacy records keep their exact original JSON for both create and update', async () => {
  const f = setup(); await f.client.connect(); const original = legacy(), expected = copy(original);
  f.reply({ id: 'server-1', revision: 1, record: original }); await f.client.create(original);
  assert.deepEqual(JSON.parse(f.calls.at(-1).options.body), { record: expected });
  f.reply({ id: 'server-1', revision: 2, record: original }); await f.client.update('server-1', 1, original);
  assert.deepEqual(JSON.parse(f.calls.at(-1).options.body), { record: expected, revision: 1 });
});
test('an unsupported record returned from the server cannot enter a legacy detail view', async () => {
  const f = setup(); await f.client.connect(); const value = legacy(); value.assessmentProfile = 'games-traits-v1';
  f.reply({ id: 'server-1', revision: 1, record: value }); await assert.rejects(f.client.get('server-1'), error => error.code === 'PROFILE');
  assert.equal(f.calls.length, 3);
});

const sparseOrMixed = [
  ['sparse new career', r => { r.state.plan.answers = { career: ['science'] }; r.state.mbti.answers = []; }],
  ['old controls with new career', r => { r.state.plan.answers.career = ['people']; }],
  ['sparse derived major ID', r => { r.state.plan.answers = { preferredMajor: ['cs'] }; r.state.mbti.answers = []; }],
  ['old controls with derived major ID', r => { r.state.plan.answers.preferredMajor = ['law']; }],
  ['more than two major choices', r => { r.state.plan.answers = { preferredMajor: ['science', 'math', 'eng'] }; r.state.mbti.answers = []; }],
  ['nested legacy marker', r => { r.state.assessmentProfile = 'legacy-2026.10'; }],
  ['nested unknown marker', r => { r.state.assessmentProfile = 'private-future-profile'; }],
  ['converted flag false', r => { r.state.mbti.legacy = false; }],
  ['mixed numeric and object answers', r => { r.state.mbti.answers = [0, { value: 4, ms: 900 }]; }],
  ['unknown numeric scale', r => { r.state.mbti.answers = [5]; }],
  ['non-array personality answers', r => { r.state.mbti.answers = 'private-answer'; }],
  ['string personality scale', r => { r.state.mbti.answers = ['2']; }],
  ['array planning container', r => { r.state.plan = []; }],
  ['null planning container', r => { r.state.plan = null; }],
  ['array personality container', r => { r.state.mbti = []; }],
  ['null personality container', r => { r.state.mbti = null; }]
];
for (const [label, alter] of sparseOrMixed) test('minimal and full clients reject ' + label + ' before sending to the old API', async () => {
  for (const withProfiles of [false, true]) {
    const f = setup(withProfiles); await f.client.connect(); const record = legacy(); alter(record);
    const original = copy(record), before = f.calls.length;
    for (const send of [() => f.client.create(record), () => f.client.update('server-1', 1, record)]) {
      await assert.rejects(send(), error => error.code === 'PROFILE' && !error.message.includes('private'));
    }
    assert.equal(f.calls.length, before, label); assert.deepEqual(record, original);
    assert.equal(f.client.user.username, 'student.local');
  }
});

for (const entry of ['share', 'statistics', 'outcomes']) test('new profiles stop before legacy ' + entry + ' restoration or projection', () => {
  const { loadReportScripts, state } = require('./helpers/report.cjs'), w = loadReportScripts();
  const value = state(w, true); value.report = w.generateReport(value);
  for (const filename of ['report-store.js', 'share-summary.js', 'report-statistics.js', 'outcome-review.js']) vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../js', filename), 'utf8'), { window: w, Date });
  let raw = null; const record = w.ReportStore.create({ getItem: () => raw, setItem: (_, text) => { raw = text; } }).save(value).record;
  assert.equal(record.assessmentProfile, 'games-traits-v1');
  w.ReportStore = { create() { assert.fail('A new profile must not enter a legacy projection'); } };
  const records = Array.from({ length: 10 }, (_, i) => ({ ...copy(record), id: 'new-' + i, reportMeta: { ...record.reportMeta, batchId: 'NEW-' + i } }));
  const manifest = { format: 'bic-followup-results', version: 1, subject: 'maths', scale: 'school_percent_0_100', examDate: '2020-01-01', bankVersion: '2026.10', source: 'synthetic', outcomes: Array.from({ length: 10 }, (_, i) => ({ studyId: 'sample-' + i, score: 50 })) };
  assert.throws(() => entry === 'share' ? w.ParentSummary.build(record) : entry === 'statistics' ? w.ReportStatistics.analyze(records, { source: 'synthetic' }) : w.OutcomeReview.analyze(records, manifest, []), error => error.code === 'PROFILE');
  assert.equal(raw.includes('games-traits-v1'), true);
});
