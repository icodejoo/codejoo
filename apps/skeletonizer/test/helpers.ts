/**
 * 测试共用的桩：假元素、假视口观察器、svg 环境桩、模块重置加载。
 * 只放被两个以上测试文件用到的东西；某个文件独有的（如 fit 的布局字段、假 ResizeObserver）留在那个文件里。
 */
import { vi } from "vitest";

/** 假元素的构造选项 */
export interface FakeElOptions {
  /** 主题变量（模拟 getComputedStyle 读到的值），默认带高光色和时长 */
  vars?: Record<string, string>;
  /** 初始子元素：给元素数组，或给个数（自动造空元素） */
  children?: FakeEl[] | number;
  /** 内联样式的实现，默认把 setProperty / removeProperty 记到 props 表 */
  style?: FakeStyle;
}

/** 假的内联样式对象 */
export interface FakeStyle {
  /** 写一个内联变量 / 属性 */
  setProperty(name: string, value: string): void;
  /** 删一个内联变量 / 属性 */
  removeProperty(name: string): void;
}

/** 默认的主题变量：svg 方案生成 blob 时要读的高光色和时长 */
const DEFAULT_VARS = { "--skz-highlight": "#eceff3", "--skz-duration": "1.5s" };

/**
 * 最小假元素：只实现 enable / svg / global / firewall / 宿主样式用到的那部分 DOM 接口。
 * 把它 stub 成全局 HTMLElement 后，`instanceof HTMLElement` 对它成立。
 * @example const f = new FakeEl({ children: 3 }); enable(asEl(f));
 */
export class FakeEl {
  /** 属性表 */
  attrs = new Map<string, string>();
  /** 内联样式 / 自定义属性表（style.setProperty 写到这里） */
  props = new Map<string, string>();
  /** 原生 inert 状态 */
  inert = false;
  /** 标签名 */
  localName = "div";
  /** 主题变量（模拟计算样式） */
  vars: Record<string, string>;
  /** 子元素 */
  children: FakeEl[];
  /** 事件监听表 */
  listeners = new Map<string, (e: { timeStamp: number }) => void>();
  /** 内联样式 */
  style: FakeStyle = {
    setProperty: (k, v): void => void this.props.set(k, v),
    removeProperty: (k): void => void this.props.delete(k),
  };

  /** @param opts 构造选项 */
  constructor(opts: FakeElOptions = {}) {
    this.vars = opts.vars ?? { ...DEFAULT_VARS };
    this.children = Array.isArray(opts.children) ? opts.children : Array.from({ length: opts.children ?? 0 }, () => new FakeEl());
    if (opts.style) this.style = opts.style;
  }

  /**
   * 写属性
   * @param n 属性名
   * @param v 属性值
   */
  setAttribute(n: string, v: string): void {
    this.attrs.set(n, v);
  }

  /**
   * 读属性；style 按内联表是否为空给 "x" / ""（模拟浏览器清空后留下 style=""）
   * @param n 属性名
   * @returns 属性值，没有为 null
   */
  getAttribute(n: string): string | null {
    return n === "style" ? (this.props.size ? "x" : "") : (this.attrs.get(n) ?? null);
  }

  /** @param n 属性名 */
  removeAttribute(n: string): void {
    this.attrs.delete(n);
  }

  /**
   * 切换布尔属性
   * @param n 属性名
   * @param force 是否存在
   */
  toggleAttribute(n: string, force: boolean): void {
    if (force) this.attrs.set(n, "");
    else this.attrs.delete(n);
  }

  /**
   * @param t 事件名
   * @param fn 回调
   */
  addEventListener(t: string, fn: (e: { timeStamp: number }) => void): void {
    this.listeners.set(t, fn);
  }

  /** @param t 事件名 */
  removeEventListener(t: string): void {
    this.listeners.delete(t);
  }

  /** 只支持 [skz-ignore]：本元素是否被标记 */
  matches(): boolean {
    return this.attrs.has("skz-ignore");
  }

  /** 只支持 [skz-ignore]：子孙里有没有被标记的 */
  querySelector(): FakeEl | null {
    for (const c of this.children) {
      if (c.matches()) return c;
      const hit = c.querySelector();
      if (hit) return hit;
    }
    return null;
  }

  /**
   * 追加子元素
   * @param c 子元素；给数字则追加那么多个新的空元素
   * @returns 传元素时返回它本身，传数字时返回新加的元素数组
   */
  add(c: FakeEl): FakeEl;
  add(n: number): FakeEl[];
  add(c: FakeEl | number): FakeEl | FakeEl[] {
    if (typeof c === "number") {
      const out = Array.from({ length: c }, () => new FakeEl());
      this.children.push(...out);
      return out;
    }
    this.children.push(c);
    return c;
  }
}

/**
 * 把假元素当 HTMLElement 用
 * @param f 假元素
 * @returns 同一个对象，类型是 HTMLElement
 */
export const asEl = (f: FakeEl): HTMLElement => f as unknown as HTMLElement;

/** 视口观察器的交叉回调 */
type IOCallback = (entries: { target: FakeEl; isIntersecting: boolean }[]) => void;

/** 假的视口观察器：记录观察目标，测试里手动调 cb 触发交叉；用 vi.stubGlobal("IntersectionObserver", FakeIO) 装上 */
export class FakeIO {
  /** 最近创建的实例 */
  static last: FakeIO | null = null;
  /** 正在观察的元素 */
  targets = new Set<FakeEl>();
  /** 交叉回调 */
  cb: IOCallback;
  /** @param cb 交叉回调 */
  constructor(cb: IOCallback) {
    this.cb = cb;
    FakeIO.last = this;
  }
  /** @param t 目标 */
  observe(t: FakeEl): void {
    this.targets.add(t);
  }
  /** @param t 目标 */
  unobserve(t: FakeEl): void {
    this.targets.delete(t);
  }
}

/** svg 环境桩记录的状态 */
export interface SvgEnv {
  /** 生成过的 blob 文本（按生成顺序，blob URL 为 `blob:<序号>`） */
  made: string[];
  /** 被释放的 URL */
  revoked: string[];
}

/**
 * 装上 svg 方案需要的浏览器环境桩：Blob / URL.createObjectURL / revokeObjectURL / getComputedStyle / matchMedia。
 * 在 beforeEach 里调用；afterEach 里要 vi.unstubAllGlobals() 与 vi.restoreAllMocks()。
 * @returns 记录 blob 生成与释放的状态对象
 * @example const env = stubSvgEnv(); // ... expect(env.made).toHaveLength(2)
 */
export function stubSvgEnv(): SvgEnv {
  const env: SvgEnv = { made: [], revoked: [] };
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
    env.made.push((b as unknown as { text: string }).text);
    return `blob:${env.made.length}`;
  });
  vi.spyOn(URL, "revokeObjectURL").mockImplementation((u) => void env.revoked.push(u));
  vi.stubGlobal("getComputedStyle", (el: FakeEl) => ({ getPropertyValue: (k: string) => el.vars[k] ?? "" }));
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: () => {} }));
  return env;
}

/**
 * 重置模块表后加载一份干净的 core（不带任何扩展）。
 * @returns core 的 enable / disable 与扩展注册函数
 * @example const { enable } = await loadCore();
 */
export async function loadCore(): Promise<{
  enable: typeof import("../src/core/enable.ts").enable;
  disable: typeof import("../src/core/enable.ts").disable;
  registerExtension: typeof import("../src/core/extension.ts").registerExtension;
}> {
  vi.resetModules();
  const { enable, disable } = await import("../src/core/enable.ts");
  const { registerExtension } = await import("../src/core/extension.ts");
  return { enable, disable, registerExtension };
}

/**
 * 重置模块表，加载完整版入口（注册 text / engine / lazy 扩展），并按需注册方案变体（导入即注册）。
 * @param variants 要注册的方案变体，默认不注册
 * @returns 新模块里的 enable 与 registerEngine
 * @example const { enable } = await loadFull(["global"]);
 */
export async function loadFull(variants: Array<"global" | "svg"> = []): Promise<{
  enable: typeof import("../src/core/enable.ts").enable;
  registerEngine: typeof import("../src/full/engine.ts").registerEngine;
}> {
  vi.resetModules();
  const { enable } = await import("../src/core/enable.ts");
  await import("../src/full/index.ts");
  // 注册顺序决定方案表的顺序，必须按序逐个导入，不能并发
  // eslint-disable-next-line no-await-in-loop
  for (const v of variants) await import(`../src/full/variants/${v}.ts`);
  const { registerEngine } = await import("../src/full/engine.ts");
  return { enable, registerEngine };
}

/**
 * 重新加载一份干净的完整版并按需注册变体，只取 enable。
 * @param variants 要注册的变体
 * @returns 新模块里的 enable
 * @example const en = await fresh(["global", "svg"]);
 */
export async function fresh(variants: Array<"global" | "svg">): Promise<typeof import("../src/core/enable.ts").enable> {
  return (await loadFull(variants)).enable;
}
