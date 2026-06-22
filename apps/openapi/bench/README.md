# bench — 生成产物的 tsserver/tsc 解析压力基准

回归用：改动类型机器（`emitMethodRefs`/`PathRefs`、`prefer-types`、`module` 开关等）后，
量一下生成产物对 TypeScript checker / tsserver 的内存与类型开销。

合成「类型内容等价、仅**形态**不同」的工程（忠实于 `typescript-emitter` 的 `response/request/paths.d.ts`
三文件结构 + 一个逼真 consumer + 若干 filler），对比各形态。

## 运行

```bash
node bench/run.mjs        # tsc --extendedDiagnostics 矩阵：checker 堆内存 / 类型数 / 耗时
node bench/tsserver.mjs   # 真实 tsserver 进程 WorkingSet（Windows，依赖 powershell）
```

`generate.mjs` 参数（`generate(outDir, opts)`）：
- `wrap`: `'global'`（ambient `declare namespace model`）| `'module'`（`export` + 命名空间导入）
- `decl`: `'interface'` | `'type'`（Tier 1 杠杆）
- `index`: `'both'` | `'methodOnly'`（只产 MethodRefs）| `'pathOnly'`
- `union`: 是否产 `type Paths` 大联合
- 规模：`res/req/paths/filler/lookup`

## 已测结论（240 路径 / 340 模型量级）

| 形态 | checker 堆内存 | 相对 |
|---|---|---|
| global + interface（当前默认） | 46.3 MB | 基准 |
| global + type（Tier1 之前） | 47.2 MB | +1.8% |
| **module + interface** | 43.1 MB | **−7%** |
| **global + iface, methodOnly 索引** | 43.0 MB | **−7%** |
| global + iface, 去 Paths 联合 | 46.2 MB | −0.2%（可忽略） |
| global + iface, methodOnly + 去联合 | 42.7 MB | −7.7% |

**tsserver 进程 WorkingSet**：global ≈ module ≈ 129 MB（**无可测差异**——tsserver 按 tsconfig
构建整个 program，全局/模块都加载，差异被 node 基线淹没）。

### 要点
- **最划算的杠杆是「只产一个索引」**：axp 只用 `MethodRefs`、openapi2lang 的 `Request` 只用
  `PathRefs`，没有单个消费者同时需要两者。设 `emitPathRefs:false`（或反之）省 ~7% 内存 + ~700 符号。
- `module` 开关在 batch checker 省 ~7%，但 **tsserver 总 RSS 不变**；其价值在解耦 / 补全卫生 /
  单文件检查作用域，不是省内存。
- `type → interface`（Tier 1）此规模省 ~2%；更大收益在 hover/报错体积与超大 schema。
- **去 Paths 联合对内存几乎无影响**——字符串字面量联合很便宜，不值得为省内存而砍。
- 反例提醒：若把 module 产物输出成 `.ts` 源文件（而非 `.d.ts`）会**反而 +15%**——务必保持 `.d.ts`。
