// 纠错本的解析和压缩：纯逻辑，输入输出能列出来，所以用快速检查；Pi 里是不是真的照着做了，由 e2e/lessons.e2e.mjs 用真实的模型验证。
import { expect, test } from "bun:test";
import { describe as descriptionOf, entries, lessonsSection, nextNumber } from "../lessons/text.ts";

const global = `# 常见错误清单

每轮验收前通读一遍。

## 通用清单

- **G1 空状态也要测。** 没数据的时候页面不能白屏。
  检查：清空数据再打开。
- **G2 窄屏。** 手机宽度下不能横向滚动。

## 项目条目格式

\`\`\`markdown
- **P3 · 2026-09-25 · C2 打回** 示例，不应该被当成规则。
\`\`\`
`;

test("entries: bullets with their indented continuation lines, and nothing after the format section", () => {
	expect(entries(global)).toEqual(["- **G1 空状态也要测。** 没数据的时候页面不能白屏。 检查：清空数据再打开。", "- **G2 窄屏。** 手机宽度下不能横向滚动。"]);
	expect(entries("")).toEqual([]);
	expect(entries("# 只有标题\n\n一段话，没有列表。")).toEqual([]);
});

test("a short notebook goes in whole, with where each part comes from", () => {
	const text = lessonsSection([{ label: "全局", path: "/g.md", text: global }, { label: "本项目", path: "/p.md", text: "- **P1** 新文件名以 zz- 开头。\n  检查：ls。" }], 5000);
	for (const need of ["纠错本", "lesson 工具", "【全局】/g.md", "G1 空状态也要测", "检查：清空数据再打开", "【本项目】/p.md", "新文件名以 zz- 开头"]) expect(text).toContain(need);
	expect(lessonsSection([], 5000)).toBe("");
	expect(lessonsSection([{ label: "x", path: "/x", text: "没有规则" }], 5000)).toBe("");
});

test("a long notebook is shortened in steps and never exceeds the limit by much, newest entries kept", () => {
	const many = Array.from({ length: 80 }, (_, i) => `- **P${i + 1}** ${"很长的说明".repeat(60)} 编号${i + 1}`).join("\n");
	const mid = lessonsSection([{ label: "本项目", path: "/p.md", text: many }], 20000);
	expect(mid).toContain("每条只列开头");
	expect(mid).toContain("P80");
	const small = lessonsSection([{ label: "本项目", path: "/p.md", text: many }], 3000);
	expect(small.length).toBeLessThanOrEqual(3000 + 400);
	expect(small).toContain("共 80 条");
	expect(small).toContain("P80"); // 最新的在
	expect(small).not.toContain("**P1** "); // 最老的被舍弃
	expect(small).toContain("全文在这个文件里");
});

test("next number is one more than the largest existing", () => {
	expect(nextNumber("- **P1** a\n- **P7 · 日期** b\n- **P3** c", "P")).toBe(8);
	expect(nextNumber("- **G12 x**", "G")).toBe(13);
	expect(nextNumber("", "P")).toBe(1);
	expect(nextNumber("- **G5**", "P")).toBe(1);
});

test("the YAML head works like a skill's: description (one line or folded) is shown as the explanation, and is not mistaken for rules", () => {
	expect(descriptionOf("---\nname: x\ndescription: 一句话说明\n---\n\n- **P1** a")).toBe("一句话说明");
	expect(descriptionOf("---\nname: x\ndescription: >\n  折起来的\n  两行\n---\n- **P1** a")).toBe("折起来的 两行");
	expect(descriptionOf("# 没有头\n\n- **P1** a")).toBe("");
	expect(descriptionOf("---\nname: x\n---\n")).toBe("");
	const withHead = "---\nname: common-mistakes\ndescription: 本项目被打回过的问题，动手前对照。\n---\n\n# 常见错误\n\n- **P1 · 2026-10-01** 新文件名以 zz- 开头。\n  检查：ls。\n";
	expect(entries(withHead)).toEqual(["- **P1 · 2026-10-01** 新文件名以 zz- 开头。 检查：ls。"]);
	const text = lessonsSection([{ label: "本项目", path: "/p.md", text: withHead }], 5000);
	expect(text).toContain("说明：本项目被打回过的问题，动手前对照。");
	expect(text).toContain("新文件名以 zz- 开头");
	expect(text).toContain("每条只列开头"); // 默认是目录式：每条只列开头，细节在文件里
	expect(lessonsSection([{ label: "本项目", path: "/p.md", text: withHead }], 5000, "full")).not.toContain("每条只列开头"); // full：放得下就全文
});
