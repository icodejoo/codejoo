// 真实 Chromium（@vitest/browser-playwright）中的全 API 集成测试。
// 核心 API：直接 import 已发布产物 @codejoo/overlaymanager，在浏览器里跑（真定时器、真 localStorage）。
// Vue 适配层：挂载真实 App.vue（Vant 组件），断言 useOverlay/model/plugin 等。
import "vant/lib/index.css";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "vue";

import { createOverlayManager, type OverlayManager } from "@codejoo/overlaymanager";
import { createOverlayManagerPlugin } from "@codejoo/overlaymanager/vue";

import App from "../src/App.vue";
import { om } from "../src/overlay";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let seq = 0;
const mk = (opts = {}): OverlayManager => createOverlayManager({ gap: 0, crossTab: false, storageKey: `t${++seq}`, ...opts });
const ids = (m: OverlayManager) => m.getSnapshot().active.map((o) => o.id);

beforeEach(() => localStorage.clear());

describe("核心 API（真实浏览器）", () => {
  it("ready / getServerSnapshot / getSnapshot 引用稳定", async () => {
    const m = mk();
    await m.ready();
    expect(m.getServerSnapshot().active).toEqual([]);
    expect(m.getSnapshot()).toBe(m.getSnapshot());
  });

  it("open：串行一次一个 + queued + instanceKey + get", () => {
    const m = mk();
    m.open({ id: "a" });
    m.open({ id: "b" });
    expect(ids(m)).toEqual(["a"]);
    expect(m.getSnapshot().queued).toEqual(["b"]);
    expect(m.get("a")?.id).toBe("a");
    expect(m.get("b")).toBeUndefined();
    expect(typeof m.get("a")?.instanceKey).toBe("number");
  });

  it("priority 降序 + 同级 FIFO", () => {
    const m = mk();
    m.open({ id: "p0" });
    m.open({ id: "p1", priority: 5 });
    m.open({ id: "p2", priority: 5 });
    m.open({ id: "p3", priority: 9 });
    m.remove("p0");
    expect(ids(m)).toEqual(["p3"]);
    m.remove("p3");
    expect(ids(m)).toEqual(["p1"]);
  });

  it("两阶段关闭：close→closing（占槽）→ remove 推进", () => {
    const m = mk();
    m.open({ id: "c1" });
    m.open({ id: "c2" });
    m.close("c1");
    expect(m.get("c1")?.phase).toBe("closing");
    expect(ids(m)).toEqual(["c1"]);
    m.remove("c1");
    expect(ids(m)).toEqual(["c2"]);
  });

  it("autoRemove 默认 300ms / false 需手动", async () => {
    const m = mk();
    m.open({ id: "ar" });
    m.close("ar");
    expect(m.get("ar")?.phase).toBe("closing");
    await sleep(360);
    expect(ids(m)).toEqual([]);

    m.open({ id: "arf", autoRemove: false });
    m.close("arf");
    await sleep(360);
    expect(m.get("arf")?.phase).toBe("closing");
  });

  it("duration 到点自动 close", async () => {
    const m = mk();
    m.open({ id: "d", duration: 150, autoRemove: false });
    expect(m.get("d")?.phase).toBe("open");
    await sleep(200);
    expect(m.get("d")?.phase).toBe("closing");
  });

  it("delay 出现前等待", async () => {
    const m = mk();
    m.open({ id: "x" });
    m.remove("x");
    m.open({ id: "dl", delay: 200 });
    expect(ids(m)).toEqual([]);
    await sleep(240);
    expect(ids(m)).toEqual(["dl"]);
  });

  it("overlap：叠加共存 + overlapping 标记；不合格丢弃 + dismissed", async () => {
    const m = mk();
    m.open({ id: "base" });
    m.open({ id: "ov", overlap: true });
    expect(ids(m).sort()).toEqual(["base", "ov"]);
    expect(m.get("ov")?.overlapping).toBe(true);

    const { result } = m.open({ id: "ovx", overlap: true, requiresAuth: true });
    expect(m.get("ovx")).toBeUndefined();
    expect(await result).toEqual({ dismissed: true });
  });

  it("replace 抢占（被替换退回队列）；不合格不顶当前", () => {
    const m = mk();
    m.open({ id: "r0" });
    m.open({ id: "r1", replace: true });
    expect(ids(m)).toEqual(["r1"]);
    expect(m.getSnapshot().queued).toContain("r0");

    const m2 = mk();
    m2.open({ id: "keep" });
    m2.open({ id: "rx", replace: true, requiresAuth: true });
    expect(ids(m2)).toEqual(["keep"]);
    expect(m2.getSnapshot().queued).toContain("rx");
  });

  it("affix 挡 replace，jumped 压过普通高优先", () => {
    const m = mk();
    m.open({ id: "fix", affix: true });
    m.open({ id: "hi", priority: 100 });
    m.open({ id: "rj", replace: true, priority: 1 });
    m.remove("fix");
    expect(ids(m)).toEqual(["rj"]);
  });

  it("重复 id：活跃→丢弃重开（新 key、旧 dismissed、不回队列）", async () => {
    const m = mk();
    const h1 = m.open({ id: "dup", data: 1 });
    const k1 = m.get("dup")?.instanceKey;
    m.open({ id: "dup", data: 2 });
    expect(m.get("dup")?.data).toBe(2);
    expect(m.get("dup")?.instanceKey).not.toBe(k1);
    expect(m.getSnapshot().queued).not.toContain("dup");
    expect(await h1.result).toEqual({ dismissed: true });
  });

  it("重复 id：队列中→覆盖旧配置", () => {
    const m = mk();
    m.open({ id: "block" });
    m.open({ id: "u", priority: 1, data: 1 });
    m.open({ id: "u", priority: 5, data: 2 });
    m.remove("block");
    expect(ids(m)).toEqual(["u"]);
    expect(m.get("u")?.data).toBe(2);
  });

  it("条件：route（setContext 触发）+ requiresAuth + when 覆盖", () => {
    const m = mk();
    m.setContext({ route: "/home" });
    m.open({ id: "cr", route: "/target" });
    expect(ids(m)).toEqual([]);
    m.setContext({ route: "/target" });
    expect(ids(m)).toEqual(["cr"]);

    const m2 = mk();
    m2.setContext({ auth: false });
    m2.open({ id: "au", requiresAuth: true });
    expect(ids(m2)).toEqual([]);
    m2.setContext({ auth: true });
    expect(ids(m2)).toEqual(["au"]);

    const m3 = mk();
    m3.setContext({ route: "/x", auth: false });
    m3.open({ id: "wn", route: "/y", requiresAuth: true, when: () => true });
    expect(ids(m3)).toEqual(["wn"]);
  });

  it("冷却：session=1", () => {
    const m = mk();
    m.open({ id: "s", cooldown: { session: 1 } });
    m.remove("s");
    m.open({ id: "s", cooldown: { session: 1 } });
    expect(ids(m)).toEqual([]);
  });

  it("冷却：minGap 内拦、过后经触发放行", async () => {
    const m = mk();
    m.open({ id: "g", cooldown: { minGap: { seconds: 1 } } });
    m.remove("g");
    m.open({ id: "g", cooldown: { minGap: { seconds: 1 } } });
    expect(ids(m)).toEqual([]);
    await sleep(1100);
    m.setContext({});
    expect(ids(m)).toEqual(["g"]);
  });

  it("resolve：data 注入 / null 跳过 / 不被插队打断", async () => {
    const m = mk();
    m.open({ id: "rs", resolve: async () => ({ v: 7 }) });
    await sleep(30);
    expect((m.get("rs")?.data as { v: number }).v).toBe(7);

    const m2 = mk();
    m2.open({ id: "rn", resolve: async () => null });
    m2.open({ id: "rn2" });
    await sleep(30);
    expect(ids(m2)).toEqual(["rn2"]);

    const m3 = mk();
    m3.open({ id: "rc", resolve: async () => ({}) });
    m3.open({ id: "rhi", priority: 100 });
    await sleep(30);
    expect(ids(m3)).toEqual(["rc"]);
  });

  it("命令式结果：resolve / reject / dismissed", async () => {
    const m = mk();
    const a = m.open<unknown, number>({ id: "res1" });
    m.resolve("res1", 42);
    expect(await a.result).toBe(42);

    const b = m.open({ id: "res2" });
    m.reject("res2", new Error("nope"));
    await expect(b.result).rejects.toThrow("nope");

    const c = m.open({ id: "dm" });
    m.remove("dm");
    expect(await c.result).toEqual({ dismissed: true });
  });

  it("clear / clear({closeActive})", () => {
    const m = mk();
    m.open({ id: "k1" });
    m.open({ id: "k2" });
    m.clear();
    expect(ids(m)).toEqual(["k1"]);
    expect(m.getSnapshot().queued).toEqual([]);
    m.clear({ closeActive: true });
    expect(ids(m)).toEqual([]);
  });

  it("pauseAll 全冻结：串行 + overlap 均不显示，resume 后放行", () => {
    const m = mk();
    m.pauseAll();
    m.open({ id: "pa" }); // 普通串行
    m.open({ id: "po", overlap: true }); // overlap 也被冻结（非立即显示）
    expect(ids(m)).toEqual([]);
    m.resumeAll();
    expect(ids(m).sort()).toEqual(["pa", "po"]);
  });

  it("pause/resume(id) 冻结单个 duration 计时", async () => {
    const m = mk();
    m.open({ id: "pz", duration: 200, autoRemove: false });
    m.pause("pz");
    await sleep(300);
    expect(m.get("pz")?.phase).toBe("open");
    m.resume("pz");
    await sleep(260);
    expect(m.get("pz")?.phase).toBe("closing");
  });

  it("程序/数据驱动：一段代码自动编排多个 overlap + replace（无交互）", async () => {
    const m = mk();
    // 纯程序驱动：批量 overlap
    m.open({ id: "auto1", overlap: true });
    m.open({ id: "auto2", overlap: true });
    expect(ids(m).sort()).toEqual(["auto1", "auto2"]);
    // 程序驱动 replace 一个串行序列
    m.open({ id: "sA" });
    m.open({ id: "sB", replace: true });
    expect(m.get("sB")?.id).toBe("sB");
    expect(m.getSnapshot().queued).toContain("sA");
    // 数据驱动 resolve：轮到才“取数”，返回后自动显示
    const m2 = mk();
    m2.open({ id: "srv", resolve: async () => ({ v: "backend" }) });
    await sleep(30);
    expect((m2.get("srv")?.data as { v: string }).v).toBe("backend");
  });

  it("subscribe 触发 + 退订", () => {
    const m = mk();
    let c = 0;
    const un = m.subscribe(() => c++);
    m.open({ id: "sb1" });
    const after = c;
    un();
    m.open({ id: "sb2" });
    expect(after).toBeGreaterThan(0);
    expect(c).toBe(after);
  });
});

describe("Vue 适配层（真实 App.vue + Vant）", () => {
  let host: HTMLDivElement;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    om.clear({ closeActive: true });
    host = document.createElement("div");
    document.body.appendChild(host);
    app = createApp(App);
    app.use(createOverlayManagerPlugin(om));
    app.mount(host);
  });
  afterEach(() => {
    app.unmount();
    host.remove();
    om.clear({ closeActive: true });
    document.querySelectorAll(".van-overlay,.van-dialog,.van-toast,.van-popup").forEach((n) => n.remove());
  });

  const q = <T extends Element>(sel: string) => document.querySelector(sel) as T | null;
  const qa = (sel: string) => [...document.querySelectorAll(sel)];
  const txt = (sel: string) => q<HTMLElement>(sel)?.textContent ?? "";
  const click = (el: Element | null) => el && (el as HTMLElement).click();

  it("plugin inject + model：Vant Dialog 经 v-model:show 打开、确认得结果", async () => {
    click(q("[data-testid=confirm-btn]"));
    await sleep(300);
    expect(q(".van-dialog")).not.toBeNull();
    expect(txt("[data-testid=dialog-body]")).toContain("队列驱动");
    click(q(".van-dialog__confirm"));
    await sleep(400);
    expect(txt(".van-toast")).toContain("已确认");
  });

  it("overlap：Dialog A 内点按钮叠加 Dialog B —— 两个弹窗同时可见", async () => {
    click(q("[data-testid=open-a]"));
    await sleep(300);
    expect(txt("[data-testid=dlgA-body]")).toContain("我是 A");
    click(q("[data-testid=stack-b]")); // A 内部按钮 → 程序开 overlap B
    await sleep(300);
    // A、B 两个 Vant Dialog 同时在 DOM
    expect(qa(".van-dialog").length).toBeGreaterThanOrEqual(2);
    expect(txt("[data-testid=dlgB-body]")).toContain("我是 B");
  });

  it("replace：串行槽互斥 —— A 内点按钮，B 抢占 A，A 退回队列", async () => {
    click(q("[data-testid=replace-demo]"));
    await sleep(900); // 覆盖 gap 700
    expect(txt("[data-testid=serial-text]")).toContain("A —— 点下方按钮替换");
    click(q("[data-testid=do-replace]")); // 弹窗内按钮 → replace 成 B
    await sleep(300);
    expect(txt("[data-testid=serial-text]")).toContain("B —— 已抢占 A");
    expect(txt("[data-testid=queued]")).toContain("repA"); // A 退回队列
  });

  it("Vant close-on-click-overlay：点蒙层(非按钮)关闭，队列照常推进", async () => {
    click(q("[data-testid=queue]"));
    await sleep(900); // 覆盖 gap 700
    expect(txt("[data-testid=serial-text]")).toContain("串行 #1");
    expect(txt("[data-testid=queued]")).toContain("card-2");
    click(q(".van-overlay")); // 点蒙层关闭（非按钮）
    await sleep(1250); // autoRemove + gap
    expect(txt("[data-testid=serial-text]")).toContain("串行 #2"); // 队列已推进
    click(q("[data-testid=serial-close]")); // 再用按钮关闭
    await sleep(1250);
    expect(txt("[data-testid=serial-text]")).toContain("串行 #3");
  });

  it("程序/数据驱动：一次点击由代码自动叠加多个 overlap；resolve 自动取数展示", async () => {
    click(q("[data-testid=data-driven]")); // 一个动作 → 程序开 2 个 overlap（立即叠加）
    await sleep(200);
    expect(qa("[data-testid=overlap-card]").length).toBe(2);
    om.clear({ closeActive: true });
    await sleep(50);
    click(q("[data-testid=backend-resolve]")); // 串行 resolve：轮到才取数（gap 700 + fetch 150）
    await sleep(1000);
    expect(txt("[data-testid=serial-text]")).toContain("resolve 拿到的后端数据");
  });

  it("pauseAll 冻结：暂停后触发不显示，恢复后放行", async () => {
    click(q("[data-testid=pause]"));
    click(q("[data-testid=data-driven]")); // 暂停中：overlap 被冻结
    await sleep(200);
    expect(qa("[data-testid=overlap-card]").length).toBe(0);
    expect(txt("[data-testid=active]")).toBe("—");
    click(q("[data-testid=resume]"));
    await sleep(200);
    expect(qa("[data-testid=overlap-card]").length).toBe(2); // 恢复后一起放行
  });
});
