# @codejoo/openapi2lang

> 🌐 **语言：** **中文** · [English](https://github.com/gapkukb/codejoo/blob/main/apps/openapi/README.md)

将 OpenAPI 3.x（或 Swagger 2.0）文档转换为 TypeScript、Dart 及 25+ 种语言的类型声明。底层由 [quicktype-core](https://github.com/quicktype/quicktype) 驱动。

---

## 目录

- [@codejoo/openapi2lang](#codejooopenapi2lang)
  - [目录](#目录)
  - [1. 安装](#1-安装)
  - [2. 快速开始](#2-快速开始)
  - [3. generate() API](#3-generate-api)
  - [4. configureBase() 选项](#4-configurebase-选项)
  - [5. TypeScript 输出](#5-typescript-输出)
    - [5.1 生成的文件结构](#51-生成的文件结构)
    - [5.2 命名空间布局](#52-命名空间布局)
      - [请求类型生成规则](#请求类型生成规则)
    - [5.3 PathRefs — 核心数据结构](#53-pathrefs--核心数据结构)
  - [6. 用 `Request<PathRefs>` 实现类型安全的 fetch](#6-用-requestpathrefs-实现类型安全的-fetch)
    - [6.1 构建请求包装层](#61-构建请求包装层)
    - [6.2 调用点自动推导](#62-调用点自动推导)
    - [6.3 显式泛型：覆盖与逃生](#63-显式泛型覆盖与逃生)
    - [6.4 编译期自动拦截的错误](#64-编译期自动拦截的错误)
    - [6.5 可选：在其上封装快捷方法](#65-可选在其上封装快捷方法)
  - [7. configureTypescript() 选项](#7-configuretypescript-选项)
    - [7.1 base 选项](#71-base-选项)
    - [7.2 primary 选项（quicktype 渲染器）](#72-primary-选项quicktype-渲染器)
    - [7.3 others 选项](#73-others-选项)
    - [7.4 示例：使用 interface 替代 type](#74-示例使用-interface-替代-type)
    - [7.5 示例：将 date-time 字符串推导为 Date](#75-示例将-date-time-字符串推导为-date)
  - [8. Dart 输出](#8-dart-输出)
    - [8.1 base 选项](#81-base-选项)
    - [8.2 primary 选项](#82-primary-选项)
    - [8.3 others 选项](#83-others-选项)
    - [8.4 示例：使用 freezed](#84-示例使用-freezed)
  - [9. 其他语言](#9-其他语言)
  - [10. 自定义 Emitter](#10-自定义-emitter)
  - [11. 推断标志 (Inference Flags)](#11-推断标志-inference-flags)
  - [12. 流水线架构](#12-流水线架构)

---

## 1. 安装

```bash
pnpm add @codejoo/openapi2lang
# 或
npm install @codejoo/openapi2lang
```

> **Node 要求：** Node.js 16 及以上（ESM 包）。

---

## 2. 快速开始

在项目根目录创建脚本（例如 `scripts/gen-types.mjs`）：

```js
import { generate, configureBase, configureTypescript, configureDart } from "@codejoo/openapi2lang";

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
[openapi2lang] Loading OpenAPI: https://petstore3.swagger.io/api/v3/openapi.json
[openapi2lang] Building mega-schema...
[openapi2lang] components: 5 | ops: 19 | definitions: 42
[openapi2lang] Running quicktype for language: typescript
  Written: /your/project/types/response.d.ts
  Written: /your/project/types/request.d.ts
  Written: /your/project/types/paths.d.ts
[openapi2lang] Running quicktype for language: dart
  Written: /your/project/types/dart/models.dart
  Written: /your/project/types/dart/paths.dart
[openapi2lang] Done.
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

## 6. 用 `Request<PathRefs>` 实现类型安全的 fetch

三个 `.d.ts` 落盘并通过 `tsconfig.json` 纳入后，借助本包导出的 `Request` 泛型把它们接入 fetch 层。运行时只写一份，类型从生成的 `PathRefs` 自动推导。

### 6.1 构建请求包装层

```ts
// src/api/client.ts
import type { Request } from "@codejoo/openapi2lang";

async function impl(method: string, path: string, body?: unknown): Promise<unknown> {
  const init: RequestInit = { method: method.toUpperCase() };
  let url = path;

  if (body !== undefined) {
    if (method.toLowerCase() === "get") {
      // GET 把 body 序列化为 query string
      const params = new URLSearchParams(body as Record<string, string>).toString();
      if (params) url += (url.includes("?") ? "&" : "?") + params;
    } else {
      init.headers = { "Content-Type": "application/json" };
      init.body = JSON.stringify(body);
    }
  }

  const res = await fetch(url, init);
  return res.json();
}

// 通过 cast 把宽松类型的 impl 升级成完全类型安全的 API
export const request = impl as Request<model.PathRefs>;
```

`Request<R>` 产出的签名（极简化版）：

```ts
function request<R = unknown, Q = unknown, M extends Method, P extends PathHint<M>>(
  method: M,
  path: P,
  ...args: ResolvedBody<Q, M, P>
): Promise<ResolvedRes<R, M, P>>;
```

- **`M`、`P`** —— 从调用点参数自动推导
- **`R`、`Q`** —— 显式泛型参数，覆盖 spec 推导（用于 mock / 未上线接口的逃生通道）
- **`...args`** —— 根据 spec 请求元组形态展开为 `[body: X]`（必填）或 `[body?: undefined]`（可选）
- **返回类型** —— 来自 spec 响应位；spec 未命中 path/method 时退化为 `any`

### 6.2 调用点自动推导

```ts
import { request } from "@/api/client";

// ✅ method + path 自动推导；payload 按 spec 校验
const pet = await request("get", "/pet/{petId}", { petId: 1 });
//    ^ Promise<model.Pet>

// ✅ POST + body
const order = await request("post", "/store/order", {
  id: 10,
  petId: 1,
  quantity: 2,
  status: "placed",
  complete: false,
});
//    ^ Promise<model.Order>

// ✅ 数组响应
const pets = await request("get", "/pet/findByStatus", { status: "available" });
//    ^ Promise<Array<model.Pet>>

// ✅ 路径参数 + body 字段全部拍平（没有嵌套的 `body:` 包装）
await request("put", "/user/{username}", {
  username: "john", // 路径参数（来自 extends 注入的扩展字段）
  email: "john@example.com", // body 字段（继承自 model.User）
});
```

### 6.3 显式泛型：覆盖与逃生

`request<R, Q>(...)` 让你绕过 spec 推导。常用于 spec 里没有的端点（mock、第三方、未上线）。

```ts
// path 在 spec 中 → R/Q 自动从 spec 取
await request("get", "/pet/{petId}", { petId: 1 });

// path 不在 spec、不传泛型 → R = any, Q = any
const r = await request("get", "/internal/healthcheck");

// path 不在 spec、显式 R → 响应是 Pet，body 不校验
const c = await request<model.Pet>("get", "/x");

// 显式 R + Q → 两端都用户指定，body 强制必填
const d = await request<model.Pet, string>("post", "/x", "body-as-string");
```

类型规则按优先级：

1. 显式 `<R, Q>` 优先级最高，覆盖 spec
2. 否则按 spec 推导（响应来自 `PathRefs[P][M][0]`、body 来自 `PathRefs[P][M][1]`）
3. spec 未命中 → 响应/body 退化为 `any`
4. spec 请求元组为空 `[]` → body 可选；非空 `[payload: X]` → body 必填

### 6.4 编译期自动拦截的错误

```ts
// ❌ spec 标注 GET /pet/findByStatus 的 body 必填
// @ts-expect-error - body required
await request("get", "/pet/findByStatus");

// ❌ 缺少必填字段
await request("get", "/pet/{petId}", {});
// Error: Property 'petId' is missing in type '{}'
//        but required in type 'model.req.GetPetById'

// ❌ 字段类型错误
await request("get", "/pet/{petId}", { petId: "one" });
// Error: Type 'string' is not assignable to type 'number'

// ❌ PUT 缺少路径参数
await request("put", "/user/{username}", { email: "john@example.com" });
// Error: Property 'username' is missing in type '...'
//        but required in type 'model.req.UpdateUser'
```

### 6.5 可选：在其上封装快捷方法

如果你想要 `get(path, body)` 而不是 `request("get", path, body)`，用本包同时导出的 `OpenApi<R>` 类型组合——它已预算好 `Method`、`MethodOf`、`PathsOf`、`Res`、`Body` 等查找表，免去重复造轮子。

```ts
import type { OpenApi } from "@codejoo/openapi2lang";
import { request } from "./client";

type Api = OpenApi<model.PathRefs>;
// Api["PathsOf"]["get"] → '/pet/{petId}' | '/pet/findByStatus' | ...

function buildHttpMethod<const M extends Api["Method"]>(method: M) {
  return <P extends Api["PathsOf"][M] | (string & {})>(
    path: P,
    ...body: P extends keyof Api["Body"]
      ? M extends keyof Api["Body"][P]
        ? Api["Body"][P][M]
        : [body?: any]
      : [body?: any]
  ) => request(method as never, path as never, ...(body as never[]));
}

export const get = buildHttpMethod("get");
export const post = buildHttpMethod("post");
export const put = buildHttpMethod("put");
export const del = buildHttpMethod("delete");
export const patch = buildHttpMethod("patch");

// 调用更短：
const pet = await get("/pet/{petId}", { petId: 1 });
//    ^ Promise<model.Pet>
```

`buildHttpMethod` 上的 `const M extends Api["Method"]` 修饰符确保 `'get'` 不被宽化成 `string`；否则 `PathsOf[string]` 产出 `never`，path 补全失效。

> `(string & {})` 是 TypeScript 技巧：运行时是 `string`，但阻止编译器把字面量联合"宽化"（widening）合并，从而保留 IDE 的字面量自动补全。把它从 `LoosePath<M>` 去掉就关闭了"任意 path"的逃生通道。

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
} from "@codejoo/openapi2lang";

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
import type { EmitContext, EmitOutput, LangConfig } from "@codejoo/openapi2lang";

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
