// 端到端：真实的 Pi + 真实的模型。纠错本里写着两条规矩，一条在项目里（新文件名以 zz- 开头），一条在全局（回复最后一行写 [已对照纠错本]）；
// 不提醒、不说纠错本，只让它做一件小事，看它是不是自己照着做了。对照组：同样的事，不开这个功能，它就不会照着做。
// 再测记录：说一句“记到纠错本里”，它要用 lesson 工具按格式记进正确的那一本（项目的 / 全局的）。
// 运行：node agents/e2e/lessons.e2e.mjs   （会产生真实的模型调用）
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PiRpc, cleanup, isolatedAgentDir } from "./rpc.mjs";

const passed = [], failed = [];
const check = (name, ok, detail = "") => { (ok ? passed : failed).push(name); console.log(`${ok ? "ok   " : "FAIL "} ${name}${!ok && detail ? `   [${String(detail).slice(0, 500)}]` : ""}`); };
const text = (message) => (message?.content ?? []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
const TASK = "在当前目录建一个文件，内容是 hi，文件名你来定，做完简单告诉我。";

function project(root) {
  execFileSync("git", ["-C", root, "init", "-q"]);
  mkdirSync(join(root, ".agents/acceptance"), { recursive: true });
  writeFileSync(join(root, ".agents/acceptance/common-mistakes.md"), "# 常见错误\n\n- **P1 · 2026-10-01** 这个项目里新建的文件名必须以 zz- 开头。\n  检查：用 ls 确认文件名。\n");
}
const globalFile = join(mkdtempSync(join(tmpdir(), "lessons-global-")), "common-mistakes.md");
writeFileSync(globalFile, "# 常见错误清单\n\n## 通用清单\n\n- **G1 回复要带标记。** 每次回复的最后一行都要单独写 [已对照纠错本]。\n  检查：看回复的最后一行。\n\n## 项目条目格式\n\n示例格式见项目文件。\n");

const work = mkdtempSync(join(tmpdir(), "lessons-e2e-"));
const control = mkdtempSync(join(tmpdir(), "lessons-control-"));
project(work); project(control);
const agentDir = isolatedAgentDir({ features: { lessons: true }, lessons: { maxChars: 12000, globalFile } });
const controlDir = isolatedAgentDir({ features: { choose: true }, choose: { model: "magpie/group/luna/low" } });
const pi = new PiRpc(agentDir, work);
const ctl = new PiRpc(controlDir, control);
try {
  await pi.ask(TASK, 300_000);
  const files = readdirSync(work).filter((f) => !f.startsWith("."));
  check("with the notebook: the file it created follows the project rule (name starts with zz-), without being told", files.length >= 1 && files.every((f) => f.startsWith("zz-")), JSON.stringify(files));
  const reply = text(pi.lastAssistant).trim();
  check("and the reply ends with the marker from the global notebook", reply.split("\n").at(-1).includes("[已对照纠错本]"), reply.slice(-200));

  await ctl.ask(TASK, 300_000);
  const controlFiles = readdirSync(control).filter((f) => !f.startsWith("."));
  check("control (feature off): the same task does not follow the rule, so the behaviour above comes from the notebook", controlFiles.length >= 1 && !controlFiles.every((f) => f.startsWith("zz-")), JSON.stringify(controlFiles));

  await pi.ask("我想让你记住一条规矩：这个项目里提交信息不能用英文。请记到纠错本里。", 300_000);
  const calls = pi.tools.filter((t) => t.name === "lesson");
  check("asked to note it, the model uses the lesson tool (not hand editing)", calls.length >= 1 && !pi.tools.some((t) => ["write", "edit"].includes(t.name) && /common-mistakes/.test(JSON.stringify(t.args))), JSON.stringify(pi.tools.map((t) => [t.name, t.args?.scope])));
  const projectText = readFileSync(join(work, ".agents/acceptance/common-mistakes.md"), "utf8");
  check("it went into the project notebook as the next entry, in the right format", /- \*\*P2 · \d{4}-\d\d-\d\d\*\* .*英文/.test(projectText) && /\n  检查：/.test(projectText), projectText);
  check("the global notebook was left alone", !/G2/.test(readFileSync(globalFile, "utf8")));

  await pi.ask("再记一条，这条是所有项目都通用的：写 shell 脚本第一行之后必须有 set -eu。记到全局纠错本。", 300_000);
  const globalText = readFileSync(globalFile, "utf8");
  check("a global one goes into the global notebook as G2, before the format section", /- \*\*G2 .*set -eu/.test(globalText) && globalText.indexOf("G2") < globalText.indexOf("## 项目条目格式"), globalText);
  check("and it did not touch the project notebook", (readFileSync(join(work, ".agents/acceptance/common-mistakes.md"), "utf8").match(/\*\*P\d/g) ?? []).length === 2);
} catch (error) {
  check("the run", false, error.message);
} finally {
  pi.close(); ctl.close();
  cleanup(agentDir, controlDir, work, control, dirnameOf(globalFile));
}
function dirnameOf(p) { return p.slice(0, p.lastIndexOf("/")); }
console.log(`\n${passed.length} passed, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
