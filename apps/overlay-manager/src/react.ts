/**
 * @codejoo/overlaymanager/react — React 18/19 接入层（可选 peer 依赖 `react`）。
 *
 * 只做一件事：把管理器的 `subscribe`+`getSnapshot`(+`getServerSnapshot`) 经 `useSyncExternalStore`
 * 桥成 React 状态（引用变即触发、天然抗 tearing、SSR 安全），再在其上封出命令式 / 声明式两种
 * 唤起风格的 hook。不含任何渲染组件——渲染留给宿主（本文件保持 .ts，无 JSX）。
 *
 * 管理器实例的获取遵循「Context 默认 + 参数覆盖」：hook 的可选 `om` 参数优先，缺省则从
 * `OverlayManagerProvider` 注入的实例回退，取不到则抛错。
 */

import { createContext, createElement, type FunctionComponent, type ReactNode, useCallback, useContext, useMemo, useRef, useSyncExternalStore } from "react";

import type { OverlayConfig, OverlayHandle, OverlayInstance, OverlayManager, OverlayState } from "./index.ts";

/* ────────────────────────────── Context 注入 ────────────────────────────── */

/** 注入默认管理器的 Context（`useOverlayManager`/各 hook 缺省时回退到它）。 */
export const OverlayManagerContext = createContext<OverlayManager | null>(null);

/** Provider 的 props。 */
export interface OverlayManagerProviderProps {
  /** 要注入的管理器实例。 */
  manager: OverlayManager;
  children?: ReactNode;
}

/**
 * 为子树注入默认管理器：`<OverlayManagerProvider manager={om}>…</OverlayManagerProvider>`。
 * 子树内的 hook 不传 `om` 时即从此取。
 */
export const OverlayManagerProvider: FunctionComponent<OverlayManagerProviderProps> = ({ manager, children }) => createElement(OverlayManagerContext.Provider, { value: manager }, children);

/** 工厂式写法：预绑定一个管理器，返回一个只需 `children` 的 Provider 组件。 */
export function createOverlayManagerProvider(manager: OverlayManager): FunctionComponent<{ children?: ReactNode }> {
  return ({ children }) => createElement(OverlayManagerContext.Provider, { value: manager }, children);
}

/** 取当前生效的管理器：显式 `om` 优先，否则读 Context，都没有则抛错。 */
export function useOverlayManager(om?: OverlayManager): OverlayManager {
  const fromContext = useContext(OverlayManagerContext);
  const resolved = om ?? fromContext;
  if (!resolved) {
    throw new Error("[overlay-manager/react] no manager available — pass one explicitly or wrap with <OverlayManagerProvider>");
  }
  return resolved;
}

/* ────────────────────────────── 状态桥 ────────────────────────────── */

/**
 * 把管理器状态桥成 React 状态（`useSyncExternalStore` 自带订阅/退订，抗 tearing、SSR 安全）。
 * 服务端 / hydration 用 `getServerSnapshot`（核心返回冻结的空态）。
 */
export function useOverlayState(om?: OverlayManager): OverlayState {
  const m = useOverlayManager(om);
  // 绑定 this 并稳定引用：管理器方法作为裸引用传入会丢失 this，且 useSyncExternalStore 要求
  // subscribe 引用稳定（否则每次渲染都退订重订）。以 m 为 key 记忆一组绑定后的方法。
  const store = useMemo(
    () => ({
      subscribe: (onChange: () => void) => m.subscribe(onChange),
      getSnapshot: () => m.getSnapshot(),
      getServerSnapshot: () => m.getServerSnapshot(),
    }),
    [m],
  );
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
}

/** 命令式风格：拿到 active / queued，用于中央渲染器遍历。 */
export function useOverlays(om?: OverlayManager): {
  active: readonly OverlayInstance[];
  queued: readonly string[];
} {
  const state = useOverlayState(om);
  return useMemo(() => ({ active: state.active, queued: state.queued }), [state]);
}

/* ────────────────────────────── 单个 overlay ────────────────────────────── */

/** `defaults` 允许直接给对象，或给一个返回配置的函数以支持「每次 open 取最新」。 */
export type OverlayDefaults<TData = unknown> = Omit<OverlayConfig<TData>, "id"> | (() => Omit<OverlayConfig<TData>, "id">);

/** 单个 overlay 的绑定返回值。`TData` 用于约束 `open` 的 `data` 入参类型。 */
export interface UseOverlayReturn<TData = unknown> {
  /** 该 id 当前的活跃实例（未展示时为 undefined）；`data` 对本层不透明，读取时自行断言类型。 */
  instance: OverlayInstance | undefined;
  /** 是否正在展示。 */
  visible: boolean;
  /** 当前渲染阶段（open/closing），未展示时 undefined。 */
  phase: OverlayInstance["phase"] | undefined;
  /** 唤起（自动带上本 id）；返回可 await 的句柄。`config` 覆盖 `defaults`。 */
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
 * 组件内 `const { visible, open, resolve } = useOverlay('promo')`，据 `visible` 显隐。
 *
 * `defaults` 声明该 overlay 的固有行为（`overlap`/`replace`/`priority`/`cooldown`/`route`/`delay`
 * 等），会合并进**每一次** open；`open(config)` 的入参再覆盖 `defaults`。
 *
 * `defaults` 可传普通对象或返回配置的函数（**在每次 open 时调用取最新值**——不是持续追踪，而是
 * 每次唤起读一次）。用 `useRef` 稳定引用避免因 `defaults` 每次渲染变化而重建回调、触发重渲。
 */
export function useOverlay<TData = unknown>(id: string, defaults?: OverlayDefaults<TData>, om?: OverlayManager): UseOverlayReturn<TData> {
  const m = useOverlayManager(om);
  const state = useOverlayState(m);
  const instance = useMemo(() => state.active.find((o: OverlayInstance) => o.id === id), [state, id]);

  // 用 ref 存 defaults：每次渲染写最新，读取在 open 时进行，从而 open 回调可保持稳定引用。
  const defaultsRef = useRef(defaults);
  defaultsRef.current = defaults;

  const resolveDefaults = useCallback((): Omit<OverlayConfig<TData>, "id"> | undefined => {
    const d = defaultsRef.current;
    return typeof d === "function" ? d() : d;
  }, []);

  const open = useCallback(<TResult = unknown>(config?: Omit<OverlayConfig<TData>, "id">) => m.open<TData, TResult>({ ...resolveDefaults(), ...config, id }), [m, id, resolveDefaults]);
  const close = useCallback(() => m.close(id), [m, id]);
  const remove = useCallback(() => m.remove(id), [m, id]);
  const resolve = useCallback((value: unknown) => m.resolve(id, value), [m, id]);
  const reject = useCallback((error: unknown) => m.reject(id, error), [m, id]);
  const pause = useCallback(() => m.pause(id), [m, id]);
  const resume = useCallback(() => m.resume(id), [m, id]);

  return {
    instance,
    visible: instance !== undefined,
    phase: instance?.phase,
    open,
    close,
    remove,
    resolve,
    reject,
    pause,
    resume,
  };
}

/* ────────────────────────────── 当前 overlay ────────────────────────────── */

/** 「当前 overlay id」的 Context（由中央渲染器逐条提供，overlay 组件内 useCurrentOverlay 消费）。 */
export const CurrentOverlayContext = createContext<string | null>(null);

/** 当前 overlay Provider 的 props。 */
export interface CurrentOverlayProviderProps {
  /** 当前正在渲染的 overlay id。 */
  id: string;
  children?: ReactNode;
}

/**
 * 中央渲染器逐条为「当前 overlay」提供 id（包裹每个活跃项），使被渲染的 overlay 组件内部可用
 * `useCurrentOverlay()` 零透传拿到自身控制句柄。
 */
export const provideCurrentOverlay: FunctionComponent<CurrentOverlayProviderProps> = ({ id, children }) => createElement(CurrentOverlayContext.Provider, { value: id }, children);

/**
 * 在 overlay 组件**内部**使用：经 Context 拿到自身 id，返回与 `useOverlay(id)` 相同的句柄，
 * 无需父层透传 id。需外层用 `<provideCurrentOverlay id={id}>`（或直接用 `useOverlay(id)`）。
 */
export function useCurrentOverlay<TData = unknown>(om?: OverlayManager): UseOverlayReturn<TData> {
  const id = useContext(CurrentOverlayContext);
  if (!id) {
    throw new Error("[overlay-manager/react] useCurrentOverlay(): no current overlay — wrap the rendered overlay with <provideCurrentOverlay id={id}>");
  }
  return useOverlay<TData>(id, undefined, om);
}
