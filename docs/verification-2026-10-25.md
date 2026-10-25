# v1.16.0本地验证记录（2026-10-25）

本记录用于交接与复现，不是GitHub CI、生产上线或真实学生样本认证。业务实现为 `7f48452`、`4f3d7d5`，最终样式修复为 `83bc637`，基于main `6f8687217945b874de3cfda30ea0e37d0262e673`。随后交接整理只改文档，没有新增业务功能。

## 实际结果

| 验证 | 结果 | 原始日志 |
|---|---|---|
| 完整Node/Chromium前端与模拟协议 | 574通过，0失败 | `profile-frontend-final.log` |
| 完整Python后端 | 770通过，1跳过，1警告；另94个参数子案例通过 | `profile-backend-full.log` |
| 真实Chromium→本地FastAPI/SQLite | 33通过，0失败 | `profile-api-integration-final.log` |
| 最终保护栏样式调整后定向复验 | 原22项续答UI、3项真实profile集成再次通过 | `profile-notice-css-green.log`、`profile-notice-api-final.log` |
| 源码与静态ZIP解压验证 | 四生成器一致、file离线、新旧备份/源数据/actor往返、旧云接受/新版拒绝、API2/schema5 | `verification-package.log` |

完整回归合计1377项；94个参数子案例和样式复验未重复计入。Windows跳过项为符号链接权限限制，其余路径边界独立验证；警告为既有Starlette/httpx测试客户端弃用提示。最终样式变化仅作用于 `#profileNotice`，没有变更业务代码。后续测试数量会随新增功能变化，不应删测试来维持本表数字。

全部使用虚构账号、答卷和临时数据库。原始日志在开发目录的 `test-results/` 和交付目录内，未跟踪进Git；交付包有 `verification-status.json`、`checksums.json`、`SHA256SUMS.txt`，可核对源码提交和文件哈希。仓库中的测试是复现依据，日志文件名仅定位已保存的本地证据，不是GitHub网页链接。

## 重点覆盖了什么

- 原引擎对照：空白/部分/完整/中立旧答卷，14/13/24口径、自由科目、顾问history/actor、编号/日期与学术0/null；新版游戏/特质引擎保持。
- 原始数据：旧续答打开、导航、离开、刷新和取消时原JSON字节不变；确认原版才启用写入；读取失败不覆盖；未知/混合/已转换资料只保留恢复与确认重测。
- 归档：旧v1、新v2、混合库、短数组/null和字段原样往返；非法JSON值、损坏整批、重复/跨profile覆盖、容量和存储失败拒绝；新/混合库不套旧CSV。
- 账号边界：新版/稀疏游戏证据/派生专业在旧客户端发送前拒绝；旧API仍严格拒绝；旧云/分享/批注/顾问/摘要流程继续使用旧合同，原报告保持。
- 改密：原密码验证、本人全会话撤销、并发事务/CAS和失败回滚、旧登录竞态、跨账号/Cookie变化、128个非BMP字符、未知结果不重试。
- 权限与导出：期限/撤销/启用/角色/源修订、只读不扩权、预览及确认前后快照/身份/模式变化、取消与迟到响应、CSV文本保护和私密字段白名单。
- 解压后：默认配置关闭、375px/file页面零HTTP/WebSocket、无页面错误，源码API私有路径404、旧记录保持，新创建/更新422，schema5/API2保持。

## 如何复跑

从仓库根目录操作，前端需Node.js 22+和Playwright，后端需Python 3.12及开发依赖。安装步骤见 [README](../README.md#开发验证) 和 [后端说明](backend.md#安装与本地试运行)。使用自己的开发环境，勿指向公司数据库；以下 `python` 应是已安装后端依赖的虚拟环境解释器。

```powershell
# 完整前端；限制并发，避免浏览器争用。
node --test --test-concurrency=2 tests/*.test.cjs

# 完整后端；测试自行使用临时虚构资料。
python -m pytest backend/tests -q

# 真实浏览器到本地API；不是线上测试。
$env:BIC_TEST_PYTHON = (python -c "import sys; print(sys.executable)")
node --test --test-concurrency=1 tests/integration/*.test.cjs

# 只检查快照，检查失败应先分析版本/规则变化。
node backend/tools/legacy-assessment.cjs --check
node backend/tools/assessment-schema.cjs --check
node backend/tools/academic-scoring.cjs --check
node backend/tools/preference-schema.cjs --check

python -m pip check
git diff --check
```

本次实际解释器为Python 3.12.14，Node.js 24，Playwright 1.62.1。Windows实际临时目录使用 `D:/Codex/work/bic-backend-temp`，Python环境为 `D:/Codex/work/bic-planner-backend-venv`；部分真实集成脚本使用D:/Codex临时根，其他设备须先准备或调整对应测试路径，并在日志中记录环境差异；不要指向真实学生库。未运行、缺依赖或中断不能记为通过。

## 失败记录与验证边界

合并游戏/特质更新后的首次全站回归曾有84项失败，具体源数据/合同断层见 [兼容性记录](upstream-assessment-compatibility.md)。本阶段首次完整前端为535通过/22失败，保留 `profile-frontend-first-attempt.log`；逐项修复原义、夹具合同、脚本依赖与真实缺陷后，完整558项通过，最后补最小客户端16项边界并完整重跑574项通过。没有把失败日志删掉，也没有以重生成旧快照替代版本兼容。

两次独立模块审查、最终客户端复核、桌面/375px截图与解压检查均已完成。JS语法、Python编译、依赖一致性、四生成器与文档本地链接检查通过。当前PR未显示GitHub CI检查结果，以上是本地执行证据。

新版严格云归档、其后的分享/摘要/统计合同仍待实现；目前验证的是这些未支持入口明确拒绝，不能据此声称它们可用。生产部署、可信代理/多worker限流/容量、真实AI、题库人工审校、真实样本校准/常模/A/B均未在本次完成。
