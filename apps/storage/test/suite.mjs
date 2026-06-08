// 完整浏览器测试用例：覆盖 @codejoo/storage 全部公开 API。
// 运行方式：项目根目录 `pnpm dev`，浏览器打开 dev 服务的 /test/ 路径。
// （通过 vite 即时转译源码，无需先 build；也可改为从 ../dist/esm/index.mjs 导入测试产物。）
import {
  factory,
  codec,
  fast,
  batchFast,
  lazy,
  debug,
  Idb,
  JSONX,
} from "../src/index.ts";

// ───────────────────────── 迷你测试框架 ─────────────────────────
const rows = [];
let passed = 0;
let failed = 0;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fmt(v) {
  if (v instanceof Map) return `Map(${JSON.stringify([...v])})`;
  if (v instanceof Set) return `Set(${JSON.stringify([...v])})`;
  if (v instanceof Date) return `Date(${v.toISOString()})`;
  if (typeof v === "bigint") return `${v}n`;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function eq(a, b) {
  if (a === b) return true;
  if (typeof a === "bigint" || typeof b === "bigint") return a === b;
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (a instanceof Map && b instanceof Map) {
    if (a.size !== b.size) return false;
    for (const [k, v] of a) if (!b.has(k) || !eq(v, b.get(k))) return false;
    return true;
  }
  if (a instanceof Set && b instanceof Set) {
    if (a.size !== b.size) return false;
    for (const v of a) if (!b.has(v)) return false;
    return true;
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    return ka.every((k) => eq(a[k], b[k]));
  }
  return false;
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || "assertion failed");
}
function assertEq(actual, expected, msg) {
  if (!eq(actual, expected))
    throw new Error(`${msg ? msg + ": " : ""}expected ${fmt(expected)}, got ${fmt(actual)}`);
}

let currentGroup = "";
function group(name) {
  currentGroup = name;
  rows.push({ group: name });
}
async function test(name, fn) {
  try {
    await fn();
    passed++;
    rows.push({ name, ok: true });
  } catch (e) {
    failed++;
    rows.push({ name, ok: false, err: e?.message || String(e) });
  }
}

function render() {
  const tbl = document.getElementById("results");
  tbl.innerHTML = rows
    .map((r) =>
      r.group
        ? `<tr><td class="group" colspan="2">▸ ${r.group}</td></tr>`
        : `<tr><td class="name ${r.ok ? "pass" : "fail"}">${r.ok ? "✓" : "✗"} ${r.name}</td>` +
          `<td class="err">${r.ok ? "" : r.err}</td></tr>`,
    )
    .join("");
  const sum = document.getElementById("summary");
  sum.textContent = `${passed} passed, ${failed} failed (${passed + failed} total)`;
  sum.className = failed ? "fail" : "pass";
}

// ───────────────────────── 测试用例 ─────────────────────────
async function run() {
  // 全新环境，避免上次运行残留
  localStorage.clear();
  sessionStorage.clear();

  // ===== factory / ls (同步 localStorage) =====
  group("ls — 基础同步读写");
  const { ls, ss } = factory();

  await test("set + get 字符串", () => {
    ls.set("k", "hello");
    assertEq(ls.get("k"), "hello");
  });
  await test("set + get 对象（自动 JSON 序列化）", () => {
    ls.set("obj", { a: 1, b: [2, 3] });
    assertEq(ls.get("obj"), { a: 1, b: [2, 3] });
  });
  await test("get 缺失键 → null", () => assertEq(ls.get("nope"), null));
  await test("get 默认值（缺失时返回默认）", () => assertEq(ls.get("nope", 42), 42));
  await test("get 存在则忽略默认值", () => {
    ls.set("n", 7);
    assertEq(ls.get("n", 42), 7);
  });
  await test("remove", () => {
    ls.set("rm", 1);
    ls.remove("rm");
    assertEq(ls.get("rm"), null);
  });
  await test("length 反映条目数", () => {
    localStorage.clear();
    ls.set("a", 1);
    ls.set("b", 2);
    assertEq(ls.length, 2);
  });
  await test("clear 清空", () => {
    ls.set("x", 1);
    ls.clear();
    assertEq(ls.length, 0);
  });
  await test("存取假值（空串/0/false）不被吞成 null", () => {
    ls.set("empty", "");
    ls.set("zero", 0);
    ls.set("flag", false);
    assertEq(ls.get("empty"), "");
    assertEq(ls.get("zero"), 0);
    assertEq(ls.get("flag"), false);
  });

  // ===== ttl / expireAt =====
  group("过期 — ttl / expireAt");
  await test("ttl 未到期可读", () => {
    ls.set("t1", "v", 1000);
    assertEq(ls.get("t1"), "v");
  });
  await test("ttl 到期后返回 null 并被清除", async () => {
    ls.set("t2", "v", 30);
    await sleep(50);
    assertEq(ls.get("t2"), null);
    assertEq(localStorage.getItem("t2"), null, "底层应已删除");
  });
  await test("expireAt 未来时间（Date）可读", () => {
    ls.set("e1", "v", { expireAt: new Date(Date.now() + 1000) });
    assertEq(ls.get("e1"), "v");
  });
  await test("expireAt 过去时间 → 放弃写入（非滑动）", () => {
    ls.set("e2", "v", { expireAt: Date.now() - 1000 });
    assertEq(ls.get("e2"), null);
  });
  await test("expireAt 接受日期字符串", () => {
    ls.set("e3", "v", { expireAt: new Date(Date.now() + 1000).toISOString() });
    assertEq(ls.get("e3"), "v");
  });

  // ===== sliding 滑动过期 =====
  group("sliding — 滑动续期");
  await test("每次读命中按 ttl 续期", async () => {
    const { ls: s } = factory({ sliding: true });
    s.set("sl", "v", 80);
    await sleep(50);
    assertEq(s.get("sl"), "v"); // 命中续期
    await sleep(50); // 距上次访问 50ms < 80ms ttl，仍在
    assertEq(s.get("sl"), "v");
  });

  // ===== namespace =====
  group("namespace — 命名空间隔离");
  await test("不同命名空间同名 key 互不干扰", () => {
    const { ls: a } = factory({ namespace: "appA" });
    const { ls: b } = factory({ namespace: "appB" });
    a.set("token", "A");
    b.set("token", "B");
    assertEq(a.get("token"), "A");
    assertEq(b.get("token"), "B");
    assert(localStorage.getItem("appA:token") != null, "底层 key 应带前缀");
  });
  await test("setNamespace 原地切换前缀，已持有引用自动生效（切账号）", () => {
    const store = factory({ namespace: "userA" });
    store.ls.set("token", "TA");
    assert(localStorage.getItem("userA:token") != null);
    store.setNamespace("userB"); // 切到另一账号
    assertEq(store.ls.get("token"), null, "新命名空间下读不到旧账号数据");
    store.ls.set("token", "TB");
    assert(localStorage.getItem("userB:token") != null, "写入应带新前缀");
    assertEq(store.ls.get("token"), "TB");
    assert(localStorage.getItem("userA:token") != null, "旧账号落盘数据仍保留（仅隔离不清除）");
  });

  // ===== raw 裸存 =====
  group("raw — 裸存模式");
  await test("raw 直接存原始字符串（无 entity 信封）", () => {
    const { ls: r } = factory({ raw: true });
    r.set("raw", "plain");
    assertEq(localStorage.getItem("raw"), "plain", "底层应是原始值");
    assertEq(r.get("raw"), "plain");
  });

  // ===== memoized 缓存 =====
  group("memoized — 读缓存");
  await test("memoized 命中缓存（绕过底层变更）", () => {
    const { ls: m } = factory({ memoized: true });
    m.set("c", "cached");
    localStorage.setItem("c", JSON.stringify({ value: "changed" })); // 偷偷改底层
    assertEq(m.get("c"), "cached", "应返回内存缓存值，而非底层值");
  });

  // ===== codec 编解码 =====
  group("codec — 混淆/编解码");
  await test("codeable + codec：底层被混淆，读出仍是原值", () => {
    const { ls: c } = factory({ codeable: true, codec: codec("pw") });
    c.set("secret", "topsecret");
    const raw = localStorage.getItem("secret");
    assert(raw != null && !raw.includes("topsecret"), "底层不应包含明文");
    assertEq(c.get("secret"), "topsecret");
  });
  await test("codec encode/decode 往返", () => {
    const cdc = codec("k");
    assertEq(cdc.decode(cdc.encode("abc中文🎉")), "abc中文🎉");
  });
  await test("codec 错误口令解码 → null", () => {
    const enc = codec("right").encode("data");
    assertEq(codec("wrong").decode(enc), null);
  });
  await test("codec key 变更：旧数据解不开 → 回退默认值", () => {
    const { ls: c1 } = factory({ codeable: true, codec: codec("old") });
    c1.set("mig", "v");
    const { ls: c2 } = factory({ codeable: true, codec: codec("new") });
    assertEq(c2.get("mig", "fallback"), "fallback");
  });

  // ===== serialize/deserialize + JSONX =====
  group("serialize — JSONX 富类型");
  await test("JSONX.stringify/parse 往返 Date/Map/Set/bigint", () => {
    const data = {
      d: new Date("2026-06-06T00:00:00.000Z"),
      m: new Map([["x", 1n]]),
      s: new Set([1, 2, 3]),
      big: 9007199254740993n,
    };
    const back = JSONX.parse(JSONX.stringify(data));
    assertEq(back, data);
    assert(back.d instanceof Date && back.m instanceof Map && back.s instanceof Set, "类型应还原");
    assert(typeof back.big === "bigint");
  });
  await test("storage 配 JSONX 存取富类型", () => {
    const { ls: j } = factory({ serialize: JSONX.stringify, deserialize: JSONX.parse });
    const v = { when: new Date(0), tags: new Set(["a"]) };
    j.set("rich", v);
    assertEq(j.get("rich"), v);
    assert(j.get("rich").when instanceof Date);
  });

  // ===== fast / lazy =====
  group("fast / lazy — 绑定 key 快捷器");
  await test("fast(ls,key) get/set/remove", () => {
    const token = fast(ls, "fast_token");
    token.set("abc");
    assertEq(token.get(), "abc");
    token.remove();
    assertEq(token.get(), null);
    assertEq(token.get("def"), "def");
  });
  await test("lazy 首次调用才建、之后复用同一实例", () => {
    const acc = lazy(ls, "lazy_k");
    const a1 = acc();
    const a2 = acc();
    assert(a1 === a2, "应复用同一访问器实例");
    a1.set("z");
    assertEq(a2.get(), "z");
  });

  // ===== readonly（只写一次） =====
  group("readonly — 只写一次");
  await test("非空时丢弃写入，空时才写", () => {
    const { ls: r } = factory({ readonly: true });
    r.set("ro", "first");
    assertEq(r.get("ro"), "first");
    r.set("ro", "second"); // 已有值 → 丢弃
    assertEq(r.get("ro"), "first", "已存在则不应被覆盖");
    r.remove("ro");
    r.set("ro", "third"); // 已空 → 可写
    assertEq(r.get("ro"), "third");
  });
  await test("已过期视为空，允许写入", async () => {
    const { ls: r } = factory({ readonly: true });
    r.set("roe", "x", 30);
    await sleep(50); // 过期
    r.set("roe", "y");
    assertEq(r.get("roe"), "y");
  });

  // ===== batchFast（批量绑定） =====
  group("batchFast — 批量绑定");
  await test("返回按 key 命名的访问器对象", () => {
    ls.clear();
    const { token, user } = batchFast(ls, ["token", "user"]);
    token.set("abc");
    user.set({ id: 1 });
    assertEq(token.get(), "abc");
    assertEq(user.get(), { id: 1 });
    user.remove();
    assertEq(user.get(), null);
  });

  // ===== enckey（键加密） =====
  group("enckey — 键加密");
  await test("enckey 加密存储键，get 仍可读", () => {
    const { ls: e } = factory({ codeable: true, codec: codec("k1"), enckey: true });
    e.clear();
    e.set("secretKey", "v");
    assertEq(localStorage.getItem("secretKey"), null, "明文键不应存在");
    assertEq(e.get("secretKey"), "v", "通过加密键仍能读回");
    assertEq(localStorage.length, 1, "应只有一条（加密键）");
  });

  // ===== debug（解密快照，独立导入，保留命名空间） =====
  group("debug — 解密快照");
  await test("debug 返回保留命名空间的明文快照（加密场景）", () => {
    const { ls: e } = factory({ codeable: true, codec: codec("k2"), enckey: true, namespace: "ns" });
    e.clear();
    e.set("a", 1);
    e.set("b", { x: 2 });
    assertEq(debug(e), { "ns:a": 1, "ns:b": { x: 2 } }); // 键保留 ns 前缀
  });
  await test("debug 分别作用于 ls / ss / db", async () => {
    const store = factory({ db: new Idb("codejoo-test-debug") });
    store.ls.clear();
    store.ss.clear();
    await store.db.clear();
    store.ls.set("k", "lv");
    store.ss.set("k", "sv");
    await store.db.set("k", "dv");
    assertEq(debug(store.ls), { k: "lv" });
    assertEq(debug(store.ss), { k: "sv" });
    assertEq(await debug(store.db), { k: "dv" });
  });

  // ===== ss (sessionStorage) =====
  group("ss — sessionStorage");
  await test("ss 基础读写", () => {
    ss.set("sk", "sv");
    assertEq(ss.get("sk"), "sv");
    assert(sessionStorage.getItem("sk") != null);
  });

  // ===== Idb（异步）直接用 =====
  group("Idb — 异步底层");
  const idb = new Idb("codejoo-test-db");
  await test("Idb set/get/remove/length/key", async () => {
    await idb.clear();
    await idb.set("a", "1");
    await idb.set("b", "2");
    assertEq(await idb.get("a"), "1");
    assertEq(await idb.length(), 2);
    const k0 = await idb.key(0);
    assert(k0 === "a" || k0 === "b", "key(0) 应是已存键之一");
    await idb.remove("a");
    assertEq(await idb.get("a"), null);
    assertEq(await idb.length(), 1);
    await idb.clear();
    assertEq(await idb.length(), 0);
  });

  // ===== db（异步 proxy，全特性） =====
  group("db — 异步 proxy");
  const { db } = factory({ db: new Idb("codejoo-test-db2"), namespace: "x" });
  await test("db set/get（返回 Promise）", async () => {
    await db.clear();
    const p = db.set("k", { v: 1 });
    assert(p instanceof Promise, "异步后端应返回 Promise");
    await p;
    assertEq(await db.get("k"), { v: 1 });
  });
  await test("db 默认值", async () => {
    assertEq(await db.get("missing", "d"), "d");
  });
  await test("db ttl 过期", async () => {
    await db.set("t", "v", 30);
    assertEq(await db.get("t"), "v");
    await sleep(50);
    assertEq(await db.get("t"), null);
  });
  await test("db remove / length", async () => {
    await db.clear();
    await db.set("a", 1);
    await db.set("b", 2);
    assertEq(await db.length, 2); // proxy 的 length 是 getter（返回 Promise），非方法
    await db.remove("a");
    assertEq(await db.length, 1);
  });
  await test("未传 db 实例时使用 db 抛错提示", async () => {
    const { db: missing } = factory();
    let threw = false;
    try {
      await missing.get("x");
    } catch {
      threw = true;
    }
    assert(threw, "应抛出『先传入 Idb』错误");
  });

  // ===== destroy（资源回收） =====
  group("destroy — 资源回收");
  await test("proxy.destroy 清空 memo 缓存但保留落盘数据", () => {
    const { ls: m } = factory({ memoized: true });
    m.set("d", "v");
    localStorage.setItem("d", JSON.stringify({ value: "changed" })); // 偷偷改底层
    assertEq(m.get("d"), "v", "destroy 前命中缓存");
    m.destroy();
    assertEq(m.get("d"), "changed", "destroy 后缓存已清，读到底层值");
  });
  await test("factory.destroy 统一释放 ls/ss/db（返回 Promise）", async () => {
    const store = factory({ db: new Idb("codejoo-test-destroy") });
    store.ls.set("k", "v");
    await store.db.set("k", "dv");
    const p = store.destroy();
    assert(p instanceof Promise, "factory.destroy 返回 Promise");
    await p;
    // 落盘数据保留：localStorage 仍可读到，db 重新打开连接后仍可读
    assertEq(store.ls.get("k"), "v");
    assertEq(await store.db.get("k"), "dv");
    await store.db.clear();
  });

  // 收尾
  localStorage.clear();
  sessionStorage.clear();
  render();
  console.log(`[storage tests] ${passed} passed, ${failed} failed`);
}

run().catch((e) => {
  failed++;
  rows.push({ name: "运行器异常", ok: false, err: e?.message || String(e) });
  render();
});
