/* ============================================================
 * 专业倾向小游戏：用拖拽 / 点击代替纯选项
 *
 *   campus-match   校园匹配：把学科卡片拖进「我喜欢 / 想试试 / 不想学」
 *   planet-drag    星球排序：把专业星球拖到「心动 / 观望 / 排除」
 *   career-dart    职业飞镖：点击人生靶环，看你会命中哪些方向
 *   team-race      团队竞速：点选自己的节奏与搭档
 *
 * 所有游戏都有拖拽 + 点击两条路径：点卡片选中、再点格子放入，
 * 键盘用户可以直接 Tab 到卡片后按回车（浏览器会把 click 视作回车）。
 * 游戏结果通过 answerKey 写回 plan.answers 中对应的 key，供报告使用。
 * ============================================================ */
(function () {
  'use strict';

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  window.GAME_CONFIG = {
    campus: {
      items: [
        { id: '数学', label: '数学', icon: '📐' },
        { id: '物理', label: '物理', icon: '🌌' },
        { id: '化学', label: '化学', icon: '🧪' },
        { id: '生物', label: '生物', icon: '🌿' },
        { id: '计算机', label: '计算机', icon: '💻' },
        { id: '经济', label: '经济', icon: '💹' },
        { id: '历史', label: '历史', icon: '🏛️' },
        { id: '英语文学', label: '英语文学', icon: '📖' },
        { id: '心理学', label: '心理学', icon: '🧠' },
        { id: '设计', label: '设计', icon: '🎨' }
      ],
      lanes: [
        { id: 'like', label: '我喜欢', icon: '💚', desc: '愿意花时间钻研' },
        { id: 'try', label: '想试试', icon: '🤔', desc: '好奇，但还不确定' },
        { id: 'avoid', label: '不想学', icon: '🙅', desc: '尽量避开' }
      ],
      capacity: 4,
      poolSize: 8
    },
    planet: {
      // 与 window.MAJORS 相同（物理与化学 / 生物 / 商科一起由专业分格与兴趣素材表示），排序结果校验按这份名单。
      majors: ['cs', 'math', 'phys', 'eng', 'chem', 'med', 'bio', 'econ', 'biz', 'law', 'psych', 'design', 'media', 'intl'],
      lanes: [
        { id: 'heart', label: '心动', icon: '💖', desc: '很想深入了解' },
        { id: 'watch', label: '观望', icon: '👀', desc: '先记下来' },
        { id: 'skip', label: '排除', icon: '⏭️', desc: '暂时不考虑' }
      ],
      capacity: 3,
      poolSize: 6
    },
    dart: {
      rings: [
        { id: 'ideas', label: '创意与表达', icon: '🎨', careers: ['creative'], traits: ['create', 'empathy'], desc: '文字、视觉、故事、声音' },
        { id: 'people', label: '与人打交道', icon: '🤝', careers: ['medicine', 'law', 'entrepreneur'], traits: ['empathy', 'persuade'], desc: '帮助、沟通、影响他人' },
        { id: 'systems', label: '系统与规则', icon: '⚙️', careers: ['law'], traits: ['organize', 'rules'], desc: '流程、制度、政策' },
        { id: 'science', label: '研究与发现', icon: '🔬', careers: ['researcher'], traits: ['analyze', 'curiosity'], desc: '实验、数据、探索未知' },
        { id: 'build', label: '动手构建', icon: '🛠️', careers: ['tech'], traits: ['execute', 'numbers'], desc: '产品、工程、技术实现' },
        { id: 'market', label: '商业与增长', icon: '📈', careers: ['finance', 'entrepreneur'], traits: ['numbers', 'persuade'], desc: '数字、交易、把想法变成生意' }
      ],
      max: 2
    },
    race: {
      pace: [
        { id: 'deep', label: '长跑型', icon: '🏃', traits: ['execute', 'resilience'], desc: '慢热但持久，越跑越稳' },
        { id: 'varied', label: '接力型', icon: '🔁', traits: ['curiosity', 'create'], desc: '多线切换，灵活应战' },
        { id: 'steady', label: '匀速型', icon: '⏱️', traits: ['organize', 'rules'], desc: '节奏稳定，按计划推进' },
        { id: 'deadline', label: '冲刺型', icon: '⚡', traits: ['resilience', 'persuade'], desc: '关键时刻爆发' }
      ],
      partners: [
        { id: 'star', label: '全能学霸', icon: '🎓', traits: ['analyze'], desc: '知识储备强，能快速算出最优解' },
        { id: 'maker', label: '动手达人', icon: '🔧', traits: ['execute'], desc: '动手能力最强，任务完成度最高' },
        { id: 'artist', label: '创意之魂', icon: '✨', traits: ['create'], desc: '点子多，能让作品眼前一亮' },
        { id: 'captain', label: '带队队长', icon: '📣', traits: ['organize', 'persuade'], desc: '擅长组织协调，把大家拧成一股绳' },
        { id: 'caretaker', label: '暖心伙伴', icon: '💗', traits: ['empathy'], desc: '照顾每个人的状态，团队士气稳定' }
      ]
    }
  };

  /* ---------------- 拖拽 / 点击分格组件 ---------------- */
  /* opts: { lanes, items, initial: {laneId: [ids]}, capacity, onChange(next), label } */
  function mountSorter(root, opts) {
    const lanes = opts.lanes;
    const items = opts.items;
    const capacity = opts.capacity || Infinity;
    let currentId = null;

    function snapshot() {
      const out = {};
      lanes.forEach(l => { out[l.id] = Array.from(root.querySelectorAll(`.g-lane[data-lane="${l.id}"] .g-card`), el => el.dataset.id); });
      return out;
    }
    function emit() {
      const next = snapshot();
      const placed = Object.values(next).flat();
      root.classList.toggle('done', placed.length >= Math.min(capacity * lanes.length, items.length));
      opts.onChange(next);
    }
    function hint(text) { const el = root.querySelector('.g-hint'); if (el) el.textContent = text; }

    function card(item) {
      const pressed = currentId === item.id ? 'true' : 'false';
      return `<button type="button" class="g-card" draggable="true" data-id="${esc(item.id)}" aria-pressed="${pressed}">
        <span class="g-icon" aria-hidden="true">${esc(item.icon || '•')}</span>
        <span class="g-name">${esc(item.label)}</span>
        ${item.desc ? `<span class="g-desc">${esc(item.desc)}</span>` : ''}
      </button>`;
    }

    root.innerHTML = `
      <div class="g-sorter" data-cap="${capacity}">
        <div class="g-pool" data-lane="__pool" aria-label="待分配">
          ${items.map(item => card(item)).join('')}
        </div>
        <div class="g-lanes">
          ${lanes.map(l => `
            <div class="g-lane" data-lane="${l.id}">
              <div class="g-lane-head"><span aria-hidden="true">${l.icon}</span><b>${esc(l.label)}</b>${l.desc ? `<span class="g-desc">${esc(l.desc)}</span>` : ''}</div>
              <div class="g-lane-body"><span class="g-empty">拖到这里</span></div>
            </div>`).join('')}
        </div>
        <p class="g-hint" aria-live="polite">${esc(opts.hint || '拖动卡片，或先点卡片再点格子')}</p>
      </div>`;

    // 回填已有答案
    Object.keys(opts.initial || {}).forEach(laneId => {
      const body = root.querySelector(`.g-lane[data-lane="${CSS_ESC(laneId)}"] .g-lane-body, .g-pool[data-lane="${CSS_ESC(laneId)}"]`);
      (opts.initial[laneId] || []).forEach(id => {
        const el = root.querySelector(`.g-card[data-id="${CSS_ESC(id)}"]`);
        if (el && body) body.appendChild(el);
      });
    });
    root.querySelectorAll('.g-lane-body, .g-pool').forEach(b => { if (b.querySelector('.g-card')) b.querySelector('.g-empty')?.remove(); });
    root.classList.toggle('done', [...root.querySelectorAll('.g-card')].every(el => el.closest('.g-lane')));

    function place(id, laneId) {
      const cardEl = root.querySelector(`.g-card[data-id="${CSS_ESC(id)}"]`);
      const body = laneId === '__pool' ? root.querySelector('.g-pool') : root.querySelector(`.g-lane[data-lane="${CSS_ESC(laneId)}"] .g-lane-body`);
      if (!cardEl || !body) return;
      if (body.contains(cardEl)) return;
      if (body.closest('.g-lane') && body.querySelectorAll('.g-card').length >= capacity) {
        hint(`「${lanes.find(l => l.id === laneId).label}」最多放 ${capacity} 个，先拿一个出来`);
        return;
      }
      cardEl.classList.add('settle');
      setTimeout(() => cardEl.classList.remove('settle'), 260);
      body.appendChild(cardEl);
      // 清空格子里的占位
      root.querySelectorAll('.g-empty').forEach(empty => { if (empty.parentElement.querySelector('.g-card')) empty.remove(); });
      hint('可以继续调整，也可以换一格');
      emit();
    }

    root.addEventListener('dragstart', (e) => {
      const el = e.target.closest('.g-card'); if (!el) return;
      e.dataTransfer.setData('text/plain', el.dataset.id);
      e.dataTransfer.effectAllowed = 'move';
      el.classList.add('dragging');
    });
    root.addEventListener('dragend', (e) => {
      e.target.closest('.g-card')?.classList.remove('dragging');
      root.querySelectorAll('.over').forEach(x => x.classList.remove('over'));
    });
    root.addEventListener('dragover', (e) => {
      const zone = e.target.closest('.g-lane, .g-pool'); if (!zone) return;
      e.preventDefault();
      root.querySelectorAll('.over').forEach(x => { if (x !== zone) x.classList.remove('over'); });
      zone.classList.add('over');
    });
    root.addEventListener('drop', (e) => {
      const zone = e.target.closest('.g-lane, .g-pool'); if (!zone) return;
      e.preventDefault();
      const id = e.dataTransfer.getData('text/plain');
      root.querySelectorAll('.over').forEach(x => x.classList.remove('over'));
      if (id) place(id, zone.dataset.lane);
    });
    root.addEventListener('click', (e) => {
      const cardEl = e.target.closest('.g-card');
      if (cardEl) {
        const id = cardEl.dataset.id;
        if (cardEl.closest('.g-lane') && !currentId) {
          // 已放入的卡片：单击直接收回待选区
          place(id, '__pool');
          hint(`已把「${cardEl.querySelector('.g-name').textContent}」放回待选区`);
          return;
        }
        currentId = currentId === id ? null : id;
        root.querySelectorAll('.g-card').forEach(c => c.setAttribute('aria-pressed', c.dataset.id === id && currentId !== null ? 'true' : 'false'));
        root.querySelectorAll('.g-lane').forEach(l => l.classList.toggle('targetable', !!currentId));
        hint(currentId ? `已选中「${cardEl.querySelector('.g-name').textContent}」，再点一个格子放入` : '拖动卡片，或先点卡片再点格子');
        return;
      }
      const zone = e.target.closest('.g-lane, .g-pool');
      if (zone && currentId) { const id = currentId; currentId = null; place(id, zone.dataset.lane); }
    });
    opts.onChange(snapshot());
    return { get: snapshot, place };
  }
  const CSS_ESC = (v) => String(v).replace(/["\\]/g, '\\$&');

  /* ---------------- 具体游戏 ---------------- */
  function renderCampus(root, value, onChange) {
    const cfg = window.GAME_CONFIG.campus;
    const chosen = Object.values(value || {}).flat();
    // 固定展示 poolSize 张卡片；已放过的卡片一定包含在内，避免回填丢失
    const seed = 20261024;
    const order = cfg.items.map((_, i) => i);
    let r = seed;
    for (let i = order.length - 1; i > 0; i--) { r = (r * 9301 + 49297) % 233280; const j = r % (i + 1); [order[i], order[j]] = [order[j], order[i]]; }
    const base = order.map(i => cfg.items[i]).slice(0, cfg.poolSize);
    const items = base.concat(cfg.items.filter(item => chosen.includes(item.id) && !base.includes(item)));
    mountSorter(root, {
      lanes: cfg.lanes, items, capacity: cfg.capacity,
      initial: value && typeof value === 'object' ? value : {}, onChange,
      hint: '把你喜欢的、想试的、不想学的学科拖到对应格子（每格最多 4 个）'
    });
  }

  function renderPlanet(root, value, onChange) {
    const cfg = window.GAME_CONFIG.planet;
    const items = cfg.majors.map(id => {
      const m = window.MAJORS.find(x => x.id === id);
      return m ? { id, label: m.name, icon: '🪐', desc: m.en } : null;
    }).filter(Boolean);
    mountSorter(root, {
      lanes: cfg.lanes, items, capacity: cfg.capacity,
      initial: value && typeof value === 'object' ? value : {}, onChange,
      hint: '凭直觉把专业星球分到三边（每边最多 3 个）'
    });
  }

  function renderDart(root, value, onChange) {
    const cfg = window.GAME_CONFIG.dart;
    const picks = (Array.isArray(value) ? value : []).slice(0, cfg.max);
    function paint() {
      root.innerHTML = `
        <div class="g-dart">
          <div class="dart-board" role="group" aria-label="选择最想命中的方向，最多 ${cfg.max} 个">
            ${cfg.rings.map((r, i) => `
              <button type="button" class="dart-ring ${picks.includes(r.id) ? 'hit' : ''}" data-ring="${r.id}" aria-pressed="${picks.includes(r.id)}" style="--i:${i}">
                <span class="dart-icon" aria-hidden="true">${r.icon}</span>
                <span class="dart-label">${esc(r.label)}</span>
                <span class="dart-desc">${esc(r.desc)}</span>
              </button>`).join('')}
            <span class="dart-bull" aria-hidden="true">🎯<small>${picks.length}/${cfg.max}</small></span>
          </div>
          <div class="dart-result">${picks.length
            ? `命中：<b>${picks.map(id => esc(cfg.rings.find(r => r.id === id).label)).join(' · ')}</b>`
            : '点击最想命中的两个靶环'}</div>
        </div>`;
      root.querySelectorAll('.dart-ring').forEach(btn => {
        btn.onclick = () => {
          const id = btn.dataset.ring;
          const i = picks.indexOf(id);
          if (i >= 0) picks.splice(i, 1);
          else { if (picks.length >= cfg.max) picks.shift(); picks.push(id); }
          onChange(picks.slice());
          paint();
        };
      });
    }
    paint();
  }

  function renderRace(root, value, onChange) {
    const cfg = window.GAME_CONFIG.race;
    const v = value && typeof value === 'object' ? value : {};
    let pace = cfg.pace.some(p => p.id === v.pace) ? v.pace : null;
    let partner = cfg.partners.some(p => p.id === v.partner) ? v.partner : null;
    function paint() {
      const paceItem = cfg.pace.find(p => p.id === pace);
      const partnerItem = cfg.partners.find(p => p.id === partner);
      root.innerHTML = `
        <div class="g-race">
          <div class="race-track" aria-hidden="true">
            <span class="race-runner" style="--p:${pace ? 100 : 0}%">🏃</span><span class="race-flag">🏁</span>
          </div>
          <div class="race-block">
            <div class="race-block-head"><b>我的节奏</b><span>${paceItem ? esc(paceItem.label) + ' · ' + esc(paceItem.desc) : '选择最像你的跑法'}</span></div>
            <div class="race-items">${cfg.pace.map(p => `
              <button type="button" class="race-item" data-id="${p.id}" aria-pressed="${p.id === pace}">
                <span aria-hidden="true">${p.icon}</span><b>${esc(p.label)}</b><small>${esc(p.desc)}</small>
              </button>`).join('')}</div>
          </div>
          <div class="race-block">
            <div class="race-block-head"><b>我的搭档</b><span>${partnerItem ? esc(partnerItem.label) + ' · ' + esc(partnerItem.desc) : '选一个最想组队的伙伴'}</span></div>
            <div class="race-items">${cfg.partners.map(p => `
              <button type="button" class="race-item" data-id="${p.id}" aria-pressed="${p.id === partner}">
                <span aria-hidden="true">${p.icon}</span><b>${esc(p.label)}</b><small>${esc(p.desc)}</small>
              </button>`).join('')}</div>
          </div>
          ${pace && partner ? `<div class="race-result">你的团队：${esc(paceItem.icon)} ${esc(paceItem.label)} + ${esc(partnerItem.icon)} ${esc(partnerItem.label)}</div>` : ''}
        </div>`;
      root.querySelectorAll('.race-item').forEach(btn => {
        btn.onclick = () => {
          if (cfg.pace.some(p => p.id === btn.dataset.id)) pace = btn.dataset.id;
          else partner = btn.dataset.id;
          onChange({ pace, partner });
          paint();
        };
      });
    }
    paint();
  }

  /* 把游戏结果换算成特质信号 */
  function traitsOf(kind, id) {
    const cfg = window.GAME_CONFIG;
    const list = kind === 'dart' ? cfg.dart.rings : kind === 'race' ? [...cfg.race.pace, ...cfg.race.partners] : [];
    return list.find(x => x.id === id)?.traits || [];
  }

  window.Games = { campus: renderCampus, planet: renderPlanet, dart: renderDart, race: renderRace, traitsOf, config: window.GAME_CONFIG };
})();
