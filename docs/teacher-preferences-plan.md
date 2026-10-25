# 显式专业意向与地区偏好摘要v3（v1.14.0）

基线16b0f1948fb876faecb971c557442e37a8a3f1d0；工作区干净，PR6草稿OPEN/MERGEABLE，无反馈。用户已授权自主顺序推进。本轮仅学生明确选择，不做规则推荐/人格/自由文本或统计推断，schema5/API2不变。

## 选项快照

backend/tools/preference-schema.cjs加载js/majors.js、js/plan.js，从preferredMajor/countries两题生成backend/preference-schema.json和安全js/preference-schema.js。私有payload精确{bank_version:'2026.10',schema_version:'planning-preferences-v1',majors_sha256,plan_sha256,questions}；questions固定顺序preferredMajor/countries，每项{key,max,options:[{id,label}]}，max分别2/3、当前12/8固定枚举（含unsure），无desc/自由文案。源UTF8文本CRLF规范为LF后SHA256，payload递归按键排序紧凑JSON（保留Unicode/UTF8）做fingerprint；私有文件{...payload,fingerprint}，--check比对两输出并规范换行。

公开window.BIC_PREFERENCE_SCHEMA精确{metadata,questions}；metadata精确{bank_version,schema_version,schema_fingerprint,basis:'explicit_student_choices'}，questions同固定枚举。Python懒加载严格校验大小/深JSON/指纹、两题ID/max/顺序与现有assessment-schema一致、选项label1–100UTF16/唯一ID；损坏或缺失仅阻止请求偏好的v3通用503，不影响v1/v2。公开选项是固定字典，非学生答卷；指纹不是防篡改签名、历史规则或教师审校证明。

## 服务与版本

新增backend/bic_api/preference_summary.py：load_schema(path=None)、metadata(schema)、project(record,schema)。project返回{preferredMajor:{answered,choices},countries:{answered,choices}}。仅取原state.plan.answers中两题的有效枚举；缺省/空数组→false/[]，非空→true，unsure是有效选择，可与具体选项共存；按快照固定枚举顺序输出，不是选择排名。不读取/输出规则推荐、人格或自由文本；不要求全部规划完成，不要求当前院校目录，仅当前题库与固定枚举一致。

TeacherSummaryService.read(recipient_id,grant_ids,academic=False,preferences=False)，两flag严格bool，沿用同一JOIN快照/所有权限/整批拒绝。默认和仅academic的v1/v2原字节保持；preferences=true时version3，顶层增加options:{academic:bool,preferences:true}及preference_schema四键metadata；每报告在原字段上增加preferences，两题结构如上。academic=true时同时保留原scoring/performance，否则不加载评分规则或出现这两字段。偏好模式缺坏选项schema不能静默降级；评分规则坏不影响纯偏好模式。无新库状态或写入，不扩大角色/家长/编辑权限。

POST /api/teacher-summaries体增加可选preferences:StrictBool=false，前端readTeacherSummaries(ids,options={})仅允许两个布尔；只true才传字段。期望版本=preferences?3:academic?2:1，v3options须精确匹配请求。元数据与公开字典逐字匹配，不一致拒绝。默认v1请求仍只有grant_ids，v2仍仅另有academic:true。

## 纯模块/CSV

TeacherSummary.validate/build扩展v3，v1/v2精确白名单/输出结构/CSV字节不改。v3顶层精确format/version/items/options/preference_schema以及条件scoring；report精确原v1字段+preferences及条件performance。校验两题answered布尔必须等于choices非空，唯一/已知ID、max2/3、快照固定顺序，无额外字段；元数据必须当前公开四键，公共字典本身结构/枚举受校验。部分规划报告可有明确偏好，不能强制变成完整或输出系统推荐。

v3 build返回{rows,csv,preference_schema,options}和条件scoring；rows仅在原白名单上增加preferences及条件performance，不含内部IDs/原答卷/审计。columns(version=1,options?)支持3，version3必须精确{academic:bool,preferences:true}；values(row,scoring?,preference_schema?)复用映射，缺必要metadata拒绝，避免预览/CSV分歧。

v3在原21列后先附条件学科v2的8列，再附6列：专业意向作答、专业意向（学生自选，非推荐）、地区偏好作答、地区偏好（学生自选，多选）、偏好选项版本、偏好选项指纹。故纯偏好27列、学科+偏好35列。状态已回答/未回答；缺答选择文本未回答；有效选择按字典label以中文分号连接，unsure原label保留，不推断优先级。BOM/CRLF/引号/公式及控制前缀转义保持。固定纯偏好文件bic-teacher-preferences-v3.csv，组合bic-teacher-academic-preferences-v3.csv。带姓名/编号的校内资料，不是匿名/录取结论或校准。

## UI与验证

新增默认未勾选summaryPreferences，与summaryAcademic独立。加载安全preference-schema.js，不加载bank/majors/plan/report/store。模式两个flag绑定选择/用户/期限/payload；任意flag更改清旧预览，忙时禁用仍防程序/确认框期间变化，导出前/确认后请求同模式，版本/字典指纹/权限/源/身份变化拒绝旧文件；不重试/降级。显示偏好metadata纯文本summaryPreferencesMeta，长指纹手机内换行；表头/值统一纯模块，旧v1/v2不变。

后台组负责生成器/快照/服务投影及测试；纯模块组协议/CSV；UI组模式与边界；主协调API/client/真实集成/文档/打包。TDD后独立审查，覆盖缺省/空/unsure+具体/乱序规范/多选max/未知损坏、4模式独立依赖、v1/v2不变、字典指纹/额外字段、模式切换/迟到/确认前后/撤销/CSV与375。完整Node/Python/真实API回归及源码解压--check、私有路径/默认关闭/零HTTP/无存储；提交fork更新草稿，台账和heartbeat准确续做。
