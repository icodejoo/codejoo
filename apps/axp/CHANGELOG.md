# Changelog

## Unreleased

Codex 全量 review 后的修复，逐条记录见 [docs/reports/2026-10-27-codex-full-review.md](docs/reports/2026-10-27-codex-full-review.md)。

### Breaking

- **入口**：`"."`、`main`、`module`、`types` 现在指向不打包的 `dist/esm/index.mjs`，并去掉了 `production` 条件。
  根入口与 `./cache`、`./cancel` 等子路径共用同一份模块。压缩版只能通过 `./min` 显式引入。（#3）
- **TypeScript**：类型推断需要 TS ≥ 5.4（用到了 `NoInfer`）。（#4）
- **key**：`FormData`、`Blob`、`Map`、`Set`，以及没有可枚举字段的类实例，不再生成 key。这类请求不再被缓存或共享，以前会被当成空值，导致命中错误的缓存。（#16）
- **cache**：默认不再缓存非 2xx 和业务失败的信封响应，可以用 `shouldCache` 自定义。（#15）
- **repath**：变量值会做 `encodeURIComponent` 编码，并且只替换 pathname 部分。（#22）
- **extends**：`Core.extends()` 不再带走父实例的插件 adapter，和文档描述一致了。（#17）
- **auth**：`canRefresh` 为 `false` 时不再刷新。会话过期后插件会把它置为 `false`，需要登录流程把它改回 `true`。（#25）
- **auth**：`AuthFailureAction` 从 enum 改成 const 对象加同名类型，调用方式不变。（#27）

### Added

- `axpKey({ scope })`：把会话或租户标识并入 key。（#1）
- `axpCache({ max, shouldCache })`：`max` 是容量上限，默认 500，超出按 LRU 淘汰；`shouldCache` 决定哪些响应可以写入缓存。（#14、#15）
- 请求级 `normalize: false` 现在生效。（#24）
- 本地类型扩展模板改为扩展 `MethodRefs`。（#30）
- `npm run accept`：对接 api-ws-demo testkit 的黑盒验收。

### Fixed

- **auth**
  - 刷新期间调用 `cancelAll()`，重放请求也会一起取消，controller 不再泄漏。（#5）
  - 重放只走鉴权这一步：notify 不再触发两次，重试次数不再翻倍。（#6）
  - 重试过程中遇到 401 会正常走刷新流程。（#7）
- **retry**
  - 请求级的 `mock: false`、`share` 在重试时保留。（#2）
  - 重试和重放不再重复执行 `transformRequest`。（#8）
- **share**
  - 每个调用方拿到独立的 error 和自己的 config。（#9）
  - 跟随者能立即响应自己的取消和超时。（#10）
- **cache**
  - 较晚返回的旧响应不再覆盖缓存。（#11）
  - 命中缓存时 `transformResponse` 不再执行两次。（#12）
  - `clearCache` 之后，已在途的请求不会再写回缓存。
- **adapter 链**：多个 handle 可以按任意顺序卸载，互不影响。（#18）
- **loading**
  - 按逻辑请求计数，重试期间不再闪烁。（#21）
  - 回调抛错时被隔离，不影响请求和计数。（#19）
  - 卸载插件时会清理定时器。（#20）
- **Core**：`loading` 选项的类型不再被收窄成 boolean。（#23）
- **wrap 模式**：非信封响应的 data 不再变成 null。（#26）
- **工程**
  - 源码可以通过 `tsgo --noEmit`。（#27）
  - e2e 的 runner 和 playground 对齐，改用本地可控后端，命中计数如实反映请求次数。（#28、#29）
