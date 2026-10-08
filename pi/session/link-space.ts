/** 链接和路径后面直接跟中文标点（“…report.html。报告里…”）时，终端会把标点和后面的字也算进链接，点开就是错的。
 *  这里在 Pi 渲染 Markdown 之前，给“网址或绝对路径”和紧跟着的全角标点之间补一个空格，链接就在该断的地方断开。
 *  只改显示用的文字：代码块和行内代码不动；紧跟着汉字（没有标点）的不动（可能是网址本身带的汉字，比如维基的中文条目）；已经有空格的不重复加。 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** 全角标点和弯引号、省略号、破折号：网址和路径里基本不会出现，出现在它们后面就是边界 */
const BOUNDARY = "[\\u3000-\\u303F\\uFF00-\\uFFEF\\u2018-\\u201F\\u2026\\u2014]";
const URL = "https?:\\/\\/[\\x21-\\x7E]+";
const PATH = "(?:file:\\/\\/|~\\/|\\/(?:Users|private|tmp|var|opt|usr|etc|Library|Applications|Volumes|home)\\/)[\\x21-\\x7E]*";
const LINK = new RegExp(`((?:${URL})|(?:${PATH}))(?=${BOUNDARY})`, "g");
/** 代码块和行内代码要原样保留 */
const CODE = /(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`)/g;

export function spaceLinks(markdown: string): string {
	return markdown
		.split(CODE)
		.map((part, i) => (i % 2 === 1 ? part : part.replace(LINK, "$1 ")))
		.join("");
}

export function registerLinkSpace(pi: ExtensionAPI): void {
	// 旧版本的 Pi 没有这个接口：就保持原样，不去猜
	if (typeof pi.registerMarkdownTransformer !== "function") return;
	pi.registerMarkdownTransformer((markdown) => spaceLinks(markdown));
}
