import { describe, expect, it } from "vitest";
import { PARAM_BYPASS, PARAM_FULL, PARAM_PLAY, PARAM_SKE, PARAM_THUMB_SCALE, isImgprogressMessage, stripImgprogressParams, withPlayParam, withStageParam } from "../src/shared/protocol";

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
  it("stripImgprogressParams 无标记时原样返回,不重写 query", () => {
    const signed = "https://a.com/x.png?x-oss-process=image/resize,w_100";
    expect(stripImgprogressParams(signed)).toBe(signed);
  });
  it("stripImgprogressParams 带标记时只剥标记,其余参数保留", () => {
    const out = stripImgprogressParams(`https://a.com/x.png?w=1&${PARAM_FULL}=ff&${PARAM_SKE}=%23fff&${PARAM_THUMB_SCALE}=2`);
    expect(out).toBe("https://a.com/x.png?w=1");
  });
  it("不变式:strip(withStage/withPlay(x)) === new URL(x).href,含 , / ~ ( %20 + 等字符", () => {
    const urls = [
      "https://a.com/x.png?x-oss-process=image/resize,w_100",
      "https://a.com/x.png?a=1&b=2&c=3",
      "https://a.com/x.png?name=a%20b&k=v",
      "https://a.com/x.png?q=a+b&k=~(v)",
      "https://a.com/x.png",
      "https://a.com/x.png#hash",
    ];
    for (const x of urls) {
      expect(stripImgprogressParams(withStageParam(x, "ff"))).toBe(new URL(x).href);
      expect(stripImgprogressParams(withStageParam(x, "1"))).toBe(new URL(x).href);
      expect(stripImgprogressParams(withPlayParam(x))).toBe(new URL(x).href);
    }
  });
  it("withStageParam 不改写已有参数的编码,且替换已有阶段参数", () => {
    const x = "https://a.com/x.png?x-oss-process=image/resize,w_100&n=a%20b&p=a+b";
    expect(withStageParam(x, "1")).toBe(`${x}&${PARAM_FULL}=1`);
    expect(withStageParam(withStageParam(x, "ff"), "1")).toBe(`${x}&${PARAM_FULL}=1`);
    expect(withPlayParam(x)).toBe(`${x}&${PARAM_PLAY}=1`);
  });
  it("标记参数名被编码时也能识别并剥掉", () => {
    const encoded = PARAM_FULL.replace("_", "%5F");
    expect(stripImgprogressParams(`https://a.com/x.png?a=1,2&${encoded}=ff`)).toBe("https://a.com/x.png?a=1,2");
  });
  it("isImgprogressMessage 过滤", () => {
    expect(isImgprogressMessage({ imgprogress: 1, type: "complete", url: "u" })).toBe(true);
    expect(isImgprogressMessage({ type: "complete" })).toBe(false);
    expect(isImgprogressMessage(null)).toBe(false);
    // 标记正确但字段残缺/非法也要拒绝
    expect(isImgprogressMessage({ imgprogress: 1 })).toBe(false);
    expect(isImgprogressMessage({ imgprogress: 1, type: "complete" })).toBe(false);
    expect(isImgprogressMessage({ imgprogress: 1, type: "complete", url: 1 })).toBe(false);
    expect(isImgprogressMessage({ imgprogress: 1, type: "weird", url: "u" })).toBe(false);
    expect(isImgprogressMessage({ imgprogress: 1, type: "first-frame", url: "u" })).toBe(true);
    // error 必须带 message(string)与合法 stage
    expect(isImgprogressMessage({ imgprogress: 1, type: "error", url: "u" })).toBe(false);
    expect(isImgprogressMessage({ imgprogress: 1, type: "error", url: "u", message: "m" })).toBe(false);
    expect(isImgprogressMessage({ imgprogress: 1, type: "error", url: "u", message: 1, stage: "download" })).toBe(false);
    expect(isImgprogressMessage({ imgprogress: 1, type: "error", url: "u", message: "m", stage: "other" })).toBe(false);
    expect(isImgprogressMessage({ imgprogress: 1, type: "error", url: "u", message: "m", stage: "download" })).toBe(true);
    expect(isImgprogressMessage({ imgprogress: 1, type: "error", url: "u", message: "m", stage: "first-frame" })).toBe(true);
  });
});
