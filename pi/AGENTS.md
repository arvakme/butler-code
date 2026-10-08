# Butler Code（Pi 包）

基于 FireCode 的 Pi 定制层：我的界面（启动横幅、输入框外壳与状态栏、后台任务弹窗、主题），FireCode 的工具渲染、
指挥官子代理与对抗审查，以及我自己的后台能力（`agents/`：哨兵、调研、未了事项、纠错本等）。

**没有斜杠命令。** 用户不手动调用功能：一切由会话 Agent 经工具发起（`review`、`subagents`、
`sentinel`、`research`、`loose`……），界面操作只有快捷键与点击。子会话里保留一个隐藏的 `/fire-review`，那是
指挥官让子代理自审的进程内通道（`master/run.ts` 经 `session.prompt` 触发），不是给人用的入口。

单一入口 `index.ts`：按 `config.features` 逐个调 `registerX(pi)`，再调 `registerAgents`。每个 register 封闭自己的
运行状态，关掉任何一个不影响其余。跨模块接缝：Master 只读调 `review/outcome.ts`；Master 复用 `tools/line.ts`
画工具行；Review 经 `master/spawn.ts` 起子会话；statusbar 订阅 review 的占用频道显示审查进度（频道名与 payload
只在 `review/occupancy.ts` 定义）；轮记录器、statusbar、tools 经 `busy.ts` 的 `watchBusy` 读在飞子代理数并消费
同一个“会话歇下”边沿；Master 的卡片复用 `tools/machine.ts` 的信封一行投影（信封格式由 `deliver.ts` 拥有）；
statusbar 落定态经 `tools/round.ts` 读轮记录；`agents/` 的任务登记簿（`agents/jobs.ts`）由 statusbar 的输入框上方任务行和任务弹窗读取；master 运行时（每次重绘）和 review 的占用信号经 `agents/firecode.ts` 把子代理和审查镜像进去。

| 路径 | 职责 | 细则 |
| --- | --- | --- |
| `header.ts` | 会话启动横幅 | |
| `statusbar/` | 输入框外壳：状态嵌进编辑器上下边框，无独立底栏 | [statusbar/AGENTS.md](statusbar/AGENTS.md) |
| `tools/` | 思考与工具的过程组/过程列表、轮记录（整段耗时与终态的持久化事后记录）、默认四工具渲染与单工具正文 | [tools/AGENTS.md](tools/AGENTS.md) |
| `session/` | 自动命名、herdr 身份投影、用户消息与链接排版 | [session/AGENTS.md](session/AGENTS.md) |
| `review/` | 对抗性审查（主会话 `review` 工具）：多模型并行审、顾问仲裁、checkpoint、结果卡、审查进度发布 | [review/AGENTS.md](review/AGENTS.md) |
| `master/` | 指挥官（新会话按配置自动激活）：进程内 Worker 池、七命令与独立查询、当前动作投影、steer 投递与审查义务 | [master/AGENTS.md](master/AGENTS.md) |
| `agents/` | 后台能力：哨兵、调研、选择题、预测输入、未了事项、纠错本与任务登记簿 | [agents/AGENTS.md](agents/AGENTS.md) |
| `themes/` | butler / butler-dark 主题，经包清单 `pi.themes` 发现 | |
| `provider/claude-sub.ts` | Claude 订阅适配：请求补 Claude Code 归因，令牌换发造成的 401 自愈一次 | |
| `provider/openai-native/` | 请求层：OpenAI verbosity、OpenAI/xAI Fast（service_tier=priority）、可选原生压缩 | |
| `round-recorder.ts` | 轮记录器：歇下时写轮记录；不属于任何可关的功能，主会话与每个子代理会话都注册 | |
| `truncated-write.ts` | 拦截带 read 截断提示的 write（把半截文件写回）；同样每个会话都注册 | |
| `deliver.ts` | 信封格式与统一投递入口（Master 事件用） | |
| `busy.ts` | “会话进行中”与“歇下”边沿的唯一判定，及相关频道 | |
| `herdr-client.ts` | herdr socket 短连接客户端，herdr-display 与 review 占用标签共用 | |
| `activity.ts` | 子代理活动列表的单行布局，只有 `master/activity-list.ts` 使用 | |
| `format.ts` `theme.ts` `flame.ts` | 共享的宽度/文本格式化、品牌配色与火苗配色（动效颜色按角色取当前主题色） | |
| `config.ts` | 从 Pi Agent 目录解析唯一运行配置，并给出 review/master 每节能否启动的判定；`agents` 节原样交给 `agents/config.ts` | |

改 `review/` 或 `master/` 前先读对应细则页：两者的状态机、持久化与投递契约都有事故换来的硬约束。术语与命名见 `WORDS.md`。

`tools/grouping.ts` 依赖 Pi 内部组件树与原型 patch，升级宿主优先验证这里。

唯一运行配置由 `getAgentDir()` 解析：`extensions/butler-ui/config.jsonc`，后台能力在其中的 `agents` 节。模板不参与运行读取；缺配置关闭可选功能并在会话启动警告。模型原子统一为 `provider/model/thinking`，不要重新引入拆字段兼容层。改配置需重载 Pi。

投递统一经根级 `deliver.ts`（机制见其头注释；唯一例外：review 的修复反馈与总结提示走 followUp 侧门，见 review/AGENTS.md 已知暴露）。两条红线是事故换来的：回合进行中以 `triggerTurn: false` 立即追加会造成快照与状态分叉、提示词缓存整段重写（#28）；以 `triggerTurn: true` 唤起歇透会话会跳过 `before_agent_start`，系统提示注入随回合抖动同样整段重写（#33，宿主缺陷，已报上游）。纯展示记录（轮记录）使用官方 CustomEntry，不走模型消息投递。

宿主私有细节只在 `tools/host.ts`；改过程分组或升级 pi 时先读 `tools/AGENTS.md`，核对原生展开与鼠标命中契约。

## 配置

唯一运行配置是 Pi Agent 目录（由官方 `getAgentDir()` 解析，含 `PI_CODING_AGENT_DIR` 覆写）下的
`extensions/butler-ui/config.jsonc`；用户侧安装与缺失行为见 README。改完本机运行配置后，把其中属于推荐配置的部分
同步进 `config.example.jsonc`，个人化内容（自定义 instructions、私人扩展名）留在本机。

配置里凡是指定模型的位置都写同一个模型原子 `"provider/model/thinking"`，解析在 `config.ts` 的 `parseModelAtom`
一处收口；旧的分字段与两段式写法一律报配置问题。

不要读项目级配置。`review`、`master` 与 `agents` 里各功能的配置有问题时对应功能拒绝启动而不是回退默认——静默回退会拿用户没配的模型
真实发起调用。能否启动只由 `loadConfig()` 给出的每节判定决定（文件级与 features 问题阻断 review 与 master），消费端不再自己筛
问题；关闭的功能那一节的问题不进 session_start 全局警告。
子会话只注册与界面无关的功能：横幅、工具渲染、自动命名与 `agents/` 的工具只属于交互主会话；子会话从 `agents/` 只拿纠错本注入。

## 测试

```bash
bun test
```

`tests/loader.ts` 需要 Pi 源码：`PI_PACKAGES_DIR` 指向 pi 仓库的 `packages/`（与已装版本同一 tag，`packages/ai/src/providers/data` 需从已装包的 dist 拷入），或 PATH 上的开发版 `pi`。loader 把当前仓库复制到临时目录并改写宿主包导入。`agents/e2e/` 是真实 Pi + 真实模型的端到端脚本，不进 `bun test`。
