import { readFileSync } from "node:fs";
import { parseJsonc } from "../../../jsonc.js";

const TEXT_VERBOSITIES = ["low", "medium", "high"] as const;

export type TextVerbosity = (typeof TEXT_VERBOSITIES)[number];

export type OpenAIProviderSettings = {
	textVerbosity?: TextVerbosity;
	priority?: true;
};

export type OpenAINativeSettings = {
	nativeCompaction: boolean;
	providers: Record<string, OpenAIProviderSettings>;
};

export type LoadedOpenAINativeSettings = {
	settings: OpenAINativeSettings;
	warnings: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isTextVerbosity(value: unknown): value is TextVerbosity {
	return typeof value === "string" && TEXT_VERBOSITIES.includes(value as TextVerbosity);
}

function createDefaultSettings(): OpenAINativeSettings {
	return {
		nativeCompaction: false,
		providers: {},
	};
}

function readConfig(configPath: string): Record<string, unknown> {
	const parsed = parseJsonc(readFileSync(configPath, "utf8"));
	if (!isRecord(parsed)) {
		throw new Error("expected a JSON object");
	}
	return parsed;
}

/** 只替换名为 key 的对象，文件其余部分（含注释）原样保留。 */
/** butler-ui/config.jsonc 用 `openai` 节；单测仍可用独立的 native 文件。 */
function openaiRoot(root: Record<string, unknown>): Record<string, unknown> {
	return isRecord(root.openai) ? root.openai : root;
}

function parseProviderSettings(
	provider: string,
	value: unknown,
	warnings: string[],
): OpenAIProviderSettings | undefined {
	if (!isRecord(value)) {
		warnings.push(`providers.${provider}: expected an object.`);
		return undefined;
	}

	const settings: OpenAIProviderSettings = {};
	if (value.textVerbosity !== undefined) {
		if (isTextVerbosity(value.textVerbosity)) {
			settings.textVerbosity = value.textVerbosity;
		} else {
			warnings.push(`providers.${provider}.textVerbosity: expected low, medium, or high.`);
		}
	}
	if (value.priority !== undefined) {
		if (typeof value.priority === "boolean") {
			if (value.priority) {
				settings.priority = true;
			}
		} else {
			warnings.push(`providers.${provider}.priority: expected a boolean.`);
		}
	}

	return Object.keys(settings).length > 0 ? settings : undefined;
}

function parseSettings(root: Record<string, unknown>): LoadedOpenAINativeSettings {
	const warnings: string[] = [];
	const settings = createDefaultSettings();
	if (root.nativeCompaction !== undefined) {
		if (typeof root.nativeCompaction === "boolean") {
			settings.nativeCompaction = root.nativeCompaction;
		} else {
			warnings.push("nativeCompaction: expected a boolean.");
		}
	}
	if (root.providers === undefined) {
		return { settings, warnings };
	}
	if (!isRecord(root.providers)) {
		warnings.push("providers: expected an object.");
		return { settings, warnings };
	}

	for (const [provider, value] of Object.entries(root.providers)) {
		if (!provider.trim()) {
			warnings.push("providers: provider name cannot be empty.");
			continue;
		}
		const providerSettings = parseProviderSettings(provider, value, warnings);
		if (providerSettings) {
			settings.providers[provider] = providerSettings;
		}
	}

	return { settings, warnings };
}

export function loadOpenAINativeSettings(configPath: string): LoadedOpenAINativeSettings {
	try {
		return parseSettings(openaiRoot(readConfig(configPath)));
	} catch (error) {
		return {
			settings: createDefaultSettings(),
			warnings: [`config.json: ${error instanceof Error ? error.message : String(error)}`],
		};
	}
}

export function providerSettings(
	settings: OpenAINativeSettings,
	provider: string | undefined,
): OpenAIProviderSettings | undefined {
	return provider ? settings.providers[provider] : undefined;
}
