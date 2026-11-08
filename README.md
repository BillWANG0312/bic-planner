# BIC 学业规划系统

面向 8–11 年级学生的 A-Level 学术规划互动测评：学生凭学校发放的一次性测试码完成学术、规划与性格特质三部分测评，生成报告后可当场导出 PDF；报告同时提交给学校/机构存档，本机不保存进度或报告。旧版账号服务仍保留给既有独立入口使用。

线上地址：<https://tlwl-bic.com/academic-planner/>（账号服务已开启）。本地也可以在完全不联网的情况下使用。

## 线上部署现状

| 项目 | 现状 |
|---|---|
| 静态前端 | `/home/bill/nas/bic_website/academic-planner/`（线上目录即 GitHub 仓库克隆，无构建步骤） |
| 网站进程 | `server.py`，`127.0.0.1:8086`，systemd `bic-website.service` |
| 账号 API | `backend.bic_api`（FastAPI），`127.0.0.1:9001`，systemd `bic-account-api.service`；同源经 `server.py` 反向代理到 `/academic-planner/api/*` |
| 数据库 | `/home/bill/nas/bic_account_data/accounts.sqlite3`（schema 6，权限 700，位于网站目录外） |
| 运行时 | venv `/home/bill/nas/bic_account_venv`，Python 3.12 |
| 入口 | Cloudflare → cloudflared → `127.0.0.1:8086`（边缘有缓存，见下） |
| 自动部署 | cron `*/5 * * * *` 执行 `pull_academic_planner.sh`：`git fetch` + `merge --ff-only origin/main`，工作区有改动时跳过 |

**更新流程**：一律开分支 → 推 GitHub → 开 PR → 由仓库所有者合并 → 5 分钟内 cron 自动拉取上线。不要直接在本地 `main` 上提交。协作细节见 [CONTRIBUTING.md](CONTRIBUTING.md)。

**脚本版本号（缓存）**：Cloudflare 边缘使用 Souin 缓存：缓存键只看路径，查询串基本被忽略，但实测不同 `?v=` 的版本会各自保留，因此**不带版本号的 URL 最长会被锁定为旧内容 1 小时**。为此 `index.html` 等页面引用的 JS 一律写成 `js/xxx.js?v=N`（各页面以实际引用为准；`cloud-config.js?v=5`、`cloud-client.js?v=8`、`app.js?v=66`、`admin.js?v=2`）。**每次修改某个 JS，就把它在引用页面里的 `?v=N` 加一**，否则线上可能继续发旧代码。改完脚本后在 `index.html`、`admin.html` 等页面搜索 `?v=` 核对。

## 功能一览

### 学生本机测评

- **学术测评**：60 题，英语 / 数学 / 物理 / 化学各 15 题，分基础、中等、进阶三档；数学与理科题附中文翻译和解析。
- **专业规划**：13 题（12 必答 + 1 选填），按兴趣、学科自评、职业与地区偏好推荐探索方向。其中 4 道是互动小游戏：
  - 校园匹配：把学科卡片拖进「喜欢 / 想试试 / 不想学」
  - 职业飞镖：点选最想命中的方向
  - 星球排序：把专业拖到「心动 / 观望 / 排除」
  - 组队赛跑：选择节奏与搭档

  卡片可拖拽，也可先点卡片再点格子；键盘与读屏同样可用。
- **性格特质**：30 道情境题，围绕分析、创造、共情、沟通、组织、执行、好奇、抗压、数字、规则 10 项特质。报告给出特质画像、优势组合与培养建议，不判定 MBTI 类型；MBTI 四维倾向仅作对照。游戏选择也计入画像。未完成显示"待完成"，各特质接近时显示"倾向均衡"。
- **报告与 PDF**：展示作答完成度、学科表现、选科与专业建议；未完成时标注为探索草稿。点「导出 PDF」在打印窗口另存，逐题解析自动展开，打印后恢复。
- **顾问本机编辑**：报告页「编辑建议」可修改四段建议文字，保存前后内容可恢复；重新生成时保留修改并提示复核。

### 学校测试码流程（线上主流程）

- 学校维护一个 `advisor` 角色的公共账号（部署示例为 `tlwl-bic`），在 `admin.html` 登录后逐个生成**一次性测试码**，默认有效 7 天。
- 学生打开测评首页，点「开始测评」时需输入测试码；输入框明确告知**作答与生成的报告会提交给学校/机构保存**。
- 学生生成报告后自动提交一份到服务器，并可在当前页面继续查看、用浏览器打印为 PDF；**关闭或刷新页面后报告无法再次查看，也没有事后查询入口**。
- 管理员后台按测试码列出学生报告，可在线打开并打印；报告与测试码一一对应。
- 一码一人，不能共用；已撤销、已过期或已完成的码不能再用。学生端使用独立的 HttpOnly Cookie，不创建学生账号。
- 详见 [测试码与学校归档说明](docs/test-codes.md)。

### 一次性测试与隐私

- 作答进度、基本信息和报告只保留在当前页面的内存中，不写入 `localStorage`、`sessionStorage` 或任何本机报告库。
- 同一页面内可以返回首页再继续；刷新、关闭标签页或更换设备后，作答进度和报告都不会恢复。
- 报告生成后请立即用「导出 PDF」保存；页面会持续提示关闭或刷新后无法再次查看。
- 测试码提交后完成，不能再用同一个码重新测试；需要重测时请联系老师生成新的测试码。

### 账号与云端（线上测试码模式）

- 线上测评页启用 `mode: 'testcode'`，学生走测试码流程，账号报告入口在测评页隐藏；家长分享、顾问授权、本人改密等独立页面仍按各自入口使用。
- 不自动联网、不自动同步；账号登录后仍需逐份确认上传、读取、更新或删除自己的报告。
- 账号由管理员离线创建，不开放自助注册；忘记密码请联系管理员。详见 [连接指南](docs/cloud-connection.md)。
- **本人改密**：账号安全页验证旧密码后修改密码并撤销本人全部会话。详见 [改密与会话说明](docs/password-change.md)。
- **家长只读分享**：所有者预览确认后生成有期限、可撤销的摘要链接，不含逐题答卷。详见 [分享说明](docs/parent-sharing.md)。
- **账号批注**：邀请已存在的学校账号，仅向其授权一份固定摘要和私有讨论，可到期 / 撤销。详见 [批注说明](docs/family-comments.md)。
- **顾问只读授权**：所有者确认后指定既有 advisor 账号读取一份报告修订，可到期 / 撤销；角色不开放全校权限。详见 [顾问只读授权](docs/teacher-access.md)。
- **顾问文字编辑**：另行确认单报告编辑范围，顾问一次提交所选建议，记录真实操作账号及前后文。详见 [操作及升级回退](docs/advisor-edit.md)。
- **顾问完成度清单**：选择 1–20 份有效授权，预览后导出 21 列校内 CSV；可选 v2（学科表现）或 v3（学生自选专业 / 地区）。详见 [完成度](docs/teacher-summary.md)、[学科](docs/teacher-academic.md)、[偏好](docs/teacher-preferences.md)。
- **建议草稿**：默认关闭，仅有本地模拟与逐段人工确认，未接入真实模型。详见 [草稿说明](docs/advice-drafts.md)。

所有汇总 / 摘要均**不承诺充分匿名、不是正式成绩、不是录取概率、未经过样本校准**。

### 两代测评共存（重要）

| 使用范围 | `legacy-2026.10` | `games-traits-v1`（当前） |
|---|---|---|
| 规划 / 性格 | 14 题、13 必答 / 24 个数字 | 13 题、12 必答 / 30 个对象 |
| 报告 / PDF、本机编辑 | 按原含义支持 | 支持 |
| 云归档、分享、顾问协作与摘要、本地统计 | 可打开；直接上传按旧版存档 | 支持；账号服务写入时换算为旧版兼容字段，读取按存档题数换回当前形状 |

账号服务只保存旧版兼容字段：写请求在顶层带 `assessmentProfile`，当前版本的作答在写入边界换算（30 道特质题 → 旧版 24 题整数，团队竞速 → 节奏与搭档人数）；读取时 30 题的对象作答换回当前形状并带当前标记，旧版 24 题数字原样返回、不带标记。客户端写回时按报告自身版本带上该标记。旧进度保护与备份规则见 [测评版本与保护说明](docs/assessment-profiles.md)。

## 本地运行

运行时不需要 Node.js、数据库或 API 密钥：

```sh
python -m http.server 8765
```

访问 `http://localhost:8765/`。也可以直接打开 `index.html`；页面不在本机保存进度，刷新后从空白首页重新开始。

可选后端（API 开发 / 本地试运行）：

```sh
python -m venv ../bic-account-venv
../bic-account-venv/bin/pip install -r backend/requirements-dev.txt
BIC_DEV=1 BIC_DATABASE_PATH=/绝对路径/网站目录外/accounts.sqlite3 BIC_PUBLIC_ORIGIN=http://127.0.0.1:9001 \
  ../bic-account-venv/bin/python -m backend.bic_api
```

创建账号：

```sh
../bic-account-venv/bin/python -m backend.bic_api.admin --database /绝对路径/accounts.sqlite3 create-user <用户名> --role student
```

密码在终端隐藏输入并二次确认；不要写进命令参数或脚本。创建管理员公共账号时加 `--role advisor`，再用同一个 CLI 交互式设置密码：

```sh
../bic-account-venv/bin/python -m backend.bic_api.admin --database /绝对路径/accounts.sqlite3 create-user tlwl-bic --role advisor
```

开发模式启动 `python -m backend.bic_api.dev`（同样读取上述环境变量，端口 `BIC_PORT`，默认 9001）后，访问它同源提供的页面即可联调，它会即时提供 `enabled: true`、`mode: 'testcode'` 的 `cloud-config.js`，不需改动仓库里的静态文件；浏览器集成测试可用 `BIC_DEV_CLOUD_MODE=account` 暂时沿用普通账号流程。服务默认只监听回环；线上的 `cloud-config.js` 已为 `enabled: true` 并启用测试码模式。接口与配置见 [连接指南](docs/cloud-connection.md)。安装、接口约定与 schema 见 [后端说明](docs/backend.md)。

## 测试

开发测试需 Node.js 22+ 与 Playwright：

```sh
npm install
npx playwright install chromium
npm test            # 前端与浏览器回归（533 项）
BIC_TEST_PYTHON=/var/tmp/bicvenv/bin/python npm run test:cloud   # 后端浏览器集成（19 项；4 个顾问只读/编辑用例在本次基底上原本失败）
/var/tmp/bicvenv/bin/python -m pytest backend/tests -q   # 后端单元与接口（821 项）
```

也可用 `pnpm install --frozen-lockfile` 代替 `npm install`。浏览器测试优先使用 Playwright Chromium，未安装时回退本机 Chrome。测试覆盖评分、空白答卷、题库、编辑历史、一次性测试码、刷新后不保留本机数据、移动端 375px、打印、分享 / 批注 / 顾问权限边界与后端集成。测试数量会随功能增加而变化；验证口径与历史日志见 [验证记录](docs/verification-2026-10-25.md)。

## 目录

| 路径 | 作用 |
|---|---|
| `index.html`、`css/style.css` | 主页面与响应式 / 打印样式 |
| `js/bank.js` | 学术题库（`2026.10`，带难度与版本） |
| `js/plan.js`、`js/majors.js` | 规划题（含 4 个游戏）与专业配置 |
| `js/personality.js`、`js/games.js` | 10 项特质、30 道情境题、计分与 MBTI 对照；互动小游戏 |
| `js/report.js`、`js/report-view.js`、`js/report-print.js` | 按 profile 分派的报告计算、展示与打印 |
| `js/assessment-profile.js`、`js/legacy-assessment.js`、`js/legacy/` | 两代测评识别、固定旧引擎与原始进度保护 |
| `js/app.js` | 流程、路由、测试码门禁与内存中的作答 / 报告 |
| `js/report-editing.js` | 顾问本机编辑与修改记录 |
| `js/report-store.js` | 报告记录的严格校验与序列化（供提交和账号服务使用） |
| `js/cloud-config.js`、`js/cloud-client.js`、`js/cloud-ui.js` | 同源账号连接与主动报告操作（`enabled` 开关） |
| `admin.html`、`js/admin.js`、`css/testcode.css`、`backend/bic_api/test_codes.py` | 一次性测试码、学生报告后台与匿名提交 |
| `account.html`、`js/account.js`、`css/account.css` | 本人改密与全部会话撤销 |
| `share.html`、`js/share-*.js`、`css/share.css` | 摘要生成、所有者分享管理与只读页面 |
| `family.html`、`js/family.js`、`js/comment-owner.js`、`css/family.css` | 受邀账号的私有批注与所有者授权 |
| `teacher.html`、`js/teacher*.js`、`css/teacher.css` | 指定顾问的只读入口与所有者授权管理 |
| `teacher-summary.html`、`js/teacher-summary*.js`、`css/teacher-summary.css`、`backend/bic_api/teacher_summary.py` | 顾问完成度摘要与私密 CSV |
| `advisor-edit.html`、`js/advisor-edit*.js`、`css/advisor-edit.css`、`backend/bic_api/advisor_edit.py` | 单次建议编辑与服务端审计 |
| `js/academic-scoring-meta.js`、`js/preference-schema.js`、`backend/tools/*.cjs` | 计分规则与偏好字典的构建期快照 |
| `js/advice-draft.js`、`backend/bic_api/drafts.py` | 建议草稿（本地模拟） |
| `data/universities.js` | 独立院校目录（62 条，含来源与复核日期） |
| `backend/` | 可选账号 / 报告 API、锁定依赖与 Python 测试 |
| `tests/` | Node 与真实浏览器回归测试（`tests/integration/` 为后端集成） |
| `docs/` | 各模块操作说明、接口口径与验证记录 |

## 院校数据

`data/universities.js` 为独立维护的目录，共 62 条：52 条明确 2027 入学年的课程、2 条未注明入学年的课程、8 条招生或路径政策；另记录 2 条排除项。报告区分具体课程、公布年份、申请周期与政策范围，不把通用资格当作录取线。来源包括 [牛津本科要求总表](https://www.ox.ac.uk/admissions/undergraduate/courses/admissions-requirements/summary-table-of-admissions-requirements)、[牛津计算机](https://www.ox.ac.uk/admissions/undergraduate/courses/course-listing/computer-science)、[牛津数学](https://www.ox.ac.uk/admissions/undergraduate/courses/course-listing/mathematics)、[MIT 测试政策](https://mitadmissions.org/apply/firstyear/tests-scores/)。核对日期 2026-10-24；修改数据无需构建。详见 [院校核验记录](docs/admissions-review-2026-10-24.md)。

## 已知限制

- **登录限流全站共享**：反代后后端看到的客户端都是 `127.0.0.1`，按 IP 20 次/分钟的全站共享配额；同时段集中登录（约 5 人以上）可能触发 429。Argon2 并发上限为 2。
- **无自助注册与找回密码**：只能由管理员建号或联系所有者处理；学生测试码不建立账号，也不支持事后取回报告。
- **测试码是使用流程而非权限系统**：服务端仍以一次性令牌 Cookie 约束加入与提交；真正安全边界在 API，不在前端弹窗。
- **题库与量表未完成外部审校与校准**：能力分数只反映本次题库，推荐指数是规则排序；统计仅用于描述与校准准备。
- **数据库升级需停机备份**：任何可能触发迁移的入口或 CLI 运行前，先停服务并在网站目录外做私有一致备份。步骤见 [顾问编辑说明](docs/advisor-edit.md#schema5升级与回退) 与 [测试码升级说明](docs/test-codes.md)。

## 文档索引

- 团队接手：[开发交接与下一步修改](docs/development-handoff.md)
- 测评版本与保护：[测评版本与保护说明](docs/assessment-profiles.md)
- 测试码与学校归档：[测试码与学校归档说明](docs/test-codes.md)
- 接口与后端：[后端说明](docs/backend.md)
- 验证记录：[验证记录](docs/verification-2026-10-25.md)
- 协作与部署：[CONTRIBUTING.md](CONTRIBUTING.md)
