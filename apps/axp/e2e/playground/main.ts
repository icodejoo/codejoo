/**
 * e2e 演练场驱动 —— 覆盖 `src/index.ts` 全部公开 API。
 * 每个动作自带新 Core 实例（顺序无关，便于 Playwright 逐项断言）。
 *
 * 覆盖清单（100% 公开导出）：
 *   create / Core(get,post,put,delete,patch,head,options, raw/wrap/plain, use,eject,plugins,extends)
 *   buildKey,$key · cache,removeCache,clearCache · cancel,cancelAll · envs
 *   filterRequest(=normalizeRequest) · loading · mock · normalizeResponse
 *   replacePathVars · retry · share · ApiResponse,ApiError · TokenManager
 */
import axios from 'axios';
import {
  create, Core,
  ApiResponse, ApiError, TokenManager,
  buildKey, $key,
  cache, removeCache, clearCache,
  cancel, cancelAll,
  envs,
  filterRequest, normalizeRequest,
  loading,
  mock,
  normalizeResponse,
  replacePathVars,
  retry,
  share,
  type Plugin,
} from '../../src/index.ts';

const BASE = 'http://localhost:4570';
const mkApi = (opts?: any) => create(axios.create({ baseURL: BASE }), opts);

// 无插件的裸 axios，用于重置 / 读取服务端命中计数（断言用）
const raw = axios.create({ baseURL: BASE });
const resetHits = () => raw.post('/api/hits/reset');
const readHits = async (id: string) => (await raw.get('/api/hits', { params: { id } })).data.data.hits as number;

function setIndicator(v: boolean) {
  const el = document.querySelector('[data-testid="loading-indicator"]')!;
  el.textContent = v ? 'on' : 'off';
  el.className = 'pill ' + (v ? 'on' : 'off');
}

const logging: Plugin = { name: 'logging', install(ctx) { ctx.request((c) => c); ctx.response((r) => r); } };
const tracer: Plugin = { name: 'tracer', install(ctx) { ctx.request((c) => c); } };

// ─── 渲染框架 ────────────────────────────────────────────────────────────────
type Action = { id: string; label: string; run: () => Promise<unknown> | unknown };
type Feature = { id: string; title: string; desc: string; actions: Action[] };

function stringify(v: unknown): string {
  return JSON.stringify(v, (_k, val) => {
    if (val instanceof ApiResponse) return { __type: 'ApiResponse', ...val };
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
    id: 'core', title: 'Core · verbs + 三种响应形态', desc: 'create() 包装裸 axios；get/post/put/delete/patch/head/options；raw/wrap/解包',
    actions: [
      { id: 'core-get', label: 'get', run: () => mkApi().get('/api/echo')({ q: 1 }) },
      { id: 'core-post', label: 'post', run: () => mkApi().post('/api/echo')({ name: 'x' }) },
      { id: 'core-put', label: 'put', run: () => mkApi().put('/api/echo')({ v: 1 }) },
      { id: 'core-patch', label: 'patch', run: () => mkApi().patch('/api/echo')({ v: 2 }) },
      { id: 'core-delete', label: 'delete', run: () => mkApi().delete('/api/echo')({ del: 1 }) },
      { id: 'core-head', label: 'head', run: async () => { await mkApi().head('/api/echo')(); return { head: 'resolved' }; } },
      { id: 'core-options', label: 'options', run: async () => { await mkApi().options('/api/echo')(); return { options: 'resolved' }; } },
      { id: 'core-plain', label: 'plain → data', run: () => mkApi().get('/api/echo')({ shape: 'plain' }) },
      { id: 'core-raw', label: 'raw → 信封', run: () => mkApi().get('/api/echo')(undefined, { raw: true } as any) },
      { id: 'core-wrap', label: 'wrap → ApiResponse', run: () => mkApi().get('/api/echo')(undefined, { wrap: true } as any) },
    ],
  },
  {
    id: 'lifecycle', title: 'Core · use / eject / plugins / extends', desc: '插件装卸与派生子实例',
    actions: [
      { id: 'lifecycle-use', label: 'use 单个+批量', run: () => { const a = mkApi(); a.use(logging).use([tracer]); return a.plugins(); } },
      { id: 'lifecycle-eject', label: 'eject', run: () => { const a = mkApi(); a.use([logging, tracer]); a.eject('logging'); return a.plugins(); } },
      { id: 'lifecycle-plugins', label: 'plugins() 快照', run: () => { const a = mkApi(); a.use([logging, tracer]); return a.plugins(); } },
      {
        id: 'lifecycle-extends', label: 'extends 派生', run: () => {
          const parent = mkApi(); parent.use(logging);
          const child = parent.extends({ baseURL: BASE }); child.use(tracer);
          return { parent: parent.plugins().map((p) => p.name), child: child.plugins().map((p) => p.name) };
        },
      },
    ],
  },
  {
    id: 'buildkey', title: 'buildKey · $key', desc: 'simple/deep/object key 生成 + 插件端到端写入 config.key',
    actions: [
      { id: 'buildkey-simple', label: 'simple 忽略 params', run: () => ({ a: $key({ url: '/u', method: 'GET', params: { x: 1 } }, true), b: $key({ url: '/u', method: 'GET', params: { x: 2 } }, true), equal: $key({ url: '/u', method: 'GET', params: { x: 1 } }, true) === $key({ url: '/u', method: 'GET', params: { x: 2 } }, true) }) },
      { id: 'buildkey-deep', label: 'deep 区分 params', run: () => ({ a: $key({ url: '/u', method: 'GET', params: { x: 1 } }, false), b: $key({ url: '/u', method: 'GET', params: { x: 2 } }, false), equal: $key({ url: '/u', method: 'GET', params: { x: 1 } }, false) === $key({ url: '/u', method: 'GET', params: { x: 2 } }, false) }) },
      {
        id: 'buildkey-plugin', label: '插件写入 key', run: async () => {
          const a = mkApi(); let captured: string | undefined;
          a.use({ name: 'capture', install(ctx) { ctx.request((c) => { captured = (c as any).key; return c; }); } });
          a.use(buildKey());
          await a.get('/api/echo')({ a: 1 }, { key: true } as any);
          return { capturedKey: captured };
        },
      },
    ],
  },
  {
    id: 'cache', title: 'cache · removeCache / clearCache', desc: 'TTL 内复用响应；用服务端命中数证明只发一次网络',
    actions: [
      {
        id: 'cache-hit-twice', label: '连发两次→1次网络', run: async () => {
          await resetHits();
          const a = mkApi(); a.use(cache({ key: () => 'ck', expires: 60000 }));
          const r1 = await a.get('/api/hit')({ id: 'cacheDemo' }, { cache: true } as any);
          const r2 = await a.get('/api/hit')({ id: 'cacheDemo' }, { cache: true } as any);
          return { r1, r2, serverHits: await readHits('cacheDemo') };
        },
      },
      {
        id: 'cache-remove', label: 'removeCache 后重发', run: async () => {
          await resetHits();
          const a = mkApi(); a.use(cache({ key: () => 'ck', expires: 60000 }));
          await a.get('/api/hit')({ id: 'cacheRm' }, { cache: true } as any);
          const removed = removeCache(a.axios, 'ck');
          await a.get('/api/hit')({ id: 'cacheRm' }, { cache: true } as any);
          return { removed, serverHits: await readHits('cacheRm') };
        },
      },
      {
        id: 'cache-clear', label: 'clearCache', run: async () => {
          const a = mkApi(); a.use(cache({ key: () => 'ck' }));
          await a.get('/api/hit')({ id: 'cacheClr' }, { cache: true } as any);
          return { cleared: clearCache(a.axios) };
        },
      },
    ],
  },
  {
    id: 'share', title: 'share · start/race/end/retry', desc: '同 key 并发请求的合并/竞速/顶替/重试策略',
    actions: [
      {
        id: 'share-start', label: 'start 合并并发', run: async () => {
          await resetHits();
          const a = mkApi(); a.use(share({ policy: 'start' })); a.use(buildKey());
          const calls = Array.from({ length: 5 }, () => a.get('/api/hit')({ id: 'shareStart' }, { key: true, share: true } as any));
          const results = await Promise.all(calls);
          return { hitsSeen: (results as any[]).map((r) => r.hits), serverHits: await readHits('shareStart') };
        },
      },
      {
        id: 'share-race', label: 'race 各发竞速', run: async () => {
          await resetHits();
          const a = mkApi(); a.use(share({ policy: 'race' })); a.use(buildKey());
          const calls = Array.from({ length: 3 }, () => a.get('/api/hit')({ id: 'shareRace' }, { key: true, share: true } as any));
          const results = await Promise.all(calls);
          return { results, serverHits: await readHits('shareRace') };
        },
      },
      {
        id: 'share-end', label: 'end 末位生效', run: async () => {
          await resetHits();
          const a = mkApi(); a.use(share({ policy: 'end' })); a.use(buildKey());
          const calls = Array.from({ length: 3 }, () => a.get('/api/hit')({ id: 'shareEnd' }, { key: true, share: true } as any));
          const results = await Promise.all(calls);
          return { sameResult: new Set((results as any[]).map((r) => JSON.stringify(r))).size, serverHits: await readHits('shareEnd') };
        },
      },
      {
        id: 'share-retry', label: 'retry 共享重试', run: async () => {
          await resetHits();
          const a = mkApi(); a.use(share({ policy: 'retry', retries: 3 })); a.use(buildKey());
          const r = await a.get('/api/hit')({ id: 'shareRetry', fail: 2 }, { key: true, share: 'retry' } as any);
          return { result: r, serverHits: await readHits('shareRetry') };
        },
      },
    ],
  },
  {
    id: 'retry', title: 'retry', desc: '失败重试到成功；retry:0 禁用',
    actions: [
      {
        id: 'retry-run', label: 'fail=2 + retry:3 → 成功', run: async () => {
          await resetHits();
          const a = mkApi(); a.use(retry({ max: 3 }));
          const r = await a.get('/api/hit')({ id: 'retryDemo', fail: 2 }, { retry: 3 } as any);
          return { result: r, serverHits: await readHits('retryDemo') };
        },
      },
      {
        id: 'retry-disabled', label: 'retry:0 → 直接失败', run: async () => {
          await resetHits();
          const a = mkApi(); a.use(retry({ max: 5 }));
          try { await a.get('/api/hit')({ id: 'retryOff', fail: 1 }, { retry: 0 } as any); return { rejected: false }; }
          catch (e: any) { return { rejected: true, status: e?.response?.status ?? e?.status, serverHits: await readHits('retryOff') }; }
        },
      },
    ],
  },
  {
    id: 'cancel', title: 'cancel · cancelAll', desc: '自动注入 AbortController；cancelAll 一次性中止在飞请求',
    actions: [
      {
        id: 'cancel-run', label: '慢请求 + cancelAll', run: async () => {
          const a = mkApi(); a.use(cancel());
          const p = a.get('/api/hit')({ id: 'cancelDemo', delay: 1500 });
          setTimeout(() => cancelAll(a.axios, 'user navigated away'), 100);
          try { await p; return { canceled: false }; }
          catch (e: any) { return { canceled: axios.isCancel(e), name: e?.name, code: e?.code }; }
        },
      },
    ],
  },
  {
    id: 'loading', title: 'loading', desc: '全局请求计数：0→1 触发 true，1→0 触发 false（看顶部指示器）',
    actions: [
      {
        id: 'loading-run', label: '2 个并发慢请求', run: async () => {
          const toggles: boolean[] = [];
          const a = mkApi(); a.use(loading({ loading: (v) => { toggles.push(v); setIndicator(v); } }));
          await Promise.all([
            a.get('/api/hit')({ id: 'loadingA', delay: 400 }),
            a.get('/api/hit')({ id: 'loadingB', delay: 600 }),
          ]);
          return { toggles };
        },
      },
    ],
  },
  {
    id: 'mock', title: 'mock', desc: '把命中请求重写到 mockUrl',
    actions: [
      {
        id: 'mock-run', label: 'mock:true → /mock', run: () => {
          const a = mkApi(); a.use(mock({ enable: true, mockUrl: BASE + '/mock' }));
          return a.get('/api/x')(undefined, { mock: true } as any);
        },
      },
      {
        id: 'mock-fallback', label: 'mock 不存在 → 回落真实(默认)', run: () => {
          const a = mkApi(); a.use(mock({ enable: true, mockUrl: BASE + '/mock-404' }));
          return a.get('/api/echo')({ via: 'fallback' }, { mock: true } as any);
        },
      },
    ],
  },
  {
    id: 'envs', title: 'envs', desc: '安装期按规则合并环境默认（运行时零开销）',
    actions: [
      {
        id: 'envs-run', label: '匹配第二条规则', run: () => {
          const a = mkApi();
          a.use(envs([
            { rule: () => false, config: { baseURL: 'http://never' } },
            { rule: () => true, config: { headers: { 'X-Env': 'prod' } as any } },
          ]));
          return { baseURL: a.axios.defaults.baseURL, xEnv: (a.axios.defaults.headers as any)['X-Env'] };
        },
      },
    ],
  },
  {
    id: 'filter', title: 'filterRequest (= normalizeRequest)', desc: '剥离 params/data 中的空字段',
    actions: [
      {
        id: 'filter-run', label: '过滤空字段', run: async () => {
          const a = mkApi(); a.use(filterRequest());
          const r: any = await a.get('/api/echo')({ a: 1, b: '', c: null, d: '  ', e: 0 }, { filter: true } as any);
          return { aliasIsSame: filterRequest === normalizeRequest, query: r.query };
        },
      },
    ],
  },
  {
    id: 'pathvars', title: 'replacePathVars', desc: '{id} / :pid / [x] 路径变量替换',
    actions: [
      {
        id: 'pathvars-run', label: '替换 {id}/:pid', run: async () => {
          const a = mkApi(); a.use(replacePathVars());
          const r: any = await a.get('/users/{id}/posts/:pid')({ id: 7, pid: 9 });
          return { path: r.path };
        },
      },
    ],
  },
  {
    id: 'normalize', title: 'normalizeResponse', desc: '业务 code 非成功 → 以 ApiError reject',
    actions: [
      { id: 'normalize-ok', label: 'code=0000 → 成功', run: () => { const a = mkApi(); a.use(normalizeResponse()); return a.get('/api/echo')({ ok: 1 }); } },
      {
        id: 'normalize-fail', label: 'code=5001 → ApiError', run: async () => {
          const a = mkApi(); a.use(normalizeResponse());
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
    id: 'apiresponse', title: 'ApiResponse · ApiError', desc: 'fromResponse 防 null + 成功判定 + ApiError',
    actions: [
      {
        id: 'apiresponse-run', label: '构造 & 判定', run: () => {
          const ok = ApiResponse.fromResponse({ status: 200, data: { code: '0000', message: 'ok', data: { x: 1 } } });
          const nullBody = ApiResponse.fromResponse({ status: 204, data: null }); // 旧实现在此崩溃
          const err = new ApiError(ApiResponse.fromResponse({ status: 500, data: { code: '5001', message: 'boom' } }));
          return { okSuccessful: ok.successful, nullSuccessful: nullBody.successful, errIsError: err instanceof Error, errMsg: err.message, isCoreCtor: typeof Core === 'function' };
        },
      },
    ],
  },
];

render(features);
