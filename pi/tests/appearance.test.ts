import { afterAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { cleanupFirecodeModules, loadFirecodeModule, PI_CODING_AGENT_URL, PI_TUI_URL } from "./loader.ts";
import themeJson from "../themes/butler.json";
import darkThemeJson from "../themes/butler-dark.json";

const { TuiAltScreen, visibleWidth } = await import(PI_TUI_URL);
const { DefaultResourceLoader, SettingsManager, Theme } = await import(PI_CODING_AGENT_URL);
afterAll(cleanupFirecodeModules);

test("the startup banner fits every width and keeps the name readable", async () => {
	const { registerHeader } = await loadFirecodeModule("header.ts");
	const colors = Object.fromEntries(Object.entries(themeJson.colors).map(([key, value]) => [key, (themeJson.vars as any)[value] ?? value]));
	const theme = new Theme(colors, colors, "truecolor");
	let start: any, header: any;
	(registerHeader as any)({ on(_name: string, handler: any) { start = handler; } });
	start({}, { mode: "rpc", ui: { setHeader() { throw new Error("headless header"); } } });
	start({}, { mode: "tui", ui: { setHeader(factory: any) { header = factory({ requestRender() {} }, theme); } } });
	try {
		for (const width of [0, 1, 12, 25, 39, 40, 80, 120]) {
			for (const line of header.render(width)) expect(visibleWidth(line)).toBeLessThanOrEqual(width);
		}
		const plain = (width: number) => header.render(width).join("\n").replace(/\x1b\[[0-9;]*m/g, "");
		// wide: Butler and the wordmark in box-drawing letters; narrow: the name as plain text
		expect(plain(80)).toContain("╔╗ ╦ ╦╔╦╗╦  ╔═╗╦═╗");
		expect(plain(80)).toContain("think · build · explore");
		expect(plain(28)).toContain("Butler Code");
		expect(plain(80)).not.toContain("FIRECODE");
	} finally { header.dispose(); }
});

test("Pi discovers Butler through the package manifest and resolves every color", async () => {
	const agentDir = await mkdtemp(resolve(tmpdir(), "butler-theme-"));
	try {
		const settingsManager = SettingsManager.inMemory({ packages: [resolve(import.meta.dir, "..")] });
		const loader = new DefaultResourceLoader({ cwd: agentDir, agentDir, settingsManager,
			noExtensions: true, noSkills: true, noPromptTemplates: true, noContextFiles: true });
		await loader.reload();
		const { themes, diagnostics } = loader.getThemes();
		expect(diagnostics).toEqual([]);
		for (const name of ["butler", "butler-dark"]) {
			const theme = themes.find((item: any) => item.name === name);
			expect(theme).toBeDefined();
			for (const key of Object.keys(themeJson.colors)) {
				if (key.endsWith("Bg")) expect(theme.bg(key, "sample")).toContain("sample");
				else expect(theme.fg(key, "sample")).toContain("sample");
			}
		}
	} finally { await rm(agentDir, { recursive: true, force: true }); }
});

test("light and dark cards keep readable text, including tool rows and the jump indicator", () => {
	const luminance = (hex: string) => {
		const channels = hex.slice(1).match(/../g)!.map(c => parseInt(c, 16) / 255)
			.map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
		return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
	};
	for (const palette of [themeJson, darkThemeJson]) {
		const color = (key: string) => {
			const value = (palette.colors as any)[key];
			return (palette.vars as any)[value] ?? value;
		};
		for (const [background, foregrounds] of [
			["userMessageBg", ["userMessageText"]], ["customMessageBg", ["customMessageText"]],
			["toolSuccessBg", ["text", "toolTitle", "toolOutput", "syntaxVariable", "syntaxComment"]],
			["toolPendingBg", ["text", "toolTitle", "toolOutput"]], ["toolErrorBg", ["toolTitle", "toolOutput"]],
			["selectedBg", ["text"]], ["searchMatchBg", ["searchMatchText"]],
		] as const) {
			const bg = luminance(color(background));
			if (palette === themeJson) expect(bg).toBeGreaterThan(0.45);
			else expect(bg).toBeLessThan(0.15);
			for (const foreground of foregrounds) {
				const fg = luminance(color(foreground));
				expect((Math.max(bg, fg) + 0.05) / (Math.min(bg, fg) + 0.05), `${palette.name} ${foreground}/${background}`).toBeGreaterThanOrEqual(4.5);
			}
		}
	}
});

test("Pi's native paired theme switches on terminal events and manual choice disables auto", async () => {
	const native = await import(new URL("./modes/interactive/theme/theme.js", PI_CODING_AGENT_URL).href);
	const { InteractiveThemeController } = await import(new URL("./modes/interactive/theme/theme-controller.js", PI_CODING_AGENT_URL).href);
	const themes = [themeJson, darkThemeJson].map(palette => {
		const colors = Object.fromEntries(Object.entries(palette.colors).map(([key, value]) => [key, (palette.vars as any)[value] ?? value]));
		const theme = new Theme(colors, colors, "truecolor");
		theme.name = palette.name;
		return theme;
	});
	native.setRegisteredThemes(themes);
	// 新版 Pi 看终端报告的背景色来分明暗；终端的明暗变化通知只是让它重新问一次背景色
	const LIGHT = { r: 255, g: 255, b: 255 }, DARK = { r: 16, g: 24, b: 32 }, TEXT = { r: 128, g: 128, b: 128 };
	let background = LIGHT, listener: ((mode: string) => void) | undefined, changes = 0;
	const notifications: boolean[] = [], errors: string[] = [];
	const controller = new InteractiveThemeController({
		onTerminalColorSchemeChange(handler: any) { listener = handler; return () => { listener = undefined; }; },
		queryTerminalColors: async () => ({ foreground: TEXT, background }),
		setTerminalColorSchemeNotifications(value: boolean) { notifications.push(value); },
		invalidate() {}, requestRender() {},
	}, { getSettingsManager: () => ({ getThemeSetting: () => "butler/butler-dark" }),
		showError: (error: string) => errors.push(error), onChanged: () => { changes++; } });
	const flip = async (mode: "light" | "dark") => { background = mode === "dark" ? DARK : LIGHT; listener!(mode); await controller.waitForTerminalColors(); };
	try {
		controller.applyFromSettings();
		await controller.waitForTerminalColors();
		expect(native.theme.name).toBe("butler"); expect(notifications).toEqual([true]);
		await flip("dark"); expect(native.theme.name).toBe("butler-dark");
		await flip("light"); expect(native.theme.name).toBe("butler");
		expect(changes).toBeGreaterThanOrEqual(3); expect(errors).toEqual([]);
		controller.setThemeName("butler-dark");
		await flip("light"); expect(native.theme.name).toBe("butler-dark"); // 手动选了就不再自动切
		expect(notifications).toEqual([true, false]);
	} finally {
		controller.dispose(); native.stopThemeWatcher(); native.setRegisteredThemes([]);
	}
	expect(listener).toBeUndefined();
});
