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
  pace: [
    { id: 'deep', label: '长时间深度沉浸', desc: '可以连续数小时投入一件事' },
    { id: 'varied', label: '短时间内切换多样任务', desc: '不断有新内容刺激' },
    { id: 'steady', label: '规律、稳定的日常节奏', desc: '固定计划，稳步推进' },
    { id: 'deadline', label: '截止日期前的集中冲刺', desc: '在压力下爆发效率最高' }
  ],
  preferredLength: [
    { id: 'short', label: '短学制，快速就业', desc: '如英国三年制本科' },
    { id: 'long',  label: '愿意为长期专业投入', desc: '如医学、建筑、读博' },
    { id: 'flex',  label: '希望路径灵活可调整', desc: '如美国四年制、可转专业' }
  ]
};

const SUM = values => (Array.isArray(values) ? values : []).reduce((n, v) => n + (Array.isArray(v) ? v.length : 0), 0);

/* 卡片分格游戏（校园匹配 / 星球排序）的答案校验与合并 */
window.isBoardAnswer = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.values(value).every(v => Array.isArray(v) && v.every(id => typeof id === 'string'));

window.mergeBoard = (key, board) => {
  if (!window.isBoardAnswer(board)) return () => {};
  const like = board.like || [], tryList = board.try || [], avoid = board.avoid || [];
  return (answers) => {
    if (key === 'subjectBoard') {
      const known = new Set([...(answers.schoolSubjects || []), ...(answers.weakSubjects || [])]);
      answers.schoolSubjects = [...new Set([...like, ...tryList])];
      answers.weakSubjects = [...new Set([...avoid, ...(answers.weakSubjects || []).filter(s => known.has(s) && !answers.schoolSubjects.includes(s))])];
    } else if (key === 'majorBoard') {
      const majorOf = id => window.INTEREST_OPTIONS.find(o => o.major === id)?.id;
      answers.preferredMajor = [...new Set([...like, ...tryList].map(majorOf).filter(Boolean))].slice(0, 6);
    }
  };
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
    id: 'campus', title: '校园匹配 · 把学科卡片拖进格子',
    sub: '哪些学科你喜欢、想试试，或者想避开？每格最多放 4 个',
    type: 'game', game: 'campus', key: 'subjectBoard',
    isAnswered: v => !!v && SUM(Object.values(v)) > 0
  },
  {
    id: 'dart', title: '职业飞镖 · 你会命中哪个方向？',
    sub: '想象你站在人生靶盘前，点击最想命中的两个靶环',
    type: 'game', game: 'dart', key: 'career', multi: true, max: 2,
    isAnswered: v => Array.isArray(v) && v.length > 0
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
    id: 'planet', title: '星球排序 · 把专业星球分到三边',
    sub: '心动、观望、排除 —— 每边最多 3 个，凭第一直觉',
    type: 'game', game: 'planet', key: 'majorBoard',
    isAnswered: v => !!v && SUM(Object.values(v)) > 0
  },
  {
    id: 'race', title: '团队竞速 · 选你的节奏与搭档',
    sub: '一场班级项目要开跑了，你希望怎么跑、和谁一起？',
    type: 'game', game: 'race', key: 'team',
    isAnswered: v => !!v && !!v.pace && !!v.partner
  },
  {
    id: 'mood', title: '以下哪几个最像"你"？',
    sub: '最多选 2 个 · 这是一道开放的想象题，没有对错',
    type: 'tags', key: 'selfImage', multi: true, max: 2,
    source: () => window.PLAN_CONFIG.mood.map(o => ({ id: o.id, label: o.label, desc: o.desc }))
  },
  {
    id: 'free', title: '平时空闲时，你更喜欢做什么？',
    sub: '最多选 3 个',
    type: 'tags', key: 'freeTime', multi: true, max: 3,
    source: () => window.PLAN_CONFIG.freeTime.map(o => ({ id: o.id, label: o.label }))
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
  },
  {
    id: 'weak', title: '以下哪些科目你学起来比较吃力？',
    sub: '选择所有符合的（选填，这会帮助我们评估选科风险）',
    type: 'tags', key: 'weakSubjects', multi: true, multiFree: true, optional: true,
    source: () => window.ALEVEL_SUBJECTS.map(s => ({ id: s, label: s }))
  }
];
