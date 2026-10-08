# 交互录像

跨页面、多步交互、触摸滚动或动态反馈的交付需要录像时读。静态排版用截图即可。录像展示实际操作；通过结论仍来自场景预期与实际回读，录制完成不等于验收通过。

## Web：复用 Ego

`scripts/record.mjs` 的 `startRecording(page, options)` 复用当前 Agent 自建的 Ego Page，通过 `page.cdp()` / `page.events()` 接收 Chromium 原生画面帧；只依赖已安装的 ffmpeg 和 Node 内置模块。它不启动浏览器、不调用规划模型、不上传、不更新 PR。找不到 ffmpeg 时说明环境缺口；Ego 的 Node PATH 与 shell 可能不同，可传 `ffmpeg` 的绝对路径。

使用本轮独立示例或测试账号，先确认页面没有凭据和私人信息。该 Page 的 CDP 事件队列由录制独占：录制期间不要另行消费 `page.events()`，不要在用户或共享 Page 上接管已有 screencast。记录 TaskSpace ID、Page label、捕获目录及工具版本；沿用该任务的同一 TaskSpace，不为重试开新空间。

在一次 `ego-browser nodejs` 调用内开始录制、执行动作并在 `finally` 中停止；调用间 Node 变量不保留。示例中的 `page` 是已取得的当前 Page，`directory` 是本轮 evidence 下尚不存在的绝对目录：

```js
const os = await import('node:os');
const { pathToFileURL } = await import('node:url');
const { startRecording } = await import(pathToFileURL(
  os.homedir() + '/.config/butler-code/skills/engineering/delivery-verify/scripts/record.mjs'
));
const recording = await startRecording(page, {
  directory,
  maxDurationMs: 60000,
  // Ego 找不到已安装的 ffmpeg 时才指定实际路径：
  // ffmpeg: '/opt/homebrew/bin/ffmpeg',
});
try {
  await recording.caption('打开请求列表');
  await page.click(selector, { label: '打开请求列表' });
  await page.waitForFunction(resultCondition); // 先按本场景定义实际结果条件
  // 保存结果断言和必要截图，继续正常 Ego 动作。
} finally {
  const result = await recording.stop();
  console.log(result); // recording.mp4 和 capture.json 的绝对路径
}
```

字幕描述动作，结果由 DOM、接口或持久化回读证明。轨迹来自真实鼠标移动，点击圈来自真实按下；需要明显轨迹时用 Ego `mouse.move` 平滑移动到已观察的控件，再实际点击。整页导航由新文档脚本恢复叠层。叠层不拦截输入；`stop()` 停掉自己启动的 screencast、移除新文档脚本及当前叠层，然后编码 H.264 MP4（手机可内联播放、faststart）。最后按 Ego 正常流程关闭本任务不用的 Page/TaskSpace，保存清理回执。

## 成功、失败与交付

- 捕获目录拒绝覆盖，含原始 JPEG、真实时间戳、字幕动作、帧间隔与 MP4。`capture.json` 记录平均采集帧率、最大帧间隔、停止原因和清理状态；30 fps 是输出帧率，重复帧不是补出来的动作。画面不含浏览器外壳、桌面或声音。
- `stop()` 可重复等待同一结果；无帧、捕获/编码/清理失败或超过最长时限会报错并留下 failed 清单。保留原始失败；修正后用新目录重录。可播放的部分录像也不能替没完成的动作宣称通过。
- 先实际查看关键帧、从报告里播放 MP4，再将 `video` 证据标为 inspected。source 写版本、时间、Ego CDP、实际采集帧率及覆盖场景；capture.json 可作为 text 附件。录像不能单独证明 iPhone Safari 手感或细微掉帧；这类结论需实际设备或独立性能证据。
- 按 `sharing.md` 分享整轮目录，检查 Tailscale HTTPS 上的页面、视频和反馈。沿用项目上传授权；用户没要求时不改 PR 或公开发布。

原生桌面录像按 Cua 的目标窗口后台证据边界处理，先读对应 skill；焦点、权限或锁屏阻塞时如实标 blocked，不录整个桌面绕过。

轨迹叠层改编自本地核对过的 `yetone/magpie` `.github/ui-preview/cursor.js`，版本 `8e1426cbb508e5c02108229086fd013b2d3397ff`；保留 `assets/recording-cursor.LICENSE.txt`（MIT，2026 yetone）。仅复用轨迹、点击圈和字幕显示；规划、浏览器、发布流程不随此集成引入。
