// 端到端：真实的 Pi 终端界面（tmux）。内置的会话哨兵：平时不占行；模型记一件没做完的事，输入框上方出现一行“▸ ! 哨兵 1 · 等你 1 · 会话 · 1 件事没做完”；做完以后那一行消失。
// 运行：node agents/e2e/loose-footer.e2e.mjs   （会产生真实的模型调用）
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ENTRY, isolatedAgentDir } from "./rpc.mjs";

const passed = [], failed = [];
const check = (name, ok, detail = "") => { (ok ? passed : failed).push(name); console.log(`${ok ? "ok   " : "FAIL "} ${name}${!ok && detail ? `   [${String(detail).slice(0, 500)}]` : ""}`); };
const SOCK = `loose${process.pid}`;
const tmux = (...a) => execFileSync("tmux", ["-L", SOCK, ...a], { encoding: "utf8" });
const pane = () => tmux("capture-pane", "-p", "-t", "0");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms) => { const end = Date.now() + ms; while (Date.now() < end) { const v = fn(); if (v) return v; await sleep(500); } return undefined; };

const work = mkdtempSync(join(tmpdir(), "loose-footer-"));
const agentDir = isolatedAgentDir({ features: { loose: true }, loose: { model: "magpie/group/luna/low", notify: "pi" } }, {}, { statusbar: true });
const say = (text) => tmux("send-keys", "-t", "0", text, "Enter");
try {
  tmux("new-session", "-d", "-x", "150", "-y", "30", "-c", work, `COLORTERM=truecolor PI_CODING_AGENT_DIR=${agentDir} pi -e ${ENTRY}; sleep 3`);
  await sleep(7000);
  check("the session sentinel takes no row while it has nothing to say", !/哨兵/.test(pane()), pane().slice(-400));
  say("用 loose 工具记一件还没做的事：给 API 加限流。只记下，不要做别的。");
  check("with an open item one line appears above the input: waiting on you, and how many are left", Boolean(await until(() => /^▸ ! 哨兵 1 · 等你 1 · 会话 · 1 件事没做完/m.test(pane()), 90_000)), pane().slice(-500));
  say("用 loose 工具把“限流”那件事标成做完。不要做别的。");
  check("when it is done the line goes away", Boolean(await until(() => !/^▸ .*哨兵/m.test(pane()), 90_000)), pane().slice(-500));
  // 弹窗里直接处理：一条一行，选中后出现按钮，按字母或回车就办掉
  say("用 loose 工具记两件还没做的事，分两次调用：给 API 加限流；写部署文档。只记下，不要做别的。");
  check("two open items are on the jobs line", Boolean(await until(() => /^▸ ! 哨兵 1 · 等你 1 · 会话 · 2 件事没做完/m.test(pane()), 120_000)), pane().slice(-500));
  await sleep(3000);
  tmux("send-keys", "-t", "0", "C-\\");
  check("the popup lists them as rows to handle, numbered, each with a tick box, its tag and age", Boolean(await until(() => /要你处理的事（2）/.test(pane()) && /1\. □ \[待办\] 给 API 加限流/.test(pane()) && /2\. □ \[待办\] 写部署文档/.test(pane()), 10_000)), pane());
  check("no buttons until one is picked (nothing is cramped together)", !/完成 d/.test(pane()), pane());
  tmux("send-keys", "-t", "0", "1");
  check("pressing the number picks that item and its two buttons appear, each with its key", Boolean(await until(() => /› 1\./.test(pane()) && /去做 g/.test(pane()) && /忽略 x/.test(pane()) && !/稍后/.test(pane()), 8000)), pane());
  tmux("send-keys", "-t", "0", "x");
  check("x ignores it: it leaves the list, the next one is picked", Boolean(await until(() => /要你处理的事（1）/.test(pane()) && /› 1\. □ \[待办\] 写部署文档/.test(pane()), 8000)), pane());
  tmux("send-keys", "-t", "0", "g");
  check("g hands the item to Pi: the popup closes and Pi receives it as the user's instruction", Boolean(await until(() => !/后台任务（/.test(pane()) && /用户在哨兵里对这件事点了「去做」/.test(pane()) && /写部署文档/.test(pane()), 20_000)), pane());
} catch (error) {
  check("the run", false, error.message);
} finally {
  try { tmux("kill-server"); } catch {}
}
console.log(`\n${passed.length} passed, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
