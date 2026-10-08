/** ccstatusline-compatible metrics from the active Pi branch, without polling or a second clock. */
type Entry = {
	type?: string;
	timestamp?: string;
	message?: { role?: string; stopReason?: string; usage?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number } };
};
export type Speeds = { input: number; output: number; total: number };
const count = (value: number | undefined) => value !== undefined && Number.isFinite(value) && value >= 0 ? value : 0;

/** Cache Hit uses reads / (reads + writes), not cached share of all input tokens. */
export function latestCacheHitPercent(entries: readonly Entry[]): number | undefined {
	for (let i = entries.length - 1; i >= 0; i--) {
		const message = entries[i].message;
		if (entries[i].type !== "message" || message?.role !== "assistant" || !message.usage) continue;
		if (message.stopReason === "error" || message.stopReason === "aborted") continue;
		const read = count(message.usage.cacheRead), write = count(message.usage.cacheWrite);
		return read + write > 0 ? read / (read + write) * 100 : 0;
	}
	return undefined;
}

/** Session-average uncached In/Out divided by merged user-to-response intervals; idle gaps are excluded. */
export function sessionSpeeds(entries: readonly Entry[]): Speeds | undefined {
	let start: number | undefined, input = 0, output = 0;
	const intervals: Array<[number, number]> = [];
	for (const entry of entries) {
		if (entry.type !== "message") continue;
		const time = Date.parse(entry.timestamp ?? "");
		if (!Number.isFinite(time)) continue;
		const message = entry.message;
		if (message?.role === "user") { start = time; continue; }
		if (message?.role !== "assistant" || !message.usage || start === undefined || time <= start) continue;
		if (message.stopReason === "error" || message.stopReason === "aborted") continue;
		input += count(message.usage.input); output += count(message.usage.output);
		intervals.push([start, time]);
	}
	intervals.sort((a, b) => a[0] - b[0]);
	let duration = 0, end = -Infinity;
	for (const [start, stop] of intervals) {
		duration += Math.max(0, stop - Math.max(start, end));
		end = Math.max(end, stop);
	}
	if (!duration) return undefined;
	return { input: input * 1000 / duration, output: output * 1000 / duration, total: (input + output) * 1000 / duration };
}
