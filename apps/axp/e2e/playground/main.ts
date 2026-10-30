/**
 * e2e 演练场驱动 —— 覆盖 `src/index.ts` 的运行时公开 API。
 * 每个动作自带新客户端（顺序无关，便于 Playwright 逐项断言）。
 *
 * 覆盖清单：
 *   createAxp（七个动词、默认解包 / wrap / throws:false、use / eject / inspect / extend / plugin / cancelAll / pending / isResponse）
 *   key 内核服务（自动 key、显式字符串 key、scope）· axpCache / removeCache / clearCache · axpShare · axpRetry
 *   axpLoading · axpNotify · axpMock · axpEnvs · axpFilter · axpRepath · axpAuth
 *   axpResponse / AxpResponse / isAxpResponse / failureOf / AXP_FAILURES · stateKey · TokenManager
 */
import { create as createAxios } from "axios";
import {
  AXP_FAILURES,
  failureOf,
  AxpResponse,
  TokenManager,
  axpAuth,
  axpCache,
  axpEnvs,
  axpFilter,
  axpLoading,
  axpMock,
  axpNotify,
  axpRepath,
  axpResponse,
  axpRetry,
  axpShare,
  clearCache,
  createAxp,
  isAxpResponse,
  removeCache,
  stateKey,
  type AxpClient,
  type AxpOptions,
  type AxpPlugin,
  type ITokenManager,
} from "../../src/index.ts";

/** 本地可控后端，所有计数、失败与延迟均由仓库服务产生。 */
const BASE = "http://localhost:4570";
/** 回显请求端点。 */
const ECHO = "/api/echo";
/** 可计数、可按次数失败的请求端点。 */
const HIT = "/api/hit";
/** 受保护资源端点。 */
const SECURE = "/api/secure";
/** 本地刷新令牌端点。 */
const REFRESH = "/api/refresh";
/** 触发真实 401 的过期令牌。 */
const EXPIRED_TOKEN = "expired-token";
/** 刷新时间线的开始标记。 */
const REFRESH_STARTED = "refresh-called";
/** 显式缓存键，供 removeCache 定位。 */
const CACHE_KEY = "ck";
/** 缓存与共享的有效期（毫秒）。 */
const CACHE_TTL = 60000;
/** 并发演示里的服务端响应延迟（毫秒）。 */
const SLOW = 80;
/** race 只等最先成功者，其余在途请求稍后才落地；读服务端命中数前先等它们到齐（毫秒）。 */
const LOSERS_LAND = SLOW * 2;
/** 强制 HTTP 400 的状态码。 */
const BAD_REQUEST = 400;
/** 强制服务端持续失败的次数。 */
const ALWAYS_FAIL = 9;
/** 重试次数的上限，等于"前两次失败，第三次成功"所需预算。 */
const RETRY_MAX = 3;
/** 自定义响应认定为成功的业务码。 */
const CUSTOM_OK_CODE = "7777";
/** 没有失败标记时展示的成功类别。 */
const RESULT_OK = "ok";

/** 解析后的动作结果，字段由各动作自行约定。 */
type Row = Record<string, any>;

/** 为每个动作创建独立客户端。
 * @param options createAxp 选项；axios 实例固定指向本地后端。
 * @returns 默认响应类型的客户端。
 */
function mkApi(options: AxpOptions = {}): AxpClient {
  return createAxp({ axios: createAxios({ baseURL: BASE }), ...options });
}
/** 等待指定毫秒以制造可控时序。 */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// 无插件的裸 axios，用于获取简单数据（断言用）
const raw = createAxios({ baseURL: BASE });
/** 重置服务端命中数与失败次数。 */
const resetHits = () => raw.post("/api/hits/reset");
/** 读取真实网络命中数，读取操作自身不计数。 */
const readHits = async (id: string): Promise<number> => (await raw.get("/api/hits", { params: { id } })).data.data.hits;
/** 取客户端当前挂载链的名字，顺序即执行顺序（外 → 内）。 */
const chainNames = (api: AxpClient): string[] => api.inspect().map((item) => item.name);
/** 捕获一次可预期失败：不抛出则返回 undefined，抛出非响应的程序异常则原样再抛。 */
async function captureFailure(api: AxpClient, call: () => Promise<unknown>): Promise<AxpResponse | undefined> {
  try {
    await call();
    return undefined;
  } catch (e) {
    if (api.isResponse(e)) return e;
    throw e;
  }
}

/** 内存 TokenManager（不落 localStorage，便于反复点测；accessToken getter 加 Bearer） */
function makeMemTM(token?: string): ITokenManager {
  let access = token,
    refresh: string | undefined;
  return {
    get accessToken() {
      return access ? `Bearer ${access}` : undefined;
    },
    get refreshToken() {
      return refresh;
    },
    set(a?: string, r?: string) {
      access = a;
      refresh = r;
    },
    clear() {
      access = undefined;
      refresh = undefined;
    },
  };
}

/** 更新顶部 loading 指示器。 */
function setIndicator(v: boolean) {
  if (typeof document === "undefined") return;
  const el = document.querySelector('[data-testid="loading-indicator"]')!;
  el.textContent = v ? "on" : "off";
  el.className = "pill " + (v ? "on" : "off");
}

/** 自定义插件之一：只放行请求，演示任何对象都能 `api.use`。 */
const logging: AxpPlugin<AxpResponse> = {
  name: "logging",
  /** 直接进入内层。 */
  handle: (_ctx, next) => next(),
};
/** 逻辑请求级状态键：每次请求写一次，演示 `stateKey` 的类型化状态。 */
const TRACE_SEQ = stateKey<number>("tracer:seq");
/** 自定义插件之二：有状态（setup 里建状态）并通过 `api` 暴露管理能力。 */
const tracer: AxpPlugin<AxpResponse, { /** 已经过本插件的请求序列。 */ seen: string[] }> = {
  name: "tracer",
  /** 每个客户端独立的状态，extend 出的子客户端不会共享。 */
  setup() {
    const seen: string[] = [];
    return {
      /** 记录请求路径并把序号放进逻辑请求状态。 */
      async handle(ctx, next) {
        ctx.set(TRACE_SEQ, seen.length);
        seen.push(ctx.request.url ?? "");
        return next();
      },
      api: { seen },
    };
  },
};

// ─── 渲染框架 ────────────────────────────────────────────────────────────────
type Action = { id: string; label: string; /** 执行本动作并返回可断言结果。 */ run: () => unknown };
type Feature = { id: string; title: string; desc: string; actions: Action[] };

/** 声明一个动作；`run` 是动作本体，返回值序列化到结果面板，抛出则面板标红。
 * @param id 按钮 data-testid。
 * @param label 按钮文字。
 * @param run 动作本体。
 * @returns 动作描述。
 */
const act = (id: string, label: string, run: () => unknown): Action => ({ id, label, run });

/** 通知文案：失败类别或状态码；成功、取消、silent 由内核先过滤。 */
const notifyText = (r: AxpResponse): string => failureOf(r)?.type ?? `status ${r.status}`;

/** 将动作结果序列化到结果面板；AxpResponse 自带 toJSON（不含 raw / error）。 */
function stringify(v: unknown): string {
  return JSON.stringify(
    v,
    (_k, val) => {
      if (val instanceof Error) return { __type: val.name, message: val.message, response: Reflect.get(val, "response"), code: Reflect.get(val, "code") };
      return val;
    },
    2,
  );
}

/** 为动作创建按钮及对应结果面板。 */
function render(features: Feature[]) {
  const app = document.getElementById("app")!;
  for (const f of features) {
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `<h2>${f.title}</h2><div class="desc">${f.desc}</div>`;
    for (const a of f.actions) {
      const btn = document.createElement("button");
      btn.textContent = a.label;
      btn.dataset.testid = a.id;
      btn.addEventListener("click", async () => {
        const pre = card.querySelector<HTMLElement>(`[data-testid="${f.id}-result"]`)!;
        pre.textContent = "running…";
        pre.className = "";
        try {
          const out = await a.run();
          pre.textContent = stringify(out);
          pre.className = "ok";
        } catch (e) {
          pre.textContent = stringify(e);
          pre.className = "err";
        }
      });
      card.appendChild(btn);
    }
    const pre = document.createElement("pre");
    pre.dataset.testid = `${f.id}-result`;
    pre.textContent = "(尚未运行)";
    card.appendChild(pre);
    app.appendChild(card);
  }
}

// ─── 功能清单 ────────────────────────────────────────────────────────────────
/** 演练场基础动作，同时供真实 HTTP 回归验证使用。 */
export const features: Feature[] = [
  {
    id: "core",
    title: "createAxp · 七个动词 + 三种返回形态",
    desc: "createAxp() 包装 axios；get/post/put/delete/patch/head/options；默认解包 / raw:true（r.raw 逃生口）/ throws:false",
    actions: [
      act("core-get", "get", () => mkApi().get(ECHO)({ q: 1 })),
      act("core-post", "post", () => mkApi().post(ECHO)({ name: "x" })),
      act("core-put", "put", () => mkApi().put(ECHO)({ v: 1 })),
      act("core-patch", "patch", () => mkApi().patch(ECHO)({ v: 2 })),
      act("core-delete", "delete", () => mkApi().delete(ECHO)({ del: 1 })),
      act("core-head", "head", async () => {
        await mkApi().head(ECHO)();
        return { head: "resolved" };
      }),
      act("core-options", "options", async () => {
        await mkApi().options(ECHO)();
        return { options: "resolved" };
      }),
      act("core-plain", "默认 → 解包 data", () => mkApi().get(ECHO)({ shape: "plain" })),
      act("core-raw", "raw:true → r.raw 原始响应", async () => {
        const r = await mkApi().get(ECHO)(undefined, { raw: true });
        return { code: r.code, message: r.message, data: r.data, rawStatus: r.raw?.status, rawEnvelope: r.raw?.data };
      }),
      act("core-wrap", "wrap → IAxpResponse", async () => {
        const api = mkApi();
        const r = await api.get(ECHO)(undefined, { wrap: true });
        return { ok: r.ok, failure: failureOf(r)?.type ?? (r.ok ? RESULT_OK : r.status), status: r.status, isResponse: api.isResponse(r), isBrand: isAxpResponse(r), data: r.data };
      }),
      act("core-throws-false", "throws:false → 失败也 resolve", async () => {
        const r = await mkApi().get(ECHO)({ status: BAD_REQUEST }, { throws: false });
        return { resolved: true, ok: r.ok, failure: failureOf(r)?.type ?? (r.ok ? RESULT_OK : r.status), status: r.status };
      }),
      act("core-throw", "默认 → 抛出 IAxpResponse", async () => {
        const api = mkApi();
        const e = await captureFailure(api, () => api.get(ECHO)({ status: BAD_REQUEST }));
        return {
          thrown: e !== undefined,
          isResponse: e !== undefined,
          isError: (e as unknown) instanceof Error,
          failure: e ? (failureOf(e)?.type ?? (e.ok ? RESULT_OK : e.status)) : undefined,
          status: e?.status,
          hasStack: e?.stack !== undefined,
        };
      }),
    ],
  },
  {
    id: "lifecycle",
    title: "use / eject / inspect / plugin / extend",
    desc: "插件运行时装卸、挂载链顺序（内置插件固定、自定义插件按 stage）、extend 默认继承插件且状态独立",
    actions: [
      act("lifecycle-use", "use 装两个自定义插件", () => {
        const api = mkApi();
        api.use(logging);
        api.use(tracer);
        return { names: chainNames(api), stages: api.inspect().map((item) => item.stage) };
      }),
      act("lifecycle-eject", "eject 只卸一个", () => {
        const api = mkApi();
        api.use(logging);
        api.use(tracer);
        const ejected = api.eject("logging");
        return { ejected, again: api.eject("logging"), names: chainNames(api) };
      }),
      act("lifecycle-inspect", "inspect 顺序与快照", () => {
        const api = mkApi({
          // 故意打乱：内置插件的次序由 stage 决定，与数组顺序无关
          plugins: [
            axpCache(),
            axpShare(),
            axpMock({ enable: true }),
            axpAuth({ tokenManager: makeMemTM(), onRefresh: () => false, onAccessExpired: () => {} }),
            axpRetry(),
            axpFilter(),
            axpRepath(),
            axpNotify({ stringify: notifyText, notify: () => {} }),
            axpLoading(),
          ],
        });
        return { names: chainNames(api), snapshotIsCopy: api.inspect() !== api.inspect() };
      }),
      act("lifecycle-extend", "extend 默认继承插件", () => {
        const parent = mkApi();
        parent.use(logging);
        const child = parent.extend({ baseURL: BASE });
        child.use(tracer);
        return { parent: chainNames(parent), child: chainNames(child) };
      }),
      act("lifecycle-extend-state", "extend 状态各自独立", async () => {
        await resetHits();
        const id = "extendState";
        const parent = mkApi({ plugins: [axpCache({ expires: CACHE_TTL })] });
        await parent.get(HIT)({ id }, { cache: true });
        await parent.get(HIT)({ id }, { cache: true });
        const parentHits = await readHits(id);
        const child = parent.extend({ baseURL: BASE });
        await child.get(HIT)({ id }, { cache: true });
        return { parentHits, childHits: await readHits(id) };
      }),
      act("lifecycle-plugin", "plugin 取本客户端的管理 API", async () => {
        const api = mkApi();
        api.use(tracer);
        const before = api.plugin(tracer)?.seen.length;
        await api.get(ECHO)({ via: "plugin" });
        return { before, after: api.plugin(tracer)?.seen.length, seen: api.plugin(tracer)?.seen, missing: api.plugin(logging) === undefined };
      }),
      act("lifecycle-dispose", "dispose 中止在途并拒绝新请求", async () => {
        const api = mkApi();
        const slow = captureFailure(api, () => api.get(HIT)({ id: "disposeDemo", delay: 1500 }));
        await sleep(50);
        const pendingBefore = api.pending();
        api.dispose();
        const e = await slow;
        let afterDispose: string;
        try {
          await api.get(ECHO)();
          afterDispose = "resolved";
        } catch {
          afterDispose = "rejected";
        }
        return { pendingBefore, failure: e ? (failureOf(e)?.type ?? (e.ok ? RESULT_OK : e.status)) : undefined, pendingAfter: api.pending(), afterDispose };
      }),
    ],
  },
  {
    id: "key",
    title: "key · 内核服务（不再是插件）",
    desc: "key 默认自动计算（含 params）、请求级显式字符串 key、createAxp({ key: { scope } }) 分区；用 cache + 服务端命中数证明",
    actions: [
      act("key-same", "相同 params → 同一 key", async () => {
        await resetHits();
        const id = "keySame";
        const api = mkApi({ plugins: [axpCache({ expires: CACHE_TTL })] });
        await api.get(HIT)({ id, v: 1 }, { cache: true });
        await api.get(HIT)({ id, v: 1 }, { cache: true });
        return { serverHits: await readHits(id) };
      }),
      act("key-params", "不同 params → 不同 key", async () => {
        await resetHits();
        const id = "keyParams";
        const api = mkApi({ plugins: [axpCache({ expires: CACHE_TTL })] });
        await api.get(HIT)({ id, v: 1 }, { cache: true });
        await api.get(HIT)({ id, v: 2 }, { cache: true });
        return { serverHits: await readHits(id) };
      }),
      act("key-explicit", "显式字符串 key 覆盖自动计算", async () => {
        await resetHits();
        const id = "keyExplicit";
        const api = mkApi({ plugins: [axpCache({ expires: CACHE_TTL })] });
        await api.get(HIT)({ id, v: 1 }, { key: CACHE_KEY, cache: true });
        await api.get(HIT)({ id, v: 2 }, { key: CACHE_KEY, cache: true });
        return { serverHits: await readHits(id) };
      }),
      act("key-scope", "scope 函数切换账号不重建客户端", async () => {
        await resetHits();
        const id = "keyScope";
        let account = "alice";
        const api = mkApi({ key: { scope: () => account }, plugins: [axpCache({ expires: CACHE_TTL })] });
        await api.get(HIT)({ id }, { cache: true });
        await api.get(HIT)({ id }, { cache: true });
        const sameAccount = await readHits(id);
        account = "bob";
        await api.get(HIT)({ id }, { cache: true });
        return { sameAccount, afterSwitch: await readHits(id) };
      }),
    ],
  },
  {
    id: "cache",
    title: "axpCache · removeCache / clearCache",
    desc: "请求级 cache 开启，TTL 内复用响应；用服务端命中数证明只发一次网络；POST 默认不缓存",
    actions: [
      act("cache-hit-twice", "连发两次→1次网络", async () => {
        await resetHits();
        const id = "cacheDemo";
        const api = mkApi({ plugins: [axpCache({ expires: CACHE_TTL })] });
        const r1 = await api.get(HIT)({ id }, { cache: true });
        const r2 = await api.get(HIT)({ id }, { cache: true });
        return { r1, r2, serverHits: await readHits(id) };
      }),
      act("cache-remove", "removeCache 后重发", async () => {
        await resetHits();
        const id = "cacheRm";
        const api = mkApi({ plugins: [axpCache({ expires: CACHE_TTL })] });
        await api.get(HIT)({ id }, { key: CACHE_KEY, cache: true });
        const removed = removeCache(api, CACHE_KEY);
        await api.get(HIT)({ id }, { key: CACHE_KEY, cache: true });
        return { removed, serverHits: await readHits(id) };
      }),
      act("cache-clear", "clearCache", async () => {
        const api = mkApi({ plugins: [axpCache({ expires: CACHE_TTL })] });
        await api.get(HIT)({ id: "cacheClr" }, { cache: true });
        return { cleared: clearCache(api), withoutPlugin: removeCache(mkApi(), CACHE_KEY) };
      }),
      act("cache-post", "POST 默认不缓存", async () => {
        await resetHits();
        const id = "cachePost";
        const api = mkApi({ plugins: [axpCache({ expires: CACHE_TTL })] });
        await api.post(HIT)({ v: 1 }, { params: { id }, cache: true });
        await api.post(HIT)({ v: 1 }, { params: { id }, cache: true });
        return { serverHits: await readHits(id) };
      }),
    ],
  },
  {
    id: "share",
    title: "axpShare · start/race/end",
    desc: "同 key 并发请求的合并/竞速/顶替策略（请求级 share 开启）",
    actions: [
      act("share-start", "start 合并并发", async () => {
        await resetHits();
        const id = "shareStart";
        const api = mkApi({ plugins: [axpShare({ policy: "start" })] });
        const results = await Promise.all(Array.from({ length: 5 }, () => api.get(HIT)<Row>({ id, delay: SLOW }, { share: true })));
        return { hitsSeen: results.map((r) => r.hits), serverHits: await readHits(id) };
      }),
      act("share-race", "race 各发竞速", async () => {
        await resetHits();
        const id = "shareRace";
        const api = mkApi({ plugins: [axpShare({ policy: "race" })] });
        const results = await Promise.all(Array.from({ length: 3 }, () => api.get(HIT)({ id, delay: SLOW }, { share: true })));
        await sleep(LOSERS_LAND);
        return { results, serverHits: await readHits(id) };
      }),
      act("share-end", "end 末位生效", async () => {
        await resetHits();
        const id = "shareEnd";
        const api = mkApi({ plugins: [axpShare({ policy: "end" })] });
        const results = await Promise.all(Array.from({ length: 3 }, () => api.get(HIT)<Row>({ id, delay: SLOW }, { share: true })));
        return { sameResult: new Set(results.map((r) => JSON.stringify(r))).size, serverHits: await readHits(id) };
      }),
      act("share-off", "share:false 退出共享", async () => {
        await resetHits();
        const id = "shareOff";
        const api = mkApi({ plugins: [axpShare({ policy: "start" })] });
        await Promise.all(Array.from({ length: 3 }, () => api.get(HIT)({ id, delay: SLOW }, { share: false })));
        return { serverHits: await readHits(id) };
      }),
    ],
  },
  {
    id: "retry",
    title: "axpRetry",
    desc: "失败自动重试；请求级数字是重试预算，retry:0 禁用",
    actions: [
      act("retry-run", "前两次 500 → 重试成功", async () => {
        await resetHits();
        const id = "retryDemo";
        const api = mkApi({ plugins: [axpRetry({ max: RETRY_MAX, delay: 0 })] });
        const result = await api.get(HIT)({ id, fail: 2 }, { retry: RETRY_MAX });
        return { result, serverHits: await readHits(id) };
      }),
      act("retry-disabled", "retry:0 + 失败状态 → 直接失败", async () => {
        await resetHits();
        const id = "retryOff";
        const api = mkApi({ plugins: [axpRetry({ max: 5, delay: 0 })] });
        const e = await captureFailure(api, () => api.get(HIT)({ id, fail: ALWAYS_FAIL }, { retry: 0 }));
        return { rejected: e !== undefined, failure: e ? (failureOf(e)?.type ?? (e.ok ? RESULT_OK : e.status)) : undefined, status: e?.status, serverHits: await readHits(id) };
      }),
    ],
  },
  {
    id: "cancel",
    title: "cancelAll · signal",
    desc: "取消是内核能力：api.cancelAll 一次性中止在飞请求，用户 signal 同样联动；取消落定为带 cancel 失败标记的响应，不是异常",
    actions: [
      act("cancel-run", "慢请求 + cancelAll", async () => {
        const api = mkApi();
        const p = captureFailure(api, () => api.get(HIT)({ id: "cancelDemo", delay: 1500 }));
        await sleep(100);
        const pendingBefore = api.pending();
        const cancelled = api.cancelAll("user navigated away");
        const e = await p;
        return { canceled: api.isCancel(e), failure: e ? (failureOf(e)?.type ?? (e.ok ? RESULT_OK : e.status)) : undefined, pendingBefore, cancelled, again: api.cancelAll(), pendingAfter: api.pending() };
      }),
      act("cancel-signal", "用户 signal 取消", async () => {
        const api = mkApi();
        const controller = new AbortController();
        const p = captureFailure(api, () => api.get(HIT)({ id: "cancelSignal", delay: 1500 }, { signal: controller.signal }));
        await sleep(100);
        controller.abort();
        const e = await p;
        return { canceled: api.isCancel(e), pendingAfter: api.pending() };
      }),
    ],
  },
  {
    id: "loading",
    title: "axpLoading",
    desc: "全局请求计数：0→1 触发 true，1→0 触发 false（看顶部指示器）",
    actions: [
      act("loading-run", "2 个并发慢请求", async () => {
        const toggles: boolean[] = [];
        const api = mkApi({
          plugins: [
            axpLoading({
              loading: (v) => {
                toggles.push(v);
                setIndicator(v);
              },
            }),
          ],
        });
        await Promise.all([api.get(HIT)({ id: "loadingA", delay: 400 }), api.get(HIT)({ id: "loadingB", delay: 600 })]);
        return { toggles };
      }),
    ],
  },
  {
    id: "notify",
    title: "axpNotify",
    desc: "每个逻辑请求最多通知一次；成功、silent、notify:false 都不通知",
    actions: [
      act("notify-run", "失败通知一次", async () => {
        const messages: string[] = [];
        const api = mkApi({ plugins: [axpNotify({ stringify: notifyText, notify: (message) => messages.push(message) })] });
        const count = () => messages.length;
        await api.get(ECHO)({ status: BAD_REQUEST }, { throws: false });
        const failed = count();
        await api.get(ECHO)({ status: BAD_REQUEST }, { throws: false, notify: false });
        await api.get(ECHO)({ status: BAD_REQUEST }, { throws: false, silent: true });
        await api.get(ECHO)({ ok: 1 });
        return { failed, afterSuppressed: count() };
      }),
    ],
  },
  {
    id: "mock",
    title: "axpMock",
    desc: "本地 mock 改写与 404 回落真实接口",
    actions: [
      act("mock-run", "请求 mock", () => mkApi({ plugins: [axpMock({ enable: true, mock: true, mockUrl: BASE + "/mock" })] }).get(ECHO)({ msg: "mock request" })),
      act("mock-fallback", "mock 404 → 真实接口", () => mkApi({ plugins: [axpMock({ enable: true, mock: true, mockUrl: BASE + "/mock-404" })] }).get(ECHO)({ via: "fallback" })),
      act("mock-request", "请求级 mock:true / false", async () => {
        const api = mkApi({ plugins: [axpMock({ enable: true, mockUrl: BASE + "/mock" })] });
        const off = await api.get(ECHO)<Row>({ via: "default" });
        const on = await api.get(ECHO)<Row>({ via: "request" }, { mock: true });
        return { offMocked: off.mocked === true, offPath: off.path, onMocked: on.mocked === true };
      }),
    ],
  },
  {
    id: "envs",
    title: "axpEnvs",
    desc: "安装期按规则合并环境默认（运行时零开销）",
    actions: [
      act("envs-run", "匹配第二条规则", () => {
        const api = mkApi({
          plugins: [
            axpEnvs([
              { rule: () => false, config: { baseURL: "http://never" } },
              { rule: () => true, config: { headers: { "X-Env": "prod" } } },
            ]),
          ],
        });
        return { baseURL: api.axios.defaults.baseURL, xEnv: Reflect.get(api.axios.defaults.headers, "X-Env"), chain: chainNames(api) };
      }),
    ],
  },
  {
    id: "filter",
    title: "axpFilter",
    desc: "剥离 params/data 中的空字段（装上即生效，filter:false 退出）",
    actions: [
      act("filter-run", "过滤空字段", async () => {
        const r = await mkApi({ plugins: [axpFilter()] }).get(ECHO)<Row>({ a: 1, b: "", c: null, d: "  ", e: 0 });
        return { query: r.query };
      }),
      act("filter-off", "filter:false 保留空字段", async () => {
        const r = await mkApi({ plugins: [axpFilter()] }).get(ECHO)<Row>({ a: 1, b: "", e: 0 }, { filter: false });
        return { query: r.query };
      }),
    ],
  },
  {
    id: "pathvars",
    title: "axpRepath",
    desc: "{id} / :pid / [x] 路径变量替换",
    actions: [act("pathvars-run", "替换 {id}/:pid", () => mkApi({ plugins: [axpRepath()] }).get("/users/{id}/posts/:pid")({ id: 7, pid: 9 }))],
  },
  {
    id: "response",
    title: "归一化响应 · axpResponse",
    desc: "业务码失败保留 HTTP status 与业务 code，是 IAxpResponse（不是 Error）；reject 可适配成 Error；响应类可自定义成功判定",
    actions: [
      act("response-ok", "code=0000 → 成功", () => mkApi().get(ECHO)({ ok: 1 })),
      act("response-biz", "code=5001 → 抛出 IAxpResponse", async () => {
        const api = mkApi();
        const e = await captureFailure(api, () => api.get(ECHO)({ code: "5001" }));
        return {
          rejected: e !== undefined,
          isResponse: e !== undefined,
          isError: (e as unknown) instanceof Error,
          failure: e ? (failureOf(e)?.type ?? (e.ok ? RESULT_OK : e.status)) : undefined,
          code: e?.code,
          ok: e?.ok,
          failureTypes: Object.values(AXP_FAILURES),
        };
      }),
      act("response-reject", "reject 适配成 Error", async () => {
        const api = mkApi({ reject: (r) => Object.assign(new Error(r.message ?? undefined), { response: r }) });
        try {
          await api.get(ECHO)({ code: "5001" });
          return { rejected: false };
        } catch (e: any) {
          return { rejected: true, isError: e instanceof Error, isResponse: api.isResponse(e.response), failure: failureOf(e.response)?.type ?? e.response?.status };
        }
      }),
      act("response-empty", "204 空 body 不崩", async () => {
        const r = await mkApi().get(ECHO)({ status: 204 }, { throws: false });
        return { ok: r.ok, failure: failureOf(r)?.type ?? (r.ok ? RESULT_OK : r.status), status: r.status };
      }),
      act("response-custom", "自定义响应类的成功判定", async () => {
        /** 业务码恰为 7777 才算成功的响应类。 */
        class MyResponse<D = unknown> extends AxpResponse<D, string | number> {
          /** 成功码是 7777，而不是默认的 0 / "0000"。 */
          get ok() {
            return this.status >= 200 && this.status < 300 && this.code === CUSTOM_OK_CODE;
          }
        }
        const custom = createAxp<unknown, MyResponse>({
          axios: createAxios({ baseURL: BASE }),
          response: axpResponse<MyResponse>({ create: (init) => new MyResponse(init) }),
        });
        const byDefault = await mkApi().get(ECHO)({ code: CUSTOM_OK_CODE }, { throws: false });
        const byCustom = await custom.get(ECHO)({ code: CUSTOM_OK_CODE }, { throws: false });
        return {
          defaultFailure: failureOf(byDefault)?.type ?? (byDefault.ok ? RESULT_OK : byDefault.status),
          customOk: byCustom.ok,
          customFailure: failureOf(byCustom)?.type ?? (byCustom.ok ? RESULT_OK : byCustom.status),
          isBrand: isAxpResponse(byCustom),
          isSubclass: byCustom instanceof MyResponse,
        };
      }),
    ],
  },
  {
    id: "token",
    title: "TokenManager",
    desc: "set/get/clear，读取带 Bearer 前缀",
    actions: [
      act("token-set", "set + 读取", () => {
        const tm = new TokenManager();
        tm.set("abc", "refresh1");
        return { accessToken: tm.accessToken, refreshToken: tm.refreshToken };
      }),
      act("token-clear", "clear", () => {
        const tm = new TokenManager();
        tm.set("abc", "r");
        tm.clear();
        return { accessToken: tm.accessToken, refreshToken: tm.refreshToken };
      }),
    ],
  },
  {
    id: "harness",
    title: "演练场自检 · 真实后端计数",
    desc: "服务端计数可归零，读取不增加命中数，失败次数在重置后恢复；其余动作的网络次数断言都依赖它",
    actions: [
      act("harness-counters", "计数 / 失败序列 / 读取不计数", async () => {
        const id = "counter";
        /** 请求前两次失败的测试接口。 */
        const hit = () => raw.get(HIT, { params: { id, fail: 2 }, validateStatus: () => true });
        await resetHits();
        const statuses = [(await hit()).status, (await hit()).status];
        const third = await hit();
        const reads = [await readHits(id), await readHits(id)];
        await resetHits();
        return { statuses, thirdStatus: third.status, thirdHits: third.data.data.hits, reads, afterReset: await readHits(id), failAgainAfterReset: (await hit()).status };
      }),
    ],
  },
];

// ─── 集成测试（高并发 / 乱序 / 夹错 / auth 刷新）：每个用例内置 pass 断言 ───────────
/** 演练场并发及失败恢复动作。 */
export const integrationFeatures: Feature[] = [
  {
    id: "int-share",
    title: "集成 · share「start」高并发去重",
    desc: "30 个并发同 key（带延迟）→ 真实网络只发 1 次，全部同一结果",
    actions: [
      act("int-share-start", "跑 30 并发", async () => {
        await resetHits();
        const id = "intShare";
        const api = mkApi({ plugins: [axpShare({ policy: "start" })] });
        const res = await Promise.all(Array.from({ length: 30 }, () => api.get(HIT)<Row>({ id, delay: SLOW }, { share: "start" })));
        const serverHits = await readHits(id);
        const allSame = new Set(res.map((r) => JSON.stringify(r))).size === 1;
        return { pass: serverHits === 1 && allSame, serverHits, allSame, sample: res[0] };
      }),
    ],
  },
  {
    id: "int-race",
    title: "集成 · share「race」乱序夹错",
    desc: "3 并发前两次失败，最后一次成功 → 全部得到赢家（用显式 key 让三个不同延迟的请求归为一组）",
    actions: [
      act("int-race-run", "跑 race", async () => {
        await resetHits();
        const id = "intRace";
        const api = mkApi({ plugins: [axpShare({ policy: "race" })] });
        const res = await Promise.all(Array.from({ length: 3 }, (_, i) => api.get(HIT)<Row>({ id, fail: 2, delay: 60 - i * 20 }, { key: id, share: "race" })));
        const allOk = res.every((r) => r.hits === 3);
        await sleep(LOSERS_LAND);
        const serverHits = await readHits(id);
        return { pass: allOk && serverHits === 3, allOk, serverHits, results: res };
      }),
    ],
  },
  {
    id: "int-retry",
    title: "集成 · retry 成功 / 失败",
    desc: "前两次 HTTP 500 后恢复 / 持续失败耗尽重试",
    actions: [
      act("int-retry-recover", "失败两次后恢复", async () => {
        await resetHits();
        const id = "intRecover";
        const api = mkApi({ plugins: [axpRetry({ max: RETRY_MAX, delay: 0 })] });
        const result = await api.get(HIT)<Row>({ id, fail: 2, delay: 10 }, { retry: RETRY_MAX });
        const serverHits = await readHits(id);
        return { pass: result.hits === 3 && serverHits === 3, result, serverHits };
      }),
      act("int-retry-exhaust", "耗尽（持续 500）", async () => {
        await resetHits();
        const id = "intExhaust";
        const api = mkApi({ plugins: [axpRetry({ max: 2, delay: 0 })] });
        const e = await captureFailure(api, () => api.get(HIT)({ id, fail: ALWAYS_FAIL, delay: 5 }, { retry: 2 }));
        if (!e) return { pass: false, note: "应当 reject 却成功了" };
        const serverHits = await readHits(id);
        return { pass: serverHits === 3 && e.status === 500, serverHits, status: e.status, failure: failureOf(e)?.type ?? (e.ok ? RESULT_OK : e.status) };
      }),
    ],
  },
  {
    id: "int-crosstalk",
    title: "集成 · 20 并发乱序夹错「无串扰」",
    desc: "偶数 200 / 奇数 400，随机延迟乱序完成 → 每个结果都对应自己的 idx",
    actions: [
      act("int-crosstalk-run", "跑 20 并发", async () => {
        const api = mkApi();
        const out = await Promise.all(
          Array.from({ length: 20 }, (_, i) => {
            const params: Row = { idx: i, delay: ((i * 7) % 13) + 1 };
            if (i % 2 === 1) params.status = BAD_REQUEST;
            return api
              .get(ECHO)<Row>(params, { throws: false })
              .then(
                /** 成功与失败均验证回显结构后读取索引。 */ (r) => {
                  const data = r.data;
                  const query = data && typeof data === "object" && "query" in data ? data.query : undefined;
                  return { i, ok: r.ok, idx: query && typeof query === "object" && "idx" in query ? Number(query.idx) : NaN };
                },
              );
          }),
        );
        const mismatches = out.filter((r) => !(r.idx === r.i && r.ok === (r.i % 2 === 0)));
        return { pass: mismatches.length === 0, count: out.length, mismatches };
      }),
    ],
  },
  {
    id: "int-loading",
    title: "集成 · loading 并发计数",
    desc: "8 个并发慢请求 → 只 show 一次、hide 一次（看顶部指示器）",
    actions: [
      act("int-loading-run", "跑 8 并发", async () => {
        const toggles: boolean[] = [];
        const api = mkApi({
          plugins: [
            axpLoading({
              loading: (v) => {
                toggles.push(v);
                setIndicator(v);
              },
            }),
          ],
        });
        await Promise.all(Array.from({ length: 8 }, (_, i) => api.get(HIT)({ id: "intLoad" + i, delay: 200 }, { loading: true })));
        const trues = toggles.filter((v) => v).length,
          falses = toggles.filter((v) => !v).length;
        return { pass: trues === 1 && falses === 1 && toggles[0] && !toggles.at(-1), toggles };
      }),
    ],
  },
  {
    id: "int-auth",
    title: "集成 · auth 并发单飞刷新",
    desc: "20 个并发受保护请求 → onRefresh 仅触发 1 次，全部用新 token 恢复",
    actions: [
      act("int-auth-run", "跑 20 并发", async () => {
        const tm = makeMemTM(EXPIRED_TOKEN);
        let refreshCalls = 0;
        const api = mkApi();
        api.use(
          axpAuth({
            tokenManager: tm,
            urlPattern: [SECURE],
            /** 按本场景执行令牌刷新。 */
            onRefresh: async (_r, TM) => {
              refreshCalls++;
              const r = await api.post(REFRESH)<Row>();
              TM.set(r.token);
              return true;
            },
            onAccessExpired: () => {},
          }),
        );
        const res = await Promise.all(Array.from({ length: 20 }, () => api.get(SECURE)<Row>({ delay: 20 })));
        const allOk = res.every((r) => r.user === "u");
        return { pass: refreshCalls === 1 && allOk, refreshCalls, allOk, token: tm.accessToken?.slice(0, 20) + "..." };
      }),
    ],
  },
  {
    id: "int-auth-fail",
    title: "集成 · auth 刷新失败",
    desc: "onRefresh 返回 false → 全部 reject + onAccessExpired + tm 清空",
    actions: [
      act("int-auth-fail-run", "跑", async () => {
        const tm = makeMemTM("invalid-token"); // 无效 token
        let refreshCalls = 0,
          expired = 0;
        const api = mkApi({
          plugins: [
            axpAuth({
              tokenManager: tm,
              urlPattern: [SECURE],
              /** 按本场景执行令牌刷新。 */
              onRefresh: async () => {
                refreshCalls++;
                await sleep(50);
                return false;
              }, // 刷新失败
              onAccessExpired: () => {
                expired++;
              },
            }),
          ],
        });
        const settled = await Promise.allSettled(Array.from({ length: 10 }, () => api.get(SECURE)({ delay: 10 })));
        const allRejected = settled.every((s) => s.status === "rejected");
        const reasons = settled.map((s) => (s.status === "rejected" && isAxpResponse(s.reason) ? `${failureOf(s.reason)?.type}/${failureOf(s.reason)?.reason}` : "?"));
        return { pass: allRejected && refreshCalls === 1 && expired > 0 && tm.accessToken === undefined, allRejected, refreshCalls, expired, reasons: [...new Set(reasons)] };
      }),
    ],
  },
  {
    id: "int-auth-burst",
    title: "集成 · auth 刷新时间线",
    desc: "慢成功、慢失败与刷新中发起的请求分别收敛",
    actions: [
      act("int-auth-burst-run", "跑", async () => {
        const tm = makeMemTM(EXPIRED_TOKEN);
        let refreshCalls = 0;
        const order: string[] = [];
        const api = mkApi();
        api.use(
          axpAuth({
            tokenManager: tm,
            urlPattern: [SECURE],
            /** 按本场景执行令牌刷新。 */
            onRefresh: async (_r, TM) => {
              refreshCalls++;
              order.push(REFRESH_STARTED);
              await sleep(20);
              const r = await api.post(REFRESH)<Row>();
              TM.set(r.token);
              order.push("refresh-done");
              return true;
            },
            onAccessExpired: () => {},
          }),
        );

        const succeeded: string[] = [],
          failed: string[] = [];
        /** 记录每个请求的真实完成结果。 */
        const track = async (label: string, params: Record<string, unknown>) => {
          try {
            await api.get(SECURE)(params);
            succeeded.push(label);
          } catch {
            failed.push(label);
          }
        };
        const slowOk = track("slowOk", { delay: 60 });
        const slowFail = track("slowFail", { delay: 80, status: BAD_REQUEST });
        const first = track("first", { delay: 1 });
        // eslint-disable-next-line no-await-in-loop -- 轮询等刷新开始，必须按序。
        while (!order.includes(REFRESH_STARTED)) await sleep(1);
        const during = track("duringRefresh", { delay: 5 });
        await Promise.all([slowOk, slowFail, first, during]);
        const pass = refreshCalls === 1 && succeeded.length === 3 && failed.length === 1 && failed[0] === "slowFail";
        return { pass, refreshCalls, succeeded, failed, order };
      }),
    ],
  },
  {
    id: "int-auth-bounded",
    title: "集成 · auth 有界收敛",
    desc: "无效 token → 刷新失败 → 有界中止，不死循环",
    actions: [
      act("int-auth-bounded-run", "跑", async () => {
        const tm = makeMemTM("invalid-forever");
        let refreshCalls = 0,
          expired = 0;
        const api = mkApi({
          plugins: [
            axpAuth({
              tokenManager: tm,
              urlPattern: [SECURE],
              /** 按本场景执行令牌刷新。 */
              onRefresh: async () => {
                refreshCalls++;
                await sleep(50);
                return false;
              }, // 始终刷新失败
              onAccessExpired: () => {
                expired++;
              },
            }),
          ],
        });
        const settled = await Promise.allSettled(Array.from({ length: 10 }, () => api.get(SECURE)({ delay: 5 })));
        const allRejected = settled.every((s) => s.status === "rejected");
        return { pass: allRejected && expired > 0 && refreshCalls >= 1, refreshCalls, allRejected, expired };
      }),
    ],
  },
];

if (typeof document !== "undefined") render([...features, ...integrationFeatures]);
