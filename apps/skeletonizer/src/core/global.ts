import { Bone } from "./bone.js";
import { disable, enable } from "./enable.js";
import { warnOnce } from "./dev.js";
import { SKZ_API_KEY } from "./api-key.js";

/**
 * 全局变量 skz 的形状：免 import 直接用（`skz.enable(el)`、`skz.bone.text(8)`）。
 */
export interface SkzGlobal {
  /** 开启骨架，见 enable */
  enable: typeof enable;
  /** 关闭骨架，见 disable */
  disable: typeof disable;
  /** mock 数据生成器 */
  bone: typeof Bone;
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
 * 模块级唯一的 skz 对象：既是 `import skz from "skeletonizer/lite"`（完整版为 `skeletonizer`）的默认导出，也是挂到全局的那个对象。
 * 全局被别人占用时它照样可用。
 * 无论公开的 skz 有没有挂上，它都会挂在私有键 SKZ_API_KEY 上供适配层取用。
 * @example
 * import skz from "skeletonizer/lite";
 * skz.enable(el, { effect: "shimmer" });
 */
export const skz: SkzGlobal = { enable, disable, bone: Bone };
Object.defineProperty(skz, OWNER, { value: true });

/**
 * 把 skz 挂到全局：总会先挂到私有键 SKZ_API_KEY（适配层靠它取 API）；
 * 公开的 skz 变量已经有我们自己挂的就刷新，已经有别人的同名变量则不覆盖，并在开发模式警告一次。
 * 不冻结对象。SSR（Node）里同样挂载。
 * @returns 是否挂上了
 * @example mountGlobal();
 */
export function mountGlobal(): boolean {
  const g = root();
  if (!g) return false;
  // 私有键总是指向本模块实例的 skz（完整版里它已带扩展），不受公开变量被占用的影响
  g[SKZ_API_KEY as unknown as string] = skz;
  const cur = g.skz;
  if (cur !== undefined && cur !== null && !(cur as { [OWNER]?: true })[OWNER]) {
    try {
      if (process.env.NODE_ENV !== "production")
        warnOnce("global-skz", "[skeletonizer] globalThis.skz is already taken and was not overwritten. Use the import instead: import skz from 'skeletonizer' (or 'skeletonizer/lite').");
    } catch {}
    return false;
  }
  g.skz = skz;
  return true;
}
