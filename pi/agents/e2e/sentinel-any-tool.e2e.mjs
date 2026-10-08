// 端到端：用户用大白话说“帮我盯着……”，而且盯的不是 PR、CI 或地址，模型应该调用 sentinel 工具的 cmd（一条快速只读的命令加目标），
// 而不是自己轮询、sleep，也不是去开别的 agent。被盯的是一个真实的目录，之后里面真的出现了文件。
// 运行：node agents/e2e/sentinel-any-tool.e2e.mjs   （会产生真实的模型调用）
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PiRpc, cleanup, isolatedAgentDir } from "./rpc.mjs";

const passed = [], failed = [];
const check = (name, ok, detail = "") => { (ok ? passed : failed).push(name); console.log(`${ok ? "ok   " : "FAIL "} ${name}${!ok && detail ? `   [${String(detail).slice(0, 600)}]` : ""}`); };
const wait = async (fn, ms = 120_000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = fn(); if (v) return v; await new Promise((r) => setTimeout(r, 500)); } return undefined; };

const work = mkdtempSync(join(tmpdir(), "sentinel-any-tool-e2e-"));
const inbox = join(work, "inbox");
mkdirSync(inbox);
const record = join(work, "notified.txt");
writeFileSync(record, "");
const agentDir = isolatedAgentDir({ features: { sentinel: true }, sentinel: { model: "magpie/group/luna/low", intervalSeconds: 15, notify: ["sh", "-c", `cat >> ${record}; echo '---' >> ${record}`] } });
const pi = new PiRpc(agentDir, work);
const notified = () => readFileSync(record, "utf8");
try {
  await pi.ask(`帮我盯着 ${inbox} 这个文件夹，等里面出现 report.html 这个文件就告诉我，现在它还是空的。`);
  const calls = pi.tools.filter((t) => t.name === "sentinel" && t.args?.action === "watch");
  check("the model calls the sentinel tool with a command, not a PR, CI or address", calls.some((c) => c.args?.kind === "cmd" && /report\.html/.test(JSON.stringify(c.args))), JSON.stringify(pi.tools));
  check("it does not poll, sleep or dispatch other agents", !pi.tools.some((t) => /sleep|herdr|spawn/.test(JSON.stringify(t.args ?? {}))), JSON.stringify(pi.tools));
  check("nothing is announced while the folder is empty", notified() === "");

  writeFileSync(join(inbox, "report.html"), "<h1>done</h1>");
  check("the file appearing is announced by the background watcher", Boolean(await wait(() => notified().length > 0)), notified());

  await pi.ask("再帮我盯一下本机 8080 端口，有程序开始监听了告诉我。");
  const second = pi.tools.filter((t) => t.name === "sentinel" && t.args?.action === "watch" && /8080/.test(JSON.stringify(t.args)));
  check("a different kind of thing (a port) is also watched through the sentinel", second.some((c) => c.args?.kind === "cmd" || c.args?.kind === "url"), JSON.stringify(pi.tools.map((t) => t.args)));
  await pi.ask("哨兵都停掉吧。");
  check("asked to stop, it uses the stop action", pi.tools.some((t) => t.name === "sentinel" && t.args?.action === "stop"), JSON.stringify(pi.tools.map((t) => t.args)));
} catch (error) {
  check("the run", false, error.message);
} finally {
  pi.close();
  cleanup(agentDir, work);
}
console.log(`\n${passed.length} passed, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
