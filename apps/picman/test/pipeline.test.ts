import { describe, expect, it, vi } from "vitest";
import { handleImageRequest, shouldIntercept, type PipelineDeps } from "../src/sw/pipeline";
import { resolveSWOptions } from "../src/shared/types";
import { HEADER_MARK, PARAM_BYPASS, withStageParam } from "../src/shared/protocol";
import { makeGif } from "./fixtures";

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
  it("include 命中 image → true;exclude 优先", () => {
    expect(shouldIntercept(withDest(img(GIF_URL), "image"), o)).toBe(true);
    expect(shouldIntercept(withDest(img("https://a.com/x.jpg"), "image"), o)).toBe(false);
    expect(shouldIntercept(withDest(img(GIF_URL), "image"), resolveSWOptions({ exclude: [/big/] }))).toBe(false);
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
  it("同 URL 并发:第二个请求复用同一下载(fetch 只调一次)", async () => {
    const gif = makeGif({ frames: 3, loop: true });
    const d = makeDeps();
    (d.fetchImpl as ReturnType<typeof vi.fn>).mockResolvedValue(streamResponse(gif, 7));
    const [r1, r2] = await Promise.all([handleImageRequest(new Request(GIF_URL), d), handleImageRequest(new Request(GIF_URL), d)]);
    expect(d.fetchImpl).toHaveBeenCalledTimes(1);
    expect(await r1.text()).toContain("<svg");
    expect(await r2.text()).toContain("<svg");
  });
});
