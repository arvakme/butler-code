import { afterAll, expect, test } from "bun:test";
import { cleanupFirecodeModules, loadFirecodeModule, PI_TUI_URL, PI_CODING_AGENT_URL } from "./loader.ts";
import palette from "../themes/butler.json";
const { visibleWidth } = await import(PI_TUI_URL);
const { Theme } = await import(PI_CODING_AGENT_URL);
afterAll(cleanupFirecodeModules);
const plain = (s: string) => s.replace(/\x1b\[[\d;]*m/g, "");

const realTheme = () => {
	const colors = Object.fromEntries(Object.entries(palette.colors).map(([k, v]) => [k, (palette.vars as any)[v] ?? v]));
	return new Theme(colors, colors, "truecolor");
};

/** 装上状态栏，拿到宿主会挂的三样东西：底栏（0 行）、输入框外壳、输入框上方的任务行。 */
async function mountShell(over: { statuses?: Map<string, string>; cwd?: string } = {}) {
	const { registerStatusBar } = await loadFirecodeModule("statusbar/index.ts") as any;
	const { fakePi } = await import("./fake-pi.ts");
	const theme = realTheme();
	const statuses = over.statuses ?? new Map<string, string>();
	const mounted: { footer?: any; editor?: any; widget?: any; workingVisible: boolean[] } = { workingVisible: [] };
	const tui = { requestRender() {}, terminal: { rows: 40 } };
	const ctx = {
		mode: "tui",
		cwd: over.cwd ?? "/tmp/work",
		isIdle: () => true,
		model: { id: "test-model", reasoning: true, contextWindow: 200_000 },
		getContextUsage: () => ({ percent: 42.3, contextWindow: 200_000 }),
		sessionManager: { getBranch: () => [], getLeafId: () => null, getSessionId: () => "12345678-abcd" },
		ui: {
			setWorkingVisible: (visible: boolean) => mounted.workingVisible.push(visible),
			setFooter(factory: any) { mounted.footer = factory?.(tui, theme, { getExtensionStatuses: () => statuses, getGitBranch: () => "main" }); },
			setEditorComponent(factory: any) { mounted.editor = factory?.(tui, { borderColor: (text: string) => text, selectList: {} }, { matches: () => false }); },
			setWidget(_key: string, factory: any) { mounted.widget?.dispose?.(); mounted.widget = factory?.(tui, theme); },
		},
	};
	const fake = fakePi({ getThinkingLevel: () => "medium" });
	registerStatusBar(fake.pi);
	fake.fire("session_start", {}, ctx);
	return { fake, ctx, mounted, top: (width = 100) => plain(mounted.editor.render(width)[0]), bottom: (width = 100) => plain(mounted.editor.render(width).at(-1)) };
}

test("输入框外壳：独立底栏 0 行，工作目录与模型在下边框，火苗与审查进度在上边框，没有额度", async () => {
	const statuses = new Map<string, string>([["pi-openai-native-fast", "fast"]]);
	const { fake, ctx, mounted, top, bottom } = await mountShell({ statuses, cwd: "/Users/me/Devs/.worktrees/butler-code/pi-firecode" });
	expect(mounted.footer.render(100)).toEqual([]);
	expect(mounted.workingVisible).toEqual([false]);
	expect(bottom()).toBe(`─ /Users/me/Devs/.worktrees/butler-code/pi-firecode ${"─".repeat(10)} test-model/medium Fast · 42.3%/200k ─`);
	for (const word of ["Weekly", "Reset", "Usage", "周 "]) expect(top() + bottom()).not.toContain(word);
	// 窄屏先省容量，再从开头裁路径（留住末尾的目录名），再裁模型名；百分比与 Fast 始终在
	expect(bottom(63)).toBe("─ …/butler-code/pi-firecode ── test-model/medium Fast · 42.3% ─");
	expect(bottom(50)).toBe("─ pi-firecode ─── test-model/medium Fast · 42.3% ─");
	// 手机竖屏：半个模型名认不出，整个让掉，留末尾目录与上下文
	expect(bottom(40)).toBe(`─ pi-firecode ${"─".repeat(11)} Fast · 42.3% ─`);
	expect(bottom(24)).toBe(`${"─".repeat(9)} Fast · 42.3% ─`);
	const { displayPath } = await loadFirecodeModule("statusbar/index.ts") as any;
	expect(displayPath("/Users/me/Job", "/Users/me")).toBe("~/Job");
	expect(displayPath("/Users/me", "/Users/me")).toBe("~");
	expect(displayPath("/Users/meow", "/Users/me")).toBe("/Users/meow");
	const { pathTail } = await loadFirecodeModule("statusbar/render.ts") as any;
	expect(pathTail("~/Job/campus-apply", 18)).toBe("~/Job/campus-apply");
	expect(pathTail("~/Job/campus-apply", 15)).toBe("…/campus-apply");
	expect(pathTail("~/Job/campus-apply", 12)).toBe("campus-apply");
	expect(pathTail("~/Job/campus-apply", 8)).toBe("…s-apply");

	expect(top()).not.toContain("处理中");
	fake.fire("agent_start", {}, ctx);
	expect(top()).toMatch(/^─ [\u2800-\u28ff]{3} 处理中 \d/u);
	let progress = { stage: "reviewing", round: 2, passed: 1, total: 3, blocked: 1 };
	fake.pi.events.emit("herdr:blocked", { active: true, label: "对抗审查进行中", progress: () => progress });
	expect(top(110)).toMatch(/^─ [\u2800-\u28ff]{3} \S+ · [⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] 审查 第2轮 1\/3 · 1 阻断 ─+$/u);
	// 窄屏逐级退让：先丢阻断数，再丢票数，最后只留火苗与计时
	expect(top(30)).toMatch(/^─ [\u2800-\u28ff]{3} \S+ · [⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] 审查 第2轮 ─+$/u);
	expect(top(26)).toMatch(/^─ [\u2800-\u28ff]{3} \S+ ─+$/u);
	for (const w of [40, 100]) expect(top(w)).not.toContain("指挥官");
	progress = { stage: "summarizing", round: 2, passed: 0, total: 0, blocked: 0 };
	expect(top()).toContain("审查 第2轮 总结中");
	fake.pi.events.emit("herdr:blocked", { active: false });
	expect(top()).not.toContain("审查");
	const { visibleWidth: width } = await import(PI_TUI_URL);
	for (let w = 1; w <= 120; w++) for (const line of mounted.editor.render(w)) expect(width(line)).toBeLessThanOrEqual(w);
	fake.fire("agent_end", { messages: [] }, ctx);
	fake.fire("agent_settled", {}, ctx);
	expect(top()).not.toContain("处理中");
	fake.fire("session_shutdown", {}, ctx);
	expect(mounted.footer).toBeUndefined();
	expect(mounted.editor).toBeUndefined();
	expect(mounted.widget).toBeUndefined();
});

test("输入框上方的后台任务：没事时整块隐藏，收起一行数量，点它展开全部、不限行数，标题裁短，worker 不重复显示", async () => {
	const { jobs } = await loadFirecodeModule("agents/jobs.ts") as any;
	const { mounted, fake, ctx } = await mountShell();
	const rows = (width = 100) => mounted.widget.render(width).map(plain);
	const click = (y: number) => mounted.widget.handleMouse({ type: "click", button: "left", x: 2, y });
	const session = jobs().start({ id: "t-quiet", role: "哨兵", title: "会话", quiet: true });
	const worker = jobs().start({ id: "t-worker", role: "worker", title: "fix-auth（工程师）" });
	expect(rows()).toEqual([]); // 只有安静的会话哨兵和 worker：不占行
	const goal = "告诉我投递池里 3 个 worker 什么时候全部有结果，有失败的就马上说";
	const many = Array.from({ length: 6 }, (_, i) => jobs().start({ id: `t-${i}`, role: i ? "调研" : "哨兵", title: i ? `问题 ${i}` : goal, detail: i === 5 ? "要你确认" : "", state: i === 5 ? "waiting" : "running" }));
	const collapsed = rows();
	expect(collapsed).toHaveLength(1);
	expect(collapsed[0]).toBe("▸ ! 哨兵 2 · 调研 5 · 等你 1 · 问题 5 · 要你确认"); // 顺带最急的（等你的）一件，worker 不算
	expect(click(0)).toEqual({ handled: true });
	const open = rows();
	expect(open).toHaveLength(1 + 6); // 展开不限行数，安静的不占行
	expect(open[0]).toBe("▾ ! 哨兵 2 · 调研 5 · 等你 1");
	expect(open[1]).toContain("哨兵 · 告诉我投递池里 3 个 wor… · 不到 1 分钟");
	expect(open[1]).not.toContain("有失败的");
	expect(open.join("\n")).not.toContain("fix-auth");
	expect(open[6]).toMatch(/^  ! 调研 · 问题 5 · 要你确认/u);
	const { visibleWidth: width } = await import(PI_TUI_URL);
	for (const w of [1, 10, 30, 60]) expect(mounted.widget.render(w).every((line: string) => width(line) <= w)).toBeTrue();
	click(0);
	expect(rows()).toHaveLength(1);
	for (const handle of [session, worker, ...many]) handle.discard();
	expect(rows()).toEqual([]);
	fake.fire("session_shutdown", {}, ctx);
});
test("后台任务弹窗：宽屏左列表右详情、窄屏先列表后详情、过程页滚动与按键", async () => {
	const { popupLines } = await loadFirecodeModule("statusbar/jobs-popup.ts");
	const colors = Object.fromEntries(Object.entries(palette.colors).map(([k, v]) => [k, (palette.vars as any)[v] ?? v]));
	const theme = new Theme(colors, colors, "truecolor");
	const now = Date.parse("2026-09-17T10:00:00Z");
	const t0 = now - 7 * 60000;
	// 一个任务里有几位并发成员：数量里写人数；弹窗左边是列表、右边是详情，已结束的灰掉沉底
	const research = { id: "r1", role: "调研", title: "把 3b1b 风格做成视频", detail: "4 位调研员并发查证…（3/4 完成）", state: "running", startedAt: t0, task: "调研一下怎么把 3b1b 的风格做成视频，用到自己的开发验证流程", model: "group/luna · max",
		members: [{ name: "Manim 能做到什么", state: "done" }, { name: "配音和字幕怎么接", state: "done" }, { name: "怎么接进验证流程", state: "failed", note: "搜索超时" }, { name: "成片怎么导出", state: "running" }], notes: ["10:01:02 拆分角度…", "10:01:20 4 位调研员并发查证…"] };
	const watch = { id: "s1", role: "哨兵", title: "PR 128", detail: "", state: "running", startedAt: t0 + 60000, task: "盯 PR 128", model: "group/luna · low（只在 CI 失败时读日志）", notes: [] };
	const finished = { id: "w1", role: "worker", title: "修登录超时", detail: "", state: "done", startedAt: t0 - 600000, endedAt: t0 - 300000, task: "修好登录超时", model: "group/sonnet", result: "已修好，测试通过", notes: [] };
	const failed = { id: "w2", role: "worker", title: "迁移数据", detail: "", state: "failed", startedAt: t0 - 900000, endedAt: t0 - 800000, task: "迁移数据", model: "group/sonnet", notes: [] };
	const all = [finished, research, failed, watch]; // 故意乱序：弹窗自己排
	const wideView = popupLines(theme, { view: "list", selected: "r1" }, all, 120, now, 0, 60);
	const wideText = wideView.lines.map(plain);
	expect(wideView.lines.every((line: string) => visibleWidth(line) === 120)).toBeTrue();
	const names = wideText.map((l: string) => l.split("│")[1] ?? "");
	const at = (needle: string) => names.findIndex((l: string) => l.includes(needle));
	expect(at("调研 · 把 3b1b")).toBeLessThan(at("哨兵 · PR 128")); // 在跑的按开始先后
	expect(at("哨兵 · PR 128")).toBeLessThan(at("已结束")); // 已结束的沉底
	expect(at("已结束")).toBeLessThan(at("worker · 修登录超时"));
	expect(at("worker · 修登录超时")).toBeLessThan(at("worker · 迁移数据")); // 最近结束的在前（先结束的是迁移数据，所以修登录超时更近）
	const right = wideText.map((l: string) => l.split("│").slice(2, -1).join("│")).join("\n");
	for (const need of ["状态", "已派出，进行中", "调研一下怎么把 3b1b 的风格做成视频", "模型  group/luna · max", "并发", "✓ Manim 能做到什么", "✗ 怎么接进验证流程  搜索超时", "（3/4 完成）", "开始  ", "还没有结束", "10:01:20 4 位调研员并发查证…"]) expect(right).toContain(need);
	const doneView = popupLines(theme, { view: "list", selected: "w1" }, all, 120, now, 0, 60).lines.map(plain).join("\n");
	for (const need of ["已完成", "结束  ", "用时  5 分钟", "已修好，测试通过"]) expect(doneView).toContain(need);
	expect(popupLines(theme, { view: "list", selected: "w2" }, all, 120, now, 0, 60).lines.map(plain).join("\n")).toContain("失败");
	expect(wideView.hits.filter((h: any) => typeof h.action === "object").map((h: any) => h.action.pick)).toEqual(["r1", "s1", "w1", "w2"]); // 点第几行就是哪个任务，顺序和显示一致
	// 终端窄时：先列表，选了再看详情
	const narrowList = popupLines(theme, { view: "list" }, all, 60, now, 0, 60);
	expect(narrowList.lines.every((line: string) => visibleWidth(line) === 60)).toBeTrue();
	expect(narrowList.lines.map(plain).join("\n")).toContain("回车或点击看详情");
	const narrowDetail = popupLines(theme, { view: "detail", selected: "r1" }, all, 60, now, 0, 60);
	expect(narrowDetail.lines.every((line: string) => visibleWidth(line) === 60)).toBeTrue();
	expect(narrowDetail.lines.map(plain).join("\n")).toContain("‹ 返回");
	expect(popupLines(theme, { view: "list" }, [], 120, now, 0, 60).lines.map(plain).join("\n")).toContain("现在没有后台任务");
	// 底边框嵌会话统计：取第一档放得下的，都放不下就是纯横线，宽度始终等于弹窗宽
	const stats = ["Cache Hit 80% · In 50.0 t/s · Session 12345678", "Session 12345678"];
	const foot = (w: number) => popupLines(theme, { view: "list" }, all, w, now, 0, 60, undefined, stats).lines.at(-1);
	expect(plain(foot(120))).toMatch(/^╰─ Cache Hit 80% · In 50\.0 t\/s · Session 12345678 ─+╯$/u);
	expect(plain(foot(40))).toMatch(/^╰─ Session 12345678 ─+╯$/u);
	expect(plain(foot(20))).toBe(`╰${"─".repeat(18)}╯`);
	for (const w of [20, 40, 60, 120]) expect(visibleWidth(foot(w))).toBe(w);
	// 高度：内容比可用高度多时，弹窗总高不超过 height + 4（标题、分隔线、提示行、底边），多出来的靠滚动，并在首尾写出还有多少行
	const longJob = { ...research, notes: Array.from({ length: 30 }, (_, i) => `10:02:${String(i).padStart(2, "0")} 第 ${i} 件事`), task: "很长的任务描述。".repeat(40) };
	const clipped = popupLines(theme, { view: "list", selected: "r1" }, [longJob, ...all.filter((j: any) => j.id !== "r1")], 120, now, 0, 14);
	expect(clipped.lines.length).toBe(14 + 4);
	expect(clipped.lines.every((line: string) => visibleWidth(line) === 120)).toBeTrue();
	expect(clipped.lines.map(plain).join("\n")).toContain("下面还有");
	expect(clipped.detailMax).toBeGreaterThan(0);
	const scrolled = popupLines(theme, { view: "list", selected: "r1", detailScroll: 8 }, [longJob], 120, now, 0, 14);
	expect(scrolled.lines.map(plain).join("\n")).toContain("上面还有 8 行");
	expect(popupLines(theme, { view: "list", selected: "r1", detailScroll: 9999 }, [longJob], 120, now, 0, 14).detailScroll).toBe(clipped.detailMax); // 滚过头会停在最底下
	// 进成员：选中的成员有 › 标记，详情里提示回车；成员有自己的完整过程
	const withTrace = { ...research, members: research.members.map((m: any, i: number) => ({ ...m, trace: [`10:01:0${i} → web_search {"query":"成员${i}"}`, `10:01:1${i} ← web_search 找到 5 条结果`, `10:01:2${i} 说 我先看第一条`, `10:01:3${i} ✗ web_fetch 超时`] })) };
	const members = popupLines(theme, { view: "list", selected: "r1", focus: "members", member: 1 }, [withTrace], 120, now, 0, 40);
	const memberText = members.lines.map(plain).join("\n");
	expect(memberText).toContain("› 2. ✓ 配音和字幕怎么接");
	expect(memberText).toContain("回车、点击或数字键看完整过程");
	expect(memberText).toContain("  1. ✓ Manim 能做到什么"); // 编号列表：没选中的也有序号，看得出是哪个、怎么点
	expect(memberText).toContain("  4. ⠋ 成片怎么导出");
	expect(members.hits.filter((h: any) => typeof h.action === "object" && "member" in h.action).map((h: any) => h.action.member)).toEqual([0, 1, 2, 3]);
	const traceView = popupLines(theme, { view: "trace", selected: "r1", member: 2, follow: true }, [withTrace], 120, now, 0, 10);
	const traceText = traceView.lines.map(plain).join("\n");
	for (const need of ["调研 › 怎么接进验证流程", "→ web_search", "← web_search  找到 5 条结果", "说 我先看第一条", "✗ web_fetch  超时", "跟随最新", "‹ 返回"]) expect(traceText).toContain(need);
	expect(traceView.lines.every((line: string) => visibleWidth(line) === 120)).toBeTrue();
	expect(traceView.total).toBe(4);
	const tail = popupLines(theme, { view: "trace", selected: "r1", member: 0, follow: true }, [{ ...withTrace, members: [{ ...withTrace.members[0], trace: Array.from({ length: 30 }, (_, i) => `10:01:${String(i).padStart(2, "0")} 说 第 ${i} 句`) }] }], 120, now, 0, 10);
	expect(tail.lines.map(plain).join("\n")).toContain("第 29 句"); // 跟随时看到最新的
	expect(tail.lines.map(plain).join("\n")).not.toContain("第 0 句");
	const paused = popupLines(theme, { view: "trace", selected: "r1", member: 0, follow: false, scroll: 0 }, [{ ...withTrace, members: [{ ...withTrace.members[0], trace: Array.from({ length: 30 }, (_, i) => `10:01:${String(i).padStart(2, "0")} 说 第 ${i} 句`) }] }], 120, now, 0, 10);
	expect(paused.lines.map(plain).join("\n")).toContain("第 0 句");
	expect(paused.lines.map(plain).join("\n")).toContain("已暂停");
	// 选中的行有底色（真实主题里是 48;… 背景色），不选中的没有
	const rawSelected = popupLines(theme, { view: "list", selected: "r1", focus: "members", member: 1 }, [withTrace], 120, now, 0, 40).lines;
	const memberRaw = rawSelected.find((l: string) => l.includes("配音和字幕怎么接")) ?? "";
	const otherRaw = rawSelected.find((l: string) => l.includes("Manim 能做到什么")) ?? "";
	expect(/\x1b\[48;/.test(memberRaw)).toBeTrue();
	expect(/\x1b\[48;/.test(otherRaw)).toBeFalse();
	expect(/\x1b\[48;/.test(popupLines(theme, { view: "list", selected: "r1" }, [withTrace], 120, now, 0, 40).lines.find((l: string) => l.includes("调研 · 把 3b1b")) ?? "")).toBeTrue(); // 选中的任务也有底色
	// 标题很长也不能把按钮挤出屏幕（以前点“返回”会点到“关闭”上）：宽度正好、两个按钮的点击区挨着不重叠，并且就在它们画出来的位置上
	const longName = "查阅 QS 官网与悉尼大学官网，核实最新一期 QS 世界大学排名中悉尼大学的名次、总分、澳大利亚排名和发布日期以及历史变化".repeat(2);
	const longTitle = popupLines(theme, { view: "trace", selected: "r1", member: 0, follow: true }, [{ ...withTrace, members: [{ ...withTrace.members[0], name: longName }, ...withTrace.members.slice(1)] }], 120, now, 0, 10);
	expect(longTitle.lines.every((line: string) => visibleWidth(line) === 120)).toBeTrue();
	const topLine = plain(longTitle.lines[0]);
	const columnOf = (needle: string) => visibleWidth(topLine.slice(0, topLine.indexOf(needle)));
	const backHit = longTitle.hits.find((h: any) => h.action === "back");
	const closeHit = longTitle.hits.find((h: any) => h.action === "close");
	expect(backHit.x1).toBeLessThanOrEqual(closeHit.x0);
	expect(closeHit.x1).toBeLessThan(120);
	expect(columnOf("‹ 返回")).toBeGreaterThanOrEqual(backHit.x0);
	expect(columnOf("‹ 返回")).toBeLessThan(backHit.x1);
	expect(columnOf("✕ 关闭")).toBeGreaterThanOrEqual(closeHit.x0);
	expect(columnOf("✕ 关闭")).toBeLessThan(closeHit.x1);
	// 过程页：说 / 想按 Markdown 渲染（交给宿主的渲染函数）；调用的参数拆开；返回的内容保留换行
	const rich = { ...research, members: [{ name: "甲", state: "running", trace: [
		"10:00:01 想 **先** 搜一下", "10:00:02 说 ## 发现\n- 用 TypeBox", '10:00:03 → web_search {"query":"abc 排名"}', '10:00:04 → fetch_page {"url":"https://x.y","max":3}',
		"10:00:05 ← web_search 1. 第一条\n   https://a.b\n2. 第二条", "10:00:06 ✗ fetch_page 超时", "10:00:07 · 这一轮 4571 tokens"] }] };
	const fakeMd = (text: string, w: number) => text.split("\n").map((l) => `[MD${w}]${l}`);
	const rich1 = popupLines(theme, { view: "trace", selected: "r1", member: 0, follow: true }, [rich], 120, now, 0, 40, fakeMd).lines.map(plain).join("\n");
	for (const need of ["[MD105]## 发现", "[MD105]- 用 TypeBox", "[MD105]**先** 搜一下", "web_search  abc 排名", "fetch_page", "url: https://x.y", "max: 3", "  1. 第一条", "    https://a.b", "  2. 第二条", "✗ fetch_page  超时", "· 这一轮 4571 tokens"]) expect(rich1).toContain(need);
	expect(rich1).not.toContain('{"query"'); // 参数不再是一整串 JSON
	expect(/← web_search +│\n│ +1\. 第一条/.test(rich1)).toBeTrue(); // 多行的返回：工具名一行，内容在下面各占一行
	const noMd = popupLines(theme, { view: "trace", selected: "r1", member: 0, follow: true }, [rich], 120, now, 0, 40).lines.map(plain).join("\n");
	expect(noMd).toContain("## 发现"); // 没有渲染函数时按纯文字显示，不丢内容
	// 名字很长的成员：最多两行，折行缩进对齐在名字下面（不重复序号），完整的名字在过程页标题里
	const longMembers = { ...research, members: ["查证 shadcn/ui 生态及相关动画库是否提供可复用的抖动组件或 hook，并比较维护状态、体积、React 19 与 Tailwind v4 兼容性、触发方式和减少动态效果支持，给出有来源和日期的推荐排序。", "比较 CSS keyframes、Web Animations API 和 motion 实现及重播抖动的方式", "短名字"].map((name, i) => ({ name, state: "running", trace: new Array(10 * (i + 1)).fill("10:00:00 · x") })) };
	const listText = popupLines(theme, { view: "list", selected: "r1" }, [longMembers], 100, now, 0, 40).lines.map(plain);
	const at1 = listText.findIndex((l: string) => l.includes(" 1. "));
	const at2 = listText.findIndex((l: string) => l.includes(" 2. "));
	const at3 = listText.findIndex((l: string) => l.includes(" 3. "));
	expect(at2 - at1).toBeLessThanOrEqual(2); // 第一位：名字再长也只占两行
	expect(listText[at1 + 1].split("│")[2]).toMatch(/^ {8}\S/); // 第二行缩进对齐（序号和状态符号的宽度），没有序号和 ▸
	expect(listText[at1 + 1]).toContain("…"); // 被截掉的用省略号告诉你
	expect(listText[at1 + 1]).toContain("10 步");
	expect(at3 - at2).toBeLessThanOrEqual(2);
	expect(listText[at3 + 1].split("│")[2]).not.toMatch(/^ {8}\S/); // 短的一行就够，下面不会再有缩进的续行
	// 数字键：直接看第几位的完整过程（任务列表这一栏时也行）
	const { JobsPopup } = await loadFirecodeModule("statusbar/jobs-popup.ts");
	let closed = 0;
	const fakeTui = { requestRender() {}, terminal: { rows: 40 } };
	const registry = { list: () => [withTrace], onChange: () => () => {}, clearEnded() {} };
	const popup = new JobsPopup(fakeTui, theme, registry, () => closed++, undefined);
	popup.render(120);
	popup.handleInput("3");
	const afterDigit = popup.render(120).map(plain).join("\n");
	expect(afterDigit).toContain("调研 › 怎么接进验证流程"); // 第 3 位
	expect(afterDigit).toContain("✗ web_fetch  超时");
	popup.handleInput("\x1b"); // Esc：退一级，回到列表，不是关掉
	expect(closed).toBe(0);
	expect(popup.render(120).map(plain).join("\n")).toContain("后台任务（1 个在跑）");
	popup.handleInput("9"); // 没有第 9 位：什么也不发生
	expect(popup.render(120).map(plain).join("\n")).toContain("后台任务（1 个在跑）");
	popup.dispose();
	// 没有成员的任务（worker）：回车直接看它自己的过程
	const solo = { ...finished, state: "running", endedAt: undefined, trace: ["10:00:01 → bash npm test", "10:00:09 ← bash 3 passed"] };
	expect(popupLines(theme, { view: "list", selected: "w1" }, [solo], 120, now, 0, 30).lines.map(plain).join("\n")).toContain("▸ 看完整过程（2 条）");
	expect(popupLines(theme, { view: "trace", selected: "w1" }, [solo], 120, now, 0, 10).lines.map(plain).join("\n")).toContain("← bash  3 passed");
});

test("a job with items lists them one per row; the selected one shows buttons, and keys, clicks and Enter act on it", async () => {
	const { popupLines, JobsPopup } = await loadFirecodeModule("statusbar/jobs-popup.ts");
	const theme = { fg: (_c: string, x: string) => x, bold: (x: string) => x };
	const acted: string[] = [];
	const job: any = {
		id: "sentinel-session", role: "哨兵", title: "会话", detail: "2 件事没做完", state: "waiting", startedAt: Date.now() - 600000, task: "盯着没做完的事",
		items: [
			{ id: "t1", text: "让 thinking 默认不展开", tag: "待办", age: "33 分钟", actions: [{ key: "g", label: "去做", close: true }, { key: "x", label: "忽略" }] },
			{ id: "alert:dirty", text: "1 个文件改了还没提交", tag: "提醒", age: "21 小时", actions: [{ key: "g", label: "去做", close: true }, { key: "x", label: "忽略" }] },
		],
		act: (id: string, key: string) => acted.push(`${id}:${key}`),
	};
	const view = (member?: number) => popupLines(theme as any, { view: "list", selected: job.id, focus: member === undefined ? "jobs" : "members", member }, [job], 120, Date.now(), 0, 40);
	const plainLines = (v: any) => v.lines.map((l: string) => l.replace(/\x1b\[[0-9;]*m/g, ""));
	const idle = plainLines(view());
	expect(idle.join("\n")).toContain("要你处理的事（2）");
	expect(idle.join("\n")).toContain("1.");
	expect(idle.join("\n")).toContain("[待办] 让 thinking 默认不展开");
	expect(idle.join("\n")).not.toContain("去做 g"); // no buttons until something is selected
	const picked = view(0);
	const text = plainLines(picked).join("\n");
	expect(text).toContain("› 1.");
	expect(text).toContain("去做 g");
	expect(text).toContain("忽略 x");
	expect(text).not.toContain("稍后"); // two states only: do it now, or ignore it
	expect((text.match(/去做 g/g) ?? []).length).toBe(1); // the second item's buttons only appear when it is selected
	// each button is clickable on exactly its own columns
	const buttons = picked.hits.filter((h: any) => typeof h.action === "object" && "act" in h.action);
	expect(buttons.map((h: any) => h.action.act)).toEqual([{ item: 0, key: "g" }, { item: 0, key: "x" }]);
	expect(buttons.every((h: any) => h.x1 > h.x0 && h.y > 0)).toBeTrue();
	const second = view(1);
	expect(plainLines(second).join("\n")).toContain("去做 g");
	// the keys and the click go through the popup's own handlers
	let closed = 0;
	const popup: any = new JobsPopup({ requestRender() {}, terminal: { rows: 40 } } as any, theme as any, { list: () => [job], onChange: () => () => {} }, () => closed++, job.id);
	popup.render(120);
	popup.handleInput("2"); // select the second item
	popup.render(120);
	popup.handleInput("x");
	expect(acted).toEqual(["alert:dirty:x"]);
	popup.handleInput("1");
	expect(closed).toBe(0);
	popup.handleInput("\r"); // Enter = the first button, "去做"; handing it over closes the popup so the user sees the work
	expect(acted).toEqual(["alert:dirty:x", "t1:g"]);
	expect(closed).toBe(1);
	popup.handleInput("q");
	popup.dispose();
});

test("with a long backlog the items sit under group headings; space ticks several, g or x acts on all ticked, and the whole-list buttons are clickable", async () => {
	const { popupLines, JobsPopup } = await loadFirecodeModule("statusbar/jobs-popup.ts");
	const theme = { fg: (_c: string, x: string) => x, bold: (x: string) => x };
	const calls: string[] = [];
	const mk = (id: string, group: string, hint?: string) => ({ id, text: `事 ${id}`, tag: "待办", group, hint, actions: [{ key: "g", label: "去做", close: true }, { key: "x", label: "忽略" }] });
	const job: any = {
		id: "sentinel-session", role: "哨兵", title: "会话", detail: "5 件事没做完", state: "waiting", startedAt: Date.now() - 600000,
		items: [mk("t1", "建议去做", "很明确"), mk("t2", "建议去做"), mk("t3", "建议忽略", "太模糊"), mk("t4", "建议忽略"), mk("t5", "要你定")],
		tools: [{ key: "t", label: "整理" }, { key: "y", label: "照建议处理" }],
		act: (id: string, key: string) => calls.push(`act:${id}:${key}`),
		actMany: (ids: string[], key: string) => calls.push(`many:${ids.join(",")}:${key}`),
	};
	const plainLines = (v: any) => v.lines.map((l: string) => l.replace(/\x1b\[[0-9;]*m/g, ""));
	const v = popupLines(theme as any, { view: "list", selected: job.id, focus: "members", member: 0, picked: new Set(["t3"]) }, [job], 120, Date.now(), 0, 40);
	const text = plainLines(v).join("\n");
	expect(text).toContain("── 建议去做（2）");
	expect(text).toContain("── 建议忽略（2）");
	expect(text).toContain("── 要你定（1）");
	expect(text).toContain("← 很明确"); // the sentinel's reason sits behind the item
	expect(text).toContain("已选 1");
	expect(text).toContain("■"); // t3 is ticked
	expect(text).toContain("整理 t");
	expect(text).toContain("照建议处理 y");
	const tools = v.hits.filter((h: any) => typeof h.action === "object" && "tool" in h.action).map((h: any) => h.action.tool);
	expect(tools).toEqual(["t", "y"]);
	expect(v.hits.filter((h: any) => typeof h.action === "object" && "toggle" in h.action).length).toBe(5); // every item has a clickable box

	let closed = 0;
	const popup: any = new JobsPopup({ requestRender() {}, terminal: { rows: 40 } } as any, theme as any, { list: () => [job], onChange: () => () => {} }, () => closed++, job.id);
	popup.render(120);
	popup.handleInput("1");
	popup.handleInput("a"); // a: tick the whole group the cursor is in
	popup.handleInput("x");
	expect(calls).toEqual(["many:t1,t2:x"]);
	popup.handleInput("3");
	popup.handleInput(" "); // tick t3
	popup.handleInput("j");
	popup.handleInput(" "); // tick t4
	popup.handleInput("g");
	expect(calls.at(-1)).toBe("many:t3,t4:g");
	expect(closed).toBe(1); // handing a batch to Pi closes the popup
	popup.handleInput("y"); // a whole-list tool key
	expect(calls.at(-1)).toBe("act::y");
	popup.dispose();
});
