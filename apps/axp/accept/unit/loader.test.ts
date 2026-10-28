import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_SCENARIOS } from "../lib/constants.ts";
import { domainOf, loadScenarios, LoaderError, validateScenarios } from "../lib/loader.ts";

/** 临时目录清单，测试后统一删除 */
const dirs: string[] = [];
function tmp(files: Record<string, string>): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "accept-loader-"));
  dirs.push(d);
  for (const [n, c] of Object.entries(files)) fs.writeFileSync(path.join(d, n), c);
  return d;
}
afterEach(() => {
  while (dirs.length) fs.rmSync(dirs.pop() as string, { recursive: true, force: true });
});

const sc = (id: string) => ({ id, title: "t", requires: [], networks: ["normal"], steps: [{ wait: 1 }], expect: { "*": {} } });

describe("loader", () => {
  it("按文件名排序读取，并标注来源文件", () => {
    const d = tmp({ "b.json": JSON.stringify([sc("b.one")]), "a.json": JSON.stringify([sc("a.one"), sc("a.two")]), "README.md": "# x" });
    const list = loadScenarios(d, { validate: false });
    expect(list.map((s) => s.id)).toEqual(["a.one", "a.two", "b.one"]);
    expect(list[0]?.file).toBe("a.json");
  });

  it("目录不存在 / JSON 非法 / 顶层不是数组 都抛 LoaderError", () => {
    expect(() => loadScenarios(path.join(os.tmpdir(), "no-such-dir-xyz"), { validate: false })).toThrow(LoaderError);
    expect(() => loadScenarios(tmp({ "x.json": "{bad" }), { validate: false })).toThrow(/不是合法 JSON/);
    expect(() => loadScenarios(tmp({ "x.json": "{}" }), { validate: false })).toThrow(/顶层必须是数组/);
  });

  it("找不到 validate.mjs 时跳过校验并视为通过", () => {
    const d = tmp({ "a.json": JSON.stringify([sc("a.one")]) });
    expect(validateScenarios(d)).toMatchObject({ ran: false, ok: true });
  });

  it("领域取 id 第一个点之前的部分", () => {
    expect(domainOf("auth.deny-403")).toBe("auth");
    expect(domainOf("conc.barrier-asc")).toBe("conc");
  });

  const real = fs.existsSync(path.join(DEFAULT_SCENARIOS, "..", "tools", "validate.mjs"));
  it.skipIf(!real)("真实 testkit 场景：调用 validate.mjs 通过且数量合理", () => {
    const v = validateScenarios(DEFAULT_SCENARIOS);
    expect(v.ran).toBe(true);
    expect(v.ok).toBe(true);
    expect(loadScenarios(DEFAULT_SCENARIOS).length).toBeGreaterThan(300);
  });

  it.skipIf(!real)("校验失败（重复 id）时抛 LoaderError 并带上 validate 的输出", () => {
    // 把 tools 链进临时目录的上一级，让 validate.mjs 能被找到
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "accept-validate-"));
    dirs.push(root);
    fs.cpSync(path.join(DEFAULT_SCENARIOS, "..", "tools"), path.join(root, "tools"), { recursive: true });
    fs.copyFileSync(path.join(DEFAULT_SCENARIOS, "..", "scenario.schema.json"), path.join(root, "scenario.schema.json"));
    fs.mkdirSync(path.join(root, "scenarios"));
    fs.writeFileSync(path.join(root, "scenarios", "a.json"), JSON.stringify([sc("a.dup"), sc("a.dup")]));
    expect(() => loadScenarios(path.join(root, "scenarios"))).toThrow(/场景校验失败/);
  });
});
