/**
 * Claude 订阅适配（Anthropic OAuth 会话）：
 * - 归因：按 Claude Code 的格式补 user-agent 与系统提示词首块的 billing header，缺失时注入，已存在则原样通过。
 *   每次请求异步读取本机版本，不猜测版本、不跨请求缓存；检测失败交给宿主显示扩展错误并保留其原生归因，下一次请求重新检测。
 * - 换发自愈：Anthropic 换发订阅令牌即吊销旧令牌，换发时仍在途的请求以 401 落空；宿主不重试 401，
 *   这里把该失败从模型投影中省略并续跑一次，续跑请求由宿主重读令牌文件拿到新令牌。重试仍 401 即登录真失效，照常落定。
 *   是否已重试只看会话分支，不留内存标记；不交给角色 fallback，换模型解决不了令牌换发。宿主将来自行重试这类 401 时删除本自愈。
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import type { ExtensionAPI, ExtensionContext, SessionEntry, SessionMessageEntry } from "@earendil-works/pi-coding-agent";
import { textOf } from "../format.js";

const BILLING_PREFIX = "x-anthropic-billing-header:";
const execFileAsync = promisify(execFile);
const DEFAULT_ENTRYPOINT = "cli";
const BILLING_SALT = "59cf53e54c78";
const REVOKED_TOKEN_NOTICE = "Claude 令牌刚换发，已自动重试";

type TextBlock = {
	type: "text";
	text: string;
	cache_control?: { type: "ephemeral"; ttl?: "1h" };
};

interface PayloadLike {
	system?: unknown;
	messages?: unknown;
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isTextBlock(value: unknown): value is TextBlock {
	return isObject(value) && value.type === "text" && typeof value.text === "string";
}

function shouldApply(ctx: ExtensionContext): boolean {
	const model = ctx.model;
	return !!model && model.provider === "anthropic" && ctx.modelRegistry.isUsingOAuth(model);
}

async function detectClaudeCodeVersion(): Promise<string> {
	const explicit = process.env.PI_CLAUDE_CODE_VERSION;
	if (explicit !== undefined) {
		const version = explicit.trim();
		if (/^\d+\.\d+\.\d+$/.test(version)) return version;
		throw new Error("Butler UI: PI_CLAUDE_CODE_VERSION 必须是 major.minor.patch 格式的 Claude Code 版本号。");
	}

	try {
		const { stdout } = await execFileAsync("claude", ["--version"], {
			encoding: "utf8",
			timeout: 10_000,
			maxBuffer: 64 * 1024,
		});
		const match = stdout.trim().match(/^\d+\.\d+\.\d+(?=\s|$)/);
		if (match) return match[0];
	} catch {
		// 不把外部进程的 stdout/stderr 写入错误，以免泄漏启动脚本中的环境信息。
	}

	throw new Error(
		"Butler UI: 无法在 10 秒内读取 Claude Code 版本。请确认 PATH 中的 claude --version 正常，" +
		"或将 PI_CLAUDE_CODE_VERSION 设为实际安装版本；本次保留 Pi 原生归因，下次请求会重新检测。",
	);
}

function firstUserText(messages: unknown): string {
	const list = Array.isArray(messages) ? messages : [];
	const firstUser = list.find((message) => isObject(message) && message.role === "user");
	return isObject(firstUser) ? textOf(firstUser.content) : "";
}

function versionSuffix(messageText: string, claudeCodeVersion: string): string {
	const explicit = process.env.PI_CLAUDE_CODE_VERSION_SUFFIX;
	if (explicit) return explicit;

	const sampled = [4, 7, 20].map((index) => messageText[index] ?? "0").join("");
	return createHash("sha256")
		.update(`${BILLING_SALT}${sampled}${claudeCodeVersion}`)
		.digest("hex")
		.slice(0, 3);
}

function buildBillingHeader(messages: unknown, claudeCodeVersion: string): string {
	const version = `${claudeCodeVersion}.${versionSuffix(firstUserText(messages), claudeCodeVersion)}`;
	const entrypoint =
		process.env.PI_CLAUDE_CODE_ENTRYPOINT ?? process.env.CLAUDE_CODE_ENTRYPOINT ?? DEFAULT_ENTRYPOINT;
	const workload = process.env.PI_CLAUDE_CODE_WORKLOAD ?? process.env.CLAUDE_CODE_WORKLOAD;
	const workloadPart = workload ? ` cc_workload=${workload};` : "";
	return `${BILLING_PREFIX} cc_version=${version}; cc_entrypoint=${entrypoint}; cch=00000;${workloadPart}`;
}

function log(details: Record<string, unknown>): void {
	const logFile = process.env.PI_CLAUDE_OAUTH_LOG_FILE;
	if (!logFile) return;

	const path = resolve(logFile);
	try {
		mkdirSync(dirname(path), { recursive: true });
		appendFileSync(path, `${JSON.stringify({ timestamp: new Date().toISOString(), ...details })}\n`, "utf8");
	} catch {
		// 调试日志是可选的。
	}
}

function isRevokedTokenFailure(entry: SessionEntry | undefined): entry is SessionMessageEntry {
	if (entry?.type !== "message" || entry.message.role !== "assistant") return false;
	const { stopReason, provider, errorMessage } = entry.message;
	return stopReason === "error" && provider === "anthropic" && !!errorMessage?.includes('"authentication_error"');
}

/** 分支上最后两条消息；中间的 context_edit 等非消息条目不算。 */
function lastTwoMessages(branch: SessionEntry[]): [SessionEntry | undefined, SessionEntry | undefined] {
	let last: SessionEntry | undefined;
	for (let index = branch.length - 1; index >= 0; index--) {
		if (branch[index].type !== "message") continue;
		if (last) return [branch[index], last];
		last = branch[index];
	}
	return [undefined, last];
}

export function registerClaudeSub(pi: ExtensionAPI): void {
	// Pi 每个会话的请求先组装 headers，再构造 payload；只在这两个钩子间保留版本。
	// 注册函数独占此状态，主会话与 worker 不共享版本，未启用的功能也不会启动 CLI。
	let requestVersion: string | undefined;
	pi.on("before_provider_headers", async (event, ctx) => {
		requestVersion = undefined;
		if (!shouldApply(ctx)) return;
		const version = await detectClaudeCodeVersion();
		event.headers["user-agent"] = `claude-cli/${version} (external, cli)`;
		event.headers["x-app"] = "cli";
		requestVersion = version;
	});

	pi.on("before_provider_request", (event, ctx) => {
		const version = requestVersion;
		requestVersion = undefined;
		const payload = event.payload;
		if (!version || !shouldApply(ctx) || !isObject(payload)) return;

		const { system, messages } = payload as PayloadLike;
		const blocks = Array.isArray(system) ? system : typeof system === "string" ? [{ type: "text", text: system }] : [];
		if (blocks.some((block) => isTextBlock(block) && block.text.startsWith(BILLING_PREFIX))) return;

		const header: TextBlock = { type: "text", text: buildBillingHeader(messages, version) };
		log({ event: "billing_header_injected", header: header.text });
		return { ...payload, system: [header, ...blocks] };
	});

	pi.on("agent_before_settle", (event, ctx) => {
		if (event.outcome !== "error" || !shouldApply(ctx)) return;
		const [previous, failure] = lastTwoMessages(ctx.sessionManager.getBranch());
		// 紧挨着的上一条也是同类失败，说明这次已是自愈重试：登录真失效，交回宿主照常落定。
		if (!isRevokedTokenFailure(failure) || isRevokedTokenFailure(previous)) return;
		ctx.ui.notify(REVOKED_TOKEN_NOTICE, "info");
		return { entries: [{ type: "context_edit", targetId: failure.id, replacement: null }], continue: true };
	});
}
