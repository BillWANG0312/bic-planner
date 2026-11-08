# 一次性测试码与学校报告归档

本功能把线上测评改为「一码一人」：

1. 学校只维护一个 `advisor` 角色的公共账号（部署示例为 `tlwl-bic`）。
2. 管理员在 `admin.html` 登录，为学生生成一个 10 位一次性测试码。
3. 学生打开测评首页，输入测试码后才能开始一次性测试。
4. 学生生成报告时，页面自动把同一份归档提交到服务器；学生可以当场查看并使用浏览器「打印 / 导出 PDF」。
5. 管理员后台按测试码列出学生报告，可在线打开同一份报告并打印。
6. 本机不保存进度或报告；刷新、关闭页面后无法恢复，也没有事后查询入口。

测试码不是账号，也不建立学生账号。学生端使用一个独立的 HttpOnly Cookie（`bic_test_code`）完成本次作答和一次提交。

## 学生流程

- 首页点「开始测评」时，若当前页面还没有生成的报告，会弹出测试码输入框。
- 输入框上方的告知写明：**作答与生成的报告会提交给学校/机构保存。**
- 测试码不区分大小写，可带空格或连字符；服务端会统一规范化。
- 测试码默认有效 7 天（创建时可选 24 小时至 30 天）。
- 学生 Cookie 最长 12 小时；刷新页面时若服务端会话仍有效，可继续使用，但作答进度已丢失，需要从基本信息重新开始。
- 提交成功后服务端会话失效；再次打开首页需要新的测试码，管理员也不会重复收到同一份报告。
- 若自动提交失败，报告页仍可查看和导出 PDF，并提供「重新提交报告」按钮；但刷新或关闭页面后这份报告无法恢复。
- 报告只在当前页面内存中保留；页面上的「请现在导出 PDF 留存」提示不能被关闭。

## 管理员后台

入口：`https://<站点>/academic-planner/admin.html`

- 只接受 `advisor` 角色账号；学生账号即使登录也会被拒绝。
- 创建测试码时填写备注（例如「2026 秋季 8 年级」）并选择有效期。每次只生成一个码，生成后立即显示，可复制。
- 测试码列表显示状态：未使用、答题中、已完成、已过期、已撤销。
- 未使用或答题中的测试码可以撤销；撤销后学生不能再用它开始或提交。
- 学生报告列表显示姓名、年级、目标入学年份、报告编号、测试码、备注和提交时间。
- 「查看报告」在后台内重新生成并展示报告；打印/导出 PDF 沿用浏览器打印。后台不生成服务端 PDF。
- 管理员页面标记为 `noindex`，CSP 限制为同源脚本/样式，不加载外部资源。

## 数据模型（schema 6）

新增两张表：

| 表 | 作用 |
|---|---|
| `test_codes` | 一次性码、备注、创建者、有效期、撤销/兑换/完成时间、参与者令牌摘要 |
| `student_reports` | 每个测试码最多一份报告；保存完整归档 JSON 与检索用的姓名/年级/年份/报告编号 |

约束：

- `test_codes.code` 唯一；10 位字符取自 `23456789ABCDEFGHJKLMNPQRSTUVWXYZ`（排除易混淆的 `0/1/I/O/L`）。
- 参与者令牌只保存 SHA-256 摘要；原始令牌仅在 HttpOnly Cookie 中。
- `student_reports.test_code_id` 唯一且外键为 `ON DELETE RESTRICT`，保证一个码对应一份报告。
- 报告修订固定为 1；没有学生端修改接口。
- 删除创建测试码的管理员账号会级联删除其测试码，但已有报告的测试码受 `RESTRICT` 保护，不会静默丢失学生资料。

## API

所有写请求仍需与 `BIC_PUBLIC_ORIGIN` 完全一致的 `Origin` 和 `Content-Type: application/json`。管理员写请求另需 `X-CSRF-Token`。

| 方法与地址 | 角色 | 行为 |
|---|---|---|
| `POST /api/admin/test-codes` | advisor | `{label, expires_in_hours}`，默认 168 小时；返回 201 与新码 |
| `GET /api/admin/test-codes?limit=&offset=` | advisor | 测试码列表与状态，最多 100 条/页 |
| `POST /api/admin/test-codes/{id}/revoke` | advisor | 撤销；重复撤销幂等（请求体可为 `{}`） |
| `GET /api/admin/reports?limit=&offset=` | advisor | 已提交报告列表 |
| `GET /api/admin/reports/{id}` | advisor | 单份报告完整归档 |
| `GET /api/public/session` | 无（Cookie） | 当前测试码会话；无有效会话返回 401 |
| `POST /api/public/join` | 无 | `{code}`；设置 `bic_test_code` Cookie，返回备注与到期时间 |
| `POST /api/public/report` | 无（Cookie） | `{record}`；写入报告并清除 Cookie，返回 201 |

补充约束：

- 测试码错误格式返回 422；不存在的合法格式返回 404；已兑换给其他人返回 409；过期/撤销/已完成返回 410。
- 同一记录重复提交是幂等的（返回 `created: false`）；同一测试码换一份不同记录提交返回 409。
- 加入接口按测试码 10 次/分钟、按来源 IP 30 次/分钟限流，超限 429。
- 学生端没有报告查询接口；`/api/public/session` 在提交后也会返回 401。

## 生产部署

### 1. 准备公共管理员账号

按现有 CLI 在服务器上创建或改用 `advisor` 角色账号。密码在终端隐藏输入，不要写进命令行、脚本或仓库；本文件也不记录密码。

```sh
/home/bill/nas/bic_account_venv/bin/python -m backend.bic_api.admin \
  --database /home/bill/nas/bic_account_data/accounts.sqlite3 \
  create-user tlwl-bic --role advisor
```

若同名账号已存在，先停服务、备份数据库，再按现有运维流程处理；不要手工改密码哈希。

### 2. 迁移或重建数据库

现有 schema 5 会在首次启动时事务升级到 schema 6，只新增两张表，保留原账号、报告、分享与授权。升级前必须停服务并做私有一致备份，步骤见 [顾问编辑与 schema 5 说明](advisor-edit.md)。

本次决定**不保留旧账号与旧报告**。推荐做法不是写删除代码，而是：

```sh
sudo systemctl stop bic-account-api.service
cp -a /home/bill/nas/bic_account_data/accounts.sqlite3 \
      /home/bill/nas/bic_account_data/accounts.sqlite3.bak-2026-11-08
mv /home/bill/nas/bic_account_data/accounts.sqlite3 \
   /home/bill/nas/bic_account_data/accounts.old-2026-11-08.sqlite3
sudo systemctl start bic-account-api.service
```

新库会在第一次 API 请求时创建为 schema 6。确认新流程和 `tlwl-bic` 登录正常后，再由维护者决定何时删除 `accounts.old-2026-11-08.sqlite3` 与备份；删除前保留至少一份私有备份。

### 3. 配置前端

`js/cloud-config.js` 使用测试码模式：

```js
window.BIC_CLOUD_CONFIG = { enabled: true, apiBase: './api/', mode: 'testcode' };
```

- `mode: 'testcode'` 时，开始测评前必须输入测试码；账号报告入口在测评页隐藏。
- 家长分享、顾问授权、本人改密等独立页面仍按各自入口使用。
- 修改任何 JS 后，按仓库约定递增引用页面里的 `?v=N`，避免 Cloudflare/Souin 继续发旧脚本。

### 4. 反向代理与静态文件

- `/academic-planner/api/*` 继续反代到后端内部 `/api/*`，Cookie 路径保持 `BIC_COOKIE_PATH=/academic-planner/api`。
- `admin.html` 与 `index.html` 同目录部署；后台只依赖同源 API，不需要额外构建。
- 确认 `/academic-planner/admin.html` 不进入 CDN 的公共可缓存路径；页面本身有 `noindex`，但仍应通过 HTTPS 和账号鉴权访问。
- 自动部署 cron 拉取后若后端代码变化，需要重启 `bic-account-api.service`；静态文件无需构建。

### 5. 验收

1. 打开 `admin.html`，用 `tlwl-bic` 登录，创建一个 7 天测试码。
2. 新浏览器（无痕）打开测评首页，点开始，确认告知文案与测试码输入框。
3. 输入错误码、已撤销码、过期码，确认提示准确。
4. 用正确码完成一次测评，确认报告页显示「报告已提交到服务器保存」。
5. 后台刷新，确认报告与测试码对应；打开报告并打印预览。
6. 刷新学生页，确认没有事后报告入口；用同一码在新浏览器加入应被拒绝。
7. 撤销另一个未使用码，确认学生无法加入。

## 安全边界

- 前端测试码门禁是使用流程，不是权限系统；真正的约束在服务端 Cookie、令牌摘要、一次性兑换和提交校验。
- 测试码只显示给学生；管理员后台需要 `advisor` 登录与 CSRF 保护。
- 后台接口不开放 CORS，响应禁止缓存，并带 `noindex` / `no-referrer`。
- 报告 JSON 与其他账号报告使用相同的严格归档校验；错误响应不回显答卷。
- 限流状态在单进程内，重启后重置；反代后所有来源可能共享代理 IP 桶，与现有登录限流限制相同。
- 测试码在创建时一次性显示，之后后台列表仍显示完整码，便于管理员核对；不要把后台截图公开发布。
