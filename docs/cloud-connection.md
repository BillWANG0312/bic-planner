# 账号与服务端报告连接（v1.3.0）

默认配置关闭。打开页面、进入「账号报告服务」或刷新页面，不会自动探测服务、登录或上传学生资料；直接打开 index.html 时继续使用本机模式。本段已通过本地同源服务验证，公司的正式域名/服务器尚未接入或部署。

## 使用

1. 学校开通服务后，从学校 HTTPS 网址点击「账号报告服务」和「连接本校报告服务」。有效 Cookie 会在这次明确连接后恢复账号，否则填写操作员提供的账号和密码。
2. 选择当前报告或一份本机归档。上传确认列出姓名、报告编号、接收账号及包含作答/顾问修改，每次只上传这一份。取消不发送，刷新名单不上传。
3. 读取详情可预览原编号、日期、修订和版本。打开前再检查会话与修订，再确认替换当前作答；请先归档当前资料。保存失败时保留原学生的内存与浏览器进度。按当前题库/目录生成报告，保留原编号、日期和顾问来源，原 PDF 需另存。
4. 更新需选择同一报告编号的本机资料，并明确更新已读取修订。若服务端已有新修订则要求重读，不自动获取新修订号重试覆盖。编号不同不能更新目标。
5. 删除只影响自己的服务端记录，不清本机作答/归档。退出撤销会话并清页面名单。断线时明确提示服务器注销尚未确认，需重新连接后再退出。

密码提交后清空输入框。口令、CSRF 和服务端绑定不写 localStorage、sessionStorage 或备份；Cookie 为 HttpOnly，HTTPS 下 Secure。刷新仍需主动连接，有效 Cookie 可恢复，正式退出应点击退出账号。本机资料仍按浏览器/网址保存，不按云端账号隔离，切换账号不会自动清掉本机进度。

多标签共享 Cookie。另一标签切换账号后，旧页下一次读取/打开会核对内存会话，失败后清名单并要求重登，不在旧账号名下展示新账号资料。旧预览不能绕过校验打开；离开页面或断开后的迟到响应不能替换当前作答或清除后来建立的新会话。

写入断线可能发生在服务器已收到请求之后。页面不宣称成功、不自动重传，请先刷新名单读取实际结果，再决定下一步。

## 开通与本地演示

安装、账号、TLS、数据库权限和私有备份见 [后端说明](backend.md)。客户端要求健康接口 `api_version: '2'`，因为 v2 增加认证读取的会话绑定。旧 v1 在恢复会话或发送口令前被拒绝，前后端须同时更新。数据库当前为schema5，已知精确v1/v2/v3/v4事务升级前先停服务私有备份，任何新版入口或账号CLI都可能触发迁移，详见 [顾问编辑与schema5升级说明](advisor-edit.md)。

`js/cloud-config.js` 默认不含凭据且关闭：

```js
window.BIC_CLOUD_CONFIG = { enabled: false, apiBase: './api/' };
```

维护者开通后将 enabled 改 true，并将 apiBase 指向已配置的同源 API 目录。要求 HTTPS，拒绝跨域、URL 凭据、查询或片段。例如网页 `/academic-planner/` 的 `./api/` 对应 `/academic-planner/api/`，代理改写为内部 `/api/`，Cookie 路径配置 `/academic-planner/api`。开启后仍需用户主动连接和逐份确认上传。

本地开发采用同源入口，避免放开 CORS。安装依赖、交互创建账号后，从完整源码根目录运行：

```powershell
$env:BIC_DEV = '1'
$env:BIC_DATABASE_PATH = 'D:\Codex\private-bic\accounts.sqlite3'
$env:BIC_PUBLIC_ORIGIN = 'http://127.0.0.1:9001'
$env:BIC_PORT = '9001'
& D:\Codex\work\bic-backend-venv\Scripts\python.exe -m backend.bic_api.dev
```

访问 `http://127.0.0.1:9001/`。此入口临时返回启用配置，未修改磁盘默认配置；只公开显式测评/家长/顾问页面及 css/js/img/data，不公开后端、文档、Git 或数据库。没有开发标志或非回环来源则拒绝启动。正式环境仍使用 API 入口 `python -m backend.bic_api` 和独立 HTTPS 静态服务器/反代，本地演示不等于上线。

原owner面板中student/advisor都只管理自己的原始记录；角色本身不授全校权限。另有 [家长只读摘要](parent-sharing.md) 和 [单报告批注](family-comments.md)，这两者不授原始答卷权限。[指定顾问只读](teacher-access.md) 是独立的所有者确认，明确包含完整答卷/历史，限指定账号和修订，原写接口仍不扩权。已读报告的 [可选建议草稿](advice-drafts.md) 默认关闭，人工选段应用只更新服务端；打开到本机仍需独立确认。另有独立的[顾问建议编辑](advisor-edit.md)授权，仅四段文字及服务端登录账号审计，旧只读不扩权。公开注册和改密找回尚未实现。

## 测试

[顾问完成度清单](teacher-summary.md) 是独立主动入口，需逐份选择有效只读授权，预览并在确认前后复查后才能保存含姓名/编号的校内CSV。只返回完成度摘要，不向页面传原始答卷或审计；不写原报告、浏览器存储或数据库新状态，schema5/API2沿用。

`pnpm test` 或 `npm test` 验证前端、协议和模拟服务的真实 Chromium UI，不需要 Python 服务。实际浏览器到 FastAPI/SQLite 集成需后端开发依赖，另行执行：

```powershell
$env:BIC_TEST_PYTHON = 'D:\Codex\work\bic-backend-venv\Scripts\python.exe'
$env:BIC_TEST_TEMP = 'D:\Codex\work\bic-cloud-browser-tests'
pnpm run test:cloud
```

未设 BIC_TEST_PYTHON 时用系统 python（非 Windows 为 python3），缺依赖明确失败，不把未运行当通过。只用临时虚构账号/数据库，默认 D 盘，结束关闭自建进程并校验目录后清理。覆盖无自动上传、取消、最新快照、刷新恢复、修订冲突、配额保护、账号切换、断线不重试和真实多标签。Windows 未授予符号链接权限时对应后端案例明确跳过，其余路径边界仍独立验证。
