# @codejoo/openapi-to-lang

将 OpenAPI 3.x（或 Swagger 2.0）文档转换为 TypeScript、Dart 及 25+ 种语言的类型声明。底层由 [quicktype-core](https://github.com/quicktype/quicktype) 驱动。

---

## 目录

1. [安装](#1-安装)
2. [快速开始](#2-快速开始)
3. [generate() API](#3-generate-api)
4. [configureBase() 选项](#4-configurebase-选项)
5. [TypeScript 输出](#5-typescript-输出)
   - 5.1 [生成的文件结构](#51-生成的文件结构)
   - 5.2 [命名空间布局](#52-命名空间布局)
   - 5.3 [PathRefs — 核心数据结构](#53-pathrefs--核心数据结构)
6. [用生成的类型实现类型安全的 fetch](#6-用生成的类型实现类型安全的-fetch)
   - 6.1 [构建 fetch 包装层](#61-构建-fetch-包装层)
   - 6.2 [泛型推导 — request()](#62-泛型推导--request)
   - 6.3 [泛型推导 — 快捷方法](#63-泛型推导--快捷方法)
   - 6.4 [推导链原理详解](#64-推导链原理详解)
   - 6.5 [编译期自动拦截的错误](#65-编译期自动拦截的错误)
   - 6.6 [未声明路径的逃生通道](#66-未声明路径的逃生通道)
7. [configureTypescript() 选项](#7-configuretypescript-选项)
8. [Dart 输出](#8-dart-输出)
9. [其他语言](#9-其他语言)
10. [自定义 Emitter](#10-自定义-emitter)
11. [推断标志 (Inference Flags)](#11-推断标志-inference-flags)
12. [流水线架构](#12-流水线架构)

---

## 1. 安装

```bash
pnpm add @codejoo/openapi-to-lang
# 或
npm install @codejoo/openapi-to-lang
```

> **Node 要求：** Node.js 16 及以上（ESM 包）。

---

## 2. 快速开始

在项目根目录创建脚本（例如 `scripts/gen-types.mjs`）：

```js
import {
  generate,
  configureBase,
  configureTypescript,
  configureDart,
} from "@codejoo/openapi-to-lang";

await generate(
  configureBase({
    source: "https://petstore3.swagger.io/api/v3/openapi.json",
    // 或本地文件：
    // source: './openapi.yaml',
  }),
  [
    configureTypescript(), // 输出到 ./types/
    configureDart(), // 输出到 ./types/dart/
  ],
);
```

运行：

```bash
node scripts/gen-types.mjs
```

控制台输出（所有文件均为绝对路径，方便定位）：

```
[openapi-to-lang] Loading OpenAPI: https://petstore3.swagger.io/api/v3/openapi.json
[openapi-to-lang] Building mega-schema...
[openapi-to-lang] components: 5 | ops: 19 | definitions: 42
[openapi-to-lang] Running quicktype for language: typescript
  Written: /your/project/types/response.d.ts
  Written: /your/project/types/request.d.ts
  Written: /your/project/types/paths.d.ts
[openapi-to-lang] Running quicktype for language: dart
  Written: /your/project/types/dart/models.dart
  Written: /your/project/types/dart/paths.dart
[openapi-to-lang] Done.
```

---

## 3. generate() API

```ts
function generate(base: BaseConfig, langs: LangConfig[]): Promise<void>;
```

| 参数    | 类型           | 说明                                             |
| ------- | -------------- | ------------------------------------------------ |
| `base`  | `BaseConfig`   | OpenAPI 来源及预处理策略，所有语言共用           |
| `langs` | `LangConfig[]` | 每种语言一个条目，由 `configure*()` 工厂函数构建 |

`generate()` 以 `process.cwd()` 为项目根目录，所有输出 `dir` 路径相对于它解析。

---

## 4. configureBase() 选项

```ts
configureBase(input: ConfigureBaseInput): BaseConfig
```

```ts
interface ConfigureBaseInput {
  /** OpenAPI 来源：http/https URL 或本地路径（.json / .yaml / .yml） */
  source: string;

  /**
   * 对"有 properties 但未设 additionalProperties"的 object，注入 false，
   * 使 quicktype 产出封闭类型。默认 true
   */
  strictObjects?: boolean;

  /**
   * 同一 path 下 HTTP 方法的处理顺序。
   * 影响 PathRefs 中字段顺序及同名冲突时的优先级。
   * 默认：['get', 'post', 'put', 'delete', 'patch', 'options', 'head']
   */
  httpMethodOrder?: readonly string[];

  /**
   * 两个 schema 产出相同标识符时的消歧策略。
   * 默认：(base, n) => `${base}$${n}` → "Pet$1", "Pet$2", …
   */
  conflictSuffix?: (base: string, n: number) => string;
}
```

---

## 5. TypeScript 输出

### 5.1 生成的文件结构

`configureTypescript()` 输出**三个声明文件**：

```
types/
├── response.d.ts   — 所有组件 schema + 提取的 enum + inline 响应别名
├── request.d.ts    — 每个 operation 一个拍平类型（所有参数 + body 合并，无嵌套）
└── paths.d.ts      — model.Paths 联合类型 + model.PathRefs 索引接口
```

三个文件均使用 `declare namespace`，TypeScript 自动合并——消费侧代码无需任何 import。

### 5.2 命名空间布局

```
model
├── Pet                        ← 组件 schema
├── Order
├── ApiResponse
├── PetStatus                  ← 从 inline schema 提取的 enum
├── GetPetByIdInlineResponse   ← inline 响应别名（自动命名）
│
├── req
│   ├── GetPetById             ← { petId: number }                              （纯路径参数）
│   ├── UpdatePetWithForm      ← { petId: number; name?: string; status?: string } （路径参数 + 表单 body 拍平）
│   ├── AddPet                 ← extends model.Pet {}                           （纯 ref body，无额外参数）
│   ├── UpdateUser             ← extends model.User { username: string }        （ref body + 路径参数）
│   └── …
│
├── Paths                      ← 所有声明路径的字面量联合类型
└── PathRefs                   ← 索引接口（见 §5.3）
```

#### 请求类型生成规则

| Body 类型                 | 额外参数          | 生成形状                                                |
| ------------------------- | ----------------- | ------------------------------------------------------- |
| 无                        | path / query 参数 | `type X = { param1: T; param2?: T }`                    |
| inline 对象               | path / query 参数 | 全部字段拍平：`type X = { bodyField: T; param1: T }`    |
| `$ref` 引用组件           | 无                | `interface X extends model.Y {}`                        |
| `$ref` 引用组件           | path / query 参数 | `interface X extends model.Y { param1: T; param2?: T }` |
| 复杂类型（allOf / oneOf） | 任意              | `type X = { body: ComplexType; param1: T }`             |

消费侧代码永远不会看到 JSON ref body 对应的嵌套 `body:` 字段——所有参数都在同一层级。

### 5.3 PathRefs — 核心数据结构

`model.PathRefs` 是驱动所有类型安全 fetch 推导的核心索引接口：

```ts
declare namespace model {
  interface PathRefs {
    "/pet/{petId}": {
      get: [response: model.Pet, request: model.req.GetPetById];
      delete: [response: unknown, request: model.req.DeletePet];
    };
    "/store/order": {
      post: [response: model.Order, request: model.req.PlaceOrder];
    };
    "/user/{username}": {
      put: [response: unknown, request: model.req.UpdateUser];
      //                                  ↑ extends model.User { username: string }
    };
    "/pet/findByStatus": {
      get: [response: Array<model.Pet>, request: model.req.FindPetsByStatus];
    };
    // … OpenAPI spec 中每个 path × method 组合
  }
}
```

每个 `(path, method)` 对映射到一个**有标签的元组 `[response, request]`**：

- 索引 `[0]` — 成功响应的类型
- 索引 `[1]` — 拍平后的请求 payload 类型（路径参数、查询参数、body 字段全在一个对象里）

使用元组（而非对象）的原因：可以直接用 `[0]` / `[1]` 索引，避免 `extends ... infer ...`，对大型 schema 的 TypeScript 编译性能更友好。

---

## 6. 用生成的类型实现类型安全的 fetch

三个 `.d.ts` 落盘并通过 `tsconfig.json` 纳入后，将其接入 fetch 层。

### 6.1 构建 fetch 包装层

```ts
// src/api/client.ts

type Refs = model.PathRefs;

type Tuple = readonly [unknown, unknown];
type FallbackTuple = readonly [any, any];

/**
 * 核心查找类型：给定 path P 和 method M，从 PathRefs 中返回对应的有标签元组。
 * P 或 M 未在 spec 中声明时，退化为 [any, any]。
 */
type Operation<P, M> = P extends keyof Refs
  ? M extends keyof Refs[P]
    ? Refs[P][M] & Tuple
    : FallbackTuple
  : FallbackTuple;

/** 所有声明了方法 M 的 path */
type PathsWith<M extends string> = {
  [P in keyof Refs]: M extends keyof Refs[P] ? P : never;
}[keyof Refs & string];

/** 已声明的 path（带自动补全） + 任意字符串（退化为 any） */
type LoosePath<M extends string> = PathsWith<M> | (string & {});
/** 已声明的方法（带自动补全） + 任意字符串 */
type LooseMethod<P> = (P extends keyof Refs ? keyof Refs[P] : never) | (string & {});

// ---------------------------------------------------------------------------
// 通用 request()
// ---------------------------------------------------------------------------

export async function request<P extends keyof Refs | (string & {}), M extends LooseMethod<P>>(
  path: P,
  method: M,
  payload: Operation<P, M>[1],
): Promise<Operation<P, M>[0]> {
  const res = await fetch(path as string, {
    method: String(method),
    headers: { "Content-Type": "application/json" },
    body: payload !== undefined ? JSON.stringify(payload) : undefined,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  return res.json();
}

// ---------------------------------------------------------------------------
// 快捷方法：get / post / put / del / patch
// ---------------------------------------------------------------------------

function buildHttpMethod<const M extends "get" | "post" | "put" | "delete" | "patch">(method: M) {
  return <P extends LoosePath<M>>(
    path: P,
    payload: Operation<P, M>[1],
  ): Promise<Operation<P, M>[0]> => request(path as never, method as never, payload as never);
}

export const get = buildHttpMethod("get");
export const post = buildHttpMethod("post");
export const put = buildHttpMethod("put");
export const del = buildHttpMethod("delete");
export const patch = buildHttpMethod("patch");
```

> `(string & {})` 是一个 TypeScript 技巧：运行时等价于 `string`，但阻止编译器将字面量联合"宽化"（widening），从而保留编辑器的自动补全能力。

### 6.2 泛型推导 — request()

```ts
import { request } from "@/api/client";

// ✅ 类型完全自动推导，无需任何注解
const pet = await request("/pet/{petId}", "get", { petId: 1 });
//    ^ model.Pet

const order = await request("/store/order", "post", {
  id: 10,
  petId: 1,
  quantity: 2,
  status: "placed",
  complete: false,
});
//    ^ model.Order

// ✅ 数组响应
const pets = await request("/pet/findByStatus", "get", { status: "available" });
//    ^ Array<model.Pet>

// ✅ 带路径参数 + body 字段（全部拍平，无嵌套）
await request("/user/{username}", "put", {
  username: "john", // 路径参数（来自 extends 的扩展字段）
  email: "john@example.com", // body 字段（继承自 model.User）
});

// ✅ 未声明的端点 → 退化为 any，不阻断编译
const r = await request("/internal/healthcheck", "OPTIONS" as any, undefined);
//    ^ any
```

**TypeScript 逐步解析过程：**

```
request('/pet/{petId}', 'get', payload)
  │
  ├─ P = '/pet/{petId}'          ← 从第一个参数字面量推导
  ├─ M = 'get'                   ← 从第二个参数字面量推导
  │
  ├─ Operation<'/pet/{petId}', 'get'>
  │       = Refs['/pet/{petId}']['get'] & Tuple
  │       = [response: model.Pet, request: model.req.GetPetById] & Tuple
  │
  ├─ payload 类型 = Operation<P,M>[1] = model.req.GetPetById  ← 第三个参数在此检查
  └─ 返回类型    = Operation<P,M>[0] = model.Pet
```

### 6.3 泛型推导 — 快捷方法

```ts
import { get, post, put, del, patch } from "@/api/client";

// ✅ path 自动收窄为支持 GET 的路径集合
const order = await get("/store/order/{orderId}", { orderId: 1 });
//    ^ model.Order
//
// 编辑器只补全支持 GET 的路径：
//   '/pet/findByStatus' | '/pet/findByTags' | '/pet/{petId}'
//   | '/store/inventory' | '/store/order/{orderId}' | …

// ✅ POST + body
const created = await post("/store/order", {
  id: 10,
  petId: 1,
  quantity: 2,
  status: "placed",
  complete: false,
});
//    ^ model.Order

// ✅ PUT：路径参数 + body 字段全部拍平（无嵌套 body:）
await put("/user/{username}", {
  username: "john", // 路径参数（扩展字段）
  email: "john@example.com", // body 字段（继承自 model.User）
});

// ✅ DELETE
await del("/pet/{petId}", { petId: 1 });

// ✅ 未声明路径 → 退化为 any
await get("/temporary-mock", { anything: true });
```

**快捷方法的推导过程：**

```
get('/pet/{petId}', payload)
  │
  ├─ M 固定为 'get'（TS 5+ const 泛型，字面量不被宽化）
  ├─ P extends LoosePath<'get'>
  │       = PathsWith<'get'> | (string & {})
  │       = '/pet/{petId}' | '/pet/findByStatus' | … | (string & {})
  │
  ├─ P 从第一个参数字面量推导为 '/pet/{petId}'
  │
  ├─ Operation<'/pet/{petId}', 'get'>
  │       = [response: model.Pet, request: model.req.GetPetById]
  │
  ├─ payload 类型 = Operation<P,'get'>[1] = model.req.GetPetById
  └─ 返回类型    = Promise<model.Pet>
```

`buildHttpMethod` 上的 `const M extends ...` 修饰符确保 `'get'` 不被宽化为 `string`；否则 `PathsWith<string>` 产出 `never`，补全失效。

### 6.4 推导链原理详解

```
PathRefs ──► Operation<P, M>
                │
                ├── [0]  响应类型   →  Promise<…> 返回值类型
                └── [1]  请求类型   →  payload 参数的约束类型
```

`Operation<P, M>` 这一个条件类型只计算一次，结果同时复用于 payload 约束和返回类型。TypeScript 对泛型类型结果有缓存，`Operation<'/pet/{petId}', 'get'>[0]` 和 `[1]` 共用同一份解析实例，无冗余开销。

对比之前常见的 `extends ... infer` 模式：

```ts
// ❌ 老写法 — 两次条件类型求值，大型 schema 下明显更慢
type Res<P, M> = M extends keyof Refs[P]
  ? Refs[P][M] extends { response: infer R }
    ? R
    : any
  : any;
```

### 6.5 编译期自动拦截的错误

```ts
// ❌ '/store/order' 不支持 GET — 编译期报错
get("/store/order", {});
// Error: Argument of type '"/store/order"' is not assignable to
//        parameter of type 'PathsWith<"get"> | (string & {})'

// ❌ 缺少必填字段
get("/pet/{petId}", {});
// Error: Property 'petId' is missing in type '{}'
//        but required in type 'model.req.GetPetById'

// ❌ 字段类型错误
get("/pet/{petId}", { petId: "one" });
// Error: Type 'string' is not assignable to type 'number'

// ❌ PUT 时缺少路径参数
put("/user/{username}", { email: "john@example.com" });
// Error: Property 'username' is missing in type '...'
//        but required in type 'model.req.UpdateUser'
```

### 6.6 未声明路径的逃生通道

当 `path` 不在 `PathRefs` 的 key 集合中（或该方法未声明），`Operation<P, M>` 返回 `FallbackTuple = readonly [any, any]`。payload 和响应均为 `any`——无类型检查，编译不报错。

```ts
// 通过，r 类型为 any
const r = await get("/internal/debug", { flag: true });
```

如需禁用逃生通道、强制只允许声明的路径，去掉 `LoosePath<M>` 中的 `| (string & {})` 即可。

---

## 7. configureTypescript() 选项

```ts
configureTypescript(input?: ConfigureTsInput): TsLangConfig
```

所有字段均可选，只填需要覆盖的部分。

### 7.1 base 选项

```ts
configureTypescript({
  base: {
    dir: "./types", // 输出目录（相对项目根）。默认 './types'
    responseFile: "response.d.ts", // 默认 'response.d.ts'
    requestFile: "request.d.ts", // 默认 'request.d.ts'
    pathsFile: "paths.d.ts", // 默认 'paths.d.ts'
    rootNamespace: "model", // declare namespace 根名。默认 'model'
    requestNamespace: "req", // req 子命名空间名。默认 'req'
    fileHeader: "// auto-generated\n\n", // 每个输出文件的文件头
    inferenceFlags: { inferEnums: true }, // 覆盖特定标志（合并，非替换）
  },
});
```

### 7.2 primary 选项（quicktype 渲染器）

```ts
configureTypescript({
  primary: {
    "just-types": true, // 仅类型，不生成运行时 converter。默认 true
    "runtime-typecheck": false, // 运行时 JSON 校验。默认 false
    "nice-property-names": false, // snake_case → camelCase 重命名。默认 false
    "explicit-unions": false, // 给联合类型起独立别名。默认 false
    "prefer-unions": true, // 字符串字面量联合替代 enum。默认 true
    "prefer-types": true, // type 别名替代 interface。默认 true
    "prefer-const-values": false, // 单值 enum 退化为字符串字面量。默认 false
    readonly: false, // 所有字段加 readonly。默认 false
    "acronym-style": "original", // 缩写词大小写处理。默认 'original'
  },
});
```

### 7.3 others 选项

```ts
configureTypescript({
  others: {
    "runtime-typecheck-ignore-unknown-properties": false,
    "raw-type": "json", // converter 输入类型：'json' | 'any'。默认 'json'
  },
});
```

### 7.4 示例：使用 interface 替代 type

```ts
configureTypescript({
  primary: { "prefer-types": false },
});
```

### 7.5 示例：将 date-time 字符串推导为 Date

```ts
configureTypescript({
  base: {
    inferenceFlags: { inferDateTimes: true },
  },
});
```

---

## 8. Dart 输出

```ts
configureDart(input?: ConfigureDartInput): DartLangConfig
```

输出两个文件：

| 文件          | 内容                                                |
| ------------- | --------------------------------------------------- |
| `models.dart` | 所有模型类（含 `fromJson` / `toJson`）              |
| `paths.dart`  | `PathRefs` 类，包含类型化的 `PathOp<Req, Res>` 常量 |

### 8.1 base 选项

```ts
configureDart({
  base: {
    dir: "./types/dart", // 默认 './types/dart'
    modelsFile: "models.dart", // 默认 'models.dart'
    pathsFile: "paths.dart", // 默认 'paths.dart'
    pathsClassName: "PathRefs", // 默认 'PathRefs'
  },
});
```

### 8.2 primary 选项

```ts
configureDart({
  primary: {
    "null-safety": true, // 空安全语法（String?）。默认 true
    "just-types": false, // 不生成 fromJson/toJson。默认 false
    "coders-in-class": false, // 序列化方法内嵌到类内部。默认 false
    "required-props": false, // 所有字段 required。默认 false
    "final-props": true, // 所有字段 final。默认 true
    "copy-with": false, // 生成 copyWith()。默认 false
  },
});
```

### 8.3 others 选项

```ts
configureDart({
  others: {
    "from-map": false, // fromJson→fromMap, toJson→toMap 重命名。默认 false
    "use-freezed": false, // @freezed 兼容输出。默认 false
    "use-hive": false, // @HiveType / @HiveField 注解。默认 false
    "use-json-annotation": false, // json_serializable 的 @JsonKey 注解。默认 false
    "part-name": "", // part 'X.dart'; 中的 X。默认 ''
  },
});
```

### 8.4 示例：使用 freezed

```ts
configureDart({
  others: {
    "use-freezed": true,
    "part-name": "models",
  },
});
```

---

## 9. 其他语言

共支持 28 种语言，均遵循相同模式：

```ts
import {
  configureJava,
  configureKotlin,
  configureSwift,
  configureGo,
  configurePython,
  configureCSharp,
  configureRust,
  configureRuby,
  configurePhp,
  configureCpp,
  // … 其余语言
} from "@codejoo/openapi-to-lang";

await generate(configureBase({ source: "./openapi.yaml" }), [
  configureTypescript(),
  configureKotlin({ base: { dir: "./src/main/kotlin/api" } }),
  configureSwift({ base: { dir: "./Sources/API" } }),
  configureGo({ base: { dir: "./internal/api" } }),
]);
```

没有自定义 emitter 的语言，通过 `base.modelsFile` 指定单一输出文件：

```ts
configureJava({
  base: {
    dir: "./src/main/java/com/example/api",
    modelsFile: "Models.java",
  },
});
```

---

## 10. 自定义 Emitter

Emitter 是 quicktype 运行后调用的回调，接收原始输出和完整的 OpenAPI 元数据，返回 `{ filename, content }` 数组以写出多个文件。

```ts
import type { EmitContext, EmitOutput, LangConfig } from "@codejoo/openapi-to-lang";

function myEmitter(ctx: EmitContext): EmitOutput[] {
  const { raw, meta, cfg } = ctx;

  // meta.ops          — 所有 operation 列表
  // meta.reqInfoOf    — Map<opKey, ReqInfo>
  // meta.schema       — 喂给 quicktype 的合并 JSON Schema
  // raw               — quicktype 原始文本输出

  return [
    { filename: "models.ts", content: `// generated\n${raw}` },
    { filename: "paths.ts", content: generatePathsFile(meta) },
  ];
}
```

`EmitContext` 完整字段：

| 字段          | 类型               | 说明                                                    |
| ------------- | ------------------ | ------------------------------------------------------- |
| `raw`         | `string`           | quicktype 原始输出（`result.lines.join('\n')`）         |
| `meta`        | `MegaSchemaResult` | 所有 op、组件名、req/响应映射                           |
| `inputData`   | `InputData`        | 传给 quicktype 的 InputData（可复用再次调用 quicktype） |
| `schemaInput` | `JSONSchemaInput`  | JSONSchemaInput（可追加更多 source）                    |
| `cfg`         | `LangConfig`       | 完整语言配置（可按需 cast 到具体类型）                  |

---

## 11. 推断标志 (Inference Flags)

控制 quicktype 内部类型图的构建方式。每种语言独立一份，互不影响。

```ts
interface InferenceFlags {
  inferMaps: boolean; // 检测 object → Map<string, V>。默认 false
  inferEnums: boolean; // 检测字符串联合 → enum。默认 false
  inferUuids: boolean; // 检测 UUID 字符串 → uuid 类型。默认 false
  inferDateTimes: boolean; // 检测 ISO-8601 字符串 → Date。默认 false
  inferIntegerStrings: boolean; // 检测数字字符串 → number。默认 false
  inferBooleanStrings: boolean; // 检测 "true"/"false" 字符串 → boolean。默认 false
  combineClasses: boolean; // 合并结构相同的类。默认 true
  ignoreJsonRefs: boolean; // 忽略 $ref 循环/自引用。默认 true
}
```

按语言覆盖特定标志：

```ts
configureTypescript({
  base: {
    inferenceFlags: {
      inferDateTimes: true, // format: date-time → Date
      inferEnums: true, // 重复字符串值 → enum
    },
  },
});
```

---

## 12. 流水线架构

```
generate(base, langs)
      │
      ├─ loadOpenAPI(source)          — 拉取/读取文件，Swagger 2.0 → OpenAPI 3.0 归一化
      │
      ├─ buildMegaSchema(doc, base)   — 合并所有 schema 为一个根 JSON Schema
      │         │                       提取 op、req 类型、响应 ref
      │         └── MegaSchemaResult
      │                 ├── schema          （喂给 quicktype）
      │                 ├── componentNames
      │                 ├── ops
      │                 ├── reqInfoOf
      │                 └── responseRefOf
      │
      └─ 对每个 LangConfig：
              │
              ├─ JSONSchemaInput.addSource(mega-schema)
              ├─ quicktype({ inputData, lang, rendererOptions, ...inferenceFlags })
              │       → 原始字符串输出
              │
              └─ 有 emitter → emitter(ctx)   — 后处理（切分文件、重写引用…）
                 无 emitter → defaultEmit()  — 剥 quicktype 文件头，写入 modelsFile
```

TypeScript emitter（`emitTypescript`）对 quicktype 原始输出的后处理步骤：

1. `T[]` → `Array<T>` 提升可读性
2. 类 enum 块提升到命名空间顶部
3. 拆分为响应块（组件 schema）和请求块（合成的 op 类型）
4. 请求声明中对响应类型的引用补 `model.` 前缀
5. 包装进 `declare namespace model { … }` / `declare namespace model.req { … }`
6. 为 ref-alias op 手写 extends 接口：
   - 纯 ref body → `interface X extends model.Y {}`
   - ref body + 参数 → `interface X extends model.Y { param1: T; param2?: T }`
7. 写出 `paths.d.ts`（`Paths` 联合类型 + `PathRefs` 有标签元组接口）
