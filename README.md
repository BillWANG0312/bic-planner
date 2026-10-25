# BIC 学业规划系统

默认纯静态的 A-Level 学术规划互动测评，面向 8–11 年级学生。另提供可选的账号与服务端报告连接，默认关闭，尚未部署公司生产环境。线上地址：[BIC Academic Planner](https://tlwl-bic.com/academic-planner/)。更新须通过 PR，由所有者合并；本地修改不代表线上已经更新。

当前集成状态（v1.16.0）：旧档案原义、续答保护和新旧profile隔离已恢复，完整回归1377项通过。新游戏/30题特质仍可在本机使用及JSON备份；其云归档、分享和汇总尚未适配，入口明确拒绝。既有云端及摘要功能继续处理旧版14/13/24合同。操作见 [测评版本与保护说明](docs/assessment-profiles.md)，历史问题与后续见 [兼容性记录](docs/upstream-assessment-compatibility.md)。

## 本地版功能

- 学术测评：60 题，英语 / 数学 / 物理 / 化学各 15 题，基础、中等、进阶分层；数学与理科有中文翻译和解析。
- 专业规划：13 题（12 道必答 + 1 道选填），结合兴趣、自评学科、职业与地区偏好推荐探索方向。其中 4 个是互动小游戏：校园匹配（把学科卡片拖进「喜欢 / 想试试 / 不想学」）、职业飞镖（点选最想命中的方向）、星球排序（把专业拖到「心动 / 观望 / 排除」）、组队赛跑（选择节奏与搭档）。卡片可以拖拽，也可以先点卡片再点格子；键盘与读屏同样可操作。
- 性格特质测评：30 道情境题，围绕分析、创造、共情、沟通、组织、执行、好奇、抗压、数字、规则 10 项与职业发展相关的特质。报告给出特质画像、优势组合与培养建议，而不是判定某个 MBTI 类型；MBTI 四维倾向仅作对照展示。游戏选择也会作为额外信号计入画像。未完成时显示待完成；各特质得分接近时显示倾向均衡，不给出单一「XX 型」结论。
- 报告：展示作答完成度、学科表现、选科与专业建议，未完成时为探索草稿。
- 顾问编辑：在报告页点击「编辑建议」，填写编辑者，选择四处建议文字之一编辑；保存修改前后内容，可恢复旧内容。重新生成时保留顾问修改并提示复核。
- 本地续答：同一浏览器可关闭后继续；保存不可用时提示仍可在当前页面使用。保留一个当前学生进度，重新测试需确认并清空当前记录，已归档报告不受影响。
- 本机报告库：可主动归档最多 100 份学生报告，按姓名/编号搜索，导出或导入 JSON 备份；纯旧库可下载原CSV，新或混合库使用JSON。重复替换需明确选择；配额或损坏数据不会静默覆盖原库。详见 [使用与恢复说明](docs/report-library.md)。
- 可选账号连接：开通同源服务后主动登录，逐份确认上传、读取/打开自己的报告，按已读修订更新或删除。默认不联网、不自动同步，详见 [连接指南](docs/cloud-connection.md)。
- 本人账号安全：独立账号安全页验证旧密码、确认新密码后撤销本人所有会话，需主动重新登录；结果未知不自动重试，详见 [改密与会话说明](docs/password-change.md)。
- 家长只读分享：所有者预览并确认后生成有期限的摘要链接，可撤销；不包含逐题答卷和修改审计，不提供匿名写入。详见 [分享与升级说明](docs/parent-sharing.md)。
- 账号批注：所有者邀请已存在的学校账号，只向该账号授权一份固定摘要和私有讨论，可到期/撤销；批注独立于成绩和建议，普通只读令牌不能写。详见 [批注说明](docs/family-comments.md)。
- 顾问只读：所有者预览完整答卷及修改历史范围并确认后，指定既有advisor账号读取这一报告修订；可到期/撤销，报告更新需重授。角色不开放全校权限，家长权限不扩权，详见 [顾问只读授权](docs/teacher-access.md)。
- 顾问文字编辑：所有者另行确认单报告编辑范围与四段文字基线，指定既有顾问一次提交所选建议，记录实际登录账号及前后文；原只读权限不扩权，答卷、成绩、身份不改。详见 [操作及schema5升级回退](docs/advisor-edit.md)。
- 顾问完成度清单：逐份选择1–20个有效只读授权，核对必要摘要后预览21列校内CSV；导出前和确认后复查权限/修订，失效整批停止，不读取或导出原始答卷。含姓名/编号，不能称匿名或成绩汇总，详见 [字段及操作](docs/teacher-summary.md)。
- 可选学生自选偏好摘要：独立勾选后使用v3，纯偏好27列、合并学科35列；仅学生明确选择的12类专业意向与8类地区，区分缺答、不确定及多选，不输出规则推荐或自由文本，详见 [口径及模式](docs/teacher-preferences.md)。
- 可选学科表现摘要：明确勾选后使用v2/29列，仅完整科目显示同版本题库答对百分比，未完整不当0分；附规则版本/指纹，前后端不一致或模式变化停止旧导出。默认v1不变，不是正式成绩或预测，详见 [计分及版本说明](docs/teacher-academic.md)。
- 可选建议草稿：已读服务端报告可主动预览四段建议、逐段核对并确认应用，保留核对人及来源。默认关闭并保留原建议；本地模拟可演示流程，尚未接入真实模型。详见 [草稿接口与人审说明](docs/advice-drafts.md)。
- 本地汇总：主动选择同题库版本的10–100份本机报告，核对来源和每人一份后预览四科与逐题统计，再确认导出去标识JSON；默认保留纯学术v1。可明确勾选 [专业与地区扩展](docs/planning-statistics.md) 输出v2，区分完整报告的规则推荐与学生多选偏好，罕见计数及其补集整表隐藏。不联网或改阈值，不承诺充分匿名或真实校准，详见 [学术汇总说明](docs/academic-statistics.md)。
- 后续成绩配对：主动导入单科校内百分制JSON、选择报告、手动配对并声明实际测评日期，检查两类缺失与时间顺序；预览后只导出必要聚合。编号/逐条成绩仅留内存，离开清除，不自动按姓名匹配或改能力阈值。详见 [配对与描述复核](docs/outcome-review.md)。
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
| `js/personality.js`、`js/games.js` | 特质模型（10 项特质、30 道情境题、计分与 MBTI 对照）与互动小游戏 |
| `js/report.js`、`js/report-view.js` | 按profile分派的报告计算与展示 |
| `js/assessment-profile.js`、`js/legacy-assessment.js`、`js/legacy/` | 两代识别、固定旧引擎与原始进度保护 |
| `js/report-editing.js` | 顾问编辑与本地修改记录 |
| `js/report-store.js`、`js/report-library.js` | 本机多报告管理、严格备份导入与 CSV 汇总 |
| `js/report-statistics*.js`、`css/statistics.css` | 明确选择的本地学术/专业/地区聚合、预览导出与未校准状态 |
| `js/outcome-review*.js`、`css/outcomes.css` | 本地后续成绩导入、人工配对/日期检查与必要描述聚合 |
| `js/report-print.js` | 打印展开与恢复 |
| `js/app.js` | 流程与本地持久化 |
| `js/cloud-config.js`、`js/cloud-client.js`、`js/cloud-ui.js` | 默认关闭的同源账号连接与主动报告操作 |
| `account.html`、`js/account.js`、`css/account.css` | 主动连接的本人改密、确认与全部会话撤销 |
| `share.html`、`js/share-*.js` | 严格摘要生成、所有者分享管理与独立只读页面 |
| `family.html`、`js/family.js`、`js/comment-owner.js` | 受邀账号的私有批注、所有者授权与回复 |
| `teacher.html`、`js/teacher*.js`、`css/teacher.css` | 指定顾问的独立只读入口与所有者授权管理 |
| `advisor-edit.html`、`js/advisor-edit*.js`、`backend/bic_api/advisor_edit.py` | 另行授权的单次建议编辑、服务端账号审计与schema5迁移 |
| `teacher-summary.html`、`js/teacher-summary*.js`、`backend/bic_api/teacher_summary.py` | 明确选择授权报告的必要完成度摘要、预览与私密CSV导出 |
| `backend/tools/academic-scoring.cjs`、`backend/bic_api/academic_scoring.py`、`js/academic-scoring-meta.js` | 可选v2计分快照、安全元数据与仅完整科目的当前规则表现 |
| `js/advice-draft.js`、`backend/bic_api/drafts.py` | 可选文案草稿、规则回退、私有预览与逐段人工确认 |
| `backend/tools/preference-schema.cjs`、`backend/bic_api/preference_summary.py`、`js/preference-schema.js` | 可选v3固定专业/地区字典与学生原选择投影 |
| `tests/` | Node 与真实浏览器回归测试 |
| `backend/` | 可选的独立账号/报告 API、锁定依赖及 Python 回归测试 |
| `docs/local-release-plan.md` | 本次范围与验收 |
| `CONTRIBUTING.md` | 原仓库协作与部署流程 |

账号、服务端保存、显式连接、家长摘要/批注、指定顾问跨用户只读与另行授权的文字编辑、可选文案草稿及本地统计/后续成绩人工配对已完成本地验证；学生自选专业/地区跨报告摘要已完成；规则推荐跨报告扩展、公司正式部署和真实 AI 服务尚未完成。统计仅为描述复核/校准准备，真实样本、阈值拟合/外部验证、常模和A/B事件尚未完成。数据库已知v1/v2/v3/v4升级到schema5前，任何新版入口/账号CLI运行前都需停服务私有备份，详见顾问编辑说明。
