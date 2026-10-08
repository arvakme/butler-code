/** 哨兵的纯逻辑：把 gh 的输出变成快照，再把前后两个快照的差变成要通知的事件。没有 IO，所以能整段读懂。 */

export type Check = { name: string; status: string; conclusion: string };
export type PrSnapshot = {
	kind: "pr";
	title: string;
	url: string;
	branch: string;
	state: "OPEN" | "MERGED" | "CLOSED";
	draft: boolean;
	mergeable: string;
	decision: string;
	checks: Check[];
	comments: number;
	lastCommenter: string;
};
export type RunSnapshot = { kind: "ci"; name: string; url: string; status: string; conclusion: string; id: number };
export type UrlSnapshot = { kind: "url"; status: number };
/** 任何一条命令的结果：退出码加输出末尾。哨兵能盯的“任何东西”都是靠一条看它一眼的命令。 */
export type CmdSnapshot = { kind: "cmd"; exit: number; out: string };
export type Snapshot = PrSnapshot | RunSnapshot | UrlSnapshot | CmdSnapshot;

/** until：命令输出里出现这个正则，或写成 exit0（命令成功退出）时，盯梢就结束。 */
export type Rule = { until?: string };

/** triage：要去读失败日志的线索——PR 的分支，或具体的一次运行。 */
export type Event = { text: string; terminal?: boolean; triage?: { branch?: string; runId?: number } };

const BAD = new Set(["FAILURE", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE", "STALE", "ERROR"]);
const failing = (s: PrSnapshot) => s.checks.filter((c) => BAD.has(c.conclusion)).map((c) => c.name);
const pending = (s: PrSnapshot) => s.checks.filter((c) => c.status !== "COMPLETED" && c.conclusion === "").length;
const green = (s: PrSnapshot) => s.checks.length > 0 && pending(s) === 0 && failing(s).length === 0;

export function parsePr(raw: any): PrSnapshot {
	const checks: Check[] = (raw.statusCheckRollup ?? []).map((c: any) => ({ name: c.name ?? c.context ?? "未命名检查", status: c.status ?? (c.state ? "COMPLETED" : ""), conclusion: c.conclusion ?? c.state ?? "" }));
	const comments = [...(raw.comments ?? []), ...(raw.reviews ?? [])];
	return {
		kind: "pr",
		title: raw.title ?? "",
		url: raw.url ?? "",
		branch: raw.headRefName ?? "",
		state: raw.state,
		draft: Boolean(raw.isDraft),
		mergeable: raw.mergeable ?? "UNKNOWN",
		decision: raw.reviewDecision ?? "",
		checks,
		comments: comments.length,
		lastCommenter: comments.at(-1)?.author?.login ?? "",
	};
}

export function parseRun(raw: any): RunSnapshot | undefined {
	const run = Array.isArray(raw) ? raw[0] : raw;
	return run ? { kind: "ci", name: run.workflowName ?? run.name ?? "CI", url: run.url ?? "", status: run.status ?? "", conclusion: run.conclusion ?? "", id: run.databaseId ?? 0 } : undefined;
}

export const OUT_LIMIT = 4000;
const show = (s: CmdSnapshot) => `${s.exit === 0 ? "" : `（退出码 ${s.exit}）`}${s.out ? s.out.slice(-600) : "（没有输出）"}`;

/** until 是不是写得对：exit0 或能编译的正则。 */
export function validUntil(until: string): boolean {
	if (until === "exit0") return true;
	try {
		new RegExp(until);
		return true;
	} catch {
		return false;
	}
}
export const reached = (s: CmdSnapshot, until: string) => (until === "exit0" ? s.exit === 0 : new RegExp(until).test(s.out));

/** 前后两个快照的差。第一次看到（prev 为空）只报“开始盯了”之外的终态与问题，不对既有的绿灯报喜。 */
export function diff(prev: Snapshot | undefined, next: Snapshot, rule?: Rule): Event[] {
	const events: Event[] = [];
	if (next.kind === "pr") {
		const before = prev?.kind === "pr" ? prev : undefined;
		const head = `PR「${next.title}」`;
		if (next.state === "MERGED") return [{ text: `${head}已合并。\n${next.url}`, terminal: true }];
		if (next.state === "CLOSED") return [{ text: `${head}被关闭了，没有合并。\n${next.url}`, terminal: true }];
		const bad = failing(next);
		const newBad = bad.filter((n) => !(before ? failing(before) : []).includes(n));
		if (newBad.length > 0) events.push({ text: `${head}的 CI 失败了：${newBad.join("、")}。\n${next.url}`, triage: { branch: next.branch } });
		if (before && green(next) && !green(before)) events.push({ text: `${head}的 CI 全部通过。${next.decision === "APPROVED" ? "也已经通过评审，可以合并。" : "等评审或合并。"}\n${next.url}` });
		if (next.mergeable === "CONFLICTING" && before?.mergeable !== "CONFLICTING") events.push({ text: `${head}和目标分支有合并冲突，需要处理。\n${next.url}` });
		if (before && next.decision !== before.decision && next.decision === "CHANGES_REQUESTED") events.push({ text: `${head}被要求修改。\n${next.url}` });
		if (before && next.decision !== before.decision && next.decision === "APPROVED") events.push({ text: `${head}通过了评审。\n${next.url}` });
		if (before && next.comments > before.comments) events.push({ text: `${head}有 ${next.comments - before.comments} 条新评论${next.lastCommenter ? `（最近的来自 ${next.lastCommenter}）` : ""}。\n${next.url}` });
	} else if (next.kind === "ci") {
		if (next.status === "completed") {
			const ok = next.conclusion === "success";
			events.push({ text: `${next.name} 跑完了：${ok ? "成功" : `失败（${next.conclusion}）`}。\n${next.url}`, terminal: true, triage: ok ? undefined : { runId: next.id } });
		}
	} else if (next.kind === "cmd") {
		if (rule?.until && reached(next, rule.until)) return [{ text: `满足条件了（${rule.until === "exit0" ? "命令成功退出" : `输出里出现 ${rule.until}`}）：\n${show(next)}`, terminal: true }];
		if (prev?.kind === "cmd" && (prev.exit !== next.exit || prev.out !== next.out)) events.push({ text: `输出变了：\n前：${show(prev)}\n后：${show(next)}` });
	} else if (next.status >= 200 && next.status < 400) {
		events.push({ text: `地址恢复了（HTTP ${next.status}）。`, terminal: true });
	}
	return events;
}

export const describe = (kind: string, target: string, goal?: string) =>
	goal ? goal : kind === "pr" ? `PR ${target}` : kind === "ci" ? `分支 ${target} 的 CI` : kind === "cmd" ? `命令 ${target.length > 40 ? `${target.slice(0, 40)}…` : target}` : `地址 ${target}`;
