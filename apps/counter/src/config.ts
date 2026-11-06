import { defaults as countdownDefaults, resetDefaults as resetCountdownDefaults } from "./count-down/count-down";
import { defaults as countupDefaults, resetDefaults as resetCountupDefaults } from "./count-up/count-up";

/** count-up 与 count-down 共有、可一次性全局设置的选项 */
export interface ISharedOptions {
  /** 更新频率（次/秒），0 表示每帧；两边共用同一套网格节流 */
  fps?: number;
  /** 是否懒加载（元素进入视口才开始） */
  lazy?: boolean;
  /** lazy 的超时兜底（ms），0 表示不兜底 */
  lazyTimeout?: number;
  /** 完成后是否自动出队销毁 */
  autoKill?: boolean;
  /** 页面隐藏 / 元素离屏时是否静音 */
  muteHidden?: boolean;
}

/**
 * 一次设置，count-up 与 count-down 的全局默认值同时生效；只改传入的键。
 * 分组配置与单任务选项仍优先于此处。
 * @param options 共享选项
 * @example
 * configure({ fps: 30, muteHidden: false });
 */
export function configure(options: ISharedOptions): void {
  Object.assign(countupDefaults, options);
  Object.assign(countdownDefaults, options);
}

/** 把 count-up 与 count-down 的全局默认值同时还原为出厂值 */
export function resetAllDefaults(): void {
  resetCountupDefaults();
  resetCountdownDefaults();
}
