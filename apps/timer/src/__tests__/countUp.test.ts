/**
 * countUp 内置 API 测试。
 */
import { describe, it, expect, vi } from "vitest";
import { buildCountUpFormatter } from "../index";
import { createTestTimer } from "./helpers";

describe("buildCountUpFormatter", () => {
  it('默认配置: precision=2, thousands=","', () => {
    const fmt = buildCountUpFormatter({});
    expect(fmt(1234567.89)).toBe("1,234,567.89");
  });

  it("自定义 prefix/suffix", () => {
    const fmt = buildCountUpFormatter({ prefix: "$", suffix: " USD" });
    expect(fmt(1234)).toBe("$1,234.00 USD");
  });

  it("precision:0 不显示小数", () => {
    const fmt = buildCountUpFormatter({ precision: 0 });
    expect(fmt(1234.56)).toBe("1,235");
  });

  it("负数", () => {
    const fmt = buildCountUpFormatter({ prefix: "$" });
    expect(fmt(-1234.56)).toBe("-$1,234.56");
  });

  it('自定义分隔符: thousands=" " decimal=","', () => {
    const fmt = buildCountUpFormatter({ thousands: " ", decimal: "," });
    expect(fmt(1234.56)).toBe("1 234,56");
  });

  it("零值", () => {
    const fmt = buildCountUpFormatter({ prefix: "₱" });
    expect(fmt(0)).toBe("₱0.00");
  });

  it("代码注入抗性: prefix 含引号、反斜杠不破坏函数体", () => {
    expect(() => buildCountUpFormatter({ prefix: '"; alert(1); //' })).not.toThrow();
    const fmt = buildCountUpFormatter({ prefix: 'a"b\\c' });
    expect(fmt(1)).toBe('a"b\\c1.00');
  });

  it("换行字符不破坏模板", () => {
    const fmt = buildCountUpFormatter({ prefix: "a\nb" });
    expect(fmt(1)).toBe("a\nb1.00");
  });
});

describe("Timer.countUp — 集成", () => {
  it("callback 形式: 触发回调", () => {
    const { timer, advance } = createTestTimer();
    const cb = vi.fn();
    timer.countUp(100, cb);
    advance(100);
    advance(500);
    advance(1000);
    expect(cb).toHaveBeenCalled();
  });

  it("end 时 progress=1，自动 remove", () => {
    const { timer, advance } = createTestTimer();
    const calls: string[] = [];
    timer.countUp(100, { duration: 500, fps: 0, prefix: "" }, (txt) => calls.push(txt));
    advance(0);
    advance(250);
    advance(500);
    advance(600);
    const last = calls[calls.length - 1];
    expect(parseFloat(last)).toBeCloseTo(100, 0);
    const beforeLen = calls.length;
    advance(700);
    advance(800);
    expect(calls.length).toBe(beforeLen);
  });

  it("el 绑定: 写入 textContent", () => {
    const { timer, advance } = createTestTimer();
    const el = document.createElement("div");
    document.body.appendChild(el);
    timer.countUp(100, { el, duration: 100, fps: 0, prefix: "" });
    advance(0);
    advance(100);
    expect(parseFloat(el.textContent!)).toBeCloseTo(100, 0);
    document.body.removeChild(el);
  });

  it("既无 el 也无 cb → 抛错", () => {
    const { timer } = createTestTimer();
    expect(() => timer.countUp(100, {})).toThrow();
  });

  it("update: 平滑重定向", () => {
    const { timer, advance } = createTestTimer();
    const calls: number[] = [];
    const ctrl = timer.countUp(100, { duration: 500, fps: 0, prefix: "" }, (txt) => calls.push(parseFloat(txt)));
    advance(0);
    advance(100);
    advance(200);
    ctrl.update(1000);
    advance(300);
    advance(700);
    const last = calls[calls.length - 1];
    expect(last).toBeGreaterThan(100);
  });

  it("remove: 取消动画", () => {
    const { timer, advance } = createTestTimer();
    const cb = vi.fn();
    const ctrl = timer.countUp(100, { duration: 500, fps: 0 }, cb);
    advance(0);
    advance(100);
    ctrl.remove();
    const before = cb.mock.calls.length;
    advance(200);
    advance(500);
    expect(cb.mock.calls.length).toBe(before);
  });

  it("用户改 prefix 时 formatter 跟随", () => {
    const { timer, advance } = createTestTimer();
    const calls: string[] = [];
    timer.countUp(100, { prefix: "$", duration: 100, fps: 0 }, (txt) => calls.push(txt));
    advance(0);
    advance(100);
    expect(calls[calls.length - 1].startsWith("$")).toBe(true);
  });

  it("自定义 formatter 优先", () => {
    const { timer, advance } = createTestTimer();
    const calls: string[] = [];
    timer.countUp(
      100,
      {
        duration: 100,
        fps: 0,
        formatter: (v) => `[${v.toFixed(0)}]`,
      },
      (txt) => calls.push(txt),
    );
    advance(0);
    advance(100);
    expect(calls[calls.length - 1]).toMatch(/^\[\d+\]$/);
  });
});
