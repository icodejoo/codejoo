import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import GT from "./core";
import countdown, { clear as cdClear, group as cdGroup, pause as cdPause, register as cdRegister, resume as cdResume, tick as cdTick } from "./count-down/count-down";
import countup, { clear as cuClear, group as cuGroup, pause as cuPause, register as cuRegister, resume as cuResume, tick as cuTick } from "./count-up/count-up";
import { buildCountupFormatter, ease, easeAsymmetricS } from "./count-up/helper";
import { buildCountdownFormatter, buildDateParser, createCountdownParser, resolveConfig, resolveDateParser, resolveFormatter, resolveParser } from "./count-down/helper";
import { $, createLazyObserver, lazyStart } from "./helper";
import { createCardRender } from "./plugins/card";
import { createOdometerRender } from "./plugins/odometer";
import { createRingRender } from "./plugins/ring";
import { isElement } from "./count-down/helper";
import type { ICountdownContext } from "./count-down/types";
import { createGroupStore, defaultLabel, scheduleStart } from "./groups";
import { CounterPlugin, vCountDown, vCountUp } from "./vue";

// ───────────── 假 IntersectionObserver ─────────────
class FakeIO {
  static all: FakeIO[] = [];
  targets = new Set<Element>();
  cb: IntersectionObserverCallback;
  constructor(cb: IntersectionObserverCallback) {
    this.cb = cb;
    FakeIO.all.push(this);
  }
  observe(e: Element) {
    this.targets.add(e);
  }
  unobserve(e: Element) {
    this.targets.delete(e);
  }
  /** 让所有正在观察 el 的 observer 触发一次 entry */
  static fire(el: Element, isIntersecting = true) {
    for (const io of FakeIO.all) {
      if (io.targets.has(el)) io.cb([{ target: el, isIntersecting } as unknown as IntersectionObserverEntry], io as unknown as IntersectionObserver);
    }
  }
  static watching(el: Element) {
    return FakeIO.all.some((io) => io.targets.has(el));
  }
}

beforeAll(() => {
  vi.stubGlobal("IntersectionObserver", FakeIO);
});

function setup() {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 0, 1));
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
}
function teardown() {
  cdClear();
  cuClear();
  cdClear("g");
  cuClear("g");
  GT.destroy();
  vi.restoreAllMocks();
  vi.useRealTimers();
}
const div = () => document.createElement("div");
const linear = { duration: 1000, fps: 0, easing: (t: number) => t, fmt: String };

// ───────────── helper.ts / groups.ts ─────────────
describe("helper: $ / lazyStart", () => {
  beforeEach(setup);
  afterEach(teardown);

  it("$：Element 原样返回；选择器命中；未命中抛错", () => {
    const el = div();
    el.id = "cov-el";
    document.body.appendChild(el);
    expect($(el)).toBe(el);
    expect($("#cov-el")).toBe(el);
    expect(() => $("#nope")).toThrow("[GT]");
    el.remove();
  });

  it("$：无 document（SSR）且传选择器时抛出 DOM unavailable", () => {
    vi.stubGlobal("document", undefined);
    expect(() => $("#x")).toThrow("DOM unavailable");
    vi.unstubAllGlobals();
    vi.stubGlobal("IntersectionObserver", FakeIO);
  });

  it("lazyStart：进入视口才触发一次；未相交忽略；元素无记录忽略", () => {
    const el = div();
    const cb = vi.fn();
    lazyStart(el, cb);
    FakeIO.fire(el, false);
    expect(cb).not.toHaveBeenCalled();
    FakeIO.fire(el, true);
    expect(cb).toHaveBeenCalledTimes(1);
    FakeIO.fire(el, true); // 已摘除并 unobserve，不会重复
    expect(cb).toHaveBeenCalledTimes(1);
    // 无注册记录的元素触发 entry：安全忽略
    const io = createLazyObserver();
    const other = div();
    (io as unknown as FakeIO).cb([{ target: other, isIntersecting: true } as unknown as IntersectionObserverEntry], io);
  });

  it("lazyStart：取消后不再触发；同元素多注册取消其一仍保留观察", () => {
    const el = div();
    const a = vi.fn();
    const b = vi.fn();
    const cancelA = lazyStart(el, a);
    lazyStart(el, b);
    cancelA();
    cancelA(); // 重复取消无副作用
    expect(FakeIO.watching(el)).toBe(true);
    FakeIO.fire(el);
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
    const c = lazyStart(div(), vi.fn());
    c();
  });

  it("lazyStart：取消唯一注册后停止观察", () => {
    const el = div();
    const cancel = lazyStart(el, vi.fn());
    cancel();
    expect(FakeIO.watching(el)).toBe(false);
  });

  it("多个 observer 共享同一元素：只触发所属 observer 的记录，其余写回", () => {
    const el = div();
    const io2 = createLazyObserver({ rootMargin: "10px" });
    const a = vi.fn();
    const b = vi.fn();
    lazyStart(el, a); // 默认 observer
    lazyStart(el, b, io2);
    (io2 as unknown as FakeIO).cb([{ target: el, isIntersecting: true } as unknown as IntersectionObserverEntry], io2);
    expect(b).toHaveBeenCalledTimes(1);
    expect(a).not.toHaveBeenCalled();
    FakeIO.fire(el);
    expect(a).toHaveBeenCalledTimes(1);
  });

  it("同批中先执行的回调取消后面的注册：后者被跳过", () => {
    const el = div();
    let cancelB: () => void = () => {};
    const b = vi.fn();
    lazyStart(el, () => cancelB());
    cancelB = lazyStart(el, b);
    FakeIO.fire(el);
    expect(b).not.toHaveBeenCalled();
  });
});

describe("groups: scheduleStart / group store", () => {
  beforeEach(setup);
  afterEach(teardown);

  it("active 或无元素：立即 start，无需取消", () => {
    expect(scheduleStart(true, div(), undefined, vi.fn())).toBeUndefined();
    expect(scheduleStart(false, undefined, undefined, vi.fn())).toBeUndefined();
  });

  it("lazyTimeout 到期仍未可见 → 断开观察并回收", () => {
    const el = div();
    const onTimeout = vi.fn();
    scheduleStart(false, el, undefined, vi.fn(), 500, onTimeout);
    vi.advanceTimersByTime(499);
    expect(onTimeout).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onTimeout).toHaveBeenCalledTimes(1);
    expect(FakeIO.watching(el)).toBe(false);
  });

  it("进入视口会清掉超时器；cancel 清理超时器与观察", () => {
    const el = div();
    const onTimeout = vi.fn();
    const onActivate = vi.fn();
    scheduleStart(false, el, undefined, onActivate, 500, onTimeout);
    FakeIO.fire(el);
    vi.advanceTimersByTime(1000);
    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(onTimeout).not.toHaveBeenCalled();

    const el2 = div();
    const cancel = scheduleStart(false, el2, undefined, vi.fn(), 500, onTimeout)!;
    cancel();
    vi.advanceTimersByTime(1000);
    expect(onTimeout).not.toHaveBeenCalled();
    expect(FakeIO.watching(el2)).toBe(false);
  });

  it("分组：配置合并、非默认空分组回收、默认分组常驻、clear 不存在的分组安全", () => {
    const g = cuGroup("g", { duration: 10 });
    expect(cuGroup("g", { fps: 5 })).toBe(g);
    expect(g.config).toEqual({ duration: 10, fps: 5 });
    expect(cuGroup("g2").config).toBeUndefined();
    expect(cuGroup("g2", { fps: 1 }).config).toEqual({ fps: 1 });
    cuClear("g2");
    cuClear("nope");
    cuClear(defaultLabel);
    countup.remove(12345);
    countup.remove(1, "nope");
    countdown.remove(12345);
  });
});

// ───────────── count-up/helper ─────────────
describe("count-up helper", () => {
  it("缓动曲线端点与形状", () => {
    for (const fn of Object.values(ease)) {
      expect(fn(0)).toBeCloseTo(0, 6);
      expect(fn(1)).toBeCloseTo(1, 6);
    }
    expect(ease.linear(0.3)).toBe(0.3);
    expect(ease.easeInQuad(0.5)).toBe(0.25);
    expect(ease.easeOutQuad(0.5)).toBe(0.75);
    expect(ease.easeInOutQuad(0.25)).toBeCloseTo(0.125);
    expect(ease.easeInOutQuad(0.75)).toBeCloseTo(0.875);
    expect(ease.easeOutCubic(0.5)).toBeCloseTo(0.875);
    expect(ease.easeInOutCubic(0.25)).toBeCloseTo(0.0625);
    expect(ease.easeInOutCubic(0.75)).toBeCloseTo(0.9375);
    const s = easeAsymmetricS(0.3);
    expect(s(0.3)).toBeCloseTo(0.5);
    expect(s(0.1)).toBeLessThan(0.5);
    expect(s(0.9)).toBeGreaterThan(0.5);
  });

  it("buildCountupFormatter：无前后缀复用 format；有则拼接", () => {
    const nf = new Intl.NumberFormat("en-US");
    expect(buildCountupFormatter(nf)(1234)).toBe("1,234");
    expect(buildCountupFormatter(nf, { prefix: "₱", suffix: "!" })(1234)).toBe("₱1,234!");
  });
});

// ───────────── count-down/helper ─────────────
describe("count-down helper", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 1));
  });
  afterEach(() => vi.useRealTimers());

  it("parser：showDays 与否", () => {
    const ms = 90061500;
    expect(createCountdownParser(true)(ms).slice()).toEqual([1, 1, 1, 1, 500]);
    expect(createCountdownParser(false)(ms).slice()).toEqual([1, 25, 1, 1, 500]);
    expect(createCountdownParser()(0).slice()).toEqual([0, 0, 0, 0, 0]);
  });

  it("buildCountdownFormatter 经解析器喂给 format", () => {
    const f = buildCountdownFormatter(createCountdownParser(true), (d, h, m, s, ms) => `${d}|${h}|${m}|${s}|${ms}`);
    expect(f(90061500)).toBe("1|1|1|1|500");
  });

  it("buildHighPerfFormatter 空模板返回空串（经 resolveFormatter）", () => {
    expect(resolveFormatter("", false, false)(1000)).toBe("");
    const fn = (n: number) => String(n);
    expect(resolveFormatter(fn, true, true)).toBe(fn);
  });

  it("resolveParser / resolveDateParser / resolveConfig", () => {
    const custom = () => [9, 9, 9, 9, 9] as [number, number, number, number, number];
    expect(resolveParser(custom, false)).toBe(custom);
    expect(typeof resolveParser(undefined, true)).toBe("function");
    const dp = () => 1;
    expect(resolveDateParser(dp)).toBe(dp);
    expect(typeof resolveDateParser("second")).toBe("function");
    const defs = { timeOffset: 0 } as never;
    expect(resolveConfig(defs)).toBe(defs);
    expect(resolveConfig(defs, { fmt: "mm" }, { showDays: true } as never)).toMatchObject({ fmt: "mm", showDays: true });
  });

  it("buildDateParser：各单位、Date、数字时间戳、ISO 回退、字符串日期时间、非法值", () => {
    const now = Date.now();
    expect(buildDateParser("second")(2)).toBe(now + 2000);
    expect(buildDateParser("minute")(1)).toBe(now + 60000);
    expect(buildDateParser("hour")(1)).toBe(now + 3600000);
    expect(buildDateParser("day")(1)).toBe(now + 86400000);
    expect(buildDateParser("week")(1)).toBe(now + 7 * 86400000);
    expect(buildDateParser("month")(1)).toBe(now + 30 * 86400000);
    expect(buildDateParser("quarter")(1)).toBe(now + 90 * 86400000);
    expect(buildDateParser("year")(1)).toBe(now + 365 * 86400000);
    const abs = new Date(2030, 0, 1).getTime();
    expect(buildDateParser("ms")(abs, 1000)).toBe(abs - 1000); // 大于阈值视为绝对时间戳
    expect(buildDateParser("ms")(new Date(abs), 5)).toBe(abs - 5);
    expect(buildDateParser("ms")("2030-01-01T00:00:00Z", 0)).toBe(Date.parse("2030-01-01T00:00:00Z")); // 正则不匹配 → Date.parse
    expect(buildDateParser("ms")("2030/01/02 03:04:05.6")).toBe(new Date(2030, 0, 2, 3, 4, 5, 600).getTime());
    expect(buildDateParser("ms")("2030")).toBe(new Date(2030, 0, 1).getTime());
  });

  it("buildDateParser：非法输入统一抛错", () => {
    const p = buildDateParser("ms");
    expect(() => p("")).toThrow("[GT]");
    expect(() => p("not a date")).toThrow("[GT]");
    expect(() => p(-1)).toThrow("[GT]");
    expect(() => p(NaN)).toThrow("[GT]");
    expect(() => p(undefined as never)).toThrow("[GT]");
  });
});

// ───────────── countdown 引擎 ─────────────
describe("countdown 引擎覆盖", () => {
  beforeEach(setup);
  afterEach(teardown);

  const lifecycle = () => {
    const calls: string[] = [];
    return {
      calls,
      r: {
        mount: vi.fn((_el: Element, ctx: { value: number[] }) => {
          calls.push("mount:" + ctx.value.join(","));
          return { n: 0 };
        }),
        update: vi.fn((s: { n: number }) => {
          s.n++;
          calls.push("update");
        }),
        destroy: vi.fn(() => calls.push("destroy")),
      },
    };
  };

  it("lazy 任务：进入视口才锚定，随后 tick；lifecycle 在激活时 mount", () => {
    const el = div();
    const { r, calls } = lifecycle();
    countdown(5000, el, { render: r as never, lazy: true });
    expect(cdTick()).toBe(false); // 未激活不计 busy
    expect(r.mount).not.toHaveBeenCalled();
    FakeIO.fire(el);
    expect(r.mount).toHaveBeenCalledTimes(1);
    expect(cdTick()).toBe(true);
    expect(calls).toContain("update");
    countdown.clear();
    expect(r.destroy).toHaveBeenCalled();
  });

  it("lazy 任务在暂停期间进入视口：记录 frozen，不锚定 deadline；resume 后按 frozen 重锚", () => {
    const el = div();
    const { r } = lifecycle();
    const id = countdown(5000, el, { render: r as never, lazy: true });
    cdPause(id);
    FakeIO.fire(el);
    expect(r.mount).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(3000);
    expect(cdTick()).toBe(false); // 暂停中
    cdResume(id);
    expect(cdTick()).toBe(true);
  });

  it("pause / resume：回调、冻结剩余、非法 id 与重复调用无副作用", () => {
    const el = div();
    const onPause = vi.fn();
    const onResume = vi.fn();
    const id = countdown(10000, el, { lazy: false, onPause, onResume });
    cdTick();
    vi.advanceTimersByTime(3000);
    cdPause(id);
    cdPause(id); // 重复
    expect(onPause).toHaveBeenCalledTimes(1);
    expect(onPause.mock.calls[0][0]).toBe(7000);
    vi.advanceTimersByTime(5000);
    expect(cdTick()).toBe(false);
    cdResume(id);
    cdResume(id); // 重复
    expect(onResume).toHaveBeenCalledTimes(1);
    cdTick();
    expect(el.textContent).toBe("00:00:07");
    cdPause(9999);
    cdResume(9999);
  });

  it("pause 一个尚未激活的 lazy 任务：frozen 记 0", () => {
    const el = div();
    const onPause = vi.fn();
    const id = countdown(5000, el, { lazy: true, onPause });
    cdPause(id);
    expect(onPause.mock.calls[0][0]).toBe(0);
  });

  it("showMilliseconds 任务逐帧渲染且 schedule 返回 true；整秒任务返回休眠毫秒数", () => {
    const el = div();
    countdown(5000, el, { lazy: false, showMilliseconds: true, fmt: "mm:ss.sss" });
    const seen: string[] = [];
    cdTick();
    seen.push(el.textContent!);
    vi.advanceTimersByTime(10);
    cdTick();
    seen.push(el.textContent!);
    expect(seen[0]).not.toBe(seen[1]);
    countdown.clear();
    countdown(5500, el, { lazy: false });
    expect(cdTick()).toBe(true);
  });

  it("作为插件：休眠毫秒数落在秒位翻转处；剩余 <20ms 退化为逐帧", () => {
    const el = div();
    countdown(3500, el, { lazy: false });
    const plugin = cdRegister();
    expect(plugin.name).toBe("down");
    expect(plugin.install(0, 0)).toBe(501); // 剩余 3500 → 跌破 3000 还需 500ms (+1)
    vi.advanceTimersByTime(3490);
    expect(plugin.install(0, 0)).toBe(true); // 剩余 10ms，<=20 窗口
    countdown.clear();
    expect(plugin.install(0, 0)).toBe(false);
    plugin.dispose!();
  });

  it("onUpdate/render 抛错不影响兄弟；归零时 render 抛错 onDone 仍触发", () => {
    const a = div();
    const b = div();
    const onDone = vi.fn();
    let first = true;
    countdown(1000, a, {
      lazy: false,
      onDone,
      render: () => {
        if (first) first = false;
        else throw new Error("x");
      },
    });
    countdown(1000, b, { lazy: false });
    cdTick();
    vi.advanceTimersByTime(1500);
    cdTick();
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalled();
  });

  it("autoKill:false 归零保留；clear 对 paused / 未激活 / active 分别上报剩余", () => {
    const e1 = div();
    countdown(1000, e1, { lazy: false, autoKill: false });
    vi.advanceTimersByTime(2000);
    cdTick();
    cdTick(); // done 后被跳过
    const onDestroy = vi.fn();
    const e2 = div();
    countdown(9000, e2, { lazy: false, onDestroy });
    countdown(9000, div(), { lazy: true, onDestroy });
    const id = countdown(9000, div(), { lazy: false, onDestroy });
    cdPause(id);
    countdown.clear();
    expect(onDestroy.mock.calls.map((c) => c[0]).sort((a, b) => a - b)).toEqual([0, 9000, 9000]);
  });

  it("同元素重复 countdown：移除旧任务；分组 config 生效；register(options) 改默认值", () => {
    const el = div();
    cdGroup("g", { fmt: "ss" });
    countdown(5000, el, { label: "g", lazy: false });
    cdTick();
    expect(el.textContent).toBe("05");
    countdown(4000, el, { lazy: false });
    cdTick();
    expect(el.textContent).toBe("00:00:04");
    const before = countdown.defaults.showDays;
    cdRegister({ showDays: !before });
    expect(countdown.defaults.showDays).toBe(!before);
    cdRegister({ showDays: before });
  });

  it("countdown(deadline, el, label) 字符串作 label；到期直接归零且 onStart 先于 onDone", () => {
    const el = div();
    const order: string[] = [];
    cdGroup("g", { lazy: false, onStart: () => order.push("start"), onDone: () => order.push("done") } as never);
    countdown(-0, el, "g");
    cdTick();
    expect(order).toEqual(["start", "done"]);
  });

  it("lazyTimeout：永不可见的任务被回收", () => {
    const el = div();
    countdown(5000, el, { lazy: true, lazyTimeout: 100 });
    vi.advanceTimersByTime(100);
    expect(cdTick()).toBe(false);
  });

  it("lifecycle 立即激活时 mount 看到已解析的 ctx.value", () => {
    const el = div();
    const { r, calls } = lifecycle();
    countdown(65000, el, { render: r as never, lazy: false });
    expect(calls[0]).toBe("mount:0,0,1,5,0");
  });
});

// ───────────── countup 引擎 ─────────────
describe("countup 引擎覆盖", () => {
  beforeEach(setup);
  afterEach(teardown);

  const lifecycle = () => ({
    mount: vi.fn(() => ({})),
    update: vi.fn(),
    destroy: vi.fn(),
  });

  it("重载：to / to+label / to+options / from+to / from+to+label / from+to+options / options；非法参数抛 TypeError", () => {
    const ids = new Set<number>();
    ids.add(countup(10));
    ids.add(countup(10, "g"));
    ids.add(countup(10, { duration: 5 }));
    ids.add(countup(1, 10));
    ids.add(countup(1, 10, "g"));
    ids.add(countup(1, 10, { duration: 5 }));
    ids.add(countup({ to: 5 }));
    expect(ids.size).toBe(7);
    expect(() => (countup as any)("x", 1)).toThrow(TypeError);
    expect(() => (countup as any)(1, "x", 2)).toThrow(TypeError);
  });

  it("无元素的任务：只推进 onUpdate/onDone，不渲染", () => {
    const onUpdate = vi.fn();
    const onDone = vi.fn();
    countup({ to: 10, ...linear, onUpdate, onDone });
    cuTick(0, 0);
    cuTick(500, 500);
    expect(onUpdate).toHaveBeenCalled();
    expect(cuTick(1000, 500)).toBe(false);
    expect(onDone).toHaveBeenCalledWith(10, expect.anything());
  });

  it("pause / resume：暂停时间不计入进度；回调；非法 id 与重复调用无副作用", () => {
    const el = div();
    const onPause = vi.fn();
    const onResume = vi.fn();
    const id = countup({ to: 100, el, lazy: false, onPause, onResume, ...linear });
    cuTick(0, 0);
    cuTick(400, 400);
    cuPause(id);
    cuPause(id);
    expect(onPause).toHaveBeenCalledTimes(1);
    expect(cuTick(5000, 4600)).toBe(false);
    cuResume(id);
    cuResume(id);
    expect(onResume).toHaveBeenCalledTimes(1);
    cuTick(5100, 100); // 平移 startAt：暂停前已走 400ms，恢复帧起继续
    expect(el.textContent).toBe("40");
    cuTick(5200, 100);
    expect(el.textContent).toBe("50");
    cuPause(9999);
    cuResume(9999);
  });

  it("fps 节流下 count-up 作为插件始终返回 true；空闲返回 false", () => {
    const p = cuRegister();
    expect(p.name).toBe("up");
    expect(p.install(0, 0)).toBe(false);
    countup({ to: 10, el: div(), lazy: false, ...linear });
    expect(p.install(0, 0)).toBe(true);
    p.dispose!();
  });

  it("lazy：进入视口才开始；lifecycle 在激活时 mount；lazyTimeout 回收", () => {
    const el = div();
    const lc = lifecycle();
    countup({ to: 10, el, render: lc as never, lazy: true, ...linear });
    expect(cuTick(0, 0)).toBe(false);
    expect(lc.mount).not.toHaveBeenCalled();
    FakeIO.fire(el);
    expect(lc.mount).toHaveBeenCalledTimes(1);
    expect(cuTick(0, 0)).toBe(true);
    cuTick(500, 500);
    expect(lc.update).toHaveBeenCalled();
    countup.clear();
    expect(lc.destroy).toHaveBeenCalled();

    const el2 = div();
    countup({ to: 10, el: el2, lazy: true, lazyTimeout: 50, ...linear });
    vi.advanceTimersByTime(50);
    expect(cuTick(0, 0)).toBe(false);
  });

  it("重定目标：待激活的 lazy 任务按新配置重挂（改为立即激活 / 仍 lazy / 超时重置）", () => {
    const el = div();
    const lc = lifecycle();
    countup({ to: 10, el, render: lc as never, lazy: true, ...linear });
    countup({ to: 20, el, render: lc as never, lazy: true, ...linear }); // 仍 lazy：重新挂 observer
    FakeIO.fire(el);
    expect(lc.mount).toHaveBeenCalledTimes(1);
    expect(cuTick(0, 0)).toBe(true);

    const el2 = div();
    const lc2 = lifecycle();
    countup({ to: 10, el: el2, render: lc2 as never, lazy: true, ...linear });
    countup({ to: 20, el: el2, render: lc2 as never, lazy: false, ...linear }); // 改为立即
    expect(lc2.mount).toHaveBeenCalledTimes(1);
  });

  it("重定目标：渲染器在 lifecycle 与 function 之间切换，均先释放旧绑定", () => {
    const el = div();
    const lc = lifecycle();
    countup({ to: 10, el, render: lc as never, lazy: false, ...linear });
    expect(lc.mount).toHaveBeenCalledTimes(1);
    const fnRender = vi.fn();
    countup({ to: 20, el, render: fnRender, lazy: false, ...linear }); // lifecycle → function
    expect(lc.destroy).toHaveBeenCalledTimes(1);
    cuTick(0, 0);
    expect(fnRender).toHaveBeenCalled();
    const lc2 = lifecycle();
    countup({ to: 30, el, render: lc2 as never, lazy: false, ...linear }); // function → lifecycle
    expect(lc2.mount).toHaveBeenCalledTimes(1);
    countup({ to: 40, el, lazy: false, ...linear }); // lifecycle → 默认 function
    expect(lc2.destroy).toHaveBeenCalledTimes(1);
  });

  it("重定目标改 label：任务迁到新分组，旧空分组回收", () => {
    const el = div();
    const id = countup({ to: 10, el, label: "g", lazy: false, ...linear });
    const id2 = countup({ to: 20, el, label: "g2", lazy: false, ...linear });
    expect(id2).toBe(id);
    expect(cuTick(0, 0)).toBe(true);
    countup.remove(id, "g2");
    expect(cuTick(1, 1)).toBe(false);
    cuClear("g2");
  });

  it("重定目标：function 渲染器换成另一个 function 时释放旧渲染器", () => {
    const el = div();
    const destroyOld = vi.fn();
    const oldR = Object.assign(vi.fn(), { destroy: destroyOld });
    countup({ to: 10, el, render: oldR as never, lazy: false, ...linear });
    countup({ to: 20, el, render: vi.fn() as never, lazy: false, ...linear });
    expect(destroyOld).toHaveBeenCalledTimes(1);
  });

  it("onUpdate 抛错只上报；duration<=0 瞬时完成", () => {
    const a = div();
    countup({
      to: 10,
      el: a,
      lazy: false,
      ...linear,
      onUpdate: () => {
        throw new Error("x");
      },
    });
    cuTick(0, 0);
    cuTick(500, 500);
    expect(console.error).toHaveBeenCalled();
    countup.clear();
    const onDone = vi.fn();
    countup({ to: 10, ...linear, duration: 0, onDone });
    cuTick(0, 0);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("autoKill:false：完成后保留，再次对同元素 countup 复活", () => {
    const el = div();
    countup({ to: 10, el, lazy: false, autoKill: false, ...linear });
    cuTick(0, 0);
    cuTick(1000, 1000);
    expect(cuTick(1100, 100)).toBe(false);
    countup({ to: 20, el, lazy: false, ...linear });
    expect(cuTick(1200, 100)).toBe(true);
  });

  it("register(options) 修改全局默认值", () => {
    const before = countup.defaults.duration;
    cuRegister({ duration: 1234 });
    expect(countup.defaults.duration).toBe(1234);
    cuRegister({ duration: before });
  });

  it("count-up 默认 render 在无 ctx 时写 String(value)", async () => {
    const { countupRender } = await import("./count-up/count-up");
    const el = div();
    countupRender(el, 5);
    expect(el.textContent).toBe("5");
    const { countdownRender } = await import("./count-down/helper");
    countdownRender(el, 7, [0, 0, 0, 0, 0]);
    expect(el.textContent).toBe("7");
  });
});

// ───────────── vue 指令 ─────────────
describe("vue 指令", () => {
  beforeEach(setup);
  afterEach(teardown);

  const cd: any = vCountDown;
  const cu: any = vCountUp;

  it("v-count-down：简单值 / 修饰符 / 配置对象；更新与卸载", () => {
    const el = div();
    cd.mounted(el, { value: 5000, modifiers: { days: true, ms: true, keep: true } });
    cdTick();
    expect(el.textContent).toMatch(/^\d\d:\d\d:\d\d$/);
    cd.updated(el, { value: 5000, oldValue: 5000, modifiers: {} }); // 值未变：不重建
    cd.updated(el, { value: 9000, oldValue: 5000, modifiers: {} });
    cdTick();
    expect(el.textContent).toBe("00:00:09");
    cd.unmounted(el);
    expect(cdTick()).toBe(false);
    cd.unmounted(el); // 重复卸载安全
  });

  it("v-count-down：配置对象含 deadline 与 label；Date 与字符串", () => {
    const el = div();
    const onDone = vi.fn();
    cd.mounted(el, { value: { deadline: new Date(Date.now() + 4000), label: "g", fmt: "ss", onDone }, modifiers: { lazy: false } });
    cdTick();
    expect(el.textContent).toBe("04");
    cd.updated(el, { value: { deadline: new Date(Date.now() + 8000), label: "g", fmt: "ss", onDone }, oldValue: { deadline: new Date(Date.now() + 4000), label: "g", fmt: "ss", onDone }, modifiers: {} });
    cdTick();
    expect(el.textContent).toBe("08");
    cd.unmounted(el);
  });

  it("v-count-down：shallowChanged 各分支", () => {
    const el = div();
    const base = { deadline: 5000, fmt: "ss" };
    cd.mounted(el, { value: base, modifiers: {} });
    const bump = (next: unknown, prev: unknown) => cd.updated(el, { value: next, oldValue: prev, modifiers: {} });
    const d1 = new Date(Date.now() + 5000);
    const d2 = new Date(Date.now() + 9000);
    bump(base, base); // 同引用
    bump({ deadline: 6000 }, undefined); // prev == null → 变化
    bump(d1, new Date(d1.getTime())); // 同时间戳 Date：不变
    bump(d2, d1); // Date 不等
    bump(5000, 6000); // 非对象
    bump({ deadline: 5000 }, 5000); // 一对象一原始值
    bump({ deadline: 1000, fmt: "ss" }, { deadline: 1000 }); // key 数不同
    bump({ deadline: d1 }, { deadline: new Date(d1.getTime()) }); // 内部 Date 相等：不变
    bump({ deadline: d2 }, { deadline: d1 }); // 内部 Date 不等
    bump({ deadline: 1000 }, { deadline: 2000 });
    cd.unmounted(el);
  });

  it("v-count-up：数值 / 配置 / 修饰符 / 更新 / 卸载", () => {
    const el = div();
    cu.mounted(el, { value: 100, modifiers: { keep: true } });
    cuTick(0, 0);
    cu.updated(el, { value: 100, oldValue: 100, modifiers: {} });
    cu.updated(el, { value: 200, oldValue: 100, modifiers: {} });
    expect(cuTick(1, 1)).toBe(true);
    cu.unmounted(el);
    expect(cuTick(2, 1)).toBe(false);
    cu.unmounted(el);
  });

  it("CounterPlugin.install 注册两个指令", () => {
    const directive = vi.fn();
    (CounterPlugin as any).install({ directive });
    expect(directive).toHaveBeenCalledWith("count-down", vCountDown);
    expect(directive).toHaveBeenCalledWith("count-up", vCountUp);
  });
});

// ───────────── core ─────────────
describe("core 补充", () => {
  beforeEach(setup);
  afterEach(teardown);

  it("插件 install 抛错：只记录，不拖垮其他插件", () => {
    const ok = vi.fn(() => false);
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => (frames.push(cb), frames.length));
    GT.use({
      name: "bad",
      install: () => {
        throw new Error("x");
      },
    });
    GT.use({ name: "ok", install: ok });
    GT.start();
    frames.shift()!(0);
    expect(ok).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalled();
  });

  it("destroy：调用 dispose、卸载 api，之后可重新自举", () => {
    const dispose = vi.fn();
    GT.use({ name: "tmp", install: () => false, api: {}, dispose });
    expect((GT as any).tmp).toBeDefined();
    GT.destroy();
    expect(dispose).toHaveBeenCalled();
    expect((GT as any).tmp).toBeUndefined();
    countup({ to: 1, ...linear });
    expect((GT as any).up).toBeDefined();
  });

  it("stop() 在未运行时安全；start() 重复调用只排一帧", () => {
    GT.stop();
    let n = 0;
    vi.stubGlobal("requestAnimationFrame", () => ++n);
    GT.start();
    GT.start();
    expect(n).toBe(1);
  });
});

// ───────────── 其余补充 ─────────────
describe("card：分隔符与数字种类切换", () => {
  it("分隔符原地更新；数字↔分隔符切换时整体重建", () => {
    const r = createCardRender();
    const host = document.createElement("div");
    let text = "1:2";
    const ctx = (rem: number) => ({ el: host, id: 0, deadline: 0, remaining: rem, value: [0, 0, 0, 0, 0], active: true, paused: false, fmt: () => text, parser: () => [0, 0, 0, 0, 0] }) as unknown as ICountdownContext;
    const state = r.mount(host, ctx(1000));
    expect(host.querySelectorAll("li").length).toBeGreaterThan(0);
    text = "1x2"; // 分隔符 → 分隔符：原地更新
    r.update(state, 2000, [0, 0, 0, 0, 0], ctx(2000));
    expect(host.textContent).toContain("x");
    text = "123"; // 分隔符 → 数字：整体重建
    r.update(state, 3000, [0, 0, 0, 0, 0], ctx(3000));
    expect(host.textContent).not.toContain("x");
    r.destroy(state);
  });
});

describe("杂项分支", () => {
  beforeEach(setup);
  afterEach(teardown);

  it("isElement：选择器字符串与 Element 为真，其余为假", () => {
    expect(isElement("#a")).toBe(true);
    expect(isElement(div())).toBe(true);
    expect(isElement({})).toBe(false);
  });

  it("重定目标的待激活 lazy 任务：新 lazyTimeout 到期后被回收", () => {
    const el = div();
    countup({ to: 10, el, lazy: true, lazyTimeout: 500, ...linear });
    countup({ to: 20, el, lazy: true, lazyTimeout: 100, ...linear });
    vi.advanceTimersByTime(100);
    expect(cuTick(0, 0)).toBe(false);
  });
});

describe("odometer / ring 防御分支", () => {
  it("odometer：非有限值不崩；落定文本含千分位分隔符时按数字位计数", () => {
    const r = createOdometerRender();
    const host = document.createElement("div");
    const nf = new Intl.NumberFormat("en-US");
    const fmt = (n: number) => nf.format(n);
    const mk = (value: number, from: number, to: number) => ({ el: host, value, from, to, fmt, id: 0, active: true, paused: false }) as never;
    const st = r.mount(host, mk(0, 0, 1234));
    r.update(st, Number.NaN, mk(Number.NaN, 0, 1234)); // intLen 的非有限分支
    r.update(st, 1234, mk(1234, 0, 1234)); // 落定：textIntLen 跳过 ","
    expect(host.textContent).toContain("1");
    r.destroy(st);
  });

  it("ring：colorAt 先给内联色、后返回 undefined → 清掉内联色回到档位 class；mask 变化时重建", () => {
    let override: string | undefined = "#ff0000";
    const r = createRingRender({ ticks: { colorAt: () => override } });
    const host = document.createElement("div");
    let text = "00:10";
    const ctx = () => ({ el: host, id: 0, deadline: 0, remaining: 0, value: [0, 0, 0, 0, 0], active: true, paused: false, fmt: () => text, parser: () => [0, 0, 0, 0, 0] }) as unknown as ICountdownContext;
    const st = r.mount(host, ctx());
    r.update(st, 9000, [0, 0, 0, 0, 0], ctx());
    const tick = host.querySelector(".rg-tick") as SVGElement;
    expect(tick.style.color).not.toBe("");
    override = undefined;
    r.update(st, 8000, [0, 0, 0, 0, 0], ctx());
    expect(tick.style.color).toBe("");
    text = "1:00:10"; // mask 变了 → 重建
    r.update(st, 7000, [0, 0, 0, 0, 0], ctx());
    expect(host.querySelector(".rg-root")).not.toBeNull();
    r.destroy(st);
  });
});

describe("剩余分支补全", () => {
  beforeEach(setup);
  afterEach(teardown);

  it("core：多个休眠插件，后者延迟更大时仍取最小值", () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => (frames.push(cb), frames.length));
    GT.use({ name: "w300", install: () => 300 });
    GT.use({ name: "w800", install: () => 800 });
    GT.start();
    frames.shift()!(0);
    vi.advanceTimersByTime(299);
    expect(frames.length).toBe(0);
    vi.advanceTimersByTime(1);
    expect(frames.length).toBe(1);
  });

  it("helper：元素只注册在别的 observer 上，被当前 observer 的 entry 触发时忽略", () => {
    const el = div();
    const cb = vi.fn();
    const io2 = createLazyObserver();
    const other = createLazyObserver();
    lazyStart(el, cb, io2);
    (other as unknown as FakeIO).cb([{ target: el, isIntersecting: true } as unknown as IntersectionObserverEntry], other);
    expect(cb).not.toHaveBeenCalled();
    FakeIO.fire(el);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("groups：不带 hooks 的 store 也能 remove / clear", () => {
    const store = createGroupStore<{ n: number }, object>();
    store.group("x").queue.set(1, { n: 1 });
    store.group("y").queue.set(2, { n: 2 });
    store.remove(1, "x");
    store.clear("y");
    store.clear();
    expect(store.groups.has("x")).toBe(false);
    expect(store.groups.has("y")).toBe(false);
  });

  it("render 显式传 undefined 时回退到默认渲染", () => {
    const a = div();
    countdown(5000, a, { lazy: false, render: undefined as never });
    cdTick();
    expect(a.textContent).toBe("00:00:05");
    const b = div();
    countup({ to: 5, el: b, lazy: false, render: undefined as never, ...linear });
    cuTick(0, 0);
    cuTick(1000, 1000);
    expect(b.textContent).toBe("5");
    // 重定目标路径（任务已完成出队，需在运行中重定）
    const c = div();
    countup({ to: 5, el: c, lazy: false, ...linear });
    countup({ to: 9, el: c, lazy: false, render: undefined as never, ...linear });
    cuTick(2000, 0);
    cuTick(3000, 1000);
    expect(c.textContent).toBe("9");
  });

  it("countdown：对未激活的 lazy 任务 pause→resume（resume 时仍未激活）", () => {
    const el = div();
    const id = countdown(5000, el, { lazy: true });
    cdPause(id);
    cdResume(id);
    expect(cdTick()).toBe(false);
    FakeIO.fire(el);
    expect(cdTick()).toBe(true);
  });

  it("countup：待激活 lazy 任务以 function 渲染器重定目标，激活后正常", () => {
    const el = div();
    countup({ to: 10, el, lazy: true, ...linear });
    countup({ to: 20, el, lazy: true, ...linear });
    FakeIO.fire(el);
    expect(cuTick(0, 0)).toBe(true);
  });

  it("countup 重定目标改 label：旧分组为默认分组 / 旧分组仍有别的任务", () => {
    const el = div();
    countup({ to: 10, el, lazy: false, ...linear });
    countup({ to: 20, el, label: "g", lazy: false, ...linear }); // default → g，默认分组常驻
    const a = div();
    const b = div();
    countup({ to: 10, el: a, label: "h", lazy: false, ...linear });
    countup({ to: 10, el: b, label: "h", lazy: false, ...linear });
    countup({ to: 20, el: a, label: "h2", lazy: false, ...linear }); // h 里还剩 b
    expect(cuTick(0, 0)).toBe(true);
    cuClear("h");
    cuClear("h2");
  });

  it("card：非 now 面的冒泡事件被忽略", () => {
    const r = createCardRender();
    const host = div();
    const ctx = { el: host, id: 0, deadline: 0, remaining: 0, value: [0, 0, 0, 0, 0], active: true, paused: false, fmt: () => "12", parser: () => [0, 0, 0, 0, 0] } as unknown as ICountdownContext;
    const st = r.mount(host, ctx);
    const li = host.querySelector("li")!;
    li.dispatchEvent(new Event("transitionend")); // target 是 li，不是 now 面
    li.dispatchEvent(new Event("animationend"));
    expect(host.querySelector("li")).not.toBeNull();
    r.destroy(st);
  });

  it("odometer：落定后重新滚动会重建；leadingZeros 落定；重复落定不再塌缩", () => {
    const host = div();
    const fmt = (n: number) => String(Math.round(n));
    const mk = (value: number, to = 100) => ({ el: host, value, from: 0, to, fmt, id: 0, active: true, paused: false }) as never;
    const r = createOdometerRender();
    const st = r.mount(host, mk(0));
    r.update(st, 100, mk(100)); // 落定 → collapsed
    r.update(st, 100, mk(100)); // 再次落定：已塌缩，跳过 collapse
    r.update(st, 50, mk(50)); // 塌缩后继续滚动 → 重建
    r.destroy(st);

    const h2 = div();
    const r2 = createOdometerRender({ leadingZeros: true });
    const mk2 = (value: number) => ({ el: h2, value, from: 0, to: 100, fmt, id: 0, active: true, paused: false }) as never;
    const st2 = r2.mount(h2, mk2(0));
    r2.update(st2, 100, mk2(100));
    r2.destroy(st2);
  });

  it("ring：相同内联色重复写入跳过；total=0 时回退到剩余；text 模式文本不变不重写", () => {
    const host = div();
    let text = "00:10";
    const ctx = () => ({ el: host, id: 0, deadline: 0, remaining: 0, value: [0, 0, 0, 0, 0], active: true, paused: false, fmt: () => text, parser: () => [0, 0, 0, 0, 0] }) as unknown as ICountdownContext;
    const r = createRingRender({ total: 0, ticks: { colorAt: () => "red" }, digit: { mode: "text" } });
    const st = r.mount(host, ctx());
    r.update(st, 9000, [0, 0, 0, 0, 0], ctx());
    r.update(st, 8000, [0, 0, 0, 0, 0], ctx()); // 文本相同、内联色相同
    text = "00:07";
    r.update(st, 7000, [0, 0, 0, 0, 0], ctx());
    expect(host.querySelector(".rg-root")).not.toBeNull();
    r.destroy(st);
  });
});
