# 可选账号与报告 API（本地验证版）

当前测评范围：本页报告操作沿用旧版14道规划/24道数字量表合同；新版游戏/30题特质尚未适配，明确拒绝进入旧云端或投影，不截断或混用分母。新旧档案与续答操作见 [测评版本说明](assessment-profiles.md)。

本目录提供独立 FastAPI 服务；静态测评仍能直接打开 index.html。可选登录和逐份上传默认关闭，不自动传送浏览器报告，详见 [连接指南](cloud-connection.md)。已有 [家长摘要](parent-sharing.md)、[受控批注](family-comments.md)、[指定顾问只读](teacher-access.md) 与 [可选文案草稿](advice-drafts.md)，尚未部署公司生产。顾问必须获得单报告明确授权，角色不开放全校，另有[单报告建议文字编辑](advisor-edit.md)，需另行确认授权，旧只读不扩权。草稿默认禁用，仅有本地模拟与供应商注入协议，没有真实模型适配器、密钥或外部请求。

## 安装与本地试运行

新增 [指定顾问完成度清单](teacher-summary.md) 只读取操作者选择的1–20个有效只读授权，用单次JOIN快照返回必要计数，`POST /api/teacher-summaries`仍需Origin/CSRF身份绑定。旧只读权限不变，编辑授权不能用于此入口；数据库沿用schema5，没有新表、迁移或导出缓存。

使用 Python 3.12（本次验证为 3.12.14）。从完整源码根目录执行，虚拟环境及数据库都放在网站目录外。下面以 Windows PowerShell 为例：

```powershell
python -m venv D:\Codex\work\bic-backend-venv
& D:\Codex\work\bic-backend-venv\Scripts\python.exe -m pip install -r backend/requirements-dev.txt

$env:BIC_DEV = '1'
$env:BIC_DATABASE_PATH = 'D:\Codex\private-bic\accounts.sqlite3'
$env:BIC_PUBLIC_ORIGIN = 'http://127.0.0.1:9001'
& D:\Codex\work\bic-backend-venv\Scripts\python.exe -m backend.bic_api.admin --database $env:BIC_DATABASE_PATH create-user advisor.local --role advisor
& D:\Codex\work\bic-backend-venv\Scripts\python.exe -m backend.bic_api
```

创建账号时终端隐藏输入并二次确认密码；不要把密码放进命令参数、脚本或环境文件。没有默认账号、公开注册或密码找回接口。账号名为3–64个ASCII字母、数字或 `._@+-`，不区分大小写；密码12–128字符。原owner CRUD仍只管理自己的报告；advisor只能经另行明确授权读取指定报告修订，不能凭角色读取其他学生或写入其报告。

只运行服务时可安装 `backend/requirements.txt`；开发依赖额外用于测试。`constraints.txt` 固定了本次验证的依赖版本。更新依赖后应重新验证，不能只改版本号。开发用 OpenAPI JSON 位于 `/api/openapi.json`，没有会加载外部 CDN 的文档页面；正式模式关闭 OpenAPI。

服务默认监听 `127.0.0.1:9001`，端口可用 `BIC_PORT` 改为 1–65535 的整数。`GET /api/health` 只返回状态和 API 版本，不披露数据库路径或账号。开发 HTTP 仅允许 `localhost` 或 `127.0.0.1`；当前不支持 IPv6 Host。Origin 不包含 URL 路径。例如网页在 `/academic-planner/`，仍配置 `https://学校域名`。

## 接口约定

请求和响应为 JSON。带请求体的 POST/PUT 必须声明 `Content-Type: application/json`。所有写请求必须包含与 `BIC_PUBLIC_ORIGIN` 完全一致的 `Origin`；不接受缺失、`null`、重复或其他来源。跨域读也不开放 CORS。全部响应禁止缓存。

| 方法与地址 | 行为 |
|---|---|
| `POST /api/auth/login` | `{username,password}`；成功设置 HttpOnly Cookie，响应仅含 `user`、`csrf_token`、`expires_at` |
| `GET /api/auth/session` | 读取当前账号和 CSRF 令牌，适合页面刷新后恢复会话 |
| `POST /api/auth/logout` | 注销并撤销服务器会话，返回 204 |
| `GET /api/reports?limit=20&offset=0` | 分页名单，含姓名、年级、目标年份、原报告编号与修订号，不含完整答卷 |
| `POST /api/reports` | `{record: 单份本机归档}`；返回新服务器 ID、修订号 1、时间戳与归档，状态 201 |
| `GET /api/reports/{id}` | 当前账号拥有的单份归档 |
| `PUT /api/reports/{id}` | `{record: 单份本机归档, revision: 最近读取的修订号}`；成功修订号加 1 |
| `DELETE /api/reports/{id}?revision=当前修订号` | 删除自己的归档，成功返回 204 |

登录后所有写操作另需 `X-CSRF-Token` 请求头，值取自登录或会话响应。Cookie 默认路径 `/api`、SameSite=Lax，HTTPS 始终 Secure；服务器保存随机令牌的 SHA-256 摘要，原始令牌只在 Cookie 中交付。密码使用 pwdlib 的 Argon2id。会话默认 8 小时固定过期，注销或禁用账号会撤销；不会把令牌写进报告、响应 JSON 或日志。

`record` 是本机报告库备份 `records` 数组中的一份记录，而非整个备份文件。必须主动选取资料后提交；现有前端连接同样要求用户明确选择并确认上传。服务器保存作答、版本、报告编号/日期和顾问编辑记录，不接受客户端指定 owner、服务器 ID、修订号或服务端时间戳。不存渲染 HTML，不把客户端成绩当作权威成绩。详细字段可看 `backend/bic_api/models.py`；题目选项元数据由现有题库生成，交叉契约测试防止字段漂移。

单账号最多 100 份、合计 200 万序列化 UTF-16 码元；此处计算各份归档之和，本机备份另有外层 JSON 开销，前端导入仍应执行自身整批校验。每份最多 200 条顾问修改。未知字段/题目、非法选项或布尔冒充分数均拒绝。实际请求体上限 6,100,000 字节，也检查无 Content-Length 的分块请求。超限 413、校验失败 422；错误不会回显密码和答卷。

重复本机 ID 或原报告编号返回 409，不静默替换。修改/删除的旧修订号返回 409，需要重新读取后由用户决定是否重试；不能自动覆盖他人在另一设备的修改。不存在和不属于自己的 ID 均返回 404。每次写入在 SQLite 事务内完成，配额、重复和冲突失败保留旧记录。服务器 ID 与本机归档 ID 是不同字段。

浏览器客户端使用 API v2：认证读取也发送 `X-CSRF-Token`，服务器发现该头时必须与当前 Cookie 会话匹配，防止多标签切换后在旧账号名下读取新账号资料。写请求仍必须提供该头。初次明确连接的会话恢复不带旧令牌，用来识别当前 Cookie；旧 v1 服务被新客户端拒绝，数据库 schema 不变。

## 运维依赖与恢复

正式模式需要操作员明确设置 `BIC_DATABASE_PATH` 和 HTTPS 的 `BIC_PUBLIC_ORIGIN`，取消 `BIC_DEV`。本次没有这些公司环境信息，未执行正式部署。上线前需由有权限的维护者完成：

- HTTPS 反代与同源 API 路由。程序只提供 API，不负责 TLS 或托管静态文件。若网页在 `/academic-planner/`，代理可将 `/academic-planner/api/...` 改写为内部 `/api/...`，并保留正确 Host；此时设置 `BIC_COOKIE_PATH=/academic-planner/api`。默认 `/api` 适用于根路径 API。不要直接暴露开发服务端口。
- 数据库和所有备份必须位于**实际静态服务器文档根目录之外**，且仅服务账号/维护者可读取。程序拒绝源码目录内的数据库，但无法识别另一个服务器是否误把它的父目录公开。SQLite 文件含学生资料、密码哈希和会话信息，没有额外数据库加密；磁盘权限与私有备份是部署依赖。
- 配置进程守护、请求超时、连接数/并发与请求体限制、日志和定期备份。禁止代理记录 Cookie、CSRF 头、登录请求体、答卷或密码。应用不打印这些内容；代理日志需要单独检查。
- 当前入口是单进程，登录限流为每账号 5 次/分钟、每来源 IP 20 次/分钟，包含未知账号和失败尝试；Argon2 同时最多 2 次，其余请求返回 429 与 Retry-After。限流状态在进程内，重启后重置。入口不信任转发 IP 头，反代后所有访问会共享代理的 IP 桶；正式学校多人使用前需完成可信代理及共享限流方案和容量验证。不能简单增加 workers 来声称限流仍等效。
- 账号创建和停用由离线 CLI 执行；停用命令如下，会同时撤销会话。本人改密已提供 `POST /api/auth/password`，成功后撤销本人全部会话，详见 [改密说明](password-change.md)。用户分配、组织管理、管理员找回/身份复核和再启用接口仍未实现，不应手工修改哈希/数据库。

```powershell
& D:\Codex\work\bic-backend-venv\Scripts\python.exe -m backend.bic_api.admin --database $env:BIC_DATABASE_PATH disable-user advisor.local
```

备份时先正常停止进程，再完整复制到私有目录；恢复前保留原文件，停服务后恢复匹配版本，再重启验证。不要在写入中仅复制主文件并假设一致。数据库带版本和应用标识；未知/篡改结构拒绝、不清库。当前已知精确v1/v2/v3/v4→5事务迁移保留原账号哈希/会话/报告/分享/批注/只读授权，任何新版入口或账号CLI前先备份；失败回滚和不可直接降级边界见[顾问编辑与schema5说明](advisor-edit.md)，没有通用迁移工具。

## 开发验证与来源

```powershell
$env:TEMP = 'D:\Codex\work\bic-backend-temp'
$env:TMP = $env:TEMP
New-Item -ItemType Directory -Force -Path $env:TEMP | Out-Null
& D:\Codex\work\bic-backend-venv\Scripts\python.exe -m pytest backend/tests -q
& D:\Codex\work\bic-backend-venv\Scripts\python.exe -m pip check
```

测试数据库全部为临时的虚构资料，保存在源码/网站之外。测试覆盖真实 Argon2/SQLite、会话撤销、跨账号隔离、原子配额与并发修订、严格作答契约、HTTP 来源与 CSRF、分块大小和内存边界、重启持久化。还应运行原有 Node/Chromium 测试，确认纯静态模式未回归。当前 Starlette 对 httpx 测试客户端给出一条弃用提示，现有版本测试通过；以后升级测试传输时一并处理，不据此宣称已兼容未来版本。

旧API的assessment-schema生成器读取固定旧版plan/mbti及共享学术bank；修改当前新版规划/游戏时，不应重生成或扩展这份旧合同。新增profile先定义独立严格模型及合同快照；学术题目/共用规则有变时先确定版本与兼容策略，再审阅生成diff、运行前后端对照。`node backend/tools/assessment-schema.cjs --check`只检查一致性，生成文件仅含字段形状/选项ID，不含答案。完整检查命令与验证边界见 [验证记录](verification-2026-10-25.md)，不能通过改快照绕过不兼容的数据变化。

实现参考 [FastAPI 密码哈希教程](https://fastapi.tiangolo.com/tutorial/security/oauth2-jwt/)（采用其维护中的 pwdlib/Argon2 用法，会话使用可撤销的服务端记录）、[pwdlib 官方指南](https://frankie567.github.io/pwdlib/guide/)、[Python sqlite3 官方文档](https://docs.python.org/3.12/library/sqlite3.html)。本阶段验证不替代公司的部署、容量或人工题库审校。

## 本人改密增量接口

现有API2/schema5增加POST /api/auth/password：本人有效会话+Origin/CSRF，旧密码验证、新密码确认、事务CAS替换哈希并撤销全部本人会话，204空响应清Cookie。登录会话创建同时核对被验证哈希，关闭改密与旧登录竞态；没有本轮迁移。限流与哈希资源上限保持。操作、Unicode长度、未知结果及边界见 [改密说明](password-change.md)。管理员找回/身份复核仍未实现，不能用新建同名账号替代恢复。

v1.16.0已恢复旧报告原义与新旧profile隔离，完整本地回归1377项通过；新游戏/特质报告仍不能通过现有严格云归档模型，前端明确阻止发送，后端保持拒绝。完整回归通过不表示新版云归档/分享/摘要已实现，见 [测评版本说明](assessment-profiles.md) 和 [兼容性记录](upstream-assessment-compatibility.md)。

旧API结构生成器现从固定旧版plan/mbti与共享学术bank生成，先运行legacy-assessment.cjs --check；旧assessment-schema.json内容保持。新profile需要独立严格模型，不能通过重生成旧形状或手改JSON扩展。

## 版本合同与能力发现（v1.17.0）

独立current_models.py验证games-traits-v1；contracts.py集中profile辨认、严格归档校验及9项操作策略，不改变旧ArchiveRecord或schema5。新版模型是后续接入基础，当前owner API仍拒绝新版，所有新版业务操作为空。

认证GET /api/report-capabilities返回bic-report-capabilities/version1、api_version2和两profile的operations；CURRENT附八键安全合同元数据，legacy沿用已支持操作。若读取带X-CSRF-Token，必须匹配当前Cookie；过期/停用/匿名拒绝。响应no-store，无答卷/账号/密钥；旧health保持原样，客户端默认连接不增加探测请求。

共同家长snapshot builder、批注新邀请、顾问/文案/汇总按操作检查；旧严格验证和公共白名单保留。既发legacy快照/线程按原授权生命周期读写与撤销，不因识别新合同失去清理能力。新合同损坏只使新模型/能力发现安全失败，旧服务可继续。详见 [架构说明](architecture-overview.md) 与 [本轮计划](architecture-plan-2026-10-26.md)。
