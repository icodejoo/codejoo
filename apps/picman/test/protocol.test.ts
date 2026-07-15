import { describe, expect, it } from "vitest";
import { PARAM_BYPASS, PARAM_FULL, isPicmanMessage, stripPicmanParams, withStageParam } from "../src/shared/protocol";

describe("protocol", () => {
  const base = "https://a.com/x.gif?w=1";
  it("withStageParam 追加阶段参数", () => {
    expect(withStageParam(base, "1")).toBe(`${base}&${PARAM_FULL}=1`);
  });
  it("stripPicmanParams 剥掉两类标记参数,保留业务参数", () => {
    const u = `${base}&${PARAM_FULL}=ff&${PARAM_BYPASS}=1`;
    expect(stripPicmanParams(u)).toBe(base);
    expect(stripPicmanParams(base)).toBe(base);
  });
  it("isPicmanMessage 过滤", () => {
    expect(isPicmanMessage({ picman: 1, type: "complete", url: "u" })).toBe(true);
    expect(isPicmanMessage({ type: "complete" })).toBe(false);
    expect(isPicmanMessage(null)).toBe(false);
  });
});
