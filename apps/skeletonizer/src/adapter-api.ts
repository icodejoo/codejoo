/**
 * 框架适配层（vue / react / svelte）共用的胶水：从私有全局键取 core 的 enable / disable。
 * 本文件不引用任何 core 运行时代码（只有零依赖的键常量和开发警告），适配层产物里没有 core。
 * 实现由使用方导入 skeletonizer（完整版）或 skeletonizer/lite 提供；都没导入时，开发模式下打印一次错误提示，调用本身不做任何事。
 */
import type { EnableOptions, SkzGlobal } from "skeletonizer/lite";
import { SKZ_API_KEY } from "./core/api-key.js";
import { warnOnce } from "./core/dev.js";

/** 适配层用到的那部分 API */
type SkzApi = Pick<SkzGlobal, "enable" | "disable">;

/** 没有实现时的开发提示（只在开发模式的守卫里引用，生产构建会被摘掉） */
const MISSING_MESSAGE =
  '[skeletonizer] No implementation found: import either "skeletonizer" (full) or "skeletonizer/lite" (only one of them) at your app entry; the framework adapters and <skz-box> are thin wrappers around it.';

/**
 * 取私有全局键上的 API；没有时开发模式提示一次。
 * @returns enable / disable，未导入实现时为 undefined
 */
function api(): SkzApi | undefined {
  const found = (globalThis as unknown as Record<symbol, SkzApi | undefined>)[SKZ_API_KEY];
  if (!found) {
    try {
      if (process.env.NODE_ENV !== "production") warnOnce("adapter-missing", MISSING_MESSAGE);
    } catch {}
  }
  return found;
}

/**
 * 开启骨架：转发给已导入实现的 enable。
 * @param el 骨架根元素
 * @param opts 骨架选项
 * @returns 关闭函数；没有实现时是空函数
 * @example const off = enable(el, { effect: "pulse" });
 */
export function enable(el: HTMLElement, opts: EnableOptions = {}): () => void {
  const impl = api();
  return impl ? impl.enable(el, opts) : () => {};
}

/**
 * 关闭骨架：转发给已导入实现的 disable。
 * @param el 骨架根元素
 * @example disable(el);
 */
export function disable(el: HTMLElement): void {
  api()?.disable(el);
}

/**
 * 按 loading 开关骨架态：真则 enable，假则 disable。
 * @param el 骨架根元素
 * @param loading 是否加载中
 * @param opts 骨架选项
 * @example toggle(el, loading, { effect: "pulse" });
 */
export function toggle(el: HTMLElement, loading: boolean, opts: EnableOptions = {}): void {
  if (loading) enable(el, opts);
  else disable(el);
}
