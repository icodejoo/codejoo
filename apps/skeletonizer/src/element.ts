/**
 * skeletonizer/element 入口：`<skz-box>` 自定义元素（light DOM）。
 * 本文件不含 core 运行时代码：开关骨架经 adapter-api 取私有全局键上的实现，
 * 实现由使用方导入 skeletonizer（完整版）或 skeletonizer/lite 提供；都没导入时开发模式提示一次，元素不做任何事。
 * 导入本模块没有副作用，需要手动调用一次 defineSkzBox() 注册。
 */
import type { EnableOptions } from "skeletonizer/lite";
import { disable, enable } from "./adapter-api.js";

/** 非浏览器环境（SSR）没有 HTMLElement，用空类占位，保证 import 不报错 */
const BaseElement: typeof HTMLElement = typeof HTMLElement !== "undefined" ? HTMLElement : (class {} as unknown as typeof HTMLElement);

/** <skz-box> 的默认标签名（包内用，不导出） */
const SKZ_BOX_TAG = "skz-box";

/** 宿主上的加载开关属性名 */
const ATTR_LOADING = "loading";

/** 宿主上的 fit 开关属性名 */
const ATTR_FIT = "fit";

/** 原样透传给 enable 的字符串选项对应的属性名（text / fallback / engine 由完整版扩展处理） */
const OPTION_ATTRS = ["effect", "text", "fallback", "engine"] as const;

/** 假值字面量：loading="false" 视为关闭 */
const FALSE_LITERAL = "false";

/**
 * 宿主上某个布尔属性是否开启：属性存在且值不是 "false"。
 * @param host 宿主元素
 * @param name 属性名
 * @returns 是否开启
 */
function isOn(host: Element, name: string): boolean {
  return host.hasAttribute(name) && host.getAttribute(name) !== FALSE_LITERAL;
}

/** 每个宿主当前接管的子根元素（模块级 WeakMap：私有字段 / 私有方法在 es2015 目标下会生成一堆 helper） */
const activeChildren = new WeakMap<SkzBox, HTMLElement>();

/**
 * 按宿主的属性开关当前子根的骨架：子根被替换时先撤掉旧的。
 * @param host 宿主元素
 */
function sync(host: SkzBox): void {
  const prev = activeChildren.get(host);
  const target = host.firstElementChild as HTMLElement | null;
  if (prev && prev !== target) {
    disable(prev);
    activeChildren.delete(host);
  }
  if (!target) return;
  activeChildren.set(host, target);

  if (host.loading) {
    // text / fallback / engine 是完整版扩展认的选项，core 只管原样透传
    const opts: Record<string, unknown> = { fit: isOn(host, ATTR_FIT) };
    for (const name of OPTION_ATTRS) opts[name] = host.getAttribute(name) ?? undefined;
    enable(target, opts as EnableOptions);
  } else {
    disable(target);
  }
}

/**
 * <skz-box loading> 自定义元素：light DOM、不用 shadow，子节点仍归你的框架管。
 * 属性：loading（布尔开关，属性存在且值不为 "false" 即为开启）、effect（fade|solid|pulse|shimmer，默认 fade）、
 * fit（存在且不为 "false" 即开启）；另有 text / fallback / engine 三个属性原样传给 enable，
 * 它们由完整版（skeletonizer）的扩展处理，只导入 lite 时被忽略。
 * 宿主只负责读取 loading 开关和选项，实际的骨架状态（skz 属性等）作用在【第一个元素子节点】上。
 * 使用前先从 skeletonizer/element 导入并调用一次 defineSkzBox()，且应用里要导入过 skeletonizer 或 skeletonizer/lite 之一。
 * 注意：不带 MutationObserver，子根被框架替换后需要由用户自己处理（例如切一下 loading）。
 *
 * SSR / 无 JS：直接在子根上写 skz（及需要的标记），浏览器仅靠 CSS 就能显示骨架；JS 起来后 enable 是幂等的。
 *
 * @example
 * <skz-box loading effect="pulse"><div>……</div></skz-box>
 * @example
 * <!-- SSR / 无 JS：子根自带 skz -->
 * <skz-box loading><div skz>……</div></skz-box>
 */
export class SkzBox extends BaseElement {
  /** 需要监听的属性 */
  static get observedAttributes(): string[] {
    return [ATTR_LOADING, ...OPTION_ATTRS, ATTR_FIT];
  }

  /**
   * 是否处于加载态：loading 属性存在且值不是 "false" 即为开启。
   * @returns 当前是否开启
   * @example el.loading; // true
   */
  get loading(): boolean {
    return isOn(this, ATTR_LOADING);
  }

  /**
   * 开关加载态，读写的就是 loading 属性。
   * @param v 是否开启
   * @example el.loading = true;
   */
  set loading(v: boolean) {
    this.toggleAttribute(ATTR_LOADING, !!v);
  }

  /**
   * 挂载时同步一次状态。
   * 若 defineSkzBox() 跑在 HTML 解析完成之前（比如 head 里的同步脚本），此刻子节点可能还没解析出来，
   * 之后也没有别的时机接管，所以没子元素又仍在解析时，等 DOMContentLoaded 再同步一次。
   */
  connectedCallback(): void {
    sync(this);
    if (!this.firstElementChild && typeof document !== "undefined" && document.readyState === "loading") {
      document.addEventListener(
        "DOMContentLoaded",
        () => {
          if (this.isConnected) sync(this);
        },
        { once: true },
      );
    }
  }

  /** 卸载时对当前子根解除骨架，但不改变宿主自己的 loading 属性（从而在移动节点后能自然恢复） */
  disconnectedCallback(): void {
    const child = activeChildren.get(this);
    if (child) {
      disable(child);
      activeChildren.delete(this);
    }
  }

  /** 属性变化时同步状态 */
  attributeChangedCallback(): void {
    if (this.isConnected) sync(this);
  }
}

/**
 * 注册 <skz-box>；重复注册是安全的。
 * @param tag 标签名，默认 skz-box
 * @example defineSkzBox();
 */
export function defineSkzBox(tag: string = SKZ_BOX_TAG): void {
  if (typeof customElements !== "undefined" && !customElements.get(tag)) {
    customElements.define(tag, SkzBox);
  }
}
