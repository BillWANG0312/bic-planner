/* 公开分享只含摘要白名单；校验器不依赖账号、存储、题库或页面状态。 */
(function () {
  'use strict';
  const SUBJECTS = ['english', 'maths', 'physics', 'chemistry'];
  const SECTIONS = ['summary', 'academic', 'plan', 'personality'];
  const MAX_CONTENT_UNITS = 24000;
  const MAX_SNAPSHOT_UNITS = 26000;
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const clone = value => JSON.parse(JSON.stringify(value));
  function fail(message = '分享摘要格式不受支持，请联系报告所有者重新生成。') { throw new Error(message); }
  function shape(value, keys) {
    if (!object(value) || Object.keys(value).length !== keys.length
        || keys.some(key => !Object.hasOwn(value, key)) || Object.keys(value).some(key => !keys.includes(key))) fail();
  }
  function text(value, maximum, required = false) {
    if (typeof value !== 'string' || value.length > maximum || required && !value.trim()) fail();
    // Isolated UTF-16 surrogates cannot be stored or transferred as valid UTF-8.
    for (const character of value) {
      const code = character.charCodeAt(0);
      if (character.length === 1 && code >= 0xD800 && code <= 0xDFFF) fail();
    }
  }
  function integer(value, minimum = 1, maximum = Number.MAX_SAFE_INTEGER) {
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum) fail();
  }
  function content(value) {
    shape(value, ['status', 'direction', 'personality', 'subjects', 'sections']);
    if (!['draft', 'complete'].includes(value.status)) fail();
    text(value.direction, 120, true); text(value.personality, 120, true);
    if (!Array.isArray(value.subjects) || value.subjects.length !== 4) fail();
    const seen = new Set();
    for (const subject of value.subjects) {
      shape(subject, ['key', 'name', 'answered', 'total', 'pct']);
      if (!SUBJECTS.includes(subject.key) || seen.has(subject.key)) fail();
      seen.add(subject.key);
      text(subject.name, 24, true);
      integer(subject.answered, 0, 15); integer(subject.total, 15, 15);
      if (subject.answered < subject.total) { if (subject.pct !== null) fail(); }
      else integer(subject.pct, 0, 100);
    }
    if (value.status === 'complete' && value.subjects.some(subject => subject.answered !== subject.total)) fail();
    shape(value.sections, SECTIONS);
    for (const section of SECTIONS) text(value.sections[section], 4000, true);
    if (JSON.stringify(value).length > MAX_CONTENT_UNITS) fail('分享摘要超过大小上限，请缩短建议后重新生成。');
    return value;
  }

  function validate(value) {
    shape(value, ['format', 'version', 'shared_at', 'expires_at', 'report', 'content']);
    if (value.format !== 'bic-parent-summary') fail();
    integer(value.version, 1, 1); integer(value.shared_at); integer(value.expires_at);
    if (value.expires_at <= value.shared_at) fail();
    const report = value.report;
    shape(report, ['name', 'grade', 'year', 'batchId', 'date', 'bankVersion', 'catalogVersion', 'revision']);
    text(report.name, 24, true); text(report.year, 40);
    if (!['', '8', '9', '10', '11'].includes(report.grade)) fail();
    text(report.batchId, 100, true); text(report.date, 80, true); text(report.bankVersion, 100, true);
    if (report.catalogVersion !== null) text(report.catalogVersion, 100, true);
    integer(report.revision);
    content(value.content);
    if (JSON.stringify(value).length > MAX_SNAPSHOT_UNITS) fail();
    return clone(value);
  }

  function build(record) {
    window.AssessmentProfiles?.requireRecord(record);
    if (!window.ReportStore || typeof window.reportEditing?.getText !== 'function') {
      fail('请从账号报告的详情中生成分享摘要。');
    }
    let raw = null;
    const store = window.ReportStore.create({ getItem: () => raw, setItem: (_, value) => { raw = value; } });
    // 账号服务读取返回的记录不带版本标记、按旧版兼容字段保存，导入时交给旧版报告库校验和换算。
    store.importBackup(JSON.stringify({ format: 'bic-report-library', version: 2,
      exportedAt: new Date().toISOString(), records: [record] }));
    // 当前版本记录按当前问卷重算报告。
    const restored = store.restore(record.id, { allowProfileChange: true });
    if (restored.versionChanged) fail('归档的题库或院校目录版本已变化，请先在本机复核并更新服务端报告，再生成分享。');
    const report = restored.state.report;
    const personality = report.mbti.complete
      ? report.mbti.code && report.mbti.type ? `${report.mbti.code} · ${report.mbti.type.title}` : '倾向均衡'
      : '待完成性格测评';
    const result = {
      status: report.meta.status,
      direction: report.plan.top.major.name,
      personality,
      subjects: report.academic.subjects.map(subject => ({ key: subject.key, name: subject.name,
        answered: subject.answered, total: subject.total, pct: subject.complete ? subject.pct : null })),
      sections: Object.fromEntries(SECTIONS.map(section => [section, window.reportEditing.getText(report, section)]))
    };
    content(result);
    return clone(result);
  }

  window.ParentSummary = { build, validate };
})();
