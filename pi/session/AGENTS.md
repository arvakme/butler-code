# session：会话层功能

自动命名、herdr 身份投影、用户消息与链接排版、复制清理。各功能各自独立。

| 文件 | 职责 |
| --- | --- |
| `rename.ts` | 没改过名的会话第一次提问时取文件夹名；手动改名用 Pi 自带的快捷键 |
| `herdr-display.ts` | 会话身份投影到 herdr 的 agent 副标题 |
| `user-message.ts` | 用户消息：左边蓝竖条、不填底色（`features.userMessage`） |
| `link-space.ts` | 网址或绝对路径后紧跟全角标点时补空格，免得终端把标点算进链接（`features.links`） |
| `clean-copy.ts` | 全屏模式复制时去掉用户消息竖条、接回自动折行（随状态栏挂载） |

## herdr-display

投影内容见文件头注释；`tokens.session` 把会话名供给侧边栏行布局（herdr 侧边栏只消费自定义 token，用户 herdr 配置的 pi 行布局引用 `$session`）。

workspace、pane label 与 tab label 都归 herdr、用户或 Master 管；FireCode 不写这些持久名称——tab 是多 pane
共享状态，而 herdr 没有条件 rename/CAS 与清除自定义名的接口，先检查再 rename 无法消除 split/move 竞态。

改名不从 `rename.ts` 接线，只听宿主的 `session_info_changed`（快捷键与自动命名已在宿主收口），另听
model/thinking 选择。同一身份不重发，只有确认送达才记为已发布，请求串行避免乱序覆盖，失败静默并由下一
事件重试。非 TUI 模式（print/json/rpc）不投影：无头调用不能接管可见会话的显示。只有 `quit` 清空副标题，
reload/new/resume/fork 由新会话覆盖。没有 feature 开关。
