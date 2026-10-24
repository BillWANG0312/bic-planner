# 专业分布与地区偏好 Implementation Plan

> 用户已授权自行决定并按顺序实施。子任务采用先失败回归再实现，独立审查后统一回归与交付；不等待重复设计确认。

**Goal:** 在现有本地显式选择、预览及快照确认导出之上，增加可选的规则专业推荐分布、学生明确专业意向、地区偏好。

**Architecture:** 扩展现有纯聚合引擎与UI，不新增后端、依赖、网络、持久统计或交叉小分组。原v1学术输出及默认行为保持；只有显式planning=true才得到v2。

**Tech Stack:** 现有浏览器JS、Node原生测试、真实Chromium。

## 引擎契约

- `ReportStatistics.analyze(records,{source,planning:true})`；planning若提供须strict boolean，默认/false输出与原v1完全一致。source/10–100/当前题库/严格归档校验和全部学术口径不变。
- planning=true要求全部所选catalogVersion与当前UNIVERSITY_CATALOG.version相同且已知，否则整批拒绝，不排除或重算旧目录。v1仍允许不同目录。规则分布是按当前本地规则重算，不认证归档当时的规则版本；系统尚无历史规则快照。
- v2保留原format='bic-academic-aggregate'及原字段，仅version=2并新增planning。其余学术sample/privacy/subjects/items/calibration结构及数值与同批v1完全相同。
- planning固定 `{ruleBasis:'current_local_rules_recomputed',catalogVersion,recommendedMajors,statedMajorPreferences,regionPreferences}`。
- 三表共有元字段 `{status:'available'|'suppressed',basis,selectionMode:'single'|'multiple',denominator:'included_reports'}`。suppressed时仅这些字段，无数量/条目/百分比/逐格压制状态或罕见项名称。
- available另有 `{included,excluded,selectionCount,entries:[{key,count,pctOfIncluded}]}`，按对应固定枚举原序输出全部选项含0。included=该表纳入报告数，excluded=N-included；selectionCount为所有count之和。百分比是count/included的整数百分比，included为0时null。
- recommendedMajors.basis='complete_reports_current_rules'，selectionMode='single'，仅generateReport(record.state).meta.status==='complete'纳入，每报告当前top.major.id计一次，key为14个MAJORS.id。其余报告excluded，包括学术/规划/人格未完成，不把默认第一名算成明确结果。不是学生自选/录取概率，不能当原历史报告结论。
- statedMajorPreferences.basis='explicit_major_choices'，selectionMode='multiple'。直接使用state.plan.answers.preferredMajor的固定INTEREST_OPTIONS.id（12项，不能映射为14专业），非空纳入；空为excluded。每报告每选项最多计一次，unsure是有效作答，可与具体选项共存。
- regionPreferences.basis='explicit_region_choices'，selectionMode='multiple'。直接使用countries的COUNTRY_OPTIONS.id（8项），不是规则推荐的地区列表；非空纳入，空excluded，unsure同上。
- 每表独立整表压制：included、excluded、每项count，以及每项included-count任一正值<10则整表suppressed。不单独隐藏稀有项，不能由分母/比例/补集直接反推。0允许；included=0且excluded>=10可available，entries全0、pct=null。
- 多选selectionCount/百分比合计可超过included/100%，UI和文档明确分母是回答该题的报告数，不是选择次数，也不是全部所选报告；未完成整份规划不抹掉已填明确偏好。不计算专业×地区/年级等交叉分组。
- 输出仅固定枚举与统计；不含姓名/编号/原始答案/自由学科文字/人格/顾问审计。10不是匿名保证，重复子集/跨表组合仍有识别风险，仅校内复核。not_calibrated等原标记不变。

## UI契约

- 新增`#statisticsPlanning` checkbox，初始未选；文本说明勾选才增加专业/地区v2，推荐仅完整报告、偏好多选另计、需当前目录。
- 变化立即清预览；生成/导出前/确认后快照检查除原条件外还核对planning选择，不能静默更改导出范围。
- 不自动取消旧目录选择。planning勾选且已选任何非当前目录时，预览按钮禁用并明确提示取消旧目录报告；回到学术模式仍可按原v1分析。名单给旧目录提示，不妨碍原v1选择。
- `#statisticsPlanningResults`承载三个纯文本表。可用表显示分母与excluded的具体含义/选择次数/多选比例说明；压制表只显示统一隐藏说明，不渲染任何计数或类别。标签仅取本机固定MAJORS/INTEREST_OPTIONS/COUNTRY_OPTIONS，无自由文案。
- JSON预览/下载范围和确认框标明纯学术v1或学术+专业/地区v2；宿主下载仍固定原无标识JSON名。close/leave/render全清，375px不溢出，不增加网络/存储。

## 任务与验证

1. 引擎：仅改js/report-statistics.js，新增tests/planning-statistics.test.cjs。先RED再实现。覆盖v1兼容、模式严格、目录版本、完整报告门槛、多选/unsure/缺答、分母、10边界/补集整表压制、白名单/无修改。
2. UI：仅改js/report-statistics-ui.js/css/statistics.css，新增tests/planning-statistics-ui.test.cjs。先RED再实现；原8项UI不回归。覆盖默认/显式/反勾失效、旧目录不静默改变选择、表状态和多选分母、导出前后范围核对、手机/纯文本。
3. root：新增真实宿主集成，使用完整规划与虚构20/30份样本，证明v2与v1学术相同、显式地区不是规则地区、缺答不生成偏好、导出与预览一致、取消/变化保护、原库不变/无网络；file://独立打包冒烟。
4. 独立审查，完整前端、后端及真实API回归、语法/元数据/pip/diff检查。
5. v1.8.0说明/README/台账、个人fork提交、更新草稿PR与2小时续做、源码/静态包/补丁/日志/截图/校验和交付。真实成绩校准/A-B事件仍未实施，下一段单独推进。
