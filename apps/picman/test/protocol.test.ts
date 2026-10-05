import { describe, expect, it } from "vitest";
import { PARAM_BYPASS, PARAM_FULL, PARAM_PLAY, isImgprogressMessage, stripImgprogressParams, withPlayParam, withStageParam } from "../src/shared/protocol";

describe("protocol", () => {
  const base = "https://a.com/x.gif?w=1";
  it("withStageParam 追加阶段参数", () => {
    expect(withStageParam(base, "1")).toBe(`${base}&${PARAM_FULL}=1`);
  });
  it("withPlayParam 追加播放标记", () => {
    expect(withPlayParam(base)).toBe(`${base}&${PARAM_PLAY}=1`);
  });
  it("stripImgprogressParams 剥掉全部标记参数,保留业务参数", () => {
    const u = `${base}&${PARAM_FULL}=ff&${PARAM_BYPASS}=1&${PARAM_PLAY}=1`;
    expect(stripImgprogressParams(u)).toBe(base);
    expect(stripImgprogressParams(base)).toBe(base);
  });
  it("isImgprogressMessage 过滤", () => {
    expect(isImgprogressMessage({ imgprogress: 1, type: "complete", url: "u" })).toBe(true);
    expect(isImgprogressMessage({ type: "complete" })).toBe(false);
    expect(isImgprogressMessage(null)).toBe(false);
  });
});
