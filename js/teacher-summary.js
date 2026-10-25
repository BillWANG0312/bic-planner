/* 指定顾问的带身份校内完成度清单。只校验必要摘要，不访问答卷或存储。 */
(function () {
  'use strict';
  const SUBJECTS = ['english', 'maths', 'physics', 'chemistry'];
  const BANK_VERSION = '2026.10';
  const FORMAT = 'bic-teacher-completion-summary';
  const GRANT_KEYS = ['id', 'report_id', 'report_revision', 'report_name', 'report_ref', 'owner_username',
    'recipient_username', 'scope', 'created_at', 'expires_at', 'revoked_at', 'status'];
  const REPORT_KEYS = ['id', 'revision', 'report_ref', 'name', 'grade', 'bank_version', 'catalog_version', 'status', 'academic', 'planning', 'personality'];
  const HEADERS = ['姓名', '报告编号', '年级', '服务端修订', '题库版本', '目录版本', '完成状态', '英语已答', '英语总题',
    '数学已答', '数学总题', '物理已答', '物理总题', '化学已答', '化学总题', '规划已答', '规划总题', '规划必答已答', '规划必答总题', '性格已答', '性格总题'];
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const exact = (value, keys) => object(value) && Object.keys(value).length === keys.length && Object.keys(value).every(key => keys.includes(key));
  const identifier = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
  const username = value => typeof value === 'string' && /^[a-z0-9._@+-]{3,64}$/.test(value);
  const positive = value => Number.isSafeInteger(value) && value > 0;
  const count = (value, total) => Number.isInteger(value) && value >= 0 && value <= total;
  const clone = value => JSON.parse(JSON.stringify(value));
  function fail() { throw new Error('摘要格式、授权身份或完成度不符合要求，未生成校内清单。'); }
  function text(value, maximum, required = true) {
    if (typeof value !== 'string' || value.length > maximum || required && !value.trim()) return false;
    for (let index = 0; index < value.length; index++) {
      const code = value.charCodeAt(index);
      if (code >= 0xD800 && code <= 0xDBFF) {
        const next = value.charCodeAt(++index);
        if (!(next >= 0xDC00 && next <= 0xDFFF)) return false;
      } else if (code >= 0xDC00 && code <= 0xDFFF) return false;
    }
    return true;
  }
  function validate(payload, recipient) {
    if (!username(recipient) || !exact(payload, ['format', 'version', 'items']) || payload.format !== FORMAT || payload.version !== 1
        || !Array.isArray(payload.items) || payload.items.length < 1 || payload.items.length > 20) fail();
    const grants = new Set(), reports = new Set(), references = new Set();
    for (const item of payload.items) {
      if (!exact(item, ['grant', 'report'])) fail();
      const grant = item.grant, report = item.report;
      if (!exact(grant, GRANT_KEYS) || !identifier(grant.id) || !identifier(grant.report_id) || !positive(grant.report_revision)
          || !text(grant.report_name, 24) || !text(grant.report_ref, 100) || !username(grant.owner_username)
          || !username(grant.recipient_username) || grant.recipient_username !== recipient || grant.owner_username === recipient
          || grant.scope !== 'full_report_read_only' || grant.status !== 'active' || grant.revoked_at !== null
          || !positive(grant.created_at) || !positive(grant.expires_at) || grant.expires_at <= grant.created_at
          || grant.expires_at * 1000 <= Date.now()) fail();
      if (!exact(report, REPORT_KEYS) || report.id !== grant.report_id || report.revision !== grant.report_revision
          || report.report_ref !== grant.report_ref || report.name !== grant.report_name || !['', '8', '9', '10', '11'].includes(report.grade)
          || report.bank_version !== BANK_VERSION || report.catalog_version !== null && !text(report.catalog_version, 100)
          || !['draft', 'complete'].includes(report.status) || !Array.isArray(report.academic) || report.academic.length !== 4) fail();
      for (let index = 0; index < SUBJECTS.length; index++) {
        const subject = report.academic[index];
        if (!exact(subject, ['key', 'answered', 'total']) || subject.key !== SUBJECTS[index] || subject.total !== 15 || !count(subject.answered, 15)) fail();
      }
      const planning = report.planning, personality = report.personality;
      if (!exact(planning, ['answered', 'total', 'required_answered', 'required_total']) || planning.total !== 14 || planning.required_total !== 13
          || !count(planning.answered, 14) || !count(planning.required_answered, 13)
          || ![0, 1].includes(planning.answered - planning.required_answered)
          || !exact(personality, ['answered', 'total']) || personality.total !== 24 || !count(personality.answered, 24)) fail();
      const complete = report.academic.every(subject => subject.answered === subject.total)
        && planning.required_answered === planning.required_total && personality.answered === personality.total;
      if ((report.status === 'complete') !== complete || grants.has(grant.id) || reports.has(report.id) || references.has(report.report_ref)) fail();
      grants.add(grant.id); reports.add(report.id); references.add(report.report_ref);
    }
    return clone(payload);
  }
  function cell(value) {
    let result = String(value ?? '');
    // Same neutralization as the existing local report CSV: escaped controls
    // and whitespace cannot hide a formula prefix, and literal text is kept.
    if (/^[\s\u0000-\u001f\u007f]*[=+\-@]/.test(result) || /^[\u0000-\u001f\u007f]/.test(result)) result = "'" + result;
    return '"' + result.replace(/"/g, '""') + '"';
  }
  function build(payload, recipient) {
    const valid = validate(payload, recipient);
    const rows = valid.items.map(({ report }) => ({ name: report.name, report_ref: report.report_ref, grade: report.grade,
      revision: report.revision, bank_version: report.bank_version, catalog_version: report.catalog_version, status: report.status,
      academic: report.academic, planning: report.planning, personality: report.personality }));
    const table = [HEADERS, ...rows.map(report => [report.name, report.report_ref, report.grade, report.revision,
      report.bank_version, report.catalog_version === null || report.catalog_version === 'unknown' ? '未记录' : report.catalog_version,
      report.status === 'complete' ? '必答已完成' : '必答未完成', ...report.academic.flatMap(subject => [subject.answered, subject.total]),
      report.planning.answered, report.planning.total, report.planning.required_answered, report.planning.required_total,
      report.personality.answered, report.personality.total])];
    return { rows, csv: '\uFEFF' + table.map(row => row.map(cell).join(',')).join('\r\n') + '\r\n' };
  }
  window.TeacherSummary = { validate, build };
})();
