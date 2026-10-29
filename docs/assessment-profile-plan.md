# 旧档案与测评版本隔离方案（2026-10-25）

本阶段只恢复旧档案/续答的原义与数据保留，保留owner新增游戏/30特质功能。不同时适配新云归档/新分享/新统计。不改schema5/API2或旧摘要v1/v2/v3；不把旧24数字按位置解释为新特质。

## profile合同

新增无DOM/存储/网络副作用的`window.AssessmentProfiles`：`LEGACY='legacy-2026.10'`、`CURRENT='games-traits-v1'`。`stateProfile(state)`、`recordProfile(record)`、`reportProfile(report)`返回这两个字符串或抛带code='PROFILE'的安全错误；`requireRecord(record)`在新/未知/混合资料时明确拒绝。

运行中/续答state可带`assessmentProfile`，新blank必须CURRENT。新归档在record顶层带`assessmentProfile:CURRENT`，归档state仍原info/academic/plan/mbti四键；新备份容器version2，可混合原旧record。纯旧record/备份继续version1、不增marker。读旧record须严格校验但返回原字段和值，不补空数组/改grade/null/排序；保存为新归档才按当前界面明确输入产生新记录。导出和导入只改变外层exportedAt，不悄改原record。

运行态只续答`CURRENT`：旧版、混合或无法识别的进度在`load()`处即停止（`saveLocked`），不续答、不自动改写原始字节，页面只保留原始JSON下载与「重新测试」。打开网址一律停在首页，续答只经首页入口。账号面板只读打开的记录保留当前`ui`、不写本机续答进度（`persist:false`）；打开记录前取消待写入的计时器，避免旧作答在打开后被写回。本机存档白名单含`report`/`reportMeta`/`advisor`等结果键；打开本机归档若替换未核对的续答，先确认（可从报告库找回）。新record缺标记的已发行v1形状可在读取时辨认并保留，后续保存才明确写CURRENT+version2；version1导入不能把带CURRENT标记的新资料伪装旧合同。

无标记识别：≤24个数字/null和旧专属规划字段按LEGACY；对象型答案/长度30或新game字段按CURRENT；空且无证据默认LEGACY以保护旧空白档案。显式marker须与实际形状相容，未知marker/数字与对象混合/标记legacy但带新game等拒绝。`mbti.legacy:true`已被旧发布版按位置转换过的数据须保留原始资料并隔离，不能假装可恢复原问卷或继续输出新特质结论。对象30与旧字段矛盾时不静默丢字段。profile识别不代替完整记录校验。

## 原引擎与展示

从Git a10d557固定保存旧plan/report/report-view/report-store源码到`js/legacy/`，带来源/规范LF SHA256清单；工具`backend/tools/legacy-assessment.cjs`生成隔离IIFE的`js/legacy-assessment.js`，不在浏览器eval源码，不覆盖当前PLAN/TRAIT/GAME globals。公开`LegacyAssessment`提供旧questions/config、generateReport/renderReport、createStore(storage)、validateRecord(record)等必要接口。旧渲染/建议按旧引擎，当前游戏/特质继续当前引擎。原学术题库及当前院校目录可共享，不能认证历史规则/人工审校。

现代generateReport/renderReport按profile分派，输出meta.assessmentProfile供渲染识别；旧record本身不增加字段、不改变编号/日期/版本/advisor history/actor。报告显示旧版24题标识，不把MBTI叫新特质。renderer使用原旧renderer，所有用户文字继续转义。保留旧完整/草稿、中立、计分和规划含义，与Git旧引擎虚构样本逐项对照。

## ReportStore

在现有100份/2M UTF16/history200/冲突/损坏库停止写入边界内，version1兼容旧和已发行的无标记新形状；version2支持明确CURRENT和旧record混合，额外字段仍拒绝。旧用封存validator校验而返回原record clone；新沿用当前严格game/trait校验并拒绝未知/重复/不合法对象。不用“过滤后合法”的方式悄丢数据。

restore保留state原答案（不把24补30），按profile生成并恢复原batch/date和advisor，运行时state可添加profile marker。save/CSV须按profile，不用新特质列解释旧类型；CSV列或新字段若扩展须明确版本，不能悄改旧导出。本阶段可对混合/新profile的旧CSV明确拒绝并提示使用JSON。

## app续答与载入

load在任何setScreen/save/flush之前识别profile，去掉按位置包装旧数字的逻辑。合法旧进度原样保存在内存，原localStorage自动写入默认锁住，显示“已识别旧版进度”，可下载原始JSON、明确确认继续旧版并允许本机保存；确认前pagehide/beforeunload/自动save不得改变原字节。当前新无标记资料也先保护原始值，未知/混合/损坏资料只提供原始导出和明确重测，不静默覆盖。无法读取存储时保持本次新测评可用。

旧模式的规划题/24数字量表使用旧questions/scale，继续作答按旧含义；新测评blank使用CURRENT。旧报告、归档或云报告openState设置相应运行时profile，不能自动把旧state放进当前game/trait控件。新增明确“开始新版”需确认先归档/导出，不能混合问卷；旧动作按钮标签和报告分母准确，375px可用。

## 范围/分工/验证

引擎组：profile模块、封存源/生成器、legacy封装、report/report-view分派、对应纯测试；存储组：report-store及双版本/原样往返/actor/限额测试；应用组：app、index和teacher/advisor-edit必要脚本依赖、保护横幅/旧量表及浏览器测试；root：云/分享/建议/统计/成绩配对profile拒绝、模块加载测试、文档/真实集成/完整回归/交付/PR台账。

先TDD red再实现，至少旧空白/部分/完整/中立/自由科目/顾问history/actor、新game/trait、未知/混合/已标legacy转换、0/null、原始localStorage首次打开/离开/确认前后、备份v1/v2混合/容量/失败回滚、独立portal旧档案读取、新profile未支持接口拒绝。独立复核，再跑适当完整回归；仍失败如实记录，不删除测试或放松旧合同凑绿。所有虚构文件与临时数据D盘，不触真实学生浏览器或公司库。
