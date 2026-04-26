# @codejoo/openapi-to-lang

Converts an OpenAPI 3.x (or Swagger 2.0) document into type declarations for TypeScript, Dart, and 25+ other languages. Powered by [quicktype-core](https://github.com/quicktype/quicktype).

---

## Table of Contents

1. [Installation](#1-installation)
2. [Quick Start](#2-quick-start)
3. [generate() API](#3-generate-api)
4. [configureBase() Options](#4-configurebase-options)
5. [TypeScript Output](#5-typescript-output)
   - 5.1 [Generated File Structure](#51-generated-file-structure)
   - 5.2 [Namespace Layout](#52-namespace-layout)
   - 5.3 [PathRefs — the key data structure](#53-pathrefs--the-key-data-structure)
6. [Type-Safe Fetch with Generated Types](#6-type-safe-fetch-with-generated-types)
   - 6.1 [Build the fetch wrapper](#61-build-the-fetch-wrapper)
   - 6.2 [Generic inference — request()](#62-generic-inference--request)
   - 6.3 [Generic inference — shortcut methods](#63-generic-inference--shortcut-methods)
   - 6.4 [How the inference chain works](#64-how-the-inference-chain-works)
   - 6.5 [Compile-time errors caught automatically](#65-compile-time-errors-caught-automatically)
   - 6.6 [Escape hatch for undeclared paths](#66-escape-hatch-for-undeclared-paths)
7. [configureTypescript() Options](#7-configuretypescript-options)
8. [Dart Output](#8-dart-output)
9. [Other Languages](#9-other-languages)
10. [Custom Emitters](#10-custom-emitters)
11. [Inference Flags](#11-inference-flags)
12. [Pipeline Architecture](#12-pipeline-architecture)

---

## 1. Installation

```bash
pnpm add @codejoo/openapi-to-lang
# or
npm install @codejoo/openapi-to-lang
```

> **Node requirement:** Node.js 16 or above (ESM package).

---

## 2. Quick Start

Create a script (e.g. `scripts/gen-types.mjs`) in your project root:

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
    // or a local file:
    // source: './openapi.yaml',
  }),
  [
    configureTypescript(), // outputs to ./types/
    configureDart(), // outputs to ./types/dart/
  ],
);
```

Run it:

```bash
node scripts/gen-types.mjs
```

Console output (all absolute paths so you know exactly where files landed):

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

| Parameter | Type           | Description                                                      |
| --------- | -------------- | ---------------------------------------------------------------- |
| `base`    | `BaseConfig`   | Source file / preprocessing options shared across all languages  |
| `langs`   | `LangConfig[]` | One entry per language; each built with a `configure*()` factory |

`generate()` resolves `process.cwd()` as the project root. All output `dir` paths are resolved relative to it.

---

## 4. configureBase() Options

```ts
configureBase(input: ConfigureBaseInput): BaseConfig
```

```ts
interface ConfigureBaseInput {
  /** OpenAPI source: http/https URL or local file path (.json / .yaml / .yml) */
  source: string;

  /**
   * When an object schema has explicit `properties` but no `additionalProperties`,
   * inject `additionalProperties: false` to make quicktype produce a closed type.
   * Default: true
   */
  strictObjects?: boolean;

  /**
   * Order in which HTTP methods are processed per path.
   * Affects field order in PathRefs and priority when two ops share the same name.
   * Default: ['get', 'post', 'put', 'delete', 'patch', 'options', 'head']
   */
  httpMethodOrder?: readonly string[];

  /**
   * How to disambiguate names when two schemas would produce the same identifier.
   * Default: (base, n) => `${base}$${n}`  →  "Pet$1", "Pet$2", …
   */
  conflictSuffix?: (base: string, n: number) => string;
}
```

---

## 5. TypeScript Output

### 5.1 Generated File Structure

`configureTypescript()` outputs **three declaration files**:

```
types/
├── response.d.ts   — All component schemas + extracted enums + inline response aliases
├── request.d.ts    — One flattened type per operation (all params + body merged, no nesting)
└── paths.d.ts      — model.Paths union type + model.PathRefs index interface
```

All three files use `declare namespace`, so TypeScript merges them automatically — no imports needed anywhere in the consuming codebase.

### 5.2 Namespace Layout

```
model
├── Pet                        ← component schema
├── Order
├── ApiResponse
├── PetStatus                  ← enum lifted from an inline schema
├── GetPetByIdInlineResponse   ← inline response alias (auto-named)
│
├── req
│   ├── GetPetById             ← { petId: number }   (path-only, no body)
│   ├── UpdatePetWithForm      ← { petId: number; name?: string; status?: string }  (path + form body inlined)
│   ├── AddPet                 ← extends model.Pet {}              (pure ref body, no extra params)
│   ├── UpdateUser             ← extends model.User { username: string }  (ref body + path param)
│   └── …
│
├── Paths                      ← string literal union of all declared paths
└── PathRefs                   ← index interface (see §5.3)
```

#### Request type generation rules

| Body type               | Extra params        | Generated shape                                                 |
| ----------------------- | ------------------- | --------------------------------------------------------------- |
| none                    | path / query params | `type X = { param1: T; param2?: T }`                            |
| inline object           | path / query params | All fields merged flat: `type X = { bodyField1: T; param1: T }` |
| `$ref` to a component   | none                | `interface X extends model.Y {}`                                |
| `$ref` to a component   | path / query params | `interface X extends model.Y { param1: T; param2?: T }`         |
| complex (allOf / oneOf) | any                 | `type X = { body: ComplexType; param1: T }`                     |

This means the consuming code never deals with a nested `body:` field for JSON ref bodies — all parameters are at the same level.

### 5.3 PathRefs — the key data structure

`model.PathRefs` is the index interface that drives all type-safe fetch inference:

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
    "/pet/findByStatus": {
      get: [response: Array<model.Pet>, request: model.req.FindPetsByStatus];
    };
    // … every path × method combination from the OpenAPI spec
  }
}
```

Each `(path, method)` pair maps to a **labeled tuple `[response, request]`**:

- Index `[0]` — the success response type
- Index `[1]` — the flattened request payload type (all path params, query params, and body fields in one object)

Using a tuple (not an object) means we can read `[0]` / `[1]` directly without `extends ... infer ...`, which is significantly cheaper for the TypeScript compiler on large schemas.

---

## 6. Type-Safe Fetch with Generated Types

Once the three `.d.ts` files are on disk and included in `tsconfig.json`, wire them up to your fetch layer.

### 6.1 Build the fetch wrapper

```ts
// src/api/client.ts

type Refs = model.PathRefs;

type Tuple = readonly [unknown, unknown];
type FallbackTuple = readonly [any, any];

/**
 * Core lookup: given a path P and method M, return the labeled tuple from PathRefs.
 * Falls back to [any, any] if either P or M is not declared in the spec.
 */
type Operation<P, M> = P extends keyof Refs
  ? M extends keyof Refs[P]
    ? Refs[P][M] & Tuple
    : FallbackTuple
  : FallbackTuple;

/** All paths that declare method M */
type PathsWith<M extends string> = {
  [P in keyof Refs]: M extends keyof Refs[P] ? P : never;
}[keyof Refs & string];

/** Declared paths for M, plus any arbitrary string (degraded to any) */
type LoosePath<M extends string> = PathsWith<M> | (string & {});
/** Declared methods for P, plus any arbitrary string */
type LooseMethod<P> = (P extends keyof Refs ? keyof Refs[P] : never) | (string & {});

// ---------------------------------------------------------------------------
// Universal request()
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
// Shortcut methods: get / post / put / del / patch
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

> `(string & {})` is a TypeScript trick: it widens to any string at runtime but prevents the compiler from collapsing the union, so IDE autocompletion still lists the known literal paths.

### 6.2 Generic inference — request()

```ts
import { request } from "@/api/client";

// ✅ Fully inferred — no type annotations needed
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

// ✅ Array response
const pets = await request("/pet/findByStatus", "get", { status: "available" });
//    ^ Array<model.Pet>

// ✅ Custom / undeclared endpoint — degrades to any, does not block compilation
const r = await request("/internal/healthcheck", "OPTIONS" as any, undefined);
//    ^ any
```

**How TypeScript resolves the types step by step:**

```
request('/pet/{petId}', 'get', payload)
  │
  ├─ P = '/pet/{petId}'           ← inferred from first argument
  ├─ M = 'get'                    ← inferred from second argument
  │
  ├─ Operation<'/pet/{petId}', 'get'>
  │     = Refs['/pet/{petId}']['get'] & Tuple
  │     = [response: model.Pet, request: model.req.GetPetById] & Tuple
  │
  ├─ payload type  = Operation<P,M>[1] = model.req.GetPetById   ← third argument checked here
  └─ return type   = Operation<P,M>[0] = model.Pet
```

### 6.3 Generic inference — shortcut methods

```ts
import { get, post, put, del, patch } from "@/api/client";

// ✅ Path auto-narrows to paths that declare GET
const order = await get("/store/order/{orderId}", { orderId: 1 });
//    ^ model.Order
//
// IDE completes only GET-supporting paths:
//   '/pet/findByStatus' | '/pet/findByTags' | '/pet/{petId}'
//   | '/store/inventory' | '/store/order/{orderId}' | '/user/{username}' | …

// ✅ POST with body
const created = await post("/store/order", {
  id: 10,
  petId: 1,
  quantity: 2,
  status: "placed",
  complete: false,
});
//    ^ model.Order

// ✅ PUT with both path param and body
await put("/user/{username}", {
  username: "john", // path param
  email: "john@example.com", // body field
});

// ✅ DELETE
await del("/pet/{petId}", { petId: 1 });

// ✅ Undeclared path — degrades to any
await get("/temporary-mock", { anything: true });
```

**How shortcut inference works:**

```
get('/pet/{petId}', payload)
  │
  ├─ M is fixed as 'get' (const generic — TS 5+ const modifier)
  ├─ P extends LoosePath<'get'>
  │       = PathsWith<'get'> | (string & {})
  │       = '/pet/{petId}' | '/pet/findByStatus' | … | (string & {})
  │
  ├─ P is inferred as '/pet/{petId}' from the first argument literal
  │
  ├─ Operation<'/pet/{petId}', 'get'>
  │       = [response: model.Pet, request: model.req.GetPetById]
  │
  ├─ payload type = Operation<P,'get'>[1] = model.req.GetPetById
  └─ return type  = Promise<model.Pet>
```

The `const M extends ...` modifier on `buildHttpMethod` ensures the method literal `'get'` is never widened to `string`, which would otherwise cause `PathsWith<string>` to produce `never`.

### 6.4 How the inference chain works

```
PathRefs ──► Operation<P, M>
                │
                ├── [0]  response type   →  Promise<…> return type
                └── [1]  request type    →  payload parameter type
```

The single conditional type `Operation<P, M>` is evaluated once and its result is reused for both the payload constraint and the return type. TypeScript caches generic type resolutions, so `Operation<'/pet/{petId}', 'get'>[0]` and `[1]` share the same resolved instance — no redundant work.

Contrast with the heavier `extends ... infer` pattern that was common before this approach:

```ts
// ❌ Old pattern — two conditional evaluations, slower on large schemas
type Res<P, M> = M extends keyof Refs[P]
  ? Refs[P][M] extends { response: infer R }
    ? R
    : any
  : any;
```

### 6.5 Compile-time errors caught automatically

```ts
// ❌ '/store/order' has no GET — caught at compile time
get("/store/order", {});
// Error: Argument of type '"/store/order"' is not assignable to
//        parameter of type 'PathsWith<"get"> | (string & {})'

// ❌ Missing required field
get("/pet/{petId}", {});
// Error: Property 'petId' is missing in type '{}'
//        but required in type 'model.req.GetPetById'

// ❌ Wrong field type
get("/pet/{petId}", { petId: "one" });
// Error: Type 'string' is not assignable to type 'number'
```

### 6.6 Escape hatch for undeclared paths

When `path` does not match any key in `PathRefs` (or the method is not declared for that path), `Operation<P, M>` returns `FallbackTuple = readonly [any, any]`. Payload and response are both `any` — no type checking, no compilation error.

```ts
// Passes without error; r is typed as any
const r = await get("/internal/debug", { flag: true });
```

To disable the escape hatch and enforce only declared paths, remove `| (string & {})` from `LoosePath<M>`.

---

## 7. configureTypescript() Options

```ts
configureTypescript(input?: ConfigureTsInput): TsLangConfig
```

All fields are optional. Pass only what you want to override.

### 7.1 base options

```ts
configureTypescript({
  base: {
    dir: "./types", // Output directory (relative to project root). Default: './types'
    responseFile: "response.d.ts", // Default: 'response.d.ts'
    requestFile: "request.d.ts", // Default: 'request.d.ts'
    pathsFile: "paths.d.ts", // Default: 'paths.d.ts'
    rootNamespace: "model", // declare namespace name. Default: 'model'
    requestNamespace: "req", // Sub-namespace for request types. Default: 'req'
    fileHeader: "// auto-generated\n\n", // Prepended to every output file
    inferenceFlags: { inferEnums: true }, // Override specific flags (merged, not replaced)
  },
});
```

### 7.2 primary options (quicktype renderer)

```ts
configureTypescript({
  primary: {
    "just-types": true, // Types only, no runtime converters. Default: true
    "runtime-typecheck": false, // Runtime JSON validation. Default: false
    "nice-property-names": false, // Rename snake_case → camelCase. Default: false
    "explicit-unions": false, // Named aliases for union types. Default: false
    "prefer-unions": true, // String literal unions instead of enums. Default: true
    "prefer-types": true, // type aliases instead of interface. Default: true
    "prefer-const-values": false, // Singleton enums → string literals. Default: false
    readonly: false, // Add readonly to all fields. Default: false
    "acronym-style": "original", // 'original' | 'pascal' | 'camel' | 'lowerCase'. Default: 'original'
  },
});
```

### 7.3 others options

```ts
configureTypescript({
  others: {
    "runtime-typecheck-ignore-unknown-properties": false, // Default: false
    "raw-type": "json", // Input kind for converters: 'json' | 'any'. Default: 'json'
  },
});
```

### 7.4 Example: use `interface` instead of `type`

```ts
configureTypescript({
  primary: { "prefer-types": false },
});
```

### 7.5 Example: infer date-time strings as `Date`

```ts
configureTypescript({
  base: {
    inferenceFlags: { inferDateTimes: true },
  },
});
```

---

## 8. Dart Output

```ts
configureDart(input?: ConfigureDartInput): DartLangConfig
```

Outputs two files:

| File          | Content                                                  |
| ------------- | -------------------------------------------------------- |
| `models.dart` | All model classes with `fromJson` / `toJson`             |
| `paths.dart`  | `PathRefs` class with typed `PathOp<Req, Res>` constants |

### 8.1 base options

```ts
configureDart({
  base: {
    dir: "./types/dart", // Default: './types/dart'
    modelsFile: "models.dart", // Default: 'models.dart'
    pathsFile: "paths.dart", // Default: 'paths.dart'
    pathsClassName: "PathRefs", // Default: 'PathRefs'
  },
});
```

### 8.2 primary options

```ts
configureDart({
  primary: {
    "null-safety": true, // Null-safe syntax (String?). Default: true
    "just-types": false, // Skip fromJson/toJson. Default: false
    "coders-in-class": false, // Embed serializers inside class. Default: false
    "required-props": false, // All fields required. Default: false
    "final-props": true, // All fields final. Default: true
    "copy-with": false, // Generate copyWith(). Default: false
  },
});
```

### 8.3 others options

```ts
configureDart({
  others: {
    "from-map": false, // Rename fromJson→fromMap, toJson→toMap. Default: false
    "use-freezed": false, // @freezed compatible output. Default: false
    "use-hive": false, // @HiveType / @HiveField annotations. Default: false
    "use-json-annotation": false, // @JsonKey annotations for json_serializable. Default: false
    "part-name": "", // part 'X.dart'; name for freezed / json_serializable. Default: ''
  },
});
```

### 8.4 Example: freezed

```ts
configureDart({
  others: {
    "use-freezed": true,
    "part-name": "models",
  },
});
```

---

## 9. Other Languages

28 languages are available. All follow the same pattern:

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
  configureCJson,
  configureObjectiveC,
  configureScala3,
  configureSmithy4s,
  configureCrystal,
  configureElixir,
  configureHaskell,
  configureElm,
  configurePike,
  configureFlow,
  configureJavascript,
  configureJavascriptPropTypes,
  configureTypescriptZod,
  configureTypescriptEffectSchema,
  configureJsonSchema,
} from "@codejoo/openapi-to-lang";

await generate(configureBase({ source: "./openapi.yaml" }), [
  configureTypescript(),
  configureKotlin({ base: { dir: "./src/main/kotlin/api" } }),
  configureSwift({ base: { dir: "./Sources/API" } }),
  configureGo({ base: { dir: "./internal/api" } }),
]);
```

Languages without a custom emitter write a single file specified by `base.modelsFile`:

```ts
configureJava({
  base: {
    dir: "./src/main/java/com/example/api",
    modelsFile: "Models.java",
  },
});
```

---

## 10. Custom Emitters

An emitter is a function called after quicktype runs, receiving the raw quicktype output and the full OpenAPI metadata. Return an array of `{ filename, content }` to write multiple files.

```ts
import type { EmitContext, EmitOutput, LangConfig } from "@codejoo/openapi-to-lang";

function myEmitter(ctx: EmitContext): EmitOutput[] {
  const { raw, meta, cfg } = ctx;

  // meta.ops        — array of all operations
  // meta.reqInfoOf  — Map<opKey, ReqInfo>
  // meta.schema     — the merged JSON Schema fed to quicktype
  // raw             — quicktype's raw text output

  return [
    { filename: "models.ts", content: `// generated\n${raw}` },
    { filename: "paths.ts", content: generatePathsFile(meta) },
  ];
}

const myLangConfig: LangConfig = {
  base: {
    lang: "typescript",
    dir: "./out",
    fileHeader: "",
    inferenceFlags: DEFAULT_INFERENCE_FLAGS,
  },
  primary: {},
  others: {},
  emitter: myEmitter,
};

await generate(configureBase({ source: "..." }), [myLangConfig]);
```

`EmitContext` gives you full access to:

| Field         | Type               | Description                                                       |
| ------------- | ------------------ | ----------------------------------------------------------------- |
| `raw`         | `string`           | Raw quicktype output (`result.lines.join('\n')`)                  |
| `meta`        | `MegaSchemaResult` | All ops, component names, req/response maps                       |
| `inputData`   | `InputData`        | The InputData passed to quicktype (re-use to run quicktype again) |
| `schemaInput` | `JSONSchemaInput`  | The JSONSchemaInput (useful for adding more sources)              |
| `cfg`         | `LangConfig`       | The full language config (cast to your concrete type as needed)   |

---

## 11. Inference Flags

Inference flags control how quicktype constructs its internal type graph. Each language config has its own independent set — changing one language's flags does not affect others.

```ts
interface InferenceFlags {
  inferMaps: boolean; // Detect object → Map<string, V>. Default: false
  inferEnums: boolean; // Detect string unions → enum. Default: false
  inferUuids: boolean; // Detect UUID strings → uuid type. Default: false
  inferDateTimes: boolean; // Detect ISO-8601 strings → Date. Default: false
  inferIntegerStrings: boolean; // Detect numeric strings → number. Default: false
  inferBooleanStrings: boolean; // Detect "true"/"false" strings → boolean. Default: false
  combineClasses: boolean; // Merge structurally identical classes. Default: true
  ignoreJsonRefs: boolean; // Ignore $ref cycles / self-references. Default: true
}
```

Override specific flags per language:

```ts
configureTypescript({
  base: {
    inferenceFlags: {
      inferDateTimes: true, // format: date-time → Date
      inferEnums: true, // repeated string values → enum
    },
  },
});
```

---

## 12. Pipeline Architecture

```
generate(base, langs)
      │
      ├─ loadOpenAPI(source)          — fetch / read file, convert Swagger 2.0 → OpenAPI 3.0
      │
      ├─ buildMegaSchema(doc, base)   — merge all schemas into one root JSON Schema
      │         │                       extract ops, req types, response refs
      │         └── MegaSchemaResult
      │                 ├── schema          (fed to quicktype)
      │                 ├── componentNames
      │                 ├── ops
      │                 ├── reqInfoOf
      │                 └── responseRefOf
      │
      └─ for each LangConfig:
              │
              ├─ JSONSchemaInput.addSource(mega-schema)
              ├─ quicktype({ inputData, lang, rendererOptions, ...inferenceFlags })
              │         → raw string output
              │
              └─ if emitter → emitter(ctx)   — post-process (split files, rewrite refs, …)
                 else       → defaultEmit()  — strip quicktype header, write modelsFile
```

The TypeScript emitter (`emitTypescript`) performs these post-processing steps on quicktype's raw output:

1. `T[]` → `Array<T>` for readability
2. Enum-like blocks lifted to the top of their namespace
3. Split into response blocks (component schemas) vs request blocks (synthesised op types)
4. Add `model.` prefix to response type references inside request declarations
5. Wrap in `declare namespace model { … }` / `declare namespace model.req { … }`
6. Append hand-written extends interfaces for ref-alias ops:
   - pure ref body → `interface X extends model.Y {}`
   - ref body + params → `interface X extends model.Y { param1: T; param2?: T }`
7. Write `paths.d.ts` with `Paths` union and `PathRefs` labeled-tuple interface
