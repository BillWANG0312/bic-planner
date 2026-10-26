// Input semantics only. This does not enable any cloud operation or projection.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const filenames = ['js/bank.js', 'js/majors.js', 'js/plan.js', 'js/personality.js', 'js/games.js', 'js/assessment-profile.js'];
const hash = value => crypto.createHash('sha256').update(value, 'utf8').digest('hex');
function sorted(value) {
  if (Array.isArray(value)) return value.map(sorted);
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, sorted(value[key])]));
  return value;
}
const canonical = value => JSON.stringify(sorted(value));
const text = filename => fs.readFileSync(path.join(root, filename), 'utf8').replace(/\r\n/g, '\n');
function meaning(value) {
  if (Array.isArray(value)) return value.map(meaning);
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'icon').map(([key, item]) => [key, meaning(item)]));
  return value;
}
function main() {
  if (process.argv.length > 3 || process.argv.length === 3 && !['--check', '--init'].includes(process.argv[2])) {
    console.error('Usage: node backend/tools/current-assessment-schema.cjs [--check|--init]'); return 2;
  }
  const window = { UNIVERSITY_CATALOG: {} }, context = vm.createContext({ window });
  const sources = {};
  for (const filename of filenames) { const contents = text(filename); sources[filename] = hash(contents); vm.runInContext(contents, context, { filename, timeout: 1000 }); }
  if (window.AssessmentProfiles.CURRENT !== 'games-traits-v1') throw new Error('Review a new profile contract before changing its identity.');
  const planning = window.PLAN_QUESTIONS.map(question => {
    const common = { key: question.key, type: question.type, optional: !!question.optional };
    if (question.type === 'game') return { ...common, game: question.game };
    if (!['single', 'tags'].includes(question.type)) throw new Error('Review the planning profile type.');
    const options = (question.type === 'single' ? question.options() : question.source()).map(option => option.id);
    return { ...common, options, ...(question.type === 'tags' ? { max: question.max || (question.multiFree ? 30 : options.length), multi_free: !!question.multiFree } : {}) };
  });
  const board = name => ({ lanes: window.GAME_CONFIG[name].lanes.map(lane => lane.id),
    items: (name === 'campus' ? window.GAME_CONFIG[name].items : window.GAME_CONFIG[name].majors).map(item => item.id || item), capacity: window.GAME_CONFIG[name].capacity });
  const semantics = {
    profile: 'games-traits-v1', contract_version: 'games-traits-contract-v1',
    bank_version: window.QUESTION_BANK_META.version, personality_version: window.PERSONALITY_META.version,
    grades: window.PLAN_CONFIG.grade.map(option => option.id),
    academic: window.QUESTION_BANK.map(question => ({ id: question.id, type: question.type,
      ...(question.type === 'choice' ? { option_count: question.options.length } : {}) })),
    planning,
    games: { campus: board('campus'), planet: board('planet'),
      dart: { options: window.GAME_CONFIG.dart.rings.map(ring => ring.id), max: window.GAME_CONFIG.dart.max },
      race: { pace: window.GAME_CONFIG.race.pace.map(option => option.id), partner: window.GAME_CONFIG.race.partners.map(option => option.id) } },
    compatibility_planning: {
      schoolSubjects: { type: 'tags', max: 30, multi_free: true, options: [] },
      preferredMajor: { type: 'tags', max: 8, multi_free: false,
        options: [...new Set([...window.INTEREST_OPTIONS.map(option => option.id), ...window.MAJORS.map(major => major.id)])] }
    },
    personality: { scale: window.PERSONALITY_SCALE.map(option => option.value),
      questions: JSON.parse(JSON.stringify(window.TRAIT_QUESTIONS)), timing: 'optional_null_or_finite_js_number' },
    meaning: {
      personality_scale: meaning(window.PERSONALITY_SCALE),
      planning: window.PLAN_QUESTIONS.map(question => ({ key: question.key, id: question.id, title: question.title, sub: question.sub ?? null,
        options: question.type === 'game' ? [] : meaning(question.type === 'single' ? question.options() : question.source()) })),
      games: meaning(window.GAME_CONFIG),
      planet_labels: window.GAME_CONFIG.planet.majors.map(id => { const major = window.MAJORS.find(item => item.id === id); return { id, label: major.name, desc: major.en }; }),
      interest_options: meaning(window.INTEREST_OPTIONS),
      traits: window.TRAITS.map(({ id, label, desc }) => ({ id, label, desc }))
    }
  };
  if (planning.length !== 13 || planning.filter(question => !question.optional).length !== 12 || semantics.personality.questions.length !== 30) {
    throw new Error('A changed question count requires a new profile contract.');
  }
  const fingerprint = hash(canonical(semantics));
  const snapshotName = 'backend/current-assessment-schema.json', publicName = 'js/current-assessment-meta.js';
  const hasPrivate = fs.existsSync(path.join(root, snapshotName)), hasPublic = fs.existsSync(path.join(root, publicName));
  if (process.argv[2] === '--init' && (hasPrivate || hasPublic)) throw new Error('Existing profile anchors cannot be reinitialized; restore and review their original identity.');
  if (!hasPrivate && !hasPublic && process.argv[2] !== '--init') throw new Error('No profile identity anchor remains; restore from Git. Use --init only when introducing a new profile for the first time.');
  if (hasPrivate) {
    const previous = JSON.parse(text(snapshotName));
    if (previous.format !== 'bic-current-assessment-contract' || previous.version !== 1 || !previous.semantics
        || previous.semantics.profile !== semantics.profile || previous.contract_fingerprint !== hash(canonical(previous.semantics))) throw new Error('Existing profile contract is invalid; preserve and review it before regeneration.');
    if (canonical(previous.semantics) !== canonical(semantics)) {
      throw new Error('Semantic changes cannot overwrite an existing profile contract; introduce a new profile/version first.');
    }
  }
  const metadata = { profile: semantics.profile, contract_version: semantics.contract_version, contract_fingerprint: fingerprint,
    bank_version: semantics.bank_version, personality_version: semantics.personality_version,
    planning_total: planning.length, planning_required: planning.filter(question => !question.optional).length, personality_total: semantics.personality.questions.length };
  if (hasPublic) {
    const matched = text(publicName).match(/window\.BIC_CURRENT_ASSESSMENT_META\s*=\s*Object\.freeze\(([\s\S]+)\);\s*$/);
    if (!matched) throw new Error('Existing public profile identity anchor is invalid; restore it from Git.');
    const previous = JSON.parse(matched[1]);
    if (canonical(previous) !== canonical(metadata)) throw new Error('Public profile identity differs from these semantics; restore its original contract or introduce a new profile/version.');
  }
  const outputs = [[snapshotName, JSON.stringify({ format: 'bic-current-assessment-contract', version: 1, semantics, sources, contract_fingerprint: fingerprint }, null, 2) + '\n'],
    [publicName, '/* Contract metadata only; no questions, answers or student information. */\nwindow.BIC_CURRENT_ASSESSMENT_META = Object.freeze(' + JSON.stringify(metadata, null, 2) + ');\n']];
  if (process.argv[2] === '--check') {
    if (outputs.some(([filename, contents]) => !fs.existsSync(path.join(root, filename)) || text(filename) !== contents)) {
      console.error('Current assessment profile snapshot or metadata is stale; review sources and regenerate without redefining its semantics.'); return 1;
    }
    console.log('Current assessment input contract and safe metadata match canonical sources; operations remain separately gated.'); return 0;
  }
  for (const [filename, contents] of outputs) fs.writeFileSync(path.join(root, filename), contents, 'utf8');
  console.log('Updated current assessment profile source fingerprints and metadata; cloud operations are not enabled.'); return 0;
}
try { process.exitCode = main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
