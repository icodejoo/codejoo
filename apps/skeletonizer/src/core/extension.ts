import type { EnableOptions } from "./types.js";

/**
 * 通用扩展点：给 enable() 挂接额外的运行时处理（文字模式、方案调度、懒渲染等）。
 * core 不认识任何具体扩展，只在 enable / disable 时按注册顺序逐个回调。
 */
export interface SkzExtension {
  /** 扩展名；同名重复注册以后者为准 */
  name: string;
  /**
   * 每次 enable() 调用都会触发（含重复调用）：扩展自己判断本次选项下是否生效、并清理上一次留下的痕迹。
   * 此时根上已带 skz，主题变量读得到。
   * @param el 骨架根元素
   * @param opts 本次的骨架选项
   */
  sync(el: HTMLElement, opts: EnableOptions): void;
  /**
   * 关闭骨架时触发：撤掉本扩展在根上留下的一切。
   * @param el 骨架根元素
   */
  release(el: HTMLElement): void;
}

/** 已注册的扩展，Map 保持注册顺序；覆盖同名扩展时沿用原来的位置 */
const extensions = new Map<string, SkzExtension>();

/** extensions 的数组快照缓存：enable / disable 每次都要遍历，没新注册时复用同一份；注册时置空 */
let snapshot: readonly SkzExtension[] | null = null;

/**
 * 注册扩展；按 name 去重，同名的后者覆盖前者（位置不变）。完整版入口会自动注册自带的几个，一般不需要手动调用。
 * @param ext 扩展
 * @example
 * registerExtension({
 *   name: "my-ext",
 *   sync: (el, opts) => el.toggleAttribute("my-flag", opts.effect === "pulse"),
 *   release: (el) => el.removeAttribute("my-flag"),
 * });
 */
export function registerExtension(ext: SkzExtension): void {
  extensions.set(ext.name, ext);
  snapshot = null;
}

/**
 * 当前已注册的扩展（按注册顺序）。仅供 enable 内部遍历。
 * @returns 扩展列表的只读快照（遍历期间有新注册也不会变；没新注册时多次调用返回同一份）
 */
export function listExtensions(): readonly SkzExtension[] {
  if (!snapshot) snapshot = Array.from(extensions.values());
  return snapshot;
}
