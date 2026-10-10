import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { asEl, FakeEl, FakeIO } from "./helpers.ts";

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("IntersectionObserver", FakeIO);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

it("跳过只有一个子元素的包裹层，取列表项", async () => {
  const { listItems } = await import("../src/core/dom.ts");
  const root = new FakeEl();
  const [list] = root.add(1);
  const cards = list!.add(5);
  expect(listItems(root as unknown as Element)).toEqual(cards);
});

it("项太少不启用", async () => {
  const { listItems } = await import("../src/core/dom.ts");
  const root = new FakeEl();
  root.add(1)[0]!.add(1);
  expect(listItems(root as unknown as Element)).toEqual([]);
});

it("启用：先全部预打防火墙，视口内的由观察器撤掉，离开视口再打上", async () => {
  const { startFirewall } = await import("../src/full/firewall.ts");
  const root = new FakeEl();
  const cards = root.add(3);
  startFirewall(asEl(root));
  expect(cards.every((c) => c.attrs.has("skz-fw"))).toBe(true);
  const io = FakeIO.last!;
  expect(io.targets.size).toBe(3);

  io.cb([{ target: cards[0]!, isIntersecting: true }]);
  expect(cards[0]!.attrs.has("skz-fw")).toBe(false);
  io.cb([{ target: cards[0]!, isIntersecting: false }]);
  expect(cards[0]!.attrs.has("skz-fw")).toBe(true);
});

it("停用：取消观察并清掉标记；重复启用会重新扫描", async () => {
  const { startFirewall, stopFirewall } = await import("../src/full/firewall.ts");
  const root = new FakeEl();
  const cards = root.add(2);
  startFirewall(asEl(root));
  const more = root.add(1);
  startFirewall(asEl(root));
  expect(FakeIO.last!.targets.size).toBe(3);
  expect(more[0]!.attrs.has("skz-fw")).toBe(true);

  stopFirewall(asEl(root));
  expect(FakeIO.last!.targets.size).toBe(0);
  expect([...cards, ...more].some((c) => c.attrs.has("skz-fw"))).toBe(false);
});

it("没有 IntersectionObserver 时什么都不做", async () => {
  vi.stubGlobal("IntersectionObserver", undefined);
  const { startFirewall } = await import("../src/full/firewall.ts");
  const root = new FakeEl();
  const cards = root.add(3);
  startFirewall(asEl(root));
  expect(cards.some((c) => c.attrs.has("skz-fw"))).toBe(false);
});

it("viewportMarker：观察器第一次 get 才创建；离开视口打属性、回来撤掉；unobserve 不会顺手创建", async () => {
  const { viewportMarker } = await import("../src/full/viewport.ts");
  FakeIO.last = null;
  const marker = viewportMarker("skz-test", "50px");
  marker.unobserve(asEl(new FakeEl()));
  expect(FakeIO.last).toBeNull();

  const io = marker.get();
  expect(io).not.toBeNull();
  expect(marker.get()).toBe(io);
  const el = new FakeEl();
  io!.observe(asEl(el));
  FakeIO.last!.cb([{ target: el, isIntersecting: false }]);
  expect(el.attrs.has("skz-test")).toBe(true);
  FakeIO.last!.cb([{ target: el, isIntersecting: true }]);
  expect(el.attrs.has("skz-test")).toBe(false);

  marker.unobserve(asEl(el));
  expect(FakeIO.last!.targets.has(el)).toBe(false);
});

it("viewportMarker：没有 IntersectionObserver 时 get 返回 null", async () => {
  vi.stubGlobal("IntersectionObserver", undefined);
  const { viewportMarker } = await import("../src/full/viewport.ts");
  expect(viewportMarker("skz-test", "0px").get()).toBeNull();
});

it("syncAttr：有值就写，没值就删", async () => {
  const { syncAttr } = await import("../src/core/dom.ts");
  const f = new FakeEl();
  syncAttr(asEl(f), "a", "1");
  expect(f.getAttribute("a")).toBe("1");
  syncAttr(asEl(f), "a", undefined);
  expect(f.getAttribute("a")).toBeNull();
});
