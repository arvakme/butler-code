// 端到端：真实的 Pi，三家不同服务商的模型（Sonnet、Sol、Grok）各自联网独立调研，再合并并交叉验证，真实的搜索。问一个答案可以核对的问题。
// 运行：node agents/e2e/research.e2e.mjs   （会产生真实的模型调用和搜索）
import { existsSync, readFileSync } from "node:fs";
import { PiRpc, cleanup, isolatedAgentDir } from "./rpc.mjs";

const passed = [], failed = [];
const check = (name, ok, detail = "") => { (ok ? passed : failed).push(name); console.log(`${ok ? "ok   " : "FAIL "} ${name}${!ok && detail ? `   [${String(detail).slice(0, 400)}]` : ""}`); };

const agentDir = isolatedAgentDir({ features: { research: true }, research: { members: ["magpie/group/sonnet/medium", "magpie/group/sol/medium", "magpie/grok/grok-4.7/high"], synthesizer: "magpie/group/sonnet/medium" } });
const pi = new PiRpc(agentDir, process.cwd());
let file;
try {
  const text = await pi.call("research", { question: "In the Pi coding agent from earendil-works, what does the codemode.mode setting do, and what is its default value?" }, 1_200_000);
  file = text.match(/（完整结果：([^；）\s]+)/)?.[1];
  check("the research finishes with a result saved in a file", Boolean(file && existsSync(file)), text.slice(-300));
  const body = file && existsSync(file) ? readFileSync(file, "utf8") : "";
  check("the answer has the sections the reader needs (conclusion, cross-check, basis, sources)", ["## 结论", "## 交叉验证", "## 依据", "## 来源"].every((h) => body.includes(h)), body.slice(0, 300));
  check("it gives real source addresses", /https?:\/\/\S+/.test(body), body.slice(0, 300));
  check("it answers correctly: the default is on (and 'only' is the other mode)", /默认[^。]{0,20}(on|开)|\bon\b[^。]{0,30}默认|default[^.]{0,30}\bon\b/i.test(body) && /only/i.test(body), body.slice(0, 600));
  check("it names all three researchers and none failed", /sonnet/i.test(body) && /sol/i.test(body) && /grok/i.test(body) && !/（失败）/.test(body), body.slice(-300));
} catch (error) {
  check("the research ran", false, error.message);
} finally {
  pi.close();
  cleanup(agentDir, file);
}
console.log(`\n${passed.length} passed, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
