// 端到端：真实的 Pi 收到“帮我盯着这个地址什么时候恢复”这样的话，应该调用 sentinel 工具（后台盯，状态变了才通知），
// 而不是自己轮询，也不是用 herdr 去开别的 agent。被盯的是一个真实的本地 HTTP 服务（先返回 503，之后恢复）。
// 运行：node agents/e2e/sentinel-tool.e2e.mjs   （会产生真实的模型调用）
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PiRpc, cleanup, isolatedAgentDir } from "./rpc.mjs";

const passed = [], failed = [];
const check = (name, ok, detail = "") => { (ok ? passed : failed).push(name); console.log(`${ok ? "ok   " : "FAIL "} ${name}${!ok && detail ? `   [${String(detail).slice(0, 500)}]` : ""}`); };
const wait = async (fn, ms = 90_000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = fn(); if (v) return v; await new Promise((r) => setTimeout(r, 500)); } return undefined; };

let healthy = false;
const server = createServer((_req, res) => { res.statusCode = healthy ? 200 : 503; res.end(healthy ? "ok" : "starting"); });
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const url = `http://127.0.0.1:${server.address().port}/health`;

const work = mkdtempSync(join(tmpdir(), "sentinel-tool-e2e-"));
const record = join(work, "notified.txt");
writeFileSync(record, "");
const agentDir = isolatedAgentDir({ features: { sentinel: true }, sentinel: { model: "magpie/group/luna/low", intervalSeconds: 15, notify: ["sh", "-c", `cat >> ${record}; echo '---' >> ${record}`] } });
const pi = new PiRpc(agentDir, work);
const notified = () => readFileSync(record, "utf8");
try {
  await pi.ask(`帮我盯着 ${url} ，它现在是坏的，等它恢复了告诉我。`);
  const calls = pi.tools.filter((t) => t.name === "sentinel");
  check("the model calls the sentinel tool to watch the address", calls.some((c) => c.args?.action === "watch" && c.args?.kind === "url" && String(c.args?.target).includes(url)), JSON.stringify(pi.tools));
  check("it does not poll by itself or dispatch other agents", !pi.tools.some((t) => /herdr|spawn|curl/.test(JSON.stringify(t.args ?? {})) || ["bash", "write"].includes(t.name)), JSON.stringify(pi.tools.map((t) => t.name)));
  check("nothing is announced while it is still broken", notified() === "");

  healthy = true;
  check("the recovery is announced through the notification channel, by the background watcher", Boolean(await wait(() => notified().length > 0)), notified());

  await pi.ask("现在有哪些哨兵在盯着？");
  check("asked what is being watched, it uses the list action", pi.tools.some((t) => t.name === "sentinel" && t.args?.action === "list"), JSON.stringify(pi.tools.map((t) => t.args)));
  await pi.ask("哨兵都停掉吧。");
  check("asked to stop, it uses the stop action", pi.tools.some((t) => t.name === "sentinel" && t.args?.action === "stop"), JSON.stringify(pi.tools.map((t) => t.args)));
} catch (error) {
  check("the run", false, error.message);
} finally {
  pi.close();
  server.close();
  cleanup(agentDir, work);
}
console.log(`\n${passed.length} passed, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
