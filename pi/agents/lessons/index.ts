/** lessons：纠错本自动进系统提示，agent 不用被提醒就照着做；用户说“记到纠错本”时有现成的工具来记。
 *  纠错本有两本：全局的（delivery-verify 的通用错题，所有项目共用）和当前项目的（`.agents/acceptance/common-mistakes.md`，往上找到最近的一份）。
 *  以前只在技能文字里写着“要去读”，全靠模型自觉，经常被忽略；现在每次运行前都把它放进系统提示里，不靠自觉。 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, parse } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { LessonsConfig } from "../config.js";
import { lessonsSection, nextNumber } from "./text.js";

const GLOBAL = join(homedir(), ".config/butler-code/skills/engineering/delivery-verify/references/common-mistakes.md");
const PROJECT = join(".agents", "acceptance", "common-mistakes.md");

const read = (path: string) => (existsSync(path) ? readFileSync(path, "utf8") : "");
/** 从 dir 往上找：先找已有的纠错本，没有就找 git 根目录（新建时放那里），再没有就用 dir 自己 */
function projectFile(dir: string): { path: string; exists: boolean } {
	let root: string | undefined;
	for (let at = dir; ; at = dirname(at)) {
		const candidate = join(at, PROJECT);
		if (existsSync(candidate)) return { path: candidate, exists: true };
		if (!root && existsSync(join(at, ".git"))) root = at;
		if (at === parse(at).root || at === homedir()) break;
	}
	return { path: join(root ?? dir, PROJECT), exists: false };
}

/** 子会话只注入纠错本，不给记录工具：它们不和用户对话，用户不会在那里让它记错。 */
export function registerLessons(pi: ExtensionAPI, config: LessonsConfig, subsession: boolean): void {
	const globalFile = config.globalFile ?? GLOBAL;

	pi.on("before_agent_start", (event, ctx) => {
		const project = projectFile(ctx.cwd);
		const text = lessonsSection(
			[
				{ label: "全局纠错本，所有项目通用", path: globalFile, text: read(globalFile) },
				{ label: "本项目的纠错本", path: project.path, text: project.exists ? read(project.path) : "" },
			],
			config.maxChars,
			config.mode,
		);
		if (text) event.systemPromptOptions.sections = { ...event.systemPromptOptions.sections, lessons: text };
	});
	if (subsession) return;

	pi.registerTool({
		name: "lesson",
		label: "纠错本",
		description: "Record one mistake in the user's notebook of mistakes, so that no agent repeats it. Call it when the user asks you to note a mistake or lesson (\"记到纠错本\", \"记一下这个教训\") or rejects your work for a reason that will recur. scope \"project\" (default) appends to this project's notebook (.agents/acceptance/common-mistakes.md); \"global\" appends to the shared list for every project. Write `rule` as what went wrong and `check` as a concrete action the next run can do to verify it, not a feeling. Never edit the notebook files by hand.",
		promptSnippet: "lesson: record a mistake in the user's notebook (project or global) in the right format",
		promptGuidelines: ["When the user asks you to record a mistake, lesson or rule in the notebook of mistakes, call the lesson tool instead of editing files yourself."],
		parameters: Type.Object({
			rule: Type.String({ description: "What went wrong, one or two sentences" }),
			check: Type.String({ description: "A concrete action that verifies it next time" }),
			scope: Type.Optional(Type.Union([Type.Literal("project"), Type.Literal("global")], { description: "project (default) or global" })),
		}),
		execute: async (_id, params, _signal, _update, ctx) => {
			const reply = (text: string) => ({ content: [{ type: "text" as const, text }], details: undefined });
			const rule = params.rule.replace(/\s+/g, " ").trim();
			const check = params.check.replace(/\s+/g, " ").trim();
			if (!rule || !check) return reply("rule 和 check 都要写：错在哪，下次怎么检查。");
			const today = new Date().toISOString().slice(0, 10);
			if (params.scope === "global") {
				const text = read(globalFile);
				const id = `G${nextNumber(text, "G")}`;
				const entry = `- **${id} ${rule}**\n  检查：${check}`;
				const at = text.search(/^## 项目条目格式/m);
				const next = at < 0 ? `${text.trimEnd()}\n${entry}\n` : `${text.slice(0, at).trimEnd()}\n${entry}\n\n${text.slice(at)}`;
				writeFileSync(globalFile, next);
				return reply(`已记入全局纠错本：${id}（${globalFile}）。`);
			}
			const file = projectFile(ctx.cwd);
			const text = file.exists ? read(file.path) : "---\nname: common-mistakes\ndescription: 本项目被打回过的问题，每条是“错在哪 + 下次怎么检查”。动手前先对照，条目只追加不改写。\n---\n\n# 常见错误\n\n";
			const id = `P${nextNumber(text, "P")}`;
			mkdirSync(dirname(file.path), { recursive: true });
			writeFileSync(file.path, `${text.trimEnd()}\n- **${id} · ${today}** ${rule}\n  检查：${check}\n`);
			return reply(`已记入本项目纠错本：${id}（${file.path}）。`);
		},
	});
}
