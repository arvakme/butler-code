// 端到端：真实的 Pi，哨兵经 gh 盯 PR。进行中的状态用一个会随时间变化的 gh 替身（真实的 GitHub 没法按需让 CI 失败）；
// 另有一次对真实 gh 的查询（一个早已合并的真实 PR）。CI 失败时的“读日志”是真实的 Luna 调用。
// 运行：node agents/e2e/sentinel.e2e.mjs   （会产生真实的模型调用）
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PiRpc, cleanup, isolatedAgentDir } from "./rpc.mjs";

const passed = [], failed = [];
const check = (name, ok, detail = "") => { (ok ? passed : failed).push(name); console.log(`${ok ? "ok   " : "FAIL "} ${name}${!ok && detail ? `   [${String(detail).slice(0, 300)}]` : ""}`); };
const wait = async (fn, ms = 120_000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = fn(); if (v) return v; await new Promise((r) => setTimeout(r, 500)); } return undefined; };

const work = mkdtempSync(join(tmpdir(), "sentinel-e2e-"));
const bin = join(work, "bin"); mkdirSync(bin);
const state = join(work, "state.json");
const record = join(work, "notified.txt");
writeFileSync(record, "");
const pr = (extra) => JSON.stringify({ title: "加上折扣券", url: "https://github.com/example/shop/pull/7", state: "OPEN", isDraft: false, mergeable: "MERGEABLE", reviewDecision: "", headRefName: "feature-coupon", comments: [], reviews: [], statusCheckRollup: [], ...extra });
const set = (extra) => writeFileSync(state, pr(extra));
set({ statusCheckRollup: [{ name: "build", status: "IN_PROGRESS", conclusion: "" }, { name: "test", status: "IN_PROGRESS", conclusion: "" }] });
// gh 替身：pr view 返回 state.json；run list 返回一条失败的运行；run view --log-failed 返回一段真实风格的失败日志
writeFileSync(join(bin, "gh"), `#!/bin/sh
case "$1 $2" in
  "pr view") cat "${state}" ;;
  "run list") echo '[{"databaseId":4242,"conclusion":"failure"}]' ;;
  "run view") printf '%s\\n' "test	Run npm test" "test	> shop@1.0.0 test" "test	AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:" "test	  + actual - expected" "test	  - 80" "test	  + 99.8" "test	    at file:///home/runner/work/shop/discount.test.js:4:8" "test	##[error]Process completed with exit code 1." ;;
  *) echo "unexpected gh call: $*" >&2; exit 1 ;;
esac
`);
chmodSync(join(bin, "gh"), 0o755);

const agentDir = isolatedAgentDir({
  features: { sentinel: true },
  sentinel: { model: "magpie/group/luna/low", intervalSeconds: 15, notify: ["sh", "-c", `cat >> ${record}; echo '---' >> ${record}`] },
});
const pi = new PiRpc(agentDir, work, { PATH: `${bin}:${process.env.PATH}` });
const notified = () => readFileSync(record, "utf8");
const sentinel = (rpc, args) => rpc.call("sentinel", args);
try {
  const started = await sentinel(pi, { action: "watch", kind: "pr", target: "7" });
  check("the sentinel starts on a PR whose CI is still running", started.includes("哨兵 s1 开始盯 PR 7"), started);
  check("list shows it", (await sentinel(pi, { action: "list" })).includes("PR 7"));
  check("nothing is announced while nothing changed", notified() === "");

  set({ statusCheckRollup: [{ name: "build", status: "COMPLETED", conclusion: "SUCCESS" }, { name: "test", status: "COMPLETED", conclusion: "FAILURE" }] });
  check("a failing check is announced (to the butler command)", Boolean(await wait(() => notified().includes("CI 失败了：test"))), notified());
  check("with the real model's plain-language reading of the failing log", Boolean(await wait(() => notified().includes("原因（模型读日志的判断）："))), notified());
  const reason = notified().split("原因（模型读日志的判断）：")[1] ?? "";
  check("and that reading mentions the real problem (80 vs 99.8)", /80|99\.8|断言|不相等|折扣/.test(reason), reason);

  set({ reviewDecision: "APPROVED", statusCheckRollup: [{ name: "build", status: "COMPLETED", conclusion: "SUCCESS" }, { name: "test", status: "COMPLETED", conclusion: "SUCCESS" }] });
  check("CI going green and the approval are announced", Boolean(await wait(() => notified().includes("CI 全部通过"))), notified());
  const failsBefore = (notified().match(/CI 失败了/g) ?? []).length;
  await new Promise((r) => setTimeout(r, 35_000));
  check("the same state is not announced again", (notified().match(/CI 全部通过/g) ?? []).length === 1 && (notified().match(/CI 失败了/g) ?? []).length === failsBefore);

  set({ state: "MERGED" });
  check("the merge is announced", Boolean(await wait(() => notified().includes("已合并"))), notified());
  check("and the sentinel stops by itself after the merge", (await sentinel(pi, { action: "list" })).includes("现在没有在盯"));

  // 真实的 gh：一个早已合并的真实 PR，应当立刻报告并结束
  const real = new PiRpc(agentDir, work);
  try {
    writeFileSync(record, "");
    const text = await sentinel(real, { action: "watch", kind: "pr", target: "https://github.com/yetone/magpie/pull/391" });
    check("the real gh sees a really merged PR at once", Boolean(await wait(() => notified().includes("已合并") || real.notes.some((n) => n.text.includes("已合并")), 60_000)), `${text}\n${notified()}`);
  } finally { real.close(); }
  const bad = await sentinel(pi, { action: "stop", target: "zzz" });
  check("stopping an unknown id says so, with the usage", bad.includes("没有这个编号") && bad.includes("kind 是"), bad);
} catch (error) {
  check("the sentinel ran", false, error.message);
} finally {
  pi.close();
  cleanup(agentDir, work);
}
console.log(`\n${passed.length} passed, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
