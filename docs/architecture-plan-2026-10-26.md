# 版本合同与操作能力：本轮实施约定

基于main `6d533f0830ed30e843f58c373a1c25bff9ed7681`，PR #8已由所有者合并。用户已授权自主继续、整理架构并逐段交付。本轮保留静态/file前端与可选FastAPI/SQLite，将合同和操作兼容性集中；新版云端CRUD留下一段完整接入，不在本轮部分放开。

## 结果和接口

1. 新建独立的 `games-traits-v1` 严格归档模型、可复核语义合同和安全公开元数据。旧 `ArchiveRecord`、旧assessment/preference快照和摘要v1/v2/v3保持。学术null、未出现字段、短数组、空game草稿、ms省略/null/任意有限数均按现ReportStore原样保留；不把poolSize当归档总量。
2. 语义合同绑定有序30题及量表value/label、规划问句和选项文字、游戏解释/信号映射、量表版本、13道规划/12必答和所有游戏形状/枚举/容量。profile指同一不可变语义；同profile题序/定义变化不能覆盖旧快照，须新profile。指纹使用规范JSON，CRLF不造成差异；源码溯源hash独立保存。公开文件没有学术答案键或学生资料。
3. 新 `contracts.py` 提供 `profile_for_record(record)`、`validate_archive(record)`、`require_operation(record, operation)`、`report_capabilities()`。profile识别与严格验证分开；验证返回保留原值的副本，策略不替代账号授权。
4. 操作固定为 `owner_archive`、`parent_summary_v1`、`family_comments_v1`、`advisor_read_v1`、`advisor_edit_v1`、`advice_draft_v1`、`teacher_completion_v1`、`teacher_academic_v2`、`teacher_preferences_v3`。legacy支持这些现有操作；CURRENT本轮均未开放。单独完成新模型不代表这些业务已经接入。
5. 新增认证 `GET /api/report-capabilities`。响应精确为format=`bic-report-capabilities`、version=1、api_version=`2`与profiles数组。legacy项为profile/operations；CURRENT项为profile/operations/contract，operations为空。contract八键：profile、contract_version=`games-traits-contract-v1`、contract_fingerprint、bank_version、personality_version、planning_total、planning_required、personality_total。沿用session/CSRF绑定和no-store；旧health和客户端默认连接请求不变。
6. 在授权与源修订核对后、生成新投影或写授权之前，调用统一操作检查。当前profile、未知标记、嵌套标记、混合/无标记新版证据不能进入旧家长摘要、批注邀请、顾问读取/编辑/汇总和文案流程。family_comments_v1仅指新邀请生成；已发legacy快照、受邀线程合法读写、名单和撤销操作保持原生命周期；不以元数据发现扩大权限。

## 分工与依赖

- 合同层：`current-assessment-schema.cjs` → 私有JSON及公开meta → `current_models.py`；新模型只复用稳定文字/顾问类型，独立学术保留null。
- 策略层：延迟导入新模型；新JSON损坏不能使旧接口导入失败。新模型/metadata安全ValueError转为通用可用性错误，不能回显源码或资料。
- 服务层：共同家长snapshot builder、顾问验证、文案和汇总投影调用策略；`StorageError(422, safe_message, 'PROFILE')`不得被宽泛ValueError捕获改写。
- 根协调：架构说明、术语/决策、skill来源核对、真实API/完整回归、独立审查与GitHub交付。没有新表、迁移或生产操作。

## 验证和交付门槛

先写行为失败用例再最小实现。新模型用真实JS ReportStore生成的空白/部分/完整虚构归档交叉对照；覆盖0/null/省略、游戏容量/重复/非法值、30题次序、有限ms/未知字段、损坏合同及同profile语义变化拒绝。覆盖量表label反转/同ID规划含义/游戏映射变化拒绝；缺私有基线时须匹配已有公开锚，两产物均缺普通生成拒绝，显式首次--init不用于恢复已发布profile。指纹/源码溯源测试核对实际生成结果，不用“源码含某行”替代行为验证。

操作策略覆盖每个固定操作、两profile/未知/混合、元数据不含答案、认证/CSRF/Cookie换人和默认无请求。以临时虚构数据库验证手造旧ShareContent也不能给CURRENT生成分享或邀请，且无新增授权/快照/批注；原legacy流程与撤销继续有效。原owner API仍明确拒绝CURRENT。

独立审查后运行完整Node/Chromium、Python和真实浏览器→API套件，保留真实失败/跳过/警告。检查旧三个快照未被重生成、全部生成器、源码解压和文档链接。新分支推fork并创建草稿PR，附加本聊天；不向已合并PR #8推送。

## 下一段

统一合同层验证后，再把新版owner CRUD、按源profile禁止跨版覆盖及显式客户端能力核对作为一段端到端功能实现。之后逐项定义新版分享/批注、顾问协作与版本化汇总，旧格式和授权不自动扩展。当前暂停的定时任务保持，除非用户恢复。
