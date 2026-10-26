/* ============================================================
 * 应用主控：路由、状态、三类测试的渲染与交互
 * ============================================================ */
(function () {
  'use strict';

  const STORAGE_KEY = 'pathwise.state.v1';
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ---------------- 状态 ---------------- */
  const blank = () => ({
    assessmentProfile: window.AssessmentProfiles.CURRENT,
    info: { name: '', grade: '', year: '' },
    academic: { answers: {} },
    plan: { answers: { interests: [], schoolSubjects: [], weakSubjects: [], clubs: [], selfImage: [], preferredMajor: [], freeTime: [], career: [], countries: [] } },
    mbti: { answers: new Array(window.TRAIT_QUESTIONS.length).fill(null) },
    ui: { screen: 'home', idx: 0 },
    report: null
  });
  let S = blank();
  let reportLibrary = null;
  let cloudReports = null;
  const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const TEST_MODES = ['academic', 'plan', 'mbti'];
  let progressRaw = null, saveLocked = false, recognizedProfile = null, progressReadFailed = false;
  const legacyMode = () => S.assessmentProfile === window.AssessmentProfiles.LEGACY;
  const planQuestions = () => legacyMode() ? window.LegacyAssessment.planQuestions : window.PLAN_QUESTIONS;
  function profileNotice() {
    const notice = $('#profileNotice');
    notice.hidden = progressRaw === null && !legacyMode() && !progressReadFailed;
    $('#profileRawDownloadBtn').hidden = progressRaw === null;
    $('#profileContinueBtn').hidden = !saveLocked || !recognizedProfile;
    $('#profileNoticeText').textContent = progressReadFailed ? '无法读取浏览器原进度，未覆盖。本次仍可在内存中作答，但不会自动保存；尚未取得原始JSON，不能提供原始导出。请恢复读取后重新载入并核对，再决定继续或重测。' : saveLocked ? recognizedProfile
      ? `已识别${recognizedProfile === window.AssessmentProfiles.LEGACY ? '旧版进度（14道规划、24道数字量表）' : '未标记的新版游戏/特质进度'}。原始JSON已保护，确认继续前不会自动更新此浏览器进度。请先下载原始备份，再明确选择按原版本继续。`
      : '原始进度损坏、版本未知、混合或已转换，已停止自动保存。请下载原始JSON保留资料；当前只能明确开始新版，不能推断旧答案含义。'
      : legacyMode() ? '当前按旧版14道规划、24道数字量表继续，已允许保存；原答案不转换为新版特质。可保留原始JSON，另行确认开始新版。' : '';
    $('#startBtn').textContent = legacyMode() ? '继续旧版测评' : '开始测评';
    $('#restartBtn').textContent = legacyMode() ? '开始新版测评' : '重新测试';
    $('.step[data-step="mbti"] span').textContent = legacyMode() ? '旧版性格24题' : '性格特质';
    $('[data-g="3"]').textContent = legacyMode() ? '整合旧版MBTI性格偏好' : '整合性格特质与职业优势';
  }

  function load() {
    try {
      // A failed read does not establish that the key is empty: writes may
      // still succeed, so lock before attempting to read any existing bytes.
      saveLocked = true;
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw === null) { saveLocked = false; return; }
      progressRaw = raw; saveLocked = true;
      const saved = JSON.parse(raw);
      if (!isObject(saved) || Object.keys(saved).some(key => !['info', 'academic', 'plan', 'mbti', 'ui', 'report', 'assessmentProfile'].includes(key))) throw new Error('Unsupported saved state');
      const profile = window.AssessmentProfiles.stateProfile(saved);
      const answers = { info: saved.info, academic: saved.academic, plan: saved.plan, mbti: saved.mbti,
        ...(Object.hasOwn(saved, 'assessmentProfile') ? { assessmentProfile: saved.assessmentProfile } : {}) };
      const restored = window.ReportStore.validateState(answers, profile, { allowBlankName: true });
      restored.assessmentProfile = profile;
      restored.ui = Object.assign(blank().ui, isObject(saved.ui) ? saved.ui : {});
      if (!['home', 'info', 'test', 'generating', 'report', 'library', 'cloud', ...TEST_MODES].includes(restored.ui.screen)) restored.ui.screen = 'home';
      if (!TEST_MODES.includes(restored.ui.resumeScreen)) restored.ui.resumeScreen = TEST_MODES.includes(restored.ui.screen) ? restored.ui.screen : 'academic';
      restored.ui.idx = Number.isInteger(restored.ui.idx) && restored.ui.idx >= 0 ? restored.ui.idx : 0;
      restored.report = isObject(saved.report) && ['meta', 'academic', 'plan', 'mbti'].every(key => isObject(saved.report[key])) ? saved.report : null;
      S = restored;
      recognizedProfile = profile;
      saveLocked = profile !== window.AssessmentProfiles.CURRENT || saved.assessmentProfile !== window.AssessmentProfiles.CURRENT;
    } catch (e) { if (progressRaw === null) progressReadFailed = true; /* 不能把读取失败当作空进度。 */ }
  }
  let saveTimer = null;
  let autoAdvanceTimer = null;
  let itemStartAt = 0;
  let generationTimer = null;
  function cancelAutoAdvance() { clearTimeout(autoAdvanceTimer); autoAdvanceTimer = null; }
  function flush() {
    clearTimeout(saveTimer);
    if (saveLocked || progressCleared) return false;
    const notice = $('#storageNotice');
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(S));
      if (notice) notice.hidden = true;
      return true;
    } catch (e) {
      if (notice) {
        notice.textContent = '浏览器暂时无法保存进度。你仍可继续作答，请保持页面打开，并导出 PDF 留存报告。';
        notice.hidden = false;
      }
      return false;
    }
  }
  // 清空本机进度后不清空存储、只跳过写入，直到出现新的作答；避免离开页面时把空进度写回。
  let progressCleared = false;
  function save() {
    // 清空后（例如只剩基本信息）用户的新输入也视为新的进度，恢复自动保存。
    progressCleared = false;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, 120);
  }
  const persistPending = () => { if (progressCleared) return; clearTimeout(saveTimer); flush(); };
  window.addEventListener('beforeunload', persistPending);
  window.addEventListener('pagehide', persistPending);

  function sourceUnchanged() {
    if (!saveLocked) return true;
    try { if (localStorage.getItem(STORAGE_KEY) === progressRaw) return true; } catch (_) {}
    toast('浏览器原始进度已变化或暂时无法核对，未覆盖。请先保留备份并刷新页面。');
    return false;
  }
  $('#profileRawDownloadBtn').onclick = () => {
    if (progressRaw === null) return;
    const link = document.createElement('a'), url = URL.createObjectURL(new Blob([progressRaw], { type: 'application/json;charset=utf-8' }));
    link.href = url; link.download = 'bic-original-progress.json'; document.body.append(link); link.click(); link.remove(); URL.revokeObjectURL(url);
  };
  $('#profileContinueBtn').onclick = () => {
    if (!saveLocked || !recognizedProfile) return;
    const label = legacyMode() ? '旧版14道规划与24道数字量表' : '当前游戏与30道特质量表';
    if (!confirm(`请先下载原始JSON备份。确认按${label}原义继续，并允许自动更新此浏览器的进度？原始作答不会按位置转换到另一版本。`)
        || !sourceUnchanged()) return;
    saveLocked = false; profileNotice(); flush();
  };
  function startNew() {
    if (!confirm('开始新版游戏/30题特质测评将替换本浏览器的当前续答进度。请先归档报告或下载原始JSON备份。确认已保留需要的资料并开始新版？') || !sourceUnchanged()) return;
    clearTimeout(saveTimer); cancelAutoAdvance();
    S = blank(); progressRaw = null; recognizedProfile = null; saveLocked = false; progressReadFailed = false;
    profileNotice(); setScreen('home'); renderInfo(); $('#resumeBtn').hidden = true;
  }
  $('#profileRestartBtn').onclick = startNew;

  function archivedCount() {
    try { return window.ReportStore.create(window.localStorage).list().length; } catch (_) { return 0; }
  }
  function clearProgress() {
    if (!progressReadFailed && progressRaw === null && !hasProgress()) { toast('本机没有未完成的进度需要清空。'); return; }
    if (!window.confirm(`清空后本浏览器里${hasProgress() ? '未完成的作答' : '原始进度'}会被删除，不能恢复；本机报告库中的归档和账号登录状态不受影响。确定清空吗？`)) return;
    try { localStorage.removeItem(STORAGE_KEY); }
    catch (_) { toast('浏览器暂时无法删除本机进度，请关闭浏览器或手动清除本站数据。'); return; }
    // 先停掉待写入与自动跳题，避免计时器把旧进度写回刚清空的存储。
    clearTimeout(saveTimer); saveTimer = null; cancelAutoAdvance();
    if (S.ui.screen === 'library') reportLibrary?.onScreenLeft();
    S = blank(); progressRaw = null; recognizedProfile = null; saveLocked = false; progressReadFailed = false; progressCleared = true;
    profileNotice(); setScreen('home'); renderInfo(); $('#resumeBtn').hidden = true;
    const archived = archivedCount();
    toast(archived ? `已清空本机进度。本机报告库仍有 ${archived} 份归档，离开前请确认已导出。` : '已清空本机进度。');
  }
  $('#clearProgressBtn').onclick = clearProgress;
  $('#libraryClearProgressBtn').onclick = clearProgress;

  function isPlanAnswered(q, v) {
    if (typeof q.isAnswered === 'function') return q.isAnswered(v);
    return Array.isArray(v) ? v.length > 0 : v != null && v !== '';
  }

  function hasProgress() {
    return Object.keys(S.academic.answers).length > 0 || S.mbti.answers.some(v => v != null)
      || planQuestions().some(q => isPlanAnswered(q, S.plan.answers[q.key]))
      || Object.values(S.info).some(v => typeof v === 'string' && v.trim() !== '') || !!S.report;
  }

  /* ---------------- 通用 ---------------- */
  let toastTimer;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
  }

  const STEP_ORDER = ['info', 'academic', 'plan', 'mbti', 'report'];
  function setScreen(name, resume) {
    cancelAutoAdvance();
    if (S.ui.screen === 'cloud' && name !== 'cloud') cloudReports?.onScreenLeft();
    if (S.ui.screen === 'library' && name !== 'library') reportLibrary?.onScreenLeft();
    if (name !== 'generating' && generationTimer !== null) { clearInterval(generationTimer); generationTimer = null; }
    S.ui.screen = name;
    // 临时查看基本信息或首页时，保留原测试模块及题号。
    if (TEST_MODES.includes(name)) S.ui.resumeScreen = name;
    if (name === 'generating') S.ui.resumeScreen = 'mbti';
    $$('.screen').forEach(s => s.classList.toggle('active', s.id === 'screen-' + name));
    const phase = name === 'test' ? S.ui.resumeScreen : name;
    const cur = { home: -1, info: 0, academic: 1, plan: 2, mbti: 3, report: 4, generating: 3 }[phase];
    $$('.step').forEach(st => {
      const i = STEP_ORDER.indexOf(st.dataset.step);
      st.classList.toggle('active', i === cur);
      st.classList.toggle('done', i < cur);
    });
    // 测试页由 test-shell 自身负责上下空白，不再留出首页 hero 的顶部空间
    document.body.classList.toggle('in-test', ['test', ...TEST_MODES, 'generating'].includes(name));
    flush();
    $('#resumeBtn').hidden = !hasProgress();
    window.scrollTo(0, 0);
  }

  /* ---------------- 基本信息 ---------------- */
  function renderInfo() {
    const grades = [{ id: '8', label: '8 年级' }, { id: '9', label: '9 年级' }, { id: '10', label: '10 年级' }, { id: '11', label: '11 年级 / 预科' }];
    const years = ['2027 年秋季', '2028 年秋季', '2029 年秋季', '2030 年秋季'];
    $('#inGrade').innerHTML = grades.map(g => `<button type="button" role="radio" data-v="${g.id}" aria-checked="${S.info.grade === g.id}">${g.label}</button>`).join('');
    $('#inYear').innerHTML = years.map(y => `<button type="button" role="radio" data-v="${y}" aria-checked="${S.info.year === y}">${y}</button>`).join('');
    $('#inName').value = S.info.name || '';
    if (S.info.name) {
      // 已有基本信息：提供"直接更新报告"入口（页脚按钮，不改变原有表单结构）
      let foot = $('#infoForm .form-actions');
      let upd = $('#updateReportBtn');
      if (!upd) {
        upd = document.createElement('button');
        upd.type = 'button'; upd.id = 'updateReportBtn'; upd.className = 'btn ghost';
        upd.textContent = '直接生成 / 更新报告';
        upd.onclick = () => { setScreen('info'); generate(); };
        foot.insertBefore(upd, foot.lastElementChild);
      }
      upd.hidden = false;
    } else if ($('#updateReportBtn')) $('#updateReportBtn').hidden = true;

    $('#inGrade').onclick = (e) => {
      const b = e.target.closest('button'); if (!b) return;
      S.info.grade = b.dataset.v;
      S.plan.answers.grade = S.info.grade;
      $$('#inGrade button').forEach(x => x.setAttribute('aria-checked', x === b));
      save();
    };
    $('#inName').oninput = () => {
      S.info.name = $('#inName').value.trim(); // 实时同步，刷新后仍可直达报告
      save();
      const upd = $('#updateReportBtn');
      if (S.info.name && !upd) renderInfo(); else if (upd) upd.hidden = !S.info.name;
    };
    $('#inYear').onclick = (e) => {
      const b = e.target.closest('button'); if (!b) return;
      S.info.year = b.dataset.v;
      $$('#inYear button').forEach(x => x.setAttribute('aria-checked', x === b));
      save();
    };
  }

  $('#infoForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = $('#inName').value.trim();
    if (!name) { $('#inName').classList.add('invalid'); $('#inName').focus(); toast('请填写你的姓名'); return; }
    if (!S.info.grade) { toast('请选择当前年级'); return; }
    if (!S.info.year) { toast('请选择目标入学时间'); return; }
    S.info.name = name;
    startAcademic();
  });
  $('#inName').addEventListener('input', (e) => e.target.classList.remove('invalid'));

  /* ---------------- 测试引擎 ---------------- */
  const engine = {
    academic: {
      title: '学术能力测试', sub: '英语 · 数学 · 物理 · 化学',
      tip: '答错也没关系，结果会附上解析帮你查漏补缺',
      items() { return window.QUESTION_BANK; },
      get(i) { return S.academic.answers[this.items()[i].id]; },
      set(i, v) { S.academic.answers[this.items()[i].id] = v; },
      isAnswered(i) { const v = this.get(i); return v !== undefined && v !== null && v !== '' && Number.isFinite(Number(v)); },
      canSkip: false,
      render(item) {
        const meta = window.SUBJECT_META[item.subject];
        const options = item.type === 'choice'
          ? `<div class="options">${item.options.map((o, idx) => `
              <button class="option" data-v="${idx}" data-k="${'ABCD'[idx]}">
                <span class="key">${'ABCD'[idx]}</span><span>${esc(o)}</span>
              </button>`).join('')}</div>`
          : `<div class="numeric-row">
              <input type="number" step="any" inputmode="decimal" id="numAns" placeholder="输入数值" />
              <span>请输入一个数字（可含小数）</span>
            </div>`;
        return `<div class="q-tag">
            <span class="pill">${esc(meta.name)}</span>
            <span class="pill gray">${esc(item.topic)}</span>
            ${window.QUESTION_BANK_META?.difficultyLabels[item.difficulty] ? `<span class="pill gray">${esc(window.QUESTION_BANK_META.difficultyLabels[item.difficulty])}</span>` : ''}
            <span class="pill gray">${item.type === 'choice' ? '单选题' : '数值题'}</span>
          </div>
          <p class="q-prompt">${esc(item.prompt)}</p>
          ${item.zh ? `<div class="q-zh">${esc(item.zh)}</div>` : ''}
          ${options}`;
      },
      bind(item) {
        if (item.type === 'choice') {
          $$('#testBody .option').forEach(btn => {
            btn.classList.toggle('selected', this.get(this.idx) === Number(btn.dataset.v));
            btn.onclick = () => {
              const v = Number(btn.dataset.v);
              $$('#testBody .option').forEach(x => x.classList.toggle('selected', x === btn));
              this.set(this.idx, v);
              save();
              updateFoot();
            };
          });
        } else {
          const inp = $('#numAns');
          if (this.get(this.idx) != null) inp.value = this.get(this.idx);
          inp.focus();
          inp.oninput = () => {
            const v = inp.value.trim();
            this.set(this.idx, v === '' ? null : Number(v));
            save(); updateFoot();
          };
          inp.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); goNext(); } };
        }
      }
    },

    plan: {
      title: '专业规划测试', sub: '兴趣 · 学科 · 职业 · 留学意向 · 4 个互动小游戏',
      tip: '没有标准答案，跟着直觉走；小游戏可以拖动卡片，也可以先点卡片再点格子',
      items() { return planQuestions(); },
      get(i) { const key = this.items()[i].key, value = S.plan.answers[key]; return key === 'grade' && value === undefined ? S.info.grade : value; },
      set(i, v) {
        const key = this.items()[i].key;
        S.plan.answers[key] = v;
        if (key === 'grade') S.info.grade = v;
      },
      isAnswered(i) { const q = this.items()[i]; return isPlanAnswered(q, this.get(i)); },
      canSkip: true,
      render(item) {
        const src = typeof item.source === 'function' ? item.source() : [];
        let body = '';
        if (item.type === 'game') {
          body = '<div class="game-mount" aria-live="polite"></div>';
        } else if (item.type === 'single') {
          body = `<div class="options">${item.options().map((o, idx) => `
            <button class="option" data-v="${esc(o.id)}">
              <span class="key">${'ABCDEFG'[idx]}</span>
              <span class="label-wrap"><span>${esc(o.label)}</span>${o.desc ? `<span class="desc">${esc(o.desc)}</span>` : ''}</span>
            </button>`).join('')}</div>`;
        } else {
          const cur = this.get(this.idx) || [];
          body = `<div class="tag-grid">${src.map(o => `
            <button class="tag-card ${cur.includes(o.id) ? 'selected' : ''}" data-v="${esc(o.id)}" ${item.max && cur.length >= item.max && !cur.includes(o.id) ? 'disabled' : ''}>
              <span class="t">${o.icon ? `<span>${esc(o.icon)}</span>` : ''}${esc(o.label)}</span>
              ${o.desc ? `<span class="d">${esc(o.desc)}</span>` : ''}
            </button>`).join('')}</div>`;
        }
        return `<div class="q-tag">
            <span class="pill violet">规划 · ${this.idx + 1}/${this.items().length}</span>
            ${item.type === 'game' ? '<span class="pill green">🎮 互动游戏</span>' : ''}
            ${item.multi ? `<span class="pill gray">${item.max ? '最多选 ' + item.max + ' 项' : '可多选'}</span>` : ''}
            ${item.optional ? `<span class="pill gray">选填</span>` : ''}
          </div>
          <p class="q-prompt">${esc(item.title)}</p>
          ${item.sub ? `<p class="q-sub">${esc(item.sub)}</p>` : ''}
          ${body}`;
      },
      bind(item) {
        const body = $('#testBody');
        if (item.type === 'game') {
          const mount = $('.game-mount', body);
          window.Games[item.game](mount, this.get(this.idx), (value) => {
            this.set(this.idx, value);
            window.mergeBoard(item.key, value)(S.plan.answers);
            save(); updateFoot();
          });
          return;
        }
        if (item.type === 'single') {
          $$('.option', body).forEach(btn => {
            btn.classList.toggle('selected', this.get(this.idx) === btn.dataset.v);
            btn.onclick = () => {
              $$('.option', body).forEach(x => x.classList.toggle('selected', x === btn));
              this.set(this.idx, btn.dataset.v);
              save(); updateFoot();
            };
          });
        } else {
          $$('.tag-card', body).forEach(btn => {
            btn.onclick = () => {
              const v = btn.dataset.v;
              let cur = [...(this.get(this.idx) || [])];
              if (cur.includes(v)) cur = cur.filter(x => x !== v);
              else {
                if (item.max && cur.length >= item.max) { toast(`最多选择 ${item.max} 项`); return; }
                cur.push(v);
              }
              this.set(this.idx, cur);
              save();
              // 重新渲染以更新禁用状态
              renderItem();
            };
          });
        }
      }
    },

    mbti: {
      title: '性格特质测评', sub: '10 项职业相关特质 · 30 道情境题',
      tip: '没有好坏之分，请按你平时真实的样子作答',
      items() { return legacyMode() ? window.LegacyAssessment.mbtiQuestions : window.TRAIT_QUESTIONS; },
      get(i) { return S.mbti.answers[i]; },
      set(i, v) {
        // A resumed short scale stays short until an explicit answer reaches
        // a later item. Represent skipped positions as null, never sparse holes.
        while (S.mbti.answers.length < i) S.mbti.answers.push(null);
        S.mbti.answers[i] = v;
        delete S.mbti.legacy;
      },
      isAnswered(i) { const a = S.mbti.answers[i]; return legacyMode() ? Number.isInteger(a) && a >= 0 && a <= 4 : !!a && Number.isInteger(a.value); },
      canSkip: true,
      render(item) {
        const cur = this.get(this.idx);
        if (legacyMode()) return `<div class="q-tag"><span class="pill pink">旧版简版MBTI · 24题</span><span class="pill gray">${this.idx + 1}/${this.items().length}</span></div>
          <p class="mbti-statement">${esc(item.text)}</p><div class="likert" role="radiogroup">${window.LegacyAssessment.mbtiScale.map(scale => `<button role="radio" data-v="${scale.value}" aria-checked="${cur === scale.value}"><span class="dot"></span>${esc(scale.label)}</button>`).join('')}</div>`;
        const t = window.TRAITS.find(x => x.id === item.trait);
        const dims = ['行事风格', '面对挑战', '与人相处'];
        return `<div class="q-tag">
            <span class="pill pink">性格特质</span>
            <span class="pill gray">${item.reversed ? '换个角度' : '情境题'} · ${this.idx + 1}/${this.items().length}</span>
          </div>
          <p class="mbti-statement">${esc(item.text)}</p>
          <div class="trait-scene" aria-hidden="true"><span>${esc(t ? t.icon : '🧩')}</span></div>
          <p class="trait-sentence">「${esc(item.statement)}」<small>（这里的${dims[this.idx % 3]}没有对错）</small></p>
          <div class="likert" role="radiogroup">
            ${window.PERSONALITY_SCALE.map(s => `<button role="radio" data-v="${s.value}" aria-checked="${cur && cur.value === s.value}"><span class="dot"></span>${esc(s.label)}</button>`).join('')}
          </div>`;
      },
      bind() {
        $$('.likert button').forEach(btn => {
          btn.onclick = () => {
            $$('.likert button').forEach(x => x.setAttribute('aria-checked', x === btn));
            const started = performance.now();
            this.set(this.idx, legacyMode() ? Number(btn.dataset.v) : { value: Number(btn.dataset.v), ms: Math.round(started - itemStartAt) });
            save(); updateFoot();
            // 自动进入下一题；若期间用户改了选择则取消
            const pick = this.idx;
            cancelAutoAdvance();
            autoAdvanceTimer = setTimeout(() => {
              if (mode === 'mbti' && S.ui.screen === 'test' && this.idx === pick && this.isAnswered(pick)) goNext();
            }, 380);
          };
        });
      }
    }
  };

  let mode = 'academic';
  const items = () => engine[mode].items();
  const total = () => items().length;

  function startTest(m) {
    if (saveLocked && !recognizedProfile && !progressReadFailed) { toast('原始进度尚不能识别，请先下载原始JSON，再明确开始新版。'); return; }
    progressCleared = false;
    mode = m;
    const e = engine[m];
    e.idx = Math.min(S.ui.idx || 0, total() - 1);
    S.ui.resumeScreen = m;
    $('#testTitle').textContent = legacyMode() && m === 'mbti' ? '旧版简版MBTI（24题）' : e.title;
    $('#testSub').textContent = m === 'academic'
      ? `${e.sub} · ${window.QUESTION_BANK.length} 题${window.QUESTION_BANK_META?.version ? ' · 题库 ' + window.QUESTION_BANK_META.version : ''}`
      : legacyMode() ? m === 'plan' ? '旧版专业规划 · 14道原问答，不含新版游戏' : '旧版24道数字量表，保持原作答含义' : e.sub;
    setScreen('test', true);
    renderItem();
  }
  function startAcademic() { S.ui.idx = firstUnanswered(engine.academic); startTest('academic'); }
  function startPlan() { S.ui.idx = firstUnanswered(engine.plan); startTest('plan'); }
  function startMBTI() { S.ui.idx = firstUnanswered(engine.mbti); startTest('mbti'); }

  function firstUnanswered(e) {
    const n = e.items().length;
    for (let i = 0; i < n; i++) if (!e.isAnswered(i)) return i;
    return 0;
  }

  function renderItem() {
    cancelAutoAdvance();
    const e = engine[mode];
    e.idx = Math.max(0, Math.min(e.idx || 0, total() - 1));
    S.ui.idx = e.idx;
    const item = items()[e.idx];
    const body = $('#testBody');
    body.innerHTML = `<div class="question-enter">${e.render(item)}</div>`;
    itemStartAt = performance.now();
    e.bind(item);
    $('#testMeta').innerHTML = `<b>${e.idx + 1}</b> / ${total()}`;
    $('#testProgress').style.width = ((e.idx) / total() * 100) + '%';
    $('#testSkip').style.visibility = e.canSkip ? 'visible' : 'hidden';
    $('#testTip').textContent = legacyMode() && mode !== 'academic' ? '旧版原题继续作答，不转换为新版游戏或特质结论。' : e.tip;
    $('#testBack').disabled = e.idx === 0 && mode === 'academic';
    updateFoot();
    save();
  }

  function updateFoot() {
    const e = engine[mode];
    const ok = e.isAnswered(e.idx);
    const last = e.idx === total() - 1;
    const nextBtn = $('#testNext');
    nextBtn.innerHTML = last ? (mode === 'mbti' ? '生成报告 <span class="arrow">→</span>' : '完成本模块 <span class="arrow">→</span>') : '下一题 <span class="arrow">→</span>';
    nextBtn.disabled = !ok;
    $('#testTip').classList.toggle('warn', !ok);
  }

  function goNext() {
    if (S.ui.screen !== 'test') return;
    cancelAutoAdvance();
    const e = engine[mode];
    if (!e.isAnswered(e.idx)) {
      if (mode === 'academic') { toast('请先作答本题'); return; }
      if (!e.items()[e.idx].optional) { toast('请选择一个选项，或点击跳过'); return; }
    }
    if (e.idx < total() - 1) { e.idx++; renderItem(); return; }
    finishModule();
  }

  function finishModule() {
    if (mode === 'academic') {
      const left = total() - engine.academic.items().filter((_, i) => engine.academic.isAnswered(i)).length;
      if (left > 0 && !confirm(`还有 ${left} 道题未作答，未作答的题目将不计分。确定继续吗？`)) return;
      startPlan();
    } else if (mode === 'plan') {
      startMBTI();
    } else {
      generate();
    }
  }

  $('#testNext').onclick = goNext;
  $('#testBack').onclick = () => {
    const e = engine[mode];
    if (e.idx > 0) { e.idx--; renderItem(); return; }
    if (mode === 'academic') { setScreen('info'); S.ui.resumeScreen = 'academic'; renderInfo(); }
    else {
      const previousMode = mode === 'plan' ? 'academic' : 'plan';
      S.ui.idx = engine[previousMode].items().length - 1;
      startTest(previousMode);
    }
  };
  $('#testSkip').onclick = () => {
    const e = engine[mode];
    if (mode === 'academic') return;
    if (e.idx < total() - 1) { e.idx++; renderItem(); } else finishModule();
  };

  // 键盘快捷键：1-9 选项，Enter 下一题
  document.addEventListener('keydown', (ev) => {
    if (!document.getElementById('screen-test').classList.contains('active')) return;
    if (ev.target.matches('input, textarea, select, [contenteditable=true]') || ev.ctrlKey || ev.altKey || ev.metaKey) return;
    if (ev.key === 'Enter') { ev.preventDefault(); goNext(); return; }
    const n = Number(ev.key);
    const body = $('#testBody');
    if (Number.isInteger(n) && n >= 1 && n <= 9) {
      if (mode === 'mbti') { const b = $$('.likert button')[n - 1]; if (b) b.click(); return; }
      if (mode === 'academic') { const b = $$('.option')[n - 1]; if (b) b.click(); return; }
      if (mode === 'plan') {
        const item = items()[engine.plan.idx];
        if (item.type === 'single') { const b = $$('.option')[n - 1]; if (b) b.click(); return; }
        if (item.type === 'game' && item.game === 'race') { const b = $$('.race-block')[n <= 4 ? 0 : 1]?.querySelectorAll('.race-item')[n <= 4 ? n - 1 : n - 5]; if (b) b.click(); return; }
        if (item.type === 'game' && item.game === 'dart') { const b = $$('.dart-ring')[n - 1]; if (b) b.click(); return; }
      }
    }
    // 多选：按 A-K 字母也可选
    if (ev.key.length !== 1) return;
    const letter = ev.key.toUpperCase();
    const cards = $$('.tag-card');
    if (mode === 'plan' && letter >= 'A' && letter <= 'Z') {
      const idx = letter.charCodeAt(0) - 65;
      const item = items()[engine.plan.idx];
      if ((item.type === 'tags' || !item.type) && cards[idx]) cards[idx].click();
    }
  });

  /* ---------------- 报告生成 ---------------- */
  function generate() {
    if (saveLocked && !recognizedProfile && !progressReadFailed) { toast('原始进度尚不能识别，未生成报告。请先下载备份，再明确开始新版。'); return; }
    if (generationTimer !== null) return;
    setScreen('generating');
    const lis = $$('.gen-steps li');
    lis.forEach(li => li.className = '');
    let i = 0;
    generationTimer = setInterval(() => {
      if (i < lis.length) { lis[i].className = 'ok'; }
      if (i + 1 < lis.length) lis[i + 1].className = 'on';
      i++;
      if (i > lis.length) {
        clearInterval(generationTimer);
        generationTimer = null;
        try {
          const previousReport = S.report;
          const nextReport = window.generateReport(S);
          window.reportEditing?.carryEdits(previousReport, nextReport);
          S.report = nextReport;
        } catch (err) {
          console.error(err);
          toast('生成报告时出现错误：' + err.message);
          setScreen('home');
          return;
        }
        renderReport(false);
      }
    }, 420);
  }

  function refreshCurrentReport() {
    const previous = S.report;
    if (!previous) return;
    let r = previous;
    {
      // 基本资料/作答可能已在其他页面更新；展示与归档必须使用同一份最新结果。
      r = window.generateReport(S);
      const material = report => JSON.stringify({ name: report.meta.name, grade: report.meta.gradeId, year: report.meta.year,
        academic: report.academic, plan: report.plan, mbti: report.mbti, next: report.next });
      const changed = material(previous) !== material(r);
      r.meta.batchId = previous.meta.batchId || r.meta.batchId;
      r.meta.date = previous.meta.date || r.meta.date;
      window.reportEditing?.carryEdits(previous, r);
      if (r.advisor) {
        if (previous.advisor?.carriedFrom) r.advisor.carriedFrom = previous.advisor.carriedFrom;
        else if (!changed) delete r.advisor.carriedFrom;
      }
      S.report = r;
    }
    return r;
  }

  function renderReport(refresh = true) {
    const r = refresh ? refreshCurrentReport() : S.report;
    if (!r) return;
    $('#reportRoot').innerHTML = window.renderReport(r);
    $('#reportId').textContent = r.meta.batchId;
    setScreen('report');
    window.animateReport($('#reportRoot'));
    reportLibrary?.onReportRendered(r);
    cloudReports?.onReportRendered(r);
    window.reportEditing?.mount(r, () => { const persisted = flush(); renderReport(false); return persisted; });
  }

  $('#pdfBtn').onclick = () => {
    toast('在打印窗口中选择「另存为 PDF」即可保存报告');
    setTimeout(() => window.print(), 350);
  };
  $('#restartBtn').onclick = startNew;

  /* ---------------- 首页 ---------------- */
  function resumeProgress() {
    if (saveLocked && !recognizedProfile && !progressReadFailed) { toast('请先下载原始JSON，再点击保护提示中的开始新版。'); return; }
    if (S.report) { renderReport(); return; }
    const s = S.ui.resumeScreen;
    if (S.info.name && TEST_MODES.includes(s)) { startTest(s); return; }
    setScreen('info');
    renderInfo();
  }
  $('#startBtn').onclick = resumeProgress;
  $('#resumeBtn').onclick = resumeProgress;
  $$('[data-goto]').forEach(b => b.onclick = () => {
    const t = b.dataset.goto;
    setScreen(t);
    if (t === 'info') renderInfo();
  });
  $$('.step').forEach(st => st.onclick = () => {
    const t = st.dataset.step;
    if (t === 'info') { setScreen('info'); renderInfo(); }
    else if (t === 'report' && S.report) renderReport();
  });

  /* ---------------- 启动 ---------------- */
  function boot() {
    load();
    profileNotice();
    // 报告在 renderReport 中按已校验作答重算，保留原编号、日期和顾问来源。
    const s = S.ui.screen;
    setScreen('home', true);
    renderInfo();
    $('#resumeBtn').hidden = !hasProgress();
    if (s === 'report' && S.report) renderReport();
    else if (s === 'info') { setScreen('info'); renderInfo(); }
    else if (s === 'test' || TEST_MODES.includes(s)) startTest(s === 'test' ? S.ui.resumeScreen : s);
    else if (s === 'generating') generate();
    else if (s === 'library') setScreen('library');
    else if (s === 'cloud') setScreen('cloud');
  }
  boot();

  /* ---------------- 本机报告库 ---------------- */
  let libraryReturnScreen = 'home';
  reportLibrary = window.ReportLibrary?.init({
    getState: () => S,
    hasProgress,
    showLibrary() {
      if (S.ui.screen !== 'library') libraryReturnScreen = S.ui.screen;
      setScreen('library');
    },
    closeLibrary() {
      if (libraryReturnScreen === 'report' && S.report) renderReport();
      else if (libraryReturnScreen === 'info') { setScreen('info'); renderInfo(); }
      else setScreen('home');
    },
    openState: openReportState
  });
  if (S.ui.screen === 'library') reportLibrary?.render();

  function openReportState(next) {
    const previous = S;
    const profile = window.AssessmentProfiles.stateProfile(next);
    const checked = window.ReportStore.validateState({ info: next.info, academic: next.academic, plan: next.plan, mbti: next.mbti,
      ...(Object.hasOwn(next, 'assessmentProfile') ? { assessmentProfile: next.assessmentProfile } : {}) }, profile, { allowBlankName: true });
    if (saveLocked && (!confirm('打开报告会替换已保护的原始续答进度。请先下载原始JSON备份，确认继续打开并允许保存？') || !sourceUnchanged())) throw new Error('已取消替换受保护的续答进度。');
    const previousLock = saveLocked;
    // 写入失败时保留当前学生的内存和磁盘进度；云端读取也复用此边界。
    S = { ...next, ...checked, assessmentProfile: profile }; saveLocked = false;
    if (!flush()) {
      S = previous; saveLocked = previousLock;
      throw new Error('无法保存打开的报告，当前作答未替换。请先导出备份并释放本地空间。');
    }
    if (previous.ui.screen === 'cloud') cloudReports?.onScreenLeft();
    if (previous.ui.screen === 'library') reportLibrary?.onScreenLeft();
    profileNotice();
    renderInfo();
    renderReport(false);
    return true;
  }

  /* ---------------- 可选服务端报告 ---------------- */
  let cloudReturnScreen = 'home';
  if (window.CloudReports && window.CloudReportUI) {
    const client = window.CloudReports.create({ config: window.BIC_CLOUD_CONFIG,
      location: window.location, fetch: window.fetch.bind(window) });
    cloudReports = window.CloudReportUI.init({
      client,
      getState: () => S,
      getCurrentRecord() {
        if (!S.report) throw new Error('请先生成当前学生的报告，或选择一份本机归档。');
        refreshCurrentReport();
        let raw = null;
        const memory = window.ReportStore.create({ getItem: () => raw, setItem: (_, value) => { raw = value; } });
        return memory.save(S).record;
      },
      hasProgress,
      openState: openReportState,
      isActive: () => S.ui.screen === 'cloud',
      showCloud() {
        if (S.ui.screen !== 'cloud') cloudReturnScreen = S.ui.screen;
        setScreen('cloud');
      },
      closeCloud() {
        if (cloudReturnScreen === 'report' && S.report) renderReport();
        else if (cloudReturnScreen === 'info') { setScreen('info'); renderInfo(); }
        else if (cloudReturnScreen === 'library') { setScreen('library'); reportLibrary?.render(); }
        else setScreen('home');
      }
    });
  }

  // 暴露给调试
  window.__pathwise = { get state() { return S; }, generate, startTest, reset() { S = blank(); setScreen('home'); profileNotice(); renderInfo(); $('#resumeBtn').hidden = true; } };
})();
