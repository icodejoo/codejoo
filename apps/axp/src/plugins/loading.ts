import { resolveOption, resolveRequestOption, type AxpOption, type IPluginSwitch } from "../options";
import type { AxpResponse, IAxpResponse } from "../response";
import type { AxpPlugin } from "../types";
import { fireNotice } from "../utils";

/** 内置显示插件名称。 */
const NAME = "axp:loading";
/** 默认不延迟显示或隐藏。 */
const DEFAULTS = { /** 显示不延迟。 */ delay: 0, /** 隐藏不延迟。 */ delayClose: 0 };
/** 通知故障始终输出。 */
const CALLBACK_ERROR = `[${NAME}] loading 回调失败`;
/** 显示状态回调；异步拒绝同样隔离。
 * @param visible 当前共享 UI 是否应显示。
 * @returns 通知结果，不参与请求落定。
 * @example `const loading: TLoadingFunc = visible => spinner.toggle(visible)`
 */
export type TLoadingFunc = (visible: boolean) => unknown;
/** 逻辑请求的显示选项。
 * @example `axpLoading({ loading, delay: 100 })`
 */
export interface ILoadingOptions extends IPluginSwitch {
  /** 按回调身份分别计数。 */
  loading?: TLoadingFunc;
  /** 首个请求进入后延迟显示的毫秒数。 */
  delay?: number;
  /** 最后请求结束后延迟隐藏的毫秒数。 */
  delayClose?: number;
}
/** 一个回调自己的防闪烁状态。 */
interface ILoadingState {
  /** 在途请求数。 */
  count: number;
  /** 是否已通知显示。 */
  shown: boolean;
  /** 当前等待显示或隐藏的定时器。 */
  timer?: ReturnType<typeof setTimeout>;
}
/** 同一 UI 回调在所有客户端间共享计数和防闪烁窗口。 */
const states = new WeakMap<TLoadingFunc, ILoadingState>();
/** 取消某个未触发的 UI 通知。 */
function clearTimer(state: ILoadingState): void {
  clearTimeout(state.timer);
  state.timer = undefined;
}
/** 函数简写仅作为通知回调，不动态求值；其它类型不认。 */
function shorthand(value: unknown): Partial<ILoadingOptions> | undefined {
  return typeof value === "function" ? { loading: value as TLoadingFunc } : undefined;
}
/** 按回调汇总逻辑请求，覆盖内层重试和重放。
 * @param options 显示回调、总开关及防闪烁延迟。
 * @returns 按回调共享计数、按客户端释放占用的插件。
 * @example `axpLoading({ loading: visible => spinner.toggle(visible), delay: 100 })`
 */
export default function axpLoading<R extends IAxpResponse<unknown, string | number> = AxpResponse>(options: ILoadingOptions = {}): AxpPlugin<R> {
  const base = resolveOption<ILoadingOptions, typeof DEFAULTS>(undefined, options, DEFAULTS);
  return {
    /** 内置插件标识。 */
    name: NAME,
    /** 插件总开关。 */
    enable: options.enable,
    /** 覆盖整个逻辑请求的外层阶段。 */
    stage: "outer",
    /** 当前客户端只记录自己的占用及待隐藏回调。 */
    setup() {
      const counts = new Map<TLoadingFunc, number>();
      /** 卸载后在途请求不再扣减共享计数。 */
      let active = true;
      /** 状态先于通知更新，回调失败不影响后续请求。 */
      function toggle(fn: TLoadingFunc, state: ILoadingState, visible: boolean): void {
        state.shown = visible;
        if (!visible) {
          states.delete(fn);
          counts.delete(fn);
        }
        fireNotice(fn, CALLBACK_ERROR, visible);
      }
      /** 同一回调最多保留一个显示或隐藏窗口。 */
      function schedule(fn: TLoadingFunc, state: ILoadingState, visible: boolean, delay: number): void {
        if (delay > 0)
          state.timer = setTimeout(
            /** 窗口到期后发出当前通知。 */ () => {
              state.timer = undefined;
              toggle(fn, state, visible);
            },
            delay,
          );
        else toggle(fn, state, visible);
      }
      return {
        /** 每个逻辑请求只增加和释放一次计数。 */
        async handle(ctx, next) {
          const resolved = active ? resolveRequestOption(ctx.request.loading, base, DEFAULTS, shorthand) : null;
          if (!resolved?.loading) return next();
          const fn = resolved.loading;
          const current = states.get(fn) ?? { count: 0, shown: false };
          states.set(fn, current);
          counts.set(fn, (counts.get(fn) ?? 0) + 1);
          if (++current.count === 1) {
            clearTimer(current);
            if (!current.shown) {
              schedule(fn, current, true, resolved.delay);
            }
          }
          try {
            return await next();
          } finally {
            if (active) {
              const remaining = counts.get(fn)! - 1;
              if (remaining) counts.set(fn, remaining);
              else counts.delete(fn);
              if (--current.count === 0) {
                clearTimer(current);
                if (current.shown) {
                  counts.set(fn, 0);
                  schedule(fn, current, false, resolved.delayClose);
                } else states.delete(fn);
              }
            }
          }
        },
        /** 撤回自身占用；共享计数归零时立即清理 UI 和定时器。 */
        dispose() {
          if (!active) return;
          active = false;
          for (const [fn, count] of counts) {
            const state = states.get(fn);
            if (!state) continue;
            state.count -= count;
            if (state.count === 0) {
              clearTimer(state);
              if (state.shown) toggle(fn, state, false);
              else states.delete(fn);
            }
          }
          counts.clear();
        },
      };
    },
  };
}

declare module "../types" {
  interface AxpRequestOptions {
    /** 四种写法；函数简写仅作为通知回调。 */
    loading?: AxpOption<ILoadingOptions, TLoadingFunc>;
  }
}
