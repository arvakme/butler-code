/**
 * 审查落定 → delivery-verify 验收报告：最后一轮每位审查者一条验收项，之前的轮次进过程记录，
 * 原文存进本轮目录，生成离线 HTML 并登记到交付看板。只读 review/ 的 checkpoint，不改审查本身。
 */
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { appendFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import type { ReviewRound, ReviewState, ReviewerResult } from "../review/state.js";

const BUTLER_CODE = join(homedir(), ".config", "butler-code");
const SCRIPTS = join(BUTLER_CODE, "skills", "engineering", "delivery-verify", "scripts");
export const DEFAULT_REGISTRY = join(BUTLER_CODE, "config", "local", "delivery-share.json");

type Evidence = { kind: "text"; path: string; caption: string; source: string; phase: "process" | "final"; inspected: boolean };
type Case = { id: string; title: string; required: boolean; method: string; expected: string; observation: string; status: string; evidence_required: string[]; evidence: Evidence[] };

export type Published = { directory: string; report: string; url?: string; verdict: string; problem?: string };

/** 用户取消或会话退出收口的审查没有结论，不出报告；其余落定的审查都要出。 */
export function reportable(state: ReviewState | undefined): state is ReviewState {
	const last = state?.phase === "settled" ? state.history.at(-1) : undefined;
	return !!last && !(last.result === "cancelled" && (last.reason === "user" || last.reason === "shutdown"));
}

const atom = (r: ReviewerResult) => `${r.model} · ${r.thinking}`;
const seconds = (ms: number) => `${Math.round(ms / 1000)} 秒`;
const ROUND_TEXT: Record<ReviewRound["result"], string> = {
	passed: "全部通过", failed: "有审查者要求修改", error: "审查出错", stopped: "顾问叫停", cancelled: "被取消", timed_out: "超时",
};

function reviewerCase(reviewer: ReviewerResult, evidence: Evidence): Case {
	const status = reviewer.status === "passed" ? "passed" : reviewer.status === "failed" ? "failed" : "uncertain";
	return {
		id: `reviewer-${reviewer.index + 1}`,
		title: `审查者 ${reviewer.index + 1}（${atom(reviewer)}）${status === "passed" ? "认为可以通过" : status === "failed" ? "要求修改" : "没能给出结论"}`,
		required: true,
		method: "审查者独立读改动和代码，跑只读验证，按发现给出通过或不通过。",
		expected: "没有需要阻塞的问题。",
		observation: reviewer.summary || reviewer.details || "（没有摘要）",
		status,
		evidence_required: ["text"],
		evidence: [evidence],
	};
}

/** 最后一轮里没有审查者结果（超时、出错）时，整场审查记为阻塞。 */
function blockedCase(last: ReviewRound): Case {
	return {
		id: "review-run",
		title: `审查没有跑完：${ROUND_TEXT[last.result]}`,
		required: true,
		method: "对抗审查按轮次运行，每轮由几位审查者独立审查。",
		expected: "审查跑完并给出结论。",
		observation: last.details.trim() || ROUND_TEXT[last.result],
		status: "blocked",
		evidence_required: [],
		evidence: [],
	};
}

function advisorCase(last: ReviewRound): Case | undefined {
	if (!last.advisor) return undefined;
	return {
		id: "advisor",
		title: `顾问的裁决：${last.advisor.verdict === "stop" ? "叫停" : last.advisor.verdict === "narrow" ? "收窄范围" : "继续修"}`,
		required: false,
		method: "审查者连续不通过时，顾问看分歧决定继续修、收窄范围还是停下。",
		expected: "分歧有明确的处理意见。",
		observation: last.advisor.advice,
		status: "uncertain",
		evidence_required: [],
		evidence: [],
	};
}

function summaryOf(cases: Case[]): string {
	const failed = cases.filter((c) => c.status === "failed").length;
	const passed = cases.filter((c) => c.status === "passed").length;
	if (cases.some((c) => c.status === "blocked")) return "审查没有跑完，下面记录了卡在哪里。这是模型的意见，不是人工审查。";
	if (failed === 0 && passed > 0) return `${passed} 位审查者都认为改动可以通过。这是模型的意见，不是人工审查。`;
	return `最后一轮有 ${failed} 位审查者要求修改，逐条看下面的验收项，修完再审一次。这是模型的意见，不是人工审查。`;
}

const run = (file: string, args: string[], cwd?: string) =>
	new Promise<{ code: number; out: string }>((done) =>
		execFile(file, args, { timeout: 120_000, cwd }, (error, stdout, stderr) => done({ code: error ? 1 : 0, out: `${stdout}${stderr}`.trim() })),
	);

const python = (script: string, args: string[]) => run("mise", ["exec", "-C", BUTLER_CODE, "--", "python3", join(SCRIPTS, script), ...args]);

/** 报告放在仓库根的 .delivery/ 下并排除出 Git；不在仓库里就放工作目录。 */
async function deliveryRoot(cwd: string): Promise<string> {
	const top = await run("git", ["rev-parse", "--show-toplevel"], cwd);
	if (top.code !== 0) return cwd;
	const exclude = await run("git", ["rev-parse", "--path-format=absolute", "--git-path", "info/exclude"], cwd);
	if (exclude.code === 0) {
		const file = exclude.out;
		const lines = existsSync(file) ? readFileSync(file, "utf8").split("\n") : [];
		if (!lines.includes(".delivery/")) {
			mkdirSync(join(file, ".."), { recursive: true });
			await appendFile(file, `${lines.length && lines.at(-1) !== "" ? "\n" : ""}.delivery/\n`);
		}
	}
	return top.out;
}

/** 同一场审查（runId）只出一份报告：reload 后重放的落定不重复发布。 */
function existingRound(task: string, runId: string): string | undefined {
	if (!existsSync(task)) return undefined;
	for (const name of readdirSync(task)) {
		const file = join(task, name, "result.json");
		if (existsSync(file) && (JSON.parse(readFileSync(file, "utf8")) as { run_id?: string }).run_id === runId) return join(task, name);
	}
	return undefined;
}

function nextRound(task: string): number {
	const rounds = existsSync(task) ? readdirSync(task).map((n) => Number(/^round-(\d+)$/.exec(n)?.[1] ?? 0)) : [];
	return Math.max(0, ...rounds) + 1;
}

export async function publishReview(state: ReviewState, cwd: string, registry = DEFAULT_REGISTRY): Promise<Published | undefined> {
	const root = await deliveryRoot(cwd);
	const project = basename(root);
	const slug = `${project.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "project"}-review`.slice(0, 80);
	const task = join(root, ".delivery", slug);
	if (existingRound(task, state.runId)) return undefined;
	const round = nextRound(task);
	const roundName = `round-${String(round).padStart(2, "0")}`;
	const directory = join(task, roundName);
	mkdirSync(join(directory, "evidence"), { recursive: true });

	const last = state.history.at(-1)!;
	const write = (round: ReviewRound, reviewer: ReviewerResult, phase: Evidence["phase"]): Evidence => {
		const path = `evidence/round-${round.round}-reviewer-${reviewer.index + 1}.md`;
		writeFileSync(join(directory, path), `# 第 ${round.round} 轮 · 审查者 ${reviewer.index + 1}（${atom(reviewer)}）\n\n${reviewer.details || reviewer.summary || "（没有输出）"}\n`);
		return { kind: "text", path, caption: `审查者原文（模型写的，未经人工审阅）`, source: "fire-review", phase, inspected: true };
	};
	for (const earlier of state.history.slice(0, -1)) for (const reviewer of earlier.reviewers) write(earlier, reviewer, "process");

	const cases = last.reviewers.length ? last.reviewers.map((r) => reviewerCase(r, write(last, r, "final"))) : [blockedCase(last)];
	const advisor = advisorCase(last);
	if (advisor) cases.push(advisor);
	const models = [...new Set(state.history.flatMap((r) => r.reviewers.map(atom)))];
	const result = {
		schema_version: 1,
		run_id: state.runId,
		title: `对抗审查：${project}`,
		summary: summaryOf(cases),
		project,
		task: slug,
		round,
		created_at: new Date().toISOString(),
		revision: (await run("git", ["rev-parse", "--short", "HEAD"], root)).out.split("\n")[0] || "不在 Git 仓库里",
		environment: `审查者：${models.join("、") || "无"}；目录 ${cwd}`,
		entry: "Pi 的 review 工具（FireCode 对抗审查）",
		process: [
			...(state.focus ? [`审查重点：${state.focus}`] : []),
			...state.history.map((r) => `第 ${r.round} 轮：${ROUND_TEXT[r.result]}，${r.reviewers.length} 位审查者，用时 ${seconds(r.elapsedMs)}`),
		],
		cases,
		checks: [],
		review: "几个模型各自独立审查，要改的交给执行模型修完再审。这是模型的意见，不是人工审查。",
		limitations: [
			"审查者是模型，会漏报也会误报，有争议的条目请自己判断。",
			"审查者只读代码和跑只读验证，没有操作真实界面。",
		],
		cleanup: { complete: true, notes: "审查会话随审查结束关闭；审查者原文保存在本轮目录。" },
	};
	writeFileSync(join(directory, "result.json"), JSON.stringify(result, null, 2));

	const made = await python("report.py", [join(directory, "result.json")]);
	if (made.code !== 0) return { directory, report: join(directory, "report.html"), verdict: "", problem: `报告生成失败：${made.out}` };
	const verdict = made.out.split("\n").at(-1) ?? "";
	const published = { directory, report: join(directory, "report.html"), verdict };
	const origin = existsSync(registry) ? (JSON.parse(readFileSync(registry, "utf8")) as { origin?: string }).origin : undefined;
	if (!origin) return { ...published, problem: "交付看板没有登记 origin，报告只在本机目录里" };
	const registered = await python("share.py", ["--registry", registry, "register", slug, task, "--origin", origin, "--agent", "pi"]);
	if (registered.code !== 0) return { ...published, problem: `登记到交付看板失败：${registered.out}` };
	return { ...published, url: `${origin}/delivery/${slug}/${roundName}/report.html` };
}
