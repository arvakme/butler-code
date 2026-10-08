---
name: herdr-team
description: 用户明确要求在终端里开另一个 agent CLI（Claude Code、Codex、Grok、Cursor 等）干活，或要读、问、等、关 herdr 里已有的 agent pane 时使用。Pi 自己的 worker 工具能做的事不用它。
---

# herdr 派发

herdr 是终端里的 agent 工作区：每个 agent 在自己的真实 pane 里，herdr 读出它的状态（`idle`、`working`、`blocked`、`done`）。本 skill 是启动、发任务、等、读、改名、关闭 agent 的唯一说明；规则（何时可以派、谁拥有 pane、命名）以 `skill-integration.md` 为准。

默认不用它：实现类任务先用 Pi 自己的 `worker` 工具（继续、角色、独立工作树、fork 都在那里）。只有用户点名要某个 CLI（比如让 Claude Code 用它的 Design 功能做界面设计），才在 herdr 里开 pane。

## 先看现场

```bash
herdr pane list          # 每个 pane 的 id（w2:p1）、里面的 agent、状态
herdr agent get <pane>   # 一个 agent 的详情
```

在 herdr 里运行时，`HERDR_PANE_ID`、`HERDR_SOCKET_PATH` 已经设好，命令自动指向当前服务；在别处用 `--session <名字>`。输出是 JSON，成功有 `result`，失败有 `error.code`。

## 开 pane、起 agent

```bash
created=$(herdr pane split --current --direction right --no-focus)
pane=$(printf '%s' "$created" | jq -r '.result.pane.pane_id')
herdr pane run "$pane" "cd /绝对路径"                       # 目录必须是该 agent 已信任的（见下）
herdr agent start <名字> --kind claude --pane "$pane" -- <传给该 CLI 的参数>
```

窗格里的 shell 是 zsh：`pane run` 发出的文本按 zsh 语法读，和 bash 基本一致；只有 `$VAR` 默认不按空格拆分这类差异，拿不准就把整条包进 `bash -c '…'`。`agent start` 直接起 agent 进程，不经过 shell。

`--kind` 可选 `pi`、`claude`、`codex`、`grok`、`cursor` 等；`--` 之后的参数原样交给该 CLI（模型用它自己的名字，如 `-m gpt-6-luna`，不是网关里的别名）。名字只许 `[a-z][a-z0-9_-]{0,31}`，写成 `<角色>-<做什么>`（`reviewer-pr128`）；中文说明放展示摘要：`herdr pane report-metadata <pane> --source <名字> --token summary=<中文>`。

**目录信任**：Claude Code 在没信任过的目录首次启动会停在“是否信任此文件夹”，只有用户能答。启动前用已信任的目录（`~/.claude.json` 里 `hasTrustDialogAccepted` 为 true 的路径，比如 `~/Devs`）。停在这个界面时状态是 `blocked`：汇报，不替用户点。

## 发任务、等、读结果

```bash
herdr agent prompt <名字或pane> "<任务，写成自己看得懂的>" --wait --timeout 600000   # 提交并等它停下
herdr agent wait <名字> --until idle --until done --until blocked --timeout 600000
herdr agent read <名字> --source recent-unwrapped --lines 120
```

- 把完整结果让 agent 写进你指定的文件（比如链接单独一行写进某个路径），再读文件；只靠屏幕读容易截断。
- `agent_blocked`：它停在一个等确认或选择的界面。读屏幕汇报给用户，不替点，不用跳过权限的参数重启。
- `blocked`、`unknown`、超时都不等于成功。提示超时或 `agent_prompt_stalled` 不证明没发出去，重发前先读它一眼，免得重复提交。
- 在 `working` 时 `read --lines N` 要 `--source visible`（它在全屏界面里，`idle` 才能翻历史）。

## 限流、继续、收尾

- 因限流或临时错误停住：隔几分钟 `agent prompt <名字> "继续"`，多次不成功就停下汇报，不无限重试。
- **关闭由谁开的谁负责**（herdr 没有闲置自动关）：读完回复、确认不再需要后，先让它正常退出（`agent send-keys <名字> ctrl+c`，或发它自己的退出命令），再 `herdr pane close <pane>`；有未保存的东西不要强关。用户的 pane 和别人开的 pane 不动。
- 记下你开的 pane id 和目的，结束前核对关掉了；没关的写明理由。

## 让别人能看见

验收页的反馈按钮回传到“登记时所在的 pane”：用 delivery-verify 的 `share.py register`，在 herdr 里它自动取 `HERDR_PANE_ID` 和 `HERDR_SOCKET_PATH`。从别的地方给另一个 agent 登记，必须同时给 `--pane` 和 `--herdr-socket`。
