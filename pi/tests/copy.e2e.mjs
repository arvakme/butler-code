// 端到端：真实的 Pi 全屏界面（tmux 里）。发一条带超长路径的用户消息，路径会折成两行；用真实的鼠标序列拖选这两行，
// 然后读系统剪贴板：应该是一整条路径，没有左边的竖条，也没有多出来的换行。会备份并恢复你的文本剪贴板。
// 运行：node packages/butler-ui/tests/copy.e2e.mjs   （会产生一次真实的模型调用）
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const passed = [], failed = [];
const check = (name, ok, detail = "") => { (ok ? passed : failed).push(name); console.log(`${ok ? "ok   " : "FAIL "} ${name}${!ok && detail ? `   [${String(detail).slice(0, 400)}]` : ""}`); };
const SOCK = `copy${process.pid}`;
const tmux = (...a) => execFileSync("tmux", ["-L", SOCK, ...a], { encoding: "utf8" });
const pane = () => tmux("capture-pane", "-p", "-t", "0");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clipboard = () => spawnSync("pbpaste", { encoding: "utf8" }).stdout;
const width = (s) => [...s].reduce((n, ch) => n + (ch.codePointAt(0) > 0x2e80 ? 2 : 1), 0);

const saved = clipboard();
const work = mkdtempSync(join(tmpdir(), "copy-e2e-")), agentDir = mkdtempSync(join(tmpdir(), "copy-agent-"));
mkdirSync(join(agentDir, "extensions/butler-ui"), { recursive: true });
cpSync(join(homedir(), ".pi/agent/models.json"), join(agentDir, "models.json"));
writeFileSync(join(agentDir, "extensions/butler-ui/config.jsonc"), JSON.stringify({ features: { header: false, statusbar: true, tools: false, rename: false, claudeSub: false, openaiNative: false, userMessage: true } }));
writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ quietStartup: true, defaultProvider: "magpie", defaultModel: "group/sonnet", defaultThinkingLevel: "off", tuiMode: "fullscreen", packages: [join(homedir(), ".config/butler-code/pi")] }));
const PATH = "/opt/demo-app/.config/butler-code/notebook/artifacts/delivery-verify/verify-video-prototype/round-01/feedback-receipts/9e1932e9-aa42-46f0-84d0-0f45f85f3fbe.json";
try {
  spawnSync("pbcopy", { input: "SENTINEL-BEFORE" });
  tmux("new-session", "-d", "-x", "100", "-y", "30", "-c", work, `COLORTERM=truecolor PI_CODING_AGENT_DIR=${agentDir} pi; sleep 3`);
  await sleep(7000);
  tmux("send-keys", "-t", "0", "-l", `只回答两个字“收到”，不要调用任何工具。文件在 ${PATH}`); tmux("send-keys", "-t", "0", "Enter");
  let lines = [];
  for (let i = 0; i < 40; i++) { await sleep(1000); lines = pane().split("\n"); if (lines.some((l) => l.includes("9e1932e9")) && /收到/.test(pane().split("9e1932e9")[1] ?? "")) break; }
  const y1 = lines.findIndex((l) => l.includes("/opt/demo-app")) + 1;
  const y2 = lines.findIndex((l) => l.includes("9e1932e9")) + 1;
  const first = lines[y1 - 1] ?? "", last = lines[y2 - 1] ?? "";
  check("the long path wrapped over several rows, each with the bar", y1 > 0 && y2 > y1 && /▎/.test(first) && /▎/.test(last), lines.slice(10, 16).join("\n"));
  const x1 = width(first.slice(0, first.indexOf("/opt"))) + 1;
  const x2 = width(last.trimEnd());
  const send = (s) => tmux("send-keys", "-t", "0", "-l", s);
  send(`\x1b[<0;${x1};${y1}M`); await sleep(100); send(`\x1b[<32;${x2};${y2}M`); await sleep(100); send(`\x1b[<0;${x2};${y2}m`);
  await sleep(1500);
  const got = clipboard();
  check("the clipboard holds the whole path in one piece", got === PATH, JSON.stringify(got));
  check("with no bar and no newline in it", !/▎/.test(got) && !got.includes("\n"), JSON.stringify(got));
} catch (error) {
  check("the run", false, error.message);
} finally {
  try { tmux("kill-server"); } catch {}
  spawnSync("pbcopy", { input: saved });
  rmSync(work, { recursive: true, force: true }); rmSync(agentDir, { recursive: true, force: true });
}
console.log(`\n${passed.length} passed, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
