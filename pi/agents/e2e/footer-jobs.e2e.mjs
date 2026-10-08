// 端到端：真实的 Pi 终端界面（放在 tmux 里）和真实的模型。让模型用哨兵盯一个还打不开的本地地址（地址一恢复哨兵就完成了任务，所以要盯一个没有服务在听的端口），确认输入框上方出现一行后台任务（点它展开、点任务行开弹窗），停掉以后整块消失。
// 运行：node agents/e2e/footer-jobs.e2e.mjs   （会产生真实的模型调用）
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ENTRY, isolatedAgentDir } from "./rpc.mjs";

const passed = [], failed = [];
const check = (name, ok, detail = "") => { (ok ? passed : failed).push(name); console.log(`${ok ? "ok   " : "FAIL "} ${name}${!ok && detail ? `   [${String(detail).slice(0, 500)}]` : ""}`); };
const SOCK = `jobs${process.pid}`;
const tmux = (...a) => execFileSync("tmux", ["-L", SOCK, ...a], { encoding: "utf8" });
const pane = () => tmux("capture-pane", "-p", "-t", "0");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms) => { const end = Date.now() + ms; while (Date.now() < end) { const v = fn(); if (v) return v; await sleep(500); } return undefined; };

const work = mkdtempSync(join(tmpdir(), "jobs-e2e-"));
const agentDir = isolatedAgentDir({ features: { sentinel: true }, sentinel: { model: "magpie/group/luna/low", intervalSeconds: 15, notify: "pi" } }, {}, { statusbar: true });

try {
  await sleep(1000);
  tmux("new-session", "-d", "-x", "150", "-y", "30", "-c", work, `COLORTERM=truecolor PI_CODING_AGENT_DIR=${agentDir} pi -e ${ENTRY}; sleep 3`);
  await sleep(7000);
  const rows = () => pane().split("\n").filter((l) => l.trim());
  check("at rest there is no jobs block: the input box is the last thing on screen, with no separate footer", !/哨兵/.test(pane()) && /─ 新会话 ─/.test(rows().at(-1) ?? ""), rows().slice(-4).join(" | "));

  tmux("send-keys", "-t", "0", "用 sentinel 工具盯着 http://127.0.0.1:47778/ 这个地址（kind 用 url，不要传 goal）。不要做别的。", "Enter");
  const shown = await until(() => /^▸ [\u2800-\u28ff] 哨兵 1 · 地址 http/m.test(pane()), 90_000);
  check("while the sentinel watches, one collapsed line above the input counts it and names it", Boolean(shown), pane().slice(-600));
  const frame = () => (pane().match(/^▸ ([\u2800-\u28ff]) 哨兵/m) ?? [])[1];
  const frames = new Set();
  for (let i = 0; i < 10; i++) { frames.add(frame()); await sleep(200); }
  check("the flame actually moves", frames.size > 1, [...frames].join(""));
  check("the jobs line sits right above the input box", rows().findIndex((l) => /^▸ .*哨兵 1/.test(l)) === rows().length - 3, rows().slice(-4).join(" | "));

  // 点击：给终端发真实的鼠标按下和松开序列（SGR 编码，坐标从 1 起）
  const click = (x, y) => { tmux("send-keys", "-t", "0", "-l", `\x1b[<0;${x};${y}M`); tmux("send-keys", "-t", "0", "-l", `\x1b[<0;${x};${y}m`); };
  const lines = () => pane().split("\n");
  const column = (line, text) => [...line.slice(0, line.indexOf(text))].reduce((n, ch) => n + (ch.codePointAt(0) > 0x2e80 ? 2 : 1), 0) + 1; // 中文占两列，坐标从 1 起
  const rowOf = (re) => lines().findIndex((l) => re.test(l)) + 1;
  click(2, rowOf(/^▸ .*哨兵 1/));
  check("clicking the line expands it: one row per job, the long address clipped", Boolean(await until(() => /^▾ /m.test(pane()) && /^  [\u2800-\u28ff] 哨兵 · 地址 http:\/\/127\.0\.0\.1:4\S*… · /m.test(pane()), 8000)), pane().slice(-600));
  click(6, rowOf(/^  [\u2800-\u28ff] 哨兵 · 地址/));
  const split = await until(() => /后台任务（1 个在跑）/.test(pane()) && /状态/.test(pane()) && /已派出，进行中/.test(pane()), 10_000);
  check("clicking a job row opens a popup: the list on the left, the selected job's details on the right", Boolean(split), pane());
  const text = pane();
  check("the details show status, task, model, progress and start/end time", ["状态", "任务", "每 15 秒查一次", "模型", "luna", "进度", "开始", "结束", "还没有结束"].every((w) => text.includes(w)), text);
  check("the popup has a close button and the list shows the selected job", /✕ 关闭/.test(text) && /› .*哨兵 · 地址/.test(text), text);
  check("the popup's bottom border carries the session stats", /╰─ Cache Hit .* Session [0-9a-f]{8} ─+╯/.test(pane()), pane());
  check("the whole popup fits the screen: the bottom border and the hint row are visible (nothing is cut off)", /╰─.*╯/.test(pane()) && /Esc 关闭/.test(pane()), pane());
  // 再往里：没有并发成员的任务，回车直接看它自己的过程（哨兵的是每次检查的记录）
  const hint = await until(() => /看完整过程（/.test(pane()), 40_000);
  check("once the sentinel has checked, the details offer to show the full process", Boolean(hint), pane());
  tmux("send-keys", "-t", "0", "Enter");
  check("Enter opens the full process view with the checks listed", Boolean(await until(() => /‹ 返回/.test(pane()) && /查了一次，没变化/.test(pane()) && /跟随最新/.test(pane()), 10_000)), pane());
  check("the process view also fits the screen", /╰─.*╯/.test(pane()) && /PgUp\/PgDn 翻页/.test(pane()), pane());
  tmux("send-keys", "-t", "0", "Escape");
  check("Esc goes back from the process view to the list", Boolean(await until(() => /后台任务（1 个在跑）/.test(pane()) && !/PgUp\/PgDn 翻页/.test(pane()), 8000)), pane());
  // 点“‹ 返回”：退一级回到列表，不是关掉整个弹窗
  tmux("send-keys", "-t", "0", "Enter");
  await until(() => /PgUp\/PgDn 翻页/.test(pane()), 8000);
  const backRow = lines().findIndex((l) => /‹ 返回/.test(l)) + 1;
  click(column(lines()[backRow - 1] ?? "", "‹ 返回") + 2, backRow);
  check("clicking Back in the process view returns one level (the popup stays open, on the list)", Boolean(await until(() => /后台任务（1 个在跑）/.test(pane()) && !/PgUp\/PgDn 翻页/.test(pane()), 8000)), pane());
  tmux("send-keys", "-t", "0", "Escape");
  check("Esc closes the popup", Boolean(await until(() => !/后台任务（/.test(pane()), 8000)), pane());

  click(2, rowOf(/^▾ .*哨兵 1/));
  check("clicking the first line again folds it back to one line (no popup)", Boolean(await until(() => /^▸ .*哨兵 1/m.test(pane()) && !/^  [\u2800-\u28ff] 哨兵 ·/m.test(pane()) && !/后台任务（/.test(pane()), 8000)), pane().slice(-600));
  tmux("send-keys", "-t", "0", "C-\\");
  await until(() => /后台任务（1 个在跑）/.test(pane()), 8000);
  const closeRow = lines().findIndex((l) => /✕ 关闭/.test(l)) + 1;
  click(column(lines()[closeRow - 1] ?? "", "✕ 关闭") + 1, closeRow);
  check("clicking the close button closes the popup", Boolean(await until(() => !/后台任务（/.test(pane()), 8000)), pane());

  tmux("send-keys", "-t", "0", "C-\\"); // Ctrl+\（tmux 里按键名发，和真实按键走同一条路）
  check("Ctrl+\\ opens it from the keyboard at any time", Boolean(await until(() => /后台任务（1 个在跑）/.test(pane()), 8000)), pane());
  tmux("send-keys", "-t", "0", "C-\\");
  check("pressing Ctrl+\\ again closes it", Boolean(await until(() => !/后台任务（/.test(pane()), 8000)), pane());
  tmux("send-keys", "-t", "0", "C-\\"); await until(() => /后台任务（1 个在跑）/.test(pane()), 8000);
  tmux("send-keys", "-t", "0", "Enter"); await until(() => /PgUp\/PgDn 翻页/.test(pane()), 8000);
  tmux("send-keys", "-t", "0", "C-\\");
  check("and it closes from the process view too, not just one level", Boolean(await until(() => !/后台任务（|PgUp\/PgDn 翻页/.test(pane()), 8000)), pane());
  tmux("send-keys", "-t", "0", "-l", "\x1bj"); // Alt+J（终端把 Option 当 Alt 的话）
  check("Alt+J opens it too", Boolean(await until(() => /后台任务（1 个在跑）/.test(pane()), 8000)), pane());
  tmux("send-keys", "-t", "0", "Escape");
  await until(() => !/后台任务（/.test(pane()), 8000);

  tmux("send-keys", "-t", "0", "用 sentinel 工具停掉所有在盯的事（action stop，target all）。不要做别的。", "Enter");
  const gone = await until(() => !/^[▸▾] .*哨兵/m.test(pane()), 90_000);
  check("stopping the sentinel removes the whole jobs block (only running jobs are shown)", Boolean(gone), pane().slice(-500));
  await sleep(3000);
  tmux("send-keys", "-t", "0", "C-\\");
  const ended = await until(() => /后台任务（0 个在跑，1 个已结束）/.test(pane()) && /已结束/.test(pane()) && /已停止/.test(pane()) && /被你停止了/.test(pane()), 8000);
  check("an ended job stays in the popup, marked stopped, with its result and end time", Boolean(ended), pane());
  check("and it has an end time and a duration", /结束  \d\d:\d\d:\d\d/.test(pane()) && /用时/.test(pane()), pane());
  tmux("send-keys", "-t", "0", "c");
  check("c clears the ended jobs", Boolean(await until(() => /现在没有后台任务/.test(pane()), 8000)), pane());
  tmux("send-keys", "-t", "0", "Escape");
} catch (error) {
  check("the footer jobs run", false, error.message);
} finally {
  try { tmux("kill-server"); } catch {}
  rmSync(work, { recursive: true, force: true });
  rmSync(agentDir, { recursive: true, force: true });
}
console.log(`\n${passed.length} passed, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
