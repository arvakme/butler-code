/** 未了事项的账本：纯逻辑加一个落盘的文件。每个会话一份（同一个目录里开几个会话互不串），放在 Pi 的 agent 目录下，不进仓库，也不在上下文里——所以压缩上下文丢不了它。 */
import { mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export type Status = "open" | "candidate" | "done" | "dropped";
/** user：用户让记的；agent：我自己记的；scan：便宜的模型从对话里翻出来的（先是候选，等用户确认） */
export type Source = "user" | "agent" | "scan";
export type Item = {
	id: string;
	text: string;
	status: Status;
	source: Source;
	created: number;
	updated: number;
	remindedAt?: number;
	escalatedAt?: number;
	snoozeUntil?: number;
	note?: string;
	/** 便宜的模型整理积压时给的建议：去做、忽略，还是要用户拿主意；用户确认之前不会执行 */
	suggest?: Suggest;
};
export type Suggest = { kind: "go" | "ignore" | "ask"; why: string };
/** 一批一批交给主 Agent 去做的队列：ids 是还没发的，current 是正在做的那一批 */
export type Queue = { ids: string[]; current: string[]; size: number; total: number; done: number; started: number; paused?: boolean; failed?: number };
/** 哨兵自己判断做完了、过时了或重复了而处理掉的，留最近几条，用户不同意可以重新打开 */
export type Recent = { id: string; text: string; why: string; kind: "done" | "obsolete" | "duplicate"; at: number };
/** mutes：提醒（状态型，比如“改了没提交”）被用户忽略或推迟到什么时候；FOREVER 表示一直忽略到这件事自己消失 */
export type Book = { counter: number; items: Item[]; mutes?: Record<string, number>; queue?: Queue; recent?: Recent[] };
export const FOREVER = 8.64e15;

export const HOUR = 3_600_000;
export const live = (item: Pick<Item, "status">) => item.status === "open" || item.status === "candidate";

/** 账本按会话存：<agent 目录>/loose-ends/<会话号>.json。新开的会话是干净的，恢复同一个会话时账本还在。 */
export function bookPath(sessionId: string, agentDir: string): string {
	return join(agentDir, "loose-ends", `${sessionId}.json`);
}
/** 会话结束时没有任何未了事项，账本就删掉，不留空文件；超过 maxAge 没动过的陈旧账本（放弃的会话）也清掉 */
export function pruneBooks(agentDir: string, keep: string, now: number, maxAge = 30 * 24 * HOUR): void {
	const dir = join(agentDir, "loose-ends");
	let names: string[] = [];
	try {
		names = readdirSync(dir);
	} catch {
		return;
	}
	for (const name of names) {
		const path = join(dir, name);
		try {
			if (path !== keep && now - statSync(path).mtimeMs > maxAge) unlinkSync(path);
		} catch {
			/* 别的会话正在写或已经没了：不管 */
		}
	}
}
export function dropBookIfEmpty(path: string, book: Book): void {
	if (book.items.some(live) || book.queue) return;
	try {
		unlinkSync(path);
	} catch {
		/* 本来就没有 */
	}
}
export function loadBook(path: string): Book {
	try {
		const book = JSON.parse(readFileSync(path, "utf8"));
		return Array.isArray(book.items) ? { counter: Number(book.counter) || book.items.length, items: book.items, mutes: book.mutes && typeof book.mutes === "object" ? book.mutes : {}, queue: book.queue, recent: Array.isArray(book.recent) ? book.recent : [] } : { counter: 0, items: [], mutes: {} };
	} catch {
		return { counter: 0, items: [] };
	}
}
export function saveBook(path: string, book: Book): void {
	mkdirSync(dirname(path), { recursive: true });
	const temporary = `${path}.${process.pid}.tmp`;
	writeFileSync(temporary, `${JSON.stringify(book, null, 2)}\n`);
	renameSync(temporary, path);
}

const norm = (text: string) => text.toLowerCase().replace(/[\s，。,.！!？?：:；;、"“”'‘’（）()[\]【】\-—]/g, "");
/** 同一件事换个说法也算重复：规整后相同，或一条包含另一条（至少 6 个字） */
export function sameThing(a: string, b: string): boolean {
	const x = norm(a);
	const y = norm(b);
	if (!x || !y) return false;
	return x === y || (Math.min(x.length, y.length) >= 6 && (x.includes(y) || y.includes(x)));
}

export function addItem(book: Book, text: string, source: Source, now = Date.now(), status: Status = source === "scan" ? "candidate" : "open"): { item: Item; added: boolean } {
	const clean = text.replace(/\s+/g, " ").trim();
	const same = book.items.find((item) => live(item) && sameThing(item.text, clean));
	if (same) {
		// 用户或我明确记的，比扫出来的候选更算数
		if (same.status === "candidate" && status === "open") (same.status = "open"), (same.updated = now);
		return { item: same, added: false };
	}
	const item: Item = { id: `t${++book.counter}`, text: clean, status, source, created: now, updated: now };
	book.items.push(item);
	return { item, added: true };
}

/** 编号（t3）或文字里的一段；对不上或对上好几条就说清楚 */
export function resolve(book: Book, ref: string, pool: Item[] = book.items): Item | "none" | "many" {
	const key = ref.trim();
	if (!key) return "none";
	const byId = pool.find((item) => item.id === key.toLowerCase());
	if (byId) return byId;
	const hits = pool.filter((item) => item.text.includes(key));
	return hits.length === 1 ? hits[0] : hits.length === 0 ? "none" : "many";
}

export function setStatus(item: Item, status: Status, now = Date.now(), note?: string): void {
	item.status = status;
	item.updated = now;
	if (note) item.note = note;
}

const snoozed = (item: Item, now: number) => (item.snoozeUntil ?? 0) > now;
/** 该提醒的：没做完、没被推迟，并且从上次提醒（没提醒过就从记下的时候）起过了 remindMs */
export function dueForReminder(book: Book, now: number, remindMs: number): Item[] {
	return book.items.filter((item) => item.status === "open" && !snoozed(item, now) && now - (item.remindedAt ?? item.created) >= remindMs);
}
/** 放太久的：交给 notify 命令，一天最多一次 */
export function dueForEscalation(book: Book, now: number, staleMs: number): Item[] {
	return book.items.filter((item) => item.status === "open" && !snoozed(item, now) && now - item.created >= staleMs && now - (item.escalatedAt ?? 0) >= 24 * HOUR);
}

export function age(since: number, now = Date.now()): string {
	const minutes = Math.max(0, Math.round((now - since) / 60000));
	if (minutes < 60) return `${minutes} 分钟`;
	const hours = Math.round(minutes / 60);
	return hours < 48 ? `${hours} 小时` : `${Math.round(hours / 24)} 天`;
}

/** 没被忽略或推迟的提醒 */
export const unmuted = <T extends { key: string }>(signals: T[], mutes: Record<string, number> | undefined, now: number): T[] => signals.filter((s) => (mutes?.[s.key] ?? 0) <= now);
/** 只留还管用的：那件事还在、而且还没到期。事情自己消失了（提交了、看过了），忽略也随之作废，下次再出现要重新提醒 */
export function pruneMutes(mutes: Record<string, number> | undefined, present: string[], now: number): Record<string, number> {
	return Object.fromEntries(Object.entries(mutes ?? {}).filter(([key, until]) => present.includes(key) && until > now));
}

export const BATCH = 8;
/** 开始一个队列：只收还没做完的，不重复，按记下的先后；第一批由调用方接着取 */
export function startQueue(book: Book, ids: string[], size = BATCH, now = Date.now(), extra: string[] = []): Queue {
	const open = new Set([...book.items.filter(live).map((item) => item.id), ...extra]); // extra：不在清单里的事（机器上的提醒）也能进队列
	const unique = [...new Set(ids)].filter((id) => open.has(id));
	const rank = new Map(book.items.map((item, index) => [item.id, index]));
	unique.sort((a, b) => (rank.get(a) ?? 1e9) - (rank.get(b) ?? 1e9));
	return (book.queue = { ids: unique, current: [], size: Math.max(1, size), total: unique.length, done: 0, started: now });
}
/** 取下一批：从队列里拿出最多 size 条，成为 current；队列空了返回空数组 */
export function nextBatch(queue: Queue): string[] {
	queue.current = queue.ids.splice(0, queue.size);
	return queue.current;
}
/** 一批做完以后清点：current 里已经不是未了状态的算做完；其余留在清单里不再自动重发（避免没完没了）。返回这一批做完几条、没做成几条 */
export function settleBatch(book: Book): { done: number; left: number } {
	const queue = book.queue;
	if (!queue) return { done: 0, left: 0 };
	const stillOpen = queue.current.filter((id) => book.items.some((item) => item.id === id && live(item)));
	const done = queue.current.length - stillOpen.length;
	queue.done += done;
	queue.failed = (queue.failed ?? 0) + stillOpen.length;
	queue.current = [];
	return { done, left: stillOpen.length };
}
/** 给主 Agent 的一批指令：编号加原文；提醒类带着具体做法。第 k / 共 n 批 */
/** 每一批消息的开头；input 钩子靠它认出“这是哨兵自己发的”，不当成用户插话（Pi 不把 sendUserMessage 标成 extension 来源） */
export const BATCH_HEAD = "用户在哨兵里选了这些事";
export function batchPrompt(items: { id: string; text: string; go?: string }[], k: number, n: number): string {
	const lines = items.map((item, i) => `${i + 1}. ${item.id}：${item.text}${item.go ? `（做法：${item.go}）` : ""}`);
	return `${BATCH_HEAD}，请现在逐条去做（第 ${k}/${n} 批，共 ${items.length} 条）：\n${lines.join("\n")}\n每做完一条，用 loose 工具的 done 把它标成完成；做不了、或需要用户拍板的，说明原因并保持未完成，不要硬做；这一批做完就停下，哨兵会把下一批交给你。`;
}
export function pushRecent(book: Book, entry: Recent, keep = 20): void {
	book.recent = [entry, ...(book.recent ?? [])].slice(0, keep);
}
