/* ============================================================
 * 专业 × A-Level 选科 × 院校 × 职业映射数据
 * 说明：
 *  - required: 绝大多数院校该专业的必修/强推荐科目
 *  - helpful : 加分科目
 *  - avoid   : 该方向下尽量避免作为主力专业科目的选择
 *  - acceptance: 用于报告中的"能力预估"，粗略估计入学后的承接难度
 *    （以该专业所需基础科目测试得分的中位数衡量）
 * ============================================================ */
window.REFERENCE_YEAR = '2026 学年入学';
window.MAJORS = [
  {
    id: 'cs', name: '计算机科学', en: 'Computer Science', category: 'STEM', cluster: 'math',
    icon: '💻',
    keywordIds: ['coding', 'math', 'puzzles', 'logic', 'build', 'tech'], clusterBonus: 3,
    required: ['数学'], helpful: ['进阶数学', '物理'], avoid: [],
    alSupport: { '数学': 3, '进阶数学': 3, '物理': 1 },
    unis: (window.UNIVERSITY_CATALOG?.entries || []).filter(u => u.majorId === 'cs'),
    careers: ['软件工程师', 'AI / 算法研究员', '数据科学家', '信息安全专家', '产品经理'],
    countries: ['英国', '美国', '加拿大', '中国香港', '新加坡'],
    grad: '名校背景 + 扎实项目：科技公司校招薪资高；牛津剑桥毕业生更偏向研究或量化金融方向。',
    hints: ['进阶数学对冲击牛剑、帝国理工至关重要', '参加计算机竞赛（如 Olympiad、Hackathon）可强化申请文书']
  },
  {
    id: 'math', name: '数学', en: 'Mathematics', category: 'STEM', cluster: 'math',
    icon: '∑',
    keywordIds: ['math', 'puzzles', 'logic', 'games', 'read'], clusterBonus: 4,
    required: ['数学'], helpful: ['进阶数学', '物理', '计算机'], avoid: [],
    alSupport: { '数学': 3, '进阶数学': 3, '物理': 1 },
    unis: (window.UNIVERSITY_CATALOG?.entries || []).filter(u => u.majorId === 'math'),
    careers: ['精算师', '金融量化分析师', '数学研究员', '数据分析师', '统计顾问'],
    countries: ['英国', '美国', '加拿大', '德国', '中国香港'],
    grad: '数学专业是金融、科技、科研的"万能底座"，名校数学毕业生在量化金融领域起薪极高。',
    hints: ['进阶数学几乎是申请顶尖数学系的标准配置', '按院校与申请年份核对 TMUA / STEP 等笔试要求，并结合成绩、面试与其他材料准备']
  },
  {
    id: 'phys', name: '物理学', en: 'Physics', category: 'STEM', cluster: 'physics',
    icon: '⚛️',
    keywordIds: ['science', 'physics', 'space', 'math', 'logic', 'experiment'], clusterBonus: 2,
    required: ['数学', '物理'], helpful: ['进阶数学', '化学'], avoid: [],
    alSupport: { '数学': 3, '物理': 3, '进阶数学': 1 },
    unis: (window.UNIVERSITY_CATALOG?.entries || []).filter(u => u.majorId === 'phys'),
    careers: ['科研人员', '半导体工程师', '航空航天工程师', '金融量化分析', '技术咨询'],
    countries: ['英国', '美国', '德国', '瑞士', '加拿大'],
    grad: '物理背景转科研、科技或金融量化都有优势，瑞士、德国的顶尖理工院校学费较低。',
    hints: ['物理 + 进阶数学是理科申请的黄金组合', '物理竞赛（BPhO）对申请有帮助']
  },
  {
    id: 'eng', name: '工程学', en: 'Engineering', category: 'STEM', cluster: 'physics',
    icon: '⚙️',
    keywordIds: ['build', 'science', 'physics', 'math', 'experiment', 'design'], clusterBonus: 2,
    required: ['数学', '物理'], helpful: ['进阶数学', '化学'], avoid: [],
    alSupport: { '数学': 3, '物理': 3, '进阶数学': 1 },
    unis: (window.UNIVERSITY_CATALOG?.entries || []).filter(u => u.majorId === 'eng'),
    careers: ['机械 / 电子工程师', '产品研发工程师', '结构工程师', '技术管理者'],
    countries: ['英国', '澳大利亚', '加拿大', '德国', '新加坡'],
    grad: '工程专业就业面广，是移民和就业都比较友好的方向；澳洲工程师协会认证学位可加分。',
    hints: ['数学 + 物理是硬门槛，化学方向（化工）需化学', '科研项目或工程竞赛可显著提升申请竞争力']
  },
  {
    id: 'chem', name: '化学 / 材料科学', en: 'Chemistry / Materials', category: 'STEM', cluster: 'chemistry',
    icon: '🧪',
    keywordIds: ['science', 'chemistry', 'experiment', 'lab', 'build', 'nature'], clusterBonus: 3,
    required: ['化学'], helpful: ['数学', '物理', '生物'], avoid: [],
    alSupport: { '化学': 3, '数学': 1, '物理': 1 },
    unis: (window.UNIVERSITY_CATALOG?.entries || []).filter(u => u.majorId === 'chem'),
    careers: ['化学研究员', '材料科学家', '制药研发', '环境化学专家'],
    countries: ['英国', '美国', '德国', '荷兰', '加拿大'],
    grad: '化学是医药、材料、新能源的基础；深造比例高，博士就业在科研与工业研发领域更稳。',
    hints: ['化学 A* 几乎是顶尖院校的隐性门槛', '喜欢动手实验可考虑材料科学与工程方向']
  },
  {
    id: 'med', name: '医学 / 健康科学', en: 'Medicine / Health Sciences', category: 'STEM', cluster: 'biology',
    icon: '🩺',
    keywordIds: ['health', 'biology', 'help', 'volunteer', 'science'], clusterBonus: 3,
    required: ['化学', '生物'], helpful: ['数学', '物理'], avoid: [],
    alSupport: { '化学': 3, '生物': 3, '数学': 1 },
    unis: (window.UNIVERSITY_CATALOG?.entries || []).filter(u => u.majorId === 'med'),
    careers: ['临床医生', '医学研究员', '公共卫生专家', '健康数据分析', '制药行业'],
    countries: ['英国', '澳大利亚', '中国香港', '加拿大'],
    grad: '医学竞争极其激烈，UCAT 成绩和面试往往是关键；健康科学方向的选择空间更大。',
    hints: ['化学 + 生物是最稳组合，很多医学院要求化学', '需尽早准备 UCAT 和临床志愿经历']
  },
  {
    id: 'bio', name: '生物学 / 生命科学', en: 'Biology / Life Sciences', category: 'STEM', cluster: 'biology',
    icon: '🧬',
    keywordIds: ['biology', 'nature', 'science', 'health', 'environment'], clusterBonus: 3,
    required: ['生物', '化学'], helpful: ['数学', '心理学'], avoid: [],
    alSupport: { '生物': 3, '化学': 2, '数学': 1 },
    unis: (window.UNIVERSITY_CATALOG?.entries || []).filter(u => u.majorId === 'bio'),
    careers: ['生物研究员', '生物技术工程师', '环境科学专家', '科学编辑 / 科普'],
    countries: ['英国', '美国', '荷兰', '澳大利亚', '加拿大'],
    grad: '生命科学在生物科技、环保、合成生物学领域发展迅速，硕士以上学历更普遍。',
    hints: ['化学与生物是生命科学的核心基础', '科研经历（实验室学徒、竞赛）比分数更关键']
  },
  {
    id: 'econ', name: '经济学', en: 'Economics', category: 'SOCIAL', cluster: 'social',
    icon: '📈',
    keywordIds: ['business', 'news', 'math', 'puzzles', 'deal', 'logic'], clusterBonus: 2,
    required: ['数学'], helpful: ['经济学', '进阶数学', '历史'], avoid: [],
    alSupport: { '数学': 3, '进阶数学': 2, '经济学': 1 },
    unis: (window.UNIVERSITY_CATALOG?.entries || []).filter(u => u.majorId === 'econ'),
    careers: ['投资银行分析师', '经济研究员', '咨询顾问', '政策分析师', '资产管理'],
    countries: ['英国', '美国', '中国香港', '新加坡', '加拿大'],
    grad: '经济学是通往金融与咨询行业的高薪专业，数学能力强的申请者在顶尖项目中优势明显。',
    hints: ['数学是刚需，LSE / 牛剑对数学分数要求很高', '阅读经济学人、参与模拟经济竞赛能强化文书']
  },
  {
    id: 'biz', name: '商科 / 管理', en: 'Business / Management', category: 'SOCIAL', cluster: 'social',
    icon: '💼',
    keywordIds: ['business', 'talk', 'lead', 'organize', 'deal'], clusterBonus: 4,
    required: ['数学'], helpful: ['经济学', '商科', '心理学'], avoid: [],
    alSupport: { '数学': 2, '经济学': 3, '商科': 1 },
    unis: (window.UNIVERSITY_CATALOG?.entries || []).filter(u => u.majorId === 'biz'),
    careers: ['咨询顾问', '市场 / 品牌管理者', '创业者', '人力资源', '供应链管理者'],
    countries: ['英国', '美国', '加拿大', '新加坡', '荷兰'],
    grad: '管理类就业面广，但顶尖商学院更看重学校平台与实习经历，建议配合数据分析能力。',
    hints: ['商科 A-Level 在顶尖商学院认可度有限，数学 + 经济学更稳妥', '尽早积累实习与社团领导经历']
  },
  {
    id: 'law', name: '法律', en: 'Law', category: 'HUMANITIES', cluster: 'humanities',
    icon: '⚖️',
    keywordIds: ['read', 'talk', 'news', 'debate', 'history'], clusterBonus: 4,
    required: ['历史', '英语文学'], helpful: ['经济学', '心理学'], avoid: [],
    alSupport: { '历史': 1, '英语文学': 2, '经济学': 1 },
    unis: (window.UNIVERSITY_CATALOG?.entries || []).filter(u => u.majorId === 'law'),
    careers: ['律师 / 法务顾问', '法官 / 检察官', '合规与风控专家', '政策研究员'],
    countries: ['英国', '中国香港', '美国', '澳大利亚'],
    grad: '英美法系学习路径差异大，英国 LLB 三年制可衔接香港、新加坡执业；文书与面试是决定性的。',
    hints: ['历史或英语文学几乎是所有顶尖法学院的"预期科目"', '辩论与写作训练极其重要']
  },
  {
    id: 'psych', name: '心理学', en: 'Psychology', category: 'SOCIAL', cluster: 'social',
    icon: '🧠',
    keywordIds: ['people', 'psych', 'help', 'biology', 'science'], clusterBonus: 3,
    required: ['心理学', '生物'], helpful: ['数学', '化学'], avoid: [],
    alSupport: { '心理学': 3, '生物': 2, '数学': 1 },
    unis: (window.UNIVERSITY_CATALOG?.entries || []).filter(u => u.majorId === 'psych'),
    careers: ['心理咨询师', '用户研究员', '人力资源管理', '行为数据分析师', '临床心理学家'],
    countries: ['英国', '美国', '加拿大', '澳大利亚'],
    grad: '心理学和神经科学交叉密切，近年与 AI、用户研究结合很紧密，就业面不断扩展。',
    hints: ['越来越多院校要求生物或数学，不要只选心理', '研究方法与统计是关键课程']
  },
  {
    id: 'design', name: '设计 / 建筑 / 艺术', en: 'Design / Architecture / Art', category: 'CREATIVE', cluster: 'creative',
    icon: '🎨',
    keywordIds: ['art', 'design', 'build', 'create', 'photo'], clusterBonus: 4,
    required: ['艺术', '数学'], helpful: ['物理', '设计'], avoid: [],
    alSupport: { '艺术': 3, '设计': 3, '数学': 1 },
    unis: (window.UNIVERSITY_CATALOG?.entries || []).filter(u => u.majorId === 'design'),
    careers: ['建筑师', 'UI / UX 设计师', '品牌设计师', '创意总监', '策展人'],
    countries: ['英国', '美国', '荷兰', '意大利', '日本'],
    grad: '设计领域作品集与学校平台同等重要；建筑需要长学制与极强的空间与数学能力。',
    hints: ['建筑专业通常需要数学或物理再加艺术', '作品集需要提前一年系统准备']
  },
  {
    id: 'media', name: '传媒 / 新闻', en: 'Media / Journalism', category: 'HUMANITIES', cluster: 'humanities',
    icon: '📰',
    keywordIds: ['news', 'talk', 'art', 'create', 'people', 'read'], clusterBonus: 4,
    required: ['英语文学'], helpful: ['历史', '社会学', '设计'], avoid: [],
    alSupport: { '英语文学': 3, '历史': 1, '设计': 1 },
    unis: (window.UNIVERSITY_CATALOG?.entries || []).filter(u => u.majorId === 'media'),
    careers: ['记者 / 编辑', '品牌公关', '内容创作者', '新媒体运营', '纪录片制作'],
    countries: ['英国', '美国', '中国香港', '澳大利亚'],
    grad: '传媒行业更看重实际作品与实习，院校平台影响初期机会，国际媒体方向对英文写作要求高。',
    hints: ['英语文学是最常见的推荐科目', '尽早积累作品（校刊、博客、短片）']
  },
  {
    id: 'intl', name: '国际关系 / 政治学', en: 'International Relations / Politics', category: 'HUMANITIES', cluster: 'humanities',
    icon: '🌍',
    keywordIds: ['news', 'history', 'debate', 'talk', 'people'], clusterBonus: 4,
    required: ['历史', '英语文学'], helpful: ['经济学', '社会学'], avoid: [],
    alSupport: { '历史': 3, '英语文学': 2, '经济学': 1 },
    unis: (window.UNIVERSITY_CATALOG?.entries || []).filter(u => u.majorId === 'intl'),
    careers: ['外交官 / 国际组织职员', '政策分析师', '智库研究员', '国际新闻记者'],
    countries: ['英国', '美国', '瑞士', '荷兰', '中国香港'],
    grad: '国际关系高度依赖语言与写作能力，研究生阶段与国际组织实习对就业至关重要。',
    hints: ['历史与英语文学是核心基础', '关注时事、参与模联与辩论赛']
  }
];

/* 本科专业选项 → 影响推荐 */
window.INTEREST_OPTIONS = [
  { id: 'science', label: '自然科学', desc: '物理 / 化学 / 生物', major: 'phys' },
  { id: 'math', label: '数学', desc: '纯数学 / 应用数学 / 统计', major: 'math' },
  { id: 'eng', label: '工程', desc: '机械 / 电子 / 土木', major: 'eng' },
  { id: 'tech', label: '计算机与人工智能', desc: '软件 / 算法 / AI', major: 'cs' },
  { id: 'business', label: '商科与管理', desc: '会计 / 金融 / 管理', major: 'biz' },
  { id: 'econ', label: '经济与金融', desc: '经济学 / 金融', major: 'econ' },
  { id: 'med', label: '医学与健康', desc: '临床 / 药学 / 公卫', major: 'med' },
  { id: 'social', label: '社会科学', desc: '心理 / 社会学 / 政治', major: 'psych' },
  { id: 'humanities', label: '人文与法律', desc: '法律 / 历史 / 文学', major: 'law' },
  { id: 'art', label: '艺术与设计', desc: '设计 / 建筑 / 艺术史', major: 'design' },
  { id: 'media', label: '传媒', desc: '新闻 / 传播 / 影视', major: 'media' },
  { id: 'unsure', label: '还不确定', desc: '希望系统帮我想一想', major: null }
];

/* A-Level 可学科目列表 */
window.ALEVEL_SUBJECTS = [
  '数学', '进阶数学', '物理', '化学', '生物', '经济学', '商科', '计算机', '心理学',
  '英语文学', '历史', '地理', '社会学', '艺术', '设计', '音乐', '戏剧', '中文', '法语', '西班牙语'
];

/* 兴趣爱好池 */
window.INTEREST_POOL = [
  { id: 'coding',    label: '编程与科技',    icon: '💻', clusters: ['math'] },
  { id: 'math',      label: '数学推理',      icon: '🔢', clusters: ['math'] },
  { id: 'puzzles',   label: '解谜与逻辑',    icon: '🧩', clusters: ['math', 'social'] },
  { id: 'logic',     label: '逻辑与辩论',    icon: '🗣️', clusters: ['math', 'social'] },
  { id: 'physics',   label: '物理探索',      icon: '🌌', clusters: ['physics'] },
  { id: 'space',     label: '天文与太空',    icon: '🔭', clusters: ['physics'] },
  { id: 'experiment',label: '动手实验',      icon: '⚗️', clusters: ['physics', 'chemistry'] },
  { id: 'science',   label: '科学求知',      icon: '🔬', clusters: ['physics', 'chemistry', 'biology'] },
  { id: 'chemistry', label: '化学探究',      icon: '🧪', clusters: ['chemistry'] },
  { id: 'biology',   label: '生命与自然',    icon: '🌿', clusters: ['biology'] },
  { id: 'health',    label: '健康与医疗',    icon: '💊', clusters: ['biology', 'social'] },
  { id: 'help',      label: '帮助他人',      icon: '🤝', clusters: ['biology', 'social', 'humanities'] },
  { id: 'people',    label: '与人交流',      icon: '🗨️', clusters: ['social', 'creative', 'humanities'] },
  { id: 'psych',     label: '人文心理',      icon: '🧠', clusters: ['social'] },
  { id: 'business',  label: '商业与投资',    icon: '💹', clusters: ['social'] },
  { id: 'news',      label: '时事与新闻',    icon: '📰', clusters: ['social', 'humanities'] },
  { id: 'deal',      label: '谈判与说服',    icon: '🤝', clusters: ['social'] },
  { id: 'lead',      label: '领导与组织',    icon: '🎯', clusters: ['social'] },
  { id: 'history',   label: '历史与文化',    icon: '🏛️', clusters: ['humanities'] },
  { id: 'read',      label: '阅读与写作',    icon: '📚', clusters: ['humanities', 'creative'] },
  { id: 'debate',    label: '演讲与辩论',    icon: '🎤', clusters: ['humanities', 'social'] },
  { id: 'art',       label: '绘画与视觉艺术',icon: '🖌️', clusters: ['creative', 'humanities'] },
  { id: 'design',    label: '设计与创意',    icon: '📐', clusters: ['creative', 'humanities'] },
  { id: 'photo',     label: '摄影与影像',    icon: '📷', clusters: ['creative'] },
  { id: 'create',    label: '动手创作',      icon: '🛠️', clusters: ['creative', 'physics'] },
  { id: 'build',     label: '模型与建造',    icon: '🏗️', clusters: ['physics', 'chemistry', 'creative'] },
  { id: 'volunteer', label: '志愿服务',      icon: '❤️', clusters: ['biology', 'social', 'humanities'] },
  { id: 'economy',   label: '经济与社会',    icon: '🏦', clusters: ['social', 'humanities'] },
  { id: 'environment',label: '环境保护',     icon: '🌍', clusters: ['biology', 'chemistry', 'physics'] },
  { id: 'talk',      label: '沟通与表达',    icon: '💬', clusters: ['humanities', 'social', 'creative'] }
];

window.CAREER_PATHS = [
  { id: 'researcher', label: '科研 / 学术研究', desc: '读博进入高校或研究所，做长期的基础或应用研究', majorIds: ['phys', 'math', 'cs', 'bio', 'chem'] },
  { id: 'tech', label: '科技行业', desc: '互联网、AI、半导体等，强调技术深度与工程能力', majorIds: ['cs', 'eng', 'math', 'phys'] },
  { id: 'finance', label: '金融与投行', desc: '投行、量化、资产管理，追求高竞争与高回报', majorIds: ['econ', 'math', 'biz', 'cs'] },
  { id: 'medicine', label: '医疗与健康', desc: '临床或其他医疗相关职业，重视长期稳定的专业训练', majorIds: ['med', 'bio'] },
  { id: 'law', label: '法律与公共服务', desc: '律师、政策制定、国际事务', majorIds: ['law', 'intl'] },
  { id: 'creative', label: '创意设计行业', desc: '设计、传媒、建筑等创意领域', majorIds: ['design', 'media'] },
  { id: 'entrepreneur', label: '创业者 / 管理者', desc: '自己创立公司或在企业中承担管理责任', majorIds: ['biz', 'econ', 'cs'] },
  { id: 'unsure', label: '还不确定', desc: '希望系统多维评估后给出方向', majorIds: [] }
];

window.COUNTRY_OPTIONS = [
  { id: 'uk',     label: '英国',     note: 'A-Level 体系的主场，三年制本科，认可度最高' },
  { id: 'us',     label: '美国',     note: '需 SAT / AP 等补充材料，四年制，灵活度高' },
  { id: 'ca',     label: '加拿大',   note: '接受 A-Level，学费相对适中，移民政策友好' },
  { id: 'au',     label: '澳大利亚', note: '接受 A-Level 换算，认可 ATA 工程师认证' },
  { id: 'hk',     label: '中国香港', note: '英联邦体系认可 A-Level，离家近、文化接近' },
  { id: 'sg',     label: '新加坡',   note: 'NUS / NTU 世界排名高，认可 A-Level' },
  { id: 'eu',     label: '欧洲大陆', note: '德国、荷兰等学费低，部分专业需语言要求' },
  { id: 'unsure', label: '还没想好', note: '系统将结合专业方向给出建议' }
];
