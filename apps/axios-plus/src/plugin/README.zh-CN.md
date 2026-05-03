# `plugin/` — 插件生命周期管理器

`PluginManager` 是 `Core` 装载所有插件时的运行时。它的核心价值是**自动追踪并撤销副作用**：插件通过 `ctx` 注册的每一个拦截器 / transformer / adapter 替换都被内部记录，`eject()`（或 `use()` / `eject()` 隐式触发的重装）会按记录精确回滚每一个副作用。

## 文件结构

| 文件 | 作用 |
|---|---|
| [`plugin.ts`](./plugin.ts) | `PluginManager` 类 —— install / eject / refresh，以及通过追踪代理 axios 修改的 `ctx` 工厂。Plugin-manager 私有的 logger 机制（`NS` / `NOOP_LOGGER` / `CONSOLE_LOGGER` / `tagged`）也在这里 |
| [`types.ts`](./types.ts) | 公开类型：`Plugin` / `PluginContext` / `PluginCleanup` / `PluginLogger` / `PluginRecord` / `IPluginCommonRequestOptions`。内部 `InternalRecord` 也定义在这里，但不通过 `index.ts` 重导出（只给 manager 用） |
| [`index.ts`](./index.ts) | 公共 barrel —— `PluginManager` + 上述公开类型 |

## 插件契约

```ts
interface Plugin {
  name: string;
  install(ctx: PluginContext): PluginCleanup | void;
}

interface PluginContext {
  axios: AxiosInstance;
  name: string;
  logger: PluginLogger;
  request(onF, onR?, options?): void;     // 自动追踪
  response(onF, onR?): void;              // 自动追踪
  adapter(adapter): void;                  // 自动追踪 + eject 时还原
  transformRequest(...fns): void;          // 自动追踪
  transformResponse(...fns): void;         // 自动追踪
  cleanup(fn): void;                       // 用户侧 teardown
}
```

插件作者只写副作用；manager 处理记账。`install()` 返回的 `PluginCleanup` 用于 axios 之外的资源（定时器、socket、内存 Map），eject 时需要释放。

## 生命周期语义

- **装载顺序很重要**。axios 原生拦截器模型决定组合方式：request 拦截器按 LIFO 执行（最后 `use` 的最先跑）；response 拦截器按 FIFO（最先 `use` 的最先跑）；transformer 按追加顺序；adapter 是"最后 `use` 的胜出"。manager 故意不加 priority 字段——**调用方的 `use()` 顺序就是优先级**
- **`useMany` 是原子操作**。批量装载（`use([a, b, c])`）只触发一次 `#refresh` 循环（O(N) 次 install）而不是 N 次（O(N²)）。批量中失败时已装好的插件不受影响
- **重复装载是 warn 不报错**。第二次 `use(samePlugin)` 会发 `console.warn`（即使 `debug: false` 也发），跳过重复 install。如需替换请先 `eject`
- **`eject` 反向 teardown**。manager 按反向 install 顺序撤销 adapter 替换，让每次还原都落在前驱保存的 adapter 上，与装载栈匹配

## 为什么没有 priority 字段

priority 系统让顺序决定隐式化，容易因为某个插件改了 priority 而破坏整条链。`use()` 调用顺序就是契约——装载点直接告诉你谁先跑。如果需要特定编排（例如 `key` 必须在 `share` 之前装，让 `config.key` 在 `share` 的 adapter 包装器看到请求时已就位），调用点就是文档。
