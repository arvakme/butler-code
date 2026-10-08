/** 会话名：没改过名的会话第一次提问时自动取所在文件夹名；手动改名用 Pi 自带的。 */
import { basename } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const MAX_TITLE_CHARS = 160;
const CONTROL_CHARS = /[\x00-\x1f\x7f-\x9f]/g;
const INVISIBLE_CHARS = /[\u200b-\u200f\u202a-\u202e\u2060-\u206f]/g;

function cleanTitle(raw: string): string {
	const title = raw
		.replace(CONTROL_CHARS, " ")
		.replace(INVISIBLE_CHARS, "")
		.replace(/\s+/g, " ")
		.trim();
	return Array.from(title).slice(0, MAX_TITLE_CHARS).join("");
}

export function registerSessionName(pi: ExtensionAPI): void {
	// 没改过名的会话，第一次提问时用所在文件夹的名字命名；放到第一次提问才做，空会话不会因此留下文件
	pi.on("agent_start", (_event, ctx) => {
		if (pi.getSessionName()) return;
		const name = cleanTitle(basename(ctx.cwd));
		if (name) pi.setSessionName(name);
	});

}
