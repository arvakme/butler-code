/** 看“状态”而不是看对话：机器上的客观事实，用户单纯忘了的事也抓得到。每一条都是一个能说清的事实，不靠模型猜。 */
import { execFile } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** go：用户在弹窗里点“去做”时，对 Pi 说的话（说清要做什么，要用户拍板的 Pi 会再问）。 */
export type Signal = { key: string; text: string; since: number; go: string };
export const SIGNAL_HOURS = 2;

const git = (cwd: string, args: string[]) =>
	new Promise<string>((done) => execFile("git", args, { cwd, timeout: 15_000, maxBuffer: 4_000_000 }, (error, stdout) => done(error ? "" : stdout)));

/** 改了没提交：文件数，和最近一次改动离现在多久 */
async function dirty(cwd: string, now: number): Promise<Signal[]> {
	const out = (await git(cwd, ["status", "--porcelain"])).split("\n").filter(Boolean);
	if (!out.length) return [];
	const root = (await git(cwd, ["rev-parse", "--show-toplevel"])).trim() || cwd;
	let newest = 0;
	for (const line of out.slice(0, 60)) {
		try {
			newest = Math.max(newest, statSync(join(root, line.slice(3).replace(/^"|"$/g, "").split(" -> ").pop()!)).mtimeMs);
		} catch {
			newest = Math.max(newest, now); // 被删掉的文件：算刚改过
		}
	}
	return newest && now - newest >= SIGNAL_HOURS * 3_600_000 ? [{ key: "dirty", text: `${out.length} 个文件改了还没提交`, since: newest, go: "看一下 git status 和 diff，告诉我这些改动是什么，把该提交的整理好提交（提交信息写清楚）；拿不准该不该提交的先问我。" }] : [];
}

/** 提交了没推送 */
async function unpushed(cwd: string, now: number): Promise<Signal[]> {
	const times = (await git(cwd, ["log", "@{u}..HEAD", "--format=%ct"])).split("\n").filter(Boolean).map(Number);
	if (!times.length) return [];
	const since = Math.min(...times) * 1000;
	return now - since >= SIGNAL_HOURS * 3_600_000 ? [{ key: "unpushed", text: `${times.length} 个提交还没推送`, since, go: "确认当前分支和远端，把这些提交推送上去；推送前先说一下要推到哪里。" }] : [];
}

/** 本会话交付的验收报告，最新一轮在看板上等着用户：报告出来以后没有任何反馈回执 */
export function waitingReports(registryPath: string, pane: string, socket: string, now: number): Signal[] {
	if (!pane || !socket || !existsSync(registryPath)) return [];
	let registry: any;
	try {
		registry = JSON.parse(readFileSync(registryPath, "utf8"));
	} catch {
		return [];
	}
	const out: Signal[] = [];
	for (const [slug, entry] of Object.entries<any>(registry.deliveries ?? {})) {
		if (entry.pane !== pane || entry.herdr_socket !== socket || (entry.state ?? "active") !== "active" || !existsSync(entry.root)) continue;
		const rounds = existsSync(join(entry.root, "result.json")) ? [entry.root] : readdirSync(entry.root).filter((d) => /^round-\d+$/.test(d)).sort().map((d) => join(entry.root, d));
		const latest = rounds.at(-1);
		if (!latest || !existsSync(join(latest, "report.html"))) continue;
		const made = statSync(join(latest, "report.html")).mtimeMs;
		const receipts = existsSync(join(latest, "feedback-receipts")) ? readdirSync(join(latest, "feedback-receipts")).map((f) => statSync(join(latest, "feedback-receipts", f)).mtimeMs) : [];
		if (receipts.some((t) => t >= made) || now - made < SIGNAL_HOURS * 3_600_000) continue;
		let title = slug;
		try {
			title = JSON.parse(readFileSync(join(latest, "result.json"), "utf8")).title ?? slug;
		} catch {}
		out.push({ key: `report:${slug}`, text: `验收报告在等你看：${title}`, since: made, go: `把验收报告「${title}」的 Tailscale HTTPS 地址（delivery 看板，slug ${slug}）发给我，并用一两句话说它在等我验收什么。` });
	}
	return out;
}

export async function gather(cwd: string, now = Date.now(), pane = process.env.HERDR_PANE_ID ?? "", registry = join(homedir(), ".config/butler-code/config/local/delivery-share.json")): Promise<Signal[]> {
	const [a, b] = await Promise.all([dirty(cwd, now), unpushed(cwd, now)]);
	return [...a, ...b, ...waitingReports(registry, pane, process.env.HERDR_SOCKET_PATH ?? "", now)];
}
