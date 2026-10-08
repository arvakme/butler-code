/**
 * 输入框外壳与任务行的纯布局：所有片段由调用方预先着色，本文件只按显示宽度逐级退让，不保存状态。
 * 边框横线与光晕由 `master/border.ts` 统一绘制，子代理视图输入区用的是同一份。
 */
import type { Theme, ThemeBg, ThemeColor } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { clip, ELLIPSIS } from "../format.js";
import { type BorderParts, fitBorder, type Line, separator } from "../master/border.js";
import { detailOf, type Job } from "../agents/jobs.js";

export type Palette = { fg(color: ThemeColor, text: string): string; bold(text: string): string; bg?(color: ThemeBg, text: string): string };
export const elapsed = (since: number, now: number) => { const m = Math.max(0, Math.round((now - since) / 60000)); return m < 1 ? "不到 1 分钟" : m < 60 ? `${m} 分钟` : `${Math.floor(m / 60)} 小时 ${m % 60} 分`; };

export interface TopParts {
	/** 火苗或落定标记；空表示没有回合。 */
	mark: string;
	word: string;
	elapsed: string;
	/** 审查进度由长到短的退让档（已着色）；空数组表示没有审查。 */
	review: readonly string[];
	/** 0–1：回合进行时边框左端的光晕强度。 */
	glow: number;
}

/** 退让顺序：审查进度逐档缩短 → “处理中” → 审查进度最短档。 */
export function topBorder(width: number, parts: TopParts, line: Line, theme: Theme): string {
	const sep = separator(theme);
	const left = (word: boolean, review: string) => {
		const head = [parts.mark, word ? parts.word : "", parts.elapsed].filter(Boolean).join(" ");
		return [head, review].filter(Boolean).join(sep);
	};
	const at = (word: boolean, review: string): BorderParts => [left(word, review), ""];
	return fitBorder(width, line, parts.glow, [
		...(parts.review.length ? parts.review : [""]).map((review) => at(true, review)),
		at(false, parts.review.at(-1) ?? ""),
		at(false, ""),
	], theme);
}

export interface BottomParts {
	/** 工作目录（未着色，家目录写成 ~）：按整段目录裁，所以由这里着色。 */
	path: string;
	/** 生效中的预设名（已着色）；没有预设为空。 */
	model: string;
	/** 含前导斜杠，如 `/high`；模型不支持思考档时为空。 */
	think: string;
	fast: string;
	percent: string;
	/** 含前导斜杠，如 `/1M`。 */
	capacity: string;
}

/** 路径从开头裁到这么窄就先去让模型名：再窄就认不出是哪个目录了。 */
const PATH_MIN = 12;
/** 模型名最多裁到这么窄，再窄就整个让掉（半个模型名认不出是谁）。 */
const MODEL_MIN = 6;
/** 最窄时路径留的列数：大致是末尾目录名。 */
const PATH_TINY = 6;

/** 路径放进 width 列：从开头整段省略（`…/butler-code/pi-firecode`），末尾目录名都放不下才从它开头裁。 */
export function pathTail(path: string, width: number): string {
	if (visibleWidth(path) <= width) return path;
	const segments = path.split("/");
	for (let from = 1; from < segments.length; from++) {
		const rest = `${ELLIPSIS}/${segments.slice(from).join("/")}`;
		if (visibleWidth(rest) <= width) return rest;
	}
	return clip(segments[segments.length - 1], width, "start");
}

/**
 * 退让顺序：容量 → 路径从开头裁到 PATH_MIN（留住末尾目录名）→ 模型名裁到 MODEL_MIN → 让掉模型 →
 * 路径继续裁到 PATH_TINY → 只留 Fast 与上下文百分比。手机竖屏（约 40 列）落在“末尾目录 + 百分比”一档。
 */
export function bottomBorder(width: number, parts: BottomParts, line: Line, theme: Theme): string {
	const sep = separator(theme);
	const right = (model: string, capacity: string) => {
		const name = [model && model + parts.think, parts.fast].filter(Boolean).join(" ");
		return [name, `${parts.percent}${capacity}`].filter(Boolean).join(sep);
	};
	const at = (path: string, model: string, capacity: string): BorderParts => [path, right(model, capacity)];
	const tail = (n: number) => theme.fg("muted", pathTail(parts.path, n));
	const pathWidth = visibleWidth(parts.path);
	const full = tail(pathWidth);
	function* candidates() {
		yield at(full, parts.model, parts.capacity);
		yield at(full, parts.model, "");
		for (let n = pathWidth; n >= Math.min(pathWidth, PATH_MIN); n--) yield at(tail(n), parts.model, "");
		const short = tail(PATH_MIN);
		for (let n = visibleWidth(parts.model) - 1; n >= MODEL_MIN; n--) yield at(short, clip(parts.model, n), "");
		for (let n = Math.min(pathWidth, PATH_MIN); n >= Math.min(pathWidth, PATH_TINY); n--) yield at(tail(n), "", "");
		yield at("", "", "");
	}
	return fitBorder(width, line, 0, candidates(), theme);
}

/** 输入框上方任务行用到的任务字段。 */
export type RowJob = Pick<Job, "id" | "role" | "title" | "detail" | "now" | "state" | "startedAt" | "members" | "quiet">;
const ROLES = ["哨兵", "调研", "审查", "worker"];
/** 任务行里标题最多占的列数：完整说明在弹窗里看。 */
export const TITLE_COLUMNS = 24;

/** 数量：`哨兵 2 · 调研 1（4 人）`。数的是任务；一个任务里有几位成员并发，括号里写出来。没有归类的算“其他”。 */
export function tallyText(active: readonly RowJob[]): string {
	const part = (label: string, jobs: readonly RowJob[]) => {
		const people = jobs.reduce((sum, j) => sum + (j.members?.length || 1), 0);
		return `${label} ${jobs.length}${people > jobs.length ? `（${people} 人）` : ""}`;
	};
	const known = ROLES.map((role) => [role, active.filter((j) => j.role === role)] as const).filter(([, jobs]) => jobs.length > 0).map(([role, jobs]) => part(role, jobs));
	const other = active.filter((j) => !ROLES.includes(j.role));
	return [...known, ...(other.length ? [part("其他", other)] : [])].join(" · ");
}

/** 每一行点下去做什么：第一行切换展开，其余打开对应任务的弹窗。 */
export type RowTarget = "toggle" | { open: string };

/**
 * 输入框上方的任务行。全是安静任务（内置会话哨兵没事可说）时整块隐藏；
 * 收起时一行（数量加最急的一件），展开后每个有事可说的任务一行，不限行数。mark 由调用方给（火苗与 ! 的颜色归主题）。
 */
export function jobRows(theme: Palette, active: readonly RowJob[], expanded: boolean, width: number, now: number, mark: (job: RowJob, index: number) => string): { lines: string[]; targets: RowTarget[] } {
	const shown = active.filter((j) => !j.quiet);
	if (shown.length === 0 || width <= 0) return { lines: [], targets: [] };
	const waiting = active.filter((j) => j.state === "waiting").length;
	const head = shown.find((j) => j.state === "waiting") ?? shown[0];
	const dot = theme.fg("dim", " · ");
	const summary = [theme.fg("accent", tallyText(active)), waiting ? theme.fg("warning", `等你 ${waiting}`) : ""].filter(Boolean).join(dot);
	// 收起时顺带说最急的一件（在等你的优先），只有一件事时不用展开就看得懂
	const headText = expanded ? "" : `${dot}${theme.fg(head.state === "waiting" ? "warning" : "muted", [clip(head.title, TITLE_COLUMNS), detailOf(head)].filter(Boolean).join(" · "))}`;
	const lines = [clip(`${theme.fg("dim", expanded ? "▾" : "▸")} ${mark(head, 0)} ${summary}${headText}`, width)];
	const targets: RowTarget[] = ["toggle"];
	if (!expanded) return { lines, targets };
	shown.forEach((job, index) => {
		const text = [job.role, clip(job.title, TITLE_COLUMNS), detailOf(job), elapsed(job.startedAt, now)].filter(Boolean).join(" · ");
		lines.push(clip(`  ${mark(job, index + 1)} ${theme.fg(job.state === "waiting" ? "warning" : "muted", text)}`, width));
		targets.push({ open: job.id });
	});
	return { lines, targets };
}
