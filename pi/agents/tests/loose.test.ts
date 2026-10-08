// 未了事项的账本和扫描结果解析：纯逻辑，输入输出能列出来，所以用快速检查；Pi 里是不是真的记下、提醒、翻出来，由 e2e/loose.e2e.mjs 用真实的 Pi 和模型验证。
import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseScan, parseTriage, transcript } from "../loose/text.ts";
import { FOREVER, HOUR, addItem, bookPath, dropBookIfEmpty, loadBook, pruneBooks, saveBook, batchPrompt, nextBatch, pushRecent, settleBatch, startQueue, age, dueForEscalation, dueForReminder, pruneMutes, resolve, sameThing, setStatus, unmuted } from "../loose/store.ts";

const book = () => ({ counter: 0, items: [] as any[] });

test("the same thing in other words is one item, and a confirmed one outranks a candidate", () => {
	expect(sameThing("给 API 加限流", "给API加限流。")).toBe(true);
	expect(sameThing("给 API 加限流并写测试", "给 API 加限流")).toBe(true);
	expect(sameThing("加限流", "加缓存")).toBe(false);
	const b = book();
	const scanned = addItem(b, "把验收报告交给用户", "scan", 1);
	expect(scanned.item.status).toBe("candidate");
	const again = addItem(b, "把验收报告交给用户。", "user", 2);
	expect(again.added).toBe(false);
	expect(b.items).toHaveLength(1);
	expect(b.items[0].status).toBe("open");
});

test("an item is found by its id or by a unique piece of its text; unclear references say so", () => {
	const b = book();
	addItem(b, "写部署文档", "agent");
	addItem(b, "写迁移脚本", "agent");
	expect(resolve(b, "t2")).toMatchObject({ text: "写迁移脚本" });
	expect(resolve(b, "部署")).toMatchObject({ id: "t1" });
	expect(resolve(b, "写")).toBe("many");
	expect(resolve(b, "不存在")).toBe("none");
});

test("reminders are due only for open, not snoozed items, and not twice within the interval", () => {
	const b = book();
	const now = 10 * HOUR;
	const a = addItem(b, "第一件要做的事", "agent", now - 2 * HOUR).item;
	const fresh = addItem(b, "刚记下的第二件事", "agent", now - 60_000).item;
	const sleeping = addItem(b, "推迟了的第三件事", "agent", now - 3 * HOUR).item;
	sleeping.snoozeUntil = now + HOUR;
	const done = addItem(b, "已经做完的第四件事", "agent", now - 3 * HOUR).item;
	setStatus(done, "done", now);
	expect(dueForReminder(b, now, 30 * 60_000).map((i) => i.id)).toEqual([a.id]);
	a.remindedAt = now - 10 * 60_000;
	expect(dueForReminder(b, now, 30 * 60_000)).toEqual([]);
	expect(fresh.status).toBe("open");
});

test("an item that sat for hours goes to the butler, once a day", () => {
	const b = book();
	const now = 100 * HOUR;
	const old = addItem(b, "放了一整天的事", "agent", now - 30 * HOUR).item;
	addItem(b, "刚刚记下的事情", "agent", now - HOUR);
	expect(dueForEscalation(b, now, 6 * HOUR).map((i) => i.id)).toEqual([old.id]);
	old.escalatedAt = now - HOUR;
	expect(dueForEscalation(b, now, 6 * HOUR)).toEqual([]);
	old.escalatedAt = now - 25 * HOUR;
	expect(dueForEscalation(b, now, 6 * HOUR)).toHaveLength(1);
});

test("age is said in minutes, hours or days", () => {
	expect(age(0, 5 * 60_000)).toBe("5 分钟");
	expect(age(0, 3 * HOUR)).toBe("3 小时");
	expect(age(0, 72 * HOUR)).toBe("3 天");
});

test("the scan result is read from the model's answer; anything else is ignored", () => {
	expect(parseScan('好的：{"candidates":["写部署文档"," ","补测试"],"finished":[{"id":"t1","evidence":"已提交"}]}')).toEqual({ candidates: ["写部署文档", "补测试"], finished: [{ id: "t1", evidence: "已提交" }], obsolete: [] });
	expect(parseScan('{"candidates":[],"obsolete":[{"id":"t4","reason":"已改用增量方案"},{"nope":1}]}')?.obsolete).toEqual([{ id: "t4", reason: "已改用增量方案" }]);
	expect(parseScan('{"candidates":[]}')).toEqual({ candidates: [], finished: [], obsolete: [] });
	expect(parseScan("我觉得没有")).toBeUndefined();
	expect(parseScan('{"candidates":["1","2","3","4","5","6","7"]}')?.candidates).toHaveLength(5);
});

test("the transcript keeps what was said, not tool output, and the most recent part when it is too long", () => {
	const entries = [
		{ type: "message", message: { role: "user", content: "帮我加限流" } },
		{ type: "message", message: { role: "assistant", content: [{ type: "text", text: "好的" }, { type: "toolCall", name: "bash" }] } },
		{ type: "message", message: { role: "toolResult", content: [{ type: "text", text: "很长的工具输出" }] } },
		{ type: "message", message: { role: "user", content: "x".repeat(30) } },
	];
	const text = transcript(entries);
	expect(text).toContain("用户：帮我加限流");
	expect(text).toContain("助手：好的 （调用了 bash）");
	expect(text).not.toContain("工具输出");
	expect(transcript(entries, 40)).toBe(`用户：${"x".repeat(30)}`);
});

test("state signals: a dirty tree, unpushed commits and a report nobody answered are found; fresh ones are not", async () => {
	const { execFileSync } = await import("node:child_process");
	const { mkdtempSync, mkdirSync, utimesSync, writeFileSync } = await import("node:fs");
	const { tmpdir } = await import("node:os");
	const { join } = await import("node:path");
	const { gather, waitingReports } = await import("../loose/signals.ts");
	const dir = mkdtempSync(join(tmpdir(), "signals-"));
	const run = (...args: string[]) => execFileSync("git", args, { cwd: dir, stdio: "pipe", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
	run("init", "-q");
	writeFileSync(join(dir, "a.txt"), "1");
	run("add", "."), run("commit", "-qm", "first");
	const none = await gather(dir, Date.now(), "", join(dir, "none.json"));
	expect(none).toEqual([]);
	writeFileSync(join(dir, "a.txt"), "2");
	expect((await gather(dir, Date.now(), "", join(dir, "none.json"))).map((s) => s.key)).toEqual([]); // edited just now: not yet worth a word
	const old = new Date(Date.now() - 5 * HOUR);
	utimesSync(join(dir, "a.txt"), old, old);
	const found = await gather(dir, Date.now(), "", join(dir, "none.json"));
	expect(found.map((s) => s.key)).toEqual(["dirty"]);
	expect(found[0].text).toBe("1 个文件改了还没提交");

	// a delivery: the report is hours old and nobody answered; an answer (a receipt written after the report) silences it
	const root = join(dir, "task");
	const round = join(root, "round-01");
	mkdirSync(round, { recursive: true });
	writeFileSync(join(round, "result.json"), JSON.stringify({ title: "做好的报告" }));
	writeFileSync(join(round, "report.html"), "<p>x</p>");
	utimesSync(join(round, "report.html"), old, old);
	const registry = join(dir, "delivery.json");
	writeFileSync(registry, JSON.stringify({ deliveries: { mine: { root, pane: "P1", herdr_socket: "/s/one", state: "active" }, other: { root, pane: "P2", herdr_socket: "/s/one", state: "active" }, elsewhere: { root, pane: "P1", herdr_socket: "/s/two", state: "active" }, legacy: { root, pane: "OLD", state: "active" } } }));
	expect(waitingReports(registry, "P1", "/s/one", Date.now()).map((s) => s.text)).toEqual(["验收报告在等你看：做好的报告"]); // same pane id on another herdr server is another pane
	expect(waitingReports(registry, "P3", "/s/one", Date.now())).toEqual([]);
	expect(waitingReports(registry, "OLD", "", Date.now())).toEqual([]); // not inside herdr: nothing is bound to this session
	mkdirSync(join(round, "feedback-receipts"));
	writeFileSync(join(round, "feedback-receipts", "x.json"), "{}");
	expect(waitingReports(registry, "P1", "/s/one", Date.now())).toEqual([]);
});

test("an ignored reminder stays quiet while the thing is still there, a snoozed one comes back after its time, and both are forgotten once the thing is gone", () => {
	const now = 50 * HOUR;
	const signals = [{ key: "dirty" }, { key: "report:a" }, { key: "unpushed" }];
	const mutes = { dirty: FOREVER, "report:a": now + 4 * HOUR };
	expect(unmuted(signals, mutes, now).map((s) => s.key)).toEqual(["unpushed"]);
	expect(unmuted(signals, mutes, now + 5 * HOUR).map((s) => s.key)).toEqual(["report:a", "unpushed"]); // the snooze ran out
	expect(pruneMutes(mutes, ["dirty", "report:a"], now)).toEqual(mutes);
	expect(pruneMutes(mutes, ["report:a"], now)).toEqual({ "report:a": now + 4 * HOUR }); // the tree was committed: the ignore is void
	expect(pruneMutes(mutes, ["dirty", "report:a"], now + 5 * HOUR)).toEqual({ dirty: FOREVER });
	expect(unmuted(signals, undefined, now)).toHaveLength(3);
});

test("a big pile is worked through in batches: ordered by when it was recorded, only what is still open, each batch settled before the next", () => {
	const b = book();
	for (let i = 1; i <= 20; i++) addItem(b, `第 ${i} 件要做的不一样的事情`, "agent", i);
	setStatus(b.items[2], "done", 99); // t3 is already done: it is not queued
	const queue = startQueue(b, ["t5", "t1", "t3", "t2", "t1", "t999", ...b.items.slice(5).map((i) => i.id)], 8, 1000);
	expect(queue.total).toBe(18); // 20 - done t3 - ... t4 is not asked for
	expect(queue.ids.slice(0, 3)).toEqual(["t1", "t2", "t5"]);
	const first = nextBatch(queue);
	expect(first).toHaveLength(8);
	expect(queue.ids).toHaveLength(10);
	// the agent finished five of the eight
	for (const id of first.slice(0, 5)) setStatus(b.items.find((i) => i.id === id)!, "done", 2000);
	expect(settleBatch(b)).toEqual({ done: 5, left: 3 });
	expect(queue.done).toBe(5);
	expect(queue.current).toEqual([]);
	expect(nextBatch(queue)).toHaveLength(8);
	expect(nextBatch(queue)).toHaveLength(2);
	expect(nextBatch(queue)).toEqual([]);
});

test("the instruction for a batch lists every item with its id and says how to report back", () => {
	const text = batchPrompt([{ id: "t1", text: "写迁移脚本" }, { id: "alert:dirty", text: "3 个文件没提交", go: "看 diff 再提交" }], 2, 4);
	expect(text).toContain("第 2/4 批，共 2 条");
	expect(text).toContain("1. t1：写迁移脚本");
	expect(text).toContain("2. alert:dirty：3 个文件没提交（做法：看 diff 再提交）");
	expect(text).toContain("loose 工具的 done");
});

test("what the sentinel closed by itself is kept as a short log, newest first", () => {
	const b = book();
	for (let i = 0; i < 25; i++) pushRecent(b, { id: `t${i}`, text: "x", why: "y", kind: "obsolete", at: i });
	expect(b.recent).toHaveLength(20);
	expect(b.recent![0].id).toBe("t24");
});

test("the triage answer keeps only known kinds and caps the reasons", () => {
	const t = parseTriage(JSON.stringify({ closed: [{ id: "t1", kind: "obsolete", reason: "改用了别的方案" }, { id: "t2", kind: "whatever" }], suggest: [{ id: "t3", kind: "go", why: "明确" }, { id: "t4", kind: "maybe" }, { id: "alert:dirty", kind: "ask", why: "x".repeat(500) }] }));
	expect(t?.closed).toEqual([{ id: "t1", kind: "obsolete", reason: "改用了别的方案" }]);
	expect(t?.suggest.map((s) => s.kind)).toEqual(["go", "ask"]);
	expect(t?.suggest[1].why).toHaveLength(200);
	expect(parseTriage("看不懂")).toBeUndefined();
});

test("a tidy answer is read even when the model fences it, talks around it, or is cut off in the middle; only a reply with nothing usable is a failure", () => {
	const full = '{"closed":[{"id":"t1","kind":"done","reason":"对话里已经改好了"}],"suggest":[{"id":"t2","kind":"go","why":"明确"},{"id":"t3","kind":"ignore","why":"太模糊 {不用做}"}]}';
	// code fence and prose around it, with braces in the prose and inside a string
	const fenced = parseTriage(`好的，整理如下 {仅供参考}：\n\`\`\`json\n${full}\n\`\`\`\n希望有帮助 }`);
	expect(fenced?.closed.map((c) => c.id)).toEqual(["t1"]);
	expect(fenced?.suggest.map((s) => [s.id, s.kind])).toEqual([["t2", "go"], ["t3", "ignore"]]);
	expect(fenced?.suggest[1].why).toBe("太模糊 {不用做}");
	// keys in another order and extra fields: only the whole-object reading can take these
	const reordered = parseTriage('{"suggest":[{"why":"明确","id":"t5","kind":"go","extra":1}],"closed":[]}');
	expect(reordered?.suggest.map((s) => s.id)).toEqual(["t5"]);
	// cut off in the middle of the third entry: the complete ones survive, nothing is invented
	const cut = parseTriage(full.slice(0, full.indexOf('{"id":"t3"') + 30));
	expect(cut?.closed.map((c) => c.id)).toEqual(["t1"]);
	expect(cut?.suggest.map((s) => s.id)).toEqual(["t2"]);
	// an unknown kind never gets through, in either path
	expect(parseTriage('{"closed":[],"suggest":[{"id":"t9","kind":"maybe","why":"x"}')).toBeUndefined();
	expect(parseTriage("我觉得都可以做")).toBeUndefined();
	expect(parseTriage("")).toBeUndefined();
});

test("the ledger belongs to a session: two sessions never share a file; an empty one is removed when the session ends; a long-abandoned one is cleaned", () => {
	const dir = mkdtempSync(join(tmpdir(), "loose-books-"));
	const a = bookPath("session-a", dir);
	const b = bookPath("session-b", dir);
	expect(a).not.toBe(b);
	// an item in A is invisible to B
	const bookA = book();
	addItem(bookA, "给 API 加限流", "user");
	saveBook(a, bookA);
	expect(loadBook(a).items).toHaveLength(1);
	expect(loadBook(b).items).toHaveLength(0);
	// ending a session: a book with a live item stays (so the session can be resumed), an empty one goes
	dropBookIfEmpty(a, bookA);
	expect(existsSync(a)).toBe(true);
	const empty = book();
	saveBook(b, empty);
	dropBookIfEmpty(b, empty);
	expect(existsSync(b)).toBe(false);
	// a done item is not "live"
	setStatus(bookA.items[0], "done");
	dropBookIfEmpty(a, bookA);
	expect(existsSync(a)).toBe(false);
	// abandoned books: older than 30 days go, the one being used and recent ones stay
	const old = bookPath("old", dir), recent = bookPath("recent", dir), mine = bookPath("mine", dir);
	for (const path of [old, recent, mine]) saveBook(path, bookA);
	const longAgo = new Date(Date.now() - 31 * 24 * HOUR);
	utimesSync(old, longAgo, longAgo);
	utimesSync(mine, longAgo, longAgo);
	pruneBooks(dir, mine, Date.now());
	expect([existsSync(old), existsSync(recent), existsSync(mine)]).toEqual([false, true, true]);
});
