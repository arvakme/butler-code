import { expect, test } from "bun:test";
import { latestCacheHitPercent, sessionSpeeds } from "../statusbar/metrics.ts";
const entry = (role: string, seconds: number, usage?: any, stopReason = "stop") => ({
	type: "message", timestamp: new Date(seconds * 1000).toISOString(), message: { role, usage, stopReason },
});

test("cache hit matches Claude's read/(read+write) rather than all prompt input", () => {
	expect(latestCacheHitPercent([entry("assistant", 10, { input: 1000, cacheRead: 800, cacheWrite: 200 })])).toBe(80);
	expect(latestCacheHitPercent([entry("assistant", 10, { input: 1000 })])).toBe(0);
	expect(latestCacheHitPercent([])).toBeUndefined();
	expect(latestCacheHitPercent([entry("assistant", 10, { cacheRead: 100 }), entry("assistant", 20, {}, "error")])).toBe(100);
});

test("session speeds merge tool-loop intervals, exclude user idle gaps and can be rebuilt after resume", () => {
	const entries = [entry("user", 0), entry("assistant", 2, { input: 100, output: 20, cacheRead: 5000 }),
		entry("toolResult", 3), entry("assistant", 4, { input: 100, output: 20 }),
		entry("user", 100), entry("assistant", 102, { input: 100, output: 20 })];
	expect(sessionSpeeds(entries)).toEqual({ input: 50, output: 10, total: 60 });
	expect(sessionSpeeds(JSON.parse(JSON.stringify(entries)))).toEqual(sessionSpeeds(entries));
	expect(sessionSpeeds([entry("assistant", 10, { input: 500, output: 100 })])).toBeUndefined();
	expect(sessionSpeeds([entry("user", 10), entry("assistant", 10, { input: 500 })])).toBeUndefined();
	expect(sessionSpeeds([...entries, entry("assistant", 500, { input: 99999 }, "error")])).toEqual(sessionSpeeds(entries));
});
