# 显式顾问单报告只读授权 Implementation Plan

> 用户已授权离开期间自主逐段实施。本段先只读授权，编辑/汇总留下一段；TDD、独立审查与完整回归后交付，不等待重复设计批准。

**Goal:** 所有者明确确认后，指定既有advisor账号读取一份固定修订的完整报告；期限/撤销/账号/角色/归属/修订失效立即阻止新的读取。

**Architecture:** 新teacher_grants表、独立API与独立只读teacher.html；不放宽原owner CRUD、家长摘要或批注。不复制原始答卷，grant绑定report_revision；owner更新后旧授权source_changed，需重授。默认无跨用户授权。

**Tech Stack:** 现有FastAPI/SQLite事务、原生JS/Chromium；无新依赖/网络厂商或生产操作。

## 数据库与服务

- schema4新增teacher_grants：`id TEXT PRIMARY KEY NOT NULL, owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, report_id TEXT NOT NULL REFERENCES reports(id) ON DELETE CASCADE, report_revision INTEGER NOT NULL CHECK(report_revision>0), recipient_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL CHECK(expires_at>created_at), revoked_at INTEGER, CHECK(recipient_id<>owner_id)`，以及owner/report/created/id与recipient/created/id索引。精确SQL由迁移agent落地并固定，scope为表级只读常量不需DB字段。
- 保留精确_SCHEMA_V3，expected映射1/2/3/4；已知1补share、1/2补comment、1/2/3补teacher，最后同一事务升4；空库建4，失败回滚，未知/修改schema拒绝。原哈希/会话/报告JSON/修订/分享令牌摘要/批注内容原样保留。旧版不能直接读4，停服务私有备份/回退说明必需。
- `TeacherAccessService(db,clock=time.time)`：`create_grant(owner_id,report_id,revision,recipient_username,ttl_hours)`、`list_for_report(owner_id,report_id)`、`revoke(owner_id,report_id,grant_id)`、`list_for_user(recipient_id)`、`read(recipient_id,grant_id)`。
- 创建仅启用owner拥有的报告、当前安全正整数revision；recipient是另一已存在、启用且role=advisor账号（canonical_username）。TTL仅24/72/168小时。写事务内检查所有权/角色/修订/配额/重复；每报告10份、每账号作为owner或recipient共100份历史（含失效，不自动删历史）。同报告同修订同recipient有效重复409 DUPLICATE；配额413 LIMIT，修订409 REVISION，格式422 VALIDATION，未知/越权/失效404 NOT_FOUND，不泄露账号名单。
- owner名单含历史，元数据精确键：`id,report_id,report_revision,report_name,report_ref,owner_username,recipient_username,scope:'full_report_read_only',created_at,expires_at,revoked_at,status`。status为active/revoked/expired/unavailable/source_changed，优先revoked>expired>unavailable（任一disabled或recipient非advisor）>source_changed（当前report.revision不同）>active。
- recipient名单仅当前有效授权；student或disabled调用404，无全校权限。read只给指定recipient（owner用原owner API），必须单次join同时检查双方启用、recipient角色、report.owner_id=grant.owner_id、report.revision=grant.report_revision；直接从同一row取record_json及报告时间，不先验授权再另读报告。返回`{grant,report}`，report原结构`{id,revision,created_at,updated_at,record}`，严格ArchiveRecord校验，损坏503通用错误，不回显私文。正文姓名/编号与存储元数据需一致。
- 撤销由启用owner按报告/授权双归属验证，重复撤销幂等；不要求当前修订（旧授权仍可撤销）。报告删除级联。已读取/复制/截图不能收回；撤销/到期/禁用/角色变化/改源修订阻止新的读取，不承诺无刷新立刻擦除他人已读内容。

## API与客户端

- POST `/api/reports/{id}/teacher-access` body=`{revision,recipient_username,ttl_hours,scope:'full_report_read_only'}`，201元数据；GET同路径owner名单；DELETE `.../{grant_id}`204。
- GET `/api/teacher-access` recipient有效名单；GET `/api/teacher-access/{grant_id}`只读完整记录。认证/CSRF/Origin/no-store边界沿用；所有浏览器认证读取发送当前内存CSRF。新增路由不改变health api_version='2'，schema独立升4。
- CloudReports新方法`createTeacherAccess(id,revision,recipient,ttlHours)`、`listTeacherAccess(id)`、`revokeTeacherAccess(id,grantId)`、`listTeacherReports()`、`readTeacherReport(grantId)`。严格metadata12键/固定scope/username/status/时间/安全整数，列表<=100且id不重复；read严格{grant,report}、grant active/recipient当前advisor、id/revision/name/ref一致；完整record由memory ReportStore校验。无自动重试/上传/存储。

## 前端

- 所有者模块`TeacherOwner.init({client,run,message})` returns `{clear,setReport,setBusy}`。在当前已读CloudUI报告中独立section，selectors：#teacherRecipient,#teacherTtl,#teacherPreviewBtn,#teacherCreateBtn,#teacherListBtn,#teacherOwnerPreview,#teacherOwnerList。必须先预览完整资料范围（姓名、逐题答卷、版本、顾问建议/历史与授权者账号），捕获report.id/revision/recipient/TTL，再确认。字段变化清预览，不发送消息，不新建账号。名单显示状态/撤销，纯文本，clear离开/切换即清。
- 独立teacher.html + js/teacher.js + css/teacher.css，默认不连接/读名单，不加载app/library/outcome/statistics，不读写localStorage/sessionStorage、不提供编辑/上传/本机打开/归档/PDF按钮。用CloudReports同源显式连接/登录，主动刷新/读取，pagehide断开清私密，pageshow要求重连；迟到响应不得恢复旧账号内容。
- Portal固定selectors：#teacherConnectBtn,#teacherDisconnectBtn,#teacherConnectPanel,#teacherLoginForm,#teacherUsername,#teacherPassword,#teacherWorkspace,#teacherAccount,#teacherRefreshBtn,#teacherLogoutBtn,#teacherStatus,#teacherList,#teacherDetail,#teacherHeading,#teacherNote,#teacherReport,#teacherHistory,#teacherReadRefreshBtn，列表读取按钮[data-teacher-read=grant.id]。
- 读取在内存ReportStore导入/restore后用现有renderReport展示，只读审计另外纯文本details，不mount编辑器、不保存；版本/目录未知或不符拒绝规则视图并清正文，提示所有者复核/更新后重授，不能默默按新规则冒充历史报告。授权时已说明完整原始资料范围。
- 当前到期本地timer清详情，刷新名单发现当前授权缺失也清；每次详情读取前清旧正文，失败不留旧资料。明确已读副本不能收回、服务器校验权威、没有后台轮询；新读取均复查授权。HTML no-referrer/noindex/同源CSP，source root不公开。普通家长令牌/邀请没有teacher读写权限。

## 文件分工与验证

1. schema agent：仅db.py、旧test_sharing.py/test_comments.py中当前版本断言及NEW test_teacher_migration.py。精确v1/2/3→4数据保留/失败回滚/未知/二次启动，先RED后实现。
2. service agent：仅NEW teacher_access.py与test_teacher_access.py，权限/修订/角色/禁用/删除/配额/并发重复/损坏/只读；不编辑db/app。
3. UI agent：仅NEW teacher.html/js/teacher.js/js/teacher-owner.js/css/teacher.css/tests/teacher-ui.test.cjs/tests/teacher-owner.test.cjs。假client先RED、隐私生命周期/版本/期限/纯文本/手机；root提供index宿主及client方法。
4. root：app路由/请求模型/dev静态入口、cloud-client严格协议、index/CloudUI挂载、API/真实端到端测试、说明/版本v1.10.0/台账/续做/PR/打包。
5. 独立安全审查后统一完整前端/Python/真实Chromium→API/SQLite、file://和解压源码/迁移冒烟、语法/元数据/pip/diff。仅虚构账号/资料，不创建生产授权或发消息。
