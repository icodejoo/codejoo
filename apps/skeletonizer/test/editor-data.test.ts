import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { buildCustomData, buildWebTypes, CUSTOM_DATA_FILE, WEB_TYPES_FILE } from "../scripts/gen-editor-data.mjs";
import { SKZ_ATTRIBUTES } from "../src/attributes.js";

/** 包根目录 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * 读包根下的文本文件
 * @param rel 相对包根的路径
 * @returns 文件内容
 * @example read("README.md");
 */
const read = (rel: string): string => readFileSync(path.join(ROOT, rel), "utf8");

/** package.json */
const pkg = JSON.parse(read("package.json")) as { version: string; files: string[]; "web-types"?: string };

/** 数据源里的属性名 */
const NAMES = SKZ_ATTRIBUTES.map((a) => a.name);

/**
 * 取 TS 源码里 SkzHtmlAttributes 声明的键（匹配 `"skz-xxx"?:` 或 `skz?:` 形式的成员）
 * @param src 源码文本
 * @returns 键名数组
 */
function attrKeys(src: string): string[] {
  const keys: string[] = [];
  for (const block of src.matchAll(/interface SkzHtmlAttributes \{([\s\S]*?)\n\s*\}/g)) {
    for (const m of block[1]!.matchAll(/^\s*"?(skz[\w-]*)"?\?:/gm)) keys.push(m[1]!);
  }
  return keys;
}

describe("编辑器提示数据", () => {
  it("生成物与数据源一致（改了 src/attributes.ts 要重新跑 pnpm build / pnpm gen:editor）", () => {
    expect(JSON.parse(read(WEB_TYPES_FILE))).toEqual(buildWebTypes(pkg.version));
    expect(JSON.parse(read(CUSTOM_DATA_FILE))).toEqual(buildCustomData());
  });

  it("web-types.json：每个属性都有说明与文档链接，枚举属性带取值，裸属性无值", () => {
    const attrs = JSON.parse(read(WEB_TYPES_FILE)).contributions.html.attributes as Array<Record<string, any>>;
    expect(attrs.map((a) => a.name)).toEqual(NAMES);
    for (const a of attrs) {
      const def = SKZ_ATTRIBUTES.find((d) => d.name === a.name)!;
      expect(a.description.length).toBeGreaterThan(10);
      expect(a["doc-url"]).toMatch(/^https:\/\/.+#[\w-]+$/);
      if (def.boolean) expect(a.value.kind).toBe("no-value");
      else expect(a.values.map((v: { name: string }) => v.name)).toEqual(def.values);
    }
  });

  it("html-custom-data.json：version 1.1，globalAttributes 的取值与引用来自数据源", () => {
    const data = JSON.parse(read(CUSTOM_DATA_FILE));
    expect(data.version).toBe(1.1);
    expect(data.globalAttributes.map((a: { name: string }) => a.name)).toEqual(NAMES);
    const effect = data.globalAttributes.find((a: { name: string }) => a.name === "skz-effect");
    expect(effect.values.map((v: { name: string }) => v.name)).toEqual(["fade", "solid", "pulse", "shimmer"]);
    for (const a of data.globalAttributes) expect(a.references[0].url).toMatch(/#[\w-]+$/);
  });

  it("数据源的非裸属性都有取值，裸属性没有", () => {
    for (const a of SKZ_ATTRIBUTES) expect(Boolean(a.values?.length)).toBe(!a.boolean);
  });

  it("TS 类型 SkzHtmlAttributes（core + full 的增强）的键与数据源一致", () => {
    const keys = [...attrKeys(read("src/core/types.ts")), ...attrKeys(read("src/full/types.ts"))];
    expect(keys.toSorted()).toEqual(NAMES.toSorted());
  });

  it("枚举取值与 TS 类型一致：skz-effect = SkzEffectMap 的键，skz-text-mode = SkzTextModeMap（core + full）", () => {
    const keysOf = (src: string, iface: string): string[] => {
      const body = new RegExp(String.raw`interface ${iface} \{([\s\S]*?)\n\s*\}`, "g");
      return [...src.matchAll(body)].flatMap((m) => [...m[1]!.matchAll(/^\s*(\w+):\s*true;/gm)].map((k) => k[1]!));
    };
    const core = read("src/core/types.ts");
    const full = read("src/full/types.ts");
    const values = (n: string) => SKZ_ATTRIBUTES.find((a) => a.name === n)!.values!.toSorted();
    expect(keysOf(core, "SkzEffectMap").toSorted()).toEqual(values("skz-effect"));
    expect([...keysOf(core, "SkzTextModeMap"), ...keysOf(full, "SkzTextModeMap")].toSorted()).toEqual(values("skz-text-mode"));
  });

  it("README 两个语言版的属性表都列出了每个属性", () => {
    for (const file of ["README.md", "README.zh-CN.md"]) {
      const text = read(file);
      for (const name of NAMES) expect(text, `${file} 缺少 ${name}`).toContain(`\`${name}\``);
    }
  });

  it("package.json：web-types 字段与 files 都带上两个生成物", () => {
    expect(pkg["web-types"]).toBe(`./${WEB_TYPES_FILE}`);
    expect(pkg.files).toEqual(expect.arrayContaining([WEB_TYPES_FILE, CUSTOM_DATA_FILE]));
  });
});
