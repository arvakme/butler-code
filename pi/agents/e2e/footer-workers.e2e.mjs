// 端到端：真实的 Pi 终端界面（放在 tmux 里）和真实的模型。指挥官派一个子代理干二十来秒的活，确认它不在输入框上方的后台任务行里重复出现（指挥官的活动列表已列出），
// 在后台任务弹窗里有自己的条目（角色、模型、此刻在做什么），落定后条目标成已结束。
// 运行：node agents/e2e/footer-workers.e2e.mjs   （会产生真实的模型调用）
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ENTRY, isolatedAgentDir } from "./rpc.mjs";

const passed = [], failed = [];
const check = (name, ok, detail = "") => { (ok ? passed : failed).push(name); console.log(`${ok ? "ok   " : "FAIL "} ${name}${!ok && detail ? `   [${String(detail).slice(-900)}]` : ""}`); };
const SOCK = `workers${process.pid}`;
const tmux = (...a) => execFileSync("tmux", ["-L", SOCK, ...a], { encoding: "utf8" });
const pane = () => tmux("capture-pane", "-p", "-t", "0");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms) => { const end = Date.now() + ms; while (Date.now() < end) { const v = fn(); if (v) return v; await sleep(500); } return undefined; };

const work = mkdtempSync(join(tmpdir(), "workers-e2e-"));
const master = { autoActivate: true, workerExcludeExtensions: [], roles: { 跑腿: { model: "magpie/group/sonnet/low", use: "跑一条命令、读一个文件这类小事" } } };
const agentDir = isolatedAgentDir({}, {}, { statusbar: true, master: true }, { master });

try {
  tmux("new-session", "-d", "-x", "160", "-y", "40", "-c", work, `COLORTERM=truecolor PI_CODING_AGENT_DIR=${agentDir} pi -e ${ENTRY}; sleep 3`);
  await sleep(8000);
  tmux("send-keys", "-t", "0", "用 subagents 工具 start 一个子代理：worker 叫 nap，role 用 跑腿，prompt 是“用 bash 运行 sleep 25，然后只回复 好了”。派出后不用等它，直接结束这一轮。", "Enter");
  const row = await until(() => /nap/.test(pane().split("\n").slice(-8).join("\n")), 120_000);
  check("while the subagent runs, the master's activity list shows it above the input", Boolean(row), pane());
  check("and the jobs line does not repeat it (no worker count above the input)", !/^[▸▾] .*worker/m.test(pane()), pane().slice(-600));

  tmux("send-keys", "-t", "0", "C-\\");
  const open = await until(() => /后台任务（1 个在跑）/.test(pane()), 10_000);
  check("the jobs popup lists the subagent run", Boolean(open) && /› .*worker · nap/.test(pane()), pane());
  check("its details name the role, the model and the working directory", /角色 跑腿/.test(pane()) && /sonnet/.test(pane()), pane());
  tmux("send-keys", "-t", "0", "Escape");

  const settled = await until(() => /好了/.test(pane()), 180_000);
  check("the run settles", Boolean(settled), pane().slice(-500));
  await sleep(1500);
  tmux("send-keys", "-t", "0", "C-\\");
  check("and the popup keeps it as an ended job", Boolean(await until(() => /后台任务（0 个在跑，1 个已结束）/.test(pane()) && /已完成/.test(pane()), 10_000)), pane());
  tmux("send-keys", "-t", "0", "Escape");
} catch (error) {
  check("the run", false, `${error.message}\n${(() => { try { return pane(); } catch { return ""; } })()}`);
} finally {
  try { tmux("kill-server"); } catch {}
  rmSync(work, { recursive: true, force: true });
  rmSync(agentDir, { recursive: true, force: true });
}
console.log(`\n${passed.length} passed, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
