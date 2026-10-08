/** 迷你 agent：一次性的、带工具的模型循环，经 Pi 自己的模型注册表调用。不是子会话，不进主会话的记录。 */
import { Agent, type AgentTool } from "@earendil-works/pi-agent-core";
import type { Model } from "@earendil-works/pi-ai";
import { streamSimple } from "@earendil-works/pi-ai/compat";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Atom } from "./config.js";
import { clipText } from "./jobs.js";

export type MiniResult = { text: string; turns: number; toolCalls: number; tokens: number; stopReason: string };
export type MiniOptions = {
	atom: Atom;
	system: string;
	prompt: string;
	tools?: AgentTool<any>[];
	maxTurns?: number;
	signal?: AbortSignal;
	onTool?: (name: string, args: unknown) => void;
	/** 完整过程，一行一条：`→ 工具 参数`、`← 工具 结果`、`说 …`、`想 …`、`· …` */
	onTrace?: (line: string) => void;
};

const argText = (args: unknown) => clipText(typeof args === "string" ? args : JSON.stringify(args ?? {}), 800);
const resultText = (result: any) => clipText((result?.content ?? []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n") || JSON.stringify(result ?? ""), 2400);

/** 找模型：Pi 的列表里有就用；没有（比如只给调研和哨兵用的 group/luna）就借同一供应商的任一模型当模板，换上 id。 */
export function resolveModel(ctx: Pick<ExtensionContext, "modelRegistry">, atom: Atom): Model<any> {
	const found = ctx.modelRegistry.find(atom.provider, atom.id);
	if (found) return found;
	const template = ctx.modelRegistry.getAll().find((m) => m.provider === atom.provider);
	if (!template) throw new Error(`供应商 ${atom.provider} 不在 Pi 的模型列表里`);
	return { ...template, id: atom.id, name: atom.id, reasoning: true };
}

export async function runMini(ctx: Pick<ExtensionContext, "modelRegistry">, options: MiniOptions): Promise<MiniResult> {
	const model = resolveModel(ctx, options.atom);
	const agent = new Agent({
		initialState: { systemPrompt: options.system, model, thinkingLevel: options.atom.thinking, tools: options.tools ?? [] },
		streamFn: streamSimple,
		getApiKey: (provider) => ctx.modelRegistry.getApiKeyForProvider(provider),
		toolExecution: "parallel",
	});
	let turns = 0;
	let toolCalls = 0;
	const max = options.maxTurns ?? 30;
	const stop = agent.subscribe((event) => {
		if (event.type === "turn_end" && ++turns >= max) agent.abort();
		if (event.type === "tool_execution_start") {
			toolCalls += 1;
			options.onTool?.(event.toolName, event.args);
			options.onTrace?.(`→ ${event.toolName} ${argText(event.args)}`);
		}
		if (event.type === "tool_execution_end") options.onTrace?.(`${event.isError ? "✗" : "←"} ${event.toolName} ${resultText(event.result)}`);
		if (event.type === "message_end" && (event.message as any).role === "assistant") {
			const message = event.message as any;
			for (const part of message.content ?? []) {
				if (part.type === "thinking" && part.thinking) options.onTrace?.(`想 ${clipText(part.thinking, 1500)}`);
				if (part.type === "text" && part.text) options.onTrace?.(`说 ${clipText(part.text, 4000)}`);
			}
			if (message.usage?.totalTokens) options.onTrace?.(`· 这一轮 ${message.usage.totalTokens} tokens`);
		}
	});
	const onAbort = () => agent.abort();
	options.signal?.addEventListener("abort", onAbort, { once: true });
	try {
		await agent.prompt(options.prompt);
		await agent.waitForIdle();
	} finally {
		stop();
		options.signal?.removeEventListener("abort", onAbort);
	}
	const messages = agent.state.messages;
	let last: any;
	let tokens = 0;
	for (const message of messages) {
		if (message.role !== "assistant") continue;
		last = message;
		tokens += message.usage?.totalTokens ?? 0;
	}
	const text = last ? last.content.filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n").trim() : "";
	const stopReason = turns >= max ? "max-turns" : (last?.stopReason ?? "none");
	if (last?.stopReason === "error") throw new Error(last.errorMessage ?? "模型请求失败");
	return { text, turns, toolCalls, tokens, stopReason };
}
