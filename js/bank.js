/* ============================================================
 * 题库（学术能力测试）
 *  - 英语：不提供中文翻译（测试英语能力本身）
 *  - 数学 / 物理 / 化学：每题均提供中文翻译
 * 评分方式：choice = 选择正确选项；numeric = 数值在容差内即得分
 * 每题 1 分，便于各科按百分比标准化比较
 * ============================================================ */
window.QUESTION_BANK = [
  /* ---------------- 英语 English (10) ---------------- */
  { id: 'en1', subject: 'english', type: 'choice', topic: 'Vocabulary 词汇',
    prompt: 'Choose the word closest in meaning to "diligent".',
    options: ['Lazy', 'Hard-working', 'Careless', 'Lucky'], answer: 1,
    explain: '"Diligent" describes someone who works carefully and persistently — i.e. hard-working. 勤奋的。' },

  { id: 'en2', subject: 'english', type: 'choice', topic: 'Grammar 语法',
    prompt: 'If I ___ more time, I would have finished the project.',
    options: ['have', 'had had', 'will have', 'would have'], answer: 1,
    explain: 'Third conditional: "If + had + past participle, … would have + past participle." 第三条件句。' },

  { id: 'en3', subject: 'english', type: 'choice', topic: 'Grammar 语法',
    prompt: 'Neither the teacher nor the students ___ aware of the change in schedule.',
    options: ['was', 'were', 'is', 'has been'], answer: 1,
    explain: 'With "neither … nor", the verb agrees with the nearer subject — "students" is plural, so "were". 就近一致原则。' },

  { id: 'en4', subject: 'english', type: 'choice', topic: 'Reading 阅读',
    prompt: 'Passage: "Although the experiment yielded promising results, the researchers cautioned that the sample size was too small to draw firm conclusions."\n\nWhat does the passage suggest?',
    options: [
      'The results were meaningless.',
      'The researchers are confident in the results.',
      'The results are encouraging but need further validation.',
      'The experiment failed.'], answer: 2,
    explain: '"Promising" signals encouragement; "cautioned that the sample size was too small" signals the need to verify. 结果令人鼓舞，但样本太小，需要进一步验证。' },

  { id: 'en5', subject: 'english', type: 'choice', topic: 'Reading 阅读',
    prompt: 'Passage: "Cities are increasingly turning to green roofs as a way to reduce urban heat, manage stormwater, and improve biodiversity."\n\nWhich benefit is NOT mentioned?',
    options: ['Reducing urban heat', 'Managing stormwater', 'Lowering property taxes', 'Improving biodiversity'], answer: 2,
    explain: 'Property taxes are not mentioned at all in the passage. 房产税未在文段中提及。' },

  { id: 'en6', subject: 'english', type: 'choice', topic: 'Logic 逻辑',
    prompt: 'All engineers are problem-solvers. Some problem-solvers are artists. Which conclusion MUST be true?',
    options: [
      'All problem-solvers are engineers.',
      'Some engineers are artists.',
      'No engineers are artists.',
      'None of the above must be true.'], answer: 3,
    explain: 'The "some problem-solvers are artists" group may or may not overlap with engineers — nothing is guaranteed. 无法必然推出。' },

  { id: 'en7', subject: 'english', type: 'choice', topic: 'Vocabulary 词汇',
    prompt: 'The word "ubiquitous" most nearly means:',
    options: ['Rare', 'Found everywhere', 'Ancient', 'Dangerous'], answer: 1,
    explain: '"Ubiquitous" = present or found everywhere. 无处不在的。' },

  { id: 'en8', subject: 'english', type: 'choice', topic: 'Grammar 语法',
    prompt: 'Having finished her homework, ___.',
    options: [
      'the TV was turned on by Maria',
      'Maria turned on the TV',
      'it was time for TV',
      'the TV was on'], answer: 1,
    explain: 'The participle clause refers to the main clause subject, which must be Maria. 分词从句的逻辑主语须为主句主语。' },

  { id: 'en9', subject: 'english', type: 'choice', topic: 'Academic English 学术写作',
    prompt: 'Which sentence uses the most academic register?',
    options: [
      'Loads of people think this is a big deal.',
      'This study suggests that the trend may be significant.',
      'Everyone knows this is super important.',
      'It is obviously a huge thing.'], answer: 1,
    explain: 'Hedged verbs ("suggests", "may") and formal vocabulary are hallmarks of academic English. 学术写作常用委婉限定词。' },

  { id: 'en10', subject: 'english', type: 'choice', topic: 'Reading 阅读',
    prompt: 'In A-Level exam questions, the command word "evaluate" requires you to:',
    options: [
      'List facts from memory',
      'Judge the strengths and weaknesses and reach a conclusion',
      'Describe a process step by step',
      'Compare two items only'], answer: 1,
    explain: '"Evaluate" = weigh evidence both ways, then form a supported judgement. A-Level 命令词训练是提分关键。' },

  /* ---------------- 数学 Mathematics (10) ---------------- */
  { id: 'ma1', subject: 'maths', type: 'choice', topic: '代数 Algebra',
    prompt: 'Solve for x:  3x + 7 = 22',
    zh: '解方程：3x + 7 = 22',
    options: ['3', '5', '7', '15'], answer: 1,
    explain: '3x = 15 → x = 5. 移项得 3x = 15，故 x = 5。' },

  { id: 'ma2', subject: 'maths', type: 'choice', topic: '代数 Algebra',
    prompt: 'Expand: (x + 3)(x − 5)',
    zh: '展开：(x + 3)(x − 5)',
    options: ['x² − 2x − 15', 'x² + 2x − 15', 'x² − 8x − 15', 'x² − 2x + 15'], answer: 0,
    explain: 'x² − 5x + 3x − 15 = x² − 2x − 15. 逐项相乘后合并同类项。' },

  { id: 'ma3', subject: 'maths', type: 'choice', topic: '函数 Functions',
    prompt: 'What is the gradient of the line 4y − 2x = 8?',
    zh: '直线 4y − 2x = 8 的斜率是多少？',
    options: ['−2', '½', '2', '4'], answer: 1,
    explain: 'Rearrange to y = ½x + 2, so gradient = ½. 整理为 y = ½x + 2，斜率即 x 的系数。' },

  { id: 'ma4', subject: 'maths', type: 'choice', topic: '三角函数 Trigonometry',
    prompt: 'sin 30° × cos 60° = ?',
    zh: '计算：sin 30° × cos 60° = ?',
    options: ['0', '¼', '½', '1'], answer: 1,
    explain: 'sin 30° = cos 60° = ½, so the product is ¼. 两者均为 ½，乘积为 ¼。' },

  { id: 'ma5', subject: 'maths', type: 'choice', topic: '数列 Sequences',
    prompt: 'Find the 10th term of the arithmetic sequence 3, 7, 11, …',
    zh: '等差数列 3, 7, 11, … 的第 10 项是多少？',
    options: ['37', '39', '41', '43'], answer: 1,
    explain: 'aₙ = a + (n−1)d = 3 + 9×4 = 39. 通项公式 aₙ = a + (n−1)d。' },

  { id: 'ma6', subject: 'maths', type: 'choice', topic: '概率 Probability',
    prompt: 'A fair six-sided die is rolled twice. What is P(two sixes)?',
    zh: '连续投掷一枚均匀六面骰子两次，两次都是 6 的概率是多少？',
    options: ['1/6', '1/12', '1/36', '1/3'], answer: 2,
    explain: 'Independent events: 1/6 × 1/6 = 1/36. 独立事件概率相乘。' },

  { id: 'ma7', subject: 'maths', type: 'choice', topic: '微积分 Calculus',
    prompt: 'What is the derivative of f(x) = 3x² − 4x + 1?',
    zh: '函数 f(x) = 3x² − 4x + 1 的导数是什么？',
    options: ['6x − 4', '3x − 4', '6x + 1', '6x² − 4'], answer: 0,
    explain: 'Multiply by the power, reduce the power by one: 6x − 4. 幂函数求导法则。' },

  { id: 'ma8', subject: 'maths', type: 'numeric', topic: '对数 Logarithms',
    prompt: 'Evaluate log₂ 32.',
    zh: '计算 log₂ 32 的值。',
    answer: 5, tol: 0.01,
    explain: 'log₂ 32 = 5 because 2⁵ = 32. 求 2 的几次方等于 32。' },

  { id: 'ma9', subject: 'maths', type: 'choice', topic: '方程 Equations',
    prompt: 'How many real roots does x² − 6x + 5 = 0 have?',
    zh: '方程 x² − 6x + 5 = 0 有几个实数根？',
    options: ['0', '1', '2', 'Infinitely many'], answer: 2,
    explain: 'Discriminant b² − 4ac = 36 − 20 = 16 > 0, so two real roots. 判别式大于 0，有两个不等实根。' },

  { id: 'ma10', subject: 'maths', type: 'choice', topic: '向量 Vectors',
    prompt: 'If vector a = (3, 4), what is |a|?',
    zh: '若向量 a = (3, 4)，则 |a| 等于多少？',
    options: ['5', '7', '12', '25'], answer: 0,
    explain: '|a| = √(3² + 4²) = 5. 向量长度的计算公式。' },

  /* ---------------- 物理 Physics (5) ---------------- */
  { id: 'ph1', subject: 'physics', type: 'choice', topic: '力学 Mechanics',
    prompt: 'A car accelerates uniformly from rest to 20 m/s in 4 s. What is its acceleration?',
    zh: '一辆汽车从静止开始匀加速，4 秒内速度达到 20 m/s，求加速度。',
    options: ['2 m/s²', '4 m/s²', '5 m/s²', '80 m/s²'], answer: 2,
    explain: 'a = Δv / t = 20 / 4 = 5 m/s². 加速度 = 速度变化量 ÷ 时间。' },

  { id: 'ph2', subject: 'physics', type: 'choice', topic: '力学 Mechanics',
    prompt: 'A 2 kg object is pushed with a net force of 10 N. What is its acceleration?',
    zh: '一个 2 kg 的物体受到 10 N 的合外力，求其加速度。',
    options: ['0.2 m/s²', '5 m/s²', '8 m/s²', '20 m/s²'], answer: 1,
    explain: 'F = ma → a = 10 / 2 = 5 m/s². 牛顿第二定律。' },

  { id: 'ph3', subject: 'physics', type: 'choice', topic: '能量 Energy',
    prompt: 'A 2 kg ball is lifted 5 m. Take g = 10 m/s². How much GPE does it gain?',
    zh: '一个 2 kg 的小球被抬高 5 m，取 g = 10 m/s²，重力势能增加多少？',
    options: ['10 J', '25 J', '50 J', '100 J'], answer: 2,
    explain: 'GPE = mgh = 2 × 10 × 5 = 100 J. 重力势能公式 mgh。' },

  { id: 'ph4', subject: 'physics', type: 'choice', topic: '电路 Electricity',
    prompt: 'A 12 V battery is connected across a 6 Ω resistor. What is the current?',
    zh: '一个 12 V 的电池连接在 6 Ω 的电阻两端，通过电阻的电流是多少？',
    options: ['0.5 A', '2 A', '6 A', '72 A'], answer: 1,
    explain: 'I = V / R = 12 / 6 = 2 A. 欧姆定律。' },

  { id: 'ph5', subject: 'physics', type: 'choice', topic: '原子物理 Atomic Physics',
    prompt: 'In radioactive decay, which particle has a charge of −1?',
    zh: '在放射性衰变中，哪种粒子带 −1 的电荷？',
    options: ['Alpha particle α', 'Beta particle β', 'Gamma ray γ', 'Neutron'], answer: 1,
    explain: 'Beta particles (electrons) carry −1 charge; alpha +2, gamma and neutron 0. β 粒子即电子，带负电。' },

  /* ---------------- 化学 Chemistry (5) ---------------- */
  { id: 'ch1', subject: 'chemistry', type: 'choice', topic: '物质的量 Amount of substance',
    prompt: 'How many moles are there in 36 g of water (H₂O)? (Mr = 18)',
    zh: '36 g 水（H₂O）中含有多少摩尔？（相对分子质量 Mr = 18）',
    options: ['0.5 mol', '1 mol', '2 mol', '18 mol'], answer: 2,
    explain: 'n = m / Mr = 36 / 18 = 2 mol. 物质的量 = 质量 ÷ 摩尔质量。' },

  { id: 'ch2', subject: 'chemistry', type: 'choice', topic: '化学式 Formulae',
    prompt: 'What is the empirical formula of a compound containing 40% C, 6.7% H, 53.3% O by mass?',
    zh: '某化合物质量组成为 40% C、6.7% H、53.3% O，求其实验式。',
    options: ['CHO', 'C₂H₄O', 'CH₂O', 'C₃H₆O₃'], answer: 2,
    explain: 'Mole ratio = 40/12 : 6.7/1 : 53.3/16 = 3.33 : 6.7 : 3.33 → 1 : 2 : 1 = CH₂O. 换算物质的量比后化简。' },

  { id: 'ch3', subject: 'chemistry', type: 'choice', topic: '酸碱 Acid-base',
    prompt: 'What is the pH of a solution with [H⁺] = 1 × 10⁻³ mol dm⁻³?',
    zh: '某溶液的氢离子浓度 [H⁺] = 1 × 10⁻³ mol dm⁻³，其 pH 是多少？',
    options: ['2', '3', '7', '11'], answer: 1,
    explain: 'pH = −log₁₀[H⁺] = 3. pH 的定义式。' },

  { id: 'ch4', subject: 'chemistry', type: 'choice', topic: '化学反应 Reaction types',
    prompt: 'Which type of reaction is CH₃CH₂OH → CH₂=CH₂ + H₂O?',
    zh: 'CH₃CH₂OH → CH₂=CH₂ + H₂O 属于哪一类反应？',
    options: ['Addition', 'Elimination', 'Substitution', 'Reduction'], answer: 1,
    explain: 'Water is removed and a double bond forms — dehydration is an elimination. 脱去小分子形成双键，属消去反应。' },

  { id: 'ch5', subject: 'chemistry', type: 'choice', topic: '电子结构 Electronic structure',
    prompt: 'What is the ground-state electron configuration of a chlorine atom (Atomic number 17)?',
    zh: '氯原子（原子序数 17）的基态电子排布是什么？',
    options: ['1s² 2s² 2p⁶ 3s² 3p⁵', '1s² 2s² 2p⁶ 3s² 3p⁶', '1s² 2s² 2p⁷ 3s² 3p⁴', '1s² 2s² 2p⁶ 3s² 3p⁴ 3d¹'], answer: 0,
    explain: '17 electrons: 2+2+6+2+5 = 17. 电子按能量层级依次填充，3p 层有 5 个电子。' }
];

/* 学科元信息 */
window.SUBJECT_META = {
  english:   { name: '英语', nameEn: 'English', icon: '📖' },
  maths:     { name: '数学', nameEn: 'Mathematics', icon: '📐' },
  physics:   { name: '物理', nameEn: 'Physics', icon: '⚛️' },
  chemistry: { name: '化学', nameEn: 'Chemistry', icon: '🧪' }
};

/* A-Level 能力等级：百分比 → 建议等级区间（入学时的起点定位，并非最终预测） */
window.ALEVEL_BANDS = [
  { min: 90, label: 'A* 潜力', desc: '基础非常扎实，可直接进入 A-Level 进阶内容，冲击 A*。' },
  { min: 75, label: 'A 潜力',  desc: '基础扎实，跟进正常，注意 A-Level 题型与学术英语的转化。' },
  { min: 60, label: 'B–A',     desc: '基础尚可，需在开学前补齐部分衔接知识（如函数、代数变形）。' },
  { min: 40, label: 'C–B',     desc: '基础薄弱点较明显，建议开学前进行 4–6 周衔接训练。' },
  { min: 0,  label: '需重点补强', desc: '基础缺口较大，建议进行系统预习与一对一辅导，否则初期会明显吃力。' }
];
