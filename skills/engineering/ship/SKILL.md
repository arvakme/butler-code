---
name: ship
description: 用户明确要求提交、推送、开 PR、发版或打 tag 时使用（包括只说“提交”“推”）：按仓库自身风格拆成原子提交、脱敏、推送并核对 CI。不自行发起提交；写代码、修 bug、审查不用它。
---

# Ship

先区分本次目标是提交、推送、PR 还是发版，只做用户这次要求的那一步；普通提交与推送不默认升级版本、写 changelog 或打 tag。本技能不改业务代码（lint 自动修复除外），发现代码问题报告给用户，不顺手修。

## 1. 事实收集

并行读取，风格全部从仓库现学，不套固定格式：

- `git status`、本任务的 `git diff`：确认改动完整、没有半成品，分清哪些是其他任务或其他 agent 的改动。
- `git log --oneline -20`：学提交风格（语言、是否 conventional、type/scope、emoji、测试与文档是否单独提交）。
- 项目说明里的交付约定（`AGENTS.md`、部署清单、PR 模板）；发版时再读 CHANGELOG 头部、版本文件位置和 `.github/workflows/` 的触发方式。

## 2. 提交

1. **脱敏**：在本次差异里查密钥、token、内网地址、个人路径和无关私人内容，命中就停下报告。
2. **原子拆分**：按逻辑单元分组，每个提交单一意图、可独立 revert、可被 bisect 定位。判断标准：revert 任意一个提交，其余仍独立成立。行为与保护它的测试可以同一提交；测试和文档是否独立，跟随仓库惯例。不要 `git add .` 一把梭。
3. **只提交本任务的路径**：`git commit -m <msg> -- <路径>`；同文件混有他人改动时先隔离自己的差异。不以“工作区必须干净”为由裹带其他任务，也不清理他人的工作区。
4. **信息**：严格匹配第 1 步学到的风格，写清为什么改。
5. **检查**：仓库有 lint / typecheck / 守卫就跑受影响的；已有且输入未变的证据直接复用。

拆分示例——一次改动同时含新功能、附带修复和文档：

```
feat(session): persist selected conversation
fix(session): drop stale draft on conversation switch
docs(changelog): note session persistence
```

而不是一个 `feat: update session stuff` 装下全部。

## 3. 推送与 PR

- 已授权推送就推送，并确认远端分支指向目标 commit；只要求提交时提交完即交付。
- 远端受网络限制时按项目或本机已知的推送方式，不改远端配置绕行。
- 项目要求 PR 时沿用其 Draft、模板、审查和合入规则；给上游提 PR 时先读该仓库合并过的 PR，照它的标题与正文格式写。
- 写 PR 正文按 [PR 正文](references/pr-body.md)：仓库自己的模板优先；没有时用那里的模板（Summary 配图、前后对比的证据、Merge Danger），口吻是用户本人，验证写真实命令和退出码。
- CI 已触发就等待并核对结果（`gh run watch` 或对应平台）。没有 run、工作流 skipped、无权查看与检查通过分别报告，不把未知状态写成绿色；CI 没绿不宣布完成。

## 4. 发版（仅本次包含发布授权时）

1. 先完成第 2 步的全部改动提交，再改版本文件与 CHANGELOG 并单独做 release 提交；tag 指向这个最终 release 提交。不先提交发布元数据、再把业务改动补在 tag 前后。
2. 版本号按 semver 判定，用户没指定时执行前一句话告知。CHANGELOG 从本次提交生成、面向用户、不写实现细节；双语仓库两种语言都写；去 AI 味读 `~/.config/butler-code/skills/writing/kill-ai-slop/REFERENCE.md`。
3. 推送 tag，核对对应的 CI、制品或 Deployment；项目规定跳过的检查明确说明。
4. 失败时按项目规定的恢复方式处理本次引入的问题；未经授权不在生产上试错。属于历史遗留的问题报告用户，不声称发布完成。

## 交付

报告实际完成的阶段、每个 commit / PR / tag / 制品链接、检查结果与 CI 状态，以及未完成或被阻塞的部分。
