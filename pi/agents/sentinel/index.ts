/** 哨兵：盯着一件事直到它有结果，状态一变就通知，不占用主会话。能盯 PR、CI、地址，也能盯任何一条命令看得到的东西（文件、进程、日志、别的机器、任务池……），可以让模型按目标判断要不要通知。 */
import { execFile, spawn } from "node:child_process";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { SentinelConfig } from "../config.js";
import { Type } from "typebox";
import { jobs, modelLabel, type JobEnd } from "../jobs.js";
import { runMini } from "../mini.js";
import { type CmdSnapshot, type Event, OUT_LIMIT, type Snapshot, describe, diff, parsePr, parseRun, validUntil } from "./watch.js";

type Kind = "pr" | "ci" | "url" | "cmd";
/** cmd：target 是命令；goal 是用户想知道什么（有它就让模型判断每次变化）；until 是确定的结束条件；interval 覆盖默认间隔。 */
type Watcher = { id: string; kind: Kind; target: string; goal?: string; until?: string; interval?: number; cwd: string; started: number; last?: Snapshot; polledAt: number; errors: number };
type Extra = { goal?: string; until?: string; interval?: number };

const ENTRY = "butler-sentinel";
const MAX_WATCHERS = 10;
const USAGE = "kind 是 pr（编号或链接）、ci（分支）、url（地址）或 cmd（一条快速只读命令）；stop 的 target 是编号（如 s1）或 all。";

const sh = (file: string, args: string[], cwd: string, timeout = 60_000) =>
	new Promise<string>((done, fail) => execFile(file, args, { cwd, timeout, maxBuffer: 20_000_000 }, (error, stdout, stderr) => (error ? fail(new Error((stderr || error.message).trim().slice(0, 300))) : done(stdout))));

/** 跑一条看一眼的命令。退出码不是 0 也是一种状态，不是错误；超时算 124。 */
const run = (command: string, cwd: string) =>
	new Promise<CmdSnapshot>((done) =>
		execFile("/bin/sh", ["-c", command], { cwd, timeout: 60_000, maxBuffer: 5_000_000 }, (error: any, stdout, stderr) =>
			done({ kind: "cmd", exit: error ? (typeof error.code === "number" ? error.code : error.killed ? 124 : 1) : 0, out: `${stdout}${stderr ? `\n${stderr}` : ""}`.trim().slice(-OUT_LIMIT) }),
		),
	);

export async function poll(w: Pick<Watcher, "kind" | "target" | "cwd">): Promise<Snapshot | undefined> {
	if (w.kind === "cmd") return run(w.target, w.cwd);
	if (w.kind === "pr") {
		const fields = "title,url,state,isDraft,mergeable,reviewDecision,statusCheckRollup,comments,reviews,headRefName";
		return parsePr(JSON.parse(await sh("gh", ["pr", "view", w.target, "--json", fields], w.cwd)));
	}
	if (w.kind === "ci") {
		const out = await sh("gh", ["run", "list", "--branch", w.target, "--limit", "1", "--json", "databaseId,workflowName,status,conclusion,url"], w.cwd);
		return parseRun(JSON.parse(out));
	}
	const response = await fetch(w.target, { signal: AbortSignal.timeout(15_000), redirect: "manual" }).catch(() => undefined);
	return { kind: "url", status: response?.status ?? 0 };
}

/** 失败了就让便宜的模型读日志尾部，用三句大白话说清哪一步、为什么。读不到日志或模型失败时返回空，通知照发。 */
async function triage(ctx: ExtensionContext, config: SentinelConfig, w: Watcher, clue: NonNullable<Event["triage"]>): Promise<string> {
	try {
		let runId = clue.runId;
		if (!runId && clue.branch) {
			const runs = JSON.parse(await sh("gh", ["run", "list", "--branch", clue.branch, "--limit", "5", "--json", "databaseId,conclusion"], w.cwd));
			runId = runs.find((r: any) => r.conclusion === "failure")?.databaseId;
		}
		if (!runId) return "";
		const log = (await sh("gh", ["run", "view", String(runId), "--log-failed"], w.cwd, 90_000)).split("\n").slice(-120).join("\n");
		const result = await runMini(ctx, {
			atom: config.model,
			system: "你读 CI 失败日志，用不超过三句大白话说明：哪一步失败了、最可能的原因是什么、是代码问题还是环境/偶发问题。不确定就说不确定。不要复述日志，不要用没解释过的行话。",
			prompt: `日志尾部：\n${log.slice(-12_000)}`,
			maxTurns: 2,
		});
		return result.text.trim();
	} catch {
		return "";
	}
}

/** 有目标时，输出一变就让便宜的模型判断：值不值得告诉用户、目标是不是已经达成。读不懂或模型失败返回空，由调用方退回“输出变了”的原始通知。 */
async function judge(ctx: ExtensionContext, config: SentinelConfig, w: Watcher, prev: CmdSnapshot | undefined, next: CmdSnapshot): Promise<Event[] | undefined> {
	const view = (s: CmdSnapshot | undefined) => (s ? `${s.exit === 0 ? "" : `[退出码 ${s.exit}] `}${s.out.slice(-2500) || "（没有输出）"}` : "（还没有上一次）");
	try {
		const result = await runMini(ctx, {
			atom: config.model,
			system: `你替用户盯着一件事。用户想知道的是：${w.goal}\n每隔一会儿会有一条命令看一眼，给你上一次和这一次的输出。判断：这次有没有值得现在告诉用户的变化，目标达成了吗。只输出一行 JSON：{"notify":true或false,"done":true或false,"text":"给用户的话，不超过三句大白话，带上关键数字或名字"}。没有实质变化（比如只是时间戳、顺序不同）就 notify:false。目标已达成、之后不会再需要盯时 done:true（done 一定要 notify）。`,
			prompt: `上一次：\n${view(prev)}\n\n这一次：\n${view(next)}`,
			maxTurns: 2,
		});
		const verdict = JSON.parse(result.text.match(/\{[\s\S]*\}/)?.[0] ?? "");
		if (typeof verdict.notify !== "boolean") return undefined;
		return verdict.notify ? [{ text: String(verdict.text || "有变化。"), terminal: verdict.done === true }] : [];
	} catch {
		return undefined;
	}
}

function deliver(config: SentinelConfig, ctx: ExtensionContext, text: string, level: "info" | "warning" = "info") {
	ctx.ui.notify(`哨兵：${text}`, level);
	if (config.notify === "pi") return;
	const [file, ...args] = config.notify;
	const child = spawn(file, args, { stdio: ["pipe", "ignore", "pipe"] });
	let stderr = "";
	child.stderr.on("data", (d) => (stderr += d));
	child.on("error", (e) => ctx.ui.notify(`哨兵：通知命令没能启动：${e.message}`, "error"));
	child.on("exit", (code) => code !== 0 && ctx.ui.notify(`哨兵：通知命令失败（退出码 ${code}）：${stderr.trim().slice(0, 200)}`, "error"));
	child.stdin.end(text);
}

export function registerSentinel(pi: ExtensionAPI, config: SentinelConfig): void {
	let watchers: Watcher[] = [];
	let timer: ReturnType<typeof setInterval> | undefined;
	let latest: ExtensionContext | undefined;
	let counter = 0;
	let busy = false;
	// 每个盯着的事在任务登记簿里有一项，输入框上方的任务行据此显示数量和明细
	const handles = new Map<string, ReturnType<ReturnType<typeof jobs>["start"]>>();
	const every = (w: Pick<Watcher, "interval">) => w.interval ?? config.intervalSeconds;
	const track = (w: Watcher) => {
		if (!handles.has(w.id)) handles.set(w.id, jobs().start({ id: `sentinel-${w.id}`, role: "哨兵", title: describe(w.kind, w.target, w.goal), task: `${describe(w.kind, w.target, w.goal)}：每 ${every(w)} 秒查一次，状态变了才通知（${config.notify === "pi" ? "只在 Pi 里提示" : "交给通知命令"}）${w.kind === "cmd" ? `\n命令：${w.target}${w.until ? `\n结束条件：${w.until}` : ""}` : ""}`, model: w.goal ? `${modelLabel(config.model)}（输出一变就判断要不要通知）` : `${modelLabel(config.model)}（只在 CI 失败时读日志，平时不用模型）`, detail: "刚开始盯" }));
	};
	const save = () => pi.appendEntry(ENTRY, { watchers: watchers.map(({ polledAt: _p, ...w }) => w), counter });
	const minutes = (since: number) => Math.max(0, Math.round((Date.now() - since) / 60000));

	const finish = (w: Watcher, end: JobEnd = { state: "done" }) => {
		watchers = watchers.filter((x) => x.id !== w.id);
		handles.get(w.id)?.finish(end);
		handles.delete(w.id);
		save();
		if (watchers.length === 0 && timer) timer = void clearInterval(timer);
	};

	async function check(w: Watcher, ctx: ExtensionContext) {
		w.polledAt = Date.now();
		let next: Snapshot | undefined;
		try {
			next = await poll(w);
			w.errors = 0;
		} catch (error) {
			if (++w.errors === 5) deliver(config, ctx, `盯 ${describe(w.kind, w.target, w.goal)} 连续出错 5 次：${error instanceof Error ? error.message : String(error)}。还会继续试，用 sentinel 工具 stop ${w.id} 可以停。`, "warning");
			if (w.errors >= 30) finish(w, { state: "failed", result: `连续出错 30 次：${error instanceof Error ? error.message : String(error)}` });
			return;
		}
		if (!next) return;
		const before = w.last;
		let events = diff(before, next, { until: w.until });
		// 有目标的命令：由模型判断每一次变化；确定的结束条件（until）优先，已经满足就不用问模型
		if (w.kind === "cmd" && w.goal && next.kind === "cmd" && !events.some((e) => e.terminal) && (before?.kind !== "cmd" || before.exit !== next.exit || before.out !== next.out)) events = (await judge(ctx, config, w, before?.kind === "cmd" ? before : undefined, next)) ?? events;
		w.last = next;
		handles.get(w.id)?.update({ detail: `已盯 ${minutes(w.started)} 分钟，最近一次 ${new Date().toTimeString().slice(0, 5)}${events.length ? " 有变化" : " 没变化"}` });
		handles.get(w.id)?.note(events.length ? `有变化：${events.map((e) => e.text.split("\n")[0]).join("；")}` : "查了一次，没变化");
		for (const event of events) {
			const why = event.triage ? await triage(ctx, config, w, event.triage) : "";
			deliver(config, ctx, `${event.text}${why ? `\n原因（模型读日志的判断）：${why}` : ""}`, event.triage ? "warning" : "info");
			if (event.terminal) return finish(w, { state: "done", result: event.text.split("\n")[0] });
		}
		save();
	}

	const ensureTimer = () => {
		if (timer) return;
		timer = setInterval(async () => {
			if (busy || !latest) return;
			busy = true;
			try {
				const due = watchers.filter((w) => Date.now() - w.polledAt >= every(w) * 1000);
				for (const w of due) await check(w, latest);
			} finally {
				busy = false;
			}
		}, 5000);
		timer.unref?.();
	};

	pi.on("session_start", (_event, ctx) => {
		latest = ctx;
		const saved = ctx.sessionManager.getEntries().filter((e: any) => e.type === "custom" && e.customType === ENTRY).at(-1) as any;
		if (saved?.data?.watchers?.length) {
			watchers = saved.data.watchers.map((w: Watcher) => ({ ...w, polledAt: 0 }));
			counter = saved.data.counter ?? watchers.length;
			ensureTimer();
			watchers.forEach(track);
			ctx.ui.notify(`哨兵：恢复了 ${watchers.length} 个盯着的事（${watchers.map((w) => describe(w.kind, w.target, w.goal)).join("、")}）。`, "info");
		}
	});
	pi.on("session_shutdown", () => {
		handles.forEach((h) => h.discard());
		handles.clear();
		if (timer) timer = void clearInterval(timer);
	});

	const listText = () => (watchers.length ? watchers.map((w) => `${w.id}  ${describe(w.kind, w.target, w.goal)}  （已盯 ${minutes(w.started)} 分钟）`).join("\n") : "现在没有在盯的事。");
	const stopText = (target: string) => {
		const gone = target === "all" ? watchers : watchers.filter((w) => w.id === target);
		if (gone.length === 0) return { ok: false, text: `没有这个编号：${target || "（空）"}。${USAGE}` };
		gone.forEach((w) => finish(w, { state: "stopped", result: "被你停止了" }));
		return { ok: true, text: `停止了 ${gone.map((w) => w.id).join("、")}。` };
	};
	/** 开始盯一件事；对象不存在或没权限当场说。返回给人看的一句话。 */
	async function watch(ctx: ExtensionContext, verb: string, target: string, extra: Extra = {}): Promise<{ ok: boolean; text: string }> {
		latest = ctx;
		if (!["pr", "ci", "url", "cmd"].includes(verb)) return { ok: false, text: USAGE };
		let resolved = target.trim();
		if (verb === "ci" && !resolved) resolved = (await sh("git", ["branch", "--show-current"], ctx.cwd).catch(() => "")).trim();
		if (!resolved) return { ok: false, text: `缺少要盯的对象。${USAGE}` };
		if (verb === "url" && !/^https?:\/\//.test(resolved)) return { ok: false, text: "url 需要以 http:// 或 https:// 开头。" };
		const until = extra.until?.trim() || undefined;
		if (until && verb !== "cmd") return { ok: false, text: "until（结束条件）只用于盯命令（cmd）。" };
		if (until && !validUntil(until)) return { ok: false, text: `until 要写 exit0，或一个能用的正则表达式：${until}` };
		if (extra.interval !== undefined && !(extra.interval >= 15 && extra.interval <= 3600)) return { ok: false, text: "间隔要在 15 到 3600 秒之间。" };
		if (watchers.length >= MAX_WATCHERS) return { ok: false, text: `最多同时盯 ${MAX_WATCHERS} 件事，先停掉一个。` };
		const w: Watcher = { id: `s${++counter}`, kind: verb as Kind, target: resolved, goal: extra.goal?.trim() || undefined, until, interval: extra.interval, cwd: ctx.cwd, started: Date.now(), polledAt: 0, errors: 0 };
		// 先看一眼：对象不存在、没有权限、命令根本跑不起来就当场说，不要等第一次轮询才发现
		try {
			w.last = await poll(w);
			if (w.last?.kind === "cmd" && w.last.exit === 127) throw new Error(`命令找不到或没法执行：${w.last.out.slice(0, 200)}`);
		} catch (error) {
			counter--;
			return { ok: false, text: `盯不了 ${describe(w.kind, w.target, w.goal)}：${error instanceof Error ? error.message : String(error)}` };
		}
		w.polledAt = Date.now();
		let first = w.last ? diff(undefined, w.last, { until }) : [];
		// 有目标的命令：第一眼就让模型看看，目标可能已经达成了
		if (w.kind === "cmd" && w.goal && w.last?.kind === "cmd" && !first.some((e) => e.terminal)) first = (await judge(ctx, config, w, undefined, w.last)) ?? [];
		watchers.push(w);
		track(w);
		save();
		ensureTimer();
		// 一开始就已经是结果（比如 PR 早就合并了、CI 已经跑完、条件已经满足）：直接报告并结束
		for (const event of first.filter((e) => e.terminal || e.triage || w.goal)) {
			const why = event.triage ? await triage(ctx, config, w, event.triage) : "";
			deliver(config, ctx, `${event.text}${why ? `\n原因（模型读日志的判断）：${why}` : ""}`, event.triage ? "warning" : "info");
			if (event.terminal) finish(w, { state: "done", result: event.text.split("\n")[0] });
		}
		return { ok: true, text: `哨兵 ${w.id} 开始盯 ${describe(w.kind, w.target, w.goal)}，每 ${every(w)} 秒看一次，有变化再通知用户。` };
	}

	// 模型也能直接发起：用户说“帮我盯一下……”，就用它，而不是自己轮询或去开别的 agent
	pi.registerTool({
		name: "sentinel",
		label: "哨兵",
		description: `Watch ANYTHING in the background without using this conversation, and tell the user through their notification channel when it changes or the goal is met, so never poll yourself. It looks every ${config.intervalSeconds} seconds (override with intervalSeconds, 15-3600). actions: watch, list, stop (target is a watcher id such as s1, or all). For watch, kind is: pr (pull request: merged, closed, checks, reviews, comments; target is a number or link), ci (latest CI run on a branch; target is the branch, default the current one), url (an address that should come back up), or cmd — for EVERYTHING ELSE: files appearing or changing, a process or a port, a log line, a build or training job, a queue or pool of workers, another machine over ssh, a database count, a price, a script's result. For cmd, target is a shell command that takes one look at the thing and prints its state (run in the project directory every time, 60 s limit, so it must be quick and read-only). Prefer output that only changes when the thing really changes (filter with grep/awk, avoid timestamps). Put what the user actually wants to know in goal, in plain words: then a cheap model reads each change and tells the user only what matters, in plain language, and ends the watch once the goal is met. Without a goal every change in the output is reported. until (cmd only) ends the watch by a fixed rule: a regular expression found in the output, or exit0 when the command exits successfully.`,
		promptSnippet: "sentinel: watch anything in the background (PR, CI, URL, or any shell command's view of a file, process, log, job, pool, machine...) and notify the user when it changes or the goal is met (use it instead of polling or dispatching agents)",
		promptGuidelines: ["When the user asks you to watch, monitor, wait for or keep an eye on anything — not only a PR, CI run or address — call the sentinel tool (kind cmd with a quick read-only command and a goal for anything else); do not poll in the conversation, do not sleep, and do not start other agents."],
		parameters: Type.Object({
			action: Type.Union([Type.Literal("watch"), Type.Literal("list"), Type.Literal("stop")]),
			kind: Type.Optional(Type.Union([Type.Literal("pr"), Type.Literal("ci"), Type.Literal("url"), Type.Literal("cmd")], { description: "What kind of thing to watch (action watch); cmd for anything that is not a PR, CI run or address" })),
			target: Type.Optional(Type.String({ description: "PR number or link, branch name, http(s) address, or the shell command for cmd; for stop the watcher id or all" })),
			goal: Type.Optional(Type.String({ description: "What the user wants to know, in plain words (for example: tell me when all 3 workers have a result). With a goal, a cheap model judges each change in the output." })),
			until: Type.Optional(Type.String({ description: "cmd only: end the watch when this regular expression is found in the output, or write exit0 to end when the command exits successfully" })),
			intervalSeconds: Type.Optional(Type.Number({ description: "How often to look, 15 to 3600 seconds; default from configuration" })),
		}),
		execute: async (_id, params, _signal, _update, ctx) => {
			latest = ctx;
			const result = params.action === "list" ? { ok: true, text: listText() } : params.action === "stop" ? stopText((params.target ?? "").trim()) : await watch(ctx, params.kind ?? "", params.target ?? "", { goal: params.goal, until: params.until, interval: params.intervalSeconds });
			return { content: [{ type: "text" as const, text: result.text }], details: undefined };
		},
	});
}
