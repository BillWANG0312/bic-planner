/* Generated frozen legacy runtime. Shared academic bank/catalog are current, not certified historical rules. */
(function (host) {
  'use strict';
  const window = Object.create(null);
  for (const key of ["QUESTION_BANK","QUESTION_BANK_META","QUESTION_BANK_VERSION","ALEVEL_BANDS","ALEVEL_SUBJECTS","CAREER_PATHS","COUNTRY_OPTIONS","INTEREST_OPTIONS","INTEREST_POOL","MAJORS","REFERENCE_YEAR","SUBJECT_META","UNIVERSITY_CATALOG"]) Object.defineProperty(window, key, { enumerable: true, get: () => host[key] });

/* Frozen js/mbti.js */
/* ============================================================
 * 简版 MBTI 性格测试（24 题，每维度 6 题）
 * 倾向度 = 某侧得分 / 6，用于报告中的强度描述
 * ============================================================ */
window.MBTI_QUESTIONS = [
  // ---- E / I 能量来源 ----
  { dim: 'EI', pole: 'E', text: '在新环境中，我能很快和陌生人聊起来。' },
  { dim: 'EI', pole: 'I', text: '经过一整天与人相处后，我需要独处来恢复精力。' },
  { dim: 'EI', pole: 'E', text: '我更喜欢通过讨论和发言来理清自己的思路。' },
  { dim: 'EI', pole: 'I', text: '我倾向于先想清楚，再开口表达观点。' },
  { dim: 'EI', pole: 'E', text: '周末我更愿意参加聚会或集体活动。' },
  { dim: 'EI', pole: 'I', text: '小组合作时，我常常希望有自己安静完成的空间。' },

  // ---- S / N 信息获取 ----
  { dim: 'SN', pole: 'S', text: '描述一件事时，我更关注具体的事实和细节。' },
  { dim: 'SN', pole: 'N', text: '我经常思考事物背后的规律和未来可能的发展。' },
  { dim: 'SN', pole: 'S', text: '比起抽象的想象，我更喜欢能亲手动手实践的学习方式。' },
  { dim: 'SN', pole: 'N', text: '阅读时，我常会被一个想法引出更多联想。' },
  { dim: 'SN', pole: 'S', text: '我做事偏好按既定步骤、按照经验来做。' },
  { dim: 'SN', pole: 'N', text: '我对"换个角度看问题"的新颖说法很有兴趣。' },

  // ---- T / F 决策方式 ----
  { dim: 'TF', pole: 'T', text: '做决定时，我更看重逻辑分析和客观证据。' },
  { dim: 'TF', pole: 'F', text: '与朋友有分歧时，我更在意对方的感受。' },
  { dim: 'TF', pole: 'T', text: '别人指出我的错误时，我倾向于关注内容是否合理，而不是语气。' },
  { dim: 'TF', pole: 'F', text: '我会因为帮助别人解决问题而感到特别满足。' },
  { dim: 'TF', pole: 'T', text: '评价一个方案时，我能相对冷静地指出它的不足。' },
  { dim: 'TF', pole: 'F', text: '我更容易被鼓舞人心、有人情味的故事打动。' },

  // ---- J / P 生活方式 ----
  { dim: 'JP', pole: 'J', text: '我习惯提前制定计划，并按计划执行。' },
  { dim: 'JP', pole: 'P', text: '我喜欢保持弹性，临时改变安排也没关系。' },
  { dim: 'JP', pole: 'J', text: '作业和复习，我会提前完成而不喜欢拖到最后。' },
  { dim: 'JP', pole: 'P', text: '比起严格的时间表，我更喜欢随性自由的学习节奏。' },
  { dim: 'JP', pole: 'J', text: '桌面上物品摆放整齐会让我感觉安心。' },
  { dim: 'JP', pole: 'P', text: '面对多条待办时，我常常同时推进好几项。' }
];

window.MBTI_SCALE = [
  { value: 0, label: '完全不同意' },
  { value: 1, label: '不太同意' },
  { value: 2, label: '有点同意' },
  { value: 3, label: '比较同意' },
  { value: 4, label: '完全同意' }
];

/* 16 型性格解析 */
window.MBTI_TYPES = {
  INTJ: { title: '建筑师', tag: '战略家 · 独立 · 长期主义',
    desc: '你习惯用系统化的思维分析世界，善于制定长期目标并拆解为可执行的路径。独处时思考效率最高，对"为什么"比对"怎么做"更感兴趣。',
    strengths: ['逻辑严密，擅长规划和目标拆解', '独立思考，不易随波逐流', '对复杂问题有强烈的好奇心'],
    watch: ['容易忽视他人感受，团队沟通时需多表达', '完美主义倾向，可能因追求最优而拖延', '需刻意练习"小而快"的试错方式'],
    study: '适合采用"目标—里程碑—复盘"的学习法；避免单打独斗，多参与小组讨论来补足表达与协作。' },
  INTP: { title: '逻辑学家', tag: '好奇 · 分析 · 理论探索',
    desc: '你天生对原理和规律感兴趣，喜欢刨根问底、搭建概念框架。学东西很快，但有时会沉浸在思考中而忽视执行。',
    strengths: ['抽象思维和推理能力强', '对新知识吸收快，乐于质疑', '擅长发现逻辑漏洞'],
    watch: ['计划性较弱，容易"想得多做得少"', '对重复性任务缺乏耐心', '需要外界节奏来督促完成度'],
    study: '用"理解优先、练习补位"的策略：先把原理吃透，再固定每天一节刷题时间，把想法落地为熟练度。' },
  ENTJ: { title: '指挥官', tag: '果断 · 领导 · 目标驱动',
    desc: '你目标感强、行动果断，擅长组织资源、带领团队达成结果。在竞争激烈的学术环境中往往能脱颖而出。',
    strengths: ['决策迅速，善于统筹', '面对压力仍能推进进度', '有强烈的成就动机'],
    watch: ['可能显得强硬，需注意沟通方式', '过于关注结果，忽略过程体验', '要学会在失利后及时复盘而非一味加码'],
    study: '给自己设置明确的、可量化的目标（如每周 3 套真题）并复盘；同时预留放松时间，避免长期高压。' },
  ENTP: { title: '辩论家', tag: '创新 · 灵活 · 挑战常规',
    desc: '你思维活跃、点子多，喜欢辩论和挑战既有观点。适合需要创意和头脑风暴的环境，但兴趣转移较快。',
    strengths: ['创意丰富，善于举一反三', '口头表达和临场应变强', '乐于接受新方法和新挑战'],
    watch: ['容易"三分钟热度"，需要机制保证持续投入', '可能忽视细节和流程', '对固定计划感到束缚'],
    study: '将长期目标拆为两周一个的"冲刺小项目"，用新挑战维持兴趣；用错题本锁定短板，防止换题就忘。' },
  INFJ: { title: '提倡者', tag: '洞察 · 理想 · 有意义感',
    desc: '你敏感而有洞察力，关心事物的意义和价值。一旦认同目标，会展现出惊人的自驱力和专注度。',
    strengths: ['洞察力强，能理解他人深层动机', '目标感明确，自我要求高', '有持久的专注与责任感'],
    watch: ['对失败比较敏感，需建立情绪调节方式', '容易过度自我审视', '需保护自己的精力和休息时间'],
    study: '把学习目标与你真正在乎的"意义"连接（如"想用生物研究解决什么"），学习动机会显著增强。' },
  INFP: { title: '调停者', tag: '真诚 · 想象 · 价值驱动',
    desc: '你内心世界丰富，重视个人价值和真诚表达。对与自己相关的事物有极强的情感投入，喜欢自由探索。',
    strengths: ['想象力丰富，写作与表达有感染力', '高度道德感与同理心', '对感兴趣的话题能深度钻研'],
    watch: ['对枯燥的执行阶段抵抗较强', '容易拖延、回避压力情境', '需要更清晰的短期目标'],
    study: '用"故事化笔记"把知识点与个人兴趣结合；采用番茄钟等小额启动法降低起步阻力。' },
  ENFJ: { title: '主人公', tag: '共情 · 鼓舞 · 团队协作',
    desc: '你善于察觉他人情绪并激励他人，在团队里往往扮演凝聚者。学习上需要良好的同伴氛围。',
    strengths: ['沟通和协作能力突出', '对他人期望敏感，能保持自律', '感染力强，善于带动团队'],
    watch: ['可能过度在意别人评价', '容易答应太多而透支精力', '需要学会拒绝与优先排序'],
    study: '组建固定学习小组能显著提升你的效率；但需给自己设定"不参加"的边界，保证独立学习时间。' },
  ENFP: { title: '竞选者', tag: '热情 · 好奇 · 探索者',
    desc: '你热情、好奇、充满活力，能在多领域中找到兴奋点。适应力强，但在单一任务上容易分心。',
    strengths: ['学习热情高，接受新事物快', '社交与表达自然', '富有灵感，善于连接不同领域'],
    watch: ['注意力容易分散', '不喜欢重复性练习', '需要外部结构来约束进度'],
    study: '用多样化的学习方式（视频、讨论、教别人）维持兴趣；把"A-Level 三科"设为固定主线，避免杂学分散。' },
  ISTJ: { title: '物流师', tag: '踏实 · 严谨 · 可靠',
    desc: '你做事严谨、脚踏实地，重视责任与承诺。擅长按规则和流程把事情做对，学习稳定性极高。',
    strengths: ['执行力极强，计划一旦定下就能完成', '细致严谨，少犯错', '对知识掌握扎实'],
    watch: ['对开放性问题和新方法适应较慢', '可能过于保守，不敢冒险', '需要主动拓展知识面'],
    study: '你是"稳定型选手"，坚持复习与刷题会带来长期复利；可有意识地增加一科挑战性课程来拓展视野。' },
  ISFJ: { title: '守卫者', tag: '细致 · 奉献 · 值得信赖',
    desc: '你细心、体贴，愿意为身边的人付出。学习认真、记忆扎实，对环境变化比较敏感。',
    strengths: ['耐心细致，擅长知识整理', '责任感强，能长期坚持', '对他人需求敏感，协作融洽'],
    watch: ['面对批评容易影响情绪', '决策时可能过于谨慎、犹豫', '需要多尝试主动表达自己的观点'],
    study: '适合"整理 + 复习"型学习法（思维导图、错题本）；可在课堂上主动提问，训练独立思考。' },
  ESTJ: { title: '总经理', tag: '高效 · 组织 · 结果导向',
    desc: '你务实、有条理，善于组织和推动事情落地。在需要规则和执行力的学术任务中表现优异。',
    strengths: ['组织与执行能力强', '目标清晰，效率高', '善于承担领导责任'],
    watch: ['可能过于注重结果而轻视过程', '对不合常规的想法接受度低', '需要练习倾听与灵活调整'],
    study: '制定时间表并严格执行是你的强项；额外加入一个需要探索与试错的科研/论文项目，有助于提升灵活度。' },
  ESFJ: { title: '执政官', tag: '热心 · 合作 · 关注他人',
    desc: '你热心、认真，重视和谐的人际关系和集体认同。在积极的学习氛围中，你的状态最好。',
    strengths: ['责任心强，认真对待他人期望', '人际能力好，善于协调', '对团队忠诚，乐于付出'],
    watch: ['可能为了迎合他人而忽视自己的需求', '对冲突比较敏感', '独立性方面需要加强'],
    study: '学习伙伴与家长的支持是你的动力来源；但需制定你自己的目标任务，减少对外部督促的依赖。' },
  ISTP: { title: '鉴赏家', tag: '冷静 · 动手 · 解决实际问题',
    desc: '你冷静理性，喜欢动手操作和解决实际问题。对理论公式的兴趣不如对"它有什么用"的兴趣大。',
    strengths: ['逻辑清楚，动手与实验能力强', '临场解决问题冷静', '对技术类事物上手快'],
    watch: ['长期规划意识较弱', '不喜欢被计划束缚', '需要给学习注入"实用性"'],
    study: '把知识点与实验、工程项目结合，理解会显著加深；同时固定每周复盘，避免只在考前突击。' },
  ISFP: { title: '探险家', tag: '敏感 · 审美 · 自由',
    desc: '你温和、敏感，对美和实验性体验有独特的感知。讨厌被束缚，但在自己真正热爱的事物上极其专注。',
    strengths: ['观察细致，感知力强', '对感兴趣的领域能沉浸投入', '温和友善，易与人相处'],
    watch: ['压力下容易回避', '不喜欢按部就班的计划', '需要找到内在动机才能坚持'],
    study: '寻找学习内容中与你兴趣相关的切入点；使用短周期、可自由安排的任务结构，降低对固定计划的抵触。' },
  ESTP: { title: '企业家', tag: '行动 · 灵活 · 冒险',
    desc: '你精力充沛，喜欢即时行动和真实体验。反应快、适应力强，在竞争和挑战中发挥最佳。',
    strengths: ['行动力强，能快速进入状态', '应变快，不被困难吓倒', '善于在实践中学习'],
    watch: ['缺乏长期规划', '容易冲动、忽略细节', '对理论学习专注度不足'],
    study: '用竞赛、项目等"有反馈感"的挑战维持动力；建立简单可靠的复习节奏，平衡"行动多、复盘少"的习惯。' },
  ESFP: { title: '表演者', tag: '活力 · 共情 · 活在当下',
    desc: '你热情开朗，善于调动气氛，对人和生活充满感受力。在活跃、有互动的环境中学习效果最好。',
    strengths: ['沟通表达与感染力强', '乐观积极，抗压性好', '善于在团队中获得能量'],
    watch: ['计划性与自控需要外部支持', '容易受社交因素分心', '需要配合明确的时间和任务结构'],
    study: '将学习安排进固定的"社交—学习"组合（如和朋友一起自习）；用可视化的进度条激励自己。' }
};

/* 根据答案计算 MBTI 结果 */
window.computeMBTI = function (answers /* [0..4] 与题目顺序对应，null 表示未答 */) {
  answers = Array.isArray(answers) ? answers : [];
  const score = { E: 0, I: 0, S: 0, N: 0, T: 0, F: 0, J: 0, P: 0 };
  const dimensions = {};
  window.MBTI_QUESTIONS.forEach((q, i) => {
    const dim = dimensions[q.dim] || (dimensions[q.dim] = { answered: 0, total: 0, hasSignal: false });
    dim.total += 1;
    const answer = answers[i];
    if (!Number.isInteger(answer) || answer < 0 || answer > 4) return;
    score[q.pole] += answer;
    dim.answered += 1;
  });
  const get = (a, b) => {
    const coverage = dimensions[a + b];
    const total = score[a] + score[b];
    const pctA = total ? Math.round(score[a] / total * 100) : 50;
    return { ...coverage, hasSignal: score[a] !== score[b], complete: coverage.answered === coverage.total,
      pole: pctA >= 50 ? a : b, a, b, pctA, pctB: 100 - pctA,
      other: pctA >= 50 ? b : a, otherPct: pctA >= 50 ? 100 - pctA : pctA };
  };
  const EI = get('E', 'I'), SN = get('S', 'N'), TF = get('T', 'F'), JP = get('J', 'P');
  const dims = [EI, SN, TF, JP];
  const answered = dims.reduce((count, dim) => count + dim.answered, 0);
  const total = window.MBTI_QUESTIONS.length;
  const hasSignal = dims.some(dim => dim.hasSignal);
  const code = answered && dims.every(dim => dim.hasSignal) ? EI.pole + SN.pole + TF.pole + JP.pole : null;
  return { code, EI, SN, TF, JP, answered, total, complete: answered === total,
    hasSignal, type: code ? window.MBTI_TYPES[code] : null };
};

/* Frozen js/plan.js */
/* ============================================================
 * 专业规划测试配置：兴趣、优势、专业意向
 * ============================================================ */
window.PLAN_CONFIG = {
  grade: [
    { id: '8',  label: '8 年级', desc: '还有充足时间探索' },
    { id: '9',  label: '9 年级', desc: '开始形成方向感' },
    { id: '10', label: '10 年级', desc: '面临 A-Level 正式选科' },
    { id: '11', label: '11 年级 / 预科', desc: '已选科，需确认方向' }
  ],
  groupSize: [
    { id: 'small', label: '我喜欢小团队 / 独立完成', desc: '3 人以下' },
    { id: 'medium', label: '我喜欢 4–10 人的小组', desc: '如社团、项目组' },
    { id: 'large', label: '我喜欢大集体 / 公开场合', desc: '如年级活动、演讲、比赛' }
  ],
  timeStyle: [
    { id: 'deep', label: '长时间深度沉浸', desc: '可以连续数小时投入一件事' },
    { id: 'varied', label: '短时间内切换多样任务', desc: '不断有新内容刺激' },
    { id: 'steady', label: '规律、稳定的日常节奏', desc: '固定计划，稳步推进' },
    { id: 'deadline', label: '截止日期前的集中冲刺', desc: '在压力下爆发效率最高' }
  ],
  mood: [
    { id: 'rational', label: '理性的科学家', desc: '用逻辑和证据看世界' },
    { id: 'empathic', label: '温暖的倾听者', desc: '关心人的感受和关系' },
    { id: 'creative',  label: '天马行空的创作者', desc: '用想象力打破常规' },
    { id: 'practical', label: '务实的建设者', desc: '把事情真正做出来' },
    { id: 'leader',    label: '目标的领导者', desc: '组织资源、带着团队达成目标' },
    { id: 'explorer',  label: '好奇的探索者', desc: '不断发现新的领域和可能' }
  ],
  freeTime: [
    { id: 'internet', label: '刷视频 / 上网探索', clusters: ['creative', 'math', 'social'] },
    { id: 'books',    label: '阅读书籍',          clusters: ['humanities', 'creative'] },
    { id: 'games',    label: '打游戏 / 桌游',      clusters: ['math', 'creative'] },
    { id: 'sports',   label: '运动与户外',        clusters: ['biology', 'social'] },
    { id: 'volunteer2', label: '社团 / 志愿服务',  clusters: ['social', 'humanities'] },
    { id: 'music',    label: '音乐 / 艺术创作',    clusters: ['creative'] },
    { id: 'make',     label: '手工 / 编程小项目',  clusters: ['math', 'physics'] },
    { id: 'hangout',  label: '和朋友聚会聊天',     clusters: ['social'] }
  ],
  travel: [
    { id: 'uk',     label: '英国' },
    { id: 'us',     label: '美国' },
    { id: 'ca',     label: '加拿大' },
    { id: 'au',     label: '澳大利亚' },
    { id: 'hk',     label: '中国香港' },
    { id: 'sg',     label: '新加坡' },
    { id: 'eu',     label: '欧洲大陆' },
    { id: 'unsure', label: '还没想好' }
  ],
  subjectPerf: ['很轻松 / 擅长', '还不错', '一般', '比较吃力'],
  preferredLength: [
    { id: 'short', label: '短学制，快速就业', desc: '如英国三年制本科' },
    { id: 'long',  label: '愿意为长期专业投入', desc: '如医学、建筑、读博' },
    { id: 'flex',  label: '希望路径灵活可调整', desc: '如美国四年制、可转专业' }
  ]
};

window.PLAN_QUESTIONS = [
  {
    id: 'grade', title: '你目前所在的年级是？', sub: '用于确定规划的时间窗口',
    type: 'single', key: 'grade', options: () => window.PLAN_CONFIG.grade
  },
  {
    id: 'interests', title: '用一句话描述：什么话题会让你忘记时间？',
    sub: '选出最多 3 个最贴近你的',
    type: 'tags', key: 'interests', multi: true, max: 3,
    source: () => window.INTEREST_POOL.map(o => ({ id: o.id, label: o.label, icon: o.icon }))
  },
  {
    id: 'school', title: '你觉得自己在学校的哪些科目表现更突出？',
    sub: '选择所有符合的（可多选）',
    type: 'tags', key: 'schoolSubjects', multi: true, multiFree: true,
    source: () => window.ALEVEL_SUBJECTS.map(s => ({ id: s, label: s }))
  },
  {
    id: 'weak', title: '以下哪些科目你学起来比较吃力？',
    sub: '选择所有符合的（这会帮助我们评估选科风险）',
    type: 'tags', key: 'weakSubjects', multi: true, multiFree: true, optional: true,
    source: () => window.ALEVEL_SUBJECTS.map(s => ({ id: s, label: s }))
  },
  {
    id: 'club', title: '你在学校或课外参加过哪类社团 / 活动？',
    sub: '选择所有符合的（可多选）',
    type: 'tags', key: 'clubs', multi: true,
    source: () => [
      { id: 'debate', label: '辩论社', icon: '🎤' },
      { id: 'modelun', label: '模拟联合国', icon: '🌐' },
      { id: 'mathclub', label: '数学 / 科学竞赛社', icon: '🧮' },
      { id: 'coding', label: '编程 / 机器人社', icon: '🤖' },
      { id: 'journalism', label: '校报 / 新媒体', icon: '📰' },
      { id: 'drama', label: '戏剧 / 表演', icon: '🎭' },
      { id: 'sports', label: '运动队', icon: '⚽' },
      { id: 'volunteer', label: '志愿服务', icon: '❤️' },
      { id: 'art', label: '美术 / 设计', icon: '🎨' },
      { id: 'music', label: '乐队 / 乐团', icon: '🎵' },
      { id: 'env', label: '环保 / 公益', icon: '🌱' },
      { id: 'business', label: '模拟股市 / 商业社团', icon: '📈' }
    ]
  },
  {
    id: 'group', title: '你更喜欢怎样合作？',
    type: 'single', key: 'groupSize', options: () => window.PLAN_CONFIG.groupSize
  },
  {
    id: 'time', title: '你最适合哪种学习节奏？',
    type: 'single', key: 'timeStyle', options: () => window.PLAN_CONFIG.timeStyle
  },
  {
    id: 'mood', title: '以下哪几个最像"你"？',
    sub: '最多选 2 个 · 这是一道开放的想象题，没有对错',
    type: 'tags', key: 'selfImage', multi: true, max: 2,
    source: () => window.PLAN_CONFIG.mood.map(o => ({ id: o.id, label: o.label, desc: o.desc }))
  },
  {
    id: 'major', title: '如果现在就要选一个专业，你最想选？',
    sub: '可以选"还不确定"，系统会结合你的兴趣给出方向',
    type: 'tags', key: 'preferredMajor', multi: true, max: 2,
    source: () => window.INTEREST_OPTIONS.map(o => ({ id: o.id, label: o.label, desc: o.desc }))
  },
  {
    id: 'free', title: '平时空闲时，你更喜欢做什么？',
    sub: '最多选 3 个',
    type: 'tags', key: 'freeTime', multi: true, max: 3,
    source: () => window.PLAN_CONFIG.freeTime.map(o => ({ id: o.id, label: o.label }))
  },
  {
    id: 'career', title: '你希望未来的工作是什么样子？',
    sub: '选择最吸引你的工作方向',
    type: 'tags', key: 'career', multi: true, max: 2,
    source: () => window.CAREER_PATHS.map(o => ({ id: o.id, label: o.label, desc: o.desc }))
  },
  {
    id: 'country', title: '你更想去哪个国家或地区读大学？',
    sub: '最多选 3 个',
    type: 'tags', key: 'countries', multi: true, max: 3,
    source: () => window.COUNTRY_OPTIONS.map(o => ({ id: o.id, label: o.label, desc: o.note }))
  },
  {
    id: 'perf', title: '请选择你对自己的学习感受描述最接近的一项',
    sub: '不需要精确，凭直觉选择',
    type: 'single', key: 'subjectPerf', options: () => window.PLAN_CONFIG.subjectPerf.map((p, i) => ({ id: String(i), label: p }))
  },
  {
    id: 'length', title: '关于学制，你的偏好是？',
    type: 'single', key: 'preferredLength', options: () => window.PLAN_CONFIG.preferredLength
  }
];

/* Frozen js/report.js */
/* ============================================================
 * 报告生成引擎（规则驱动，无 AI 依赖）
 * 输入：state.academic / state.plan / state.mbti
 * 输出：结构化对象，由 report-view 渲染
 * ============================================================ */
(function () {
  const M = window.MAJORS;

  // 评分、答题覆盖率与逐题回顾共用校验，避免空字符串被 Number() 当作 0。
  function evaluateAnswer(q, answer) {
    const answered = q.type === 'choice'
      ? Number.isInteger(answer) && answer >= 0 && answer < q.options.length
      : (typeof answer === 'number' || typeof answer === 'string' && answer.trim() !== '')
        && Number.isFinite(Number(answer));
    const correct = answered && (q.type === 'choice' ? answer === q.answer
      : Math.abs(Number(answer) - q.answer) <= (q.tol || 0));
    return { answered, correct };
  }

  /* ---------- 学术得分 ---------- */
  function gradeAcademic(academic) {
    const answers = academic && academic.answers || {};
    const bank = window.QUESTION_BANK;
    const bySubject = { english: [0, 0, 0], maths: [0, 0, 0], physics: [0, 0, 0], chemistry: [0, 0, 0] };
    const topic = {};
    bank.forEach((q) => {
      const { answered, correct } = evaluateAnswer(q, answers[q.id]);
      bySubject[q.subject][1] += 1;
      if (correct) bySubject[q.subject][0] += 1;
      if (answered) bySubject[q.subject][2] += 1;
      if (!topic[q.subject]) topic[q.subject] = {};
      if (!topic[q.subject][q.topic]) topic[q.subject][q.topic] = [0, 0, 0];
      topic[q.subject][q.topic][1] += 1;
      if (correct) topic[q.subject][q.topic][0] += 1;
      if (answered) topic[q.subject][q.topic][2] += 1;
    });
    const subjects = {};
    Object.entries(bySubject).forEach(([k, [c, t, a]]) => {
      subjects[k] = { correct: c, total: t, answered: a, complete: a === t, pct: t ? Math.round((c / t) * 100) : 0 };
    });
    const sciTotal = subjects.physics.total + subjects.chemistry.total;
    const sciAnswered = subjects.physics.answered + subjects.chemistry.answered;
    const sciPct = sciTotal ? Math.round((subjects.physics.correct + subjects.chemistry.correct) / sciTotal * 100) : 0;
    return { subjects, sciPct, sciAnswered, sciTotal, topic,
      answered: Object.values(subjects).reduce((count, subject) => count + subject.answered, 0), total: bank.length };
  }

  function band(pct) {
    return window.ALEVEL_BANDS.find(b => pct >= b.min) || window.ALEVEL_BANDS[window.ALEVEL_BANDS.length - 1];
  }

  /* ---------- 专业匹配 ---------- */
  function scoreMajors(plan, academic, mbti) {
    const interests = window.INTEREST_POOL.filter(o => (plan.interests || []).includes(o.id));
    const clubs = plan.clubs || [];
    const free = window.PLAN_CONFIG.freeTime.filter(o => (plan.freeTime || []).includes(o.id));
    const self = plan.selfImage || [];
    const prefMajor = (plan.preferredMajor || []).map(id => window.INTEREST_OPTIONS.find(o => o.id === id)?.major).filter(Boolean);
    const careers = window.CAREER_PATHS.filter(o => (plan.career || []).includes(o.id));
    const school = plan.schoolSubjects || [];
    const weak = plan.weakSubjects || [];

    const moodCluster = { rational: 'math', empathic: 'social', creative: 'creative', practical: 'physics', leader: 'social', explorer: 'humanities' };
    const clubCluster = { debate: 'humanities', modelun: 'humanities', mathclub: 'math', coding: 'math', journalism: 'creative', drama: 'creative', sports: 'biology', volunteer: 'social', art: 'creative', music: 'creative', env: 'biology', business: 'social' };

    const clusterScore = {};
    interests.forEach(o => o.clusters.forEach(c => { clusterScore[c] = (clusterScore[c] || 0) + 3; }));
    clubs.forEach(id => { const c = clubCluster[id]; if (c) clusterScore[c] = (clusterScore[c] || 0) + 1.5; });
    free.forEach(o => o.clusters.forEach(c => { clusterScore[c] = (clusterScore[c] || 0) + 1; }));
    self.forEach(id => { const c = moodCluster[id]; if (c) clusterScore[c] = (clusterScore[c] || 0) + 2; });

    // 尚未测过的科目不产生正负加权，草稿中的 0 分不等于能力缺失。
    const subject = key => academic.subjects[key].complete ? academic.subjects[key].pct : 50;
    const science = academic.sciTotal
      ? (subject('physics') * academic.subjects.physics.total + subject('chemistry') * academic.subjects.chemistry.total) / academic.sciTotal : 50;
    const subjectScores = {
      cs: subject('maths') * 0.6 + science * 0.4,
      math: subject('maths'),
      phys: subject('maths') * 0.5 + subject('physics') * 0.5,
      eng: subject('maths') * 0.5 + subject('physics') * 0.5,
      chem: subject('chemistry'),
      med: subject('chemistry'),
      bio: subject('chemistry'),
      econ: subject('maths') * 0.7 + subject('english') * 0.3,
      biz: subject('english') * 0.5 + subject('maths') * 0.5,
      law: subject('english'),
      psych: subject('english') * 0.5 + subject('chemistry') * 0.5,
      design: subject('english'),
      media: subject('english'),
      intl: subject('english')
    };

    const results = M.map(m => {
      let score = 0;
      const reasons = [];
      const cs = m.cluster ? (clusterScore[m.cluster] || 0) : 0;
      // 兴趣命中：具体的兴趣标签 + 集群
      const hitInterests = interests.filter(o => o.clusters.includes(m.cluster));
      score += cs;
      if (hitInterests.length) reasons.push(`你的兴趣（${hitInterests.slice(0, 2).map(o => o.label).join('、')}）与${m.name}高度吻合`);
      // 社团
      const hitClubs = clubs.filter(id => clubCluster[id] === m.cluster);
      if (hitClubs.length) reasons.push(`参加过 ${hitClubs.slice(0, 2).map(id => window.PLAN_QUESTIONS.find(q => q.id === 'club').source().find(s => s.id === id).label).join('、')} 等相关社团`);
      // 明确专业意向
      if (prefMajor.includes(m.id)) { score += 10; reasons.push('你在专业意向中明确选择了这个方向'); }
      // 职业方向
      const hitCareer = careers.filter(c => c.majorIds.includes(m.id));
      if (hitCareer.length) { score += 5; reasons.push(`与你期望的职业路径「${hitCareer[0].label}」一致`); }
      // 擅长学科（A-Level 相关：生物/化学 → bio/med/chem；经济 → econ）
      const haveSubject = (s) => school.includes(s);
      const relevantSchool = { med: ['生物', '化学'], bio: ['生物', '化学'], chem: ['化学'], phys: ['物理', '数学'], math: ['数学'], econ: ['经济学', '数学'], biz: ['商科', '经济学'], psych: ['心理学'], law: ['历史', '英语文学'], design: ['艺术', '设计'], media: ['英语文学'], intl: ['历史', '英语文学'], cs: ['数学', '计算机'], eng: ['数学', '物理'] };
      const rel = (relevantSchool[m.id] || []).filter(haveSubject);
      if (rel.length) { score += rel.length * 2; reasons.push(`自评擅长 ${rel.join('、')}，是该专业的重要基础`); }
      const weakRel = (relevantSchool[m.id] || []).filter(s => weak.includes(s));
      if (weakRel.length) { score -= weakRel.length * 1.5; }
      // 学业能力适配（占比较大）
      const subjScore = subjectScores[m.id] ?? 50;
      score += (subjScore - 50) * 0.35;
      // MBTI 倾向（轻量）
      const tVal = mbti.TF.complete ? mbti.TF.pctA : 50;
      const nVal = mbti.SN.complete ? mbti.SN.pctB : 50;
      if (['cs', 'math', 'phys', 'eng', 'econ', 'intl', 'psych'].includes(m.id)) score += (tVal - 50) * 0.06;
      if (['chem', 'bio', 'med', 'law', 'media', 'design', 'intl'].includes(m.id)) score += (nVal - 50) * 0.04;
      // 不同专业自身的集群偏好权重
      score += m.clusterBonus || 0;
      return { major: m, score, reasons, subjScore };
    }).sort((a, b) => b.score - a.score);

    return results;
  }

  /* ---------- A-Level 选科建议 ---------- */
  function recommendSubjects(major, plan, academic) {
    const rec = [];
    const add = (name, reason, kind) => {
      if (!rec.find(r => r.name === name)) rec.push({ name, reason, kind });
    };
    major.required.forEach(s => add(s, `${major.name}方向的核心必修/强推荐科目`, 'required'));
    major.helpful.forEach(s => add(s, `${major.name}方向的加分科目`, 'helpful'));
    // 补足至 3 门可选建议
    const fallback = { cs: ['进阶数学', '物理'], math: ['进阶数学', '物理'], phys: ['进阶数学'], eng: ['进阶数学'], chem: ['数学'], med: ['数学'], bio: ['数学'], econ: ['进阶数学', '历史'], biz: ['经济学'], law: ['历史'], psych: ['数学'], design: ['艺术'], media: ['历史'], intl: ['经济学'] };
    (fallback[major.id] || []).forEach(s => add(s, '与目标专业互补的搭配', 'helpful'));
    const school = plan.schoolSubjects || [];
    school.forEach(s => {
      if (!rec.find(r => r.name === s) && window.ALEVEL_SUBJECTS.includes(s) && s !== '中文') {
        add(s, '你的优势科目，可作为第三/第四门选科', 'strong');
      }
    });
    return rec.slice(0, 4);
  }

  /* ---------- 国家建议 ---------- */
  function recommendCountries(major, plan) {
    const pref = plan.countries || [];
    const list = window.COUNTRY_OPTIONS.filter(o => o.id !== 'unsure');
    const score = list.map(c => {
      let s = 0;
      if (major.countries.includes(c.label)) s += 5;
      if (pref.includes(c.id)) s += 4;
      if (plan.countries && plan.countries.length && !plan.countries.includes(c.id) && c.id !== 'unsure') s -= 1;
      return { ...c, s };
    }).sort((a, b) => b.s - a.s).slice(0, 3);
    return score;
  }

  /* ---------- 院校分层 ---------- */
  function tierUnis(major) {
    const byCountry = {};
    major.unis.forEach(u => { (byCountry[u.country] = byCountry[u.country] || []).push(u); });
    const out = [];
    Object.entries(byCountry).forEach(([country, arr]) => out.push({ country, unis: arr }));
    return out;
  }

  /* ---------- 能力预估 ---------- */
  function fitForMajor(major, academic) {
    const subjectKeys = { '数学': 'maths', '物理': 'physics', '化学': 'chemistry' };
    const keys = [...new Set((major.required || []).map(s => subjectKeys[s]).filter(Boolean))];
    const measured = (keys.length ? keys : ['english', 'maths']).map(key => academic.subjects[key]);
    const answered = measured.reduce((count, subject) => count + subject.answered, 0);
    const total = measured.reduce((count, subject) => count + subject.total, 0);
    const complete = total > 0 && answered === total;
    const evidence = { answered, total, complete };
    if (!complete) return { ...evidence, level: '待完成测评', cls: 'pending', pct: null,
      note: '相关基础科目的作答尚未完成；完成测评后再评估学科准备情况，当前不作能力判断。' };
    const pct = Math.round(measured.reduce((sum, subject) => sum + subject.pct, 0) / measured.length);
    if (pct >= 75) return { ...evidence, level: '适配度高', cls: 'good', pct, note: '本次测评覆盖的相关基础科目表现扎实，可继续挑战进阶内容。' };
    if (pct >= 55) return { ...evidence, level: '基本适配', cls: 'mid', pct, note: '本次测评覆盖的基础尚可，建议结合错题回顾安排衔接学习。' };
    return { ...evidence, level: '需重点准备', cls: 'weak', pct, note: '本次测评覆盖的相关基础科目存在薄弱点，建议安排针对性的衔接学习。' };
  }

  function normalizePlan(raw, info) {
    const plan = {};
    raw = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    window.PLAN_QUESTIONS.forEach(q => {
      const value = raw[q.key];
      if (q.type === 'single') {
        if (q.options().some(option => option.id === value)) plan[q.key] = value;
      } else if (Array.isArray(value)) {
        const options = q.source().map(option => option.id);
        plan[q.key] = [...new Set(value.filter(item => typeof item === 'string'
          && (options.includes(item) || q.multiFree && item.trim() !== '')).map(item => item.trim()))]
          .slice(0, q.max || Infinity);
      }
    });
    const grade = String(info.grade || '');
    if (window.PLAN_CONFIG.grade.some(option => option.id === grade)) plan.grade = grade;
    return plan;
  }

  function planCoverage(plan) {
    const answered = window.PLAN_QUESTIONS.filter(q => {
      const value = plan[q.key];
      return Array.isArray(value) ? value.length > 0 || q.optional : value != null && value !== '';
    }).length;
    const complete = window.PLAN_QUESTIONS.every(q => {
      const value = plan[q.key];
      return q.optional || (Array.isArray(value) ? value.length > 0 : value != null && value !== '');
    });
    return { answered, total: window.PLAN_QUESTIONS.length, complete };
  }

  /* ---------- 主入口 ---------- */
  function generateReport(state = {}) {
    const info = state.info || {};
    const academic = gradeAcademic(state.academic);
    const mbti = window.computeMBTI(state.mbti && state.mbti.answers);
    const plan = normalizePlan(state.plan && state.plan.answers, info);
    const planning = planCoverage(plan);
    const coverage = {
      academic: { answered: academic.answered, total: academic.total },
      plan: { answered: planning.answered, total: planning.total },
      mbti: { answered: mbti.answered, total: mbti.total }
    };
    const majors = scoreMajors(plan, academic, mbti);
    const top = majors[0];
    const second = majors[1];

    // 学科分析
    const subjectList = Object.entries(academic.subjects).map(([k, v]) => ({
      key: k, ...window.SUBJECT_META[k], ...v, band: band(v.pct)
    })).sort((a, b) => b.pct - a.pct);
    const sci = { key: 'science', name: '理科综合', nameEn: 'Science (Phys + Chem)', icon: '🔬',
      pct: academic.sciPct, band: band(academic.sciPct), answered: academic.sciAnswered, total: academic.sciTotal,
      complete: academic.sciAnswered === academic.sciTotal };
    const strengths = subjectList.filter(s => s.complete && s.answered && s.pct >= 70);
    // 薄弱点：按主题找正确率低的
    const weakTopics = [];
    Object.entries(academic.topic).forEach(([subj, topics]) => {
      Object.entries(topics).forEach(([t, [c, tot, answered]]) => {
        if (answered === tot && answered > 0 && c / tot < 0.6) weakTopics.push({ subject: window.SUBJECT_META[subj].name, topic: t, pct: Math.round(c / tot * 100) });
      });
    });
    // 逐题回顾（错题+解析）
    const review = window.QUESTION_BANK.map(q => {
      const a = state.academic && state.academic.answers && state.academic.answers[q.id];
      return { q, a, ...evaluateAnswer(q, a) };
    });

    const recSubjects = recommendSubjects(top.major, plan, academic);
    const countries = recommendCountries(top.major, plan);
    const unis = tierUnis(top.major);
    const fit = fitForMajor(top.major, academic);
    const fit2 = second ? fitForMajor(second.major, academic) : null;

    // 下一步建议
    const next = [];
    if (academic.answered < academic.total) next.push({ t: '先完成学术测评', d: `目前已作答 ${academic.answered}/${academic.total} 题；未答题暂计入总题数，完成后再解读科目分数与能力准备情况。` });
    if (academic.subjects.english.complete && academic.subjects.english.pct < 60) next.push({ t: '英语能力是 A-Level 的核心门槛', d: '除英语外所有科目都要求学术英语（阅读大段题干、写论证型答案）。建议每天 20 分钟英语原版阅读，并每周写一篇 200 词学术短文。' });
    if (academic.subjects.maths.complete && academic.subjects.maths.pct < 60) next.push({ t: '数学基础需系统补强', d: '数学几乎是所有 STEM 与商科专业的门槛。建议优先补齐函数、代数变形、三角与基础微积分，再进入 A-Level Pure Math。' });
    if (sci.complete && academic.sciPct < 60) next.push({ t: '理科（物理 / 化学）存在知识缺口', d: '若希望走 STEM 路线，开学前应集中复习力学、物质的量与酸碱基础，配合实验理解。' });
    if (academic.subjects.english.complete && academic.subjects.english.pct >= 70) next.push({ t: '发挥英语优势', d: '英语强项是人文、传媒、法律方向的优势，也意味着你可以更快适应全英文授课，建议尝试英文辩论或论文写作训练。' });
    if (academic.subjects.maths.complete && academic.subjects.maths.pct >= 75) next.push({ t: '数学能力可以成为"硬实力"', d: `数学表现突出，适合冲刺 ${['cs', 'math', 'phys', 'eng', 'econ'].includes(top.major.id) ? '该专业' : '数学要求较高的专业'}；建议尽早接触进阶数学（Further Maths）内容。` });

    return {
      meta: {
        name: info.name || '', gradeId: plan.grade || '',
        grade: (window.PLAN_CONFIG.grade.find(g => g.id === plan.grade) || {}).label || '',
        status: academic.answered === academic.total && planning.complete && mbti.complete ? 'complete' : 'draft',
        coverage,
        date: new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' }),
        refYear: window.REFERENCE_YEAR,
        year: info.year || '',
        batchId: 'AP-' + Date.now().toString(36).toUpperCase()
      },
      academic: { subjects: subjectList, sci, strengths, weakTopics, review, answered: academic.answered, total: academic.total },
      plan: { top, second, majors: majors.slice(0, 4), recSubjects, countries, unis, fit, fit2, subjects: plan, prefer: plan.preferredMajor },
      mbti,
      next
    };
  }

  window.generateReport = generateReport;
  window.gradeAcademic = gradeAcademic;
})();

/* Frozen js/report-editing.js */
/* 顾问文字建议与本地修改记录。数值与测试结果仍由规则引擎生成。 */
(function () {
  'use strict';
  const sections = { summary: '核心结论说明', academic: '学习行动建议', plan: '专业与职业建议', personality: '学习策略建议' };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const defaults = {
    summary: r => r.meta.status === 'draft'
      ? '这是一份探索草稿。请先补齐测评，再与升学指导老师讨论方向。'
      : '本报告基于你的学业测试结果、专业规划问答与性格偏好综合生成，帮助你与升学指导老师讨论下一步。',
    academic: r => (r.next || []).map(n => `${n.t}：${n.d}`).join('\n') || (r.academic.answered === r.academic.total
      ? '每周复盘一次错题与课堂笔记，记录仍有疑问的知识点，再与老师调整学习计划。'
      : '请先完成学术测评，再制定针对性的学习计划。'),
    plan: r => r.plan.top.major.grad,
    personality: r => r.mbti.complete && r.mbti.type ? r.mbti.type.study : '请先完成性格测评，结合实际学习体验选择适合自己的学习方式。'
  };
  function getText(report, section) {
    if (!Object.hasOwn(sections, section)) throw new Error('未知的建议部分');
    return report.advisor?.sections?.[section] ?? defaults[section](report);
  }
  function normalizeOrigin(value) {
    const keys = ['kind', 'draft_id', 'generator', 'source_revision'];
    if (!value || typeof value !== 'object' || Array.isArray(value)
        || Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key))
        || !['rule', 'local_mock', 'provider'].includes(value.kind)
        || typeof value.draft_id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value.draft_id)
        || typeof value.generator !== 'string' || !/^[A-Za-z0-9._-]{1,80}$/.test(value.generator)
        || !Number.isSafeInteger(value.source_revision) || value.source_revision < 1) throw new Error('草稿来源格式不正确');
    return { kind: value.kind, draft_id: value.draft_id, generator: value.generator, source_revision: value.source_revision };
  }
  function originLabel(origin) {
    try {
      const value = normalizeOrigin(origin);
      return { rule: '顾问核对·规则草稿', local_mock: '顾问核对·本地模拟草稿', provider: '顾问核对·模型草稿' }[value.kind];
    } catch (_) { return ''; }
  }
  function originDetails(entry) {
    const label = originLabel(entry.origin);
    return label ? `<p>${esc(label)} · ${esc(entry.origin.generator)} · 源修订 ${esc(entry.origin.source_revision)}</p>` : '';
  }
  function normalizeActor(value) {
    const keys = ['kind', 'user_id', 'username', 'grant_id', 'source_revision', 'result_revision'];
    const uuid = input => typeof input === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(input);
    if (!value || typeof value !== 'object' || Array.isArray(value)
        || Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key))
        || value.kind !== 'school_advisor' || !uuid(value.user_id) || !uuid(value.grant_id)
        || typeof value.username !== 'string' || !/^[a-z0-9._@+\-]{3,64}$/.test(value.username)
        || !Number.isSafeInteger(value.source_revision) || value.source_revision < 1
        || !Number.isSafeInteger(value.result_revision) || value.result_revision !== value.source_revision + 1) throw new Error('学校账号记录格式不正确');
    return { kind: value.kind, user_id: value.user_id, username: value.username, grant_id: value.grant_id,
      source_revision: value.source_revision, result_revision: value.result_revision };
  }
  function validActorEntry(entry) {
    if (!Object.hasOwn(entry, 'actor')) return true;
    try { normalizeActor(entry.actor); return entry.action === 'edit' && !Object.hasOwn(entry, 'origin'); }
    catch (_) { return false; }
  }
  function actorDetails(entry) {
    if (!Object.hasOwn(entry, 'actor') || !validActorEntry(entry)) return '';
    const actor = normalizeActor(entry.actor);
    return `<p>学校账号 ${esc(actor.username)} · 修订 ${actor.source_revision} → ${actor.result_revision}（便携记录，服务端审计请在账号页核对）</p>`;
  }
  let sequence = 0;
  function applyEdit(report, section, value, author, action = 'edit') {
    if (!Object.hasOwn(sections, section)) throw new Error('请选择可编辑的建议部分');
    if (typeof author !== 'string' || !author.trim() || author.trim().length > 40) throw new Error('请填写编辑者姓名（最多 40 字）');
    if (typeof value !== 'string' || !value.trim() || value.length > 4000) throw new Error('建议文字需为 1–4000 字');
    const before = getText(report, section);
    const after = value.trim();
    if (before === after) return false;
    const advisor = report.advisor || { sections: {}, history: [] };
    advisor.sections = advisor.sections || {};
    advisor.history = advisor.history || [];
    advisor.history.push({ id: `${Date.now().toString(36)}-${++sequence}`, at: new Date().toISOString(), author: author.trim(), section, before, after, action, reportId: report.meta.batchId });
    advisor.sections[section] = after;
    advisor.lastAuthor = author.trim();
    report.advisor = advisor;
    return true;
  }
  function restoreEdit(report, id, author) {
    const entry = report.advisor?.history?.find(x => x.id === id);
    if (!entry) throw new Error('找不到该修改记录');
    return applyEdit(report, entry.section, entry.before, author, 'restore');
  }
  function carryEdits(previous, next) {
    const source = previous?.advisor;
    if (!source || typeof source !== 'object' || Array.isArray(source)) return;
    const texts = Object.fromEntries(Object.keys(sections).filter(key => typeof source.sections?.[key] === 'string'
      && source.sections[key].trim() && source.sections[key].length <= 4000).map(key => [key, source.sections[key]]));
    const history = Array.isArray(source.history) ? source.history.filter(entry => entry && typeof entry === 'object'
      && Object.hasOwn(sections, entry.section) && typeof entry.id === 'string'
      && typeof entry.author === 'string' && entry.author.length <= 40
      && typeof entry.before === 'string' && entry.before.length <= 4000
      && typeof entry.after === 'string' && entry.after.length <= 4000
      && (!Object.hasOwn(entry, 'origin') || !!originLabel(entry.origin))
      && validActorEntry(entry)
      && Number.isFinite(Date.parse(entry.at))) : [];
    if (!Object.keys(texts).length && !history.length) return;
    next.advisor = { sections: texts, history: JSON.parse(JSON.stringify(history)),
      lastAuthor: typeof source.lastAuthor === 'string' ? source.lastAuthor.slice(0, 40) : '',
      carriedFrom: previous.meta.batchId };
  }
  function mount(report, onChange) {
    const panel = document.getElementById('reportEditor');
    const toggle = document.getElementById('editReportBtn');
    if (!panel || !toggle) return;
    const previousSection = panel.querySelector('#advisorSection')?.value || 'summary';
    const history = report.advisor?.history || [];
    panel.innerHTML = `<div class="editor-heading"><h2>编辑报告建议</h2><button type="button" class="btn ghost sm" id="closeEditor">收起</button></div>
      <p>可调整四处建议文字。每次保存都会保留编辑者、时间和前后内容。修改只保存在当前浏览器，请导出 PDF 留存。</p>
      ${report.advisor?.carriedFrom ? '<p class="editor-notice">以下顾问建议沿用了上次报告的修改，请结合本次测评结果复核。</p>' : ''}
      <form id="advisorForm"><div class="editor-fields">
        <label>编辑者姓名<input id="advisorAuthor" maxlength="40" required value="${esc(report.advisor?.lastAuthor || '')}" autocomplete="name" /></label>
        <label>建议部分<select id="advisorSection">${Object.entries(sections).map(([id, label]) => `<option value="${id}" ${id === previousSection ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
      </div><label class="editor-text-label" for="advisorText">建议文字（最多 4000 字）</label><textarea id="advisorText" rows="7" maxlength="4000" required></textarea>
      <div class="editor-actions"><button type="button" class="btn ghost sm" id="defaultAdvice">恢复系统建议</button><button class="btn primary sm" type="submit">保存修改</button></div>
      <p id="advisorStatus" role="status" aria-live="polite"></p></form>
      <details class="editor-history"><summary>修改记录（${history.length}）</summary>${history.length ? [...history].reverse().map(entry => `<article><div><b>${esc(sections[entry.section] || entry.section)}</b> · ${esc(entry.author)} · <time>${esc(new Date(entry.at).toLocaleString('zh-CN'))}</time></div>${originDetails(entry)}${actorDetails(entry)}<details><summary>查看修改前后内容</summary><p>修改前</p><pre>${esc(entry.before)}</pre><p>修改后</p><pre>${esc(entry.after)}</pre></details><button type="button" class="btn ghost sm" data-restore="${esc(entry.id)}">恢复此条修改前的内容</button></article>`).join('') : '<p>尚无修改记录。</p>'}</details>`;
    const select = panel.querySelector('#advisorSection');
    const text = panel.querySelector('#advisorText');
    const author = panel.querySelector('#advisorAuthor');
    const status = panel.querySelector('#advisorStatus');
    text.value = getText(report, select.value);
    select.onchange = () => { text.value = getText(report, select.value); status.textContent = ''; };
    const show = visible => { panel.hidden = !visible; toggle.setAttribute('aria-expanded', String(visible)); if (visible) author.focus(); };
    toggle.onclick = () => show(panel.hidden);
    panel.querySelector('#closeEditor').onclick = () => show(false);
    const commit = fn => {
      try {
        if (!fn()) { status.textContent = '内容没有变化。'; return; }
        const persisted = onChange();
        panel.querySelector('#advisorStatus').textContent = persisted === false ? '本次报告已更新，本地保存暂不可用，请导出 PDF 留存。' : '修改已保存到本次报告。';
      } catch (err) { status.textContent = err.message; }
    };
    panel.querySelector('#advisorForm').onsubmit = event => {
      event.preventDefault();
      commit(() => applyEdit(report, select.value, text.value, author.value));
    };
    panel.querySelector('#defaultAdvice').onclick = () => {
      commit(() => applyEdit(report, select.value, defaults[select.value](report), author.value, 'reset'));
    };
    panel.querySelectorAll('[data-restore]').forEach(button => {
      button.onclick = () => commit(() => restoreEdit(report, button.dataset.restore, author.value));
    });
  }
  window.reportEditing = { sections, getText, applyEdit, restoreEdit, carryEdits, normalizeOrigin, originLabel, normalizeActor, actorDetails, mount };
})();

/* Frozen js/report-view.js */
/* ============================================================
 * 报告渲染：把 generateReport() 的结构化对象渲染为 HTML
 * ============================================================ */
(function () {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clsByPct = (pct) => pct >= 70 ? 'good' : pct >= 55 ? 'mid' : 'weak';
  const countryFlag = { '英国': '🇬🇧', '美国': '🇺🇸', '加拿大': '🇨🇦', '澳大利亚': '🇦🇺', '中国香港': '🇭🇰', '新加坡': '🇸🇬', '欧洲大陆': '🇪🇺' };
  const bounded = value => Math.round(Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0)));
  const edited = (r, section) => Object.hasOwn(r.advisor?.sections || {}, section);
  const editedMark = (r, section) => {
    if (!edited(r, section)) return '';
    const latest = [...(r.advisor?.history || [])].reverse().find(entry => entry.section === section);
    const label = (latest?.after === r.advisor.sections[section] ? window.reportEditing?.originLabel(latest.origin) : '') || '顾问已编辑';
    return `<span class="advisor-label">${esc(label)}</span>`;
  };
  const advice = (r, section, fallback) => window.reportEditing ? window.reportEditing.getText(r, section) : fallback;
  const adviceHtml = (r, section, fallback) => `<p class="advice-text">${esc(advice(r, section, fallback))}</p>${editedMark(r, section)}`;
  const hasPersonality = r => r.mbti.complete && r.mbti.code && r.mbti.type;
  const mAnswered = r => r.mbti.answered || 0;
  const personalityLabel = r => hasPersonality(r) ? `${r.mbti.code} · ${r.mbti.type.title}`
    : r.mbti.complete ? '倾向均衡' : '待完成性格测评';
  const isCompleteSubject = s => s.complete === true || s.answered != null && s.total > 0 && s.answered === s.total;
  const secureUrl = value => typeof value === 'string' && /^https:\/\/[a-z0-9.-]+(?::\d+)?(?:[/?#][^\s]*)?$/i.test(value) ? value : null;
  function academicCoverage(r) {
    return r.meta.coverage?.academic || { answered: r.academic.answered || 0, total: r.academic.total || r.academic.review.length };
  }
  function coverageText(r) {
    const coverage = r.meta.coverage || { academic: academicCoverage(r),
      plan: { answered: 0, total: window.PLAN_QUESTIONS.length },
      mbti: { answered: r.mbti.answered || 0, total: r.mbti.total || window.MBTI_QUESTIONS.length } };
    return `学术 ${coverage.academic.answered}/${coverage.academic.total} · 规划 ${coverage.plan.answered}/${coverage.plan.total} · 性格 ${coverage.mbti.answered}/${coverage.mbti.total}`;
  }

  function renderCover(r) {
    const top = r.plan.top.major;
    const m = r.mbti;
    const completeSubjects = r.academic.subjects.filter(isCompleteSubject);
    const strengths = r.academic.strengths || [];
    const version = window.QUESTION_BANK_META?.version || window.QUESTION_BANK_VERSION || '';
    return `<section class="cover">
      <div class="cover-top">
        <div class="cover-brand"><img src="img/bic-logo-white.png" alt="BIC" class="cover-logo" /><span>BIC 学业规划系统 · BIC Academic Planner</span></div>
        <div class="cover-date">生成日期 ${esc(r.meta.date)}<br/>报告编号 ${esc(r.meta.batchId)}</div>
      </div>
      <h1>${esc(r.meta.name)} 的<br/><span>学术规划报告</span></h1>
      <p class="cover-sub">A-Level Academic &amp; Career Planning Report · ${esc(r.meta.grade)}${r.meta.status === 'complete' ? '' : ' · 探索草稿'}</p>
      <div class="cover-grid">
        <div class="cover-cell"><small>${r.meta.status === 'complete' ? '推荐专业方向' : '待讨论的探索方向'}</small><b>${esc(top.name)}</b></div>
        <div class="cover-cell"><small>性格类型</small><b>${esc(personalityLabel(r))}</b></div>
        <div class="cover-cell"><small>优势学科</small><b>${strengths.length ? strengths.slice(0, 2).map(s => esc(s.name)).join(' / ') : completeSubjects.length ? '待结合兴趣讨论' : '待完成学术测评'}</b></div>
        <div class="cover-cell"><small>首选留学地区</small><b>${esc(r.plan.countries[0] ? r.plan.countries[0].label : '待定')}</b></div>
      </div>
      <div class="cover-foot">
        <span>已作答：${esc(coverageText(r))}${version ? ' · 题库版本 ' + esc(version) : ''}</span>
        <span>${esc(r.meta.year ? '目标 ' + r.meta.year + ' 入学' : '目标入学时间待补充')} · 数据仅供参考</span>
      </div>
    </section>`;
  }

  function renderSummary(r) {
    const top = r.plan.top.major;
    const completed = r.academic.subjects.filter(isCompleteSubject);
    const bestSubject = completed[0];
    const weakest = [...completed].sort((a, b) => a.pct - b.pct)[0];
    const coverage = academicCoverage(r);
    return `<section class="paper-section" id="sec-summary">
      <div class="sec-kicker">Executive Summary</div>
      <h2>核心结论一览</h2>
      ${r.advisor?.carriedFrom ? '<p class="report-coverage">顾问建议沿用自上次报告，请结合本次作答重新复核。</p>' : ''}
      ${adviceHtml(r, 'summary', r.meta.status === 'complete' ? '根据已完成的测评，与升学指导老师讨论以下方向。' : '这是一份探索草稿。请补齐测评后再解读能力与性格结论。')}
      <div class="exec">
        <div class="exec-card">
          <div class="t">学业诊断</div>
          <div class="big">${bestSubject ? `${esc(bestSubject.name)} ${bounded(bestSubject.pct)} 分 · ${esc(bestSubject.band.label)}` : '待完成学术测评'}</div>
          <div class="s">${coverage.answered < coverage.total ? `已作答 ${coverage.answered}/${coverage.total} 题，完成科目后再解读能力分布。` : `已完成科目中，${esc(bestSubject.name)}得分最高；${bestSubject.pct === weakest.pct ? '各科得分相同，可结合兴趣选择探索方向。' : `${esc(weakest.name)}得分相对较低，可结合错题安排复习。`}`}</div>
        </div>
        <div class="exec-card">
          <div class="t">专业方向</div>
          <div class="big">${esc(top.icon)} ${esc(top.name)}</div>
          <div class="s">${esc(top.required.join(' + '))} 是此方向的选科参考；地区与院校要求需结合具体课程复核。${r.meta.status === 'complete' ? '' : '当前排序仅供探索讨论。'}</div>
        </div>
        <div class="exec-card">
          <div class="t">性格特质</div>
          <div class="big">${esc(personalityLabel(r))}</div>
          <div class="s">${hasPersonality(r) ? esc(r.mbti.type.tag) : r.mbti.complete ? '本次回答未呈现清晰的性格类型偏向，可结合实际学习体验继续观察。' : `已作答 ${mAnswered(r)}/${r.mbti.total || window.MBTI_QUESTIONS.length} 题，完成后再讨论性格偏好。`}</div>
        </div>
      </div>
    </section>`;
  }

  function renderAcademic(r) {
    const a = r.academic;
    const coverage = academicCoverage(r);
    const complete = coverage.answered === coverage.total;
    const scoreRow = s => {
      const pct = bounded(s.pct);
      const finished = isCompleteSubject(s);
      return `<div class="score-row">
        <div class="score-name"><span class="ico">${esc(s.icon)}</span><div>${esc(s.name)}<small>${esc(s.nameEn)} · 已作答 ${s.answered || 0}/${s.total || 0}</small></div></div>
        <div class="score-track"><div class="score-fill fill-${finished ? clsByPct(pct) : 'pending'}" data-w="${pct}"></div></div>
        <div class="score-val">${finished ? pct + '%' : '待完成'}<small>${finished ? esc(s.band.label) : `已答对 ${s.correct || 0} 题`}</small></div>
      </div>`;
    };
    const rows = a.subjects.map(s => {
      return scoreRow(s);
    }).join('');

    const strong = a.strengths.length
      ? a.strengths.map(s => `<li><b>${esc(s.name)} ${s.pct}%</b> — ${esc(s.band.desc)}</li>`).join('')
      : complete ? '<li>本次已完成的科目中暂无达到 70% 的科目，可结合错题制定复习计划。</li>' : '<li>待完成学术测评，再识别优势学科。</li>';
    const weak = a.weakTopics.length
      ? a.weakTopics.slice(0, 6).map(t => `<li><b>${esc(t.subject)} · ${esc(t.topic)}</b> — 正确率 ${t.pct}%，需重点复习</li>`).join('')
      : complete ? '<li>本次测评覆盖的知识点正确率均达到 60%；可继续挑战进阶题。</li>' : '<li>尚不能根据未答题判断薄弱点，请继续完成测评。</li>';

    const scienceRow = scoreRow({ ...a.sci,
      correct: a.subjects.filter(s => ['physics', 'chemistry'].includes(s.key)).reduce((count, s) => count + s.correct, 0) });

    const wrong = a.review.filter(x => x.answered && !x.correct);
    const unanswered = a.review.filter(x => !x.answered).length;
    const reviewHtml = a.review.map(({ q, a: answer, correct, answered }) => {
      const ansText = q.type === 'choice'
        ? (q.options[q.answer])
        : String(q.answer);
      const userAnswer = answered ? q.type === 'choice' ? q.options[answer] : String(answer) : '未答';
      return `<details class="review-item ${!answered ? 'pending' : correct ? 'ok' : 'no'}">
        <summary><span class="mark">${!answered ? '—' : correct ? '✓' : '✕'}</span><span class="text">${esc(q.prompt.split('\n')[0])}</span><span class="topic">${esc(q.topic)}${answered ? '' : ' · 未答'}</span></summary>
        <div class="detail">你的答案：<b>${esc(userAnswer)}</b><br/>正确答案：<b>${esc(ansText)}</b><br/>${esc(q.explain)}</div>
      </details>`;
    }).join('');

    return `<section class="paper-section" id="sec-academic">
      <div class="sec-kicker">Part 1 · Academic Diagnosis</div>
      <h2>学科能力分析</h2>
      <p>已作答 ${coverage.answered}/${coverage.total} 道学术题。${complete ? '下表展示本次测评覆盖的基础表现。' : '未完成的科目暂不作能力判断；完整得分以全部题目为分母。'}</p>
      <div class="score-list">${rows}${scienceRow}</div>
      <p class="muted">说明：等级为「入学起点参考」，不代表 A-Level 最终成绩，能力会随学习投入显著变化。</p>

      <div class="two-col">
        <div class="panel cool">
          <h3>💪 优势学科</h3>
          <ul>${strong}</ul>
        </div>
        <div class="panel warm">
          <h3>🎯 需要补强的知识点</h3>
          <ul>${weak}</ul>
        </div>
      </div>

      <div class="quote">
        ${!complete ? '请先完成学术测评。当前只反映已作答内容，未答题不能证明学科能力不足。' : a.subjects[0].pct >= 70
          ? `${esc(a.subjects[0].name)}是你目前最突出的学科，这为你选择相关方向的 A-Level 科目提供了信心；同时请保持对相对较弱科目的关注，避免偏科影响整体选科组合的竞争力。`
          : `你目前的各科成绩较为均衡，但整体尚未形成明显优势学科。A-Level 阶段对知识深度要求更高，建议先找到 1–2 个最感兴趣的方向重点投入。`}
      </div>

      <h3 style="margin-top:28px">下一步行动建议</h3>
      ${edited(r, 'academic') || !r.next.length ? adviceHtml(r, 'academic', '') : `<ul class="timeline" style="margin-top:14px">
        ${r.next.map(n => `<li><b>${esc(n.t)}</b><span>${esc(n.d)}</span></li>`).join('')}
      </ul>`}
    </section>

    <section class="paper-section appendix" id="sec-review">
      <div class="sec-kicker">Appendix · Answer Review</div>
      <h2>逐题回顾与解析</h2>
      <p class="muted">共 ${wrong.length} 道错题，${unanswered} 道未答（题库共 ${a.review.length} 题）。展开可对照你的答案、正确答案与解析。</p>
      <div class="review-grid">${reviewHtml}</div>
    </section>`;
  }

  function renderPlan(r) {
    const p = r.plan;
    const top = p.top.major;
    const reasons = p.top.reasons.length ? p.top.reasons : ['当前信息不足；这是供后续讨论的探索方向，请继续完善测评'];
    const recommendationIndex = item => bounded(60 + (Number.isFinite(item.score) ? item.score : 0) * 2);

    const others = p.majors.slice(1, 4);
    const othersHtml = others.length ? `<h3 style="margin-top:28px">备选方向</h3><div class="alt-majors">${others.map(o => `
      <div class="alt-major"><div class="n">${esc(o.major.icon)} ${esc(o.major.name)}</div><div class="m">推荐指数 ${recommendationIndex(o)}/100${o.major.required.length ? ' · ' + esc(o.major.required.join('+')) : ''}</div></div>`).join('')}</div>` : '';

    const subjectRows = p.recSubjects.map(s => `
      <tr><td>${esc(s.name)}</td><td><span class="tag ${s.kind === 'required' ? 'req' : s.kind === 'strong' ? 'strong' : 'help'}">${s.kind === 'required' ? '必修/强推荐' : s.kind === 'strong' ? '优势搭配' : '加分推荐'}</span></td><td>${esc(s.reason)}</td></tr>`).join('');

    const countryCards = p.countries.map((c, i) => `
      <div class="country-card ${i === 0 ? 'primary' : ''}">
        <div class="flag">${countryFlag[c.label] || '🌍'}${i === 0 ? (p.subjects.countries?.some(id => id !== 'unsure') ? ' · 讨论首选' : ' · 探索参考') : ''}</div>
        <b>${esc(c.label)}</b>
        <p>${esc(c.note)}</p>
      </div>`).join('');

    const uniGroups = p.unis.map(g => `
      <div class="uni-group">
        <h4>${esc(g.country)}</h4>
        ${g.unis.map(u => {
          const source = secureUrl(u.sourceUrl);
          const policy = u.scope === 'policy' && u.entryYear == null;
          const year = Number.isInteger(u.entryYear) && u.entryYear >= 2020 && u.entryYear <= 2100;
          const undatedCourse = u.scope === 'course' && u.entryYear == null;
          const verified = u.reviewStatus === 'verified' && (policy || undatedCourse || year) && u.reviewedAt && source;
          const sources = [...new Set([source, ...(Array.isArray(u.sourceUrls) ? u.sourceUrls.map(secureUrl) : [])].filter(Boolean))];
          return `<div class="uni-row"><div class="uni-name">${esc(u.name)}${verified && u.courseName ? `<small class="uni-course">${esc(u.courseName)}</small>` : ''}<small>${verified ? policy ? '官网政策已核验' : '官网课程已核验' : '历史参考 · 待复核'}</small></div><div class="uni-req">${verified ? esc(u.req || '请查官网') : '录取要求待复核'}</div><div class="uni-note">${verified ? esc(u.note || '') : '请查看该校本科招生官网。'}
            ${verified ? `<div>${policy ? '招生政策 · 未指定入学年' + (u.applicationCycle ? ' · ' + esc(u.applicationCycle) + ' 申请周期' : '') : undatedCourse ? '课程要求 · 未指定入学年' : esc(u.entryYear) + ' 入学'} · 核验日期 ${esc(u.reviewedAt)}</div>` : '<div>历史要求仅作探索参考，请复核对应入学年份。</div>'}
            ${sources.map((url, index) => `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">官网要求${sources.length > 1 ? ' ' + (index + 1) : ''}</a>`).join(' · ')}</div></div>`;
        }).join('')}
      </div>`).join('');

    const moodLabel = { rational: '理性分析', empathic: '共情他人', creative: '创意想象', practical: '动手实践', leader: '组织领导', explorer: '广泛探索' };
    const selfImage = (p.subjects.selfImage || []).map(x => moodLabel[x]).filter(Boolean).join('、') || '开放探索';
    const careerLabel = (window.CAREER_PATHS.filter(c => (p.subjects.career || []).includes(c.id)).map(c => c.label)).join('、') || '尚未确定';

    const grade = r.meta.gradeId || p.subjects.grade;
    const timeline = grade === '8'
      ? [['8 年级（当前）', '广泛探索兴趣领域，夯实英语与数学基础，尝试参加 1–2 个社团或竞赛。'], ['9 年级', '围绕 2–3 个方向继续探索，了解学校的科目设置，积累社团与阅读体验。'], ['10 年级', '确认 A-Level 选科，逐步形成目标地区与课程清单。']]
      : grade === '9'
      ? [['9 年级（当前）', '探索本科专业与学习兴趣，确认学校是否开设相关科目，安排阅读和社团体验。'], ['10 年级', '围绕目标方向确定 A-Level 科目，了解地区与院校的课程要求。'], ['11 年级', '按学校教学进度进入 AS 学习，复核目标课程与申请材料要求。']]
      : grade === '10'
      ? [['10 年级（当前）', '确认 A-Level 选科组合，如果是 10 年级末，尽快确定三科核心选项。'], ['AS 阶段', '保持学科成绩，按目标课程官网要求安排入学测试或竞赛训练。'], ['A2 阶段', '完成院校申请、笔试、文书与面试，保持最终考试成绩达标。']]
      : [['当前阶段', '核对已选科目是否满足目标专业要求；若不满足，尽早评估转科或补充方案。'], ['AS 冲刺', '确认目标国家与院校，开始准备对应的入学笔试与文书材料。'], ['A2 阶段', '完成申请与面试，保持最终考试成绩达标。']];

    return `<section class="paper-section" id="sec-plan">
      <div class="sec-kicker">Part 2 · Future Path Planning</div>
      <h2>未来升学路径规划</h2>
      <p>${r.meta.status === 'complete' ? '根据本次测评与规划偏好，以下方向可作为升学讨论的起点。' : '当前为探索草稿，以下方向会随着测评与偏好的补充而调整。'}</p>
      <p class="muted">推荐指数是规则排序的参考值（0–100），用于比较探索方向，不是录取概率或经过校准的能力预测。</p>

      <div class="path-hero print-keep">
        <div class="big-ico">${esc(top.icon)}</div>
        <div>
          <h3>${esc(top.name)}</h3>
          <div class="en">${esc(top.en)} · ${esc(top.category)}</div>
          ${adviceHtml(r, 'plan', top.grad)}
          <p class="muted">推荐指数 ${recommendationIndex(p.top)}/100</p>
        </div>
        <div class="fit-badge ${esc(p.fit.cls)}"><b>${esc(p.fit.level)}</b><span>${Number.isFinite(p.fit.pct) ? `已测基础参考 ${bounded(p.fit.pct)}%` : '待完成相关科目'}</span></div>
      </div>
      <div class="reason-list">${reasons.map(x => `<span class="reason-chip">${esc(x)}</span>`).join('')}</div>

      <div class="two-col" style="margin-top:18px">
        <div class="panel">
          <h3>🧭 你的自我定位</h3>
          <ul>
            <li>自我形象：<b>${esc(selfImage)}</b></li>
            <li>职业愿景：<b>${esc(careerLabel)}</b></li>
            <li>期望学制：<b>${esc((window.PLAN_CONFIG.preferredLength.find(o => o.id === p.subjects.preferredLength) || {}).label || '灵活')}</b></li>
          </ul>
        </div>
        <div class="panel">
          <h3>📌 专业能力评估</h3>
          <p style="margin-top:4px">${esc(p.fit.note)}</p>
          ${p.fit2 ? `<p class="muted" style="margin-top:10px">备选方向「${esc(p.second.major.name)}」的评估：${esc(p.fit2.level)}${Number.isFinite(p.fit2.pct) ? `（已测基础参考 ${bounded(p.fit2.pct)}%）` : '（待完成相关科目）'}</p>` : ''}
        </div>
      </div>

      <h3 style="margin-top:30px">1. A-Level 选科建议</h3>
      <p class="muted">以下为 ${esc(top.name)} 方向的初步选科参考。请与老师核对学校开课情况及具体目标课程的要求。</p>
      <table class="subject-table">
        <thead><tr><th>科目</th><th>定位</th><th>推荐理由</th></tr></thead>
        <tbody>${subjectRows}</tbody>
      </table>
      <div class="panel" style="margin-top:14px">
        <h3>⚠️ 选科注意事项</h3>
        <ul>${top.hints.map(h => `<li>${esc(h)}</li>`).join('')}
          ${top.required.filter(subject => (p.subjects.weakSubjects || []).includes(subject)).map(subject => `<li>你自评在 <b>${esc(subject)}</b> 上比较吃力，可先与老师讨论衔接学习或备选科目。</li>`).join('')}
          <li>部分顶尖院校不接受中文等母语科目作为三科成绩之一，请以各校官网最新要求为准。</li>
        </ul>
      </div>

      ${othersHtml}

      <h3 style="margin-top:30px">2. 留学国家与地区选择</h3>
      <div class="country-grid">${countryCards}</div>

      <h3 style="margin-top:30px">3. 目标院校推荐</h3>
      <p class="muted">以下为 ${esc(top.name)} 方向的课程参考清单。每条记录单独标注核验状态与入学年份；历史记录须先复核，不能直接视作当前录取要求。</p>
      ${uniGroups || '<p class="muted">该方向暂无院校记录，请与升学指导老师共同查询对应课程。</p>'}

      <h3 style="margin-top:30px">4. 未来职业路径</h3>
      <div class="reason-list">${top.careers.map(c => `<span class="reason-chip">${esc(c)}</span>`).join('')}</div>
      ${adviceHtml(r, 'plan', top.grad)}

      <h3 style="margin-top:30px">5. 时间线与行动建议</h3>
      <ul class="timeline">${timeline.map(([t, d]) => `<li><b>${esc(t)}</b><span>${esc(d)}</span></li>`).join('')}</ul>
    </section>`;
  }

  function renderMBTI(r) {
    const m = r.mbti;
    const t = m.type;
    const dims = [
      { code: 'EI', l: '外向 E', r: '内向 I', val: m.EI },
      { code: 'SN', l: '实感 S', r: '直觉 N', val: m.SN },
      { code: 'TF', l: '思考 T', r: '情感 F', val: m.TF },
      { code: 'JP', l: '判断 J', r: '知觉 P', val: m.JP }
    ];
    const dimHtml = dims.map(d => {
      const v = d.val;
      const winL = v.pctA > 50;
      const winR = v.pctB > 50;
      const finished = v.complete;
      return `<div class="dim">
        <div class="l ${finished && winL ? 'win' : ''}">${d.l} ${finished && winL ? bounded(v.pctA) + '%' : ''}</div>
        <div class="bar"><div class="a" style="width:${finished ? bounded(v.pctA) : 50}%"></div><div class="b" style="width:${finished ? bounded(v.pctB) : 50}%"></div></div>
        <div class="r ${finished && winR ? 'win' : ''}">${finished && winR ? bounded(v.pctB) + '%' : ''} ${d.r}</div>
        <p class="muted">${finished ? v.pctA === 50 ? '倾向均衡' : '已完成此维度' : '待完成'} · 已作答 ${v.answered || 0}/${v.total || 6}</p>
      </div>`;
    }).join('');

    if (!hasPersonality(r)) {
      return `<section class="paper-section" id="sec-mbti">
        <div class="sec-kicker">Part 3 · Personality</div><h2>性格特点解析</h2>
        <h3>${esc(personalityLabel(r))}</h3>
        <p>已作答 ${mAnswered(r)}/${m.total || window.MBTI_QUESTIONS.length} 道性格题。${m.complete ? '本次回答未呈现清晰的类型偏向，可结合实际学习体验继续观察，不强行指定人格类型。' : '请完成量表后再讨论性格偏好；少量回答不能确定人格类型。'}</p>
        <div class="mbti-scale">${dimHtml}</div>
        ${edited(r, 'personality') ? adviceHtml(r, 'personality', '') : '<p>可尝试独立学习、小组讨论和实践项目，记录在哪些环境下更专注、更舒适，再与老师交流。</p>'}
      </section>`;
    }

    const codeHtml = m.code.split('').map((c, i) => `<span style="${i % 2 === 0 ? 'color:var(--paper-brand)' : ''}">${c}</span>`).join('');

    return `<section class="paper-section" id="sec-mbti">
      <div class="sec-kicker">Part 3 · Personality</div>
      <h2>性格特点解析</h2>
      <div class="mbti-hero">
        <div>
          <div class="mbti-code">${codeHtml}</div>
          <div class="mbti-title">${esc(t.title)} · ${esc(t.tag)}</div>
        </div>
      </div>
      <p>${esc(t.desc)}</p>

      <div class="mbti-scale">${dimHtml}</div>

      <div class="persona">
        <div class="panel cool">
          <h3>✨ 性格优势</h3>
          <ul>${t.strengths.map(s => `<li>${esc(s)}</li>`).join('')}</ul>
        </div>
        <div class="panel warm">
          <h3>🌱 成长建议</h3>
          <ul>${t.watch.map(s => `<li>${esc(s)}</li>`).join('')}</ul>
        </div>
      </div>

      <div class="panel" style="margin-top:18px">
        <h3>📖 与你匹配的学习策略</h3>
        ${adviceHtml(r, 'personality', t.study)}
      </div>

      <div class="quote">
        性格类型没有优劣之分。它帮助你理解自己"在什么环境下最能发挥"，而不是给自己设限。A-Level 阶段同样需要注意：${m.JP.pole === 'P' ? '你会倾向于灵活安排时间，建议建立一个最低限度的固定学习节奏（如每天固定一小时），否则容易拖到考前突击。' : m.JP.pole === 'J' ? '你习惯按计划执行，这非常有利于 A-Level 学习，但也要允许自己在遇到新方向时调整计划。' : ''}
      </div>
    </section>`;
  }

  function renderFooter(r) {
    return `<section class="paper-section">
      <h3>说明与免责</h3>
      <p class="disclaimer">
        本报告由「BIC 学业规划系统」根据测试作答自动生成，用于帮助学生认识自身优势与方向，不构成升学决策的唯一依据。
        院校记录逐条区分具体课程与招生政策，并标注公布的入学年份、申请周期、核验日期和官网来源；未指定入学年的政策不等于某个入学年的完整课程要求。标注「历史参考 · 待复核」的内容不作为当前录取要求。请以目标课程官网为准。
        MBTI 为简版人格测评，仅供性格参考，非专业心理诊断。
        建议结合学校升学指导老师的意见，共同制定最终规划。
      </p>
      <p class="disclaimer" style="margin-top:10px">报告编号 ${esc(r.meta.batchId)} · 生成于 ${esc(r.meta.date)} · ${esc(r.meta.refYear)}</p>
    </section>`;
  }

  window.renderReport = function (r) {
    return `<div class="paper">
      ${renderCover(r)}
      ${renderSummary(r)}
      ${renderAcademic(r)}
      ${renderPlan(r)}
      ${renderMBTI(r)}
      ${renderFooter(r)}
    </div>`;
  };

  /* 进入报告后触发条形动画 */
  window.animateReport = function (root) {
    requestAnimationFrame(() => {
      root.querySelectorAll('.score-fill').forEach(el => {
        const w = el.dataset.w;
        setTimeout(() => { el.style.width = w + '%'; }, 80);
      });
    });
  };
})();

/* Frozen js/report-store.js */
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
    shape(value.plan.answers, window.PLAN_QUESTIONS.map(q => q.key), '规划答案');
    const plan = { answers: {} };
    window.PLAN_QUESTIONS.forEach(q => {
      const answer = value.plan.answers[q.key];
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
    if (info.grade && plan.answers.grade && info.grade !== plan.answers.grade) fail('学生资料与规划答案的年级不一致');
    if (!info.grade && plan.answers.grade) info.grade = plan.answers.grade;
    if (info.grade) plan.answers.grade = info.grade;
    shape(value.mbti, ['answers'], '性格测评');
    if (!Array.isArray(value.mbti.answers) || value.mbti.answers.length > window.MBTI_QUESTIONS.length) fail('性格答案数量或类型无效');
    const scale = window.MBTI_SCALE.map(option => option.value);
    const mbti = { answers: Array.from({ length: window.MBTI_QUESTIONS.length }, (_, i) => {
      const answer = value.mbti.answers[i];
      if (answer === undefined || answer === null) return null;
      if (!scale.includes(answer)) fail(`性格题 ${i + 1} 的答案无效`);
      return answer;
    }) };
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
      shape(entry, ['id', 'at', 'author', 'section', 'before', 'after', 'action', 'reportId', 'origin', 'actor'], '顾问修改记录');
      const id = text(entry.id, 100, '修改编号', true);
      if (ids.has(id)) fail('顾问修改编号重复');
      ids.add(id);
      if (!SECTIONS.includes(entry.section) || !['edit', 'reset', 'restore'].includes(entry.action)) fail('顾问修改部分或操作类型无效');
      const result = { id, at: timestamp(entry.at, '修改时间'), author: text(entry.author, 40, '编辑者', true),
        section: entry.section, before: text(entry.before, 4000, '修改前文字'), after: text(entry.after, 4000, '修改后文字', true),
        action: entry.action, reportId: text(entry.reportId, 100, '原报告编号', true) };
      if (Object.hasOwn(entry, 'origin')) {
        const origin = entry.origin;
        shape(origin, ['kind', 'draft_id', 'generator', 'source_revision'], '草稿来源');
        if (!['rule', 'local_mock', 'provider'].includes(origin.kind)
            || typeof origin.draft_id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(origin.draft_id)
            || typeof origin.generator !== 'string' || !/^[A-Za-z0-9._-]{1,80}$/.test(origin.generator)
            || !Number.isSafeInteger(origin.source_revision) || origin.source_revision < 1) fail('草稿来源格式不正确');
        result.origin = { kind: origin.kind, draft_id: origin.draft_id, generator: origin.generator, source_revision: origin.source_revision };
      }
      if (Object.hasOwn(entry, 'actor')) {
        const actor = entry.actor;
        shape(actor, ['kind', 'user_id', 'username', 'grant_id', 'source_revision', 'result_revision'], '学校账号记录');
        const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
        if (entry.action !== 'edit' || Object.hasOwn(entry, 'origin') || actor.kind !== 'school_advisor'
            || !uuid(actor.user_id) || !uuid(actor.grant_id) || typeof actor.username !== 'string'
            || !/^[a-z0-9._@+\-]{3,64}$/.test(actor.username)
            || !Number.isSafeInteger(actor.source_revision) || actor.source_revision < 1
            || !Number.isSafeInteger(actor.result_revision) || actor.result_revision !== actor.source_revision + 1) fail('学校账号记录格式不正确');
        result.actor = { kind: actor.kind, user_id: actor.user_id, username: actor.username, grant_id: actor.grant_id,
          source_revision: actor.source_revision, result_revision: actor.result_revision };
      }
      return result;
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
      const state = normalizeState({ info: currentState.info, academic: currentState.academic, plan: currentState.plan, mbti: currentState.mbti });
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
      const rows = [['归档编号', '报告编号', '学生姓名', '年级', '目标入学时间', '报告日期', '报告状态', '学术已答', '学术总题', '数学百分比（完成后）', '英语百分比（完成后）', '物理百分比（完成后）', '化学百分比（完成后）', '首选探索专业', '性格倾向', '归档题库版本', '归档院校目录版本']];
      records.forEach(record => {
        const report = window.generateReport(record.state);
        const pct = key => { const subject = report.academic.subjects.find(item => item.key === key); return subject?.complete ? subject.pct : ''; };
        rows.push([record.id, record.reportMeta.batchId, record.state.info.name, report.meta.grade, record.state.info.year,
          record.reportMeta.date, report.meta.status === 'complete' ? '完成' : '草稿', report.academic.answered, report.academic.total,
          pct('maths'), pct('english'), pct('physics'), pct('chemistry'), report.plan.top.major.name,
          report.mbti.complete ? report.mbti.code || '倾向均衡' : '待完成', record.bankVersion, record.catalogVersion || '未知']);
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

  const clone = value => JSON.parse(JSON.stringify(value));
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  function invalid() { const error = new Error('旧版档案格式无效，请保留原始资料并核对。'); error.code = 'VALIDATION'; throw error; }
  function jsonValue(value) {
    let raw; try { raw = JSON.stringify(value); } catch (_) { invalid(); }
    if (typeof raw !== 'string' || raw.length > 2000000) invalid();
    const pending = [value], seen = new WeakSet(); let count = 0;
    while (pending.length) {
      const next = pending.pop(); if (++count > 2000000) invalid();
      if (typeof next === 'string') { for (let i = 0; i < next.length; i++) { const code = next.charCodeAt(i); if (code >= 0xD800 && code <= 0xDBFF) { const low = next.charCodeAt(++i); if (!(low >= 0xDC00 && low <= 0xDFFF)) invalid(); } else if (code >= 0xDC00 && code <= 0xDFFF) invalid(); } }
      else if (next === null || typeof next === 'boolean') continue;
      else if (typeof next === 'number') { if (!Number.isFinite(next)) invalid(); }
      else if (object(next) || Array.isArray(next)) { if (seen.has(next)) continue; seen.add(next); for (const value of Object.values(next)) pending.push(value); if (Object.getOwnPropertySymbols(next).length || Array.isArray(next) && Object.keys(next).length !== next.length) invalid(); }
      else invalid();
    }
    return raw;
  }
  // 记录不带版本标记时，当前版本特有的规划题只能视为未作答；只保留旧版题目里仍有效的回答，不能因此判为无法识别。
  function legacyAnswers(answers) {
    return Object.fromEntries(window.PLAN_QUESTIONS.flatMap(q => {
      const answer = answers[q.key];
      if (answer === undefined) return [];
      const options = (q.type === 'single' ? q.options() : q.source()).map(option => option.id);
      if (q.type !== 'single') {
        const kept = Array.isArray(answer) ? answer.filter(item => options.includes(item)) : [];
        return [kept.length === answer.length ? [q.key, answer] : [q.key, kept]];
      }
      return options.includes(answer) ? [[q.key, answer]] : [];
    }));
  }
  // 旧版作答逐题复核，严格拒绝无法按旧版规则解释的内容；当前版本独有的题目在旧版里视为未作答。
  // 记录里的报告属于生成结果，复核作答时由旧版引擎按作答重新生成，不从记录带入。
  function checkAnswers(state, allowBlankName) {
    if (!object(state)) invalid();
    const value = clone(state);
    delete value.assessmentProfile; delete value.report;
    const keys = allowBlankName ? ['info', 'academic', 'plan', 'mbti'] : null;
    if (keys) shape(value, keys, '作答记录');
    else shape(value, ['info', 'academic', 'plan', 'mbti'], '作答记录');
    shape(value.info, ['name', 'grade', 'year'], '学生资料');
    text(value.info.name, 24, '学生姓名', !allowBlankName);
    text(value.info.grade, 10, '年级'); text(value.info.year, 40, '目标入学时间');
    const grades = window.PLAN_CONFIG.grade.map(option => option.id);
    if (value.info.grade && !grades.includes(value.info.grade)) fail('年级不在当前测评范围内');
    shape(value.academic, ['answers'], '学术测评');
    shape(value.academic.answers, window.QUESTION_BANK.map(q => q.id), '学术答案');
    window.QUESTION_BANK.forEach(q => {
      const answer = value.academic.answers[q.id];
      if (answer === undefined || answer === null) return; // 页面清空数值题后存为 null，含义仍为未作答。
      const valid = q.type === 'choice'
        ? Number.isInteger(answer) && answer >= 0 && answer < q.options.length
        : (typeof answer === 'number' || typeof answer === 'string' && answer.trim() !== '' && answer.length <= 100) && Number.isFinite(Number(answer));
      if (!valid) fail(`学术题 ${q.id} 的答案无效`);
    });
    shape(value.plan, ['answers'], '专业规划');
    shape(value.plan.answers, window.PLAN_QUESTIONS.map(q => q.key), '规划答案');
    window.PLAN_QUESTIONS.forEach(q => {
      const answer = value.plan.answers[q.key];
      if (answer === undefined) return;
      const options = (q.type === 'single' ? q.options() : q.source()).map(option => option.id);
      if (q.type === 'single') {
        if (!options.includes(answer)) fail(`规划题 ${q.key} 的选项或数量无效`);
        return;
      }
      if (!Array.isArray(answer)) fail(`规划题 ${q.key} 的选项或数量无效`);
      const ids = Array.from(new Set(answer));
      if (ids.length !== answer.length || ids.length > (q.max || Infinity) || ids.some(id => !options.includes(id))) fail(`规划题 ${q.key} 的选项或数量无效`);
      if (q.optional !== true && ids.length < (q.min || 1)) fail(`规划题 ${q.key} 的选项或数量无效`);
    });
    shape(value.mbti, ['answers'], '性格测评');
    if (!Array.isArray(value.mbti.answers) || value.mbti.answers.length > window.MBTI_QUESTIONS.length) fail('性格答案格式不正确');
    value.mbti.answers.forEach((answer, index) => {
      const q = window.MBTI_QUESTIONS[index];
      if (q && answer !== null && !(Number.isInteger(answer) && answer >= 0 && answer < q.options.length)) fail('性格答案无效');
    });
    return value;
  }
  function validateRecord(record) {
    // 旧版校验器可以复核旧版归档；当前版本记录由账号服务与当前报告库直接处理。
    if (host.AssessmentProfiles.recordProfile(record) !== host.AssessmentProfiles.LEGACY) { const error = new Error('不能用旧版引擎解释新版资料。'); error.code = 'PROFILE'; throw error; }
    const raw = jsonValue(record);
    const store = window.ReportStore.create({ getItem: () => null, setItem() {} });
    const value = JSON.parse(raw);
    // 记录里的报告属于生成结果，复核作答时由旧版引擎按作答重新生成，不从记录带入。
    const probe = { ...value, state: { ...value.state } };
    delete probe.state.report;
    store.previewImport(jsonValue({ format: 'bic-report-library', version: 1, exportedAt: '2026-10-25T00:00:00Z', records: [probe] }));
    return JSON.parse(raw);
  }
  function validateState(state, options = {}) {
    if (!object(options) || Object.keys(options).some(key => key !== 'allowBlankName') || Object.hasOwn(options, 'allowBlankName') && typeof options.allowBlankName !== 'boolean'
        || !object(state) || Object.keys(state).some(key => !['info','academic','plan','mbti','report','assessmentProfile'].includes(key)) || host.AssessmentProfiles.stateProfile(state) !== host.AssessmentProfiles.LEGACY) invalid();
    // 记录层只保存作答；报告随作答一起打开时只校验作答，报告元数据由引擎重新生成。
    const value = JSON.parse(jsonValue(state)); delete value.assessmentProfile; delete value.report;
    const probe = clone(value);
    if (options.allowBlankName && typeof probe.info?.name === 'string' && probe.info.name.length <= 24 && !probe.info.name.trim()) probe.info.name = '旧版续答校验';
    validateRecord({ id: 'legacy-validation', createdAt: '2026-10-25T00:00:00Z', updatedAt: '2026-10-25T00:00:00Z', bankVersion: '2026.10', state: probe, reportMeta: { batchId: 'LEGACY-VALIDATION', date: '2026/10/25' } });
    return value;
  }
  const originalGenerateReport = window.generateReport;
  function generateReport(state) {
    if (host.AssessmentProfiles.stateProfile(state) !== host.AssessmentProfiles.LEGACY) { const error = new Error('不能用旧版引擎解释新版资料。'); error.code = 'PROFILE'; throw error; }
    const report = originalGenerateReport(state); report.meta.assessmentProfile = host.AssessmentProfiles.LEGACY; return report;
  }
  function renderReport(report) {
    if (host.AssessmentProfiles.reportProfile(report) !== host.AssessmentProfiles.LEGACY) { const error = new Error('报告测评版本不受支持。'); error.code = 'PROFILE'; throw error; }
    return '<p class="report-coverage">旧版24题测评 · 保留原问卷含义；院校资料按当前目录展示。</p>' + window.renderReport(report);
  }
  window.generateReport = generateReport;
  host.LegacyAssessment = Object.freeze({ source: {"source_revision":"a10d5577c18ce48188fd74e31829d57d57fc3dd5","profile":"legacy-2026.10"}, planQuestions: window.PLAN_QUESTIONS, planConfig: window.PLAN_CONFIG,
    mbtiQuestions: window.MBTI_QUESTIONS, mbtiScale: window.MBTI_SCALE, generateReport, renderReport, createStore: storage => window.ReportStore.create(storage), validateRecord, validateState,
    // 旧版报告按归档重算时需要沿用归档里的顾问修改（来源标签也按旧版规则校验）。
    carryEdits: window.reportEditing.carryEdits });
})(window);
