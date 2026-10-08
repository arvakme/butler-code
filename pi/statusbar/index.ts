/**
 * 输入框外壳：状态画进编辑器的上下边框，没有独立底栏；后台任务是输入框上方可展开的一块。
 * 上边框：回合火苗与计时、主会话审查进度；下边框：工作目录 | 预设、模型、上下文。
 */
import { homedir } from "node:os";
import {
	CustomEditor,
	type ExtensionAPI,
	type ExtensionContext,
	getMarkdownTheme,
	type KeybindingsManager,
	type Theme,
} from "@earendil-works/pi-coding-agent";
import { type EditorTheme, Markdown, type TUI, type TuiMouseEvent } from "@earendil-works/pi-tui";
import { isLive, jobs, type Job } from "../agents/jobs.js";
import { type BusyView, IDLE, OUTCOME_TEXT, roundTexts, watchBusy } from "../busy.js";
import { flame, onFrame, paint, palette, phaseOf, reviewMark, settleMark, settling } from "../flame.js";
import { formatDuration, formatModelName, formatTokens } from "../format.js";
import { OCCUPANCY_CHANNEL, type OccupancyPayload, type ReviewProgress, type ReviewStage } from "../review/occupancy.js";
import { installCleanCopy } from "../session/clean-copy.js";
import { cacheColor, contextColor, thinkingColor } from "../theme.js";
import { type BranchEntry, latestTurnRecord, ROUND_RECORDED_CHANNEL, type TurnRecord } from "../tools/round.js";
import { JobsPopup, ordered } from "./jobs-popup.js";
import { latestCacheHitPercent, sessionSpeeds, type Speeds } from "./metrics.js";
import { type BottomParts, jobRows, type RowTarget, type TopParts, bottomBorder, topBorder } from "./render.js";

/** 工作目录的显示写法：家目录写成 ~，和 shell 提示符一致。 */
export function displayPath(cwd: string, home = homedir()): string {
	return cwd === home || cwd.startsWith(`${home}/`) ? `~${cwd.slice(home.length)}` : cwd;
}

const FAST_STATUS = "pi-openai-native-fast";
/** 落定后光晕渐隐的时长；落定结果本身一直留到下一轮开始。 */
const GLOW_FADE_MS = 1_000;
const JOBS_WIDGET_KEY = "butler-jobs";
/** 会话 ID 只显示开头这几位：Pi 的 --session 按开头匹配，够用来找回会话。 */
const SESSION_ID_LENGTH = 8;

/** 外壳要展示的全部运行状态；事件写入，编辑器每次绘制只读。 */
class Shell {
	/** busy.ts 的会话进行中快照：起点、指挥官是否在跑、在飞子代理数。 */
	busy: BusyView = IDLE;
	/**
	 * 最近一轮的落定事实与落定时刻，留到下一轮开始。只在轮记录写入、开会话、切分支时算一次，绘制只读它：
	 * 读分支是整条回溯。at 为空是开会话时恢复的，不播落定过渡。
	 */
	settled: { record: TurnRecord; at?: number } | undefined;
	/** 审查占用期间的进度访问器（review 经占用频道发布）；undefined 表示没有审查。 */
	review: (() => ReviewProgress | undefined) | undefined;
	statuses: () => ReadonlyMap<string, string> = () => new Map();
	theme: Theme | undefined;
	requestRender = () => {};
	private stopClock: (() => void) | undefined;

	/** 时钟只在有动效要播时订阅：回合进行、落定过渡或审查进行。 */
	syncClock(): void {
		const need = this.review !== undefined || this.busy.busy || (this.settled?.at !== undefined && settling(Date.now() - this.settled.at));
		if (need && !this.stopClock) this.stopClock = onFrame(() => { this.syncClock(); this.requestRender(); });
		if (!need && this.stopClock) { this.stopClock(); this.stopClock = undefined; }
	}

	dispose(): void {
		this.stopClock?.();
		this.stopClock = undefined;
		this.requestRender = () => {};
	}

	sync(view: BusyView): void {
		this.busy = view;
		if (view.busy) this.settled = undefined;
	}

	showRecord(branch: readonly BranchEntry[], at?: number): void {
		if (this.busy.busy) return;
		const record = latestTurnRecord(branch);
		this.settled = record && { record, at };
	}

	top(theme: Theme): TopParts {
		const { busy, settled, review } = this;
		const parts: TopParts = { mark: "", word: "", elapsed: "", review: [], glow: 0 };
		if (busy.since !== undefined) {
			parts.mark = flame(3, phaseOf(0), theme);
			const word = activityWord(busy);
			parts.word = word && theme.fg("text", word);
			parts.elapsed = theme.fg("muted", formatDuration(Date.now() - busy.since));
			parts.glow = 1;
		} else if (settled) {
			const { record } = settled;
			const since = settled.at === undefined ? Infinity : Date.now() - settled.at;
			const text = OUTCOME_TEXT[record.round.outcome];
			parts.mark = settleMark(text ? "failed" : "done", since, theme);
			// 与摘要行同一写法：终态字样、耗时、均速之间都是“ · ”；终态字样不随窄屏退让。
			parts.elapsed = [
				...(text ? [theme.fg("error", text)] : []),
				...roundTexts(record.round).map((part) => theme.fg("muted", part)),
				...record.earlier.map((part) => theme.fg("warning", part)),
			].join(theme.fg("dim", " · "));
			parts.glow = Math.max(0, 1 - since / GLOW_FADE_MS);
		}
		if (review) parts.review = reviewTiers(review(), theme);
		return parts;
	}

	bottom(ctx: ExtensionContext, thinking: string, theme: Theme): BottomParts {
		const model = ctx.model;
		const usage = ctx.getContextUsage();
		const window = usage?.contextWindow ?? model?.contextWindow ?? 0;
		const percent = usage?.percent;
		return {
			path: displayPath(ctx.cwd),
			model: theme.fg("text", formatModelName(model?.id)),
			think: model?.reasoning ? theme.fg(thinkingColor(thinking as never), `/${thinking}`) : "",
			fast: this.statuses().has(FAST_STATUS) ? theme.fg("warning", "Fast") : "",
			percent: theme.fg(contextColor(percent), percent == null ? "?" : `${percent.toFixed(1)}%`),
			capacity: theme.fg("dim", `/${formatTokens(window)}`),
		};
	}
}

/** 进行中的那个词：主会话审查期间一律由审查进度说明；否则指挥官在跑是“处理中”，再否则是在等子代理。 */
function activityWord(busy: BusyView): string {
	if (busy.review) return "";
	return busy.agentRunning ? "处理中" : `等待 ${busy.inFlight} 个子代理`;
}

const STAGE_TEXT: Record<Exclude<ReviewStage, "reviewing">, string> = {
	queued: "排队中", advisor: "顾问介入", fixing: "修复中", summarizing: "总结中",
};

/** 审查进度的退让档：`审查 第2轮 1/3 · 1 阻断` → 丢阻断数 → 丢票数或阶段，“审查 第N轮”留到最后；字形始终在。 */
function reviewTiers(progress: ReviewProgress | undefined, theme: Theme): string[] {
	const highlight = palette(theme).highlight;
	const gold = (text: string) => paint(highlight, text);
	const head = `${reviewMark(theme, phaseOf(2))} ${gold("审查")}`;
	if (!progress) return [head];
	const named = progress.round > 0 ? `${head}${gold(` 第${progress.round}轮`)}` : head;
	const body = gold(progress.stage === "reviewing" ? `${progress.passed}/${progress.total}` : STAGE_TEXT[progress.stage]);
	const blocked = progress.stage === "reviewing" && progress.blocked ? `${gold(" · ")}${theme.fg("error", `${progress.blocked} 阻断`)}` : "";
	const tiers = [`${named} ${body}${blocked}`, `${named} ${body}`, named];
	return tiers.filter((tier, index) => tier !== tiers[index - 1]);
}

class ShellEditor extends CustomEditor {
	constructor(
		tui: TUI,
		theme: EditorTheme,
		keybindings: KeybindingsManager,
		private readonly shell: Shell,
		private readonly bottomParts: (theme: Theme) => BottomParts,
	) {
		super(tui, theme, keybindings);
		shell.requestRender = () => tui.requestRender();
	}

	// 输入过长滚动时让位给宿主的“↑ n more”提示；主题未到位（底栏工厂还没跑）时也用宿主边框。
	protected override renderTopBorder(width: number, hiddenLineCount: number): string {
		const theme = this.shell.theme;
		return hiddenLineCount > 0 || !theme
			? super.renderTopBorder(width, hiddenLineCount)
			: topBorder(width, this.shell.top(theme), this.borderColor, theme);
	}

	protected override renderBottomBorder(width: number, hiddenLineCount: number): string {
		const theme = this.shell.theme;
		return hiddenLineCount > 0 || !theme
			? super.renderBottomBorder(width, hiddenLineCount)
			: bottomBorder(width, this.bottomParts(theme), this.borderColor, theme);
	}
}

/**
 * 输入框上方的后台任务：哨兵、调研、审查、待办。worker 不在这里——指挥官的活动列表已经逐个列出子代理，
 * 弹窗里仍然看得到。收起时一行，点第一行展开；展开后点某一行打开它的弹窗。
 */
class JobsRows {
	expanded = false;
	private targets: RowTarget[] = [];
	private stopClock: (() => void) | undefined;
	private readonly unsubscribe: () => void;
	constructor(private readonly tui: TUI, private readonly theme: Theme, private readonly open: (id?: string) => void) {
		this.unsubscribe = jobs().onChange(() => { this.syncClock(); tui.requestRender(); });
		this.syncClock();
	}
	private active = (): Job[] => ordered(jobs().list()).filter((job) => isLive(job) && job.role !== "worker");
	/** 有在跑且看得见的任务才订阅动画时钟。 */
	private syncClock(): void {
		const need = this.active().some((job) => !job.quiet);
		if (need && !this.stopClock) this.stopClock = onFrame(() => this.tui.requestRender());
		if (!need && this.stopClock) { this.stopClock(); this.stopClock = undefined; }
	}
	invalidate(): void {}
	render(width: number): string[] {
		const mark = (job: Pick<Job, "state">, index: number) => job.state === "waiting" ? this.theme.fg("warning", "!") : flame(1, phaseOf(index), this.theme);
		const { lines, targets } = jobRows(this.theme, this.active(), this.expanded, width, Date.now(), mark);
		this.targets = targets;
		return lines;
	}
	handleMouse(event: TuiMouseEvent) {
		if (event.type !== "click" || event.button !== "left") return undefined;
		const target = this.targets[event.y];
		if (!target) return undefined;
		if (target === "toggle") {
			this.expanded = !this.expanded;
			this.tui.requestRender();
		} else this.open(target.open);
		return { handled: true };
	}
	dispose(): void {
		this.unsubscribe();
		this.stopClock?.();
	}
}

function speed(value: number | undefined): string {
	if (value === undefined || !Number.isFinite(value)) return "—";
	return value >= 1000 ? `${(value / 1000).toFixed(1)}k t/s` : `${value.toFixed(1)} t/s`;
}

/** 弹窗底边框上的会话统计，由长到短的退让档：先丢速度，再丢分支与缓存，会话 ID 留到最后。 */
function sessionStats(theme: Theme, sessionId: string, branch: string | null | undefined, metrics: { cache?: number; speeds?: Speeds }): string[] {
	const { cache, speeds } = metrics;
	const cacheText = theme.fg(cache === undefined ? "dim" : cacheColor(cache), `Cache Hit ${cache === undefined ? "n/a" : `${Math.round(cache)}%`}`);
	const speedText = theme.fg("muted", `In ${speed(speeds?.input)} · Out ${speed(speeds?.output)} · Total ${speed(speeds?.total)}`);
	const branchText = branch ? theme.fg("muted", `Git ${branch}`) : "";
	const session = theme.fg("dim", `Session ${sessionId.slice(0, SESSION_ID_LENGTH)}`);
	const join = (...parts: string[]) => parts.filter(Boolean).join(theme.fg("dim", " · "));
	return [join(cacheText, speedText, branchText, session), join(cacheText, branchText, session), join(branchText, session), session];
}

export function registerStatusBar(pi: ExtensionAPI): void {
	const shell = new Shell();
	let gitBranch: () => string | null | undefined = () => undefined;
	// 弹窗开着时每秒重绘好几次：统计按分支末端缓存，只在末端变了时重新扫一遍分支
	let metrics: { leaf: string | null; cache?: number; speeds?: Speeds } | undefined;
	const metricsOf = (ctx: ExtensionContext) => {
		const leaf = ctx.sessionManager.getLeafId();
		if (metrics?.leaf !== leaf) {
			const entries = ctx.sessionManager.getBranch();
			metrics = { leaf, cache: latestCacheHitPercent(entries), speeds: sessionSpeeds(entries) };
		}
		return metrics;
	};
	// 后台任务弹窗：点任务行或按快捷键打开；一次只开一个
	let popupOpen = false;
	let closePopup: (() => void) | undefined;
	const openJobs = (ctx: ExtensionContext, startId?: string) => {
		if (ctx.mode !== "tui") return;
		if (popupOpen) return closePopup?.(); // 开着的时候再按同一个键（Ctrl+\）就是关掉
		popupOpen = true;
		void ctx.ui.custom<void>((tui, theme, _keys, done) => new JobsPopup(tui, theme, jobs(), (closePopup = () => done()), startId,
			(text, width) => new Markdown(text, 0, 0, getMarkdownTheme()).render(width), () => sessionStats(theme, ctx.sessionManager.getSessionId(), gitBranch(), metricsOf(ctx))),
		{ overlay: true, overlayOptions: { width: "90%", minWidth: 50, maxHeight: "85%", anchor: "center" } })
			.finally(() => { popupOpen = false; closePopup = undefined; });
	};
	// 快捷键 Ctrl+\ 与 Alt+J：任何时候都能按，Agent 在跑时也不受影响
	// macOS 终端里 Option 默认不当 Alt 用（Option+J 发出来的是字符 ∆），所以另给一个不依赖它的 Ctrl+\
	for (const key of ["ctrl+\\", "alt+j"] as const) pi.registerShortcut(key, { description: "后台任务弹窗", handler: (ctx) => openJobs(ctx) });

	watchBusy(pi, {
		onChange: (view) => {
			shell.sync(view);
			shell.syncClock();
			shell.requestRender();
		},
	});
	let branch: () => readonly BranchEntry[] = () => [];
	/**
	 * 落定态只在三个时点算一次并存下，绘制只读：轮记录写入后的发布、session_start（重开会话直接显示上一轮，
	 * 不播落定过渡）、session_tree。不取歇下边沿：那一刻记录未必已写进分支，订阅顺序不定。
	 */
	const showRecord = (at?: number) => {
		shell.showRecord(branch(), at);
		shell.syncClock();
		shell.requestRender();
	};
	pi.events.on(ROUND_RECORDED_CHANNEL, () => showRecord(Date.now()));
	pi.on("session_tree", () => showRecord());
	pi.events.on(OCCUPANCY_CHANNEL, (data) => {
		const occupancy = data as OccupancyPayload;
		shell.review = occupancy.active ? occupancy.progress : undefined;
		shell.syncClock();
		shell.requestRender();
	});
	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		branch = () => ctx.sessionManager.getBranch();
		showRecord();
		// 宿主内嵌的 Working 指示由外壳的火苗取代，可见性只在这里管理。
		ctx.ui.setWorkingVisible(false);
		// 独立底栏 0 行；借它拿到主题、状态订阅与 Git 分支，并装上复制清理（去竖条、接回自动折行）。
		ctx.ui.setFooter((tui, theme, footerData) => {
			shell.theme = theme;
			shell.statuses = () => footerData.getExtensionStatuses();
			gitBranch = () => footerData.getGitBranch();
			const restoreCopy = installCleanCopy(tui);
			return { dispose: restoreCopy, invalidate() {}, render: () => [] };
		});
		ctx.ui.setEditorComponent((tui, theme, keybindings) =>
			new ShellEditor(tui, theme, keybindings, shell, (current) => shell.bottom(ctx, pi.getThinkingLevel(), current)));
		ctx.ui.setWidget(JOBS_WIDGET_KEY, (tui, theme) => new JobsRows(tui, theme, (id) => openJobs(ctx, id)), { placement: "aboveEditor" });
	});
	pi.on("thinking_level_select", () => shell.requestRender());
	pi.on("model_select", () => shell.requestRender());
	pi.on("session_shutdown", (_event, ctx) => {
		shell.dispose();
		shell.busy = IDLE;
		shell.settled = undefined;
		shell.review = undefined;
		if (ctx.mode !== "tui") return;
		ctx.ui.setFooter(undefined);
		ctx.ui.setEditorComponent(undefined);
		ctx.ui.setWidget(JOBS_WIDGET_KEY, undefined);
	});
}
