# `loading`

全局计数 + 私有 callback 双工 loading 插件。`delay` 滤快请求（不闪）+ `mdt` 兜底慢请求（一旦显示至少留够），是 NN.com / Material Design 标准的 wait-then-stay 模式。

## 三条路径

| `config.loading` | 行为 |
| --- | --- |
| `false` | **跳过**：不计数 / 不调任何回调 |
| `true` | **全局计数**：用插件级 `loading` 回调；多请求共用 count + delay + mdt |
| `function` | **独立执行**：立即 `fn(true)`、settle 后 `fn(false)`；不入计数、不受 delay/mdt 影响 |
| 未指定 | 看插件级 `default`：`true` ⇒ 全局计数、`false`（默认）⇒ 跳过 |

## 快速开始

```ts
import loadingPlugin from 'http-plugins/plugins/loading';

api.use(loadingPlugin({
  enable: true,
  default: false,                         // opt-in 模式（推荐）
  loading: (visible) => store.setLoading(visible),
  delay: 200,                             // 请求 < 200ms 不出现 spinner
  mdt: 500,                               // 一旦出现至少留 500ms（防一闪即消）
}));

api.get('/api', undefined, { loading: true });    // 显式参与全局
api.get('/api');                                   // default=false ⇒ 不参与
api.get('/api', undefined, { loading: false });    // 显式跳过
api.get('/api', undefined, { loading: (v) => spinner.toggle(v) });  // 私有 callback
```

## 配置项

| 字段 | 类型 | 默认 | 含义 |
| --- | --- | --- | --- |
| `enable` | `boolean` | `true` | 插件总开关；`false` 不安装 adapter |
| `loading` | `(visible: boolean) => any` | — | 全局计数路径的回调；`config.loading` 不是函数时使用 |
| `delay` | `number` | `0` | 触发 `cb(true)` 前的延迟（ms）—— 请求在 `delay` 内全部结束 ⇒ 跳过本次显示，永不闪 |
| `mdt` | `number` | `500` | Min Display Time —— spinner 一旦显示至少留 `mdt` ms |
| `default` | `boolean` | `false` | `config.loading: undefined` 时的默认参与策略；`false` opt-in、`true` opt-out |

## delay + mdt 时序

```text
请求开始
  │
  ├─ 0 ~ delay ms ────────── spinner 不出现
  │                           ↓ settle ⇒ 整段 debounce，零闪现
  │
  └─ delay 之后 ────────────── spinner 出现（cb(true)）
       │
       ├─ 持续 < mdt ────── 即使 settle 了也强制留够 mdt 才隐藏（cb(false)）
       └─ 持续 ≥ mdt ────── 立即跟随 settle 隐藏

mdt 等待期内来新请求 ⇒ 取消 hide，spinner 持续可见，shownAt 不重置
```

## 私有 callback 用法

请求级 `loading` 是函数时走"独立执行"路径，**不入全局计数**：

```ts
// 单按钮自管 spinner —— 不影响主页全局 loading
api.get('/api/refresh', undefined, {
  loading: (v) => button.classList.toggle('spinning', v),
});
```

`fn(true)` 立即触发，`fn(false)` 在 settle 时触发。无 delay / mdt（如需 debounce，调用方自己用 setTimeout）。

## 装载顺序

`loading` 包装 adapter，建议放在 cache / share 之后，让命中缓存 / 共享请求**不计入** loading：

```ts
api.use([
  cachePlugin(),         // 缓存命中不闪
  sharePlugin(),         // 共享请求只算一次
  concurrencyPlugin(),
  loadingPlugin({ ... }),// 真发出网的请求才入计数
  normalizePlugin(),
]);
```

## 性能

热路径**零分配**：跳过 / 私有 / 全局三条分支直接 inline，不创建中间对象、不调用 helper。失败也经 `finally` 减计数器，loading 永不卡住。
