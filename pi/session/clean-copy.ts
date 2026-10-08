/** 干净的复制：Pi 全屏模式自己管鼠标选择，复制的是屏幕上每一行的原样文字再用换行连起来——
 *  它不知道左边的竖条（用户消息的 `▎`）是装饰，也不知道哪些换行是自动折行，所以长路径、网址折成两行后，
 *  复制出来带着竖条和一个多余的换行，粘贴到浏览器里就打不开。这里接管取字的那一步：
 *  1. 每一行开头的 `▎` 去掉；
 *  2. 上一行写满了整个屏宽（自动折行，不是作者自己换的行）就和下一行直接接起来，不加换行。
 *  只改取出来的文字，不改屏幕上的显示、也不改选择本身。宿主以后换了写法（找不到方法、行数对不上）就保持原样。 */
import { stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";

const MARK = Symbol.for("butler.clean-copy");
const GUTTER = /^ *▎ ?/;
/** 一行写到离屏宽这么近就当作写满了：中文折行会差一列，右边可能还有滚动条占一列 */
const SLACK = 3;

/** 一行写到离屏宽的六成以上，才可能是一段话里被渲染器按词折行的一行；更短的是标题、短句或作者自己的换行 */
const SOFT_RATIO = 0.6;
/** 看不见或看着像空格的字符：不换行空格、窄不换行空格、零宽空格/连接符、词连接符、BOM */
const ODD_SPACE = /[\u00a0\u202f\u2007]/g;
const INVISIBLE = /[\u200b-\u200d\u2060\ufeff]/g;
/** 下一行是新的一块（列表、标题、引用、表格、代码围栏、缩进），不是上一行的续行 */
const BLOCK_START = /^(?:[-*+•] |\d+[.)] |#{1,6} |> |\||```|~~~| {2,}|\t)/;
/** 上一行像代码：结尾是 { } ; , ( 之类，或含有典型的赋值/箭头/调用写法 */
const CODE_LIKE = /(?:[{};(\[]$|=>|==|;\s|\w\(.*\)\s*\{?$)/;
/** 上一行以句号、问号、冒号等结尾：这句话写完了，换行保留 */
const SENTENCE_END = /[。！？；：.!?;:]$/;
const CJK = /[\u3000-\u303f\u3400-\u9fff\uf900-\ufaff\uff00-\uffef]/;

const tidy = (text: string) => text.replace(ODD_SPACE, " ").replace(INVISIBLE, "").replace(/[ \t]+$/, "");

/** rows：选中的每一行的文字，以及它在屏幕上完整一行（不只是选中的部分）有多宽。规则：
 *  - 开头的 `▎` 去掉；怪空格变普通空格，零宽字符去掉，行尾空格去掉；作者自己打在中间的空格保留；
 *  - 上一行写满屏宽（终端硬折行）：直接接上，不加空格；
 *  - 上一行有六成以上宽、没有写完一句、不像代码，下一行也不是新的一块：按词折行，接上（中文之间不加空格，其余加一个）；
 *  - 其余都保留换行，空行不接。 */
export function cleanSelection(rows: { text: string; full: number }[], columns: number): string {
	let out = "";
	let previous: { text: string; full: number } | undefined;
	let previousSpaced = false; // 上一行原文末尾本来就有个空格（按词硬折行时，折行吃掉的那个空格）
	rows.forEach((row, i) => {
		const text = tidy(row.text.replace(GUTTER, ""));
		let glue: "" | " " | "\n" = "\n";
		if (i > 0 && previous !== undefined && previous.text !== "" && text !== "") {
			if (previous.full >= columns - SLACK) glue = previousSpaced ? " " : "";
			else if (columns > 0 && previous.full >= columns * SOFT_RATIO && !SENTENCE_END.test(previous.text) && !CODE_LIKE.test(previous.text) && !BLOCK_START.test(text)) {
				glue = CJK.test(previous.text.slice(-1)) || CJK.test(text.charAt(0)) ? "" : " ";
			}
		}
		out += i === 0 ? text : glue + text;
		previous = { text, full: row.full };
		previousSpaced = / $/.test(row.text);
	});
	return out;
}

type Fullscreen = {
	getActiveSelectionText?: () => string | undefined;
	getSelectionColumns?: (...args: unknown[]) => unknown;
	terminal?: { columns?: number };
	[MARK]?: boolean;
};

/** 装到全屏界面上；返回还原的函数。非全屏（没有这些方法）就什么也不做。 */
export function installCleanCopy(tui: unknown): () => void {
	const target = tui as Fullscreen;
	const proto = Object.getPrototypeOf(target) as Fullscreen | null;
	if (!proto || typeof proto.getActiveSelectionText !== "function" || typeof proto.getSelectionColumns !== "function" || target[MARK]) return () => {};
	const original = proto.getActiveSelectionText;
	const columnsOf = proto.getSelectionColumns;
	const patched = function (this: Fullscreen): string | undefined {
		const widths: number[] = [];
		// 原来的取字函数每选中一行就会问一次这一行取哪几列：趁机记下这一行完整有多宽
		this.getSelectionColumns = (line: unknown, ...rest: unknown[]) => {
			widths.push(visibleWidth(stripTerminalSequences(String(line)).trimEnd()));
			return columnsOf.call(this, line, ...rest);
		};
		let text: string | undefined;
		try {
			text = original.call(this);
		} finally {
			delete this.getSelectionColumns;
		}
		if (text === undefined) return text;
		const lines = text.split("\n");
		if (lines.length !== widths.length) return text;
		return cleanSelection(lines.map((t, i) => ({ text: t, full: widths[i] })), this.terminal?.columns ?? 0) || undefined;
	};
	target.getActiveSelectionText = patched;
	target[MARK] = true;
	return () => {
		if (target.getActiveSelectionText === patched) delete target.getActiveSelectionText;
		delete target[MARK];
	};
}
