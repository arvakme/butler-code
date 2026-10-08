/**
 * 火焰动效：全局唯一动画时钟、盲文火苗与落定过渡。凡是“正在运行”的东西都用这里的火苗；
 * 所有动效由同一个时钟驱动，没有订阅者时计时器停止，帧号取绝对时间，多处火苗天然同步。
 * 颜色全部取自当前主题（明暗切换随之变化），这里只定义每种角色用哪个主题色。
 */
import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import { colorToRgb } from "@earendil-works/pi-tui";

export type Rgb = readonly [number, number, number];

/** 动效色板：heat 是火苗由冷到热的五档；lit 是“在跑”的强调色；highlight 是审查与到达高亮。 */
export interface Palette {
	heat: readonly [Rgb, Rgb, Rgb, Rgb, Rgb];
	line: Rgb;
	lit: Rgb;
	highlight: Rgb;
	done: Rgb;
	failed: Rgb;
}

/** 角色 → 主题色。highlight 借标题色：主题里没有专门的“审查”色，标题色在明暗两套里都是醒目的暖色。 */
const ROLES = {
	heat: ["borderMuted", "borderAccent", "border", "accent", "text"],
	line: "borderMuted",
	lit: "accent",
	highlight: "mdHeading",
	done: "success",
	failed: "error",
} as const satisfies { heat: readonly ThemeColor[] } & Record<Exclude<keyof Palette, "heat">, ThemeColor>;

// 主题的 colors 对象在主题或终端底色变化时才换新；按它缓存，渲染热路径只查表。
const palettes = new WeakMap<object, Palette>();

export function palette(theme: Theme): Palette {
	const colors = theme.colors;
	const cached = palettes.get(colors);
	if (cached) return cached;
	const rgb = (token: ThemeColor): Rgb => {
		const { r, g, b } = colorToRgb(colors[token]);
		return [r, g, b];
	};
	const built: Palette = {
		heat: ROLES.heat.map(rgb) as unknown as Palette["heat"],
		line: rgb(ROLES.line), lit: rgb(ROLES.lit), highlight: rgb(ROLES.highlight),
		done: rgb(ROLES.done), failed: rgb(ROLES.failed),
	};
	palettes.set(colors, built);
	return built;
}

const FPS = 12;
const FRAME_MS = 1000 / FPS;
const SETTLE_MS = 400;
/** 一格火苗与三格火苗的火舌高度轮廓（每格两个点列）。 */
const PROFILE = { 1: [0.75, 1], 3: [0.3, 0.6, 0.9, 1, 0.7, 0.35] } as const;
// 盲文点位：左列自上而下 1 2 3 7，右列 4 5 6 8。
const DOT = [
	[0x01, 0x02, 0x04, 0x40],
	[0x08, 0x10, 0x20, 0x80],
] as const;
/** 五档火色在 0–1 上的位置。 */
const HEAT_AT = [0, 0.3, 0.55, 0.8, 1] as const;

const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;

/** 订阅动画帧；返回取消函数。最后一个订阅者离开时计时器随之停止。 */
export function onFrame(listener: () => void): () => void {
	listeners.add(listener);
	if (!timer) {
		timer = setInterval(() => {
			for (const notify of listeners) notify();
		}, FRAME_MS);
		timer.unref?.();
	}
	return () => {
		listeners.delete(listener);
		if (listeners.size || !timer) return;
		clearInterval(timer);
		timer = undefined;
	};
}

/** 按帧量化的绝对秒数；所有火苗共用同一相位基准。 */
const frameSeconds = () => Math.floor(Date.now() / FRAME_MS) / FPS;

const clamp = (value: number) => Math.min(1, Math.max(0, value));
const easeOut = (k: number) => 1 - (1 - clamp(k)) ** 3;

export function mix(from: Rgb, to: Rgb, k: number): Rgb {
	const t = clamp(k);
	return [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t, from[2] + (to[2] - from[2]) * t];
}

function heat(stops: Palette["heat"], value: number): Rgb {
	const x = clamp(value);
	for (let index = 1; index < HEAT_AT.length; index++) {
		const at = HEAT_AT[index];
		const fromAt = HEAT_AT[index - 1];
		if (x <= at) return mix(stops[index - 1], stops[index], (x - fromAt) / (at - fromAt));
	}
	return stops[stops.length - 1];
}

/** 只设置/复位前景色，不注入全量 reset，可安全嵌进带背景的行。 */
export function paint(color: Rgb, text: string): string {
	return text ? `\x1b[38;2;${color[0] | 0};${color[1] | 0};${color[2] | 0}m${text}\x1b[39m` : "";
}

/** 三个不可公约频率叠加的火势，0.1–1 之间起伏。 */
export function flicker(phase: number, t = frameSeconds()): number {
	const tau = Math.PI * 2;
	return 0.55
		+ 0.2 * Math.sin(tau * (1.1 * t + phase))
		+ 0.15 * Math.sin(tau * (2.7 * t + 1.7 * phase) + 1.3)
		+ 0.1 * Math.sin(tau * (5.9 * t + 3.1 * phase) + 0.4);
}

/**
 * 盲文火苗：每个点列是一根随时钟起伏的火舌，火尖随风摆，顶行只留一个点保持尖顶。
 * phase 让并列的火苗错开。
 */
export function flame(cells: 1 | 3, phase: number, theme: Theme): string {
	const stops = palette(theme).heat;
	const profile = PROFILE[cells];
	const columns = cells * 2;
	const t = frameSeconds();
	const sway = Math.round(Math.sin(Math.PI * 2 * (0.7 * t + phase)) * 0.6);
	const heights = Array.from({ length: columns }, (_, index) => {
		const base = profile[Math.min(columns - 1, Math.max(0, index - sway))];
		return Math.round(clamp(base * (0.7 + 0.45 * flicker(phase + index * 0.37, t))) * 4);
	});
	const peak = Math.max(...heights);
	let topSeen = false;
	let out = "";
	for (let cell = 0; cell < cells; cell++) {
		let bits = 0;
		for (let side = 0; side < 2; side++) {
			let height = heights[cell * 2 + side];
			if (height === peak && height > 1) {
				if (topSeen) height -= 1;
				topSeen = true;
			}
			for (let row = 0; row < height; row++) bits |= DOT[side][3 - row];
		}
		const core = cells === 1 ? 0.5 : 1 - Math.abs(cell - (cells - 1) / 2) / cells;
		const color = heat(stops, 0.35 + 0.45 * core + 0.2 * flicker(phase + cell, t));
		out += paint(color, String.fromCodePoint(0x2800 + bits));
	}
	return out;
}

export type Settle = "done" | "failed";

/**
 * 落定标记：歇下那一刻就是 ✓/✗（与定格文字同帧出现，不留冷却中的火苗残帧），颜色在 0.4 秒内从“在跑”色转到终色。
 */
export function settleMark(kind: Settle, sinceMs: number, theme: Theme): string {
	const k = easeOut(sinceMs / SETTLE_MS);
	const colors = palette(theme);
	return kind === "done"
		? paint(mix(colors.lit, colors.done, k), "✓")
		: paint(mix(colors.lit, colors.failed, k), "✗");
}

/** 落定过渡是否仍在播放；调用方据此决定是否继续订阅时钟。 */
export const settling = (sinceMs: number) => sinceMs < SETTLE_MS;

const SPINNER = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏";

/** 审查：高亮色盲文转圈点，与火苗同一时钟、同一字符族，靠颜色与火苗区分；phase 错开并列的转圈。 */
export function reviewMark(theme: Theme, phase = 0): string {
	const frame = Math.floor(Date.now() / FRAME_MS + phase * SPINNER.length);
	return paint(palette(theme).highlight, SPINNER[frame % SPINNER.length]);
}

/** 并列火苗的相位：按序号错开，避免一排火苗同起同落。 */
export const phaseOf = (index: number) => index * 0.23 + 0.11;
