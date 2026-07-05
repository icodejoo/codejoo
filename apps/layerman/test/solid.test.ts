import { createRoot } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createLayerman, type Layerman } from "../src/index.ts";
import { provideCurrentOverlay, provideLayerman, useCurrentOverlay, useOverlay, useOverlays, useOverlayState } from "../src/solid.ts";

const managers: Layerman[] = [];

function make(): Layerman {
  const m = createLayerman({ crossTab: false });
  managers.push(m);
  return m;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T12:00:00"));
});

afterEach(() => {
  for (const m of managers) m.destroy();
  managers.length = 0;
  vi.useRealTimers();
});

describe("@codejoo/layerman/solid", () => {
  it("useOverlayState：状态桥成 signal，open 后 accessor 同步更新", () => {
    const m = make();
    createRoot((dispose) => {
      const st = useOverlayState(m);
      expect(st().active).toEqual([]);
      m.open({ id: "a" });
      expect(st().active.map((o) => o.id)).toEqual(["a"]);
      expect(st().active[0].id).toBe("a");
      dispose();
    });
  });

  it("useOverlayState：作用域 dispose 后自动退订（accessor 不再更新）", () => {
    const m = make();
    let st: ReturnType<typeof useOverlayState> | undefined;
    createRoot((dispose) => {
      st = useOverlayState(m);
      dispose(); // → onCleanup 退订
    });
    m.open({ id: "a" });
    expect(st!().active).toEqual([]); // 未更新，证明已退订
  });

  it("useOverlays：active/queued memo 随 open 更新", () => {
    const m = make();
    createRoot((dispose) => {
      const { active, queued } = useOverlays(m);
      expect(active()).toEqual([]);
      m.open({ id: "a" });
      m.open({ id: "b" });
      expect(active().map((o) => o.id)).toEqual(["a"]);
      expect(queued()).toEqual(["b"]);
      dispose();
    });
  });

  it("useOverlay：声明式绑定 visible/phase，open→visible true、close→phase closing", () => {
    const m = make();
    createRoot((dispose) => {
      const o = useOverlay("x", undefined, m); // id, defaults, om
      expect(o.visible()).toBe(false);
      o.open({ priority: 5 });
      expect(o.visible()).toBe(true);
      expect(o.phase()).toBe("open");
      expect(o.instance()?.priority).toBe(5);
      o.close();
      expect(o.phase()).toBe("closing");
      dispose();
    });
  });

  it("useOverlay：defaults 与 open(config) 合并，config 覆盖 defaults", () => {
    const m = make();
    createRoot((dispose) => {
      const o = useOverlay("d", { priority: 1, overlap: true }, m);
      o.open({ priority: 9 }); // 覆盖 priority，保留 overlap
      expect(o.instance()?.priority).toBe(9);
      expect(o.instance()?.overlapping).toBe(true);
      dispose();
    });
  });

  it("useOverlay：defaults 支持 getter 函数，每次 open 求值取最新", () => {
    const m = make();
    createRoot((dispose) => {
      let pri = 1;
      const o = useOverlay("g", () => ({ priority: pri, overlap: true }), m);
      o.open();
      expect(o.instance()?.priority).toBe(1);
      pri = 9;
      o.open(); // 同 id 活跃 → 丢弃重开，取最新 defaults
      expect(o.instance()?.priority).toBe(9);
      dispose();
    });
  });

  it("useOverlay：open().result 经 resolve 兑现", async () => {
    const m = make();
    // 在 createRoot 内 open 拿句柄，root 外 await。
    const h = createRoot((dispose) => {
      const o = useOverlay<unknown>("confirm", undefined, m);
      const handle = o.open<boolean>();
      o.resolve(true);
      dispose();
      return handle;
    });
    await expect(h.result).resolves.toBe(true);
  });

  it("provideLayerman：注入后 composable 不传 om 亦可回退", () => {
    const m = make();
    createRoot((dispose) => {
      provideLayerman(m);
      const o = useOverlay("fromCtx"); // 不传 om → 走 useContext
      o.open();
      expect(o.visible()).toBe(true);
      dispose();
    });
  });

  it("无管理器（既未传参又未注入）→ 抛错", () => {
    createRoot((dispose) => {
      expect(() => useOverlayState()).toThrow(/no manager/);
      dispose();
    });
  });

  it("useCurrentOverlay：经注入拿到自身 id 的控制句柄（无需透传）", () => {
    const m = make();
    createRoot((dispose) => {
      provideLayerman(m);
      provideCurrentOverlay("cur");
      const o = useCurrentOverlay();
      o.open();
      expect(o.instance()?.id).toBe("cur");
      expect(o.visible()).toBe(true);
      dispose();
    });
  });

  it("useCurrentOverlay：无当前 overlay 注入 → 抛错", () => {
    const m = make();
    createRoot((dispose) => {
      provideLayerman(m);
      expect(() => useCurrentOverlay()).toThrow(/current overlay/);
      dispose();
    });
  });
});
