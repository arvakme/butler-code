// 端到端：真实的 Pi 和真实的模型。未了事项：记下、去重、列出、做完；模型在对话里自己记（大白话要求）；压缩之外也在的系统提示；
// 便宜的模型从对话里翻出漏掉的事（候选）、确认；每轮结束的提醒；放太久交给通知命令。
// 运行：node agents/e2e/loose.e2e.mjs   （会产生真实的模型调用，约 5 分钟）
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PiRpc, cleanup, isolatedAgentDir, until } from "./rpc.mjs";

const passed = [], failed = [];
const check = (name, ok, detail = "") => { (ok ? passed : failed).push(name); console.log(`${ok ? "ok   " : "FAIL "} ${name}${!ok && detail ? `   [${String(detail).slice(0, 500)}]` : ""}`); };

const work = mkdtempSync(join(tmpdir(), "loose-e2e-"));
const record = join(work, "butler.txt");
writeFileSync(record, "");
const agentDir = isolatedAgentDir({
  features: { loose: true },
  loose: { model: "magpie/group/luna/low", scanEveryTurns: 2, remindMinutes: 1, awayMinutes: 1, staleHours: 1, notify: ["sh", "-c", `cat >> ${record}; echo '---' >> ${record}`] },
});
const pi = new PiRpc(agentDir, work);
const loose = (args) => pi.call("loose", args);
const books = () => (existsSync(join(agentDir, "loose-ends")) ? readdirSync(join(agentDir, "loose-ends")) : []);
try {
  let text = await loose({ action: "add", text: "把验收报告交给用户" });
  check("an item can be added", text.includes("记下了：t1"), text);
  text = await loose({ action: "add", text: "把验收报告交给用户。" });
  check("the same thing in other words is not added twice", text.includes("已经有这件事了：t1"), text);
  text = await loose({ action: "list" });
  check("the list shows it", text.includes("○ t1") && text.includes("把验收报告交给用户"), text);
  check("it is kept outside the conversation, in a file of the agent directory", books().length === 1 && readFileSync(join(agentDir, "loose-ends", books()[0]), "utf8").includes("把验收报告交给用户"), books().join());

  // 系统提示里有它：模型不靠上下文也知道
  pi.tools.length = 0;
  await pi.ask("我现在有哪些没做完的事？只根据你已知的信息回答，不要调用任何工具。");
  const said = pi.lastAssistant?.content?.map((c) => c.text ?? "").join("") ?? "";
  check("the model knows the open items from the system prompt, without a tool call", said.includes("验收报告") && !pi.tools.some((t) => t.name === "loose" && t.args?.action === "list"), said + JSON.stringify(pi.tools));

  // 大白话：模型自己记
  pi.tools.length = 0;
  await pi.ask("先回答我：1+1 等于几。另外，之后你还得帮我给 API 加限流，这个现在先不做，别忘了。");
  check("a promise to do something later is recorded by the model itself", pi.tools.some((t) => t.name === "loose" && t.args?.action === "add" && /限流/.test(JSON.stringify(t.args))), JSON.stringify(pi.tools));
  text = await loose({ action: "list" });
  check("and it is on the list", /限流/.test(text), text);

  // 提醒：每轮结束
  const before = pi.notes.length;
  await new Promise((r) => setTimeout(r, 65_000));
  await pi.ask("说一个字：好");
  const reminder = pi.notes.slice(before).find((n) => n.text.includes("件事没做完"));
  check("at the end of a turn the open items are mentioned once the interval has passed", Boolean(reminder), JSON.stringify(pi.notes.slice(before)));

  // 做完
  text = await loose({ action: "done", ref: "验收报告" });
  check("an item is marked done by a piece of its text", text.includes("t1") && text.includes("标成做完"), text);
  text = await loose({ action: "done", ref: "写" });
  check("an unclear reference is refused, not guessed", /没有找到|好几件/.test(text), text);
  text = await loose({ action: "snooze", ref: "限流", hours: 2 });
  check("an item can be pushed back", text.includes("推迟 2 小时"), text);

  // 扫描：对话里答应了、没做、模型也没有记（这一轮明确要求它别用任何工具），便宜的模型翻对话时找出来
  pi.tools.length = 0;
  await pi.ask("请回答：2+2 等于几？（不要调用任何工具。）另外你待会儿还要帮我写一份部署文档，现在不写，只在心里记着。");
  await pi.ask("再说一个字：好。（不要调用任何工具。）");
  const unrecorded = !pi.tools.some((t) => t.name === "loose");
  const file = () => readFileSync(join(agentDir, "loose-ends", books()[0]), "utf8");
  const found = await until(() => (/"status": "candidate"/.test(file()) && /部署/.test(file()) ? true : undefined), 90_000);
  check("the background scan finds a promise nobody recorded and keeps it as a candidate", unrecorded && Boolean(found), `unrecorded=${unrecorded} ${file()}`);
  text = await loose({ action: "confirm", ref: "all" });
  check("candidates are confirmed in one go", /确认了 \d+ 件/.test(text) && /部署/.test(text), text);
  text = await loose({ action: "list" });
  check("a confirmed candidate is an ordinary open item", /○ t\d+\s+.*部署/.test(text), text);
} catch (error) {
  check("the run", false, error.message);
} finally {
  pi.close();
  cleanup(agentDir, work);
}
console.log(`\n${passed.length} passed, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
