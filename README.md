# butler-code

我自己写代码用的 AI 编码环境：Pi 为主，Claude Code 和 Codex 作执行者，herdr 管多个 agent 窗格。这里放的是可以照着装的部分：Pi 扩展包、共享规则、自己写的 skill 和 herdr 的 shell 封装。

## 里面有什么

| 路径 | 是什么 |
|---|---|
| `pi/` | Pi Package：界面与状态栏、对抗审查、子代理，和哨兵、调研、未了事项、纠错本等后台能力。底座是 [FireCode](https://github.com/Suge8/firecode)。说明见 `pi/README.md` |
| `config/instructions/pi-coding.md` | Pi 的系统提示（`~/.pi/agent/SYSTEM.md`） |
| `config/instructions/skill-integration.md` | Pi、Claude Code、Codex 共用的规则（Pi 用作 `APPEND_SYSTEM.md`） |
| `config/shell/` | herdr 的 zsh 封装：服务端脱离终端窗口运行，关窗口不会杀掉里面的 agent |
| `skills/` | 自己写的 skill：`delivery-verify`（验收与离线证据报告）、`dogfood`、`independent-review`、`ship`、`herdr-team`、`cua-driver` |

规则里的路径写的是 `~/.config/butler-code/...`，所以请克隆到这个位置。规则是按我自己的习惯写的（中文回复、zsh、mise 管版本等），装之前读一遍，改成你的。

## 安装

```bash
git clone https://github.com/arvakme/butler-code ~/.config/butler-code
cd ~/.config/butler-code

# Pi：系统提示、共享规则、扩展包
ln -s ~/.config/butler-code/config/instructions/pi-coding.md ~/.pi/agent/SYSTEM.md
ln -s ~/.config/butler-code/config/instructions/skill-integration.md ~/.pi/agent/APPEND_SYSTEM.md
# 把 "~/.config/butler-code/pi" 加进 ~/.pi/agent/settings.json 的 "packages" 列表（写绝对路径）
mkdir -p ~/.pi/agent/extensions/butler-ui
cp pi/config.example.jsonc ~/.pi/agent/extensions/butler-ui/config.jsonc   # 换成你登录过的模型

# skill：给 Pi 和 Claude Code 都链一份
for d in skills/*/*/; do n=$(basename "$d"); ln -s "$PWD/$d" ~/.pi/agent/skills/$n; ln -s "$PWD/$d" ~/.claude/skills/$n; done

# herdr（可选）：在 ~/.zshrc 里加
#   source ~/.config/butler-code/config/shell/herdr.zsh
```

Claude Code 在 `~/.claude/CLAUDE.md` 里写一行 `@~/.config/butler-code/config/instructions/skill-integration.md` 引入共享规则。Codex 没有引用语法，把这份规则拼进 `~/.codex/AGENTS.md`。

## 用到的第三方 skill

我日常还装着这些上游的 skill，没有复制进来，直接装原仓库：

- [tw93/Waza](https://github.com/tw93/Waza)：think、hunt、check、ui、read、learn、write、health
- [mattpocock/skills](https://github.com/mattpocock/skills)：grilling、wizard、to-spec、to-tickets、codebase-design、domain-modeling 等
- [emilkowalski/skills](https://github.com/emilkowalski/skills)：animate、apple-design、emil-design-eng 等动效与设计
- [tester-army/e2e](https://github.com/tester-army/e2e)：e2e
- [Innei/SKILL](https://github.com/Innei/SKILL)：handoff
- [jnsahaj/skills](https://github.com/jnsahaj/skills)：explain-then-fix

## 许可

MIT。`pi/` 基于 FireCode（MIT，Copyright (c) 2026 Suge8），原许可保留在 `pi/LICENSE`。
