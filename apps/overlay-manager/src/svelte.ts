/**
 * @codejoo/overlaymanager/svelte — Svelte 接入层（可选 peer 依赖 `svelte`，兼容 4/5）。
 *
 * 只做一件事：把管理器的 `subscribe`+`getSnapshot` 桥成 **Svelte store 契约**（纯对象
 * `{ subscribe }`，不依赖 runes 编译器 / DOM），再在其上封出命令式 / 声明式两种唤起风格的
 * helper。不含任何 `.svelte` 组件——渲染留给宿主。
 *
 * 管理器实例的获取遵循「context 默认 + 参数覆盖」：helper 的可选 `om` 参数优先，缺省则从
 * `setOverlayManager(om)` 注入的 context 回退。⚠️`setContext`/`getContext` 只能在组件 init
 * 期调用；不在组件上下文（如纯逻辑 / 测试）时，请显式传入 `om`。
 */

import { getContext, setContext } from "svelte";
import { derived, type Readable, readable } from "svelte/store";

import type { OverlayConfig, OverlayHandle, OverlayInstance, OverlayManager, OverlayState } from "./index.ts";

/** context 键：默认管理器。 */
const OVERLAY_MANAGER_KEY = Symbol("overlay-manager");
/** context 键：「当前 overlay id」（由中央渲染器逐条 setContext，overlay 组件内消费）。 */
const CURRENT_OVERLAY_KEY = Symbol("current-overlay");

/**
 * 在组件 init 期注入默认管理器（等价于 Vue 插件 / provide）。**只能在组件初始化时调用**。
 * 之后同组件树内的 helper 不传 `om` 即可经 context 回退到它。
 */
export function setOverlayManager(om: OverlayManager): void {
  setContext(OVERLAY_MANAGER_KEY, om);
}

/** 在组件 init 期读取被注入的默认管理器（无则 undefined）。**只能在组件初始化时调用**。 */
export function getOverlayManager(): OverlayManager | undefined {
  return getContext<OverlayManager | undefined>(OVERLAY_MANAGER_KEY);
}

function useManager(om?: OverlayManager): OverlayManager {
  // 显式传入优先，且不触碰 context —— 保证「不在组件上下文」的用法（纯逻辑/测试）可用。
  const resolved = om ?? getOverlayManager();
  if (!resolved) {
    throw new Error("[overlay-manager/svelte] no manager available — pass one explicitly or call setOverlayManager(om) during component init");
  }
  return resolved;
}

/**
 * 把管理器状态桥成 `Readable<OverlayState>`。用 `readable(seed, start)`：首个订阅者到来时
 * `start` 被调用并 `om.subscribe(set, { immediate })` 立即回填最新快照；返回的退订函数即
 * store 的 stop 回调 —— 最后一个订阅者离开时自动退订核心，无泄漏。
 */
export function overlayState(om?: OverlayManager): Readable<OverlayState> {
  const m = useManager(om);
  return readable(m.getSnapshot(), (set) => m.subscribe(set, { immediate: true }));
}

/** 命令式风格：拿到 active / queued 两个只读 store，用于中央渲染器遍历。 */
export function overlays(om?: OverlayManager): {
  active: Readable<readonly OverlayInstance[]>;
  queued: Readable<readonly string[]>;
} {
  const state = overlayState(om);
  return {
    active: derived(state, (s) => s.active),
    queued: derived(state, (s) => s.queued),
  };
}

/** 单个 overlay 绑定的返回值。`TData` 用于约束 `open` 的 `data` 入参类型。 */
export interface OverlayBinding<TData = unknown> {
  /** 该 id 当前的活跃实例 store（未展示时为 undefined）。 */
  instance: Readable<OverlayInstance | undefined>;
  /** 是否正在展示的 store。 */
  visible: Readable<boolean>;
  /** 当前渲染阶段（open/closing）store，未展示时 undefined。 */
  phase: Readable<OverlayInstance["phase"] | undefined>;
  /** 唤起（自动带上本 id，并合并 `defaults`）；返回可 await 的句柄。 */
  open: <TResult = unknown>(config?: Omit<OverlayConfig<TData>, "id">) => OverlayHandle<TResult>;
  close: () => void;
  remove: () => void;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
  pause: () => void;
  resume: () => void;
}

/** `defaults` 可为对象或返回对象的 getter（每次 open 求值取最新，函数型字段不会被误当 getter）。 */
export type OverlayDefaults<TData = unknown> = Omit<OverlayConfig<TData>, "id"> | (() => Omit<OverlayConfig<TData>, "id">);

/**
 * 声明式风格：按 id 绑定，返回一组只读 store（`instance/visible/phase`）+ 命令式方法。
 *
 * `defaults` 声明该 overlay 的固有行为（`overlap`/`replace`/`priority`/`cooldown`/`route`/`delay`
 * 等），会合并进**每一次** open；`open(config)` 的入参再覆盖 `defaults`。`defaults` 支持传对象或
 * getter 函数，getter **在每次 open 时求值取最新**（不是持续追踪）。
 */
export function overlay<TData = unknown>(id: string, defaults?: OverlayDefaults<TData>, om?: OverlayManager): OverlayBinding<TData> {
  const m = useManager(om);
  const state = overlayState(m);
  const instance = derived(state, (s) => s.active.find((o: OverlayInstance) => o.id === id));
  const resolveDefaults = (): Omit<OverlayConfig<TData>, "id"> | undefined => (typeof defaults === "function" ? defaults() : defaults);
  return {
    instance,
    visible: derived(instance, (i) => i !== undefined),
    phase: derived(instance, (i) => i?.phase),
    open: <TResult = unknown>(config?: Omit<OverlayConfig<TData>, "id">) => m.open<TData, TResult>({ ...resolveDefaults(), ...config, id }),
    close: () => m.close(id),
    remove: () => m.remove(id),
    resolve: (value: unknown) => m.resolve(id, value),
    reject: (error: unknown) => m.reject(id, error),
    pause: () => m.pause(id),
    resume: () => m.resume(id),
  };
}

/**
 * 中央渲染器逐条为「当前 overlay」提供 id（在包裹每个活跃项的小组件 init 内调用），
 * 使被渲染的 overlay 组件内部可用 `currentOverlay()` 零透传拿到自身控制句柄。
 * **只能在组件初始化时调用**。
 */
export function provideCurrentOverlay(id: string): void {
  setContext(CURRENT_OVERLAY_KEY, id);
}

/**
 * 在 overlay 组件**内部**使用：经 context 拿到自身 id，返回与 `overlay(id)` 相同的绑定，无需父层
 * 透传 id。需外层用 `provideCurrentOverlay(id)`。**只能在组件初始化时调用**（依赖 getContext）。
 */
export function currentOverlay<TData = unknown>(om?: OverlayManager): OverlayBinding<TData> {
  const id = getContext<string | undefined>(CURRENT_OVERLAY_KEY);
  if (!id) {
    throw new Error("[overlay-manager/svelte] currentOverlay(): no current overlay — wrap the rendered overlay with provideCurrentOverlay(id)");
  }
  return overlay<TData>(id, undefined, om);
}
