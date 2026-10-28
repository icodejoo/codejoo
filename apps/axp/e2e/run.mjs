// @ts-nocheck
/**
 * 端到端自动化：用真实 Playwright + 真实 Chromium 驱动演练场,逐项断言。
 *
 *   - 若 mock(:4570) 与 dev(:5180) 已在运行 → 复用(配合手动 `npm run e2e:server` + `npm run e2e:dev`)
 *   - 否则自动拉起两个服务,跑完再回收
 *
 * 每个 case 对应演练场上的一个按钮(= 一个公开 API 动作),动作契约由页面与 runner 共同校验，覆盖 createAxp 基础 API 与并发失败场景。
 * 任一断言失败 → 退出码 1。
 *
 * 运行：`npm run e2e`
 */
import { chromium } from "playwright";
import { APP, MOCK, startServices } from "./services.mjs";

// ── assert helpers ───────────────────────────────────────────────────────────
/** 检查 JSON 值一致。 */
const eq = (a, b, msg) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
};
/** 检查布尔断言。 */
const ok = (c, msg) => {
  if (!c) throw new Error(msg);
};

/**
 * 每个 case：{ action(按钮 testid), result(结果面板 testid), exports(本 case 覆盖的导出), check(j) }
 */
const cases = [
  // ── createAxp：七个动词 + 三种返回形态 ──
  { action: "core-get", result: "core-result", exports: ["createAxp", "get"], check: (j) => eq(j.query.q, "1", "get query") },
  { action: "core-post", result: "core-result", exports: ["post"], check: (j) => eq(j.body.name, "x", "post body") },
  { action: "core-put", result: "core-result", exports: ["put"], check: (j) => eq(j.body.v, 1, "put body") },
  { action: "core-patch", result: "core-result", exports: ["patch"], check: (j) => eq(j.body.v, 2, "patch body") },
  { action: "core-delete", result: "core-result", exports: ["delete"], check: (j) => eq(j.body.del, 1, "delete body") },
  { action: "core-head", result: "core-result", exports: ["head"], check: (j) => eq(j.head, "resolved", "head") },
  { action: "core-options", result: "core-result", exports: ["options"], check: (j) => eq(j.options, "resolved", "options") },
  { action: "core-plain", result: "core-result", exports: ["默认解包 data"], check: (j) => eq(j.query.shape, "plain", "plain unwrap") },
  {
    action: "core-raw",
    result: "core-result",
    exports: ["wrap → r.raw"],
    check: (j) => {
      ok(j.code === "0000" && j.data && "message" in j, "envelope fields on r");
      eq(j.rawStatus, 200, "raw AxiosResponse status");
      eq(j.rawEnvelope.code, "0000", "raw keeps the original envelope");
    },
  },
  {
    action: "core-wrap",
    result: "core-result",
    exports: ["wrap", "isAxpResponse"],
    check: (j) => {
      ok(j.ok === true && j.kind === "ok" && j.status === 200, "wrap ok");
      ok(j.isResponse === true && j.isBrand === true, "brand recognized by api.isResponse / isAxpResponse");
      eq(j.data.method, "GET", "business data under r.data");
    },
  },
  {
    action: "core-throws-false",
    result: "core-result",
    exports: ["throws:false"],
    check: (j) => {
      ok(j.resolved === true && j.ok === false, "failure resolves, ok=false");
      eq([j.kind, j.status, j.httpStatus], ["http", 400, 400], "http failure fields");
    },
  },
  {
    action: "core-throw",
    result: "core-result",
    exports: ["默认抛出 IAxpResponse"],
    check: (j) => {
      ok(j.thrown === true && j.isResponse === true, "failure is thrown as IAxpResponse");
      ok(j.isError === false && j.hasStack === false, "plain object, no stack by default");
      eq([j.kind, j.status], ["http", 400], "http failure fields");
    },
  },

  // ── use / eject / inspect / plugin / extend / dispose ──
  {
    action: "lifecycle-use",
    result: "lifecycle-result",
    exports: ["use"],
    check: (j) => {
      eq(j.names, ["logging", "tracer"], "use");
      eq(j.stages, ["attempt", "attempt"], "custom plugins default to the attempt stage");
    },
  },
  {
    action: "lifecycle-eject",
    result: "lifecycle-result",
    exports: ["eject"],
    check: (j) => {
      ok(j.ejected === true && j.again === false, "eject returns whether it existed");
      eq(j.names, ["tracer"], "eject keeps the others");
    },
  },
  {
    action: "lifecycle-inspect",
    result: "lifecycle-result",
    exports: ["inspect"],
    check: (j) => {
      eq(j.names, ["axp:loading", "axp:notify", "axp:repath", "axp:filter", "axp:retry", "axp:auth", "axp:mock", "axp:share", "axp:cache"], "built-in plugins ordered by stage, not by array order");
      ok(j.snapshotIsCopy === true, "inspect returns a fresh copy");
    },
  },
  {
    action: "lifecycle-extend",
    result: "lifecycle-result",
    exports: ["extend"],
    check: (j) => {
      eq(j.parent, ["logging"], "parent");
      eq(j.child, ["logging", "tracer"], "child inherits parent plugins, then adds its own");
    },
  },
  {
    action: "lifecycle-extend-state",
    result: "lifecycle-result",
    exports: ["extend (independent state)"],
    check: (j) => {
      eq(j.parentHits, 1, "parent cache hit");
      eq(j.childHits, 2, "child has its own empty cache");
    },
  },
  {
    action: "lifecycle-plugin",
    result: "lifecycle-result",
    exports: ["plugin", "stateKey"],
    check: (j) => {
      eq([j.before, j.after], [0, 1], "plugin api sees the request");
      eq(j.seen, ["/api/echo"], "plugin api state");
      ok(j.missing === true, "plugin not installed → undefined");
    },
  },
  {
    action: "lifecycle-dispose",
    result: "lifecycle-result",
    exports: ["dispose", "pending"],
    check: (j) => {
      eq(j.pendingBefore, 1, "one in flight");
      eq(j.kind, "cancel", "dispose aborts in-flight requests");
      eq(j.pendingAfter, 0, "nothing pending after dispose");
      eq(j.afterDispose, "rejected", "disposed client refuses new requests");
    },
  },

  // ── key（内核服务）──
  { action: "key-same", result: "key-result", exports: ["key (auto, same params)"], check: (j) => eq(j.serverHits, 1, "same params share one key") },
  { action: "key-params", result: "key-result", exports: ["key (auto, params in key)"], check: (j) => eq(j.serverHits, 2, "different params are different keys") },
  { action: "key-explicit", result: "key-result", exports: ["key (explicit string)"], check: (j) => eq(j.serverHits, 1, "explicit key overrides auto key") },
  {
    action: "key-scope",
    result: "key-result",
    exports: ["key (scope)"],
    check: (j) => {
      eq(j.sameAccount, 1, "same scope shares the entry");
      eq(j.afterSwitch, 2, "scope function re-evaluated per request");
    },
  },

  // ── cache ──
  {
    action: "cache-hit-twice",
    result: "cache-result",
    exports: ["cache"],
    check: (j) => {
      eq(j.serverHits, 1, "cache one network hit");
      eq(j.r2.hits, 1, "cache served second");
    },
  },
  {
    action: "cache-remove",
    result: "cache-result",
    exports: ["removeCache"],
    check: (j) => {
      ok(j.removed === true, "removed");
      eq(j.serverHits, 2, "refetch after remove");
    },
  },
  {
    action: "cache-clear",
    result: "cache-result",
    exports: ["clearCache"],
    check: (j) => {
      ok(j.cleared >= 1, "clearCache count");
      ok(j.withoutPlugin === false, "removeCache without the plugin returns false");
    },
  },
  { action: "cache-post", result: "cache-result", exports: ["cache (POST off by default)"], check: (j) => eq(j.serverHits, 2, "POST is not cached") },

  // ── share ──
  {
    action: "share-start",
    result: "share-result",
    exports: ["share (start)"],
    check: (j) => {
      eq(j.serverHits, 1, "start merges");
      ok(
        j.hitsSeen.every((h) => h === 1),
        "all callers same",
      );
    },
  },
  {
    action: "share-race",
    result: "share-result",
    exports: ["share (race)"],
    check: (j) => {
      eq(j.serverHits, 3, "race each sends");
      ok(
        j.results.every((r) => r.hits === j.results[0].hits),
        "all callers get the winner",
      );
    },
  },
  {
    action: "share-end",
    result: "share-result",
    exports: ["share (end)"],
    check: (j) => {
      eq(j.serverHits, 3, "end each sends");
      eq(j.sameResult, 1, "end one result");
    },
  },
  { action: "share-off", result: "share-result", exports: ["share:false"], check: (j) => eq(j.serverHits, 3, "share:false opts out") },

  // ── retry ──
  {
    action: "retry-run",
    result: "retry-result",
    exports: ["retry"],
    check: (j) => {
      eq(j.serverHits, 3, "retry 3 hits");
      eq(j.result.hits, 3, "retry success");
    },
  },
  {
    action: "retry-disabled",
    result: "retry-result",
    exports: ["retry:0"],
    check: (j) => {
      ok(j.rejected === true, "retry:0 rejects");
      eq([j.kind, j.status], ["http", 500], "http failure");
      eq(j.serverHits, 1, "no retry");
    },
  },

  // ── cancel（内核）──
  {
    action: "cancel-run",
    result: "cancel-result",
    exports: ["cancelAll"],
    check: (j) => {
      ok(j.canceled === true, "cancelAll aborts");
      eq([j.pendingBefore, j.cancelled, j.again, j.pendingAfter], [1, 1, 0, 0], "counts: 1 in flight → 1 cancelled → none left");
    },
  },
  {
    action: "cancel-signal",
    result: "cancel-result",
    exports: ["signal"],
    check: (j) => {
      ok(j.canceled === true, "user signal cancels");
      eq(j.pendingAfter, 0, "nothing pending");
    },
  },

  // ── loading ──
  { action: "loading-run", result: "loading-result", exports: ["loading"], check: (j) => eq(j.toggles, [true, false], "loading toggles once") },

  // ── notify ──
  {
    action: "notify-run",
    result: "notify-result",
    exports: ["notify"],
    check: (j) => {
      eq(j.failed, 1, "a failed request notifies once");
      eq(j.afterSuppressed, 1, "notify:false, silent and success do not notify");
    },
  },

  // ── mock ──
  { action: "mock-run", result: "mock-result", exports: ["mock"], check: (j) => ok(j.mocked === true && j.path.includes("/mock"), "mock rewrite") },
  {
    action: "mock-fallback",
    result: "mock-result",
    exports: ["mock (404 fallback)"],
    check: (j) => {
      eq(j.path, "/api/echo", "reached real route");
      eq(j.query.via, "fallback", "real request");
      ok(!j.mocked, "not from mock");
    },
  },
  {
    action: "mock-request",
    result: "mock-result",
    exports: ["mock (per request)"],
    check: (j) => {
      ok(j.offMocked === false && j.offPath === "/api/echo", "plugin mock:false by default → real route");
      ok(j.onMocked === true, "request-level mock:true → mock route");
    },
  },

  // ── envs ──
  {
    action: "envs-run",
    result: "envs-result",
    exports: ["envs"],
    check: (j) => {
      eq(j.baseURL, MOCK, "baseURL unchanged");
      eq(j.xEnv, "prod", "env header merged");
      eq(j.chain, [], "envs is not part of the middleware chain");
    },
  },

  // ── filter ──
  {
    action: "filter-run",
    result: "filter-result",
    exports: ["filter"],
    check: (j) => {
      eq(j.query.a, "1", "keep a");
      eq(j.query.e, "0", "keep 0");
      ok(!("b" in j.query) && !("c" in j.query) && !("d" in j.query), "drop empties");
    },
  },
  { action: "filter-off", result: "filter-result", exports: ["filter:false"], check: (j) => ok("b" in j.query && j.query.e === "0", "filter:false keeps empties") },

  // ── repath ──
  { action: "pathvars-run", result: "pathvars-result", exports: ["repath"], check: (j) => eq(j.path, "/users/7/posts/9", "path vars substituted") },

  // ── 归一化响应（替代旧 normalize 插件、ApiError、ApiResponse）──
  { action: "response-ok", result: "response-result", exports: ["response (ok)"], check: (j) => eq(j.query.ok, "1", "success passes through") },
  {
    action: "response-biz",
    result: "response-result",
    exports: ["response (biz failure)", "AXP_KINDS"],
    check: (j) => {
      ok(j.rejected === true && j.isResponse === true, "rejects with an IAxpResponse");
      ok(j.isError === false, "not an Error");
      eq([j.kind, j.code, j.ok], ["biz", "5001", false], "carries the business code");
    },
  },
  {
    action: "response-reject",
    result: "response-result",
    exports: ["reject"],
    check: (j) => {
      ok(j.rejected === true && j.isError === true, "reject adapts the failure into an Error");
      ok(j.isResponse === true && j.kind === "biz", "the response rides on error.response");
    },
  },
  {
    action: "response-empty",
    result: "response-result",
    exports: ["response (empty body)"],
    check: (j) => {
      ok(j.ok === true && j.kind === "ok", "204 with no body is a success");
      eq(j.httpStatus, 204, "http status");
    },
  },
  {
    action: "response-custom",
    result: "response-result",
    exports: ["axpResponse", "AxpResponse"],
    check: (j) => {
      eq(j.defaultKind, "biz", "default rule rejects code 7777");
      ok(j.customOk === true && j.customKind === "ok", "subclass overrides ok, kind follows");
      ok(j.isBrand === true && j.isSubclass === true, "still recognized, still the subclass");
    },
  },

  // ── TokenManager ──
  {
    action: "token-set",
    result: "token-result",
    exports: ["TokenManager"],
    check: (j) => {
      eq(j.accessToken, "Bearer abc", "bearer prefix");
      eq(j.refreshToken, "refresh1", "refresh");
    },
  },
  { action: "token-clear", result: "token-result", exports: ["TokenManager.clear"], check: (j) => ok(!j.accessToken && !j.refreshToken, "cleared") },

  // ── 演练场自检：真实后端计数 ──
  {
    action: "harness-counters",
    result: "harness-result",
    exports: ["mock server counters"],
    check: (j) => {
      eq(j.statuses, [500, 500], "first two hits fail");
      eq([j.thirdStatus, j.thirdHits], [200, 3], "third succeeds and counts every hit");
      eq(j.reads, [3, 3], "reading does not add hits");
      eq(j.afterReset, 0, "reset zeroes the counter");
      eq(j.failAgainAfterReset, 500, "fail sequence restarts after reset");
    },
  },

  // ── 集成（高并发 / 乱序 / 夹错 / auth 刷新）──
  {
    action: "int-share-start",
    result: "int-share-result",
    exports: ["integration: share start dedup"],
    check: (j) => {
      ok(j.pass === true, "share dedup");
      eq(j.serverHits, 1, "one network hit");
    },
  },
  {
    action: "int-race-run",
    result: "int-race-result",
    exports: ["integration: race"],
    check: (j) => {
      ok(j.pass === true, "race");
      eq(j.serverHits, 3, "race each sends");
    },
  },
  {
    action: "int-retry-recover",
    result: "int-retry-result",
    exports: ["integration: retry recover"],
    check: (j) => {
      ok(j.pass === true, "retry recover");
      eq(j.serverHits, 3, "3 hits");
    },
  },
  {
    action: "int-retry-exhaust",
    result: "int-retry-result",
    exports: ["integration: retry exhaust (no infinite loop)"],
    check: (j) => {
      ok(j.pass === true, "exhaust rejects");
      eq(j.serverHits, 3, "1+2 then stop");
    },
  },
  {
    action: "int-crosstalk-run",
    result: "int-crosstalk-result",
    exports: ["integration: no crosstalk"],
    check: (j) => {
      ok(j.pass === true, "no crosstalk");
      eq(j.count, 20, "20 concurrent");
    },
  },
  {
    action: "int-loading-run",
    result: "int-loading-result",
    exports: ["integration: loading concurrency"],
    check: (j) => {
      ok(j.pass === true, "loading once");
      eq(j.toggles, [true, false], "one show one hide");
    },
  },
  {
    action: "int-auth-run",
    result: "int-auth-result",
    exports: ["integration: auth single-flight"],
    check: (j) => {
      ok(j.pass === true, "auth recovers");
      eq(j.refreshCalls, 1, "single-flight refresh");
    },
  },
  {
    action: "int-auth-fail-run",
    result: "int-auth-fail-result",
    exports: ["integration: auth refresh fail"],
    check: (j) => {
      ok(j.pass === true, "all reject");
      ok(j.allRejected === true, "no replay");
      eq(j.expired, 1, "onAccessExpired fires once per round, not once per request");
      eq(j.reasons, ["auth/expired"], "every caller gets kind:auth reason:expired");
    },
  },
  {
    action: "int-auth-burst-run",
    result: "int-auth-burst-result",
    exports: ["integration: auth timeline (slow-ok/slow-fail/during-refresh)"],
    check: (j) => {
      ok(j.pass === true, "timeline");
      eq(j.refreshCalls, 1, "single-flight");
      ok(j.failed.includes("slowFail"), "slow failure present");
    },
  },
  {
    action: "int-auth-bounded-run",
    result: "int-auth-bounded-result",
    exports: ["integration: auth bounded convergence"],
    check: (j) => {
      ok(j.pass === true, "bounded");
      ok(j.refreshCalls >= 1 && j.refreshCalls <= 10, "≤1 refresh/request (no infinite loop)");
      eq(j.expired, 1, "one expired notification for the whole round");
    },
  },
];

/** 点击动作并等到本次结果完成后执行断言。 */
async function runCase(page, c) {
  await page.getByTestId(c.action).click();
  const pane = page.locator(`[data-testid="${c.result}"].ok, [data-testid="${c.result}"].err`).first();
  await pane.waitFor({ timeout: 15000 });
  const txt = await page.getByTestId(c.result).textContent();
  let j;
  try {
    j = JSON.parse(txt);
  } catch {
    throw new Error(`result not JSON: ${txt?.slice(0, 120)}`);
  }
  c.check(j);
}

/** 启动本地服务并驱动全部 UI 用例，任何退出路径均回收资源。 */
async function main() {
  const activeCases = process.env.E2E_INTEGRATION_ONLY ? cases.filter((c) => c.action.startsWith("int-")) : cases;
  const closeServices = await startServices();
  let browser;
  try {
    browser = process.env.E2E_CDP_URL ? await chromium.connectOverCDP(process.env.E2E_CDP_URL) : await chromium.launch({ channel: process.env.E2E_BROWSER_CHANNEL || "chrome" });
    const page = await browser.newPage();
    const consoleErrors = [];
    page.on("pageerror", (e) => consoleErrors.push(e.message));
    await page.goto(APP, { waitUntil: "networkidle" });
    // 契约预检：缺失按钮或面板立即失败，不逐项等待超时。
    for (const c of activeCases) {
      eq(await page.getByTestId(c.action).count(), 1, "action " + c.action);
      eq(await page.getByTestId(c.result).count(), 1, "result " + c.result);
    }

    let pass = 0;
    const fails = [];
    const covered = new Set();
    for (const c of activeCases) {
      process.stdout.write(`• ${c.action} … `);
      try {
        await runCase(page, c);
        pass++;
        c.exports.forEach((e) => covered.add(e));
        console.log("PASS");
      } catch (e) {
        fails.push({ action: c.action, error: e.message });
        console.log("FAIL — " + e.message);
      }
    }

    console.log(`\n${"=".repeat(60)}`);
    console.log(`covered API actions: ${covered.size} | cases: ${pass}/${activeCases.length} passed`);
    if (consoleErrors.length) console.log(`page console errors: ${consoleErrors.length}\n  ` + consoleErrors.slice(0, 5).join("\n  "));
    if (fails.length) {
      console.log(`\nFAILURES:`);
      fails.forEach((f) => console.log(`  ✗ ${f.action}: ${f.error}`));
      process.exitCode = 1;
      return;
    }
    if (consoleErrors.length) {
      process.exitCode = 1;
      return;
    }
    console.log("ALL E2E PASSED ✅");
  } finally {
    try {
      await browser?.close();
    } finally {
      await closeServices();
    }
  }
}

main().catch((e) => {
  console.error("e2e runner crashed:", e);
  process.exitCode = 1;
});
