/**
 * e2e 演练场驱动 —— 覆盖 `src/index.ts` 全部公开 API。
 * 每个动作自带新 axios 实例（顺序无关，便于 Playwright 逐项断言）。
 *
 * 覆盖清单（100% 公开导出）：
 *   Axp.create/Core(get,post,put,delete,patch,head,options, raw/wrap/plain, extends)
 *   Axp.install/AxpHandle(plugin,plugins,dispose,prepend,append,insertBefore,insertAfter)
 *   axpKey,$key · axpCache,removeCache,clearCache · axpCancel,cancelAll · axpEnvs
 *   axpFilter · axpLoading · axpMock · axpNormalize
 *   axpRepath · axpRetry · axpShare · axpAuth · AxpResponse,ApiError · TokenManager
 */
import axios from 'axios';
import {
  Axp, Core,
  AxpResponse, ApiError, TokenManager,
  axpKey, $key,
  axpCache, removeCache, clearCache,
  axpCancel, cancelAll,
  axpEnvs,
  axpFilter,
  axpLoading,
  axpMock,
  axpNormalize,
  axpRepath,
  axpRetry,
  axpShare,
  axpAuth,
  type Plugin,
  type ITokenManager,
} from '../../src/index.ts';

/** 本地可控后端，所有计数、失败与延迟均由仓库服务产生。 */
const BASE = 'http://localhost:4570';
/** 回显请求端点。 */
const ECHO = '/api/echo';
/** 可计数、可按次数失败的请求端点。 */
const HIT = '/api/hit';
/** 受保护资源端点。 */
const SECURE = '/api/secure';
/** 本地缓存演示使用的固定键。 */
const CACHE_KEY = 'ck';
/** 本地刷新令牌端点。 */
const REFRESH = '/api/refresh';
/** 触发真实 401 的过期令牌。 */
const EXPIRED_TOKEN = 'expired-token';
/** 刷新时间线的开始标记。 */
const REFRESH_STARTED = 'refresh-called';
/** 缓存命中计数组。 */
const CACHE_SCENARIO = 'cacheDemo';
/** 移除缓存计数组。 */
const REMOVE_SCENARIO = 'cacheRm';
/** 共享合并计数组。 */
const START_SCENARIO = 'shareStart';
/** 共享竞速计数组。 */
const RACE_SCENARIO = 'shareRace';
/** 共享末位计数组。 */
const END_SCENARIO = 'shareEnd';
/** 重试恢复计数组。 */
const RETRY_SCENARIO = 'retryDemo';
/** 禁用重试计数组。 */
const NO_RETRY_SCENARIO = 'retryOff';
/** 高并发合并计数组。 */
const INT_SHARE_SCENARIO = 'intShare';
/** 乱序竞速计数组。 */
const INT_RACE_SCENARIO = 'intRace';
/** 集成恢复计数组。 */
const RECOVER_SCENARIO = 'intRecover';
/** 集成耗尽计数组。 */
const EXHAUST_SCENARIO = 'intExhaust';
/** 为每个动作创建独立请求实例。 */
const mkApi = (opts?: any) => Axp.create(axios.create({ baseURL: BASE }), opts);
/** 等待指定毫秒以制造可控时序。 */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// 无插件的裸 axios，用于获取简单数据（断言用）
const raw = axios.create({ baseURL: BASE });
/** 重置服务端命中数与失败次数。 */
const resetHits = () => raw.post('/api/hits/reset');
/** 读取真实网络命中数，读取操作自身不计数。 */
const readHits = async (id: string): Promise<number> => (await raw.get('/api/hits', { params: { id } })).data.data.hits;

/** 内存 TokenManager（不落 localStorage，便于反复点测；accessToken getter 加 Bearer） */
function makeMemTM(token?: string): ITokenManager {
  let access = token, refresh: string | undefined;
  return {
    canRefresh: true,
    get accessToken() { return access ? `Bearer ${access}` : undefined; },
    get refreshToken() { return refresh; },
    set(a?: string, r?: string) { access = a; refresh = r; },
    clear() { access = undefined; refresh = undefined; },
  };
}

/** 更新顶部 loading 指示器。 */
function setIndicator(v: boolean) {
  if (typeof document === 'undefined') return;
  const el = document.querySelector('[data-testid="loading-indicator"]')!;
  el.textContent = v ? 'on' : 'off';
  el.className = 'pill ' + (v ? 'on' : 'off');
}

// 两个自定义（非内置）插件，示范 Plugin 是普通 `{name, install(axios)}` 对象——
// 装法跟内置插件完全一样，不需要走 Axp.install 的固定插槽。
const logging: Plugin = {
  name: 'logging',
  install(axiosInstance) {
    const reqId = axiosInstance.interceptors.request.use((c) => c);
    const resId = axiosInstance.interceptors.response.use((r) => r);
    return () => { axiosInstance.interceptors.request.eject(reqId); axiosInstance.interceptors.response.eject(resId); };
  },
};
const tracer: Plugin = {
  name: 'tracer',
  install(axiosInstance) {
    const id = axiosInstance.interceptors.request.use((c) => c);
    return () => { axiosInstance.interceptors.request.eject(id); };
  },
};

// ─── 渲染框架 ────────────────────────────────────────────────────────────────
type Action = { id: string; label: string; /** 执行本动作并返回可断言结果。 */ run: () => Promise<unknown> | unknown };
type Feature = { id: string; title: string; desc: string; actions: Action[] };

/** 将动作结果序列化到结果面板。 */
function stringify(v: unknown): string {
  return JSON.stringify(v, (_k, val) => {
    if (val instanceof AxpResponse) return { __type: 'ApiResponse', ...val };
    if (val instanceof Error) return { __type: val.name, message: val.message, response: (val as any).response, code: (val as any).code };
    return val;
  }, 2);
}

/** 为动作创建按钮及对应结果面板。 */
function render(features: Feature[]) {
  const app = document.getElementById('app')!;
  for (const f of features) {
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `<h2>${f.title}</h2><div class="desc">${f.desc}</div>`;
    for (const a of f.actions) {
      const btn = document.createElement('button');
      btn.textContent = a.label;
      btn.dataset.testid = a.id;
      btn.onclick = async () => {
        const pre = card.querySelector(`[data-testid="${f.id}-result"]`)! as HTMLElement;
        pre.textContent = 'running…';
        pre.className = '';
        try {
          const out = await a.run();
          pre.textContent = stringify(out);
          pre.className = 'ok';
        } catch (e) {
          pre.textContent = stringify(e);
          pre.className = 'err';
        }
      };
      card.appendChild(btn);
    }
    const pre = document.createElement('pre');
    pre.dataset.testid = `${f.id}-result`;
    pre.textContent = '(尚未运行)';
    card.appendChild(pre);
    app.appendChild(card);
  }
}

// ─── 功能清单 ────────────────────────────────────────────────────────────────
/** 演练场基础动作，同时供真实 HTTP 回归验证使用。 */
export const features: Feature[] = [
  {
    id: 'core', title: 'Core · verbs + 三种响应形态', desc: 'Axp.create() 包装裸 axios；get/post/put/delete/patch/head/options；raw/wrap/解包',
    actions: [
      { id: 'core-get', label: 'get', /** 执行本动作并返回可断言结果。 */ run: () => mkApi().get(ECHO)({ q: 1 }) },
      { id: 'core-post', label: 'post', /** 执行本动作并返回可断言结果。 */ run: () => mkApi().post(ECHO)({ name: 'x' }) },
      { id: 'core-put', label: 'put', /** 执行本动作并返回可断言结果。 */ run: () => mkApi().put(ECHO)({ v: 1 }) },
      { id: 'core-patch', label: 'patch', /** 执行本动作并返回可断言结果。 */ run: () => mkApi().patch(ECHO)({ v: 2 }) },
      { id: 'core-delete', label: 'delete', /** 执行本动作并返回可断言结果。 */ run: () => mkApi().delete(ECHO)({ del: 1 }) },
      { id: 'core-head', label: 'head', /** 执行本动作并返回可断言结果。 */ run: async () => { await mkApi().head(ECHO)(); return { head: 'resolved' }; } },
      { id: 'core-options', label: 'options', /** 执行本动作并返回可断言结果。 */ run: async () => { await mkApi().options(ECHO)(); return { options: 'resolved' }; } },
      { id: 'core-plain', label: 'plain → data', /** 执行本动作并返回可断言结果。 */ run: () => mkApi().get(ECHO)({ shape: 'plain' }) },
      { id: 'core-raw', label: 'raw → 信封', /** 执行本动作并返回可断言结果。 */ run: () => mkApi().get(ECHO)(undefined, { raw: true } as any) },
      { id: 'core-wrap', label: 'wrap → AxpResponse', /** 执行本动作并返回可断言结果。 */ run: () => mkApi().get(ECHO)(undefined, { wrap: true } as any) },
    ],
  },
  {
    id: 'lifecycle', title: 'Axp.install · AxpHandle + Core.extends', desc: '插件编排（固定插槽 + append/prepend/insertBefore/insertAfter/dispose）与派生子实例',
    actions: [
      {
        id: 'lifecycle-use', label: 'Axp.install + append 装两个', /** 执行本动作并返回可断言结果。 */ run: () => {
          const a = mkApi();
          // 自定义插件（不占用 AxpPlugins 固定插槽）用 append 追加进同一个 handle。
          const handle = Axp.install(a.axios, {});
          handle.append(logging);
          handle.append(tracer);
          return handle.plugins.map((p) => ({ name: p.name }));
        },
      },
      {
        id: 'lifecycle-eject', label: '各自 cleanup 独立卸载', /** 执行本动作并返回可断言结果。 */ run: () => {
          // AxpHandle 没有"卸载其中一个"的方法——每个插件自己的 cleanup 就是它的卸载
          // 入口，不需要一个共享的编排器。这里绕开 handle，直接拿两个插件各自的
          // cleanup，只调用 logging 的，tracer 不受影响。
          const a = mkApi();
          const installed = [logging, tracer].map((p) => ({ name: p.name, cleanup: p.install(a.axios) }));
          installed[0].cleanup?.();
          return installed.slice(1).map((p) => ({ name: p.name }));
        },
      },
      {
        id: 'lifecycle-plugins', label: 'plugins 快照', /** 执行本动作并返回可断言结果。 */ run: () => {
          const a = mkApi();
          const handle = Axp.install(a.axios, {});
          handle.append(logging);
          handle.append(tracer);
          return handle.plugins;
        },
      },
      {
        id: 'lifecycle-extends', label: 'extends 派生（不带插件）', /** 执行本动作并返回可断言结果。 */ run: () => {
          const parent = mkApi();
          const parentHandle = Axp.install(parent.axios, {});
          parentHandle.append(logging);
          const child = parent.extends({ baseURL: BASE });
          // extends 不带走插件——子实例需要的话自己再 Axp.install 一次。
          const childHandle = Axp.install(child.axios, {});
          childHandle.append(logging);
          childHandle.append(tracer);
          return { parent: parentHandle.plugins.map((p) => p.name), child: childHandle.plugins.map((p) => p.name) };
        },
      },
    ],
  },
  {
    id: 'key', title: 'axpKey · $key', desc: 'simple/deep/object key 生成 + 插件端到端写入 config.key',
    actions: [
      { id: 'key-simple', label: 'simple 忽略 params', /** 执行本动作并返回可断言结果。 */ run: () => ({ a: $key({ url: '/u', method: 'GET', params: { x: 1 } }, true), b: $key({ url: '/u', method: 'GET', params: { x: 2 } }, true), equal: $key({ url: '/u', method: 'GET', params: { x: 1 } }, true) === $key({ url: '/u', method: 'GET', params: { x: 2 } }, true) }) },
      { id: 'key-deep', label: 'deep 区分 params', /** 执行本动作并返回可断言结果。 */ run: () => ({ a: $key({ url: '/u', method: 'GET', params: { x: 1 } }, false), b: $key({ url: '/u', method: 'GET', params: { x: 2 } }, false), equal: $key({ url: '/u', method: 'GET', params: { x: 1 } }, false) === $key({ url: '/u', method: 'GET', params: { x: 2 } }, false) }) },
      {
        id: 'key-plugin', label: '插件写入 key', /** 执行本动作并返回可断言结果。 */ run: async () => {
          const a = mkApi(); let captured: string | undefined;
          const capture: Plugin = {
            name: 'capture',
            install(axiosInstance) {
              const id = axiosInstance.interceptors.request.use((c) => { captured = (c as any).key; return c; });
              return () => { axiosInstance.interceptors.request.eject(id); };
            },
          };
          // 注册顺序 = LIFO 的"先"：capture 先注册、key 后注册 → key 的拦截器先跑（写入
          // config.key），capture 的拦截器后跑（读到已写好的 key）——跟 axpKey 装在
          // capture 之后的语义一致。
          capture.install(a.axios);
          Axp.install(a.axios, { key: axpKey() });
          await a.get(ECHO)({ a: 1 }, { key: true } as any);
          return { capturedKey: captured };
        },
      },
    ],
  },
  {
    id: 'cache', title: 'axpCache · removeCache / clearCache', desc: 'TTL 内复用响应；用服务端命中数证明只发一次网络',
    actions: [
      {
        id: 'cache-hit-twice', label: '连发两次→1次网络', /** 执行本动作并返回可断言结果。 */ run: async () => {
          await resetHits();
          const a = mkApi(); Axp.install(a.axios, { cache: axpCache({ key: () => CACHE_KEY, expires: 60000 }) });
          const r1 = await a.get(HIT)({ id: CACHE_SCENARIO }, { cache: true } as any);
          const r2 = await a.get(HIT)({ id: CACHE_SCENARIO }, { cache: true } as any);
          return { r1, r2, serverHits: await readHits(CACHE_SCENARIO) };
        },
      },
      {
        id: 'cache-remove', label: 'removeCache 后重发', /** 执行本动作并返回可断言结果。 */ run: async () => {
          await resetHits();
          const a = mkApi(); Axp.install(a.axios, { cache: axpCache({ key: () => CACHE_KEY, expires: 60000 }) });
          await a.get(HIT)({ id: REMOVE_SCENARIO }, { cache: true } as any);
          const removed = removeCache(a.axios, CACHE_KEY);
          await a.get(HIT)({ id: REMOVE_SCENARIO }, { cache: true } as any);
          return { removed, serverHits: await readHits(REMOVE_SCENARIO) };
        },
      },
      {
        id: 'cache-clear', label: 'clearCache', /** 执行本动作并返回可断言结果。 */ run: async () => {
          const a = mkApi(); Axp.install(a.axios, { cache: axpCache({ key: () => CACHE_KEY }) });
          await a.get(HIT)({ id: 'cacheClr' }, { cache: true } as any);
          return { cleared: clearCache(a.axios) };
        },
      },
    ],
  },
  {
    id: 'share', title: 'axpShare · start/race/end', desc: '同 key 并发请求的合并/竞速/顶替策略',
    actions: [
      {
        id: 'share-start', label: 'start 合并并发', /** 执行本动作并返回可断言结果。 */ run: async () => {
          await resetHits();
          const a = mkApi(); Axp.install(a.axios, { key: axpKey(), share: axpShare({ policy: 'start' }) });
          const calls = Array.from({ length: 5 }, () => a.get(HIT)({ id: START_SCENARIO, delay: 80 }, { key: true, share: true } as any));
          const results = await Promise.all(calls);
          return { hitsSeen: (results as any[]).map((r) => r.hits), serverHits: await readHits(START_SCENARIO) };
        },
      },
      {
        id: 'share-race', label: 'race 各发竞速', /** 执行本动作并返回可断言结果。 */ run: async () => {
          await resetHits();
          const a = mkApi(); Axp.install(a.axios, { key: axpKey(), share: axpShare({ policy: 'race' }) });
          const calls = Array.from({ length: 3 }, () => a.get(HIT)({ id: RACE_SCENARIO, delay: 80 }, { key: true, share: true } as any));
          const results = await Promise.all(calls);
          return { results, serverHits: await readHits(RACE_SCENARIO) };
        },
      },
      {
        id: 'share-end', label: 'end 末位生效', /** 执行本动作并返回可断言结果。 */ run: async () => {
          await resetHits();
          const a = mkApi(); Axp.install(a.axios, { key: axpKey(), share: axpShare({ policy: 'end' }) });
          const calls = Array.from({ length: 3 }, () => a.get(HIT)({ id: END_SCENARIO, delay: 80 }, { key: true, share: true } as any));
          const results = await Promise.all(calls);
          return { sameResult: new Set((results as any[]).map((r) => JSON.stringify(r))).size, serverHits: await readHits(END_SCENARIO) };
        },
      },
    ],
  },
  {
    id: 'retry', title: 'axpRetry', desc: '失败自动重试；retry:0 禁用',
    actions: [
      {
        id: 'retry-run', label: '前两次 500 → 重试成功', /** 执行本动作并返回可断言结果。 */ run: async () => {
          await resetHits();
          const a = mkApi(); Axp.install(a.axios, { retry: axpRetry({ max: 3, delay: 0 }) });
          const result = await a.get(HIT)({ id: RETRY_SCENARIO, fail: 2 }, { retry: 3 });
          return { result, serverHits: await readHits(RETRY_SCENARIO) };
        },
      },
      {
        id: 'retry-disabled', label: 'retry:0 + 失败状态 → 直接失败', /** 执行本动作并返回可断言结果。 */ run: async () => {
          await resetHits();
          const a = mkApi(); Axp.install(a.axios, { retry: axpRetry({ max: 5, delay: 0 }) });
          try { await a.get(HIT)({ id: NO_RETRY_SCENARIO, fail: 9 }, { retry: 0 }); return { rejected: false }; }
          catch (e: any) { return { rejected: true, status: e?.response?.status, serverHits: await readHits(NO_RETRY_SCENARIO) }; }
        },
      },
    ],
  },
  {
    id: 'cancel', title: 'axpCancel · cancelAll', desc: '自动注入 AbortController；cancelAll 一次性中止在飞请求',
    actions: [
      {
        id: 'cancel-run', label: '慢请求 + cancelAll', /** 执行本动作并返回可断言结果。 */ run: async () => {
          const a = mkApi(); Axp.install(a.axios, { cancel: axpCancel() });
          const p = a.get(HIT)({ id: 'cancelDemo', delay: 1500 });
          setTimeout(() => cancelAll(a.axios, 'user navigated away'), 100);
          try { await p; return { canceled: false }; }
          catch (e: any) { return { canceled: axios.isCancel(e), name: e?.name, code: e?.code }; }
        },
      },
    ],
  },
  {
    id: 'loading', title: 'axpLoading', desc: '全局请求计数：0→1 触发 true，1→0 触发 false（看顶部指示器）',
    actions: [
      {
        id: 'loading-run', label: '2 个并发慢请求', /** 执行本动作并返回可断言结果。 */ run: async () => {
          const toggles: boolean[] = [];
          const a = mkApi(); Axp.install(a.axios, { loading: axpLoading({ loading: (v) => { toggles.push(v); setIndicator(v); } }) });
          await Promise.all([
            a.get(HIT)({ id: 'loadingA', delay: 400 }),
            a.get(HIT)({ id: 'loadingB', delay: 600 }),
          ]);
          return { toggles };
        },
      },
    ],
  },
  {
    id: 'mock', title: 'axpMock', desc: '本地 mock 改写与 404 回落真实接口',
    actions: [
      {
        id: 'mock-run', label: '请求 mock',
        /** 验证启用 mock 后实际到达 mock 路由。 */
        /** 执行本动作并返回可断言结果。 */ run: () => {
          const a = mkApi(); Axp.install(a.axios, { mock: axpMock({ enable: true, mock: true, mockUrl: BASE + '/mock' }) });
          return a.get(ECHO)({ msg: 'mock request' });
        },
      },
      {
        id: 'mock-fallback', label: 'mock 404 → 真实接口',
        /** 验证插件在 mock 不存在时回落到原始 URL。 */
        /** 执行本动作并返回可断言结果。 */ run: () => {
          const a = mkApi(); Axp.install(a.axios, { mock: axpMock({ enable: true, mock: true, mockUrl: BASE + '/mock-404' }) });
          return a.get(ECHO)({ via: 'fallback' });
        },
      },
    ],
  },
  {
    id: 'envs', title: 'axpEnvs', desc: '安装期按规则合并环境默认（运行时零开销）',
    actions: [
      {
        id: 'envs-run', label: '匹配第二条规则', /** 执行本动作并返回可断言结果。 */ run: () => {
          const a = mkApi();
          Axp.install(a.axios, {
            envs: axpEnvs([
              { rule: () => false, config: { baseURL: 'http://never' } },
              { rule: () => true, config: { headers: { 'X-Env': 'prod' } as any } },
            ]),
          });
          return { baseURL: a.axios.defaults.baseURL, xEnv: (a.axios.defaults.headers as any)['X-Env'] };
        },
      },
    ],
  },
  {
    id: 'filter', title: 'axpFilter', desc: '剥离 params/data 中的空字段',
    actions: [
      {
        id: 'filter-run', label: '过滤空字段', /** 执行本动作并返回可断言结果。 */ run: async () => {
          const a = mkApi(); Axp.install(a.axios, { filter: axpFilter() });
          const r: any = await a.get(ECHO)({ a: 1, b: '', c: null, d: '  ', e: 0 }, { filter: true } as any);
          return { query: r.query };
        },
      },
    ],
  },
  {
    id: 'pathvars', title: 'axpRepath', desc: '{id} / :pid / [x] 路径变量替换',
    actions: [
      {
        id: 'pathvars-run', label: '替换 {id}/:pid', /** 执行本动作并返回可断言结果。 */ run: async () => {
          const a = mkApi(); Axp.install(a.axios, { repath: axpRepath() });
          return a.get('/users/{id}/posts/:pid')({ id: 7, pid: 9 });
        },
      },
    ],
  },
  {
    id: 'normalize', title: 'axpNormalize', desc: '业务 code 非成功 → 以 ApiError reject',
    actions: [
      { id: 'normalize-ok', label: 'code=0000 → 成功', /** 执行本动作并返回可断言结果。 */ run: () => { const a = mkApi(); Axp.install(a.axios, { normalize: axpNormalize() }); return a.get(ECHO)({ ok: 1 }); } },
      {
        id: 'normalize-fail', label: 'code=5001 → ApiError', /** 执行本动作并返回可断言结果。 */ run: async () => {
          const a = mkApi(); Axp.install(a.axios, { normalize: axpNormalize() });
          try { await a.get(ECHO)({ code: '5001' }); return { rejected: false }; }
          catch (e: any) { return { rejected: true, isApiError: e instanceof ApiError, response: e?.response }; }
        },
      },
    ],
  },
  {
    id: 'token', title: 'TokenManager', desc: 'set/get/clear，读取带 Bearer 前缀',
    actions: [
      { id: 'token-set', label: 'set + 读取', /** 执行本动作并返回可断言结果。 */ run: () => { const tm = new TokenManager(); tm.set('abc', 'refresh1'); return { accessToken: tm.accessToken, refreshToken: tm.refreshToken }; } },
      { id: 'token-clear', label: 'clear', /** 执行本动作并返回可断言结果。 */ run: () => { const tm = new TokenManager(); tm.set('abc', 'r'); tm.clear(); return { accessToken: tm.accessToken, refreshToken: tm.refreshToken }; } },
    ],
  },
  {
    id: 'apiresponse', title: 'AxpResponse · ApiError', desc: 'fromResponse 防 null + 成功判定 + ApiError',
    actions: [
      {
        id: 'apiresponse-run', label: '构造 & 判定', /** 执行本动作并返回可断言结果。 */ run: () => {
          const ok = AxpResponse.fromResponse({ status: 200, data: { code: '0000', message: 'ok', data: { x: 1 } } });
          const nullBody = AxpResponse.fromResponse({ status: 204, data: null }); // 旧实现在此崩溃
          const err = new ApiError(AxpResponse.fromResponse({ status: 500, data: { code: '5001', message: 'boom' } }));
          return { okSuccessful: ok.successful, nullSuccessful: nullBody.successful, errIsError: err instanceof Error, errMsg: err.message, isCoreCtor: typeof Core === 'function' };
        },
      },
    ],
  },
];

// ─── 集成测试（高并发 / 乱序 / 夹错 / auth 刷新）：每个用例内置 pass 断言 ───────────
/** 演练场并发及失败恢复动作。 */
export const integrationFeatures: Feature[] = [
  {
    id: 'int-share', title: '集成 · share「start」高并发去重', desc: '30 个并发同 key（带延迟）→ 真实网络只发 1 次，全部同一结果',
    actions: [{
      id: 'int-share-start', label: '跑 30 并发', /** 执行本动作并返回可断言结果。 */ run: async () => {
        await resetHits();
        const a = mkApi(); Axp.install(a.axios, { key: axpKey(), share: axpShare({ policy: 'start' }) });
        const res = await Promise.all(
          Array.from({ length: 30 }, () => a.get(HIT)({ id: INT_SHARE_SCENARIO, delay: 80 }, { key: true, share: 'start' } as any)),
        );
        const serverHits = await readHits(INT_SHARE_SCENARIO);
        const allSame = new Set((res as any[]).map((r) => JSON.stringify(r))).size === 1;
        return { pass: serverHits === 1 && allSame, serverHits, allSame, sample: (res as any[])[0] };
      },
    }],
  },
  {
    id: 'int-race', title: '集成 · share「race」乱序夹错', desc: '3 并发前两次失败，最后一次成功 → 全部得到赢家',
    actions: [{
      id: 'int-race-run', label: '跑 race', /** 执行本动作并返回可断言结果。 */ run: async () => {
        await resetHits();
        const a = mkApi(); Axp.install(a.axios, { key: axpKey(), share: axpShare({ policy: 'race' }) });
        const res = await Promise.all(
          Array.from({ length: 3 }, (_, i) => a.get(HIT)({ id: INT_RACE_SCENARIO, fail: 2, delay: 60 - i * 20 }, { key: true, share: 'race' })),
        );
        const allOk = (res as any[]).every((r) => r?.hits === 3);
        const serverHits = await readHits(INT_RACE_SCENARIO);
        return { pass: allOk && serverHits === 3, allOk, serverHits, results: res };
      },
    }],
  },
  {
    id: 'int-retry', title: '集成 · retry 成功 / 失败', desc: '前两次 HTTP 500 后恢复 / 持续失败耗尽重试',
    actions: [
      {
        id: 'int-retry-recover', label: '失败两次后恢复', /** 执行本动作并返回可断言结果。 */ run: async () => {
          await resetHits();
          const a = mkApi(); Axp.install(a.axios, { retry: axpRetry({ max: 3, delay: 0 }) });
          const result: any = await a.get(HIT)({ id: RECOVER_SCENARIO, fail: 2, delay: 10 }, { retry: 3 });
          const serverHits = await readHits(RECOVER_SCENARIO);
          return { pass: result.hits === 3 && serverHits === 3, result, serverHits };
        },
      },
      {
        id: 'int-retry-exhaust', label: '耗尽（持续 500）', /** 执行本动作并返回可断言结果。 */ run: async () => {
          await resetHits();
          const a = mkApi(); Axp.install(a.axios, { retry: axpRetry({ max: 2, delay: 0 }) });
          try {
            await a.get(HIT)({ id: EXHAUST_SCENARIO, fail: 9, delay: 5 }, { retry: 2 } as any);
            return { pass: false, note: '应当 reject 却成功了' };
          } catch (e: any) {
            const serverHits = await readHits(EXHAUST_SCENARIO);
            return { pass: serverHits === 3 && e?.response?.status === 500, serverHits, status: e?.response?.status };
          }
        },
      },
    ],
  },
  {
    id: 'int-crosstalk', title: '集成 · 20 并发乱序夹错「无串扰」', desc: '偶数 200 / 奇数 400，随机延迟乱序完成 → 每个结果都对应自己的 idx',
    actions: [{
      id: 'int-crosstalk-run', label: '跑 20 并发', /** 执行本动作并返回可断言结果。 */ run: async () => {
        const a = mkApi();
        const out = await Promise.all(Array.from({ length: 20 }, (_, i) => {
          const params: any = { idx: i, delay: ((i * 7) % 13) + 1 };
          if (i % 2 === 1) params.status = 400;
          return a.get(ECHO)(params)
            .then((d: any) => ({ i, ok: true, idx: Number(d.query.idx) }))
            .catch((e: any) => ({ i, ok: false, idx: Number(e?.response?.data?.data?.query?.idx) }));
        }));
        const mismatches = out.filter((r) => !(r.idx === r.i && r.ok === (r.i % 2 === 0)));
        return { pass: mismatches.length === 0, count: out.length, mismatches };
      },
    }],
  },
  {
    id: 'int-loading', title: '集成 · loading 并发计数', desc: '8 个并发慢请求 → 只 show 一次、hide 一次（看顶部指示器）',
    actions: [{
      id: 'int-loading-run', label: '跑 8 并发', /** 执行本动作并返回可断言结果。 */ run: async () => {
        const toggles: boolean[] = [];
        const a = mkApi(); Axp.install(a.axios, { loading: axpLoading({ loading: (v) => { toggles.push(v); setIndicator(v); } }) });
        await Promise.all(Array.from({ length: 8 }, (_, i) => a.get(HIT)({ id: 'intLoad' + i, delay: 200 }, { loading: true } as any)));
        const trues = toggles.filter((v) => v).length, falses = toggles.filter((v) => !v).length;
        return { pass: trues === 1 && falses === 1 && toggles[0] === true && toggles.at(-1) === false, toggles };
      },
    }],
  },
  {
    id: 'int-auth', title: '集成 · auth 并发单飞刷新', desc: '20 个并发受保护请求 → onRefresh 仅触发 1 次，全部用新 token 恢复',
    actions: [{
      id: 'int-auth-run', label: '跑 20 并发', /** 执行本动作并返回可断言结果。 */ run: async () => {
        const a = mkApi();
        const tm = makeMemTM(EXPIRED_TOKEN);
        let refreshCalls = 0;
        Axp.install(a.axios, {
          auth: axpAuth({
            tokenManager: tm, urlPattern: [SECURE],
            /** 按本场景执行令牌刷新。 */
            onRefresh: async (TM) => {
              refreshCalls++;
              const r: any = await a.post(REFRESH)();
              TM.set(r.token);
              return true;
            },
            onAccessExpired: () => { },
          }),
        });
        const res = await Promise.all(Array.from({ length: 20 }, () => a.get(SECURE)({ delay: 20 })));
        const allOk = (res as any[]).every((r) => r?.user === 'u');
        return { pass: refreshCalls === 1 && allOk, refreshCalls, allOk, token: tm.accessToken?.slice(0, 20) + '...' };
      },
    }],
  },
  {
    id: 'int-auth-fail', title: '集成 · auth 刷新失败', desc: 'onRefresh 返回 false → 全部 reject + onAccessExpired + tm 清空',
    actions: [{
      id: 'int-auth-fail-run', label: '跑', /** 执行本动作并返回可断言结果。 */ run: async () => {
        const a = mkApi(); const tm = makeMemTM('invalid-token');  // 无效 token
        let refreshCalls = 0, expired = 0;
        Axp.install(a.axios, {
          auth: axpAuth({
            tokenManager: tm, urlPattern: [SECURE],
            /** 按本场景执行令牌刷新。 */
            onRefresh: async () => { refreshCalls++; await sleep(50); return false; },  // 刷新失败
            onAccessExpired: () => { expired++; },
          }),
        });
        const settled = await Promise.allSettled(Array.from({ length: 10 }, () => a.get(SECURE)({ delay: 10 } as any)));
        const allRejected = settled.every((s) => s.status === 'rejected');
        return { pass: allRejected && refreshCalls === 1 && expired > 0 && tm.accessToken === undefined, allRejected, refreshCalls, expired };
      },
    }],
  },
  {
    id: 'int-auth-burst', title: '集成 · auth 刷新时间线', desc: '慢成功、慢失败与刷新中发起的请求分别收敛',
    actions: [{
      id: 'int-auth-burst-run', label: '跑', /** 执行本动作并返回可断言结果。 */ run: async () => {
        const a = mkApi();
        const tm = makeMemTM(EXPIRED_TOKEN);
        let refreshCalls = 0;
        const order: string[] = [];
        Axp.install(a.axios, {
          auth: axpAuth({
            tokenManager: tm, urlPattern: [SECURE],
            /** 按本场景执行令牌刷新。 */
            onRefresh: async (TM) => {
              refreshCalls++;
              order.push(REFRESH_STARTED);
              await sleep(20);
              const r: any = await a.post(REFRESH)();
              TM.set(r.token);
              order.push('refresh-done');
              return true;
            },
            onAccessExpired: () => { },
          }),
        });

        const succeeded: string[] = [], failed: string[] = [];
        /** 记录每个请求的真实完成结果。 */
        const track = (label: string, params: Record<string, unknown>) => a.get(SECURE)(params)
          .then(() => { succeeded.push(label); }, () => { failed.push(label); });
        const slowOk = track('slowOk', { delay: 60 });
        const slowFail = track('slowFail', { delay: 80, status: 400 });
        const first = track('first', { delay: 1 });
        while (!order.includes(REFRESH_STARTED)) await sleep(1);
        const during = track('duringRefresh', { delay: 5 });
        await Promise.all([slowOk, slowFail, first, during]);
        const pass = refreshCalls === 1 && succeeded.length === 3 && failed.length === 1 && failed[0] === 'slowFail';
        return { pass, refreshCalls, succeeded, failed, order };
      },
    }],
  },
  {
    id: 'int-auth-bounded', title: '集成 · auth 有界收敛', desc: '无效 token → 刷新失败 → 有界中止，不死循环',
    actions: [{
      id: 'int-auth-bounded-run', label: '跑', /** 执行本动作并返回可断言结果。 */ run: async () => {
        const a = mkApi(); const tm = makeMemTM('invalid-forever');
        let refreshCalls = 0, expired = 0;
        Axp.install(a.axios, {
          auth: axpAuth({
            tokenManager: tm, urlPattern: [SECURE],
            /** 按本场景执行令牌刷新。 */
            onRefresh: async () => { refreshCalls++; await sleep(50); return false; },  // 始终刷新失败
            onAccessExpired: () => { expired++; },
          }),
        });
        const settled = await Promise.allSettled(Array.from({ length: 10 }, () => a.get(SECURE)({ delay: 5 } as any)));
        const allRejected = settled.every((s) => s.status === 'rejected');
        return { pass: allRejected && expired > 0 && refreshCalls >= 1, refreshCalls, allRejected, expired };
      },
    }],
  },
];

if (typeof document !== 'undefined') render([...features, ...integrationFeatures]);
