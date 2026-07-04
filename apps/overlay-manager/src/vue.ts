/**
 * @codejoo/layerman/vue — Vue 3 接入层（可选 peer 依赖 `vue`）。
 *
 * 只做一件事：把管理器的 `subscribe`+`getSnapshot` 桥成响应式 `shallowRef`（引用变即触发），
 * 再在其上封出命令式 / 声明式两种唤起风格的 composable。不含任何渲染组件——渲染留给宿主。
 *
 * 管理器实例的获取遵循「插件默认 + 参数覆盖」：composable 的可选 `om` 参数优先，缺省则从
 * `createLayermanPlugin` 注入的实例回退。
 */

import {
  type App,
  computed,
  type ComputedRef,
  getCurrentScope,
  inject,
  type InjectionKey,
  type MaybeRefOrGetter,
  onScopeDispose,
  type Plugin,
  provide,
  type Ref,
  shallowRef,
  toValue,
  type WritableComputedRef,
} from "vue";

import type { OverlayConfig, OverlayHandle, OverlayInstance, Layerman, OverlayState } from "./index.ts";

/** provide/inject 键。 */
export const LAYERMAN_KEY: InjectionKey<Layerman> = Symbol("layerman");
/** 「当前 overlay id」的注入键（由中央渲染器逐条 provide，overlay 组件内 useCurrentOverlay 消费）。 */
export const CURRENT_OVERLAY_KEY: InjectionKey<string> = Symbol("current-overlay");

/** Vue 插件：`app.use(createLayermanPlugin(om))`，为全应用注入默认管理器。 */
export function createLayermanPlugin(om: Layerman): Plugin {
  return {
    install(app: App) {
      app.provide(LAYERMAN_KEY, om);
    },
  };
}

/** 组合式 API 内 provide 默认管理器（等价于插件，用于 setup 内手动注入）。 */
export function provideLayerman(om: Layerman): void {
  provide(LAYERMAN_KEY, om);
}

function useManager(om?: Layerman): Layerman {
  const resolved = om ?? inject(LAYERMAN_KEY, undefined);
  if (!resolved) {
    throw new Error("[layerman/vue] no manager available — pass one explicitly or install createLayermanPlugin");
  }
  return resolved;
}

/** 把管理器状态桥成响应式 `Ref<OverlayState>`（作用域销毁时自动退订）。 */
export function useOverlayState(om?: Layerman): Ref<OverlayState> {
  const m = useManager(om);
  const state = shallowRef(m.getSnapshot());
  const unsub = m.subscribe((s) => {
    state.value = s;
  });
  if (getCurrentScope()) onScopeDispose(unsub);
  return state;
}

/** 命令式风格：拿到响应式的 active / queued，用于中央渲染器遍历。 */
export function useOverlays(om?: Layerman): {
  active: ComputedRef<readonly OverlayInstance[]>;
  queued: ComputedRef<readonly string[]>;
} {
  const state = useOverlayState(om);
  return {
    active: computed(() => state.value.active),
    queued: computed(() => state.value.queued),
  };
}

/** 单个 overlay 的绑定返回值。`TData` 用于约束 `open` 的 `data` 入参类型。 */
export interface UseOverlayReturn<TData = unknown> {
  /** 该 id 当前的活跃实例（未展示时为 undefined）；`data` 对本层不透明，读取时自行断言类型。 */
  instance: ComputedRef<OverlayInstance | undefined>;
  /** 是否正在展示。 */
  visible: ComputedRef<boolean>;
  /**
   * 可写的可见性,直接给第三方「只暴露 v-model」的弹窗用:`<ThirdPartyDialog v-model="model" />`。
   * - get：是否正在展示(open/closing）。
   * - set(true)：若未展示且未排队则 `open()`（无额外配置；要 priority/cooldown 等请改用 `open(config)`）。
   * - set(false)：走 `close()`（尊重 `beforeClose` 守卫，不再被硬闯过去）。无 `beforeClose` 时
   *   `close()` 内部同步转 `closing`，随即紧跟 `remove()` 收尾——效果等同「立即移除」，第三方弹窗
   *   仍不需要我们的 closing 期；配了 `beforeClose` 时守卫异步决定是否真正关闭，此时不强制移除。
   * 注意：队列/gap/条件/冷却仍生效,`set(true)` 若被排队则不会立刻可见,getter 如实反映真实状态。
   */
  model: WritableComputedRef<boolean>;
  /** 当前渲染阶段（open/closing），未展示时 undefined。 */
  phase: ComputedRef<OverlayInstance["phase"] | undefined>;
  /** 唤起（自动带上本 id）；返回可 await 的句柄。 */
  open: <TResult = unknown>(config?: Omit<OverlayConfig<TData>, "id">) => OverlayHandle<TResult>;
  close: () => void;
  remove: () => void;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
  pause: () => void;
  resume: () => void;
}

/**
 * 声明式风格：常驻组件把「可见权」托管给管理器，按 id 绑定。
 * 组件内 `const { visible, open, resolve } = useOverlay('promo')`，`v-if="visible"` 显隐。
 *
 * `defaults` 声明该 overlay 的固有行为（`overlap`/`replace`/`priority`/`cooldown`/`route`/`delay`
 * 等），会合并进**每一次** open —— 无论经 `open()`、`model = true` 还是 ref 触发；`open(config)`
 * 的入参再覆盖 `defaults`。
 *
 * `defaults` 支持**响应式**：可传普通对象、`ref`，或 getter 函数，**在每次 open 时用 `toValue`
 * 求值取最新**（不是持续追踪，而是每次唤起读一次）。函数型字段（`when`/`resolve`/钩子）写在返回
 * 的对象里，不会被误当 getter 调用。
 *
 * 对 `v-model` 驱动的弹窗尤其重要：普通入队若被排队则 `model` 的 getter 读回 false 会导致回弹，
 * 因此想「立刻显示/插队」的 v-model 弹窗应在 `defaults` 里带 `overlap: true`（叠加、绕过串行）或
 * `replace: true`（抢占当前串行槽）——两者都会让实例立即进入 active，getter 立刻为 true、不回弹。
 */
export function useOverlay<TData = unknown>(id: string, defaults?: MaybeRefOrGetter<Omit<OverlayConfig<TData>, "id">>, om?: Layerman): UseOverlayReturn<TData> {
  const m = useManager(om);
  const state = useOverlayState(m);
  const instance = computed(() => state.value.active.find((o: OverlayInstance) => o.id === id));
  return {
    instance,
    visible: computed(() => instance.value !== undefined),
    model: computed<boolean>({
      get: () => instance.value !== undefined,
      set: (value: boolean) => {
        if (value) {
          if (instance.value === undefined && !state.value.queued.includes(id)) m.open({ ...toValue(defaults), id });
        } else if (m.get(id)) {
          // 已展示（open/closing）：走 close()（尊重 beforeClose）。无 beforeClose 时 close() 已同步
          // 转 closing——按原「立即移除」的第三方 v-model 契约收尾；有 beforeClose 时 close() 是异步
          // 的（守卫未决），此时 phase 仍是 open，交给守卫自行处理，不强制 remove。
          m.close(id);
          if (m.get(id)?.phase === "closing") m.remove(id);
        } else {
          // 尚未展示（还在排队/pending）：beforeClose 语义上只守「已展示时的关闭」，对排队项不适用
          // ——直接 remove() 撤下，维持原「立即移除」契约（否则会卡在队列里出不来）。
          m.remove(id);
        }
      },
    }),
    phase: computed(() => instance.value?.phase),
    open: <TResult = unknown>(config?: Omit<OverlayConfig<TData>, "id">) => m.open<TData, TResult>({ ...toValue(defaults), ...config, id }),
    close: () => m.close(id),
    remove: () => m.remove(id),
    resolve: (value: unknown) => m.resolve(id, value),
    reject: (error: unknown) => m.reject(id, error),
    pause: () => m.pause(id),
    resume: () => m.resume(id),
  };
}

/**
 * 中央渲染器逐条为「当前 overlay」提供 id（在包裹每个活跃项的小组件 setup 内调用），
 * 使被渲染的 overlay 组件内部可用 `useCurrentOverlay()` 零透传拿到自身控制句柄。
 */
export function provideCurrentOverlay(id: string): void {
  provide(CURRENT_OVERLAY_KEY, id);
}

/**
 * 在 overlay 组件**内部**使用：经 inject 拿到自身 id，返回与 `useOverlay(id)` 相同的句柄
 * （`instance/visible/phase/open/close/remove/resolve/reject/pause/resume`），无需父层透传 id。
 * 需外层用 `provideCurrentOverlay(id)`（或声明式 template+ref 场景直接用 `useOverlay(id)`）。
 */
export function useCurrentOverlay<TData = unknown>(om?: Layerman): UseOverlayReturn<TData> {
  const id = inject(CURRENT_OVERLAY_KEY, undefined);
  if (!id) {
    throw new Error("[layerman/vue] useCurrentOverlay(): no current overlay — wrap the rendered overlay with provideCurrentOverlay(id)");
  }
  return useOverlay<TData>(id, undefined, om);
}
