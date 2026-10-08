// 端到端：真实的 Pi。账本按会话存：同一个目录里开两个会话，一个记的待办不会出现在另一个里（以前按目录存，会串）；
// 会话结束时账本里没有未了事项就不留文件。模型按给定参数调用 loose 工具。
// 运行：node agents/e2e/loose-sessions.e2e.mjs   （会产生真实的模型调用）
import { existsSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PiRpc, cleanup, isolatedAgentDir, until } from "./rpc.mjs";

const passed = [], failed = [];
const check = (name, ok, detail = "") => { (ok ? passed : failed).push(name); console.log(`${ok ? "ok   " : "FAIL "} ${name}${!ok && detail ? `   [${String(detail).slice(0, 400)}]` : ""}`); };

const work = mkdtempSync(join(tmpdir(), "loose-sessions-"));
const agentDir = isolatedAgentDir({ features: { loose: true }, loose: { model: "magpie/group/luna/low", notify: "pi" } });
const books = () => (existsSync(join(agentDir, "loose-ends")) ? readdirSync(join(agentDir, "loose-ends")).filter((f) => f.endsWith(".json")) : []);
const a = new PiRpc(agentDir, work);
const b = new PiRpc(agentDir, work); // 同一个目录、同一个 agent 目录，另一个会话
try {
  await a.call("loose", { action: "add", text: "给秋招投递补附件" });
  check("a todo noted in session A is on A's list", /给秋招投递补附件/.test(await a.call("loose", { action: "list" })));
  const listB = await b.call("loose", { action: "list" });
  check("session B, in the same directory, does not see it", /没有没做完的事/.test(listB) && !/秋招/.test(listB), listB);
  await b.call("loose", { action: "add", text: "修登录超时" });
  const listA = await a.call("loose", { action: "list" });
  check("and what B notes does not reach A", /秋招/.test(listA) && !/登录超时/.test(listA), listA);
  const files = books();
  check("each session has its own ledger file, named after its session", files.length === 2 && new Set(files).size === 2, files.join());
  check("A's file holds only A's item", files.some((f) => { const t = readFileSync(join(agentDir, "loose-ends", f), "utf8"); return /秋招/.test(t) && !/登录超时/.test(t); }), files.join());

  // 会话结束：有未了事项的留着（恢复时还在），空的不留
  await a.call("loose", { action: "done", ref: "秋招" });
  a.close();
  check("when a session ends with nothing left, its ledger file is removed", Boolean(await until(() => books().length === 1, 15_000)), books().join());
  b.close();
  await new Promise((r) => setTimeout(r, 1500));
  check("when a session ends with a live item, its ledger stays (so it can be resumed)", books().length === 1 && /登录超时/.test(readFileSync(join(agentDir, "loose-ends", books()[0]), "utf8")), books().join());
} catch (error) {
  check("the run", false, error.message);
} finally {
  a.close(); b.close();
  cleanup(agentDir, work);
}
console.log(`\n${passed.length} passed, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
