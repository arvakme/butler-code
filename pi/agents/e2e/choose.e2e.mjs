// 端到端：真实的 Pi 终端界面（放在 tmux 里）、真实的 Magpie 模型。让助手给出两个方案并问你选哪个，等选择题弹出，用键盘选，确认你的选择变成了一条用户消息；
// 再确认一句普通的回答不会弹出选择题。
// 运行：node agents/e2e/choose.e2e.mjs
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ENTRY, cleanup, isolatedAgentDir } from "./rpc.mjs";

const passed = [], failed = [];
const check = (name, ok, detail = "") => { (ok ? passed : failed).push(name); console.log(`${ok ? "ok   " : "FAIL "} ${name}${!ok && detail ? `   [${String(detail).slice(0, 500)}]` : ""}`); };
const SOCK = `choose${process.pid}`;
const tmux = (...a) => execFileSync("tmux", ["-L", SOCK, ...a], { encoding: "utf8" });
const pane = () => tmux("capture-pane", "-p", "-t", "0");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms) => { const end = Date.now() + ms; while (Date.now() < end) { const v = fn(); if (v) return v; await sleep(700); } return undefined; };

const work = mkdtempSync(join(tmpdir(), "choose-e2e-"));
const agentDir = isolatedAgentDir({ features: { choose: true }, choose: { model: "magpie/group/luna/low" } });
try {
  tmux("new-session", "-d", "-x", "150", "-y", "42", "-c", work, `COLORTERM=truecolor PI_CODING_AGENT_DIR=${agentDir} pi -e ${ENTRY}; sleep 5`);
  await sleep(6000);

  tmux("send-keys", "-t", "0", "只回复 ok", "Enter");
  await until(() => /\nok\s*\n/.test(pane()), 90_000);
  await sleep(15_000);
  check("a plain answer does not raise a question", !pane().includes("自己写…"), pane().slice(-400));

  tmux("send-keys", "-t", "0", "我想给这个项目加存储层。不要写代码，不要用工具。只列两个方案：方案 A 用 SQLite，方案 B 用一个 JSON 文件，各一句话，然后问我选哪个。", "Enter");
  const shown = await until(() => pane().includes("自己写…"), 150_000);
  check("a multiple-choice question appears after the assistant asks which to pick", Boolean(shown), pane().slice(-900));
  const screen = pane();
  check("it offers the assistant's own options", /SQLite/.test(screen.split("自己写")[0].slice(-700)) && /JSON/.test(screen.split("自己写")[0].slice(-700)), screen.slice(-900));
  check("and a way to write your own answer", screen.includes("自己写…"));

  tmux("send-keys", "-t", "0", "Enter");
  const sent = await until(() => !pane().includes("自己写…"), 15_000);
  check("choosing closes the question", Boolean(sent), pane().slice(-500));
  await sleep(3000);
  const log = join(agentDir, "extensions/butler-ui/choose-log.jsonl");
  const entries = existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l)) : [];
  check("the pick was recorded (shown, then picked)", entries.some((e) => e.outcome === "shown") && entries.some((e) => e.outcome === "picked"), JSON.stringify(entries));
  const picked = entries.find((e) => e.outcome === "picked")?.pick ?? "";
  check("the choice went to the assistant as the user's next message", picked !== "" && pane().includes(picked), `${picked} :: ${pane().slice(-600)}`);
  console.log(`      question: ${entries.find((e) => e.outcome === "shown")?.question}   pick: ${picked}`);

} catch (error) {
  check("the choose run", false, error.message);
} finally {
  try { tmux("kill-server"); } catch {}
  cleanup(agentDir, work);
}
console.log(`\n${passed.length} passed, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
