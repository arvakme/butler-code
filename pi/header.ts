/** 启动横幅：Butler 睁开眼、挥挥手，然后停住；窄了退成字标或一行。画法在 banner.ts。 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { BOOT, bannerLines, centered, FRAME_MS } from "./banner.js";
import { clip } from "./format.js";

export function registerHeader(pi: ExtensionAPI): void {
	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		ctx.ui.setHeader((tui, theme) => {
			let frame = 0;
			// 只在开场动一下，动完就不再重画；横幅被换掉或会话结束时 dispose 会一并清掉 timer
			const timer = setInterval(() => {
				frame += 1;
				tui.requestRender();
				if (frame >= BOOT.length - 1) clearInterval(timer);
			}, FRAME_MS);
			timer.unref();
			const dress = { muted: (text: string) => theme.fg("muted", text), bold: (text: string) => theme.bold(text) };
			return {
				invalidate() {},
				dispose: () => clearInterval(timer),
				render: (width: number) =>
					centered(bannerLines(width, BOOT[Math.min(frame, BOOT.length - 1)], dress), width, visibleWidth).map((line) => clip(line, width, "end", "")),
			};
		});
	});
}
