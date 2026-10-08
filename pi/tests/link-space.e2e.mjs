// 端到端：真实的 Pi 全屏界面（tmux 里）。让模型原样复述一句“网址后面紧跟中文句号”的话，屏幕上网址和句号之间必须有一个空格，
// 这样终端的链接识别就在网址末尾断开（以前会把“。报告里能回看第”也算进链接）。
// 运行：node packages/butler-ui/tests/link-space.e2e.mjs   （会产生一次真实的模型调用）
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const passed = [], failed = [];
const check = (name, ok, detail = "") => { (ok ? passed : failed).push(name); console.log(`${ok ? "ok   " : "FAIL "} ${name}${!ok && detail ? `   [${String(detail).slice(0, 500)}]` : ""}`); };
const SOCK = `link${process.pid}`;
const tmux = (...a) => execFileSync("tmux", ["-L", SOCK, ...a], { encoding: "utf8" });
const pane = () => tmux("capture-pane", "-p", "-t", "0");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const work = mkdtempSync(join(tmpdir(), "link-e2e-")), agentDir = mkdtempSync(join(tmpdir(), "link-agent-"));
mkdirSync(join(agentDir, "extensions/butler-ui"), { recursive: true });
cpSync(join(homedir(), ".pi/agent/models.json"), join(agentDir, "models.json"));
const features = (links) => JSON.stringify({ features: { header: false, statusbar: false, tools: false, rename: false, claudeSub: false, openaiNative: false, userMessage: true, links } });
writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ quietStartup: true, defaultProvider: "magpie", defaultModel: "group/sonnet", defaultThinkingLevel: "off", tuiMode: "fullscreen", packages: [join(homedir(), ".config/butler-code/pi")] }));
const SENTENCE = "报告地址 https://example.com/delivery/x/round-02/report.html。报告里能回看第 1 轮。";
async function run(links) {
  writeFileSync(join(agentDir, "extensions/butler-ui/config.jsonc"), features(links));
  tmux("new-session", "-d", "-x", "140", "-y", "30", "-c", work, `COLORTERM=truecolor PI_CODING_AGENT_DIR=${agentDir} pi; sleep 2`);
  await sleep(7000);
  tmux("send-keys", "-t", "0", "-l", `请一个字符都不要改，原样输出下面这句话，不要加任何别的内容：${SENTENCE}`); tmux("send-keys", "-t", "0", "Enter");
  let screen = "";
  for (let i = 0; i < 45; i++) { await sleep(1000); screen = pane(); if ((screen.match(/report\.html/g) ?? []).length >= 2 && /第 1 轮/.test(screen.split("report.html").at(-1))) break; }
  await sleep(1000);
  const text = pane();
  try { tmux("kill-server"); } catch {}
  return text;
}
try {
  const on = await run(true);
  const hits = (on.match(/report\.html ?。/g) ?? []);
  check("with the feature: the URL and the full stop are separated by a space (in your message and in the reply)", hits.length >= 2 && hits.every((h) => h === "report.html 。"), JSON.stringify(hits) + "\n" + on);
  const off = await run(false);
  const offHits = (off.match(/report\.html ?。/g) ?? []);
  check("control (feature off): without it the full stop sits right against the URL, which is what broke the link", offHits.length >= 1 && offHits.every((h) => h === "report.html。"), JSON.stringify(offHits));
} catch (error) {
  check("the run", false, error.message);
} finally {
  try { tmux("kill-server"); } catch {}
  rmSync(work, { recursive: true, force: true }); rmSync(agentDir, { recursive: true, force: true });
}
console.log(`\n${passed.length} passed, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
