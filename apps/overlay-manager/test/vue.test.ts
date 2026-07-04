import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, effectScope, ref } from "vue";

import { createLayerman, type Layerman } from "../src/index.ts";
import { createLayermanPlugin, CURRENT_OVERLAY_KEY, LAYERMAN_KEY, useCurrentOverlay, useOverlay, useOverlays, useOverlayState } from "../src/vue.ts";

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

describe("@codejoo/layerman/vue", () => {
  it("useOverlayState：状态桥成响应式，open 后 ref 更新", () => {
    const m = make();
    const scope = effectScope();
    scope.run(() => {
      const state = useOverlayState(m);
      expect(state.value.active).toEqual([]);
      m.open({ id: "a" });
      expect(state.value.active.map((o) => o.id)).toEqual(["a"]);
    });
    scope.stop();
  });

  it("useOverlayState：作用域停止后自动退订（ref 不再更新）", () => {
    const m = make();
    const scope = effectScope();
    let stateRef: ReturnType<typeof useOverlayState> | undefined;
    scope.run(() => {
      stateRef = useOverlayState(m);
    });
    scope.stop(); // → onScopeDispose 退订
    m.open({ id: "a" });
    expect(stateRef!.value.active).toEqual([]); // 未更新，证明已退订
  });

  it("useOverlays：active/queued 响应式计算", () => {
    const m = make();
    const scope = effectScope();
    scope.run(() => {
      const { active, queued } = useOverlays(m);
      m.open({ id: "a" });
      m.open({ id: "b" });
      expect(active.value.map((o) => o.id)).toEqual(["a"]);
      expect(queued.value).toEqual(["b"]);
    });
    scope.stop();
  });

  it("useOverlay：声明式绑定 visible/phase + open/close", () => {
    const m = make();
    const scope = effectScope();
    scope.run(() => {
      const o = useOverlay("promo", undefined, m); // id, defaults, om
      expect(o.visible.value).toBe(false);
      o.open({ priority: 5 });
      expect(o.visible.value).toBe(true);
      expect(o.phase.value).toBe("open");
      expect(o.instance.value?.priority).toBe(5);
      o.close();
      expect(o.phase.value).toBe("closing");
    });
    scope.stop();
  });

  it("useOverlay：可写 model 支持第三方 v-model（set true→open / false→立即 remove）", () => {
    const m = make();
    const scope = effectScope();
    scope.run(() => {
      const o = useOverlay("dlg", undefined, m);
      expect(o.model.value).toBe(false);

      o.model.value = true; // → open
      expect(o.model.value).toBe(true);
      expect(o.visible.value).toBe(true);
      const key = o.instance.value?.instanceKey;

      o.model.value = true; // 已展示 → 不重复 open（instanceKey 不变）
      expect(o.instance.value?.instanceKey).toBe(key);

      o.model.value = false; // → 立即 remove，无 closing 回弹
      expect(o.model.value).toBe(false);
      expect(o.instance.value).toBeUndefined();
    });
    scope.stop();
  });

  it("useOverlay：model 在排队中 set(false) → 直接撤下队列，不卡住", () => {
    const m = make();
    const scope = effectScope();
    scope.run(() => {
      m.open({ id: "blocker" }); // 占住默认串行槽
      const o = useOverlay("dlg", undefined, m);
      o.model.value = true; // 排队（未展示）
      expect(o.model.value).toBe(false);
      expect(m.getSnapshot().queued).toEqual(["dlg"]);

      o.model.value = false; // 排队中取消
      expect(m.getSnapshot().queued).toEqual([]);
      expect(m.get("dlg")).toBeUndefined();
    });
    scope.stop();
  });

  it("useOverlay：defaults(overlap) 让 v-model/model 立即显示、绕过串行、不回弹", () => {
    const m = make();
    const scope = effectScope();
    scope.run(() => {
      m.open({ id: "blocker" }); // 占住串行槽
      const o = useOverlay("f", { overlap: true }, m);
      o.model.value = true; // overlap → 立即叠加显示，即使 blocker 还在
      expect(o.visible.value).toBe(true);
      expect(o.instance.value?.overlapping).toBe(true);
    });
    scope.stop();
  });

  it("useOverlay：defaults 与 open(config) 合并，config 覆盖 defaults", () => {
    const m = make();
    const scope = effectScope();
    scope.run(() => {
      const o = useOverlay("d", { priority: 1, overlap: true }, m);
      o.open({ priority: 9 }); // 覆盖 priority，保留 overlap
      expect(o.instance.value?.priority).toBe(9);
      expect(o.instance.value?.overlapping).toBe(true);
    });
    scope.stop();
  });

  it("useOverlay：defaults 支持响应式 getter，每次 open 取最新值", () => {
    const m = make();
    const scope = effectScope();
    scope.run(() => {
      const pri = ref(1);
      const o = useOverlay("x", () => ({ priority: pri.value, overlap: true }), m);
      o.open();
      expect(o.instance.value?.priority).toBe(1);
      pri.value = 9;
      o.open(); // 同 id 活跃 → 丢弃重开，取最新 defaults
      expect(o.instance.value?.priority).toBe(9);
    });
    scope.stop();
  });

  it("useOverlay：defaults 支持 ref 形态", () => {
    const m = make();
    const scope = effectScope();
    scope.run(() => {
      const cfg = ref({ priority: 3, overlap: true });
      const o = useOverlay("y", cfg, m);
      o.open();
      expect(o.instance.value?.priority).toBe(3);
    });
    scope.stop();
  });

  it("useOverlay：open().result 经 resolve 兑现", async () => {
    const m = make();
    const scope = effectScope();
    await scope.run(async () => {
      const o = useOverlay<unknown>("confirm", undefined, m);
      const h = o.open<boolean>();
      o.resolve(true);
      await expect(h.result).resolves.toBe(true);
    });
    scope.stop();
  });

  it("插件注入：runWithContext 内无需显式传 om", () => {
    const m = make();
    const app = createApp({});
    app.use(createLayermanPlugin(m));
    app.runWithContext(() => {
      const scope = effectScope();
      scope.run(() => {
        const o = useOverlay("fromPlugin"); // 不传 om → 走 inject
        o.open();
        expect(o.visible.value).toBe(true);
      });
      scope.stop();
    });
  });

  it("无管理器（既未传参又未注入）→ 抛错", () => {
    const scope = effectScope();
    scope.run(() => {
      expect(() => useOverlayState()).toThrow(/no manager/);
    });
    scope.stop();
  });

  it("useCurrentOverlay：经 inject 拿到自身 id 的控制句柄（无需透传）", () => {
    const m = make();
    const app = createApp({});
    app.provide(LAYERMAN_KEY, m);
    app.provide(CURRENT_OVERLAY_KEY, "cur");
    app.runWithContext(() => {
      const scope = effectScope();
      scope.run(() => {
        const o = useCurrentOverlay();
        o.open();
        expect(o.instance.value?.id).toBe("cur");
        expect(o.visible.value).toBe(true);
      });
      scope.stop();
    });
  });

  it("useCurrentOverlay：无当前 overlay 注入 → 抛错", () => {
    const m = make();
    const app = createApp({});
    app.provide(LAYERMAN_KEY, m);
    app.runWithContext(() => {
      expect(() => useCurrentOverlay()).toThrow(/current overlay/);
    });
  });
});
