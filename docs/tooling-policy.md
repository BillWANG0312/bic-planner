# Skill与MCP使用约定

用户要求优先原生能力；需要第三方skill时，仅考虑GitHub高star来源，不安装只有少量star的skill。工具必须解决当前任务的具体缺口；已有能力足够时不增加安装项。

## 2026-10-26本轮核对

本轮使用已安装的设计、领域术语、测试和审查skills，未新增安装。通过GitHub仓库API读取star数，并逐字比较本机SKILL.md与上游默认分支，以下五份均一致：

| 来源 | 读取时star数 | 本轮使用 |
|---|---:|---|
| [mattpocock/skills](https://github.com/mattpocock/skills) | 303,625 | codebase-design、domain-modeling |
| [obra/superpowers](https://github.com/obra/superpowers) | 305,303 | test-driven-development、requesting-code-review、verification-before-completion |

数字是本次读取快照，之后会变化。源文件分别位于前者 `skills/engineering/`、后者 `skills/`。核对结果保留在本机 `test-results/skill-provenance-20261026.json`，没有读取或输出凭据。

现有GitHub连接、Git/本机运行工具和浏览器测试能力足够本轮合同/策略开发，未发现必须新增MCP的缺口，未额外开服务或创建密钥。

## 后续安装前

1. 先说明现有工具缺少哪项具体能力，优先查原生或官方插件。
2. 对第三方skill核实高star仓库、具体路径、维护状态、许可和安装脚本；不能只凭名称或一个转载页面判断来源。低star或来源不明时使用现有工具完成，不为安装而安装。
3. 限定安装和运行权限；检查是否会执行远程脚本、读取浏览器/凭据或外传资料。项目源码、临时文件和交付仍优先D:/Codex，不将密钥、学生资料或工具缓存写入Git。
4. 记录来源、读取日期、采用的版本/提交和实际用途。团队能据此复核，也能在工具不再需要时移除。

用户本次对必要skill/MCP安装的授权继续有效，常规安装不额外请求确认；付费、凭据创建、真实学生资料外发和生产变更仍按已有约束处理。
