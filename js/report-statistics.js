/* 本地描述汇总。只返回固定聚合字段；不存储、联网或改动评分阈值。 */
(function () {
  'use strict';

  const MIN_CELL = 10;
  const SUBJECTS = ['english', 'maths', 'physics', 'chemistry'];
  const smallCell = counts => counts.some(count => count > 0 && count < MIN_CELL);
  function fail(message) { throw new Error(message); }

  function distribution(selections, keys, basis, selectionMode) {
    const includedSelections = selections.filter(values => values.length);
    const included = includedSelections.length, excluded = selections.length - included;
    const counts = keys.map(key => includedSelections.filter(values => values.includes(key)).length);
    const metadata = { basis, selectionMode, denominator: 'included_reports' };
    // The unselected complement matters for multiple choices: a popular option
    // can otherwise reveal the few respondents who did not select it.
    if (smallCell([included, excluded, ...counts, ...counts.map(count => included - count)])) {
      return { status: 'suppressed', ...metadata };
    }
    return { status: 'available', ...metadata, included, excluded,
      selectionCount: counts.reduce((sum, count) => sum + count, 0),
      entries: keys.map((key, index) => ({ key, count: counts[index],
        pctOfIncluded: included ? Math.round(counts[index] / included * 100) : null })) };
  }

  function planningAggregate(selected, reports, catalogVersion) {
    return { ruleBasis: 'current_local_rules_recomputed', catalogVersion,
      recommendedMajors: distribution(reports.map(report => report.meta.status === 'complete' ? [report.plan.top.major.id] : []),
        window.MAJORS.map(major => major.id), 'complete_reports_current_rules', 'single'),
      statedMajorPreferences: distribution(selected.map(record => record.state.plan.answers.preferredMajor || []),
        window.INTEREST_OPTIONS.map(option => option.id), 'explicit_major_choices', 'multiple'),
      regionPreferences: distribution(selected.map(record => record.state.plan.answers.countries || []),
        window.COUNTRY_OPTIONS.map(option => option.id), 'explicit_region_choices', 'multiple') };
  }

  function analyze(records, options) {
    if (!options || typeof options !== 'object' || Array.isArray(options)
        || Object.keys(options).some(key => !['source', 'planning'].includes(key))
        || !['synthetic', 'unverified_real'].includes(options.source)
        || Object.hasOwn(options, 'planning') && typeof options.planning !== 'boolean') {
      fail('请明确选择样本来源：模拟资料或尚未独立核验的真实样本。');
    }
    const includePlanning = Object.hasOwn(options, 'planning') && options.planning;
    if (!Array.isArray(records) || records.length < MIN_CELL || records.length > 100) {
      fail('请明确选择10–100份报告后生成本地汇总。');
    }
    records.forEach(record => window.AssessmentProfiles?.requireLegacyRecord(record));
    const version = window.QUESTION_BANK_META?.version;
    if (typeof version !== 'string' || !version || version === 'unknown'
        || records.some(record => !record || record.bankVersion !== version)) {
      fail('所选报告必须使用当前同一题库版本；请移除旧版或版本不明的报告。');
    }
    const catalogVersion = window.UNIVERSITY_CATALOG?.version;
    if (includePlanning && (typeof catalogVersion !== 'string' || !catalogVersion || catalogVersion === 'unknown'
        || records.some(record => record.catalogVersion !== catalogVersion))) {
      fail('专业与地区扩展要求当前同一目录版本；请取消旧目录报告，或使用纯学术汇总。');
    }
    // Use the real archive contract, including complete-batch size and duplicate
    // checks, without reading or writing the user's browser storage.
    let raw = null;
    const store = window.ReportStore.create({ getItem: () => raw, setItem: (_, value) => { raw = value; } });
    store.importBackup(JSON.stringify({ format: 'bic-report-library', version: 1,
      exportedAt: new Date().toISOString(), records }));
    const selected = store.list();
    const graded = selected.map(record => window.gradeAcademic(record.state.academic));
    const reports = selected.map(record => window.generateReport(record.state));
    const reviews = reports.map(report => report.academic.review);
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
    const result = { format: 'bic-academic-aggregate', version: includePlanning ? 2 : 1, bankVersion: version,
      sample: { unit: 'report', count, source: options.source, independence: 'operator_checked_not_verified' },
      privacy: { minCell: MIN_CELL, release: 'local_aggregate_not_anonymity_guarantee' },
      subjects, items, calibration: { status: 'not_calibrated', followupOutcomes: false, thresholdsChanged: false } };
    if (includePlanning) result.planning = planningAggregate(selected, reports, catalogVersion);
    return result;
  }

  window.ReportStatistics = { analyze };
})();
