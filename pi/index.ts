/**
 * Butler Code：基于 FireCode 的 Pi 定制层——我的界面（启动画面、状态栏、任务弹窗、主题），
 * FireCode 的工具渲染、指挥官子代理与对抗审查，以及我自己的后台能力（agents/）。
 * 各功能可在 config.jsonc 的 features 里单独关闭；所有能力都由会话 Agent 通过工具调用，不提供斜杠命令。
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type Feature, loadConfig } from "./config.js";
import { registerHeader } from "./header.js";
import { registerClaudeSub } from "./provider/claude-sub.js";
import { registerOpenAINative } from "./provider/openai-native/index.js";
import { registerHerdrDisplay } from "./session/herdr-display.js";
import { registerSessionName } from "./session/rename.js";
import { registerLinkSpace } from "./session/link-space.js";
import { registerUserMessage } from "./session/user-message.js";
import { registerStatusBar } from "./statusbar/index.js";
import { registerToolRendering } from "./tools/index.js";
import { registerReview } from "./review/index.js";
import { registerMaster } from "./master/index.js";
import { currentSubsessionRole, type SubsessionRole } from "./master/role.js";
import { registerRoundRecorder } from "./round-recorder.js";
import { registerTruncatedWriteGuard } from "./truncated-write.js";
import { registerAgents } from "./agents/index.js";

type SimpleFeature = Exclude<Feature, "review" | "master">;

const REGISTRARS: Record<SimpleFeature, (pi: ExtensionAPI) => void> = {
	header: registerHeader,
	statusbar: registerStatusBar,
	tools: registerToolRendering,
	rename: registerSessionName,
	userMessage: registerUserMessage,
	links: registerLinkSpace,
	claudeSub: registerClaudeSub,
	openaiNative: registerOpenAINative,
};

/** 只属于交互主会话的功能：子会话（子代理、审查者）没有界面，注册了只会白占资源。 */
const MAIN_ONLY = new Set<SimpleFeature>(["header", "statusbar", "tools", "rename", "userMessage", "links"]);

type SessionRole = "main" | SubsessionRole;

export function registerButler(pi: ExtensionAPI, role: SessionRole = "main"): void {
	const { config, problems, featuresBroken } = loadConfig();
	const subsession = role !== "main";
	// 轮记录不属于任何可关的功能：每个会话（含子代理）都写，界面、指挥官耗时与子代理视图都只读它。
	registerRoundRecorder(pi);
	registerTruncatedWriteGuard(pi);
	for (const [feature, register] of Object.entries(REGISTRARS) as [SimpleFeature, (pi: ExtensionAPI) => void][]) {
		if (config.features[feature] === false || (subsession && MAIN_ONLY.has(feature))) continue;
		register(pi);
	}
	if (config.features.master !== false) registerMaster(pi, {}, subsession);
	// herdr 显示投影没有开关：herdr 之外自我禁用，只写显示层。
	registerHerdrDisplay(pi, subsession);
	// 历史卡渲染与 checkpoint 收口不受 feature 开关控制；开关只控制工具和执行循环。
	// features 整节类型错误会被安全回退成全关，但那是配置坏而非用户关闭：不封存 checkpoint。
	registerReview(pi, config.features.review !== false, featuresBroken, {}, subsession ? "command" : "tool");
	registerAgents(pi, subsession);

	if (problems.length === 0) return;
	pi.on("session_start", (_event, ctx) => {
		ctx.ui.notify(`Butler 配置有问题：${problems.join("；")}`, "warning");
	});
}

export default function butler(pi: ExtensionAPI): void {
	registerButler(pi, currentSubsessionRole() ?? "main");
}
