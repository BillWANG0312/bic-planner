/* 手工配对的校内后续成绩描述复核；无存储、网络或阈值更改。 */
(function () {
  'use strict';
  const SUBJECTS = ['english', 'maths', 'physics', 'chemistry'];
  const SCALE = 'school_percent_0_100';
  const MIN_CELL = 10;
  const MAX_TEXT = 100000;
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  function fail(message) { throw new Error(message); }
  function exact(value, keys, label) {
    if (!object(value) || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) {
      fail(label + '字段或格式不受支持，请按本地结果模板核对。');
    }
  }
  function currentBank() {
    const value = window.QUESTION_BANK_META?.version;
    if (typeof value !== 'string' || !value || value === 'unknown') fail('当前题库版本不明，不能复核后续结果。');
    return value;
  }
  function calendar(value, label) {
    if (typeof value !== 'string' || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value)) fail(label + '须为真实的YYYY-MM-DD日期。');
    const parsed = new Date(value + 'T00:00:00Z');
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) fail(label + '不是有效日历日期。');
    return value;
  }
  function today() {
    const now = new Date();
    if (!Number.isFinite(now.getTime())) fail('浏览器日期无法读取，请先核对本机时间。');
    return String(now.getFullYear()).padStart(4, '0') + '-' + String(now.getMonth() + 1).padStart(2, '0')
      + '-' + String(now.getDate()).padStart(2, '0');
  }
  function manifest(value) {
    exact(value, ['format', 'version', 'subject', 'scale', 'examDate', 'bankVersion', 'source', 'outcomes'], '后续结果文件');
    if (value.format !== 'bic-followup-results' || value.version !== 1 || !SUBJECTS.includes(value.subject)
        || value.scale !== SCALE || value.bankVersion !== currentBank()
        || !['synthetic', 'unverified_real'].includes(value.source)) {
      fail('结果格式、科目、校内百分制量表、来源或题库版本不受支持。');
    }
    const examDate = calendar(value.examDate, '后续考试日期');
    if (examDate > today()) fail('后续考试日期不得晚于浏览器本地今天。');
    if (!Array.isArray(value.outcomes) || value.outcomes.length < 1 || value.outcomes.length > 100) fail('结果文件须包含1–100条结果。');
    const ids = new Set(), outcomes = [];
    for (const row of value.outcomes) {
      exact(row, ['studyId', 'score'], '后续结果行');
      if (typeof row.studyId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/.test(row.studyId)
          || ids.has(row.studyId)) fail('研究编号须唯一，并使用1–40位安全英文字母、数字或下划线/连字符。');
      if (row.score !== null && (typeof row.score !== 'number' || !Number.isFinite(row.score) || row.score < 0 || row.score > 100)) {
        fail('结果须为0–100的有限数字，或用null明确表示成绩缺失。');
      }
      ids.add(row.studyId); outcomes.push({ studyId: row.studyId, score: row.score });
    }
    return { format: 'bic-followup-results', version: 1, subject: value.subject, scale: SCALE,
      examDate, bankVersion: value.bankVersion, source: value.source, outcomes };
  }
  function parse(text) {
    if (typeof text !== 'string' || !text.length || text.length > MAX_TEXT) fail('请选择不超过100000字符的JSON结果文件。');
    let value;
    try { value = JSON.parse(text); }
    catch (_) { fail('JSON结果文件无法读取，请保留原文件并核对格式。'); }
    return manifest(value);
  }
  function analyze(records, suppliedManifest, bindings) {
    const results = manifest(suppliedManifest);
    if (!Array.isArray(records) || records.length < 10 || records.length > 100) fail('请明确选择10–100份本机报告。');
    records.forEach(record => window.AssessmentProfiles?.requireRecord(record));
    if (records.some(record => !object(record) || record.bankVersion !== results.bankVersion)) fail('所选报告必须使用当前同一题库版本。');
    let raw = null;
    const store = window.ReportStore.create({ getItem: () => raw, setItem: (_, text) => { raw = text; } });
    store.importBackup(JSON.stringify({ format: 'bic-report-library', version: 2, exportedAt: new Date().toISOString(), records }));
    const selected = store.list();
    const reports = new Map(selected.map(record => {
      const grade = window.gradeAcademic(record.state.academic).subjects[results.subject];
      if (!grade?.complete) fail('所选报告的目标科目尚未完成，请先核对作答。');
      return [record.id, grade];
    }));
    if (!Array.isArray(bindings) || bindings.length > 100) fail('配对列表格式或数量不受支持。');
    const outcomes = new Map(results.outcomes.map(row => [row.studyId, row.score]));
    const studies = new Set(), reportIds = new Set(), usable = [];
    let missingScorePairs = 0;
    for (const binding of bindings) {
      exact(binding, ['studyId', 'reportId', 'baselineDate'], '手工配对');
      if (typeof binding.studyId !== 'string' || typeof binding.reportId !== 'string'
          || !outcomes.has(binding.studyId) || !reports.has(binding.reportId)
          || studies.has(binding.studyId) || reportIds.has(binding.reportId)) {
        fail('配对须引用已导入结果与已选报告，且每个研究编号和报告只能使用一次。');
      }
      const baselineDate = calendar(binding.baselineDate, '实际基线测评日期');
      if (baselineDate >= results.examDate) fail('实际基线测评日期必须早于后续考试日期，不能用报告展示日期推断。');
      studies.add(binding.studyId); reportIds.add(binding.reportId);
      const score = outcomes.get(binding.studyId);
      if (score === null) missingScorePairs++;
      else usable.push({ grade: reports.get(binding.reportId), score });
    }
    const counts = { selectedReports: selected.length, outcomeRows: results.outcomes.length,
      usablePairs: usable.length, missingScorePairs, unpairedReports: selected.length - bindings.length,
      unpairedOutcomes: results.outcomes.length - bindings.length };
    const suppressed = Object.values(counts).some(value => value > 0 && value < MIN_CELL);
    const output = { format: 'bic-followup-review', version: 1, bankVersion: results.bankVersion,
      subject: results.subject, scale: SCALE, source: results.source,
      privacy: { minCell: MIN_CELL, release: 'local_aggregate_not_anonymity_guarantee' },
      method: { pairing: 'operator_selected', dates: 'operator_declared_order_checked', comparison: 'separate_coarse_means_not_equated' },
      status: suppressed ? 'suppressed' : 'available',
      calibration: { status: 'not_calibrated', thresholdsChanged: false, realSampleValidation: false } };
    if (!suppressed) {
      const correct = usable.reduce((sum, row) => sum + row.grade.correct, 0);
      const total = usable.reduce((sum, row) => sum + row.grade.total, 0);
      const score = usable.reduce((sum, row) => sum + row.score, 0);
      output.counts = counts;
      output.means = { baselinePctRounded5: usable.length ? Math.round(correct / total * 100 / 5) * 5 : null,
        followupPctRounded5: usable.length ? Math.round(score / usable.length / 5) * 5 : null };
    }
    return output;
  }
  window.OutcomeReview = { parse, analyze };
})();
