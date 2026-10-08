/** Butler UI 配置：读取 Pi Agent 目录下的 `extensions/butler-ui/config.jsonc`。 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { parseJsonc } from "./jsonc.js";

export type Language = "zh" | "en";

export type ThinkingLevelValue =
	| "off"
	| "minimal"
	| "low"
	| "medium"
	| "high"
	| "xhigh"
	| "max";

/**
 * 模型原子：配置里一律写作 "provider/model/thinking"，解析后拆成运行时模型 id 与思考档。
 * 全仓库指定模型与思考档的唯一形状。
 */
export interface ModelAtom {
	model: string;
	thinking: ThinkingLevelValue;
}

/** /fire-review 配置：审查者 / 顾问模型 + 循环限制。见 config.jsonc 的 review 节注释。 */
export interface ReviewConfig {
	advisor: ModelAtom;
	reviewers: ModelAtom[];
	/** 审查轮数硬上限。 */
	maxRounds: number;
	/** 连续几轮失败触发顾问仲裁。 */
	advisorAfterFailures: number;
	/** 单个审查者 / 顾问会话超时（分钟）。 */
	timeoutMinutes: number;
	/** 审查者只读工具白名单。 */
	tools: string[];
	language: Language;
}

export interface MasterRole extends ModelAtom {
	role: string;
	use: string;
	fallback: ModelAtom[];
}

export interface MasterConfig {
	roles: MasterRole[];
	workerExcludeExtensions: string[];
	autoActivate: boolean;
}

/** tools 节：折叠态每轮最多显示几条中间回复（0 = 只留最后一条回复）。 */
export interface ToolsConfig {
	replyLines: number;
}

const DEFAULT_REPLY_LINES = 3;

export const FEATURES = [
	"header",
	"statusbar",
	"tools",
	"rename",
	"claudeSub",
	"openaiNative",
	"userMessage",
	"links",
	"review",
	"master",
] as const;

export type Feature = (typeof FEATURES)[number];

export interface ButlerUIConfig {
	features: Partial<Record<Feature, boolean>>;
	review: ReviewConfig;
	master: MasterConfig;
	tools: ToolsConfig;
}

/** 一节能否启动的唯一判定：要么交出可用配置，要么给出拒绝启动的原因。 */
export type Section<T> = { config: T } | { error: string };

export type LoadedConfig = {
	config: ButlerUIConfig;
	/** 需要在 session_start 全局警告的问题；关闭的功能那一节的问题不在其中。 */
	problems: string[];
	review: Section<ReviewConfig>;
	master: Section<MasterConfig>;
	/** features 整节类型错误：已安全回退成全关，但那是配置坏而非用户关闭。 */
	featuresBroken: boolean;
	/** agents 节原样交给 agents/config.ts 解析：后台能力的开关与模型和界面同在这一个文件里。 */
	agents: unknown;
};

export const CONFIG_PATH = join(getAgentDir(), "extensions", "butler-ui", "config.jsonc");

function readFile(problems: string[]): Record<string, unknown> {
	if (!existsSync(CONFIG_PATH)) {
		problems.push("config.jsonc 不存在，已关闭可选功能");
		return { features: Object.fromEntries(FEATURES.map((feature) => [feature, false])) };
	}
	try {
		const parsed: unknown = parseJsonc(readFileSync(CONFIG_PATH, "utf8"));
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
			problems.push("config.jsonc 顶层必须是对象");
			return {};
		}
		return parsed as Record<string, unknown>;
	} catch (error) {
		// 统一前缀：文件级故障必须能被调用方识别并阻断功能，
		// 不能因为消息文本不带节名就被当成无关问题过滤掉。
		const message = error instanceof Error ? error.message : String(error);
		problems.push(`config.jsonc 解析失败：${message}`);
		return {};
	}
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

/** 嵌套对象也做键白名单：拼写错误必须报出来，不能静默回退默认值。 */
function rejectUnknownKeys(
	record: Record<string, unknown>,
	allowed: readonly string[],
	field: string,
	problems: string[],
) {
	for (const key of Object.keys(record))
		if (!allowed.includes(key)) problems.push(`未知字段 ${field}.${key}`);
}

function booleanValue(value: unknown, field: string, fallback: boolean, problems: string[]): boolean {
	if (value === undefined) return fallback;
	if (typeof value === "boolean") return value;
	problems.push(`${field} 必须是 true 或 false`);
	return fallback;
}

function stringValue(value: unknown, field: string, problems: string[]): string | undefined {
	if (typeof value === "string" && value) return value;
	problems.push(`${field} 必须是非空字符串`);
	return undefined;
}

function stringArray(value: unknown, field: string, problems: string[]): string[] {
	if (value === undefined) return [];
	if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item)) {
		problems.push(`${field} 必须是非空字符串数组`);
		return [];
	}
	return [...new Set(value)];
}

function checkFeatures(features: Record<string, unknown>, problems: string[]): void {
	for (const [key, value] of Object.entries(features)) {
		if (!FEATURES.includes(key as Feature)) {
			problems.push(`未知开关 features.${key}，可用：${FEATURES.join(" / ")}`);
			continue;
		}
		// 开关只能是布尔：写成字符串 "false" 时因为 `!== false` 仍会启用，
		// 不能把类型错误当成用户授权启用功能。
		if (typeof value !== "boolean")
			problems.push(`features.${key} 必须是 true 或 false`);
	}
}

let cached: LoadedConfig | undefined;

export function loadConfig(): LoadedConfig {
	if (cached) return cached;

	// 文件级与开关级问题阻断所有付费功能：开关写成字符串 "false" 时 `!== false` 仍会启用。
	const blocking: string[] = [];
	const raw = readFile(blocking);
	// features 省略表示沿用默认全开；只要显式写了，就必须是对象。
	// 非对象不能回退成 {}，因为 {} 在入口语义里正是「全部启用」。
	const featuresBroken = raw.features !== undefined && !isPlainObject(raw.features);
	if (featuresBroken) blocking.push("features 必须是对象");
	const features: Partial<Record<Feature, boolean>> = featuresBroken
		? Object.fromEntries(FEATURES.map((feature) => [feature, false]))
		: asRecord(raw.features);
	checkFeatures(features, blocking);

	const problems = [...blocking];
	if (raw.tools !== undefined && !isPlainObject(raw.tools)) problems.push("tools 必须是对象");
	const tools = parseToolsConfig(asRecord(raw.tools), problems);

	// review / master 有问题时对应功能拒绝启动：静默补齐会拿用户没选的模型真实发起调用。
	// 节内问题只在功能开启时进全局警告。
	const section = <T>(
		name: "review" | "master",
		label: string,
		parse: (record: Record<string, unknown>, problems: string[]) => T,
		incomplete: (config: T) => string | undefined,
	): { config: T; verdict: Section<T> } => {
		const own: string[] = [];
		if (raw[name] !== undefined && !isPlainObject(raw[name])) own.push(`${name} 必须是对象`);
		const config = parse(asRecord(raw[name]), own);
		if (features[name] !== false) problems.push(...own);
		const reasons = [...blocking, ...own];
		const missing = reasons.length ? undefined : incomplete(config);
		if (missing) reasons.push(missing);
		return { config, verdict: reasons.length ? { error: `${label}配置有问题，已停止：${reasons.join("；")}` } : { config } };
	};
	const review = section("review", "审查", parseReviewConfig, (config) =>
		config.advisor.model && config.reviewers.length ? undefined : "请显式完整配置 review");
	const master = section("master", "指挥官", parseMasterConfig, (config) =>
		config.roles.length ? undefined : "请在 master.roles 至少配置一个角色");

	cached = {
		config: { features, review: review.config, master: master.config, tools },
		problems,
		review: review.verdict,
		master: master.verdict,
		featuresBroken,
		agents: raw.agents,
	};
	return cached;
}

// ---- 模型原子 ----

const THINKING_LEVELS = new Set<ThinkingLevelValue>([
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
]);
const FALLBACK_THINKING: ThinkingLevelValue = "medium";

/**
 * 解析 "provider/model/thinking"：按最后一个斜杠切出思考档，前半必须仍是 provider/model。
 * 任何位置的模型配置都走这里，解析失败只记录问题并留空模型，让上层拒绝启动。
 * 每个字段只报一条问题，且必带目标形状——两段式旧写法会同时踩中两项校验，逐项报错说不出该改成什么。
 * 旧的分字段与两段式写法一律拒绝、不做兼容：兼容层会把三种写法固化成三套事实源。
 */
export function parseModelAtom(value: unknown, field: string, problems: string[]): ModelAtom {
	const shape = `${field} 必须是“provider/model/thinking”字符串`;
	if (typeof value !== "string" || !value) {
		problems.push(shape);
		return { model: "", thinking: FALLBACK_THINKING };
	}
	const slash = value.lastIndexOf("/");
	const model = slash > 0 ? value.slice(0, slash) : "";
	const thinking = slash > 0 ? value.slice(slash + 1) : value;
	const providerSlash = model.indexOf("/");
	const valid = THINKING_LEVELS.has(thinking as ThinkingLevelValue);
	const faults: string[] = [];
	if (providerSlash <= 0 || providerSlash === model.length - 1)
		faults.push(`模型段不是 provider/model：${model || value}`);
	if (!valid) faults.push(`思考档无效：${thinking}`);
	if (faults.length) problems.push(`${shape}（${faults.join("；")}）`);
	return { model, thinking: valid ? (thinking as ThinkingLevelValue) : FALLBACK_THINKING };
}

// ---- review 节 ----

const REVIEW_KEYS = new Set([
	"advisor",
	"reviewers",
	"maxRounds",
	"advisorAfterFailures",
	"timeoutMinutes",
	"tools",
	"language",
]);
const DEFAULT_TOOLS = ["read", "grep", "find", "ls", "bash"];
const LANGUAGES = new Set<Language>(["zh", "en"]);

/** 导出供测试：严格拒绝未知字段（含嵌套），类型错误一律记录而非静默回退。 */
export function parseReviewConfig(raw: Record<string, unknown>, problems: string[]): ReviewConfig {
	for (const key of Object.keys(raw)) {
		if (REVIEW_KEYS.has(key)) continue;
		problems.push(key === "background"
			? "review.background 已随审查子进程层删除，请直接移除该键"
			: `未知字段 review.${key}`);
	}
	// advisor 与 reviewers 缺失由模型原子解析自己报形状，不再叠一条泛化的“必须显式配置”。
	for (const key of REVIEW_KEYS)
		if (key !== "advisor" && key !== "reviewers" && !(key in raw))
			problems.push(`review.${key} 必须显式配置`);
	const advisor = parseModelAtom(raw.advisor, "review.advisor", problems);
	const reviewers = reviewModels(raw.reviewers, problems);
	return {
		advisor,
		reviewers,
		maxRounds: reviewInt(raw.maxRounds, "review.maxRounds", 5, 1, 10, problems),
		advisorAfterFailures: reviewInt(raw.advisorAfterFailures, "review.advisorAfterFailures", 2, 1, 5, problems),
		timeoutMinutes: reviewInt(raw.timeoutMinutes, "review.timeoutMinutes", 20, 1, 60, problems),
		tools: reviewTools(raw.tools, problems),
		language: reviewLanguage(raw.language, problems),
	};
}

function reviewModels(value: unknown, problems: string[]): ModelAtom[] {
	if (!Array.isArray(value) || value.length === 0 || value.length > 5) {
		problems.push("review.reviewers 必须包含 1–5 个模型原子");
		return [];
	}
	return value.map((item, index) => parseModelAtom(item, `review.reviewers[${index}]`, problems));
}

function reviewInt(
	value: unknown,
	field: string,
	fallback: number,
	min: number,
	max: number,
	problems: string[],
): number {
	if (value === undefined) return fallback;
	if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
		problems.push(`${field} 必须是 ${min}–${max} 的整数`);
		return fallback;
	}
	return value;
}

function reviewTools(value: unknown, problems: string[]): string[] {
	if (value === undefined) return [...DEFAULT_TOOLS];
	if (!Array.isArray(value)) {
		problems.push("review.tools 必须是字符串数组");
		return [...DEFAULT_TOOLS];
	}
	const tools = value.filter((item): item is string => typeof item === "string" && item.length > 0);
	if (tools.length !== value.length || tools.length === 0)
		problems.push("review.tools 必须是非空字符串数组");
	return tools.length > 0 ? tools : [...DEFAULT_TOOLS];
}

// ---- master 节 ----

/** 导出供测试：与 review 节同样严格拒绝未知字段，类型错误记录而非静默回退。 */
export function parseMasterConfig(raw: Record<string, unknown>, problems: string[]): MasterConfig {
	for (const key of Object.keys(raw))
		if (key !== "roles" && key !== "workerExcludeExtensions" && key !== "autoActivate")
			problems.push(`未知字段 master.${key}`);
	const exclusions = stringArray(raw.workerExcludeExtensions, "master.workerExcludeExtensions", problems);
	const autoActivate = booleanValue(raw.autoActivate, "master.autoActivate", true, problems);
	if (raw.roles === undefined)
		return { roles: [], workerExcludeExtensions: exclusions, autoActivate };
	if (!isPlainObject(raw.roles) || Object.keys(raw.roles).length === 0) {
		problems.push("master.roles 必须是至少包含一个角色的对象");
		return { roles: [], workerExcludeExtensions: exclusions, autoActivate };
	}
	const roles = Object.entries(raw.roles).map(([role, value]) =>
		masterRole(value, `master.roles.${role}`, role, problems));
	return { roles, workerExcludeExtensions: exclusions, autoActivate };
}

function masterRole(value: unknown, field: string, role: string, problems: string[]): MasterRole {
	const record = asRecord(value);
	rejectUnknownKeys(record, ["model", "use", "fallback"], field, problems);
	const atom = parseModelAtom(record.model, `${field}.model`, problems);
	const use = typeof record.use === "string" && record.use ? record.use : "";
	if (!use) problems.push(`${field}.use 必须是非空字符串`);
	const fallback = masterFallback(record.fallback, `${field}.fallback`, problems);
	return { role, ...atom, use, fallback };
}

function masterFallback(value: unknown, field: string, problems: string[]): ModelAtom[] {
	if (value === undefined) return [];
	if (!Array.isArray(value) || value.length > 2) {
		problems.push(`${field} 必须是至多 2 项的数组`);
		return [];
	}
	return value.map((item, index) => parseModelAtom(item, `${field}[${index}]`, problems));
}

// ---- tools 节 ----

function parseToolsConfig(raw: Record<string, unknown>, problems: string[]): ToolsConfig {
	rejectUnknownKeys(raw, ["replyLines"], "tools", problems);
	const value = raw.replyLines;
	if (value === undefined) return { replyLines: DEFAULT_REPLY_LINES };
	if (typeof value === "number" && Number.isInteger(value) && value >= 0) return { replyLines: value };
	problems.push("tools.replyLines 必须是非负整数");
	return { replyLines: DEFAULT_REPLY_LINES };
}


function reviewLanguage(value: unknown, problems: string[]): Language {
	if (value === undefined) return "zh";
	if (typeof value !== "string" || !LANGUAGES.has(value as Language)) {
		problems.push("review.language 必须是 zh 或 en");
		return "zh";
	}
	return value as Language;
}
