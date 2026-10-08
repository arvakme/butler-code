// 端到端：真实的 Pi 终端界面（tmux）和真实的模型。积压很多时：整理（分组和建议）、勾选多条一次处理、分批接力交给主 Agent，一批做完才发下一批，最后汇总。
// 运行：node agents/e2e/loose-backlog.e2e.mjs   （会产生真实的模型调用，约 10 分钟）
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ENTRY, isolatedAgentDir } from "./rpc.mjs";

const passed = [], failed = [];
const check = (name, ok, detail = "") => { (ok ? passed : failed).push(name); console.log(`${ok ? "ok   " : "FAIL "} ${name}${!ok && detail ? `   [${String(detail).slice(0, 700)}]` : ""}`); };
const SOCK = `backlog${process.pid}`;
const tmux = (...a) => execFileSync("tmux", ["-L", SOCK, ...a], { encoding: "utf8" });
const pane = () => tmux("capture-pane", "-p", "-S", "-120", "-t", "0");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms) => { const end = Date.now() + ms; while (Date.now() < end) { const v = fn(); if (v) return v; await sleep(700); } return undefined; };
const type = (text) => tmux("send-keys", "-t", "0", text, "Enter");
const key = (k) => tmux("send-keys", "-t", "0", k);

const work = mkdtempSync(join(tmpdir(), "backlog-"));
const agentDir = isolatedAgentDir({ features: { loose: true }, loose: { model: "magpie/group/sonnet/low", notify: "pi", remindMinutes: 1440 } }, {}, { statusbar: true });
const ledger = () => { const dir = join(agentDir, "loose-ends"); const f = existsSync(dir) ? readdirSync(dir)[0] : undefined; return f ? JSON.parse(readFileSync(join(dir, f), "utf8")) : { items: [] }; };
const live = () => ledger().items.filter((i) => i.status === "open" || i.status === "candidate").length;
/** 没有斜杠命令：让模型用 loose 工具把这些事一件件记下（不做） */
const note = (words) => type(`用 loose 工具记下下面 ${words.length} 件还没做的事，每件单独调用一次 add，text 依次是：${words.map((w) => `回复一个字“${w}”（只回复这一个字，不用调用别的工具）`).join("；")}。只记下，现在不要做。`);

// 20 件互不相同、模型一句话就能“做完”的小事
const WORDS = ["苹果", "香蕉", "樱桃", "葡萄", "西瓜", "柠檬", "芒果", "桃子", "梨", "李子", "荔枝", "榴莲", "菠萝", "橙子", "杏", "柿子", "石榴", "椰子", "枇杷", "山竹"];
try {
  tmux("new-session", "-d", "-x", "170", "-y", "40", "-c", work, `COLORTERM=truecolor PI_CODING_AGENT_DIR=${agentDir} pi -e ${ENTRY}; sleep 3`);
  await sleep(7000);
  note(WORDS);
  check("20 open items pile up in the ledger and on the footer row", Boolean(await until(() => ledger().items.length === 20 && /20 件事没做完/.test(pane()), 300_000)), `${ledger().items.length} ${pane().slice(-300)}`);
  await sleep(3000);

  // 分批接力：弹窗里 a 勾上整组（还没整理时同一类是一组），g 一次交给主 Agent，每批 8 条
  const left = live();
  const batches = Math.ceil(left / 8);
  key("C-\\");
  await until(() => /要你处理的事（\d+）/.test(pane()), 10_000);
  key("1");
  key("a");
  check("a ticks the whole group", Boolean(await until(() => new RegExp(`已选 ${left}`).test(pane()), 8000)), pane());
  key("g");
  check("the first batch reaches the main agent as one structured message", Boolean(await until(() => new RegExp(`第 1/${batches} 批`).test(pane()), 30_000)), `${left} items, ${batches} batches\n${pane().slice(-700)}`);
  check("the footer shows the relay progress", Boolean(await until(() => /分批处理：第 \d\/\d 批/.test(pane()), 20_000)), pane().slice(-500));
  check("there are at least three batches, and the second is only sent after the first is settled", batches >= 3 && Boolean(await until(() => /第 2\/\d+ 批/.test(pane()), 300_000)), `${batches} ${pane().slice(-500)}`);
  const finished = await until(() => /这一轮分批处理完了：共 \d+ 条/.test(pane()) && !ledger().queue, 600_000);
  check("when every batch has run it says how many got done", Boolean(finished), pane().slice(-800));
  const relayed = ledger();
  const doneCount = relayed.items.filter((i) => i.status === "done").length;
  check("the items the model did are marked done in the ledger", doneCount >= Math.floor(left / 2), JSON.stringify(relayed.items.map((i) => i.status)));
  check("no queue is left behind", !relayed.queue, JSON.stringify(relayed.queue));

  // 再积压 18 件，整理：模型给出分组和建议
  const MORE = ["牛奶", "面包", "鸡蛋", "大米", "豆腐", "青菜", "土豆", "番茄", "黄瓜", "茄子", "辣椒", "洋葱", "大蒜", "生姜", "玉米", "红薯", "南瓜", "蘑菇"];
  note(MORE);
  await until(() => live() >= 18, 300_000);
  await sleep(3000);
  key("C-\\");
  await until(() => /要你处理的事（\d+）/.test(pane()), 10_000);
  key("t");
  check("t in the popup tidies: the items come back grouped under headings", Boolean(await until(() => /── (建议去做|建议忽略|要你定)（\d+）/.test(pane()), 180_000)), pane());
  check("it offers one-key buttons for the whole list: tidy and follow-the-suggestions", /整理 t/.test(pane()) && /照建议处理 y/.test(pane()), pane());

  // 勾选多条一次处理：1 → 空格 → 下 → 空格，再按 x
  const open0 = live();
  key("1");
  key(" ");
  key("j");
  key(" ");
  check("space ticks items and the heading counts them", Boolean(await until(() => /已选 2/.test(pane()) && /■/.test(pane()), 8000)), pane());
  key("x");
  check("x ignores all ticked items at once", Boolean(await until(() => live() === open0 - 2, 8000)), `${open0} -> ${live()}`);
} catch (error) {
  check("the run", false, `${error.message}\n${(() => { try { return pane().slice(-600); } catch { return ""; } })()}`);
} finally {
  try { tmux("kill-server"); } catch {}
  rmSync(work, { recursive: true, force: true });
  rmSync(agentDir, { recursive: true, force: true });
}
console.log(`\n${passed.length} passed, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
