# 项目基线

每个项目都达到同一条基线：版本固定、agent 说明、验收说明。新项目开工时一次建好；老项目在下一次改动它时补齐，不做批量翻新。

## 基线文件

| 文件 | 内容 | 是否提交 |
| --- | --- | --- |
| `mise.toml` | 固定运行时版本。node 默认 24（LTS），部署（Dockerfile、CI、托管平台）要求别的版本就跟部署一致；python 默认 3.12。只写真正用到的工具 | 提交 |
| `AGENTS.md` | 给 agent 的项目说明：一句话目标、目录结构、常用命令（安装 / 开发 / 构建 / 测试）、版本来源（指向 `mise.toml`）、项目特有约束。`CLAUDE.md` 只放一行 `@AGENTS.md`，不维护第二份 | 提交 |
| `.agents/acceptance/PROJECT.md` | 验收适配层：怎么启动、端口、账号、界面入口，写法见 [project-adapter.md](project-adapter.md) | 提交 |
| `.agents/acceptance/common-mistakes.md` | 本项目被打回过的问题，第一次有打回时再建 | 提交 |
| `.agents/guards/run.mjs`（或同等脚本） | 架构守卫：把本项目最重要的几条结构规则写成秒级检查，违反即失败；已有例外用基线清单做棘轮，只减不增。挂到 `npm run guard`、pre-commit（`.githooks/`，`git config core.hooksPath .githooks`）与 CI | 提交 |
| CI（`.github/workflows/ci.yml` 或 Gitea Actions） | 用 mise 安装固定版本，依次跑依赖安装、守卫、类型检查、测试；昂贵的端到端只在高风险目录改动时触发 | 提交 |

锁文件（`package-lock.json`、`pnpm-lock.yaml`、`uv.lock`）照常提交。一个项目只用一种包管理器，不同时留两份锁文件。

## 新项目

1. 位置：个人项目放 `~/Devs/<name>`，工作项目放 `~/Job/<name>`。同一项目的额外检出和 git worktree 放 `~/Devs/.worktrees/<name>/<branch>`，不和主项目并排。
2. `git init`，第一时间写 `.gitignore`（依赖目录、构建产物、`.env*`、`.acceptances/` 之类的本地产物）。
3. `mise use node@24`（或 `python@3.12`），生成 `mise.toml`，`mise trust` 后确认 `mise exec -- node --version`。
4. 选定包管理器并初始化；只用这一个。
5. 写 `AGENTS.md` 和 `.agents/acceptance/PROJECT.md`。命令写成能直接复制运行的样子，写完实际跑一遍。
6. 先放一条能跑通的最小端到端路径（例如启动后首页可访问、CLI 返回预期输出），把它写进 `PROJECT.md` 的冒烟命令。
7. 建远程仓库，第一次提交只包含基线和最小路径。

## 老项目补齐

改动一个缺基线的项目时，先补齐再做需求：

- 没有 `mise.toml`：按部署约束或默认版本补上，用这个版本跑一次项目自己的构建和测试；失败时先确认是不是版本导致的（换回原版本对照），不是就如实记录为既有问题。
- 没有 `AGENTS.md` 或内容过时：按上面的结构补齐，删掉与代码不符的旧说明，不留"历史说明"段落。
- 没有 `.agents/acceptance/PROJECT.md`：本次验收用到了哪些启动与登录步骤，就把它们写进去。
- 发现多份事实源（例如 `.nvmrc` 与 `mise.toml` 并存）：保留 `mise.toml`，删掉其余。

## 守卫怎么写

- 每条守卫写清规则、原因和修法，输出指向具体文件；整套在一秒内跑完，不依赖网络。
- 先挑真正会出错的结构边界：唯一的事实源（版本、配置、连接）、分层边界（例如只有数据层写 SQL）、禁止的调用方式。
- 规则当前不成立时用棘轮：把现状记入基线清单，禁止新增；清单里的项修好后守卫会要求删掉它。
- 写完先故意制造一次违规，确认每条守卫都会失败，再恢复。
- 守卫失败时修代码，不改守卫、不往清单里加条目来放行。

基线本身不是验收项；它在 `process` 里记一行即可。
