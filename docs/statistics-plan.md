# 本地学术汇总与校准准备 Implementation Plan

> **For agentic workers:** 使用独立子任务实施并独立复核，逐项先失败回归再实现；用户已明确要求自行决定并逐轮完成，不等待设计确认。

**Goal:** 由用户明确选择本机报告，生成不含直接标识/答卷的学术描述汇总，预览确认后本地导出，供后续校准准备。

**Architecture:** 无新后端、网络、依赖或持久统计。纯聚合引擎复用严格 ReportStore 与现有评分，独立 UI 嵌入本机报告库，清选择/来源/离开即丢弃预览。与成绩和规则阈值隔离。

**Tech Stack:** 现有浏览器脚本、Node原生测试、真实Chromium。

**Spec:** 本文件为本轮设计与实现范围，结合 docs/progress.md 当前下一项。专业/地区分布、后续真实成绩及A/B事件留后续独立阶段。

## 固定契约

- `window.ReportStatistics.analyze(records, {source})` 返回只含白名单字段的纯JSON对象，无副作用。source必须显式为 `synthetic` 或 `unverified_real`；后者仅操作者声明，不能自动认证真实/授权或独立学生。
- records为10–100份当前QUESTION_BANK_META.version的本机归档，整批严格ReportStore内存校验及重复ID/batchId检查；不同题库版本整批拒绝，不静默重算旧卷。纯学术计算不要求院校目录相同。统计单位为报告，UI要求操作者核对每人至多一份，系统不靠姓名去重。
- 输出固定顶层 `format:'bic-academic-aggregate',version:1,bankVersion,sample,privacy,subjects,items,calibration`。
- sample固定 `{unit:'report',count:N,source,independence:'operator_checked_not_verified'}`；privacy固定 `{minCell:10,release:'local_aggregate_not_anonymity_guarantee'}`。
- subjects按english/maths/physics/chemistry固定顺序；每项总有 `{key,totalQuestions:15,status}`。complete/incomplete两个计数的任何正数小于10，则整行status=suppressed，不输出计数/均分。否则status=available并有 `complete,incomplete,meanPctRounded5`；均分仅完整科目、按总正确数/15计算后舍入到5个百分点，完整数为0时null。
- items按当前题库顺序，总有 `{id,subject,difficulty,status}`。正确/错误/缺答三格任一正数小于10，则整行suppressed，所有计数及比例不输出。否则available并有 `answered,missing,correct,incorrect,pctCorrect`（正确/已答的整数百分比，已答0则null），`review`为no_answers/all_correct/all_incorrect/descriptive_only。完整行仅用于描述复核，不自动改难度。
- calibration固定 `{status:'not_calibrated',followupOutcomes:false,thresholdsChanged:false}`，不提供推断能力等级、录取概率、常模或真实样本校准声明。
- 复用gradeAcademic及generateReport(...).academic.review，避免数值题容差/缺答与报告不一致。不在输出包含姓名、学号、归档/报告编号、日期、年级、地区、原始答案、顾问文字/历史或人格画像。
- 此处10是产品内部最小单元规则，不是匿名认证。均值/组合/多次子集差分仍有识别风险，界面与导出固定标明“去标识汇总，仅限校内复核”，不承诺可公开或充分匿名。

## UI契约

- `window.ReportStatisticsUI.init({getRecords,download})`，返回 `{clear()}`。download调用 `download(text)`，宿主固定JSON文件名，无名字或报告ID；宿主只在用户确认后收到调用。
- UI根容器 `#libraryStatistics`，打开按钮 `#libraryStatisticsBtn`。初始面板隐藏、未读报告、未选报告、没有分析/下载。点击后getRecords读取本机已有库并显示仅本机的姓名/编号选择，默认无勾选；旧题库项禁用并说明。
- 需要显式样本来源、至少10份、独立样本核对勾选，才可生成预览。选项/来源/核对状态变化立即丢弃旧预览。
- 展示四科完成/缺答和粗粒度完整科目均分；逐题复核折叠显示60行；小单元整行隐藏，不能由分母/比例反推该行罕见计数。JSON预览与实际导出内容一致。
- 导出前重新读取所选记录，与预览所用的完整内存序列化快照比对；任一改动/删除/损坏/存储拒绝均清预览，不下载。无静默替换或自动重新分析。确认框明确来源、报告数和识别风险，仅导出去标识汇总，不是备份。取消不下载。
- 关闭/离开报告库/库重新render/导入删除后clear；清理姓名列表和预览。宿主清理与原库行为不冲突。所有渲染纯文本，375px不溢出，无网络/新增存储写入。

## 实施任务

- [x] 引擎：tests/statistics.test.cjs先红后绿；边界含人数/来源/旧版/重复/损坏、numeric容差、缺答、完整均分和小格压制；严格白名单不包含私密字段，输入不改。
- [x] UI：tests/statistics-ui.test.cjs先红后绿；选择默认空、预览/取消/变动失效、导出新鲜性/存储异常、纯文本/移动端/离开清理。
- [x] 集成：index与ReportLibrary初始化/清理；原本机库/作答无变化、file://零HTTP冒烟。
- [x] 独立审查后完整前端回归；后端与真实API回归验证静态入口未破坏；语法/元数据/diff检查。
- [ ] 更新README/使用说明/台账、提交推送个人fork、更新现有草稿PR（若已合并则另建分支PR）、静态/源码包与真实日志/界面/校验和；更新两小时续做准确下一步。
