import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRingRender } from "./ring";
import countdown, { tick as countdownTick } from "../count-down/count-down";
import type { ICountdownContext, ICountdownFormatter, TCountdownParser, TCountdownValue } from "../count-down/types";

const val: TCountdownValue = [0, 0, 0, 0, 0];
const parser: TCountdownParser = () => [0, 0, 0, 0, 0];

function makeCtx(text: string): ICountdownContext {
  const fmt: ICountdownFormatter = () => text;
  return { el: document.createElement("div"), id: 0, deadline: 0, remaining: 0, value: val, active: true, paused: false, fmt, parser } as ICountdownContext;
}

const svg = (host: Element, prefix = "rg-") => host.querySelector("." + prefix + "root") as SVGElement;
const ticks = (host: Element, prefix = "rg-") => Array.from(host.querySelectorAll("." + prefix + "tick")) as SVGElement[];
const segs = (host: Element) => Array.from(host.querySelectorAll(".rg-seg")) as SVGElement[];
const seps = (host: Element) => Array.from(host.querySelectorAll(".rg-sep")) as SVGElement[];
const fills = (host: Element) => Array.from(host.querySelectorAll(".rg-fill")) as SVGElement[];
const onTicks = (host: Element) => ticks(host).filter((t) => t.classList.contains("rg-on"));
const colorOf = (e: Element) => (e as SVGElement & { style: CSSStyleDeclaration }).style.color;
function zoneOf(e: Element): string | null {
  for (const z of ["normal", "green", "yellow", "red", "off"]) if (e.classList.contains("rg-zone-" + z)) return z;
  return null;
}
function norm(c: string) {
  const probe = document.createElement("span");
  probe.style.color = c;
  return probe.style.color;
}
const dOf = (p: Element) => p.getAttribute("d") ?? "";
const rot = (g: Element) => Number(/rotate\(([-\d.]+)/.exec(g.getAttribute("transform") ?? "")?.[1] ?? "0");

describe("createRingRender 结构与显隐（分组配置）", () => {
  it("默认 60 刻度 + 七段数码管(g+polygon) + 内圈 + 双弧", () => {
    const host = document.createElement("div");
    createRingRender()(host, 5000, val, makeCtx("00:05"));
    expect(svg(host).tagName.toLowerCase()).toBe("svg");
    expect(ticks(host).length).toBe(60);
    expect(segs(host).length).toBe(4 * 7); // 4 数字位 × 7 段
    expect(seps(host)[0].textContent).toBe(":");
    expect(host.querySelector(".rg-arcA")).not.toBeNull();
    expect(host.querySelector(".rg-arcB")).not.toBeNull();
    expect(host.querySelector(".rg-track")).not.toBeNull();
  });

  it("ticks.count 控制刻度数", () => {
    const host = document.createElement("div");
    createRingRender({ ticks: { count: 12 } })(host, 5000, val, makeCtx("00:05"));
    expect(ticks(host).length).toBe(12);
  });

  it("各部件可 false / display:false 隐藏（不生成 SVG）", () => {
    const a = document.createElement("div");
    createRingRender({ ticks: false })(a, 5000, val, makeCtx("00:05"));
    expect(ticks(a).length).toBe(0);

    const b = document.createElement("div");
    createRingRender({ arcA: false, arcB: false })(b, 5000, val, makeCtx("00:05"));
    expect(b.querySelector(".rg-arc")).toBeNull();

    const c = document.createElement("div");
    createRingRender({ inner: false })(c, 5000, val, makeCtx("00:05"));
    expect(c.querySelector(".rg-track")).toBeNull();
    expect(fills(c).length).toBe(0);

    const d = document.createElement("div");
    createRingRender({ digit: { display: false } })(d, 5000, val, makeCtx("00:05"));
    expect(d.querySelector(".rg-digits")).toBeNull();
    expect(ticks(d).length).toBe(60); // 其余仍在
  });

  it("发光默认关（无 rg-glow），glow:true 才加；自定义前缀", () => {
    const off = document.createElement("div");
    createRingRender({ prefix: "xx-" })(off, 5000, val, makeCtx("00:05"));
    expect(svg(off, "xx-")).not.toBeNull();
    expect(ticks(off, "xx-").every((t) => !t.classList.contains("xx-glow"))).toBe(true); // 默认不发光

    const on = document.createElement("div");
    createRingRender({ glow: true })(on, 5000, val, makeCtx("00:05"));
    expect(ticks(on).some((t) => t.classList.contains("rg-glow"))).toBe(true); // 显式开启才有
  });
});

describe("createRingRender 点亮与档位", () => {
  it("点亮刻度数 = 秒位本身（向上取整，归零不多走一格）", () => {
    const host = document.createElement("div");
    const r = createRingRender();
    r(host, 5000, val, makeCtx("00:05"));
    expect(onTicks(host).length).toBe(5); // 5s → 5 格
    r(host, 4200, val, makeCtx("00:05")); // 4.2s 仍显示 5（ceil）→ 5 格
    expect(onTicks(host).length).toBe(5);
    r(host, 800, val, makeCtx("00:01")); // 0.8s → ceil 1 → 1 格（不会是 0，结尾才归零）
    expect(onTicks(host).length).toBe(1);
    r(host, 0, val, makeCtx("00:00")); // 归零 → 0 格
    expect(onTicks(host).length).toBe(0);
  });

  it("remaining<=0 全灭，刻度 off 档", () => {
    const host = document.createElement("div");
    createRingRender()(host, 0, val, makeCtx("00:00"));
    expect(onTicks(host).length).toBe(0);
    expect(zoneOf(ticks(host)[0])).toBe("off");
  });

  it("最后一分钟按档位（≤3 红 / ≤10 黄 / 其余绿）", () => {
    const host = document.createElement("div");
    createRingRender()(host, 59000, val, makeCtx("00:59"));
    const ts = ticks(host);
    expect(zoneOf(ts[0])).toBe("red");
    expect(zoneOf(ts[3])).toBe("yellow");
    expect(zoneOf(ts[10])).toBe("green");
  });

  it("分钟>0：点亮 normal、熄灭 off；数码区随档位", () => {
    const host = document.createElement("div");
    createRingRender()(host, 125000, val, makeCtx("02:05"));
    expect(zoneOf(ticks(host)[0])).toBe("normal");
    expect(zoneOf(ticks(host)[10])).toBe("off");
    expect(zoneOf(host.querySelector(".rg-digits") as Element)).toBe("normal");
  });

  it("七段映射：8 亮 7 段，1 亮 2 段（仅切 rg-on，不重建 DOM）", () => {
    const host = document.createElement("div");
    const r = createRingRender();
    r(host, 8000, val, makeCtx("8"));
    const segNodes = segs(host);
    expect(segNodes.filter((s) => s.classList.contains("rg-on")).length).toBe(7);
    r(host, 1000, val, makeCtx("1")); // 同 mask，仅切 class（节点不变）
    expect(segs(host)[0]).toBe(segNodes[0]);
    expect(segs(host).filter((s) => s.classList.contains("rg-on")).length).toBe(2);
  });
});

describe("createRingRender 最内圈", () => {
  const zoneFill = (host: Element, z: string) => host.querySelector(".rg-fill.rg-zone-" + z) as SVGElement;

  it("灰底 + 末分钟三色 + 逐分钟段", () => {
    const host = document.createElement("div");
    createRingRender()(host, 300000, val, makeCtx("05:00"));
    expect(host.querySelector(".rg-track")).not.toBeNull();
    expect(host.querySelectorAll(".rg-fill.rg-zone-normal").length).toBe(4);
    expect(zoneFill(host, "red")).not.toBeNull();
    expect(zoneFill(host, "green")).not.toBeNull();
  });

  it("排空：绿先空、黄次之、红最后", () => {
    const host = document.createElement("div");
    const r = createRingRender();
    r(host, 300000, val, makeCtx("05:00"));
    expect(dOf(zoneFill(host, "green"))).not.toBe("");
    r(host, 5000, val, makeCtx("00:05"));
    expect(dOf(zoneFill(host, "green"))).toBe("");
    expect(dOf(zoneFill(host, "yellow"))).not.toBe("");
    r(host, 2000, val, makeCtx("00:02"));
    expect(dOf(zoneFill(host, "yellow"))).toBe("");
    expect(dOf(zoneFill(host, "red"))).not.toBe("");
  });
});

describe("createRingRender 外2圈/外3圈", () => {
  it("默认复用：源弧 3 段，arcA/arcB 均为 <use>，归零回基准位重合", () => {
    const host = document.createElement("div");
    const r = createRingRender();
    r(host, 300000, val, makeCtx("05:00"));
    const src = host.querySelector("[id^='rg-arcsrc']") as Element;
    expect(src.querySelectorAll("path").length).toBe(3); // 源只建一份
    const b = host.querySelector(".rg-arcA") as Element;
    const c = host.querySelector(".rg-arcB") as Element;
    expect(b.tagName.toLowerCase()).toBe("use");
    expect(c.tagName.toLowerCase()).toBe("use");

    r(host, 290000, val, makeCtx("04:50"));
    expect(rot(b)).not.toBe(0);
    expect(rot(b)).toBeCloseTo(-rot(c), 5);
    expect(c.getAttribute("transform")).toContain("scale("); // 外3圈缩放到自身半径

    r(host, 0, val, makeCtx("00:00"));
    expect(rot(b)).toBe(0);
    expect(rot(c)).toBe(0);
  });

  it("段数不同则各自独立绘制（不复用）；clockwise 翻转旋向", () => {
    const host = document.createElement("div");
    createRingRender({ arcA: { segments: 4 }, arcB: { segments: 5 } })(host, 5000, val, makeCtx("00:05"));
    const b = host.querySelector(".rg-arcA") as Element;
    const c = host.querySelector(".rg-arcB") as Element;
    expect(b.tagName.toLowerCase()).toBe("g"); // 独立 <g>
    expect(b.querySelectorAll("path").length).toBe(4);
    expect(c.querySelectorAll("path").length).toBe(5);

    const cwHost = document.createElement("div");
    createRingRender({ clockwise: true })(cwHost, 290000, val, makeCtx("04:50"));
    const ccwHost = document.createElement("div");
    createRingRender({ clockwise: false })(ccwHost, 290000, val, makeCtx("04:50"));
    const rb = (h: Element) => rot(h.querySelector(".rg-arcA") as Element);
    expect(Math.sign(rb(cwHost))).toBe(-Math.sign(rb(ccwHost)));
  });
});

describe("createRingRender 客制化（分组 + CSS 变量 + 回调）", () => {
  it("ticks 几何用属性；arc/inner 线宽与颜色写 CSS 变量", () => {
    const host = document.createElement("div");
    createRingRender({ ticks: { radius: 40, width: 4, length: 6 }, arcA: { width: 5 }, inner: { width: 9, track: "#222" }, colors: { normal: "#0000ff" } })(host, 5000, val, makeCtx("00:05"));
    const t = ticks(host)[0];
    expect(t.getAttribute("width")).toBe("4");
    expect(t.getAttribute("height")).toBe("6");
    expect(t.getAttribute("y")).toBe("10");
    expect(t.getAttribute("x")).toBe("48");
    const s = svg(host).style;
    expect(s.getPropertyValue("--rg-w-arcA")).toBe("5");
    expect(s.getPropertyValue("--rg-w-inner")).toBe("9");
    expect(s.getPropertyValue("--rg-track")).toBe("#222");
    expect(s.getPropertyValue("--rg-normal")).toBe("#0000ff");
  });

  it("digit.colorAt / arcA.colorAt 内联覆盖当前主题色", () => {
    const host = document.createElement("div");
    createRingRender({ digit: { colorAt: () => "#123456" }, arcA: { colorAt: () => "#654321" } })(host, 125000, val, makeCtx("02:05"));
    expect(colorOf(host.querySelector(".rg-digits") as Element)).toBe(norm("#123456"));
    expect(colorOf(host.querySelector(".rg-arcA") as Element)).toBe(norm("#654321"));
  });

  it("ticks.colorAt 逐刻度覆盖；返回 undefined 用档位", () => {
    const host = document.createElement("div");
    createRingRender({ ticks: { colorAt: ({ index }) => (index === 0 ? "#abcdef" : undefined) } })(host, 59000, val, makeCtx("00:59"));
    expect(colorOf(ticks(host)[0])).toBe(norm("#abcdef"));
    expect(zoneOf(ticks(host)[3])).toBe("yellow");
  });

  it("inner.colorAt 逐分钟上色（下发总分钟数）", () => {
    const host = document.createElement("div");
    const seen: Array<{ index: number; count: number }> = [];
    createRingRender({
      inner: {
        colorAt: ({ index, count }) => {
          seen.push({ index, count });
          return "#777777";
        },
      },
    })(host, 180000, val, makeCtx("03:00"));
    expect(seen.map((s) => s.count)).toEqual([3, 3]);
    expect(seen.map((s) => s.index).sort()).toEqual([1, 2]);
    expect(colorOf(fills(host).find((f) => colorOf(f)) as Element)).toBe(norm("#777777"));
  });

  it('digit.mode:"text" 用文字节点', () => {
    const host = document.createElement("div");
    createRingRender({ digit: { mode: "text" } })(host, 125000, val, makeCtx("02:05"));
    expect(segs(host).length).toBe(0);
    const t = host.querySelector(".rg-dtext") as SVGElement;
    expect(t.textContent).toBe("02:05");
  });
});

describe("createRingRender 自定义 render 钩子（含算好的参数与 host）", () => {
  it("digit.render 接管数码区", () => {
    const host = document.createElement("div");
    let f: { text: string; color: string; sec: number } | undefined;
    createRingRender({
      digit: {
        render: (fr) => {
          f = { text: fr.text, color: fr.color, sec: fr.sec };
          fr.host.setAttribute("data-x", "1");
        },
      },
    })(host, 5000, val, makeCtx("00:05"));
    expect(f?.text).toBe("00:05");
    expect(f?.sec).toBe(5);
    expect(segs(host).length).toBe(0);
    expect((host.querySelector(".rg-digits") as Element).getAttribute("data-x")).toBe("1");
  });

  it("ticks.render 接管刻度（给出 lit / zoneAt / host）", () => {
    const host = document.createElement("div");
    let f: { count: number; lit: number; z0: string } | undefined;
    createRingRender({ ticks: { render: (fr) => (f = { count: fr.count, lit: fr.lit, z0: fr.zoneAt(0) }) } })(host, 5000, val, makeCtx("00:05"));
    expect(ticks(host).length).toBe(0); // 未建默认 rect
    expect(f).toEqual({ count: 60, lit: 5, z0: "red" });
  });

  it("arcA.render 给出 rotation/color；inner.render 给出 angleAt/total", () => {
    const host = document.createElement("div");
    let arcF: { rotation: number; color: string } | undefined;
    let innerF: { total: number; r0: number } | undefined;
    createRingRender({
      arcA: { render: (fr) => (arcF = { rotation: fr.rotation, color: fr.color }) },
      inner: { render: (fr) => (innerF = { total: fr.total, r0: fr.angleAt(0) }) },
    })(host, 290000, val, makeCtx("04:50"));
    expect(arcF?.rotation).toBe(-290 * 6); // -cw·secRem·6
    expect(arcF?.color).toBe("#ff6a5a"); // 分钟>0 常态
    expect(innerF?.total).toBe(290000);
    expect(innerF?.r0).toBeCloseTo(-Math.PI / 2, 5); // 顶部
  });
});

describe("createRingRender 重建与隔离", () => {
  it("mask 变化重建，仅数字变化复用同一 svg", () => {
    const host = document.createElement("div");
    const r = createRingRender();
    r(host, 5000, val, makeCtx("00:05"));
    const first = svg(host);
    r(host, 4000, val, makeCtx("00:04"));
    expect(svg(host)).toBe(first);
    r(host, 600000, val, makeCtx("10:00"));
    expect(segs(host).length).toBe(4 * 7); // 1,0,0,0 → 4 数字位
  });

  it("按元素隔离状态", () => {
    const a = document.createElement("div");
    const b = document.createElement("div");
    const r = createRingRender();
    r(a, 5000, val, makeCtx("00:05"));
    r(b, 2000, val, makeCtx("00:02"));
    expect(onTicks(a).length).toBe(5);
    expect(onTicks(b).length).toBe(2);
  });
});

describe("createRingRender × countdown", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 1));
    vi.stubGlobal("requestAnimationFrame", () => 1);
    vi.stubGlobal("cancelAnimationFrame", () => {});
  });
  afterEach(() => {
    countdown.clear();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("接入 countdown：渲染刻度并按秒点亮", () => {
    const host = document.createElement("div");
    countdown(3000, host, { render: createRingRender(), lazy: false });
    countdownTick();
    expect(ticks(host).length).toBe(60);
    expect(segs(host).length).toBe(6 * 7); // "00:00:03" → 6 数字位
    expect(onTicks(host).length).toBe(3); // sec=3
  });
});

describe("createRingRender destroy", () => {
  it("destroy(el) 断开状态引用，不改动宿主子节点；再渲染则重建", () => {
    const host = document.createElement("div");
    const r = createRingRender();
    r(host, 5000, val, makeCtx("00:05"));
    const svgEl = svg(host);
    r.destroy(host);
    expect(svg(host)).toBe(svgEl); // 子节点未被清理
    r(host, 5000, val, makeCtx("00:05"));
    expect(svg(host)).not.toBe(svgEl); // 状态已断 → 重建出新 svg
  });

  it("destroy() 丢弃整张状态表", () => {
    const host = document.createElement("div");
    const r = createRingRender();
    r(host, 5000, val, makeCtx("00:05"));
    const svgEl = svg(host);
    r.destroy();
    r(host, 5000, val, makeCtx("00:05"));
    expect(svg(host)).not.toBe(svgEl);
  });
});
