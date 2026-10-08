/** 我自己的后台能力：哨兵、调研、未了事项、纠错本、输入预测与选择题。每个功能由配置开关打开，关掉任何一个不影响其余。 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { CONFIG_PATH } from "../config.js";
import { loadConfig } from "./config.js";
import { registerChoose } from "./choose/index.js";
import { registerPredict } from "./predict/index.js";
import { registerResearch } from "./research/index.js";
import { registerSentinel } from "./sentinel/index.js";
import { registerLessons } from "./lessons/index.js";
import { registerLoose } from "./loose/index.js";
import { mirrorReview } from "./firecode.js";

/** 子会话（指挥官派出的子代理、审查者）只读纠错本：它们也会犯同样的错；其余能力属于用户面对的主会话。 */
export function registerAgents(pi: ExtensionAPI, subsession: boolean): void {
	const { config, problems } = loadConfig();
	if (config.features.lessons && config.lessons) registerLessons(pi, config.lessons, subsession);
	if (subsession) return;
	mirrorReview(pi);
	if (config.features.sentinel && config.sentinel) registerSentinel(pi, config.sentinel);
	if (config.features.research && config.research) registerResearch(pi, config.research);
	if (config.features.predict && config.predict) registerPredict(pi, config.predict);
	if (config.features.choose && config.choose) registerChoose(pi, config.choose);
	if (config.features.loose && config.loose) registerLoose(pi, config.loose);

	if (problems.length === 0) return;
	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode === "tui") ctx.ui.notify(`配置的 agents 节有问题（${CONFIG_PATH}）：${problems.join("；")}`, "warning");
	});
}
