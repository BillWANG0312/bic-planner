const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const copy = value => JSON.parse(JSON.stringify(value));
const legacy = () => ({ id: 'local-1', state: { info: { name: '虚构学员' }, academic: { answers: {} }, plan: { answers: { groupSize: 'small' } }, mbti: { answers: [0, null, 2] } } });
// 统一版本后页面总是带测评版本识别；minimal 只为验证独立加载的客户端也不放行。
function setup(withProfiles = true) {
  const w = {}, replies = [], calls = [];
  if (withProfiles) vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../js/assessment-profile.js'), 'utf8'), { window: w });
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../js/cloud-client.js'), 'utf8'), { window: w, URL, AbortController, TextDecoder, setTimeout, clearTimeout });
  const reply = (data, status = 200) => replies.push(new Response(status === 204 ? null : JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } }));
  reply({ status: 'ok', api_version: '2' }); reply({ user: { id: 'user-one', username: 'student.local', role: 'student' }, csrf_token: 'x'.repeat(43), expires_at: 1_900_000_000 });
  const client = w.CloudReports.create({ config: { enabled: true, apiBase: '/api/' }, location: new URL('https://school.test/'), fetch: async (url, options) => { calls.push({ url, options }); const value = replies.shift(); if (!value) throw new Error('Unexpected request'); return value; } });
  return { w, client, calls, reply };
}
// 新旧两版作答都可以存档到账号服务；无法识别或混合的格式仍然在发送前拒绝。
const unsupported = [
  value => { value.assessmentProfile = 'future-profile'; },
  value => { value.state.mbti.answers = Array(31).fill(null); },
  value => { value.state.mbti.answers = [5]; },
  value => { value.state.mbti.legacy = true; },
  value => { value.state.plan = null; }
];
test('both recognised profiles can be stored while unknown or mixed shapes are rejected before sending', async () => {
  const f = setup(); await f.client.connect(); const current = legacy();
  current.assessmentProfile = 'games-traits-v1'; current.state.mbti.answers = [{ value: 4, ms: 900 }];
  current.state.plan.answers = { team: { pace: 'deep', partner: 'solo' } };
  const sent = copy(current);
  f.reply({ id: 'server-1', revision: 1, record: current }); await f.client.create(current);
  // 由页面加载的客户端不额外附加版本：版本只来自记录本身，未知版本在发送前被拒绝。
  assert.deepEqual(JSON.parse(f.calls.at(-1).options.body), { record: sent });
  f.reply({ id: 'server-1', revision: 1, record: current }); await f.client.get('server-1');
  assert.deepEqual(f.calls.at(-1).url.split('/').at(-1), 'server-1');
});
for (const [index, alter] of unsupported.entries()) test('unknown or mixed record cannot be sent to cloud API #' + index, async () => {
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
test('an unsupported record returned from the server cannot enter a detail view', async () => {
  const f = setup(); await f.client.connect(); const value = legacy(); value.state.mbti.answers = Array(31).fill(null);
  f.reply({ id: 'server-1', revision: 1, record: value }); await assert.rejects(f.client.get('server-1'), error => error.code === 'PROFILE');
  assert.equal(f.calls.length, 3);
});

const invalidShapes = [
  // 作答里混入报告等生成结果，不是可识别的作答记录，不能上传到账号服务
  ['nested report result', r => { r.state.report = { meta: {}, academic: {} }; }],
  ['nested UI state', r => { r.state.ui = { screen: 'report' }; }],
  ['converted flag false', r => { r.state.mbti.legacy = false; }],
  // 数字与对象混排按旧版作答识别，由旧版字段校验拒绝（见下一组）

  ['unknown numeric scale', r => { r.state.mbti.answers = [5]; }],
  ['non-array personality answers', r => { r.state.mbti.answers = 'private-answer'; }],
  ['string personality scale', r => { r.state.mbti.answers = ['2']; }],
  ['array planning container', r => { r.state.plan = []; }],
  ['null planning container', r => { r.state.plan = null; }],
  ['array personality container', r => { r.state.mbti = []; }],
  ['null personality container', r => { r.state.mbti = null; }]
];
for (const [label, alter] of invalidShapes) test('clients reject ' + label + ' before sending to the cloud API', async () => {
  for (const withProfiles of [true, false]) {
    const f = setup(withProfiles); await f.client.connect(); const record = legacy(); alter(record);
    const original = copy(record), before = f.calls.length;
    for (const send of [() => f.client.create(record), () => f.client.update('server-1', 1, record)]) {
      // 有版本模块时按版本规则判定为不支持；最简客户端同样必须在发送前拒绝，而不是发出后因断线报错。
      await assert.rejects(send(), error => ['PROFILE', 'VALIDATION'].includes(error.code) && !error.message.includes('private'));
    }
    assert.equal(f.calls.length, before, label); assert.deepEqual(record, original);
    assert.equal(f.client.user.username, 'student.local');
  }
});

// 带版本标记的旧版记录里混入当前版本形状（对象作答、组队题）时，版本识别仍按旧版作答判定，随后由旧版字段校验拒绝。
for (const [label, alter] of [['current version board and team answers', r => { r.state.plan.answers = { groupSize: 'small', team: { pace: 'deep', partner: 'solo' } }; r.state.mbti.answers = [{ value: 4, ms: 900 }]; }]]) {
  test('legacy validation rejects ' + label + ' inside a marked legacy record', () => {
    const w = require('./helpers/report.cjs').loadReportScripts(), record = { id: 'r-1', state: legacy().state }; alter(record);
    assert.throws(() => w.LegacyAssessment.validateRecord({ ...record, assessmentProfile: w.AssessmentProfiles.LEGACY }), error => error.code === 'VALIDATION' || error.code === 'PROFILE');
  });
}

for (const entry of ['share', 'statistics', 'outcomes']) test('new profiles stop before legacy ' + entry + ' restoration or projection', () => {
  const { loadReportScripts, state } = require('./helpers/report.cjs'), w = loadReportScripts();
  // 当前版本报告在本机库中走当前规则；只要有任何一步交给冻结的旧版报告库，就说明投影走错了版本。
  const value = state(w, true); value.report = w.generateReport({ ...value, assessmentProfile: w.AssessmentProfiles.CURRENT });
  for (const filename of ['report-store.js', 'share-summary.js', 'report-statistics.js', 'outcome-review.js']) vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../js', filename), 'utf8'), { window: w, Date });
  let raw = null;
  const record = w.ReportStore.create({ getItem: () => raw, setItem: (_, text) => { raw = text; } }).save(value).record;
  assert.equal(record.assessmentProfile, 'games-traits-v1');
  let legacyCalls = 0;
  w.ReportStore = {
    create() { legacyCalls++; throw Object.assign(new Error('A new profile must not enter a legacy projection'), { code: 'PROFILE' }); },
    get list() { legacyCalls++; throw new Error('legacy list'); },
    get restore() { legacyCalls++; throw new Error('legacy restore'); },
    get importBackup() { legacyCalls++; throw new Error('legacy import'); },
    get exportBackup() { legacyCalls++; throw new Error('legacy export'); }
  };
  const records = Array.from({ length: 10 }, (_, i) => ({ ...copy(record), id: 'new-' + i, reportMeta: { ...record.reportMeta, batchId: 'NEW-' + i } }));
  const manifest = { format: 'bic-followup-results', version: 1, subject: 'maths', scale: 'school_percent_0_100', examDate: '2020-01-01', bankVersion: '2026.10', source: 'synthetic', outcomes: Array.from({ length: 10 }, (_, i) => ({ studyId: 'sample-' + i, score: 50 })) };
  // 冻结的旧版运行时不能接手当前版本的记录：要么直接抛 PROFILE，要么根本不碰它。
  const run = () => entry === 'share' ? w.ParentSummary.build(record) : entry === 'statistics' ? w.ReportStatistics.analyze(records, { source: 'synthetic' }) : w.OutcomeReview.analyze(records, manifest, []);
  let error = null;
  try { run(); } catch (caught) { error = caught; }
  assert.equal(error?.code === 'PROFILE' || legacyCalls === 0, true, error?.message);
  assert.equal(raw.includes('games-traits-v1'), true);
});
