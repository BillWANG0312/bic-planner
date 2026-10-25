// Explicit current-rule snapshot. The browser-facing output contains metadata only.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const canonical = value => JSON.stringify(Array.isArray(value) ? value.map(sort) : sort(value));
function sort(value) {
  if (Array.isArray(value)) return value.map(sort);
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, sort(value[key])]));
  return value;
}
const digest = value => crypto.createHash('sha256').update(value, 'utf8').digest('hex');
const source = filename => fs.readFileSync(path.join(root, filename), 'utf8').replace(/\r\n/g, '\n');
const bank = source('js/bank.js'), report = source('js/report.js');
const window = {};
vm.runInNewContext(bank, { window }, { filename: 'js/bank.js' });
const payload = {
  bank_version: window.QUESTION_BANK_META.version, rule_version: 'academic-pct-v1',
  bank_sha256: digest(bank), report_sha256: digest(report),
  questions: window.QUESTION_BANK.map(question => ({ id: question.id, subject: question.subject, type: question.type,
    answer: String(question.answer), tol: String(question.tol || 0), option_count: question.type === 'choice' ? question.options.length : null }))
};
const fingerprint = digest(canonical(payload));
const metadata = { bank_version: payload.bank_version, rule_version: payload.rule_version, rule_fingerprint: fingerprint,
  basis: 'current_local_rules_recomputed', incomplete_policy: 'not_scored', calibration: 'not_calibrated' };
const outputs = [
  ['backend/academic-scoring.json', JSON.stringify({ ...payload, fingerprint }, null, 2) + '\n'],
  ['js/academic-scoring-meta.js', '/* Safe current-rule metadata; no questions or answer keys. */\nwindow.BIC_ACADEMIC_SCORING_META = ' + JSON.stringify(metadata, null, 2) + ';\n']
];
if (process.argv.length === 3 && process.argv[2] === '--check') {
  const stale = outputs.filter(([filename, contents]) => !fs.existsSync(path.join(root, filename)) || fs.readFileSync(path.join(root, filename), 'utf8').replace(/\r\n/g, '\n') !== contents);
  if (stale.length) { console.error('Academic scoring snapshots differ from current canonical sources. Regenerate both and review.'); process.exitCode = 1; }
  else console.log('Academic scoring snapshot and public metadata match current canonical sources.');
} else if (process.argv.length === 2) {
  for (const [filename, contents] of outputs) fs.writeFileSync(path.join(root, filename), contents, 'utf8');
  console.log('Updated private academic scoring snapshot and safe public metadata; review and verify parity.');
} else { console.error('Usage: node backend/tools/academic-scoring.cjs [--check]'); process.exitCode = 2; }
