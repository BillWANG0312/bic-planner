const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), vm = require('node:vm'), cp = require('node:child_process');
const root = path.resolve(__dirname, '..'), script = 'backend/tools/current-assessment-schema.cjs';
const sources = ['js/bank.js', 'js/majors.js', 'js/plan.js', 'js/personality.js', 'js/games.js', 'js/assessment-profile.js'];
const outputs = ['backend/current-assessment-schema.json', 'js/current-assessment-meta.js'];
function run(where, check = false) { return cp.spawnSync(process.execPath, [script, ...(check ? [typeof check === 'string' ? check : '--check'] : [])], { cwd: where, encoding: 'utf8' }); }
function scratch(fn) {
  const base = path.resolve('D:/Codex/work/bic-current-contract-generator-tests'); fs.mkdirSync(base, { recursive: true });
  const folder = fs.mkdtempSync(path.join(base, 'contract-'));
  try {
    for (const name of [script, ...sources, ...outputs]) { const target = path.join(folder, name); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(path.join(root, name), target); }
    return fn(folder);
  } finally { assert.ok(path.resolve(folder).startsWith(base + path.sep)); fs.rmSync(folder, { recursive: true, force: true }); }
}
test('the new generated contract and safe eight-field browser metadata match their sources', () => {
  const result = run(root, true); assert.equal(result.status, 0, result.stdout + result.stderr);
  const window = {}; vm.runInNewContext(fs.readFileSync(path.join(root, outputs[1]), 'utf8'), { window });
  const meta = window.BIC_CURRENT_ASSESSMENT_META;
  assert.deepEqual(Object.keys(meta).sort(), ['profile', 'contract_version', 'contract_fingerprint', 'bank_version', 'personality_version', 'planning_total', 'planning_required', 'personality_total'].sort());
  assert.equal(meta.profile, 'games-traits-v1'); assert.equal(meta.planning_total, 13); assert.equal(meta.planning_required, 12); assert.equal(meta.personality_total, 30);
  const snapshot = JSON.parse(fs.readFileSync(path.join(root, outputs[0]), 'utf8'));
  const w = { UNIVERSITY_CATALOG: {} }, context = vm.createContext({ window: w });
  for (const name of sources) vm.runInContext(fs.readFileSync(path.join(root, name), 'utf8'), context);
  assert.deepEqual(snapshot.semantics.personality.questions, JSON.parse(JSON.stringify(w.TRAIT_QUESTIONS)));
  assert.equal(snapshot.contract_fingerprint, meta.contract_fingerprint);
  assert.ok(!Object.hasOwn(meta, 'questions'));
});
test('CRLF-only source changes keep the canonical snapshot and metadata valid', () => scratch(folder => {
  for (const name of sources) fs.writeFileSync(path.join(folder, name), fs.readFileSync(path.join(folder, name), 'utf8').replace(/\r\n/g, '\n').replace(/\n/g, '\r\n'));
  const result = run(folder, true); assert.equal(result.status, 0, result.stdout + result.stderr);
}));
test('benign source edits can update source hashes without changing semantic identity', () => scratch(folder => {
  const before = JSON.parse(fs.readFileSync(path.join(folder, outputs[0]), 'utf8'));
  fs.appendFileSync(path.join(folder, 'js/personality.js'), '\n// No semantic change.\n');
  assert.notEqual(run(folder, true).status, 0);
  const result = run(folder); assert.equal(result.status, 0, result.stdout + result.stderr);
  const after = JSON.parse(fs.readFileSync(path.join(folder, outputs[0]), 'utf8'));
  assert.equal(after.contract_fingerprint, before.contract_fingerprint); assert.notDeepEqual(after.sources, before.sources);
}));
test('a reordered personality scale cannot overwrite the existing profile contract', () => scratch(folder => {
  const before = outputs.map(name => fs.readFileSync(path.join(folder, name), 'utf8'));
  const filename = path.join(folder, 'js/personality.js'), source = fs.readFileSync(filename, 'utf8');
  assert.ok(source.includes('order.map(i => pool[i])'));
  fs.writeFileSync(filename, source.replace('order.map(i => pool[i])', 'order.map(i => pool[i]).reverse()'));
  for (const check of [true, false]) { const result = run(folder, check); assert.notEqual(result.status, 0); assert.match(result.stdout + result.stderr, /profile/i); }
  outputs.forEach((name, index) => assert.equal(fs.readFileSync(path.join(folder, name), 'utf8'), before[index]));
}));

for (const [label, filename, before, after] of [
  ['personality response label', 'js/personality.js', "label: '完全不像我'", "label: '非常像我'"],
  ['planning prompt', 'js/plan.js', '你目前所在的年级是？', '你希望未来在哪个年级？'],
  ['planning instruction', 'js/plan.js', '选出最多 3 个最贴近你的', '选择最不符合你的3项'],
  ['same-ID planning choice label', 'js/plan.js', "label: '8 年级'", "label: '11 年级'"],
  ['game explanation', 'js/games.js', '文字、视觉、故事、声音', '制度、规则和执行'],
  ['game trait mapping', 'js/games.js', "traits: ['create', 'empathy']", "traits: ['rules']"],
]) test(label + ' is immutable profile meaning, not a replaceable source hash', () => scratch(folder => {
  const original = outputs.map(name => fs.readFileSync(path.join(folder, name), 'utf8'));
  const target = path.join(folder, filename), contents = fs.readFileSync(target, 'utf8'); assert.ok(contents.includes(before));
  fs.writeFileSync(target, contents.replace(before, after));
  const result = run(folder); assert.notEqual(result.status, 0); assert.match(result.stdout + result.stderr, /profile/i);
  outputs.forEach((name, index) => assert.equal(fs.readFileSync(path.join(folder, name), 'utf8'), original[index]));
}));

test('pure icon decoration can change without redefining response meaning', () => scratch(folder => {
  const before = JSON.parse(fs.readFileSync(path.join(folder, outputs[0]), 'utf8'));
  const target = path.join(folder, 'js/games.js'), contents = fs.readFileSync(target, 'utf8');
  fs.writeFileSync(target, contents.replace("icon: '🎨'", "icon: '⭐'"));
  const result = run(folder); assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(JSON.parse(fs.readFileSync(path.join(folder, outputs[0]), 'utf8')).contract_fingerprint, before.contract_fingerprint);
}));

test('public metadata still anchors semantics when the private snapshot is missing', () => scratch(folder => {
  const publicBefore = fs.readFileSync(path.join(folder, outputs[1]), 'utf8'); fs.unlinkSync(path.join(folder, outputs[0]));
  const target = path.join(folder, 'js/personality.js'), contents = fs.readFileSync(target, 'utf8');
  fs.writeFileSync(target, contents.replace('order.map(i => pool[i])', 'order.map(i => pool[i]).reverse()'));
  const result = run(folder); assert.notEqual(result.status, 0); assert.match(result.stdout + result.stderr, /profile/i);
  assert.equal(fs.existsSync(path.join(folder, outputs[0])), false); assert.equal(fs.readFileSync(path.join(folder, outputs[1]), 'utf8'), publicBefore);
}));

test('missing private snapshot can only recover the same public semantic identity', () => scratch(folder => {
  const publicBefore = fs.readFileSync(path.join(folder, outputs[1]), 'utf8'); fs.unlinkSync(path.join(folder, outputs[0]));
  const result = run(folder); assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(fs.readFileSync(path.join(folder, outputs[1]), 'utf8'), publicBefore);
}));

test('a private snapshot anchors same-semantic recovery when public metadata is missing', () => scratch(folder => {
  const original = fs.readFileSync(path.join(folder, outputs[1]), 'utf8'); fs.unlinkSync(path.join(folder, outputs[1]));
  const result = run(folder); assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(fs.readFileSync(path.join(folder, outputs[1]), 'utf8'), original);
}));

for (const invalid of ['malformed', 'mismatched']) test(invalid + ' public anchor cannot be ignored or silently overwritten', () => scratch(folder => {
  const target = path.join(folder, outputs[1]), originalPrivate = fs.readFileSync(path.join(folder, outputs[0]), 'utf8');
  const invalidPublic = invalid === 'malformed' ? 'window.BIC_CURRENT_ASSESSMENT_META = invalid;' : fs.readFileSync(target, 'utf8').replace(/"contract_fingerprint": "[0-9a-f]+"/, '"contract_fingerprint": "' + '0'.repeat(64) + '"');
  fs.writeFileSync(target, invalidPublic);
  const result = run(folder); assert.notEqual(result.status, 0); assert.match(result.stdout + result.stderr, /profile/i);
  assert.equal(fs.readFileSync(target, 'utf8'), invalidPublic); assert.equal(fs.readFileSync(path.join(folder, outputs[0]), 'utf8'), originalPrivate);
}));

test('missing both anchors refuses ordinary generation; explicit init creates only a new profile baseline', () => scratch(folder => {
  outputs.forEach(name => fs.unlinkSync(path.join(folder, name)));
  assert.notEqual(run(folder).status, 0); outputs.forEach(name => assert.equal(fs.existsSync(path.join(folder, name)), false));
  const initialized = run(folder, '--init'); assert.equal(initialized.status, 0, initialized.stdout + initialized.stderr);
  const original = outputs.map(name => fs.readFileSync(path.join(folder, name), 'utf8'));
  assert.notEqual(run(folder, '--init').status, 0);
  outputs.forEach((name, index) => assert.equal(fs.readFileSync(path.join(folder, name), 'utf8'), original[index]));
}));
