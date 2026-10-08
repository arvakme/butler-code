/** 启动横幅：Butler 本人 + 字标。纯函数，不依赖 Pi，所以 scripts/preview-banner.ts 能直接在终端里预览。 */

// 机器人是 claude-code-butler 里的同一个 Butler（butler-world/hooks/sprite.ts），这里只留横幅要用的几个姿势。
// ' ' 为透明：横幅只画前景色，终端是透明背景也不会露出方块。
const W = 25;
const H = 15;
const BODY_X = 4;
const BODY_Y = 1;

const COLORS: Record<string, [number, number, number]> = {
	h: [238, 238, 238], // 高光
	w: [215, 255, 255], // 外壳
	s: [135, 175, 215], // 外壳阴影
	d: [95, 135, 175], // 下半壳
	n: [28, 28, 28], // 面罩
	v: [0, 95, 135], // 面罩边
	c: [95, 215, 255], // 辉光
	b: [0, 135, 215], // 深辉光
	e: [135, 255, 255], // 亮辉光
	o: [68, 68, 68], // 描边
};

const SHELL = [
	"       chc       ",
	"      cwhwc      ",
	"     shhhwws     ",
	"   bwhhhwwwwsb   ",
	"  cwhvvvvvvvwwc  ",
	" cwwvnnnnnnnvwsc ",
	"  swvnnnnnnnvws  ",
	"   swwvnnnvwws   ",
	"  bcswwwwwsscb   ",
	"      dbcbd      ",
];
const HAND = ["hw", "sd"];

type Eyes = "dim" | "blink" | "open" | "happy";
type Hands = "close" | "rest" | "waveA" | "waveB";
export type Pose = { eyes: Eyes; hands: Hands };

const HANDS: Record<Hands, [number, number, number, number]> = {
	close: [3, 7, 20, 7],
	rest: [1, 6, 22, 6],
	waveA: [1, 6, 22, 2],
	waveB: [1, 6, 22, 4],
};

/** 开场：眼睛从暗到睁开，挥两下手，眨一下眼，然后停在 REST。每帧约 110ms。 */
export const REST: Pose = { eyes: "open", hands: "rest" };
export const BOOT: Pose[] = [
	{ eyes: "dim", hands: "close" },
	{ eyes: "dim", hands: "close" },
	{ eyes: "blink", hands: "close" },
	{ eyes: "open", hands: "rest" },
	{ eyes: "open", hands: "waveA" },
	{ eyes: "open", hands: "waveB" },
	{ eyes: "happy", hands: "waveA" },
	{ eyes: "happy", hands: "waveB" },
	{ eyes: "open", hands: "rest" },
	{ eyes: "blink", hands: "rest" },
	REST,
];
export const FRAME_MS = 110;

function butlerGrid(pose: Pose): string[][] {
	const grid = Array.from({ length: H }, () => Array<string>(W).fill(" "));
	const body = SHELL.map((line) => [...line]);
	const at = (y: number, x: number, value: string) => {
		const row = body[y];
		if (row) row[x] = value;
	};
	for (const eye of [5, 10]) {
		const [top, bottom] =
			pose.eyes === "dim" ? ["nn", "dd"] : pose.eyes === "blink" ? ["nn", "ce"] : pose.eyes === "happy" ? ["he", "nn"] : ["he", "ce"];
		at(5, eye, top[0]);
		at(5, eye + 1, top[1]);
		at(6, eye, bottom[0]);
		at(6, eye + 1, bottom[1]);
	}
	at(7, 8, pose.eyes === "happy" ? "e" : "b");
	at(3, 5, "h");
	at(9, 8, "d");

	body.forEach((line, y) => {
		line.forEach((ch, x) => {
			if (ch !== " ") grid[BODY_Y + y][BODY_X + x] = ch;
		});
	});
	grid[BODY_Y + 10][BODY_X + 8] = "d";

	const [lx, ly, rx, ry] = HANDS[pose.hands];
	for (const [hx, hy] of [[lx, ly], [rx, ry]] as const) {
		HAND.forEach((art, j) => {
			[...art].forEach((ch, i) => {
				if (grid[hy + j]) grid[hy + j][hx + i] = ch;
			});
		});
	}

	// 描边，让浅色外壳在浅色背景上也看得清
	const edge: [number, number][] = [];
	for (let y = 0; y < H; y++) {
		for (let x = 0; x < W; x++) {
			if (grid[y][x] !== " ") continue;
			const near = [grid[y - 1]?.[x], grid[y + 1]?.[x], grid[y]?.[x - 1], grid[y]?.[x + 1]];
			if (near.some((n) => n !== undefined && n !== " " && n !== "o")) edge.push([y, x]);
		}
	}
	for (const [y, x] of edge) grid[y][x] = "o";
	return grid;
}

const RESET = "\x1b[0m";
const fg = (rgb: readonly number[]) => `\x1b[38;2;${rgb.join(";")}m`;
const bg = (rgb: readonly number[]) => `\x1b[48;2;${rgb.join(";")}m`;

/** 半块字符：一格两个像素。两个都有且颜色不同时才用背景色，背景只出现在机器人身体里面。 */
export function butlerLines(pose: Pose): string[] {
	const grid = butlerGrid(pose);
	const lines: string[] = [];
	for (let y = 0; y < H; y += 2) {
		let line = "";
		for (let x = 0; x < W; x++) {
			const top = COLORS[grid[y][x]];
			const bottom = COLORS[grid[y + 1]?.[x] ?? " "];
			if (!top && !bottom) line += " ";
			else if (top && !bottom) line += `${fg(top)}▀${RESET}`;
			else if (!top && bottom) line += `${fg(bottom)}▄${RESET}`;
			else if (top && bottom && top.join() === bottom.join()) line += `${fg(top)}█${RESET}`;
			else if (top && bottom) line += `${fg(top)}${bg(bottom)}▀${RESET}`;
		}
		lines.push(line);
	}
	return lines;
}

// 字标：Calvin S，三行制表符。BUTLER 用深一点的蓝，CODE 用亮一点的青，浅色和深色背景上都读得出。
const GLYPHS: Record<string, [string, string, string]> = {
	B: ["╔╗ ", "╠╩╗", "╚═╝"],
	U: ["╦ ╦", "║ ║", "╚═╝"],
	T: ["╔╦╗", " ║ ", " ╩ "],
	L: ["╦  ", "║  ", "╩═╝"],
	E: ["╔═╗", "║╣ ", "╚═╝"],
	R: ["╦═╗", "╠╦╝", "╩╚═"],
	C: ["╔═╗", "║  ", "╚═╝"],
	O: ["╔═╗", "║ ║", "╚═╝"],
	D: ["╔╦╗", " ║║", "═╩╝"],
};
const BLUE = [0, 110, 180];
const CYAN = [30, 170, 210];

function word(text: string): [string, string, string] {
	const rows: [string, string, string] = ["", "", ""];
	for (const letter of text) for (let i = 0; i < 3; i++) rows[i] += GLYPHS[letter][i];
	return rows;
}

const BUTLER = word("BUTLER");
const CODE = word("CODE");
const WORDMARK_WIDTH = 18 + 2 + 12;
const SPRITE_COLUMNS = W;
const GAP = 4;
export const FULL_WIDTH = SPRITE_COLUMNS + GAP + WORDMARK_WIDTH;

export type Dress = { muted: (text: string) => string; bold: (text: string) => string };

const wordmarkLines = (dress: Dress): string[] =>
	[0, 1, 2].map((i) => dress.bold(`${fg(BLUE)}${BUTLER[i]}${RESET}`) + "  " + dress.bold(`${fg(CYAN)}${CODE[i]}${RESET}`));

/** 三档：够宽时 机器人 + 字标；中等宽度只留字标；再窄退成一行。 */
export function bannerLines(width: number, pose: Pose, dress: Dress): string[] {
	const subtitle = dress.muted("think · build · explore");
	if (width >= FULL_WIDTH) {
		const art = butlerLines(pose);
		const right = ["", "", ...wordmarkLines(dress), "", subtitle, "", ""];
		const lines = art.map((row, i) => `${row}${" ".repeat(GAP)}${right[i] ?? ""}`);
		return ["", ...lines, ""];
	}
	if (width >= WORDMARK_WIDTH + 2) return ["", ...wordmarkLines(dress), subtitle, ""];
	return [dress.bold(`${fg(BLUE)}◈ Butler${RESET} ${fg(CYAN)}Code${RESET}`)];
}

/** 整块居中：先量出最宽的一行，再整体左补空格，这样机器人和字标之间的位置不会因为居中而错开。 */
export function centered(lines: string[], width: number, visible: (text: string) => number): string[] {
	const widest = Math.max(0, ...lines.map(visible));
	const pad = " ".repeat(Math.max(0, Math.floor((width - widest) / 2)));
	return lines.map((line) => (line === "" ? "" : pad + line));
}
