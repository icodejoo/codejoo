import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCardRender } from "./card";
import countdown, { tick as countdownTick } from "../count-down/count-down";
import type { ICountdownContext, ICountdownFormatter, TCountdownParser, TCountdownValue } from "../count-down/types";

const parser: TCountdownParser = () => [0, 0, 0, 0, 0];
const fmt: ICountdownFormatter = (ms) => String(ms);
// 新渲染契约：render(el, remaining, value, ctx)，formatter/parser 收敛进 ctx
const val: TCountdownValue = [0, 0, 0, 0, 0];
const ctx = { el: document.createElement("div"), id: 0, deadline: 0, remaining: 0, value: val, active: true, paused: false, fmt, parser } as ICountdownContext;

// DOM: host > ul.cd-root.cd-flip-root > li.cd-cell.cd-flip-cell
//      > span.cd-num.cd-next.cd-flip-num.cd-flip-next + span.cd-num.cd-now.cd-flip-num.cd-flip-now
// 翻页态 .cd-flipping 加在两个面（span）上，不在 li 上。
function root(host: Element) {
  return host.querySelector(".cd-root") as HTMLElement;
}
function items(host: Element) {
  return Array.from(root(host).children) as HTMLElement[];
}
function now(item: HTMLElement) {
  return item.querySelector(".cd-now") as HTMLElement;
}
function next(item: HTMLElement) {
  return item.querySelector(".cd-next") as HTMLElement;
}
function nowDigit(item: HTMLElement) {
  return now(item).dataset.digit;
}
function nextDigit(item: HTMLElement) {
  return next(item).dataset.digit;
}
/** 该格是否处于翻页态（状态类在 now 面上；分隔符恒为 false） */
function flipping(item: HTMLElement) {
  const n = now(item);
  return !!n && n.classList.contains("cd-flipping");
}
/** 读出整块时钟当前展示的字符串（数字取 now 面 data-digit，分隔符取文本） */
function readClock(host: Element) {
  return items(host)
    .map((it) => (it.classList.contains("cd-sep") ? it.textContent : nowDigit(it)))
    .join("");
}

describe("createCardRender DOM & structure", () => {
  it("builds ul.cd-root > li.cd-cell per char, no animation on first render", () => {
    const host = document.createElement("div");
    createCardRender()(host, 123, val, ctx);

    const ul = root(host);
    expect(ul.tagName).toBe("UL");
    expect(ul.classList.contains("cd-root")).toBe(true);
    expect(ul.classList.contains("cd-flip-root")).toBe(true);

    const its = items(host);
    expect(its.length).toBe(3);
    // 每格带公共类 + 效果类
    expect(its.every((it) => it.tagName === "LI" && it.classList.contains("cd-cell") && it.classList.contains("cd-flip-cell"))).toBe(true);
    expect(its.map((it) => nowDigit(it)).join("")).toBe("123");
    // 每格内：next 在前、now 在后，均带 cd-num + 效果类
    const n0 = its[0].children[0];
    const n1 = its[0].children[1];
    expect(n0.classList.contains("cd-next") && n0.classList.contains("cd-flip-next")).toBe(true);
    expect(n1.classList.contains("cd-now") && n1.classList.contains("cd-flip-num")).toBe(true);
    expect(its.some((it) => flipping(it))).toBe(false);
  });

  it("does NOT inject any <style> (css is an external file)", () => {
    const host = document.createElement("div");
    createCardRender()(host, 1, val, ctx);
    expect(document.querySelector("style#gt-card-style")).toBeNull();
    // 根上不写内联 duration（时长由 CSS 变量控制）
    expect(root(host).style.getPropertyValue("--cd-duration")).toBe("");
  });

  it("animates only the changed characters, writing new value to .cd-next", () => {
    const host = document.createElement("div");
    const render = createCardRender();
    render(host, 120, val, ctx);
    render(host, 119, val, ctx);

    const [a, b, c] = items(host);
    expect(flipping(a)).toBe(false);
    expect(flipping(b)).toBe(true);
    expect(nextDigit(b)).toBe("1");
    expect(flipping(c)).toBe(true);
    expect(nextDigit(c)).toBe("9");
  });

  it("finalizes on the now face's transitionend/animationend", () => {
    const host = document.createElement("div");
    const render = createCardRender();
    render(host, 5, val, ctx);
    render(host, 4, val, ctx);

    const item = items(host)[0];
    now(item).dispatchEvent(new Event("transitionend", { bubbles: true }));
    expect(nowDigit(item)).toBe("4");
    expect(flipping(item)).toBe(false);
  });

  it("snaps the pending value when interrupted by a new change", () => {
    const host = document.createElement("div");
    const render = createCardRender();
    render(host, 5, val, ctx);
    render(host, 4, val, ctx); // 结束事件未触发（如后台标签页）
    render(host, 3, val, ctx); // 中断 → 上一目标值立即落定

    const item = items(host)[0];
    expect(nowDigit(item)).toBe("4");
    expect(nextDigit(item)).toBe("3");
    expect(flipping(item)).toBe(true);
  });

  it("rebuilds without animation when the text length changes", () => {
    const host = document.createElement("div");
    const render = createCardRender();
    render(host, 100, val, ctx);
    render(host, 99, val, ctx);

    const its = items(host);
    expect(its.length).toBe(2);
    expect(its.map((it) => nowDigit(it)).join("")).toBe("99");
    expect(its.some((it) => flipping(it))).toBe(false);
  });

  it("supports a custom class prefix (prefix + effect + name)", () => {
    const host = document.createElement("div");
    createCardRender({ effect: "calendar", prefix: "fc-" })(host, 7, val, ctx);

    const ul = host.querySelector(".fc-root") as HTMLElement;
    expect(ul).not.toBeNull();
    expect(ul.classList.contains("fc-calendar-root")).toBe(true);
    const item = ul.children[0] as HTMLElement;
    expect(item.classList.contains("fc-cell") && item.classList.contains("fc-calendar-cell")).toBe(true);
    const nowSpan = item.querySelector(".fc-now") as HTMLElement;
    expect(nowSpan.classList.contains("fc-calendar-now")).toBe(true);
    expect(nowSpan.dataset.digit).toBe("7");
  });

  it("applies the requested effect class on root and cells", () => {
    const host = document.createElement("div");
    createCardRender({ effect: "slide" })(host, 7, val, ctx);
    expect(root(host).classList.contains("cd-slide-root")).toBe(true);
    expect(items(host)[0].classList.contains("cd-slide-cell")).toBe(true);
  });

  it("adds direction modifier classes (axis/direction), default none", () => {
    const x = document.createElement("div");
    createCardRender({ effect: "flip" })(x, 7, val, ctx);
    expect(root(x).classList.contains("cd-flip-y")).toBe(false); // 默认绕 X 轴，无修饰类

    const y = document.createElement("div");
    createCardRender({ effect: "flip", axis: "y" })(y, 7, val, ctx);
    expect(root(y).classList.contains("cd-flip-y")).toBe(true);

    const down = document.createElement("div");
    createCardRender({ effect: "slide" })(down, 7, val, ctx);
    expect(root(down).classList.contains("cd-slide-up")).toBe(false); // 默认向下

    const up = document.createElement("div");
    createCardRender({ effect: "slide", direction: "up" })(up, 7, val, ctx);
    expect(root(up).classList.contains("cd-slide-up")).toBe(true);
  });

  it("renders non-digit characters as li.cd-sep without flip structure", () => {
    const host = document.createElement("div");
    const colonFmt: ICountdownFormatter = () => "1:2";
    createCardRender()(host, 0, val, { ...ctx, fmt: colonFmt });

    const kids = items(host);
    expect(kids.length).toBe(3);
    expect(kids[0].classList.contains("cd-cell")).toBe(true);
    expect(kids[1].classList.contains("cd-sep")).toBe(true);
    expect(kids[1].querySelector(".cd-num")).toBeNull();
    expect(kids[1].textContent).toBe(":");
    expect(kids[2].classList.contains("cd-cell")).toBe(true);
    expect(readClock(host)).toBe("1:2");
  });

  it("isolates state per element", () => {
    const a = document.createElement("div");
    const b = document.createElement("div");
    const render = createCardRender();
    render(a, 11, val, ctx);
    render(b, 22, val, ctx);
    render(a, 12, val, ctx);

    expect(flipping(items(a)[1])).toBe(true);
    expect(items(b).some((it) => flipping(it))).toBe(false);
  });
});

describe("createCardRender calendar flip flow", () => {
  it("writes new value into next span before flip, settles now after end", () => {
    const host = document.createElement("div");
    const render = createCardRender({ effect: "calendar" });
    render(host, 5, val, ctx);
    render(host, 4, val, ctx);

    const item = items(host)[0];
    expect(flipping(item)).toBe(true);
    // 翻页中：next（翻入的新值）= 4，now（折出的旧值）仍 = 5
    expect(nextDigit(item)).toBe("4");
    expect(nowDigit(item)).toBe("5");

    // now 的 ::before 动画结束（事件 target 为 now span）触发落定
    now(item).dispatchEvent(new Event("animationend", { bubbles: true }));
    expect(flipping(item)).toBe(false);
    expect(nowDigit(item)).toBe("4");
  });
});

describe("createCardRender × countdown", () => {
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

  it("renders HH:mm:ss cards and flips the seconds digit on tick", () => {
    const host = document.createElement("div");
    countdown(3000, host, { render: createCardRender() });

    countdownTick();
    const its = items(host);
    expect(its.length).toBe(8);
    expect(readClock(host)).toBe("00:00:03");
    // 冒号位渲染为分隔符，不参与翻页
    expect(its[2].classList.contains("cd-sep")).toBe(true);
    expect(its[5].classList.contains("cd-sep")).toBe(true);

    vi.setSystemTime(Date.now() + 1000);
    countdownTick();
    // 末位 "3"→"2" 翻页
    expect(flipping(its[7])).toBe(true);
    expect(nextDigit(its[7])).toBe("2");
    expect(flipping(its[6])).toBe(false);
  });
});

describe("createCardRender destroy", () => {
  it("destroy(el) 断开状态与事件监听，不改动宿主子节点；再渲染则重建", () => {
    const host = document.createElement("div");
    const render = createCardRender();
    render(host, 5, val, ctx);
    const ul = root(host);
    render.destroy(host);
    expect(root(host)).toBe(ul); // 未清理子节点
    render(host, 5, val, ctx);
    expect(root(host)).not.toBe(ul); // 状态已断 → 重建
  });

  it("destroy() 丢弃整张状态表", () => {
    const host = document.createElement("div");
    const render = createCardRender();
    render(host, 5, val, ctx);
    const ul = root(host);
    render.destroy();
    render(host, 5, val, ctx);
    expect(root(host)).not.toBe(ul);
  });
});
