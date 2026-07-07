/**
 * e2e 演练场驱动 —— 覆盖 `src/index.ts` 全部公开 API。
 * 每个动作自带新 Core 实例（顺序无关，便于 Playwright 逐项断言）。
 *
 * 覆盖清单（100% 公开导出）：
 *   create / Core(get,post,put,delete,patch,head,options, raw/wrap/plain, use,eject,plugins,extends)
 *   key,$key · cache,removeCache,clearCache · cancel,cancelAll · envs
 *   filter · loading · mock · normalize
 *   repath · retry · share · ApiResponse,ApiError · TokenManager
 */
import axios from 'axios';
import {
  create, Core,
  ApiResponse, ApiError, TokenManager,
  key, $key,
  cache, removeCache, clearCache,
  cancel, cancelAll,
  envs,
  filter,
  loading,
  mock,
  normalize,
  repath,
  retry,
  share,
  auth,
  type Plugin,
  type ITokenManager,
} from '../../src/index.ts';

const BASE = 'http://localhost:4570';
const mkApi = (opts?: any) => create(axios.create({ baseURL: BASE }), opts);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// 无插件的裸 axios，用于重置 / 读取服务端命中计数（断言用）
const raw = axios.create({ baseURL: BASE });
const resetHits = () => raw.post('/api/hits/reset');
const readHits = async (id: string) => (await raw.get('/api/hits', { params: { id } })).data.data.hits as number;

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
    id: 'key', title: 'key · $key', desc: 'simple/deep/object key 生成 + 插件端到端写入 config.key',
    actions: [
      { id: 'key-simple', label: 'simple 忽略 params', run: () => ({ a: $key({ url: '/u', method: 'GET', params: { x: 1 } }, true), b: $key({ url: '/u', method: 'GET', params: { x: 2 } }, true), equal: $key({ url: '/u', method: 'GET', params: { x: 1 } }, true) === $key({ url: '/u', method: 'GET', params: { x: 2 } }, true) }) },
      { id: 'key-deep', label: 'deep 区分 params', run: () => ({ a: $key({ url: '/u', method: 'GET', params: { x: 1 } }, false), b: $key({ url: '/u', method: 'GET', params: { x: 2 } }, false), equal: $key({ url: '/u', method: 'GET', params: { x: 1 } }, false) === $key({ url: '/u', method: 'GET', params: { x: 2 } }, false) }) },
      {
        id: 'key-plugin', label: '插件写入 key', run: async () => {
          const a = mkApi(); let captured: string | undefined;
          a.use({ name: 'capture', install(ctx) { ctx.request((c) => { captured = (c as any).key; return c; }); } });
          a.use(key());
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
          const a = mkApi(); a.use(share({ policy: 'start' })); a.use(key());
          const calls = Array.from({ length: 5 }, () => a.get('/api/hit')({ id: 'shareStart' }, { key: true, share: true } as any));
          const results = await Promise.all(calls);
          return { hitsSeen: (results as any[]).map((r) => r.hits), serverHits: await readHits('shareStart') };
        },
      },
      {
        id: 'share-race', label: 'race 各发竞速', run: async () => {
          await resetHits();
          const a = mkApi(); a.use(share({ policy: 'race' })); a.use(key());
          const calls = Array.from({ length: 3 }, () => a.get('/api/hit')({ id: 'shareRace' }, { key: true, share: true } as any));
          const results = await Promise.all(calls);
          return { results, serverHits: await readHits('shareRace') };
        },
      },
      {
        id: 'share-end', label: 'end 末位生效', run: async () => {
          await resetHits();
          const a = mkApi(); a.use(share({ policy: 'end' })); a.use(key());
          const calls = Array.from({ length: 3 }, () => a.get('/api/hit')({ id: 'shareEnd' }, { key: true, share: true } as any));
          const results = await Promise.all(calls);
          return { sameResult: new Set((results as any[]).map((r) => JSON.stringify(r))).size, serverHits: await readHits('shareEnd') };
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
    id: 'mock', title: 'mock', desc: '命中请求重写到 mockUrl；未命中由 mock server 服务端转发真实上游',
    actions: [
      {
        id: 'mock-run', label: 'mock:true → /mock', run: () => {
          const a = mkApi(); a.use(mock({ enable: true, mockUrl: BASE + '/mock' }));
          return a.get('/api/x')(undefined, { mock: true } as any);
        },
      },
      {
        id: 'mock-fallback', label: 'mock 未命中 → mock server 转发真实(服务端)', run: () => {
          // mockUrl 指向网关 /gw：插件只负责重写 URL，mock 未命中时由「mock server」转发真实上游
          // （区别于 axios 客户端回落）。echo 回显里带 _gw=1 即证明经服务端转发。
          const a = mkApi(); a.use(mock({ enable: true, mockUrl: BASE + '/gw' }));
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
    id: 'filter', title: 'filter', desc: '剥离 params/data 中的空字段',
    actions: [
      {
        id: 'filter-run', label: '过滤空字段', run: async () => {
          const a = mkApi(); a.use(filter());
          const r: any = await a.get('/api/echo')({ a: 1, b: '', c: null, d: '  ', e: 0 }, { filter: true } as any);
          return { query: r.query };
        },
      },
    ],
  },
  {
    id: 'pathvars', title: 'repath', desc: '{id} / :pid / [x] 路径变量替换',
    actions: [
      {
        id: 'pathvars-run', label: '替换 {id}/:pid', run: async () => {
          const a = mkApi(); a.use(repath());
          const r: any = await a.get('/users/{id}/posts/:pid')({ id: 7, pid: 9 });
          return { path: r.path };
        },
      },
    ],
  },
  {
    id: 'normalize', title: 'normalize', desc: '业务 code 非成功 → 以 ApiError reject',
    actions: [
      { id: 'normalize-ok', label: 'code=0000 → 成功', run: () => { const a = mkApi(); a.use(normalize()); return a.get('/api/echo')({ ok: 1 }); } },
      {
        id: 'normalize-fail', label: 'code=5001 → ApiError', run: async () => {
          const a = mkApi(); a.use(normalize());
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

// ─── 集成测试（高并发 / 乱序 / 夹错 / auth 刷新）：每个用例内置 pass 断言 ───────────
const integrationFeatures: Feature[] = [
  {
    id: 'int-share', title: '集成 · share「start」高并发去重', desc: '30 个并发同 key（带延迟）→ 真实网络只发 1 次，全部同一结果',
    actions: [{
      id: 'int-share-start', label: '跑 30 并发', run: async () => {
        await resetHits();
        const a = mkApi(); a.use([key(), share({ policy: 'start' })]);
        const res = await Promise.all(
          Array.from({ length: 30 }, () => a.get('/api/hit')({ id: 'intShare', delay: 80 }, { key: true, share: 'start' } as any)),
        );
        const serverHits = await readHits('intShare');
        const allSame = new Set((res as any[]).map((r) => JSON.stringify(r))).size === 1;
        return { pass: serverHits === 1 && allSame, serverHits, allSame, sample: (res as any[])[0] };
      },
    }],
  },
  {
    id: 'int-race', title: '集成 · share「race」乱序夹错', desc: '3 并发各自发；前两次 500、第三次成功 → 全部拿到成功',
    actions: [{
      id: 'int-race-run', label: '跑 race', run: async () => {
        await resetHits();
        const a = mkApi(); a.use([key(), share({ policy: 'race' })]);
        const res = await Promise.all(
          Array.from({ length: 3 }, () => a.get('/api/hit')({ id: 'intRace', fail: 2, delay: 30 }, { key: true, share: 'race' } as any)),
        );
        const serverHits = await readHits('intRace');
        const allWin = (res as any[]).every((r) => r && r.id === 'intRace');
        return { pass: serverHits === 3 && allWin, serverHits, results: res };
      },
    }],
  },
  {
    id: 'int-retry', title: '集成 · retry 恢复 / 耗尽', desc: 'fail=2+retry:3 自动恢复；强制 500 时耗尽后 reject（验证无限重试 bug 已修）',
    actions: [
      {
        id: 'int-retry-recover', label: '恢复', run: async () => {
          await resetHits();
          const a = mkApi(); a.use(retry({ max: 3 }));
          const r: any = await a.get('/api/hit')({ id: 'intRetryOK', fail: 2, delay: 10 }, { retry: 3 } as any);
          const serverHits = await readHits('intRetryOK');
          return { pass: serverHits === 3 && r.hits === 3, serverHits, result: r };
        },
      },
      {
        id: 'int-retry-exhaust', label: '耗尽（强制 500）', run: async () => {
          await resetHits();
          const a = mkApi(); a.use(retry({ max: 2 }));
          try {
            await a.get('/api/hit')({ id: 'intRetryFail', status: 500, delay: 5 }, { retry: 2 } as any);
            return { pass: false, note: '应当 reject 却成功了' };
          } catch (e: any) {
            const serverHits = await readHits('intRetryFail');
            return { pass: serverHits === 3, serverHits, status: e?.response?.status ?? e?.status };  // 首发+2重试=3，且不无限循环
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
        const a = mkApi(); a.use(loading({ loading: (v) => { toggles.push(v); setIndicator(v); } }));
        await Promise.all(Array.from({ length: 8 }, (_, i) => a.get('/api/hit')({ id: 'intLoad' + i, delay: 200 }, { loading: true } as any)));
        const trues = toggles.filter((v) => v).length, falses = toggles.filter((v) => !v).length;
        return { pass: trues === 1 && falses === 1 && toggles[0] === true && toggles.at(-1) === false, toggles };
      },
    }],
  },
  {
    id: 'int-auth', title: '集成 · auth 并发单飞刷新', desc: '20 个并发受保护请求（持过期 token）→ onRefresh 仅触发 1 次，全部用新 token 恢复',
    actions: [{
      id: 'int-auth-run', label: '跑 20 并发', run: async () => {
        await resetHits();
        const a = mkApi(); const tm = makeMemTM('stale-token');  // 过期 token
        let refreshCalls = 0;
        a.use(auth({
          tokenManager: tm, urlPattern: ['/api/secure'],
          onRefresh: async (TM) => { refreshCalls++; const r: any = await a.post('/api/refresh')(undefined, { protected: false } as any); TM.set(r.token); return true; },
          onAccessExpired: () => { },
        }));
        const res = await Promise.all(Array.from({ length: 20 }, () => a.get('/api/secure')({ id: 'intAuth', delay: 20 } as any)));
        const allOk = (res as any[]).every((r) => r.user === 'u');
        return { pass: refreshCalls === 1 && allOk, refreshCalls, allOk, secureHits: await readHits('intAuth'), token: tm.accessToken };
      },
    }],
  },
  {
    id: 'int-auth-fail', title: '集成 · auth 刷新失败', desc: 'onRefresh 返回 false → 全部 reject + onAccessExpired + tm 清空',
    actions: [{
      id: 'int-auth-fail-run', label: '跑', run: async () => {
        await resetHits();
        const a = mkApi(); const tm = makeMemTM('stale-token');
        let refreshCalls = 0, expired = 0;
        a.use(auth({
          tokenManager: tm, urlPattern: ['/api/secure'],
          onRefresh: async () => { refreshCalls++; return false; },
          onAccessExpired: () => { expired++; },
        }));
        const settled = await Promise.allSettled(Array.from({ length: 10 }, () => a.get('/api/secure')({ id: 'intAuthFail', delay: 10 } as any)));
        const allRejected = settled.every((s) => s.status === 'rejected');
        return { pass: allRejected && refreshCalls === 1 && expired > 0 && tm.accessToken === undefined, allRejected, refreshCalls, expired, token: tm.accessToken };
      },
    }],
  },
  {
    id: 'int-auth-burst', title: '集成 · auth 时间线（a/b/c/d/e：慢成功 / 慢失败 / 刷新中新发起）', desc: '“慢”=响应在刷新成功之后才回来。trigger 触发刷新；刷新中发起 during1/2(请求侧挂起)；slowOK/slowFail 的 401 都晚于刷新完成才回来→走重放(token 不一致)，一个成功一个仍失败→过期。看每项 @ms 与 refreshDoneAt 对比',
    actions: [{
      id: 'int-auth-burst-run', label: '跑', run: async () => {
        await resetHits();
        const a = mkApi(); const tm = makeMemTM('stale');
        let refreshCalls = 0, refreshDoneAt = 0;
        const t0 = performance.now();
        const order: string[] = [];
        a.use(auth({
          tokenManager: tm, urlPattern: ['/api/secure', '/api/secure-dead'],
          onRefresh: async (TM) => {
            refreshCalls++;
            await sleep(50);                                                  // 刷新窗口
            const r: any = await a.post('/api/refresh')(undefined, { protected: false } as any);
            TM.set(r.token);
            refreshDoneAt = Math.round(performance.now() - t0);               // 标记刷新完成时刻
            return true;
          },
          onAccessExpired: () => { },
        }));
        const tag = (name: string, p: Promise<any>) => {
          const stamp = (ok: boolean, extra: any = {}) => {
            const at = Math.round(performance.now() - t0);
            order.push(`${ok ? '✓' : '✗'}${name}@${at}ms`);
            return { name, ok, at, ...extra };
          };
          return p.then(() => stamp(true), (e: any) => stamp(false, { status: e?.response?.status ?? e?.status }));
        };

        // 阶段1（刷新前发起）：trigger 触发刷新；slowOK/slowFail 给大延迟 → 它们的 401 在刷新完成之后才回来
        const trigger = tag('trigger', a.get('/api/secure')({ id: 'a', delay: 5 } as any));        // 401→触发刷新→重放→成功
        const slowOK = tag('slowOK', a.get('/api/secure')({ id: 'sok', delay: 130 } as any));      // 慢成功：401 晚到→token 不一致→重放→200
        const slowFail = tag('slowFail', a.get('/api/secure-dead')({ id: 'sf', delay: 130 } as any)); // 慢失败：401 晚到→重放→仍 401→过期
        // 阶段2（刷新进行中发起）：受保护 during1/2 被请求侧挂起，刷新成功后带新 token 才发出；
        // 非鉴权 pubDuring 同期发起但不挂起、直接放行（应早于 refreshDoneAt 返回）
        const during = sleep(25).then(() => Promise.all([
          tag('during1', a.get('/api/secure')({ id: 'd', delay: 10 } as any)),
          tag('during2', a.get('/api/secure')({ id: 'e', delay: 10 } as any)),
        ]));
        const pubDuring = sleep(30).then(() => tag('pubDuring', a.get('/api/echo')({ k: 1, delay: 5 }, { protected: false } as any)));

        const flat = await Promise.all([trigger, slowOK, slowFail, during, pubDuring]);
        const res = [flat[0], flat[1], flat[2], ...(flat[3] as any[]), flat[4]];
        const at = (n: string) => res.find((r) => r.name === n)!.at;
        const ok = res.filter((r) => r.ok).map((r) => r.name).sort();
        const failed = res.filter((r) => !r.ok).map((r) => r.name).sort();
        const sameSet = (x: string[], y: string[]) => JSON.stringify(x) === JSON.stringify([...y].sort());
        const pass = refreshCalls === 1                                          // 单飞刷一次；晚到的 401 走重放不再刷新
          && sameSet(ok, ['trigger', 'slowOK', 'during1', 'during2', 'pubDuring'])// 慢成功 + 刷新中挂起的 + 触发者 + 非鉴权 都成功
          && sameSet(failed, ['slowFail'])                                       // 慢失败：重放后仍 401 → 过期
          && at('slowOK') > refreshDoneAt && at('slowFail') > refreshDoneAt      // “慢”=响应晚于刷新完成
          && at('pubDuring') < refreshDoneAt;                                    // 非鉴权在刷新中不被挂起、提前返回
        return { pass, refreshCalls, refreshDoneAt, ok, failed, completionOrder: order };
      },
    }],
  },
  {
    id: 'int-auth-bounded', title: '集成 · auth 极端有界收敛（带当前 token 的 401）', desc: '刷新后 token 仍被拒(always 401) → 每请求至多「刷一次 + 重放一次」后过期；有界、不死循环（refreshCalls≤请求数；浏览器并发连接上限会让它>1，单飞由其它卡演示）',
    actions: [{
      id: 'int-auth-bounded-run', label: '跑', run: async () => {
        await resetHits();
        const a = mkApi(); const tm = makeMemTM('srv-token');  // 已持「当前」token（carried===cur 场景）
        let refreshCalls = 0, expired = 0;
        a.use(auth({
          tokenManager: tm, urlPattern: ['/api/secure-dead'],
          onRefresh: async (TM) => { refreshCalls++; await sleep(40); const r: any = await a.post('/api/refresh')(undefined, { protected: false } as any); TM.set(r.token); return true; },
          onAccessExpired: () => { expired++; },
        }));
        const settled = await Promise.allSettled(Array.from({ length: 10 }, () => a.get('/api/secure-dead')({ id: 'dead', delay: 10 } as any)));
        const allRejected = settled.every((s) => s.status === 'rejected');
        // 有界收敛：每请求至多一次刷新（refreshCalls≤10），全部干净过期，绝不无限循环
        return { pass: allRejected && expired === 10 && refreshCalls >= 1 && refreshCalls <= 10, refreshCalls, allRejected, expired };
      },
    }],
  },
];

render([...features, ...integrationFeatures]);
