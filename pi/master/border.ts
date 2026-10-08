/**
 * 子代理视图输入区的边框纯布局：状态嵌进上下边框横线。所有片段由调用方预先着色，
 * 本文件只按显示宽度逐级退让，宽窄布局不保存状态。
 */
import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { mix, paint, palette } from "../flame.js";

/** 回合进行时边框左端的光晕渐隐距离（列）。 */
const GLOW_SPAN = 18;
export const separator = (theme: Theme) => ` ${theme.fg("dim", "·")} `;

export type Line = (text: string) => string;
/** 一条边框的一档候选：左、右两段（已着色）。 */
export type BorderParts = readonly [left: string, right: string];

/**
 * 一条边框：`─ 左 ───── 右 ─`。左端按 glow 渐变成主题强调色；横线放不下（填充不足两格）返回空串。
 * 左右为空时对应空位并入横线。
 */
function border(width: number, left: string, right: string, line: Line, glow: number, theme: Theme): string {
	const fill = width - 2 - (left ? visibleWidth(left) + 2 : 0) - (right ? visibleWidth(right) + 2 : 0);
	if (fill < 2) return "";
	const colors = palette(theme);
	const lit = (index: number) => glow * Math.max(0, 1 - index / GLOW_SPAN);
	const dash = (index: number) => {
		const k = lit(index);
		return k > 0.02 ? paint(mix(colors.line, colors.lit, k), "─") : line("─");
	};
	let bar = "";
	for (let index = 0; index < fill; index++) bar += dash(index + (left ? 0 : 1));
	return `${dash(0)}${left ? ` ${left} ` : ""}${bar}${right ? ` ${right} ` : ""}${line("─")}`;
}

/**
 * 边框布局：依次尝试由长到短的候选，取第一个放得下的；全都放不下就是一条纯横线。
 * 退让档由调用方给出。
 */
export function fitBorder(width: number, line: Line, glow: number, candidates: Iterable<BorderParts>, theme: Theme): string {
	for (const [left, right] of candidates) {
		const text = border(width, left, right, line, glow, theme);
		if (text && visibleWidth(text) <= width) return text;
	}
	return line("─").repeat(Math.max(0, width));
}

