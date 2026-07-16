import { describe, expect, it, vi } from "vitest";
import { handleImageRequest, shouldIntercept, type PipelineDeps } from "../src/sw/pipeline";
import { resolveSWOptions } from "../src/shared/types";
import { HEADER_MARK, PARAM_BYPASS, withPlayParam, withStageParam } from "../src/shared/protocol";
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
    expect(d.notify).toHaveBeenCalledWith({ picman: 1, type: "first-frame", url: GIF_URL });
    expect(d.notify).toHaveBeenCalledWith({ picman: 1, type: "complete", url: GIF_URL });
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
    expect(d.fetchImpl).toHaveBeenCalledWith(GIF_URL);
  });
  it("首帧生成失败(makeFirstFrame null):无 ff 通知,complete 照常", async () => {
    const gif = makeGif({ frames: 3, loop: true });
    const d = makeDeps({ makeFirstFrame: vi.fn().mockResolvedValue(null) });
    (d.fetchImpl as ReturnType<typeof vi.fn>).mockResolvedValue(streamResponse(gif, 7));
    await handleImageRequest(new Request(GIF_URL), d);
    await drain(d);
    expect(d.notify).not.toHaveBeenCalledWith(expect.objectContaining({ type: "first-frame" }));
    expect(d.notify).toHaveBeenCalledWith({ picman: 1, type: "complete", url: GIF_URL });
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

  describe("静态渐进(staticProgressive)", () => {
    const JPG_URL = "https://a.com/photo.jpg";
    const PNG_URL = "https://a.com/photo.png";

    it("渐进式 JPEG:占位 SVG,首 scan 收完后 ff=已到前缀原始字节(早于下载完成),最后 complete", async () => {
      const jpg = makeJpeg({ progressive: true, scanBytes: 6000, endFirstScan: true });
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
      expect(d.makeFirstFrame).not.toHaveBeenCalled();

      expect(d.notify).toHaveBeenCalledWith({ picman: 1, type: "first-frame", url: JPG_URL });
      expect(d.notify).toHaveBeenCalledWith({ picman: 1, type: "complete", url: JPG_URL });
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
      expect(d.notify).toHaveBeenCalledWith({ picman: 1, type: "first-frame", url: JPG_URL });
      expect(d.notify).toHaveBeenCalledWith({ picman: 1, type: "complete", url: JPG_URL });
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
      expect(d2.notify).toHaveBeenCalledWith({ picman: 1, type: "complete", url: "https://a.com/plain.png" });
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
