/** FireCode 的审查和子代理在任务行、后台任务弹窗里露面：登记进任务登记簿。登记簿只是镜像，真源仍在 review/ 和 master/。 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import type { SettledFact } from "../master/activity-list.js";
import type { WorkerRef } from "../master/state.js";
import { readCheckpoint } from "../review/checkpoint.js";
import type { ReviewProgress as WorkerReview } from "../review/outcome.js";
import { OCCUPANCY_CHANNEL, type OccupancyPayload, type ReviewProgress, type ReviewStage } from "../review/occupancy.js";
import { type JobEnd, type JobHandle, jobs } from "./jobs.js";
import { RESULT_MESSAGE } from "../tools/group-view.js";
import { publishReview, reportable } from "./review-report.js";

const STAGE_TEXT: Record<ReviewStage, string> = {
	queued: "排队，这一轮结束就开始",
	reviewing: "审查者在审",
	advisor: "顾问在看分歧",
	fixing: "在按意见修",
	summarizing: "在总结",
};

export function reviewText(progress: ReviewProgress | undefined): string | undefined {
	if (!progress) return undefined;
	const round = progress.round ? `第 ${progress.round} 轮：` : "";
	if (progress.stage !== "reviewing") return `${round}${STAGE_TEXT[progress.stage]}`;
	return `${round}${progress.passed + progress.blocked}/${progress.total} 位审完${progress.blocked ? `，${progress.blocked} 位要改` : ""}`;
}

/**
 * 主会话的审查：占用信号成对出现（持有 → 释放），持有期间是一个“审查”任务，进度在绘制时现取。
 * 释放时审查已把终态写进 checkpoint：落定的审查生成验收报告，地址写进任务结局并作为一条消息留在会话里。
 */
export function mirrorReview(pi: ExtensionAPI): void {
	let job: JobHandle | undefined;
	let session: ExtensionContext | undefined;
	pi.registerMessageRenderer<ReportDetails>(RESULT_MESSAGE, (message, _options, theme) => {
		const { where, verdict, problem } = message.details ?? {};
		const head = where ? `${theme.fg(problem ? "warning" : "success", "▤")} ${theme.fg("text", "验收报告")}${verdict ? theme.fg("muted", ` · ${verdict}`) : ""}` : theme.fg("error", "✗ 验收报告没有生成");
		const lines = [head, ...(where ? [`  ${theme.fg("accent", where)}`] : []), ...(problem ? [`  ${theme.fg("warning", problem)}`] : [])];
		return new Text(lines.join("\n"), 1, 0);
	});
	pi.on("session_start", (_event, ctx) => { session = ctx; });
	pi.on("session_shutdown", () => { session = undefined; });
	pi.events.on(OCCUPANCY_CHANNEL, (data) => {
		const payload = data as OccupancyPayload;
		if (!payload.active) {
			const ended = job;
			job = undefined;
			const state = session && readCheckpoint(session);
			if (!session || !reportable(state)) {
				ended?.finish({ result: "审查结束，结论在会话里的审查卡片" });
				return;
			}
			ended?.update({ now: () => "在生成验收报告" });
			void reportReview(pi, state, session.cwd, ended);
			return;
		}
		job ??= jobs().start({
			id: `review-${Date.now()}`,
			role: "审查",
			title: "对抗审查",
			task: "几位审查者各自审这一轮的改动，有分歧时顾问介入，要改的交给执行模型修，最后总结成审查卡片。",
			now: () => reviewText(payload.progress()),
		});
	});
}

type ReportDetails = { where?: string; verdict?: string; problem?: string };

async function reportReview(pi: ExtensionAPI, state: Parameters<typeof publishReview>[0], cwd: string, job: JobHandle | undefined): Promise<void> {
	const published = await publishReview(state, cwd).catch((error: unknown) => ({ problem: `验收报告没能生成：${error instanceof Error ? error.message : String(error)}` }) as const);
	if (!published) {
		job?.finish({ result: "审查结束，这场审查的验收报告已经生成过" });
		return;
	}
	const details: ReportDetails = {
		where: "url" in published && published.url ? published.url : "report" in published ? published.report : undefined,
		verdict: "verdict" in published ? published.verdict.replace(/ · 待用户验收$/u, "") : undefined,
		problem: published.problem,
	};
	const content = [details.where ? `对抗审查的验收报告（${details.verdict}）：${details.where}` : "对抗审查的验收报告没有生成。", details.problem].filter(Boolean).join("\n");
	job?.finish({ state: details.where && !details.problem ? "done" : "failed", result: details.where ?? details.problem });
	// triggerTurn: false：流式中延到回合结束再追加，不会变成 steer 打断执行模型。
	pi.sendMessage({ customType: RESULT_MESSAGE, content, display: true, details }, { triggerTurn: false });
}

/** 子代理此刻的样子，绘制时由 master 现取 */
export type WorkerNow = { reviewing: boolean; tools: readonly string[]; review: WorkerReview | undefined };

function workerText(now: WorkerNow): string {
	if (now.reviewing) return now.review ? `审查第 ${now.review.round} 轮 · ${now.review.settled}/${now.review.total} 位审完` : "审查中";
	return now.tools.length ? `在用 ${now.tools.join("、")}` : "在想";
}

const SETTLED: Record<SettledFact["kind"], NonNullable<JobEnd["state"]>> = { done: "done", failed: "failed", interrupted: "stopped" };

/** 子代理的每次运行（start / send / review）是一个 worker 任务：从不闲变成闲（落定）为止，被移除的按停止收尾 */
export class WorkerJobs {
	private readonly runs = new Map<string, JobHandle>();

	constructor(private readonly nowOf: (worker: WorkerRef) => WorkerNow) {}

	/** master 每次重绘时调用：工作状态的变化都经那里 */
	sync(workers: readonly WorkerRef[], settled: (worker: WorkerRef) => SettledFact | undefined): void {
		const present = new Set<string>();
		for (const worker of workers) {
			present.add(worker.sessionPath);
			const running = this.runs.has(worker.sessionPath);
			if (worker.status === "idle" && running) this.end(worker.sessionPath, settled(worker));
			if (worker.status !== "idle" && !running) this.begin(worker);
		}
		for (const path of [...this.runs.keys()]) if (!present.has(path)) this.end(path, { kind: "interrupted", note: "已移除", at: Date.now() });
	}

	/** 会话关闭：在跑的运行跟着结束 */
	close(): void {
		for (const path of [...this.runs.keys()]) this.end(path, { kind: "interrupted", note: "会话已关闭", at: Date.now() });
	}

	private begin(worker: WorkerRef): void {
		const handle = jobs().start({
			id: `worker-${worker.name}-${Date.now()}`,
			role: "worker",
			title: `${worker.name}（${worker.role}）`,
			task: `子代理 ${worker.name}，角色 ${worker.role}${worker.cwd ? `，在 ${worker.cwd} 里干活` : ""}。完整过程在输入框上方的子代理列表里点开看。`,
			model: `${worker.model} · ${worker.thinking}`,
			log: worker.sessionPath,
			now: () => workerText(this.nowOf(worker)),
		});
		this.runs.set(worker.sessionPath, handle);
	}

	private end(path: string, settled: SettledFact | undefined): void {
		this.runs.get(path)?.finish(settled ? { state: SETTLED[settled.kind], result: settled.note } : {});
		this.runs.delete(path);
	}
}
