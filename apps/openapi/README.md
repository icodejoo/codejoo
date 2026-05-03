# @codejoo/openapi2lang

> 🌐 **Languages:** **English** · [中文](https://github.com/gapkukb/codejoo/blob/main/apps/openapi/README_zh.md)

Converts an OpenAPI 3.x (or Swagger 2.0) document into type declarations for TypeScript, Dart, and 25+ other languages. Powered by [quicktype-core](https://github.com/quicktype/quicktype).

---

## Table of Contents

- [@codejoo/openapi2lang](#codejooopenapi2lang)
  - [Table of Contents](#table-of-contents)
  - [1. Installation](#1-installation)
  - [2. Quick Start](#2-quick-start)
  - [3. generate() API](#3-generate-api)
  - [4. configureBase() Options](#4-configurebase-options)
  - [5. TypeScript Output](#5-typescript-output)
    - [5.1 Generated File Structure](#51-generated-file-structure)
    - [5.2 Namespace Layout](#52-namespace-layout)
      - [Request type generation rules](#request-type-generation-rules)
    - [5.3 PathRefs — the key data structure](#53-pathrefs--the-key-data-structure)
  - [6. Type-Safe Fetch with `Request<PathRefs>`](#6-type-safe-fetch-with-requestpathrefs)
    - [6.1 Build the request wrapper](#61-build-the-request-wrapper)
    - [6.2 Auto-inferred call sites](#62-auto-inferred-call-sites)
    - [6.3 Explicit generics: override or escape](#63-explicit-generics-override-or-escape)
    - [6.4 Compile-time errors caught automatically](#64-compile-time-errors-caught-automatically)
    - [6.5 Optional: build shortcut methods on top](#65-optional-build-shortcut-methods-on-top)
  - [7. configureTypescript() Options](#7-configuretypescript-options)
    - [7.1 base options](#71-base-options)
    - [7.2 primary options (quicktype renderer)](#72-primary-options-quicktype-renderer)
    - [7.3 others options](#73-others-options)
    - [7.4 Example: use `interface` instead of `type`](#74-example-use-interface-instead-of-type)
    - [7.5 Example: infer date-time strings as `Date`](#75-example-infer-date-time-strings-as-date)
  - [8. Dart Output](#8-dart-output)
    - [8.1 base options](#81-base-options)
    - [8.2 primary options](#82-primary-options)
    - [8.3 others options](#83-others-options)
    - [8.4 Example: freezed](#84-example-freezed)
  - [9. Other Languages](#9-other-languages)
  - [10. Custom Emitters](#10-custom-emitters)
  - [11. Inference Flags](#11-inference-flags)
  - [12. Pipeline Architecture](#12-pipeline-architecture)

---

## 1. Installation

```bash
pnpm add @codejoo/openapi2lang
# or
npm install @codejoo/openapi2lang
```

> **Node requirement:** Node.js 16 or above (ESM package).

---

## 2. Quick Start

Create a script (e.g. `scripts/gen-types.mjs`) in your project root:

```js
import { generate, configureBase, configureTypescript, configureDart } from "@codejoo/openapi2lang";

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

## 6. Type-Safe Fetch with `Request<PathRefs>`

Once the three `.d.ts` files are on disk and included in `tsconfig.json`, wire them up to your fetch layer through the `Request` generic exported from this package. You write the runtime once; the types are derived from the generated `PathRefs`.

### 6.1 Build the request wrapper

```ts
// src/api/client.ts
import type { Request } from "@codejoo/openapi2lang";

async function impl(method: string, path: string, body?: unknown): Promise<unknown> {
  const init: RequestInit = { method: method.toUpperCase() };
  let url = path;

  if (body !== undefined) {
    if (method.toLowerCase() === "get") {
      // serialize body as query string for GET
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

// loosely-typed `impl` is upgraded to a fully type-safe API by the cast.
export const request = impl as Request<model.PathRefs>;
```

`Request<R>` produces (greatly simplified):

```ts
function request<R = unknown, Q = unknown, M extends Method, P extends PathHint<M>>(
  method: M,
  path: P,
  ...args: ResolvedBody<Q, M, P>
): Promise<ResolvedRes<R, M, P>>;
```

- **`M`, `P`** — inferred from the call-site arguments
- **`R`, `Q`** — explicit type parameters that override spec inference (escape hatch for mock / undeclared endpoints)
- **`...args`** — `[body: X]` (required) or `[body?: undefined]` (optional) depending on the spec's request tuple
- **return type** — pulled from the spec's response slot, or `any` if `path`/`method` not declared

### 6.2 Auto-inferred call sites

```ts
import { request } from "@/api/client";

// ✅ method + path inferred; payload type checked against spec
const pet = await request("get", "/pet/{petId}", { petId: 1 });
//    ^ Promise<model.Pet>

// ✅ POST with body
const order = await request("post", "/store/order", {
  id: 10,
  petId: 1,
  quantity: 2,
  status: "placed",
  complete: false,
});
//    ^ Promise<model.Order>

// ✅ Array response
const pets = await request("get", "/pet/findByStatus", { status: "available" });
//    ^ Promise<Array<model.Pet>>

// ✅ Path param + body field flat (no nested `body:` wrapper)
await request("put", "/user/{username}", {
  username: "john", // path parameter (extends-injected)
  email: "john@example.com", // body field (inherited from model.User)
});
```

### 6.3 Explicit generics: override or escape

`request<R, Q>(...)` lets you bypass spec inference. Useful for endpoints that don't appear in the spec (mocks, third-party, not yet shipped).

```ts
// path is in spec → R/Q auto-pulled from spec
await request("get", "/pet/{petId}", { petId: 1 });

// path NOT in spec, no generics → R = any, Q = any
const r = await request("get", "/internal/healthcheck");

// path NOT in spec, explicit R → response is Pet, body unchecked
const c = await request<model.Pet>("get", "/x");

// explicit R + Q → both body and response are user-typed; forces body required
const d = await request<model.Pet, string>("post", "/x", "body-as-string");
```

Type rules in priority order:

1. Explicit `<R, Q>` wins over spec
2. Otherwise spec inference (response from `PathRefs[P][M][0]`, body from `PathRefs[P][M][1]`)
3. Spec misses → response/body fall back to `any`
4. Spec request tuple `[]` → body optional; `[payload: X]` → body required

### 6.4 Compile-time errors caught automatically

```ts
// ❌ spec marks body as required for GET /pet/findByStatus
// @ts-expect-error - body required
await request("get", "/pet/findByStatus");

// ❌ missing required field
await request("get", "/pet/{petId}", {});
// Error: Property 'petId' is missing in type '{}'
//        but required in type 'model.req.GetPetById'

// ❌ wrong field type
await request("get", "/pet/{petId}", { petId: "one" });
// Error: Type 'string' is not assignable to type 'number'

// ❌ PUT path param missing
await request("put", "/user/{username}", { email: "john@example.com" });
// Error: Property 'username' is missing in type '...'
//        but required in type 'model.req.UpdateUser'
```

### 6.5 Optional: build shortcut methods on top

If you prefer `get(path, body)` over `request("get", path, body)`, compose with the `OpenApi<R>` type also exported from this package — it pre-computes lookup tables (`Method`, `MethodOf`, `PathsOf`, `Res`, `Body`) so you don't reinvent them.

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

// Usage is even shorter:
const pet = await get("/pet/{petId}", { petId: 1 });
//    ^ Promise<model.Pet>
```

The `const M extends Api["Method"]` modifier on `buildHttpMethod` ensures `'get'` is never widened to `string` (otherwise `PathsOf[string]` would produce `never` and break path autocompletion).

> `(string & {})` is a TypeScript trick: widens to any string at runtime but prevents the compiler from collapsing the union, so IDE autocompletion still lists the known literal paths. Drop it from `LoosePath<M>` to disable the "any path" escape hatch.

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
} from "@codejoo/openapi2lang";

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
import type { EmitContext, EmitOutput, LangConfig } from "@codejoo/openapi2lang";

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
