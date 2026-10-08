import { afterAll, expect, test } from "bun:test";
import { dirname, join } from "node:path";
import { cleanupFirecodeModules, firecodeModulePath, PI_CODING_AGENT_URL } from "./loader.ts";
const { DefaultResourceLoader, SettingsManager } = await import(PI_CODING_AGENT_URL);
afterAll(cleanupFirecodeModules);

test("real Pi loads the package as one extension that exposes tools and shortcuts, never slash commands", async () => {
	const directory = dirname(await firecodeModulePath("index.ts", {
		configJsonc: JSON.stringify({
			features: { header: false, statusbar: false, tools: false, rename: true,
				claudeSub: false, openaiNative: true, review: true, master: false },
			review: {
				advisor: { model: "test/advisor/high" },
				reviewers: [{ model: "test/reviewer/medium" }],
			},
		}),
	}));
	const agentDir = join(directory, "agent");
	const loader = new DefaultResourceLoader({ cwd: agentDir, agentDir,
		settingsManager: SettingsManager.inMemory({ packages: [directory] }),
		noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true });
	await loader.reload();
	const result = loader.getExtensions();
	expect(result.errors).toEqual([]);
	expect(result.extensions).toHaveLength(1);
	const [extension] = result.extensions;
	expect(extension.path).toBe(join(directory, "index.ts"));
	expect([...extension.commands.keys()]).toEqual([]);
	expect([...extension.tools.keys()]).toEqual(expect.arrayContaining(["review"]));
	expect([...extension.shortcuts.keys()]).not.toContain("ctrl+r");
	expect([...extension.flags.keys()]).toEqual(["verbosity"]);
	expect(extension.handlers.get("before_provider_request")).toHaveLength(2);
});
