// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { inViewport } from "../src/page/viewport";

/** 造一个带指定矩形的元素 */
function elWithRect(left: number, top: number, w: number, h: number): Element {
  const el = document.createElement("div");
  el.getBoundingClientRect = () => ({ left, top, right: left + w, bottom: top + h, width: w, height: h, x: left, y: top, toJSON: () => ({}) }) as DOMRect;
  return el;
}

describe("inViewport", () => {
  it("视口内可见", () => {
    expect(inViewport(elWithRect(10, 10, 100, 100))).toBe(true);
  });
  it("纵向在视口外不可见", () => {
    expect(inViewport(elWithRect(10, innerHeight + 10, 100, 100))).toBe(false);
    expect(inViewport(elWithRect(10, -200, 100, 100))).toBe(false);
  });
  it("横向在视口外不可见(如横向轮播的屏外项)", () => {
    expect(inViewport(elWithRect(innerWidth + 10, 10, 100, 100))).toBe(false);
    expect(inViewport(elWithRect(-300, 10, 100, 100))).toBe(false);
  });
  it("零尺寸视为可见", () => {
    expect(inViewport(elWithRect(99999, 99999, 0, 0))).toBe(true);
  });
});
