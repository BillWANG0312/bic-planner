// Offline build from reviewed, pinned LF sources; browser code never evaluates strings.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8').replace(/\r\n/g, '\n');
const hash = text => crypto.createHash('sha256').update(text, 'utf8').digest('hex');
const manifest = JSON.parse(read('js/legacy/manifest.json'));
const files = ['mbti.js', 'plan.js', 'report.js', 'report-editing.js', 'report-view.js', 'report-store.js'];
if (manifest.format !== 'bic-legacy-assessment-sources' || manifest.version !== 1
    || manifest.profile !== 'legacy-2026.10' || !/^[0-9a-f]{40}$/.test(manifest.source_revision)
    || !Array.isArray(manifest.files) || manifest.files.length !== files.length) throw new Error('Unsupported frozen source manifest.');
const parts = manifest.files.map((entry, index) => {
  if (entry.file !== 'js/legacy/' + files[index] || entry.source !== 'js/' + files[index] || !/^[0-9a-f]{64}$/.test(entry.sha256)) throw new Error('Unexpected frozen source entry.');
  const contents = read(entry.file);
  if (hash(contents) !== entry.sha256) throw new Error('Frozen source checksum differs; preserve the pinned source and review.');
  return '\n/* Frozen ' + entry.source + ' */\n' + contents;
});
const shared = ['QUESTION_BANK', 'QUESTION_BANK_META', 'QUESTION_BANK_VERSION', 'ALEVEL_BANDS', 'ALEVEL_SUBJECTS', 'CAREER_PATHS', 'COUNTRY_OPTIONS', 'INTEREST_OPTIONS', 'INTEREST_POOL', 'MAJORS', 'REFERENCE_YEAR', 'SUBJECT_META', 'UNIVERSITY_CATALOG'];
const opening = `/* Generated frozen legacy runtime. Shared academic bank/catalog are current, not certified historical rules. */
(function (host) {
  'use strict';
  const window = Object.create(null);
  for (const key of ${JSON.stringify(shared)}) Object.defineProperty(window, key, { enumerable: true, get: () => host[key] });
`;
const closing = `
  const clone = value => JSON.parse(JSON.stringify(value));
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  function invalid() { const error = new Error('旧版档案格式无效，请保留原始资料并核对。'); error.code = 'VALIDATION'; throw error; }
  function jsonValue(value) {
    let raw; try { raw = JSON.stringify(value); } catch (_) { invalid(); }
    if (typeof raw !== 'string' || raw.length > 2000000) invalid();
    const pending = [value], seen = new WeakSet(); let count = 0;
    while (pending.length) {
      const next = pending.pop(); if (++count > 2000000) invalid();
      if (typeof next === 'string') { for (let i = 0; i < next.length; i++) { const code = next.charCodeAt(i); if (code >= 0xD800 && code <= 0xDBFF) { const low = next.charCodeAt(++i); if (!(low >= 0xDC00 && low <= 0xDFFF)) invalid(); } else if (code >= 0xDC00 && code <= 0xDFFF) invalid(); } }
      else if (next === null || typeof next === 'boolean') continue;
      else if (typeof next === 'number') { if (!Number.isFinite(next)) invalid(); }
      else if (object(next) || Array.isArray(next)) { if (seen.has(next)) continue; seen.add(next); for (const value of Object.values(next)) pending.push(value); if (Object.getOwnPropertySymbols(next).length || Array.isArray(next) && Object.keys(next).length !== next.length) invalid(); }
      else invalid();
    }
    return raw;
  }
  // 记录不带版本标记时，当前版本特有的规划题只能视为未作答；只保留旧版题目里仍有效的回答，不能因此判为无法识别。
  function legacyAnswers(answers) {
    return Object.fromEntries(window.PLAN_QUESTIONS.flatMap(q => {
      const answer = answers[q.key];
      if (answer === undefined) return [];
      const options = (q.type === 'single' ? q.options() : q.source()).map(option => option.id);
      if (q.type !== 'single') {
        const kept = Array.isArray(answer) ? answer.filter(item => options.includes(item)) : [];
        return [kept.length === answer.length ? [q.key, answer] : [q.key, kept]];
      }
      return options.includes(answer) ? [[q.key, answer]] : [];
    }));
  }
  // 旧版作答逐题复核，严格拒绝无法按旧版规则解释的内容；当前版本独有的题目在旧版里视为未作答。
  // 记录里的报告属于生成结果，复核作答时由旧版引擎按作答重新生成，不从记录带入。
  function checkAnswers(state, allowBlankName) {
    if (!object(state)) invalid();
    const value = clone(state);
    delete value.assessmentProfile; delete value.report;
    const keys = allowBlankName ? ['info', 'academic', 'plan', 'mbti'] : null;
    if (keys) shape(value, keys, '作答记录');
    else shape(value, ['info', 'academic', 'plan', 'mbti'], '作答记录');
    shape(value.info, ['name', 'grade', 'year'], '学生资料');
    text(value.info.name, 24, '学生姓名', !allowBlankName);
    text(value.info.grade, 10, '年级'); text(value.info.year, 40, '目标入学时间');
    const grades = window.PLAN_CONFIG.grade.map(option => option.id);
    if (value.info.grade && !grades.includes(value.info.grade)) fail('年级不在当前测评范围内');
    shape(value.academic, ['answers'], '学术测评');
    shape(value.academic.answers, window.QUESTION_BANK.map(q => q.id), '学术答案');
    window.QUESTION_BANK.forEach(q => {
      const answer = value.academic.answers[q.id];
      if (answer === undefined || answer === null) return; // 页面清空数值题后存为 null，含义仍为未作答。
      const valid = q.type === 'choice'
        ? Number.isInteger(answer) && answer >= 0 && answer < q.options.length
        : (typeof answer === 'number' || typeof answer === 'string' && answer.trim() !== '' && answer.length <= 100) && Number.isFinite(Number(answer));
      if (!valid) fail(\`学术题 \${q.id} 的答案无效\`);
    });
    shape(value.plan, ['answers'], '专业规划');
    shape(value.plan.answers, window.PLAN_QUESTIONS.map(q => q.key), '规划答案');
    window.PLAN_QUESTIONS.forEach(q => {
      const answer = value.plan.answers[q.key];
      if (answer === undefined) return;
      const options = (q.type === 'single' ? q.options() : q.source()).map(option => option.id);
      if (q.type === 'single') {
        if (!options.includes(answer)) fail(\`规划题 \${q.key} 的选项或数量无效\`);
        return;
      }
      if (!Array.isArray(answer)) fail(\`规划题 \${q.key} 的选项或数量无效\`);
      const ids = Array.from(new Set(answer));
      if (ids.length !== answer.length || ids.length > (q.max || Infinity) || ids.some(id => !options.includes(id))) fail(\`规划题 \${q.key} 的选项或数量无效\`);
      if (q.optional !== true && ids.length < (q.min || 1)) fail(\`规划题 \${q.key} 的选项或数量无效\`);
    });
    shape(value.mbti, ['answers'], '性格测评');
    if (!Array.isArray(value.mbti.answers) || value.mbti.answers.length > window.MBTI_QUESTIONS.length) fail('性格答案格式不正确');
    value.mbti.answers.forEach((answer, index) => {
      const q = window.MBTI_QUESTIONS[index];
      if (q && answer !== null && !(Number.isInteger(answer) && answer >= 0 && answer < q.options.length)) fail('性格答案无效');
    });
    return value;
  }
  function validateRecord(record) {
    // 旧版校验器可以复核旧版归档；当前版本记录由账号服务与当前报告库直接处理。
    if (host.AssessmentProfiles.recordProfile(record) !== host.AssessmentProfiles.LEGACY) { const error = new Error('不能用旧版引擎解释新版资料。'); error.code = 'PROFILE'; throw error; }
    const raw = jsonValue(record);
    const store = window.ReportStore.create({ getItem: () => null, setItem() {} });
    const value = JSON.parse(raw);
    // 记录里的报告属于生成结果，复核作答时由旧版引擎按作答重新生成，不从记录带入。
    const probe = { ...value, state: { ...value.state } };
    delete probe.state.report;
    store.previewImport(jsonValue({ format: 'bic-report-library', version: 1, exportedAt: '2026-10-25T00:00:00Z', records: [probe] }));
    return JSON.parse(raw);
  }
  function validateState(state, options = {}) {
    if (!object(options) || Object.keys(options).some(key => key !== 'allowBlankName') || Object.hasOwn(options, 'allowBlankName') && typeof options.allowBlankName !== 'boolean'
        || !object(state) || Object.keys(state).some(key => !['info','academic','plan','mbti','report','assessmentProfile'].includes(key)) || host.AssessmentProfiles.stateProfile(state) !== host.AssessmentProfiles.LEGACY) invalid();
    // 记录层只保存作答；报告随作答一起打开时只校验作答，报告元数据由引擎重新生成。
    const value = JSON.parse(jsonValue(state)); delete value.assessmentProfile; delete value.report;
    const probe = clone(value);
    if (options.allowBlankName && typeof probe.info?.name === 'string' && probe.info.name.length <= 24 && !probe.info.name.trim()) probe.info.name = '旧版续答校验';
    validateRecord({ id: 'legacy-validation', createdAt: '2026-10-25T00:00:00Z', updatedAt: '2026-10-25T00:00:00Z', bankVersion: '2026.10', state: probe, reportMeta: { batchId: 'LEGACY-VALIDATION', date: '2026/10/25' } });
    return value;
  }
  const originalGenerateReport = window.generateReport;
  function generateReport(state) {
    if (host.AssessmentProfiles.stateProfile(state) !== host.AssessmentProfiles.LEGACY) { const error = new Error('不能用旧版引擎解释新版资料。'); error.code = 'PROFILE'; throw error; }
    const report = originalGenerateReport(state); report.meta.assessmentProfile = host.AssessmentProfiles.LEGACY; return report;
  }
  function renderReport(report) {
    if (host.AssessmentProfiles.reportProfile(report) !== host.AssessmentProfiles.LEGACY) { const error = new Error('报告测评版本不受支持。'); error.code = 'PROFILE'; throw error; }
    return '<p class="report-coverage">旧版24题测评 · 保留原问卷含义；院校资料按当前目录展示。</p>' + window.renderReport(report);
  }
  window.generateReport = generateReport;
  host.LegacyAssessment = Object.freeze({ source: ${JSON.stringify({ source_revision: manifest.source_revision, profile: manifest.profile })}, planQuestions: window.PLAN_QUESTIONS, planConfig: window.PLAN_CONFIG,
    mbtiQuestions: window.MBTI_QUESTIONS, mbtiScale: window.MBTI_SCALE, generateReport, renderReport, createStore: storage => window.ReportStore.create(storage), validateRecord, validateState,
    // 旧版报告按归档重算时需要沿用归档里的顾问修改（来源标签也按旧版规则校验）。
    carryEdits: window.reportEditing.carryEdits });
})(window);
`;
const output = opening + parts.join('') + closing, destination = 'js/legacy-assessment.js';
if (process.argv.length === 3 && process.argv[2] === '--check') {
  if (!fs.existsSync(path.join(root, destination)) || read(destination) !== output) { console.error('Legacy assessment bundle differs from pinned sources.'); process.exitCode = 1; }
  else console.log('Frozen legacy sources and generated isolated bundle match.');
} else if (process.argv.length === 2) { fs.writeFileSync(path.join(root, destination), output, 'utf8'); console.log('Generated isolated frozen legacy assessment bundle.'); }
else { console.error('Usage: node backend/tools/legacy-assessment.cjs [--check]'); process.exitCode = 2; }
