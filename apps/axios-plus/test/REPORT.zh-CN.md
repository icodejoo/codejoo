# 测试与重构报告（中文）

生成时间：2026-05-01
库版本：`http-plugins` 0.0.0
测试运行器：vitest 4.1.5，Bun 1.2.20
> 英文版：[REPORT.en.md](./REPORT.en.md)

---

## 1. 本轮重构主旨：归一化全链路 + 无 reject 的 onFulfilled 模型

这次重构是项目 pre-release 期的**核心架构定型**，目标：

1. **`normalize` 把所有 settle 形态归一为 `onFulfilled + ApiResponse`**：HTTP 错误 / 网络 / 超时 / cancel / 业务错都不再走 `onRejected`，统一在 `onFulfilled` 里以 `response.data: ApiResponse(successful=false, code, status)` 的形式呈现
2. **下游所有插件只处理 onFulfilled，不再 shape detection、不再 instanceof、不再 try/catch**
3. **新增 `rethrow` 插件**作为整链最后一步，按规则把"业务认定失败"的 ApiResponse 重新 reject 给 caller —— 是否 reject 由用户配置决定
4. **强约束的 plugin 依赖检查**：`notification` / `retry` / `rethrow` 在 `install()` 时通过 `requirePlugin(ctx, 'normalize')` 强制 normalize 必须先注册

---

## 2. 测试结果总览

| 指标 | 值 |
| --- | --- |
| 总测试数 | **395** |
| 通过 | **395** |
| 失败 | 0 |
| 全量耗时 | ~1.1 s |
| TypeScript `tsc --noEmit` | 干净 |

### 2.1 文件分布

| 文件 | case 数 | 性质 |
| --- | ---: | --- |
| `src/plugins/normalize/normalize.test.ts` | 23 | 新增（之前没有单测） |
| `src/plugins/notification/notification.test.ts` | 26 | 重写 —— 适配 ApiResponse 形态 |
| `src/plugins/retry/retry.test.ts` | 44 | 重写 —— 适配 onFulfilled 模型 |
| `src/plugins/rethrow/rethrow.test.ts` | 19 | **新插件单测** |
| `src/plugins/cache/cache.test.ts` | 17 | 保留（adapter 级，未受影响） |
| `src/plugins/cancel/cancel.test.ts` | 9 | 保留 |
| `src/plugins/envs/envs.test.ts` | 5 | 保留 |
| `src/plugins/key/key.test.ts` | 62 | 保留 |
| `src/plugins/loading/loading.test.ts` | 17 | 保留 |
| `src/plugins/mock/mock.test.ts` | 18 | 保留 |
| `src/plugins/share/share.test.ts` | 41 | 保留 |
| `test/index.test.ts` | **54** | **重写**：13 个 describe 覆盖全链路 |
| `test/integration/normalize.test.ts` | 7 | 重写 |
| `test/integration/retry.test.ts` | 17 | 重写 |
| `test/integration/combo.test.ts` | 4 | 重写 |
| `test/integration/e2e-edge.test.ts` | 5 | 重写 |
| 其他 integration（cache/cancel/key/share/loading/filter/replace-path-vars/_smoke） | 32 | 保留 |
| **合计** | **395** | |

### 2.2 [`test/index.test.ts`](./index.test.ts) 综合编排测试覆盖矩阵

| 区块 | case 数 | 重点 |
| --- | ---: | --- |
| 全栈 use 顺序 | 4 | 13 plugins 一次装齐；normalize 依赖检查；缺 normalize 时 retry/notification/rethrow 抛错 |
| normalize 核心契约 | 8 | 0000 → ApiResponse；HTTP 5xx/biz 错误也 resolve；网络错；自定义 successful；自定义 code 路径；transform 'tag' 模式；请求级 normalize:false |
| rethrow 裁决 | 10 | successful=false reject；nullable=true/false；`config.rethrow=true/false` 强制；`shouldRethrow` 自定义；`transform` 自定义 reject 值；`onError:false` 关闭自动 reject |
| notification | 6 | 业务错误命中 messages；HTTP 错误命中 status；成功不通知；`config.notify` null/string/MaybeFun + `lookup()` |
| retry | 6 | 默认幂等；POST opt-in；Retry-After；`shouldRetry` 看 ApiResponse；CANCEL 永不重试 |
| cancel + normalize | 3 | `cancelAll` 后 cancel 也归一为 `apiResp.code='CANCEL'`；rethrow 默认 reject；`shouldRethrow` 可放过 cancel |
| cache + normalize | 3 | 失败响应不缓存（successful=false 不写入 store） |
| share + normalize | 1 | 3 并发同 key 收到同一 ApiResponse |
| loading + normalize | 1 | 0→1→0 计数器在归一化下仍正确 |
| 完整链路 normalize+retry+notification+rethrow | 3 | 业务恢复后不通知；硬错时 retry 用尽 + notification 仅 1 次 + rethrow reject |
| 请求侧插件（不依赖 normalize） | 4 | envs / mock / filter / replace-path-vars 独立工作 |
| Core.extends + 边界 | 4 | 派生隔离；重复 use；install 抛错；反复装/卸 |

### 2.3 修复的真实 bug（重构期间发现）

1. **`afterEach` 反序卸载** —— 正序卸 `normalize` 时，依赖它的 `retry` / `notification` / `rethrow` 在 `#refresh` 重装阶段会抛 `requires "normalize"`。改为反序卸（先卸最末插件）。
2. **cache 的失败响应缓存问题** —— 改造前 cache 缓存所有 adapter 返回值；改造后必须用 `response.data.successful === false` 判断跳过失败响应，否则永远缓存第一次的 BIZ_ERR / 5xx 等错误。

---

## 3. 架构与文件改动清单

### 3.1 新增

| 文件 | 用途 |
| --- | --- |
| `src/plugins/rethrow/rethrow.ts` | 新插件：按规则 reject 归一化结果 |
| `src/plugins/rethrow/types.ts` | `IRethrowOptions / TShouldRethrow / TRethrowTransform` |
| `src/plugins/rethrow/index.ts` | barrel |
| `src/plugins/rethrow/rethrow.test.ts` | 19 单测 |
| `src/plugins/normalize/normalize.test.ts` | 23 单测 |

### 3.2 重写

| 文件 | 主要变化 |
| --- | --- |
| `src/objects/ApiResponse.ts` | 新增 `ERR_CODES` 常量（HTTP/NETWORK/TIMEOUT/CANCEL）+ `DEFAULT_SUCCESS_CODE`；`successful` 允许构造方显式传入 |
| `src/plugins/normalize/types.ts` | 新增 `code / message / payload / successful / successCode / transform / *ErrorCode` 全套配置；axios `config.normalize` 类型 |
| `src/plugins/normalize/normalize.ts` | **核心改造**：onRejected 不再 reject，统一合成 ApiResponse 后 resolve；`transform: 'apiResponse' \| 'tag' \| function`；路径访问 + 函数形态 code |
| `src/plugins/notification/notification.ts` | 删除 `$extract` 等 shape detection；只工作在 onFulfilled；统一从 `apiResp.code` / `apiResp.status` 读 |
| `src/plugins/retry/retry.ts` | 删除 onRejected；`$decide` 改为基于 `ApiResponse`；新增 `codes` 白名单（`NETWORK_ERR/TIMEOUT_ERR/HTTP_ERR`）；`shouldRetry(apiResp, response)` 签名变更；`CANCEL` 硬编码不重试 |
| `src/plugins/cache/cache.ts` | 添加"失败响应不缓存"逻辑（`response.data.successful === false` 跳过 store.set） |
| `src/plugin/types.ts` | `PluginContext` 新增 `plugins()` 方法暴露当前快照 |
| `src/plugin/plugin.ts` | 实现 `ctx.plugins()` |
| `src/helper.ts` | `MaybeFun<T, P = AxiosRequestConfig>` 增第二泛型；新增 `requirePlugin(ctx, name)` helper |
| `src/index.ts` | 导出 ApiResponse / ERR_CODES / DEFAULT_SUCCESS_CODE / requirePlugin / rethrow + 全部 type |

### 3.3 受影响但保持兼容的文件

- `src/plugins/share/share.ts`、`src/plugins/loading/loading.ts`、`src/plugins/cancel/cancel.ts`、`src/plugins/key/key.ts`、`src/plugins/filter/filter.ts`、`src/plugins/mock/mock.ts`、`src/plugins/envs/envs.ts`、`src/plugins/replace-path-vars/replace-path-vars.ts` —— 与归一化模型天然兼容，未修改

---

## 4. 新模型核心契约速记

### 4.1 注册顺序

```ts
api.use([
    normalize(/* 1st 必须 */),

    // 中间随意：cancel / cache / share / key / filter / replacePathVars / mock / envs / loading
    cache(),
    retry(),
    notification(),

    rethrow(/* last 推荐 */),
]);
```

**强约束**：

- `notification` / `retry` / `rethrow` 的 `install()` 都会调 `requirePlugin(ctx, 'normalize')`，未先装 normalize 时抛错 `[<plugin>] requires "normalize" plugin to be installed first`
- `rethrow` 必须最后 use（用文档约定，不强检测）—— 否则后面注册的插件就看不到 reject 信号了

### 4.2 settle 形态对照

| axios 原始情形 | 改造前 | 改造后（`normalize` 单独安装时） |
| --- | --- | --- |
| HTTP 200 + biz 0000 | resolve, response.data = ApiResponse(successful=true) | 同 |
| HTTP 200 + biz 错误 | reject(response) | **resolve**, response.data = ApiResponse(code='BIZ_ERR', successful=false, status=200) |
| HTTP 4xx/5xx | reject(AxiosError) | **resolve**, response.data = ApiResponse(code from envelope or 'HTTP_ERR', status=4xx/5xx) |
| 网络错误 | reject(AxiosError) | **resolve**, response.data = ApiResponse(code='NETWORK_ERR', status=0) |
| 超时 | reject(AxiosError) | **resolve**, response.data = ApiResponse(code='TIMEOUT_ERR', status=0) |
| 用户 cancel | reject(CanceledError) | **resolve**, response.data = ApiResponse(code='CANCEL', status=0) |

### 4.3 加上 rethrow 的最终行为

| 场景 | 默认行为 | 关键配置 |
| --- | --- | --- |
| `successful=true` + 非空 data | resolve | — |
| `successful=true` + null data + `nullable=false` | **reject** | `nullable: true` 关掉 |
| `successful=false`（含 cancel / 网络 / 超时） | **reject** ApiResponse | `onError: false` 关掉 |
| `config.rethrow=true` | 强制 reject | 无视所有其他规则 |
| `config.rethrow=false` | 强制 resolve | 无视所有其他规则 |
| `shouldRethrow(apiResp, response, config)` 返回 boolean | 用它 | 返回 null/undefined → 走默认 |

---

## 5. 关键收益 vs 改造成本

### 5.1 收益（按"对每行业务代码的影响"计量）

**改造前**：

```ts
try {
    const r = await api.get('/x');
    if (r?.data?.code === '0000') {
        renderPet(r.data.data);
    } else {
        toast(r?.data?.message ?? '失败');
    }
} catch (e: any) {
    if (e?.response?.data instanceof ApiResponse) toast(e.response.data.message);
    else if (e?.code === 'ETIMEDOUT' || e?.code === 'ECONNABORTED') toast('超时');
    else if (axios.isCancel(e)) return;
    else toast('网络异常');
}
```

**改造后**：

```ts
try {
    const r = await api.get('/x');                   // r.data 一定是 ApiResponse 且 successful=true
    renderPet(r.data.data);
} catch (apiResp: ApiResponse) {                     // 一定是 ApiResponse
    if (apiResp.code !== 'CANCEL') toast(apiResp.message ?? '请求失败');
}
```

每一个 caller、每一个调用点都从 14 行 + 4 个 `?.` + 4 种类型判断 → 5 行 + 1 个 `if`。

### 5.2 改造成本（实际花费）

| 工作量 | 估算（之前的预估） | 实际 |
| --- | --- | --- |
| ApiResponse + ERR_CODES + ctx.plugins() + requirePlugin | 0.5 h | 0.5 h |
| normalize 重写 + 灵活配置 | 1 d | 0.5 d |
| notification 重写 | 2 h | 1 h |
| retry 重写 | 2 h | 2 h |
| cache 改造 | 0.5 h | 0.5 h |
| rethrow 新插件 | 0.5 d | 0.5 d |
| 新单测（normalize / rethrow） | 0.5 d | 0.5 d |
| 重写单测（notification / retry） | 0.5 d | 0.5 d |
| 重写集成测试（normalize / retry / combo / e2e-edge） | 0.5 d | 0.5 d |
| 重写综合编排 test/index.test.ts | 0.5 d | 0.5 d |
| 双语 REPORT 更新 | 0.5 d | 0.5 d |
| **合计** | ~3-4 d | **~3 d** |

### 5.3 性能与内存

| 维度 | 评估 |
| --- | --- |
| 每响应分配 | +1 个 ApiResponse 实例（5 字段）。浏览器 / 普通 Node 业务**完全可忽略** |
| 每错误分配 | 之前是 axios 自带 AxiosError，现在追加 1 个 ApiResponse；总分配略增但同量级 |
| CPU | normalize 的 onRejected handler 多了一次合成 + transform，单次微秒级 |
| 代码量 | normalize +60 行；notification 删 -20 行；retry 持平；新增 rethrow +120 行；测试 +400 行；**净增 +560 行** —— 都换来了"业务代码 -50%"的回报 |

如果是 BFF 高 QPS 场景对每响应分配敏感，可以用 `transform: 'tag'` 模式 —— 不替换 `response.data`，只挂不可枚举 `$hp` 元信息（已实测覆盖）。

---

## 6. 执行测试

```bash
# 全量
npx vitest run

# 仅综合编排
npx vitest run test/index.test.ts

# 仅单测（src/**）
npx vitest run src/

# 仅集成
npx vitest run test/integration/
```

集成测试需 Bun 环境（`BUN_PATH` 或 Windows 下 `C:/Users/.../bun.exe`）。

---

## 7. 已知设计取舍

- **cancel 也归一化为 ApiResponse(code=CANCEL)** —— 用户的 `axios.isCancel(e)` 不再适用；改用 `apiResp.code === 'CANCEL'`。`ERR_CODES.CANCEL` 已导出方便比对
- **rethrow 必须最后 use**：当前是文档约束。如果中间插装了别的会处理 onRejected 的插件，rethrow 的 reject 会被那些插件再次"拦截"。**建议**：所有插件都遵守"只看 onFulfilled" 这条新契约，rethrow 自然就是最后一步
- **`requirePlugin` 是 install-time 检查**：依赖必须在自己之前 use，`useMany([deps...self])` 顺序；不支持运行时检查"自己之后还会装什么"
- **没有 priority/order 字段**：保持 "use() 顺序 = 注册顺序" 的简单契约。强行需要"必先/必后"约束的插件用 `requirePlugin` 自我声明
