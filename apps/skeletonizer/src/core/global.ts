import { Bone } from "./bone.js";
import { defineSkzBox } from "./element.js";
import { disable, enable } from "./enable.js";
import { warnOnce } from "./dev.js";

/**
 * 全局变量 skz 的形状：免 import 直接用（`skz.enable(el)`、`skz.bone.text(8)`）。
 * 完整版（skeletonizer/full）会通过 `declare module "skeletonizer"` 往这里补 registerCustomElements。
 */
export interface SkzGlobal {
  /** 开启骨架，见 enable */
  enable: typeof enable;
  /** 关闭骨架，见 disable */
  disable: typeof disable;
  /** mock 数据生成器 */
  bone: typeof Bone;
  /** 注册 <skz-box> 自定义元素，见 defineSkzBox */
  defineSkzBox: typeof defineSkzBox;
}

declare global {
  /** skeletonizer 的全局入口（导入任一入口后可用） */
  var skz: SkzGlobal;
}

/** 标记"这个 skz 对象是我们挂的"：Symbol.for 全局唯一，多份拷贝之间也认得 */
const OWNER = Symbol.for("skeletonizer.global");

/** 取全局对象：现代环境用 globalThis，老浏览器退回 self / window */
function root(): Record<string, unknown> | undefined {
  if (typeof globalThis !== "undefined") return globalThis as unknown as Record<string, unknown>;
  if (typeof self !== "undefined") return self as unknown as Record<string, unknown>;
  return undefined;
}

/**
 * 模块级唯一的 skz 对象：既是 `import skz from "skeletonizer"` 的默认导出，也是挂到全局的那个对象。
 * 全局被别人占用时它照样可用；完整版入口会往它上面补 registerCustomElements。
 * @example
 * import skz from "skeletonizer";
 * skz.enable(el, { effect: "shimmer" });
 */
// 完整版的类型增强会让 SkzGlobal 多出 registerCustomElements（由完整版入口运行时补上），这里只放 core 的成员
export const skz = { enable, disable, bone: Bone, defineSkzBox } as SkzGlobal;
Object.defineProperty(skz, OWNER, { value: true });

/**
 * 取出我们自己挂在全局上的 skz；全局上没有、或是别人的同名变量时返回 undefined。
 * @returns 我们的 skz 对象
 * @example skzGlobal()?.registerCustomElements
 */
export function skzGlobal(): SkzGlobal | undefined {
  const cur = root()?.skz as (SkzGlobal & { [OWNER]?: true }) | undefined;
  return cur && cur[OWNER] ? cur : undefined;
}

/**
 * 把 skz 挂到全局：已经有我们自己挂的就刷新；已经有别人的同名变量则不覆盖，并在开发模式警告一次。
 * 不冻结对象，完整版要往上补属性。SSR（Node）里同样挂载。
 * @returns 是否挂上了
 * @example mountGlobal();
 */
export function mountGlobal(): boolean {
  const g = root();
  if (!g) return false;
  const cur = g.skz;
  if (cur !== undefined && cur !== null && !(cur as { [OWNER]?: true })[OWNER]) {
    warnOnce("global-skz", "[skeletonizer] 全局 skz 已被占用，未覆盖。请改用 import 方式使用：import { enable } from 'skeletonizer'");
    return false;
  }
  g.skz = skz;
  return true;
}
