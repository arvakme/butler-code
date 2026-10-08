/** 后台任务弹窗，布局像 Telescope：左边是任务列表（上下选择），右边是选中那一项的详情；终端太窄时退回“列表 → 详情”两步。
 *  详情依次是：状态、任务、模型、进度（含并发成员）、起止时间，之后是结果、最近动态、过程记录的位置。
 *  再往里：回车（或点击）进入成员（调研员、审查者），再回车看这一位的完整过程（调用了什么工具、传了什么、返回什么、模型说了什么，
 *  模型说的话按 Markdown 渲染），实时更新、可滚动；worker 没有成员，回车直接看它自己的过程。已结束的任务变灰，排在最下面。
 *  数据来自 agents/jobs.ts 的任务登记簿。
 *  高度：弹窗总高不超过终端的 80%，放不下的部分（右边详情、左边列表、过程页）都可以滚动，不会被输入框挡住或截断。
 *  可选中的东西：选中的行有底色，按钮有底色；tmux 里 Pi 只上报点击和拖动、不上报鼠标悬停，所以不做悬停高亮。 */
import { matchesKey, visibleWidth, wrapTextWithAnsi, type Component, type TUI, type TuiMouseEvent, type TuiMouseEventResult } from "@earendil-works/pi-tui";
import { clip } from "../format.js";
import { detailOf, isLive, type Job, type Jobs } from "../agents/jobs.js";
import { elapsed, type Palette } from "./render.js";

/** 把一段 Markdown 渲染成带样式的行（宿主提供；没有就按纯文字折行） */
export type MarkdownFn = (text: string, width: number) => string[];
/** 弹窗里的顺序：在跑的在前（先开始的在前），已结束的在后（最近结束的在前） */
export const ordered = (jobs: Job[]): Job[] => [...jobs.filter(isLive).sort((a, b) => a.startedAt - b.startedAt), ...jobs.filter((j) => !isLive(j)).sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))];

type Hit = { y: number; x0: number; x1: number; action: "close" | "back" | { pick: string } | { member: number } | { trace: true } | { act: { item: number; key: string } } | { tool: string } | { toggle: number } };
/** view：list（宽屏下是左右分栏）/ detail（窄屏的详情页）/ trace（某个成员或任务的完整过程）。
 *  focus：方向键作用在哪（jobs 左边的任务，members 右边的成员；窄屏的详情页固定是 members）。
 *  detailScroll：右边详情往下滚了几行；scroll / follow：过程页的位置和是否跟随最新。 */
export type PopupState = { picked?: ReadonlySet<string>; selected?: string; view: "list" | "detail" | "trace"; focus?: "jobs" | "members"; member?: number; detailScroll?: number; scroll?: number; follow?: boolean; from?: "list" | "detail" };
export const WIDE = 84;
/** 弹窗总高占终端的比例；内容按这个算好，放不下的可以滚动 */
export const HEIGHT_RATIO = 0.8;
const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const MAX_NOTES = 6;
const MAX_MEMBERS = 8;
const MAX_RESULT_ROWS = 12;

const clock = (ms: number, now: number) => {
	const d = new Date(ms);
	return `${new Date(now).toDateString() === d.toDateString() ? "" : `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} `}${d.toTimeString().slice(0, 8)}`;
};
const STATUS = { running: ["已派出，进行中", "accent"], waiting: ["在等你", "warning"], done: ["已完成", "success"], failed: ["失败", "error"], stopped: ["已停止", "muted"] } as const;

function mark(theme: Palette, job: Job, frame: number): string {
	if (job.state === "running") return theme.fg("accent", SPINNER[frame % SPINNER.length]);
	if (job.state === "waiting") return theme.fg("warning", "!");
	return theme.fg(job.state === "failed" ? "error" : "dim", job.state === "done" ? "✓" : job.state === "failed" ? "✗" : "■");
}
/** 选中行的底色，补空格铺满 width 列；没有底色能力（测试里的假主题）就加粗 */
const highlight = (theme: Palette, text: string, width: number) => (theme.bg ? theme.bg("selectedBg", text + " ".repeat(Math.max(0, width - visibleWidth(text)))) : theme.bold(text));
/** 按钮：带底色的一小块，一眼看得出能点 */
const button = (theme: Palette, text: string) => (theme.bg ? theme.bg("selectedBg", theme.fg("accent", text)) : theme.fg("accent", text));

/** 过程记录能看的内容：成员自己的过程；没有成员的任务看它自己的过程，再没有就看最近动态 */
export function traceOf(job: Job, member?: number): { title: string; lines: string[]; model?: string } {
	const m = member === undefined ? undefined : job.members?.[member];
	if (m) return { title: m.name, lines: m.trace ?? [], model: m.model ?? job.model };
	// 最近动态没有标记字符（“时间 内容”），补上 · 才能和过程记录同样显示
	return { title: job.title, lines: job.trace?.length ? job.trace : (job.notes ?? []).map((n) => `${n.slice(0, 8)} · ${n.slice(9)}`), model: job.model };
}
const hasTrace = (job: Job) => (job.trace?.length ?? 0) > 0 || (job.members?.some((m) => (m.trace?.length ?? 0) > 0) ?? false);

/** 右边（或窄屏时整页）的详情。members 记下每位成员占的行，用于点击、高亮和滚动到可见处。 */
export function detailBlock(theme: Palette, job: Job, width: number, now: number, frame: number, memberFocus?: number, picked: ReadonlySet<string> = new Set()): { lines: string[]; members: { start: number; end: number }[]; open?: number; buttons: { line: number; x0: number; x1: number; item: number; key: string }[]; tools: { line: number; x0: number; x1: number; key: string }[]; boxes: { line: number; x0: number; x1: number; item: number }[] } {
	const out: string[] = [];
	const members: { start: number; end: number }[] = [];
	const buttons: { line: number; x0: number; x1: number; item: number; key: string }[] = [];
	const tools: { line: number; x0: number; x1: number; key: string }[] = [];
	const boxes: { line: number; x0: number; x1: number; item: number }[] = [];
	let open: number | undefined;
	const wrap = (text: string, indent: string) => wrapTextWithAnsi(text, Math.max(8, width - visibleWidth(indent))).map((l) => `${indent}${l}`);
	const field = (label: string, value: string) => {
		const lines = wrapTextWithAnsi(value, Math.max(8, width - 6));
		lines.forEach((l, i) => out.push(`${i === 0 ? theme.fg("dim", `${label}  `) : "      "}${l}`));
	};
	const [text, color] = STATUS[job.state];
	field("状态", `${mark(theme, job, frame)} ${theme.fg(color, text)}`);
	out.push("", theme.fg("accent", theme.bold("任务")), ...wrap(job.task ?? job.title, "  "));
	field("模型", job.model ? job.model : theme.fg("dim", "没有记录"));
	if (job.items?.length) {
		// 要你处理的事：分组、一条一行；空格多选，选中的打勾；选中的那条下面是按钮，每个按钮上写着快捷键。
		out.push("", theme.fg("accent", theme.bold(`要你处理的事（${job.items.length}${picked.size ? `，已选 ${picked.size}` : ""}）`)));
		if (job.tools?.length) {
			let x = 2;
			const parts = job.tools.map((t) => {
				const text = ` ${t.label} ${theme.fg("dim", t.key)} `;
				const w = visibleWidth(text);
				tools.push({ line: out.length, x0: x, x1: x + w, key: t.key });
				x += w + 1;
				return button(theme, text);
			});
			out.push(`  ${parts.join(" ")}`);
		}
		let group: string | undefined;
		job.items.forEach((item, i) => {
			if (item.group && item.group !== group) {
				group = item.group;
				const count = job.items!.filter((entry) => entry.group === group).length;
				out.push(theme.fg("dim", `  ── ${group}（${count}）${"─".repeat(Math.max(2, width - visibleWidth(group) - 14))}`));
			}
			const selected = memberFocus === i;
			const tone = item.tone ?? "accent";
			const tag = theme.fg(tone, `[${item.tag}]`);
			const age = item.age ? theme.fg("dim", `  ${item.age}`) : "";
			const hint = item.hint ? theme.fg("dim", `  ← ${item.hint}`) : "";
			const number = selected ? theme.fg("accent", theme.bold(`› ${i + 1}. `)) : theme.fg("dim", `  ${i + 1}. `);
			const box = picked.has(item.id) ? theme.fg("accent", "■ ") : theme.fg("dim", "□ ");
			const prefixW = visibleWidth(number) + 2;
			const lines = wrapTextWithAnsi(`${tag} ${item.text}${age}${hint}`, Math.max(8, width - prefixW - 1));
			const start = out.length;
			const rendered = lines.map((l, k) => (k === 0 ? `${number}${box}${l}` : `${" ".repeat(prefixW)}${l}`));
			boxes.push({ line: start, x0: visibleWidth(number), x1: prefixW, item: i });
			out.push(...(selected ? rendered.map((l) => highlight(theme, l, width)) : rendered));
			if (selected) {
				let x = prefixW;
				const parts = item.actions.map((a) => {
					const text = ` ${a.label} ${theme.fg("dim", a.key)} `;
					const w = visibleWidth(text);
					buttons.push({ line: out.length, x0: x, x1: x + w, item: i, key: a.key });
					x += w + 1;
					return button(theme, text);
				});
				out.push(`${" ".repeat(prefixW)}${parts.join(" ")}`);
			}
			members.push({ start, end: out.length });
		});
		out.push(theme.fg("dim", memberFocus === undefined ? "  数字键或点一条来选；空格打勾多选，a 选中本组全部，然后按 g 去做 / x 忽略" : "  ↑↓ 选一条 · 空格打勾 · a 选本组 · g 去做 · x 忽略 · 回车 = 第一个按钮 · ← 返回"));
	}
	out.push("", theme.fg("accent", theme.bold("进度")));
	const detail = detailOf(job);
	if (detail) out.push(...wrap(detail, "  "));
	// 成员是编号列表：`  1. ⠸ 名字`，折行的部分缩进对齐在名字下面，每位最多两行（完整的名字在它的过程页标题里）；选中的是 `› 2.` 加底色
	(job.members ?? []).slice(0, MAX_MEMBERS).forEach((m, i) => {
		const markM = m.state === "done" ? theme.fg("success", "✓") : m.state === "failed" ? theme.fg("error", "✗") : theme.fg("accent", SPINNER[frame % SPINNER.length]);
		const extra = [m.note, m.model && m.model !== job.model ? m.model : "", m.trace?.length ? `${m.trace.length} 步` : ""].filter(Boolean).join(" · ");
		const selected = memberFocus === i;
		const nameW = Math.max(8, width - 7);
		const suffix = extra ? `  ${extra}` : "";
		const room = Math.max(4, nameW - visibleWidth(suffix)); // 最后一行给“N 步”这类说明留位置，名字被截也不能把它挤掉
		let pieces = wrapTextWithAnsi(m.name, nameW);
		if (pieces.length > 2) pieces = [pieces[0], pieces.slice(1).join("")];
		const last = pieces.length - 1;
		pieces[last] = `${clip(pieces[last], room, "end")}${suffix ? theme.fg("dim", suffix) : ""}`;
		const number = selected ? theme.fg("accent", theme.bold(`› ${i + 1}. `)) : theme.fg("dim", `  ${i + 1}. `);
		const lines = pieces.map((piece, k) => (k === 0 ? `${number}${markM} ${piece}` : `       ${piece}`));
		members.push({ start: out.length, end: out.length + lines.length });
		out.push(...(selected ? lines.map((l) => highlight(theme, l, width)) : lines));
	});
	if ((job.members?.length ?? 0) > MAX_MEMBERS) out.push(theme.fg("dim", `  …还有 ${(job.members?.length ?? 0) - MAX_MEMBERS} 个`));
	if (job.items?.length) {
		/* 事项已经在上面列过 */
	} else if (job.members?.length) out.push(theme.fg("dim", memberFocus === undefined ? `  点某一位的行，或按数字键 1-${Math.min(9, job.members.length)}：看它的完整过程` : "  ↑↓ 选 · 回车、点击或数字键：看完整过程 · ← 返回"));
	else if (hasTrace(job) || job.notes?.length) (open = out.length), out.push(`  ${button(theme, ` ▸ 看完整过程（${job.trace?.length ?? job.notes?.length ?? 0} 条） `)}`);
	out.push("");
	field("开始", clock(job.startedAt, now));
	field("结束", job.endedAt ? clock(job.endedAt, now) : theme.fg("dim", `还没有结束，已用 ${elapsed(job.startedAt, now)}`));
	if (job.endedAt) field("用时", elapsed(job.startedAt, job.endedAt));
	if (job.result) out.push("", theme.fg("accent", theme.bold("结果")), ...wrap(job.result, "  "));
	const notes = (job.notes ?? []).slice(-MAX_NOTES);
	if (notes.length) out.push("", theme.fg("accent", theme.bold("最近动态")), ...notes.map((n) => `  ${theme.fg("muted", clip(n, Math.max(8, width - 2), "end"))}`));
	if (job.log) out.push("", theme.fg("accent", theme.bold("过程记录")), ...wrap(job.log, "  "));
	return { lines: out, members, open, buttons, tools, boxes };
}

/** 工具调用的参数：JSON 对象一项一行（只有一项就写在工具名后面），不是 JSON 就原样 */
function callRows(theme: Palette, rest: string, width: number): string[] {
	const space = rest.search(/\s/);
	const name = space < 0 ? rest : rest.slice(0, space);
	const args = space < 0 ? "" : rest.slice(space + 1).trim();
	const head = theme.fg("accent", theme.bold(name));
	let parsed: unknown;
	try {
		parsed = args ? JSON.parse(args) : undefined;
	} catch {}
	const wrap = (text: string, indent: string) => text.split("\n").flatMap((l) => wrapTextWithAnsi(l, Math.max(8, width - visibleWidth(indent)))).map((l) => `${indent}${l}`);
	if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
		const entries = Object.entries(parsed as Record<string, unknown>);
		const show = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v));
		if (entries.length === 1) return wrapTextWithAnsi(`${head}  ${show(entries[0][1])}`, width);
		return [head, ...entries.flatMap(([k, v]) => wrap(`${theme.fg("dim", `${k}:`)} ${show(v)}`, "  "))];
	}
	return args ? wrapTextWithAnsi(`${head}  ${args}`, width) : [head];
}

/** 完整过程：`HH:MM:SS 标记 内容`。说 / 想按 Markdown 渲染；→ 调用把参数拆开；← 返回的内容保留换行、最多显示前几行；其余按标记上色。 */
export function traceRows(theme: Palette, lines: string[], width: number, md?: MarkdownFn): string[] {
	const body = Math.max(10, width - 11);
	const wrap = (text: string) => text.split("\n").flatMap((l) => wrapTextWithAnsi(l, body));
	const out: string[] = [];
	for (const raw of lines) {
		const time = raw.slice(0, 8);
		const marker = raw[9] ?? "";
		const rest = raw.slice(11);
		let rows: string[];
		if (marker === "说" || marker === "想") rows = (md ? md(rest, body) : wrap(rest)).map((l) => l.trimEnd());
		else if (marker === "→") rows = callRows(theme, rest, body);
		else if (marker === "←" || marker === "✗") {
			const space = rest.search(/\s/);
			const name = space < 0 ? rest : rest.slice(0, space);
			const text = space < 0 ? "" : rest.slice(space + 1);
			const all = wrap(text);
			const tone = marker === "✗" ? "error" : "muted";
			if (all.length <= 1) rows = wrapTextWithAnsi(`${theme.fg(marker === "✗" ? "error" : "dim", name)}  ${theme.fg(tone, text)}`, body); // 一行能说完的，和工具名写在一起
			else {
				rows = [theme.fg(marker === "✗" ? "error" : "dim", name), ...all.slice(0, MAX_RESULT_ROWS).map((l) => `  ${theme.fg(tone, l)}`)];
				if (all.length > MAX_RESULT_ROWS) rows.push(theme.fg("dim", `  …还有 ${all.length - MAX_RESULT_ROWS} 行`));
			}
		} else rows = wrap(rest).map((l) => theme.fg("dim", l));
		if (rows.length === 0) rows = [""];
		const color = marker === "→" ? "accent" : marker === "←" ? "muted" : marker === "✗" ? "error" : marker === "想" || marker === "·" ? "dim" : undefined;
		const shownMarker = color ? theme.fg(color, marker) : marker;
		rows.forEach((piece, i) => out.push(i === 0 ? `${theme.fg("dim", time)} ${shownMarker} ${piece}` : `           ${piece}`));
	}
	return out;
}

/** 放不下时的窗口：把选中的那行放在中间附近 */
const windowStart = (at: number, count: number, rows: number) => (count <= rows ? 0 : Math.max(0, Math.min(count - rows, at - Math.floor(rows / 2))));
/** 截出 rows 行，上下还有内容时在首尾行写提示 */
function windowed(theme: Palette, lines: string[], rows: number, scroll: number): string[] {
	if (lines.length <= rows) return lines;
	const view = lines.slice(scroll, scroll + rows);
	if (scroll > 0) view[0] = theme.fg("dim", `↑ 上面还有 ${scroll} 行（PgUp / 滚轮）`);
	if (scroll + rows < lines.length) view[rows - 1] = theme.fg("dim", `↓ 下面还有 ${lines.length - scroll - rows + 1} 行（PgDn / 滚轮）`);
	return view;
}

export type PopupOut = { lines: string[]; hits: Hit[]; selected?: string; total: number; rows: number; detailScroll: number; detailMax: number };
/** 画出弹窗的每一行，并给出可点击区域（y 从 0 起，x 是列）。不碰终端，便于测试。height 是内容区最多几行（不含标题、分隔线、提示行、底边）。 */
export function popupLines(theme: Palette, state: PopupState, all: Job[], width: number, now: number, frame: number, height = 20, md?: MarkdownFn, stats: readonly string[] = []): PopupOut {
	const jobs = ordered(all);
	const hits: Hit[] = [];
	const border = (t: string) => theme.fg("borderMuted", t);
	const wide = width >= WIDE;
	const selected = jobs.find((j) => j.id === state.selected) ?? jobs[0];
	const live = jobs.filter(isLive).length;
	// 超宽的内容（窄屏时的操作提示）先裁再补齐，右边框才不会被挤出屏幕
	const pad = (text: string, w: number) => {
		const fitted = clip(text, w - 2);
		return ` ${fitted}${" ".repeat(Math.max(0, w - 2 - visibleWidth(fitted)))} `;
	};
	const row = (text: string) => `${border("│")}${pad(text, width - 2)}${border("│")}`;
	const body: string[] = [];
	let total = 0;
	let detailScroll = 0;
	let detailMax = 0;
	// 标题由三段组成，最后按剩下的宽度裁（过长会把按钮挤出屏幕，点击位置也就对不上了）
	let titleHead = "后台任务";
	let titleName = "";
	let titleTail = "";
	let controls: { text: string; action: "close" | "back" }[] = [{ text: "✕ 关闭", action: "close" }];

	/** 详情区的滚动：选中的成员要在可见范围内 */
	const place = (block: ReturnType<typeof detailBlock>, rows: number) => {
		detailMax = Math.max(0, block.lines.length - rows);
		let at = Math.max(0, Math.min(state.detailScroll ?? 0, detailMax));
		const m = state.focus === "members" || state.view === "detail" ? block.members[state.member ?? 0] : undefined;
		if (m && block.lines.length > rows) {
			if (m.start < at + 1) at = Math.max(0, m.start - 1);
			if (m.end > at + rows - 1) at = Math.min(detailMax, m.end - rows + 1);
		}
		detailScroll = at;
		return at;
	};

	if (state.view === "trace" && selected) {
		const t = traceOf(selected, state.member);
		const wrapped = traceRows(theme, t.lines, width - 4, md);
		total = wrapped.length;
		const top = state.follow === false ? Math.max(0, Math.min(state.scroll ?? 0, Math.max(0, total - height))) : Math.max(0, total - height);
		titleHead = `${selected.role} › `;
		titleName = t.title;
		titleTail = t.model ? `  ${clip(t.model, 20, "end")}` : "";
		controls = [{ text: "‹ 返回", action: "back" }, ...controls];
		for (let i = 0; i < height; i++) body.push(row(wrapped[top + i] ?? (i === 0 && total === 0 ? theme.fg("dim", "还没有记录。") : "")));
		const where = total === 0 ? "" : `第 ${top + 1}-${Math.min(total, top + height)} / ${total} 行 · ${state.follow === false && top < total - height ? "已暂停（G 回到最新）" : isLive(selected) ? "跟随最新" : "已结束"}`;
		body.push(row(theme.fg("dim", `↑↓ 滚动 · PgUp/PgDn 翻页 · G 跟随最新 · Esc 返回${where ? ` · ${where}` : ""}`)));
	} else if (!wide && state.view === "detail" && selected) {
		titleHead = `${selected.role} · `;
		titleName = selected.title;
		controls = [{ text: "‹ 返回", action: "back" }, ...controls];
		const block = detailBlock(theme, selected, width - 4, now, frame, selected.members?.length || selected.items?.length ? state.member ?? 0 : undefined, state.picked);
		const rows = Math.min(block.lines.length, height);
		const at = place(block, rows);
		windowed(theme, block.lines, rows, at).forEach((l) => body.push(row(l)));
		block.tools.forEach((t) => { if (t.line >= at && t.line < at + rows) hits.push({ y: t.line - at + 1, x0: 2 + t.x0, x1: 2 + t.x1, action: { tool: t.key } }); });
		block.buttons.forEach((b) => { if (b.line >= at && b.line < at + rows) hits.push({ y: b.line - at + 1, x0: 2 + b.x0, x1: 2 + b.x1, action: { act: { item: b.item, key: b.key } } }); });
		block.boxes.forEach((b) => { if (b.line >= at && b.line < at + rows) hits.push({ y: b.line - at + 1, x0: 2 + b.x0, x1: 2 + b.x1, action: { toggle: b.item } }); });
		block.members.forEach((m, i) => { if (m.start >= at && m.start < at + rows) hits.push({ y: m.start - at + 1, x0: 0, x1: width, action: { member: i } }); });
		if (block.open !== undefined && block.open >= at && block.open < at + rows) hits.push({ y: block.open - at + 1, x0: 0, x1: width, action: { trace: true } });
		body.push(row(theme.fg("dim", "Esc 返回列表")));
	} else {
		titleHead = jobs.length ? `后台任务（${live} 个在跑${jobs.length > live ? `，${jobs.length - live} 个已结束` : ""}）` : "后台任务";
		const leftW = wide ? Math.min(40, Math.max(28, Math.floor(width * 0.36))) : width - 2;
		const rightW = wide ? width - leftW - 3 : 0;
		const left: string[] = [];
		const leftHit: (string | undefined)[] = [];
		if (jobs.length === 0) left.push(theme.fg("dim", "现在没有后台任务。"));
		let sawEnded = false;
		for (const j of jobs) {
			if (!isLive(j) && !sawEnded) {
				sawEnded = true;
				if (left.length) (left.push(""), leftHit.push(undefined));
				left.push(theme.fg("dim", "已结束"));
				leftHit.push(undefined);
			}
			const text = clip(`${j.role} · ${j.title}`, Math.max(6, leftW - 8), "end");
			const isSel = j.id === selected?.id;
			const cell = `${isSel ? theme.fg("accent", state.focus === "members" ? "·" : "›") : " "} ${mark(theme, j, frame)} ${isLive(j) ? text : theme.fg("dim", text)}`;
			left.push(isSel && state.focus !== "members" ? highlight(theme, theme.bold(cell), leftW - 2) : isSel ? theme.bold(cell) : cell);
			leftHit.push(j.id);
		}
		if (wide) {
			const block = selected ? detailBlock(theme, selected, rightW - 2, now, frame, state.focus === "members" ? state.member ?? 0 : undefined, state.picked) : { lines: [], members: [] as { start: number; end: number }[], open: undefined, buttons: [] as { line: number; x0: number; x1: number; item: number; key: string }[], tools: [] as { line: number; x0: number; x1: number; key: string }[], boxes: [] as { line: number; x0: number; x1: number; item: number }[] };
			const rows = Math.min(Math.max(left.length, block.lines.length, 12), height);
			const at = place(block, rows);
			const leftStart = windowStart(Math.max(0, leftHit.indexOf(selected?.id)), left.length, rows);
			const right = windowed(theme, block.lines, rows, at);
			const leftView = left.slice(leftStart, leftStart + rows);
			for (let i = 0; i < rows; i++) {
				if (leftHit[leftStart + i]) hits.push({ y: i + 1, x0: 0, x1: leftW + 2, action: { pick: leftHit[leftStart + i]! } });
				body.push(`${border("│")}${pad(leftView[i] ?? "", leftW)}${border("│")}${pad(right[i] ?? "", rightW)}${border("│")}`);
			}
			block.tools.forEach((t) => { if (t.line >= at && t.line < at + rows) hits.push({ y: t.line - at + 1, x0: leftW + 3 + t.x0, x1: leftW + 3 + t.x1, action: { tool: t.key } }); });
			block.buttons.forEach((b) => { if (b.line >= at && b.line < at + rows) hits.push({ y: b.line - at + 1, x0: leftW + 3 + b.x0, x1: leftW + 3 + b.x1, action: { act: { item: b.item, key: b.key } } }); });
			block.boxes.forEach((b) => { if (b.line >= at && b.line < at + rows) hits.push({ y: b.line - at + 1, x0: leftW + 3 + b.x0, x1: leftW + 3 + b.x1, action: { toggle: b.item } }); });
			block.members.forEach((m, i) => { for (let y = m.start; y < m.end; y++) if (y >= at && y < at + rows) hits.push({ y: y - at + 1, x0: leftW + 2, x1: width, action: { member: i } }); });
			if (block.open !== undefined && block.open >= at && block.open < at + rows) hits.push({ y: block.open - at + 1, x0: leftW + 2, x1: width, action: { trace: true } });
			body.push(border(`├${"─".repeat(leftW)}┴${"─".repeat(rightW)}┤`));
			const withItems = (selected?.items?.length ?? 0) > 0;
			body.push(row(theme.fg("dim", state.focus === "members"
				? (withItems ? "↑↓ 选一条 · 按钮上的字母或点按钮：处理 · 回车 = 第一个按钮 · ← 返回任务列表 · Esc 关闭" : "↑↓ 选成员 · 回车、点击或数字键看完整过程 · ← 返回任务列表 · Esc 关闭")
				: withItems ? "↑↓ 选任务 · 数字键或点一条事项：选中后处理 · PgUp/PgDn 滚动详情 · Ctrl+\\ / Esc 关闭" : "↑↓ 选任务 · 数字键或点击成员看过程 · PgUp/PgDn 滚动详情 · c 清除已结束 · Ctrl+\\ / Esc 关闭")));
		} else {
			const rows = Math.min(left.length, height);
			const start = windowStart(Math.max(0, leftHit.indexOf(selected?.id)), left.length, rows);
			left.slice(start, start + rows).forEach((l, i) => {
				if (leftHit[start + i]) hits.push({ y: i + 1, x0: 0, x1: width, action: { pick: leftHit[start + i]! } });
				body.push(row(l));
			});
			body.push(row(theme.fg("dim", "↑↓ 选择 · 回车或点击看详情 · c 清除已结束 · Esc 关闭")));
		}
	}

	// 标题行：左边标题，右边是可点的按钮（带底色的小块）
	const shown = controls.map((c) => ` ${c.text} `);
	const buttonsW = shown.reduce((n, s) => n + visibleWidth(s), 0) + (shown.length - 1);
	const budget = Math.max(10, width - buttonsW - 8);
	const nameRoom = Math.max(4, budget - visibleWidth(titleHead) - visibleWidth(titleTail));
	let title = `${theme.fg("accent", theme.bold(titleHead))}${titleName ? theme.fg("accent", theme.bold(clip(titleName, nameRoom, "end"))) : ""}${titleTail ? theme.fg("dim", titleTail) : ""}`;
	if (visibleWidth(title) > budget) title = clip(title, budget, "end");
	const room = Math.max(1, width - buttonsW - visibleWidth(title) - 6);
	const top = `${border("╭")} ${title} ${border("─".repeat(room))} ${shown.map((s) => button(theme, s)).join(" ")} ${border("╮")}`;
	let x = width - 2 - buttonsW;
	controls.forEach((c, i) => {
		hits.push({ y: 0, x0: x, x1: x + visibleWidth(shown[i]), action: c.action });
		x += visibleWidth(shown[i]) + 1;
	});
	// 底边框嵌着会话统计（缓存命中、速度、分支、会话 ID）：由长到短取第一档放得下的，都放不下就是一条纯横线
	const shownStats = stats.find((tier) => visibleWidth(tier) <= width - 6) ?? "";
	const bottom = shownStats ? `${border("╰─")} ${shownStats} ${border(`${"─".repeat(width - 5 - visibleWidth(shownStats))}╯`)}` : border(`╰${"─".repeat(width - 2)}╯`);
	return { lines: [top, ...body, bottom], hits, selected: selected?.id, total, rows: height, detailScroll, detailMax };
}

export class JobsPopup implements Component {
	private state: PopupState;
	private hits: Hit[] = [];
	private readonly unsubscribe: () => void;
	private readonly spin: ReturnType<typeof setInterval>;
	private width = 0;
	private meta = { total: 0, rows: 20, detailMax: 0, leftW: 0 };
	private readonly cache = new Map<string, string[]>();
	constructor(
		private readonly tui: TUI,
		private readonly theme: Palette,
		private readonly registry: Pick<Jobs, "list" | "onChange" | "clearEnded">,
		private readonly done: () => void,
		startId?: string,
		private readonly markdown?: MarkdownFn,
		private readonly stats: () => readonly string[] = () => [],
	) {
		this.state = { selected: startId, view: "list", focus: "jobs" };
		this.unsubscribe = registry.onChange(() => tui.requestRender());
		this.spin = setInterval(() => registry.list().some(isLive) && tui.requestRender(), 150);
		this.spin.unref?.();
		// Markdown 渲染按（宽度，文字）缓存：过程页每秒刷新好几次，不能每次都重新解析
		if (markdown)
			this.md = (text, width) => {
				const key = `${width}\u0000${text}`;
				let hit = this.cache.get(key);
				if (!hit) {
					hit = markdown(text, width);
					if (this.cache.size > 1500) this.cache.clear();
					this.cache.set(key, hit);
				}
				return hit;
			};
	}
	private md: MarkdownFn | undefined;
	private ids = () => ordered(this.registry.list()).map((j) => j.id);
	private current = () => ordered(this.registry.list()).find((j) => j.id === this.state.selected) ?? ordered(this.registry.list())[0];
	private move(delta: number) {
		const ids = this.ids();
		if (!ids.length) return;
		const at = Math.max(0, ids.indexOf(this.state.selected ?? ids[0]));
		this.state.selected = ids[Math.min(ids.length - 1, Math.max(0, at + delta))];
		this.state.detailScroll = 0;
	}
	private moveMember(delta: number) {
		const job = this.current();
		const n = job?.items?.length ?? job?.members?.length ?? 0;
		if (n) this.state.member = Math.min(n - 1, Math.max(0, (this.state.member ?? 0) + delta));
	}
	/** 进入：有成员就先进成员，没有就直接看它自己的过程 */
	private enter() {
		const job = this.current();
		if (!job) return;
		const wide = this.width >= WIDE;
		const inside = wide ? this.state.focus === "members" : this.state.view === "detail";
		if ((job.members?.length || job.items?.length) && !inside) {
			this.state = { ...this.state, view: wide ? "list" : "detail", focus: "members", member: 0 };
		} else if (job.items?.length) {
			const item = job.items[this.state.member ?? 0];
			if (item?.actions[0]) this.act(item.actions[0].key); // 回车 = 第一个按钮
		} else this.openTrace(job.members?.length ? this.state.member ?? 0 : undefined);
	}
	/** 对选中的那一条事项按一个动作；动作由任务自己处理，登记簿一变，弹窗就跟着重画 */
	private act(key: string, itemIndex = this.state.member ?? 0) {
		const job = this.current();
		const item = job?.items?.[itemIndex];
		const action = item?.actions.find((a) => a.key === key);
		const picked = [...(this.state.picked ?? [])].filter((id) => job?.items?.some((i) => i.id === id));
		if (job && item && action && picked.length > 0 && job.actMany) {
			// 有勾选的就对整批做同一个动作，没勾选才只管光标那一条
			job.actMany(picked, key);
			this.state.picked = new Set();
			if (action.close) return this.done();
			const left = job.items?.length ?? 0;
			if (left > 0) this.state.member = Math.min(itemIndex, left - 1);
			else this.state = { ...this.state, focus: "jobs", member: 0 };
		} else if (job && item && action) {
			job.act?.(item.id, key); // 任务当场更新自己的 items，所以下面读到的已经是处理之后的
			if (action.close) return this.done(); // “去做”：交给 Pi 了，关掉弹窗让用户看它干活
			const left = job.items?.length ?? 0;
			if (left > 0) this.state.member = Math.min(itemIndex, left - 1); // 这条处理掉以后，选中原来位置上的下一条
			else this.state = { ...this.state, focus: "jobs", member: 0 };
		}
	}
	/** 打勾或取消打勾；默认是光标那一条 */
	private toggle(itemIndex = this.state.member ?? 0) {
		const id = this.current()?.items?.[itemIndex]?.id;
		if (!id) return;
		const next = new Set(this.state.picked ?? []);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		this.state.picked = next;
	}
	/** a：光标那条所在的整组一起勾上（已经全勾了就全取消） */
	private toggleGroup() {
		const items = this.current()?.items ?? [];
		const at = items[this.state.member ?? 0];
		if (!at) return;
		const ids = items.filter((i) => i.group === at.group).map((i) => i.id);
		const next = new Set(this.state.picked ?? []);
		const all = ids.every((id) => next.has(id));
		for (const id of ids) all ? next.delete(id) : next.add(id);
		this.state.picked = next;
	}
	/** 对整个任务的操作（整理、照建议处理…）；做完后勾选清空 */
	private tool(key: string): boolean {
		const job = this.current();
		if (!job?.tools?.some((t) => t.key === key) || !job.act) return false;
		job.act("", key);
		this.state.picked = new Set();
		const left = job.items?.length ?? 0;
		this.state.member = Math.min(this.state.member ?? 0, Math.max(0, left - 1));
		return true;
	}
	private openTrace(member?: number) {
		this.state = { ...this.state, view: "trace", member, follow: true, scroll: 0, from: this.width >= WIDE ? "list" : this.state.view === "detail" ? "detail" : "list" };
	}
	/** 从过程页退一级：回到进来的那一页（成员列表），不是关掉弹窗 */
	private leaveTrace() {
		this.state = { ...this.state, view: this.state.from === "detail" ? "detail" : "list", focus: this.state.member === undefined ? "jobs" : "members" };
	}
	private scroll(delta: number) {
		const bottom = Math.max(0, this.meta.total - this.meta.rows);
		const top = this.state.follow === false ? this.state.scroll ?? 0 : bottom;
		const next = Math.max(0, Math.min(bottom, top + delta));
		this.state.scroll = next;
		this.state.follow = delta > 0 && next >= bottom;
	}
	private scrollDetail(delta: number) {
		this.state.detailScroll = Math.max(0, Math.min(this.meta.detailMax, (this.state.detailScroll ?? 0) + delta));
	}
	render(width: number): string[] {
		this.width = width;
		const termRows = (this.tui as any).terminal?.rows ?? 40;
		const rows = Math.max(5, Math.floor(termRows * HEIGHT_RATIO) - 4);
		const out = popupLines(this.theme, this.state, this.registry.list(), width, Date.now(), Math.floor(Date.now() / 120), rows, this.md, this.stats());
		this.hits = out.hits;
		this.state.selected = out.selected;
		this.state.detailScroll = out.detailScroll;
		this.meta = { total: out.total, rows: out.rows, detailMax: out.detailMax, leftW: width >= WIDE ? Math.min(40, Math.max(28, Math.floor(width * 0.36))) : width };
		return out.lines;
	}
	handleInput(data: string): void {
		const wide = this.width >= WIDE;
		const view = this.state.view;
		if (matchesKey(data, "ctrl+\\")) return this.done(); // 打开弹窗的那个键再按一次就是关掉（任何一页都一样）
		const back = matchesKey(data, "escape") || data === "q";
		if (view === "trace") {
			if (back || matchesKey(data, "left") || data === "h") this.leaveTrace();
			else if (matchesKey(data, "up") || data === "k") this.scroll(-1);
			else if (matchesKey(data, "down") || data === "j") this.scroll(1);
			else if (matchesKey(data, "pageUp")) this.scroll(-(this.meta.rows - 2));
			else if (matchesKey(data, "pageDown")) this.scroll(this.meta.rows - 2);
			else if (data === "g" || matchesKey(data, "home")) (this.state.follow = false), (this.state.scroll = 0);
			else if (data === "G" || matchesKey(data, "end")) this.state.follow = true;
		} else if (/^[1-9]$/.test(data) && (this.current()?.items?.length ?? 0) >= Number(data)) {
			this.state = { ...this.state, view: wide ? "list" : "detail", focus: "members", member: Number(data) - 1 }; // 数字键：选第几条事项
		} else if (/^[1-9]$/.test(data) && (this.current()?.members?.length ?? 0) >= Number(data)) {
			this.openTrace(Number(data) - 1); // 数字键：直接看第几位的完整过程
		} else if (back || matchesKey(data, "ctrl+c")) {
			if (!wide && view === "detail") this.state = { ...this.state, view: "list", focus: "jobs" };
			else if (wide && this.state.focus === "members") this.state.focus = "jobs";
			else this.done();
		} else if (matchesKey(data, "pageDown")) this.scrollDetail(Math.max(1, this.meta.rows - 3));
		else if (matchesKey(data, "pageUp")) this.scrollDetail(-Math.max(1, this.meta.rows - 3));
		else if (wide ? this.state.focus === "members" : view === "detail") {
			if (matchesKey(data, "up") || data === "k") this.moveMember(-1);
			else if (matchesKey(data, "down") || data === "j") this.moveMember(1);
			else if (matchesKey(data, "enter") || matchesKey(data, "right") || data === "l") this.enter();
			else if (matchesKey(data, "left") || data === "h") this.state = { ...this.state, view: "list", focus: "jobs" };
			else if (data === " " && this.current()?.items?.length) this.toggle();
			else if (data === "a" && this.current()?.items?.length) this.toggleGroup();
			else if (this.tool(data)) {
			} else if (this.current()?.items?.length) this.act(data); // 按钮上的字母
		} else {
			if (matchesKey(data, "up") || matchesKey(data, "ctrl+p") || data === "k") this.move(-1);
			else if (matchesKey(data, "down") || matchesKey(data, "ctrl+n") || data === "j") this.move(1);
			else if (matchesKey(data, "enter") || matchesKey(data, "right") || data === "l") wide ? this.enter() : (this.state.view = "detail");
			else if (data === "c") this.registry.clearEnded();
			else this.tool(data);
		}
		this.tui.requestRender();
	}
	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		if (event.type === "wheel") {
			const delta = Math.sign(event.wheelDelta ?? 0) * Math.max(1, Math.abs(event.wheelDelta ?? 1));
			if (this.state.view === "trace") this.scroll(delta);
			else if (this.width < WIDE || event.x > this.meta.leftW + 1) this.scrollDetail(delta);
			else this.move(delta > 0 ? 1 : -1);
			return { handled: true };
		}
		if (event.type !== "click" || event.button !== "left") return { handled: true, render: false };
		const hit = this.hits.find((h) => h.y === event.y && event.x >= h.x0 && event.x < h.x1);
		if (!hit) return { handled: true };
		const wide = this.width >= WIDE;
		if (hit.action === "close") this.done();
		else if (hit.action === "back") {
			if (this.state.view === "trace") this.leaveTrace();
			else this.state = { ...this.state, view: "list", focus: "jobs" };
		} else if ("pick" in hit.action) this.state = { selected: hit.action.pick, view: wide ? "list" : "detail", focus: "jobs", member: 0, detailScroll: 0 };
		else if ("act" in hit.action) this.act(hit.action.act.key, hit.action.act.item);
		else if ("tool" in hit.action) this.tool(hit.action.tool);
		else if ("toggle" in hit.action) {
			this.state = { ...this.state, member: hit.action.toggle, focus: "members" };
			this.toggle(hit.action.toggle);
		}
		else if ("member" in hit.action) {
			this.state = { ...this.state, member: hit.action.member, focus: "members" };
			if (!this.current()?.items?.length) this.openTrace(hit.action.member); // 事项只是选中，成员才进过程页
		}
		else this.openTrace(undefined);
		return { handled: true };
	}
	invalidate(): void {
		this.cache.clear();
	}
	dispose(): void {
		this.unsubscribe();
		clearInterval(this.spin);
	}
}
