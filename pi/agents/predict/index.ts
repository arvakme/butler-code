/** 预测输入：每个回合结束后，让一个小模型猜你下一句想说什么，显示成输入框里的灰色提示，按 Tab 采用。 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { CustomEditor, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { matchesKey, type TUI, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { CONFIG_PATH } from "../../config.js";
import type { PredictConfig } from "../config.js";
import { runMini } from "../mini.js";

const LOG = join(dirname(CONFIG_PATH), "predict-log.jsonl");
const SYSTEM = `你替用户预测他在这个编程会话里下一句最可能说的话。只输出这一句话本身：不加引号、不加解释、不加前缀。
- 你预测的是**用户**会说的话，不是助手会说的话：如果助手刚问了一个问题，就预测用户的回答或指令，绝不能把助手的问题复述一遍。
- 用用户最近说话的语言和口吻，长度和他平时差不多，一句话为限（通常不超过 40 个字）。
- 只有下一步很明显时才预测（比如助手刚做完一件事、问了一个问题，或者用户通常接下来会要求的事）。没有把握就只输出两个字：无。
- 不要预测“好的”“谢谢”“继续”这类没有信息量的话，除非助手刚问了“要继续吗”。
- 下面的“用户采用过的预测”和“用户实际打的字”是他的真实习惯，贴近它们。`;

type Outcome = "shown" | "accepted" | "ignored";
type Entry = { at: string; outcome: Outcome; suggestion: string; typed?: string };

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

/** 最近 30 次展示里被采用的比例；展示不满 20 次不下结论。 */
export function acceptance(entries: Entry[]): { shown: number; accepted: number; rate: number | undefined } {
	const recent = entries.filter((e) => e.outcome === "shown").slice(-30);
	const accepted = entries.filter((e) => e.outcome === "accepted").slice(-30).length;
	return { shown: recent.length, accepted, rate: recent.length >= 20 ? accepted / recent.length : undefined };
}

const text = (message: any): string =>
	typeof message?.content === "string" ? message.content : (message?.content ?? []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n");

function conversation(ctx: ExtensionContext): { recent: string; typed: string[] } {
	const lines: string[] = [];
	const typed: string[] = [];
	for (const entry of ctx.sessionManager.getEntries() as any[]) {
		const m = entry.type === "message" ? entry.message : undefined;
		if (m?.role === "user") {
			const t = text(m).trim();
			if (t) { lines.push(`用户：${t.slice(0, 400)}`); typed.push(t.slice(0, 120)); }
		} else if (m?.role === "assistant") {
			const t = text(m).trim();
			if (t) lines.push(`助手：${t.slice(0, 900)}`);
		}
	}
	return { recent: lines.slice(-6).join("\n\n"), typed: typed.slice(-5) };
}

/** 模型的回答变成一句干净的建议；“无”、空、太长、像解释的都丢掉。 */
export function clean(raw: string): string | undefined {
	// 小模型偶尔在句末多吐一个 `】【`（后面可能还跟句号），它不属于用户要说的话
	const line = raw.trim().split("\n")[0]?.trim().replace(/[】【]+(?=[。！？.!?]?$)/, "").replace(/^["“「'`]+|["”」'`]+$/g, "").trim() ?? "";
	if (line === "" || line === "无" || line === "无。" || line.length > 120) return undefined;
	if (/^(预测|建议|下一句|用户)[:：]/.test(line)) return line.replace(/^(预测|建议|下一句|用户)[:：]\s*/, "") || undefined;
	return line;
}

/** 在空输入框的光标后面补上灰色提示；找不到光标就在输入行下面单独放一行，宁可丑一点也不弄坏输入框。 */
export function withGhost(lines: string[], suggestion: string, width: number): string[] {
	// 光标是一个反显的空格；Pi 会在里面夹一段颜色重置，所以按“反显、若干样式、空格、重置”匹配
	const cursor = /\x1b\[7m(?:\x1b\[\d+m)* \x1b\[0m/;
	const at = lines.findIndex((l) => cursor.test(l));
	if (at < 0) return lines;
	const hit = cursor.exec(lines[at]) as RegExpExecArray;
	const before = lines[at].slice(0, hit.index + hit[0].length);
	const after = lines[at].slice(hit.index + hit[0].length);
	const room = Math.max(0, width - visibleWidth(before));
	if (room < 6) return lines;
	const ghost = truncateToWidth(`${suggestion} ⇥`, room, "…");
	const rest = after.replace(/\s+$/, "");
	const padding = " ".repeat(Math.max(0, room - visibleWidth(ghost) - visibleWidth(rest)));
	const out = [...lines];
	out[at] = `${before}\x1b[2m${ghost}\x1b[22m${rest}${padding}`;
	return out;
}

type Hooks = { suggestion: () => string | undefined; accept: (text: string) => void };

/**
 * 给输入框加上灰字与 Tab：装饰已有的输入框（如状态栏的输入框外壳）而不是替换它，两个扩展才能同时生效。
 * 只在输入框为空且有建议时介入，其余按键与绘制原样交给原输入框。
 */
function withPredict(editor: CustomEditor, hooks: Hooks): CustomEditor {
	const handleInput = editor.handleInput.bind(editor);
	const render = editor.render.bind(editor);
	editor.handleInput = (data) => {
		const suggestion = hooks.suggestion();
		if (suggestion && editor.getText() === "" && matchesKey(data, "tab") && !editor.isShowingAutocomplete()) {
			editor.setText(suggestion);
			hooks.accept(suggestion);
			return;
		}
		handleInput(data);
	};
	editor.render = (width) => {
		const lines = render(width);
		const suggestion = hooks.suggestion();
		return suggestion && editor.getText() === "" ? withGhost(lines, suggestion, width) : lines;
	};
	return editor;
}

export function registerPredict(pi: ExtensionAPI, config: PredictConfig): void {
	let suggestion: string | undefined;
	let generation = 0;
	let turns = 0;
	let tui: TUI | undefined;

	const show = (text: string | undefined) => {
		suggestion = text;
		tui?.requestRender();
	};

	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		const base = ctx.ui.getEditorComponent();
		ctx.ui.setEditorComponent((t, theme, keybindings) => {
			tui = t;
			const editor = (base?.(t, theme, keybindings) as CustomEditor | undefined) ?? new CustomEditor(t, theme, keybindings);
			return withPredict(editor, {
				suggestion: () => suggestion,
				accept: (text) => {
					write({ outcome: "accepted", suggestion: text });
					suggestion = undefined;
				},
			});
		});
	});

	// 用户发出一条消息：如果展示过建议而他打的是别的，把他真正打的字记下来，这是最好的学习材料
	pi.on("input", (event) => {
		generation += 1;
		if (suggestion && event.text.trim() !== suggestion) write({ outcome: "ignored", suggestion, typed: event.text.trim().slice(0, 160) });
		show(undefined);
	});

	pi.on("agent_end", (event, ctx) => {
		if (ctx.mode !== "tui") return;
		const last = [...event.messages].reverse().find((m: any) => m.role === "assistant") as any;
		if (!last || last.stopReason === "error" || last.stopReason === "aborted") return void show(undefined);
		turns += 1;
		const stats = acceptance(read());
		// 被采用得很少就降低频率：每三个回合才猜一次，省下没有用的调用
		if (stats.rate !== undefined && stats.rate < 0.1 && turns % 3 !== 0) return void show(undefined);
		const mine = ++generation;
		void predict(ctx, mine);
	});

	async function predict(ctx: ExtensionContext, mine: number) {
		try {
			const { recent, typed } = conversation(ctx);
			if (!recent) return;
			const log = read();
			const accepted = log.filter((e) => e.outcome === "accepted").slice(-config.examples).map((e) => e.suggestion);
			const actual = [...typed, ...log.filter((e) => e.outcome === "ignored" && e.typed).slice(-config.examples).map((e) => e.typed as string)].slice(-config.examples * 2);
			const prompt = `${recent}\n\n${accepted.length ? `用户采用过的预测：\n${accepted.map((a) => `- ${a}`).join("\n")}\n\n` : ""}${actual.length ? `用户实际打的字：\n${actual.map((a) => `- ${a}`).join("\n")}\n\n` : ""}他下一句最可能说什么？`;
			const result = await runMini(ctx, { atom: config.model, system: SYSTEM, prompt, maxTurns: 1 });
			const next = clean(result.text);
			// 回来得太晚（用户已经开始打字或又发了消息）就丢掉
			if (mine !== generation || ctx.ui.getEditorText() !== "") return;
			if (!next) return;
			show(next);
			write({ outcome: "shown", suggestion: next });
		} catch {
			// 预测失败时什么都不显示，不打扰用户
		}
	}

}
