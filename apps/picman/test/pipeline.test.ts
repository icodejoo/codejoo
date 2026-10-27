import { describe, expect, it, vi } from "vitest";
import { handleImageRequest, shouldIntercept, type PipelineDeps } from "../src/sw/pipeline";
import { resolveSWOptions } from "../src/shared/types";
import { HEADER_MARK, PARAM_BYPASS, PARAM_FULL, PARAM_SKE, withPlayParam, withStageParam } from "../src/shared/protocol";
import { makeBigPng, makeGif, makeJpeg } from "./fixtures";

const GIF_URL = "https://a.com/big.gif";

/** 把字节按 chunkSize 切成流式 Response */
function streamResponse(bytes: Uint8Array, chunkSize: number, headers: Record<string, string> = {}): Response {
  let off = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(c) {
      if (off >= bytes.length) return c.close();
      c.enqueue(bytes.slice(off, off + chunkSize));
      off += chunkSize;
    },
  });
  return new Response(stream, { headers });
}

function makeDeps(over: Partial<PipelineDeps> = {}): PipelineDeps & { bg: Promise<unknown>[] } {
  const bg: Promise<unknown>[] = [];
  return {
    fetchImpl: vi.fn() as unknown as typeof fetch,
    cache: { matchStage: vi.fn().mockResolvedValue(undefined), putStage: vi.fn().mockResolvedValue(true), deleteUrl: vi.fn() },
    notify: vi.fn(),
    makeFirstFrame: vi.fn().mockResolvedValue(new Blob(["png"], { type: "image/png" })),
    waitUntil: (p) => bg.push(p),
    options: resolveSWOptions({ threshold: 10, headBytes: 16 }), // 小阈值便于测试
    bg,
    ...over,
  };
}
const drain = (d: { bg: Promise<unknown>[] }) => Promise.all(d.bg);

describe("shouldIntercept", () => {
  const o = resolveSWOptions();
  const img = (url: string) => new Request(url, { method: "GET" });
  // node Request 无 destination,补 defineProperty
  const withDest = (r: Request, d: string) => (Object.defineProperty(r, "destination", { value: d }), r);
  it("非 image destination → false", () => {
    expect(shouldIntercept(withDest(img(GIF_URL), "script"), o)).toBe(false);
  });
  it("include 命中 image → true(含 jpg);exclude 优先", () => {
    expect(shouldIntercept(withDest(img(GIF_URL), "image"), o)).toBe(true);
    expect(shouldIntercept(withDest(img("https://a.com/x.jpg"), "image"), o)).toBe(true);
    expect(shouldIntercept(withDest(img("https://a.com/x.txt"), "image"), o)).toBe(false);
    expect(shouldIntercept(withDest(img(GIF_URL), "image"), resolveSWOptions({ exclude: [/big/] }))).toBe(false);
  });

  const VIDEO_URL = "https://a.com/hero.mp4";
  it("带 g 标志的正则多次调用结果稳定", () => {
    const gOpts = resolveSWOptions({ include: [/\.gif/g] });
    const req = () => withDest(img(GIF_URL), "image");
    expect([shouldIntercept(req(), gOpts), shouldIntercept(req(), gOpts), shouldIntercept(req(), gOpts)]).toEqual([true, true, true]);
  });
  it("video 默认不拦(deferVideos 关)", () => {
    expect(shouldIntercept(withDest(img(VIDEO_URL), "video"), o)).toBe(false);
  });
  it("video + deferVideos:未带播放标记 → true", () => {
    expect(shouldIntercept(withDest(img(VIDEO_URL), "video"), resolveSWOptions({ deferVideos: true }))).toBe(true);
  });
  it("video + deferVideos:带播放标记 → false(原生放行)", () => {
    expect(shouldIntercept(withDest(img(withPlayParam(VIDEO_URL)), "video"), resolveSWOptions({ deferVideos: true }))).toBe(false);
  });
});

describe("handleImageRequest", () => {
  it("小图(CL<阈值)原样返回", async () => {
    const d = makeDeps();
    const orig = new Response("tiny", { headers: { "Content-Length": "4" } });
    (d.fetchImpl as ReturnType<typeof vi.fn>).mockResolvedValue(orig);
    expect(await handleImageRequest(new Request(GIF_URL), d)).toBe(orig);
  });
  it("动图:立即回 SVG 占位,后台产出首帧+全图缓存+两次通知", async () => {
    const gif = makeGif({ frames: 3, loop: true }); // 确保 > threshold(10)
    const d = makeDeps();
    (d.fetchImpl as ReturnType<typeof vi.fn>).mockResolvedValue(streamResponse(gif, 7));
    const resp = await handleImageRequest(new Request(GIF_URL), d);
    expect(resp.headers.get("Content-Type")).toContain("svg");
    expect(resp.headers.get("Cache-Control")).toBe("no-store");
    expect(resp.headers.get(HEADER_MARK)).toBe("placeholder");
    expect(await resp.text()).toContain("<svg");
    await drain(d);
    expect(d.cache.putStage).toHaveBeenCalledWith(GIF_URL, "ff", expect.any(Response));
    expect(d.cache.putStage).toHaveBeenCalledWith(GIF_URL, "1", expect.any(Response));
    expect(d.notify).toHaveBeenCalledWith({ imgprogress: 1, type: "first-frame", url: GIF_URL });
    expect(d.notify).toHaveBeenCalledWith({ imgprogress: 1, type: "complete", url: GIF_URL });
  });
  it("非动图大文件:透传全部字节", async () => {
    const bytes = new Uint8Array(64).fill(0xff); // 未知容器 → static
    bytes.set([0xff, 0xd8, 0xff], 0);
    const d = makeDeps();
    (d.fetchImpl as ReturnType<typeof vi.fn>).mockResolvedValue(streamResponse(bytes, 16));
    const resp = await handleImageRequest(new Request("https://a.com/x.gif"), d);
    expect(new Uint8Array(await resp.arrayBuffer())).toEqual(bytes);
  });
  it("无 CL 且总量 < 阈值:整体透传", async () => {
    const d = makeDeps();
    (d.fetchImpl as ReturnType<typeof vi.fn>).mockResolvedValue(streamResponse(new Uint8Array([1, 2, 3]), 2));
    const resp = await handleImageRequest(new Request(GIF_URL), d);
    expect(new Uint8Array(await resp.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });
  it("PARAM_FULL:缓存命中回缓存;未命中透传", async () => {
    const d = makeDeps();
    const cached = new Response("cached");
    (d.cache.matchStage as ReturnType<typeof vi.fn>).mockResolvedValue(cached);
    expect(await handleImageRequest(new Request(withStageParam(GIF_URL, "1")), d)).toBe(cached);
  });
  it("PARAM_BYPASS:剥参后直接 fetch", async () => {
    const d = makeDeps();
    const net = new Response("net");
    (d.fetchImpl as ReturnType<typeof vi.fn>).mockResolvedValue(net);
    const u = new URL(GIF_URL);
    u.searchParams.set(PARAM_BYPASS, "1");
    expect(await handleImageRequest(new Request(u.href), d)).toBe(net);
    const arg = (d.fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(arg).toBeInstanceOf(Request);
    expect((arg as Request).url).toBe(GIF_URL);
  });
  it("首帧生成失败(makeFirstFrame null):无 ff 通知,complete 照常", async () => {
    const gif = makeGif({ frames: 3, loop: true });
    const d = makeDeps({ makeFirstFrame: vi.fn().mockResolvedValue(null) });
    (d.fetchImpl as ReturnType<typeof vi.fn>).mockResolvedValue(streamResponse(gif, 7));
    await handleImageRequest(new Request(GIF_URL), d);
    await drain(d);
    expect(d.notify).not.toHaveBeenCalledWith(expect.objectContaining({ type: "first-frame" }));
    expect(d.notify).toHaveBeenCalledWith({ imgprogress: 1, type: "complete", url: GIF_URL });
  });
  it("Cache-Control 含 no-store(大小写不敏感、逗号分隔):原样透传,不进管线不写缓存", async () => {
    const gif = makeGif({ frames: 3, loop: true });
    const d = makeDeps();
    const orig = streamResponse(gif, 7, { "Cache-Control": "Public, No-Store" });
    (d.fetchImpl as ReturnType<typeof vi.fn>).mockResolvedValue(orig);
    const resp = await handleImageRequest(new Request(GIF_URL), d);
    expect(resp).toBe(orig);
    expect(d.bg).toHaveLength(0);
    expect(d.cache.putStage).not.toHaveBeenCalled();
  });
  it("Cache-Control 无 no-store(如 no-cache):仍走渐进管线", async () => {
    const gif = makeGif({ frames: 3, loop: true });
    const d = makeDeps();
    (d.fetchImpl as ReturnType<typeof vi.fn>).mockResolvedValue(streamResponse(gif, 7, { "Cache-Control": "max-age=0, no-cache" }));
    const resp = await handleImageRequest(new Request(GIF_URL), d);
    expect(resp.headers.get(HEADER_MARK)).toBe("placeholder");
    await drain(d);
  });
  it("无 CL、总长小于 threshold 但大于 headBytes 的动图:原样返回,不出占位", async () => {
    const gif = makeGif({ frames: 3, loop: true });
    const d = makeDeps({ options: resolveSWOptions({ threshold: 100000, headBytes: 16 }) });
    (d.fetchImpl as ReturnType<typeof vi.fn>).mockResolvedValue(streamResponse(gif, 7));
    const resp = await handleImageRequest(new Request(GIF_URL), d);
    expect(resp.headers.get(HEADER_MARK)).toBeNull();
    expect(new Uint8Array(await resp.arrayBuffer())).toEqual(gif);
    expect(d.bg).toHaveLength(0);
  });
  it("fetch 抛异常且请求带标记参数:兜底回落请求用去标记 URL", async () => {
    const d = makeDeps();
    (d.fetchImpl as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce(new Response("retry"));
    const u = new URL(GIF_URL);
    u.searchParams.set(PARAM_SKE, "#ff0000");
    await handleImageRequest(new Request(u.href), d);
    const fallbackArg = (d.fetchImpl as ReturnType<typeof vi.fn>).mock.calls[1]![0] as Request;
    expect(fallbackArg).toBeInstanceOf(Request);
    expect(fallbackArg.url).toBe(GIF_URL);
  });
  it("fetch 抛异常且请求无标记参数:兜底回落沿用原 Request", async () => {
    const d = makeDeps();
    (d.fetchImpl as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce(new Response("retry"));
    const req = new Request(GIF_URL);
    await handleImageRequest(req, d);
    expect((d.fetchImpl as ReturnType<typeof vi.fn>).mock.calls[1]![0]).toBe(req);
  });
  it("fetch 抛异常:onError 后透传重试不抛", async () => {
    const onError = vi.fn();
    const d = makeDeps({ options: resolveSWOptions({ threshold: 10, onError }) });
    (d.fetchImpl as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce(new Response("retry"));
    const resp = await handleImageRequest(new Request(GIF_URL), d);
    expect(await resp.text()).toBe("retry");
    expect(onError).toHaveBeenCalled();
  });
  it("video deferred:destination=video → 204 极小响应且不 fetch", async () => {
    const d = makeDeps();
    const req = new Request("https://a.com/hero.mp4");
    Object.defineProperty(req, "destination", { value: "video" });
    const resp = await handleImageRequest(req, d);
    expect(resp.status).toBe(204);
    expect(resp.headers.get(HEADER_MARK)).toBe("deferred");
    expect(d.fetchImpl).not.toHaveBeenCalled();
  });
  it("同 URL 并发:第二个请求复用同一下载(fetch 只调一次)", async () => {
    const gif = makeGif({ frames: 3, loop: true });
    const d = makeDeps();
    (d.fetchImpl as ReturnType<typeof vi.fn>).mockResolvedValue(streamResponse(gif, 7));
    const [r1, r2] = await Promise.all([handleImageRequest(new Request(GIF_URL), d), handleImageRequest(new Request(GIF_URL), d)]);
    expect(d.fetchImpl).toHaveBeenCalledTimes(1);
    expect(await r1.text()).toContain("<svg");
    expect(await r2.text()).toContain("<svg");
  });
  it("需求2 已缓存完整图:原始请求直接回缓存,不出色块也不 fetch", async () => {
    const d = makeDeps();
    const cached = new Response("full-cached");
    (d.cache.matchStage as ReturnType<typeof vi.fn>).mockImplementation((_u: string, stage: string) => Promise.resolve(stage === "1" ? cached : undefined));
    const resp = await handleImageRequest(new Request(GIF_URL), d);
    expect(resp).toBe(cached);
    expect(d.fetchImpl).not.toHaveBeenCalled();
  });
  it("需求1 data-ske-color(PARAM_SKE):色块用指定的静态颜色", async () => {
    const gif = makeGif({ frames: 3, loop: true });
    const d = makeDeps({ options: resolveSWOptions({ threshold: 10, headBytes: 16, colorBlock: "solid" }) });
    (d.fetchImpl as ReturnType<typeof vi.fn>).mockResolvedValue(streamResponse(gif, 7));
    const u = new URL(GIF_URL);
    u.searchParams.set(PARAM_SKE, "#ff0000");
    const resp = await handleImageRequest(new Request(u.href), d);
    const svg = await resp.text();
    expect(svg).toContain('fill="#ff0000"');
    // 通知/缓存 key 应为剥参后的规范 URL
    await drain(d);
    expect(d.notify).toHaveBeenCalledWith({ imgprogress: 1, type: "complete", url: GIF_URL });
  });

  it("ff 阶段缓存写入失败:不发 first-frame 通知,complete 照常", async () => {
    const gif = makeGif({ frames: 3, loop: true });
    const d = makeDeps();
    (d.cache.putStage as ReturnType<typeof vi.fn>).mockImplementation(async (_u: string, stage: string) => stage !== "ff");
    (d.fetchImpl as ReturnType<typeof vi.fn>).mockResolvedValue(streamResponse(gif, 7));
    await handleImageRequest(new Request(GIF_URL), d);
    await drain(d);
    expect(d.notify).not.toHaveBeenCalledWith(expect.objectContaining({ type: "first-frame" }));
    expect(d.notify).toHaveBeenCalledWith({ imgprogress: 1, type: "complete", url: GIF_URL });
  });
  it("后台下载失败:notify 抛错也不吞 onError", async () => {
    const gif = makeGif({ frames: 3, loop: true });
    const onError = vi.fn();
    const d = makeDeps({ options: resolveSWOptions({ threshold: 10, headBytes: 16, onError }), notify: vi.fn().mockRejectedValue(new Error("notify down")) });
    (d.fetchImpl as ReturnType<typeof vi.fn>).mockResolvedValue(streamResponse(gif, 7));
    await handleImageRequest(new Request(GIF_URL), d);
    await expect(drain(d)).resolves.toBeDefined();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ url: GIF_URL, stage: "download" }));
  });
  it("后台下载失败且 onError 自己抛错:error 通知照常发出,不向外抛", async () => {
    const gif = makeGif({ frames: 3, loop: true });
    const onError = vi.fn(() => {
      throw new Error("hook boom");
    });
    const d = makeDeps({ options: resolveSWOptions({ threshold: 10, headBytes: 16, onError }), makeFirstFrame: vi.fn().mockRejectedValue(new Error("render down")) });
    (d.fetchImpl as ReturnType<typeof vi.fn>).mockResolvedValue(streamResponse(gif, 7));
    await handleImageRequest(new Request(GIF_URL), d);
    await expect(drain(d)).resolves.toBeDefined();
    expect(onError).toHaveBeenCalled();
    expect(d.notify).toHaveBeenCalledWith(expect.objectContaining({ type: "error", url: GIF_URL, stage: "download" }));
  });
  it("首帧渲染返回 null 且 onError 抛错:complete 照常发出", async () => {
    const gif = makeGif({ frames: 3, loop: true });
    const onError = vi.fn(() => {
      throw new Error("hook boom");
    });
    const d = makeDeps({ options: resolveSWOptions({ threshold: 10, headBytes: 16, onError }), makeFirstFrame: vi.fn().mockResolvedValue(null) });
    (d.fetchImpl as ReturnType<typeof vi.fn>).mockResolvedValue(streamResponse(gif, 7));
    await handleImageRequest(new Request(GIF_URL), d);
    await drain(d);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ stage: "first-frame" }));
    expect(d.notify).toHaveBeenCalledWith({ imgprogress: 1, type: "complete", url: GIF_URL });
  });
  it("fetch 抛异常且 onError 自己抛错:仍透传重试,不抛", async () => {
    const onError = vi.fn(() => {
      throw new Error("hook boom");
    });
    const d = makeDeps({ options: resolveSWOptions({ threshold: 10, onError }) });
    (d.fetchImpl as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce(new Response("retry"));
    const resp = await handleImageRequest(new Request(GIF_URL), d);
    expect(await resp.text()).toBe("retry");
  });
  it("R1 回归:带 `,` `/` 的原图 URL,写入索引的 key 与 PARAM_FULL 请求 matchStage 的 key 一致", async () => {
    const gif = makeGif({ frames: 3, loop: true });
    const oss = "https://a.com/big.gif?x-oss-process=image/resize,w_100&n=a%20b";
    const d = makeDeps();
    (d.fetchImpl as ReturnType<typeof vi.fn>).mockResolvedValue(streamResponse(gif, 7));
    await handleImageRequest(new Request(oss), d);
    await drain(d);
    const written = (d.cache.putStage as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    expect(written.length).toBeGreaterThan(0);
    expect(new Set(written)).toEqual(new Set([oss]));

    (d.cache.matchStage as ReturnType<typeof vi.fn>).mockClear();
    await handleImageRequest(new Request(withStageParam(oss, "1")), d);
    expect(d.cache.matchStage).toHaveBeenCalledWith(oss, "1");
  });
  it("PARAM_FULL 值无效:直接以 Request 回落网络,不查缓存", async () => {
    const d = makeDeps();
    const net = new Response("net");
    (d.fetchImpl as ReturnType<typeof vi.fn>).mockResolvedValue(net);
    const u = new URL(GIF_URL);
    u.searchParams.set(PARAM_FULL, "bogus");
    expect(await handleImageRequest(new Request(u.href), d)).toBe(net);
    expect(d.cache.matchStage).not.toHaveBeenCalled();
    expect(((d.fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0]![0] as Request).url).toBe(GIF_URL);
  });
  it("PARAM_SKE 非法颜色:回退全局默认色,不注入 SVG", async () => {
    const gif = makeGif({ frames: 3, loop: true });
    const d = makeDeps({ options: resolveSWOptions({ threshold: 10, headBytes: 16, colorBlock: "solid", fallbackColor: "#00ff00" }) });
    (d.fetchImpl as ReturnType<typeof vi.fn>).mockResolvedValue(streamResponse(gif, 7));
    const u = new URL(GIF_URL);
    u.searchParams.set(PARAM_SKE, '"/><script>');
    const svg = await (await handleImageRequest(new Request(u.href), d)).text();
    expect(svg).toContain('fill="#00ff00"');
    expect(svg).not.toContain("script");
  });
  describe("静态渐进(staticProgressive)", () => {
    const JPG_URL = "https://a.com/photo.jpg";
    const PNG_URL = "https://a.com/photo.png";

    it("渐进式 JPEG:占位 SVG,首 scan 收完后 ff=已到前缀原始字节(早于下载完成),最后 complete", async () => {
      // 首 scan 结束后还有 8000 字节后续数据,用来证明 ff 早于下载完成
      const jpg = makeJpeg({ progressive: true, scanBytes: 6000, endFirstScan: true, tailBytes: 8000 });
      const d = makeDeps();
      (d.fetchImpl as ReturnType<typeof vi.fn>).mockResolvedValue(streamResponse(jpg, 1024));
      const resp = await handleImageRequest(new Request(JPG_URL), d);
      expect(resp.headers.get(HEADER_MARK)).toBe("placeholder");
      expect(await resp.text()).toContain("<svg");

      await drain(d);
      const ffCall = (d.cache.putStage as ReturnType<typeof vi.fn>).mock.calls.find((c) => c[1] === "ff");
      expect(ffCall).toBeDefined();
      const ffResp = ffCall![2] as Response;
      // 早期路径:ff 是原始前缀字节(image/jpeg),不是光栅化 PNG
      expect(ffResp.headers.get("Content-Type")).toBe("image/jpeg");
      const ffBytes = new Uint8Array(await ffResp.arrayBuffer());
      expect(ffBytes[0]).toBe(0xff);
      expect(ffBytes[1]).toBe(0xd8);
      // ff 只是全文件的一段前缀:比全文件短,且逐字节等于全文件开头
      expect(ffBytes.length).toBeLessThan(jpg.length);
      expect(ffBytes).toEqual(jpg.slice(0, ffBytes.length));
      expect(d.makeFirstFrame).not.toHaveBeenCalled();

      expect(d.notify).toHaveBeenCalledWith({ imgprogress: 1, type: "first-frame", url: JPG_URL });
      expect(d.notify).toHaveBeenCalledWith({ imgprogress: 1, type: "complete", url: JPG_URL });
      const fullCall = (d.cache.putStage as ReturnType<typeof vi.fn>).mock.calls.find((c) => c[1] === "1");
      expect(new Uint8Array(await (fullCall![2] as Response).arrayBuffer())).toEqual(jpg);
    });

    it("baseline JPEG:早期信号不触发,全量下载完后 ff=makeFirstFrame 光栅化缩略图(image/png)", async () => {
      const jpg = makeJpeg({ scanBytes: 12000 });
      const d = makeDeps();
      (d.fetchImpl as ReturnType<typeof vi.fn>).mockResolvedValue(streamResponse(jpg, 1024));
      const resp = await handleImageRequest(new Request(JPG_URL), d);
      expect(resp.headers.get(HEADER_MARK)).toBe("placeholder");

      await drain(d);
      const ffCall = (d.cache.putStage as ReturnType<typeof vi.fn>).mock.calls.find((c) => c[1] === "ff");
      expect(ffCall).toBeDefined();
      // baseline 路径:ff 是下载完后光栅化的缩略图 PNG
      expect((ffCall![2] as Response).headers.get("Content-Type")).toBe("image/png");
      expect(d.makeFirstFrame).toHaveBeenCalledWith(expect.anything(), "image/jpeg");
      expect(d.notify).toHaveBeenCalledWith({ imgprogress: 1, type: "first-frame", url: JPG_URL });
      expect(d.notify).toHaveBeenCalledWith({ imgprogress: 1, type: "complete", url: JPG_URL });
    });

    it("隔行 PNG:IDAT 跨过门槛后 ff=原始前缀字节;非隔行 PNG:下载完后光栅化缩略图", async () => {
      const interlaced = makeBigPng({ idatBytes: 20000, interlaced: true });
      const d1 = makeDeps();
      (d1.fetchImpl as ReturnType<typeof vi.fn>).mockResolvedValue(streamResponse(interlaced, 2048));
      await handleImageRequest(new Request(PNG_URL), d1);
      await drain(d1);
      const ff1 = (d1.cache.putStage as ReturnType<typeof vi.fn>).mock.calls.find((c) => c[1] === "ff");
      expect((ff1![2] as Response).headers.get("Content-Type")).toBe("image/png");
      expect(d1.makeFirstFrame).not.toHaveBeenCalled(); // 原始前缀字节路径

      const plain = makeBigPng({ idatBytes: 20000 });
      const d2 = makeDeps();
      (d2.fetchImpl as ReturnType<typeof vi.fn>).mockResolvedValue(streamResponse(plain, 2048));
      await handleImageRequest(new Request("https://a.com/plain.png"), d2);
      await drain(d2);
      expect(d2.makeFirstFrame).toHaveBeenCalledWith(expect.anything(), "image/png"); // 光栅化缩略图路径
      expect(d2.notify).toHaveBeenCalledWith({ imgprogress: 1, type: "complete", url: "https://a.com/plain.png" });
    });

    it("staticProgressive: false 时静态大图原样透传", async () => {
      const jpg = makeJpeg({ scanBytes: 12000 });
      const d = makeDeps({ options: resolveSWOptions({ threshold: 10, headBytes: 16, staticProgressive: false }) });
      (d.fetchImpl as ReturnType<typeof vi.fn>).mockResolvedValue(streamResponse(jpg, 1024));
      const resp = await handleImageRequest(new Request(JPG_URL), d);
      expect(resp.headers.get(HEADER_MARK)).toBeNull();
      expect(new Uint8Array(await resp.arrayBuffer())).toEqual(jpg);
    });

    it("动图流程不受影响:GIF 仍走首帧重组路径", async () => {
      const gif = makeGif({ frames: 3, loop: true });
      const d = makeDeps();
      (d.fetchImpl as ReturnType<typeof vi.fn>).mockResolvedValue(streamResponse(gif, 7));
      await handleImageRequest(new Request(GIF_URL), d);
      await drain(d);
      // 动图的 ff 是 makeFirstFrame 光栅化的 PNG,不是原始前缀字节
      const ffCall = (d.cache.putStage as ReturnType<typeof vi.fn>).mock.calls.find((c) => c[1] === "ff");
      expect((ffCall![2] as Response).headers.get("Content-Type")).toBe("image/png");
      expect(d.makeFirstFrame).toHaveBeenCalled();
    });
  });
});
