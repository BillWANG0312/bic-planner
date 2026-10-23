**BIC 学业规划系统**（BIC Academic Planner）是一个纯静态的 A-Level 学术规划互动测试网站，面向 8–10 年级 A-Level 体系新生。

在线访问：[https://tlwl-bic.com/academic-planner/](https://tlwl-bic.com/academic-planner/)　

三大互动模块：

- **学术能力测试**（30 题：英语 / 数学 / 物理 / 化学，数学与理科题附中文翻译）
- **专业规划测试**（14 题：学科强弱、兴趣、留学偏好等）
- **简版 MBTI**（24 题，5 级量表，16 型解析）

完成后由规则引擎自动生成学术规划报告：学科能力分析（含逐题解析附录）、未来升学路径规划（A-Level 选科、留学地区、目标院校分档、时间线）、性格特点解析。支持一键导出 / 打印 A4 PDF（8 页）。

答题进度自动保存在浏览器本地，刷新或关闭后可从上次的位置继续。

## 运行

无需构建、无需后端：

```bash
python3 -m http.server 8765   # 然后打开 http://localhost:8765/
```

也可以直接双击 `index.html`。

## 目录

| 文件 | 说明 |
|---|---|
| `index.html` | 页面骨架（首页 / 基本信息 / 测试容器 / 生成中 / 报告） |
| `css/style.css` | 视觉样式、响应式与打印样式 |
| `js/bank.js` | 学术题库（科目、知识点、中文翻译、解析） |
| `js/plan.js` | 专业规划题与配置 |
| `js/mbti.js` | 简版 MBTI 量表与 16 型画像 |
| `js/majors.js` | 专业方向与院校库 |
| `js/report.js` | 规则引擎：答题数据 → 结构化报告 |
| `js/report-view.js` | 报告 HTML 渲染 |
| `js/app.js` | 交互流程、状态保存、PDF 导出 |
| `docs/deliverable.html` | 交付说明：用户流程、页面结构、规则映射、下一步建议 |
