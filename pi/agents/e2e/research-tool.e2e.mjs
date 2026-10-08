// 端到端：真实的 Pi 收到“派几个 researcher 去调研”这样的话，应该调用 research 工具（几位不同模型各自联网调研），而不是用 herdr 去开 Claude Code 之类的 agent。
// 运行：node agents/e2e/research-tool.e2e.mjs   （会产生真实的模型调用和搜索）
import { existsSync } from "node:fs";
import { PiRpc, cleanup, isolatedAgentDir } from "./rpc.mjs";

const passed = [], failed = [];
const check = (name, ok, detail = "") => { (ok ? passed : failed).push(name); console.log(`${ok ? "ok   " : "FAIL "} ${name}${!ok && detail ? `   [${String(detail).slice(0, 500)}]` : ""}`); };

const agentDir = isolatedAgentDir({ features: { research: true }, research: { members: ["magpie/group/sonnet/medium", "magpie/group/sol/medium", "magpie/grok/grok-4.7/high"], synthesizer: "magpie/group/sonnet/medium" } });
const pi = new PiRpc(agentDir, process.cwd());
let file;
try {
  await pi.ask("你派两个 researcher 去调研一下：earendil-works 的 Pi coding agent 里 codemode.mode 这个设置有哪几种取值，默认值是什么？调研完用两三句话告诉我结论。");
  const names = pi.tools.map((t) => t.name);
  check("the model calls the research tool", names.includes("research"), JSON.stringify(names));
  check("it does not dispatch other agents with herdr", !pi.tools.some((t) => /herdr|spawn/.test(JSON.stringify(t.args ?? {}))), JSON.stringify(pi.tools.map((t) => t.args)).slice(0, 300));
  const text = (pi.lastAssistant?.content ?? []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
  check("it answers from the research: both values, and the default", /only/i.test(text) && /\bon\b|默认/.test(text), text.slice(0, 400));
  file = (text.match(/[^\s`'"(]+\/research\/[^\s`'")]+\.md/) ?? [])[0];
  check("when the answer names the saved research file, the file exists", file === undefined || existsSync(file), file);
} catch (error) {
  check("the run", false, error.message);
} finally {
  pi.close();
  cleanup(agentDir);
}
console.log(`\n${passed.length} passed, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
