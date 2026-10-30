/* Shape identification only. Full archive validation remains a separate boundary. */
(function () {
  'use strict';
  const LEGACY = 'legacy-2026.10', CURRENT = 'games-traits-v1';
  // 归档记录只保存作答；报告与界面状态属于生成结果，混在记录或 state 里都不是可识别的作答记录。
  const RESULT_KEYS = ['report', 'reportMeta', 'ui'];
  const hasResult = value => RESULT_KEYS.some(key => Object.hasOwn(value, key));
  // 同一份记录可以是分享输入：生成的报告和编辑记录不进版本判断，但也不算作作答内容被混入。
  const hasAnswersResult = value => ['ui'].some(key => Object.hasOwn(value, key));
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  // undefined 字段在记录里等同没写；只把实际存在的键交给识别逻辑。
  const present = value => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
  function fail() { const error = new Error('测评版本未知、混合或曾被转换，请保留原始资料并核对版本。'); error.code = 'PROFILE'; throw error; }
  function marker(value) { if (value !== LEGACY && value !== CURRENT) fail(); return value; }
  function identify(state, explicit) {
    if (!object(state)) fail();
    if (state.mbti !== undefined && !object(state.mbti) || state.plan !== undefined && !object(state.plan)) fail();
    const mbti = state.mbti || {};
    const raw = state.plan?.answers;
    // 尚未作答的版本里规划题是空数组而非对象；只有其中有作答时才需要是作答表。
    if (!object(mbti) || !(raw === undefined || Array.isArray(raw) && !raw.length || object(raw)) || Object.hasOwn(mbti, 'legacy')) fail();
    const plan = object(raw) ? raw : {};
    const answers = mbti.answers === undefined ? [] : mbti.answers;
    if (!Array.isArray(answers) || answers.length > 30) fail();
    let numeric = false, structured = false;
    for (const answer of answers) {
      if (answer === null) continue;
      if (typeof answer === 'number' && Number.isInteger(answer) && answer >= 0 && answer <= 4) numeric = true;
      else if (object(answer)) structured = true;
      else fail();
    }
    // 当前版本独有的作答证据：结构化性格作答、超过旧版题量的作答、当前版本的游戏题或编号。
    const currentOnly = structured || answers.length > 24 || ['subjectBoard', 'majorBoard', 'team'].some(key => Object.hasOwn(plan, key))
      || Array.isArray(plan.career) && plan.career.some(id => ['ideas', 'people', 'systems', 'science', 'build', 'market'].includes(id))
      || Array.isArray(plan.preferredMajor) && (plan.preferredMajor.length > 2
        || plan.preferredMajor.some(id => ['cs', 'phys', 'chem', 'bio', 'biz', 'law', 'psych', 'design', 'intl'].includes(id)));
    // 旧版独有的作答证据：旧版规划题（旧版题表里有、当前版本已删的题）或旧版职业编号。
    const oldOnly = Object.hasOwn(plan, 'groupSize')
      || Array.isArray(plan.career) && plan.career.some(id => ['researcher', 'tech', 'finance', 'medicine', 'law', 'creative', 'entrepreneur', 'unsure'].includes(id));
    if (explicit !== undefined) marker(explicit);
    // 服务保存旧版记录时会补上当前版本独有的字段（如放宽的偏好专业数量）：旧版标记只是这种遗留形状，
    // 作答带着当前版本独有证据、又没有旧版独有证据时就按当前版本。
    if (currentOnly && !oldOnly) return CURRENT;
    // 页面运行态的旧版作答带旧版标记，旧版引擎和旧版校验据此接手；标记在这里已确认有效。
    if (explicit === LEGACY) return LEGACY;
    // 有旧版证据、没有当前版本证据就是旧版作答：旧版引擎与旧版校验据此接手，页面只读打开、不再续答。
    // 旧版性格题只存数值作答，未作答处是空位；旧版规划题里出现当前版形状的作答是新旧混写。
    if (oldOnly) {
      // 记录本体带标记（服务保存当前版时留下）而作答里留着旧版规划题，也是两版对比后才看得出的混写，
      // 交给 ReportStore 的校验按标记不符拒绝，这里仍按旧版作答识别。
      if (structured) fail();
      return LEGACY;
    }
    // 空白作答：带标记的按当前版本（当前版本开新一份会写标记，「标了旧版」也只是服务存档回显）；
    // 完全空白且未标记的只可能来自旧版客户端或旧版导入，按旧版只读读取，不续答。
    return explicit === undefined ? LEGACY : CURRENT;
  }
  // 页面续答与运行态判定用严格版本：旧版作答不再续答，混合或分不清的版本一律拒绝。
  function stateProfile(state) { const value = present(state || {}); return identify(value, Object.hasOwn(value, 'assessmentProfile') ? marker(state.assessmentProfile) : undefined); }
  // 归档读取与运行态判定同一规则，只是记录结果不进版本判断。
  function recordProfile(record) {
    if (!object(record) || !object(record.state) || hasResult(record.state)) fail();
    return identify(record.state, Object.hasOwn(record, 'assessmentProfile') ? marker(record.assessmentProfile) : undefined, true);
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
  // 账号服务同时接受两版归档；记录 shape 无法识别时仍拒绝。
  function requireRecord(record) {
    // 账号存档只保存作答：state 里混有报告或界面状态时与旧版归档校验一致，在发送前拒绝。
    if (!object(record) || !object(record.state) || hasResult(record.state)) fail();
    identify(record.state, Object.hasOwn(record, 'assessmentProfile') ? marker(record.assessmentProfile) : undefined, true);
    return record;
  }
  window.AssessmentProfiles = Object.freeze({ LEGACY, CURRENT, stateProfile, recordProfile, reportProfile, requireRecord });
})();
