/**
 * @codejoo/layerman/solid — SolidJS 接入层（可选 peer 依赖 `solid-js`）。
 *
 * 只做一件事：把管理器的 `subscribe`+`getSnapshot` 桥成 Solid signal（accessor），再在其上封出
 * 命令式 / 声明式两种唤起风格的原语。不含任何渲染组件、不写 JSX、不依赖 solid 的编译器——只用
 * solid-js 运行时原语（`createSignal`/`createMemo`/`onCleanup`/`createContext`/`useContext`）。
 *
 * 管理器实例的获取遵循「Provider 默认 + 参数覆盖」：composable 的可选 `om` 参数优先，缺省则从
 * `LayermanProvider` / `provideLayerman` 注入的实例回退。
 *
 * 所有 composable 假定在 Solid 响应式作用域内调用（组件 `setup` 或 `createRoot` 内）——signal 的
 * 创建、`onCleanup` 退订、`useContext` 注入均依赖当前 owner/tracking scope。
 */

import { type Accessor, createContext, createSignal, getOwner, onCleanup, useContext } from "solid-js";

import type { OverlayConfig, OverlayHandle, OverlayInstance, Layerman, OverlayState } from "./index.ts";

/** 「当前管理器」注入 Context（idiomatic：`<LayermanContext.Provider value={om}>`）。 */
export const LayermanContext = createContext<Layerman>();
/** 「当前 overlay id」注入 Context（由中央渲染器逐条 provide，overlay 组件内 useCurrentOverlay 消费）。 */
export const CurrentOverlayContext = createContext<string>();

/** idiomatic JSX Provider 别名：`<LayermanProvider value={om}>...</LayermanProvider>`。 */
export const LayermanProvider = LayermanContext.Provider;
/** idiomatic JSX Provider 别名（当前 overlay id）。 */
export const CurrentOverlayProvider = CurrentOverlayContext.Provider;

/**
 * 非 JSX 注入：在当前 owner（组件 setup / `createRoot` 回调）上就地写入默认管理器 Context。
 * 之后同一 owner 内、或此后创建的子作用域内的 composable 不传 `om` 即可回退到它。
 * 等价于用 `<LayermanProvider value={om}>` 包裹，但无需 JSX。
 */
export function provideLayerman(om: Layerman): void {
  provideContext(LayermanContext.id, om);
}

/** 非 JSX 注入：为「当前 overlay」提供 id（等价于 `<CurrentOverlayProvider value={id}>`）。 */
export function provideCurrentOverlay(id: string): void {
  provideContext(CurrentOverlayContext.id, id);
}

/** 在当前 owner 的 context 上就地挂一个键（Solid 子作用域按引用继承 owner.context）。 */
function provideContext(id: symbol, value: unknown): void {
  const owner = getOwner();
  if (!owner) {
    throw new Error("[layerman/solid] provide*(): must be called inside a reactive scope (component setup or createRoot)");
  }
  (owner as { context: Record<symbol, unknown> | null }).context = {
    ...(owner as { context: Record<symbol, unknown> | null }).context,
    [id]: value,
  };
}

function useManager(om?: Layerman): Layerman {
  const resolved = om ?? useContext(LayermanContext);
  if (!resolved) {
    throw new Error("[layerman/solid] no manager available — pass one explicitly or wrap with LayermanProvider / provideLayerman");
  }
  return resolved;
}

/**
 * 把管理器状态桥成 Solid signal（accessor）：初值取 `getSnapshot()`，`subscribe` 同步驱动 setter，
 * 作用域销毁时 `onCleanup` 自动退订。核心 `subscribe` 为同步触发，故 open/close 后 accessor 立即反映。
 */
export function useOverlayState(om?: Layerman): Accessor<OverlayState> {
  const m = useManager(om);
  const [state, setState] = createSignal(m.getSnapshot());
  const unsub = m.subscribe((s) => setState(s));
  onCleanup(unsub);
  return state;
}

/**
 * 命令式风格：拿到响应式的 active / queued，用于中央渲染器遍历。
 *
 * 用「派生 signal」（读取 signal 的普通函数，Solid 里等价于未记忆化的 `createMemo`）而非 `createMemo`：
 * 二者在客户端都完全响应式；但 vitest 在 node 下解析到 solid-js 的 **SSR 构建**，其 `createMemo`
 * 只在创建时求值一次并冻结（返回 `() => v`）——派生 signal 每次读取都重算，故在 SSR 与客户端下都正确。
 */
export function useOverlays(om?: Layerman): {
  active: Accessor<readonly OverlayInstance[]>;
  queued: Accessor<readonly string[]>;
} {
  const state = useOverlayState(om);
  return {
    active: () => state().active,
    queued: () => state().queued,
  };
}

/** `defaults` 可传对象或返回对象的函数；每次 open 求值取最新。 */
export type OverlayDefaults<TData = unknown> = Omit<OverlayConfig<TData>, "id"> | (() => Omit<OverlayConfig<TData>, "id">);

/** 单个 overlay 的绑定返回值。`TData` 用于约束 `open` 的 `data` 入参类型。 */
export interface UseOverlayReturn<TData = unknown> {
  /** 该 id 当前的活跃实例（未展示时为 undefined）；`data` 对本层不透明，读取时自行断言类型。 */
  instance: Accessor<OverlayInstance | undefined>;
  /** 是否正在展示。 */
  visible: Accessor<boolean>;
  /** 当前渲染阶段（open/closing），未展示时 undefined。 */
  phase: Accessor<OverlayInstance["phase"] | undefined>;
  /** 唤起（自动带上本 id，并合并 defaults）；返回可 await 的句柄。 */
  open: <TResult = unknown>(config?: Omit<OverlayConfig<TData>, "id">) => OverlayHandle<TResult>;
  close: () => void;
  remove: () => void;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
  pause: () => void;
  resume: () => void;
}

function resolveDefaults<TData>(defaults?: OverlayDefaults<TData>): Omit<OverlayConfig<TData>, "id"> | undefined {
  return typeof defaults === "function" ? defaults() : defaults;
}

/**
 * 声明式风格：常驻组件把「可见权」托管给管理器，按 id 绑定。
 * `const o = useOverlay('promo')`，`<Show when={o.visible()}>` 显隐。
 *
 * `defaults` 声明该 overlay 的固有行为（`overlap`/`replace`/`priority`/`cooldown`/`route`/`delay`
 * 等），会合并进**每一次** open；`open(config)` 的入参再覆盖 `defaults`。`defaults` 支持传普通对象或
 * getter 函数，**在每次 open 时求值取最新**（不是持续追踪，而是每次唤起读一次）。函数型字段
 * （`when`/`resolve`/钩子）写在返回的对象里，不会被误当 getter 调用。
 */
export function useOverlay<TData = unknown>(id: string, defaults?: OverlayDefaults<TData>, om?: Layerman): UseOverlayReturn<TData> {
  const m = useManager(om);
  const state = useOverlayState(m);
  // 派生 signal（非 createMemo）——理由同 useOverlays：SSR 构建下 createMemo 会冻结。
  const instance: Accessor<OverlayInstance | undefined> = () => state().active.find((o: OverlayInstance) => o.id === id);
  return {
    instance,
    visible: () => instance() !== undefined,
    phase: () => instance()?.phase,
    open: <TResult = unknown>(config?: Omit<OverlayConfig<TData>, "id">) => m.open<TData, TResult>({ ...resolveDefaults(defaults), ...config, id }),
    close: () => m.close(id),
    remove: () => m.remove(id),
    resolve: (value: unknown) => m.resolve(id, value),
    reject: (error: unknown) => m.reject(id, error),
    pause: () => m.pause(id),
    resume: () => m.resume(id),
  };
}

/**
 * 在 overlay 组件**内部**使用：经 `useContext` 拿到自身 id，返回与 `useOverlay(id)` 相同的句柄
 * （`instance/visible/phase/open/close/remove/resolve/reject/pause/resume`），无需父层透传 id。
 * 需外层用 `provideCurrentOverlay(id)`（或 `<CurrentOverlayProvider value={id}>`）。
 */
export function useCurrentOverlay<TData = unknown>(om?: Layerman): UseOverlayReturn<TData> {
  const id = useContext(CurrentOverlayContext);
  if (!id) {
    throw new Error("[layerman/solid] useCurrentOverlay(): no current overlay — wrap the rendered overlay with provideCurrentOverlay(id)");
  }
  return useOverlay<TData>(id, undefined, om);
}
