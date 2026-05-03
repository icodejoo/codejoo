---
name: plugin-author
description: Conventions for authoring or modifying http-plugins plugins (src/plugins/*). Use when writing a new plugin, refactoring an existing one, or adding request-level config fields. Captures naming, options layering, MaybeFun, declare-module merge, side-effect tracking via PluginContext, __DEV__ guards, and test conventions established across the bundled plugins.
---

# http-plugins — plugin authoring conventions

These rules are **observed practice** across [src/plugins/](../../../src/plugins/). Read [src/plugin.ts](../../../src/plugin.ts) for the lifecycle if anything below feels under-justified.

## File layout

Each plugin gets its **own folder** under `src/plugins/<name>/` with these files:

```
src/plugins/<name>/
├── <name>.ts          # implementation (factory + internal helpers)
├── types.ts           # public types + `declare module 'axios'` block
├── index.ts           # re-exports (default + named values + types)
├── <name>.test.ts     # vitest spec (if applicable)
├── README.md          # English doc
└── README.zh-CN.md    # Chinese doc
```

The default factory + the `declare module 'axios'` block are **mandatory**. Tests and READMEs follow the same naming convention. Sample minimal layout:

```ts
// types.ts
import type { MaybeFun } from '../../types';

export interface IMyOptions {
    enable?: boolean;
    /* ... */
}

declare module 'axios' {
    interface AxiosRequestConfig {
        myField?: MaybeFun<boolean | IMyOptions>;
    }
}
```

```ts
// my-plugin.ts
import type { Plugin } from '../../types';
import { __DEV__ } from '../../helper';
import type { IMyOptions } from './types';

const name = 'my-plugin';

export default function myPlugin(options: IMyOptions = {}): Plugin {
    const cfg = $normalize(options);
    return {
        name,
        install(ctx) {
            if (__DEV__) ctx.logger.log(`${name} enabled:${cfg.enable}`);
            if (!cfg.enable) return;
            ctx.request(/* ... */);
        },
    };
}
```

```ts
// index.ts
export { default } from './my-plugin';
export type { IMyOptions } from './types';
```

> **Why split**: keeps the impl file focused on runtime, lets `declare module 'axios'` be discoverable in one place per plugin, and makes the per-plugin docs first-class siblings of the code instead of buried sections of a monolithic README.

## Naming

- **Plugin name (string)**: kebab-case, declared as `const name = 'my-plugin'` at the top of the file. Reused by `Core.eject('my-plugin')`.
- **Factory function**: camelCase, declaration name **must match** the kebab → camel form of the plugin name when possible (so `eject(myPlugin)` works without `myPlugin.name = name`). When they diverge, assign explicitly: `myPlugin.name = name;`.
- **Internal helpers**: prefix with `$` (`$normalize`, `$merge`, `$decide`, `$parseRetryAfter`). Export them with `@internal exported for unit tests` comment.

## Options layering — three levels, one merge rule

Every plugin supports the same priority chain:

1. **Built-in defaults** — constants at the top of the file (`const DEFAULT_X = ...`).
2. **Plugin-level options** — passed to the factory: `myPlugin({ x: 1 })`.
3. **Request-level overrides** — read from `config.<plugin-config-key>`, declared via module merge.

The convention is two pure helpers:

- `$normalize(opts)` — defaults ⊕ plugin-level → `IConfig` (called once, in the factory body).
- `$merge(cfg, config)` — plugin-level ⊕ request-level → `IConfig` (called per-request, inside the interceptor).

Both are pure and `@internal`-exported so tests can assert merge precedence directly.

## Request-level config fields

Add fields via `declare module 'axios'`:

```ts
declare module 'axios' {
    interface AxiosRequestConfig {
        myField?: MaybeFun<boolean | IMyOptions>;
    }
}
```

- **Always wrap with `MaybeFun<T>`** — request-level config can be a value *or* `(config) => value`. Resolve via `typeof v === 'function' ? v(config) : v` inside `$merge`.
- **Boolean shortcuts**: `false` / `0` → off, `true` / `undefined` → use plugin defaults, object → field-level overrides. Keep the shortcut grammar consistent across plugins.
- **Array fields are merged, not replaced** — when a plugin has list-shaped options like `methods`, `status`, `ignoreKeys`, add user values onto the defaults via `$mergeArr` rather than overwriting. Otherwise users must restate the full default list to extend it. Document this clearly in the option's JSDoc.
- **Delete request-level fields after consumption** — once an interceptor has read `config.myField`, `delete config.myField` so it doesn't leak through retries / shared promises / log dumps. (See `cache.ts`, `mock.ts`, `loading.ts`, `filter.ts`.)

## `enable: false` means "don't install"

Not "install but no-op." Skip the entire body of `install` so no interceptors / adapter wraps are registered. Pattern:

```ts
install(ctx) {
    if (__DEV__) ctx.logger.log(`${name} enabled:${cfg.enable}`);
    if (!cfg.enable) return;
    // ... rest
}
```

## Side effects go through `ctx`

Never touch `axios.interceptors` / `axios.defaults.adapter` / transformers directly — always go through `ctx.request` / `ctx.response` / `ctx.adapter` / `ctx.transformRequest` / `ctx.transformResponse`. The PluginManager tracks every registration internally and reverts it on `eject`. Bypassing `ctx` leaks side-effects.

For non-axios resources (timers, sockets, in-memory maps), register a teardown via `ctx.cleanup(fn)` or `return cleanupFn` from `install`.

## State lives in the install closure

`install` runs fresh on every install — including the implicit re-installs that `use` / `eject` triggers for the rest of the plugin set. Keep plugin-local state (counters, in-flight maps) inside the closure. Reach for module-level `WeakMap<AxiosInstance, ...>` only when you intentionally want state to survive teardown — *and* register a `ctx.cleanup` to remove the entry.

## Adapter wrapping pattern

For features that should short-circuit or wrap the HTTP call (cache, share, loading, mock, retry's delay):

```ts
const prev = ctx.axios.defaults.adapter as AxiosAdapter; // PluginManager normalized to function
ctx.adapter((config) => {
    // pre-flight branching
    if (shouldShortCircuit) return Promise.resolve(cachedResponse);
    return prev(config).then(/* post-flight */);
});
```

The `PluginManager` constructor normalizes `defaults.adapter` to a callable, so plugins can cast directly without re-running `axios.getAdapter`.

**Adapter wrap order = `use()` order.** The library has no priority field on purpose. If you need a specific wrap order, document it ("use cache *before* share") in the plugin JSDoc or the README "Recipes" section.

## Logging

- Use `ctx.logger` — already namespaced and tagged. Never `console.log` directly.
- Wrap noisy paths in `if (__DEV__) { ... }` so production builds DCE the block. `__DEV__` is the compile-time constant exported from [src/helper.ts](../../../src/helper.ts).
- Prefer `config.key` (set by [key plugin](../../../src/plugins/key/key.ts)) over `${method} ${url}` when tagging logs — it's shorter and aligns with `cache` / `share` log lines:
  ```ts
  function $tag(config) {
      const k = config.key;
      return (typeof k === 'string' && k) ? k : `${(config.method || '').toUpperCase()} ${config.url ?? ''}`.trim();
  }
  ```

## Co-existence with other plugins

When a plugin needs information another plugin produces (e.g. retry / cache / share all want a stable request fingerprint), **read it from the existing field** instead of recomputing:

- `config.key` (string) — output of `key` plugin, used by `cache` / `share` / `retry` (logs).
- `config.signal` / `config.cancelToken` — `cancel` plugin checks these before injecting its own `AbortController`.
- `axios.isCancel(error)` — every error-path plugin should short-circuit cancellations before any other logic.

Don't re-implement what another plugin already does. Order plugins via `use()` so the producer runs first; let the consumer read the field.

## Retry-skip opt-in (`isRetry`)

The `retry` plugin stores a **countdown** counter on `config.__retry` (string key, survives `axios.mergeConfig` across `axios.request` re-entries). With `max=3`, the field goes `3 → 2 → 1 → 0`; with `max=-1` it stays `-1` forever. Truly **idempotent** request-side plugins should short-circuit when `isRetry(config) === true`:

```ts
import { isRetry } from '../../helper';

ctx.request((config) => {
    if (isRetry(config)) return config;  // first attempt already did the work
    // ... idempotent computation: build key, replace path vars, filter empty fields, etc.
    return config;
});
```

**Opted-in plugins** (no-op on retry):

- `key` — fingerprint stable across attempts
- `filter` — params/data already filtered on first attempt
- `reurl` — URL already substituted and slash-normalized, source fields already pruned

**Plugins that intentionally do NOT skip** (must run every attempt):

- `cache` — TTL may have expired between attempts
- `cancel` — every request needs a fresh `AbortController`
- `loading` — must keep the global counter accurate
- `share` — adapter-level, runs every dispatch
- `normalize` — must wrap the retry's response too

When you author a new request-interceptor plugin, decide explicitly: is the work I'm doing *only* a function of `(method, url, params, data)`? If yes, opt in to the skip. If it depends on time / state / external resources, don't.

## File anatomy (recommended sections)

Mirror the section layout of [src/plugins/retry/retry.ts](../../../src/plugins/retry/retry.ts) / [src/plugins/share/share.ts](../../../src/plugins/share/share.ts):

```
1. Imports + name constant
2. Default values (DEFAULT_*)
3. Public factory (default export)
4. Internal `attempt` / decision helpers
5. Pure computation helpers (@internal, exported for tests)
6. $normalize / $merge / $resolve* (@internal)
7. Internal IConfig type + tool helpers ($tag, $fmt*, etc.)
```

Public types (`IXxxOptions`, hook signatures) and the `declare module 'axios'` block live in `types.ts`, not the impl file. Separate sections with a horizontal-rule comment band (`// ──────────────`) for skim-readability.

## Test conventions

Test file lives at `src/plugins/<name>/<name>.test.ts`, vitest, runs via `npx vitest run src/plugins/<name>`.

Required coverage:

1. **Pure helpers** — `$resolveX`, `$normalize`, `$merge`, `$mergeArr`, `$decide`, `$computeDelay`, etc. Covered with table-style `describe` blocks.
2. **Integration** — install the plugin onto a `makeMockCtx()` (small ad-hoc mock that captures registered handlers; copy the helper from any existing test file), then drive interceptors / adapter wrappers manually. **Always pass `delay: 0`** (or stub `setTimeout`) so tests don't actually sleep.
3. **MaybeFun resolution** — at least one test that confirms `config.<field>: () => value` is unwrapped.
4. **Boolean shortcuts** — explicit tests for `false` / `true` / `0` / number / object cases on the request-level field.
5. **Backward-compat smoke** — when changing semantics, keep at least one test for the most common existing usage.

## What NOT to do

- Don't introduce a priority / order field on `Plugin`. `use()` order is the contract.
- Don't add cleanup boilerplate inside the plugin — `PluginManager` reverts every `ctx`-registered side effect automatically.
- Don't add module-level mutable state without a `ctx.cleanup` to clear it.
- Don't replace `console.warn` for duplicate-install warnings — the `PluginManager` does that and runs even when `debug: false`.
- Don't add new orphan types to [src/types.ts](../../../src/types.ts). Co-locate plugin types in the plugin file; let the module merge make them visible globally.
- Don't catch and swallow `axios.isCancel` errors — propagate cancellations.
