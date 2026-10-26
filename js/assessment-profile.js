/* Shape identification only. Full archive validation remains a separate boundary. */
(function () {
  'use strict';
  const LEGACY = 'legacy-2026.10', CURRENT = 'games-traits-v1';
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  function fail() { const error = new Error('测评版本未知、混合或曾被转换，请保留原始资料并核对版本。'); error.code = 'PROFILE'; throw error; }
  function marker(value) { if (value !== LEGACY && value !== CURRENT) fail(); return value; }
  function identify(state, explicit) {
    if (!object(state)) fail();
    if (state.mbti !== undefined && !object(state.mbti) || state.plan !== undefined && !object(state.plan)) fail();
    const mbti = state.mbti || {}, plan = state.plan?.answers || {};
    if (!object(plan) || Object.hasOwn(mbti, 'legacy')) fail();
    const answers = mbti.answers === undefined ? [] : mbti.answers;
    if (!Array.isArray(answers) || answers.length > 30) fail();
    let numeric = false, structured = false;
    for (const answer of answers) {
      if (answer === null) continue;
      if (typeof answer === 'number' && Number.isInteger(answer) && answer >= 0 && answer <= 4) numeric = true;
      else if (object(answer)) structured = true;
      else fail();
    }
    const oldCareer = ['researcher', 'tech', 'finance', 'medicine', 'law', 'creative', 'entrepreneur', 'unsure'];
    const old = ['groupSize', 'timeStyle'].some(key => Object.hasOwn(plan, key))
      || Array.isArray(plan.career) && plan.career.some(id => oldCareer.includes(id));
    const current = structured || answers.length > 24 || ['subjectBoard', 'majorBoard', 'team'].some(key => Object.hasOwn(plan, key))
      || Array.isArray(plan.career) && plan.career.some(id => ['ideas', 'people', 'systems', 'science', 'build', 'market'].includes(id))
      || Array.isArray(plan.preferredMajor) && (plan.preferredMajor.length > 2 || plan.preferredMajor.some(id => ['cs', 'phys', 'chem', 'bio', 'biz', 'law', 'psych', 'design', 'intl'].includes(id)));
    if (numeric && (structured || current) || old && current) fail();
    if (explicit !== undefined) {
      marker(explicit);
      if (explicit === LEGACY && current || explicit === CURRENT && (numeric || old)) fail();
      return explicit;
    }
    return current ? CURRENT : LEGACY;
  }
  function stateProfile(state) { return identify(state, Object.hasOwn(state || {}, 'assessmentProfile') ? marker(state.assessmentProfile) : undefined); }
  function recordProfile(record) {
    if (!object(record) || !object(record.state) || Object.hasOwn(record.state, 'assessmentProfile')) fail();
    return identify(record.state, Object.hasOwn(record, 'assessmentProfile') ? marker(record.assessmentProfile) : undefined);
  }
  function reportProfile(report) {
    if (!object(report) || !object(report.meta) || !object(report.mbti)) fail();
    const modern = Object.hasOwn(report.mbti, 'traits') || Object.hasOwn(report, 'games') || report.mbti.total === 30;
    const old = ['EI', 'SN', 'TF', 'JP'].some(key => Object.hasOwn(report.mbti, key)) || report.mbti.total === 24;
    if (modern && old || !modern && !old) fail();
    const selected = modern ? CURRENT : LEGACY;
    if (Object.hasOwn(report.meta, 'assessmentProfile') && marker(report.meta.assessmentProfile) !== selected) fail();
    return selected;
  }
  function requireLegacyRecord(record) { if (recordProfile(record) !== LEGACY) fail(); return record; }
  window.AssessmentProfiles = Object.freeze({ LEGACY, CURRENT, stateProfile, recordProfile, reportProfile, requireLegacyRecord });
})();
