import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, test } from "bun:test";
import { cleanupFirecodeModules, FIRECODE_DIR, loadFirecodeModule, featuresOnly } from "./loader.ts";
import { fakePi } from "./fake-pi.ts";

afterEach(cleanupFirecodeModules);

test("missing runtime config disables optional behavior and warns on each session_start", async () => {
	const { default: registerFirecode } = await loadFirecodeModule("index.ts", { configJsonc: null });
	const fake = fakePi();

	(registerFirecode as (pi: unknown) => void)(fake.pi);

	expect([...fake.commands.keys()]).toEqual([]);
	expect([...fake.shortcuts.keys()]).toEqual([]);
	expect([...fake.tools.keys()]).toEqual([]);
	expect([...fake.messageRenderers.keys()]).toEqual(["firecode-review-card", "butler-result"]);
	const warnings: string[] = [];
	for (let occurrence = 0; occurrence < 2; occurrence++)
		await fake.fire("session_start", {}, { ui: { notify: (message: string) => warnings.push(message) }, sessionManager: { getBranch: () => [] } });
	expect(warnings).toEqual([
		"Butler 配置有问题：config.jsonc 不存在，已关闭可选功能",
		"Butler 配置有问题：config.jsonc 不存在，已关闭可选功能",
	]);
});

test("runtime config enables only rename behavior: no commands, tools or shortcuts", async () => {
	const configJsonc = JSON.stringify({ features: await featuresOnly("rename") });
	const { default: registerFirecode } = await loadFirecodeModule("index.ts", { configJsonc });
	const fake = fakePi();
	(registerFirecode as (pi: unknown) => void)(fake.pi);

	expect([...fake.entryRenderers.keys()]).toEqual([]);
	expect([...fake.commands.keys()]).toEqual([]);
	expect([...fake.tools.keys()]).toEqual([]);
	expect([...fake.shortcuts.keys()]).toEqual([]);
});

test("Master 角色对象严格解析原子与 fallback", async () => {
	const { parseMasterConfig } = await loadFirecodeModule("config.ts") as any;
	const validProblems: string[] = [];
	const parsed = parseMasterConfig({
		roles: {
			工程师: { model: "test/shared/medium", use: "实现", fallback: ["test/backup/high"] },
			哨兵: { model: "test/shared/low", use: "盯守" },
		},
	}, validProblems);
	expect(validProblems).toEqual([]);
	expect(parsed.roles).toEqual([
		{
			role: "工程师", model: "test/shared", thinking: "medium", use: "实现",
			fallback: [{ model: "test/backup", thinking: "high" }],
		},
		{ role: "哨兵", model: "test/shared", thinking: "low", use: "盯守", fallback: [] },
	]);

	const problems: string[] = [];
	parseMasterConfig({
		roles: {
			工程师: {
				model: "invalid-model/high", thinking: "medium", use: "旧写法",
				fallback: ["test/a/low", "test/b/low", "test/c/low"],
			},
			哨兵: { model: "test/model/turbo", use: "坏档" },
			调研员: { model: "test/model", use: "漏写思考档" },
		},
	}, problems);
	expect(problems).toContain("未知字段 master.roles.工程师.thinking");
	expect(problems).toContain(
		"master.roles.工程师.model 必须是“provider/model/thinking”字符串（模型段不是 provider/model：invalid-model）",
	);
	expect(problems).toContain("master.roles.哨兵.model 必须是“provider/model/thinking”字符串（思考档无效：turbo）");
	// 两段式旧写法同时踩中两项校验，仍然只报一条并给出目标形状。
	expect(problems).toContain(
		"master.roles.调研员.model 必须是“provider/model/thinking”字符串（模型段不是 provider/model：test；思考档无效：model）",
	);
	expect(problems).toContain("master.roles.工程师.fallback 必须是至多 2 项的数组");

	const emptyProblems: string[] = [];
	parseMasterConfig({ roles: {} }, emptyProblems);
	expect(emptyProblems).toContain("master.roles 必须是至少包含一个角色的对象");

	const legacyProblems: string[] = [];
	parseMasterConfig({ models: [{ role: "工程师", model: "test/model/low", use: "旧数组" }] }, legacyProblems);
	expect(legacyProblems).toEqual(["未知字段 master.models"]);
});

test("公共配置模板可解析并启用完整推荐工作流", async () => {
	const configJsonc = await readFile(join(FIRECODE_DIR, "config.example.jsonc"), "utf8");
	const { loadConfig } = await loadFirecodeModule("config.ts", { configJsonc });
	const loaded = (loadConfig as () => { config: any; problems: string[] })();

	expect(loaded.problems).toEqual([]);
	for (const feature of ["openaiNative", "review", "master"])
		expect(loaded.config.features[feature]).toBeTrue();
	expect(loaded.config.features.claudeSub).toBeFalse();
	expect(loaded.config.master.autoActivate).toBeTrue();
	expect(loaded.config.master.roles.map((entry: any) => entry.role)).toEqual(["调研员", "工程师", "杂活"]);

	const { loadConfig: loadAgents } = await loadFirecodeModule("agents/config.ts", { configJsonc }) as any;
	const agents = loadAgents();
	expect(agents.problems).toEqual([]);
	expect(agents.config.features.sentinel).toBeTrue();
	expect(agents.config.sentinel.intervalSeconds).toBe(60);
});

test("tools.replyLines 默认 3，接受非负整数，类型错误与未知字段报配置问题", async () => {
	const load = async (tools: string | undefined) => {
		const configJsonc = tools === undefined ? "{}" : `{ "tools": ${tools} }`;
		const { loadConfig } = await loadFirecodeModule("config.ts", { configJsonc });
		const loaded = (loadConfig as () => { config: any; problems: string[] })();
		await cleanupFirecodeModules();
		return loaded;
	};
	expect((await load(undefined)).config.tools.replyLines).toBe(3);
	expect((await load("{}")).config.tools.replyLines).toBe(3);
	for (const value of [0, 5]) {
		const loaded = await load(`{ "replyLines": ${value} }`);
		expect(loaded.config.tools.replyLines).toBe(value);
		expect(loaded.problems.filter((problem) => problem.startsWith("tools"))).toEqual([]);
	}
	for (const bad of ["-1", "1.5", '"3"', "null"]) {
		const loaded = await load(`{ "replyLines": ${bad} }`);
		expect(loaded.problems).toContain("tools.replyLines 必须是非负整数");
		expect(loaded.config.tools.replyLines).toBe(3);
	}
	expect((await load('{ "replyLine": 2 }')).problems).toContain("未知字段 tools.replyLine");
	expect((await load("[]")).problems).toContain("tools 必须是对象");
});

test("功能关闭时它那一节的配置错误不全局警告；开启时照常警告", async () => {
	const warningsFor = async (master: boolean) => {
		const configJsonc = JSON.stringify({
			features: { ...(await featuresOnly()), master },
			master: { roles: { 工程师: { model: "bad", use: "坏原子" } } },
		});
		const { default: registerFirecode } = await loadFirecodeModule("index.ts", { configJsonc });
		const fake = fakePi();
		(registerFirecode as (pi: unknown) => void)(fake.pi);
		const warnings: string[] = [];
		await fake.fire("session_start", {}, { ui: { notify: (message: string) => warnings.push(message) }, sessionManager: { getBranch: () => [] } });
		await cleanupFirecodeModules();
		return warnings.filter((message) => message.includes("master.roles"));
	};
	expect(await warningsFor(false)).toEqual([]);
	expect(await warningsFor(true)).not.toEqual([]);
});
