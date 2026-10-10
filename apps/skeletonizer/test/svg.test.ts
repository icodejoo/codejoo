import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { asEl, FakeEl, stubSvgEnv } from "./helpers.ts";
import type { SvgEnv } from "./helpers.ts";

/** svg 环境桩的状态（生成的 blob / 释放的 URL） */
let env: SvgEnv;

beforeEach(() => {
  vi.resetModules();
  env = stubSvgEnv();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("按主题高光色和时长生成 SVG，写到根的内联变量", async () => {
  const { applySvg } = await import("../src/full/svg.ts");
  const f = new FakeEl();
  f.vars["--skz-duration"] = "750ms";
  expect(applySvg(asEl(f))).toBe(true);
  expect(env.made).toHaveLength(2);
  expect(env.made[0]).toContain('stop-color="#eceff3"');
  expect(env.made[0]).toContain('dur="750ms"');
  expect(env.made[1]).toContain('dur="1500ms"');
  expect(f.props.get("--skz-svg-shimmer")).toBe('url("blob:1")');
  expect(f.props.get("--skz-svg-pulse")).toBe('url("blob:2")');
});

it("applySvg 成功才写 skz-engine=svg；参数没变再调一次仍返回 true", async () => {
  const { applySvg } = await import("../src/full/svg.ts");
  const f = new FakeEl();
  expect(f.getAttribute("skz-engine")).toBeNull();
  expect(applySvg(asEl(f))).toBe(true);
  expect(f.getAttribute("skz-engine")).toBe("svg");
  f.attrs.delete("skz-engine");
  expect(applySvg(asEl(f))).toBe(true);
  expect(f.getAttribute("skz-engine")).toBe("svg");
  expect(env.made).toHaveLength(2);
});

it("releaseSvg 摘掉 skz-engine 和内联变量；没挂过也不报错", async () => {
  const { applySvg, releaseSvg } = await import("../src/full/svg.ts");
  const f = new FakeEl();
  applySvg(asEl(f));
  releaseSvg(asEl(f));
  expect(f.getAttribute("skz-engine")).toBeNull();
  expect(f.props.size).toBe(0);
  expect(() => releaseSvg(asEl(f))).not.toThrow();
});

it("环境不支持 blob：返回 false，摘掉之前挂的东西（含 engine 属性）", async () => {
  const { applySvg } = await import("../src/full/svg.ts");
  const f = new FakeEl();
  expect(applySvg(asEl(f))).toBe(true);
  vi.stubGlobal("Blob", undefined);
  expect(applySvg(asEl(f))).toBe(false);
  expect(f.getAttribute("skz-engine")).toBeNull();
  expect(f.props.size).toBe(0);
});

it("同参数复用同一份 blob；最后一个根释放时才 revoke", async () => {
  const { applySvg, releaseSvg } = await import("../src/full/svg.ts");
  const a = new FakeEl();
  const b = new FakeEl();
  applySvg(asEl(a));
  applySvg(asEl(b));
  expect(env.made).toHaveLength(2);
  releaseSvg(asEl(a));
  expect(env.revoked).toHaveLength(0);
  expect(a.props.size).toBe(0);
  releaseSvg(asEl(b));
  expect(env.revoked).toEqual(["blob:1", "blob:2"]);
});

it("参数变了重新生成并释放旧的；参数没变不重复生成", async () => {
  const { applySvg } = await import("../src/full/svg.ts");
  const f = new FakeEl();
  applySvg(asEl(f));
  applySvg(asEl(f));
  expect(env.made).toHaveLength(2);
  f.vars["--skz-highlight"] = "#ff0000";
  applySvg(asEl(f));
  expect(env.made).toHaveLength(4);
  expect(env.revoked).toEqual(["blob:1", "blob:2"]);
});

it("读不到主题变量（样式表未加载）时不生成、不写 engine，返回 false，退回 fade", async () => {
  const { applySvg } = await import("../src/full/svg.ts");
  const f = new FakeEl();
  f.vars = {};
  expect(applySvg(asEl(f))).toBe(false);
  expect(env.made).toHaveLength(0);
  expect(f.props.size).toBe(0);
  expect(f.getAttribute("skz-engine")).toBeNull();
});
