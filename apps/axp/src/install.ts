import type { Plugin as AxpPlugin } from './types';
import type Core from './core';

/**
 * One-call wiring for the axp plugin set in a canonical, hand-verified
 * order — mirrors dioman's `Dioman.install`. Pass the plugins you want
 * (already constructed via their factories); omitted ones are skipped.
 *
 * Order is a hard constraint, harder to get right than in dioman: axios
 * splits request/response interceptors into LIFO/FIFO (see plugin.ts's
 * class doc), so the `.use()` array order needed to reach a sane EXECUTION
 * order is not just "list them in the order you want them to run" — some
 * pairs need to be registered *backwards* from their intended execution
 * order. `Axp.install` hard-codes the array so callers never have to
 * reason about this.
 *
 * Canonical registration order (this array) → resulting execution order:
 *
 *   - **Request** (LIFO — last registered runs first): registering
 *     `[auth, cancel, key, filter, repath]` executes as
 *     `repath → filter → key → cancel → auth`. `repath` substitutes
 *     path vars before anything reads params/data; `filter` strips empty
 *     fields before `key` hashes them (getting this pair backwards is
 *     the single easiest mistake — see the file's own class docs); `auth`
 *     injects the token last, after everything else has shaped the request.
 *
 *   - **Response** (FIFO — first registered runs first): registering
 *     `[auth, cancel, retry, notify, normalize]` executes in that same
 *     order. `auth` sees a 401 before `retry` does, so a refresh+replay
 *     happens *before* `retry` would otherwise burn attempts resending a
 *     request with a token already known to be stale. `notify` runs before
 *     `normalize` (mirroring dioman's `retry, log, normalize` order) so it
 *     reports the raw HTTP-level outcome, not `normalize`'s already-rejected
 *     `ApiError`. `normalize` runs last of all so it judges the truly final
 *     response, after `retry`/`auth` have resolved everything they're
 *     going to resolve.
 *
 *   - **Adapter composition** (last-registered wraps outermost):
 *     `[cache, share, mock, loading]` — `mock` wraps `cache`/`share` so its
 *     own probe *and* fallback dispatches still pass through them (it
 *     already neutralizes `cache`/`share` for its own probe via config
 *     flags, but needs them present in the chain to do that); `loading`
 *     wraps everything so it fires exactly one show/hide pair per logical
 *     operation instead of one per internal step (a cache hit, a mock
 *     probe-then-fallback, a share dedup wait all read as a single span).
 *
 * `envs` has no interceptors at all — it only touches `axios.defaults` at
 * install time — so its position is irrelevant; kept first for readability.
 *
 * Returns an `AxpHandle`, not the bare `Core` — mirrors `Dioman.install`
 * returning a `DiomanHandle` rather than the bare `Dio`, including
 * `insertBefore`/`insertAfter`/`prepend`/`append` for slotting extra
 * plugins into the chain without hand-managing `Core.use()` calls.
 *
 * Caveat `DiomanHandle` doesn't have: `Core`'s plugin list is append-only
 * (`use()` always adds to the *end* of `Core`'s current list — there is no
 * index-based insert the way `dio.interceptors` supports). `prepend` /
 * `insertBefore` / `insertAfter` are implemented by ejecting this handle's
 * OWN tracked plugins and re-`use()`-ing them in the new order — which
 * reorders them correctly *relative to each other*, but the whole group
 * lands back at the end of `Core`'s list, potentially after some other,
 * unrelated plugin installed directly via `api.use(...)` outside this
 * handle. `append` doesn't have this problem (appending was already a
 * plain `use()` call). If you never mix `Axp.install` with direct
 * `api.use(...)` calls on the same `Core`, this caveat never surfaces.
 *
 * @example
 *   const handle = Axp.install(api, {
 *     key: key(),
 *     cache: cache({ expires: 30_000 }),
 *     auth: auth({ tokenManager: tm, onRefresh, onAccessExpired }),
 *     retry: retry({ max: 2 }),
 *   });
 *   handle.plugin('cache');   // → the Plugin object passed in above
 *   handle.dispose();         // ejects everything Axp.install installed
 */
export const Axp = {
  install<T>(api: Core<T>, plugins: AxpPlugins): AxpHandle<T> {
    const ordered: Array<AxpPlugin | null | undefined | false> = [
      plugins.envs,
      plugins.auth,
      plugins.cancel,
      plugins.key,
      plugins.filter,
      plugins.repath,
      plugins.retry,
      plugins.notify,
      plugins.normalize,
      plugins.cache,
      plugins.share,
      plugins.mock,
      plugins.loading,
    ];
    const list: AxpPlugin[] = ordered.filter((p): p is AxpPlugin => !!p);
    if (list.length) api.use(list);

    const checkAnchor = (anchor: AxpPlugin): number => {
      const idx = list.indexOf(anchor);
      if (idx === -1) {
        throw new Error(`[Axp.install] anchor "${anchor.name}" is not installed on this handle`);
      }
      return idx;
    };
    // Ejects every plugin currently in `list`, then re-`use()`s it as-is —
    // the caller mutates `list` (splice/unshift/push) BEFORE calling this,
    // so the re-install picks up the new order.
    const reinstall = (): void => {
      for (const p of list) api.eject(p);
      if (list.length) api.use(list);
    };

    return {
      api,
      get plugins() { return list.slice(); },
      plugin(name: string): AxpPlugin | undefined {
        return list.find((p) => p.name === name);
      },
      dispose(): void {
        for (const p of list) api.eject(p);
        list.length = 0;
      },
      prepend(p: AxpPlugin): void {
        list.unshift(p);
        reinstall();
      },
      append(p: AxpPlugin): void {
        list.push(p);
        api.use(p);
      },
      insertBefore(anchor: AxpPlugin, p: AxpPlugin): void {
        const idx = checkAnchor(anchor);
        list.splice(idx, 0, p);
        reinstall();
      },
      insertAfter(anchor: AxpPlugin, p: AxpPlugin): void {
        const idx = checkAnchor(anchor);
        list.splice(idx + 1, 0, p);
        reinstall();
      },
    };
  },
};

/** Returned by `Axp.install` — the installed plugins plus lookup/teardown/
 *  insertion, scoped to exactly the batch `install` wired up. */
export interface AxpHandle<T = unknown> {
  /** The `Core` instance `install` was called on. */
  readonly api: Core<T>;
  /** Snapshot of the plugins currently tracked by this handle, in
   *  registration order. A fresh array each read — mutate via
   *  `prepend`/`append`/`insertBefore`/`insertAfter`, not this array. */
  readonly plugins: readonly AxpPlugin[];
  /** Look up a tracked plugin by its `.name` (e.g. `'cache'`, `'auth'`).
   *  Unlike `DiomanHandle.plugin<T>()`, this is by name, not by type — axp
   *  plugins are plain `{name, install}` objects from factory functions,
   *  not class instances, so there's no runtime type to `instanceof`-check
   *  the way Dio's plugin classes support. */
  plugin(name: string): AxpPlugin | undefined;
  /** Ejects every plugin this `install` call (plus any since added via
   *  `prepend`/`append`/`insertBefore`/`insertAfter`) installed. Does not
   *  touch any plugin installed separately via `api.use(...)`. */
  dispose(): void;
  /** Adds `p` before every plugin this handle tracks. See the file doc's
   *  caveat — reorders relative to this handle's own plugins correctly,
   *  but the whole group re-lands at the end of `Core`'s list. */
  prepend(p: AxpPlugin): void;
  /** Adds `p` after every plugin this handle tracks (and after anything
   *  else already in `Core`'s list — a plain `api.use(p)`, no reordering
   *  needed for a pure append). */
  append(p: AxpPlugin): void;
  /** Inserts `p` immediately before `anchor` among this handle's tracked
   *  plugins. Throws if `anchor` isn't tracked by this handle. Same
   *  re-landing-at-the-end caveat as `prepend`. */
  insertBefore(anchor: AxpPlugin, p: AxpPlugin): void;
  /** Inserts `p` immediately after `anchor` among this handle's tracked
   *  plugins. Throws if `anchor` isn't tracked by this handle. Same
   *  re-landing-at-the-end caveat as `prepend`. */
  insertAfter(anchor: AxpPlugin, p: AxpPlugin): void;
}

/** Named slots for `Axp.install` — one per bundled plugin, in no particular
 *  order here (the canonical order lives in `install`'s own implementation,
 *  not in this interface's field order). Pass a constructed `Plugin` (call
 *  the factory yourself, e.g. `cache({ expires: 30_000 })`); omit or pass a
 *  falsy value to skip. */
export interface AxpPlugins {
  envs?: AxpPlugin | null | false;
  repath?: AxpPlugin | null | false;
  filter?: AxpPlugin | null | false;
  key?: AxpPlugin | null | false;
  cache?: AxpPlugin | null | false;
  share?: AxpPlugin | null | false;
  mock?: AxpPlugin | null | false;
  cancel?: AxpPlugin | null | false;
  loading?: AxpPlugin | null | false;
  auth?: AxpPlugin | null | false;
  retry?: AxpPlugin | null | false;
  notify?: AxpPlugin | null | false;
  normalize?: AxpPlugin | null | false;
}
