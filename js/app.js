/* ============================================================
 * 应用主控：路由、状态、三类测试的渲染与交互
 * ============================================================ */
(function () {
  'use strict';

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
  let cloudReports = null;
  // 一次性测试码：线上启用 testcode 模式时，开始测评前必须凭码加入。
  const testCodeConfig = window.BIC_CLOUD_CONFIG || {};
  const testCodeRequired = testCodeConfig.enabled === true && testCodeConfig.mode === 'testcode'
    && typeof location !== 'undefined' && location.protocol !== 'file:';
  let testCodeClient = null;
  let pendingStart = null;
  let testCodeBusy = false;
  let submittedBatch = null;
  const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const TEST_MODES = ['academic', 'plan', 'mbti'];
  const legacyMode = () => S.assessmentProfile === window.AssessmentProfiles.LEGACY;
  const planQuestions = () => legacyMode() ? window.LegacyAssessment.planQuestions : window.PLAN_QUESTIONS;
  // 账号面板打开的记录只在页面上查看，不属于本机进度。
  let cloudReadOnly = false;
  function profileNotice() {
    $('#startBtn').textContent = legacyMode() ? '继续旧版测评' : '开始测评';
    $('#restartBtn').textContent = legacyMode() ? '开始新版测评' : '重新测试';
    $('.step[data-step="mbti"] span').textContent = legacyMode() ? '旧版性格24题' : '性格特质';
    $('[data-g="3"]').textContent = legacyMode() ? '整合旧版MBTI性格偏好' : '整合性格特质与职业优势';
  }

  // 本机不保存作答、进度或报告。下面的内存种子只供自动化测试和调试在页面启动前注入状态，
  // 用户正常打开页面时不存在，也不会写入浏览器存储。
  function load() {
    const saved = window.__BIC_SEED_STATE__;
    if (!isObject(saved)) return;
    try {
      if (Object.keys(saved).some(key => !['info', 'academic', 'plan', 'mbti', 'ui', 'report', 'assessmentProfile', 'reportMeta', 'advisor'].includes(key))) return;
      const profile = window.AssessmentProfiles.stateProfile(saved);
      const answers = { info: saved.info, academic: saved.academic, plan: saved.plan, mbti: saved.mbti,
        ...(Object.hasOwn(saved, 'assessmentProfile') ? { assessmentProfile: saved.assessmentProfile } : {}) };
      const restored = window.ReportStore.validateState(answers, profile, { allowBlankName: true });
      restored.assessmentProfile = profile;
      restored.ui = Object.assign(blank().ui, isObject(saved.ui) ? saved.ui : {});
      if (!['home', 'info', 'test', 'generating', 'report', 'cloud', ...TEST_MODES].includes(restored.ui.screen)) restored.ui.screen = 'home';
      if (!TEST_MODES.includes(restored.ui.resumeScreen)) restored.ui.resumeScreen = TEST_MODES.includes(restored.ui.screen) ? restored.ui.screen : 'academic';
      restored.ui.idx = Number.isInteger(restored.ui.idx) && restored.ui.idx >= 0 ? restored.ui.idx : 0;
      restored.report = isObject(saved.report) && ['meta', 'academic', 'plan', 'mbti'].every(key => isObject(saved.report[key])) ? saved.report : null;
      S = restored;
    } catch (_) { S = blank(); }
  }
  let autoAdvanceTimer = null;
  let itemStartAt = 0;
  let generationTimer = null;
  function cancelAutoAdvance() { clearTimeout(autoAdvanceTimer); autoAdvanceTimer = null; }
  // 页面只在内存中保留当前作答和报告；刷新或关闭后无法恢复。
  function startNew() {
    cancelAutoAdvance();
    S = blank(); cloudReadOnly = false;
    profileNotice(); setScreen('home'); renderInfo();
  }

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
    if (name !== 'generating' && generationTimer !== null) { clearInterval(generationTimer); generationTimer = null; }
    S.ui.screen = name;
    // 临时查看基本信息或首页时，保留原测试模块及题号。
    if (TEST_MODES.includes(name)) S.ui.resumeScreen = name;
    if (name === 'generating') S.ui.resumeScreen = 'mbti';
    // 先移除再添加，保证唯一活动屏的 class 变化总能触发样式重算。
    $$('.screen').forEach(s => s.classList.remove('active'));
    $('#screen-' + name)?.classList.add('active');
    const phase = name === 'test' ? S.ui.resumeScreen : name;
    const cur = { home: -1, info: 0, academic: 1, plan: 2, mbti: 3, report: 4, generating: 3 }[phase];
    $$('.step').forEach(st => {
      const i = STEP_ORDER.indexOf(st.dataset.step);
      st.classList.toggle('active', i === cur);
      st.classList.toggle('done', i < cur);
    });
    // 测试页由 test-shell 自身负责上下空白，不再留出首页 hero 的顶部空间
    document.body.classList.toggle('in-test', ['test', ...TEST_MODES, 'generating'].includes(name));
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
    };
    $('#inName').oninput = () => {
      S.info.name = $('#inName').value.trim(); // 实时同步，刷新后仍可直达报告
      const upd = $('#updateReportBtn');
      if (S.info.name && !upd) renderInfo(); else if (upd) upd.hidden = !S.info.name;
    };
    $('#inYear').onclick = (e) => {
      const b = e.target.closest('button'); if (!b) return;
      S.info.year = b.dataset.v;
      $$('#inYear button').forEach(x => x.setAttribute('aria-checked', x === b));
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
            updateFoot();
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
            updateFoot();
          });
          return;
        }
        if (item.type === 'single') {
          $$('.option', body).forEach(btn => {
            btn.classList.toggle('selected', this.get(this.idx) === btn.dataset.v);
            btn.onclick = () => {
              $$('.option', body).forEach(x => x.classList.toggle('selected', x === btn));
              this.set(this.idx, btn.dataset.v);
              updateFoot();
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
            updateFoot();
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

  /* ---------------- 一次性测试码 ---------------- */
  if (testCodeRequired && window.CloudReports) {
    testCodeClient = window.CloudReports.create({
      config: testCodeConfig, location: window.location, fetch: window.fetch.bind(window)
    });
    for (const selector of ['#cloudBtn', '#openCloudBtn']) {
      const button = $(selector);
      if (button) button.hidden = true;
    }
  }
  // 只在当前页面内存中记住已加入，不写入 sessionStorage；刷新后重新向服务端确认会话。
  let testCodeJoined = false;
  const markTestCodeJoined = () => { testCodeJoined = true; };
  function testCodeError(error) {
    if (error?.status === 429 || error?.code === 'RATE_LIMIT') return '尝试次数过多，请稍后再试。';
    if (error?.status === 409) return '这个测试码已经被使用，请向老师索取新的测试码。';
    if (error?.status === 410) return '测试码已过期或已被撤销，请向老师索取新的测试码。';
    if (error?.status === 404) return '测试码不存在，请核对后重试。';
    if (error?.status === 422) return '请输入有效的测试码。';
    if (error?.code === 'LOCAL_ONLY' || error?.code === 'CONFIG') return '当前网址无法连接测试码服务，请使用学校提供的网址。';
    return '无法连接测试码服务，请检查网络后重试。';
  }
  function closeCodeGate() {
    $('#codeGate').hidden = true;
    $('#codeGateStatus').textContent = '';
    $('#codeGateInput').value = '';
  }
  async function ensureTestCode(next) {
    if (!testCodeRequired || !testCodeClient || testCodeJoined) { next(); return; }
    try {
      const active = await testCodeClient.testCodeSession();
      if (active) { markTestCodeJoined(); next(); return; }
    } catch (_) { /* 无法确认时仍显示输入框。 */ }
    pendingStart = next;
    $('#codeGateStatus').textContent = '';
    $('#codeGateInput').value = '';
    $('#codeGate').hidden = false;
    setTimeout(() => $('#codeGateInput').focus(), 0);
  }
  $('#codeGateCancel').onclick = () => { if (!testCodeBusy) { pendingStart = null; closeCodeGate(); } };
  $('#codeGateForm').onsubmit = async event => {
    event.preventDefault();
    if (testCodeBusy || !testCodeClient) return;
    const code = $('#codeGateInput').value;
    testCodeBusy = true;
    $('#codeGateSubmit').disabled = true;
    $('#codeGateStatus').textContent = '正在校验测试码…';
    try {
      await testCodeClient.joinTestCode(code);
      markTestCodeJoined();
      const next = pendingStart;
      pendingStart = null;
      closeCodeGate();
      if (next) next();
    } catch (error) {
      $('#codeGateStatus').textContent = testCodeError(error);
    } finally {
      testCodeBusy = false;
      $('#codeGateSubmit').disabled = false;
    }
  };

  function submitStatus(text, error = false) {
    const element = $('#reportSubmitStatus');
    if (!element) return;
    element.hidden = !text;
    element.textContent = text || '';
    element.classList.toggle('is-error', !!error);
  }
  async function autoSubmitReport(force = false) {
    if (!testCodeRequired || !testCodeClient) return;
    const batch = S.report?.meta?.batchId;
    if (!batch || !$('#reportSubmitStatus')) return;
    if (!force && batch === submittedBatch) return;
    const retry = $('#reportSubmitRetry');
    if (retry) retry.hidden = true;
    submitStatus('正在把报告提交到服务器…');
    try {
      // 与账号上传使用同一份校验后的归档记录，避免另造一种报告格式。
      const memory = window.ReportStore.create({ getItem: () => null, setItem: () => {} });
      const result = await testCodeClient.submitStudentReport(memory.save(S).record);
      submittedBatch = batch;
      // 测试码已随报告完成；之后重新开始必须重新向服务端确认或输入新码。
      testCodeJoined = false;
      submitStatus(result.created ? '报告已提交到服务器保存。请立即导出 PDF 留存。' : '报告已在服务器上，无需重复提交。请立即导出 PDF 留存。');
    } catch (_) {
      submitStatus('报告提交未成功。你仍可查看和导出 PDF；请检查网络后点击「重新提交报告」。', true);
      if (retry) retry.hidden = false;
    }
  }
  $('#reportSubmitRetry').onclick = () => autoSubmitReport(true);

  /* ---------------- 报告生成 ---------------- */
  function generate() {
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
        autoSubmitReport();
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
    cloudReports?.onReportRendered(r);
    window.reportEditing?.mount(r, () => { renderReport(false); return true; });
  }

  $('#pdfBtn').onclick = () => {
    toast('在打印窗口中选择「另存为 PDF」即可保存报告');
    setTimeout(() => window.print(), 350);
  };
  $('#restartBtn').onclick = () => {
    if (!confirm('重新测试会清除当前页面上的报告，关闭后无法再次查看。请先导出 PDF。确定继续吗？')) return;
    ensureTestCode(startNew);
  };

  /* ---------------- 首页 ---------------- */
  // 只在同一个页面内回到上次的模块和题号；刷新或关闭页面后没有任何本机进度。
  function resumeProgress() {
    if (S.report) { renderReport(); return; }
    const s = S.ui.resumeScreen;
    if (S.info.name && TEST_MODES.includes(s) && hasProgress()) { startTest(s); return; }
    setScreen('info');
    renderInfo();
  }
  function startFromHome() {
    // 已生成的报告只在当前页面查看/打印；刷新或关闭后不会保留。
    if (S.report) { renderReport(); return; }
    ensureTestCode(resumeProgress);
  }
  $('#startBtn').onclick = startFromHome;
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
    // 打开网址一律停在首页，不自动恢复任何本机内容。
    setScreen("home", true);
    renderInfo();
  }
  boot();

  // 账号面板读取的报告只在当前页面内存中查看。
  function openReportState(next) {
    const previous = S;
    const profile = window.AssessmentProfiles.stateProfile(next);
    const checked = window.ReportStore.validateState({ info: next.info, academic: next.academic, plan: next.plan, mbti: next.mbti,
      ...(Object.hasOwn(next, 'assessmentProfile') ? { assessmentProfile: next.assessmentProfile } : {}) }, profile, { allowBlankName: true });
    S = { ...next, ...checked, assessmentProfile: profile, ui: previous.ui };
    const report = next.report && typeof next.report === 'object' ? next.report : window.generateReport(S);
    Object.assign(report.meta, { batchId: next.reportMeta?.batchId || report.meta.batchId, date: next.reportMeta?.date || report.meta.date });
    S.report = next.advisor && !next.report ? { ...report, advisor: next.advisor } : report;
    if (previous.ui?.screen === 'cloud') cloudReports?.onScreenLeft({ keepStatus: true });
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
        if (!S.report) throw new Error('请先生成当前学生的报告。');
        refreshCurrentReport();
        let raw = null;
        const memory = window.ReportStore.create({ getItem: () => raw, setItem: (_, value) => { raw = value; } });
        return memory.save(S).record;
      },
      hasProgress,
      // 只读打开的账号记录可以再次作为「当前报告」上传。
      readOnlyRecord(profile) {
        if (!cloudReadOnly || !S.report) return null;
        const memory = window.ReportStore.create({ getItem: () => null, setItem: () => {} });
        const record = memory.save({ ...S, assessmentProfile: profile || S.assessmentProfile || window.AssessmentProfiles.CURRENT }).record;
        return record;
      },
      // 打开账号记录：只在当前页面内存中显示这份报告。
      openState(next) {
        const previous = S;
        try { const restored = openReportState(next); cloudReadOnly = !!restored; return restored; }
        catch (error) { S = previous; cloudReadOnly = false; throw error; }
      },
      isActive: () => S.ui.screen === 'cloud',
      showCloud() {
        if (S.ui.screen !== 'cloud') cloudReturnScreen = S.ui.screen;
        setScreen('cloud');
      },
      closeCloud() {
        cloudReadOnly = false;
        refreshCurrentReport();
        if (cloudReturnScreen === 'report' && S.report) renderReport();
        else if (cloudReturnScreen === 'info') { setScreen('info'); renderInfo(); }
        else setScreen('home');
      }
    });
  }

  // 暴露给调试
  window.__pathwise = { get state() { return S; }, generate, startTest, openState: openReportState,
    reset() { S = blank(); cloudReadOnly = false; setScreen('home'); profileNotice(); renderInfo(); } };
})();
