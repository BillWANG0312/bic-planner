/* 本地描述汇总。只返回固定聚合字段；不存储、联网或改动评分阈值。 */
(function () {
  'use strict';

  const MIN_CELL = 10;
  const SUBJECTS = ['english', 'maths', 'physics', 'chemistry'];
  const smallCell = counts => counts.some(count => count > 0 && count < MIN_CELL);
  function fail(message) { throw new Error(message); }

  function analyze(records, options) {
    if (!options || typeof options !== 'object' || Array.isArray(options)
        || Object.keys(options).some(key => key !== 'source')
        || !['synthetic', 'unverified_real'].includes(options.source)) {
      fail('请明确选择样本来源：模拟资料或尚未独立核验的真实样本。');
    }
    if (!Array.isArray(records) || records.length < MIN_CELL || records.length > 100) {
      fail('请明确选择10–100份报告后生成本地汇总。');
    }
    const version = window.QUESTION_BANK_META?.version;
    if (typeof version !== 'string' || !version || version === 'unknown'
        || records.some(record => !record || record.bankVersion !== version)) {
      fail('所选报告必须使用当前同一题库版本；请移除旧版或版本不明的报告。');
    }
    // Use the real archive contract, including complete-batch size and duplicate
    // checks, without reading or writing the user's browser storage.
    let raw = null;
    const store = window.ReportStore.create({ getItem: () => raw, setItem: (_, value) => { raw = value; } });
    store.importBackup(JSON.stringify({ format: 'bic-report-library', version: 1,
      exportedAt: new Date().toISOString(), records }));
    const selected = store.list();
    const graded = selected.map(record => window.gradeAcademic(record.state.academic));
    const reviews = selected.map(record => window.generateReport(record.state).academic.review);
    const count = selected.length;
    const subjects = SUBJECTS.map(key => {
      const values = graded.map(grade => grade.subjects[key]);
      const completed = values.filter(subject => subject.complete);
      const complete = completed.length, incomplete = count - complete;
      const row = { key, totalQuestions: values[0].total };
      if (smallCell([complete, incomplete])) return { ...row, status: 'suppressed' };
      const correct = completed.reduce((sum, subject) => sum + subject.correct, 0);
      const total = completed.reduce((sum, subject) => sum + subject.total, 0);
      return { ...row, status: 'available', complete, incomplete,
        meanPctRounded5: total ? Math.round(correct / total * 100 / 5) * 5 : null };
    });
    const items = window.QUESTION_BANK.map((question, index) => {
      const observations = reviews.map(review => review[index]);
      const answered = observations.filter(value => value.answered).length;
      const correct = observations.filter(value => value.correct).length;
      const missing = count - answered, incorrect = answered - correct;
      const row = { id: question.id, subject: question.subject, difficulty: question.difficulty };
      // Suppress the entire row, rather than revealing a small cell through
      // its denominator, percentages, or complementary categories.
      if (smallCell([correct, incorrect, missing])) return { ...row, status: 'suppressed' };
      return { ...row, status: 'available', answered, missing, correct, incorrect,
        pctCorrect: answered ? Math.round(correct / answered * 100) : null,
        review: !answered ? 'no_answers' : correct === answered ? 'all_correct'
          : !correct ? 'all_incorrect' : 'descriptive_only' };
    });
    return { format: 'bic-academic-aggregate', version: 1, bankVersion: version,
      sample: { unit: 'report', count, source: options.source, independence: 'operator_checked_not_verified' },
      privacy: { minCell: MIN_CELL, release: 'local_aggregate_not_anonymity_guarantee' },
      subjects, items, calibration: { status: 'not_calibrated', followupOutcomes: false, thresholdsChanged: false } };
  }

  window.ReportStatistics = { analyze };
})();
