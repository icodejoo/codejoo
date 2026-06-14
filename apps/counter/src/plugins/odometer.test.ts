import { describe, expect, it } from "vitest";
import { createOdometerRender } from "./odometer";
import type { ICountupRenderContext } from "../count-up/type";

const NF = new Intl.NumberFormat();

/** 构造渲染上下文；默认 from=to=value、fmt 为 Intl 默认（千分位） */
function ctx(value: number, from: number = value, to: number = value, fmt: (n: number) => string = NF.format): ICountupRenderContext {
  return { value, from, to, fmt, id: 0, active: true, paused: false };
}

function root(host: Element) {
  return host.querySelector(".cd-root") as HTMLElement;
}
function items(host: Element) {
  return Array.from(root(host).children) as HTMLElement[];
}
function strips(host: Element) {
  return Array.from(host.querySelectorAll(".cd-odometer-num")) as HTMLElement[];
}
function visibleStrips(host: Element) {
  return strips(host).filter((s) => !(s.parentElement as HTMLElement).classList.contains("cd-hidden"));
}
function visibleSeps(host: Element) {
  return items(host).filter((it) => it.classList.contains("cd-sep") && !it.classList.contains("cd-hidden"));
}
function topDigit(strip: HTMLElement): string | null {
  return strip.children[0].textContent;
}
/** 从 transform "translateY(calc(var(--cd-cell-height, 1.25em) * -0.5))" 取出平移量 */
function shift(strip: HTMLElement): number {
  const m = strip.style.transform.match(/\*\s*(-?[\d.]+)\)/);
  return m ? -Number(m[1]) : 0;
}

const MODES = ["minimal", "full"] as const;

// ====================== 两种模式共享的结构 / 生命周期 ======================
for (const strip of MODES) {
  describe(`createOdometerRender [strip:${strip}] 结构与生命周期`, () => {
    const make = (o: object = {}) => createOdometerRender({ strip, ...o });
    const cells = strip === "full" ? 11 : 2; // 动画中每位的格数

    it("构建 ul.cd-root.cd-odometer-root，每个数字位一条长条", () => {
      const host = document.createElement("div");
      make()(host, NF.format(12), ctx(12, 0, 99)); // value≠to，不落定
      const ul = root(host);
      expect(ul.tagName).toBe("UL");
      expect(ul.classList.contains("cd-root") && ul.classList.contains("cd-odometer-root")).toBe(true);
      const ss = strips(host);
      expect(ss.length).toBe(2);
      expect(ss.every((s) => s.classList.contains("cd-num") && s.classList.contains("cd-odometer-num"))).toBe(true);
      expect(ss[0].children.length).toBe(cells);
    });

    it("分隔符渲染为 li.cd-sep，不是长条", () => {
      const host = document.createElement("div");
      make()(host, NF.format(1234), ctx(1234, 0, 9999));
      const its = items(host);
      expect(its.length).toBe(5);
      expect(its[1].classList.contains("cd-sep")).toBe(true);
      expect(its[1].textContent).toBe(",");
      expect(strips(host).length).toBe(4);
    });

    it("按 from/to 预建最大宽度，动画中不重建结构", () => {
      const host = document.createElement("div");
      const r = make();
      r(host, NF.format(0), ctx(0, 0, 1234567));
      expect(strips(host).length).toBe(7);
      const r0 = root(host);
      r(host, NF.format(12345), ctx(12345, 0, 1234567));
      r(host, NF.format(999999), ctx(999999, 0, 1234567));
      expect(root(host)).toBe(r0); // 同一 ul，未重建
      expect(strips(host).length).toBe(7);
    });

    it("用 ctx.formatter 精确定宽（无分组 formatter 不塞逗号）", () => {
      const host = document.createElement("div");
      const plain = (n: number) => String(Math.trunc(n));
      make()(host, plain(0), ctx(0, 0, 1234567, plain));
      expect(strips(host).length).toBe(7);
      expect(items(host).length).toBe(7); // 无分隔符
    });

    it("默认隐藏前导零，随数值增大逐位显现", () => {
      const host = document.createElement("div");
      const r = make();
      r(host, NF.format(0), ctx(0, 0, 9999));
      expect(visibleStrips(host).length).toBe(1); // 至少显示个位 "0"
      r(host, NF.format(42), ctx(42, 0, 9999));
      expect(visibleStrips(host).length).toBe(2);
      r(host, NF.format(4200), ctx(4200, 0, 9999));
      expect(visibleStrips(host).length).toBe(4);
      expect(visibleSeps(host).length).toBe(1); // "4,200"
    });

    it("leadingZeros:true 时保留前导零", () => {
      const host = document.createElement("div");
      const r = make({ leadingZeros: true });
      r(host, NF.format(0), ctx(0, 0, 1234567));
      r(host, NF.format(12345), ctx(12345, 0, 1234567));
      expect(visibleStrips(host).length).toBe(7);
    });

    it("倒数落定时裁剪到目标宽度", () => {
      const host = document.createElement("div");
      const r = make();
      r(host, NF.format(9999999), ctx(9999999, 9999999, 5)); // 预建 7 位
      expect(strips(host).length).toBe(7);
      r(host, NF.format(5), ctx(5, 9999999, 5)); // settle
      expect(strips(host).length).toBe(1);
    });

    it("落定后每位塌缩为单格静态显示", () => {
      const host = document.createElement("div");
      const r = make();
      r(host, NF.format(120), ctx(120, 0, 543));
      expect(strips(host)[0].children.length).toBe(cells); // 动画中
      r(host, NF.format(543), ctx(543, 0, 543)); // 落定 value===to
      const ss = strips(host);
      expect(ss.map((s) => s.children.length)).toEqual([1, 1, 1]); // 都塌缩为单格
      expect(ss.map((s) => s.textContent).join("")).toBe("543");
      expect(ss[0].style.transform).toBe(""); // transform 清零
    });

    it("塌缩后开启新动画会重建长条", () => {
      const host = document.createElement("div");
      const r = make();
      r(host, NF.format(5), ctx(5, 0, 5)); // 瞬时落定 → 塌缩
      expect(strips(host)[0].children.length).toBe(1);
      r(host, NF.format(0), ctx(0, 0, 99)); // 新动画（不同 to）
      expect(strips(host)[0].children.length).toBe(cells); // 重建为该模式的格数
    });
  });
}

// ====================== minimal 模式专属：双格 + 文本切换 ======================
describe("createOdometerRender minimal 定位", () => {
  it("仅在每位步进的最后 rollWindow 段滚动，停得干净", () => {
    const host = document.createElement("div");
    const r = createOdometerRender({ rollWindow: 0.2 }); // T = 0.8
    const one = (v: number) =>
      r(
        host,
        "0",
        ctx(v, 0, 99, () => "0"),
      ); // 单位数结构、不落定
    one(0);
    const ones = strips(host)[0];
    one(3.5); // frac .5 < .8 → 不滚
    expect(topDigit(ones)).toBe("3");
    expect(ones.children[1].textContent).toBe("4"); // bottom = 下一数字
    expect(shift(ones)).toBeCloseTo(0, 5);
    one(3.9); // frac .9 → 滚 (.9-.8)/.2 = .5
    expect(shift(ones)).toBeCloseTo(0.5, 5);
    one(4); // 进位落定
    expect(topDigit(ones)).toBe("4");
    expect(shift(ones)).toBeCloseTo(0, 5);
  });

  it("9→0 经 bottom 格无缝（top=9, bottom=0）", () => {
    const host = document.createElement("div");
    createOdometerRender()(
      host,
      "0",
      ctx(9, 9, 0, () => "0"),
    );
    const ones = strips(host)[0];
    expect(topDigit(ones)).toBe("9");
    expect(ones.children[1].textContent).toBe("0");
  });

  it("只改文本节点数据，不替换节点", () => {
    const host = document.createElement("div");
    const r = createOdometerRender();
    r(host, NF.format(0), ctx(0, 0, 9));
    const ones = strips(host)[0];
    const textNode = ones.children[0].firstChild;
    r(host, NF.format(7), ctx(7, 0, 9));
    expect(ones.children[0].firstChild).toBe(textNode); // 同一节点
    expect(textNode!.textContent).toBe("7");
  });

  it("平移以 --cd-cell-height 为单位，且只表达 roll(0~1)", () => {
    const host = document.createElement("div");
    const r = createOdometerRender({ rollWindow: 1 }); // 全程滚动
    r(
      host,
      "0",
      ctx(7.5, 0, 99, () => "0"),
    ); // frac .5 → roll .5
    const t = strips(host)[0].style.transform;
    expect(t).toContain("var(--cd-cell-height, 1.25em)");
    expect(shift(strips(host)[0])).toBeCloseTo(0.5, 5); // minimal 平移=roll
  });
});

// ====================== full 模式专属：11 格整体平移 ======================
describe("createOdometerRender full 定位", () => {
  it("长条含 0-9 + 尾部补 0 共 11 格", () => {
    const host = document.createElement("div");
    createOdometerRender({ strip: "full" })(host, NF.format(12), ctx(12, 0, 99));
    const s = strips(host)[0];
    expect(s.children.length).toBe(11);
    expect(
      Array.from(s.children)
        .map((c) => c.textContent)
        .join(""),
    ).toBe("01234567890");
  });

  it("整条平移到 digit+roll 的绝对位置", () => {
    const host = document.createElement("div");
    const r = createOdometerRender({ strip: "full", rollWindow: 1 }); // 全程滚动
    r(
      host,
      "0",
      ctx(7.5, 0, 99, () => "0"),
    ); // digit 7 + roll .5
    expect(shift(strips(host)[0])).toBeCloseTo(7.5, 5); // full 平移=digit+roll
  });
});

describe("createOdometerRender × 小数", () => {
  it("处理小数位列（负位权）", () => {
    const host = document.createElement("div");
    createOdometerRender()(host, NF.format(12.3), ctx(12.3, 0, 99.9));
    const ss = strips(host);
    expect(topDigit(ss[0])).toBe("1");
    expect(topDigit(ss[1])).toBe("2");
    expect(topDigit(ss[2])).toBe("3"); // 十分位 k=-1
  });
});

describe("createOdometerRender destroy", () => {
  it("destroy(el) 断开状态引用，不改动宿主子节点；再渲染则重建", () => {
    const host = document.createElement("div");
    const r = createOdometerRender();
    r(host, NF.format(12), ctx(12, 0, 99));
    const ul = root(host);
    r.destroy(host);
    expect(root(host)).toBe(ul); // 未清理子节点
    r(host, NF.format(12), ctx(12, 0, 99));
    expect(root(host)).not.toBe(ul); // 状态已断 → 重建
  });

  it("destroy() 丢弃整张状态表", () => {
    const host = document.createElement("div");
    const r = createOdometerRender();
    r(host, NF.format(12), ctx(12, 0, 99));
    const ul = root(host);
    r.destroy();
    r(host, NF.format(12), ctx(12, 0, 99));
    expect(root(host)).not.toBe(ul);
  });
});
