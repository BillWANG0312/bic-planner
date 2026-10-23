# 学径 Pathwise · 协作与更新说明

> 给同事和 AI 助手看的操作手册。修改本网站前请先读一遍。

## 一、这个项目在哪

| 位置 | 说明 |
|---|---|
| **BIC 网站线上目录** | `/home/bill/nas/bic_website/academic-planner/` |
| **线上访问地址** | http://192.168.100.66:8086/apps/academic-planner/ |
| **GitHub 仓库** | https://github.com/BillWANG0312/bic-planner （**public**） |
| **网站服务** | `/home/bill/nas/bic_website/server.py`，端口 8086，systemd 单元 `bic-website.service` |

**关键事实：线上目录本身就是 GitHub 仓库的克隆（`.git` 就在里面），网站的「部署」就是把文件放进这个目录**——没有构建步骤、没有 CDN，改完文件刷新浏览器即可见效。网页静态文件（`index.html`、`css/`、`js/`、`docs/`）不需要重启服务。

## 二、协作模式（已定）

- **main 分支受保护，必须先开 PR，不能直接 push。**
- 同事和 AI 助手都**不在 main 上直接改**，一律：拉最新 → 开分支 → 改 → 推分支 → 开 PR → 由仓库所有者 BillWANG0312 合并。
- 合并后，服务器上的 cron 会自动把 main 拉到线上目录，**5 分钟内**网站生效。

## 三、自动部署（服务器定时拉取）

| 项目 | 内容 |
|---|---|
| 脚本 | `/home/bill/nas/bic_website/pull_academic_planner.sh` |
| 频率 | cron：`*/5 * * * *` |
| 日志 | `/home/bill/nas/bic_website/academic-planner-pull.log` |
| 行为 | `git fetch` + `git merge --ff-only origin/main`；**工作区有未提交改动时会跳过**（只写日志，不覆盖任何人的文件）；只快进合并，不产生冲突提交 |

查看最近一次是否更新过：

```bash
tail -5 /home/bill/nas/bic_website/academic-planner-pull.log
```

工作区有改动导致跳过时会看到 `skip: working tree has local changes`——说明有人在同一目录直接改了文件没提交，需要先处理。

## 四、修改代码的标准流程（人和 AI 都照做）

```bash
cd /home/bill/nas/bic_website/academic-planner

git fetch origin
git checkout main
git merge --ff-only origin/main       # 拉取同事已合并的最新代码

git checkout -b fix/简短描述           # 永远新开分支，例如 fix/mobile-topbar
# ……修改文件……

git add -A
git commit -m "类型: 说明改了什么"
# 提交信息末尾加：Co-Authored-By: Claude Code <noreply@anthropic.com>（AI 提交时）

git push -u origin fix/简短描述        # 需要 GitHub 凭据
```

然后在 GitHub 上：打开分支对比页 → **Compare & pull request** → 填说明 → **Create pull request** → 等 BillWANG0312 审批 → **Merge**。

### 几个硬性注意点

1. **绝不在本地 main 上提交**。本地 main 应当是“只拉不推”的干净分支；一旦本地 main 有提交，自动拉取会因分叉而无法快进，必须先 rebase 或重置。
2. **提交前把改动做完就提交**。工作区长期挂着未提交改动，会让 cron 拉取一直跳过，同事的更新就上不了线。
3. **不要提交的**：`.DS_Store`、`._*`、`*.bak_*`（已在 `.gitignore`）；任何 token、密码。
4. 只改网页静态文件即可上线；若改了 `server.py` 或 `apps.json`，需要 `sudo systemctl restart bic-website`（或 `/home/bill/nas/bic_website/stop.sh && start.sh`）。

## 五、GitHub 凭据

- 仓库是 public，**拉取/克隆不需要任何凭据**。
- **推送才需要 token**（Fine-grained PAT，需有该仓库 Contents: Read and write 权限）。用户名用 `x-access-token`。
- 本机若已通过 `git credential approve` 把 token 存进 `~/.git-credentials`（配置 `credential.helper=store`），直接 `git push` 即可。
- **不要**把 token 写进 remote URL、脚本、文档或聊天记录。token 失效时由 BillWANG0312 重新签发。
- 如果 AI 助手无法推送，就由 AI 完成「分支 + 提交」，并把要执行的 `git push -u origin <分支名>` 命令交给 BillWANG0312 在自己终端执行。

## 六、GitHub 设置（由仓库所有者操作）

- **Settings → Collaborators**：添加同事的 GitHub 用户名，对方接受邀请后即可推送分支、开 PR。
- **Settings → Branches → Add classic branch protection rule**（或 Rules → Rulesets）：
  - Branch name pattern：`main`
  - 勾选 **Require a pull request before merging**，Required approvals 设为 1
  - 建议勾选 **Do not allow bypassing the above settings**、**Dismiss stale approvals**
  - 不勾选 Allow force pushes / Allow deletions

## 七、本地备份

每次大改前保留一份线上目录快照，例如：

```bash
tar czf ~/bic_website_academic-planner_backup_$(date +%Y%m%d%H%M%S).tar.gz \
  -C /home/bill/nas/bic_website academic-planner
```

回滚线上版本：`git reset --hard <提交号>`（只影响本地，不会回滚 GitHub）。

## 八、常见问题

| 现象 | 原因 / 处理 |
|---|---|
| `git push` 报 `GH006: Protected branch update failed` | main 已被保护，属正常。请推到分支并开 PR |
| `! [rejected] ... fetch first` | 远端有更新，先 `git pull --rebase origin main`（在分支上） |
| 改了网站但网页没变 | 检查 cron 日志是否 `skip`；浏览器强制刷新（Ctrl+Shift+R） |
| `git merge --ff-only` 报 `Not possible to fast-forward` | 本地分支有了自己的提交且与远端分叉，改用 rebase 或重置本地 main |
| 不知道线上跑的是哪个版本 | `cd /home/bill/nas/bic_website/academic-planner && git log --oneline -1` |
