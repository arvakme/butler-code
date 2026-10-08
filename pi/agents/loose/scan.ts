/** 让便宜的模型翻最近的对话：找出“要求提了、没看到做完”的事（候选），和清单里已经做完的事。读不懂就什么都不改。 */
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { LooseConfig } from "../config.js";
import { runMini } from "../mini.js";
import { type Item, live } from "./store.js";
import { SYSTEM, type ScanResult, TRIAGE, type Triage, parseScan, parseTriage, transcript } from "./text.js";

export type { ScanResult };

export async function scan(ctx: Pick<ExtensionContext, "modelRegistry">, config: LooseConfig, entries: any[], items: Item[], signal?: AbortSignal): Promise<ScanResult | undefined> {
	const talk = transcript(entries);
	if (talk.length < 40) return undefined;
	const known = items.filter(live).map((item) => `${item.id}：${item.text}`).join("\n") || "（空）";
	try {
		const result = await runMini(ctx, { atom: config.model, system: SYSTEM, prompt: `已有清单：\n${known}\n\n对话：\n${talk}`, maxTurns: 2, signal });
		return parseScan(result.text);
	} catch {
		return undefined;
	}
}

/** 整理积压：把清单（和机器上的提醒）连同最近的对话交给便宜的模型，拿回“可以直接处理掉的”和“对其余的建议”。读不懂返回空，什么都不改。 */
export async function triage(ctx: Pick<ExtensionContext, "modelRegistry">, config: LooseConfig, entries: any[], items: Item[], alerts: { key: string; text: string; age: string }[], now: number, signal?: AbortSignal): Promise<{ triage?: Triage; raw: string }> {
	const list = [
		...items.filter(live).slice(0, 60).map((item) => `${item.id}｜${item.status === "candidate" ? "候选" : "待办"}｜${item.text}｜放了 ${Math.round((now - item.created) / 3_600_000)} 小时｜来源：${item.source}`),
		...alerts.map((a) => `alert:${a.key}｜提醒｜${a.text}｜${a.age}`),
	].join("\n") || "（空）";
	// 便宜的模型偶尔会给出读不懂或被截断的结果：自动再试一次；还是不行就把原文交回去，由调用方留档
	let raw = "";
	for (let attempt = 0; attempt < 2; attempt++) {
		try {
			const result = await runMini(ctx, { atom: config.model, system: TRIAGE, prompt: `清单：\n${list}\n\n最近的对话：\n${transcript(entries) || "（没有）"}`, maxTurns: 2, signal });
			raw = result.text;
			const parsed = parseTriage(raw);
			if (parsed) return { triage: parsed, raw };
		} catch (error) {
			raw = `${raw}\n[error] ${String((error as Error)?.message ?? error)}`;
		}
		if (signal?.aborted) break;
	}
	return { raw };
}
