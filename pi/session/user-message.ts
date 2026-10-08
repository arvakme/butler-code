/** 用户消息：不填底色，左边一道蓝竖条，文字用深蓝；没有通栏色块，也没有上下的空行。 */
import { type ExtensionAPI, type ExtensionUIContext, UserMessageComponent } from "@earendil-works/pi-coding-agent";
import { type Component, Markdown } from "@earendil-works/pi-tui";

const OWNER = Symbol.for("butler.user-message-bar");
const runtime = globalThis as typeof globalThis & { [OWNER]?: () => void };

class Bar implements Component {
	constructor(
		private readonly markdown: Markdown,
		private readonly margin: number,
		private readonly ui: ExtensionUIContext,
	) {}
	invalidate(): void {
		this.markdown.invalidate();
	}
	render(width: number): string[] {
		const lines = this.markdown.render(Math.max(1, width - this.margin - 2));
		const bar = `${" ".repeat(this.margin)}${this.ui.theme.fg("border", "▎")} `;
		return lines.map((line) => `${bar}${line}`);
	}
}

export function installUserMessageBar(ui: ExtensionUIContext): () => void {
	runtime[OWNER]?.();
	const prototype = UserMessageComponent.prototype as unknown as { rebuild: () => void };
	const original = prototype.rebuild;
	const rebuild = function (this: InstanceType<typeof UserMessageComponent>) {
		original.call(this);
		// 宿主以后换了结构就保持原样，不去猜
		const [child] = this.children;
		if (this.children.length !== 1 || !(child instanceof Markdown)) return;
		const style = child as unknown as { paddingX: number; paddingY: number; defaultTextStyle?: { bgColor?: unknown } };
		const margin = style.paddingX;
		style.paddingX = 0;
		style.paddingY = 0;
		style.defaultTextStyle = { ...style.defaultTextStyle, bgColor: undefined };
		this.children = [new Bar(child, margin, ui)];
	};
	prototype.rebuild = rebuild;
	const dispose = () => {
		if (runtime[OWNER] !== dispose) return;
		if (prototype.rebuild === rebuild) prototype.rebuild = original;
		delete runtime[OWNER];
	};
	runtime[OWNER] = dispose;
	return dispose;
}

export function registerUserMessage(pi: ExtensionAPI): void {
	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		installUserMessageBar(ctx.ui);
	});
	pi.on("session_shutdown", () => runtime[OWNER]?.());
}
