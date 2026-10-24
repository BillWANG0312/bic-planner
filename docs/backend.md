# 可选账号与报告 API（本地验证版）

本目录提供独立 FastAPI 服务；静态测评仍能直接打开 index.html。可选登录和逐份上传默认关闭，不自动传送浏览器报告，详见 [连接指南](cloud-connection.md)。新增 [家长只读摘要及迁移](parent-sharing.md)，尚未部署公司生产；教师分配权限和批注未实现。

## 安装与本地试运行

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

创建账号时终端隐藏输入并二次确认密码；不要把密码放进命令参数、脚本或环境文件。没有默认账号、公开注册或密码找回接口。账号名为 3–64 个 ASCII 字母、数字或 `._@+-`，不区分大小写；密码 12–128 字符。`student` 与 `advisor` 在本阶段都只管理自己拥有的报告，角色名称不授予读取其他学生的权限。

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

`record` 是本机报告库备份 `records` 数组中的一份记录，而非整个备份文件。必须主动选取资料后提交；未来前端接入同样必须由用户明确选择上传。服务器保存作答、版本、报告编号/日期和顾问编辑记录，不接受客户端指定 owner、服务器 ID、修订号或服务端时间戳。不存渲染 HTML，不把客户端成绩当作权威成绩。详细字段可看 `backend/bic_api/models.py`；题目选项元数据由现有题库生成，交叉契约测试防止字段漂移。

单账号最多 100 份、合计 200 万序列化 UTF-16 码元；此处计算各份归档之和，本机备份另有外层 JSON 开销，前端导入仍应执行自身整批校验。每份最多 200 条顾问修改。未知字段/题目、非法选项或布尔冒充分数均拒绝。实际请求体上限 6,100,000 字节，也检查无 Content-Length 的分块请求。超限 413、校验失败 422；错误不会回显密码和答卷。

重复本机 ID 或原报告编号返回 409，不静默替换。修改/删除的旧修订号返回 409，需要重新读取后由用户决定是否重试；不能自动覆盖他人在另一设备的修改。不存在和不属于自己的 ID 均返回 404。每次写入在 SQLite 事务内完成，配额、重复和冲突失败保留旧记录。服务器 ID 与本机归档 ID 是不同字段。

浏览器客户端使用 API v2：认证读取也发送 `X-CSRF-Token`，服务器发现该头时必须与当前 Cookie 会话匹配，防止多标签切换后在旧账号名下读取新账号资料。写请求仍必须提供该头。初次明确连接的会话恢复不带旧令牌，用来识别当前 Cookie；旧 v1 服务被新客户端拒绝，数据库 schema 不变。

## 运维依赖与恢复

正式模式需要操作员明确设置 `BIC_DATABASE_PATH` 和 HTTPS 的 `BIC_PUBLIC_ORIGIN`，取消 `BIC_DEV`。本次没有这些公司环境信息，未执行正式部署。上线前需由有权限的维护者完成：

- HTTPS 反代与同源 API 路由。程序只提供 API，不负责 TLS 或托管静态文件。若网页在 `/academic-planner/`，代理可将 `/academic-planner/api/...` 改写为内部 `/api/...`，并保留正确 Host；此时设置 `BIC_COOKIE_PATH=/academic-planner/api`。默认 `/api` 适用于根路径 API。不要直接暴露开发服务端口。
- 数据库和所有备份必须位于**实际静态服务器文档根目录之外**，且仅服务账号/维护者可读取。程序拒绝源码目录内的数据库，但无法识别另一个服务器是否误把它的父目录公开。SQLite 文件含学生资料、密码哈希和会话信息，没有额外数据库加密；磁盘权限与私有备份是部署依赖。
- 配置进程守护、请求超时、连接数/并发与请求体限制、日志和定期备份。禁止代理记录 Cookie、CSRF 头、登录请求体、答卷或密码。应用不打印这些内容；代理日志需要单独检查。
- 当前入口是单进程，登录限流为每账号 5 次/分钟、每来源 IP 20 次/分钟，包含未知账号和失败尝试；Argon2 同时最多 2 次，其余请求返回 429 与 Retry-After。限流状态在进程内，重启后重置。入口不信任转发 IP 头，反代后所有访问会共享代理的 IP 桶；正式学校多人使用前需完成可信代理及共享限流方案和容量验证。不能简单增加 workers 来声称限流仍等效。
- 本阶段无用户分配、组织管理、改密/找回和再启用接口。账号管理由离线 CLI 执行；停用命令如下，会同时撤销会话。恢复或改密需要后续受审查的管理员能力，不应手工修改哈希/数据库。

```powershell
& D:\Codex\work\bic-backend-venv\Scripts\python.exe -m backend.bic_api.admin --database $env:BIC_DATABASE_PATH disable-user advisor.local
```

备份时先正常停止进程，再完整复制到私有目录；恢复前保留原文件，停服务后恢复匹配版本，再重启验证。不要在写入中仅复制主文件并假设一致。数据库带版本和应用标识；未知/篡改结构拒绝、不清库。分享阶段新增已知精确 v1→v2 事务迁移，升级前备份、失败回滚和不可直接降级的边界见分享说明；没有通用迁移工具。

## 开发验证与来源

```powershell
$env:TEMP = 'D:\Codex\work\bic-backend-temp'
$env:TMP = $env:TEMP
New-Item -ItemType Directory -Force -Path $env:TEMP | Out-Null
& D:\Codex\work\bic-backend-venv\Scripts\python.exe -m pytest backend/tests -q
& D:\Codex\work\bic-backend-venv\Scripts\python.exe -m pip check
```

测试数据库全部为临时的虚构资料，保存在源码/网站之外。测试覆盖真实 Argon2/SQLite、会话撤销、跨账号隔离、原子配额与并发修订、严格作答契约、HTTP 来源与 CSRF、分块大小和内存边界、重启持久化。还应运行原有 Node/Chromium 测试，确认纯静态模式未回归。当前 Starlette 对 httpx 测试客户端给出一条弃用提示，现有版本测试通过；以后升级测试传输时一并处理，不据此宣称已兼容未来版本。

维护题目或规划选项后，在完整源码根目录运行 `node backend/tools/assessment-schema.cjs` 重新生成元数据，再审查 diff 并跑前后端测试；`node backend/tools/assessment-schema.cjs --check` 只检查是否一致。生成文件仅含字段形状和选项 ID，没有题目答案。后端测试会独立加载真实浏览器脚本与 ReportStore 归档做交叉验证，不能仅通过改快照绕过不兼容的数据变化。

实现参考 [FastAPI 密码哈希教程](https://fastapi.tiangolo.com/tutorial/security/oauth2-jwt/)（采用其维护中的 pwdlib/Argon2 用法，会话使用可撤销的服务端记录）、[pwdlib 官方指南](https://frankie567.github.io/pwdlib/guide/)、[Python sqlite3 官方文档](https://docs.python.org/3.12/library/sqlite3.html)。本阶段验证不替代公司的部署、容量或人工题库审校。
