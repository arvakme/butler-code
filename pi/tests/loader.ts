/**
 * 在测试里加载 FireCode 模块：扩展运行时由 pi 注入 `@earendil-works/*`，
 * 测试环境没有这层注入，因此把整个插件目录复制到临时目录并把包名改写到已安装的 Pi（或显式指定的源码）。
 */
import { existsSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { delimiter, dirname, extname, join, relative, sep } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

export const FIRECODE_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const SOURCE_DIR = FIRECODE_DIR;

function piHostEntries(): { codingAgent: string; ai: string; compat: string; tui: string } {
	if (process.env.PI_PACKAGES_DIR) {
		const root = process.env.PI_PACKAGES_DIR;
		const entries = { codingAgent: join(root, "coding-agent/src/index.ts"), ai: join(root, "ai/src/index.ts"),
			compat: join(root, "ai/src/compat.ts"), tui: join(root, "tui/src/index.ts") };
		for (const path of Object.values(entries)) if (!existsSync(path)) throw new Error(`Pi source entry missing: ${path}`);
		return entries;
	}
	for (const directory of (process.env.PATH ?? "").split(delimiter)) {
		const executable = join(directory, process.platform === "win32" ? "pi.exe" : "pi");
		if (!existsSync(executable)) continue;
		const resolved = realpathSync(executable);
		let root = dirname(resolved);
		while (dirname(root) !== root) {
			const manifest = join(root, "package.json");
			if (existsSync(manifest) && JSON.parse(readFileSync(manifest, "utf8")).name === "@earendil-works/pi-coding-agent") {
				// Bun resolves import-only package exports against the installed host dependencies.
				const resolve = (name: string) => Bun.resolveSync(name, root);
				const codingAgent = join(root, "dist/index.js");
				if (existsSync(codingAgent)) return { codingAgent, ai: resolve("@earendil-works/pi-ai"),
					compat: resolve("@earendil-works/pi-ai/compat"), tui: resolve("@earendil-works/pi-tui") };
				const packages = dirname(root);
				if (existsSync(join(root, "src/index.ts"))) return { codingAgent: join(root, "src/index.ts"),
					ai: join(packages, "ai/src/index.ts"), compat: join(packages, "ai/src/compat.ts"), tui: join(packages, "tui/src/index.ts") };
			}
			root = dirname(root);
		}
	}
	throw new Error("Cannot locate Pi host: install pi on PATH or set PI_PACKAGES_DIR to a working pi-mono packages directory");
}

const host = piHostEntries();
export const PI_CODING_AGENT_URL = pathToFileURL(host.codingAgent).href;
const PI_CODING_AGENT = PI_CODING_AGENT_URL;
export const PI_AI_URL = pathToFileURL(host.ai).href;
export const PI_AI_COMPAT_URL = pathToFileURL(host.compat).href;
const PI_AI = PI_AI_URL;
const PI_TUI = pathToFileURL(host.tui).href;

/** 同一份配置与改写只复制一次仓库：复制是测试耗时的大头（每次数百个文件）。进程退出时统一删除。 */
const copies = new Map<string, Promise<string>>();
process.on("exit", () => {
	for (const directory of shared) rmSync(directory, { recursive: true, force: true });
});
const shared: string[] = [];
const NON_RUNTIME_ROOTS = new Set([".git", "docs", "tests"]);
export const TEST_REVIEW_CONFIG = {
	advisor: "test/advisor/high",
	reviewers: ["test/reviewer/high"],
	maxRounds: 3,
	advisorAfterFailures: 2,
	timeoutMinutes: 1,
	tools: ["read", "bash"],
	language: "zh",
};
const TEST_CONFIG_JSONC = JSON.stringify({
	features: {
		header: true,
		statusbar: true,
		tools: true,
		rename: true,
		claudeSub: false,
		openaiNative: false,
		userMessage: true,
		links: true,
		review: true,
		master: false,
	},
	review: TEST_REVIEW_CONFIG,
});

async function copyFirecodeSource(destination: string): Promise<void> {
	await cp(SOURCE_DIR, destination, {
		recursive: true,
		filter: (source) => {
			const path = relative(SOURCE_DIR, source);
			const [root] = path.split(sep);
			if (NON_RUNTIME_ROOTS.has(root)) return false;
			if (![".md", ".mdx"].includes(extname(path))) return true;
			return path.startsWith(`master${sep}prompts${sep}`)
				|| path.startsWith(`review${sep}prompts${sep}`);
		},
	});
}

async function rewriteImports(directory: string): Promise<void> {
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) {
			await rewriteImports(path);
			continue;
		}
		if (!entry.name.endsWith(".ts")) continue;
		const source = (await readFile(path, "utf8"))
			.replaceAll('"@earendil-works/pi-coding-agent"', JSON.stringify(PI_CODING_AGENT))
			.replaceAll('"@earendil-works/pi-ai"', JSON.stringify(PI_AI))
			.replaceAll('"@earendil-works/pi-tui"', JSON.stringify(PI_TUI));
		await writeFile(path, source);
	}
}

/**
 * 加载插件内某个模块，例如 `tools/index.ts`、`session/rename.ts`。
 * `configJsonc` 可覆写或移除测试 Agent 目录里的运行配置，用于验证配置边界。
 */
/** 与 loadFirecodeModule 同一份副本里某个模块的绝对路径：供测试写进子会话扩展文件，让子会话加载同一份代码。 */
export async function firecodeModulePath(
	entry: string,
	options: { configJsonc?: string | null; replacements?: Record<string, string>; extraFiles?: Record<string, string> } = {},
): Promise<string> {
	return join(await copyFor(entry, options), entry);
}

export async function loadFirecodeModule(
	entry: string,
	options: {
		configJsonc?: string | null;
		replacements?: Record<string, string>;
		extraFiles?: Record<string, string>;
	} = {},
): Promise<Record<string, unknown>> {
	const directory = await copyFor(entry, options);
	return import(`${pathToFileURL(join(directory, entry)).href}?test=${Date.now()}-${Math.random()}`);
}

function copyFor(
	entry: string,
	options: { configJsonc?: string | null; replacements?: Record<string, string>; extraFiles?: Record<string, string> },
): Promise<string> {
	const sourceEntry = entry.endsWith(".js") ? `${entry.slice(0, -3)}.ts` : entry;
	// undefined（默认测试配置）与 null（没有运行配置）必须分开：JSON 会把两者都写成 null。
	const config = options.configJsonc === undefined ? { default: true } : { text: options.configJsonc };
	const key = JSON.stringify([config, options.extraFiles, options.replacements && [sourceEntry, options.replacements]]);
	let copy = copies.get(key);
	if (!copy) copies.set(key, copy = prepareCopy(sourceEntry, options));
	return copy;
}

async function prepareCopy(
	sourceEntry: string,
	options: { configJsonc?: string | null; replacements?: Record<string, string>; extraFiles?: Record<string, string> },
): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), "firecode-test-"));
	shared.push(directory);
	await copyFirecodeSource(directory);
	const agentDir = join(directory, "agent");
	const configDir = join(agentDir, "extensions", "butler-ui");
	await mkdir(configDir, { recursive: true });
	if (options.configJsonc !== null) {
		const configJsonc = options.configJsonc ?? TEST_CONFIG_JSONC;
		await writeFile(join(configDir, "config.jsonc"), configJsonc);
	}
	for (const [path, content] of Object.entries(options.extraFiles ?? {})) {
		const destination = join(directory, path);
		await mkdir(dirname(destination), { recursive: true });
		await writeFile(destination, content);
	}
	await rewriteImports(directory);
	const configModule = join(directory, "config.ts");
	const getAgentDirImport = `import { getAgentDir } from ${JSON.stringify(PI_CODING_AGENT)};`;
	const configSource = await readFile(configModule, "utf8");
	if (!configSource.includes(getAgentDirImport)) throw new Error("FireCode config path seam changed");
	await writeFile(
		configModule,
		configSource.replace(getAgentDirImport, `const getAgentDir = () => ${JSON.stringify(agentDir)};`),
	);
	for (const [oldText, newText] of Object.entries(options.replacements ?? {})) {
		const path = join(directory, sourceEntry);
		await writeFile(path, (await readFile(path, "utf8")).replace(oldText, newText));
	}
	return directory;
}

/** 副本按配置共享、进程退出才删；保留这个钩子让各用例的 afterEach 写法不变。 */
export async function cleanupFirecodeModules(): Promise<void> {}

export const PI_TUI_URL = PI_TUI;

/** 注册入口测试只开启指定功能，其余开关从运行配置的唯一功能清单派生。 */
export async function featuresOnly(...enabled: string[]): Promise<Record<string, boolean>> {
	const { FEATURES } = await loadFirecodeModule("config.ts") as { FEATURES: readonly string[] };
	return Object.fromEntries(FEATURES.map((feature) => [feature, enabled.includes(feature)]));
}

/** 假主题的具体颜色：每个令牌按名字确定一个 RGB，火苗、光晕等按主题取色的动效在假主题上也能渲染。 */
export const FAKE_THEME_COLORS: Record<string, { kind: "rgb"; r: number; g: number; b: number }> = new Proxy({}, {
	get: (_target, token) => {
		const code = [...String(token)].reduce((sum, char) => sum + char.charCodeAt(0), 0);
		return { kind: "rgb", r: code % 256, g: (code * 7) % 256, b: (code * 13) % 256 };
	},
});
