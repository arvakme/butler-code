// 链接后面紧跟中文标点时补空格：纯文字变换，输入输出能列出来，所以用快速检查；真实终端里看到的样子由 tests/link-space.e2e.mjs 验证。
import { expect, test } from "bun:test";
import { spaceLinks } from "../session/link-space.ts";

test("a URL followed by a full-width punctuation mark gets a space before it (the case from the screenshot)", () => {
	expect(spaceLinks("报告地址：\nhttps://box.example.ts.net:8443/delivery/x/round-02/report.html。报告里能回看第 1 轮。")).toBe("报告地址：\nhttps://box.example.ts.net:8443/delivery/x/round-02/report.html 。报告里能回看第 1 轮。");
	expect(spaceLinks("看 https://a.b/c，再看 https://d.e/f；好了（https://g.h/i）。")).toBe("看 https://a.b/c ，再看 https://d.e/f ；好了（https://g.h/i ）。");
});

test("absolute paths and file URLs too", () => {
	expect(spaceLinks("文件在 /opt/demo-app/.config/a/b.md。然后")).toBe("文件在 /opt/demo-app/.config/a/b.md 。然后");
	expect(spaceLinks("放在~/Devs/x/README.md，再看")).toBe("放在~/Devs/x/README.md ，再看");
	expect(spaceLinks("见 file:///tmp/r.html。")).toBe("见 file:///tmp/r.html 。");
});

test("things that must not change", () => {
	const same = [
		"https://zh.wikipedia.org/wiki/中文条目 里有",            // 汉字是网址的一部分（后面不是标点）
		"https://a.b/c 。已经有空格",                               // 已经有空格
		"网址单独一行：\nhttps://a.b/c\n后面是下一行",               // 后面是换行
		"没有链接，只有中文。和/或 这种斜杠不是路径",                // 不是链接
		"```\nurl = 'https://a.b/c。'\n```",                      // 代码块
		"命令是 `curl https://a.b/c。` 然后",                      // 行内代码
	];
	for (const text of same) expect(spaceLinks(text)).toBe(text);
});

test("applies outside code but not inside, in the same message; idempotent", () => {
	const text = "看 https://a.b/c。代码：`https://x.y/z。` 完了 https://d.e/f。";
	const once = spaceLinks(text);
	expect(once).toBe("看 https://a.b/c 。代码：`https://x.y/z。` 完了 https://d.e/f 。");
	expect(spaceLinks(once)).toBe(once);
	expect(spaceLinks("")).toBe("");
});
