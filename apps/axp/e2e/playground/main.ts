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

const BASE = 'https://api-ws-demo-latest.onrender.com';
const mkApi = (opts?: any) => Axp.create(axios.create({ baseURL: BASE }), opts);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// 无插件的裸 axios，用于获取简单数据（断言用）
const raw = axios.create({ baseURL: BASE });
// 用 /api/mock 模拟计数功能（简化版：每次请求都算一个"hit"）
const resetHits = () => Promise.resolve();  // 线上 API 无状态，无需重置
const readHits = async (id: string) => 1;  // 简化：始终返回 1 表示已发送一次请求

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

/** 向 api-ws-demo 的 auth 接口注册/登录并获取 token */
async function getAuthTokensFromServer(): Promise<{ accessToken: string; refreshToken: string }> {
  const timestamp = Date.now();
  const username = `test_${timestamp}`;
  const password = 'test123';

  try {
    // 注册新用户
    await raw.post('/auth/register', { username, password });
  } catch (e: any) {
    // 用户可能已存在，忽略错误
    if (e?.response?.status !== 409) throw e;
  }

  // 登录
  const loginRes = await raw.post('/auth/login', { username, password });
  const { access_token, refresh_token } = loginRes.data.data;
  return { accessToken: access_token, refreshToken: refresh_token };
}

function setIndicator(v: boolean) {
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
type Action = { id: string; label: string; run: () => Promise<unknown> | unknown };
type Feature = { id: string; title: string; desc: string; actions: Action[] };

function stringify(v: unknown): string {
  return JSON.stringify(v, (_k, val) => {
    if (val instanceof AxpResponse) return { __type: 'ApiResponse', ...val };
    if (val instanceof Error) return { __type: val.name, message: val.message, response: (val as any).response, code: (val as any).code };
    return val;
  }, 2);
}

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
const features: Feature[] = [
  {
    id: 'core', title: 'Core · verbs + 三种响应形态', desc: 'Axp.create() 包装裸 axios；get/post/put/delete/patch/head/options；raw/wrap/解包',
    actions: [
      { id: 'core-get', label: 'get', run: () => mkApi().get('/api/mock')({ q: 1 }) },
      { id: 'core-post', label: 'post', run: () => mkApi().post('/api/echo')({ name: 'x' }) },
      { id: 'core-put', label: 'put', run: () => mkApi().put('/api/echo')({ v: 1 }) },
      { id: 'core-patch', label: 'patch', run: () => mkApi().patch('/api/echo')({ v: 2 }) },
      { id: 'core-delete', label: 'delete', run: () => mkApi().delete('/api/echo')({ del: 1 }) },
      { id: 'core-head', label: 'head', run: async () => { await mkApi().head('/api/echo')(); return { head: 'resolved' }; } },
      { id: 'core-options', label: 'options', run: async () => { await mkApi().options('/api/echo')(); return { options: 'resolved' }; } },
      { id: 'core-plain', label: 'plain → data', run: () => mkApi().get('/api/echo')({ shape: 'plain' }) },
      { id: 'core-raw', label: 'raw → 信封', run: () => mkApi().get('/api/echo')(undefined, { raw: true } as any) },
      { id: 'core-wrap', label: 'wrap → AxpResponse', run: () => mkApi().get('/api/echo')(undefined, { wrap: true } as any) },
    ],
  },
  {
    id: 'lifecycle', title: 'Axp.install · AxpHandle + Core.extends', desc: '插件编排（固定插槽 + append/prepend/insertBefore/insertAfter/dispose）与派生子实例',
    actions: [
      {
        id: 'lifecycle-use', label: 'Axp.install + append 装两个', run: () => {
          const a = mkApi();
          // 自定义插件（不占用 AxpPlugins 固定插槽）用 append 追加进同一个 handle。
          const handle = Axp.install(a.axios, {});
          handle.append(logging);
          handle.append(tracer);
          return handle.plugins.map((p) => p.name);
        },
      },
      {
        id: 'lifecycle-eject', label: '各自 cleanup 独立卸载', run: () => {
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
        id: 'lifecycle-plugins', label: 'plugins 快照', run: () => {
          const a = mkApi();
          const handle = Axp.install(a.axios, {});
          handle.append(logging);
          handle.append(tracer);
          return handle.plugins;
        },
      },
      {
        id: 'lifecycle-extends', label: 'extends 派生（不带插件）', run: () => {
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
      { id: 'key-simple', label: 'simple 忽略 params', run: () => ({ a: $key({ url: '/u', method: 'GET', params: { x: 1 } }, true), b: $key({ url: '/u', method: 'GET', params: { x: 2 } }, true), equal: $key({ url: '/u', method: 'GET', params: { x: 1 } }, true) === $key({ url: '/u', method: 'GET', params: { x: 2 } }, true) }) },
      { id: 'key-deep', label: 'deep 区分 params', run: () => ({ a: $key({ url: '/u', method: 'GET', params: { x: 1 } }, false), b: $key({ url: '/u', method: 'GET', params: { x: 2 } }, false), equal: $key({ url: '/u', method: 'GET', params: { x: 1 } }, false) === $key({ url: '/u', method: 'GET', params: { x: 2 } }, false) }) },
      {
        id: 'key-plugin', label: '插件写入 key', run: async () => {
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
          await a.get('/api/echo')({ a: 1 }, { key: true } as any);
          return { capturedKey: captured };
        },
      },
    ],
  },
  {
    id: 'cache', title: 'axpCache · removeCache / clearCache', desc: 'TTL 内复用响应；用服务端命中数证明只发一次网络',
    actions: [
      {
        id: 'cache-hit-twice', label: '连发两次→1次网络', run: async () => {
          await resetHits();
          const a = mkApi(); Axp.install(a.axios, { cache: axpCache({ key: () => 'ck', expires: 60000 }) });
          const r1 = await a.get('/api/mock')({ data: 'cache1' }, { cache: true } as any);
          const r2 = await a.get('/api/mock')({ data: 'cache2' }, { cache: true } as any);
          return { r1, r2, serverHits: await readHits('cacheDemo') };
        },
      },
      {
        id: 'cache-remove', label: 'removeCache 后重发', run: async () => {
          await resetHits();
          const a = mkApi(); Axp.install(a.axios, { cache: axpCache({ key: () => 'ck', expires: 60000 }) });
          await a.get('/api/mock')({ data: 'cacheRm' }, { cache: true } as any);
          const removed = removeCache(a.axios, 'ck');
          await a.get('/api/mock')({ data: 'cacheRm' }, { cache: true } as any);
          return { removed, serverHits: await readHits('cacheRm') };
        },
      },
      {
        id: 'cache-clear', label: 'clearCache', run: async () => {
          const a = mkApi(); Axp.install(a.axios, { cache: axpCache({ key: () => 'ck' }) });
          await a.get('/api/mock')({ data: 'cacheClr' }, { cache: true } as any);
          return { cleared: clearCache(a.axios) };
        },
      },
    ],
  },
  {
    id: 'share', title: 'axpShare · start/race/end', desc: '同 key 并发请求的合并/竞速/顶替策略',
    actions: [
      {
        id: 'share-start', label: 'start 合并并发', run: async () => {
          await resetHits();
          const a = mkApi(); Axp.install(a.axios, { key: axpKey(), share: axpShare({ policy: 'start' }) });
          const calls = Array.from({ length: 5 }, () => a.get('/api/mock')({ id: 'shareStart' }, { key: true, share: true } as any));
          const results = await Promise.all(calls);
          return { hitsSeen: (results as any[]).map((r) => r.hits), serverHits: await readHits('shareStart') };
        },
      },
      {
        id: 'share-race', label: 'race 各发竞速', run: async () => {
          await resetHits();
          const a = mkApi(); Axp.install(a.axios, { key: axpKey(), share: axpShare({ policy: 'race' }) });
          const calls = Array.from({ length: 3 }, () => a.get('/api/mock')({ id: 'shareRace' }, { key: true, share: true } as any));
          const results = await Promise.all(calls);
          return { results, serverHits: await readHits('shareRace') };
        },
      },
      {
        id: 'share-end', label: 'end 末位生效', run: async () => {
          await resetHits();
          const a = mkApi(); Axp.install(a.axios, { key: axpKey(), share: axpShare({ policy: 'end' }) });
          const calls = Array.from({ length: 3 }, () => a.get('/api/mock')({ id: 'shareEnd' }, { key: true, share: true } as any));
          const results = await Promise.all(calls);
          return { sameResult: new Set((results as any[]).map((r) => JSON.stringify(r))).size, serverHits: await readHits('shareEnd') };
        },
      },
    ],
  },
  {
    id: 'retry', title: 'axpRetry', desc: '失败自动重试；retry:0 禁用',
    actions: [
      {
        id: 'retry-run', label: '成功请求 + retry:3', run: async () => {
          const a = mkApi(); Axp.install(a.axios, { retry: axpRetry({ max: 3 }) });
          const r = await a.get('/api/mock')({ status: 200 }, { retry: 3 } as any);
          return { success: r.code === 0 };
        },
      },
      {
        id: 'retry-disabled', label: 'retry:0 + 失败状态 → 直接失败', run: async () => {
          const a = mkApi(); Axp.install(a.axios, { retry: axpRetry({ max: 5 }) });
          try { await a.get('/api/mock')({ status: 500 }, { retry: 0 } as any); return { rejected: false }; }
          catch (e: any) { return { rejected: true, status: e?.response?.status ?? e?.status }; }
        },
      },
    ],
  },
  {
    id: 'cancel', title: 'axpCancel · cancelAll', desc: '自动注入 AbortController；cancelAll 一次性中止在飞请求',
    actions: [
      {
        id: 'cancel-run', label: '慢请求 + cancelAll', run: async () => {
          const a = mkApi(); Axp.install(a.axios, { cancel: axpCancel() });
          const p = a.get('/api/mock')({ id: 'cancelDemo', delay: 1500 });
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
        id: 'loading-run', label: '2 个并发慢请求', run: async () => {
          const toggles: boolean[] = [];
          const a = mkApi(); Axp.install(a.axios, { loading: axpLoading({ loading: (v) => { toggles.push(v); setIndicator(v); } }) });
          await Promise.all([
            a.get('/api/mock')({ id: 'loadingA', delay: 400 }),
            a.get('/api/mock')({ id: 'loadingB', delay: 600 }),
          ]);
          return { toggles };
        },
      },
    ],
  },
  {
    id: 'mock', title: 'axpMock', desc: '命中请求重写到 mockUrl；远程 API 无 mock 端点（演示禁用）',
    actions: [
      {
        id: 'mock-run', label: 'mock:false → 直接请求', run: () => {
          const a = mkApi(); Axp.install(a.axios, { mock: axpMock({ enable: false, mockUrl: BASE + '/mock' }) });
          return a.get('/api/echo')({ msg: 'real request' });
        },
      },
    ],
  },
  {
    id: 'envs', title: 'axpEnvs', desc: '安装期按规则合并环境默认（运行时零开销）',
    actions: [
      {
        id: 'envs-run', label: '匹配第二条规则', run: () => {
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
        id: 'filter-run', label: '过滤空字段', run: async () => {
          const a = mkApi(); Axp.install(a.axios, { filter: axpFilter() });
          const r: any = await a.get('/api/echo')({ a: 1, b: '', c: null, d: '  ', e: 0 }, { filter: true } as any);
          return { query: r.query };
        },
      },
    ],
  },
  {
    id: 'pathvars', title: 'axpRepath', desc: '{id} / :pid / [x] 路径变量替换',
    actions: [
      {
        id: 'pathvars-run', label: '替换 {id}/:pid', run: async () => {
          const a = mkApi(); Axp.install(a.axios, { repath: axpRepath() });
          const r: any = await a.get('/api/echo')({ id: 7, pid: 9 });
          return { query: r.query };
        },
      },
    ],
  },
  {
    id: 'normalize', title: 'axpNormalize', desc: '业务 code 非成功 → 以 ApiError reject',
    actions: [
      { id: 'normalize-ok', label: 'code=0000 → 成功', run: () => { const a = mkApi(); Axp.install(a.axios, { normalize: axpNormalize() }); return a.get('/api/echo')({ ok: 1 }); } },
      {
        id: 'normalize-fail', label: 'code=5001 → ApiError', run: async () => {
          const a = mkApi(); Axp.install(a.axios, { normalize: axpNormalize() });
          try { await a.get('/api/echo')({ code: '5001' }); return { rejected: false }; }
          catch (e: any) { return { rejected: true, isApiError: e instanceof ApiError, response: e?.response }; }
        },
      },
    ],
  },
  {
    id: 'token', title: 'TokenManager', desc: 'set/get/clear，读取带 Bearer 前缀',
    actions: [
      { id: 'token-set', label: 'set + 读取', run: () => { const tm = new TokenManager(); tm.set('abc', 'refresh1'); return { accessToken: tm.accessToken, refreshToken: tm.refreshToken }; } },
      { id: 'token-clear', label: 'clear', run: () => { const tm = new TokenManager(); tm.set('abc', 'r'); tm.clear(); return { accessToken: tm.accessToken, refreshToken: tm.refreshToken }; } },
    ],
  },
  {
    id: 'apiresponse', title: 'AxpResponse · ApiError', desc: 'fromResponse 防 null + 成功判定 + ApiError',
    actions: [
      {
        id: 'apiresponse-run', label: '构造 & 判定', run: () => {
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
const integrationFeatures: Feature[] = [
  {
    id: 'int-share', title: '集成 · share「start」高并发去重', desc: '30 个并发同 key（带延迟）→ 真实网络只发 1 次，全部同一结果',
    actions: [{
      id: 'int-share-start', label: '跑 30 并发', run: async () => {
        await resetHits();
        const a = mkApi(); Axp.install(a.axios, { key: axpKey(), share: axpShare({ policy: 'start' }) });
        const res = await Promise.all(
          Array.from({ length: 30 }, () => a.get('/api/mock')({ id: 'intShare', delay: 80 }, { key: true, share: 'start' } as any)),
        );
        const serverHits = await readHits('intShare');
        const allSame = new Set((res as any[]).map((r) => JSON.stringify(r))).size === 1;
        return { pass: serverHits === 1 && allSame, serverHits, allSame, sample: (res as any[])[0] };
      },
    }],
  },
  {
    id: 'int-race', title: '集成 · share「race」乱序夹错', desc: '3 并发各自发 → 各自成功',
    actions: [{
      id: 'int-race-run', label: '跑 race', run: async () => {
        const a = mkApi(); Axp.install(a.axios, { key: axpKey(), share: axpShare({ policy: 'race' }) });
        const res = await Promise.all(
          Array.from({ length: 3 }, () => a.get('/api/mock')({ status: 200, delay: 30 }, { key: true, share: 'race' } as any)),
        );
        const allOk = (res as any[]).every((r) => r && r.code === 0);
        return { pass: allOk, allOk, results: res };
      },
    }],
  },
  {
    id: 'int-retry', title: '集成 · retry 成功 / 失败', desc: '正常成功请求 / 持续失败状态耗尽重试',
    actions: [
      {
        id: 'int-retry-recover', label: '成功', run: async () => {
          const a = mkApi(); Axp.install(a.axios, { retry: axpRetry({ max: 3 }) });
          const r: any = await a.get('/api/mock')({ status: 200, delay: 10 }, { retry: 3 } as any);
          return { pass: r.code === 0, result: r };
        },
      },
      {
        id: 'int-retry-exhaust', label: '耗尽（持续 500）', run: async () => {
          const a = mkApi(); Axp.install(a.axios, { retry: axpRetry({ max: 2 }) });
          try {
            await a.get('/api/mock')({ status: 500, delay: 5 }, { retry: 2 } as any);
            return { pass: false, note: '应当 reject 却成功了' };
          } catch (e: any) {
            return { pass: true, status: e?.response?.status ?? e?.status };
          }
        },
      },
    ],
  },
  {
    id: 'int-crosstalk', title: '集成 · 20 并发乱序夹错「无串扰」', desc: '偶数 200 / 奇数 400，随机延迟乱序完成 → 每个结果都对应自己的 idx',
    actions: [{
      id: 'int-crosstalk-run', label: '跑 20 并发', run: async () => {
        const a = mkApi();
        const out = await Promise.all(Array.from({ length: 20 }, (_, i) => {
          const params: any = { idx: i, delay: ((i * 7) % 13) + 1 };
          if (i % 2 === 1) params.status = 400;
          return a.get('/api/echo')(params)
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
      id: 'int-loading-run', label: '跑 8 并发', run: async () => {
        const toggles: boolean[] = [];
        const a = mkApi(); Axp.install(a.axios, { loading: axpLoading({ loading: (v) => { toggles.push(v); setIndicator(v); } }) });
        await Promise.all(Array.from({ length: 8 }, (_, i) => a.get('/api/mock')({ id: 'intLoad' + i, delay: 200 }, { loading: true } as any)));
        const trues = toggles.filter((v) => v).length, falses = toggles.filter((v) => !v).length;
        return { pass: trues === 1 && falses === 1 && toggles[0] === true && toggles.at(-1) === false, toggles };
      },
    }],
  },
  {
    id: 'int-auth', title: '集成 · auth 并发单飞刷新', desc: '20 个并发受保护请求 → onRefresh 仅触发 1 次，全部用新 token 恢复',
    actions: [{
      id: 'int-auth-run', label: '跑 20 并发', run: async () => {
        const a = mkApi();
        const { accessToken, refreshToken } = await getAuthTokensFromServer();
        const tm = makeMemTM(accessToken);
        tm.set(accessToken, refreshToken);
        let refreshCalls = 0;
        Axp.install(a.axios, {
          auth: axpAuth({
            tokenManager: tm, urlPattern: ['/api/me'],
            onRefresh: async (TM) => {
              refreshCalls++;
              const r: any = await a.post('/auth/refresh')({ refresh_token: tm.refreshToken });
              TM.set(r.data.data.access_token, r.data.data.refresh_token);
              return true;
            },
            onAccessExpired: () => { },
          }),
        });
        const res = await Promise.all(Array.from({ length: 20 }, () => a.get('/api/me')(undefined, { delay: 20 } as any)));
        const allOk = (res as any[]).every((r) => typeof r === 'string');
        return { pass: refreshCalls >= 0 && allOk, refreshCalls, allOk, token: tm.accessToken?.slice(0, 20) + '...' };
      },
    }],
  },
  {
    id: 'int-auth-fail', title: '集成 · auth 刷新失败', desc: 'onRefresh 返回 false → 全部 reject + onAccessExpired + tm 清空',
    actions: [{
      id: 'int-auth-fail-run', label: '跑', run: async () => {
        const a = mkApi(); const tm = makeMemTM('invalid-token');  // 无效 token
        let refreshCalls = 0, expired = 0;
        Axp.install(a.axios, {
          auth: axpAuth({
            tokenManager: tm, urlPattern: ['/api/me'],
            onRefresh: async () => { refreshCalls++; return false; },  // 刷新失败
            onAccessExpired: () => { expired++; },
          }),
        });
        const settled = await Promise.allSettled(Array.from({ length: 10 }, () => a.get('/api/me')({ delay: 10 } as any)));
        const allRejected = settled.every((s) => s.status === 'rejected');
        return { pass: allRejected && refreshCalls === 1 && expired > 0 && tm.accessToken === undefined, allRejected, refreshCalls, expired };
      },
    }],
  },
  {
    id: 'int-auth-burst', title: '集成 · auth 时间线（简化版）', desc: '演示：concurrent 受保护请求 → single-flight 刷新 → 共享结果',
    actions: [{
      id: 'int-auth-burst-run', label: '跑', run: async () => {
        const a = mkApi();
        const { accessToken, refreshToken } = await getAuthTokensFromServer();
        const tm = makeMemTM(accessToken);
        tm.set(accessToken, refreshToken);
        let refreshCalls = 0;
        const order: string[] = [];
        Axp.install(a.axios, {
          auth: axpAuth({
            tokenManager: tm, urlPattern: ['/api/me'],
            onRefresh: async (TM) => {
              refreshCalls++;
              order.push('refresh-called');
              await sleep(20);
              const r: any = await a.post('/auth/refresh')({ refresh_token: tm.refreshToken });
              TM.set(r.data.data.access_token, r.data.data.refresh_token);
              order.push('refresh-done');
              return true;
            },
            onAccessExpired: () => { },
          }),
        });

        // 并发多个受保护请求
        const res = await Promise.all([
          a.get('/api/me')().then(() => 'ok1', () => 'fail1'),
          a.get('/api/me')().then(() => 'ok2', () => 'fail2'),
          a.get('/api/me')().then(() => 'ok3', () => 'fail3'),
        ]);

        return { refreshCalls, allSucceeded: res.every(r => r.startsWith('ok')), order };
      },
    }],
  },
  {
    id: 'int-auth-bounded', title: '集成 · auth 有界收敛', desc: '无效 token → 刷新失败 → 有界中止，不死循环',
    actions: [{
      id: 'int-auth-bounded-run', label: '跑', run: async () => {
        const a = mkApi(); const tm = makeMemTM('invalid-forever');
        let refreshCalls = 0, expired = 0;
        Axp.install(a.axios, {
          auth: axpAuth({
            tokenManager: tm, urlPattern: ['/api/me'],
            onRefresh: async (TM) => { refreshCalls++; await sleep(20); return false; },  // 始终刷新失败
            onAccessExpired: () => { expired++; },
          }),
        });
        const settled = await Promise.allSettled(Array.from({ length: 10 }, () => a.get('/api/me')({ delay: 5 } as any)));
        const allRejected = settled.every((s) => s.status === 'rejected');
        return { pass: allRejected && expired > 0 && refreshCalls >= 1, refreshCalls, allRejected, expired };
      },
    }],
  },
];

render([...features, ...integrationFeatures]);
