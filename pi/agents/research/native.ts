/** 一位调研员 = 一次带 `web_search_options` 的请求：模型用自己服务商的原生联网搜索（经支持该参数的 OpenAI 兼容网关），搜几次、读哪些页面由模型自己定。 */
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Atom } from "../config.js";
import { resolveModel } from "../mini.js";

const TIMEOUT_MS = 10 * 60_000;

export type NativeResult = { text: string; tokens: number };

export async function nativeResearch(ctx: Pick<ExtensionContext, "modelRegistry">, atom: Atom, system: string, prompt: string, signal?: AbortSignal): Promise<NativeResult> {
	const model = resolveModel(ctx, atom) as { baseUrl?: string };
	if (!model.baseUrl) throw new Error(`供应商 ${atom.provider} 没有请求地址`);
	const apiKey = await ctx.modelRegistry.getApiKeyForProvider(atom.provider);
	const body = {
		model: atom.id,
		messages: [{ role: "system", content: system }, { role: "user", content: prompt }],
		web_search_options: {},
		...(atom.thinking === "off" ? {} : { reasoning_effort: atom.thinking }),
	};
	const response = await fetch(`${model.baseUrl.replace(/\/$/, "")}/chat/completions`, {
		method: "POST",
		headers: { "content-type": "application/json", ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
		body: JSON.stringify(body),
		signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]) : AbortSignal.timeout(TIMEOUT_MS),
	});
	const data = (await response.json().catch(() => ({}))) as { choices?: { message?: { content?: string } }[]; usage?: { total_tokens?: number }; error?: { message?: string } };
	if (!response.ok) throw new Error(data.error?.message ?? `HTTP ${response.status}`);
	const text = data.choices?.[0]?.message?.content?.trim();
	if (!text) throw new Error("模型没有给出内容");
	return { text, tokens: data.usage?.total_tokens ?? 0 };
}
