# 本地后续成绩配对与描述复核 Implementation Plan

> 用户已授权逐轮自行实施。子任务先RED后实现，独立审查后统一回归/交付；不重复索要设计批准。真实资料缺失不阻止虚构夹具验证工具。

**Goal:** 用户主动导入单科校内百分制结果、选择本机报告并手工配对/声明基线日期，检查缺失与时间顺序，预览确认导出必要聚合，供校准准备。

**Architecture:** 新增独立纯引擎与UI，挂在本机报告库；不扩展现有统计v1/v2、不新增后端/网络/依赖/持久存储、不改报告/成绩/阈值。配对编号和逐条成绩仅存在本机内存，离开清除。

**Tech Stack:** 原生浏览器JS、Node测试、Chromium、现有ReportStore/gradeAcademic。

## 固定引擎契约

- `window.OutcomeReview.parse(text)`：严格JSON字符串，最多100000 UTF-16码元；返回新JSON对象。顶层仅`format:'bic-followup-results',version:1,subject,scale:'school_percent_0_100',examDate,bankVersion,source,outcomes`，所有键必需，未知拒绝。
- subject只english/maths/physics/chemistry；source只synthetic/unverified_real；bankVersion须与当前已知QUESTION_BANK_META.version完全相同。examDate严格ISO YYYY-MM-DD真实日历日期，不得晚于浏览器本地日历的今天；不依赖UTC日界，也不从报告日期推断。
- outcomes为1–100项，每项仅`{studyId,score}`。studyId唯一、区分大小写、`[A-Za-z0-9][A-Za-z0-9_-]{0,39}`；score为有限number 0–100或null，拒绝布尔/数字字符串。null与0分不同，未知字段/重复/非法日期/非有限/损坏JSON整批拒绝，不丢行。
- `OutcomeReview.analyze(records,manifest,bindings)`：records是用户明确选中的10–100份归档，整批在内存ReportStore严格校验/容量/重复。只需当前题库与目标科目完整，不要求规划/人格完成或当前院校目录。manifest重新严格校验，不信任parse先调用。
- bindings数组0–100项，每项仅`{studyId,reportId,baselineDate}`。两ID必须分别属于manifest与已选records，每个studyId/报告至多绑定一次；baselineDate严格真实ISO日历且baselineDate<examDate。不得用createdAt/updatedAt/reportMeta.date推测日期。未知/重复/时间倒置/目标科未完成/旧题库整批拒绝，无姓名自动匹配。
- 统计分解：R=所选报告数，O=导入结果行数，V=已配对且score非null，M=已配对且score=null，UR=R-V-M未配对报告，UO=O-V-M未配对结果。没选中的本机报告不进R，没配对的结果不进均值。
- 检查R/O/V/M/UR/UO任一正值<10即整个聚合status=suppressed，计数/均值/分母/配对率都不输出；0允许。available才输出counts及两份独立粗均值，V=0时均值均null。无交叉小分组、逐对分数、差值/相关/预测误差/等级换算或自动阈值调整。
- 输出精确顶层：`format:'bic-followup-review',version:1,bankVersion,subject,scale:'school_percent_0_100',source,privacy:{minCell:10,release:'local_aggregate_not_anonymity_guarantee'},method:{pairing:'operator_selected',dates:'operator_declared_order_checked',comparison:'separate_coarse_means_not_equated'},status,calibration:{status:'not_calibrated',thresholdsChanged:false,realSampleValidation:false}`。
- available另有`counts:{selectedReports:R,outcomeRows:O,usablePairs:V,missingScorePairs:M,unpairedReports:UR,unpairedOutcomes:UO}`及`means:{baselinePctRounded5,followupPctRounded5}`。基线均值用V份完整目标科的correct/total重算汇总，后续均值用V个score；各舍入到5个百分点，V=0均null。两次不同试卷不可视为同一量尺，不输出差值或称学习进步/校准改善。
- 输出不含研究/报告/归档编号、姓名、逐条分数、精确日期、自由文案/人格/顾问审计。日期/来源/独立性只由操作者声明，不能认证真实成绩、学生或授权；10不是匿名保证，子集/均值/组合仍有风险，限校内复核。输入及原本机库不改，无I/O。

## 固定UI契约

- `OutcomeReviewUI.init({getRecords,download})` returns `{clear()}`。宿主button#libraryOutcomesBtn、空div#libraryOutcomes；初始隐藏、不getRecords/不分析/不上传。主动打开并导入文件后显示私有列表。
- 固定selectors：#outcomeFile（json，文件1..300000字节，text再查100000码元）、#outcomeSourceSummary、#outcomeRecords中checkbox[data-outcome-record]、#outcomeBindings里每行[data-outcome-study]；select[data-outcome-pair=studyId]，date input[data-outcome-date=studyId]；#outcomeIndependence、#outcomePreviewBtn、#outcomePreview、#outcomeJson、#outcomeExportBtn、#outcomeCloseBtn、#outcomeStatus。
- 解析成功显示subject/scale/examDate/来源与行数，默认无报告选择/配对。仅当前题库且目标科完整可选。每结果行手动选择已勾选报告、填写实际基线日期；0分显示0，null显示缺失。无自动按姓名/编号配对；重复绑定交引擎拒绝。
- 选择变化只清除引用已取消报告的绑定，保留其余有效绑定但不自动新增；换文件清选择/绑定/旧预览。报告选择/配对/日期/独立性变化均立即清预览。
- 核对checkbox说明每位学生至多一份、研究编号对应及实际日期由操作者核对。至少10份报告、合法manifest与核对后才可生成；未绑定允许作为缺失诊断，绑定却无日期应报错不丢行。
- 生成前、导出前、确认后均复查所选归档完整快照+manifest+bindings+核对状态，改变/删除/损坏/读取失败清预览不导出，不自动重算。确认明确来源/科目、仅聚合非备份、日期声明与非匿名保证、未校准，不含原始编号/逐对成绩。
- 文件异步读取使用代际令牌，离开/换文件后的迟到读取不能恢复私密资料。clear清DOM/文件/编号/成绩/姓名/配对/预览，宿主render/离开均调用。所有渲染纯文本，375px不溢出，不新增浏览器存储或网络。
- 可提供#outcomeTemplateBtn主动下载一行synthetic格式模板（固定SAMPLE-001/score:null/当前题库/今天/math，显式仅格式样例不是真实样本），不含本机数据；`download(text,'template')`。摘要仅确认后`download(text,'summary')`，宿主固定文件名前缀，任何姓名/编号不用于下载名。

## 任务

1. 引擎agent只拥有js/outcome-review.js、tests/outcome-review.test.cjs。TDD后给准确日志/数。
2. UI agent只拥有js/outcome-review-ui.js、css/outcomes.css、tests/outcome-review-ui.test.cjs。用假引擎隔离UI，TDD及迟到读取/快照/取消/纯文本/手机验证。
3. root负责index/ReportLibrary初始化清理、真实宿主与file://测试、说明/版本v1.9.0/台账/自动续做、PR与打包。
4. 独立审查日期/分解/压制与输入白名单、UI私有生命周期；统一前后端及真实API回归，语法/元数据/pip/diff。只用虚构资料；真实样本、阈值/常模和A/B事件仍未完成。
