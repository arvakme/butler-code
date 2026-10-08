// 端到端用的小客户端：启动一个隔离的 Pi（RPC 模式），发话、让模型调工具，收通知与工具结果。不依赖任何测试框架。
import { spawn, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, chmodSync, existsSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

/** 包的根入口：端到端加载整个 Butler Code 包，和真实安装一样。 */
export const ENTRY = resolve(HERE, "../..", "index.ts");
/** 根配置里与后台能力无关的开关：端到端默认全关，只测 agents 节。 */
const UI_OFF = Object.fromEntries(["header", "statusbar", "tools", "rename", "claudeSub", "openaiNative", "userMessage", "links", "review", "master"].map((f) => [f, false]));

/** 唯一运行配置 extensions/butler-ui/config.jsonc：agents 节原样放进去，features 在全关的基础上覆写。 */
export function writeConfig(agentDir, agents, features = {}, sections = {}) {
	mkdirSync(join(agentDir, "extensions", "butler-ui"), { recursive: true });
	writeFileSync(join(agentDir, "extensions", "butler-ui", "config.jsonc"), JSON.stringify({ features: { ...UI_OFF, ...features }, agents, ...sections }, null, 2));
}

/** 隔离的 Pi 目录：只带本包（用 -e 加载）和给定的配置，模型清单从真实配置复制（含本机网关密钥，用完即删）。 */
export function isolatedAgentDir(agents, extraSettings = {}, features = {}, sections = {}) {
	const dir = mkdtempSync(join(tmpdir(), "butler-e2e-"));
	writeConfig(dir, agents, features, sections);
	cpSync(join(homedir(), ".pi", "agent", "models.json"), join(dir, "models.json"));
	chmodSync(join(dir, "models.json"), 0o600);
	writeFileSync(join(dir, "settings.json"), JSON.stringify({ quietStartup: true, defaultProvider: "magpie", defaultModel: "group/sonnet", defaultThinkingLevel: "low", ...extraSettings }));
	return dir;
}

export class PiRpc {
	/** extensions：额外加载的扩展入口（同时装着的别的包）。 */
	constructor(agentDir, cwd, env = {}, { persist = false, extensions = [] } = {}) {
		this.notes = [];
		this.tools = [];
		this.ended = 0;
		this.messages = [];
		this.buffer = "";
		this.waiters = [];
		this.child = spawn("pi", ["--mode", "rpc", ...(persist ? [] : ["--no-session"]), "-e", ENTRY, ...extensions.flatMap((entry) => ["-e", entry])], { cwd, env: { ...process.env, PI_CODING_AGENT_DIR: agentDir, ...env }, stdio: ["pipe", "pipe", "pipe"] });
		this.stderr = "";
		this.child.stderr.on("data", (d) => (this.stderr += d));
		this.child.stdout.on("data", (chunk) => {
			this.buffer += chunk;
			let at;
			while ((at = this.buffer.indexOf("\n")) >= 0) {
				const line = this.buffer.slice(0, at);
				this.buffer = this.buffer.slice(at + 1);
				try { this.onRecord(JSON.parse(line)); } catch {}
			}
		});
	}
	onRecord(record) {
		if (record.type === "extension_ui_request" && record.method === "notify") this.notes.push({ text: record.message, level: record.notifyType });
		if (record.type === "extension_ui_request" && record.method === "setStatus") this.status = record.statusText;
		if (record.type === "message_end" && record.message?.role === "custom") this.messages.push(record.message);
		if (record.type === "tool_execution_start") this.tools.push({ name: record.toolName, args: record.args });
		if (record.type === "tool_execution_end") (this.toolResults ??= []).push({ name: record.toolName, text: (record.result?.content ?? []).map((c) => c.text ?? "").join(" "), error: record.isError });
		if (record.type === "agent_start") this.running = true;
		if (record.type === "agent_end") (this.ended += 1, (this.running = false));
		if (record.type === "message_end" && record.message?.role === "assistant") this.lastAssistant = record.message;
		this.waiters = this.waiters.filter((w) => !w(record));
	}
	send(command) { this.child.stdin.write(`${JSON.stringify(command)}\n`); }
	/** 发 prompt，直到某条通知满足 until 或超时。 */
	async command(text, until, timeoutMs = 900_000) {
		const before = this.notes.length;
		this.send({ type: "prompt", message: text });
		const deadline = Date.now() + timeoutMs;
		while (Date.now() < deadline) {
			const found = this.notes.slice(before).find((n) => until(n.text));
			if (found) return this.notes.slice(before);
			await new Promise((r) => setTimeout(r, 500));
		}
		throw new Error(`超时，收到的通知：${JSON.stringify(this.notes.slice(before))}\nstderr: ${this.stderr.slice(-500)}`);
	}
	/** 没有斜杠命令：让模型按给定参数调用一次工具，返回这次调用的结果文字（走真实的工具调用，和用户说一句话时一样）。 */
	async call(tool, args, timeoutMs = 300_000) {
		await this.quiet();
		const before = (this.toolResults ?? []).length;
		this.send({ type: "prompt", message: `只调用一次 ${tool} 工具，参数严格是这个 JSON，不要改动：${JSON.stringify(args)}。不要调用别的工具，调用完只回复“好”。` });
		const deadline = Date.now() + timeoutMs;
		while (Date.now() < deadline) {
			const found = (this.toolResults ?? []).slice(before).find((r) => r.name === tool);
			if (found) return found.text;
			await new Promise((r) => setTimeout(r, 500));
		}
		throw new Error(`超时，模型没有调用 ${tool}；用到的工具：${JSON.stringify(this.tools.slice(-5))}\nstderr: ${this.stderr.slice(-500)}`);
	}
	/** 发一句普通的话，等这一轮（包括它调用的工具）结束。 */
	/** 等主 Agent 安静下来：连续 ms 毫秒没有在跑的一轮（worker 的报告会让它自己开一轮，不等的话会把那一轮当成对我这句话的回应） */
	async quiet(ms = 2500, timeoutMs = 300_000) {
		const deadline = Date.now() + timeoutMs;
		let since = this.running ? 0 : Date.now();
		while (Date.now() < deadline) {
			if (this.running) since = 0;
			else if (!since) since = Date.now();
			else if (Date.now() - since >= ms) return;
			await new Promise((r) => setTimeout(r, 300));
		}
		throw new Error("主 Agent 一直没有安静下来");
	}
	async ask(text, timeoutMs = 900_000) {
		await this.quiet();
		const before = this.ended;
		this.send({ type: "prompt", message: text });
		const deadline = Date.now() + timeoutMs;
		while (Date.now() < deadline) {
			if (this.ended > before) return;
			await new Promise((r) => setTimeout(r, 500));
		}
		throw new Error(`超时，用到的工具：${JSON.stringify(this.tools)}\nstderr: ${this.stderr.slice(-500)}`);
	}
	close() { this.child.kill("SIGTERM"); }
}

export const cleanup = (...paths) => paths.forEach((p) => existsSync(p) && rmSync(p, { recursive: true, force: true }));

/** 等一个条件成立，超时返回 undefined */
export async function until(fn, ms = 120_000) {
	const end = Date.now() + ms;
	while (Date.now() < end) {
		const v = fn();
		if (v) return v;
		await new Promise((r) => setTimeout(r, 500));
	}
	return undefined;
}
/** 命令行里带这个字样的进程还有几个（用来确认子进程真的被停掉了，不是只改了状态） */
export function processesMatching(text) {
	return spawnSync("pgrep", ["-f", text], { encoding: "utf8" }).stdout.split("\n").filter(Boolean).length;
}
