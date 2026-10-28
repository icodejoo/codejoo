import { resolveOption, type AxpOption, type IPluginSwitch } from "../options";
import type { AxpResponse, IAxpResponse } from "../response";
import type { AxpPlugin } from "../types";
import { fireNotice, isPlainObject } from "../utils";

/** 内置显示插件名称。 */
const NAME = "axp:loading";
/** 默认不延迟显示或隐藏。 */
const DEFAULTS = { /** 显示不延迟。 */ delay: 0, /** 隐藏不延迟。 */ delayClose: 0 };
/** 通知故障始终输出。 */
const CALLBACK_ERROR = `[${NAME}] loading 回调失败`;
/** 显示状态回调；异步拒绝同样隔离。 */
export type TLoadingFunc = (visible: boolean) => unknown;
/** 逻辑请求的显示选项。 */
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
/** 取消某个未触发的 UI 通知。 */
function clearTimer(state: ILoadingState): void {
  clearTimeout(state.timer);
  state.timer = undefined;
}
/** 函数简写仅作为通知回调，不动态求值。 */
function shorthand(value: unknown): Partial<ILoadingOptions> {
  return { loading: value as TLoadingFunc };
}
/** 按回调汇总逻辑请求，覆盖内层重试和重放。
 * @param options 显示回调、总开关及防闪烁延迟。
 * @returns 每客户端在 setup 建立独立计数的插件。
 * @example `axpLoading({ loading: visible => spinner.toggle(visible), delay: 100 })`
 */
export default function axpLoading<R extends IAxpResponse = AxpResponse>(options: ILoadingOptions = {}): AxpPlugin<R> {
  const base = resolveOption<ILoadingOptions, typeof DEFAULTS>(undefined, options, DEFAULTS);
  return {
    name: NAME,
    enable: options.enable,
    stage: "outer",
    /** 不同客户端各自管理计数和定时器。 */
    setup() {
      const states = new Map<TLoadingFunc, ILoadingState>();
      let active = true;
      /** 状态先于通知更新，回调失败不影响后续请求。 */
      function toggle(fn: TLoadingFunc, state: ILoadingState, visible: boolean): void {
        state.shown = visible;
        if (!visible) states.delete(fn);
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
          const value = ctx.request.loading;
          if (!active || value === false || (!base.loading && typeof value !== "function" && (!isPlainObject(value) || !value.loading))) return next();
          const resolved = isPlainObject(value) || typeof value === "function" ? resolveOption(value, base, DEFAULTS, shorthand) : base;
          if (!resolved?.loading) return next();
          const fn = resolved.loading;
          const current = states.get(fn) ?? { count: 0, shown: false };
          states.set(fn, current);
          if (++current.count === 1) {
            clearTimer(current);
            if (!current.shown) {
              schedule(fn, current, true, resolved.delay);
            }
          }
          try {
            return await next();
          } finally {
            if (--current.count === 0 && active) {
              clearTimer(current);
              if (current.shown) {
                schedule(fn, current, false, resolved.delayClose);
              } else states.delete(fn);
            }
          }
        },
        /** 取消定时器，结束已显示的 UI，旧请求不再通知。 */
        dispose() {
          active = false;
          for (const [fn, state] of states) {
            clearTimer(state);
            if (state.shown) fireNotice(fn, CALLBACK_ERROR, false);
          }
          states.clear();
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
