import { describe, it, expect } from "vite-plus/test";

import { configureBase } from "../src/config/shared";
import { buildMegaSchema, HTTP_METHOD_ORDER, isHttpMethod, loadOpenAPI, opKey, type MegaSchemaResult, type OpenAPIDoc } from "../src/schema";
import { ALLOF_SPEC, EDGE_SPEC, jsonBody, KEYWORD_PROPS_SPEC, ok, ref } from "./specs";

const base = configureBase({ source: {} });

/** 直接对已是 v3 的对象建 mega-schema */
function build(spec: OpenAPIDoc, cfg = base): MegaSchemaResult {
  return buildMegaSchema(spec, cfg);
}

/** 按 operationId 找 op */
function opOf(meta: MegaSchemaResult, operationId: string) {
  const op = meta.ops.find((o) => o.operationId === operationId);
  if (!op) throw new Error(`找不到 op ${operationId}`);
  return op;
}

describe("walk：属性名不当关键字处理", () => {
  const meta = build(KEYWORD_PROPS_SPEC);
  const props = meta.schema.definitions.Kw.properties;

  it("default / example / pattern / minimum / nullable / deprecated / x-foo / title / enum 属性都保留", () => {
    for (const name of ["default", "example", "pattern", "minimum", "nullable", "deprecated", "x-foo", "title", "enum"]) {
      expect(props, name).toHaveProperty(name);
      expect(props[name].type, name).toBeDefined();
    }
  });

  it("properties 字典里不会被塞进多余的 description 键", () => {
    expect(Object.keys(props)).not.toContain("description");
    expect(Object.keys(props)).toHaveLength(9);
  });

  it("required 里的 default 不受影响", () => {
    expect(meta.schema.definitions.Kw.required).toEqual(["default"]);
  });
});

describe("enum 处理", () => {
  const spec = {
    openapi: "3.0.0",
    info: { title: "e", version: "1" },
    paths: {},
    components: {
      schemas: {
        Status: { type: "string", enum: ["on", "off"] },
        Holder: {
          type: "object",
          properties: {
            s: { type: "string", enum: ["on", "off"] }, // 与 Status 同一集合，应复用
            n: { type: "string", enum: ["a"], nullable: true },
            p1: { type: "string", enum: ["a", "b"] },
            p2: { type: "string", enum: ["a|s:b"] }, // 旧实现的 key 会与 p1 撞
          },
        },
      },
    },
  };

  it("顶层 enum 组件保持原定义，不会变成指向自己的 $ref", () => {
    const meta = build(spec);
    const status = meta.schema.definitions.Status;
    expect(status.enum).toEqual(["on", "off"]);
    expect(status.$ref).toBeUndefined();
  });

  it("嵌套的同值 enum 复用顶层名字", () => {
    const meta = build(spec);
    expect(meta.schema.definitions.Holder.properties.s.$ref).toBe("#/definitions/Status");
  });

  it("enumKey 对含分隔符的字面量不撞 key", () => {
    const meta = build(spec);
    const { p1, p2 } = meta.schema.definitions.Holder.properties;
    expect(p1.$ref).not.toBe(p2.$ref);
  });

  it("nullable enum 只改拷贝，不污染源文档", () => {
    const frozen = structuredClone(spec);
    const meta = build(spec);
    expect(spec).toEqual(frozen);
    const nRef = meta.schema.definitions.Holder.properties.n.$ref.replace("#/definitions/", "");
    expect(meta.schema.definitions[nRef].enum).toEqual(["a", null]);
  });

  it("响应是 enum 时分类为 ref，数组元素是 enum 时分类为 array-of-ref", () => {
    const meta = build(EDGE_SPEC);
    const single = meta.responseRefOf.get(opKey("/status", "get"));
    expect(single?.kind).toBe("ref");
    const arr = meta.responseRefOf.get(opKey("/statuses", "get"));
    expect(arr?.kind).toBe("array-of-ref");
    if (single?.kind === "ref") expect(meta.schema.definitions[single.name].enum).toEqual(["on", "off"]);
  });
});

describe("allOf 拍平", () => {
  const defs = build(ALLOF_SPEC).schema.definitions;

  it("allOf[$ref A, inline{b}] 合并成含 a、b 的单个对象", () => {
    const b = defs.B;
    expect(b.allOf).toBeUndefined();
    expect(Object.keys(b.properties)).toEqual(["a", "b"]);
    expect(b.required).toEqual(["a", "b"]);
    expect(b.additionalProperties).toBe(false);
    expect(b.description).toBe("B 的说明");
  });

  it("单成员 allOf 保持原样（引用交给 quicktype 复用）", () => {
    expect(defs.C.allOf).toHaveLength(1);
  });

  it("循环引用的 allOf 放弃拍平且不抛错", () => {
    expect(defs.P.allOf).toBeDefined();
    expect(defs.Q.allOf).toBeDefined();
  });

  it("nullable + allOf：外层 oneOf，内层照样拍平", () => {
    const prop = defs.Holder.properties.b;
    expect(prop.oneOf).toHaveLength(2);
    expect(Object.keys(prop.oneOf[0].properties)).toEqual(["a", "z"]);
    expect(prop.oneOf[1]).toEqual({ type: "null" });
  });

  it("allOf 成员不是对象型（含 oneOf）时保持原样", () => {
    const meta = build({
      openapi: "3.0.0",
      info: { title: "x", version: "1" },
      paths: {},
      components: { schemas: { U: { oneOf: [{ type: "string" }, { type: "integer" }] }, M: { allOf: [ref("U"), { type: "object", properties: { m: { type: "string" } } }] } } },
    });
    expect(meta.schema.definitions.M.allOf).toHaveLength(2);
  });

  it("allOf body 能被 inlineableObjectProps 拍平进 req", () => {
    const meta = build({
      openapi: "3.0.0",
      info: { title: "x", version: "1" },
      paths: { "/b": { post: { operationId: "postB", requestBody: jsonBody({ allOf: [ref("A"), { type: "object", properties: { extra: { type: "string" } } }] }), responses: ok(ref("A")) } } },
      components: { schemas: { A: { type: "object", required: ["a"], properties: { a: { type: "string" } } } } },
    });
    expect(meta.reqInfoOf.get(opKey("/b", "post"))?.kind).toBe("normal");
    expect(Object.keys(meta.schema.definitions.PostB.properties)).toEqual(["a", "extra"]);
  });
});

/** 用给定的 schemas 建一个只含 components 的文档 */
const docOf = (schemas: Record<string, unknown>): OpenAPIDoc => ({ openapi: "3.0.0", info: { title: "x", version: "1" }, paths: {}, components: { schemas } });

/** 只有一个属性 x 的对象 schema */
const objOf = (x: unknown) => ({ type: "object", properties: { x } });

describe("allOf 拍平：冲突、additionalProperties、别名包装", () => {
  const strictish = { type: "string", enum: ["a"] };
  const loose = { type: "string" };

  it("同名属性内容不同：合成 allOf 保留两边约束，且与成员顺序无关", () => {
    const forward = build(docOf({ M: { allOf: [objOf(strictish), objOf(loose)] } })).schema.definitions.M;
    const backward = build(docOf({ M: { allOf: [objOf(loose), objOf(strictish)] } })).schema.definitions.M;
    // 两份约束都在：一份带 enum（可能已被提升成 $ref），一份是裸 string
    for (const x of [forward.properties.x, backward.properties.x]) {
      expect(x.allOf).toHaveLength(2);
      expect(x.allOf.filter((m: any) => m.enum !== undefined || m.$ref !== undefined)).toHaveLength(1);
      expect(x.allOf.filter((m: any) => m.type === "string" && m.enum === undefined)).toHaveLength(1);
    }
  });

  it("同名属性内容相同不重复；三份冲突时把新的追加进已合成的 allOf", () => {
    const same = build(docOf({ M: { allOf: [objOf(loose), objOf(loose)] } })).schema.definitions.M;
    expect(same.properties.x).toEqual(build(docOf({ M: objOf(loose) })).schema.definitions.M.properties.x);
    const triple = build(docOf({ M: { allOf: [objOf(loose), objOf({ type: "integer" }), objOf({ type: "integer" }), objOf({ type: "boolean" })] } })).schema.definitions.M;
    expect(triple.properties.x.allOf).toHaveLength(3);
  });

  it("strictObjects=false：任一方显式 additionalProperties:false 就是 false，否则沿用成员的值", () => {
    const loosely = configureBase({ source: {}, strictObjects: false });
    const closed = build(
      docOf({
        A: { type: "object", properties: { a: { type: "string" } }, additionalProperties: false },
        B: { allOf: [ref("A"), { type: "object", properties: { b: { type: "string" } } }] },
        C: { allOf: [{ type: "object", properties: { a: { type: "string" } } }, { type: "object", properties: { b: { type: "string" } }, additionalProperties: { type: "number" } }], additionalProperties: false },
        D: { allOf: [{ type: "object", properties: { a: { type: "string" } } }, { type: "object", properties: { b: { type: "string" } }, additionalProperties: { type: "number" } }] },
        E: { allOf: [{ type: "object", properties: { a: { type: "string" } } }, { type: "object", properties: { b: { type: "string" } } }] },
      }),
      loosely,
    ).schema.definitions;
    expect(closed.B.additionalProperties).toBe(false);
    expect(closed.C.additionalProperties).toBe(false);
    expect(closed.D.additionalProperties).toEqual({ type: "number" });
    expect("additionalProperties" in closed.E).toBe(false);
  });

  it("单成员 allOf 别名包装不会阻断外层拍平", () => {
    const defs = build(
      docOf({
        A: { type: "object", required: ["a"], properties: { a: { type: "string" } } },
        Alias: { allOf: [ref("A")] },
        InlineAlias: { allOf: [{ allOf: [{ type: "object", properties: { i: { type: "string" } } }] }] },
        B: { allOf: [ref("Alias"), { type: "object", required: ["b"], properties: { b: { type: "integer" } } }] },
        B2: { allOf: [ref("InlineAlias"), { type: "object", properties: { b: { type: "integer" } } }] },
      }),
    ).schema.definitions;
    expect(defs.B.allOf).toBeUndefined();
    expect(Object.keys(defs.B.properties)).toEqual(["a", "b"]);
    expect(defs.B.required).toEqual(["a", "b"]);
    expect(Object.keys(defs.B2.properties)).toEqual(["i", "b"]);
    // 别名组件自己的定义保持不动
    expect(defs.Alias.allOf).toHaveLength(1);
  });

  it("别名包装成环时放弃拍平且不抛错", () => {
    const defs = build(
      docOf({
        X: { allOf: [ref("Y")] },
        Y: { allOf: [ref("X")] },
        Z: { allOf: [ref("X"), { type: "object", properties: { z: { type: "string" } } }] },
      }),
    ).schema.definitions;
    expect(defs.Z.allOf).toHaveLength(2);
  });
});

describe("本地 $ref 解析（v3 Reference Object）", () => {
  const meta = build(EDGE_SPEC);

  it("path-level 与 op-level 的 parameter $ref 都被解开", () => {
    expect(opOf(meta, "listItems").params.map((p) => p.name)).toEqual(expect.arrayContaining(["limit", "Tag", "status"]));
    expect(opOf(meta, "updateItem").params.map((p) => p.name)).toEqual(["id", "X-Request-Id"]);
  });

  it("response $ref 被解开：PUT 响应分类为 ref Item", () => {
    expect(meta.responseRefOf.get(opKey("/items/{id}", "put"))).toEqual({ kind: "ref", name: "Item" });
  });

  it("requestBody $ref 被解开", () => {
    const m = build({
      openapi: "3.0.0",
      info: { title: "x", version: "1" },
      paths: { "/p": { post: { operationId: "postP", requestBody: { $ref: "#/components/requestBodies/PetBody" }, responses: ok(ref("Pet")) } } },
      components: {
        requestBodies: { PetBody: jsonBody(ref("Pet")) },
        schemas: { Pet: { type: "object", properties: { n: { type: "string" } } } },
      },
    });
    expect(opOf(m, "postP").body?.schema).toEqual(ref("Pet"));
  });

  it("支持链式引用、~1 / ~0 转义；解不出来的引用静默忽略而不抛错", () => {
    const m = build({
      openapi: "3.0.0",
      info: { title: "x", version: "1" },
      paths: {
        "/p": {
          get: {
            operationId: "getP",
            parameters: [{ $ref: "#/x-defs/a~1b" }, { $ref: "#/x-defs/chain1" }, { $ref: "#/x-defs/missing" }, { $ref: "#/x-defs/loop1" }],
            responses: ok(ref("Pet")),
          },
        },
      },
      "x-defs": {
        "a/b": { name: "slash", in: "query", schema: { type: "string" } },
        chain1: { $ref: "#/x-defs/chain2" },
        chain2: { name: "chained", in: "query", schema: { type: "string" } },
        loop1: { $ref: "#/x-defs/loop2" },
        loop2: { $ref: "#/x-defs/loop1" },
      },
      components: { schemas: { Pet: { type: "object", properties: { n: { type: "string" } } } } },
    });
    expect(opOf(m, "getP").params.map((p) => p.name)).toEqual(["slash", "chained"]);
  });

  it("百分号编码按 RFC 6901 先整体解码再分段：%2F 是路径分隔符，~1 才是键里的斜杠", () => {
    const m = build({
      openapi: "3.0.0",
      info: { title: "x", version: "1" },
      paths: { "/p": { get: { operationId: "getP", parameters: [{ $ref: "#/x-defs/a%2Fb" }, { $ref: "#/x-defs/a~1b" }, { $ref: "#/x-defs/bad%zz" }], responses: ok(ref("Pet")) } } },
      "x-defs": {
        a: { b: { name: "nested", in: "query", schema: { type: "string" } } },
        "a/b": { name: "slashKey", in: "query", schema: { type: "string" } },
        "bad%zz": { name: "literal", in: "query", schema: { type: "string" } },
      },
      components: { schemas: { Pet: { type: "object", properties: { n: { type: "string" } } } } },
    });
    expect(opOf(m, "getP").params.map((p) => p.name)).toEqual(["nested", "slashKey", "literal"]);
  });
});

describe("Swagger 2.0 归一化", () => {
  const v2 = {
    swagger: "2.0",
    info: { title: "v2", version: "1" },
    produces: ["application/json"],
    paths: {
      "/pets": { get: { operationId: "listPets", responses: { "200": { $ref: "#/responses/PetOk" } } } },
    },
    responses: { PetOk: { description: "ok", schema: { $ref: "#/definitions/Pet" }, examples: { "application/json": {} } } },
    definitions: { Pet: { type: "object", properties: { name: { type: "string" } } } },
  };

  it("顶层共享 response（#/responses/X）能被解析成 ref", async () => {
    const doc = await loadOpenAPI(structuredClone(v2), process.cwd());
    const resp = doc.components.responses.PetOk;
    expect(resp.schema).toBeUndefined();
    expect(resp.examples).toBeUndefined();
    expect(resp.content["application/json"].schema).toEqual({ $ref: "#/components/schemas/Pet" });
    const meta = buildMegaSchema(doc, base);
    expect(meta.responseRefOf.get(opKey("/pets", "get"))).toEqual({ kind: "ref", name: "Pet" });
  });
});

describe("加载校验", () => {
  it("根节点不是对象时给出明确错误（数组 / null / 标量）", async () => {
    await expect(loadOpenAPI("[1, 2]", process.cwd())).rejects.toThrow(/根节点必须是对象.*数组.*inline\.json/);
    await expect(loadOpenAPI("- a\n- b\n", process.cwd())).rejects.toThrow(/根节点必须是对象.*inline\.yaml/);
    await expect(loadOpenAPI(null as unknown as Record<string, unknown>, process.cwd())).rejects.toThrow(/根节点必须是对象.*null/);
  });
});

describe("命名与方法表", () => {
  it("HTTP_METHOD_ORDER 含 trace，isHttpMethod 与 configureBase 默认值都引用它", () => {
    expect(HTTP_METHOD_ORDER).toEqual(["get", "post", "put", "delete", "patch", "options", "head", "trace"]);
    expect(isHttpMethod("TRACE")).toBe(true);
    expect(isHttpMethod("connect")).toBe(false);
    expect(base.httpMethodOrder).toBe(HTTP_METHOD_ORDER);
    expect(build(EDGE_SPEC).ops.some((o) => o.method === "trace")).toBe(true);
  });

  it("conflictSuffix 永远返回已占用名字时抛出明确错误，而不是死循环", () => {
    const cfg = configureBase({ source: {}, conflictSuffix: () => "Item" });
    const spec = {
      openapi: "3.0.0",
      info: { title: "x", version: "1" },
      paths: { "/i": { get: { operationId: "item", responses: ok(ref("Item")) } } },
      components: { schemas: { Item: { type: "object", properties: { a: { type: "string" } } } } },
    };
    expect(() => build(spec, cfg)).toThrow(/conflictSuffix/);
  });
});
