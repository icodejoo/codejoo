# `envs`

**install 时**用 `default` 选择器选定 env 名，去 `rules` 列表查命中的规则，把它的 `config` 浅合并到 `axios.defaults`。

- 不装拦截器，纯 install-time 行为，运行时零开销
- `default` 是字面量（直接当 env 名）或函数（调用一次得到 env 名）
- `rules[i].rule` 同样支持字面量或函数（每条 rule 各自解析后比对）
- 未命中 → no-op + dev warn（不擅自 fallback，避免静默吞错跑通假环境）

## 快速开始

```ts
import envsPlugin from 'http-plugins/plugins/envs';

// 探测式默认
api.use(envsPlugin({
  enable: true,
  default: () => (import.meta.env.PROD ? 'prod' : 'dev'),
  rules: [
    { rule: 'dev',  config: { baseURL: 'http://dev'  } },
    { rule: 'prod', config: { baseURL: 'http://prod' } },
  ],
}));

// 钉死某个 env
api.use(envsPlugin({
  enable: true,
  default: 'staging',
  rules: [
    { rule: 'staging', config: { baseURL: 'http://staging' } },
    { rule: 'prod',    config: { baseURL: 'http://prod'    } },
  ],
}));
```

## 配置项

| 字段 | 类型 | 默认 | 含义 |
| --- | --- | --- | --- |
| `enable` | `boolean` | — | **必传**。`false` ⇒ 整个 install 早退，不查也不合并 |
| `default` | `TRule` | — | **必传**。env 选择器：字面量（`string` / `number` / `symbol`）或 `() => 字面量` |
| `rules` | `IEnvRule[]` | `[]` | 候选 env 表；缺省 ⇒ 永远不会命中 |

## 规则匹配

- 解析 `default`（函数则调用一次）得到 env 名
- 在 `rules` 里找第一个 `resolve(rule.rule) === envName` 的规则
- 命中 ⇒ `Object.assign(axios.defaults, rule.config)`
- 未命中 ⇒ no-op + `dev warn`

```text
解析顺序：
  default 是函数  ⇒  调一次取返回值
  default 是字面量 ⇒  原样使用

  rules[i].rule 同样规则
```

## 何时**不要**用 envs

如果你的 dev/prod 切换通过构建变量（vite/webpack）已经在 `axios.create({ baseURL: import.meta.env.VITE_API })` 完成，envs 是冗余的。envs 适合：

- 同一份产物在多个环境运行（如 Tauri / Electron 灵活切换 API 域）
- 多环境调试时通过 URL 参数 / cookie 决定 env：`default: () => new URL(location.href).searchParams.get('env') ?? 'prod'`
- 本地开发 mock 切换：`default: 'mock'` 钉死命中 mock 规则
