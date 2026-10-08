/** 后台能力的配置：Butler UI config.jsonc 的 agents 节。严格校验，写错的功能拒绝启动，不回退默认；没有这一节就全部关闭。 */
import { loadConfig as loadButlerConfig } from "../config.js";

export const THINKING = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export type Thinking = (typeof THINKING)[number];
export type Atom = { provider: string; id: string; thinking: Thinking };

export const FEATURES = ["sentinel", "research", "predict", "choose", "lessons", "loose"] as const;
export type Feature = (typeof FEATURES)[number];

export type SentinelConfig = { model: Atom; intervalSeconds: number; notify: string[] | "pi" };
/** research：每个 members 是一位调研员（不同模型各自联网独立查同一个问题），synthesizer 合并并交叉验证（不写就用第一位）。 */
export type ResearchConfig = { members: Atom[]; synthesizer: Atom };
export type PredictConfig = { model: Atom; examples: number };
export type ChooseConfig = { model: Atom };
export type LessonsConfig = { maxChars: number; mode: "index" | "full"; globalFile?: string };
/** loose：未了事项。scanEveryTurns 每隔几轮让便宜的模型翻一遍最近的对话；remindMinutes 同一条多久再提醒；awayMinutes 你离开多久算“回来”；staleHours 放多久交给 notify；notify 同哨兵。 */
export type LooseConfig = { model: Atom; scanEveryTurns: number; remindMinutes: number; awayMinutes: number; staleHours: number; notify: string[] | "pi" };
export type ButlerAgentsConfig = {
	features: Record<Feature, boolean>;
	sentinel?: SentinelConfig;
	research?: ResearchConfig;
	predict?: PredictConfig;
	choose?: ChooseConfig;
	lessons?: LessonsConfig;
	loose?: LooseConfig;
};
export type Loaded = { config: ButlerAgentsConfig; problems: string[] };

/** "provider/model/thinking"：思考档取最后一段，前半必须是 provider/model（model 本身可含斜杠，如 openrouter/anthropic/claude-sonnet-5-5）。 */
export function parseAtom(value: unknown, field: string, problems: string[]): Atom | undefined {
	const shape = `${field} 必须是“provider/model/thinking”字符串`;
	if (typeof value !== "string" || !value) return void problems.push(shape);
	const slash = value.lastIndexOf("/");
	const head = slash > 0 ? value.slice(0, slash) : "";
	const thinking = value.slice(slash + 1);
	const providerSlash = head.indexOf("/");
	if (providerSlash <= 0 || providerSlash === head.length - 1 || !(THINKING as readonly string[]).includes(thinking))
		return void problems.push(`${shape}（得到 ${value}）`);
	return { provider: head.slice(0, providerSlash), id: head.slice(providerSlash + 1), thinking: thinking as Thinking };
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function section(raw: Record<string, unknown>, name: string, allowed: readonly string[], problems: string[]): Record<string, unknown> | undefined {
	const value = raw[name];
	if (value === undefined) return undefined;
	if (!isObject(value)) return void problems.push(`${name} 必须是对象`);
	for (const key of Object.keys(value)) if (!allowed.includes(key)) problems.push(`未知字段 ${name}.${key}`);
	return value;
}

function integer(value: unknown, field: string, min: number, max: number, problems: string[]): number | undefined {
	if (typeof value === "number" && Number.isInteger(value) && value >= min && value <= max) return value;
	problems.push(`${field} 必须是 ${min} 到 ${max} 的整数`);
}

export function parseConfig(raw: unknown): Loaded {
	const problems: string[] = [];
	const off = Object.fromEntries(FEATURES.map((f) => [f, false])) as Record<Feature, boolean>;
	if (!isObject(raw)) return { config: { features: off }, problems: ["agents 必须是对象"] };
	for (const key of Object.keys(raw)) if (!["features", ...FEATURES].includes(key)) problems.push(`未知字段 ${key}`);

	const features = { ...off };
	if (isObject(raw.features)) {
		for (const [key, value] of Object.entries(raw.features)) {
			if (!(FEATURES as readonly string[]).includes(key)) problems.push(`未知开关 features.${key}，可用：${FEATURES.join(" / ")}`);
			else if (typeof value !== "boolean") problems.push(`features.${key} 必须是 true 或 false`);
			else features[key as Feature] = value;
		}
	} else problems.push("features 必须是对象");

	const config: ButlerAgentsConfig = { features };
	const sentinel = section(raw, "sentinel", ["model", "intervalSeconds", "notify"], problems);
	if (sentinel) {
		const model = parseAtom(sentinel.model, "sentinel.model", problems);
		const interval = sentinel.intervalSeconds === undefined ? 60 : integer(sentinel.intervalSeconds, "sentinel.intervalSeconds", 15, 3600, problems);
		let notify: SentinelConfig["notify"] | undefined = "pi";
		if (sentinel.notify !== undefined) {
			if (sentinel.notify === "pi") notify = "pi";
			else if (Array.isArray(sentinel.notify) && sentinel.notify.length > 0 && sentinel.notify.every((x) => typeof x === "string" && x))
				notify = sentinel.notify as string[];
			else problems.push('sentinel.notify 必须是 "pi" 或命令数组（文本从标准输入传入）'), (notify = undefined);
		}
		if (model && interval && notify) config.sentinel = { model, intervalSeconds: interval, notify };
	}
	const research = section(raw, "research", ["members", "synthesizer"], problems);
	if (research) {
		const members = Array.isArray(research.members) ? research.members.map((m, i) => parseAtom(m, `research.members[${i}]`, problems)) : void problems.push("research.members 必须是数组");
		if (members && (members.length < 1 || members.length > 5)) problems.push("research.members 要有 1 到 5 个模型");
		const synthesizer = research.synthesizer === undefined ? members?.[0] : parseAtom(research.synthesizer, "research.synthesizer", problems);
		if (members && members.length >= 1 && members.length <= 5 && members.every(Boolean) && synthesizer) config.research = { members: members as Atom[], synthesizer };
	}
	const predict = section(raw, "predict", ["model", "examples"], problems);
	if (predict) {
		const model = parseAtom(predict.model, "predict.model", problems);
		const examples = predict.examples === undefined ? 4 : integer(predict.examples, "predict.examples", 0, 10, problems);
		if (model && examples !== undefined) config.predict = { model, examples };
	}
	const choose = section(raw, "choose", ["model"], problems);
	if (choose) {
		const model = parseAtom(choose.model, "choose.model", problems);
		if (model) config.choose = { model };
	}
	const lessons = section(raw, "lessons", ["maxChars", "mode", "globalFile"], problems);
	if (lessons) {
		const maxChars = lessons.maxChars === undefined ? 12000 : integer(lessons.maxChars, "lessons.maxChars", 2000, 60000, problems);
		const globalFile = lessons.globalFile;
		const mode = lessons.mode === undefined ? "index" : lessons.mode;
		if (mode !== "index" && mode !== "full") problems.push('lessons.mode 必须是 "index" 或 "full"');
		else if (globalFile !== undefined && typeof globalFile !== "string") problems.push("lessons.globalFile 必须是路径字符串");
		else if (maxChars) config.lessons = { maxChars, mode, ...(globalFile ? { globalFile } : {}) };
	}
	const loose = section(raw, "loose", ["model", "scanEveryTurns", "remindMinutes", "awayMinutes", "staleHours", "notify"], problems);
	if (loose) {
		const model = parseAtom(loose.model, "loose.model", problems);
		const scan = loose.scanEveryTurns === undefined ? 6 : integer(loose.scanEveryTurns, "loose.scanEveryTurns", 1, 50, problems);
		const remind = loose.remindMinutes === undefined ? 30 : integer(loose.remindMinutes, "loose.remindMinutes", 1, 1440, problems);
		const away = loose.awayMinutes === undefined ? 20 : integer(loose.awayMinutes, "loose.awayMinutes", 1, 1440, problems);
		const stale = loose.staleHours === undefined ? 6 : integer(loose.staleHours, "loose.staleHours", 1, 720, problems);
		let notify: LooseConfig["notify"] | undefined = "pi";
		if (loose.notify !== undefined) {
			if (loose.notify === "pi") notify = "pi";
			else if (Array.isArray(loose.notify) && loose.notify.length > 0 && loose.notify.every((x) => typeof x === "string" && x)) notify = loose.notify as string[];
			else problems.push('loose.notify 必须是 "pi" 或命令数组（文本从标准输入传入）'), (notify = undefined);
		}
		if (model && scan && remind && away && stale && notify) config.loose = { model, scanEveryTurns: scan, remindMinutes: remind, awayMinutes: away, staleHours: stale, notify };
	}
	for (const feature of FEATURES)
		if (features[feature] && !config[feature]) {
			if (!problems.some((p) => p.startsWith(feature))) problems.push(`${feature} 已开启但缺少 ${feature} 配置节`);
			features[feature] = false; // 配置有问题的功能拒绝启动，不回退默认模型
		}
	return { config, problems };
}

let cached: Loaded | undefined;
export function loadConfig(): Loaded {
	if (cached) return cached;
	const raw = loadButlerConfig().agents;
	return (cached = raw === undefined ? { config: { features: Object.fromEntries(FEATURES.map((f) => [f, false])) as Record<Feature, boolean> }, problems: [] } : parseConfig(raw));
}
