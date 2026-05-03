# `envs`

At **install time**, the `default` selector picks an env name; `envs` looks it up in `rules` and shallow-merges the matching `config` into `axios.defaults`.

- No interceptors — pure install-time, zero runtime overhead.
- `default` is either a literal (used directly as the env name) or a function (called once to produce the env name).
- `rules[i].rule` follows the same shape (literal or function — each is resolved before comparison).
- No match → no-op + dev warn (no silent fallback; surfaces config errors instead of running against a wrong env).

## Quick start

```ts
import envsPlugin from 'http-plugins/plugins/envs';

// Detect env at install time
api.use(envsPlugin({
  enable: true,
  default: () => (import.meta.env.PROD ? 'prod' : 'dev'),
  rules: [
    { rule: 'dev',  config: { baseURL: 'http://dev'  } },
    { rule: 'prod', config: { baseURL: 'http://prod' } },
  ],
}));

// Pin a specific env
api.use(envsPlugin({
  enable: true,
  default: 'staging',
  rules: [
    { rule: 'staging', config: { baseURL: 'http://staging' } },
    { rule: 'prod',    config: { baseURL: 'http://prod'    } },
  ],
}));
```

## Options

| Field | Type | Default | Meaning |
| --- | --- | --- | --- |
| `enable` | `boolean` | — | **Required.** `false` ⇒ install bails out early — no lookup, no merge |
| `default` | `TRule` | — | **Required.** Env selector: literal (`string` / `number` / `symbol`) or `() => literal` |
| `rules` | `IEnvRule[]` | `[]` | Candidate env table; if omitted, no rule will ever match |

## Matching

- Resolve `default` (call if function) to the env name.
- Find the first `rules[i]` such that `resolve(rule.rule) === envName`.
- Hit ⇒ `Object.assign(axios.defaults, rule.config)`.
- Miss ⇒ no-op + `dev warn`.

```text
Resolution order:
  default is a function   ⇒  called once, return value used
  default is a literal    ⇒  used directly

  rules[i].rule follows the same shape
```

## When **not** to use envs

If your dev/prod switch is already handled at build time (`axios.create({ baseURL: import.meta.env.VITE_API })`), `envs` is redundant. Reach for `envs` when:

- The same artifact runs in multiple environments (e.g., Tauri / Electron switching API origin)
- You want runtime env switching via URL param / cookie: `default: () => new URL(location.href).searchParams.get('env') ?? 'prod'`
- Local dev mock toggling: `default: 'mock'` to pin onto a mock rule
