// The current API accepts the pinned legacy profile; game/trait records remain unsupported.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const legacySource = require('./legacy-contract.cjs');

const root = path.resolve(__dirname, '../..');
const window = {};
const context = vm.createContext({ window });
for (const file of ['js/bank.js', 'data/universities.js', 'js/majors.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
}
for (const name of ['mbti.js', 'plan.js']) vm.runInContext(legacySource(root, name), context, { filename: 'js/legacy/' + name });
const metadata = {
  bankVersion: window.QUESTION_BANK_META.version,
  academic: window.QUESTION_BANK.map(q => ({ id: q.id, type: q.type,
    ...(q.type === 'choice' ? { optionCount: q.options.length } : {}) })),
  plan: window.PLAN_QUESTIONS.map(q => {
    const ids = (q.type === 'single' ? q.options() : q.source()).map(o => o.id);
    return { key: q.key, type: q.type, options: ids,
      ...(q.type !== 'single' ? { max: q.max || (q.multiFree ? 30 : ids.length), multiFree: !!q.multiFree } : {}) };
  }),
  grades: window.PLAN_CONFIG.grade.map(o => o.id),
  mbtiCount: window.MBTI_QUESTIONS.length,
  mbtiScale: window.MBTI_SCALE.map(o => o.value)
};
const destination = path.join(root, 'backend/assessment-schema.json');
if (process.argv.length === 3 && process.argv[2] === '--check') {
  if (JSON.stringify(JSON.parse(fs.readFileSync(destination, 'utf8'))) !== JSON.stringify(metadata)) {
    console.error('Assessment schema differs from browser sources. Regenerate and review the contract.');
    process.exitCode = 1;
  } else console.log('Assessment schema matches the pinned legacy browser profile; new games/traits are not accepted by this API.');
} else if (process.argv.length === 2) {
  fs.writeFileSync(destination, JSON.stringify(metadata, null, 2) + '\n', 'utf8');
  console.log('Updated backend/assessment-schema.json; review and run backend contract tests.');
} else {
  console.error('Usage: node backend/tools/assessment-schema.cjs [--check]');
  process.exitCode = 2;
}
