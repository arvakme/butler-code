/** Butler UI 品牌色与数值分级配色：所有阈值到颜色的映射集中在此。 */
import type { ExtensionAPI, ThemeColor } from "@earendil-works/pi-coding-agent";

/** 阈值表：首个满足 `value >= at` 的档位胜出，表按 at 降序书写。 */
type Threshold = { at: number; color: ThemeColor };

function pick(value: number, thresholds: readonly Threshold[]): ThemeColor {
	for (const threshold of thresholds) {
		if (value >= threshold.at) return threshold.color;
	}
	return thresholds[thresholds.length - 1].color;
}

const CONTEXT_FILL = [
	{ at: 75, color: "error" },
	{ at: 50, color: "warning" },
	{ at: 0, color: "success" },
] as const satisfies readonly Threshold[];

/** 缓存命中越高越好，与上下文填充方向相反。 */
const CACHE_HIT = [
	{ at: 90, color: "success" },
	{ at: 50, color: "muted" },
	{ at: 20, color: "warning" },
	{ at: 0, color: "error" },
] as const satisfies readonly Threshold[];


const RESULT_SIZE = [
	{ at: 50_000, color: "error" },
	{ at: 10_000, color: "warning" },
	{ at: 0, color: "dim" },
] as const satisfies readonly Threshold[];

export const contextColor = (percent: number | null | undefined): ThemeColor =>
	percent == null ? "muted" : pick(percent, CONTEXT_FILL);

export const cacheColor = (percent: number): ThemeColor =>
	pick(percent, CACHE_HIT);

export const sizeColor = (chars: number): ThemeColor =>
	pick(chars, RESULT_SIZE);

type ThinkingLevel = ReturnType<ExtensionAPI["getThinkingLevel"]>;

const THINKING: Record<ThinkingLevel, ThemeColor> = {
	off: "thinkingOff",
	minimal: "thinkingMinimal",
	low: "thinkingLow",
	medium: "thinkingMedium",
	high: "thinkingHigh",
	xhigh: "thinkingXhigh",
	max: "thinkingMax",
};

export const thinkingColor = (level: ThinkingLevel): ThemeColor =>
	THINKING[level];
