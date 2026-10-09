import { afterEach, beforeEach, expect, it, vi } from "vitest";

/** 最小假元素：内联自定义属性 */
class FakeEl {
  /** 内联自定义属性 */
  props = new Map<string, string>();
  /** 主题变量（模拟计算样式） */
  vars: Record<string, string> = { "--skz-highlight": "#eceff3", "--skz-duration": "1.5s" };
  /** 内联样式的最小实现 */
  style = {
    setProperty: (k: string, v: string): void => void this.props.set(k, v),
    removeProperty: (k: string): void => void this.props.delete(k),
  };
  /** 普通属性表（skz-engine 等） */
  attrs = new Map<string, string>();
  /** @param n 属性名 */
  getAttribute(n: string): string | null {
    return n === "style" ? (this.props.size ? "x" : "") : (this.attrs.get(n) ?? null);
  }
  /**
   * 写属性
   * @param n 属性名
   * @param v 属性值
   */
  setAttribute(n: string, v: string): void {
    this.attrs.set(n, v);
  }
  /** @param n 属性名 */
  removeAttribute(n: string): void {
    this.attrs.delete(n);
  }
}

/** 把假元素当 HTMLElement 用 */
const asEl = (f: FakeEl): HTMLElement => f as unknown as HTMLElement;

/** 生成过的 blob 文本 */
let made: string[] = [];
/** 被释放的 URL */
let revoked: string[] = [];

beforeEach(() => {
  vi.resetModules();
  made = [];
  revoked = [];
  vi.stubGlobal(
    "Blob",
    class {
      /** 内容 */
      text: string;
      /** @param parts 内容片段 */
      constructor(parts: string[]) {
        this.text = parts.join("");
      }
    },
  );
  // 只替换两个方法；整个替换 URL 会弄坏测试框架自己的模块加载
  vi.spyOn(URL, "createObjectURL").mockImplementation((b) => {
    made.push((b as unknown as { text: string }).text);
    return `blob:${made.length}`;
  });
  vi.spyOn(URL, "revokeObjectURL").mockImplementation((u) => void revoked.push(u));
  vi.stubGlobal("getComputedStyle", (el: FakeEl) => ({ getPropertyValue: (k: string) => el.vars[k] ?? "" }));
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: () => {} }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("按主题高光色和时长生成 SVG，写到根的内联变量", async () => {
  const { applySvg } = await import("../src/svg.ts");
  const f = new FakeEl();
  f.vars["--skz-duration"] = "750ms";
  expect(applySvg(asEl(f))).toBe(true);
  expect(made).toHaveLength(2);
  expect(made[0]).toContain('stop-color="#eceff3"');
  expect(made[0]).toContain('dur="750ms"');
  expect(made[1]).toContain('dur="1500ms"');
  expect(f.props.get("--skz-svg-shimmer")).toBe('url("blob:1")');
  expect(f.props.get("--skz-svg-pulse")).toBe('url("blob:2")');
});

it("applySvg 成功才写 skz-engine=svg；参数没变再调一次仍返回 true", async () => {
  const { applySvg } = await import("../src/svg.ts");
  const f = new FakeEl();
  expect(f.getAttribute("skz-engine")).toBeNull();
  expect(applySvg(asEl(f))).toBe(true);
  expect(f.getAttribute("skz-engine")).toBe("svg");
  f.attrs.delete("skz-engine");
  expect(applySvg(asEl(f))).toBe(true);
  expect(f.getAttribute("skz-engine")).toBe("svg");
  expect(made).toHaveLength(2);
});

it("releaseSvg 摘掉 skz-engine 和内联变量；没挂过也不报错", async () => {
  const { applySvg, releaseSvg } = await import("../src/svg.ts");
  const f = new FakeEl();
  applySvg(asEl(f));
  releaseSvg(asEl(f));
  expect(f.getAttribute("skz-engine")).toBeNull();
  expect(f.props.size).toBe(0);
  expect(() => releaseSvg(asEl(f))).not.toThrow();
});

it("环境不支持 blob：返回 false，摘掉之前挂的东西（含 engine 属性）", async () => {
  const { applySvg } = await import("../src/svg.ts");
  const f = new FakeEl();
  expect(applySvg(asEl(f))).toBe(true);
  vi.stubGlobal("Blob", undefined);
  expect(applySvg(asEl(f))).toBe(false);
  expect(f.getAttribute("skz-engine")).toBeNull();
  expect(f.props.size).toBe(0);
});

it("同参数复用同一份 blob；最后一个根释放时才 revoke", async () => {
  const { applySvg, releaseSvg } = await import("../src/svg.ts");
  const a = new FakeEl();
  const b = new FakeEl();
  applySvg(asEl(a));
  applySvg(asEl(b));
  expect(made).toHaveLength(2);
  releaseSvg(asEl(a));
  expect(revoked).toHaveLength(0);
  expect(a.props.size).toBe(0);
  releaseSvg(asEl(b));
  expect(revoked).toEqual(["blob:1", "blob:2"]);
});

it("参数变了重新生成并释放旧的；参数没变不重复生成", async () => {
  const { applySvg } = await import("../src/svg.ts");
  const f = new FakeEl();
  applySvg(asEl(f));
  applySvg(asEl(f));
  expect(made).toHaveLength(2);
  f.vars["--skz-highlight"] = "#ff0000";
  applySvg(asEl(f));
  expect(made).toHaveLength(4);
  expect(revoked).toEqual(["blob:1", "blob:2"]);
});

it("读不到主题变量（样式表未加载）时不生成、不写 engine，返回 false，退回 fade", async () => {
  const { applySvg } = await import("../src/svg.ts");
  const f = new FakeEl();
  f.vars = {};
  expect(applySvg(asEl(f))).toBe(false);
  expect(made).toHaveLength(0);
  expect(f.props.size).toBe(0);
  expect(f.getAttribute("skz-engine")).toBeNull();
});
