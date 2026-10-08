import { afterEach, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerClaudeSub } from "../provider/claude-sub.js";

const originalEnv = { ...process.env };
const directories: string[] = [];
afterEach(() => {
	for (const name of ["PATH", "PI_CLAUDE_CODE_VERSION", "PI_CLAUDE_CODE_VERSION_SUFFIX", "PI_CLAUDE_OAUTH_LOG_FILE"]) {
		if (originalEnv[name] === undefined) delete process.env[name];
		else process.env[name] = originalEnv[name];
	}
	for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function fakeClaude(version = "2.1.274", delay = 0) {
	const directory = mkdtempSync(join(tmpdir(), "butler-ui-claude-version-"));
	directories.push(directory);
	const executable = join(directory, "claude");
	const install = (nextVersion: string) => {
		writeFileSync(executable, `#!/bin/sh\n/bin/sleep ${delay}\nprintf '%s\\n' '${nextVersion} (Claude Code)'\n`);
		chmodSync(executable, 0o755);
	};
	install(version);
	process.env.PATH = directory;
	delete process.env.PI_CLAUDE_CODE_VERSION;
	delete process.env.PI_CLAUDE_CODE_VERSION_SUFFIX;
	delete process.env.PI_CLAUDE_OAUTH_LOG_FILE;
	return { install, executable };
}

function harness(provider = "anthropic", oauth = true) {
	const handlers = new Map<string, (event: any, ctx: any) => any>();
	const registrations: unknown[] = [];
	registerClaudeSub({
		on: (name: string, handler: any) => handlers.set(name, handler),
		registerProvider: (...args: unknown[]) => registrations.push(args),
	} as never);
	const ctx = { model: { provider }, modelRegistry: { isUsingOAuth: () => oauth } };
	return {
		registrations,
		async headers(headers: Record<string, string | null> = {}) {
			await handlers.get("before_provider_headers")?.({ headers }, ctx);
			return headers;
		},
		async payload(system: unknown = [{ type: "text", text: "Keep this system prompt." }]) {
			const payload = { system, messages: [{ role: "user", content: "Hello Claude" }] };
			return await handlers.get("before_provider_request")?.({ payload }, ctx) ?? payload;
		},
	};
}

test("Claude detection tolerates a cold start longer than one second without blocking the event loop", async () => {
	fakeClaude("2.1.274", 1.2);
	const h = harness();
	let ticked = false;
	const timer = setTimeout(() => { ticked = true; }, 25);
	try {
		const pending = h.headers();
		await new Promise((resolve) => setTimeout(resolve, 60));
		expect(ticked).toBe(true);
		expect((await pending)["user-agent"]).toBe("claude-cli/2.1.274 (external, cli)");
		expect((await h.payload()).system[0].text).toMatch(/cc_version=2\.1\.274\.[a-f0-9]{3};/);
	} finally {
		clearTimeout(timer);
	}
});

test("the next request sees a CLI upgrade while the current request keeps matching attribution", async () => {
	const cli = fakeClaude();
	const h = harness();
	expect((await h.headers())["user-agent"]).toContain("2.1.274");
	cli.install("2.1.275");
	expect((await h.payload()).system[0].text).toContain("cc_version=2.1.274.");
	expect((await h.headers())["user-agent"]).toContain("2.1.275");
	expect((await h.payload()).system[0].text).toContain("cc_version=2.1.275.");
});

test("a failed detection never reuses an old version and the next request can recover", async () => {
	const cli = fakeClaude();
	const h = harness();
	await h.headers();
	rmSync(cli.executable);
	const headers = { "user-agent": "host-default" };
	await expect(h.headers(headers)).rejects.toThrow("PI_CLAUDE_CODE_VERSION");
	expect(headers).toEqual({ "user-agent": "host-default" });
	expect((await h.payload()).system).toEqual([{ type: "text", text: "Keep this system prompt." }]);
	cli.install("2.1.276");
	expect((await h.headers())["user-agent"]).toContain("2.1.276");
});

test("malformed CLI output produces an actionable error instead of a made-up version", async () => {
	fakeClaude("unknown");
	const h = harness();
	await expect(h.headers()).rejects.toThrow("Claude Code");
	expect((await h.payload()).system).toHaveLength(1);
});

test("an explicit version works without a CLI and invalid overrides are rejected", async () => {
	const cli = fakeClaude();
	rmSync(cli.executable);
	process.env.PI_CLAUDE_CODE_VERSION = " 2.1.280 ";
	const h = harness();
	expect((await h.headers())["user-agent"]).toContain("2.1.280");
	process.env.PI_CLAUDE_CODE_VERSION = "2.1.280\r\nx-injected: yes";
	await expect(h.headers()).rejects.toThrow("PI_CLAUDE_CODE_VERSION");
	expect((await h.payload()).system).toHaveLength(1);
});

test("API-key and other-provider requests receive no Claude attribution or version detection", async () => {
	const cli = fakeClaude();
	rmSync(cli.executable);
	for (const h of [harness("anthropic", false), harness("openai", true)]) {
		expect(h.registrations).toHaveLength(0);
		expect(await h.headers({ existing: "value" })).toEqual({ existing: "value" });
		expect((await h.payload()).system).toHaveLength(1);
	}
});

test("billing injection preserves a string system prompt and does not duplicate an existing header", async () => {
	fakeClaude();
	const h = harness();
	await h.headers();
	const payload = await h.payload("Keep the string prompt.");
	expect(payload.system[1]).toEqual({ type: "text", text: "Keep the string prompt." });
	const existing = [{ type: "text", text: "x-anthropic-billing-header: cc_version=2.1.274.abc;" }];
	await h.headers();
	expect((await h.payload(existing)).system).toEqual(existing);
});

test("a hung CLI times out visibly and a subsequent request can use a valid override", async () => {
	const cli = fakeClaude();
	writeFileSync(cli.executable, "#!/bin/sh\nexec /bin/sleep 30\n");
	const h = harness();
	await expect(h.headers()).rejects.toThrow("10 秒");
	expect((await h.payload()).system).toHaveLength(1);
	process.env.PI_CLAUDE_CODE_VERSION = "2.1.280";
	expect((await h.headers())["user-agent"]).toContain("2.1.280");
}, 15_000);

test("separate sessions keep their own request attribution", async () => {
	fakeClaude();
	const first = harness();
	const second = harness();
	process.env.PI_CLAUDE_CODE_VERSION = "2.1.281";
	await first.headers();
	process.env.PI_CLAUDE_CODE_VERSION = "2.1.282";
	await second.headers();
	expect((await first.payload()).system[0].text).toContain("cc_version=2.1.281.");
	expect((await second.payload()).system[0].text).toContain("cc_version=2.1.282.");
});
