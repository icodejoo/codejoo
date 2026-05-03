import axios from "axios";
import type { AxiosAdapter, AxiosInstance } from "axios";
import { asArray } from "../helper";
import type {
  InternalRecord,
  Plugin,
  PluginLogger,
  PluginRecord,
} from "./types";

/* ── plugin-manager-private logger machinery (was in helper.ts) ─────────── */

/** Project-wide log namespace used for tagging. */
const NS = "[http-plugins]";

/** No-op logger — used when `Core` is constructed without `debug: true`. */
const NOOP_LOGGER: PluginLogger = {
  log: () => {},
  warn: () => {},
  error: () => {},
};

/** Default logger sink — wraps `console.*`. */
const CONSOLE_LOGGER: PluginLogger = {
  log: console.log.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
};

/* Browser DevTools support `%c` CSS substitution; Node terminals support ANSI
 * SGR codes. Detect once at module load and pick the right path. */
const IS_BROWSER =
  typeof globalThis !== "undefined" &&
  typeof (globalThis as { document?: unknown }).document !== "undefined";

const BROWSER_TAG_STYLE =
  "background:#2563eb;color:#fff;padding:1px 6px;border-radius:3px;font-weight:600";
const BROWSER_RESET_STYLE = "";

const ANSI_TAG = "\x1b[44;97m";
const ANSI_RESET = "\x1b[0m";

/** Decorate a logger so every line is prefixed with `tag` rendered in
 *  blue-background / white-foreground. Falls back gracefully on sinks that
 *  don't understand `%c` or ANSI — the tag still reads cleanly. */
function tagged(base: PluginLogger, tag: string): PluginLogger {
  if (IS_BROWSER) {
    const fmt = `%c${tag}%c`;
    return {
      log: (...a) =>
        base.log(fmt, BROWSER_TAG_STYLE, BROWSER_RESET_STYLE, ...a),
      warn: (...a) =>
        base.warn(fmt, BROWSER_TAG_STYLE, BROWSER_RESET_STYLE, ...a),
      error: (...a) =>
        base.error(fmt, BROWSER_TAG_STYLE, BROWSER_RESET_STYLE, ...a),
    };
  }
  const colored = `${ANSI_TAG}${tag}${ANSI_RESET}`;
  return {
    log: (...a) => base.log(colored, ...a),
    warn: (...a) => base.warn(colored, ...a),
    error: (...a) => base.error(colored, ...a),
  };
}

/**
 * Plugin lifecycle manager.
 *
 *   Each plugin is expected to do one thing. Ordering is the caller's
 *   responsibility — `use()` invocation order determines axios registration
 *   order, and from there axios's native semantics take over:
 *     • request interceptors run LIFO  (last `use`d runs first on request)
 *     • response interceptors run FIFO (first `use`d runs first on response)
 *     • transformRequest / transformResponse run in append order
 *     • adapter — last `use`d wins
 */
export class PluginManager {
  #axios: AxiosInstance;
  #debug: boolean;
  #userLogger?: PluginLogger;
  #rootLogger: PluginLogger;
  /* Always-on channel for warnings the developer must see (e.g. duplicate
   * `use()`), independent of the `debug` flag. */
  #warnLogger: PluginLogger;
  #plugins: Plugin[] = [];
  #records = new Map<string, InternalRecord>();

  constructor(
    instance: AxiosInstance,
    options: { debug?: boolean; logger?: PluginLogger } = {},
  ) {
    this.#axios = instance;
    // 归一化 adapter：axios 1.x 允许 defaults.adapter 是 string / string[] / function / undefined，
    // 这里统一解析成 AxiosAdapter，之后所有插件读 ctx.axios.defaults.adapter 都是函数，
    // 不再需要每个插件各自处理 getAdapter 的兼容代码。
    if (typeof instance.defaults.adapter !== "function") {
      instance.defaults.adapter = axios.getAdapter(
        instance.defaults.adapter ?? ["xhr", "http", "fetch"],
      );
    }
    this.#debug = !!options.debug;
    this.#userLogger = options.logger;
    this.#rootLogger = this.#debug
      ? tagged(options.logger ?? CONSOLE_LOGGER, NS)
      : NOOP_LOGGER;
    this.#warnLogger = tagged(options.logger ?? CONSOLE_LOGGER, NS);
  }

  /** Install one plugin. Single-plugin convenience wrapper around `useMany`. */
  use(plugin: Plugin): this {
    return this.useMany([plugin]);
  }

  /** Install many plugins atomically — every plugin is queued before any
   *  install runs, and there is exactly one `#refresh` cycle covering the
   *  whole batch. Duplicates (already installed, or repeated in the batch
   *  itself) are warned about and skipped; the rest still install.
   *
   *  **依赖检查下放给插件自己** —— 之前的"normalize 必须最先 use"全局强约束已删除，
   *  改成各依赖插件在 `install(ctx)` 阶段调 `requirePlugin(ctx, 'normalize')`，
   *  谁需要谁声明，PluginManager 不再做特例。
   *
   *  Why one refresh: each `#refresh` tears down + reinstalls every plugin,
   *  so calling `use` N times in a row is O(N²) installs. Batching keeps it
   *  O(N) and also gives a consistent failure profile — partial batch state
   *  never leaks past the call. */
  useMany(plugins: Plugin[]): this {
    let added = 0;

    for (const plugin of plugins) {
      if (this.#plugins.some((p) => p.name === plugin.name)) {
        this.#warnLogger.warn(
          `plugin "${plugin.name}" is already installed; duplicate use() ignored`,
        );
        continue;
      }

      this.#plugins.push(plugin);
      added++;
    }
    if (added > 0) this.#refresh();

    return this;
  }

  eject(name: string): void {
    if (!this.#records.has(name)) return;
    this.#plugins = this.#plugins.filter((p) => p.name !== name);
    this.#refresh();
  }

  snapshot(): readonly PluginRecord[] {
    return Array.from(this.#records.values()).map((r) => this.#snapshotOf(r));
  }

  /** Live plugin references in install order. Used by `Core.extends` to
   *  re-install the same plugin set on a derived axios instance. Returned as
   *  `readonly` to discourage mutation through this handle. */
  get plugins(): readonly Plugin[] {
    return this.#plugins;
  }

  #snapshotOf(r: InternalRecord): PluginRecord {
    return {
      name: r.plugin.name,
      requestInterceptors: r.reqIds.length,
      responseInterceptors: r.resIds.length,
      transformRequests: r.addedReqTransforms.length,
      transformResponses: r.addedResTransforms.length,
      adapterReplaced: r.adapterReplaced,
      cleanups: r.userCleanups.length + (r.pluginCleanup ? 1 : 0),
    };
  }

  #refresh(): void {
    /* Reverse-order teardown so each adapter restore unwinds onto the
     * adapter the predecessor saved. */
    const records = Array.from(this.#records.values()).reverse();

    for (const r of records) {
      this.#teardown(r);
      this.#rootLogger.log(`eject "${r.plugin.name}"`);
    }
    this.#records.clear();

    let installError: unknown;
    for (const plugin of this.#plugins) {
      const record = this.#createRecord(plugin);
      this.#records.set(plugin.name, record);
      this.#rootLogger.log(`use "${plugin.name}"`);
      try {
        const cleanup = plugin.install(record.ctx);
        if (cleanup) record.pluginCleanup = cleanup;
      } catch (err) {
        this.#rootLogger.error(`install "${plugin.name}" failed`, err);
        this.#teardown(record);
        this.#records.delete(plugin.name);
        this.#plugins = this.#plugins.filter((p) => p.name !== plugin.name);
        installError = err;
        break;
      }
    }

    if (installError !== undefined) throw installError;
  }

  #loggerFor(pluginName: string): PluginLogger {
    return this.#debug
      ? tagged(this.#userLogger ?? CONSOLE_LOGGER, `${NS} [${pluginName}]`)
      : NOOP_LOGGER;
  }

  #createRecord(plugin: Plugin): InternalRecord {
    const ax = this.#axios;
    const logger = this.#loggerFor(plugin.name);
    const manager = this;

    const record: InternalRecord = {
      plugin,
      ctx: undefined as never,
      reqIds: [],
      resIds: [],
      addedReqTransforms: [],
      addedResTransforms: [],
      adapterReplaced: false,
      savedAdapter: undefined,
      userCleanups: [],
      pluginCleanup: undefined,
    };

    record.ctx = {
      axios: ax,
      name: plugin.name,
      logger,

      // 当前快照 —— 由于 #refresh 顺序安装，install 时只能看见"我之前的兄弟"
      plugins: () => Array.from(manager.#records.keys()),

      request(onF, onR, options) {
        const id = ax.interceptors.request.use(
          onF as never,
          onR as never,
          options,
        );
        record.reqIds.push(id);
        logger.log(`request interceptor #${id} +`);
      },

      response(onF, onR) {
        const id = ax.interceptors.response.use(onF as never, onR as never);
        record.resIds.push(id);
        logger.log(`response interceptor #${id} +`);
      },

      adapter(a) {
        if (!record.adapterReplaced) {
          record.savedAdapter = ax.defaults.adapter as AxiosAdapter | undefined;
          record.adapterReplaced = true;
        }
        ax.defaults.adapter = a;
        logger.log("adapter replaced");
      },

      transformRequest(...fns) {
        const arr = asArray(ax.defaults.transformRequest);
        arr.push(...fns);
        record.addedReqTransforms.push(...fns);
        ax.defaults.transformRequest = arr;
        logger.log(`+${fns.length} transformRequest`);
      },

      transformResponse(...fns) {
        const arr = asArray(ax.defaults.transformResponse);
        arr.push(...fns);
        record.addedResTransforms.push(...fns);
        ax.defaults.transformResponse = arr;
        logger.log(`+${fns.length} transformResponse`);
      },

      cleanup(fn) {
        record.userCleanups.push(fn);
      },
    };

    return record;
  }

  #teardown(r: InternalRecord): void {
    const ax = this.#axios;
    const logger = this.#loggerFor(r.plugin.name);

    /* Cleanups before interceptor removal — they may need axios still wired. */
    if (r.pluginCleanup) {
      try {
        r.pluginCleanup();
      } catch (e) {
        logger.error("cleanup of plugin threw", e);
      }
    }
    for (const fn of r.userCleanups) {
      try {
        fn();
      } catch (e) {
        logger.error("cleanup callback threw", e);
      }
    }

    for (const id of r.reqIds) ax.interceptors.request.eject(id);
    for (const id of r.resIds) ax.interceptors.response.eject(id);
    if (r.reqIds.length) logger.log(`-${r.reqIds.length} request interceptor`);
    if (r.resIds.length) logger.log(`-${r.resIds.length} response interceptor`);

    if (r.adapterReplaced) {
      ax.defaults.adapter = r.savedAdapter;
      logger.log("adapter restored");
    }

    if (r.addedReqTransforms.length) {
      const arr = asArray(ax.defaults.transformRequest);
      for (const fn of r.addedReqTransforms) {
        const idx = arr.indexOf(fn);
        if (idx >= 0) arr.splice(idx, 1);
      }
      ax.defaults.transformRequest = arr;
    }
    if (r.addedResTransforms.length) {
      const arr = asArray(ax.defaults.transformResponse);
      for (const fn of r.addedResTransforms) {
        const idx = arr.indexOf(fn);
        if (idx >= 0) arr.splice(idx, 1);
      }
      ax.defaults.transformResponse = arr;
    }
  }
}
