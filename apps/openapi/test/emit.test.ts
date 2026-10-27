import fs from "fs/promises";
import os from "os";
import path from "path";

import { afterAll, describe, it, expect } from "vite-plus/test";

import { configureBase, configureDart, configureTypescript, generate } from "../src/index";
import { allocateDartFieldName, escapeDartString, escapeSingleQuoted, opDocLines, stripQuicktypeHeader } from "../src/emitters/shared";
import { EDGE_SPEC, jsonBody, ok, ref } from "./specs";

const tmpDirs: string[] = [];

/** 建一个临时输出目录（绝对路径，测试结束统一清理） */
async function tmpDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openapi2lang-test-"));
  tmpDirs.push(dir);
  return dir;
}

/** 带必填属性 a 的对象 schema，additionalProperties 由参数指定 */
const item = (ap: unknown) => ({ type: "object", required: ["a"], properties: { a: { type: "string" } }, additionalProperties: ap });

/** 读输出文件 */
const read = (dir: string, file: string) => fs.readFile(path.join(dir, file), "utf-8");

afterAll(async () => {
  await Promise.all(tmpDirs.map((d) => fs.rm(d, { recursive: true, force: true })));
});

describe("stripQuicktypeHeader", () => {
  it("保留 C / C++ / ObjC 预处理指令", () => {
    const src = ["// To parse this JSON data", "//", "", "#pragma once", "#include <x>", "#import <Foundation/Foundation.h>", "#ifndef A", "int a;", ""].join("\n");
    expect(stripQuicktypeHeader(src)).toBe(["#pragma once", "#include <x>", "#import <Foundation/Foundation.h>", "#ifndef A", "int a;"].join("\n"));
  });

  it("剥掉 `# comment`、`#`（单独一行）、`// comment`、`-- comment` 与空行", () => {
    const src = ["# comment", "#", "// c", "-- hs", "", "body", "# 正文里的不剥"].join("\n");
    expect(stripQuicktypeHeader(src)).toBe("body\n# 正文里的不剥");
  });

  it("去尾部空白，且只剥前导部分", () => {
    expect(stripQuicktypeHeader("// h\nA\n// 中间注释\nB\n\n\n")).toBe("A\n// 中间注释\nB");
  });
});

describe("opDocLines", () => {
  it("summary + 空行 + description + @deprecated", () => {
    expect(opDocLines({ summary: "查宠物", description: "按 id 查\n第二行", deprecated: true })).toEqual(["查宠物", "", "按 id 查", "第二行", "@deprecated"]);
  });

  it("description 与 summary 相同时不重复；只有 description 时不插空行；什么都没有返回空数组", () => {
    expect(opDocLines({ summary: "同", description: "同" })).toEqual(["同"]);
    expect(opDocLines({ description: "只有描述" })).toEqual(["只有描述"]);
    expect(opDocLines({})).toEqual([]);
  });
});

describe("字符串转义与 Dart 字段名", () => {
  it("escapeSingleQuoted 转义反斜杠与单引号", () => {
    expect(escapeSingleQuoted("/it's")).toBe("/it\\'s");
    expect(escapeSingleQuoted("a\\b")).toBe("a\\\\b");
  });

  it("escapeDartString 额外转义 $", () => {
    expect(escapeDartString("/cost/$total")).toBe("/cost/\\$total");
  });

  it("allocateDartFieldName：重名加数字后缀，保留字加 _", () => {
    const used = new Set<string>();
    expect(allocateDartFieldName("findById", used)).toBe("findById");
    expect(allocateDartFieldName("findById", used)).toBe("findById2");
    expect(allocateDartFieldName("findById", used)).toBe("findById3");
    expect(allocateDartFieldName("class", used)).toBe("class_");
    expect(allocateDartFieldName("class", used)).toBe("class_2");
    expect(allocateDartFieldName("new", used)).toBe("new_");
  });
});

describe("TypeScript 端到端（EDGE_SPEC）", () => {
  it("全局 namespace 形态：属性名 / 字面量不被改写，enum 不退化，非对象基类走 type 别名", async () => {
    const dir = await tmpDir();
    await generate(configureBase({ source: structuredClone(EDGE_SPEC) }), [configureTypescript({ base: { dir } })]);
    const req = await read(dir, "request.d.ts");
    const res = await read(dir, "response.d.ts");
    const paths = await read(dir, "paths.d.ts");

    // 与响应类型同名的查询参数 Tag 不能被加上 model. 前缀
    expect(req).not.toContain("model.Tag?:");
    expect(req).toMatch(/Tag\?:\s+string/);
    // header 名要加引号；path 参数 id（来自 $ref）与 limit 都要在
    expect(req).toContain('"X-Request-Id": string');
    expect(req).toMatch(/interface UpdateItem extends model\.Item \{[\s\S]*id: number/);
    expect(req).toMatch(/limit\?:\s+number/);
    // 非对象基类退化为 type 别名
    expect(req).toContain("type PutStatus = model.Status");
    expect(req).toMatch(/type PutStatusWithId = model\.Status & \{\s+id: number\s+\}/);
    // 对象基类仍然是 interface extends（默认输出风格不变）
    expect(req).not.toMatch(/interface PutStatus/);
    // oneOf body 渲染成联合
    expect(req).toContain("type PostPoly = model.Item | model.Tag");
    // 带方括号的属性名保持原样，数组仍被转成 Array<>
    expect(res).toContain('"items[]"');
    expect(res).toContain("Array<string>");
    expect(res).not.toContain("type Status = any");
    expect(res).toMatch(/type Status = "on" \| "off"/);

    // path 字面量转义、trace 方法、PUT 响应
    expect(paths).toContain("'/it\\'s'");
    expect(paths).toMatch(/trace: \{/);
    expect(paths).toMatch(/put: \[response: model\.Item, request: \[payload: model\.req\.UpdateItem\]\]/);
    // enum 响应走 ref
    expect(paths).toMatch(/'\/status': \{\s+get: \[response: model\./);
  });

  it("模块形态：request / paths 的 import 路径按引用文件所在目录计算", async () => {
    const dir = await tmpDir();
    await generate(configureBase({ source: structuredClone(EDGE_SPEC) }), [
      configureTypescript({ base: { dir, module: true, responseFile: "res/response.d.ts", requestFile: "req/request.d.ts", pathsFile: "paths.d.ts" } }),
    ]);
    const req = await read(dir, "req/request.d.ts");
    const paths = await read(dir, "paths.d.ts");
    expect(req).toContain('import type * as model from "../res/response"');
    expect(paths).toContain('import type * as model from "./res/response"');
    expect(paths).toContain('import type * as req from "./req/request"');
    expect(req).toContain("export type PutStatus = model.Status");
  });

  it("inferenceFlags 可只覆盖一部分，且不认识的字段会被类型检查拦下", () => {
    // 运行期：给出的字段生效，没给的字段沿用默认值
    const cfg = configureTypescript({ base: { inferenceFlags: { inferDateTimes: true } } });
    expect(cfg.base.inferenceFlags.inferDateTimes).toBe(true);
    expect(cfg.base.inferenceFlags.combineClasses).toBe(true);
    // 类型层面：下面这行必须报类型错误，@ts-expect-error 失效（即不再报错）时由 `pnpm run lint`（typeCheck）拦下；
    // vitest 本身不做类型检查，所以这里没有运行期断言
    // @ts-expect-error notAFlag 不是合法的 inferenceFlags 字段
    configureTypescript({ base: { inferenceFlags: { notAFlag: true } } });
  });

  it("基类 type 为数组时，只有全部元素都是 object 才走 interface extends", async () => {
    const dir = await tmpDir();
    const body = (operationId: string, schemaName: string) => ({ post: { operationId, requestBody: jsonBody(ref(schemaName)), responses: ok(ref("Obj")) } });
    const spec = {
      openapi: "3.1.0",
      info: { title: "x", version: "1" },
      paths: { "/mixed": body("putMixed", "Mixed"), "/obj": body("putObj", "Obj") },
      components: {
        schemas: {
          Obj: { type: "object", properties: { a: { type: "string" } } },
          Mixed: { type: ["object", "string"], properties: { a: { type: "string" } } },
        },
      },
    };
    await generate(configureBase({ source: spec }), [configureTypescript({ base: { dir } })]);
    const req = await read(dir, "request.d.ts");
    expect(req).toContain("type PutMixed = model.Mixed");
    expect(req).toMatch(/interface PutObj extends model\.Obj/);
  });

  it("内联对象同时有 properties 与 additionalProperties 时追加索引签名", async () => {
    const dir = await tmpDir();
    const spec = {
      openapi: "3.0.0",
      info: { title: "x", version: "1" },
      paths: {
        "/open": { post: { operationId: "postOpen", requestBody: jsonBody({ type: "array", items: item(true) }), responses: ok(ref("Obj")) } },
        "/typed": { post: { operationId: "postTyped", requestBody: jsonBody({ type: "array", items: item({ type: "number" }) }), responses: ok(ref("Obj")) } },
        "/closed": { post: { operationId: "postClosed", requestBody: jsonBody({ type: "array", items: item(false) }), responses: ok(ref("Obj")) } },
      },
      components: { schemas: { Obj: { type: "object", properties: { a: { type: "string" } } } } },
    };
    await generate(configureBase({ source: spec }), [configureTypescript({ base: { dir } })]);
    const req = await read(dir, "request.d.ts");
    expect(req).toContain("type PostOpen = Array<{ a: string; [key: string]: unknown }>");
    expect(req).toContain("type PostTyped = Array<{ a: string; [key: string]: unknown }>");
    expect(req).toContain("type PostClosed = Array<{ a: string }>");
  });
});

describe("Dart 端到端（EDGE_SPEC）", () => {
  it("paths.dart 只引用 models.dart 里存在的类型，字段名去重且避开保留字，字符串已转义", async () => {
    const dir = await tmpDir();
    await generate(configureBase({ source: structuredClone(EDGE_SPEC) }), [configureDart({ base: { dir } })]);
    const models = await read(dir, "models.dart");
    const paths = await read(dir, "paths.dart");

    expect(paths).not.toMatch(/\bUpdateItem\b/);
    expect(paths).not.toMatch(/\bCreateItems\b/);

    // 泛型里出现的每个自定义类型名，都必须能在 models.dart 找到
    const declared = new Set([...models.matchAll(/^(?:class|enum) (\w+)/gm)].map((m) => m[1]));
    const builtin = new Set(["List", "Map", "String", "Object"]);
    const used = new Set<string>();
    for (const m of paths.matchAll(/PathOp<(.+?)>\('/g)) {
      for (const t of m[1].matchAll(/\b[A-Z]\w*\b/g)) used.add(t[0]);
    }
    expect(used.size).toBeGreaterThan(0);
    for (const t of used) if (!builtin.has(t)) expect(declared.has(t), `models.dart 缺少 ${t}`).toBe(true);

    // body-alias 数组 → List<Item>；ref-alias-extends → dynamic
    expect(paths).toContain("static const createItems = PathOp<List<Item>, List<Item>>");
    expect(paths).toContain("static const updateItem = PathOp<dynamic, Item>");

    // 保留字与重名
    expect(paths).toContain("static const class_ =");
    expect(paths).toContain("static const findById =");
    expect(paths).toContain("static const findById2 =");

    // $ 与 ' 的转义
    expect(paths).toContain("'/cost/\\$total'");
    expect(paths).toContain("'/it\\'s'");
  });

  it("可空类型映射：顶层 nullable integer → int?，数组元素 nullable integer → List<int?>，多个非 null 类型 → dynamic", async () => {
    const dir = await tmpDir();
    const spec = {
      openapi: "3.1.0",
      info: { title: "x", version: "1" },
      paths: {
        "/n": { post: { operationId: "postN", requestBody: jsonBody({ type: ["integer", "null"] }), responses: ok(ref("Obj")) } },
        "/list": { post: { operationId: "postList", requestBody: jsonBody({ type: "array", items: { type: ["integer", "null"] } }), responses: ok(ref("Obj")) } },
        "/multi": { post: { operationId: "postMulti", requestBody: jsonBody({ type: ["integer", "string"] }), responses: ok(ref("Obj")) } },
      },
      components: { schemas: { Obj: { type: "object", properties: { a: { type: "string" } } } } },
    };
    await generate(configureBase({ source: spec }), [configureDart({ base: { dir } })]);
    const paths = await read(dir, "paths.dart");
    expect(paths).toContain("static const postN = PathOp<int?, Obj>");
    expect(paths).toContain("static const postList = PathOp<List<int?>, Obj>");
    expect(paths).toContain("static const postMulti = PathOp<dynamic, Obj>");
  });
});
