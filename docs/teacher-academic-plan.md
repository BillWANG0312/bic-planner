# 显式可选的学科表现摘要v2（v1.13.0）

基线2f064c24d0389c83789713a1a026f923db7d775e；工作区干净，PR6草稿OPEN/MERGEABLE无反馈。用户授权自主实现。本轮只扩展四科学科表现，不做专业/人格推断或真实校准，schema5/API2不变。

## 计分快照与服务

新增backend/tools/academic-scoring.cjs，从当前js/bank.js和report.js生成backend/academic-scoring.json与安全公开js/academic-scoring-meta.js。私有快照payload精确{bank_version,rule_version:'academic-pct-v1',bank_sha256,report_sha256,questions}；questions固定当前60题，每项精确{id,subject,type,answer,tol,option_count}，answer/tol为JS String(number)规范ASCII数字串，option_count选择题整数、数值题null。规范JSON按键递归排序/ASCII值紧凑编码，SHA256作为fingerprint。快照文件为{...payload,fingerprint}，两处源文件UTF-8文本CRLF规范为LF后做SHA256绑定（Windows工作树与git archive/Linux同规则不产生假冲突）；这是跨平台实现裁定，不是原字节签名。生成器--check比对两输出；不改变既有无答案assessment-schema工具。

公开JS仅window.BIC_ACADEMIC_SCORING_META={bank_version,rule_version,rule_fingerprint,basis:'current_local_rules_recomputed',incomplete_policy:'not_scored',calibration:'not_calibrated'}，无题目/答案键。Python懒加载并验证私有快照指纹、严格字段/枚举、当前assessment-schema的ID/类型/选项数、科目与15题数量、有限答案/非负容差；损坏或缺失仅v2返回通用503，不影响默认v1，不回显私文。公开指纹用于确认同一部署规则，不是防篡改签名、历史规则证明或教师审校证据。

backend/bic_api/academic_scoring.py提供load_rules()、grade(record,rules)及scoring_metadata(rules)。grade返回固定english/maths/physics/chemistry四行{key,complete,pct}。完全沿用evaluateAnswer/gradeAcademic：选择题JS整数0..optioncount-1，数值JS Number的十进制/科学计数/0x/0b/0o及ECMAScript空白转换，有限数字/合法0，按abs(value-answer)<=tol。每题等权；仅该科15题全答时pct=Math.round(correct/15*100)，否则null。0%有效，与null区分。不返回原答案/逐题正误/部分科正确数，不写原报告或阈值。用真实Node gradeAcademic对照全部0–15正确数和数值边界/近容差/负零/进制/大值/缺答。

TeacherSummaryService.read(recipient_id,grant_ids,academic=False)延续单JOIN整批权限与归档检查；academic严格bool。false/默认输出原v1逐字不变；true输出同format/version:2，顶层增加scoring（上述公开六键），每个report在原v1字段上仅增加performance（四行）。load_rules每批一次，授权/版本先检查，不能向v1静默降级。旧权限不扩张；只有现有有效完整报告只读授权，编辑/家长授权仍拒绝。

## API、纯模块与CSV

POST /api/teacher-summaries体只增加可选academic:StrictBool=false；缺省/false仍原v1，true明确v2。客户端readTeacherSummaries(ids,options={})仅允许academic布尔，true才传字段，默认原请求不变；响应版本须对应选项，公开BIC_ACADEMIC_SCORING_META六键与服务端scoring逐字匹配，否则PROTOCOL；前后端一起更新。

TeacherSummary.validate/build扩展v2严格白名单与模式；v1仍拒绝额外字段、build仍返回{rows,csv}。v2 build返回{rows,csv,scoring}，rows仅在原行增加performance，不含内部ID/原答案/审计。校验performance顺序/complete须等于原academic已答15；不完整pct必须null，完整pct须为round(n/15*100)的16个可能整数值之一（含0），状态/计数原验证保持；元数据须当前公开六键。新增columns(version=1)及values(row,scoring?)供UI复用显示，避免预览/CSV映射分歧。

v1仍21列及原文件名；v2追加英语/数学/物理/化学「题库表现（仅完整，%）」四列与评分规则版本/评分规则指纹/规则依据/校准状态四列，共29列。未完整显示未完整，完整0显示0；依据显示当前同版规则重算、校准状态未校准，规则版本及完整指纹可追溯。BOM/CRLF/引号与公式/控制前缀保护保持。固定v2文件名bic-teacher-academic-v2.csv，不称正式成绩/预测/学习增长或匿名资料。

## UI与新鲜度

teacher-summary.html加载安全academic-scoring-meta.js，仍不加载bank/report/store/答案键。新增默认未选checkbox summaryAcademic，明确非正式成绩与未完整隐藏。更改选项清旧预览/CSV；忙碌时禁用，但程序/确认框期间变化仍通过currentPreview校验捕获，不依赖禁用属性。模式与所选ID/身份/期限/payload绑定，预览/导出前/确认后请求同模式、核对完整快照及指纹。服务端静默v1/模式/规则变化拒绝，不重算或自动重试；默认v1全部原行为与字节保持。表头/单元格通过纯模块columns/values渲染，规则元数据纯文本/长指纹手机不溢出。

## 分工与验证

后台组负责生成器/私有快照/安全公开metadata/Python grader/service及测试；纯模块组负责v2协议/CSV及测试；UI组负责显式模式/显示/新鲜度测试；主协调API/client/真实集成/文档/打包。TDD先失败后实现，新增可替换边界只为真实规则验证，不加厂商/依赖/网络/持久化。独立复核数值JS一致、指纹/模式failclosed、旧v1不变及权限/原答卷保持；完整Node/Python/真实API回归，默认关闭离线包/升级边界验证后提交fork更新草稿，更新台账和heartbeat。
