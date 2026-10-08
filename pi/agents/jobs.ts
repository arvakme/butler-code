/** 任务登记簿：哨兵、调研、审查、worker 都在这里登记“我是谁、在做什么、用什么模型”，输入框上方的任务行和弹窗读它显示数量和明细。
 *  放在 globalThis 上：/reload 重新加载模块后，在跑的任务还在同一本登记簿里。
 *  任务结束后不会消失：留在登记簿里（标明是完成、失败还是被停止），弹窗里变灰沉底，最多留最近 20 个。 */
export type JobRole = "哨兵" | "调研" | "审查" | "worker";
export type JobState = "running" | "waiting" | "done" | "failed" | "stopped";
/** 过程记录里的一行：`→ 工具 参数`（调用）、`← 工具 结果`（返回）、`说 …`（模型的话）、`想 …`（思考）、`· …`（说明），前面带时间 */
export const TRACE_MAX = 400;
/** 过程记录里一段文字：保留换行（弹窗里要按 Markdown 渲染），去掉多余的空行，太长就截断 */
export function clipText(text: string, max: number): string {
	const clean = text.replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
	return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}
export function pushTrace(lines: string[] | undefined, line: string): void {
	if (!lines) return;
	lines.push(`${new Date().toTimeString().slice(0, 8)} ${line}`);
	if (lines.length > TRACE_MAX) lines.shift();
}
/** 任务里要用户处理的一条事项（比如会话哨兵里没做完的事）。actions 的 key 是弹窗里的快捷键；点按钮或按键就调用任务的 act。 */
/** group 是弹窗里的分组标题，hint 是哨兵对这条的建议（写在条目后面）。 */
export type JobItem = { id: string; text: string; tag: string; age?: string; tone?: "warning" | "accent" | "muted"; group?: string; hint?: string; actions: { key: string; label: string; close?: boolean }[] };
export type Member = { name: string; state: "running" | "done" | "failed"; note?: string; model?: string; /** 这一位自己的完整过程 */ trace?: string[] };
export type Job = {
	id: string;
	role: JobRole;
	/** 它是干什么的：一句话，越短越好 */
	title: string;
	/** 它此刻在做什么：一句话，随进度更新 */
	detail: string;
	/** 此刻在做什么，每次绘制时现取：进度只能拉取、不发变化事件的模块用（比如审查）；有值就盖过 detail */
	now?: () => string | undefined;
	state: JobState;
	startedAt: number;
	endedAt?: number;
	/** 只算进数量，不占任务行：内置的哨兵平时没事可说 */
	quiet?: boolean;
	/** 完整的任务描述（弹窗详情里显示；title 只是它的缩写） */
	task?: string;
	/** 要用户处理的事项：弹窗里一条一行，选中后下面出现按钮 */
	items?: JobItem[];
	/** 用户在弹窗里对某一条按了某个动作（actions 里的 key）；itemId 为空串表示对整个任务的操作（tools 里的 key） */
	act?: (itemId: string, key: string) => void;
	/** 用户勾选了好几条，对它们做同一个动作 */
	actMany?: (itemIds: string[], key: string) => void;
	/** 对整个任务的操作按钮（整理、照建议处理、暂停接力） */
	tools?: { key: string; label: string }[];
	/** 用的模型（可以是几个，用 + 连起来）。这里写请求的名字 */
	model?: string;
	/** 并发的几位成员（调研员、审查者）和各自的状态 */
	members?: Member[];
	/** 最近发生的事，最新的在最后，只留最近 40 条 */
	notes: string[];
	/** 这个任务自己的完整过程（worker 用；有并发成员的任务，过程在各成员身上） */
	trace?: string[];
	/** 结束后的一句话结果（报告地址、结论、最后一次状态） */
	result?: string;
	/** 过程记录的位置（有的话，用户可以去看它具体做了什么） */
	log?: string;
};
export type JobEnd = { state?: "done" | "failed" | "stopped"; result?: string };
export type JobHandle = {
	update(patch: Partial<Pick<Job, "detail" | "now" | "state" | "title" | "task" | "members" | "model" | "log" | "quiet" | "items" | "act" | "actMany" | "tools">>): void;
	note(line: string): void;
	/** 记一行完整过程（不触发刷新；弹窗自己定时刷新） */
	trace(line: string): void;
	/** 结束：留在登记簿里，标明结局 */
	finish(end?: JobEnd): void;
	/** 撤销：从登记簿里拿掉，不留记录（比如界面重载后会重新登记同一件事） */
	discard(): void;
};

export type Jobs = {
	/** 所有任务，包括已结束的（按开始时间） */
	list(): Job[];
	start(job: Omit<Job, "startedAt" | "state" | "detail" | "notes"> & Partial<Pick<Job, "detail" | "state">>): JobHandle;
	/** 清掉已结束的记录 */
	clearEnded(): void;
	onChange(listener: () => void): () => void;
};

export const isLive = (job: Pick<Job, "state">) => job.state === "running" || job.state === "waiting";
/** 任务行和弹窗显示的“此刻在做什么” */
export const detailOf = (job: Pick<Job, "state" | "detail" | "now">): string => (isLive(job) && job.now?.()) || job.detail;
/** 模型的显示名：`group/luna · max` */
export const modelLabel = (atom: { id: string; thinking: string }) => `${atom.id} · ${atom.thinking}`;

const KEY = Symbol.for("butler.jobs");
const KEEP_ENDED = 20;
type Global = typeof globalThis & { [KEY]?: Jobs };

export function jobs(): Jobs {
	const g = globalThis as Global;
	if (g[KEY]) return g[KEY] as Jobs;
	const table = new Map<string, Job>();
	const listeners = new Set<() => void>();
	const changed = () => listeners.forEach((fn) => fn());
	const trim = () => {
		const ended = [...table.values()].filter((j) => !isLive(j)).sort((a, b) => (a.endedAt ?? 0) - (b.endedAt ?? 0));
		ended.slice(0, Math.max(0, ended.length - KEEP_ENDED)).forEach((j) => table.delete(j.id));
	};
	g[KEY] = {
		list: () => [...table.values()].sort((a, b) => a.startedAt - b.startedAt),
		start(job) {
			const entry: Job = { detail: "", state: "running", notes: [], ...job, startedAt: Date.now() };
			table.set(entry.id, entry);
			changed();
			return {
				update(patch) {
					const current = table.get(entry.id);
					if (!current) return;
					Object.assign(current, patch);
					changed();
				},
				note(line) {
					const current = table.get(entry.id);
					if (!current) return;
					current.notes.push(`${new Date().toTimeString().slice(0, 8)} ${line}`);
					if (current.notes.length > 40) current.notes.shift();
					changed();
				},
				trace(line) {
					const current = table.get(entry.id);
					if (current) pushTrace((current.trace ??= []), line);
				},
				finish(end = {}) {
					const current = table.get(entry.id);
					if (!current || !isLive(current)) return;
					current.state = end.state ?? "done";
					current.endedAt = Date.now();
					current.detail = ""; // “此刻在做什么”到这里就没有意义了
					current.now = undefined;
					if (end.result) current.result = end.result;
					current.members?.forEach((m) => {
						if (m.state === "running") m.state = current.state === "done" ? "done" : "failed";
					});
					trim();
					changed();
				},
				discard() {
					if (table.delete(entry.id)) changed();
				},
			};
		},
		clearEnded() {
			[...table.values()].filter((j) => !isLive(j)).forEach((j) => table.delete(j.id));
			changed();
		},
		onChange(listener) {
			listeners.add(listener);
			return () => void listeners.delete(listener);
		},
	};
	return g[KEY] as Jobs;
}
