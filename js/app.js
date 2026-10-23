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
    info: { name: '', grade: '', year: '' },
    academic: { answers: {} },
    plan: { answers: { interests: [], schoolSubjects: [], weakSubjects: [], clubs: [], selfImage: [], preferredMajor: [], freeTime: [], career: [], countries: [] } },
    mbti: { answers: new Array(window.MBTI_QUESTIONS.length).fill(null) },
    ui: { screen: 'home', idx: 0 },
    report: null
  });
  let S = blank();

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      if (sessionStorage.getItem('pathwise.fresh') === '1') {
        sessionStorage.removeItem('pathwise.fresh');
        localStorage.removeItem(STORAGE_KEY);
        return;
      }
      const saved = JSON.parse(raw);
      S = Object.assign(blank(), saved);
      S.info = Object.assign(blank().info, saved.info || {});
      S.ui = Object.assign(blank().ui, saved.ui || {});
      if (S.ui.screen === 'test') S.ui.screen = ['academic', 'plan', 'mbti'].includes(saved.ui.resumeScreen) ? saved.ui.resumeScreen : 'academic';
      S.academic = Object.assign(blank().academic, saved.academic || {});
      S.academic.answers = Object.assign({}, saved.academic?.answers || {});
      S.plan.answers = Object.assign(blank().plan.answers, saved.plan?.answers || {});
      // 保证 MBTI 答案数组长度正确
      const a = new Array(window.MBTI_QUESTIONS.length).fill(null);
      (saved.mbti?.answers || []).forEach((v, i) => { if (i < a.length) a[i] = v; });
      S.mbti.answers = a;
    } catch (e) { /* 忽略损坏的本地数据 */ }
  }
  let saveTimer = null;
  function flush() {
    clearTimeout(saveTimer);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(S)); } catch (e) { /* 存储已满时静默失败 */ }
  }
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, 120);
  }
  window.addEventListener('beforeunload', () => { clearTimeout(saveTimer); flush(); });

  /* 首次打开时清空过期的中断进度，保证从信息页开始 */
  (function dropStaleProgress() {
    try {
      if (sessionStorage.getItem('pathwise.entered')) return;
      sessionStorage.setItem('pathwise.entered', '1');
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const prev = JSON.parse(raw);
      if (prev.report) return; // 已有完整报告则保留
      if (prev.ui && prev.ui.screen && prev.ui.screen !== 'home') {
        localStorage.removeItem(STORAGE_KEY);
        sessionStorage.setItem('pathwise.fresh', '1');
      }
    } catch (e) { /* ignore */ }
  })();

  function hasProgress() {
    return Object.keys(S.academic.answers).length > 0 || S.mbti.answers.some(v => v != null)
      || Object.values(S.plan.answers).some(v => Array.isArray(v) && v.length) || !!S.info.name;
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
    S.ui.screen = name;
    // 记录"上一次真实阶段"，测试页本身不覆盖它，刷新后才能回到对应模块
    if (!resume) S.ui.resumeScreen = name === 'generating' ? 'mbti' : name;
    $$('.screen').forEach(s => s.classList.toggle('active', s.id === 'screen-' + name));
    const cur = { home: -1, info: 0, academic: 1, plan: 2, mbti: 3, report: 4, generating: 3 }[name];
    $$('.step').forEach(st => {
      const i = STEP_ORDER.indexOf(st.dataset.step);
      st.classList.toggle('active', i === cur);
      st.classList.toggle('done', i < cur);
    });
    // 测试页由 test-shell 自身负责上下空白，不再留出首页 hero 的顶部空间
    document.body.classList.toggle('in-test', ['academic', 'plan', 'mbti', 'generating'].includes(name));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(S)); // 立即写入，避免刷新丢失当前阶段
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
      $$('#inGrade button').forEach(x => x.setAttribute('aria-checked', x === b));
      save();
    };
    $('#inName').oninput = () => {
      S.info.name = $('#inName').value.trim(); // 实时同步，刷新后仍可直达报告
      save();
      const upd = $('#updateReportBtn');
      if (S.info.name && !upd) renderInfo(); else if (!S.info.name && upd) upd.hidden = true;
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
      isAnswered(i) { const v = this.get(i); return v !== undefined && v !== null && v !== ''; },
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
            <span class="pill gray">${item.type === 'choice' ? '单选题' : '数值题'}</span>
          </div>
          <p class="q-prompt">${esc(item.prompt)}</p>
          ${item.zh ? `<div class="q-zh">${esc(item.zh)}</div>` : ''}
          ${options}`;
      },
      bind(item) {
        if (item.type === 'choice') {
          $$('#testBody .option').forEach(btn => {
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
      title: '专业规划测试', sub: '兴趣 · 学科 · 职业 · 留学意向',
      tip: '没有标准答案，跟着直觉选最像你的选项',
      items() { return window.PLAN_QUESTIONS; },
      get(i) { return S.plan.answers[this.items()[i].key]; },
      set(i, v) { S.plan.answers[this.items()[i].key] = v; },
      isAnswered(i) { const v = this.get(i); return Array.isArray(v) ? v.length > 0 : !!v || this.items()[i].optional; },
      canSkip: true,
      render(item) {
        const src = typeof item.source === 'function' ? item.source() : [];
        let body = '';
        if (item.type === 'single') {
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
            ${item.multi ? `<span class="pill gray">${item.max ? '最多选 ' + item.max + ' 项' : '可多选'}</span>` : ''}
            ${item.optional ? `<span class="pill gray">选填</span>` : ''}
          </div>
          <p class="q-prompt">${esc(item.title)}</p>
          ${item.sub ? `<p class="q-sub">${esc(item.sub)}</p>` : ''}
          ${body}`;
      },
      bind(item) {
        const body = $('#testBody');
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
      title: '简版性格测试', sub: 'MBTI · 4 个维度 · 24 道题',
      tip: '请凭第一直觉作答，不必过度思考',
      items() { return window.MBTI_QUESTIONS; },
      get(i) { return S.mbti.answers[i]; },
      set(i, v) { S.mbti.answers[i] = v; },
      isAnswered(i) { return S.mbti.answers[i] != null; },
      canSkip: true,
      render(item) {
        const cur = this.get(this.idx);
        return `<div class="q-tag">
            <span class="pill pink">性格判断</span>
            <span class="pill gray">${this.idx < 6 ? '能量来源 E/I' : this.idx < 12 ? '信息获取 S/N' : this.idx < 18 ? '决策方式 T/F' : '生活方式 J/P'}</span>
          </div>
          <p class="mbti-statement">${esc(item.text)}</p>
          <div class="likert" role="radiogroup">
            ${window.MBTI_SCALE.map(s => `<button role="radio" data-v="${s.value}" aria-checked="${cur === s.value}"><span class="dot"></span>${esc(s.label)}</button>`).join('')}
          </div>`;
      },
      bind() {
        $$('.likert button').forEach(btn => {
          btn.onclick = () => {
            $$('.likert button').forEach(x => x.setAttribute('aria-checked', x === btn));
            this.set(this.idx, Number(btn.dataset.v));
            save(); updateFoot();
            // 自动进入下一题；若期间用户改了选择则取消
            const pick = this.idx;
            setTimeout(() => { if (this.idx === pick && this.isAnswered(pick)) goNext(); }, 380);
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
    $('#testTitle').textContent = e.title;
    $('#testSub').textContent = e.sub;
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
    const e = engine[mode];
    e.idx = Math.max(0, Math.min(e.idx || 0, total() - 1));
    S.ui.idx = e.idx;
    const item = items()[e.idx];
    const body = $('#testBody');
    body.innerHTML = `<div class="question-enter">${e.render(item)}</div>`;
    e.bind(item);
    $('#testMeta').innerHTML = `<b>${e.idx + 1}</b> / ${total()}`;
    $('#testProgress').style.width = ((e.idx) / total() * 100) + '%';
    $('#testSkip').style.visibility = e.canSkip ? 'visible' : 'hidden';
    $('#testTip').textContent = e.tip;
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
    if (mode === 'academic') { setScreen('info'); S.ui.resumeScreen = 'academic'; }
    else if (mode === 'plan') { startAcademic(); }
    else { startPlan(); }
  };
  $('#testSkip').onclick = () => {
    const e = engine[mode];
    if (mode === 'academic') return;
    if (e.idx < total() - 1) { e.idx++; renderItem(); } else finishModule();
  };

  // 键盘快捷键：1-9 选项，Enter 下一题
  document.addEventListener('keydown', (ev) => {
    if (!document.getElementById('screen-test').classList.contains('active')) return;
    if (ev.target.tagName === 'INPUT') return;
    if (ev.key === 'Enter') { ev.preventDefault(); goNext(); return; }
    const n = Number(ev.key);
    if (!Number.isInteger(n) || n < 1 || n > 9) return;
    const body = $('#testBody');
    if (mode === 'mbti') { const b = $$('.likert button')[n - 1]; if (b) b.click(); return; }
    if (mode === 'academic') { const b = $$('.option')[n - 1]; if (b) b.click(); return; }
    if (mode === 'plan') {
      const item = items()[engine.plan.idx];
      if (item.type === 'single') { const b = $$('.option')[n - 1]; if (b) b.click(); return; }
    }
    // 多选：按 A-K 字母也可选
    if (ev.key.length !== 1) return;
    const letter = ev.key.toUpperCase();
    const cards = $$('.tag-card');
    if (letter >= 'A' && letter <= 'K') {
      const idx = letter.charCodeAt(0) - 65;
      const item = items()[engine.plan.idx];
      if (item.type !== 'single' && cards[idx]) cards[idx].click();
    }
  });

  /* ---------------- 报告生成 ---------------- */
  function generate() {
    setScreen('generating');
    const lis = $$('.gen-steps li');
    lis.forEach(li => li.className = '');
    let i = 0;
    const tick = setInterval(() => {
      if (i < lis.length) { lis[i].className = 'ok'; }
      if (i + 1 < lis.length) lis[i + 1].className = 'on';
      i++;
      if (i > lis.length) {
        clearInterval(tick);
        try {
          S.report = window.generateReport(S);
        } catch (err) {
          console.error(err);
          clearInterval(tick);
          toast('生成报告时出现错误：' + err.message);
          setScreen('home');
          return;
        }
        renderReport();
      }
    }, 420);
  }

  function renderReport() {
    const r = S.report;
    if (!r) return;
    $('#reportRoot').innerHTML = window.renderReport(r);
    $('#reportId').textContent = r.meta.batchId;
    setScreen('report');
    window.animateReport($('#reportRoot'));
  }

  $('#pdfBtn').onclick = () => {
    toast('在打印窗口中选择「另存为 PDF」即可保存报告');
    setTimeout(() => window.print(), 350);
  };
  $('#restartBtn').onclick = () => {
    if (!confirm('确定要清空所有作答并重新开始吗？')) return;
    localStorage.removeItem(STORAGE_KEY);
    S = blank();
    setScreen('home');
    renderInfo();
    $('#resumeBtn').hidden = !hasProgress();
  };

  /* ---------------- 首页 ---------------- */
  $('#startBtn').onclick = () => {
    if (S.report) { renderReport(); return; }
    // 已有进度：回到上次中断的位置；没有进度：从填写信息开始
    const s = S.ui.screen;
    if (S.info.name && hasProgress() && (s === 'academic' || s === 'plan' || s === 'mbti')) { startTest(s); return; }
    setScreen('info');
    renderInfo();
  };
  $('#resumeBtn').onclick = () => {
    if (S.report) { renderReport(); return; }
    setScreen('info'); renderInfo();
  };
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
    const s = S.ui.screen;
    setScreen('home', true);
    renderInfo();
    $('#resumeBtn').hidden = !hasProgress();
    if (s === 'report' && S.report) renderReport();
    else if (s === 'info') { setScreen('info'); renderInfo(); }
    else if (s === 'academic' || s === 'plan' || s === 'mbti') startTest(s);
  }
  boot();

  // 暴露给调试
  window.__pathwise = { get state() { return S; }, generate, startTest, reset() { localStorage.removeItem(STORAGE_KEY); S = blank(); setScreen('home'); renderInfo(); $('#resumeBtn').hidden = true; } };
})();
