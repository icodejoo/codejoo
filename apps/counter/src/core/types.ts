import type countdown from "../count-down/count-down";
import type countup from "../count-up/count-up";

export interface IPlugin {
  /** 插件名，同时作为 api 挂载到 gt 上的 key，需与类型增强声明的字段一致 */
  name: string;
  /**
   * 每帧回调，接收 (elapsed, dt)：elapsed 为 RAF 时间戳，dt 为距上一帧的毫秒数。
   * 返回 false 表示当前没有待处理任务；所有插件都返回 false 时核心自动停止 RAF。
   * 返回 true 或 undefined 均视为"仍有任务"。
   */
  install(elapsed: number, dt: number): boolean | void;
  /** 插件暴露给 gt 的 API，会以 plugin.name 作为 key 挂到 gt 上 */
  api?: unknown;
  /** 释放钩子：counter.destroy() 时调用，用于清空该插件的任务/观察者等资源 */
  dispose?: () => void;
}

/**
 * gt 的类型形状。内置插件的 api 以 type-only import 直接声明（运行时无依赖环），
 * 第三方插件可通过 declare module "@codejoo/counter" 扩展此接口。
 */
export interface Counter {
  start(): void;
  stop(): void;
  use(plugin: IPlugin): void;
  /** 销毁：停止 RAF、清空所有插件任务与观察者、卸载已挂载 api。之后再调用 countup/countdown 会自动重建 */
  destroy(): void;
  /** countup 插件 api，首次调用 countup(...) 自举注册后挂载（或手动 use(countup.install())）；注册前为 undefined */
  up?: typeof countup;
  /** countdown 插件 api，首次调用 countdown(...) 自举注册后挂载（或手动 use(countdown.install())）；注册前为 undefined */
  down?: typeof countdown;
}
