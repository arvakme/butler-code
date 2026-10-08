// 端到端：真实的 Pi 终端界面（放在 tmux 里）、真实的 Magpie 模型。发一条消息，等灰色建议出现，Tab 采用，再确认正常输入不受影响。
// 运行：node agents/e2e/predict.e2e.mjs
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ENTRY, cleanup, isolatedAgentDir } from "./rpc.mjs";

const passed = [], failed = [];
const check = (name, ok, detail = "") => { (ok ? passed : failed).push(name); console.log(`${ok ? "ok   " : "FAIL "} ${name}${!ok && detail ? `   [${String(detail).slice(0, 400)}]` : ""}`); };
const SOCK = `pred${process.pid}`;
const tmux = (...a) => execFileSync("tmux", ["-L", SOCK, ...a], { encoding: "utf8" });
const pane = (escapes = false) => tmux("capture-pane", ...(escapes ? ["-e"] : []), "-p", "-t", "0");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms) => { const end = Date.now() + ms; while (Date.now() < end) { const v = fn(); if (v) return v; await sleep(700); } return undefined; };

const work = mkdtempSync(join(tmpdir(), "predict-e2e-"));
const agentDir = isolatedAgentDir({ features: { predict: true }, predict: { model: "magpie/group/luna/low", examples: 4 } });
const ghostOf = () => { const m = pane(true).match(/\x1b\[(?:0;)?2m([^\x1b]*?) ⇥/); return m?.[1]; };
try {
  tmux("new-session", "-d", "-x", "150", "-y", "40", "-c", work, `COLORTERM=truecolor PI_CODING_AGENT_DIR=${agentDir} pi -e ${ENTRY}; sleep 5`);
  await sleep(6000);
  tmux("send-keys", "-t", "0", "给我一个 python 的 is_prime 函数，只给代码，不要解释。写完后只问我一句：要不要接着给它写测试？", "Enter");
  const reply = await until(() => /def is_prime/.test(pane()) && /测试/.test(pane().split("def is_prime").pop() ?? ""), 120_000);
  check("the session works normally: the model answers", Boolean(reply), pane().slice(-400));

  const ghost = await until(ghostOf, 90_000);
  check("a grey suggestion appears in the empty input box after the turn", Boolean(ghost), pane(true).slice(-900));
  console.log(`      suggestion: ${ghost}`);
  check("it is one short line", Boolean(ghost) && ghost.length <= 120 && !ghost.includes("\n"), ghost);
  check("it predicts what the USER would say, not the assistant's own question repeated", Boolean(ghost) && !/要不要接着|要我接着|是否需要/.test(ghost), ghost);

  tmux("send-keys", "-t", "0", "Tab");
  await sleep(1200);
  const editorLine = pane().split("\n").find((l) => ghost && l.includes(ghost.slice(0, 6)) && !l.includes("⇥"));
  check("Tab puts the suggestion into the input box as real text", Boolean(editorLine), pane().slice(-500));
  check("and the grey hint is gone", !pane(true).includes(" ⇥"));

  for (let i = 0; i < 80; i++) tmux("send-keys", "-t", "0", "BSpace");
  await sleep(800);
  tmux("send-keys", "-t", "0", "hello");
  await sleep(800);
  check("ordinary typing works and shows no hint while there is text", pane().includes("hello") && !pane(true).includes(" ⇥"), pane().slice(-400));
  for (let i = 0; i < 5; i++) tmux("send-keys", "-t", "0", "BSpace");

  const log = join(agentDir, "extensions/butler-ui/predict-log.jsonl");
  const entries = existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l)) : [];
  check("the learning log has the shown and the accepted suggestion", entries.some((e) => e.outcome === "shown") && entries.some((e) => e.outcome === "accepted"), JSON.stringify(entries));
} catch (error) {
  check("the predict run", false, error.message);
} finally {
  try { tmux("kill-server"); } catch {}
  cleanup(agentDir, work);
}
console.log(`\n${passed.length} passed, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
