// 完整浏览器测试用例：覆盖 @codejoo/storage 全部公开 API。
// 运行方式：项目根目录 `pnpm dev`，浏览器打开 dev 服务的 /test/ 路径。
// （通过 vite 即时转译源码，无需先 build；也可改为从 ../dist/esm/index.mjs 导入测试产物。）
import { factory, codec, codecAtob, codecBase64, crossTab, fast, batchFast, lazy, debug, Idb, JSONX } from "../src/index.ts";
import { supported } from "../src/helper.ts";
import { Memory } from "../src/memory.ts";
import { proxy } from "../src/proxy.ts";

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
  if (!eq(actual, expected)) throw new Error(`${msg ? msg + ": " : ""}expected ${fmt(expected)}, got ${fmt(actual)}`);
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
      r.group ? `<tr><td class="group" colspan="2">▸ ${r.group}</td></tr>` : `<tr><td class="name ${r.ok ? "pass" : "fail"}">${r.ok ? "✓" : "✗"} ${r.name}</td>` + `<td class="err">${r.ok ? "" : r.err}</td></tr>`,
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
  await test("续期有阈值：剩余寿命 >90% 时跳过回写（消除高频读写放大）", () => {
    const { ls: s } = factory({ sliding: true });
    s.set("sl2", "v", 10000);
    const before = localStorage.getItem("sl2");
    assertEq(s.get("sl2"), "v"); // 刚写入，剩余 ~100% → 不应回写
    assertEq(localStorage.getItem("sl2"), before, "底层串应未变（未触发续期回写）");
  });
  await test("剩余寿命 <90% 时正常续期回写", async () => {
    const { ls: s } = factory({ sliding: true });
    s.set("sl3", "v", 100);
    const before = JSON.parse(localStorage.getItem("sl3")).expireAt;
    await sleep(30); // 已消耗 ~30%
    assertEq(s.get("sl3"), "v");
    const after = JSON.parse(localStorage.getItem("sl3")).expireAt;
    assert(after > before, "expireAt 应已续期");
  });
  await test("sliding 但无 ttl 时，过去的 expireAt 拒绝写入（不落盘死条目）", () => {
    const { ls: s } = factory({ sliding: true });
    s.set("dead", "v", { expireAt: Date.now() - 1000 });
    assertEq(s.get("dead"), null);
    assertEq(localStorage.getItem("dead"), null, "不应落盘已过期条目");
  });
  await test("sliding + ttl 时，过去的 expireAt 改为从现在按 ttl 续期", () => {
    const { ls: s } = factory({ sliding: true });
    s.set("renew", "v", { expireAt: Date.now() - 1000, ttl: 500 });
    assertEq(s.get("renew"), "v");
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

  // ===== clear 作用域 =====
  group("clear — 命名空间/enckey 作用域");
  await test("namespace 实例 clear 只清自己的键，不波及他人", () => {
    localStorage.clear();
    localStorage.setItem("foreign", "keep"); // 模拟同源其他应用的数据
    const { ls: a } = factory({ namespace: "nsA" });
    const { ls: b } = factory({ namespace: "nsB" });
    a.set("k", 1);
    b.set("k", 2);
    a.clear();
    assertEq(a.get("k"), null, "本命名空间应被清空");
    assertEq(b.get("k"), 2, "其他命名空间不受影响");
    assertEq(localStorage.getItem("foreign"), "keep", "外部数据不受影响");
  });
  await test("enckey 实例 clear 只清能解开的键", () => {
    localStorage.clear();
    localStorage.setItem("foreign", "keep");
    const { ls: e } = factory({ codeable: true, codec: codec("pw"), enckey: true });
    e.set("k", 1);
    e.clear();
    assertEq(e.get("k"), null);
    assertEq(localStorage.getItem("foreign"), "keep", "解不开的外部键应保留");
  });
  await test("无命名空间且未加密键时 clear 整库清空（保持旧语义）", () => {
    localStorage.setItem("foreign", "x");
    ls.clear();
    assertEq(localStorage.length, 0);
  });
  await test("db 命名空间 clear 只清本命名空间（异步）", async () => {
    const shared = new Idb("codejoo-test-nsclear");
    const { db: p } = factory({ db: shared, namespace: "p" });
    const { db: q } = factory({ db: shared, namespace: "q" });
    await shared.clear();
    await p.set("k", 1);
    await q.set("k", 2);
    await p.clear();
    assertEq(await p.get("k"), null);
    assertEq(await q.get("k"), 2, "其他命名空间不受影响");
    await shared.clear();
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
  await test("codec 全 BMP 码元 + 增补平面字符往返，输出恒为合法 UTF-16", () => {
    const cdc = codec("k");
    let s = "🎉😀𝕏"; // 增补平面（合法代理对）
    for (let c = 0; c <= 0xffff; c++) if (c < 0xd800 || c > 0xdfff) s += String.fromCharCode(c);
    const enc = cdc.encode(s); // 全码元扫一遍必然覆盖代理区转义路径
    for (let i = 0; i < enc.length; i++) {
      const u = enc.charCodeAt(i);
      if (u >= 0xd800 && u <= 0xdbff) {
        const lo = enc.charCodeAt(++i);
        assert(lo >= 0xdc00 && lo <= 0xdfff, "高代理后必须跟低代理");
      } else {
        assert(u < 0xdc00 || u > 0xdfff, "不应出现孤立低代理");
      }
    }
    assert(cdc.decode(enc) === s, "应逐码元精确还原");
  });
  await test("codec 长字符串往返", () => {
    const cdc = codec("k");
    const s = JSON.stringify({ list: Array.from({ length: 3000 }, (_, i) => `项目-${i}-数据`) });
    assert(s.length > 8192 && cdc.decode(cdc.encode(s)) === s);
  });
  await test("codecBase64 输出无标准 base64 特征（无 + / = 字符）", () => {
    const cdc = codecBase64("k");
    const enc = cdc.encode(JSON.stringify({ a: "明文数据", b: [1, 2, 3] }));
    assert(!/[+/=]/.test(enc), "不应包含 + / = 等 base64 特征字符");
  });
  await test("codecBase64 无 toBase64 时回退 atob/btoa，格式与原生一致、可互解", () => {
    const plain = "兼容性数据 compat-😀";
    const native = codecBase64("k").encode(plain); // 原生路径产物
    const o1 = Uint8Array.prototype.toBase64;
    const o2 = Uint8Array.fromBase64;
    try {
      delete Uint8Array.prototype.toBase64; // 模拟旧运行时（检测发生在 codecBase64() 构造时）
      delete Uint8Array.fromBase64;
      const fb = codecBase64("k");
      assertEq(fb.encode(plain), native, "回退实现输出应与原生逐字符一致");
      assertEq(fb.decode(native), plain, "回退实现应能解原生写入的数据");
      assertEq(fb.decode(codecBase64("wrong").encode(plain)), null, "错口令仍应返回 null");
    } finally {
      Uint8Array.prototype.toBase64 = o1;
      Uint8Array.fromBase64 = o2;
    }
    assertEq(codecBase64("k").decode(native), plain, "恢复后原生路径不受影响");
  });
  await test("codecBase64 与 codecAtob 同格式互解；三变体错口令均为 null", () => {
    const s = "互解测试 interop-😀";
    const a = codecBase64("k").encode(s);
    const b = codecAtob("k").encode(s);
    assertEq(a, b, "两变体输出应逐字符一致");
    assertEq(codecAtob("k").decode(a), s);
    assertEq(codecBase64("k").decode(b), s);
    for (const make of [codec, codecBase64, codecAtob]) {
      const enc = make("pw").encode(s);
      assertEq(make("pw").decode(enc), s);
      assertEq(make("other").decode(enc), null);
      assert(!enc.includes("互解测试"), "不应包含明文");
    }
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
    localStorage.clear(); // enckey 的 clear 只清能解开的键，故此处直接整库清空保证计数断言
    const { ls: e } = factory({ codeable: true, codec: codec("k1"), enckey: true });
    e.set("secretKey", "v");
    assertEq(localStorage.getItem("secretKey"), null, "明文键不应存在");
    assertEq(e.get("secretKey"), "v", "通过加密键仍能读回");
    assertEq(localStorage.length, 1, "应只有一条（加密键）");
  });

  // ===== debug（解密快照，独立导入，保留命名空间） =====
  group("debug — 解密快照");
  await test("debug 返回保留命名空间的明文快照（加密场景）", () => {
    localStorage.clear(); // debug 枚举整个底层，先清掉之前用例的残留
    const { ls: e } = factory({ codeable: true, codec: codec("k2"), enckey: true, namespace: "ns" });
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

  // ===== 批量（数组 keys） =====
  group("批量 — 数组 keys");
  await test("ls 批量 set/get/remove，默认值逐位生效", () => {
    ls.clear();
    ls.set(["ba", "bb", "bc"], [1, "x", { z: 1 }]);
    assertEq(ls.get(["ba", "bb", "bc"]), [1, "x", { z: 1 }]);
    assertEq(ls.get(["ba", "missing"], [0, "dflt"]), [1, "dflt"]);
    ls.remove(["ba", "bb"]);
    assertEq(ls.get(["ba", "bb", "bc"]), [null, null, { z: 1 }]);
  });
  await test("批量 set：values 短于 keys 时缺位键跳过（不写入 undefined）", () => {
    ls.clear();
    ls.set(["k1", "k2", "k3"], [1, 2]);
    assertEq(ls.get(["k1", "k2", "k3"]), [1, 2, null]);
    assertEq(localStorage.getItem("k3"), null, "缺位键不应落盘");
  });
  await test("db 批量走单事务快路径（getMany/setMany/removeMany）", async () => {
    const { db: bdb } = factory({ db: new Idb("codejoo-test-batch"), namespace: "bt" });
    await bdb.clear();
    await bdb.set(["x", "y", "z"], [10, "s", { a: 1 }], 60000);
    assertEq(await bdb.get(["x", "y", "z", "none"], [0, "", {}, "d"]), [10, "s", { a: 1 }, "d"]);
    await bdb.remove(["x", "y"]);
    assertEq(await bdb.get(["x", "z"]), [null, { a: 1 }]);
    await bdb.clear();
    assertEq(await bdb.length, 0);
  });
  await test("db 批量 + memoized：缓存命中与事务未命中混合", async () => {
    const { db: mdb } = factory({ db: new Idb("codejoo-test-batch2"), namespace: "bm", memoized: true });
    await mdb.clear();
    await mdb.set("hit", "cached"); // memoized → 写入 memo
    await mdb.set("miss", "fromdb");
    assertEq(await mdb.get(["hit", "miss", "none"], [0, 0, "d"]), ["cached", "fromdb", "d"]);
    await mdb.clear();
  });

  // ===== keys / purge =====
  group("keys / purge — 枚举与主动清理");
  await test("keys() 仅返回本命名空间逻辑键，不混入外部数据", () => {
    localStorage.clear();
    localStorage.setItem("foreign", "1");
    const { ls: a } = factory({ namespace: "ka" });
    a.set(["k1", "k2"], [1, 2]);
    assertEq(a.keys().sort(), ["k1", "k2"]);
  });
  await test("keys() enckey 场景返回解密后的逻辑键", () => {
    localStorage.clear();
    const { ls: e } = factory({ codeable: true, codec: codec("pw"), enckey: true, namespace: "ke" });
    e.set("sec", 1);
    assertEq(e.keys(), ["sec"]);
  });
  await test("purge() 主动回收过期但从未被读取的条目", async () => {
    localStorage.clear();
    const { ls: p } = factory({ namespace: "pg" });
    p.set("dead", 1, 30);
    p.set("alive", 2, 60000);
    await sleep(50);
    p.purge();
    assert(localStorage.getItem("pg:dead") == null, "过期条目应被物理清除");
    assert(localStorage.getItem("pg:alive") != null, "未过期条目应保留");
  });
  await test("db purge()（getMany+removeMany 两事务快路径）", async () => {
    const { db: pdb } = factory({ db: new Idb("codejoo-test-purge"), namespace: "pp" });
    await pdb.clear();
    await pdb.set("dead", 1, 30);
    await pdb.set("alive", 2, 60000);
    await sleep(50);
    await pdb.purge();
    assertEq(await pdb.length, 1, "过期条目应已物理删除");
    assertEq(await pdb.get("alive"), 2);
    await pdb.clear();
  });

  // ===== cloned =====
  group("cloned — memo 副本隔离");
  await test("cloned: true 时修改返回值不污染缓存", () => {
    const { ls: c } = factory({ memoized: true, cloned: true, namespace: "cl" });
    c.set("o", { n: 1 });
    c.get("o").n = 999;
    assertEq(c.get("o").n, 1, "缓存不应被外部修改污染");
  });
  await test("默认共享引用（零开销路径行为不变）", () => {
    const { ls: c } = factory({ memoized: true, namespace: "cl2" });
    c.set("o", { n: 1 });
    c.get("o").n = 999;
    assertEq(c.get("o").n, 999);
  });

  // ===== raw 混用守卫 =====
  group("raw 混用 — 共享 memo 守卫");
  await test("非 raw 实例不把 raw 字符串误读为 entity（不再返回 undefined）", () => {
    localStorage.clear();
    const { ls: r } = factory({ raw: true });
    const { ls: s } = factory();
    r.set("mix", "rawstr", true); // memoized → 写入共享 memo
    assert(s.get("mix") !== undefined, "不应静默返回 undefined");
    assertEq(s.get("mix"), null, "应走后端并按损坏清除语义回退");
  });

  // ===== crossTab =====
  group("crossTab — 跨标签同步插件");
  await test("原生 storage 可用时为空操作", () => {
    const stop = crossTab(ls);
    assert(!ls.__crossTab, "不应挂载（无包装标记）");
    stop();
  });
  await test("纯内存模式下经 BroadcastChannel 同步（隔离双实例模拟双标签）", async () => {
    const orig = supported.storage;
    supported.storage = false; // 激活条件：纯内存模式
    const t1 = proxy(new Memory(), new Memory());
    const t2 = proxy(new Memory(), new Memory());
    const s1 = crossTab(t1, "test-ct");
    const s2 = crossTab(t2, "test-ct");
    supported.storage = orig;
    try {
      t1.set("k", { v: 1 }, 60000);
      await sleep(60); // BroadcastChannel 异步派发
      assertEq(t2.get("k"), { v: 1 }, "另一实例应收到 set 回放");
      t1.remove("k");
      await sleep(60);
      assertEq(t2.get("k"), null, "remove 也应同步");
    } finally {
      s1();
      s2();
    }
  });
  await test("重复挂载幂等；stop 后卸载", async () => {
    const orig = supported.storage;
    supported.storage = false;
    const t1 = proxy(new Memory(), new Memory());
    const stop1 = crossTab(t1, "test-ct2");
    const stop2 = crossTab(t1, "test-ct2"); // 第二次应为空操作
    supported.storage = orig;
    assert(t1.__crossTab === true, "首次挂载应生效");
    stop2(); // 空操作的 stop 不应影响首次挂载
    assert(t1.__crossTab === true, "幂等：第二次挂载的 stop 无副作用");
    stop1();
    assert(t1.__crossTab === false, "stop 后应卸载");
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
