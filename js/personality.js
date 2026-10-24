/* ============================================================
 * 性格特质测评 + 专业倾向小游戏
 *
 * 1. 性格特质：10 个与职业发展相关的特质（分析 / 创造 / 助人 / 沟通 /
 *    统筹 / 执行 / 探索 / 坚韧 / 数字意识 / 规则意识），每个特质 4 道情境题，
 *    题干自动取自 TRAIT_SCENARIOS 的「情境 × 表达方式」组合。
 *    输出是特质画像（高 / 中 / 待观察），可翻译成 MBTI 四维倾向作参考，
 *    但报告不再把 MBTI 四个字母当作结论。
 * 2. 小游戏：campus-match（校园匹配）、team-race（团队竞速）、
 *    career-dart（职业飞镖），每一局的成绩都换算为特质信号。
 * ============================================================ */

/* ---------------- 特质定义 ---------------- */
window.TRAITS = [
  { id: 'analyze', label: '分析思考', icon: '🔍', clusters: ['math', 'physics', 'social'],
    desc: '喜欢拆解问题、找规律、用证据说话',
    careers: ['科研 / 数据 / 工程 / 金融分析'], strengths: '遇到复杂问题时你倾向于先理清结构再下结论',
    watch: '避免陷入“想清楚再说”，先做一个最小版本往往更有帮助' },
  { id: 'create', label: '创造想象', icon: '🎨', clusters: ['creative', 'humanities', 'math'],
    desc: '点子多、喜欢做新的东西、对审美敏感',
    careers: ['设计 / 传媒 / 产品 / 建筑'], strengths: '你能把看似无关的想法连接起来，提出新方案',
    watch: '给创意加上交付节点，避免“开很多坑、很少收尾”' },
  { id: 'empathy', label: '共情助人', icon: '🤝', clusters: ['biology', 'social', 'humanities'],
    desc: '关心他人的感受，愿意帮助身边人',
    careers: ['医学 / 心理咨询 / 教育 / 公益'], strengths: '你对他人的情绪和需求比较敏感，容易获得信任',
    watch: '帮助别人之前先照顾好自己，学会说不' },
  { id: 'persuade', label: '表达沟通', icon: '💬', clusters: ['humanities', 'social', 'creative'],
    desc: '擅长把想法讲清楚，能带动别人',
    careers: ['法律 / 传媒 / 咨询 / 管理'], strengths: '你能让听众理解并认同你的观点',
    watch: '表达之外也要留出倾听的时间' },
  { id: 'organize', label: '统筹组织', icon: '🧭', clusters: ['social', 'math'],
    desc: '擅长把事情排好顺序、协调资源与人',
    careers: ['管理 / 项目管理 / 咨询 / 运营'], strengths: '你能快速把一个目标拆成谁在什么时候做什么',
    watch: '不必事事亲力亲为，学会把任务分出去' },
  { id: 'execute', label: '专注执行', icon: '🎯', clusters: ['physics', 'math', 'biology', 'chemistry'],
    desc: '说到做到，能长时间沉下心完成一件事',
    careers: ['工程 / 科研 / 医学 / 会计'], strengths: '你的持续性让你在长期任务中积累出明显优势',
    watch: '定期抬头看看方向是否正确，再继续加速' },
  { id: 'curiosity', label: '好奇探索', icon: '🧭', clusters: ['physics', 'chemistry', 'biology', 'humanities', 'social'],
    desc: '对新知识、新领域有持续兴趣',
    careers: ['科研 / 数据 / 新闻 / 咨询'], strengths: '你愿意跳出舒适区，往往能发现别人忽略的机会',
    watch: '给探索设一个当前主线，避免兴趣太分散' },
  { id: 'resilience', label: '抗压坚韧', icon: '💪', clusters: ['physics', 'biology', 'math'],
    desc: '遇到挫折不轻易放弃，能在压力下继续推进',
    careers: ['医学 / 科研 / 体育 / 创业'], strengths: '面对挑战时你能保持节奏，这在高强度学业里很关键',
    watch: '坚韧不等于硬扛，学会求助和休息同样是能力' },
  { id: 'numbers', label: '数字论证', icon: '📊', clusters: ['math', 'social'],
    desc: '喜欢用数字、模型和数据来判断事情',
    careers: ['金融 / 精算 / 数据 / 经济'], strengths: '你能从数据中读出趋势，做出有依据的判断',
    watch: '数字之外也要关注人的因素和情境' },
  { id: 'rules', label: '严谨规则', icon: '⚖️', clusters: ['humanities', 'chemistry', 'biology'],
    desc: '重视准确、规则和细节，追求把事情做对',
    careers: ['法律 / 会计 / 医学 / 审计'], strengths: '你的严谨能减少错误，在需要精确的领域是高价值特质',
    watch: '面对模糊的新情况时，允许自己先试错再规范' }
];

/* 每个特质 4 个情境，每个情境两种表达方式（正反交替出现，降低作答惯性） */
window.TRAIT_SCENARIOS = [
  { trait: 'analyze', variants: [
    { s: '小组作业给了一堆杂乱的数据', pos: '我会先想办法找出其中的规律', neg: '我直接照着感觉写结论' },
    { s: '遇到一个完全看不懂的物理题', pos: '我会把题目拆成几个小步骤逐一分析', neg: '我会等着看老师的讲解' },
    { s: '朋友问我一个复杂的问题', pos: '我更想听他讲清来龙去脉再做判断', neg: '我更想马上给一个答案' }
  ] },
  { trait: 'create', variants: [
    { s: '社团的海报没人设计', pos: '我会冒出一个新点子并试着做出来', neg: '我会等别人先给出模板' },
    { s: '写一篇自由题目的作文', pos: '我会想用不一样的视角来写', neg: '我会参考范文的写法更稳妥' },
    { s: '看到普通的教室', pos: '我脑子里会浮现“如果改成这样会更好”', neg: '我觉得现在这样就挺好' }
  ] },
  { trait: 'empathy', variants: [
    { s: '同学在课上被老师批评后很沮丧', pos: '课后我想去问问他的感受', neg: '我觉得这不关我的事' },
    { s: '小组里有同学一直不说话', pos: '我会主动问他的想法', neg: '我专注于把任务做完就好' },
    { s: '自己有两小时空余时间', pos: '帮低年级同学讲题会让我有成就感', neg: '我更想自己安安静静地刷题' }
  ] },
  { trait: 'persuade', variants: [
    { s: '我的想法和别人不一样', pos: '我会试着有条理地说服大家', neg: '我通常就默默保留意见' },
    { s: '需要在全班面前汇报', pos: '我会觉得这是一个展示想法的好机会', neg: '我只希望快点讲完' },
    { s: '小组对方案有分歧', pos: '我愿意站出来引导讨论', neg: '我更希望别人来定' }
  ] },
  { trait: 'organize', variants: [
    { s: '要组织一次班级活动', pos: '我会主动排时间表和分工', neg: '我更愿意负责其中一项具体的事' },
    { s: '小组项目刚开始', pos: '我会先把任务拆开、确定分工', neg: '我觉得边做边看更自然' },
    { s: '一个重要的汇报截止日临近', pos: '我能同时盯住几件关键的事', neg: '事情一多我就容易乱' }
  ] },
  { trait: 'execute', variants: [
    { s: '给自己定好每天练题的计划', pos: '我基本能坚持执行下去', neg: '我常常坚持两三天就放弃' },
    { s: '需要长时间专注做一件事', pos: '我能沉下心来一直做', neg: '我很难安静超过半小时' },
    { s: '老师布置了一项几周后才交的任务', pos: '我会稳步推进', neg: '我一般会拖到最后才开始' }
  ] },
  { trait: 'curiosity', variants: [
    { s: '课上听到一个没讲透的概念', pos: '我会下课后自己查资料弄清它', neg: '我觉得等考试用到再说' },
    { s: '看到一篇关于外星海洋的文章', pos: '我会想继续读更多相关内容', neg: '看完标题就够了' },
    { s: '有我从未参加过的讲座', pos: '即使和课程无关我也想去听', neg: '我更愿意用这段时间复习' }
  ] },
  { trait: 'resilience', variants: [
    { s: '一次重要考试没考好', pos: '我会复盘原因并继续推进', neg: '我会消沉很久' },
    { s: '练习了很久还是学不会', pos: '我会换个方法再试几次', neg: '我会先放一段时间' },
    { s: '离截止日期只剩一天', pos: '我还能保持节奏完成任务', neg: '我基本就会乱掉' }
  ] },
  { trait: 'numbers', variants: [
    { s: '面对一串数字表格', pos: '我会想算一算或画个图看看', neg: '我会尽量避开数字' },
    { s: '看到新闻里的统计数据', pos: '我会怀疑样本和方法是否靠得住', neg: '我直接接受结论' },
    { s: '需要用 Excel / 表格做统计', pos: '我觉得挺有意思', neg: '我觉得很麻烦' }
  ] },
  { trait: 'rules', variants: [
    { s: '交作业之前', pos: '我习惯逐项检查有没有遗漏', neg: '交上去就算了' },
    { s: '老师讲解了一个标准步骤', pos: '我会尽量严格照做', neg: '我更喜欢自己摸索' },
    { s: '学习资料整理', pos: '我会把页面整理得整洁有序', neg: '能找到东西就行' }
  ] }
];

window.PERSONALITY_SCALE = [
  { value: 0, label: '完全不像我' },
  { value: 1, label: '不太像' },
  { value: 2, label: '不确定' },
  { value: 3, label: '比较像' },
  { value: 4, label: '非常像我' }
];

/* 自动生成 30 道小程序题：每个特质 3 道，正反表达轮换并按固定种子打散顺序 */
(function buildTraitQuestions() {
  const pool = [];
  window.TRAIT_SCENARIOS.forEach(def => def.variants.forEach((v, i) => {
    const reversed = i % 2 === 1;
    pool.push({ trait: def.trait, text: v.s, statement: reversed ? v.neg : v.pos, reversed });
  }));
  // 确定性打散（固定种子），保证题库顺序在版本间稳定、便于回归测试
  let seed = 20261024;
  const order = pool.map((_, i) => i).sort(() => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % 5 - 2; });
  window.TRAIT_QUESTIONS = order.map(i => pool[i]);
  window.PERSONALITY_META = { version: '2026.11-trait', total: window.TRAIT_QUESTIONS.length };
})();

/* ---------------- MBTI 对照倾向（只作参考，不作结论） ---------------- */
window.TRAIT_TO_MBTI = {
  EI: { E: ['persuade', 'organize'], I: ['analyze', 'execute'] },
  SN: { N: ['create', 'curiosity'], S: ['execute', 'rules'] },
  TF: { T: ['analyze', 'numbers'], F: ['empathy', 'rules'] },
  JP: { J: ['rules', 'organize'], P: ['curiosity', 'create'] }
};

window.MBTI_HINT_LABEL = {
  EI: '社交能量', SN: '信息偏好', TF: '决策依据', JP: '做事节奏'
};

/* 计算特质画像。
 * answers: [{ value: 0..4, ms: 毫秒数 }]，与 TRAIT_QUESTIONS 顺序对应，null 表示未作答
 * games: { campusMatch: {answers:[majorId...]}, teamRace: {traits:{..}}, careerDart: {traits:{..}} }
 */
window.computePersonality = function (answers, games) {
  answers = Array.isArray(answers) ? answers : [];
  games = games && typeof games === 'object' ? games : {};
  const traitAnswers = {};
  window.TRAITS.forEach(t => { traitAnswers[t.id] = []; });
  window.TRAIT_QUESTIONS.forEach((q, i) => {
    const a = answers[i];
    if (!a || !Number.isInteger(a.value) || a.value < 0 || a.value > 4) return;
    const score = q.reversed ? 4 - a.value : a.value;
    traitAnswers[q.trait].push({ score, ms: Number.isFinite(a.ms) ? a.ms : null });
  });
  const byId = {};
  const list = window.TRAITS.map(t => {
    const values = traitAnswers[t.id];
    const answered = values.length;
    let raw = null;
    if (answered) {
      // 去掉最高、最低各一个（至少 3 题时），减少极端作答的影响
      let usable = values.map(v => v.score);
      if (usable.length >= 3) { const sorted = [...usable].sort((a, b) => a - b); sorted.shift(); sorted.pop(); usable = sorted; }
      raw = usable.reduce((sum, v) => sum + v, 0) / usable.length; // 0..4
    }
    const level = raw == null ? 'pending' : raw >= 2.6 ? 'high' : raw >= 1.6 ? 'mid' : 'low';
    const result = {
      id: t.id, label: t.label, icon: t.icon, desc: t.desc, careers: t.careers,
      strengths: t.strengths, watch: t.watch, clusters: t.clusters,
      answered, pct: raw == null ? null : Math.round(raw / 4 * 100), level
    };
    byId[t.id] = result;
    return result;
  });
  // 游戏中每题给出的特质偏好直接计入（每题 1 分）
  const gameBonus = {};
  const addBonus = (traits) => {
    if (!Array.isArray(traits)) return;
    traits.forEach(id => { if (byId[id]) gameBonus[id] = (gameBonus[id] || 0) + 1; });
  };
  addBonus(games.careerDart?.traits);
  addBonus(games.teamRace?.traits);
  list.forEach(t => {
    t.gameScore = gameBonus[t.id] || 0;
    if (t.pct != null) t.pct = Math.max(0, Math.min(100, t.pct + t.gameScore * 2));
  });
  const ranked = [...list].filter(t => t.pct != null).sort((a, b) => b.pct - a.pct);

  // 由兴趣游戏得到的方向倾向：每选一个专业方向，给其关联集群加 1 分
  const campus = [];
  (games.campusMatch?.answers || []).forEach(id => {
    const major = window.MAJORS.find(m => m.id === id);
    if (major && !campus.includes(major.id)) campus.push(major.id);
  });

  // MBTI 对照倾向
  const hint = {};
  Object.entries(window.TRAIT_TO_MBTI).forEach(([dim, poles]) => {
    const scoreOf = ids => ids.reduce((sum, id) => sum + (byId[id]?.pct == null ? 50 : byId[id].pct), 0) / ids.length;
    const [a, b] = Object.keys(poles);
    const pa = scoreOf(poles[a]), pb = scoreOf(poles[b]);
    const settled = list.every(t => t.pct != null);
    const gap = Math.abs(pa - pb);
    hint[dim] = {
      a, b, pa: Math.round(pa), pb: Math.round(pb),
      pole: settled && gap >= 6 ? (pa > pb ? a : b) : null,
      label: window.MBTI_HINT_LABEL[dim], evidence: settled
    };
  });
  hint.code = Object.values(hint).every(h => h.pole) ? Object.values(hint).map(h => h.pole).join('') : null;

  const answeredTotal = list.reduce((n, t) => n + t.answered, 0);
  return {
    traits: list,
    byId,
    top: ranked.slice(0, 3),
    growth: [...ranked].reverse().slice(0, 2),
    answered: answeredTotal,
    total: window.TRAIT_QUESTIONS.length,
    complete: list.every(t => t.answered >= 3) && answeredTotal === window.TRAIT_QUESTIONS.length,
    hint,
    campus,
    games: {
      campusMatch: !!games.campusMatch?.answers?.length,
      teamRace: Array.isArray(games.teamRace?.traits) ? games.teamRace.traits : [],
      careerDart: Array.isArray(games.careerDart?.traits) ? games.careerDart.traits : []
    }
  };
};
