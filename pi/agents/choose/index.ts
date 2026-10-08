/** 选择题：助手说完一段话、在等你做决定时，让一个小模型把它整理成选项，你按键选，不用打字回答。 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { CONFIG_PATH } from "../../config.js";
import type { ChooseConfig } from "../config.js";
import { runMini } from "../mini.js";

const LOG = join(dirname(CONFIG_PATH), "choose-log.jsonl");
const OTHER = "自己写…";
const SYSTEM = `你读一段编程助手刚说完的话，判断它是不是在等用户做选择；是的话整理成一道选择题。
只有同时满足下面两条才出题：
1. 助手明确在等用户做决定（不是在汇报结果）。
2. 有 2 到 4 个有限的、互不重叠的选项，用户可以直接选一个（也可以是一个明确的“是/否”）。
一律不出题：助手在汇报或总结；问的是开放问题（要用户给路径、名字、描述、报错）；问“要不要继续”“还有别的吗”这类没有信息量的话；一次问了三个以上的问题；选项需要用户自己填东西才能成立。
选项必须来自助手的原话，不要自己发明，不要改变意思。
只输出一个 JSON，不要任何别的文字：
不出题：{"ask":false}
出题：{"ask":true,"question":"一句话的问题","options":[{"label":"不超过 12 个字","detail":"一句话说明，可省略"}],"recommended":助手推荐的选项序号（从 0 开始），没有推荐就是 null}
label、question 用助手所用的语言。`;

type Outcome = "shown" | "picked" | "typed" | "dismissed";
type Entry = { at: string; outcome: Outcome; question: string; pick?: string };
export type Question = { question: string; options: { label: string; detail?: string }[]; recommended: number | null };

const read = (): Entry[] => {
	if (!existsSync(LOG)) return [];
	return readFileSync(LOG, "utf8").split("\n").filter(Boolean).map((l) => {
		try { return JSON.parse(l) as Entry; } catch { return undefined; }
	}).filter((e): e is Entry => e !== undefined);
};
const write = (entry: Omit<Entry, "at">) => {
	try {
		mkdirSync(dirname(LOG), { recursive: true });
		appendFileSync(LOG, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`);
	} catch {
		// 记不下来不影响使用
	}
};

/** 最近 10 次展示里被直接关掉的比例；展示不满 6 次不下结论。 */
export function dismissal(entries: Entry[]): { shown: number; dismissed: number; rate: number | undefined } {
	const shown = entries.filter((e) => e.outcome === "shown").length;
	const finished = entries.filter((e) => e.outcome !== "shown").slice(-10);
	const dismissed = finished.filter((e) => e.outcome === "dismissed").length;
	return { shown, dismissed, rate: finished.length >= 6 ? dismissed / finished.length : undefined };
}

/** 不花模型调用的第一道门：结尾像在提问，并且带着几个并列的选项。 */
export function looksLikeChoice(text: string): boolean {
	const tail = text.trim().slice(-500);
	if (tail.length < 12) return false;
	const asks = /[？?]/.test(tail.slice(-160));
	const listed = /(^|\n)\s*(?:[-*•]|\d+[.、)）]|[A-Da-d][.、):：）]|方案\s*[A-Da-d1-4]|选项\s*[A-Da-d1-4])/.test(tail);
	const either = /还是|或者|二选一|\bor\b/i.test(tail);
	return asks && (listed || either);
}

const lastAssistant = (messages: any[]) => {
	const last = [...messages].reverse().find((m) => m.role === "assistant");
	if (!last || last.stopReason === "error" || last.stopReason === "aborted") return undefined;
	const text = typeof last.content === "string" ? last.content : (last.content ?? []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n");
	return text.trim() || undefined;
};

/** 模型的回答变成一道合格的题；不出题、格式不对、选项太少或太多都丢掉。 */
export function parseQuestion(raw: string): Question | undefined {
	const match = /\{[\s\S]*\}/.exec(raw);
	if (!match) return undefined;
	let data: any;
	try { data = JSON.parse(match[0]); } catch { return undefined; }
	if (data?.ask !== true || typeof data.question !== "string" || !data.question.trim() || !Array.isArray(data.options)) return undefined;
	const options = data.options
		.filter((o: any) => o && typeof o.label === "string" && o.label.trim())
		.map((o: any) => ({ label: o.label.trim().slice(0, 30), detail: typeof o.detail === "string" && o.detail.trim() ? o.detail.trim().slice(0, 80) : undefined }));
	if (options.length < 2 || options.length > 4) return undefined;
	const recommended = Number.isInteger(data.recommended) && data.recommended >= 0 && data.recommended < options.length ? data.recommended : null;
	return { question: data.question.trim().slice(0, 120), options, recommended };
}

export function registerChoose(pi: ExtensionAPI, config: ChooseConfig): void {
	let generation = 0;
	let eligible = 0;

	pi.on("input", () => void (generation += 1));

	pi.on("agent_end", (event, ctx) => {
		if (ctx.mode !== "tui") return;
		const text = lastAssistant(event.messages as any[]);
		if (!text) return;
		if (!looksLikeChoice(text)) return;
		eligible += 1;
		const stats = dismissal(read());
		// 你经常直接关掉它，就降低频率：每三次才问一次
		if (stats.rate !== undefined && stats.rate >= 0.6 && eligible % 3 !== 0) return;
		const mine = ++generation;
		void ask(ctx, text, mine);
	});

	async function ask(ctx: ExtensionContext, text: string, mine: number) {
		try {
			const result = await runMini(ctx, { atom: config.model, system: SYSTEM, prompt: `助手刚说的话：\n\n${text.slice(-2500)}`, maxTurns: 1 });
			if (mine !== generation || ctx.ui.getEditorText() !== "") return;
			const q = parseQuestion(result.text);
			if (!q) return;
			write({ outcome: "shown", question: q.question });
			const labels = q.options.map((o, i) => `${o.label}${i === q.recommended ? "（推荐）" : ""}${o.detail ? ` — ${o.detail}` : ""}`);
			const picked = await ctx.ui.select(q.question, [...labels, OTHER]);
			if (picked === undefined) return void write({ outcome: "dismissed", question: q.question });
			if (picked === OTHER) {
				const typed = (await ctx.ui.input(q.question, "直接写你的回答"))?.trim();
				if (!typed) return void write({ outcome: "dismissed", question: q.question });
				write({ outcome: "typed", question: q.question, pick: typed.slice(0, 160) });
				return void (await pi.sendUserMessage(typed));
			}
			const option = q.options[labels.indexOf(picked)];
			write({ outcome: "picked", question: q.question, pick: option.label });
			await pi.sendUserMessage(option.label);
		} catch (error) {
		}
	}
}
