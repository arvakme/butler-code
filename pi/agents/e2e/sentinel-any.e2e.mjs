// 端到端：真实的 Pi，哨兵盯“任何东西”——靠一条看一眼的命令。被盯的是真实的文件和进程；
// 有目标的盯梢由真实的 Luna 判断每次变化（只在输出变了才调用）。
// 运行：node agents/e2e/sentinel-any.e2e.mjs   （会产生真实的模型调用）
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PiRpc, cleanup, isolatedAgentDir } from "./rpc.mjs";

const passed = [], failed = [];
const check = (name, ok, detail = "") => { (ok ? passed : failed).push(name); console.log(`${ok ? "ok   " : "FAIL "} ${name}${!ok && detail ? `   [${String(detail).slice(0, 400)}]` : ""}`); };
const wait = async (fn, ms = 120_000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = fn(); if (v) return v; await new Promise((r) => setTimeout(r, 500)); } return undefined; };

const work = mkdtempSync(join(tmpdir(), "sentinel-any-e2e-"));
const record = join(work, "notified.txt");
writeFileSync(record, "");
const file = (name, text) => writeFileSync(join(work, name), text);
const agentDir = isolatedAgentDir({ features: { sentinel: true }, sentinel: { model: "magpie/group/luna/low", intervalSeconds: 15, notify: ["sh", "-c", `cat >> ${record}; echo '---' >> ${record}`] } });
const pi = new PiRpc(agentDir, work);
const notified = () => readFileSync(record, "utf8");
const sentinel = (args) => pi.call("sentinel", args);
const list = () => sentinel({ action: "list" });
const watch = (target, extra = {}) => sentinel({ action: "watch", kind: "cmd", target, ...extra });
let sleeper;
try {
  // 1 没有目标：输出一变就报，没变不报
  file("plain.txt", "files: 1");
  let text = await watch("cat plain.txt");
  check("any command can be watched", text.includes("开始盯 命令 cat plain.txt"), text);
  await new Promise((r) => setTimeout(r, 20_000));
  check("nothing is announced while the output is the same", notified() === "");
  file("plain.txt", "files: 2");
  check("a change in the output is announced with before and after", Boolean(await wait(() => /输出变了[\s\S]*前：files: 1[\s\S]*后：files: 2/.test(notified()))), notified());
  await sentinel({ action: "stop", target: "all" });

  // 2 until：命令输出里出现某个词就结束
  writeFileSync(record, "");
  file("job.log", "step 1\nstep 2");
  await watch("tail -n 1 job.log", { until: "finished" });
  file("job.log", "step 1\nstep 2\nfinished ok");
  check("until ends the watch the moment the output matches", Boolean(await wait(() => notified().includes("满足条件了") && notified().includes("finished ok"))), notified());
  check("and the watcher is gone", (await list()).includes("现在没有在盯"));

  // 3 exit0：一个进程结束时命令才成功退出
  writeFileSync(record, "");
  sleeper = spawn("sleep", ["25"]);
  await watch(`! kill -0 ${sleeper.pid}`, { until: "exit0" });
  check("a process that is still alive is not announced", notified() === "");
  sleeper.kill();
  check("exit0 ends the watch when the process is gone", Boolean(await wait(() => notified().includes("命令成功退出"))), notified());

  // 4 有目标：模型只在值得说的时候说
  writeFileSync(record, "");
  file("workers.txt", "worker-a running\nworker-b running\nworker-c running");
  await watch("cat workers.txt", { goal: "三个 worker 全部有结果时告诉我，只有一两个有结果不用说" });
  check("a goal makes the real model judge: nothing to say at the start", notified() === "", notified());
  file("workers.txt", "worker-a done\nworker-b running\nworker-c running");
  await new Promise((r) => setTimeout(r, 40_000));
  check("one of three done is not enough to speak", notified() === "", notified());
  file("workers.txt", "worker-a done\nworker-b done\nworker-c done");
  check("all three done is announced, in plain words", Boolean(await wait(() => notified().length > 0)), notified());
  await new Promise((r) => setTimeout(r, 3000));
  check("the watcher list is empty after the goal is met", (await list()).includes("现在没有在盯"), await list());

  // 5 当场说：命令根本跑不起来
  text = await watch("definitely-not-a-command-xyz");
  check("a command that cannot run is refused at once", text.includes("盯不了"), text);
  text = await watch("cat plain.txt", { until: "([" });
  check("a broken until is refused at once", text.includes("until 要写"), text);
} catch (error) {
  check("the run", false, error.message);
} finally {
  sleeper?.kill();
  pi.close();
  cleanup(agentDir, work);
}
console.log(`\n${passed.length} passed, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
