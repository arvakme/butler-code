/** 扫描用的纯逻辑：提示词、对话的文字稿、模型答案的解析。没有 IO，所以能快速检查。 */
export const SYSTEM = `你读一段用户和编程助手的对话，替用户找出“还没做完的事”。
candidates：用户明确提出的要求，或助手明确答应“之后/待会/下一步会做”的事，而且对话里还没有做完（或看不到做完的证据）。
一律不算：已经做完的；纯问答、纯讨论；用户说了“先搁一下”“不用了”的；只是助手的建议而用户没答应的。
每条写成一句待办，动词开头，不超过 30 个字，写清对象。不要重复“已有清单”里的事。最多 5 条。
finished：“已有清单”里，从对话里能明确看出已经做完的，给一句证据。拿不准就不列。
obsolete：“已有清单”里，因为后来的进展已经不需要做了的（被更新的做法取代、用户改了主意、问题已经不存在、重复了别的一条），给一句理由。不是“放得久”就算过时，要看对话里后来发生了什么；拿不准就不列。
只输出一个 JSON，不要任何别的文字：{"candidates":["…"],"finished":[{"id":"t1","evidence":"…"}],"obsolete":[{"id":"t2","reason":"…"}]}
没有就给空数组。`;

type Message = { role?: string; content?: unknown };
const textOf = (content: unknown): string =>
	typeof content === "string" ? content : Array.isArray(content) ? content.map((part: any) => (part?.type === "text" ? part.text : part?.type === "toolCall" ? `（调用了 ${part.name}）` : "")).filter(Boolean).join(" ") : "";

/** 对话的文字稿：只要用户和助手说的话，工具的返回不要；超过上限就留最近的 */
export function transcript(entries: any[], maxChars = 14_000): string {
	const lines: string[] = [];
	for (const entry of entries) {
		const message: Message | undefined = entry?.type === "message" ? entry.message : undefined;
		if (!message || (message.role !== "user" && message.role !== "assistant")) continue;
		const text = textOf(message.content).replace(/\s+/g, " ").trim();
		if (text) lines.push(`${message.role === "user" ? "用户" : "助手"}：${text.slice(0, 1800)}`);
	}
	let out = "";
	for (let i = lines.length - 1; i >= 0; i--) {
		if (out.length + lines[i].length > maxChars) break;
		out = `${lines[i]}\n${out}`;
	}
	return out.trim();
}

export type ScanResult = { candidates: string[]; finished: { id: string; evidence: string }[]; obsolete: { id: string; reason: string }[] };
export function parseScan(text: string): ScanResult | undefined {
	try {
		const data = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] ?? "");
		const candidates = Array.isArray(data.candidates) ? data.candidates.filter((c: unknown): c is string => typeof c === "string" && c.trim().length > 0).slice(0, 5) : [];
		const finished = Array.isArray(data.finished) ? data.finished.filter((f: any) => typeof f?.id === "string").map((f: any) => ({ id: f.id, evidence: String(f.evidence ?? "") })) : [];
		const obsolete = Array.isArray(data.obsolete) ? data.obsolete.filter((o: any) => typeof o?.id === "string").map((o: any) => ({ id: o.id, reason: String(o.reason ?? "") })) : [];
		return { candidates, finished, obsolete };
	} catch {
		return undefined;
	}
}


/** 整理积压：模型对每一条给出建议。closed 是它能明确判断已经不用管的（做完了、过时了、重复了，会直接处理，留记录可撤销）；suggest 是对其余的建议，用户一键确认才执行。 */
export const TRIAGE = `你替用户整理一份积压的待办清单。给你：清单（编号、内容、放了多久、来源）、机器上的提醒，和最近的对话。
先判断每一条还要不要做：
closed：从对话和提醒能明确看出已经做完了，或者因为后来的进展已经不需要做了（被取代、用户改了主意、问题不存在了），或者和另一条重复。给 kind（done 做完 / obsolete 过时 / duplicate 重复）和一句理由。不是“放得久”就算过时，要看后来发生了什么；拿不准就不要 closed。
对其余的每一条给建议 suggest：
go：明确、能由编程助手现在动手做、不需要用户拍板。
ignore：虽然还没做，但价值很低、很模糊，或者明显不值得现在做。
ask：需要用户本人判断（取舍、授权、需要用户的账号或设备、会影响别人）。
理由写一句大白话。拿不准的归 ask，不要替用户决定忽略重要的事。
只输出一个 JSON，不要任何别的文字：{"closed":[{"id":"t1","kind":"done","reason":"…"}],"suggest":[{"id":"t2","kind":"go","why":"…"}]}
编号原样照抄，没有就给空数组。`;
export type Triage = { closed: { id: string; kind: "done" | "obsolete" | "duplicate"; reason: string }[]; suggest: { id: string; kind: "go" | "ignore" | "ask"; why: string }[] };
const CLOSED_KINDS = ["done", "obsolete", "duplicate"];
const SUGGEST_KINDS = ["go", "ignore", "ask"];
const shape = (data: any): Triage => ({
	closed: (Array.isArray(data?.closed) ? data.closed : []).filter((c: any) => typeof c?.id === "string" && CLOSED_KINDS.includes(c.kind)).map((c: any) => ({ id: c.id, kind: c.kind, reason: String(c.reason ?? "").slice(0, 200) })),
	suggest: (Array.isArray(data?.suggest) ? data.suggest : []).filter((c: any) => typeof c?.id === "string" && SUGGEST_KINDS.includes(c.kind)).map((c: any) => ({ id: c.id, kind: c.kind, why: String(c.why ?? "").slice(0, 200) })),
});
/** 整理的结果。先整体当 JSON 读（去掉代码围栏和前后的说明）；模型有时被截断或夹带说明，整体读不了时逐条捞出还完整的条目，而不是整个丢掉；一条都捞不到才算失败。 */
export function parseTriage(text: string): Triage | undefined {
	const body = text.replace(/```(?:json)?/gi, "");
	try {
		return shape(JSON.parse(body.slice(body.indexOf("{"), body.lastIndexOf("}") + 1)));
	} catch {
		/* 往下逐条捞 */
	}
	const entry = /\{\s*"id"\s*:\s*"([^"]+)"\s*,\s*"kind"\s*:\s*"([^"]+)"\s*,\s*"(?:reason|why)"\s*:\s*"((?:[^"\\]|\\.)*)"\s*\}/g;
	const found = [...body.matchAll(entry)].map((m) => ({ id: m[1], kind: m[2], text: m[3].slice(0, 200) }));
	const closed = found.filter((f) => CLOSED_KINDS.includes(f.kind)).map((f) => ({ id: f.id, kind: f.kind as Triage["closed"][number]["kind"], reason: f.text }));
	const suggest = found.filter((f) => SUGGEST_KINDS.includes(f.kind)).map((f) => ({ id: f.id, kind: f.kind as Triage["suggest"][number]["kind"], why: f.text }));
	return closed.length || suggest.length ? { closed, suggest } : undefined;
}
