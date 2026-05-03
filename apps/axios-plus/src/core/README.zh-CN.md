# `core/` — `Core<T>` 类 + `create()` 工厂

`Core<T>` 是用户实例化的唯一类。它持有一个 `axios.AxiosInstance`，派发 HTTP 动词（`get` / `post` / `put` / `delete` / `patch` / `head` / `options`），并通过 `PluginManager` 串接插件生命周期。

## 文件结构

| 文件 | 作用 |
|---|---|
| [`core.ts`](./core.ts) | `Core<T>` 类实现 + 派发胶水 + `create()` 工厂 + `extends()` 用的 axios.defaults 克隆辅助函数 |
| [`types.ts`](./types.ts) | 公开类型：`CoreOptions` / `IBaseOptions` / `IMethodOptions` / `IHttpOptions` / `ICommonOptions` / `Named` / `HttpMethodLower` / `HttpPrototype<T>`。路径到 payload 的推断机制（`_Indexed` / `LoosePath` / `EntryFor` / `ResolvePayload` / `Payload` 等）是模块私有——只有最外层的 `HttpPrototype<T>` 导出 |
| [`index.ts`](./index.ts) | 公共 barrel —— `default`（Core）、`create`、上述公开类型 |

## 公开 API

```ts
import { create } from 'http-plugins';
import axios from 'axios';

const api = create<MyApi>(axios.create({ baseURL: '/api' }), { debug: true });
api.use(retry({ max: 3 }));

// `MyApi extends model.PathRefs` 时支持类型化派发：
const pet = await api.get('/pet/{petId}')({ petId: 7 });
```

`Core` 暴露的方法：

- `use(plugin | plugin[])` —— 安装一个或一批插件，可链式调用
- `eject(name | Plugin | factory)` —— 卸载插件（内部统一走字符串名查找）
- `plugins()` —— 返回 `PluginRecord[]` 快照，用于调试
- `extends(overrides)` —— 派生子 `Core`，用新 axios 实例（深克隆 `headers` / `params` / `transformRequest` / `transformResponse` / `transitional`；共享 `adapter` / `logger`）
- `axios` —— 暴露底层 `AxiosInstance`（escape hatch）
- `get` / `post` / `put` / `delete` / `patch` / `head` / `options` —— curry 式派发：`api.get(path, methodConfig?)(payload?, config?)`

## 类型性能调优

`types.ts` 里的路径到 payload 推断机制针对 ~1000 个路径的 schema 做了 IDE 性能优化。详见 `types.ts` 的注释块和项目根 README 的 "Architecture" 章节。

## 为什么用 class 而非工厂函数

`Core<T>` 通过 TypeScript 接口声明合并把 `HttpPrototype<T>` 混进类：

```ts
export default interface Core<T = unknown> extends HttpPrototype<T> {}
export default class Core<T = unknown> { /* 运行时 */ }
```

class 提供运行时行为（plugin manager / 派发），interface 声明添加类型化的动词方法。用户看到 `api.get`、`api.post` 等，强类型绑定到 `T`。
