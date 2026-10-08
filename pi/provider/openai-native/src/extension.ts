import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { loadOpenAINativeSettings, type OpenAINativeSettings } from "./config";
import { compactWithOpenAINative } from "./native-compaction";
import { FAST_STATUS_KEY, fastModeEnabled, supportsFastMode } from "./options";
import { rewriteOpenAIProviderRequest } from "./request-pipeline";

const VERBOSITY_FLAG = "verbosity";

function updateFastStatus(ctx: ExtensionContext, settings: OpenAINativeSettings): void {
	if (!ctx.hasUI) {
		return;
	}
	ctx.ui.setStatus(
		FAST_STATUS_KEY,
		fastModeEnabled(ctx.model, settings) ? ctx.ui.theme.fg("warning", "⚡ fast") : undefined,
	);
}

export default function openAINativeExtension(
	pi: ExtensionAPI,
	configPath: string,
): void {
	const loadedSettings = loadOpenAINativeSettings(configPath);
	const settings = loadedSettings.settings;

	pi.registerFlag(VERBOSITY_FLAG, {
		description: "覆盖 OpenAI 回答详略：low、medium、high",
		type: "string",
	});

	pi.on("session_start", (_event, ctx) => {
		if (loadedSettings.warnings.length > 0 && ctx.hasUI) {
			ctx.ui.notify(`Butler UI openai 配置：${loadedSettings.warnings[0]}`, "warning");
		}
		updateFastStatus(ctx, settings);
	});

	pi.on("model_select", (_event, ctx) => updateFastStatus(ctx, settings));
	pi.on("session_before_compact", (event, ctx) => {
		if (!settings.nativeCompaction) {
			return undefined;
		}
		return compactWithOpenAINative(event, ctx);
	});
	pi.on("before_provider_request", (event, ctx) => {
		const nextPayload = rewriteOpenAIProviderRequest(event.payload, ctx, settings, pi.getFlag(VERBOSITY_FLAG));
		return nextPayload === event.payload ? undefined : nextPayload;
	});
	pi.on("session_shutdown", (_event, ctx) => {
		if (ctx.hasUI) {
			ctx.ui.setStatus(FAST_STATUS_KEY, undefined);
		}
	});
}
