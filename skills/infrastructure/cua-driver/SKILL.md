---
name: cua-driver
description: 用已安装的 Cua Driver 后台读取和操作原生桌面窗口；也用于 ego-browser 的具体能力缺口。Web 交互默认 Ego，CLI/API 不启动桌面工具。需要前台焦点时停止并报告阻塞。
---

# Cua Driver

由当前 agent 直接调用 `cua-driver`。无需另一个模型或 Jev 才能操作；额外模型评估仅按已有授权接入。Web 任务先读 `ego-browser`，原生窗口与浏览器外的控件才用本 skill。工具切换不能绕过权限、用户接管或暂停。

## 连接与权限

```bash
cua-driver --version
cua-driver status
cua-driver permissions status --json  # macOS，只读权限状态
```

复用已安装的应用与 daemon。缺 CLI、daemon 或权限时报告具体阻塞，按 [官方安装说明](https://cua.ai/docs/how-to-guides/driver/install) 处理，不重复安装工具。macOS 的授权归 CuaDriver.app；CLI 经 daemon 操作，不使用 `--direct` 绕开其权限身份，不切换到 unrestricted 模式。

下文最近核对于 0.33.0；升级后行为与此不符时，以本机 `describe` 和[发布说明](https://github.com/trycua/cua/releases)为准。参数以本机 `cua-driver describe <tool>` 为准；先查实际 schema，不从网页样例猜 API。`call` 接受 JSON 字符串或 stdin，返回 MCP 内容；同时检查命令退出码、`isError` 和结构化动作结果，退出码为零不是行为通过。

## 后台操作合同

- 每次输入指定准确的 `pid` 与 `window_id`。先读取目标窗口，优先 AX 元素动作；像素坐标只能来自该窗口的当前截图。
- 支持 `delivery_mode` 的动作显式设为 `"background"`。不调用 `bring_to_front`，不发送桌面绝对坐标输入，也不以 AppleScript activate、系统快捷键或其他工具偷换前台操作。
- Cua 官方仅承诺 best-effort background。若返回 foreground 升级建议、修饰键操作必须前台，或目标自行激活，停止该路径，记录 `Blocked` 并请求明确许可；不能因为后台动作没效果就自动抢焦点。
- 后台 AX 无效时，重新观察后可尝试同一窗口的后台像素路径；仍无效就停止，不循环重试。工具成功回执、`verified: false` 或 `effect: unverifiable` 都需要实际回读；不能当作用户操作已成功。

## 最小操作闭环

1. 为本次任务选唯一公开 session 名并记录。调用 `start_session`，后续所有接受 `session` 的工具重复此名；CLI 每轮进程不同，不能依赖隐式会话延续。
2. `list_windows` 按已知 PID 收窄。只操作已授权的目标；若需新实例，查 `launch_app` schema，并记录返回 PID、进程启动身份与窗口 ID。启动后台应用仍可能自行激活，检查 `self_activation_suppressed`；无法保持后台就停止。
3. `get_window_state` 获取 AX 元素与截图。截图用 `screenshot_out_file` 保存到本次证据目录，按需查看；只需重新索引时才用 `include_screenshot: false`。
4. 从本轮 CLI JSON 的 `elements`（MCP 为 `structuredContent.elements`）选择 `element_token` 后调用动作。不复用上一快照的 token，也不传 `element_index` / `snapshot_id`（动作工具已拒绝未声明的参数）。并行任务各用自己的实例或窗口，不能共享窗口交替刷新快照。
5. 重新读取目标窗口，按预期检查实际变化。输入回显不能证明保存、持久化或后端效果；需要时继续验证相应用户路径。

```bash
cua-driver call start_session '{"session":"task-unique-run"}'
cua-driver call list_windows '{"pid":1234}'
cua-driver call get_window_state '{"session":"task-unique-run","pid":1234,"window_id":5678,"screenshot_out_file":"/absolute/evidence/before.png"}'
# 用刚读到的真实 PID、window_id、element_token 替换示例值。
cua-driver call click '{"session":"task-unique-run","pid":1234,"window_id":5678,"element_token":"TOKEN_FROM_CURRENT_SNAPSHOT","delivery_mode":"background"}'
cua-driver call get_window_state '{"session":"task-unique-run","pid":1234,"window_id":5678,"screenshot_out_file":"/absolute/evidence/after.png"}'
```

点击、输入、快捷键、菜单、窗口尺寸和文件选择的参数均按 `describe` 查询。整屏截图会含无关内容，优先单窗口取证；不在报告中保存 cookie、token 或完整用户桌面。

## 可选录制

需要动作前后证据时先查 `get_recording_state`、`start_recording` 和 `stop_recording`。录制是共享 daemon 状态：已有录制或所有权不明就不接管，改为手动保存本任务的窗口截图。仅在确认独占本次录制时开始，并记录输出目录与所有权。

使用 trajectory 的窗口截图与动作 JSON；保持 `record_video: false`，因为 true 会录制主显示器而非仅目标窗口。停止自己拥有的录制后，可用 `cua-driver recording render <trajectory-dir> <out.mp4>` 合成视频。`stop_recording` 会无条件停止当前录制，调用前重新确认归属；不把别人的录制一起停掉。

## 收尾

成功、失败或取消都先保存结果，再 `end_session` 结束自己的 session，确认返回 `active: false`。后续 `get_session` 会以非零退出并明确报告该名字已 ended；这是终态证据，不要为查询而重新 start/revive。其它查询失败不等于已关闭。独立清理本任务创建的窗口/临时进程，核对 PID 与启动身份；session 结束不代表应用退出。保留用户已有窗口、共享 daemon 和交付证据，不执行全局 stop/revoke。无法确认关闭就报告资源句柄和缺口。

```bash
cua-driver call end_session '{"session":"task-unique-run"}'
cua-driver call get_session '{"session":"task-unique-run"}'
```

[官方后台行为边界](https://cua.ai/docs/concepts/the-no-foreground-contract) 解释哪些应用需要前台；本 skill 的默认策略是在该边界停止，而不是自动升级。
