// 复制的取字逻辑：纯逻辑，输入输出能列出来（竖条、折行、空行），所以用快速检查；真实终端里的复制另有端到端。
import { afterAll, expect, test } from "bun:test";
import { cleanupFirecodeModules, loadFirecodeModule } from "./loader.ts";
afterAll(cleanupFirecodeModules);

test("copying a path that wrapped keeps it in one piece and drops the user-message bar", async () => {
	const { cleanSelection } = await loadFirecodeModule("session/clean-copy.ts");
	const columns = 100;
	const rows = [
		{ text: "  ▎ /opt/demo-app/.config/butler-code/notebook/artifacts/delivery-verify/verify-video-prototype/round-01/feedback-receipts/", full: 99 },
		{ text: "  ▎ 9e1932e9-aa42-46f0-84d0-0f45f85f3fbe.json", full: 46 },
	];
	expect(cleanSelection(rows, columns)).toBe("/opt/demo-app/.config/butler-code/notebook/artifacts/delivery-verify/verify-video-prototype/round-01/feedback-receipts/9e1932e9-aa42-46f0-84d0-0f45f85f3fbe.json");
	// 选中的是半行（从中间开始）：本来就没有竖条，不会多删
	expect(cleanSelection([{ text: "tory/round-01/", full: 99 }, { text: "  ▎ file.json", full: 30 }], columns)).toBe("tory/round-01/file.json");
});

test("real line breaks stay, wrapped ones are joined, blank lines are kept", async () => {
	const { cleanSelection } = await loadFirecodeModule("session/clean-copy.ts");
	const columns = 80;
	expect(cleanSelection([{ text: "第一行", full: 6 }, { text: "第二行", full: 6 }], columns)).toBe("第一行\n第二行"); // 没写满屏宽：是作者自己换的行
	expect(cleanSelection([{ text: "中文自动折行到这里为止，", full: 78 }, { text: "接着往下", full: 8 }], columns)).toBe("中文自动折行到这里为止，接着往下"); // 差一两列也算写满
	expect(cleanSelection([{ text: "a".repeat(80), full: 80 }, { text: "", full: 0 }, { text: "b", full: 1 }], columns)).toBe(`${"a".repeat(80)}\n\nb`); // 空行不接
	expect(cleanSelection([{ text: "单独一行", full: 8 }], columns)).toBe("单独一行");
	expect(cleanSelection([], columns)).toBe("");
});

test("installing patches only the instance, reads the row widths, and restores", async () => {
	const { installCleanCopy } = await loadFirecodeModule("session/clean-copy.ts");
	const rows = ["  ▎ " + "x".repeat(96), "  ▎ tail"];
	class Fake {
		terminal = { columns: 100 };
		getSelectionColumns(line: string) { return { start: 0, end: line.length }; }
		getActiveSelectionText() {
			return rows.map((line) => { this.getSelectionColumns(line); return line.trimEnd(); }).join("\n");
		}
	}
	const tui = new Fake();
	const restore = installCleanCopy(tui);
	expect(tui.getActiveSelectionText()).toBe(`${"x".repeat(96)}tail`);
	expect(Object.prototype.hasOwnProperty.call(tui, "getSelectionColumns")).toBeFalse(); // 临时替换的方法用完就撤掉
	restore();
	expect(tui.getActiveSelectionText()).toBe(`  ▎ ${"x".repeat(96)}\n  ▎ tail`); // 还原成宿主原来的行为
	expect(installCleanCopy({})).toBeInstanceOf(Function); // 不是全屏界面就什么也不做
});

test("a paragraph that Pi wrapped at word boundaries is joined with one space (none between Chinese characters)", async () => {
	const { cleanSelection } = await loadFirecodeModule("session/clean-copy.ts");
	const columns = 80;
	// 按词折行：上一行没有写满，右边参差不齐，但够长，说明是一段话里的折行
	expect(cleanSelection([{ text: "This is a long paragraph that was word wrapped by the", full: 54 }, { text: "renderer and continues here", full: 27 }], columns)).toBe("This is a long paragraph that was word wrapped by the renderer and continues here");
	expect(cleanSelection([{ text: "这是一段很长的中文说明，在渲染的时候被自动折成了两行显示出来而且", full: 66 }, { text: "后面还有内容", full: 12 }], columns)).toBe("这是一段很长的中文说明，在渲染的时候被自动折成了两行显示出来而且后面还有内容");
	expect(cleanSelection([{ text: "A line of text that is long enough to count as wrapped for sure,", full: 65 }, { text: "then a third", full: 12 }, { text: "short one", full: 9 }], columns)).toBe("A line of text that is long enough to count as wrapped for sure, then a third\nshort one"); // 第二行不长，不再往下接
});

test("spaces the author typed stay, odd invisible spaces go", async () => {
	const { cleanSelection } = await loadFirecodeModule("session/clean-copy.ts");
	const columns = 80;
	expect(cleanSelection([{ text: "name  value   other", full: 19 }], columns)).toBe("name  value   other"); // 中间本来就有的空格保留
	expect(cleanSelection([{ text: "a b​c﻿d⁠e", full: 5 }], columns)).toBe("a bcde"); // 不换行空格变普通空格，零宽字符去掉
	expect(cleanSelection([{ text: "行尾有空格   ", full: 12 }, { text: "下一行", full: 6 }], columns)).toBe("行尾有空格\n下一行"); // 行尾空格去掉
	expect(cleanSelection([{ text: "x".repeat(80) + " ", full: 81 }, { text: "tail", full: 4 }], columns)).toBe(`${"x".repeat(80)}tail`); // 满行硬折行后面的怪空格也不残留
});

test("lists, headings, code, quotes and finished sentences are never glued together", async () => {
	const { cleanSelection } = await loadFirecodeModule("session/clean-copy.ts");
	const columns = 80;
	const long = "This line is long enough to look like the middle of a wrapped paragraph ok";
	const full = 74;
	for (const next of ["- a list item", "* another", "1. numbered", "# heading", "> quote", "| a | b |", "    indented code", "```", "  hanging"]) {
		expect(cleanSelection([{ text: long, full }, { text: next, full: next.length }], columns)).toBe(`${long}\n${next}`);
	}
	expect(cleanSelection([{ text: "const longVariableName = someFunction(argumentNumberOne, three) {", full: 66 }, { text: "return 1;", full: 9 }], columns)).toContain("\n"); // 像代码的行不接
	expect(cleanSelection([{ text: "这一句话已经写完了，后面是另一句新的话，所以这里的换行应当保留下来不要接上。", full: 76 }, { text: "下一句", full: 6 }], columns)).toBe("这一句话已经写完了，后面是另一句新的话，所以这里的换行应当保留下来不要接上。\n下一句"); // 以句号结尾：保留换行
});

test("a hard wrap that swallowed a real space keeps that one space", async () => {
	const { cleanSelection } = await loadFirecodeModule("session/clean-copy.ts");
	expect(cleanSelection([{ text: `${"x".repeat(78)} `, full: 78 }, { text: "tail", full: 4 }], 80)).toBe(`${"x".repeat(78)} tail`);
});
