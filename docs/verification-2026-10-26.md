# v1.17.0架构基础验证（2026-10-26）

本轮基于main `6d533f0830ed30e843f58c373a1c25bff9ed7681`，PR #8已由所有者合并；新分支为 `feat/versioned-assessment-architecture`。范围是独立新版合同、中央操作策略、认证能力发现和旧投影边界；CURRENT的全部业务操作仍关闭，不代表新版云端CRUD已完成。

## 最终执行结果

| 检查 | 结果 | 原始日志 |
|---|---|---|
| 完整Node/Chromium与模拟协议 | 591通过，0失败 | `architecture-frontend-final.log` |
| 完整Python后端 | 885通过，1跳过，1警告；另94个参数子案例通过 | `architecture-backend-final.log` |
| 真实Chromium→本地FastAPI/SQLite | 36通过，0失败 | `architecture-api-integration-final.log` |
| 当前Chromium题序与量表文字 | 与Node生成的有序合同一致，file页面零HTTP | `architecture-browser-order-check.log` |
| 独立审查 | 两个重要合同问题已TDD修正，其余服务授权边界无阻断 | `architecture-policy-independent-review.log`、`architecture-current-*-independent-review.log` |

完整主套件共1512项，94子案例未重复计入。Windows符号链接权限限制导致1项跳过，另1条为既有Starlette/httpx测试客户端弃用提示。没有真实学生样本、生产部署、真实模型请求或GitHub CI通过声明。

## 覆盖的关键行为

- 新模型与真实JS ReportStore的空白/部分/完整档案对照，保留0/null、字段省略、空数组、短量表、ms省略/null/有限数、自由科目及顾问history/actor；拒绝非法枚举、重复/超容量、未知字段和混合版本。
- 合同固定有序30题、量表value/label、规划问句/选项含义、游戏解释与信号映射；规范语义指纹与LF源码溯源分开。17项生成器行为用例覆盖同profile含义/题序变化、CRLF、无语义来源变化、锚丢失/坏锚/冲突锚及首次初始化限制。
- 既有旧模型与三份旧快照保持；坏新合同延迟失败，不阻止旧接口导入或操作。新cap返回安全503，不回显文件内容。
- 每个固定操作检查两profile、未知/无标记新版/混合/嵌套标记。新模型可校验不等于可执行业务；CURRENT的operations为空，旧owner API仍拒绝新版创建/更新，schema5/API2保持。
- 手造旧ShareContent不能为CURRENT新建家长分享或批注邀请；所有者/角色/源修订核对保持在策略之前，拒绝无新快照/授权/审计写入。既发legacy快照/受邀线程读写沿用原期限/撤销，撤销后拒绝。
- 能力发现仅在明确调用时发生，默认页面/登录没有新探测；匿名/过期/停用会话拒绝，带旧CSRF的换Cookie页面403，响应no-store且无学生/凭据。健康接口保持原响应。

## 发现、修复及保留的失败

首次完整前端578项和真实API36项通过，后端884通过/1失败。失败为 `test_comment_models.py::test_snapshot_builder_does_not_silently_drop_private_content_or_accept_missing_metadata`：guard前置改变了缺元数据的旧ValueError合同。已移到元数据抽取之后、创建snapshot之前，原断言和96项相关测试通过，再完整重跑885项通过。首次日志保留为 `architecture-backend-first-attempt.log`。

独立审查复现两个P2：同value的量表label反转未改变指纹；删除私有快照但保留旧公开meta后，普通生成可重定义同profile。均先观察失败，再扩展语义含义及双锚校验；两产物都缺时普通生成拒绝，`--init`只允许首次引入新profile，已发布版本恢复须从Git取回基线。本轮未交付草稿已备份后重新首次生成，未改真实学生JSON或数据库版本。修复后新增13项Node行为回归，主套件最终591项通过。

真实cap测试先观察旧接口404；首次实现后2过/1失败是测试退出请求漏application/json（415），修正夹具后3项通过，未放宽现有请求边界。独立审查最初系统Python缺后端依赖，改用既有开发venv后通过，没有向系统环境安装。各次RED、首次失败和最终GREEN日志保留，不把中断或缺依赖记为通过。

## 复跑命令

安装及环境前提沿用 [前次验证记录](verification-2026-10-25.md#如何复跑)；以下python应为已装后端开发依赖的Python 3.12虚拟环境。测试只用临时虚构资料，Windows默认D:/Codex路径需存在或调整对应测试根。

```powershell
node --test --test-concurrency=2 tests/*.test.cjs
python -m pytest backend/tests -q
$env:BIC_TEST_PYTHON = (python -c "import sys; print(sys.executable)")
node --test --test-concurrency=1 tests/integration/*.test.cjs

node backend/tools/legacy-assessment.cjs --check
node backend/tools/assessment-schema.cjs --check
node backend/tools/academic-scoring.cjs --check
node backend/tools/preference-schema.cjs --check
node backend/tools/current-assessment-schema.cjs --check
python -m pip check
git diff --check
```

当前games-traits-v1已有基线，不要运行 `--init` 作为修复/升级手段。同profile语义变化须新profile，合同或公开锚丢失应从Git恢复。当前Node/Chromium题序一致未替代Firefox/Safari验证；跨浏览器稳定ID/题序策略仍是下一段上云前提，见 [架构说明](architecture-overview.md#上云前还要核对浏览器题序)。

主要交付目录为 `D:/Codex/outputs/bic-planner-20261026-architecture`，聊天下载副本为outputs/architecture-20261026。源码/静态ZIP、实际日志、来源核对及SHA256随包保存；解压验证记录在 `verification-package.log`。测试和说明在Git，原始日志/临时数据库不混入源码。
