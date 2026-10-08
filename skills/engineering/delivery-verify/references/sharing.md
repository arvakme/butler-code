# 交付看板：一个端口，一个 Tailscale 地址

所有 agent（Claude Code、Pi、Codex）交付给用户看的 HTML、报告、预览和附件，都走同一个入口：本机固定端口 `8769` 上的交付看板，经 Tailscale HTTPS 暴露。agent 不自己开端口、不自己加 Serve 路由、不自己拼地址；每次交付都给用户这个地址。localhost、file://、裸 HTTP 和本地路径只供内部验证，不能当交付链接。

- 看板是给 agent 的入口，不是给用户看的：开始一项工作前先 `share.py list --json`（或读 `<origin>/delivery/index.json`），了解还有哪些项目和交付在并行。默认只把本次报告的地址告诉用户，不发看板地址（页面仍在 `<origin>/delivery/`，按 Active、Archived、Cleaned 分组，用户想看可以打开）。
- 自动归档：7 天没动静的交付由服务自己归档（每小时检查一次，`share.py sweep` 可手动跑）；有人提交反馈或重新登记会自动恢复为 Active。归档的仍然可以打开。
- 单份报告 `<origin>/delivery/<slug>/report.html`；有多轮时登记整个任务目录，进入 `round-NN/report.html`。
- 反馈按钮提交到同源入口，先持久保存，再送到该 agent 自己的 herdr pane。
- 不使用 Lody：它的会话探测不稳，已不再使用。

## 当前工作站

先 `tailscale serve status --json` 回读实际设备 HTTPS 域名与现有路由。首次设置只增加独立路径，不执行 `serve reset`，不覆盖既有代理，不启用 Funnel。手机需登录同一 tailnet，不要替用户关闭 HTTPS 校验。

## 登记

在 butler-code 项目目录用它的 mise runtime：

```bash
mise exec -- python skills/engineering/delivery-verify/scripts/share.py register TASK-r01 /absolute/round-01 \
  --origin https://REAL-DEVICE.ts.net:8443
```

- slug 只能是小写字母、数字、连字符，唯一对应一个目录。看板只有一个 origin，换了会被拒绝。
- 反馈 pane 默认取当前 agent 的 `$HERDR_PANE_ID`，它所在的 herdr 服务取 `$HERDR_SOCKET_PATH`，两者一起记进登记簿（只给其一，登记会被拒绝）；agent 类型从环境猜（`--agent claude|pi|codex` 可覆盖）。不在 herdr 里运行时没有 pane，页面会显示"未绑定反馈"，不能宣称按钮能回传。旧登记里绑着别的系统 pane 的报告同样显示未绑定。
- 命令输出这份报告的 HTTPS 地址，只把它告诉用户（看板地址在 stderr，是给 agent 的）。重新登记同一个 slug 可以换 pane、把状态恢复为 Active。

## 产品预览：固定端口

给用户试用的网页（开发服务器）也不要自己加 Tailscale 路由。统一用：

```bash
mise exec -- python skills/engineering/delivery-verify/scripts/share.py preview PROJECT-NAME LOCAL_PORT
mise exec -- python skills/engineering/delivery-verify/scripts/share.py preview-rm PROJECT-NAME
```

- 地址形如 `https://<设备>.ts.net:47xxx/`，端口来自保留的 47100–47199（100 个，不常见的端口，避开常见开发端口）。项目名对应的端口固定不变：同名再运行，端口不变，哪怕本地端口换了。
- 不放在看板的子路径下：很多网页用绝对路径和 WebSocket，放进子路径会坏。
- 项目结束时 `preview-rm` 关掉路由、释放端口；预览列在看板首页和 `index.json` 的 `previews` 里。端口用完了会报错，不会覆盖别人的。

## 状态与清理

| 命令 | 作用 |
|---|---|
| `share.py list [--json]` | 每份交付、状态、agent、能否反馈；`--json` 是给 agent 读的索引 |
| `share.py sweep` | 立即把 7 天没动静的进行中交付归档（服务每小时自己做一次） |
| `share.py archive SLUG` / `activate SLUG` | 移出/移回进行中；归档仍可打开 |
| `share.py clean SLUG` | 只列出会删的文件；加 `--yes` 才删，保留 `result.json` 和 `feedback-receipts/`，状态记为 Cleaned，页面返回 410 |

页面只能归档和恢复，删文件只在命令行做。`scripts/prune.py` 按时间清整个 artifacts 目录，是另一件事，不改状态。

## 反馈怎么回到 agent

按钮生成稳定 UUID，发送 task、round、完整打回项和意见。服务只接受登记的 Tailscale origin 的 JSON POST，目标 pane 来自注册表，浏览器不能选命令、目录或 pane。

1. 完整意见先保存到本轮 `feedback-receipts/<UUID>.json`。
2. 再用 `herdr agent prompt <pane> <一行>`（环境变量 `HERDR_SOCKET_PATH` 指向登记时记下的服务）向 agent 发**一行** `[delivery-hub slug=…]`，只带结论和回执文件路径，agent 读文件取全文（消息保持单行、内容放文件）。
3. 只有 herdr 返回 `result`（没有 `error`）才记为 `delivered`；这表示话已送进 agent 的输入，不表示 agent 已处理。那个 agent 正停在等人确认的界面（herdr 报 `agent_blocked`）时没有送出，页面提示“正停在等你确认的界面”；超时或没有确认记为 `delivery_unknown`。两种情况意见都完整保留，**不自动重发**：先看目标 pane 和回执，再决定。
4. 同一个 UUID 同一正文只返回原回执，不再投递；同编号换正文返回冲突。网络断开保留草稿，可重新取回同一回执。
5. 向当前会话做回传测试要明确标为测试消息，不冒充用户接受。

收到 `[team-msg from=delivery-hub …]` 的 agent：读回执文件，从反馈定位验收项 ID，按 SKILL.md 第 4 节开下一轮。

回执（`feedback`）的字段：`decision`、`accepted`（已接受的项）、`ignored`（用户说不用处理的项）、`rejected`（每项有 `reason`、`tags`、`lesson`、`notes`）、`comment`；`at` 是保存时间。`lesson` 为真的项，按 SKILL.md 第 4 节把原因写进项目的 `common-mistakes.md`。看板的 `GET …/round-NN/history.json` 汇总同一任务各轮的结果摘要和这些回执，页面用它画历史、讨论和用户流程；`history.json` 还带每轮的 `message`、`flows` 和 `reactions`。表情（POST `…/reaction`，只接受页面提供的六个）存在每轮目录的 `reactions.json`，不通知 Agent。

回执里每个打回项可带 `notes`：用户在截图上框的区域（`rect` 为占整张图的比例 x、y、宽、高，宽高为 0 表示一个点）或在录像里暂停的时刻（`t` 秒）加一句话，服务只收属于该验收项证据的文件，并把位置写进给 agent 的文本。按位置定位问题，不要让用户再描述一遍。

## 验证

生成报告后在 Ego 打开 HTTPS 地址，实际查看窄屏布局、至少一个相对媒体附件，并提交一次反馈看到回执；CLI GET 只能证明可达，不替代 UI 验证。改动看板服务本身时运行 `python3 tests/delivery-hub.e2e.py`（真实服务进程 + HTTP，唯一的替身是 `herdr`；`python3 tests/delivery-herdr.e2e.py` 用真实的 herdr 和 Pi 验证整条回传）。

## 生命周期

临时预览按资源所有权约定关闭；要在手机验收的报告和反馈入口有明确保留理由，保留到约定的期限。清理产物用 `clean`，不删除原反馈历史来假装关闭。不要以关闭任务为由停止用户共享的 Tailscale Serve 路由或应用会话。
