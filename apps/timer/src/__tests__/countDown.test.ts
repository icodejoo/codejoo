/**
 * countDown 内置 API 测试。
 */
import { describe, it, expect, vi } from "vitest";
import { buildHighPerfFormatter, buildCountDownFormatter, createCountDownParser } from "../index";
import { createTestTimer } from "./helpers";

describe("buildHighPerfFormatter", () => {
  it('"HH:mm:ss" 标准格式', () => {
    const fmt = buildHighPerfFormatter("HH:mm:ss");
    expect(fmt(3661000)).toBe("01:01:01");
  });

  it('"DD天 HH:mm:ss" 显示天数', () => {
    const fmt = buildHighPerfFormatter("DD天 HH:mm:ss");
    expect(fmt(86400000 + 3661000)).toBe("01天 01:01:01");
  });

  it("showDays:false → HH 不拆天", () => {
    const fmt = buildHighPerfFormatter("HH:mm:ss", { showDays: false });
    expect(fmt(90061000)).toBe("25:01:01");
  });

  it('"mm:ss.sss" 毫秒精度', () => {
    const fmt = buildHighPerfFormatter("mm:ss.sss");
    expect(fmt(61500)).toBe("01:01.500");
  });

  it("sss 补零三位", () => {
    const fmt = buildHighPerfFormatter("sss");
    expect(fmt(5)).toBe("005");
    expect(fmt(50)).toBe("050");
    expect(fmt(500)).toBe("500");
  });

  it("零时长", () => {
    const fmt = buildHighPerfFormatter("HH:mm:ss");
    expect(fmt(0)).toBe("00:00:00");
  });
});

describe("createCountDownParser", () => {
  it("shared 模式: 返回 { d, h, m, s, sss }", () => {
    const parse = createCountDownParser("shared", true);
    const r = parse(90061500);
    expect(r).toEqual({ d: 1, h: 1, m: 1, s: 1, sss: 500 });
  });

  it("shared 模式: 同一对象被复用(零 GC)", () => {
    const parse = createCountDownParser("shared", true);
    const a = parse(1000);
    const b = parse(2000);
    expect(a).toBe(b);
  });

  it("typed 模式: Int32Array", () => {
    const parse = createCountDownParser("typed", true);
    const r = parse(90061500);
    expect(r).toBeInstanceOf(Int32Array);
    expect(Array.from(r)).toEqual([1, 1, 1, 1, 500]);
  });

  it("callback 模式: 通过回调传值", () => {
    const parse = createCountDownParser("callback", true);
    const s = parse(90061500, (d, h, m, s, sss) => `${d}d ${h}h ${m}m ${s}s ${sss}ms`);
    expect(s).toBe("1d 1h 1m 1s 500ms");
  });

  it("showDays:false → 小时为总小时数", () => {
    const parse = createCountDownParser("shared", false);
    const r = parse(90000000);
    expect(r.d).toBe(1);
    expect(r.h).toBe(25);
  });
});

describe("buildCountDownFormatter", () => {
  it("支持 shared/typed parser(arity=1)", () => {
    const parser = createCountDownParser("shared", true);
    const fmt = buildCountDownFormatter(parser, (d, h, m, s) => `${d}d ${h}:${m}:${s}`);
    expect(fmt(86400000 + 3600000)).toBe("1d 1:0:0");
  });

  it("支持 callback parser(arity=2)", () => {
    const parser = createCountDownParser("callback", true);
    const fmt = buildCountDownFormatter(parser, (d, h, m, s) => `${d}d ${h}:${m}:${s}`);
    expect(fmt(86400000 + 3600000)).toBe("1d 1:0:0");
  });
});

describe("Timer.countDown — 集成", () => {
  it("每秒回调，到 0 自动停止", () => {
    const { timer, advance } = createTestTimer();
    const cb = vi.fn();
    timer.countDown(3000, cb);
    advance(1000);
    advance(2000);
    advance(3000);
    expect(cb).toHaveBeenCalled();
    const before = cb.mock.calls.length;
    advance(4000);
    advance(5000);
    expect(cb.mock.calls.length).toBe(before);
  });

  it("自定义 interval / formatter", () => {
    const { timer, advance } = createTestTimer();
    const fmt = buildHighPerfFormatter("mm:ss.sss");
    const calls: string[] = [];
    timer.countDown(2000, (txt) => calls.push(txt), { interval: 100, formatter: fmt });
    advance(100);
    advance(200);
    advance(300);
    expect(calls.length).toBeGreaterThanOrEqual(3);
    expect(calls[0]).toMatch(/^\d{2}:\d{2}\.\d{3}$/);
  });

  it("remove() 提前取消", () => {
    const { timer, advance } = createTestTimer();
    const cb = vi.fn();
    const ctrl = timer.countDown(5000, cb);
    advance(1000);
    ctrl.remove();
    advance(2000);
    advance(3000);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("duration 越界检查", () => {
    const { timer } = createTestTimer();
    expect(() => timer.countDown(1e12, () => {})).toThrow();
    expect(() => timer.countDown(NaN as any, () => {})).toThrow();
  });
});
