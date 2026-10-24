/* 同一浏览器的本地报告库。只归档作答和顾问记录，打开时按当前规则重新生成。 */
(function () {
  'use strict';
  const KEY = 'bic.report-library.v1';
  const FORMAT = 'bic-report-library';
  const VERSION = 1;
  const LIMITS = Object.freeze({ MAX_RECORDS: 100, MAX_CHARS: 2000000, MAX_HISTORY: 200 });
  const SECTIONS = ['summary', 'academic', 'plan', 'personality'];
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const clone = value => JSON.parse(JSON.stringify(value));
  const now = () => new Date().toISOString();
  const bankVersion = () => window.QUESTION_BANK_META?.version || 'unknown';
  const catalogVersion = () => window.UNIVERSITY_CATALOG?.version || 'unknown';
  let sequence = 0;

  function fail(message, code = 'VALIDATION') {
    const error = new Error(message);
    error.code = code;
    throw error;
  }
  function shape(value, keys, label) {
    if (!object(value)) fail(`${label}格式不正确`);
    if (Object.keys(value).some(key => !keys.includes(key))) fail(`${label}含未支持的字段，请保留原备份并核对版本`);
  }
  function text(value, max, label, required = false) {
    if (typeof value !== 'string' || value.length > max || required && !value.trim()) fail(`${label}需为${required ? '非空' : ''}文字，最多 ${max} 字`);
    return value;
  }
  function timestamp(value, label) {
    text(value, 40, label, true);
    if (!Number.isFinite(Date.parse(value))) fail(`${label}无效`);
    return value;
  }

  // 小游戏答案：分格卡片 / 靶环 / 团队竞速
  function normalizeGame(q, answer) {
    const cfg = window.GAME_CONFIG;
    if (q.game === 'campus' || q.game === 'planet') {
      const board = cfg[q.game];
      if (!object(answer) || Object.keys(answer).some(key => !board.lanes.some(lane => lane.id === key))) return null;
      const allowed = new Set((q.game === 'campus' ? board.items : board.majors).map(item => item.id || item));
      const out = {};
      board.lanes.forEach(lane => {
        const list = answer[lane.id] === undefined ? [] : answer[lane.id];
        if (!Array.isArray(list) || list.length > board.capacity || new Set(list).size !== list.length
          || list.some(id => typeof id !== 'string' || !allowed.has(id))) { out.bad = true; return; }
        out[lane.id] = list.slice();
      });
      return out.bad ? null : out;
    }
    if (q.game === 'dart') {
      const rings = cfg.dart.rings.map(ring => ring.id);
      if (!Array.isArray(answer) || answer.length > cfg.dart.max || new Set(answer).size !== answer.length
        || answer.some(id => !rings.includes(id))) return null;
      return answer.slice();
    }
    if (q.game === 'race') {
      if (!object(answer)) return null;
      const out = {};
      if (answer.pace !== undefined) { if (!cfg.race.pace.some(p => p.id === answer.pace)) return null; out.pace = answer.pace; }
      if (answer.partner !== undefined) { if (!cfg.race.partners.some(p => p.id === answer.partner)) return null; out.partner = answer.partner; }
      return out;
    }
    return null;
  }

  const LEGACY_PLAN_KEYS = ['schoolSubjects', 'weakSubjects'];

  function normalizeState(value) {
    shape(value, ['info', 'academic', 'plan', 'mbti'], '作答记录');
    shape(value.info, ['name', 'grade', 'year'], '学生资料');
    const info = {
      name: text(value.info.name, 24, '学生姓名', true),
      grade: text(value.info.grade, 10, '年级'),
      year: text(value.info.year, 40, '目标入学时间')
    };
    const grades = window.PLAN_CONFIG.grade.map(option => option.id);
    if (info.grade && !grades.includes(info.grade)) fail('年级不在当前测评范围内');
    shape(value.academic, ['answers'], '学术测评');
    shape(value.academic.answers, window.QUESTION_BANK.map(q => q.id), '学术答案');
    const academic = { answers: {} };
    window.QUESTION_BANK.forEach(q => {
      if (!Object.hasOwn(value.academic.answers, q.id)) return;
      const answer = value.academic.answers[q.id];
      if (answer === null) return; // 页面清空数值题后存为 null，含义仍为未作答。
      const valid = q.type === 'choice'
        ? Number.isInteger(answer) && answer >= 0 && answer < q.options.length
        : (typeof answer === 'number' || typeof answer === 'string' && answer.trim() !== '' && answer.length <= 100)
          && Number.isFinite(Number(answer));
      if (!valid) fail(`学术题 ${q.id} 的答案无效`);
      academic.answers[q.id] = answer;
    });
    shape(value.plan, ['answers'], '专业规划');
    // 这些字段不是 plan.js 的问答题，但星球排序会把专业意向写进 preferredMajor，
    // 旧版存档还会带有 schoolSubjects / weakSubjects → 报告同样会读取，需要原样保留
    const planKeys = [...window.PLAN_QUESTIONS.map(q => q.key), 'preferredMajor', ...LEGACY_PLAN_KEYS];
    shape(value.plan.answers, planKeys, '规划答案');
    const plan = { answers: {} };
    window.PLAN_QUESTIONS.forEach(q => {
      const answer = value.plan.answers[q.key];
      if (q.type === 'game') {
        if (answer === undefined) { plan.answers[q.key] = q.game === 'race' ? {} : q.game === 'dart' ? [] : {}; return; }
        const clean = normalizeGame(q, answer);
        if (clean == null) fail(`规划题 ${q.key} 的答案类型或选项无效`);
        plan.answers[q.key] = clean;
        return;
      }
      const options = (q.type === 'single' ? q.options() : q.source()).map(option => option.id);
      if (q.type === 'single') {
        if (answer === undefined) return;
        if (!options.includes(answer)) fail(`规划题 ${q.key} 的答案无效`);
        plan.answers[q.key] = answer;
      } else {
        if (answer === undefined) { plan.answers[q.key] = []; return; }
        const max = q.max || (q.multiFree ? 30 : options.length);
        if (!Array.isArray(answer) || answer.length > max || new Set(answer).size !== answer.length
          || answer.some(item => typeof item !== 'string' || !item.trim() || item.length > 80 || !options.includes(item) && !q.multiFree)) fail(`规划题 ${q.key} 的答案类型、选项或数量无效`);
        plan.answers[q.key] = answer.slice();
      }
    });
    LEGACY_PLAN_KEYS.forEach(key => {
      const list = value.plan.answers[key];
      if (list === undefined) return;
      if (!Array.isArray(list) || list.length > 30 || list.some(item => typeof item !== 'string' || !item.trim() || item.length > 80)) {
        fail(`规划题 ${key} 的答案类型或数量无效`);
      }
      plan.answers[key] = list.slice();
    });
    if (value.plan.answers.preferredMajor !== undefined) {
      const ids = window.INTEREST_OPTIONS.map(o => o.id).concat(window.MAJORS.map(m => m.id));
      const value2 = value.plan.answers.preferredMajor;
      if (!Array.isArray(value2) || value2.length > 8 || new Set(value2).size !== value2.length
        || value2.some(id => typeof id !== 'string' || !ids.includes(id))) fail('规划题 preferredMajor 的答案类型、选项或数量无效');
      plan.answers.preferredMajor = value2.slice();
    }
    if (info.grade && plan.answers.grade && info.grade !== plan.answers.grade) fail('学生资料与规划答案的年级不一致');
    if (!info.grade && plan.answers.grade) info.grade = plan.answers.grade;
    if (info.grade) plan.answers.grade = info.grade;
    shape(value.mbti, ['answers', 'legacy'], '性格测评');
    if (!Array.isArray(value.mbti.answers) || value.mbti.answers.length > window.TRAIT_QUESTIONS.length) fail('性格答案数量或类型无效');
    const scale = window.PERSONALITY_SCALE.map(option => option.value);
    const mbti = { answers: Array.from({ length: window.TRAIT_QUESTIONS.length }, (_, i) => {
      const answer = value.mbti.answers[i];
      if (answer === undefined || answer === null) return null;
      if (!object(answer) || !scale.includes(answer.value)) fail(`性格题 ${i + 1} 的答案无效`);
      return { value: answer.value, ms: Number.isFinite(answer.ms) ? answer.ms : null };
    }) };
    if (value.mbti.legacy === true) mbti.legacy = true;
    return { info, academic, plan, mbti };
  }

  function normalizeAdvisor(value) {
    if (value === undefined) return undefined;
    shape(value, ['sections', 'history', 'lastAuthor', 'carriedFrom'], '顾问编辑');
    shape(value.sections, SECTIONS, '顾问建议');
    const sections = {};
    for (const key of Object.keys(value.sections)) sections[key] = text(value.sections[key], 4000, '顾问建议', true);
    if (!Array.isArray(value.history)) fail('顾问修改记录格式不正确');
    if (value.history.length > LIMITS.MAX_HISTORY) fail(`顾问修改记录最多 ${LIMITS.MAX_HISTORY} 条，请先保留原始备份`, 'LIMIT');
    const ids = new Set();
    const history = value.history.map(entry => {
      shape(entry, ['id', 'at', 'author', 'section', 'before', 'after', 'action', 'reportId'], '顾问修改记录');
      const id = text(entry.id, 100, '修改编号', true);
      if (ids.has(id)) fail('顾问修改编号重复');
      ids.add(id);
      if (!SECTIONS.includes(entry.section) || !['edit', 'reset', 'restore'].includes(entry.action)) fail('顾问修改部分或操作类型无效');
      return { id, at: timestamp(entry.at, '修改时间'), author: text(entry.author, 40, '编辑者', true),
        section: entry.section, before: text(entry.before, 4000, '修改前文字'), after: text(entry.after, 4000, '修改后文字', true),
        action: entry.action, reportId: text(entry.reportId, 100, '原报告编号', true) };
    });
    const advisor = { sections, history };
    if (value.lastAuthor !== undefined) advisor.lastAuthor = text(value.lastAuthor, 40, '最近编辑者');
    if (value.carriedFrom !== undefined) advisor.carriedFrom = text(value.carriedFrom, 100, '沿用报告编号', true);
    return advisor;
  }

  function normalizeRecord(value) {
    shape(value, ['id', 'createdAt', 'updatedAt', 'bankVersion', 'catalogVersion', 'state', 'reportMeta', 'advisor'], '归档记录');
    const id = text(value.id, 100, '归档编号', true);
    if (!/^[A-Za-z0-9_-]+$/.test(id)) fail('归档编号格式无效');
    shape(value.reportMeta, ['batchId', 'date'], '报告资料');
    const record = { id, createdAt: timestamp(value.createdAt, '归档时间'), updatedAt: timestamp(value.updatedAt, '更新时间'),
      bankVersion: text(value.bankVersion, 100, '题库版本', true),
      catalogVersion: value.catalogVersion == null ? null : text(value.catalogVersion, 100, '院校目录版本', true),
      state: normalizeState(value.state), reportMeta: { batchId: text(value.reportMeta.batchId, 100, '报告编号', true), date: text(value.reportMeta.date, 80, '报告日期', true) } };
    const advisor = normalizeAdvisor(value.advisor);
    if (advisor) record.advisor = advisor;
    return record;
  }
  function validateRecords(records) {
    if (!Array.isArray(records)) fail('报告列表格式不正确');
    if (records.length > LIMITS.MAX_RECORDS) fail(`本地报告库最多 ${LIMITS.MAX_RECORDS} 份，请先导出备份并整理归档`, 'LIMIT');
    const ids = new Set(); const reports = new Set();
    return records.map(value => {
      const record = normalizeRecord(value);
      if (ids.has(record.id) || reports.has(record.reportMeta.batchId)) fail('备份中有重复的归档编号或报告编号，请先核对原始备份');
      ids.add(record.id); reports.add(record.reportMeta.batchId);
      return record;
    });
  }
  function envelope(records) { return { format: FORMAT, version: VERSION, exportedAt: now(), records }; }
  function serialize(records) {
    const result = JSON.stringify(envelope(records));
    if (result.length > LIMITS.MAX_CHARS) fail(`报告库超过 ${LIMITS.MAX_CHARS} 字符的保存上限，请先导出备份并整理归档`, 'LIMIT');
    return result;
  }
  function parse(raw) {
    if (typeof raw !== 'string') fail('请导入 JSON 文字');
    if (raw.length > LIMITS.MAX_CHARS) fail(`备份超过 ${LIMITS.MAX_CHARS} 字符的导入上限`, 'LIMIT');
    let parsed;
    try { parsed = JSON.parse(raw); } catch (_) { fail('JSON 格式无法读取，请保留原文件并检查备份'); }
    shape(parsed, ['format', 'version', 'exportedAt', 'records'], '备份文件');
    if (parsed.format !== FORMAT || parsed.version !== VERSION) fail('备份格式或版本不受支持，请保留原文件');
    timestamp(parsed.exportedAt, '备份时间');
    return validateRecords(parsed.records);
  }

  function create(storage) {
    function rawBackup() {
      try { return storage.getItem(KEY); }
      catch (_) { fail('浏览器无法读取本地报告库，请检查浏览器存储权限', 'STORAGE'); }
    }
    function read() {
      const raw = rawBackup();
      if (raw === null || raw === '') return [];
      try { return parse(raw); }
      catch (error) { fail(`本地报告库无法完整读取，已停止修改。请先导出原始数据备份。${error.message}`, 'CORRUPT'); }
    }
    function write(records) {
      const serialized = serialize(validateRecords(records));
      try { storage.setItem(KEY, serialized); }
      catch (_) { fail('本地报告库保存失败，原有归档未更改。请导出备份并检查浏览器存储空间', 'STORAGE'); }
    }
    function save(currentState, options = {}) {
      const records = read();
      if (!object(currentState) || !object(currentState.report) || !object(currentState.report.meta)) fail('请先生成当前学生的报告再归档');
      const state = normalizeState({ info: currentState.info, academic: currentState.academic, plan: currentState.plan,
        mbti: { answers: currentState.mbti?.answers, ...(currentState.mbti?.legacy ? { legacy: true } : {}) } });
      const reportMeta = { batchId: currentState.report.meta.batchId, date: currentState.report.meta.date };
      const previous = records.find(record => record.reportMeta.batchId === reportMeta.batchId);
      if (previous && options.overwrite !== true) fail('此报告已归档，请明确选择更新已有归档', 'DUPLICATE');
      const at = now();
      const record = normalizeRecord({ id: previous?.id || `local-${Date.now().toString(36)}-${(++sequence).toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
        createdAt: previous?.createdAt || at, updatedAt: at, bankVersion: bankVersion(), catalogVersion: catalogVersion(), state, reportMeta,
        ...(currentState.report.advisor !== undefined ? { advisor: currentState.report.advisor } : {}) });
      const next = previous ? records.map(item => item.id === previous.id ? record : item) : [...records, record];
      write(next);
      return { record: clone(record), updated: !!previous };
    }
    function remove(id) {
      const records = read();
      const next = records.filter(record => record.id !== id);
      if (next.length === records.length) return false;
      write(next);
      return true;
    }
    function restore(id) {
      const record = read().find(item => item.id === id);
      if (!record) fail('找不到这份归档，可能已被删除', 'NOT_FOUND');
      const state = clone(record.state);
      state.mbti = state.mbti || { answers: [] };
      if (state.mbti.answers.length < window.TRAIT_QUESTIONS.length) state.mbti.answers.push(...new Array(window.TRAIT_QUESTIONS.length - state.mbti.answers.length).fill(null));
      const report = window.generateReport(state);
      report.meta.batchId = record.reportMeta.batchId;
      report.meta.date = record.reportMeta.date;
      if (record.advisor) {
        window.reportEditing.carryEdits({ meta: record.reportMeta, advisor: record.advisor }, report);
        if (report.advisor) {
          if (record.advisor.carriedFrom !== undefined) report.advisor.carriedFrom = record.advisor.carriedFrom;
          else delete report.advisor.carriedFrom;
        }
      }
      state.report = report;
      state.ui = { screen: 'report', idx: 0, resumeScreen: 'academic' };
      const sources = [record.bankVersion, record.catalogVersion, bankVersion(), catalogVersion()];
      const versionChanged = sources.some(version => !version || version === 'unknown')
        || record.bankVersion !== bankVersion() || record.catalogVersion !== catalogVersion();
      return { state, record: clone(record), versionChanged };
    }
    function merge(existing, incoming, onConflict) {
      const next = existing.slice();
      let added = 0; let skipped = 0; let replaced = 0;
      for (const record of incoming) {
        const matches = next.map((item, i) => item.id === record.id || item.reportMeta.batchId === record.reportMeta.batchId ? i : -1).filter(i => i >= 0);
        if (matches.length > 1) fail('备份中的归档编号与报告编号分别对应不同现有记录，请核对后重新导入');
        if (!matches.length) { next.push(record); added++; }
        else if (onConflict === 'replace') { next[matches[0]] = { ...record, id: next[matches[0]].id }; replaced++; }
        else skipped++;
      }
      validateRecords(next);
      serialize(next);
      return { next, added, skipped, replaced, total: next.length };
    }
    function previewImport(raw) {
      const existing = read();
      const incoming = parse(raw);
      const result = merge(existing, incoming, 'skip');
      return { count: incoming.length, added: result.added, conflicts: result.skipped };
    }
    function importBackup(raw, options = {}) {
      const records = read();
      const onConflict = options.onConflict ?? 'skip';
      if (!['skip', 'replace'].includes(onConflict)) fail('请选择跳过或替换重复报告');
      const result = merge(records, parse(raw), onConflict);
      if (result.added || result.replaced) write(result.next);
      return { added: result.added, skipped: result.skipped, replaced: result.replaced, total: result.total };
    }
    function exportBackup() { return serialize(read()); }
    function exportCSV() {
      const records = read();
      const rows = [['归档编号', '报告编号', '学生姓名', '年级', '目标入学时间', '报告日期', '报告状态', '学术已答', '学术总题', '数学百分比（完成后）', '英语百分比（完成后）', '物理百分比（完成后）', '化学百分比（完成后）', '首选探索专业', '性格特质', '归档题库版本', '归档院校目录版本']];
      records.forEach(record => {
        const report = window.generateReport(record.state);
        const pct = key => { const subject = report.academic.subjects.find(item => item.key === key); return subject?.complete ? subject.pct : ''; };
        rows.push([record.id, record.reportMeta.batchId, record.state.info.name, report.meta.grade, record.state.info.year,
          record.reportMeta.date, report.meta.status === 'complete' ? '完成' : '草稿', report.academic.answered, report.academic.total,
          pct('maths'), pct('english'), pct('physics'), pct('chemistry'), report.plan.top.major.name,
          report.mbti.complete ? (report.mbti.top || []).slice(0, 2).map(t => t.label).join(' / ') || '倾向均衡' : '待完成', record.bankVersion, record.catalogVersion || '未知']);
      });
      const cell = value => {
        let result = String(value ?? '');
        if (/^[\s\u0000-\u001f\u007f]*[=+\-@]/.test(result) || /^[\u0000-\u001f\u007f]/.test(result)) result = "'" + result;
        return '"' + result.replace(/"/g, '""') + '"';
      };
      return '\uFEFF' + rows.map(row => row.map(cell).join(',')).join('\r\n') + '\r\n';
    }
    return { list: () => clone(read()), save, remove, restore, previewImport, importBackup, exportBackup, exportCSV, rawBackup };
  }
  window.ReportStore = { create, LIMITS };
})();
