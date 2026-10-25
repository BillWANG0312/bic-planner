// Fixed student-choice labels only; no answers, recommendations, or free text.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..');
function sort(value) {
  if (Array.isArray(value)) return value.map(sort);
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, sort(value[key])]));
  return value;
}
const digest = value => crypto.createHash('sha256').update(value, 'utf8').digest('hex');
const source = filename => fs.readFileSync(path.join(root, filename), 'utf8').replace(/\r\n/g, '\n');
const majors = source('js/majors.js'), plan = source('js/plan.js');
const assessment = JSON.parse(source('backend/assessment-schema.json'));
// Catalog entries do not determine these two option dictionaries.
const window = { UNIVERSITY_CATALOG: {} };
const context = vm.createContext({ window });
vm.runInContext(majors, context, { filename: 'js/majors.js' });
vm.runInContext(plan, context, { filename: 'js/plan.js' });
const fields = [
  ['preferredMajor', 2, ['science', 'math', 'eng', 'tech', 'business', 'econ', 'med', 'social', 'humanities', 'art', 'media', 'unsure']],
  ['countries', 3, ['uk', 'us', 'ca', 'au', 'hk', 'sg', 'eu', 'unsure']]
];
const questions = fields.map(([key, max, ids]) => {
  const question = window.PLAN_QUESTIONS.find(question => question.key === key);
  const expected = assessment.plan.find(question => question.key === key);
  if (!question || question.type !== 'tags' || question.multi !== true || question.max !== max || question.multiFree
      || !expected || expected.type !== 'tags' || expected.max !== max || expected.multiFree !== false
      || JSON.stringify(expected.options) !== JSON.stringify(ids)) throw new Error('Review the fixed preference schema contract before regenerating.');
  const options = question.source().map(({ id, label }) => ({ id, label }));
  if (JSON.stringify(options.map(option => option.id)) !== JSON.stringify(ids)
      || options.some(option => typeof option.label !== 'string' || !option.label.trim() || option.label.length > 100
        || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(option.label))) {
    throw new Error('Review the fixed preference option identifiers and labels before regenerating.');
  }
  return { key, max, options };
});
const payload = { bank_version: assessment.bankVersion, schema_version: 'planning-preferences-v1',
  majors_sha256: digest(majors), plan_sha256: digest(plan), questions };
const fingerprint = digest(JSON.stringify(sort(payload)));
const metadata = { bank_version: payload.bank_version, schema_version: payload.schema_version,
  schema_fingerprint: fingerprint, basis: 'explicit_student_choices' };
const outputs = [
  ['backend/preference-schema.json', JSON.stringify({ ...payload, fingerprint }, null, 2) + '\n'],
  ['js/preference-schema.js', '/* Safe fixed choice dictionary; no student records or recommendations. */\nwindow.BIC_PREFERENCE_SCHEMA = ' + JSON.stringify({ metadata, questions }, null, 2) + ';\n']
];
if (process.argv.length === 3 && process.argv[2] === '--check') {
  const stale = outputs.filter(([filename, contents]) => !fs.existsSync(path.join(root, filename)) || fs.readFileSync(path.join(root, filename), 'utf8').replace(/\r\n/g, '\n') !== contents);
  if (stale.length) { console.error('Preference snapshots differ from current canonical sources. Regenerate both and review.'); process.exitCode = 1; }
  else console.log('Preference snapshot and public fixed-choice dictionary match current canonical sources.');
} else if (process.argv.length === 2) {
  for (const [filename, contents] of outputs) fs.writeFileSync(path.join(root, filename), contents, 'utf8');
  console.log('Updated private preference snapshot and safe fixed-choice dictionary; review and verify parity.');
} else { console.error('Usage: node backend/tools/preference-schema.cjs [--check]'); process.exitCode = 2; }
