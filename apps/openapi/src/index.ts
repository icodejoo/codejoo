// 入口：导出 generate(base, langs) 通用函数；底部演示如何用本仓库的默认配置调用它。
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
export * from "./http-types";

// 其它 25 种语言可按需 import：
//   import { configureJava }                    from './config/java'
//   import { configureKotlin }                  from './config/kotlin'
//   import { configureSwift }                   from './config/swift'
//   import { configureGo }                      from './config/golang'
//   import { configurePython }                  from './config/python'
//   import { configureCSharp }                  from './config/csharp'
//   import { configureRust }                    from './config/rust'
//   import { configureRuby }                    from './config/ruby'
//   import { configurePhp }                     from './config/php'
//   import { configureCpp }                     from './config/cpp'
//   import { configureCJson }                   from './config/cjson'
//   import { configureObjectiveC }              from './config/objective-c'
//   import { configureScala3 }                  from './config/scala3'
//   import { configureSmithy4s }                from './config/smithy4s'
//   import { configureCrystal }                 from './config/crystal'
//   import { configureElixir }                  from './config/elixir'
//   import { configureHaskell }                 from './config/haskell'
//   import { configureElm }                     from './config/elm'
//   import { configurePike }                    from './config/pike'
//   import { configureFlow }                    from './config/flow'
//   import { configureJavascript }              from './config/javascript'
//   import { configureJavascriptPropTypes }     from './config/javascript-prop-types'
//   import { configureTypescriptZod }           from './config/typescript-zod'
//   import { configureTypescriptEffectSchema }  from './config/typescript-effect-schema'
//   import { configureJsonSchema }              from './config/json-schema'

const PROJECT_ROOT = process.cwd();

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

export async function generate(base: BaseConfig, langs: LangConfig[]): Promise<void> {
  console.log(`[openapi2lang] Loading OpenAPI: ${describeSource(base.source)}`);
  const doc = await loadOpenAPI(base.source, PROJECT_ROOT);

  console.log("[openapi2lang] Building mega-schema...");
  const meta = buildMegaSchema(doc, base);
  console.log(`[openapi2lang] components: ${meta.componentNames.length} | ops: ${meta.ops.length} | definitions: ${Object.keys(meta.schema.definitions).length}`);

  for (const lang of langs) {
    console.log(`[openapi2lang] Running quicktype for language: ${lang.base.lang}`);
    const outputs = await runLang(lang, meta);
    for (const { filename, content } of outputs) {
      const absPath = path.resolve(PROJECT_ROOT, lang.base.dir, filename);
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

/**
 * quicktype 默认会在文件顶部加"// To parse this JSON data..."用法注释。
 * 不同语言的注释引导符不同（C 系 //、Python 系 #、Haskell --），所以这里做较宽松的匹配：
 * 剥掉前导连续的"以注释字符开头或纯空"的行。
 */
function stripQuicktypeHeader(src: string): string {
  const lines = src.split("\n");
  let i = 0;
  while (i < lines.length) {
    const t = lines[i].trim();
    if (!t) {
      i++;
      continue;
    }
    if (t.startsWith("//") || t.startsWith("#") || t.startsWith("--")) {
      i++;
      continue;
    }
    break;
  }
  return lines.slice(i).join("\n").replace(/\s+$/, "");
}
