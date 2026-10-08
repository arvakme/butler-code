/** 纠错本的解析和压缩（纯逻辑，没有任何依赖，方便单独测）。 */

/** 一条一条的规则：以 `- ` 开头，后面缩进的行算同一条；到“项目条目格式”那一节为止（那是写给人看的格式说明）。 */
export function entries(markdown: string): string[] {
	const out: string[] = [];
	let current: string | undefined;
	for (const line of markdown.split("\n")) {
		if (/^##\s*项目条目格式/.test(line)) break;
		if (/^- /.test(line)) out.push((current = line.trim()));
		else if (current !== undefined && /^\s+\S/.test(line)) out[out.length - 1] = current = `${current} ${line.trim()}`;
		else current = undefined;
	}
	return out;
}

/** 文件开头的 YAML 头（和技能的 SKILL.md 一样）：取 description，可以是一行，也可以是 `>` 或 `|` 折起来的几行 */
export function describe(markdown: string): string {
	const head = /^---\n([\s\S]*?)\n---/.exec(markdown)?.[1];
	if (!head) return "";
	const lines = head.split("\n");
	const at = lines.findIndex((l) => /^description:/.test(l));
	if (at < 0) return "";
	const first = lines[at].replace(/^description:\s*/, "").trim();
	const rest: string[] = [];
	for (let i = at + 1; i < lines.length && /^\s+\S/.test(lines[i]); i++) rest.push(lines[i].trim());
	return [first && !/^[>|][+-]?$/.test(first) ? first : "", ...rest].filter(Boolean).join(" ");
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

export type Source = { label: string; path: string; text: string };

/** 放进系统提示的那一段，像技能的目录：每本纠错本给一句 description 和每条规则的开头一行，细节在文件里，需要时自己去读。
 *  mode "index"（默认）：每条只留开头；mode "full"：放得下就全文。都放不下时留最新的几条并写明全文在哪。 */
export function lessonsSection(sources: Source[], maxChars: number, mode: "index" | "full" = "index"): string {
	const parts = sources.map((s) => ({ ...s, list: entries(s.text) })).filter((s) => s.list.length > 0);
	if (parts.length === 0) return "";
	const head = "用户的纠错本：下面这些是 agent 以前被用户打回过的错误，每条只列了开头。不用提醒就照着做，交付前逐条对照；某条的来龙去脉或检查方法不够清楚时，去读它所在的文件。用户说“记到纠错本”“记一下这个教训”时，调用 lesson 工具来记，不要自己去改文件。";
	const render = (list: (typeof parts)[number]["list"], s: (typeof parts)[number], note = "") => `【${s.label}】${s.path}${note}${describe(s.text) ? `\n说明：${describe(s.text)}` : ""}\n${list.join("\n")}`;
	const build = (pick: (s: (typeof parts)[number]) => { list: string[]; note: string }) => [head, ...parts.map((s) => { const p = pick(s); return render(p.list, s, p.note); })].join("\n\n");
	if (mode === "full") {
		const whole = build((s) => ({ list: s.list, note: "" }));
		if (whole.length <= maxChars) return whole;
	}
	let text = build((s) => ({ list: s.list.map((e) => clip(e, 160)), note: "（每条只列开头，全文在这个文件里）" }));
	if (text.length <= maxChars) return text;
	// 还放不下：每个来源平分剩下的位置，留最新的（文件是只追加的，新的在后面）
	const budget = Math.max(400, Math.floor((maxChars - head.length) / parts.length) - 200);
	return build((s) => {
		const short = s.list.map((e) => clip(e, 160));
		const kept: string[] = [];
		let used = 0;
		for (let i = short.length - 1; i >= 0 && used + short[i].length + 1 <= budget; i--) (kept.unshift(short[i]), (used += short[i].length + 1));
		return { list: kept, note: `（共 ${s.list.length} 条，这里只列最新的 ${kept.length} 条，全文在这个文件里，需要时去读）` };
	});
}

/** 下一个编号：已有的 `**P3` / `**G12` 里最大的加一 */
export function nextNumber(markdown: string, letter: "P" | "G"): number {
	let max = 0;
	for (const m of markdown.matchAll(new RegExp(`\\*\\*${letter}(\\d+)`, "g"))) max = Math.max(max, Number(m[1]));
	return max + 1;
}
