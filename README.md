# BIC 学业规划系统

默认纯静态的 A-Level 学术规划互动测评，面向 8–11 年级学生。另提供可选的账号与服务端报告连接，默认关闭，尚未部署公司生产环境。线上地址：[BIC Academic Planner](https://tlwl-bic.com/academic-planner/)。更新须通过 PR，由所有者合并；本地修改不代表线上已经更新。

## 本地版功能

- 学术测评：60 题，英语 / 数学 / 物理 / 化学各 15 题，基础、中等、进阶分层；数学与理科有中文翻译和解析。
- 专业规划：14 题，结合兴趣、自评学科、职业与地区偏好推荐探索方向。
- 简版 MBTI：24 题。未完成时显示待完成，不生成确定的人格画像；全中立作答显示倾向均衡。
- 报告：展示作答完成度、学科表现、选科与专业建议，未完成时为探索草稿。
- 顾问编辑：在报告页点击「编辑建议」，填写编辑者，选择四处建议文字之一编辑；保存修改前后内容，可恢复旧内容。重新生成时保留顾问修改并提示复核。
- 本地续答：同一浏览器可关闭后继续；保存不可用时提示仍可在当前页面使用。保留一个当前学生进度，重新测试需确认并清空当前记录，已归档报告不受影响。
- 本机报告库：可主动归档最多 100 份学生报告，按姓名/编号搜索，导出或导入 JSON 备份、下载 CSV 汇总。重复替换需明确选择；配额或损坏数据不会静默覆盖原库。详见 [使用与恢复说明](docs/report-library.md)。
- 可选账号连接：开通同源服务后主动登录，逐份确认上传、读取/打开自己的报告，按已读修订更新或删除。默认不联网、不自动同步，详见 [连接指南](docs/cloud-connection.md)。
- 家长只读分享：所有者预览并确认后生成有期限的摘要链接，可撤销；不包含逐题答卷和修改审计，不提供匿名写入。详见 [分享与升级说明](docs/parent-sharing.md)。
- 账号批注：所有者邀请已存在的学校账号，只向该账号授权一份固定摘要和私有讨论，可到期/撤销；批注独立于成绩和建议，普通只读令牌不能写。详见 [批注说明](docs/family-comments.md)。
- 可选建议草稿：已读服务端报告可主动预览四段建议、逐段核对并确认应用，保留核对人及来源。默认关闭并保留原建议；本地模拟可演示流程，尚未接入真实模型。详见 [草稿接口与人审说明](docs/advice-drafts.md)。
- PDF：点击「导出 PDF」，在打印窗口选择另存为 PDF。逐题解析自动展开，打印后恢复。页数按内容长度变化。

预计完整测评约 35–45 分钟。题库版本 `2026.10`；新增题目为待学科老师审校的题库草稿，难度标签是编辑分层，尚未经过学生样本校准。能力分数仅反映本次题库，不是 A-Level 成绩预测；推荐指数为规则排序，不是录取概率。

## 运行

无需构建、数据库、账号或 API 密钥。可直接打开 `index.html`，或：

```sh
python -m http.server 8765
```

然后访问 `http://localhost:8765/`。本地进度按浏览器和网址保存，直接打开文件与通过 HTTP 访问的进度不共享。请在原来的网址和浏览器续答。

可选后端使用 Python 3.12、FastAPI、SQLite 与 Argon2，支持操作员创建账号、会话、账号隔离、修订冲突和配额保护。服务默认仅监听回环，数据库在网站目录外。前端配置默认关闭，需开通服务并由用户主动连接和确认上传。本地同源入口为 `python -m backend.bic_api.dev`，配置见 [连接指南](docs/cloud-connection.md)，安装/API 与上线依赖见 [后端说明](docs/backend.md)。

## 院校数据

`data/universities.js` 是独立维护的数据目录，包含专业、学校、地区、参考年份、官网来源与复核日期。已逐条处理原型历史记录，目录现有 62 条：52 条明确 2027 入学年的课程、2 条未注明入学年的具体课程要求、8 条招生或路径政策。报告区分具体课程、公布年份、申请周期与政策范围；未将通用资格或路径信息当作完整的课程录取线。修改数据即可更新，无需构建。详细来源、移除记录与未核实范围见 [院校核验记录](docs/admissions-review-2026-10-24.md)。

来源包括 [牛津本科要求总表](https://www.ox.ac.uk/admissions/undergraduate/courses/admissions-requirements/summary-table-of-admissions-requirements)、[牛津计算机](https://www.ox.ac.uk/admissions/undergraduate/courses/course-listing/computer-science)、[牛津数学](https://www.ox.ac.uk/admissions/undergraduate/courses/course-listing/mathematics)、[MIT 测试政策](https://mitadmissions.org/apply/firstyear/tests-scores/)。核对日期 2026-10-24；课程与申请年份需分别核实。

## 开发验证

运行时不需要 Node.js。开发测试使用 Node.js 22+ 与 Playwright：

```sh
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm test
```

也可 `npm install` 后执行 `npx playwright install chromium`、`npm test`。浏览器测试优先使用 Playwright Chromium，未安装时尝试本机 Chrome。测试覆盖评分、空白答卷、题库、编辑历史、存储异常、续答、移动端、打印和完整流程。

## 目录

| 文件 | 作用 |
|---|---|
| `index.html`、`css/style.css` | 页面与响应式 / 打印样式 |
| `js/bank.js` | 带难度与版本的学术题库 |
| `data/universities.js` | 独立院校目录与复核信息 |
| `js/majors.js`、`js/plan.js`、`js/mbti.js` | 专业配置、规划题与性格量表 |
| `js/report.js`、`js/report-view.js` | 报告计算与展示 |
| `js/report-editing.js` | 顾问编辑与本地修改记录 |
| `js/report-store.js`、`js/report-library.js` | 本机多报告管理、严格备份导入与 CSV 汇总 |
| `js/report-print.js` | 打印展开与恢复 |
| `js/app.js` | 流程与本地持久化 |
| `js/cloud-config.js`、`js/cloud-client.js`、`js/cloud-ui.js` | 默认关闭的同源账号连接与主动报告操作 |
| `share.html`、`js/share-*.js` | 严格摘要生成、所有者分享管理与独立只读页面 |
| `family.html`、`js/family.js`、`js/comment-owner.js` | 受邀账号的私有批注、所有者授权与回复 |
| `js/advice-draft.js`、`backend/bic_api/drafts.py` | 可选文案草稿、规则回退、私有预览与逐段人工确认 |
| `tests/` | Node 与真实浏览器回归测试 |
| `backend/` | 可选的独立账号/报告 API、锁定依赖及 Python 回归测试 |
| `docs/local-release-plan.md` | 本次范围与验收 |
| `CONTRIBUTING.md` | 原仓库协作与部署流程 |

账号、服务端保存、显式连接、家长只读摘要、受控账号批注和可选文案草稿流程已完成本地验证；公司正式部署、教师跨用户授权与真实 AI 服务尚未接入。数据库已知 v1/v2 升至 v3 前需私有备份，详见批注说明；文案草稿阶段沿用 v3。
