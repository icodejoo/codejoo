// 入口：导出 generate(base, langs) 通用函数，并统一 re-export 各语言配置工厂与类型。
//
// 主函数职责：
//   1. 加载 OpenAPI doc（v2/v3、json/yaml）→ 合成 mega-schema
//   2. 对每个语言：构建 InputData/JSONSchemaInput → 调 quicktype 拿到 raw 输出
//   3. 若该语言有 emitter 回调，调用它做后处理（TS 切分、Dart paths 登记表等）；
//      否则把 quicktype 原始输出整体落到 cfg.base.modelsFile
//   4. 写盘
//
// 添加新语言示例：
//   1. 在 config/<lang>.ts 实现 configure<Lang>(input)，返回 LangConfig（emitter 可省）
//   2. 在调用 generate() 时多传一个 configure<Lang>({...}) 即可

import fs from "fs/promises";
import path from "path";

import { quicktype, InputData, JSONSchemaInput } from "quicktype-core";

import { type BaseConfig, type EmitContext, type EmitOutput, type LangConfig } from "./config/shared";
import { stripQuicktypeHeader } from "./emitters/shared";
import { buildMegaSchema, loadOpenAPI, type MegaSchemaResult } from "./schema";

export * from "./http-types";
export * from "./config/shared";
export * from "./config/cjson";
export * from "./config/cpp";
export * from "./config/crystal";
export * from "./config/csharp";
export * from "./config/dart";
export * from "./config/elixir";
export * from "./config/elm";
export * from "./config/flow";
export * from "./config/golang";
export * from "./config/haskell";
export * from "./config/java";
export * from "./config/javascript-prop-types";
export * from "./config/javascript";
export * from "./config/json-schema";
export * from "./config/kotlin";
export * from "./config/objective-c";
export * from "./config/php";
export * from "./config/pike";
export * from "./config/python";
export * from "./config/ruby";
export * from "./config/rust";
export * from "./config/scala3";
export * from "./config/smithy4s";
export * from "./config/swift";
export * from "./config/typescript";
export * from "./config/typescript-effect-schema";
export * from "./config/typescript-zod";
export * from "./schema";
export * from "./emitters/typescript-emitter";
export * from "./emitters/dart-emitter";

/** 把 `base.source` 的 5 种形态压成一行短描述，避免内联字符串塞满日志 */
function describeSource(source: string | Record<string, unknown>): string {
  if (typeof source !== "string") return "[object]";
  if (/^https?:\/\//i.test(source)) return source;
  const trimmed = source.trimStart();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return `[inline JSON, ${source.length} chars]`;
  }
  if (source.includes("\n")) {
    return `[inline YAML, ${source.length} chars]`;
  }
  return source;
}

// ============================================================================
// 主函数：generate
// ============================================================================

/**
 * 主入口：加载 OpenAPI → 合成 mega-schema → 逐语言跑 quicktype → 写盘。
 * 相对路径（`base.source` 与各语言的 `base.dir`）以调用 generate 时的 `process.cwd()` 为基准。
 * @param base 与语言无关的基础配置，用 {@link configureBase} 构造
 * @param langs 要产出的语言配置列表，如 `[configureTypescript(), configureDart()]`
 * @returns 全部文件写完后 resolve
 * @example
 * await generate(configureBase({ source: "./openapi.json" }), [configureTypescript()]);
 */
export async function generate(base: BaseConfig, langs: LangConfig[]): Promise<void> {
  const projectRoot = process.cwd(); // 每次调用时取，避免 import 时固定住后来 chdir 的情况
  console.log(`[openapi2lang] Loading OpenAPI: ${describeSource(base.source)}`);
  const doc = await loadOpenAPI(base.source, projectRoot);

  console.log("[openapi2lang] Building mega-schema...");
  const meta = buildMegaSchema(doc, base);
  console.log(`[openapi2lang] components: ${meta.componentNames.length} | ops: ${meta.ops.length} | definitions: ${Object.keys(meta.schema.definitions).length}`);

  for (const lang of langs) {
    console.log(`[openapi2lang] Running quicktype for language: ${lang.base.lang}`);
    const outputs = await runLang(lang, meta);
    for (const { filename, content } of outputs) {
      const absPath = path.resolve(projectRoot, lang.base.dir, filename);
      await fs.mkdir(path.dirname(absPath), { recursive: true });
      await fs.writeFile(absPath, content, "utf-8");
      console.log(`  Written: ${absPath}`);
    }
  }

  console.log("[openapi2lang] Done.");
}

/** 单个语言的全流程：构建 InputData → 调 quicktype → emitter 回调或默认输出 */
async function runLang(cfg: LangConfig, meta: MegaSchemaResult): Promise<EmitOutput[]> {
  const inputData = new InputData();
  // store=undefined：所有 schema 在内存里，不做 IO
  const schemaInput = new JSONSchemaInput(undefined);
  await schemaInput.addSource({
    name: "api",
    // 尾斜杠：把 #/definitions/ 下每个 key 自动当 top-level 暴露
    uris: ["openapi://api.json#/definitions/"],
    schema: JSON.stringify(meta.schema),
  });
  inputData.addInput(schemaInput);

  const result = await quicktype({
    inputData,
    // quicktype 的 lang 形参是字面量 union，这里 cast 让任意 lang 字符串都能传入
    lang: cfg.base.lang as any,
    rendererOptions: { ...cfg.primary, ...cfg.others } as Record<string, string | boolean>,
    ...cfg.base.inferenceFlags,
  });
  const raw = result.lines.join("\n");

  if (cfg.emitter) {
    const ctx: EmitContext = { raw, meta, inputData, schemaInput, cfg };
    return cfg.emitter(ctx);
  }
  return defaultEmit(cfg, raw);
}

/** 无 emitter 时的默认行为：剥 quicktype 顶部用法注释 + 拼 fileHeader → 单文件落到 modelsFile */
function defaultEmit(cfg: LangConfig, raw: string): EmitOutput[] {
  if (!cfg.base.modelsFile) {
    throw new Error(`语言 '${cfg.base.lang}' 既没有 emitter 也没有 base.modelsFile；二者至少需要其一`);
  }
  return [
    {
      filename: cfg.base.modelsFile,
      content: cfg.base.fileHeader + stripQuicktypeHeader(raw) + "\n",
    },
  ];
}
