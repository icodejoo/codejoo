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

it("shimmer 光带两侧按 smoothstep 缓动：9 个色标，透明度 0 → 1 → 0 对称", async () => {
  const { applySvg } = await import("../src/full/svg.ts");
  applySvg(asEl(new FakeEl()));
  const shimmer = env.made.find((s) => s.includes("animateTransform"));
  const stops = [...(shimmer ?? "").matchAll(/<stop offset="([\d.]+)" stop-color="[^"]+" stop-opacity="([\d.]+)"\/>/g)].map((m) => [Number(m[1]), Number(m[2])]);
  expect(stops).toEqual([
    [0, 0],
    [0.125, 0.156],
    [0.25, 0.5],
    [0.375, 0.844],
    [0.5, 1],
    [0.625, 0.844],
    [0.75, 0.5],
    [0.875, 0.156],
    [1, 0],
  ]);
});

/** 桩一个视口宽（svg 引擎按它取档位、换算光带宽） */
const stubWidth = (w: number): void => void vi.stubGlobal("window", { innerWidth: w });

/** 取生成的 shimmer 图文本 */
const shimmerOf = (): string => env.made.find((s) => s.includes("animateTransform")) ?? "";

it("svg 光带扫过占 62.5%，之后停住：从 -光带宽 走到 100（视口宽），与 CSS 关键帧一致", async () => {
  stubWidth(800);
  const { applySvg } = await import("../src/full/svg.ts");
  applySvg(asEl(new FakeEl()));
  expect(shimmerOf()).toContain('values="-50 0;100 0;100 0" keyTimes="0;0.625;1"');
});

it("光带宽固定 400px，按视口宽换算成 viewBox 单位（400 / innerWidth * 100）", async () => {
  const { applySvg } = await import("../src/full/svg.ts");
  stubWidth(1600);
  applySvg(asEl(new FakeEl()));
  expect(shimmerOf()).toContain('<rect width="25"');
  expect(shimmerOf()).toContain('values="-25 0;100 0;100 0"');
});

it.each([
  [639, "2000ms"],
  [640, "2800ms"],
  [1279, "2800ms"],
  [1280, "3600ms"],
])("没写 --skz-duration：视口 %ipx 取档位时长 %s；pulse 图仍是 2s（来回 4000ms）", async (w, dur) => {
  stubWidth(w);
  const { applySvg } = await import("../src/full/svg.ts");
  applySvg(asEl(new FakeEl()));
  expect(shimmerOf()).toContain(`dur="${dur}"`);
  expect(env.made.find((s) => s.includes("<animate "))).toContain('dur="4000ms"');
});

it("用户写了 --skz-duration：shimmer 与 pulse 都用它，档位不起作用", async () => {
  stubWidth(1920);
  const { applySvg } = await import("../src/full/svg.ts");
  const f = new FakeEl();
  f.vars["--skz-duration"] = "1s";
  applySvg(asEl(f));
  expect(shimmerOf()).toContain('dur="1000ms"');
  expect(env.made.find((s) => s.includes("<animate "))).toContain('dur="2000ms"');
});

it("tierDuration 按断点取最后一个满足的档位", async () => {
  const { tierDuration } = await import("../src/full/svg.ts");
  expect([0, 639, 640, 1279, 1280, 4000].map(tierDuration)).toEqual([2000, 2000, 2800, 2800, 3600, 3600]);
});
