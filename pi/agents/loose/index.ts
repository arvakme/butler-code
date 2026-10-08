/** loose：未了事项。用户提的要求、我答应过“待会做”的事，压缩上下文或用户忘了也不会丢：
 *  记在上下文之外的账本里（每个会话一份），每次运行前把没做完的放进系统提示，输入框上方显示数量，每轮结束和用户回来时提醒，放久了交给 notify 命令。
 *  两路来源：我自己用 loose 工具记；便宜的模型定时（和压缩上下文之前）翻对话找漏的，找到的先是“候选”，等用户确认才算数。 */
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { type ExtensionAPI, type ExtensionContext, getAgentDir } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { LooseConfig } from "../config.js";
import { type JobItem, jobs } from "../jobs.js";
import { scan, triage } from "./scan.js";
import { type Signal, gather } from "./signals.js";
import { BATCH, BATCH_HEAD, type Book, FOREVER, HOUR, type Item, type Suggest, addItem, age, batchPrompt, bookPath, dropBookIfEmpty, dueForEscalation, dueForReminder, live, loadBook, nextBatch, pruneBooks, pruneMutes, pushRecent, resolve, saveBook, setStatus, settleBatch, startQueue, unmuted } from "./store.js";

const USAGE = "ref 写编号（如 t3）或这件事里一段独特的文字。";
const MIN = 60_000;

export function registerLoose(pi: ExtensionAPI, config: LooseConfig): void {
	let file = "";
	let project = "";
	let book: Book = { counter: 0, items: [] };
	let latest: ExtensionContext | undefined;
	let turns = 0;
	let scanning = false;
	let lastActive = Date.now();
	let timer: ReturnType<typeof setInterval> | undefined;

	const open = () => book.items.filter((item) => item.status === "open");
	const candidates = () => book.items.filter((item) => item.status === "candidate");
	const line = (item: Item, now = Date.now()) => `${item.status === "candidate" ? "？" : "○"} ${item.id}  ${item.text}（${age(item.created, now)}${item.status === "candidate" ? "，待你确认" : ""}）`;
	const save = () => file && saveBook(file, book);

	let alerts: Signal[] = [];
	let rawAlerts: Signal[] = [];
	const alertedAt = new Map<string, number>();
	const alertSuggest = new Map<string, Suggest>();
	let tidying = false;
	let session: ReturnType<ReturnType<typeof jobs>["start"]> | undefined;
	/** 弹窗里的“要你处理的事”：待确认的、没做完的、机器上的提醒；每条自带能按的按钮，按键或点击都走 act */
	const GO = { key: "g", label: "去做", close: true };
	const SUGGEST_GROUP = { go: "建议去做", ignore: "建议忽略", ask: "要你定" } as const;
	const GROUP_ORDER: string[] = [SUGGEST_GROUP.go, SUGGEST_GROUP.ignore, SUGGEST_GROUP.ask];
	const itemsOf = (now: number): JobItem[] => {
		const raw: JobItem[] = [
			...candidates().map((item): JobItem => ({ id: item.id, text: item.text, tag: "待确认", age: age(item.created, now), tone: "warning", actions: [GO, { key: "x", label: "忽略" }] })),
			...open().map((item): JobItem => ({ id: item.id, text: item.text, tag: "待办", age: age(item.created, now), tone: "accent", actions: [GO, { key: "x", label: "忽略" }] })),
			...alerts.map((a): JobItem => ({ id: `alert:${a.key}`, text: a.text, tag: "提醒", age: age(a.since, now), tone: "warning", actions: [GO, { key: "x", label: "忽略" }] })),
		];
		const suggestOf = (id: string) => (id.startsWith("alert:") ? alertSuggest.get(id.slice(6)) : book.items.find((item) => item.id === id)?.suggest);
		const tagged = raw.map((item) => {
			const s = suggestOf(item.id);
			return s ? { ...item, group: SUGGEST_GROUP[s.kind], hint: s.why } : item;
		});
		const anySuggest = tagged.some((item) => item.group);
		if (!anySuggest && tagged.length > BATCH) return tagged.map((item) => ({ ...item, group: item.tag })); // 积压多了，至少按类别分开
		const rank = (item: JobItem) => (item.group ? GROUP_ORDER.indexOf(item.group) : 9);
		return anySuggest ? tagged.map((item, i) => ({ item, i })).sort((x, y) => rank(x.item) - rank(y.item) || x.i - y.i).map(({ item }) => ({ ...item, group: item.group ?? "还没整理" })) : tagged;
	};
	/** 每一条只有两个动作：去做（把它交给 Pi，立刻开始）和忽略（不再提）。 */
	const press = (id: string, key: string) => {
		if (id === "") return toolPress(key);
		const now = Date.now();
		if (id.startsWith("alert:")) {
			const alertKey = id.slice(6);
			const signal = rawAlerts.find((a) => a.key === alertKey);
			if (key === "g" && signal) {
				pi.sendUserMessage(`用户在哨兵里对这条提醒点了「去做」：${signal.text}。${signal.go}`, { deliverAs: "followUp" });
				book.mutes = { ...(book.mutes ?? {}), [alertKey]: now + 2 * HOUR }; // 交给 Pi 了，两小时内不再提；那时事情办完了它自己就不在了
			} else if (key === "x") book.mutes = { ...(book.mutes ?? {}), [alertKey]: FOREVER };
			alerts = unmuted(rawAlerts, book.mutes, now);
			save();
			sync();
			return;
		}
		const item = book.items.find((entry) => entry.id === id);
		if (!item) return;
		if (key === "g") {
			if (item.status === "candidate") setStatus(item, "open", now);
			item.remindedAt = now;
			pi.sendUserMessage(`用户在哨兵里对这件事点了「去做」：${item.id} ${item.text}。现在就去做，做完用 loose 工具的 done 标成完成；需要用户拍板的再问。`, { deliverAs: "followUp" });
			save();
			sync();
		} else if (key === "x") act("drop", id);
	};
	/** 内置的“会话哨兵”：任务行里只有一个，平时安静地算在哨兵的数量里；有没做完的事或客观提醒时才占一行 */
	const sync = () => {
		const now = Date.now();
		const pending = open();
		const guesses = candidates();
		const items = itemsOf(now);
		const quiet = items.length === 0;
		const queue = book.queue;
		const batches = queue ? Math.ceil(queue.total / queue.size) : 0;
		const sent = queue ? batches - Math.ceil(queue.ids.length / queue.size) : 0;
		const relay = queue ? `分批处理：第 ${Math.max(1, sent)}/${batches} 批，已做完 ${queue.done}/${queue.total} 条${queue.paused ? "（已暂停）" : ""}` : "";
		const detail = relay || (tidying ? "正在整理积压…" : quiet ? "没有没做完的事" : [pending.length ? `${pending.length} 件事没做完` : "", guesses.length ? `${guesses.length} 件待确认` : "", alerts.length ? `${alerts.length} 条提醒` : ""].filter(Boolean).join("，"));
		const task = "盯着这个会话里没做完的事，和机器上放着没动的东西。下面每一条都能直接处理：数字键或点选中它，再按按钮上的字母或点按钮。";
		const tools: { key: string; label: string }[] = [];
		if (items.length >= 3) tools.push({ key: "t", label: tidying ? "整理中…" : "整理" });
		if (items.some((item) => item.hint)) tools.push({ key: "y", label: "照建议处理" });
		if (queue) tools.push({ key: "p", label: queue.paused ? "继续接力" : "暂停接力" }, { key: "s", label: "停止接力" });
		const hidden = quiet && !queue && !tidying;
		const patch = { detail, task, quiet: hidden, items, act: press, actMany: pressMany, tools, state: hidden ? ("running" as const) : queue && !queue.paused ? ("running" as const) : ("waiting" as const) };
		if (!session) session = jobs().start({ id: "sentinel-session", role: "哨兵", title: "会话", model: "只在翻对话找漏掉的事、整理积压时用模型", ...patch });
		else session.update(patch);
	};
	const refreshSignals = async (ctx: ExtensionContext) => {
		try {
			rawAlerts = await gather(ctx.cwd);
			const now = Date.now();
			const kept = pruneMutes(book.mutes, rawAlerts.map((a) => a.key), now);
			if (Object.keys(kept).length !== Object.keys(book.mutes ?? {}).length) {
				book.mutes = kept;
				save();
			}
			alerts = unmuted(rawAlerts, book.mutes, now);
			sync();
		} catch {
			/* 查不到就当没有，不影响用户 */
		}
	};
	const refresh = (ctx: ExtensionContext) => {
		latest = ctx;
		const path = bookPath(ctx.sessionManager.getSessionId(), getAgentDir());
		if (path !== file) file = path;
		project = basename(ctx.cwd);
		book = loadBook(file);
		sync();
	};

	function tell(ctx: ExtensionContext, text: string, level: "info" | "warning" = "info") {
		ctx.ui.notify(text, level);
	}
	/** 放太久的交给 notify 命令（比如推到手机）；配置成 "pi" 就不转 */
	function escalateText(text: string) {
		if (config.notify === "pi") return;
		const [command, ...args] = config.notify;
		const child = spawn(command, args, { stdio: ["pipe", "ignore", "ignore"] });
		child.on("error", () => undefined);
		child.stdin.end(`${text}\n（项目：${project}）`);
	}
	function escalate(items: Item[]) {
		if (config.notify === "pi" || items.length === 0) return;
		const now = Date.now();
		escalateText(`还有 ${items.length} 件事放了很久没做完\n${items.slice(0, 8).map((item) => `${item.text}（${age(item.created, now)}）`).join("\n")}${items.length > 8 ? `\n…还有 ${items.length - 8} 件，回到 Pi 里按 t 整理` : ""}`);
		items.forEach((item) => (item.escalatedAt = now));
		save();
	}

	// ───── 积压：整理 + 分批接力 ─────
	const MUTE_DAY = 24 * HOUR;
	const alertKey = (id: string) => id.slice(6);
	/** 忽略一批（清单里的划掉，提醒类静音）；不保存，由调用方统一 save + sync */
	function dropMany(ids: string[], now: number, note?: string): number {
		let n = 0;
		for (const id of ids) {
			if (id.startsWith("alert:")) {
				book.mutes = { ...(book.mutes ?? {}), [alertKey(id)]: FOREVER };
				n++;
				continue;
			}
			const item = book.items.find((entry) => entry.id === id && live(entry));
			if (item) (setStatus(item, "dropped", now, note), n++);
		}
		alerts = unmuted(rawAlerts, book.mutes, now);
		return n;
	}
	function pressMany(ids: string[], key: string) {
		const now = Date.now();
		if (key === "x") {
			dropMany(ids, now);
			save();
			sync();
		} else if (key === "g") startRelay(ids);
	}
	function toolPress(key: string) {
		if (key === "t") {
			if (latest) void tidy(latest);
		} else if (key === "y") applySuggestions();
		else if (key === "p") book.queue?.paused ? resume() : pause();
		else if (key === "s") stopRelay();
	}
	/** 把一批事项交给主 Agent：分批（每批 BATCH 条），每批是一条结构化的话，做完一批再发下一批。已经在接力就把新的接在后面。 */
	function startRelay(ids: string[]) {
		const now = Date.now();
		const alertIds = ids.filter((id) => id.startsWith("alert:") && rawAlerts.some((a) => `alert:${a.key}` === id));
		const q = book.queue;
		if (q) {
			const known = new Set([...q.ids, ...q.current]);
			const fresh = ids.filter((id) => !known.has(id) && (id.startsWith("alert:") ? alertIds.includes(id) : book.items.some((item) => item.id === id && live(item))));
			q.ids.push(...fresh);
			q.total += fresh.length;
		} else if (startQueue(book, ids, BATCH, now, alertIds).total === 0) {
			book.queue = undefined;
			return;
		}
		book.queue!.paused = false;
		dispatch();
	}
	function dispatch() {
		const q = book.queue;
		if (!q || q.paused || q.current.length) return;
		const now = Date.now();
		for (;;) {
			const ids = nextBatch(q);
			if (!ids.length) return finishRelay();
			const batch = ids.flatMap((id) => {
				if (id.startsWith("alert:")) {
					const signal = rawAlerts.find((a) => `alert:${a.key}` === id);
					if (!signal) return [];
					book.mutes = { ...(book.mutes ?? {}), [signal.key]: now + 2 * HOUR };
					return [{ id, text: signal.text, go: signal.go }];
				}
				const item = book.items.find((entry) => entry.id === id && live(entry));
				if (!item) return [];
				if (item.status === "candidate") setStatus(item, "open", now);
				item.remindedAt = now;
				return [{ id: item.id, text: item.text }];
			});
			if (!batch.length) {
				q.current = [];
				continue; // 这一批的事都已经不在了，直接下一批
			}
			q.current = batch.map((entry) => entry.id);
			const n = Math.ceil(q.total / q.size);
			const k = n - Math.ceil(q.ids.length / q.size);
			alerts = unmuted(rawAlerts, book.mutes, now);
			save();
			sync();
			pi.sendUserMessage(batchPrompt(batch, k, n), { deliverAs: "followUp" });
			return;
		}
	}
	function finishRelay() {
		const q = book.queue;
		book.queue = undefined;
		save();
		sync();
		if (!q) return;
		const text = `这一轮分批处理完了：共 ${q.total} 条，做完 ${q.done} 条${q.failed ? `，${q.failed} 条没做成（还留在清单里，要你看一眼）` : ""}。`;
		if (latest) tell(latest, text);
		if (q.total >= BATCH) escalateText(text);
	}
	function pause() {
		if (!book.queue) return;
		book.queue.paused = true;
		save();
		sync();
		if (latest) tell(latest, "分批处理暂停了。按 Ctrl+\\ 打开哨兵弹窗，按 p 继续、s 放弃剩下的。");
	}
	function resume() {
		if (!book.queue) return;
		book.queue.paused = false;
		save();
		sync();
		dispatch();
	}
	function stopRelay() {
		const q = book.queue;
		if (!q) return;
		book.queue = undefined;
		save();
		sync();
		if (latest) tell(latest, `停止了分批处理：做完 ${q.done} 条，剩下 ${q.ids.length + q.current.length} 条还在清单里。`);
	}
	/** 一批做完（Pi 这一轮结束）：清点，再发下一批 */
	function onSettled() {
		const q = book.queue;
		if (!q || q.current.length === 0) return;
		settleBatch(book);
		save();
		if (q.paused) return sync();
		dispatch();
	}
	/** 照建议处理：建议忽略的划掉，建议去做的分批交给 Pi，“要你定”的不动 */
	function applySuggestions() {
		const now = Date.now();
		const ids = (kind: Suggest["kind"]) => [
			...book.items.filter((item) => live(item) && item.suggest?.kind === kind).map((item) => item.id),
			...alerts.filter((a) => alertSuggest.get(a.key)?.kind === kind).map((a) => `alert:${a.key}`),
		];
		const ignore = ids("ignore");
		const go = ids("go");
		const dropped = dropMany(ignore, now, "照整理的建议忽略");
		save();
		sync();
		if (latest) tell(latest, `照建议处理：忽略 ${dropped} 条，交给 Pi ${go.length} 条${go.length > BATCH ? `（分 ${Math.ceil(go.length / BATCH)} 批）` : ""}，要你定的留着。`);
		if (go.length) startRelay(go);
	}
	/** 整理积压：便宜的模型对照对话判断每一条还要不要做。能明确判断做完了/过时了/重复的直接处理（留记录，清单里能看到，跟我说一声就能重新打开）；其余给建议，等你确认。 */
	async function tidy(ctx: ExtensionContext) {
		if (tidying) return;
		tidying = true;
		sync();
		try {
			const now = Date.now();
			const { triage: result, raw } = await triage(ctx, config, ctx.sessionManager.getBranch(), book.items, rawAlerts.map((a) => ({ key: a.key, text: a.text, age: age(a.since, now) })), now, AbortSignal.timeout(90_000));
			if (!result) {
				const saved = join(dirname(file), "last-triage-failure.txt");
				try {
					writeFileSync(saved, raw || "（模型没有返回任何内容）");
				} catch {}
				const failure = raw.split("\n").find((l) => l.startsWith("[error]"));
				return void tell(ctx, failure ? `整理没成功：模型调用出错——${failure.slice(8, 200)}。清单没动。` : `整理没成功：试了两次，模型都没给出能读懂的结果，清单没动。它的原话存在 ${saved}`, "warning");
			}
			const closed: string[] = [];
			for (const c of result.closed) {
				const id = c.id;
				if (id.startsWith("alert:")) {
					const signal = rawAlerts.find((a) => `alert:${a.key}` === id);
					if (!signal) continue;
					book.mutes = { ...(book.mutes ?? {}), [signal.key]: now + MUTE_DAY };
					pushRecent(book, { id, text: signal.text, why: c.reason, kind: c.kind, at: now });
					closed.push(signal.text);
					continue;
				}
				const item = book.items.find((entry) => entry.id === id && live(entry));
				if (!item) continue;
				setStatus(item, c.kind === "done" ? "done" : "dropped", now, `自动整理：${c.reason}`);
				pushRecent(book, { id, text: item.text, why: c.reason, kind: c.kind, at: now });
				closed.push(item.text);
			}
			alerts = unmuted(rawAlerts, book.mutes, now);
			const counts = { go: 0, ignore: 0, ask: 0 };
			for (const s of result.suggest) {
				if (s.id.startsWith("alert:")) {
					if (!alerts.some((a) => `alert:${a.key}` === s.id)) continue;
					alertSuggest.set(alertKey(s.id), { kind: s.kind, why: s.why });
				} else {
					const item = book.items.find((entry) => entry.id === s.id && live(entry));
					if (!item) continue;
					item.suggest = { kind: s.kind, why: s.why };
				}
				counts[s.kind]++;
			}
			save();
			sync();
			tell(ctx, `整理完了：自动划掉 ${closed.length} 条（做完了、过时了或重复；不对跟我说，我重新打开）；建议去做 ${counts.go}、建议忽略 ${counts.ignore}、要你定 ${counts.ask}。在哨兵弹窗按 y 照建议处理，或勾选后自己决定。`);
		} finally {
			tidying = false;
			sync();
		}
	}

	async function look(ctx: ExtensionContext, entries: any[], signal?: AbortSignal) {
		if (scanning) return;
		scanning = true;
		try {
			const result = await scan(ctx, config, entries, book.items, signal);
			if (!result) return;
			const now = Date.now();
			let found = 0;
			for (const text of result.candidates) if (addItem(book, text, "scan", now).added) found++;
			const closed: Item[] = [];
			for (const done of result.finished) {
				const item = book.items.find((entry) => entry.id === done.id && live(entry));
				if (item) (setStatus(item, "done", now, `自动判断做完了：${done.evidence}`), closed.push(item));
			}
			for (const o of result.obsolete) {
				const item = book.items.find((entry) => entry.id === o.id && live(entry));
				if (!item) continue;
				setStatus(item, "dropped", now, `自动判断过时了：${o.reason}`);
				pushRecent(book, { id: item.id, text: item.text, why: o.reason, kind: "obsolete", at: now });
				closed.push(item);
			}
			if (found || closed.length) {
				save();
				sync();
				if (found) tell(ctx, `我从对话里翻出 ${found} 件可能还没做完的事，等你确认：\n${candidates().map((item) => line(item, now)).join("\n")}\n跟我说哪些要做、哪些不要。`);
				if (closed.length) tell(ctx, `看起来已经做完或过时了，我帮你划掉了：${closed.map((item) => item.text).join("；")}（不对的话跟我说，我重新打开）`);
			}
		} finally {
			scanning = false;
		}
	}

	const summary = (items: Item[], now = Date.now(), cap = 5) => `${items.slice(0, cap).map((item) => line(item, now)).join("\n")}${items.length > cap ? `\n…还有 ${items.length - cap} 件（点输入框上方的任务行或按 Ctrl+\\ 看全部）` : ""}`;

	pi.on("session_start", (_event, ctx) => {
		refresh(ctx);
		pruneBooks(getAgentDir(), file, Date.now());
		lastActive = Date.now();
		const pending = book.items.filter(live);
		if (book.queue) {
			// 上次的分批处理被打断了：没交代清的那一批放回队首，暂停，等用户说继续
			book.queue.ids = [...book.queue.current, ...book.queue.ids];
			book.queue.current = [];
			book.queue.paused = true;
			save();
			sync();
			tell(ctx, `上次的分批处理停在半路：还剩 ${book.queue.ids.length} 条，已做完 ${book.queue.done} 条。按 Ctrl+\\ 打开哨兵弹窗，按 p 继续、s 放弃。`);
		} else if (pending.length > BATCH) tell(ctx, `上次留下 ${pending.length} 件事没做完，有点多。按 Ctrl+\\ 打开哨兵弹窗按 t 整理一遍（划掉已经做完或过时的，其余给建议）。`);
		else if (pending.length) tell(ctx, `上次留下 ${pending.length} 件事没做完：\n${summary(pending)}`);
		void refreshSignals(ctx);
		timer ??= setInterval(() => {
			const now = Date.now();
			escalate(dueForEscalation(book, now, config.staleHours * HOUR));
			const stale = alerts.filter((a) => now - a.since >= config.staleHours * HOUR && now - (alertedAt.get(`esc:${a.key}`) ?? 0) >= 24 * HOUR);
			if (stale.length) {
				stale.forEach((a) => alertedAt.set(`esc:${a.key}`, now));
				escalateText(`还有 ${stale.length} 件事放了很久\n${stale.map((a) => `${a.text}（${age(a.since, now)}）`).join("\n")}`);
			}
			if (latest) void refreshSignals(latest);
		}, 10 * MIN);
		timer.unref?.();
	});
	pi.on("session_shutdown", () => {
		if (file) dropBookIfEmpty(file, book);
		session?.discard();
		session = undefined;
		if (timer) timer = void clearInterval(timer);
	});

	// 每次运行前，把没做完的放进系统提示：压缩上下文之后我也还看得见
	pi.on("before_agent_start", (event, ctx) => {
		refresh(ctx);
		const pending = book.items.filter(live);
		if (!pending.length) return;
		const text = `## 未了事项（用户要求或你答应过、还没做完的事；记在上下文之外，压缩也不会丢）\n${pending.map((item) => `- ${item.id}${item.status === "candidate" ? "（候选：后台扫描猜的，用户还没确认）" : ""}：${item.text}`).join("\n")}\n做完一项就调用 loose 工具的 done；之后又答应了新的事，或用户提了这一轮做不完的要求，就调用 add。每次回复用户之前先对照一遍这张清单：对话里已经做完的，调用 done；因为后来的进展不用再做、或和别的重复的，调用 drop 并写一句原因；这些由你自己清理，不要留给用户。只有真正拿不准、而且需要用户拍板的候选才问用户，不要凭候选自己动手做大事。`;
		event.systemPromptOptions.sections = { ...event.systemPromptOptions.sections, loose: text };
	});

	pi.on("input", (event, ctx) => {
		const now = Date.now();
		const own = event.source === "extension" || event.text.startsWith(BATCH_HEAD) || event.text.startsWith("用户在哨兵里对这");
		if (!own && book.queue && book.queue.current.length && !book.queue.paused) {
			book.queue.paused = true; // 用户插话：这一批做完就先停，不再自动发下一批
			save();
			sync();
			tell(ctx, "你插话了，分批处理做完这一批就暂停。按 Ctrl+\\ 打开哨兵弹窗，按 p 继续。");
		}
		if (!own && now - lastActive >= config.awayMinutes * MIN) {
			const pending = book.items.filter(live);
			if (pending.length) tell(ctx, `你离开了 ${age(lastActive, now)}，还有 ${pending.length} 件事没做完：\n${summary(pending, now)}`);
		}
		lastActive = now;
		return undefined;
	});

	pi.on("agent_settled", (_event, ctx) => {
		refresh(ctx);
		const now = Date.now();
		lastActive = now;
		onSettled();
		const due = book.queue ? [] : dueForReminder(book, now, config.remindMinutes * MIN); // 分批处理期间不再提醒
		const quiet = book.queue ? [] : alerts.filter((a) => now - (alertedAt.get(a.key) ?? 0) >= config.remindMinutes * MIN);
		if (due.length || quiet.length) {
			const total = open().length + alerts.length;
			const parts = [...due.slice(0, 3).map((item) => item.text), ...quiet.slice(0, 3).map((a) => a.text)];
			if (total > BATCH) tell(ctx, `积压了 ${total} 件事没做完。按 Ctrl+\\ 打开哨兵弹窗按 t 整理一遍（划掉已经做完或过时的，其余分组给建议），再分批处理，不用一次看完。`);
			else tell(ctx, `还有 ${total} 件事没做完：${parts.join("；")}（点输入框上方的任务行或按 Ctrl+\\ 看全部）`);
			due.forEach((item) => (item.remindedAt = now));
			quiet.forEach((a) => alertedAt.set(a.key, now));
			save();
		}
		void refreshSignals(ctx);
		if (++turns >= config.scanEveryTurns) {
			turns = 0;
			void look(ctx, ctx.sessionManager.getBranch());
		}
	});

	// 上下文要被压缩了：压缩之前先翻一遍，免得漏掉的事跟着旧对话一起消失（最多等 25 秒）
	pi.on("session_before_compact", async (event, ctx) => {
		const stop = AbortSignal.any([event.signal, AbortSignal.timeout(25_000)]);
		await look(ctx, event.branchEntries, stop);
	});

	const reply = (text: string) => ({ content: [{ type: "text" as const, text }], details: undefined });
	function act(action: string, ref: string, extra: { hours?: number; note?: string } = {}): string {
		const now = Date.now();
		if (action === "list") {
			const rows = [...book.items.filter(live).map((item) => line(item, now)), ...alerts.map((a) => `！ ${a.text}（${age(a.since, now)}）`)];
			const kinds = { done: "做完了", obsolete: "过时了", duplicate: "重复" };
			const recent = (book.recent ?? []).map((r) => `${r.id}  ${r.text}（自动判断${kinds[r.kind]}：${r.why}，${age(r.at, now)}前）`);
			return [rows.length ? rows.join("\n") : "现在没有没做完的事。", ...(recent.length ? ["最近自动划掉的（不对就 reopen）：", ...recent] : [])].join("\n");
		}
		if (action === "ok" && ref === "all") {
			const list = candidates();
			list.forEach((item) => setStatus(item, "open", now));
			save();
			sync();
			return list.length ? `确认了 ${list.length} 件：${list.map((item) => item.text).join("；")}` : "没有待确认的候选。";
		}
		const found = resolve(book, ref);
		if (found === "none") return `没有找到「${ref}」。${USAGE}`;
		if (found === "many") return `「${ref}」对上了好几件，请用编号。\n${book.items.filter(live).map((item) => line(item, now)).join("\n")}`;
		const item = found;
		if (action === "done") setStatus(item, "done", now, extra.note);
		else if (action === "drop") setStatus(item, "dropped", now, extra.note);
		else if (action === "ok") setStatus(item, "open", now);
		else if (action === "reopen") (setStatus(item, "open", now), (item.remindedAt = undefined));
		else if (action === "snooze") (item.snoozeUntil = now + (extra.hours ?? 4) * HOUR), (item.updated = now);
		else return USAGE;
		save();
		sync();
		const verb = { done: "标成做完", drop: "划掉", ok: "确认", reopen: "重新打开", snooze: `推迟 ${extra.hours ?? 4} 小时` }[action];
		return `${item.id} ${item.text}：${verb}了。`;
	}
	const add = (text: string, source: "user" | "agent") => {
		const { item, added } = addItem(book, text, source);
		save();
		sync();
		return added ? `记下了：${item.id} ${item.text}` : `已经有这件事了：${item.id} ${item.text}`;
	};

	pi.registerTool({
		name: "loose",
		label: "未了事项",
		description:
			"Keep the list of things the user asked for, or you promised to do later, that are not finished yet. The list is stored outside the conversation, so it survives context compaction and is shown to the user in the footer and at the end of turns. Call add when the user gives a request you cannot finish in this turn, or when you say you will do something later or next; call done as soon as an item is really finished (with a short note of the evidence); drop when the user says it is no longer needed; confirm when the user agrees that a candidate (found by a background scan, shown as 候选) is a real to-do; reopen when the user says an item was wrongly closed (list also shows recently auto-closed items); snooze to push reminders back; list to show everything. ref is the item id such as t3 or a distinctive piece of its text.",
		promptSnippet: "loose: record what is still to do (user requests, promises to do later), mark it done, drop or snooze it; the list survives context compaction",
		promptGuidelines: [
			"When the user asks for something you cannot finish in this turn, or you promise to do something later or as a next step, call the loose tool to add it; when it is really finished, call done. Do not rely on remembering it.",
			"Items marked 候选 in the system prompt were guessed by a background scan: ask the user before treating them as tasks, and use confirm or drop on their answer.",
		],
		parameters: Type.Object({
			action: Type.Union([Type.Literal("add"), Type.Literal("done"), Type.Literal("drop"), Type.Literal("confirm"), Type.Literal("reopen"), Type.Literal("snooze"), Type.Literal("list")]),
			text: Type.Optional(Type.String({ description: "What is still to do, one short sentence starting with a verb (action add)" })),
			ref: Type.Optional(Type.String({ description: "Item id such as t3, or a distinctive piece of its text; for confirm also all (done, drop, confirm, reopen, snooze)" })),
			note: Type.Optional(Type.String({ description: "Evidence it is done, or why it was dropped" })),
			hours: Type.Optional(Type.Number({ description: "How many hours to push reminders back (snooze), default 4" })),
		}),
		execute: async (_id, params, _signal, _update, ctx) => {
			refresh(ctx);
			if (params.action === "add") return reply(params.text?.trim() ? add(params.text, "agent") : "add 需要 text：这件事是什么。");
			const action = params.action === "confirm" ? "ok" : params.action;
			return reply(act(action, params.ref ?? "", { hours: params.hours, note: params.note }));
		},
	});
}
