import type { Plugin, PluginCleanup } from './types';
import type { AxiosInstance } from 'axios';
import { create } from './core';

/**
 * 以规范化、经人工验证过的顺序一次性装配 axp 插件集——对应 dioman 的 `Dioman.install`。传入你想要的插件（已用各自工厂函数构造好）；省略的插件会被跳过。插件彼此独立——`Axp.install` 只是按顺序调用每个选中插件的 `install(axios)` 并收集返回的 `PluginCleanup`，没有共享编排器代为跟踪拦截器 id；每个插件像 dioman 的 `DiomanPlugin` 一样管理自己的 teardown。
 *
 * 顺序仍是硬性约束：axios 把 request/response 拦截器分成 LIFO/FIFO（见 README "顺序语义"），所以 `install()` 调用顺序不是简单地"按想要的执行顺序列出"——有些插件必须按与预期执行顺序*相反*的顺序安装。`Axp.install` 把数组硬编码好，调用方无需自己推理：
 *
 *   - **`logger` 永远最先**——它没有拦截器，只在安装时同步设置 `axios.defaults.debug`/`.logger`，让其他插件安装期的日志已能读到这个开关。
 *   - **Request**（LIFO）：安装 `[auth, key, filter, repath, cancel]` 执行顺序为 `cancel → repath → filter → key → auth`。`repath` 先替换路径变量；`filter` 要在 `key` 哈希前剔除空字段（顺序装反是最容易犯的错，详见 key.ts/filter.ts）；`auth` 最后注入 token。
 *   - **Response**（FIFO）：安装 `[auth, retry, cancel, notify, normalize]` 即按此顺序执行。`auth` 早于 `retry` 看到 401，刷新+重放先于 `retry` 消耗次数；`cancel` 排在 `retry` 之后：retry 等待/重发期间 controller 仍在追踪中，`cancelAll` 能中止它，等重试最终落定才释放；`notify` 在 `normalize` 前运行，汇报原始 HTTP 结果而非已 reject 的 `ApiError`；`normalize` 最后评判最终响应。
 *   - **Adapter 组合**（后装的包在最外层）：`[cache, share, mock, loading]`——`mock` 包住 `cache`/`share`，让自己的探测与 fallback dispatch 仍经过它们；`loading` 包住一切，每个逻辑操作只触发一对 show/hide。
 *
 * `envs` 同样没有拦截器，位置除了要在 `logger` 之后都无关紧要。
 *
 * One-call wiring for the axp plugin set in a canonical, hand-verified order — mirrors dioman's `Dioman.install`. Pass the plugins you want (already constructed via their factories); omitted ones are skipped. Plugins are independent — `Axp.install` just calls each selected plugin's `install(axios)` in order and collects the returned `PluginCleanup`; there's no shared orchestrator tracking interceptor ids, each plugin manages its own teardown like dioman's `DiomanPlugin`.
 *
 * Order is still a hard constraint: axios splits request/response interceptors into LIFO/FIFO (see README "顺序语义"), so the `install()` call order isn't just "list them in the order you want them to run" — some pairs must be installed *backwards* from their intended execution order. `Axp.install` hard-codes the array so callers never have to reason about this:
 *
 *   - **`logger` always first** — no interceptors, just sets `axios.defaults.debug`/`.logger` synchronously so other plugins' install-time logs can already see it.
 *   - **Request** (LIFO): installing `[auth, key, filter, repath, cancel]` executes as `cancel → repath → filter → key → auth`. `repath` substitutes path vars first; `filter` strips empty fields before `key` hashes them (getting this pair backwards is the easiest mistake, see key.ts/filter.ts); `auth` injects the token last.
 *   - **Response** (FIFO): installing `[auth, retry, cancel, notify, normalize]` executes in that order. `auth` sees a 401 before `retry`, so refresh+replay happens before `retry` burns attempts; `cancel` sits after `retry` so the controller stays tracked while retry waits/resends — `cancelAll` can still abort it, and it is only released once the retry settles; `notify` runs before `normalize` so it reports the raw HTTP outcome, not `normalize`'s already-rejected `ApiError`; `normalize` judges the truly final response last.
 *   - **Adapter composition** (last-installed wraps outermost): `[cache, share, mock, loading]` — `mock` wraps `cache`/`share` so its own probe/fallback dispatches still pass through them; `loading` wraps everything so each logical operation fires exactly one show/hide pair.
 *
 * `envs` also has no interceptors; its position is irrelevant besides being after `logger`.
 *
 * @example
 *   const handle = Axp.install(axiosInstance, {
 *     logger: logger({ debug: true }),
 *     key: key(),
 *     cache: cache({ expires: 30_000 }),
 *     auth: auth({ tokenManager: tm, onRefresh, onAccessExpired }),
 *     retry: retry({ max: 2 }),
 *   });
 *   handle.plugin('cache');   // → the Plugin object passed in above
 *   handle.dispose();         // ejects everything Axp.install installed
 */
export const Axp = {
  /**
   * 把 `axios` 实例包装成 `Core<T>`，仅用于拿到带类型的 `.get/.post/...` 分发形状；`Axp.install` 从不要求 `Core`。`T` 可以是任意形状匹配 `MethodSchema`（见 `types.ts`）的 schema，省略则得到无类型客户端。
   *
   * Wraps an `axios` instance into a `Core<T>`, purely for the typed `.get/.post/...` dispatch shapes — `Axp.install` never requires a `Core`. `T` is any schema shaped like `MethodSchema` (see `types.ts`); omit for an untyped client.
   */
  create,

  /**
   * `axios` 是普通的 `AxiosInstance`；Core 在这里只是便利，从不是必需品。
   *
   * `axios` is a plain `AxiosInstance`; Core is convenience here, never a requirement.
   *
   * @param axios 要装配插件的目标 axios 实例 / target axios instance to wire plugins onto
   * @param plugins 本次要装配的插件集合，省略或传 falsy 值即跳过某个插件 / plugins to wire up; omit or pass falsy to skip one
   * @returns `AxpHandle`，用于查询/增删本次装配的插件及整体 `dispose()` / an `AxpHandle` for querying/mutating/disposing this batch
   */
  install(axios: AxiosInstance, plugins: AxpPlugins): AxpHandle {
    const ordered: Array<Plugin | null | undefined | false> = [
      plugins.logger,
      plugins.envs,
      plugins.auth,
      plugins.key,
      plugins.filter,
      plugins.repath,
      plugins.retry,
      plugins.cancel,
      plugins.notify,
      plugins.normalize,
      plugins.cache,
      plugins.share,
      plugins.mock,
      plugins.loading,
    ];
    const list: Plugin[] = ordered.filter((p): p is Plugin => !!p);
    // 与 `list` 下标对齐的 cleanup 表：同一插件对象出现多次也互不覆盖。
    //
    // Cleanups aligned by index with `list`, so the same plugin object appearing more than once never overwrites itself.
    const cleanups: Array<PluginCleanup | void> = [];

    // 按倒序拆卸已装的插件，使包装 adapter 的插件在恢复时正好还原到前一个插件保存的状态，与安装顺序对称。
    //
    // Tears down installed plugins in reverse so an adapter-wrapping plugin's restore unwinds onto whatever its predecessor saved, mirroring install order symmetrically.
    const teardownAll = (): void => {
      for (let i = cleanups.length - 1; i >= 0; i--) cleanups[i]?.();
      cleanups.length = 0;
    };
    // 按 `list` 顺序逐个安装；任一抛错则先倒序拆掉已装的再 rethrow，不留半装状态。
    //
    // Installs in `list` order; if any throws, tears down what's already installed (reversed) before rethrowing, leaving no half-installed state.
    const installAll = (): void => {
      try {
        for (const p of list) cleanups.push(p.install(axios));
      } catch (e) {
        teardownAll();
        throw e;
      }
    };
    const checkAnchor = (anchor: Plugin): number => {
      const idx = list.indexOf(anchor);
      if (idx === -1) {
        throw new Error(`[Axp.install] anchor "${anchor.name}" is not installed on this handle`);
      }
      return idx;
    };
    // 整体拆卸后按新的 `list` 顺序重装，直接操作各插件自己的 install()/cleanup()（不经过 Core.use()/eject()）；原因见文件头部文档。新插件装不上时把它移出 `list`、恢复原集合再 rethrow。
    //
    // Full teardown + reinstall in the new `list` order, operating directly on each plugin's own install()/cleanup() (not via Core.use()/eject()); see the file doc for why. If the new plugin fails to install, it's removed from `list`, the original set is restored, then the error is rethrown.
    const insertAt = (idx: number, p: Plugin): void => {
      teardownAll();
      list.splice(idx, 0, p);
      try {
        installAll();
      } catch (e) {
        list.splice(idx, 1);
        installAll();
        throw e;
      }
    };

    installAll();

    return {
      axios,
      get plugins() { return list.slice(); },
      plugin(name: string): Plugin | undefined {
        return list.find((p) => p.name === name);
      },
      dispose(): void {
        teardownAll();
        list.length = 0;
      },
      prepend(p: Plugin): void {
        insertAt(0, p);
      },
      append(p: Plugin): void {
        // 纯追加不需要重排——普通的 install() 调用，就像 axios 原生只能追加的拦截器注册；装不上则撤销入列再 rethrow。
        //
        // Pure append needs no reordering — a plain install() call, same as axios's own append-only interceptor registration; on failure the plugin is un-listed and the error rethrown.
        list.push(p);
        try {
          cleanups.push(p.install(axios));
        } catch (e) {
          list.pop();
          throw e;
        }
      },
      insertBefore(anchor: Plugin, p: Plugin): void {
        insertAt(checkAnchor(anchor), p);
      },
      insertAfter(anchor: Plugin, p: Plugin): void {
        insertAt(checkAnchor(anchor) + 1, p);
      },
    };
  },
};

/**
 * `Axp.install` 的返回值——本次安装的插件集合，加上查询/拆卸/插入操作，作用范围严格限定在这一批 `install` 装配的插件上。
 *
 * Returned by `Axp.install` — the installed plugins plus lookup/teardown/insertion, scoped to exactly the batch `install` wired up.
 */
export interface AxpHandle {
  /** `install` 被调用时传入的 `AxiosInstance`。 / The `AxiosInstance` `install` was called on. */
  readonly axios: AxiosInstance;
  /** 当前跟踪的插件快照（注册顺序），每次读取是新数组——改动请用 `prepend`/`append`/`insertBefore`/`insertAfter`。
   *
   *  Snapshot of tracked plugins (registration order), a fresh array each read — mutate via `prepend`/`append`/`insertBefore`/`insertAfter`, not this array. */
  readonly plugins: readonly Plugin[];
  /** 按 `.name` 查找被跟踪的插件；插件是工厂函数产出的普通对象而非类实例，故按名称而非类型查找。
   *
   *  Look up a tracked plugin by `.name`; plugins are plain objects from factories, not class instances, so lookup is by name, not type. */
  plugin(name: string): Plugin | undefined;
  /** 按安装顺序反序调用每个被跟踪插件的 cleanup；不影响以其他方式装配的插件。
   *
   *  Calls every tracked plugin's cleanup in reverse install order; doesn't touch plugins wired up outside this handle. */
  dispose(): void;
  /** 把 `p` 加到所有已跟踪插件之前；实现为整体拆卸+按新顺序重装，不影响此 handle 之外的装配。
   *
   *  Adds `p` before every tracked plugin; implemented as a full teardown + reinstall, doesn't affect anything wired up outside this handle. */
  prepend(p: Plugin): void;
  /** 把 `p` 加到所有已跟踪插件之后——普通 install 调用，纯追加无需重排。
   *
   *  Adds `p` after every tracked plugin — a plain install call, no reordering needed. */
  append(p: Plugin): void;
  /** 把 `p` 插入到 `anchor` 之前；`anchor` 不在此 handle 中则抛错。
   *
   *  Inserts `p` immediately before `anchor`; throws if `anchor` isn't tracked by this handle. */
  insertBefore(anchor: Plugin, p: Plugin): void;
  /** 把 `p` 插入到 `anchor` 之后；`anchor` 不在此 handle 中则抛错。
   *
   *  Inserts `p` immediately after `anchor`; throws if `anchor` isn't tracked by this handle. */
  insertAfter(anchor: Plugin, p: Plugin): void;
}

/**
 * `Axp.install` 的具名插槽，每个内置插件一个字段（字段顺序无特殊含义，规范安装顺序在 `install` 实现里）。传入构造好的 `Plugin`；省略或传 falsy 值即跳过。
 *
 * Named slots for `Axp.install`, one per bundled plugin (field order here is arbitrary — canonical order lives in `install`'s implementation). Pass a constructed `Plugin`; omit or pass falsy to skip.
 */
export interface AxpPlugins {
  /** 日志插件插槽。 Logger plugin slot. */
  logger?: Plugin | null | false;
  /** 环境变量插件插槽。 Envs plugin slot. */
  envs?: Plugin | null | false;
  /** 路径变量替换插件插槽。 Path-variable substitution (repath) plugin slot. */
  repath?: Plugin | null | false;
  /** 空字段过滤插件插槽。 Empty-field filtering (filter) plugin slot. */
  filter?: Plugin | null | false;
  /** 请求指纹/哈希键插件插槽。 Request key/hash (key) plugin slot. */
  key?: Plugin | null | false;
  /** 响应缓存插件插槽。 Response cache plugin slot. */
  cache?: Plugin | null | false;
  /** 请求去重/共享插件插槽。 Request dedup/share plugin slot. */
  share?: Plugin | null | false;
  /** Mock/降级插件插槽。 Mock/fallback plugin slot. */
  mock?: Plugin | null | false;
  /** 取消/中断插件插槽。 Cancel plugin slot. */
  cancel?: Plugin | null | false;
  /** 加载态提示插件插槽。 Loading-indicator plugin slot. */
  loading?: Plugin | null | false;
  /** 鉴权/token 刷新插件插槽。 Auth/token-refresh plugin slot. */
  auth?: Plugin | null | false;
  /** 失败重试插件插槽。 Retry plugin slot. */
  retry?: Plugin | null | false;
  /** 通知/提示插件插槽。 Notify plugin slot. */
  notify?: Plugin | null | false;
  /** 响应/错误归一化插件插槽。 Normalize plugin slot. */
  normalize?: Plugin | null | false;
}
